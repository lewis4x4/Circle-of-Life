-- Native scratch-only probe; fixtures and auth adaptation roll back.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE su_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() session,f.id facility,f.organization_id org,gen_random_uuid() other_facility FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','org_admin'),'{"full_name":"Stand Up probe"}' FROM su_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT actor,actor||'@review.invalid','Stand Up probe','org_admin',org,true FROM su_fixture ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM su_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds) SELECT x.other_facility,f.entity_id,x.org,'Stand Up scope probe','Test','Test','00000',1 FROM su_fixture x JOIN public.facilities f ON f.id=x.facility;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM su_fixture;
CREATE FUNCTION pg_temp.su_actor() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true) FROM su_fixture f JOIN public.user_profiles p ON p.id=f.actor;
END $$;
SELECT pg_temp.su_actor();
CREATE TEMP TABLE su_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON su_results TO authenticated;
GRANT SELECT ON su_fixture TO authenticated;
CREATE FUNCTION pg_temp.su_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;
-- New projections and helper grants do not provide a bypass around the command.
DO $$ BEGIN
 IF has_function_privilege('authenticated','public.stand_up_export_history(uuid,date,date)','EXECUTE')
 OR has_function_privilege('anon','public.stand_up_export_history(uuid,date,date)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_command_v1(text,jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_revision_metadata(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_reverse_import(jsonb)','EXECUTE')
 OR has_table_privilege('authenticated','public.stand_up_reports','UPDATE')
 OR (SELECT prosecdef FROM pg_proc WHERE oid='public.stand_up_command(text,jsonb)'::regprocedure)
 OR (SELECT prosecdef FROM pg_proc WHERE oid='public.stand_up_export_history(uuid,date,date)'::regprocedure)
 THEN RAISE EXCEPTION 'Stand Up experience grant boundary failed'; END IF;
 IF haven.stand_up_overtime_minutes('17.15')<>1035 OR haven.stand_up_overtime_minutes('16.09')<>969
 OR haven.stand_up_overtime_minutes('0')<>0 OR haven.stand_up_overtime_minutes('null') IS NOT NULL
 OR haven.stand_up_overtime_minutes('17.60') IS NOT NULL OR haven.stand_up_overtime_minutes('17.151') IS NOT NULL
 OR haven.stand_up_overtime_minutes('35791394.07')<>2147483647 OR haven.stand_up_overtime_minutes('35791394.08') IS NOT NULL
 THEN RAISE EXCEPTION 'HH.MM projection failed'; END IF;
 IF haven.stand_up_meeting_snapshot_available('2026-09-14','2026-09-14T13:14:59.999999Z')
 OR NOT haven.stand_up_meeting_snapshot_available('2026-09-14','2026-09-14T13:15:00Z')
 OR NOT haven.stand_up_meeting_snapshot_available('2026-09-14','2026-09-14T13:15:00.000001Z')
 OR haven.stand_up_meeting_snapshot_available('2026-09-14','2026-09-13T23:00:00Z')
 OR haven.stand_up_meeting_snapshot_available('2026-11-02','2026-11-02T14:14:59Z')
 OR NOT haven.stand_up_meeting_snapshot_available('2026-11-02','2026-11-02T14:15:00Z')
 THEN RAISE EXCEPTION 'Meeting cutoff before/exact/after boundary failed'; END IF;
END $$;
INSERT INTO su_results SELECT 'payload',jsonb_build_object('facility_id',facility,'week_start','2020-09-14','expected_version',0,'request_id',gen_random_uuid(),'values',(SELECT jsonb_object_agg(k,0) FROM unnest(haven.stand_up_keys()) k)||'{"overtime_reported":17.15}', 'status','ready','reason','Historical fixture') FROM su_fixture;
SET LOCAL ROLE authenticated;
INSERT INTO su_results VALUES('workspace',public.stand_up_command('workspace','{}'));
INSERT INTO su_results SELECT 'ready',public.stand_up_command('save',value) FROM su_results WHERE name='payload';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM su_results WHERE name='ready';
 IF r->>'overtime_minutes'<>'1035' OR r->>'entry_origin'<>'manual' OR r->>'updated_by'<>(SELECT actor::text FROM su_fixture)
 OR r->>'first_submitted_at' IS NULL OR r->>'first_submitted_at' IS DISTINCT FROM r->>'last_submitted_at'
 OR r->>'last_submitted_revision_id' IS DISTINCT FROM r->>'revision_id' THEN RAISE EXCEPTION 'Submission metadata missing'; END IF;
 IF (SELECT public.stand_up_command('save',value) FROM su_results WHERE name='payload') IS DISTINCT FROM r THEN RAISE EXCEPTION 'Idempotent enriched result changed'; END IF;
END $$;
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'values',(value->'values')||'{"overtime_reported":17.60}')),'Overtime requires') FROM su_results WHERE name='payload';
INSERT INTO su_results SELECT 'draft',public.stand_up_command('save',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'status','draft','values',(value->'values')||'{"overtime_reported":0.45}')) FROM su_results WHERE name='payload';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM su_results WHERE name='draft';
 IF r->>'overtime_minutes'<>'45' OR r->>'last_submitted_revision_id' IS DISTINCT FROM (SELECT value->>'revision_id' FROM su_results WHERE name='ready') THEN RAISE EXCEPTION 'Draft lost submission history'; END IF;
 r:=public.stand_up_command('workspace','{}');
 IF r->>'server_now' IS NULL OR r->>'actor_role'<>'org_admin' THEN RAISE EXCEPTION 'Workspace clock/role missing'; END IF;
END $$;
INSERT INTO su_results SELECT 'preview',public.stand_up_command('preview_recovery',jsonb_build_object('baseline_id',value->>'revision_id','facility_id',value->>'facility_id','week_start',value->>'week_start','values',(value->'values')||'{"overtime_reported":1.15}')) FROM su_results WHERE name='draft';
INSERT INTO su_results SELECT 'recovered',public.stand_up_command('commit_recovery',jsonb_build_object('preview_id',value->>'preview_id','request_id',gen_random_uuid(),'resolutions','{}'::jsonb)) FROM su_results WHERE name='preview';
DO $$ BEGIN IF (SELECT value->>'entry_origin' FROM su_results WHERE name='recovered')<>'recovery' THEN RAISE EXCEPTION 'Recovery origin missing'; END IF; END $$;
INSERT INTO su_results SELECT 'batch',public.stand_up_command('stage_import',jsonb_build_object('request_id',gen_random_uuid(),'reason','Import source fixture','provenance','{"file_id":"fixture"}'::jsonb,'rows',jsonb_build_array(value||'{"week_start":"2020-09-21","expected_version":0}'))) FROM su_results WHERE name='payload';
INSERT INTO su_results SELECT 'imported',public.stand_up_command('commit_import',value) FROM su_results WHERE name='batch';
RESET ROLE;
-- Only native fixtures set recorded timestamps; actual backdated imports retain NOW.
DO $$ DECLARE f su_fixture%ROWTYPE; rid uuid; vid uuid; vals jsonb; i integer; BEGIN
 SELECT * INTO f FROM su_fixture;
 SELECT jsonb_object_agg(k,0) INTO vals FROM unnest(haven.stand_up_keys()) k;
 INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status) VALUES(f.org,f.facility,'2020-09-07',vals,'draft') RETURNING id INTO rid;
 FOR i IN 1..5 LOOP
  INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,created_at)
  VALUES(rid,i,vals||jsonb_build_object('current_total_census',i),CASE WHEN i IN(2,5) THEN 'ready' ELSE 'draft' END,f.actor,
   CASE i WHEN 1 THEN '2020-09-07T12:30:00Z'::timestamptz WHEN 2 THEN '2020-09-07T12:40:00Z' WHEN 3 THEN '2020-09-07T13:00:00Z' WHEN 4 THEN '2020-09-07T13:20:00Z' ELSE '2020-09-07T13:25:00Z' END) RETURNING id INTO vid;
 END LOOP;
 UPDATE public.stand_up_reports SET version=5,revision_id=vid,values=vals||'{"current_total_census":5}',status='ready' WHERE id=rid;
 INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status) VALUES(f.org,f.facility,'2020-08-31',vals,'draft') RETURNING id INTO rid;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id) VALUES(rid,1,vals,'draft',f.actor);
 SELECT jsonb_object_agg(k,'null'::jsonb) INTO vals FROM unnest(haven.stand_up_keys()) k;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id) VALUES(rid,2,vals,'draft',f.actor) RETURNING id INTO vid;
 UPDATE public.stand_up_reports SET version=2,revision_id=vid,values=vals WHERE id=rid;
 -- A malformed legacy value is visible as needs review; its raw revision remains intact.
 vals:=vals||'{"overtime_reported":17.75}';
 INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status) VALUES(f.org,f.facility,'2019-09-02',vals,'draft') RETURNING id INTO rid;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id) VALUES(rid,1,vals,'draft',f.actor) RETURNING id INTO vid;
 UPDATE public.stand_up_reports SET version=1,revision_id=vid WHERE id=rid;
 IF NOT EXISTS(SELECT 1 FROM public.stand_up_reports WHERE id=rid AND overtime_minutes IS NULL AND overtime_issue AND values->>'overtime_reported'='17.75') THEN RAISE EXCEPTION 'Legacy issue silently altered'; END IF;
 vals:=vals||'{"overtime_reported":0}';
 INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status) VALUES(f.org,f.facility,haven.stand_up_week()+7,vals,'draft') RETURNING id INTO rid;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id) VALUES(rid,1,vals,'draft',f.actor) RETURNING id INTO vid;
 UPDATE public.stand_up_reports SET version=1,revision_id=vid WHERE id=rid;
END $$;
-- A valid import can replace retained invalid legacy overtime. Reversal holds that
-- row transparently while restoring another safe row instead of aborting the batch.
SET LOCAL ROLE authenticated;
INSERT INTO su_results SELECT 'legacy_batch',public.stand_up_command('stage_import',jsonb_build_object('request_id',gen_random_uuid(),'reason','Replace legacy source fixture','provenance','{"file_id":"legacy-replacement"}'::jsonb,
 'rows',jsonb_build_array(value||'{"week_start":"2019-09-02","expected_version":1}',value||'{"week_start":"2019-09-09","expected_version":0}'))) FROM su_results WHERE name='payload';
INSERT INTO su_results SELECT 'legacy_replacement',public.stand_up_command('commit_import',value) FROM su_results WHERE name='legacy_batch';
INSERT INTO su_results SELECT 'legacy_reversal',public.stand_up_command('reverse_import',value||'{"reason":"Withdraw replacement source"}') FROM su_results WHERE name='legacy_batch';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM su_results WHERE name='legacy_reversal';
 IF jsonb_array_length(r->'restored')<>1 OR jsonb_array_length(r->'conflicts')<>1 OR r->'conflicts'->0->>'code'<>'legacy_overtime_requires_review'
 OR r->'conflicts'->0->>'retained_overtime'<>'17.75' THEN RAISE EXCEPTION 'Invalid legacy reversal did not return an explicit held conflict'; END IF;
 IF r IS DISTINCT FROM (SELECT public.stand_up_command('reverse_import',value||'{"reason":"Withdraw replacement source"}') FROM su_results WHERE name='legacy_batch') THEN RAISE EXCEPTION 'Held reversal replay changed'; END IF;
END $$;
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'week_start','2019-09-02','expected_version',2,'values',(value->'values')||'{"overtime_reported":17.75}')),'Overtime requires') FROM su_results WHERE name='payload';
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.stand_up_reports WHERE facility_id=(SELECT facility FROM su_fixture) AND week_start='2019-09-02' AND version=2 AND values->>'overtime_reported'='17.15') THEN RAISE EXCEPTION 'Held row current revision was overwritten'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id WHERE r.facility_id=(SELECT facility FROM su_fixture) AND r.week_start='2019-09-02' AND v.version=1 AND v.values->>'overtime_reported'='17.75' AND v.overtime_issue) THEN RAISE EXCEPTION 'Retained invalid source revision was altered'; END IF;
END $$;
GRANT SELECT ON su_fixture TO service_role;
GRANT ALL ON su_results TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO su_results SELECT 'archive',public.stand_up_export_history(org,'2020-08-31','2020-09-21') FROM su_fixture;
INSERT INTO su_results SELECT 'future_archive',public.stand_up_export_history(org,((SELECT value->>'current_week' FROM su_results WHERE name='workspace')::date+7),((SELECT value->>'current_week' FROM su_results WHERE name='workspace')::date+7)) FROM su_fixture;
SELECT pg_temp.su_fail(format('SELECT public.stand_up_export_history(%L::uuid,''2020-08-31'',''2022-09-05'')',org),'at most 104') FROM su_fixture;
SELECT pg_temp.su_fail(format('SELECT public.stand_up_export_history(%L::uuid,''2020-09-01'',''2020-09-21'')',org),'Monday') FROM su_fixture;
RESET ROLE;
DO $$ DECLARE a jsonb; x jsonb; r jsonb; BEGIN
 SELECT value INTO a FROM su_results WHERE name='future_archive';
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(a->'snapshots') WHERE value->>'kind'='2') THEN RAISE EXCEPTION 'Future meeting snapshot published before cutoff'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'snapshots') WHERE value->>'kind'='0') THEN RAISE EXCEPTION 'Future draft fixture missing'; END IF;
 SELECT value INTO a FROM su_results WHERE name='archive';
 IF a->>'archive_as_of' IS NULL OR (a->>'archive_as_of')::timestamptz<transaction_timestamp() THEN RAISE EXCEPTION 'Archive generation time missing'; END IF;
 SELECT value INTO x FROM jsonb_array_elements(a->'snapshots') WHERE value->>'week_start'='2020-09-07' AND value->>'kind'='0';
 IF x->'reports'->0->>'version'<>'5' THEN RAISE EXCEPTION 'Latest snapshot wrong'; END IF;
 SELECT value INTO x FROM jsonb_array_elements(a->'snapshots') WHERE value->>'week_start'='2020-09-07' AND value->>'kind'='1';
 IF x->'reports'->0->>'version'<>'5' THEN RAISE EXCEPTION 'Submitted snapshot wrong'; END IF;
 SELECT value INTO x FROM jsonb_array_elements(a->'snapshots') WHERE value->>'week_start'='2020-09-07' AND value->>'kind'='2';
 IF x->'reports'->0->>'version'<>'3' THEN RAISE EXCEPTION 'Meeting snapshot must use last recorded revision by 09:15 Eastern'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(a->'snapshots') WHERE value->>'week_start'='2020-09-21' AND value->>'kind'='2') THEN RAISE EXCEPTION 'Later import manufactured historical meeting snapshot'; END IF;
 SELECT value INTO x FROM jsonb_array_elements(a->'snapshots') WHERE value->>'week_start'='2020-09-21' AND value->>'kind'='0';
 IF x->'reports'->0->>'entry_origin'<>'imported' THEN RAISE EXCEPTION 'Import origin missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'snapshots') WHERE value->>'week_start'='2020-08-31' AND value->>'kind'='0') THEN RAISE EXCEPTION 'Cleared existing week must supersede previously published figures'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(a->'snapshots') LOOP
  FOR r IN SELECT value FROM jsonb_array_elements(x->'reports') LOOP
   IF r ? 'updated_by' OR r ? 'updated_by_name' THEN RAISE EXCEPTION 'Personal actor identity leaked to aggregate'; END IF;
  END LOOP;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.stand_up_export_audit WHERE organization_id=(SELECT org FROM su_fixture) AND source_identity='stand_up_history_service') THEN RAISE EXCEPTION 'History export unaudited'; END IF;
END $$;
UPDATE public.user_profiles SET app_role='facility_admin' WHERE id=(SELECT actor FROM su_fixture);
SELECT pg_temp.su_actor();
SET LOCAL ROLE authenticated;
DO $$ DECLARE w jsonb; BEGIN
 w:=public.stand_up_command('workspace','{}');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(w->'reports') WHERE value->>'facility_id'<>(SELECT facility::text FROM su_fixture)) THEN RAISE EXCEPTION 'Cross facility report leak'; END IF;
END $$;
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('facility_id',(SELECT other_facility FROM su_fixture),'request_id',gen_random_uuid())),'access denied') FROM su_results WHERE name='payload';
RESET ROLE;
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT actor FROM su_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.su_fail('SELECT public.stand_up_command(''workspace'',''{}'')','denied');
RESET ROLE;
ROLLBACK;
