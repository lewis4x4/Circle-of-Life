-- COL-351: Stand Up census and hospital from the resident roster.
-- Native scratch-only probe; every fixture and auth adaptation rolls back.
-- Synthetic residents only ("Test Resident"); no real data.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
-- Replay adaptation: the hosted project grants authenticated the resident tables by default; the scratch cluster does not.
GRANT SELECT ON public.residents,public.resident_status_history,public.family_resident_links TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE rc_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() session,gen_random_uuid() org,gen_random_uuid() ent,
 gen_random_uuid() fac_roster,gen_random_uuid() fac_empty,gen_random_uuid() fac_other,gen_random_uuid() returned,haven.stand_up_open_week(NULL) week;
INSERT INTO public.organizations(id,name) SELECT org,'Roster census probe' FROM rc_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT ent,org,'Roster census entity' FROM rc_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT fac_roster,ent,org,'Roster census facility','1 Way','Town','00000',12 FROM rc_fixture
 UNION ALL SELECT fac_empty,ent,org,'Roster empty facility','2 Way','Town','00000',12 FROM rc_fixture
 UNION ALL SELECT fac_other,ent,org,'Roster other facility','3 Way','Town','00000',12 FROM rc_fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','org_admin'),'{"full_name":"Roster probe"}' FROM rc_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT actor,actor||'@review.invalid','Roster probe','org_admin',org,true FROM rc_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM rc_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,fac_roster,org FROM rc_fixture UNION ALL SELECT actor,fac_empty,org FROM rc_fixture;
-- Every lifecycle status once, plus a resident who went to hospital and came back.
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,gender,status)
 SELECT gen_random_uuid(),fac_roster,org,'Test Resident','A','prefer_not_to_say'::gender,'active'::resident_status FROM rc_fixture
 UNION ALL SELECT gen_random_uuid(),fac_roster,org,'Test Resident','B','prefer_not_to_say'::gender,'active'::resident_status FROM rc_fixture
 UNION ALL SELECT gen_random_uuid(),fac_roster,org,'Test Resident','C','prefer_not_to_say'::gender,'hospital_hold'::resident_status FROM rc_fixture
 UNION ALL SELECT gen_random_uuid(),fac_roster,org,'Test Resident','D','prefer_not_to_say'::gender,'loa'::resident_status FROM rc_fixture
 UNION ALL SELECT gen_random_uuid(),fac_roster,org,'Test Resident','E','prefer_not_to_say'::gender,'discharged'::resident_status FROM rc_fixture
 UNION ALL SELECT gen_random_uuid(),fac_roster,org,'Test Resident','F','prefer_not_to_say'::gender,'deceased'::resident_status FROM rc_fixture
 UNION ALL SELECT gen_random_uuid(),fac_roster,org,'Test Resident','G','prefer_not_to_say'::gender,'inquiry'::resident_status FROM rc_fixture
 UNION ALL SELECT gen_random_uuid(),fac_roster,org,'Test Resident','H','prefer_not_to_say'::gender,'pending_admission'::resident_status FROM rc_fixture
 UNION ALL SELECT returned,fac_roster,org,'Test Resident','I','prefer_not_to_say'::gender,'active'::resident_status FROM rc_fixture
 UNION ALL SELECT gen_random_uuid(),fac_other,org,'Test Resident','J','prefer_not_to_say'::gender,'active'::resident_status FROM rc_fixture;
UPDATE public.residents SET status='hospital_hold' WHERE id=(SELECT returned FROM rc_fixture);
UPDATE public.residents SET status='active' WHERE id=(SELECT returned FROM rc_fixture);
CREATE FUNCTION pg_temp.rc_actor() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true) FROM rc_fixture f JOIN public.user_profiles p ON p.id=f.actor;
END $$;
SELECT pg_temp.rc_actor();
CREATE TEMP TABLE rc_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON rc_results TO authenticated;
GRANT SELECT ON rc_fixture TO authenticated;
CREATE FUNCTION pg_temp.rc_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;
CREATE FUNCTION pg_temp.rc_values(census integer,hospital integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(census) WHEN k='hospital_and_rehab_total' THEN to_jsonb(hospital) ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k
$$;
-- Grant posture: helpers reachable only through the command; the table has no direct access.
DO $$ BEGIN
 IF has_function_privilege('authenticated','haven.stand_up_roster_confirm(jsonb,uuid,uuid,uuid,uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_roster_suggestion(jsonb)','EXECUTE')
 OR has_function_privilege('service_role','haven.stand_up_roster_confirmations(uuid)','EXECUTE')
 OR has_function_privilege('anon','public.stand_up_roster_census(uuid,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.stand_up_roster_census(uuid,uuid)','EXECUTE')
 OR has_table_privilege('authenticated','public.stand_up_roster_confirmations','SELECT')
 OR has_table_privilege('service_role','public.stand_up_roster_confirmations','INSERT')
 THEN RAISE EXCEPTION 'Roster census grant boundary failed'; END IF;
END $$;
-- Counts from every status: in house 3 (A, B and the returned I), hospital 1, leave 1, census 5, nine residents in Haven.
DO $$ DECLARE c record; h timestamptz; BEGIN
 SELECT * INTO c FROM public.stand_up_roster_census((SELECT org FROM rc_fixture),(SELECT fac_roster FROM rc_fixture));
 IF c.in_house_count<>3 OR c.hospital_hold_count<>1 OR c.loa_count<>1 OR c.roster_census_count<>5 OR c.resident_count_in_haven<>9 THEN RAISE EXCEPTION 'Roster counts wrong: %',to_jsonb(c); END IF;
 SELECT max(effective_from) INTO h FROM public.resident_status_history WHERE facility_id=(SELECT fac_roster FROM rc_fixture) AND deleted_at IS NULL;
 IF c.roster_as_of IS DISTINCT FROM h THEN RAISE EXCEPTION 'Roster as-of is not the latest status change'; END IF;
 IF (SELECT count(*) FROM public.resident_status_history WHERE resident_id=(SELECT returned FROM rc_fixture) AND status='hospital_hold')<>1 THEN RAISE EXCEPTION 'Hospital visit not in history'; END IF;
 SELECT * INTO c FROM public.stand_up_roster_census((SELECT org FROM rc_fixture),(SELECT fac_empty FROM rc_fixture));
 IF c.resident_count_in_haven<>0 OR c.roster_census_count<>0 OR c.roster_as_of IS NOT NULL THEN RAISE EXCEPTION 'Empty facility must report no roster: %',to_jsonb(c); END IF;
END $$;
SET LOCAL ROLE authenticated;
-- The suggestion through the command, and the same counts through resident RLS.
INSERT INTO rc_results SELECT 'roster',public.stand_up_command('roster',jsonb_build_object('facility_id',fac_roster)) FROM rc_fixture;
INSERT INTO rc_results SELECT 'roster_empty',public.stand_up_command('roster',jsonb_build_object('facility_id',fac_empty)) FROM rc_fixture;
DO $$ DECLARE r jsonb; c record; BEGIN
 SELECT value INTO r FROM rc_results WHERE name='roster';
 IF r->>'roster_census_count'<>'5' OR r->>'in_house_count'<>'3' OR r->>'hospital_hold_count'<>'1' OR r->>'loa_count'<>'1' OR r->>'resident_count_in_haven'<>'9' OR r->>'roster_as_of' IS NULL OR r->>'server_now' IS NULL THEN RAISE EXCEPTION 'Roster suggestion wrong: %',r; END IF;
 IF r::text ~* 'first_name|last_name|resident_id|Test Resident' THEN RAISE EXCEPTION 'Roster suggestion carries identifiers'; END IF;
 SELECT value INTO r FROM rc_results WHERE name='roster_empty';
 IF r->>'resident_count_in_haven'<>'0' OR r->'roster_as_of'<>'null'::jsonb THEN RAISE EXCEPTION 'Empty roster suggestion wrong: %',r; END IF;
 SELECT * INTO c FROM public.stand_up_roster_census((SELECT org FROM rc_fixture),(SELECT fac_roster FROM rc_fixture));
 IF c.roster_census_count<>5 THEN RAISE EXCEPTION 'Granted caller must see the roster counts through RLS'; END IF;
END $$;
-- Use roster: the saved figure equals the suggestion, so the server records roster_confirmed.
INSERT INTO rc_results SELECT 'confirm_payload',jsonb_build_object('facility_id',fac_roster,'week_start',week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft',
 'values',pg_temp.rc_values(5,1),'roster',jsonb_build_object('current_total_census','{}'::jsonb,'hospital_and_rehab_total','{}'::jsonb)) FROM rc_fixture;
INSERT INTO rc_results SELECT 'confirmed',public.stand_up_command('save',value) FROM rc_results WHERE name='confirm_payload';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM rc_results WHERE name='confirmed';
 IF r->'roster_confirmations'->'current_total_census'->>'source'<>'roster_confirmed' OR r->'roster_confirmations'->'current_total_census'->>'suggested'<>'5' OR r->'roster_confirmations'->'current_total_census'->>'confirmed'<>'5'
  OR r->'roster_confirmations'->'current_total_census'->'override_reason'<>'null'::jsonb OR r->'roster_confirmations'->'current_total_census'->>'roster_as_of' IS NULL
  OR r->'roster_confirmations'->'hospital_and_rehab_total'->>'source'<>'roster_confirmed' OR r->'roster_confirmations'->'hospital_and_rehab_total'->>'suggested'<>'1'
 THEN RAISE EXCEPTION 'Use roster did not record roster_confirmed: %',r; END IF;
END $$;
-- A retried request returns its receipt and writes no second confirmation.
DO $$ DECLARE r jsonb; n integer; BEGIN
 SELECT public.stand_up_command('save',value) INTO r FROM rc_results WHERE name='confirm_payload';
 IF r IS DISTINCT FROM (SELECT value FROM rc_results WHERE name='confirmed') THEN RAISE EXCEPTION 'Receipt replay changed the roster result'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.stand_up_roster_confirmations WHERE facility_id=(SELECT fac_roster FROM rc_fixture);
 IF n<>2 THEN RAISE EXCEPTION 'Retried request must not add confirmation rows: %',n; END IF;
END $$;
SELECT pg_temp.rc_actor();
SET LOCAL ROLE authenticated;
-- A different figure without a reason is refused; with a reason it is recorded as overridden.
SELECT pg_temp.rc_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'values',pg_temp.rc_values(6,1))),'differs from the Haven roster') FROM rc_results WHERE name='confirm_payload';
SELECT pg_temp.rc_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'values',pg_temp.rc_values(6,1),'roster',jsonb_build_object('current_total_census',jsonb_build_object('override_reason','because')))),'Invalid override reason') FROM rc_results WHERE name='confirm_payload';
SELECT pg_temp.rc_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'roster',jsonb_build_object('invented','{}'::jsonb))),'Invalid roster confirmation') FROM rc_results WHERE name='confirm_payload';
INSERT INTO rc_results SELECT 'overridden',public.stand_up_command('save',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'values',pg_temp.rc_values(6,2),
 'roster',jsonb_build_object('current_total_census',jsonb_build_object('override_reason','roster_not_current'),'hospital_and_rehab_total',jsonb_build_object('override_reason','change_not_entered')))) FROM rc_results WHERE name='confirm_payload';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM rc_results WHERE name='overridden';
 IF r->'roster_confirmations'->'current_total_census'->>'source'<>'overridden' OR r->'roster_confirmations'->'current_total_census'->>'override_reason'<>'roster_not_current' OR r->'roster_confirmations'->'current_total_census'->>'confirmed'<>'6' OR r->'roster_confirmations'->'current_total_census'->>'suggested'<>'5'
  OR r->'roster_confirmations'->'hospital_and_rehab_total'->>'source'<>'overridden' OR r->'roster_confirmations'->'hospital_and_rehab_total'->>'override_reason'<>'change_not_entered'
 THEN RAISE EXCEPTION 'Override not recorded: %',r; END IF;
END $$;
-- A reason sent with a matching figure is dropped: the server decides the source.
INSERT INTO rc_results SELECT 'reason_dropped',public.stand_up_command('save',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',2,'values',pg_temp.rc_values(5,1),
 'roster',jsonb_build_object('current_total_census',jsonb_build_object('override_reason','other')))) FROM rc_results WHERE name='confirm_payload';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM rc_results WHERE name='reason_dropped';
 IF r->'roster_confirmations'->'current_total_census'->>'source'<>'roster_confirmed' OR r->'roster_confirmations'->'current_total_census'->'override_reason'<>'null'::jsonb THEN RAISE EXCEPTION 'Server must own the source: %',r; END IF;
END $$;
-- A blank figure confirms nothing. COL-553: a save without the roster key is compared all the same;
-- a differing figure is refused and a matching one records roster_confirmed.
INSERT INTO rc_results SELECT 'blank',public.stand_up_command('save',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',3,'values',pg_temp.rc_values(NULL,NULL))) FROM rc_results WHERE name='confirm_payload';
SELECT pg_temp.rc_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',(value-'roster')||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',4,'values',pg_temp.rc_values(7,1))),'differs from the Haven roster') FROM rc_results WHERE name='confirm_payload';
INSERT INTO rc_results SELECT 'no_roster_key',public.stand_up_command('save',(value-'roster')||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',4,'values',pg_temp.rc_values(5,1))) FROM rc_results WHERE name='confirm_payload';
DO $$ BEGIN
 IF (SELECT value->'roster_confirmations' FROM rc_results WHERE name='blank')<>'{}'::jsonb THEN RAISE EXCEPTION 'Blank saves must record no confirmation'; END IF;
 IF (SELECT value->'roster_confirmations'->'current_total_census'->>'source' FROM rc_results WHERE name='no_roster_key')<>'roster_confirmed' THEN RAISE EXCEPTION 'A save without the roster key must still be compared'; END IF;
END $$;
-- A facility with no roster in Haven records entered_no_roster with no suggestion.
INSERT INTO rc_results SELECT 'no_roster',public.stand_up_command('save',jsonb_build_object('facility_id',fac_empty,'week_start',week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft',
 'values',pg_temp.rc_values(4,0),'roster',jsonb_build_object('current_total_census','{}'::jsonb,'hospital_and_rehab_total','{}'::jsonb))) FROM rc_fixture;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM rc_results WHERE name='no_roster';
 IF r->'roster_confirmations'->'current_total_census'->>'source'<>'entered_no_roster' OR r->'roster_confirmations'->'current_total_census'->'suggested'<>'null'::jsonb OR r->'roster_confirmations'->'current_total_census'->'roster_as_of'<>'null'::jsonb
  OR r->'roster_confirmations'->'hospital_and_rehab_total'->>'source'<>'entered_no_roster' THEN RAISE EXCEPTION 'No-roster save not recorded: %',r; END IF;
END $$;
-- A historical correction never takes a roster confirmation; its recorded confirmation stands.
SELECT pg_temp.rc_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',jsonb_build_object('facility_id',fac_roster,'week_start','2020-09-07','expected_version',0,'request_id',gen_random_uuid(),'status','draft','reason','Probe','values',pg_temp.rc_values(5,1),'roster','{}'::jsonb)),'open reporting period only') FROM rc_fixture;
-- The workspace carries the confirmation recorded on the latest revision, not a recomputation.
INSERT INTO rc_results VALUES('workspace',public.stand_up_command('workspace','{}'));
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM jsonb_array_elements((SELECT value->'reports' FROM rc_results WHERE name='workspace')) WHERE value->>'facility_id'=(SELECT fac_roster::text FROM rc_fixture);
 -- COL-553: revision 5 was saved without a roster key and is now compared all the same.
 IF r->'roster_confirmations'->'current_total_census'->>'source'<>'roster_confirmed' OR r->>'version'<>'5' THEN RAISE EXCEPTION 'Workspace must show the latest revision confirmation: %',r; END IF;
 SELECT value INTO r FROM jsonb_array_elements((SELECT value->'reports' FROM rc_results WHERE name='workspace')) WHERE value->>'facility_id'=(SELECT fac_empty::text FROM rc_fixture);
 IF r->'roster_confirmations'->'current_total_census'->>'source'<>'entered_no_roster' THEN RAISE EXCEPTION 'Workspace lost the recorded confirmation: %',r; END IF;
END $$;
RESET ROLE;
-- The recorded confirmation on an earlier revision is unchanged by later roster edits.
UPDATE public.residents SET status='discharged' WHERE first_name='Test Resident' AND last_name='A' AND facility_id=(SELECT fac_roster FROM rc_fixture);
DO $$ DECLARE c jsonb; BEGIN
 SELECT haven.stand_up_roster_confirmations(v.id) INTO c FROM public.stand_up_revisions v JOIN public.stand_up_reports p ON p.id=v.report_id WHERE p.facility_id=(SELECT fac_roster FROM rc_fixture) AND p.week_start=(SELECT week FROM rc_fixture) AND v.version=2;
 IF c->'current_total_census'->>'suggested'<>'5' OR c->'current_total_census'->>'confirmed'<>'6' THEN RAISE EXCEPTION 'Historical confirmation was recomputed: %',c; END IF;
 IF (SELECT roster_census_count FROM public.stand_up_roster_census((SELECT org FROM rc_fixture),(SELECT fac_roster FROM rc_fixture)))<>4 THEN RAISE EXCEPTION 'Live roster must follow the discharge'; END IF;
END $$;
-- Confirmations are append only.
SELECT pg_temp.rc_fail('UPDATE public.stand_up_roster_confirmations SET confirmed_value=99 WHERE facility_id='''||(SELECT fac_roster FROM rc_fixture)||'''','immutable');
SELECT pg_temp.rc_fail('DELETE FROM public.stand_up_roster_confirmations WHERE facility_id='''||(SELECT fac_roster FROM rc_fixture)||'''','immutable');
-- A facility administrator without the grant: denial through the command, nothing through RLS.
UPDATE public.user_profiles SET app_role='facility_admin' WHERE id=(SELECT actor FROM rc_fixture);
SELECT pg_temp.rc_actor();
SET LOCAL ROLE authenticated;
SELECT pg_temp.rc_fail(format('SELECT public.stand_up_command(''roster'',%L::jsonb)',jsonb_build_object('facility_id',fac_other)),'access denied') FROM rc_fixture;
DO $$ DECLARE c record; BEGIN
 SELECT * INTO c FROM public.stand_up_roster_census((SELECT org FROM rc_fixture),(SELECT fac_other FROM rc_fixture));
 IF c.resident_count_in_haven<>0 OR c.roster_as_of IS NOT NULL THEN RAISE EXCEPTION 'Ungranted facility leaked roster counts: %',to_jsonb(c); END IF;
 SELECT * INTO c FROM public.stand_up_roster_census((SELECT org FROM rc_fixture),(SELECT fac_roster FROM rc_fixture));
 IF c.roster_census_count<>4 THEN RAISE EXCEPTION 'Granted facility must stay readable'; END IF;
END $$;
RESET ROLE;
-- The service archive carries the confirmation tokens and no resident identity.
GRANT SELECT ON rc_fixture TO service_role;
GRANT ALL ON rc_results TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO rc_results SELECT 'archive',public.stand_up_export_history(org,week,week) FROM rc_fixture;
INSERT INTO rc_results SELECT 'aggregate',public.stand_up_export_aggregate(org,week) FROM rc_fixture;
RESET ROLE;
DO $$ DECLARE x jsonb; r jsonb; BEGIN
 SELECT value INTO x FROM rc_results WHERE name='aggregate';
 SELECT value INTO r FROM jsonb_array_elements(x->'reports') WHERE value->>'facility_id'=(SELECT fac_empty::text FROM rc_fixture);
 IF r->'roster_confirmations'->'current_total_census'->>'source'<>'entered_no_roster' THEN RAISE EXCEPTION 'Aggregate export lost the confirmation: %',r; END IF;
 IF x::text ~* 'first_name|last_name|resident_id|Test Resident|room' THEN RAISE EXCEPTION 'Aggregate export carries resident identity'; END IF;
 SELECT value INTO x FROM rc_results WHERE name='archive';
 IF x::text ~* 'first_name|last_name|resident_id|Test Resident|room' THEN RAISE EXCEPTION 'History archive carries resident identity'; END IF;
 IF NOT (x::text LIKE '%roster_confirmations%') THEN RAISE EXCEPTION 'History archive must carry roster confirmations'; END IF;
END $$;
ROLLBACK;
