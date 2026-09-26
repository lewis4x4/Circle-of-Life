-- COL-555 remainder (migrations 534-536): the census reason list is a facility
-- setting written through a command, Thursday records reasons, Thursday can be
-- checked against Monday behind a setting, notice delivery and recruiter
-- admission notes are settings. Fails before migration 534.
-- Native scratch-only probe; every fixture rolls back. Synthetic data only.
BEGIN;
SET LOCAL client_min_messages=warning;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON public.residents,public.resident_status_history,public.family_resident_links TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE rs AS SELECT gen_random_uuid() org,gen_random_uuid() ent,gen_random_uuid() fac,gen_random_uuid() fac_other,
 gen_random_uuid() owner_id,gen_random_uuid() owner_session,gen_random_uuid() admin_id,gen_random_uuid() admin_session,
 gen_random_uuid() manager_id,gen_random_uuid() manager_session,gen_random_uuid() res_a,gen_random_uuid() res_b;
INSERT INTO public.organizations(id,name) SELECT org,'Census reason probe' FROM rs;
INSERT INTO public.entities(id,organization_id,name) SELECT ent,org,'Reason entity' FROM rs;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT fac,ent,org,'Reason facility','1 Way','Town','00000',12 FROM rs
 UNION ALL SELECT fac_other,ent,org,'Other reason facility','2 Way','Town','00000',12 FROM rs;
INSERT INTO public.stand_up_meeting_schedule(organization_id,meeting_day,weekday,entry_due_local,call_local,time_zone)
 SELECT org,d,w,time '08:45',time '09:15','America/New_York' FROM rs,(VALUES ('monday',1::smallint),('thursday',4::smallint)) v(d,w);
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT u,u||'@review.invalid','{}','{}' FROM rs,LATERAL (VALUES (owner_id),(admin_id),(manager_id)) v(u);
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT u,u||'@review.invalid',n,r::app_role,org,true FROM rs,LATERAL (VALUES (owner_id,'Reason owner','owner'),(admin_id,'Reason admin','facility_admin'),
  (manager_id,'Reason manager','manager')) v(u,n,r);
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_id FROM rs UNION ALL SELECT admin_session,admin_id FROM rs UNION ALL SELECT manager_session,manager_id FROM rs;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT admin_id,fac,org FROM rs UNION ALL SELECT manager_id,fac,org FROM rs;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,gender,status)
 SELECT res_a,fac,org,'Test Resident','A','prefer_not_to_say'::gender,'active'::resident_status FROM rs
 UNION ALL SELECT res_b,fac,org,'Test Resident','B','prefer_not_to_say','active' FROM rs;
UPDATE public.resident_status_history SET effective_from=now()-interval '30 days' WHERE facility_id=(SELECT fac FROM rs);

CREATE FUNCTION pg_temp.rs_login(who uuid,sess uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'session_id',sess,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',p.organization_id,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM public.user_profiles p WHERE p.id=who;
END $$;
CREATE FUNCTION pg_temp.rs_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;
CREATE FUNCTION pg_temp.rs_values(census integer,hospital integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(census) WHEN k='hospital_and_rehab_total' THEN to_jsonb(hospital) ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k
$$;
CREATE FUNCTION pg_temp.rs_state(p_day text,p_now timestamptz DEFAULT clock_timestamp()) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT haven.stand_up_census_disagreement(org,fac,p_day,p_now) FROM rs
$$;
CREATE FUNCTION pg_temp.rs_thursday(census integer,hospital integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('current_ar_cents',null,'current_total_census',census,'departures_since_monday',null,'hospital_and_rehab_total',hospital,'hospital_total',null,'rehab_total',null)
$$;
CREATE TEMP TABLE rs_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON rs_results TO authenticated; GRANT SELECT ON rs TO authenticated;
CREATE TEMP TABLE rs_week AS SELECT haven.stand_up_open_week(fac) monday_week,haven.stand_up_meeting_open_week(org,fac,'thursday',clock_timestamp()) thursday_week FROM rs;
GRANT SELECT ON rs_week TO authenticated;

-- 1. The new rules have defaults and refuse bad values.
DO $$ DECLARE v jsonb; BEGIN
 SELECT value INTO v FROM public.haven_operating_rule((SELECT org FROM rs),(SELECT fac FROM rs),'stand_up.census_reason_options',current_date);
 IF jsonb_array_length(v)<>4 OR v->1->>'key'<>'change_not_entered' THEN RAISE EXCEPTION 'Reason list default wrong: %',v; END IF;
 SELECT value INTO v FROM public.haven_operating_rule((SELECT org FROM rs),(SELECT fac FROM rs),'stand_up.census_notice_channels',current_date);
 IF v<>'["in_app"]'::jsonb THEN RAISE EXCEPTION 'Channel default wrong: %',v; END IF;
 -- COL-749 ruling 3 (migration 542): the Thursday check against Monday is on by default, through the census bridge.
 IF (SELECT value FROM public.haven_operating_rule((SELECT org FROM rs),(SELECT fac FROM rs),'stand_up.thursday_census_vs_monday',current_date))<>'true'::jsonb
  OR (SELECT value FROM public.haven_operating_rule((SELECT org FROM rs),(SELECT fac FROM rs),'stand_up.thursday_admission_notes_to_recruiters',current_date))<>'false'::jsonb
  OR (SELECT value FROM public.haven_operating_rule((SELECT org FROM rs),(SELECT fac FROM rs),'admissions.arrival_approval_roles',current_date))<>'["owner", "org_admin", "facility_admin", "admin_assistant"]'::jsonb
 THEN RAISE EXCEPTION 'A new rule default is wrong'; END IF;
END $$;
SELECT pg_temp.rs_fail($q$INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'stand_up.census_reason_options','[]'::jsonb,current_date,'Probe' FROM rs$q$,'Census reasons must be');
SELECT pg_temp.rs_fail($q$INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'stand_up.census_reason_options','[{"key":"Bad Key","label":"x"}]'::jsonb,current_date,'Probe' FROM rs$q$,'Census reasons must be');
SELECT pg_temp.rs_fail($q$INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'stand_up.census_reason_options','[{"key":"a","label":"Same"},{"key":"b","label":"same"}]'::jsonb,current_date,'Probe' FROM rs$q$,'Census reasons must be');
SELECT pg_temp.rs_fail($q$INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'stand_up.census_notice_channels','["in_app","push"]'::jsonb,current_date,'Probe' FROM rs$q$,'Push and text delivery');
SELECT pg_temp.rs_fail($q$INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'stand_up.census_notice_channels','["sms"]'::jsonb,current_date,'Probe' FROM rs$q$,'Push and text delivery');
SELECT pg_temp.rs_fail($q$INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'stand_up.thursday_census_vs_monday','"yes"'::jsonb,current_date,'Probe' FROM rs$q$,'on (true) or off');
-- Sections 2 to 4 check Thursday against the roster alone; section 5 turns the Monday check back on.
INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
 SELECT org,fac,'stand_up.thursday_census_vs_monday','false'::jsonb,current_date-30,'Probe: roster only' FROM rs;
SELECT pg_temp.rs_fail($q$INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'admissions.arrival_approval_roles','[]'::jsonb,current_date,'Probe' FROM rs$q$,'cannot be switched off');
SELECT pg_temp.rs_fail($q$INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'admissions.arrival_approval_roles','["recruiter"]'::jsonb,current_date,'Probe' FROM rs$q$,'cannot be switched off');
SELECT pg_temp.rs_fail($q$INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'admissions.arrival_approval_roles','["owner","owner"]'::jsonb,current_date,'Probe' FROM rs$q$,'cannot be switched off');

-- 2. The command: the administrator sets a facility list; the organization scope is refused; a manager is refused.
SELECT pg_temp.rs_login(admin_id,admin_session) FROM rs;
SET LOCAL ROLE authenticated;
INSERT INTO rs_results SELECT 'rule',public.operating_rule_record('stand_up.census_reason_options',fac,
 '[{"key":"awaiting_paperwork","label":"Paperwork not back from the hospital"},{"key":"other","label":"Other"}]'::jsonb,
 (now() AT TIME ZONE 'America/New_York')::date,'Probe: Homewood''s own list') FROM rs;
SELECT pg_temp.rs_fail($q$SELECT public.operating_rule_record('stand_up.census_reason_window_days',NULL,'3'::jsonb,(now() AT TIME ZONE 'America/New_York')::date,'Probe')$q$,'cannot change this rule');
SELECT pg_temp.rs_fail($q$SELECT public.operating_rule_record('stand_up.census_reason_window_days',fac_other,'3'::jsonb,(now() AT TIME ZONE 'America/New_York')::date,'Probe') FROM rs$q$,'cannot change');
SELECT pg_temp.rs_fail($q$SELECT public.operating_rule_record('stand_up.census_reason_window_days',fac,'3'::jsonb,(now() AT TIME ZONE 'America/New_York')::date-1,'Probe') FROM rs$q$,'today or later');
RESET ROLE;
SELECT pg_temp.rs_login(manager_id,manager_session) FROM rs;
SET LOCAL ROLE authenticated;
SELECT pg_temp.rs_fail($q$SELECT public.operating_rule_record('stand_up.census_reason_window_days',fac,'3'::jsonb,(now() AT TIME ZONE 'America/New_York')::date,'Probe') FROM rs$q$,'cannot change this rule');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT value->>'facility_id' FROM rs_results WHERE name='rule')<>(SELECT fac::text FROM rs)
  OR NOT EXISTS(SELECT 1 FROM public.operating_rules WHERE facility_id=(SELECT fac FROM rs) AND rule_key='stand_up.census_reason_options' AND created_by=(SELECT admin_id FROM rs))
 THEN RAISE EXCEPTION 'The command did not record the facility rule with its author'; END IF;
END $$;

-- 3. Monday: a reason outside the facility's list is refused; one in it is kept with its label.
SELECT pg_temp.rs_login(admin_id,admin_session) FROM rs;
SET LOCAL ROLE authenticated;
SELECT pg_temp.rs_fail($q$SELECT public.stand_up_command('save',jsonb_build_object('facility_id',fac,'week_start',monday_week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft',
 'values',pg_temp.rs_values(3,0),'roster',jsonb_build_object('current_total_census',jsonb_build_object('override_reason','change_not_entered')))) FROM rs,rs_week$q$,'Invalid override reason');
INSERT INTO rs_results SELECT 'monday',public.stand_up_command('save',jsonb_build_object('facility_id',fac,'week_start',monday_week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft',
 'values',pg_temp.rs_values(3,0),'roster',jsonb_build_object('current_total_census',jsonb_build_object('override_reason','awaiting_paperwork'))))
 FROM rs,rs_week;
RESET ROLE;
DO $$ DECLARE d jsonb; f jsonb; r jsonb; BEGIN
 SELECT value INTO r FROM rs_results WHERE name='monday';
 IF r->'roster_confirmations'->'current_total_census'->>'override_reason_label'<>'Paperwork not back from the hospital' THEN RAISE EXCEPTION 'The saved reason lost its label: %',r->'roster_confirmations'; END IF;
 d:=pg_temp.rs_state('monday');
 SELECT x INTO f FROM jsonb_array_elements(d->'figures') x WHERE x->>'key'='current_total_census';
 IF d->>'state'<>'explained' OR f->>'reason_label'<>'Paperwork not back from the hospital' OR jsonb_array_length(d->'reason_options')<>2 THEN
  RAISE EXCEPTION 'The disagreement does not carry the facility''s reasons: %',d; END IF;
END $$;
-- Retiring the reason later keeps the label it was given with.
UPDATE public.operating_rules SET effective_from=effective_from-1 WHERE facility_id=(SELECT fac FROM rs) AND rule_key='stand_up.census_reason_options';
INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
 SELECT org,fac,'stand_up.census_reason_options','[{"key":"other","label":"Other"}]'::jsonb,(now() AT TIME ZONE 'America/New_York')::date,'Probe: retire the paperwork reason' FROM rs;
DO $$ DECLARE f jsonb; BEGIN
 SELECT x INTO f FROM jsonb_array_elements(pg_temp.rs_state('monday')->'figures') x WHERE x->>'key'='current_total_census';
 IF f->>'reason_label'<>'Paperwork not back from the hospital' THEN RAISE EXCEPTION 'A retired reason must keep its label: %',f; END IF;
END $$;

-- 4. Thursday: a draft may keep a difference (open), submitting needs a reason, a reason explains it.
SELECT pg_temp.rs_login(admin_id,admin_session) FROM rs;
SET LOCAL ROLE authenticated;
INSERT INTO rs_results SELECT 'thursday_draft',public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',fac,'week_start',thursday_week,'expected_version',0,
 'request_id',gen_random_uuid(),'status','draft','values',pg_temp.rs_thursday(4,0))) FROM rs,rs_week;
SELECT pg_temp.rs_fail($q$SELECT public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',fac,'week_start',thursday_week,'expected_version',1,
 'request_id',gen_random_uuid(),'status','ready','values',jsonb_build_object('current_ar_cents',0,'current_total_census',4,'departures_since_monday',0,'hospital_and_rehab_total',0,'hospital_total',0,'rehab_total',0))) FROM rs,rs_week$q$,'differs from the Haven roster');
SELECT pg_temp.rs_fail($q$SELECT public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',fac,'week_start',thursday_week,'expected_version',1,
 'request_id',gen_random_uuid(),'status','draft','values',pg_temp.rs_thursday(4,0),'roster',jsonb_build_object('current_total_census',jsonb_build_object('override_reason','not_a_reason')))) FROM rs,rs_week$q$,'Invalid override reason');
RESET ROLE;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM rs_results WHERE name='thursday_draft';
 IF r->'roster_confirmations'->'current_total_census'->>'source'<>'differs_unexplained' THEN RAISE EXCEPTION 'The Thursday draft must record the unexplained difference: %',r; END IF;
 IF pg_temp.rs_state('thursday')->>'state'<>'open' THEN RAISE EXCEPTION 'An unexplained Thursday difference must be open'; END IF;
END $$;
SELECT pg_temp.rs_login(admin_id,admin_session) FROM rs;
SET LOCAL ROLE authenticated;
INSERT INTO rs_results SELECT 'thursday_ready',public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',fac,'week_start',thursday_week,'expected_version',1,
 'request_id',gen_random_uuid(),'status','ready','values',jsonb_build_object('current_ar_cents',0,'current_total_census',4,'departures_since_monday',0,'hospital_and_rehab_total',0,'hospital_total',0,'rehab_total',0),
 'roster',jsonb_build_object('current_total_census',jsonb_build_object('override_reason','other')))) FROM rs,rs_week;
RESET ROLE;
DO $$ DECLARE d jsonb; f jsonb; BEGIN
 d:=pg_temp.rs_state('thursday');
 SELECT x INTO f FROM jsonb_array_elements(d->'figures') x WHERE x->>'key'='current_total_census';
 IF d->>'state'<>'explained' OR f->>'reason'<>'other' OR f->>'reason_label'<>'Other' OR (d->>'compares_with_monday')::boolean THEN RAISE EXCEPTION 'A Thursday reason must explain it: %',d; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(d->'figures') x WHERE x->>'against'='monday') THEN RAISE EXCEPTION 'Thursday against Monday must be off by default'; END IF;
 -- The facility's window governs Thursday as it does Monday: at 0 days a reason never holds.
 INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
  SELECT org,fac,'stand_up.census_reason_window_days','0'::jsonb,current_date-1,'Probe: no grace' FROM rs;
 IF pg_temp.rs_state('thursday')->>'state'<>'open' THEN RAISE EXCEPTION 'A Thursday reason must follow the window'; END IF;
 DELETE FROM public.operating_rules WHERE facility_id=(SELECT fac FROM rs) AND rule_key='stand_up.census_reason_window_days';
END $$;

-- 5. Thursday against Monday, when the facility turns it on: Monday said 2 (the
-- roster then), nothing has moved since, so Thursday's 4 is 2 more than expected.
-- Fixture shortcut: stand the Monday draft in for a submission (triggers off for these two rows only).
SET LOCAL session_replication_role=replica;
UPDATE public.stand_up_revisions SET status='ready',created_at=now()-interval '1 hour',values=jsonb_set(values,'{current_total_census}','2')
 WHERE report_id=(SELECT id FROM public.stand_up_reports WHERE facility_id=(SELECT fac FROM rs));
SET LOCAL session_replication_role=origin;
INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
 SELECT org,fac,'stand_up.thursday_census_vs_monday','true'::jsonb,(now() AT TIME ZONE 'America/New_York')::date-14,'Probe: compare with Monday' FROM rs;
DO $$ DECLARE d jsonb; f jsonb; BEGIN
 d:=pg_temp.rs_state('thursday');
 SELECT x INTO f FROM jsonb_array_elements(d->'figures') x WHERE x->>'key'='current_total_census' AND x->>'against'='monday';
 IF f IS NULL OR (f->>'monday')::int<>2 OR (f->>'roster')::int<>2 OR (f->>'roster_change_since_monday')::int<>0 OR f->>'stand_up'<>'4' THEN
  RAISE EXCEPTION 'Thursday against Monday is wrong: %',d; END IF;
 IF NOT (d->>'compares_with_monday')::boolean THEN RAISE EXCEPTION 'The disagreement must say it compares with Monday'; END IF;
END $$;

-- 6. Notice delivery: an empty channel list sends nothing. The sweep reads the rule on the
-- Eastern date of the Thursday due time, which can be days back and, in a UTC session after
-- 00:00, earlier than current_date-1; date the rule before any due date in the open week.
INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
 SELECT org,fac,'stand_up.census_notice_channels','[]'::jsonb,(now() AT TIME ZONE 'America/New_York')::date-14,'Probe: no notices' FROM rs;
DELETE FROM public.operating_rules WHERE facility_id=(SELECT fac FROM rs) AND rule_key='stand_up.census_reason_options';
SELECT pg_temp.rs_login(admin_id,admin_session) FROM rs;
SET LOCAL ROLE authenticated;
INSERT INTO rs_results SELECT 'thursday_open',public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',fac,'week_start',thursday_week,'expected_version',2,
 'request_id',gen_random_uuid(),'status','draft','values',pg_temp.rs_thursday(5,0))) FROM rs,rs_week;
RESET ROLE;
DO $$ DECLARE due timestamptz; BEGIN
 due:=(pg_temp.rs_state('thursday')->>'entry_due_at')::timestamptz;
 IF pg_temp.rs_state('thursday')->>'state'<>'open' THEN RAISE EXCEPTION 'Setup: Thursday must be open'; END IF;
 PERFORM haven.stand_up_census_notice_sweep(due-interval '10 minutes');
 IF EXISTS(SELECT 1 FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM rs) AND meeting_day='thursday') THEN RAISE EXCEPTION 'A facility with no notice channel was notified'; END IF;
 DELETE FROM public.operating_rules WHERE facility_id=(SELECT fac FROM rs) AND rule_key='stand_up.census_notice_channels';
 PERFORM haven.stand_up_census_notice_sweep(due-interval '9 minutes');
 IF NOT EXISTS(SELECT 1 FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM rs) AND meeting_day='thursday' AND message LIKE '%Monday''s 2 with the movements since expects 2%') THEN
  RAISE EXCEPTION 'The in-app notice with the Monday comparison did not go out: %',(SELECT array_agg(message) FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM rs)); END IF;
END $$;

-- 7. Recruiters read admission notes on the Thursday report only where the facility turns it on.
DO $$ DECLARE w date := (SELECT thursday_week FROM rs_week); BEGIN
 IF (haven.stand_up_thursday_facility((SELECT org FROM rs),(SELECT fac FROM rs),w,'thursday','recruiter')->>'admission_notes_shown')::boolean THEN
  RAISE EXCEPTION 'Recruiters must not read admission notes by default'; END IF;
 IF NOT (haven.stand_up_thursday_facility((SELECT org FROM rs),(SELECT fac FROM rs),w,'thursday','facility_admin')->>'admission_notes_shown')::boolean THEN
  RAISE EXCEPTION 'Administrators read admission notes'; END IF;
 INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
  SELECT org,fac,'stand_up.thursday_admission_notes_to_recruiters','true'::jsonb,current_date-1,'Probe: recruiters read notes' FROM rs;
 IF NOT (haven.stand_up_thursday_facility((SELECT org FROM rs),(SELECT fac FROM rs),w,'thursday','recruiter')->>'admission_notes_shown')::boolean THEN
  RAISE EXCEPTION 'The facility setting did not show admission notes to recruiters'; END IF;
 IF (haven.stand_up_thursday_facility((SELECT org FROM rs),(SELECT fac_other FROM rs),w,'thursday','recruiter')->>'admission_notes_shown')::boolean THEN
  RAISE EXCEPTION 'Another facility''s setting leaked'; END IF;
END $$;

-- Grant posture.
DO $$ BEGIN
 IF NOT has_function_privilege('authenticated','public.operating_rule_record(text,uuid,jsonb,date,text)','EXECUTE')
  OR has_function_privilege('anon','public.operating_rule_record(text,uuid,jsonb,date,text)','EXECUTE')
  OR has_function_privilege('authenticated','haven.stand_up_meeting_roster_confirm(jsonb,uuid,uuid,uuid,uuid,uuid)','EXECUTE')
  OR has_table_privilege('authenticated','public.stand_up_meeting_roster_confirmations','SELECT')
 THEN RAISE EXCEPTION 'Census reason grant boundary failed'; END IF;
END $$;
SELECT pg_temp.rs_fail('UPDATE public.stand_up_meeting_roster_confirmations SET confirmed_value=0','immutable');
ROLLBACK;
