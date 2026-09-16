-- 07A "Something happened": the two pg_cron jobs for the hosted project.
--
-- Run this by hand in the Supabase SQL editor (or an admin session) on the
-- hosted project after migrations 400 to 403 are applied. Do not run it from
-- the build and do not commit values. Placeholders are in angle brackets.
-- Pattern: docs/designs/2026-05-24-hygiene-pipeline-plan.md section 5.
--
-- Before running, create the two Vault secrets once (names only; values come
-- from the project dashboard and the Edge Function secret you set for
-- care-event-dispatcher):
--
--   select vault.create_secret('<the project anon key>', 'care_event_dispatcher_anon_key');
--   select vault.create_secret('<the CARE_EVENT_DISPATCHER_CRON_SECRET value>', 'care_event_dispatcher_cron_secret');
--
-- The dispatcher Edge Function verifies the x-cron-secret header against its
-- CARE_EVENT_DISPATCHER_CRON_SECRET environment variable. Replace
-- <project-ref> with the project reference (the subdomain of the project URL).
--
-- Both jobs are idempotent: an existing job with the same name is unscheduled
-- first, so re-running this file replaces rather than duplicates.

-- ---------------------------------------------------------------------------
-- 1. Escalation tick: every minute, inserts the next escalation step rows for
--    open Level 2 and above care events. Runs as the cron owner (postgres);
--    public.care_event_escalation_tick() is granted to service_role only.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'care-event-escalation-tick') then
    perform cron.unschedule('care-event-escalation-tick');
  end if;
end
$$;

select cron.schedule(
  'care-event-escalation-tick',
  '* * * * *',
  $$select public.care_event_escalation_tick();$$
);

-- ---------------------------------------------------------------------------
-- 2. Dispatcher: every minute, drains queued care_event_deliveries through the
--    care-event-dispatcher Edge Function (in_app, push, and sms/voice when
--    Twilio is enabled; otherwise those rows are marked skipped).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'care-event-dispatcher') then
    perform cron.unschedule('care-event-dispatcher');
  end if;
end
$$;

select cron.schedule(
  'care-event-dispatcher',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.functions.supabase.co/care-event-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'care_event_dispatcher_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'care_event_dispatcher_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- select jobid, jobname, schedule, active from cron.job
--  where jobname in ('care-event-escalation-tick', 'care-event-dispatcher');
-- select jobname, status, return_message, start_time from cron.job_run_details
--  where jobname in ('care-event-escalation-tick', 'care-event-dispatcher')
--  order by start_time desc limit 10;
