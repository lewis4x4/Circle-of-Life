-- Synthetic, rollback-only publication tests. Run after the reviewed standup import migration as postgres.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA haven, auth TO authenticated, service_role;
GRANT SELECT ON public.exec_standup_snapshots, public.exec_standup_snapshot_metrics, public.exec_standup_import_jobs TO service_role;
CREATE TEMP TABLE standup_fixture AS SELECT gen_random_uuid() org,gen_random_uuid() other_org,
  gen_random_uuid() entity,gen_random_uuid() other_entity,gen_random_uuid() facility,
  gen_random_uuid() missing_facility,gen_random_uuid() foreign_facility;
INSERT INTO public.organizations(id,name) SELECT org,'Standup import fixture' FROM standup_fixture
  UNION ALL SELECT other_org,'Foreign standup fixture' FROM standup_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'Fixture entity' FROM standup_fixture
  UNION ALL SELECT other_entity,other_org,'Foreign fixture entity' FROM standup_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT facility,entity,org,'Reporting fixture','Fixture','Fixture','00000',1 FROM standup_fixture
  UNION ALL SELECT missing_facility,entity,org,'Missing fixture','Fixture','Fixture','00000',1 FROM standup_fixture
  UNION ALL SELECT foreign_facility,other_entity,other_org,'Foreign fixture','Fixture','Fixture','00000',1 FROM standup_fixture;
INSERT INTO public.exec_standup_metric_definitions(organization_id,key,section_key,label,description,value_type,source_mode,aggregation_mode,time_grain,facility_scope,total_scope)
  SELECT org,'fixture_count','census','Fixture count','Synthetic review fixture','count','manual','sum','weekly',true,true FROM standup_fixture;
CREATE FUNCTION pg_temp.standup_assert(p_ok boolean,p_label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %',p_label; END IF;
  RAISE NOTICE 'PASS: %',p_label;
END $$;
CREATE FUNCTION pg_temp.standup_rows(p_week text DEFAULT '2091-01-01',p_value numeric DEFAULT 0) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('week_of',p_week,'facility_id',facility,'metric_key','fixture_count','metric_label','Fixture count',
    'section_key','census','value_numeric',p_value,'value_text',NULL,'source_row',2,'source_cells',jsonb_build_object('raw_value',p_value))) FROM standup_fixture
$$;
CREATE TEMP TABLE standup_context AS SELECT jsonb_build_object('facility_ids',
 (SELECT jsonb_agg(id ORDER BY id) FROM public.facilities WHERE organization_id=(SELECT org FROM standup_fixture) AND status='active' AND deleted_at IS NULL),
 'metric_definitions',(SELECT jsonb_agg(to_jsonb(d) ORDER BY key) FROM public.exec_standup_metric_definitions d
 WHERE organization_id=(SELECT org FROM standup_fixture) AND active AND deleted_at IS NULL)) context;
GRANT SELECT ON standup_context TO service_role,authenticated,anon;
CREATE FUNCTION pg_temp.standup_publish(p_hash text,p_rows jsonb DEFAULT NULL,p_versions jsonb DEFAULT '{"2091-01-01":0}',p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.haven_publish_standup_import(org,repeat(p_hash,64),'fixture.csv',coalesce(p_rows,pg_temp.standup_rows()),p_versions,p_reason,'Synthetic definition review 1',(SELECT context FROM standup_context)) FROM standup_fixture
$$;
CREATE FUNCTION pg_temp.standup_reject(p_sql text,p_code text,p_label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE<>p_code THEN RAISE EXCEPTION 'FAIL: % expected %, got %: %',p_label,p_code,SQLSTATE,SQLERRM; END IF;
    RAISE NOTICE 'PASS: %',p_label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % did not reject',p_label;
END $$;
GRANT SELECT ON standup_fixture TO service_role,authenticated,anon;
SET LOCAL ROLE service_role;
SELECT pg_temp.standup_publish('a');
SELECT pg_temp.standup_assert((SELECT completeness_pct=33.33 AND published_version=1 AND summary_json->>'missing_metric_count'='2'
  FROM public.exec_standup_snapshots WHERE organization_id=(SELECT org FROM standup_fixture)), 'Explicit zero counts against all facilities plus total scope');
SELECT pg_temp.standup_assert((pg_temp.standup_publish('a')->>'duplicate')::boolean,'Duplicate fingerprint returns original receipt');
SELECT pg_temp.standup_assert((SELECT count(*)=1 FROM public.exec_standup_import_receipts WHERE organization_id=(SELECT org FROM standup_fixture)), 'Retry has one receipt');
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('a',pg_temp.standup_rows('2091-01-01',5))$q$,'22023','Same fingerprint cannot change content');
SELECT pg_temp.standup_assert((SELECT summary_json->>'coverage_basis'='current_active_registry' AND jsonb_array_length(summary_json->'expected_facility_ids')=2
 AND jsonb_array_length(summary_json->'metric_definitions')=1 FROM public.exec_standup_snapshots WHERE organization_id=(SELECT org FROM standup_fixture)), 'Coverage denominator inputs preserved');
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('b',pg_temp.standup_rows('2091-01-01',1.5))$q$,'22023','Fractional count rejects');
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('b',NULL,'{"2091-01-01":1}')$q$,'22023','Correction requires reason');
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('b',NULL,'{"2091-01-01":0}','Correction')$q$,'40001','Stale preview rejects');
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('b',pg_temp.standup_rows()||pg_temp.standup_rows())$q$,'22023','Duplicate source rows reject');
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('b',jsonb_set(pg_temp.standup_rows(),'{0,facility_id}',to_jsonb((SELECT foreign_facility::text FROM standup_fixture))))$q$,'22023','Foreign facility rejects');
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('b',pg_temp.standup_rows('2091-02-01')||jsonb_set(pg_temp.standup_rows('2091-03-01'),'{0,metric_key}','"unknown"'),' {"2091-02-01":0,"2091-03-01":0}')$q$,'22023','Invalid late row rolls back file');
SELECT pg_temp.standup_assert((SELECT count(*)=1 FROM public.exec_standup_snapshots WHERE organization_id=(SELECT org FROM standup_fixture)), 'Failed file creates no weeks');
RESET ROLE;
CREATE TEMP TABLE original_standup AS SELECT to_jsonb(s) header,jsonb_agg(to_jsonb(m) ORDER BY m.id) metrics
 FROM public.exec_standup_snapshots s JOIN public.exec_standup_snapshot_metrics m ON m.snapshot_id=s.id
 WHERE s.organization_id=(SELECT org FROM standup_fixture) GROUP BY s.id;
GRANT SELECT ON original_standup TO service_role;
SET LOCAL ROLE service_role;
SELECT pg_temp.standup_publish('b',pg_temp.standup_rows('2091-01-01',7),'{"2091-01-01":1}','Correct source transcription');
SELECT pg_temp.standup_assert((SELECT v.header_json=o.header AND v.metrics_json=o.metrics FROM public.exec_standup_snapshot_versions v
 CROSS JOIN original_standup o WHERE v.organization_id=(SELECT org FROM standup_fixture)), 'Full original header and metrics preserved unchanged');
SELECT pg_temp.standup_assert((SELECT published_version=2 FROM public.exec_standup_snapshots WHERE organization_id=(SELECT org FROM standup_fixture)), 'Correction increments version once');
SELECT pg_temp.standup_assert((SELECT count(*) FILTER(WHERE deleted_at IS NULL)=1 AND count(*) FILTER(WHERE deleted_at IS NOT NULL)=1
 FROM public.exec_standup_snapshot_metrics WHERE organization_id=(SELECT org FROM standup_fixture)), 'Replaced metrics soft deleted');
SELECT pg_temp.standup_assert((SELECT freshness_at IS NULL AND value_numeric=7 FROM public.exec_standup_snapshot_metrics
 WHERE organization_id=(SELECT org FROM standup_fixture) AND deleted_at IS NULL), 'Source freshness remains unknown');
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('c',pg_temp.standup_rows('2090-12-01')||pg_temp.standup_rows('2091-01-01'),'{"2090-12-01":0,"2091-01-01":1}','Stale correction')$q$,'40001','Stale multiweek file rejects atomically');
SELECT pg_temp.standup_assert((SELECT count(*)=1 FROM public.exec_standup_snapshots WHERE organization_id=(SELECT org FROM standup_fixture)), 'Stale later week rolls back earlier new week');
RESET ROLE;
-- Even privileged table writes cannot rewrite immutable history (not merely an ACL check).
SELECT pg_temp.standup_reject($q$UPDATE public.exec_standup_snapshot_versions SET header_json='{}' WHERE organization_id=(SELECT org FROM standup_fixture)$q$,'55000','Archive update rejected for owner');
SELECT pg_temp.standup_reject($q$DELETE FROM public.exec_standup_import_receipts WHERE organization_id=(SELECT org FROM standup_fixture)$q$,'55000','Receipt delete rejected for owner');
SELECT pg_temp.standup_reject($q$TRUNCATE public.exec_standup_snapshot_versions$q$,'55000','Archive truncate rejected');
-- A normal external edit invalidates an already prepared preview.
UPDATE public.exec_standup_snapshot_metrics SET value_numeric=8 WHERE organization_id=(SELECT org FROM standup_fixture) AND deleted_at IS NULL;
SELECT pg_temp.standup_assert((SELECT published_version=3 FROM public.exec_standup_snapshots WHERE organization_id=(SELECT org FROM standup_fixture)), 'Direct metric edit invalidates preview version');
SET LOCAL ROLE service_role;
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('c',NULL,'{"2091-01-01":2}','Correction')$q$,'40001','Preview predating direct edit rejects');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('c')$q$,'42501','Authenticated caller cannot publish');
SELECT pg_temp.standup_reject($q$INSERT INTO public.exec_standup_snapshot_versions(organization_id,snapshot_id,published_version,header_json,metrics_json,correction_reason,replacement_file_sha256) SELECT org,gen_random_uuid(),9,'{}','[]','forged','x' FROM standup_fixture$q$,'42501','Authenticated caller cannot forge history');
SELECT pg_temp.standup_assert((SELECT count(*)=0 FROM public.exec_standup_snapshot_versions), 'Unauthenticated actor context cannot read history');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('c')$q$,'42501','Anonymous caller cannot publish');
RESET ROLE;
-- A registry change after review cannot silently alter semantics or denominator.
UPDATE public.exec_standup_metric_definitions SET label='Changed after preview' WHERE organization_id=(SELECT org FROM standup_fixture);
SET LOCAL ROLE service_role;
SELECT pg_temp.standup_reject($q$SELECT pg_temp.standup_publish('c',NULL,'{"2091-01-01":3}','Correction')$q$,'40001','Changed registry invalidates reviewed context');
SELECT pg_temp.standup_assert((pg_temp.standup_publish('a')->>'duplicate')::boolean,'Original retry remains idempotent after registry changes');
RESET ROLE;
-- Real current-actor claims exercise organization and portfolio scope, including audit JSON.
CREATE TEMP TABLE standup_actors AS
 SELECT gen_random_uuid() id,gen_random_uuid() session_id,org organization_id,'owner'::public.app_role role FROM standup_fixture
 UNION ALL SELECT gen_random_uuid(),gen_random_uuid(),org,'facility_admin'::public.app_role FROM standup_fixture
 UNION ALL SELECT gen_random_uuid(),gen_random_uuid(),other_org,'owner'::public.app_role FROM standup_fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT id,id||'@standup.invalid','{}','{}' FROM standup_actors;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
 SELECT id,organization_id,id||'@standup.invalid','Standup fixture actor',role,true FROM standup_actors;
INSERT INTO auth.sessions(id,user_id) SELECT session_id,id FROM standup_actors;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT a.id,f.facility,f.org FROM standup_actors a CROSS JOIN standup_fixture f WHERE a.role='facility_admin';
CREATE TEMP TABLE standup_claims AS SELECT a.organization_id,a.role,jsonb_build_object('sub',a.id,'session_id',a.session_id,
 'role','authenticated','auth_claim_version',p.auth_claim_version) claims FROM standup_actors a JOIN public.user_profiles p ON p.id=a.id;
GRANT SELECT ON standup_claims TO authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
SELECT set_config('request.jwt.claims',(SELECT claims::text FROM standup_claims WHERE organization_id=(SELECT org FROM standup_fixture) AND role='owner'),true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.standup_assert((SELECT count(*)=1 FROM public.exec_standup_snapshot_versions), 'Current organization owner reads original version');
SELECT pg_temp.standup_assert((SELECT count(*)=2 FROM public.exec_standup_import_receipts), 'Current organization owner reads receipts');
RESET ROLE;
SELECT set_config('request.jwt.claims',(SELECT claims::text FROM standup_claims WHERE role='facility_admin'),true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.standup_assert((SELECT count(*)=0 FROM public.exec_standup_snapshot_versions), 'Facility admin cannot read portfolio archive');
SELECT pg_temp.standup_assert((SELECT count(*)=0 FROM public.exec_standup_import_receipts), 'Facility admin cannot read portfolio receipts');
SELECT pg_temp.standup_assert((SELECT count(*)=0 FROM public.audit_log WHERE table_name IN ('exec_standup_snapshot_versions','exec_standup_import_receipts','exec_standup_import_jobs')
 AND organization_id=(SELECT org FROM standup_fixture)), 'Facility admin cannot read portfolio JSON through audit');
RESET ROLE;
SELECT set_config('request.jwt.claims',(SELECT claims::text FROM standup_claims WHERE organization_id=(SELECT other_org FROM standup_fixture)),true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.standup_assert((SELECT count(*)=0 FROM public.exec_standup_snapshot_versions), 'Other organization owner cannot read archive');
SELECT pg_temp.standup_assert((SELECT count(*)=0 FROM public.exec_standup_import_receipts), 'Other organization owner cannot read receipts');
RESET ROLE;
SELECT pg_temp.standup_assert(NOT has_function_privilege('authenticated','public.haven_publish_standup_import(uuid,text,text,jsonb,jsonb,text,text,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.haven_publish_standup_import(uuid,text,text,jsonb,jsonb,text,text,jsonb)','EXECUTE'), 'RPC grant posture service only');
SELECT pg_temp.standup_assert((SELECT count(*)=2 FROM public.exec_standup_import_jobs WHERE organization_id=(SELECT org FROM standup_fixture)), 'Only successful unique files create jobs');
-- Metric insertion cannot bypass preview versioning through a hidden parent UPDATE.
GRANT INSERT ON public.exec_standup_snapshot_metrics TO authenticated;
GRANT SELECT, UPDATE ON public.exec_standup_snapshots TO authenticated;
SELECT set_config('request.jwt.claims',(SELECT claims::text FROM standup_claims WHERE role='facility_admin'),true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.standup_reject($q$INSERT INTO public.exec_standup_snapshot_metrics(snapshot_id,organization_id,facility_id,section_key,metric_key,metric_label)
 SELECT s.id,f.org,f.facility,'census','attempted_bypass','Attempt' FROM standup_fixture f JOIN public.exec_standup_snapshots s ON s.organization_id=f.org WHERE s.week_of='2091-01-01'$q$,'42501','Facility admin cannot insert into published snapshot without invalidating preview');
RESET ROLE;
INSERT INTO public.exec_standup_snapshots(organization_id,week_of,created_by) SELECT organization_id,'2092-01-01',id FROM standup_actors WHERE role='facility_admin';
SET LOCAL ROLE authenticated;
INSERT INTO public.exec_standup_snapshot_metrics(snapshot_id,organization_id,facility_id,section_key,metric_key,metric_label)
 SELECT s.id,f.org,f.facility,'census','draft_entry','Draft' FROM standup_fixture f JOIN public.exec_standup_snapshots s ON s.organization_id=f.org WHERE s.week_of='2092-01-01';
SELECT pg_temp.standup_assert((SELECT published_version=2 FROM public.exec_standup_snapshots WHERE week_of='2092-01-01' AND organization_id=(SELECT org FROM standup_fixture)), 'Facility admin own draft metric insert bumps version');
RESET ROLE;
ROLLBACK;
