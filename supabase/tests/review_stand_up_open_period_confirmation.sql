-- COL-553: open-period Stand Up figures are always compared with the roster,
-- and a revision written around stand_up_save cannot skip the confirmation.
-- Native scratch-only probe; every fixture and auth adaptation rolls back.
-- Synthetic residents only ("Test Resident"); no real data.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
-- Replay adaptation: the hosted project grants authenticated the resident tables by default; the scratch cluster does not.
GRANT SELECT ON public.residents,public.resident_status_history,public.family_resident_links TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE oc_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() session,gen_random_uuid() org,gen_random_uuid() ent,
 gen_random_uuid() fac,gen_random_uuid() fac_empty,haven.stand_up_week() week;
INSERT INTO public.organizations(id,name) SELECT org,'Open period confirmation probe' FROM oc_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT ent,org,'Open period entity' FROM oc_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT fac,ent,org,'Open period facility','1 Way','Town','00000',12 FROM oc_fixture
 UNION ALL SELECT fac_empty,ent,org,'Open period empty facility','2 Way','Town','00000',12 FROM oc_fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','org_admin'),'{"full_name":"Open period probe"}' FROM oc_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT actor,actor||'@review.invalid','Open period probe','org_admin',org,true FROM oc_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM oc_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,fac,org FROM oc_fixture UNION ALL SELECT actor,fac_empty,org FROM oc_fixture;
-- Roster: three in house, one at hospital. Census suggestion 4, hospital suggestion 1.
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,gender,status)
 SELECT gen_random_uuid(),fac,org,'Test Resident','A','prefer_not_to_say'::gender,'active'::resident_status FROM oc_fixture
 UNION ALL SELECT gen_random_uuid(),fac,org,'Test Resident','B','prefer_not_to_say'::gender,'active'::resident_status FROM oc_fixture
 UNION ALL SELECT gen_random_uuid(),fac,org,'Test Resident','C','prefer_not_to_say'::gender,'active'::resident_status FROM oc_fixture
 UNION ALL SELECT gen_random_uuid(),fac,org,'Test Resident','D','prefer_not_to_say'::gender,'hospital_hold'::resident_status FROM oc_fixture;
CREATE FUNCTION pg_temp.oc_actor() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true) FROM oc_fixture f JOIN public.user_profiles p ON p.id=f.actor;
END $$;
SELECT pg_temp.oc_actor();
CREATE TEMP TABLE oc_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON oc_results TO authenticated;
GRANT SELECT ON oc_fixture TO authenticated;
CREATE FUNCTION pg_temp.oc_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;
CREATE FUNCTION pg_temp.oc_values(census integer,hospital integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(census) WHEN k='hospital_and_rehab_total' THEN to_jsonb(hospital) ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k
$$;
-- The open-period payload the finding names: figures, no roster block at all.
INSERT INTO oc_results SELECT 'bare',jsonb_build_object('facility_id',fac,'week_start',week,'expected_version',0,'status','draft') FROM oc_fixture;

-- The trigger exists, is deferred, and its function is reachable by nobody.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='stand_up_revisions' AND t.tgname='stand_up_revision_confirmed' AND t.tgdeferrable AND t.tginitdeferred AND NOT t.tgisinternal)
 THEN RAISE EXCEPTION 'Deferred constraint trigger stand_up_revision_confirmed is missing'; END IF;
 IF has_function_privilege('authenticated','haven.stand_up_revision_confirmed()','EXECUTE') OR has_function_privilege('service_role','haven.stand_up_revision_confirmed()','EXECUTE')
 THEN RAISE EXCEPTION 'Trigger function must not be executable by application roles'; END IF;
END $$;

SET LOCAL ROLE authenticated;
-- 1. A differing figure with no roster block is refused: the comparison is not the client's to request.
SELECT pg_temp.oc_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'values',pg_temp.oc_values(6,1))),'differs from the Haven roster') FROM oc_results WHERE name='bare';
-- 2. A matching figure with no roster block is recorded as roster_confirmed.
INSERT INTO oc_results SELECT 'confirmed',public.stand_up_command('save',value||jsonb_build_object('request_id',gen_random_uuid(),'values',pg_temp.oc_values(4,1))) FROM oc_results WHERE name='bare';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM oc_results WHERE name='confirmed';
 IF r->'roster_confirmations'->'current_total_census'->>'source'<>'roster_confirmed' OR r->'roster_confirmations'->'current_total_census'->>'suggested'<>'4'
  OR r->'roster_confirmations'->'hospital_and_rehab_total'->>'source'<>'roster_confirmed' OR r->'roster_confirmations'->'hospital_and_rehab_total'->>'suggested'<>'1'
 THEN RAISE EXCEPTION 'A bare matching save must record roster_confirmed: %',r; END IF;
END $$;
-- 3. A differing figure with a reason is recorded as overridden, exactly as before.
INSERT INTO oc_results SELECT 'overridden',public.stand_up_command('save',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'values',pg_temp.oc_values(6,1),
 'roster',jsonb_build_object('current_total_census',jsonb_build_object('override_reason','change_not_entered')))) FROM oc_results WHERE name='bare';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM oc_results WHERE name='overridden';
 IF r->'roster_confirmations'->'current_total_census'->>'source'<>'overridden' OR r->'roster_confirmations'->'current_total_census'->>'override_reason'<>'change_not_entered' OR r->'roster_confirmations'->'current_total_census'->>'confirmed'<>'6'
 THEN RAISE EXCEPTION 'A reasoned save must record overridden: %',r; END IF;
END $$;
-- 4. A facility with no roster in Haven still records entered_no_roster from a bare payload.
INSERT INTO oc_results SELECT 'no_roster',public.stand_up_command('save',jsonb_build_object('facility_id',fac_empty,'week_start',week,'expected_version',0,'status','draft','request_id',gen_random_uuid(),'values',pg_temp.oc_values(9,0))) FROM oc_fixture;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM oc_results WHERE name='no_roster';
 IF r->'roster_confirmations'->'current_total_census'->>'source'<>'entered_no_roster' THEN RAISE EXCEPTION 'No-roster facility must record entered_no_roster: %',r; END IF;
END $$;
-- 5. A historical correction still may not carry a roster block and still records nothing.
SELECT pg_temp.oc_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',jsonb_build_object('facility_id',fac,'week_start',week-7,'expected_version',0,'status','draft','request_id',gen_random_uuid(),'reason','probe','values',pg_temp.oc_values(6,1),'roster','{}'::jsonb)),'open reporting period only') FROM oc_fixture;
INSERT INTO oc_results SELECT 'historical',public.stand_up_command('save',jsonb_build_object('facility_id',fac,'week_start',week-7,'expected_version',0,'status','draft','request_id',gen_random_uuid(),'reason','probe','values',pg_temp.oc_values(6,1))) FROM oc_fixture;
RESET ROLE;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.stand_up_roster_confirmations c JOIN public.stand_up_reports r ON r.id=c.report_id WHERE r.facility_id=(SELECT fac FROM oc_fixture) AND r.week_start=(SELECT week-7 FROM oc_fixture);
 IF n<>0 THEN RAISE EXCEPTION 'A historical correction must record no confirmation: %',n; END IF;
 SELECT count(*) INTO n FROM public.stand_up_roster_confirmations c JOIN public.stand_up_reports r ON r.id=c.report_id WHERE r.facility_id=(SELECT fac FROM oc_fixture) AND r.week_start=(SELECT week FROM oc_fixture);
 -- Two revisions, two figures each: the bare match and the reasoned override both record both figures.
 IF n<>4 THEN RAISE EXCEPTION 'Open-period saves must record one row per figure per revision: %',n; END IF;
END $$;

-- 6. The guard behind the guard: a revision written around stand_up_save for the open period is refused at commit.
DO $$ DECLARE rid uuid; ver integer; caught boolean:=false; BEGIN
 SELECT id,version INTO rid,ver FROM public.stand_up_reports WHERE facility_id=(SELECT fac FROM oc_fixture) AND week_start=(SELECT week FROM oc_fixture);
 BEGIN
  INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,reason,provenance,batch_id,source_as_of)
   VALUES(rid,ver+1,pg_temp.oc_values(35,1),'draft',(SELECT actor FROM oc_fixture),'direct write','{"source":"probe"}',NULL,clock_timestamp());
  SET CONSTRAINTS ALL IMMEDIATE;
 EXCEPTION WHEN check_violation THEN
  IF position('no roster confirmation' IN SQLERRM)=0 THEN RAISE; END IF;
  caught:=true;
 END;
 IF NOT caught THEN RAISE EXCEPTION 'A direct open-period revision without confirmation must be refused'; END IF;
 IF EXISTS(SELECT 1 FROM public.stand_up_revisions WHERE report_id=rid AND version=ver+1) THEN RAISE EXCEPTION 'The refused revision must not remain'; END IF;
END $$;
-- 7. The same direct write for a past week, or with a batch, is outside the guard (imports and history stay as they were).
DO $$ DECLARE rid uuid; ver integer; BEGIN
 SELECT id,version INTO rid,ver FROM public.stand_up_reports WHERE facility_id=(SELECT fac FROM oc_fixture) AND week_start=(SELECT week-7 FROM oc_fixture);
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,reason,provenance,batch_id,source_as_of)
  VALUES(rid,ver+1,pg_temp.oc_values(7,1),'draft',(SELECT actor FROM oc_fixture),'historical direct write','{"source":"probe"}',NULL,clock_timestamp());
 SET CONSTRAINTS ALL IMMEDIATE;
END $$;
-- 8. A blank figure on the open period needs no confirmation (nothing to compare).
DO $$ DECLARE rid uuid; ver integer; BEGIN
 SELECT id,version INTO rid,ver FROM public.stand_up_reports WHERE facility_id=(SELECT fac FROM oc_fixture) AND week_start=(SELECT week FROM oc_fixture);
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,reason,provenance,batch_id,source_as_of)
  VALUES(rid,ver+1,pg_temp.oc_values(NULL,NULL),'draft',(SELECT actor FROM oc_fixture),'blank direct write','{"source":"probe"}',NULL,clock_timestamp());
 SET CONSTRAINTS ALL IMMEDIATE;
END $$;
ROLLBACK;
