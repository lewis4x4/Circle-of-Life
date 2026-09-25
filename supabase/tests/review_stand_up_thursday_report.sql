-- COL-754: the Thursday Stand Up report. Fails before migration 524 (no report).
-- Per facility: Haven's figures for Thursday, who left and who is at hospital or
-- rehab, every open referral with all its notes and contacts in time order, and
-- each recruiter's activity since Monday's call. Names and admission notes only
-- to the roles that already read them.
-- Native scratch-only probe; every fixture rolls back. Synthetic data only.
BEGIN;
SET LOCAL client_min_messages=warning;
GRANT USAGE ON SCHEMA auth, haven TO authenticated;
GRANT SELECT ON public.residents,public.resident_status_history,public.family_resident_links TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'role','') $$;

CREATE TEMP TABLE th AS SELECT gen_random_uuid() org,gen_random_uuid() ent,gen_random_uuid() fac,gen_random_uuid() fac_other,
 gen_random_uuid() admin_id,gen_random_uuid() admin_session,gen_random_uuid() recruiter_id,gen_random_uuid() recruiter_session,
 gen_random_uuid() medtech_id,gen_random_uuid() medtech_session,
 gen_random_uuid() res_a,gen_random_uuid() res_b,gen_random_uuid() res_c,gen_random_uuid() res_d,
 NULL::uuid lead_open,NULL::uuid lead_moved_in,NULL::uuid lead_other;
INSERT INTO public.organizations(id,name) SELECT org,'Thursday report probe' FROM th;
INSERT INTO public.entities(id,organization_id,name) SELECT ent,org,'Thursday entity' FROM th;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,state,zip,total_licensed_beds)
 SELECT fac,ent,org,'Thursday facility','1 Way','Town','FL','00000',12 FROM th
 UNION ALL SELECT fac_other,ent,org,'Other Thursday facility','2 Way','Town','FL','00000',12 FROM th;
INSERT INTO public.stand_up_meeting_schedule(organization_id,meeting_day,weekday,entry_due_local,call_local,time_zone)
 SELECT org,d,w,time '08:45',time '09:15','America/New_York' FROM th,(VALUES ('monday',1::smallint),('thursday',4::smallint)) v(d,w);
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT u,u||'@review.invalid','{}','{}' FROM th,LATERAL (VALUES (admin_id),(recruiter_id),(medtech_id)) v(u);
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT u,u||'@review.invalid',n,r::app_role,org,true FROM th,LATERAL (VALUES (admin_id,'Thursday administrator','facility_admin'),(recruiter_id,'Robin Recruiter','recruiter'),(medtech_id,'Thursday med tech','med_tech')) v(u,n,r);
INSERT INTO auth.sessions(id,user_id) SELECT admin_session,admin_id FROM th UNION ALL SELECT recruiter_session,recruiter_id FROM th UNION ALL SELECT medtech_session,medtech_id FROM th;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT u,f,org FROM th,LATERAL (VALUES (admin_id,fac),(recruiter_id,fac),(recruiter_id,fac_other),(medtech_id,fac)) v(u,f);
-- Residents: two in house a month, then one goes to rehab and one is discharged, both after Monday's call.
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,gender,status)
 SELECT r,fac,org,'Test Resident',n,'prefer_not_to_say'::gender,'active'::resident_status FROM th,LATERAL (VALUES (res_a,'Alpha'),(res_b,'Bravo'),(res_c,'Charlie')) v(r,n);
UPDATE public.resident_status_history SET effective_from=now()-interval '30 days' WHERE facility_id=(SELECT fac FROM th);
UPDATE public.residents SET status='hospital_hold',bed_hold_stay_type='rehab' WHERE id=(SELECT res_b FROM th);
UPDATE public.residents SET status='discharged',discharge_date=(now() AT TIME ZONE 'America/New_York')::date,discharge_reason='other' WHERE id=(SELECT res_c FROM th);
-- A resident who moved in from a referral: that referral is converted and not a potential resident.
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,gender,status)
 SELECT res_d,fac,org,'Test Resident','Delta','prefer_not_to_say','active' FROM th;

CREATE FUNCTION pg_temp.th_login(who uuid,sess uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'session_id',sess,'role','authenticated','auth_claim_version',p.auth_claim_version,'organization_id',p.organization_id,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM public.user_profiles p WHERE p.id=who;
END $$;
CREATE FUNCTION pg_temp.th_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;
CREATE TEMP TABLE th_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON th_results TO authenticated; GRANT SELECT,UPDATE ON th TO authenticated;

-- The recruiter captures two leads, logs a contact and books a tour; a third lead at another facility.
SELECT pg_temp.th_login(recruiter_id,recruiter_session) FROM th;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f th%ROWTYPE; one jsonb; two jsonb; other jsonb; logged jsonb; BEGIN
 SELECT * INTO STRICT f FROM th;
 one:=public.referral_episode_capture('thursday:capture:one',public.referral_episode_initial_revision(),
  jsonb_build_object('facility_id',f.fac,'first_name','Avery','last_name','Prospect','receipt_precision','unknown'));
 two:=public.referral_episode_capture('thursday:capture:two',public.referral_episode_initial_revision(),
  jsonb_build_object('facility_id',f.fac,'first_name','Delta','last_name','Mover','receipt_precision','unknown'));
 other:=public.referral_episode_capture('thursday:capture:three',public.referral_episode_initial_revision(),
  jsonb_build_object('facility_id',f.fac_other,'first_name','Elsewhere','last_name','Lead','receipt_precision','unknown'));
 logged:=public.referral_episode_command((one->>'episode_id')::uuid,'thursday:interaction:one',one->>'episode_revision','record_interaction',
  jsonb_build_object('summary','Daughter wants a tour next week.','method','phone_call','contacted_name','Jordan Prospect (Daughter)',
   'effective_precision','unknown','next_action','Call back to book the tour','next_action_at','2030-01-01T13:00:00Z'));
 PERFORM public.referral_tour_command((one->>'episode_id')::uuid,'thursday:tour:one',logged->>'episode_revision','schedule',
  jsonb_build_object('scheduled_for','2030-01-02T15:00:00Z','owner_user_id',f.recruiter_id));
 UPDATE th SET lead_open=(one->>'episode_id')::uuid, lead_moved_in=(two->>'episode_id')::uuid, lead_other=(other->>'episode_id')::uuid;
END $$;
RESET ROLE;
-- The second lead moved in: an arrival converted it (COL-333's result, set directly here).
DO $$ BEGIN
 PERFORM haven.activate_referral_command(false);
 UPDATE public.referral_leads SET status='converted',converted_resident_id=(SELECT res_d FROM th),converted_at=now(),work_state='closed' WHERE id=(SELECT lead_moved_in FROM th);
 PERFORM haven.deactivate_referral_command();
END $$;
-- An admission case with its own notes on the open lead.
INSERT INTO public.admission_cases(resident_id,organization_id,facility_id,referral_lead_id,status,target_move_in_date,notes)
 SELECT res_a,org,fac,lead_open,'pending_clearance',current_date+10,'Physician visit booked for the 1823.' FROM th;
UPDATE public.referral_leads SET notes='Prefers a private room.' WHERE id=(SELECT lead_open FROM th);

-- The administrator reads the report.
SELECT pg_temp.th_login(admin_id,admin_session) FROM th;
SET LOCAL ROLE authenticated;
INSERT INTO th_results SELECT 'admin',public.stand_up_command('report',jsonb_build_object('meeting_day','thursday','facility_id',fac)) FROM th;
RESET ROLE;
DO $$ DECLARE r jsonb; f jsonb; lead jsonb; kinds text[]; BEGIN
 SELECT value INTO r FROM th_results WHERE name='admin';
 f:=r->'facilities'->0;
 IF jsonb_array_length(r->'facilities')<>1 OR f->>'facility_name'<>'Thursday facility' THEN RAISE EXCEPTION 'Report scope wrong: %',r; END IF;
 -- 1. Figures: census 3 (A, B in rehab, D), 1 at hospital or rehab, rehab 1, hospital 0, 1 departure since Monday.
 IF (f->'figures'->'current_total_census'->>'value')::int<>3 OR (f->'figures'->'hospital_and_rehab_total'->>'value')::int<>1
  OR (f->'figures'->'rehab_total'->>'value')::int<>1 OR (f->'figures'->'hospital_total'->>'value')::int<>0
  OR (f->'figures'->'departures_since_monday'->>'value')::int<>1 THEN RAISE EXCEPTION 'Thursday figures wrong: %',f->'figures'; END IF;
 IF f->'figures'->'current_ar_cents'->'value'<>'null'::jsonb OR f->'figures'->'current_ar_cents'->>'note' IS NULL THEN RAISE EXCEPTION 'A/R with no invoices must say so, not 0: %',f->'figures'->'current_ar_cents'; END IF;
 -- 2. Who: named for the administrator.
 IF f->'departures'->0->>'resident'<>'Test Resident Charlie' OR f->'departures'->0->>'kind'<>'discharged' THEN RAISE EXCEPTION 'Departures wrong: %',f->'departures'; END IF;
 IF f->'hospital'->'out_now'->0->>'resident'<>'Test Resident Bravo' OR f->'hospital'->'out_now'->0->>'stay_type'<>'rehab'
  OR jsonb_array_length(f->'hospital'->'went_out')<>1 THEN RAISE EXCEPTION 'Hospital stays wrong: %',f->'hospital'; END IF;
 -- 3. Potential residents: the open lead only; the moved-in and other-facility leads are not here.
 IF jsonb_array_length(f->'potential_residents')<>1 THEN RAISE EXCEPTION 'Potential residents wrong: %',f->'potential_residents'; END IF;
 lead:=f->'potential_residents'->0;
 IF lead->>'name'<>'Avery Prospect' OR lead->>'next_action'<>'Call back to book the tour'
  OR jsonb_array_length(lead->'tours')<>1 OR lead->'tours'->0->>'outcome'<>'scheduled' OR (lead->'tours'->0->>'new')::boolean IS NOT TRUE
  OR lead->'admission'->>'status'<>'pending_clearance' THEN RAISE EXCEPTION 'Lead detail wrong: %',lead; END IF;
 SELECT array_agg(x->>'kind' ORDER BY x->>'kind') INTO kinds FROM jsonb_array_elements(lead->'timeline') x;
 IF NOT kinds @> ARRAY['contact','admission_note','lead_note','tour'] THEN RAISE EXCEPTION 'Timeline missing entries: %',lead->'timeline'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lead->'timeline') x WHERE x->>'kind'='contact' AND x->>'text'='Daughter wants a tour next week.'
   AND x->>'method'='phone_call' AND x->>'by'='Robin Recruiter' AND (x->>'new')::boolean) THEN RAISE EXCEPTION 'The logged contact is not in the timeline: %',lead->'timeline'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lead->'timeline') x WHERE x->>'kind'='admission_note' AND x->>'text'='Physician visit booked for the 1823.') THEN RAISE EXCEPTION 'Admission notes missing for the administrator'; END IF;
 -- In time order.
 IF EXISTS(SELECT 1 FROM (SELECT (x->>'at')::timestamptz at, lag((x->>'at')::timestamptz) OVER (ORDER BY o) prev FROM jsonb_array_elements(lead->'timeline') WITH ORDINALITY t(x,o)) s WHERE s.at<s.prev) THEN
  RAISE EXCEPTION 'Timeline not in time order: %',lead->'timeline'; END IF;
 -- 4. Recruiters' activity since Monday.
 IF jsonb_array_length(f->'recruiters')<>1 OR (f->'recruiters'->0->>'contacts')::int<>1 OR (f->'recruiters'->0->>'tours')::int<>1
  OR f->'recruiters'->0->'items'->0->>'lead_name'<>'Avery Prospect' THEN RAISE EXCEPTION 'Recruiter activity wrong: %',f->'recruiters'; END IF;
END $$;

-- The recruiter reads the same report: counts, not names; no admission notes; their own contacts in full.
SELECT pg_temp.th_login(recruiter_id,recruiter_session) FROM th;
SET LOCAL ROLE authenticated;
INSERT INTO th_results SELECT 'recruiter',public.stand_up_command('report',jsonb_build_object('meeting_day','thursday','facility_id',fac)) FROM th;
-- A recruiter still cannot write Thursday figures.
SELECT pg_temp.th_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',jsonb_build_object('meeting_day','thursday','facility_id',fac,'week_start',haven_week,
  'expected_version',0,'request_id',gen_random_uuid(),'values','{"current_ar_cents":1,"current_total_census":1,"departures_since_monday":0,"hospital_and_rehab_total":0,"hospital_total":0,"rehab_total":0}'::jsonb)),'access denied')
 FROM th, LATERAL (SELECT (value->'facilities'->0->>'week_start')::date haven_week FROM th_results WHERE name='recruiter') w;
RESET ROLE;
DO $$ DECLARE f jsonb; lead jsonb; BEGIN
 SELECT value->'facilities'->0 INTO f FROM th_results WHERE name='recruiter';
 IF (f->>'names_shown')::boolean OR f->'departures'->0->'resident'<>'null'::jsonb OR f->'hospital'->'out_now'->0->'resident'<>'null'::jsonb THEN
  RAISE EXCEPTION 'A recruiter must see counts, not resident names: %',f; END IF;
 IF f::text LIKE '%Test Resident%' THEN RAISE EXCEPTION 'Resident names reached a recruiter'; END IF;
 lead:=f->'potential_residents'->0;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(lead->'timeline') x WHERE x->>'kind'='admission_note') THEN RAISE EXCEPTION 'Admission notes reached a recruiter'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lead->'timeline') x WHERE x->>'kind'='contact' AND x->>'text'='Daughter wants a tour next week.') THEN RAISE EXCEPTION 'The recruiter lost the contact log'; END IF;
END $$;

-- A med-tech is not a note reader: refused.
SELECT pg_temp.th_login(medtech_id,medtech_session) FROM th;
SET LOCAL ROLE authenticated;
SELECT pg_temp.th_fail($q$SELECT public.stand_up_command('report','{"meeting_day":"thursday"}'::jsonb)$q$,'access denied');
RESET ROLE;

-- Haven only: no publisher or export reads the report.
DO $$ DECLARE fn text; BEGIN
 FOR fn IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','haven') AND p.proname IN ('stand_up_export_history','stand_up_export_aggregate','stand_up_google_export_bridge','stand_up_google_bridge') LOOP
  IF pg_get_functiondef(fn::regprocedure) ~ 'thursday_report|thursday_facility' THEN RAISE EXCEPTION 'A publisher reads the Thursday report: %',fn; END IF;
 END LOOP;
END $$;
ROLLBACK;
