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
-- Grant posture must be tested before replay default privilege adaptations.
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.stand_up_reports','UPDATE') OR has_table_privilege('service_role','public.stand_up_reports','INSERT') OR has_function_privilege('authenticated','haven.stand_up_save(jsonb,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.stand_up_export_aggregate(uuid,date)','EXECUTE') OR has_function_privilege('anon','public.stand_up_command(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Stand Up grant boundary failed'; END IF;
END $$;
SET LOCAL ROLE authenticated;
INSERT INTO su_results VALUES('workspace',public.stand_up_command('workspace','{}'));
-- Historical date guarantees staffing interval closed regardless when test runs.
INSERT INTO su_results SELECT 'payload',jsonb_build_object('facility_id',facility,'week_start','2020-09-07','expected_version',0,'request_id',gen_random_uuid(),'values',jsonb_build_object('monthly_rent_roll_cents',null,'current_total_census',null,'sp_female_beds_open',null,'sp_male_beds_open',null,'sp_flexible_beds_open',null,'private_beds_open',null,'admissions_expected',null,'hospital_and_rehab_total',null,'expected_discharges',null,'callouts_last_week',null,'terminations_last_week',null,'current_open_positions',null,'overtime_reported',null,'tours_expected',null,'provider_activities_expected',null,'outreach_engagements',null),'status','draft','reason','Fixture historical import') FROM su_fixture;
INSERT INTO su_results SELECT 'r1',public.stand_up_command('save',value) FROM su_results WHERE name='payload';
DO $$ DECLARE r jsonb; BEGIN
 SELECT public.stand_up_command('save',value) INTO r FROM su_results WHERE name='payload';
 IF r IS DISTINCT FROM (SELECT value FROM su_results WHERE name='r1') THEN RAISE EXCEPTION 'Receipt replay changed result'; END IF;
 IF r->'values'->'current_total_census'<>'null'::jsonb OR r->'source_as_of'<>'null'::jsonb THEN RAISE EXCEPTION 'Historical unknowns fabricated'; END IF;
END $$;
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||'{"status":"ready"}'),'Idempotency key payload differs') FROM su_results WHERE name='payload';
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid())),'Stale report version') FROM su_results WHERE name='payload';
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'status','ready')),'Ready requires complete') FROM su_results WHERE name='payload';
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'values',(value->'values')||'{"current_total_census":0.5}')),'Invalid numeric metric') FROM su_results WHERE name='payload';
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'values',(value->'values')||'{"invented":1}')),'Exactly sixteen') FROM su_results WHERE name='payload';
INSERT INTO su_results SELECT 'export',public.stand_up_command('export',value) FROM su_results WHERE name='payload';
-- A valid baseline must not redirect an upload to a different selected scope.
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''preview_recovery'',%L::jsonb)',value||jsonb_build_object('facility_id',(SELECT other_facility FROM su_fixture))),'Baseline does not match uploaded facility/week') FROM su_results WHERE name='export';
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''preview_recovery'',%L::jsonb)',value||'{"week_start":"2020-09-14"}'),'Baseline does not match uploaded facility/week') FROM su_results WHERE name='export';
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''preview_recovery'',%L::jsonb)',value-'facility_id'),'Baseline does not match uploaded facility/week') FROM su_results WHERE name='export';
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''preview_recovery'',%L::jsonb)',value-'week_start'),'Baseline does not match uploaded facility/week') FROM su_results WHERE name='export';
INSERT INTO su_results SELECT 'r2',public.stand_up_command('save',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'values',(value->'values')||'{"current_total_census":10}')) FROM su_results WHERE name='payload';
INSERT INTO su_results SELECT 'preview',public.stand_up_command('preview_recovery',jsonb_build_object('baseline_id',e.value->>'baseline_id','facility_id',e.value->>'facility_id','week_start',e.value->>'week_start','values',(e.value->'values')||'{"current_total_census":11,"callouts_last_week":2}')) FROM su_results e WHERE name='export';
DO $$ BEGIN IF (SELECT value->'conflicts' FROM su_results WHERE name='preview')<>'["current_total_census"]'::jsonb THEN RAISE EXCEPTION 'Missing three-way conflict'; END IF; END $$;
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''commit_recovery'',%L::jsonb)',jsonb_build_object('preview_id',value->>'preview_id','request_id',gen_random_uuid())),'Resolve all previewed conflicts') FROM su_results WHERE name='preview';
INSERT INTO su_results SELECT 'r3',public.stand_up_command('commit_recovery',jsonb_build_object('preview_id',value->>'preview_id','request_id',gen_random_uuid(),'resolutions','{"current_total_census":11}'::jsonb)) FROM su_results WHERE name='preview';
-- Reusing a preview with a new request must reject the advanced report version.
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''commit_recovery'',%L::jsonb)',jsonb_build_object('preview_id',value->>'preview_id','request_id',gen_random_uuid(),'resolutions','{"current_total_census":12}'::jsonb)),'Recovery decision already committed with different values') FROM su_results WHERE name='preview';
INSERT INTO su_results SELECT 'clear_preview',public.stand_up_command('preview_recovery',jsonb_build_object('baseline_id',value->>'revision_id','facility_id',value->>'facility_id','week_start',value->>'week_start','values',(value->'values')||'{"current_total_census":null}')) FROM su_results WHERE name='r3';
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''commit_recovery'',%L::jsonb)',jsonb_build_object('preview_id',value->>'preview_id','request_id',gen_random_uuid())),'Explicit clear confirmation required') FROM su_results WHERE name='clear_preview';
-- Reviewed rejection of a clear remains discoverable to the file worker.
INSERT INTO su_results SELECT 'clear_rejected',public.stand_up_command('commit_recovery',jsonb_build_object('preview_id',value->>'preview_id','request_id',gen_random_uuid(),'resolutions','{"current_total_census":11}'::jsonb,'confirm_clears',false)) FROM su_results WHERE name='clear_preview';
DO $$ DECLARE decision jsonb; BEGIN
 SELECT public.stand_up_command('find_recovery',jsonb_build_object('baseline_id',value->>'revision_id','facility_id',value->>'facility_id','week_start',value->>'week_start','values',(value->'values')||'{"current_total_census":null}')) INTO decision FROM su_results WHERE name='r3';
 IF decision->'resolved_result'->'values'->'current_total_census'<>'11'::jsonb THEN RAISE EXCEPTION 'Rejected clear not discoverable'; END IF;
 SELECT public.stand_up_command('find_recovery',jsonb_build_object('baseline_id',value->>'revision_id','facility_id',value->>'facility_id','week_start',value->>'week_start','values',(value->'values')||'{"current_total_census":12}')) INTO decision FROM su_results WHERE name='r3';
 IF decision->'resolved_result'<>'null'::jsonb THEN RAISE EXCEPTION 'Altered incoming matched a decision'; END IF;
 IF jsonb_array_length(public.stand_up_command('workspace','{}')->'pending_recoveries')<>0 THEN RAISE EXCEPTION 'Committed preview still pending'; END IF;
END $$;
-- Choosing Haven on a true conflict is recorded separately from incoming values.
INSERT INTO su_results SELECT 'keep_haven_preview',public.stand_up_command('preview_recovery',jsonb_build_object('baseline_id',e.value->>'baseline_id','facility_id',e.value->>'facility_id','week_start',e.value->>'week_start','values',(e.value->'values')||'{"current_total_census":44}')) FROM su_results e WHERE name='export';
INSERT INTO su_results SELECT 'keep_haven',public.stand_up_command('commit_recovery',jsonb_build_object('preview_id',value->>'preview_id','request_id',gen_random_uuid(),'resolutions','{"current_total_census":11}'::jsonb)) FROM su_results WHERE name='keep_haven_preview';
DO $$ DECLARE decision jsonb; BEGIN
 SELECT public.stand_up_command('find_recovery',jsonb_build_object('baseline_id',value->>'baseline_id','facility_id',value->>'facility_id','week_start',value->>'week_start','values',(value->'values')||'{"current_total_census":44}')) INTO decision FROM su_results WHERE name='export';
 IF decision->'resolved_result'->'values'->'current_total_census'<>'11'::jsonb THEN RAISE EXCEPTION 'Haven conflict decision not discoverable'; END IF;
END $$;
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''find_recovery'',%L::jsonb)',value||jsonb_build_object('facility_id',(SELECT other_facility FROM su_fixture))),'Baseline does not match uploaded facility/week') FROM su_results WHERE name='export';
-- Import staging is non-publishing and commit is CAS atomic across all rows.
INSERT INTO su_results SELECT 'batch_payload',jsonb_build_object('request_id',gen_random_uuid(),'reason','Historical source probe','provenance','{"file_id":"fixture"}'::jsonb,'rows',jsonb_build_array(value||'{"week_start":"2020-08-03","expected_version":0}',value||'{"week_start":"2020-08-10","expected_version":0}')) FROM su_results WHERE name='payload';
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''stage_import'',%L::jsonb)',value||'{"issues":[{"code":"overlap"}]}'),'Resolve all source issues') FROM su_results WHERE name='batch_payload';
INSERT INTO su_results SELECT 'batch',public.stand_up_command('stage_import',value) FROM su_results WHERE name='batch_payload';
INSERT INTO su_results SELECT 'committed',public.stand_up_command('commit_import',value) FROM su_results WHERE name='batch';
INSERT INTO su_results SELECT 'independent',public.stand_up_command('save',(value->'reports'->0)||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'reason','Later independent correction')) FROM su_results WHERE name='committed';
INSERT INTO su_results SELECT 'reversed',public.stand_up_command('reverse_import',value||'{"reason":"Source withdrawn"}') FROM su_results WHERE name='batch';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM su_results WHERE name='reversed'; IF jsonb_array_length(r->'restored')<>1 OR jsonb_array_length(r->'conflicts')<>1 THEN RAISE EXCEPTION 'Reversal failed to preserve independent edit'; END IF;
 IF r IS DISTINCT FROM (SELECT public.stand_up_command('reverse_import',value||'{"reason":"Source withdrawn"}') FROM su_results WHERE name='batch') THEN RAISE EXCEPTION 'Reversal not idempotent'; END IF;
END $$;
RESET ROLE;
-- Failed second row rolls back first row publication in the same batch command.
SET LOCAL ROLE authenticated;
INSERT INTO su_results SELECT 'atomic_batch',public.stand_up_command('stage_import',value||jsonb_build_object('request_id',gen_random_uuid(),'rows',jsonb_build_array((value->'rows'->0)||'{"week_start":"2020-07-06","expected_version":0}',(value->'rows'->0)||'{"week_start":"2020-09-07","expected_version":0}'))) FROM su_results WHERE name='batch_payload';
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''commit_import'',%L::jsonb)',value),'Stale report version') FROM su_results WHERE name='atomic_batch';
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.stand_up_reports WHERE facility_id=(SELECT facility FROM su_fixture) AND week_start='2020-07-06') THEN RAISE EXCEPTION 'Partial batch publication'; END IF; END $$;
-- Service export is aggregate-only and records source identity audit.
GRANT SELECT ON su_fixture TO service_role;
SET LOCAL ROLE service_role;
SELECT public.stand_up_export_aggregate((SELECT org FROM su_fixture),'2020-09-07');
RESET ROLE;
-- Scoped facility administrator is denied other facilities and historical edits.
UPDATE public.user_profiles SET app_role='facility_admin' WHERE id=(SELECT actor FROM su_fixture);
SELECT pg_temp.su_actor();
SET LOCAL ROLE authenticated;
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''export'',%L::jsonb)',jsonb_build_object('facility_id',other_facility,'week_start','2020-09-07')),'access denied') FROM su_fixture;
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',3)),'access denied') FROM su_results WHERE name='payload';
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=(SELECT actor FROM su_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.su_fail(format('SELECT public.stand_up_command(''find_recovery'',%L::jsonb)',value),'access denied') FROM su_results WHERE name='export';
RESET ROLE;
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT actor FROM su_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.su_fail('SELECT public.stand_up_command(''workspace'',''{}'')','access denied');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.stand_up_revisions WHERE report_id=(SELECT (value->>'id')::uuid FROM su_results WHERE name='r1'))<>5 THEN RAISE EXCEPTION 'Unexpected revisions after rejected writes'; END IF;
END $$;
ROLLBACK;
