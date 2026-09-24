-- COL-547: two gaps the scheduled-job monitor found on 2026-09-23.
--
-- Run this by hand in an admin session (as postgres) on the hosted project.
-- It is idempotent: a second run changes nothing and reports each job as
-- already done. Rehearse on Haven HFO Staging first. Pattern:
-- scripts/reports/cron-schedules.sql.
--
-- 1. Monitored HTTP jobs without an explicit timeout inherit pg_net's
--    5-second default. grace-redteam-nightly, report-scheduler-daily,
--    resident-assurance-ai-daily and resident-safety-scorer-daily take longer
--    than that, so pg_net gave up and the monitor recorded an error even when
--    the function finished its work (the safety scorer wrote its scores).
--    Every monitored HTTP job still on the default gets 60 seconds, the value
--    risk-nightly-scorer-daily already uses. The job_monitor registry is
--    updated in the same transaction, so the monitor keeps recognizing the
--    command (command_matches) instead of reporting it as not_monitored, and
--    job_monitor.restore() would restore the timeout too.
--
-- 2. home-escalate-uncleared-15m was scheduled by
--    scripts/operator-home/cron-schedules.sql without being registered, so the
--    monitor reported it as not_monitored. It is pure SQL, so it is registered
--    natively (assessed from cron.job_run_details), not rewritten.
--
-- A job whose command no longer equals its registered command is left alone
-- and reported: that is a concurrent edit to review, not something to overwrite.

begin;

do $$
declare
  j record;
  rewritten text;
  original text;
  actual text;
  report text := '';
begin
  for j in
    select c.jobid, c.jobname, c.command, m.original_command, m.instrumented_command
    from cron.job c
    join job_monitor.jobs m on m.jobid = c.jobid
    where m.original_command <> m.instrumented_command
      and c.command ~ 'job_monitor\.http_post\s*\('
      and c.command !~ 'timeout_milliseconds'
    order by c.jobid
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('job_monitor:' || j.jobid::text, 0));
    if j.command <> j.instrumented_command then
      report := report || format(E'\n  %s: SKIPPED, command differs from its registration', j.jobname);
      continue;
    end if;
    rewritten := regexp_replace(j.command,
      '(job_monitor\.http_post\s*\(\s*monitored_jobid\s*:=\s*\d+\s*,)',
      '\1 timeout_milliseconds := 60000,');
    original := regexp_replace(j.original_command,
      '(net\.http_post\s*\()', '\1timeout_milliseconds := 60000, ');
    if rewritten = j.command or original = j.original_command then
      raise exception 'Could not place a timeout in job %; review it by hand', j.jobname;
    end if;
    perform cron.alter_job(j.jobid, command := rewritten);
    select command into strict actual from cron.job where jobid = j.jobid;
    if actual <> rewritten then
      raise exception 'Job % did not keep its new command', j.jobname;
    end if;
    update job_monitor.jobs
      set original_command = original, instrumented_command = rewritten
      where jobid = j.jobid;
    report := report || format(E'\n  %s: timeout set to 60000 ms', j.jobname);
  end loop;

  select c.jobid, c.jobname, m.jobid is not null registered into j
    from cron.job c left join job_monitor.jobs m on m.jobid = c.jobid
    where c.jobname = 'home-escalate-uncleared-15m';
  if not found then
    report := report || E'\n  home-escalate-uncleared-15m: not scheduled on this project';
  elsif j.registered then
    report := report || E'\n  home-escalate-uncleared-15m: already registered';
  else
    perform job_monitor.register_native(j.jobid);
    report := report || E'\n  home-escalate-uncleared-15m: registered with the monitor';
  end if;

  -- Session-scoped so the report survives the commit for the select below.
  perform set_config('col547.report', coalesce(nullif(report, ''), E'\n  nothing to change'), false);
end
$$;

-- Nothing monitored may be left on the default timeout or out of step with its
-- registration.
do $$
begin
  if exists (
    select 1 from cron.job c join job_monitor.jobs m on m.jobid = c.jobid
    where c.command <> m.instrumented_command
       or (c.command ~ 'job_monitor\.http_post\s*\(' and c.command !~ 'timeout_milliseconds')
  ) then
    raise exception 'A monitored job is still on the default timeout or differs from its registration';
  end if;
end
$$;

commit;

select current_setting('col547.report', true) as col547_report;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- select c.jobid, c.jobname, c.command = m.instrumented_command command_matches,
--        substring(c.command from 'timeout_milliseconds\s*:=\s*(\d+)') timeout_ms
--   from cron.job c left join job_monitor.jobs m using (jobid) order by c.jobid;
