-- Native scratch-only probe for migration 338; fixtures and auth adaptation roll back.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE fs_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() session,f.id facility,f.organization_id org,gen_random_uuid() other_facility FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','org_admin'),'{"full_name":"Field state probe"}' FROM fs_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT actor,actor||'@review.invalid','Field state probe','org_admin',org,true FROM fs_fixture ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM fs_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds) SELECT x.other_facility,f.entity_id,x.org,'Field state scope probe','Test','Test','00000',1 FROM fs_fixture x JOIN public.facilities f ON f.id=x.facility;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM fs_fixture;
CREATE FUNCTION pg_temp.fs_actor() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true) FROM fs_fixture f JOIN public.user_profiles p ON p.id=f.actor;
END $$;
SELECT pg_temp.fs_actor();
CREATE TEMP TABLE fs_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON fs_results TO authenticated;
GRANT SELECT ON fs_fixture TO authenticated;
CREATE FUNCTION pg_temp.fs_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;
-- The new helpers are reachable only through the authorized command.
DO $$ BEGIN
 IF has_function_privilege('authenticated','haven.stand_up_field_dispositions(uuid)','EXECUTE')
 OR has_function_privilege('anon','haven.stand_up_field_dispositions(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_revision_history(jsonb)','EXECUTE')
 OR has_function_privilege('service_role','haven.stand_up_revision_history(jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_revision_metadata(uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','haven.stand_up_command(text,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Field state grant boundary failed'; END IF;
END $$;
-- An imported row with a withheld overtime carries the disposition in its provenance.
INSERT INTO fs_results SELECT 'row',jsonb_build_object('facility_id',facility,'week_start','2020-10-05','expected_version',0,
 'values',(SELECT jsonb_object_agg(k,CASE WHEN k='overtime_reported' THEN 'null'::jsonb ELSE to_jsonb(3) END) FROM unnest(haven.stand_up_keys()) k),
 'provenance',jsonb_build_object('sheet','October','field_dispositions',jsonb_build_object('overtime_reported','historical_unit_unconfirmed'))) FROM fs_fixture;
SET LOCAL ROLE authenticated;
INSERT INTO fs_results SELECT 'batch',public.stand_up_command('stage_import',jsonb_build_object('request_id',gen_random_uuid(),'reason','Held import fixture','provenance','{"file_id":"fixture"}'::jsonb,'rows',jsonb_build_array(value))) FROM fs_results WHERE name='row';
INSERT INTO fs_results SELECT 'imported',public.stand_up_command('commit_import',value) FROM fs_results WHERE name='batch';
INSERT INTO fs_results VALUES('workspace_held',public.stand_up_command('workspace','{}'));
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM jsonb_array_elements((SELECT value->'reports' FROM fs_results WHERE name='workspace_held')) WHERE value->>'week_start'='2020-10-05';
 IF r IS NULL OR r->>'entry_origin'<>'imported' OR r->'field_dispositions'->>'overtime_reported'<>'historical_unit_unconfirmed'
  OR (SELECT count(*) FROM jsonb_object_keys(r->'field_dispositions'))<>1 OR r->'values'->'overtime_reported'<>'null'::jsonb
 THEN RAISE EXCEPTION 'Held import disposition not exposed from stored provenance: %',r; END IF;
 -- Metrics that carry a value never report a disposition even if the source named one.
 IF r->'field_dispositions' ? 'current_total_census' THEN RAISE EXCEPTION 'Disposition leaked onto a provided metric'; END IF;
END $$;
-- Reversing the import restores the pre-import figures and ends the hold; the raw import stays in its own revision.
INSERT INTO fs_results SELECT 'reversed',public.stand_up_command('reverse_import',value||'{"reason":"Probe reversal"}') FROM fs_results WHERE name='batch';
DO $$ DECLARE r jsonb; w jsonb; BEGIN
 SELECT value INTO r FROM fs_results WHERE name='reversed';
 IF jsonb_array_length(r->'restored')<>1 THEN RAISE EXCEPTION 'Reversal did not restore the imported row: %',r; END IF;
 SELECT value INTO w FROM jsonb_array_elements((SELECT value->'reports' FROM (SELECT public.stand_up_command('workspace','{}') value) x)) WHERE value->>'week_start'='2020-10-05';
 IF w->'field_dispositions'<>'{}'::jsonb OR w->'values'->'overtime_reported'<>'null'::jsonb THEN RAISE EXCEPTION 'Reversed import still reported as held: %',w; END IF;
END $$;
-- A fresh import of the same row is held again; an unrelated administrator edit that leaves overtime blank keeps it held.
INSERT INTO fs_results SELECT 'batch2',public.stand_up_command('stage_import',jsonb_build_object('request_id',gen_random_uuid(),'reason','Held import fixture again','provenance','{"file_id":"fixture"}'::jsonb,'rows',jsonb_build_array(value||'{"expected_version":2}'))) FROM fs_results WHERE name='row';
INSERT INTO fs_results SELECT 'imported2',public.stand_up_command('commit_import',value) FROM fs_results WHERE name='batch2';
INSERT INTO fs_results SELECT 'edited',public.stand_up_command('save',jsonb_build_object('facility_id',f.facility,'week_start','2020-10-05','expected_version',3,'request_id',gen_random_uuid(),'status','draft','reason','Probe census correction',
 'values',(SELECT value->'values' FROM fs_results WHERE name='row')||'{"current_total_census":4}')) FROM fs_fixture f;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM fs_results WHERE name='edited';
 IF r->>'entry_origin'<>'manual' OR r->'field_dispositions'->>'overtime_reported'<>'historical_unit_unconfirmed' THEN RAISE EXCEPTION 'Held stays held until a value is entered: %',r; END IF;
END $$;
-- Entering hours and minutes clears the disposition; the raw import is untouched in its own revision.
INSERT INTO fs_results SELECT 'entered',public.stand_up_command('save',jsonb_build_object('facility_id',f.facility,'week_start','2020-10-05','expected_version',4,'request_id',gen_random_uuid(),'status','draft','reason','Probe overtime entry',
 'values',(SELECT value->'values' FROM fs_results WHERE name='row')||'{"current_total_census":4,"overtime_reported":3.16}')) FROM fs_fixture f;
DO $$ DECLARE r jsonb; h jsonb; BEGIN
 SELECT value INTO r FROM fs_results WHERE name='entered';
 IF r->'field_dispositions'<>'{}'::jsonb OR r->>'overtime_minutes'<>'196' THEN RAISE EXCEPTION 'Entered value still reported as held: %',r; END IF;
 h:=public.stand_up_command('revisions',jsonb_build_object('facility_id',(SELECT facility FROM fs_fixture),'week_start','2020-10-05'));
 IF jsonb_array_length(h->'revisions')<>5 OR h->'revisions'->0->>'version'<>'1' OR h->'revisions'->0->>'entry_origin'<>'imported'
  OR h->'revisions'->0->'values'->'overtime_reported'<>'null'::jsonb OR h->'revisions'->4->'values'->>'overtime_reported'<>'3.16'
  OR h->'revisions'->3->>'updated_by_name'<>'Field state probe' OR h->'revisions'->4->>'created_at' IS NULL
 THEN RAISE EXCEPTION 'Revision history incomplete: %',h; END IF;
 h:=public.stand_up_command('revisions',jsonb_build_object('facility_id',(SELECT facility FROM fs_fixture),'week_start','2020-10-12'));
 IF jsonb_array_length(h->'revisions')<>0 THEN RAISE EXCEPTION 'Missing report must return an empty revision list'; END IF;
END $$;
RESET ROLE;
-- A facility administrator cannot list revisions for an ALF outside their grants.
UPDATE public.user_profiles SET app_role='facility_admin' WHERE id=(SELECT actor FROM fs_fixture);
SELECT pg_temp.fs_actor();
SET LOCAL ROLE authenticated;
SELECT pg_temp.fs_fail(format('SELECT public.stand_up_command(''revisions'',%L::jsonb)',jsonb_build_object('facility_id',other_facility,'week_start','2020-10-05')),'access denied') FROM fs_fixture;
DO $$ DECLARE h jsonb; BEGIN
 h:=public.stand_up_command('revisions',jsonb_build_object('facility_id',(SELECT facility FROM fs_fixture),'week_start','2020-10-05'));
 IF jsonb_array_length(h->'revisions')<>5 THEN RAISE EXCEPTION 'Granted facility revisions must stay readable'; END IF;
END $$;
RESET ROLE;
-- The service archive carries the disposition for the held revision and nothing personal.
GRANT SELECT ON fs_fixture TO service_role;
GRANT ALL ON fs_results TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO fs_results SELECT 'archive',public.stand_up_export_history(org,'2020-10-05','2020-10-05') FROM fs_fixture;
RESET ROLE;
DO $$ DECLARE x jsonb; r jsonb; BEGIN
 SELECT value INTO x FROM jsonb_array_elements((SELECT value->'snapshots' FROM fs_results WHERE name='archive')) WHERE value->>'kind'='0';
 r:=x->'reports'->0;
 IF r IS NULL OR NOT (r ? 'field_dispositions') OR r->'field_dispositions'<>'{}'::jsonb THEN RAISE EXCEPTION 'Latest archive must carry an empty disposition set once entered: %',r; END IF;
 IF r ? 'updated_by' OR r ? 'updated_by_name' THEN RAISE EXCEPTION 'Personal actor identity leaked to aggregate'; END IF;
 IF haven.stand_up_field_dispositions((SELECT v.id FROM public.stand_up_revisions v JOIN public.stand_up_reports p ON p.id=v.report_id WHERE p.facility_id=(SELECT facility FROM fs_fixture) AND p.week_start='2020-10-05' AND v.version=1))->>'overtime_reported'<>'historical_unit_unconfirmed'
 THEN RAISE EXCEPTION 'Imported revision lost its stored disposition'; END IF;
END $$;
ROLLBACK;
