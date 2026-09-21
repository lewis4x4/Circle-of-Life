-- Run against the verified Haven production database after reviewing the three
-- exact jobs below. This wraps pg_net calls so job_monitor records the HTTP
-- result rather than treating pg_cron's enqueue as successful work.
BEGIN;

DO $$
DECLARE expected text[]:=ARRAY[
  'stand-up-google-inbound',
  'stand-up-front-office-current',
  'stand-up-front-office-history'
];
DECLARE job record;
BEGIN
 IF (SELECT count(*) FROM cron.job WHERE jobname=ANY(expected))<>3 THEN
  RAISE EXCEPTION 'Expected all three hosted Stand Up jobs';
 END IF;
 FOR job IN SELECT * FROM cron.job WHERE jobname=ANY(expected) ORDER BY jobname LOOP
  IF job.username<>'postgres' OR NOT job.active THEN
   RAISE EXCEPTION 'Stand Up job % must be active and owned by postgres',job.jobname;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM job_monitor.jobs m WHERE m.jobid=job.jobid) THEN
   PERFORM job_monitor.instrument(job.jobid);
  ELSIF NOT EXISTS(SELECT 1 FROM job_monitor.jobs m WHERE m.jobid=job.jobid AND m.instrumented_command=job.command) THEN
   RAISE EXCEPTION 'Stand Up job % changed after monitoring was installed',job.jobname;
  END IF;
 END LOOP;
END $$;

COMMIT;

-- Verify after at least two current/Google minutes and one history interval:
--   select job_monitor.collect();
--   select j.jobname,r.requested_at,r.http_status,r.outcome
--   from job_monitor.runs r join cron.job j using(jobid)
--   where j.jobname like 'stand-up-%' order by r.requested_at desc;
-- Recover one reviewed job with select job_monitor.restore(<jobid>).
