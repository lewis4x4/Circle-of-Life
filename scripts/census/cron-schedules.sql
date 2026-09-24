-- COL-414: the nightly pg_cron job that writes census_daily_log.
--
-- Run this by hand in the Supabase SQL editor (or an admin session) on the
-- hosted project after migration 415 is applied and the daily-census-log Edge
-- Function is deployed. Do not run it from the build and do not commit values.
-- Placeholders are in angle brackets. Pattern:
-- scripts/care-events/cron-schedules.sql and section 5 of
-- docs/designs/2026-05-24-hygiene-pipeline-plan.md.
--
-- Before running, create the Vault secrets once (names only; values come from
-- the project dashboard and the Edge Function secret you set for
-- daily-census-log):
--
--   select vault.create_secret('<the project anon key>', 'daily_census_log_anon_key');
--   select vault.create_secret('<the DAILY_CENSUS_LOG_SECRET value>', 'daily_census_log_cron_secret');
--
-- The Edge Function verifies the x-cron-secret header against its
-- DAILY_CENSUS_LOG_SECRET environment variable. Replace <project-ref> with the
-- project reference (the subdomain of the project URL).
--
-- The job is idempotent: an existing job with the same name is unscheduled
-- first, so re-running this file replaces rather than duplicates.

-- ---------------------------------------------------------------------------
-- Daily census: the midnight census for each facility's operating day.
--
-- pg_cron runs in UTC (scripts/scheduled-jobs/check.mjs refuses to assess a
-- scheduler on any other timezone), and America/New_York moves an hour twice a
-- year, so the job fires at both 04:30 and 05:30 UTC. Exactly one of those is
-- 00:30 in America/New_York on any given day; the Edge Function lets that one
-- through and reports the other as skipped, which is a success, not a failure.
--
-- This must land before exec-kpi-snapshot runs the same day. The executive
-- incident rate divides by the trailing 30 days of this table, and the newest
-- day of that window is the one written here.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-census-log') then
    perform cron.unschedule('daily-census-log');
  end if;
end
$$;

select cron.schedule(
  'daily-census-log',
  '30 4,5 * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/daily-census-log',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'daily_census_log_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'daily_census_log_cron_secret')
    ),
    body := '{}'::jsonb,
    -- pg_net's 5-second default is shorter than a run (COL-547).
    timeout_milliseconds := 60000
  );
  $$
);

-- Retain the actual HTTP outcome, not just pg_cron's SQL success (COL-253).
select job_monitor.instrument(jobid) from cron.job where jobname = 'daily-census-log';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- select jobid, jobname, schedule, active from cron.job where jobname = 'daily-census-log';
-- select jobname, status, return_message, start_time from cron.job_run_details
--  where jobname = 'daily-census-log' order by start_time desc limit 10;
--
-- One row per live facility per operating day, and nothing filled in for a day
-- the job did not run:
-- select log_date, count(*) facilities, sum(occupied_beds) residents_in_census
--   from public.census_daily_log
--  where log_date >= current_date - 30 group by log_date order by log_date desc;
