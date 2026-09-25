-- COL-749 ruling 4 (migration 543): recruiters read the non-clinical admission
-- workflow on the Thursday report (status steps, blocks, quoted-rate notes and
-- non-clinical checklist notes), and never its clinical content (admission
-- notes stay behind their own setting, which stays off; physician orders,
-- Form 1823 content and clinical checklist documents never reach the report).
-- Ruling 3: the report carries the census bridge per facility, counts only.
-- Fails before migration 543. Native scratch-only probe; every fixture rolls
-- back. Synthetic data only.
BEGIN;
SET LOCAL client_min_messages=warning;
GRANT USAGE ON SCHEMA auth, haven TO authenticated;
GRANT SELECT ON public.residents,public.resident_status_history,public.family_resident_links TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'role','') $$;

CREATE TEMP TABLE aw AS SELECT gen_random_uuid() org,gen_random_uuid() ent,gen_random_uuid() fac,gen_random_uuid() fac_closed,gen_random_uuid() fac_unassigned,
 gen_random_uuid() admin_id,gen_random_uuid() admin_session,gen_random_uuid() recruiter_id,gen_random_uuid() recruiter_session,
 gen_random_uuid() res_a,gen_random_uuid() res_b,gen_random_uuid() case_a,gen_random_uuid() case_b,
 NULL::uuid lead_a,NULL::uuid lead_b,NULL::uuid lead_c;
INSERT INTO public.organizations(id,name) SELECT org,'Admission workflow probe' FROM aw;
INSERT INTO public.entities(id,organization_id,name) SELECT ent,org,'Workflow entity' FROM aw;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,state,zip,total_licensed_beds)
 SELECT fac,ent,org,'Workflow facility','1 Way','Town','FL','00000',12 FROM aw
 UNION ALL SELECT fac_closed,ent,org,'Workflow facility, switch off','2 Way','Town','FL','00000',12 FROM aw
 UNION ALL SELECT fac_unassigned,ent,org,'Workflow facility, not assigned','3 Way','Town','FL','00000',12 FROM aw;
INSERT INTO public.stand_up_meeting_schedule(organization_id,meeting_day,weekday,entry_due_local,call_local,time_zone)
 SELECT org,d,w,time '08:45',time '09:15','America/New_York' FROM aw,(VALUES ('monday',1::smallint),('thursday',4::smallint)) v(d,w);
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT u,u||'@review.invalid','{}','{}' FROM aw,LATERAL (VALUES (admin_id),(recruiter_id)) v(u);
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT u,u||'@review.invalid',n,r::app_role,org,true FROM aw,LATERAL (VALUES (admin_id,'Workflow administrator','owner'),(recruiter_id,'Riley Recruiter','recruiter')) v(u,n,r);
INSERT INTO auth.sessions(id,user_id) SELECT admin_session,admin_id FROM aw UNION ALL SELECT recruiter_session,recruiter_id FROM aw;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT u,f,org FROM aw,LATERAL (VALUES (admin_id,fac),(admin_id,fac_closed),(admin_id,fac_unassigned),(recruiter_id,fac),(recruiter_id,fac_closed)) v(u,f);
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,gender,status)
 SELECT r,f,org,'Test Resident',n,'prefer_not_to_say'::gender,'pending_admission'::resident_status FROM aw,LATERAL (VALUES (res_a,fac,'Alpha'),(res_b,fac_closed,'Bravo')) v(r,f,n);

CREATE FUNCTION pg_temp.aw_login(who uuid,sess uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'session_id',sess,'role','authenticated','auth_claim_version',p.auth_claim_version,'organization_id',p.organization_id,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM public.user_profiles p WHERE p.id=who;
END $$;
CREATE TEMP TABLE aw_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON aw_results TO authenticated; GRANT SELECT,UPDATE ON aw TO authenticated;

-- The owner captures a lead at each facility.
SELECT pg_temp.aw_login(admin_id,admin_session) FROM aw;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f aw%ROWTYPE; a jsonb; b jsonb; c jsonb; BEGIN
 SELECT * INTO STRICT f FROM aw;
 a:=public.referral_episode_capture('workflow:capture:a',public.referral_episode_initial_revision(),
  jsonb_build_object('facility_id',f.fac,'first_name','Avery','last_name','Workflow','receipt_precision','unknown'));
 b:=public.referral_episode_capture('workflow:capture:b',public.referral_episode_initial_revision(),
  jsonb_build_object('facility_id',f.fac_closed,'first_name','Blake','last_name','Workflow','receipt_precision','unknown'));
 c:=public.referral_episode_capture('workflow:capture:c',public.referral_episode_initial_revision(),
  jsonb_build_object('facility_id',f.fac_unassigned,'first_name','Casey','last_name','Unassigned','receipt_precision','unknown'));
 UPDATE aw SET lead_a=(a->>'episode_id')::uuid, lead_b=(b->>'episode_id')::uuid, lead_c=(c->>'episode_id')::uuid;
END $$;
RESET ROLE;

-- Each lead's admission, with every kind of admission note.
INSERT INTO public.admission_cases(id,resident_id,organization_id,facility_id,referral_lead_id,status,target_move_in_date,notes,physician_orders_summary)
 SELECT case_a,res_a,org,fac,lead_a,'pending_clearance'::admission_case_status,current_date+10,'CLINICAL-NOTE reason for admission','CLINICAL-ORDERS metformin 500mg' FROM aw
 UNION ALL SELECT case_b,res_b,org,fac_closed,lead_b,'pending_clearance'::admission_case_status,current_date+10,NULL,NULL FROM aw;
INSERT INTO public.admission_case_rate_terms(admission_case_id,accommodation_type,quoted_base_rate_cents,quoted_care_surcharge_cents,notes)
 SELECT case_a,'private'::admission_accommodation_quote,400000,55500,'Family asked about a second-floor room.' FROM aw
 UNION ALL SELECT case_b,'private'::admission_accommodation_quote,400000,0,'Switch-off facility rate note.' FROM aw;
INSERT INTO public.admission_document_checklist_items(organization_id,facility_id,admission_case_id,document_type,notes,waived_reason)
 SELECT org,fac,case_a,d::admission_document_type,n,w FROM aw,(VALUES
  ('admission_agreement','Daughter signs Tuesday.',NULL),
  ('insurance_financial_cards',NULL,'Private pay; no card.'),
  ('catheter_care','CLINICAL-CATHETER foley since June',NULL),
  ('form_1823','CLINICAL-1823 checklist note',NULL),
  ('medication_list','CLINICAL-MEDS list pending',NULL)) v(d,n,w)
 ON CONFLICT (admission_case_id,document_type) WHERE deleted_at IS NULL DO UPDATE SET notes=EXCLUDED.notes,waived_reason=EXCLUDED.waived_reason;
INSERT INTO public.form_1823_records(organization_id,facility_id,resident_id,admission_case_id,status,medical_history,allergies)
 SELECT org,fac,res_a,case_a,'received','{"diagnoses":"CLINICAL-1823 history"}'::jsonb,ARRAY['CLINICAL-ALLERGY penicillin'] FROM aw;
INSERT INTO public.workflow_events(organization_id,facility_id,referral_lead_id,admission_case_id,resident_id,event_type,source_module,payload_json)
 SELECT org,fac,lead_a,case_a,res_a,e::workflow_event_type,'admissions',p::jsonb FROM aw,(VALUES
  ('referral_admission_started','{"status":"pending_clearance"}'),
  ('admission_move_in_blocked','{"blocked_by":["quoted rate terms","Form 1823"]}'),
  ('form_1823_received','{"status":"received","exam_date":"2026-09-01","expiration_date":"2026-12-01"}'),
  ('admission_status_changed','{"from_status":"pending_clearance","to_status":"bed_reserved"}'),
  ('admission_case_updated','{"fields":["physician_orders_summary"]}')) v(e,p)
 UNION ALL SELECT org,fac_closed,lead_b,case_b,res_b,'admission_status_changed'::workflow_event_type,'admissions','{"from_status":"pending_clearance","to_status":"bed_reserved"}'::jsonb FROM aw;
-- The switch is off at one facility.
INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
 SELECT org,fac_closed,'stand_up.thursday_admission_workflow_to_recruiters','false'::jsonb,current_date-1,'Probe: workflow hidden from recruiters' FROM aw;

-- The recruiter and the owner read the report.
SELECT pg_temp.aw_login(recruiter_id,recruiter_session) FROM aw;
SET LOCAL ROLE authenticated;
INSERT INTO aw_results SELECT 'recruiter',public.stand_up_command('report',jsonb_build_object('meeting_day','thursday')) FROM aw;
RESET ROLE;
SELECT pg_temp.aw_login(admin_id,admin_session) FROM aw;
SET LOCAL ROLE authenticated;
INSERT INTO aw_results SELECT 'owner',public.stand_up_command('report',jsonb_build_object('meeting_day','thursday')) FROM aw;
RESET ROLE;

DO $$ DECLARE r jsonb; f jsonb; closed jsonb; t jsonb; BEGIN
 SELECT value INTO r FROM aw_results WHERE name='recruiter';
 -- Scope: only the recruiter's assigned facilities.
 IF jsonb_array_length(r->'facilities')<>2 OR r::text LIKE '%Casey%' OR r::text LIKE '%not assigned%' THEN RAISE EXCEPTION 'Recruiter scope wrong: %',r->'facilities'; END IF;
 SELECT x INTO f FROM jsonb_array_elements(r->'facilities') x WHERE x->>'facility_name'='Workflow facility';
 SELECT x INTO closed FROM jsonb_array_elements(r->'facilities') x WHERE x->>'facility_name'='Workflow facility, switch off';
 t:=f->'potential_residents'->0->'timeline';
 -- Ruling 3: the bridge is on the report, counts only.
 IF f->'bridge'->>'state' IS NULL OR f->'bridge'->>'facility_id'<>(SELECT fac::text FROM aw) THEN RAISE EXCEPTION 'The report must carry the census bridge: %',f->'bridge'; END IF;
 -- Ruling 4: the non-clinical workflow reaches the recruiter.
 IF (f->>'admission_workflow_shown')::boolean IS NOT TRUE OR (f->>'admission_notes_shown')::boolean THEN RAISE EXCEPTION 'Recruiter switches wrong: %',f; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(t) x WHERE x->>'kind'='admission_step')<>4 THEN RAISE EXCEPTION 'Admission steps missing or extra: %',t; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t) x WHERE x->>'kind'='admission_step' AND x->>'method'='admission_status_changed' AND x->>'with'='pending_clearance' AND x->>'status'='bed_reserved')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t) x WHERE x->>'kind'='admission_step' AND x->>'method'='admission_move_in_blocked' AND x->>'text'='quoted rate terms, Form 1823')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t) x WHERE x->>'kind'='rate_note' AND x->>'text'='Family asked about a second-floor room.' AND x->>'status'='private')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t) x WHERE x->>'kind'='checklist_note' AND x->>'status'='admission_agreement' AND x->>'text'='Daughter signs Tuesday.')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t) x WHERE x->>'kind'='checklist_note' AND x->>'status'='insurance_financial_cards' AND x->>'text'='Waived: Private pay; no card.' AND x->>'method'='waived')
 THEN RAISE EXCEPTION 'The non-clinical workflow did not reach the recruiter: %',t; END IF;
 -- Never clinical: not the admission notes, orders, Form 1823 content or dates, clinical checklist documents, or the care surcharge.
 IF r::text ~ 'CLINICAL-|metformin|penicillin|catheter_care|medication_list|55500|exam_date|2026-12-01|physician_orders_summary' THEN
  RAISE EXCEPTION 'Clinical admission content reached a recruiter: %',t; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(t) x WHERE x->>'kind'='checklist_note' AND x->>'status'='form_1823') THEN RAISE EXCEPTION 'A Form 1823 checklist note reached a recruiter'; END IF;
 -- The facility switch hides the workflow from recruiters there.
 IF (closed->>'admission_workflow_shown')::boolean OR closed::text LIKE '%Switch-off facility rate note%'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(closed->'potential_residents'->0->'timeline') x WHERE x->>'kind' IN ('admission_step','rate_note','checklist_note')) THEN
  RAISE EXCEPTION 'The switch did not hide the workflow: %',closed; END IF;

 -- The owner sees the workflow everywhere and the admission notes; still never orders, Form 1823 content or clinical checklist notes.
 SELECT value INTO r FROM aw_results WHERE name='owner';
 SELECT x INTO f FROM jsonb_array_elements(r->'facilities') x WHERE x->>'facility_name'='Workflow facility';
 t:=f->'potential_residents'->0->'timeline';
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t) x WHERE x->>'kind'='admission_note' AND x->>'text'='CLINICAL-NOTE reason for admission') THEN RAISE EXCEPTION 'The owner lost the admission notes: %',t; END IF;
 IF r::text ~ 'metformin|penicillin|CLINICAL-CATHETER|CLINICAL-1823|CLINICAL-MEDS' THEN RAISE EXCEPTION 'Clinical admission content is never on the report'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'facilities') x WHERE x->>'facility_name'='Workflow facility, switch off' AND (x->>'admission_workflow_shown')::boolean) THEN
  RAISE EXCEPTION 'The recruiter switch must not hide the workflow from the owner'; END IF;
END $$;

-- Row-level access for recruiters is not widened by this change.
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('admission_cases','admission_case_rate_terms','admission_document_checklist_items','form_1823_records','workflow_events')
     AND (qual ~ 'recruiter' OR with_check ~ 'recruiter') AND qual !~ 'IS DISTINCT FROM|<>|NOT IN') > 0 THEN
  RAISE EXCEPTION 'A recruiter row policy was added to an admission table';
 END IF;
END $$;
ROLLBACK;
