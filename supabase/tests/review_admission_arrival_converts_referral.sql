-- COL-333: a confirmed arrival marks its referral converted, atomically and
-- replay-safe. Fails before migration 520: the lead stayed application_pending.
-- Local disposable replay only: every fixture rolls back. Synthetic data only.
BEGIN;
SET LOCAL client_min_messages=warning;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'role','')
$$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated,service_role;
-- Vanilla replay's service role lacks hosted Supabase's grants/BYPASSRLS.
ALTER ROLE service_role BYPASSRLS;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

CREATE TEMP TABLE ar AS SELECT gen_random_uuid() org, gen_random_uuid() ent, gen_random_uuid() fac, gen_random_uuid() fac2,
  gen_random_uuid() room, gen_random_uuid() owner_id,
  gen_random_uuid() bed_a, gen_random_uuid() bed_b, gen_random_uuid() bed_c, gen_random_uuid() bed_d,
  gen_random_uuid() res_a, gen_random_uuid() res_b, gen_random_uuid() res_c, gen_random_uuid() res_d,
  gen_random_uuid() case_a, gen_random_uuid() case_b, gen_random_uuid() case_c, gen_random_uuid() case_d,
  gen_random_uuid() lead_a, gen_random_uuid() lead_b, gen_random_uuid() lead_c,
  (now() AT TIME ZONE 'America/New_York')::date AS today;
GRANT ALL ON ar TO authenticated,service_role;

INSERT INTO organizations(id,name) SELECT org,'Arrival review' FROM ar;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Arrival Entity' FROM ar;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone)
  SELECT fac,ent,org,'Arrival A','1 Way','Town','00000',10,'America/New_York' FROM ar
  UNION ALL SELECT fac2,ent,org,'Arrival B','2 Way','Town','00000',10,'America/New_York' FROM ar;
INSERT INTO rooms(id,facility_id,organization_id,room_number) SELECT room,fac,org,'101' FROM ar;
INSERT INTO beds(id,room_id,facility_id,organization_id,bed_label,status)
  SELECT b,room,fac,org,l,'available' FROM ar, LATERAL (VALUES (bed_a,'A'),(bed_b,'B'),(bed_c,'C'),(bed_d,'D')) v(b,l);
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT owner_id,owner_id||'@arrival.invalid','{}','{}' FROM ar;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
  SELECT owner_id,org,owner_id||'@arrival.invalid','Arrival owner','owner'::app_role,true FROM ar
ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,gender,date_of_birth,status)
  SELECT r,org,fac,'Synthetic',n,'prefer_not_to_say'::gender,'1940-01-01'::date,'pending_admission'::resident_status
  FROM ar, LATERAL (VALUES (res_a,'Alpha'),(res_b,'Bravo'),(res_c,'Charlie'),(res_d,'Delta')) v(r,n);

-- Leads: A is application_pending with a next step, B was already closed lost,
-- C is open and linked to a case that moves to move_in without an arrival.
INSERT INTO referral_leads(id,organization_id,facility_id,first_name,last_name,status,next_action,next_action_at)
  SELECT lead_a,org,fac,'Synthetic','Alpha','application_pending'::referral_lead_status,'Call daughter',now()+interval '1 day' FROM ar
  UNION ALL SELECT lead_c,org,fac,'Synthetic','Charlie','tour_completed',NULL,NULL FROM ar;
INSERT INTO referral_closure_reasons(organization_id,code,label,closed_by_party,is_active)
  SELECT org,'chose_elsewhere','Chose elsewhere','prospect',true FROM ar;
INSERT INTO referral_leads(id,organization_id,facility_id,first_name,last_name,status,closed_at,closed_by_party,closure_reason_id)
  SELECT lead_b,org,fac,'Synthetic','Bravo','lost',now()-interval '2 days','prospect',
    (SELECT id FROM referral_closure_reasons WHERE organization_id=ar.org) FROM ar;

INSERT INTO admission_cases(id,resident_id,organization_id,facility_id,referral_lead_id,status,bed_id,financial_clearance_at,physician_orders_received_at)
  SELECT c,r,org,fac,l,'bed_reserved',b,now(),now()
  FROM ar, LATERAL (VALUES (case_a,res_a,lead_a,bed_a),(case_b,res_b,lead_b,bed_b),(case_c,res_c,lead_c,bed_c),(case_d,res_d,NULL::uuid,bed_d)) v(c,r,l,b);
INSERT INTO form_1823_records(admission_case_id,resident_id,facility_id,organization_id,status,physician_name,exam_date,expiration_date)
  SELECT c,r,fac,org,'received','Synthetic physician',today-1,today+365
  FROM ar, LATERAL (VALUES (case_a,res_a),(case_b,res_b),(case_c,res_c),(case_d,res_d)) v(c,r);
INSERT INTO admission_document_checklist_items(admission_case_id,organization_id,facility_id,document_type,required,received_at,notes)
  SELECT c,org,fac,'form_1823',true,now(),'Synthetic verified document'
  FROM ar, LATERAL (VALUES (case_a),(case_b),(case_c),(case_d)) v(c)
  ON CONFLICT(admission_case_id,document_type) WHERE deleted_at IS NULL
  DO UPDATE SET received_at=excluded.received_at,notes=excluded.notes;
INSERT INTO admission_case_rate_terms(admission_case_id,accommodation_type,quoted_base_rate_cents,created_by)
  SELECT c,'private',10000,owner_id FROM ar, LATERAL (VALUES (case_a),(case_b),(case_c),(case_d)) v(c);

CREATE FUNCTION pg_temp.ar_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'Arrival conversion: %',msg; END IF; END $$;

-- COL-333 (538): an administrator approves each case's current readiness before its arrival.
CREATE FUNCTION pg_temp.ar_approve(p_case uuid) RETURNS void LANGUAGE sql AS $$
  SELECT admission_arrival_approve(p_case,(SELECT owner_id FROM ar),haven.admission_arrival_readiness(p_case)->>'fingerprint',gen_random_uuid())::text::void
$$;
SELECT pg_temp.ar_approve(c) FROM ar, LATERAL (VALUES (case_a),(case_b),(case_c),(case_d)) v(c);

-- 1. Moving the case to move_in without an actual arrival is refused (538) and converts nothing.
DO $$ BEGIN
  UPDATE admission_cases SET status='move_in' WHERE id=(SELECT case_c FROM ar);
  RAISE EXCEPTION 'a move_in status without an actual arrival was accepted';
EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'Move-in is recorded by confirming the actual arrival' THEN RAISE; END IF;
END $$;
SELECT pg_temp.ar_assert((SELECT status='tour_completed' AND converted_at IS NULL FROM referral_leads WHERE id=(SELECT lead_c FROM ar)),
  'a move_in status without an actual arrival converted the referral');

-- 2. A failure after the arrival in the same transaction leaves the referral open.
DO $$ BEGIN
  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM confirm_admission_arrival_review(case_a,owner_id,today) FROM ar;
    RAISE EXCEPTION 'synthetic failure after arrival';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT pg_temp.ar_assert((SELECT status='application_pending' AND converted_resident_id IS NULL FROM referral_leads WHERE id=(SELECT lead_a FROM ar)),
  'a rolled-back arrival left the referral converted');
SELECT pg_temp.ar_assert((SELECT count(*)=0 FROM referral_episode_events WHERE referral_lead_id=(SELECT lead_a FROM ar) AND event_kind='admission_transition'),
  'a rolled-back arrival left an event');

-- 3. The confirmed arrival converts the linked referral in the same transaction.
SET LOCAL ROLE service_role;
SELECT confirm_admission_arrival_review(case_a,owner_id,today) FROM ar;
RESET ROLE;
DO $$ DECLARE f record; l record; e record; c record; BEGIN
  SELECT * INTO f FROM ar;
  SELECT * INTO c FROM admission_cases WHERE id=f.case_a;
  SELECT * INTO l FROM referral_leads WHERE id=f.lead_a;
  IF l.status<>'converted' OR l.converted_resident_id IS DISTINCT FROM f.res_a OR l.converted_at IS DISTINCT FROM c.actual_arrival_at THEN
    RAISE EXCEPTION 'lead after arrival: status % resident % at % (arrival %)', l.status, l.converted_resident_id, l.converted_at, c.actual_arrival_at; END IF;
  IF l.work_state<>'closed' OR l.next_action IS NOT NULL OR l.status_before_close<>'application_pending' OR l.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'lead closure fields wrong: % % % %', l.work_state, l.next_action, l.status_before_close, l.closed_at; END IF;
  SELECT * INTO STRICT e FROM referral_episode_events WHERE referral_lead_id=f.lead_a AND event_kind='admission_transition';
  IF e.from_status<>'application_pending' OR e.to_status<>'converted' OR e.actor_id<>f.owner_id OR e.actor_role<>'owner'
     OR e.request_key<>'arrival:'||f.case_a
     -- 538: an arrival given as a date only is recorded as a date, never as an invented instant.
     OR e.effective_precision<>'date' OR e.effective_date IS DISTINCT FROM f.today OR e.effective_at IS NOT NULL
     OR e.source_reference->>'admission_case_id'<>f.case_a::text OR e.result_revision<>l.episode_revision THEN
    RAISE EXCEPTION 'arrival event wrong: %', to_jsonb(e); END IF;
  IF (SELECT o.state FROM referral_opportunities o JOIN referral_facility_considerations fc ON fc.opportunity_id=o.id WHERE fc.id=l.facility_consideration_id)<>'closed' THEN
    RAISE EXCEPTION 'the opportunity stayed open after its only episode converted'; END IF;
END $$;

-- 4. Replaying the confirmation changes nothing and records nothing twice.
SET LOCAL ROLE service_role;
SELECT pg_temp.ar_assert((SELECT confirm_admission_arrival_review(case_a,owner_id,today)=res_a FROM ar),'replay did not return the resident');
RESET ROLE;
SELECT pg_temp.ar_assert((SELECT count(*)=1 FROM referral_episode_events WHERE referral_lead_id=(SELECT lead_a FROM ar) AND event_kind='admission_transition'),
  'replay recorded a second conversion');
-- A second writer of the same arrival cannot record it twice either.
DO $$ BEGIN
  PERFORM haven.referral_convert_for_arrival(case_a,owner_id) FROM ar;
END $$;
SELECT pg_temp.ar_assert((SELECT count(*)=1 FROM referral_episode_events WHERE referral_lead_id=(SELECT lead_a FROM ar) AND event_kind='admission_transition'),
  'a second conversion of the same arrival was recorded');

-- 5. A lead already closed lost keeps its outcome; a case with no lead arrives normally.
SET LOCAL ROLE service_role;
SELECT confirm_admission_arrival_review(case_b,owner_id,today) FROM ar;
SELECT confirm_admission_arrival_review(case_d,owner_id,today) FROM ar;
RESET ROLE;
SELECT pg_temp.ar_assert((SELECT status='lost' AND converted_resident_id IS NULL FROM referral_leads WHERE id=(SELECT lead_b FROM ar)),
  'an arrival rewrote a lost referral');
SELECT pg_temp.ar_assert((SELECT status='active' FROM residents WHERE id=(SELECT res_d FROM ar)),'a case with no referral did not arrive');

-- 6. The moved-in resident has left the open referral list; the open lead has not.
SELECT pg_temp.ar_assert((SELECT count(*)=1 FROM referral_leads WHERE organization_id=(SELECT org FROM ar)
  AND deleted_at IS NULL AND status NOT IN ('converted','lost','merged')),'open referral list is wrong after arrivals');

-- 7. Nobody but the arrival trigger can call the helper.
DO $$ BEGIN
  IF has_function_privilege('authenticated','haven.referral_convert_for_arrival(uuid,uuid)','EXECUTE')
     OR has_function_privilege('service_role','haven.referral_convert_for_arrival(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'the conversion helper is callable directly'; END IF;
END $$;

ROLLBACK;
