-- COL-751 (migration 541): the census notice reaches the Administrator, the
-- Assistant Administrator (admin_assistant) and the Manager at the facility, by
-- default and in Haven only. Fails before migration 541 (the default was the
-- administrator alone). Native scratch-only probe; every fixture rolls back.
-- Synthetic data only.
BEGIN;
SET LOCAL client_min_messages=warning;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON public.residents,public.resident_status_history,public.family_resident_links TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE nr AS SELECT gen_random_uuid() org,gen_random_uuid() ent,gen_random_uuid() fac,gen_random_uuid() fac_other,
 gen_random_uuid() admin_id,gen_random_uuid() assistant_id,gen_random_uuid() assistant_session,gen_random_uuid() manager_id,gen_random_uuid() manager_session,
 gen_random_uuid() medtech_id,gen_random_uuid() recruiter_id,gen_random_uuid() other_assistant_id,gen_random_uuid() inactive_manager_id,gen_random_uuid() revoked_manager_id,
 gen_random_uuid() res_a,gen_random_uuid() res_b;
INSERT INTO public.organizations(id,name) SELECT org,'Notice recipients probe' FROM nr;
INSERT INTO public.entities(id,organization_id,name) SELECT ent,org,'Notice entity' FROM nr;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT fac,ent,org,'Notice facility','1 Way','Town','00000',12 FROM nr
 UNION ALL SELECT fac_other,ent,org,'Other notice facility','2 Way','Town','00000',12 FROM nr;
INSERT INTO public.stand_up_meeting_schedule(organization_id,meeting_day,weekday,entry_due_local,call_local,time_zone)
 SELECT org,d,w,time '08:45',time '09:15','America/New_York' FROM nr,(VALUES ('monday',1::smallint),('thursday',4::smallint)) v(d,w);
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT u,u||'@review.invalid','{}','{}' FROM nr,LATERAL (VALUES (admin_id),(assistant_id),(manager_id),(medtech_id),(recruiter_id),(other_assistant_id),(inactive_manager_id),(revoked_manager_id)) v(u);
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT u,u||'@review.invalid',n,r::app_role,org,act FROM nr,LATERAL (VALUES
  (admin_id,'Notice admin','facility_admin',true),(assistant_id,'Notice assistant','admin_assistant',true),(manager_id,'Notice manager','manager',true),
  (medtech_id,'Notice med tech','med_tech',true),(recruiter_id,'Notice recruiter','recruiter',true),
  (other_assistant_id,'Assistant elsewhere','admin_assistant',true),(inactive_manager_id,'Inactive manager','manager',false),
  (revoked_manager_id,'Revoked manager','manager',true)) v(u,n,r,act);
INSERT INTO auth.sessions(id,user_id) SELECT assistant_session,assistant_id FROM nr UNION ALL SELECT manager_session,manager_id FROM nr;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT u,f,org FROM nr,LATERAL (VALUES (admin_id,fac),(assistant_id,fac),(manager_id,fac),(medtech_id,fac),(recruiter_id,fac),
  (other_assistant_id,fac_other),(inactive_manager_id,fac)) v(u,f);
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,revoked_at)
 SELECT revoked_manager_id,fac,org,now()-interval '1 day' FROM nr;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,gender,status)
 SELECT res_a,fac,org,'Test Resident','A','prefer_not_to_say'::gender,'active'::resident_status FROM nr
 UNION ALL SELECT res_b,fac,org,'Test Resident','B','prefer_not_to_say','active' FROM nr;
UPDATE public.resident_status_history SET effective_from=now()-interval '30 days' WHERE facility_id=(SELECT fac FROM nr);

CREATE FUNCTION pg_temp.nr_login(who uuid,sess uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'session_id',sess,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',p.organization_id,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM public.user_profiles p WHERE p.id=who;
END $$;
CREATE TEMP TABLE nr_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON nr_results TO authenticated; GRANT SELECT ON nr TO authenticated;

-- 1. The default is the three roles, and the delivery stays in Haven.
DO $$ BEGIN
 IF (SELECT value FROM public.haven_operating_rule((SELECT org FROM nr),(SELECT fac FROM nr),'stand_up.census_notice_roles',current_date))
    <>'["facility_admin", "admin_assistant", "manager"]'::jsonb THEN
  RAISE EXCEPTION 'Default notice roles must be the administrator, the assistant and the manager: %',
   (SELECT value FROM public.haven_operating_rule((SELECT org FROM nr),(SELECT fac FROM nr),'stand_up.census_notice_roles',current_date));
 END IF;
 IF (SELECT value FROM public.haven_operating_rule((SELECT org FROM nr),(SELECT fac FROM nr),'stand_up.census_notice_channels',current_date))<>'["in_app"]'::jsonb THEN
  RAISE EXCEPTION 'Census notices stay in Haven';
 END IF;
END $$;
-- Every organization that existed at the migration got the ruling as its own dated row.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.organizations o WHERE o.deleted_at IS NULL AND o.id<>(SELECT org FROM nr)
   AND NOT EXISTS(SELECT 1 FROM public.operating_rules r WHERE r.organization_id=o.id AND r.facility_id IS NULL AND r.rule_key='stand_up.census_notice_roles'
     AND r.effective_from=DATE '2026-09-25' AND r.value='["facility_admin", "admin_assistant", "manager"]'::jsonb AND r.change_reason LIKE '%Brian%')) THEN
  RAISE EXCEPTION 'An organization is missing the 2026-09-25 notice roles row';
 END IF;
END $$;

-- 2. Monday 3 against a roster of 2, no reason: open. The sweep tells exactly
-- the administrator, the assistant and the manager with access to the facility.
INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status)
 SELECT org,fac,haven.stand_up_open_week(fac),
  (SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN '3'::jsonb WHEN k='hospital_and_rehab_total' THEN '0'::jsonb ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k),'draft' FROM nr;
DO $$ DECLARE d jsonb; due timestamptz; got text[]; BEGIN
 d:=haven.stand_up_census_disagreement((SELECT org FROM nr),(SELECT fac FROM nr),'monday',clock_timestamp());
 IF d->>'state'<>'open' THEN RAISE EXCEPTION 'Monday 3 against 2 must be open: %',d; END IF;
 due:=(d->>'entry_due_at')::timestamptz;
 PERFORM haven.stand_up_census_notice_sweep(due-interval '20 minutes');
 SELECT array_agg(recipient_role ORDER BY recipient_role) INTO got FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM nr) AND phase='before_deadline';
 IF got IS DISTINCT FROM ARRAY['admin_assistant','facility_admin','manager'] THEN RAISE EXCEPTION 'Recipients wrong: %',got; END IF;
 IF EXISTS(SELECT 1 FROM public.stand_up_census_notices WHERE recipient_user_id IN (SELECT unnest(ARRAY[medtech_id,recruiter_id,other_assistant_id,inactive_manager_id,revoked_manager_id]) FROM nr)) THEN
  RAISE EXCEPTION 'A med-tech, recruiter, inactive, revoked or other-facility user was told';
 END IF;
 IF EXISTS(SELECT 1 FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM nr) AND channel<>'in_app') THEN RAISE EXCEPTION 'A notice left Haven'; END IF;
END $$;

-- 3. The assistant and the manager each read their own notice (Home and Stand Up read this).
SELECT pg_temp.nr_login(assistant_id,assistant_session) FROM nr;
SET LOCAL ROLE authenticated;
INSERT INTO nr_results VALUES('assistant',public.stand_up_census_notices_for_me());
RESET ROLE;
SELECT pg_temp.nr_login(manager_id,manager_session) FROM nr;
SET LOCAL ROLE authenticated;
INSERT INTO nr_results VALUES('manager',public.stand_up_census_notices_for_me());
INSERT INTO nr_results SELECT 'manager_read',public.stand_up_census_disagreements(fac) FROM nr;
RESET ROLE;
DO $$ DECLARE r jsonb; BEGIN
 FOR r IN SELECT value FROM nr_results WHERE name IN ('assistant','manager') LOOP
  IF jsonb_array_length(r)<>1 OR r->0->>'facility_name'<>'Notice facility' OR r->0->>'meeting_day'<>'monday' OR r->0->'figures'->0->>'stand_up'<>'3' THEN
   RAISE EXCEPTION 'A recipient cannot read their notice: %',r; END IF;
 END LOOP;
 SELECT value INTO r FROM nr_results WHERE name='manager_read';
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r) x WHERE x->>'meeting_day'='monday' AND x->>'state'='open') THEN
  RAISE EXCEPTION 'The manager must read the disagreement to reconcile it: %',r; END IF;
END $$;

-- 4. Still a setting: a facility narrowed to its administrator tells only them.
INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
 SELECT org,fac,'stand_up.census_notice_roles','["facility_admin"]'::jsonb,current_date-30,'Probe: administrator only' FROM nr;
DO $$ DECLARE due timestamptz; BEGIN
 due:=(haven.stand_up_census_disagreement((SELECT org FROM nr),(SELECT fac FROM nr),'monday',clock_timestamp())->>'entry_due_at')::timestamptz;
 PERFORM haven.stand_up_census_notice_sweep(due+interval '1 minute');
 IF (SELECT array_agg(recipient_role) FROM public.stand_up_census_notices WHERE facility_id=(SELECT fac FROM nr) AND phase='at_deadline')
    IS DISTINCT FROM ARRAY['facility_admin'] THEN RAISE EXCEPTION 'A narrowed setting must tell only the administrator'; END IF;
END $$;
ROLLBACK;
