-- COL-635: the report scheduler and the nightly risk scorer on the hosted project.
--
-- Run this by hand in the Supabase SQL editor (or an admin session) on the
-- hosted project, after the configuration steps below are done. Do not run it
-- from the build and do not commit values. Placeholders are in angle brackets.
-- Pattern: scripts/census/cron-schedules.sql and scripts/care-events/cron-schedules.sql.
--
-- What production looked like on 2026-09-22 (read-only inspection):
--
--   * report-scheduler-daily (jobid 33, '0 6 * * *') exists and is monitored by
--     job_monitor, but every call returns 503. The report-scheduler Edge
--     Function has no REPORT_SCHEDULER_RUNNER_URL secret, so it refuses before
--     it reaches Haven. The Netlify REPORT_SCHEDULER_SECRET also differs from
--     the Edge Function and Vault value (the Vault value matches the Edge value),
--     so once the URL is set, the Next.js runner would still answer 401.
--   * There is no cron job for risk-nightly-scorer at all, and no Vault secret
--     for it. The Edge Function is deployed and RISK_NIGHTLY_SCORER_SECRET
--     matches between the Edge Function and Netlify.
--
-- ---------------------------------------------------------------------------
-- 0. Configuration (outside SQL; Brian approves and runs these)
-- ---------------------------------------------------------------------------
--
--   a. Point the report-scheduler Edge Function at the Haven runner:
--        supabase secrets set --project-ref <project-ref> \
--          REPORT_SCHEDULER_RUNNER_URL=https://<production host>/api/reports/scheduler
--      The function refuses anything that is not https and does not end in
--      exactly /api/reports/scheduler.
--
--   b. Make the Netlify REPORT_SCHEDULER_SECRET equal to the Edge Function /
--      Vault value (or rotate all three to one new value: Edge Function secret,
--      Netlify env var, and vault secret 'report_scheduler_secret'). The runner
--      compares x-cron-secret against its own copy; the Edge Function forwards
--      its own copy. Netlify env changes need a redeploy to take effect.
--
--   c. Create the risk scorer's Vault secret once (value = the
--      RISK_NIGHTLY_SCORER_SECRET already set on the Edge Function):
--        select vault.create_secret('<the RISK_NIGHTLY_SCORER_SECRET value>', 'risk_nightly_scorer_secret');
--      The job below also reads the existing 'project_url' and 'anon_key'
--      Vault secrets, the same ones report-scheduler-daily uses.

-- ---------------------------------------------------------------------------
-- 1. Report scheduler cadence (optional, recommended)
--
-- The job runs once a day at 06:00 UTC (02:00 in America/New_York), so a
-- report scheduled for Monday 08:00 is produced at 02:00 on Tuesday. Running
-- the dispatcher hourly delivers each report within the hour it is due; the
-- dispatcher only picks up schedules whose next_run_at has passed, so the
-- extra calls do no work. cron.alter_job changes the schedule only, so the
-- job_monitor wrapper on the command stays in place.
-- ---------------------------------------------------------------------------
select cron.alter_job(
  (select jobid from cron.job where jobname = 'report-scheduler-daily'),
  schedule := '5 * * * *'
);

-- ---------------------------------------------------------------------------
-- 2. Nightly risk scorer: once a day after resident-safety-scorer
--    (resident-safety-scorer-daily runs at 11:00 UTC; the risk score reads
--    the resident safety rows it writes).
--
-- "notify": false is required: the function writes risk snapshots and
-- executive alerts, and refuses notify:true with 409 ("Risk notifications
-- require current recipient authority"), so no owner SMS is sent from here.
-- With no organization_id in the body it scores every organization.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'risk-nightly-scorer-daily') then
    perform cron.unschedule('risk-nightly-scorer-daily');
  end if;
end
$$;

select cron.schedule(
  'risk-nightly-scorer-daily',
  '30 11 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/risk-nightly-scorer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'risk_nightly_scorer_secret')
    ),
    body := '{"notify": false}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Put the new job under the response-aware monitor (COL-253 / COL-547), so a
-- non-2xx answer is recorded in job_monitor.runs and alerts a person, instead
-- of pg_cron reporting success for every call.
select job_monitor.instrument((select jobid from cron.job where jobname = 'risk-nightly-scorer-daily'));

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- select jobid, jobname, schedule, active from cron.job
--  where jobname in ('report-scheduler-daily', 'risk-nightly-scorer-daily');
-- select j.jobname, r.requested_at, r.http_status, r.outcome
--   from job_monitor.runs r join cron.job j using (jobid)
--  where j.jobname in ('report-scheduler-daily', 'risk-nightly-scorer-daily')
--  order by r.requested_at desc limit 10;
-- select facility_id, snapshot_date, risk_score, risk_level
--   from risk_score_snapshots order by computed_at desc limit 10;
