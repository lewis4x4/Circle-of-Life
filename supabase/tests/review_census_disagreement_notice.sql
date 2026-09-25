-- COL-555 / COL-751: a census disagreement is one derived object, and it reaches
-- the administrator before each Stand Up deadline. Fails before migration 523.
-- Native scratch-only probe; every fixture rolls back. Synthetic data only.
BEGIN;
SET LOCAL client_min_messages=warning;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON public.residents,public.resident_status_history,public.family_resident_links TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE cd AS SELECT gen_random_uuid() org,gen_random_uuid() ent,gen_random_uuid() fac,gen_random_uuid() fac_other,
 gen_random_uuid() admin_id,gen_random_uuid() admin_session,gen_random_uuid() manager_id,gen_random_uuid() manager_session,
 gen_random_uuid() medtech_id,gen_random_uuid() medtech_session,gen_random_uuid() outsider_id,
 gen_random_uuid() res_a,gen_random_uuid() res_b;
INSERT INTO public.organizations(id,name) SELECT org,'Census disagreement probe' FROM cd;
INSERT INTO public.entities(id,organization_id,name) SELECT ent,org,'Census entity' FROM cd;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT fac,ent,org,'Census facility','1 Way','Town','00000',12 FROM cd
 UNION ALL SELECT fac_other,ent,org,'Other census facility','2 Way','Town','00000',12 FROM cd;
INSERT INTO public.stand_up_meeting_schedule(organization_id,meeting_day,weekday,entry_due_local,call_local,time_zone)
 SELECT org,d,w,time '08:45',time '09:15','America/New_York' FROM cd,(VALUES ('monday',1::smallint),('thursday',4::smallint)) v(d,w);
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT u,u||'@review.invalid','{}','{}' FROM cd,LATERAL (VALUES (admin_id),(manager_id),(medtech_id),(outsider_id)) v(u);
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT u,u||'@review.invalid',n,r::app_role,org,true FROM cd,LATERAL (VALUES (admin_id,'Census admin','facility_admin'),(manager_id,'Census manager','manager'),
  (medtech_id,'Census med tech','med_tech'),(outsider_id,'Other admin','facility_admin')) v(u,n,r);
INSERT INTO auth.sessions(id,user_id) SELECT admin_session,admin_id FROM cd UNION ALL SELECT manager_session,manager_id FROM cd UNION ALL SELECT medtech_session,medtech_id FROM cd;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT admin_id,fac,org FROM cd UNION ALL SELECT manager_id,fac,org FROM cd UNION ALL SELECT medtech_id,fac,org FROM cd UNION ALL SELECT outsider_id,fac_other,org FROM cd;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,gender,status)
 SELECT res_a,fac,org,'Test Resident','A','prefer_not_to_say'::gender,'active'::resident_status FROM cd
 UNION ALL SELECT res_b,fac,org,'Test Resident','B','prefer_not_to_say','active' FROM cd;

CREATE FUNCTION pg_temp.cd_login(who uuid,sess uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'session_id',sess,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',p.organization_id,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM public.user_profiles p WHERE p.id=who;
END $$;
CREATE FUNCTION pg_temp.cd_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;
CREATE FUNCTION pg_temp.cd_values(census integer,hospital integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(census) WHEN k='hospital_and_rehab_total' THEN to_jsonb(hospital) ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k
$$;
CREATE FUNCTION pg_temp.cd_state(p_day text,p_now timestamptz DEFAULT clock_timestamp()) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT haven.stand_up_census_disagreement(org,fac,p_day,p_now) FROM cd
$$;
CREATE TEMP TABLE cd_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON cd_results TO authenticated; GRANT SELECT ON cd TO authenticated;

-- Grant posture: the derived read and the notice read are the only doors.
DO $$ BEGIN
 IF has_function_privilege('authenticated','haven.stand_up_census_disagreement(uuid,uuid,text,timestamptz)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_census_notice_sweep(timestamptz)','EXECUTE')
 OR has_function_privilege('service_role','haven.stand_up_census_notice_sweep(timestamptz)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.stand_up_census_disagreements(uuid)','EXECUTE')
 OR has_function_privilege('anon','public.stand_up_census_notices_for_me()','EXECUTE')
 OR has_table_privilege('authenticated','public.stand_up_census_notices','SELECT')
 THEN RAISE EXCEPTION 'Census disagreement grant boundary failed'; END IF;
END $$;

-- 1. Nothing entered yet: nothing to disagree with.
DO $$ BEGIN
 IF pg_temp.cd_state('monday')->>'state'<>'not_entered' THEN RAISE EXCEPTION 'An unstarted report must read not_entered: %',pg_temp.cd_state('monday'); END IF;
END $$;

-- 2. Monday says 3 with a reason; the roster says 2: explained, within the window.
-- The residents arrived a month ago (the probe runs in one transaction, so
-- every change would otherwise share one timestamp).
UPDATE public.resident_status_history SET effective_from=now()-interval '30 days' WHERE facility_id=(SELECT fac FROM cd);
CREATE TEMP TABLE cd_week AS SELECT haven.stand_up_open_week(fac) haven_week FROM cd;
GRANT SELECT ON cd_week TO authenticated;
SELECT pg_temp.cd_login(admin_id,admin_session) FROM cd;
SET LOCAL ROLE authenticated;
INSERT INTO cd_results SELECT 'monday',public.stand_up_command('save',jsonb_build_object('facility_id',fac,'week_start',haven_week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft',
 'values',pg_temp.cd_values(3,0),'roster',jsonb_build_object('current_total_census',jsonb_build_object('override_reason','change_not_entered'))))
 FROM cd, cd_week;
RESET ROLE;
DO $$ DECLARE d jsonb; f jsonb; BEGIN
 d:=pg_temp.cd_state('monday');
 SELECT x INTO f FROM jsonb_array_elements(d->'figures') x WHERE x->>'key'='current_total_census';
 IF d->>'state'<>'explained' OR f->>'stand_up'<>'3' OR f->>'roster'<>'2' OR f->>'reason'<>'change_not_entered' OR f->>'reason_until' IS NULL THEN RAISE EXCEPTION 'Explained disagreement wrong: %',d; END IF;
 -- The window is the facility's setting: 7 days by default. Day 8 is open again, with nothing else changed.
 d:=pg_temp.cd_state('monday',(f->>'reason_at')::timestamptz+interval '6 days 23 hours');
 IF d->>'state'<>'explained' THEN RAISE EXCEPTION 'Inside the window the reason must hold: %',d; END IF;
 d:=pg_temp.cd_state('monday',(f->>'reason_at')::timestamptz+interval '7 days 1 minute');
 IF d->>'state'<>'open' THEN RAISE EXCEPTION 'After the window the disagreement must reopen: %',d; END IF;
END $$;
-- A shorter window, set for this facility, takes over.
INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
 SELECT org,fac,'stand_up.census_reason_window_days','1'::jsonb,current_date-1,'Probe: one-day window' FROM cd;
DO $$ DECLARE d jsonb; f jsonb; BEGIN
 d:=pg_temp.cd_state('monday');
 SELECT x INTO f FROM jsonb_array_elements(d->'figures') x WHERE x->>'key'='current_total_census';
 IF (pg_temp.cd_state('monday',(f->>'reason_at')::timestamptz+interval '25 hours'))->>'state'<>'open' OR (d->>'reason_window_days')::int<>1 THEN
  RAISE EXCEPTION 'The facility window did not apply: %',d; END IF;
END $$;
SELECT pg_temp.cd_fail($q$INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'stand_up.census_reason_window_days','-1'::jsonb,current_date,'Probe' FROM cd$q$,'census reason window');
SELECT pg_temp.cd_fail($q$INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'stand_up.census_notice_roles','["med_tech"]'::jsonb,current_date,'Probe' FROM cd$q$,'Census notices go to');
DELETE FROM public.operating_rules WHERE facility_id=(SELECT fac FROM cd) AND rule_key='stand_up.census_reason_window_days';

-- 3. The roster moves after the reason and the figure still differs: open.
INSERT INTO public.residents(facility_id,organization_id,first_name,last_name,gender,status)
 SELECT fac,org,'Test Resident','C','prefer_not_to_say','active' FROM cd;
UPDATE public.residents SET status='discharged',discharge_date=(now() AT TIME ZONE 'America/New_York')::date,discharge_reason='other' WHERE id=(SELECT res_b FROM cd);
DO $$ DECLARE d jsonb; f jsonb; BEGIN
 d:=pg_temp.cd_state('monday');
 SELECT x INTO f FROM jsonb_array_elements(d->'figures') x WHERE x->>'key'='current_total_census';
 IF d->>'state'<>'open' OR (f->>'roster_changed_since_reason')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'A roster change must reopen the reason: %',d; END IF;
END $$;

-- 4. The notice: inside the lead time before the deadline, and again at it; never outside.
DO $$ DECLARE d jsonb; due timestamptz; n integer; BEGIN
 d:=pg_temp.cd_state('monday'); due:=(d->>'entry_due_at')::timestamptz;
 PERFORM haven.stand_up_census_notice_sweep(due-interval '2 hours');
 IF EXISTS(SELECT 1 FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM cd)) THEN RAISE EXCEPTION 'A notice went out before the lead time'; END IF;
 PERFORM haven.stand_up_census_notice_sweep(due-interval '30 minutes');
 PERFORM haven.stand_up_census_notice_sweep(due-interval '25 minutes');
 SELECT count(*) INTO n FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM cd) AND phase='before_deadline';
 IF n<>1 THEN RAISE EXCEPTION 'The administrator must get exactly one notice before the deadline, got %',n; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM cd) AND recipient_user_id=(SELECT admin_id FROM cd)
   AND message LIKE 'Census: Stand Up says 3, roster says 2. Reconcile before 8:45 AM.') THEN RAISE EXCEPTION 'The notice words are wrong: %',(SELECT message FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM cd) LIMIT 1); END IF;
 IF EXISTS(SELECT 1 FROM public.stand_up_census_notices WHERE recipient_user_id IN ((SELECT manager_id FROM cd),(SELECT medtech_id FROM cd),(SELECT outsider_id FROM cd))) THEN
  RAISE EXCEPTION 'Only the notice roles with access to the facility are told'; END IF;
 PERFORM haven.stand_up_census_notice_sweep(due+interval '1 minute');
 IF NOT EXISTS(SELECT 1 FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM cd) AND phase='at_deadline') THEN RAISE EXCEPTION 'No second notice at the deadline'; END IF;
 IF (pg_temp.cd_state('monday',(d->>'call_at')::timestamptz+interval '1 minute')->>'unreconciled')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'After the call an open disagreement must read unreconciled'; END IF;
END $$;
-- The recipient roles are a setting: add managers.
INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
 SELECT org,fac,'stand_up.census_notice_roles','["facility_admin","manager"]'::jsonb,current_date-14,'Probe: managers too' FROM cd;
DO $$ BEGIN
 PERFORM haven.stand_up_census_notice_sweep((pg_temp.cd_state('monday')->>'entry_due_at')::timestamptz-interval '10 minutes');
 IF NOT EXISTS(SELECT 1 FROM public.stand_up_census_notices WHERE recipient_user_id=(SELECT manager_id FROM cd)) THEN RAISE EXCEPTION 'A role added to the setting was not told'; END IF;
END $$;

-- 5. The recipient reads it; it clears the moment either side is fixed.
SELECT pg_temp.cd_login(admin_id,admin_session) FROM cd;
SET LOCAL ROLE authenticated;
INSERT INTO cd_results VALUES('mine',public.stand_up_census_notices_for_me());
INSERT INTO cd_results SELECT 'read',public.stand_up_census_disagreements(fac) FROM cd;
RESET ROLE;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM cd_results WHERE name='mine';
 IF jsonb_array_length(r)<>1 OR r->0->>'facility_name'<>'Census facility' OR r->0->'figures'->0->>'stand_up'<>'3' THEN RAISE EXCEPTION 'Recipient cannot read the notice: %',r; END IF;
 SELECT value INTO r FROM cd_results WHERE name='read';
 IF r::text ~* 'Test Resident|first_name|last_name' THEN RAISE EXCEPTION 'The disagreement carries resident identity'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r) x WHERE x->>'meeting_day'='monday' AND x->>'state'='open') THEN RAISE EXCEPTION 'Reader must see Monday open: %',r; END IF;
END $$;
-- Fix the roster side: admit the missing resident back.
UPDATE public.residents SET status='active',discharge_date=NULL,discharge_reason=NULL WHERE id=(SELECT res_b FROM cd);
SELECT pg_temp.cd_login(admin_id,admin_session) FROM cd;
SET LOCAL ROLE authenticated;
INSERT INTO cd_results VALUES('mine_after',public.stand_up_census_notices_for_me());
RESET ROLE;
DO $$ BEGIN
 IF pg_temp.cd_state('monday')->>'state'<>'agrees' THEN RAISE EXCEPTION 'Roster 3 against Stand Up 3 must agree: %',pg_temp.cd_state('monday'); END IF;
 IF (SELECT jsonb_array_length(value) FROM cd_results WHERE name='mine_after')<>0 THEN RAISE EXCEPTION 'A fixed disagreement must clear the notice'; END IF;
 -- An agreeing facility sends nothing.
 PERFORM haven.stand_up_census_notice_sweep((pg_temp.cd_state('monday')->>'entry_due_at')::timestamptz-interval '5 minutes');
 IF (SELECT count(*) FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM cd))<>3 THEN RAISE EXCEPTION 'An agreeing facility was notified'; END IF;
END $$;

-- 6. Thursday compares its own figures with the roster; with no reason a difference is open.
INSERT INTO public.stand_up_meeting_reports(organization_id,facility_id,week_start,meeting_day,values,status)
 SELECT org,fac,haven.stand_up_meeting_open_week(org,fac,'thursday',clock_timestamp()),'thursday',
  '{"current_ar_cents":null,"current_total_census":5,"departures_since_monday":null,"hospital_and_rehab_total":0,"hospital_total":null,"rehab_total":null}'::jsonb,'draft' FROM cd;
DO $$ BEGIN
 IF pg_temp.cd_state('thursday')->>'state'<>'open' THEN RAISE EXCEPTION 'Thursday 5 against roster 3 must be open: %',pg_temp.cd_state('thursday'); END IF;
END $$;

-- 7. Who may read: administrators, managers and assistants; not med-techs.
SELECT pg_temp.cd_login(medtech_id,medtech_session) FROM cd;
SET LOCAL ROLE authenticated;
SELECT pg_temp.cd_fail('SELECT public.stand_up_census_disagreements()','access denied');
RESET ROLE;
SELECT pg_temp.cd_fail('UPDATE public.stand_up_census_notices SET message=''x''','immutable');
ROLLBACK;
