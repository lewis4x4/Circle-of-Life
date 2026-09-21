-- COL-253: keep the response-aware monitor compatible with hosted pg_cron.
-- Supabase denies row locks/direct updates on cron.job; official cron functions
-- remain the only mutation surface. Advisory locks serialize monitor changes.

create or replace function job_monitor.instrument(target_jobid bigint) returns void
language plpgsql security invoker set search_path = '' as $$
declare j record; rewritten text; actual text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job_monitor:'||target_jobid::text,0));
  select * into strict j from cron.job where jobid=target_jobid;
  if exists(select 1 from job_monitor.jobs where jobid=target_jobid) then
    raise exception 'Job already instrumented; inspect existing registration';
  end if;
  if j.username <> current_user or
     (select count(*) from regexp_matches(j.command,'net\.http_post\s*\(','g')) <> 1 or
     j.command !~ 'net\.http_post\s*\(\s*(url|body|params|headers|timeout_milliseconds)\s*(:=|=>)' then
    raise exception 'Unsupported scheduler owner or HTTP command';
  end if;
  rewritten := regexp_replace(j.command,'net\.http_post\s*\(',
    format('job_monitor.http_post(monitored_jobid := %s, ',target_jobid));
  insert into job_monitor.jobs(jobid,jobname,original_command,instrumented_command)
    values(j.jobid,j.jobname,j.command,rewritten);
  perform cron.alter_job(target_jobid,command := rewritten);
  select command into strict actual from cron.job where jobid=target_jobid;
  if actual <> rewritten then raise exception 'Cron command did not retain monitoring wrapper'; end if;
end $$;

create or replace function job_monitor.register_native(target_jobid bigint) returns void
language plpgsql security invoker set search_path = '' as $$
declare j record;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job_monitor:'||target_jobid::text,0));
  select * into strict j from cron.job where jobid=target_jobid;
  if exists(select 1 from job_monitor.jobs where jobid=target_jobid) then
    raise exception 'Job already registered; inspect existing registration';
  end if;
  if j.username <> current_user or not j.active or
     j.command ~ '(net|job_monitor)\.http_(get|post|delete)\s*\(' then
    raise exception 'Unsupported scheduler owner or native command';
  end if;
  insert into job_monitor.jobs(jobid,jobname,original_command,instrumented_command)
    values(j.jobid,j.jobname,j.command,j.command);
end $$;

create or replace function job_monitor.restore(target_jobid bigint) returns void
language plpgsql security invoker set search_path = '' as $$
declare saved record; actual text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job_monitor:'||target_jobid::text,0));
  select * into strict saved from job_monitor.jobs where jobid=target_jobid;
  select command into strict actual from cron.job where jobid=target_jobid;
  if saved.original_command = saved.instrumented_command then
    raise exception 'Native jobs are registered, not rewritten';
  end if;
  if actual <> saved.instrumented_command then
    raise exception 'Cron command changed since instrumentation; preserve concurrent edit';
  end if;
  perform cron.alter_job(target_jobid,command := saved.original_command);
  select command into strict actual from cron.job where jobid=target_jobid;
  if actual <> saved.original_command then raise exception 'Cron command was not restored'; end if;
  -- Preserve the ledger and original command for audit; never delete evidence.
end $$;

revoke all on function job_monitor.instrument(bigint) from public, anon, authenticated, service_role;
revoke all on function job_monitor.register_native(bigint) from public, anon, authenticated, service_role;
revoke all on function job_monitor.restore(bigint) from public, anon, authenticated, service_role;
