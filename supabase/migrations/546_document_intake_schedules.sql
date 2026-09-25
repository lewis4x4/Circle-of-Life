-- COL-771 (DI-04, DI-06): schedules for the Document Intake worker and mail receiver.
--
--   document-intake-processor   every minute     claims queued runs (reader + Jev proposals)
--   document-intake-mail-sync   every 5 minutes  Microsoft Graph delta sweep of active mailboxes
--
-- Same shape as 496/523: both jobs are created INACTIVE and switched on by hand
-- on each host once the Edge Functions, their secrets and the Vault entries
-- exist. The tick refuses independently when anything is missing, so an early
-- activation fails loudly instead of posting to the wrong place.
--
-- Vault (names only; values never in the repository):
--   document_intake_functions_url          https://<project-ref>.supabase.co/functions/v1
--   document_intake_processor_cron_secret  = Edge secret DOCUMENT_INTAKE_PROCESSOR_SECRET
--   document_intake_mail_sync_cron_secret  = Edge secret DOCUMENT_INTAKE_MAIL_SYNC_SECRET
-- The URL lives in Vault rather than here so Haven HFO Staging never posts to
-- production (or the reverse).
--
-- Monitoring: each job is registered in job_monitor.jobs and the tick posts
-- through job_monitor.http_post, so job_monitor.collect() records the real HTTP
-- outcome (a non-2xx or `ok:false` body is a failure, not a pg_cron success).
--
-- Replay-safe on a local Postgres without pg_cron, pg_net or Vault: every
-- reference to those schemas is dynamic and the schedule block is skipped.
BEGIN;

CREATE FUNCTION haven.document_intake_scheduler_tick(p_job text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE fn text; secret_name text; base_url text; secret text; url text; headers jsonb; monitored bigint; request_id bigint;
BEGIN
  CASE p_job
    WHEN 'document-intake-processor' THEN fn := 'document-intake-processor'; secret_name := 'document_intake_processor_cron_secret';
    WHEN 'document-intake-mail-sync' THEN fn := 'document-intake-mail-sync'; secret_name := 'document_intake_mail_sync_cron_secret';
    ELSE RAISE EXCEPTION 'document_intake_scheduler_unknown_job' USING ERRCODE = '22023';
  END CASE;
  IF to_regnamespace('vault') IS NULL OR to_regnamespace('net') IS NULL THEN
    RAISE EXCEPTION 'document_intake_scheduler_unconfigured';
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1' INTO base_url USING 'document_intake_functions_url';
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1' INTO secret USING secret_name;
  IF base_url IS NULL OR base_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1$' OR secret IS NULL OR length(secret) < 32 THEN
    RAISE EXCEPTION 'document_intake_scheduler_unconfigured';
  END IF;
  url := base_url || '/' || fn;
  headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', secret);
  IF to_regclass('job_monitor.jobs') IS NOT NULL AND to_regnamespace('cron') IS NOT NULL THEN
    EXECUTE 'SELECT m.jobid FROM job_monitor.jobs m JOIN cron.job c ON c.jobid = m.jobid WHERE c.jobname = $1'
      INTO monitored USING p_job;
  END IF;
  -- The processor stops claiming after 60 s but may finish a reader + Jev call
  -- after that; 150 s keeps a slow success from reading as a timeout.
  IF monitored IS NOT NULL THEN
    EXECUTE 'SELECT job_monitor.http_post(monitored_jobid:=$1,url:=$2,body:=$3,headers:=$4,timeout_milliseconds:=$5)'
      INTO request_id USING monitored, url, '{}'::jsonb, headers, 150000;
  ELSE
    EXECUTE 'SELECT net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=$4)'
      INTO request_id USING url, headers, '{}'::jsonb, 150000;
  END IF;
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION haven.document_intake_scheduler_tick(text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.document_intake_scheduler_tick(text) IS
  'COL-771: pg_cron body for the Document Intake processor and mail receiver. Reads the functions URL and the per-function cron secret from Vault and posts through job_monitor.http_post when the job is registered. Runs as the cron owner only.';

DO $document_intake_cron$
DECLARE job bigint; existing record; spec record;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOR spec IN SELECT * FROM (VALUES
      ('document-intake-processor', '* * * * *'),
      ('document-intake-mail-sync', '*/5 * * * *')) AS v(name, schedule) LOOP
    job := NULL;
    PERFORM pg_advisory_xact_lock(hashtextextended('haven.' || spec.name, 0));
    FOR existing IN EXECUTE 'SELECT * FROM cron.job WHERE jobname=$1' USING spec.name LOOP
      IF job IS NOT NULL OR existing.schedule IS DISTINCT FROM spec.schedule
        OR existing.command IS DISTINCT FROM format('SELECT haven.document_intake_scheduler_tick(%L)', spec.name)
        OR existing.username IS DISTINCT FROM current_user OR existing.database IS DISTINCT FROM current_database()
      THEN RAISE EXCEPTION 'document_intake_scheduler_name_conflict: %', spec.name USING ERRCODE = '55000'; END IF;
      job := existing.jobid;
    END LOOP;
    IF job IS NULL THEN
      EXECUTE 'SELECT cron.schedule($1,$2,$3)' INTO job
        USING spec.name, spec.schedule, format('SELECT haven.document_intake_scheduler_tick(%L)', spec.name);
      -- Managed postgres cannot UPDATE cron.job; the enclosing migration
      -- transaction publishes only the inactive job.
      EXECUTE 'SELECT cron.alter_job($1,active:=false)' USING job;
    END IF;
    -- Native registration: the command itself has no http_post to rewrite;
    -- the tick posts through job_monitor.http_post with this jobid.
    IF to_regclass('job_monitor.jobs') IS NOT NULL THEN
      EXECUTE 'INSERT INTO job_monitor.jobs(jobid,jobname,original_command,instrumented_command) VALUES ($1,$2,$3,$3) ON CONFLICT (jobid) DO NOTHING'
        USING job, spec.name, format('SELECT haven.document_intake_scheduler_tick(%L)', spec.name);
    END IF;
  END LOOP;
END $document_intake_cron$;

COMMIT;

-- Switch on (each host, after the functions and Vault entries exist):
--   SELECT cron.alter_job(jobid, active := true) FROM cron.job
--    WHERE jobname IN ('document-intake-processor','document-intake-mail-sync');
-- Verify:
--   SELECT job_monitor.collect();
--   SELECT j.jobname, r.requested_at, r.http_status, r.outcome FROM job_monitor.runs r
--     JOIN cron.job j USING (jobid) WHERE j.jobname LIKE 'document-intake-%' ORDER BY r.requested_at DESC;
-- Rollback: SELECT cron.unschedule('document-intake-processor'); SELECT cron.unschedule('document-intake-mail-sync');
--   DROP FUNCTION haven.document_intake_scheduler_tick(text); (job_monitor rows stay as evidence.)
