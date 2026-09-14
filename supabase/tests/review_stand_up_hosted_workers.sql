-- Hosted Stand Up worker grant, fence, queue and safe-bootstrap probes.
BEGIN;

CREATE FUNCTION pg_temp.su_hosted_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected IN SQLERRM)>0 THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected failure: %',expected;
END $$;

DO $$ BEGIN
  IF has_function_privilege('anon','public.stand_up_publisher_acquire(uuid,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.stand_up_google_bridge(text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.stand_up_google_export_bridge(text,jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.stand_up_history_publisher_acquire(uuid,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.stand_up_google_complete_export(jsonb)','EXECUTE')
     OR has_table_privilege('service_role','haven.stand_up_publisher_state','SELECT')
     OR has_table_privilege('service_role','haven.stand_up_google_exports','SELECT') THEN
    RAISE EXCEPTION 'Hosted Stand Up grant posture failed';
  END IF;
END $$;

SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE TEMP TABLE hosted_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON hosted_results TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO hosted_results VALUES('disabled',public.stand_up_publisher_acquire(gen_random_uuid(),50));
DO $$ BEGIN IF (SELECT value->>'reason' FROM hosted_results WHERE name='disabled')<>'disabled' THEN RAISE EXCEPTION 'Disabled publisher acquired'; END IF; END $$;
RESET ROLE;

UPDATE haven.stand_up_publisher_state SET enabled=true WHERE singleton;
SET LOCAL ROLE service_role;
INSERT INTO hosted_results VALUES('publisher_lease',public.stand_up_publisher_acquire('10000000-0000-0000-0000-000000000001',50));
SELECT public.stand_up_publisher_store_pending(
  '10000000-0000-0000-0000-000000000001',(value->>'lease_token')::uuid,(value->>'generation')::bigint,
  '{"dataset":"standup_weekly","sequence":1}',repeat('a',64),1,clock_timestamp()
) FROM hosted_results WHERE name='publisher_lease';
SELECT public.stand_up_publisher_complete(
  '10000000-0000-0000-0000-000000000001',(value->>'lease_token')::uuid,(value->>'generation')::bigint,
  'hosted-publisher-receipt',false,clock_timestamp()
) FROM hosted_results WHERE name='publisher_lease';
SELECT public.stand_up_publisher_release(
  '10000000-0000-0000-0000-000000000001',(value->>'lease_token')::uuid,(value->>'generation')::bigint,'accepted',NULL
) FROM hosted_results WHERE name='publisher_lease';
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM haven.stand_up_publisher_state WHERE sequence=1 AND pending_body IS NULL AND lease_token IS NULL AND last_outcome='accepted')
  THEN RAISE EXCEPTION 'Publisher completion was not durable'; END IF;
END $$;

SET LOCAL ROLE service_role;
INSERT INTO hosted_results VALUES('stale_lease',public.stand_up_publisher_acquire('10000000-0000-0000-0000-000000000002',50));
RESET ROLE;
UPDATE haven.stand_up_publisher_state SET enabled=false WHERE singleton;
UPDATE haven.stand_up_publisher_state SET enabled=true WHERE singleton;
SET LOCAL ROLE service_role;
SELECT pg_temp.su_hosted_fail(format(
  'SELECT public.stand_up_publisher_store_pending(%L,%L,%s,%L,%L,%s,clock_timestamp())',
  '10000000-0000-0000-0000-000000000002',(value->>'lease_token')::uuid,value->>'generation',
  '{"dataset":"standup_weekly","sequence":2}',repeat('b',64),2
),'lease is not current') FROM hosted_results WHERE name='stale_lease';
RESET ROLE;

UPDATE haven.stand_up_history_publisher_state SET enabled=true WHERE singleton;
SET LOCAL ROLE service_role;
INSERT INTO hosted_results VALUES('history_lease',public.stand_up_history_publisher_acquire('20000000-0000-0000-0000-000000000001',50));
SELECT public.stand_up_history_publisher_store_queue(
  '20000000-0000-0000-0000-000000000001',(value->>'lease_token')::uuid,(value->>'generation')::bigint,
  jsonb_build_array(jsonb_build_object('identity','2026-09-14:0','sequence',1,'fingerprint',repeat('c',64),
    'body','{"dataset":"standup_weekly_history","sequence":1}','source_as_of',clock_timestamp(),'first_sent_at',clock_timestamp()))
) FROM hosted_results WHERE name='history_lease';
SELECT public.stand_up_history_publisher_complete_head(
  '20000000-0000-0000-0000-000000000001',(value->>'lease_token')::uuid,(value->>'generation')::bigint,
  '2026-09-14:0',1,repeat('c',64),'hosted-history-receipt'
) FROM hosted_results WHERE name='history_lease';
SELECT public.stand_up_history_publisher_release(
  '20000000-0000-0000-0000-000000000001',(value->>'lease_token')::uuid,(value->>'generation')::bigint,'accepted',NULL
) FROM hosted_results WHERE name='history_lease';
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM haven.stand_up_history_publisher_state WHERE sequence=1 AND lease_token IS NULL)
     OR NOT EXISTS(SELECT 1 FROM haven.stand_up_history_fingerprints WHERE identity='2026-09-14:0' AND fingerprint=repeat('c',64))
  THEN RAISE EXCEPTION 'History queue completion was not durable'; END IF;
END $$;

UPDATE haven.stand_up_google_state SET workbook_id='hosted-review-workbook',enabled=true WHERE singleton;
INSERT INTO hosted_results VALUES('current_week',to_jsonb(haven.stand_up_week()));
SET LOCAL ROLE service_role;
INSERT INTO hosted_results VALUES('google_context',public.stand_up_google_bridge('load_context',
  jsonb_build_object('workbook_id','hosted-review-workbook','week_start',(SELECT value#>>'{}' FROM hosted_results WHERE name='current_week'))));
INSERT INTO hosted_results VALUES('google_apply',public.stand_up_google_bridge('apply_snapshot',jsonb_build_object(
  'workbook_id','hosted-review-workbook','week_start',(SELECT value#>>'{}' FROM hosted_results WHERE name='current_week'),'schema_version','standup-2026-v1',
  'source_sha256',repeat('d',64),'credential_fingerprint',repeat('e',64),'observed_at',clock_timestamp(),
  'drive',jsonb_build_object('etag','"review-etag"','version','1','head_revision_id','review-head','md5_checksum',repeat('f',32),'file_size',1024),
  'records','[]'::jsonb,
  'locations',(SELECT jsonb_object_agg((value#>>'{}')||':'||(SELECT value#>>'{}' FROM hosted_results WHERE name='current_week'),jsonb_build_object('sheet','Review'))
    FROM jsonb_each((SELECT value->'facility_map' FROM hosted_results WHERE name='google_context')))
)));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT value->>'state' FROM hosted_results WHERE name='google_apply')<>'synchronized'
     OR (SELECT count(*) FROM haven.stand_up_google_baselines WHERE week_start=haven.stand_up_week())<>5
     OR (SELECT count(*) FROM public.stand_up_revisions v JOIN haven.stand_up_connector_actors a ON a.actor_id=v.actor_id
         JOIN public.stand_up_reports r ON r.id=v.report_id WHERE r.week_start=haven.stand_up_week())<>5 THEN
    RAISE EXCEPTION 'Google empty Monday bootstrap was not safe and attributable';
  END IF;
END $$;

-- A Haven revision against an unchanged file must create a durable outbound
-- plan. Only exact provider readback advances the immutable common baseline.
SELECT haven.stand_up_connector_save(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0002-000000000002'::uuid,
  haven.stand_up_week(),
  (SELECT version FROM public.stand_up_reports WHERE facility_id='00000000-0000-0000-0002-000000000002'::uuid AND week_start=haven.stand_up_week()),
  jsonb_set((SELECT values FROM public.stand_up_reports WHERE facility_id='00000000-0000-0000-0002-000000000002'::uuid AND week_start=haven.stand_up_week()),'{current_total_census}','12'::jsonb),
  clock_timestamp(),'Synthetic Rising Oaks Haven edit','{"source":"sql-probe"}'::jsonb
);
INSERT INTO hosted_results VALUES('google_source_records',(
  SELECT jsonb_agg(jsonb_build_object('facility_id',b.facility_id,'week_start',b.week_start,'values',b.file_values))
  FROM haven.stand_up_google_baselines b WHERE b.week_start=haven.stand_up_week()
));
INSERT INTO hosted_results VALUES('google_output_records',(
  SELECT jsonb_agg(jsonb_build_object('facility_id',r.facility_id,'week_start',r.week_start,'values',r.values))
  FROM public.stand_up_reports r WHERE r.week_start=haven.stand_up_week()
));
SET LOCAL ROLE service_role;
INSERT INTO hosted_results VALUES('google_export_plan',public.stand_up_google_export_bridge('prepare_export',jsonb_build_object(
  'workbook_id','hosted-review-workbook','week_start',(SELECT value#>>'{}' FROM hosted_results WHERE name='current_week'),
  'source_sha256',repeat('d',64),'observed_at',clock_timestamp(),
  'drive',jsonb_build_object('etag','"review-etag"','version','1','head_revision_id','review-head','md5_checksum',repeat('f',32),'file_size',1024),
  'records',(SELECT value FROM hosted_results WHERE name='google_source_records')
)));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT value->>'state' FROM hosted_results WHERE name='google_export_plan')<>'export_required'
     OR (SELECT count(*) FROM jsonb_object_keys((SELECT value->'updates' FROM hosted_results WHERE name='google_export_plan')))<>1
     OR NOT EXISTS(SELECT 1 FROM haven.stand_up_google_exports WHERE state='pending') THEN
    RAISE EXCEPTION 'Haven change did not create one durable outbound plan';
  END IF;
END $$;
SET LOCAL ROLE service_role;
INSERT INTO hosted_results VALUES('google_export_recovered',public.stand_up_google_export_bridge('prepare_export',jsonb_build_object(
  'workbook_id','hosted-review-workbook','week_start',(SELECT value#>>'{}' FROM hosted_results WHERE name='current_week'),
  'source_sha256',repeat('1',64),'observed_at',clock_timestamp(),
  'drive',jsonb_build_object('etag','"output-etag"','version','2','head_revision_id','output-head','md5_checksum',repeat('2',32),'file_size',1100),
  'records',(SELECT value FROM hosted_results WHERE name='google_output_records')
)));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT value->>'state' FROM hosted_results WHERE name='google_export_recovered')<>'export_applied'
     OR (SELECT value->>'export_id' FROM hosted_results WHERE name='google_export_recovered')
        IS DISTINCT FROM (SELECT value->>'export_id' FROM hosted_results WHERE name='google_export_plan') THEN
    RAISE EXCEPTION 'Unknown successful provider write was not recovered by exact values';
  END IF;
END $$;
SET LOCAL ROLE service_role;
INSERT INTO hosted_results VALUES('google_export_complete',public.stand_up_google_complete_export(jsonb_build_object(
  'export_id',(SELECT value->>'export_id' FROM hosted_results WHERE name='google_export_plan'),
  'workbook_id','hosted-review-workbook','week_start',(SELECT value#>>'{}' FROM hosted_results WHERE name='current_week'),
  'source_sha256',repeat('1',64),'observed_at',clock_timestamp(),
  'drive',jsonb_build_object('etag','"output-etag"','version','2','head_revision_id','output-head','md5_checksum',repeat('2',32),'file_size',1100),
  'records',(SELECT value FROM hosted_results WHERE name='google_output_records')
)));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT value->>'state' FROM hosted_results WHERE name='google_export_complete')<>'synchronized'
     OR NOT EXISTS(SELECT 1 FROM haven.stand_up_google_exports WHERE state='completed' AND output_sha256=repeat('1',64))
     OR NOT EXISTS(SELECT 1 FROM haven.stand_up_google_baselines b JOIN public.stand_up_reports r
       ON r.facility_id=b.facility_id AND r.week_start=b.week_start
       WHERE b.facility_id='00000000-0000-0000-0002-000000000002'::uuid
         AND b.baseline_revision_id=r.revision_id AND b.file_values->>'current_total_census'='12')
     OR NOT EXISTS(SELECT 1 FROM haven.stand_up_google_runs WHERE detail->>'direction'='haven_to_google') THEN
    RAISE EXCEPTION 'Exact outbound readback did not advance the durable baseline';
  END IF;
END $$;

ROLLBACK;
