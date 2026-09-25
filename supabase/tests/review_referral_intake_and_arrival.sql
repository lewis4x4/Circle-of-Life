-- COL-333 (migrations 537-540): the referral-to-arrival matrix. Intake is one
-- replay-safe transaction locked on the referral; an arrival needs an
-- administrator's approval of the current readiness; nothing else records a
-- move-in; a reversal compensates everything with review notes; return and
-- transfer keep the referral's link; the receiving team acknowledges through the
-- handoff board. Fails before migration 537.
-- Native scratch-only probe; every fixture rolls back. Synthetic data only.
BEGIN;
SET LOCAL client_min_messages=warning;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'role','') $$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated,service_role;

CREATE TEMP TABLE ia AS SELECT gen_random_uuid() org,gen_random_uuid() ent,gen_random_uuid() fac,gen_random_uuid() fac_b,
 gen_random_uuid() room,gen_random_uuid() room_b,gen_random_uuid() bed1,gen_random_uuid() bed2,gen_random_uuid() bed_b,
 gen_random_uuid() owner_id,gen_random_uuid() admin_id,gen_random_uuid() admin_session,gen_random_uuid() admin2_id,gen_random_uuid() manager_id,
 gen_random_uuid() medtech_id,gen_random_uuid() recruiter_id,gen_random_uuid() outsider_id,
 gen_random_uuid() lead1,gen_random_uuid() lead2,gen_random_uuid() lead3,gen_random_uuid() lead_lost,gen_random_uuid() lead_b,
 (now() AT TIME ZONE 'America/New_York')::date today;
GRANT SELECT ON ia TO authenticated,service_role;
INSERT INTO organizations(id,name) SELECT org,'Intake review' FROM ia;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Intake entity' FROM ia;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone)
 SELECT fac,ent,org,'Intake A','1 Way','Town','00000',10,'America/New_York' FROM ia
 UNION ALL SELECT fac_b,ent,org,'Intake B','2 Way','Town','00000',10,'America/New_York' FROM ia;
INSERT INTO rooms(id,facility_id,organization_id,room_number) SELECT room,fac,org,'101' FROM ia UNION ALL SELECT room_b,fac_b,org,'201' FROM ia;
INSERT INTO beds(id,room_id,facility_id,organization_id,bed_label,status)
 SELECT bed1,room,fac,org,'A','available'::bed_status FROM ia UNION ALL SELECT bed2,room,fac,org,'B','available' FROM ia
 UNION ALL SELECT bed_b,room_b,fac_b,org,'A','available' FROM ia;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT u,u||'@intake.invalid','{}','{}' FROM ia,LATERAL (VALUES (owner_id),(admin_id),(admin2_id),(manager_id),(medtech_id),(recruiter_id),(outsider_id)) v(u);
INSERT INTO user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT u,u||'@intake.invalid',n,r::app_role,org,true FROM ia,LATERAL (VALUES (owner_id,'Intake owner','owner'),(admin_id,'Intake admin','facility_admin'),
  (admin2_id,'Second admin','facility_admin'),(manager_id,'Intake manager','manager'),(medtech_id,'Intake med tech','med_tech'),
  (recruiter_id,'Intake recruiter','recruiter'),(outsider_id,'Other building admin','facility_admin')) v(u,n,r)
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT admin_session,admin_id FROM ia;
INSERT INTO user_facility_access(user_id,facility_id,organization_id)
 SELECT u,fac,org FROM ia,LATERAL (VALUES (admin_id),(admin2_id),(manager_id),(medtech_id),(recruiter_id)) v(u)
 UNION ALL SELECT outsider_id,fac_b,org FROM ia UNION ALL SELECT admin_id,fac_b,org FROM ia;
INSERT INTO referral_leads(id,organization_id,facility_id,first_name,last_name,date_of_birth,status)
 SELECT lead1,org,fac,'Synthetic','Intakeone','1941-02-03'::date,'tour_completed'::referral_lead_status FROM ia
 UNION ALL SELECT lead2,org,fac,'Synthetic','Intaketwo','1942-02-03'::date,'contacted' FROM ia
 UNION ALL SELECT lead3,org,fac,'Synthetic','Intakethree',NULL,'new' FROM ia
 UNION ALL SELECT lead_b,org,fac_b,'Synthetic','Intakeother',NULL,'new' FROM ia;
INSERT INTO referral_closure_reasons(organization_id,code,label,closed_by_party,is_active) SELECT org,'chose_elsewhere','Chose elsewhere','prospect',true FROM ia;
INSERT INTO referral_leads(id,organization_id,facility_id,first_name,last_name,status,closed_at,closed_by_party,closure_reason_id)
 SELECT lead_lost,org,fac,'Synthetic','Intakelost','lost',now()-interval '2 days','prospect',(SELECT id FROM referral_closure_reasons WHERE organization_id=ia.org) FROM ia;

CREATE FUNCTION pg_temp.ia_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;
CREATE FUNCTION pg_temp.ia_ok(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'Intake and arrival: %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.ia_intake(actor uuid,req uuid,lead uuid,fac uuid,intent text,target date,notes text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT admission_intake_start(actor,jsonb_strip_nulls(jsonb_build_object('request_id',req,'facility_id',fac,'referral_lead_id',lead,'intent',intent,
  'target_move_in_date',target,'notes',notes)))
$$;
CREATE FUNCTION pg_temp.ia_fp(c uuid) RETURNS text LANGUAGE sql AS $$ SELECT haven.admission_arrival_readiness(c)->>'fingerprint' $$;
CREATE TEMP TABLE ia_r(name text PRIMARY KEY,value jsonb);
GRANT ALL ON ia_r TO authenticated;
CREATE TEMP TABLE ia_req AS SELECT gen_random_uuid() r1,gen_random_uuid() r2,gen_random_uuid() d1,gen_random_uuid() s1,gen_random_uuid() f1,gen_random_uuid() f2,
 gen_random_uuid() a1,gen_random_uuid() a2,gen_random_uuid() rev1;

-- ===========================================================================
-- A. Intake
-- ===========================================================================
-- Grant posture: service route only.
SELECT pg_temp.ia_ok(NOT has_function_privilege('authenticated','public.admission_intake_start(uuid,jsonb)','EXECUTE')
 AND has_function_privilege('service_role','public.admission_intake_start(uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.admission_arrival_approve(uuid,uuid,text,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.admission_arrival_reverse(uuid,uuid,text,uuid)','EXECUTE')
 AND NOT has_table_privilege('authenticated','public.admission_intake_receipts','SELECT'),'grant boundary');
-- Recruiters do not start intakes; a lead in another facility is refused, never re-scoped; a closed lead is refused.
SELECT pg_temp.ia_fail($q$SELECT pg_temp.ia_intake(recruiter_id,gen_random_uuid(),lead1,fac,'submit',today+7) FROM ia$q$,'no longer have access');
SELECT pg_temp.ia_fail($q$SELECT pg_temp.ia_intake(admin_id,gen_random_uuid(),lead1,fac_b,'submit',today+7) FROM ia$q$,'not found in facility');
SELECT pg_temp.ia_fail($q$SELECT pg_temp.ia_intake(outsider_id,gen_random_uuid(),lead_b,fac,'submit',today+7) FROM ia$q$,'not found in facility');
SELECT pg_temp.ia_fail($q$SELECT pg_temp.ia_intake(admin_id,gen_random_uuid(),lead_lost,fac,'submit',today+7) FROM ia$q$,'This referral is closed');

-- Two users / two tabs start the same referral: one resident, one case.
INSERT INTO ia_r SELECT 'r1',pg_temp.ia_intake(admin_id,r1,lead1,fac,'submit',today+7,'Daughter visiting Friday') FROM ia,ia_req;
INSERT INTO ia_r SELECT 'r2',pg_temp.ia_intake(manager_id,r2,lead1,fac,'submit',today+9) FROM ia,ia_req;
DO $$ DECLARE a jsonb:=(SELECT value FROM ia_r WHERE name='r1'); b jsonb:=(SELECT value FROM ia_r WHERE name='r2'); f record; BEGIN
 SELECT * INTO f FROM ia;
 PERFORM pg_temp.ia_ok(a->>'outcome'='started' AND b->>'outcome'='already_started' AND a->>'admission_case_id'=b->>'admission_case_id'
  AND a->>'resident_id'=b->>'resident_id','second start must return the first case: '||a::text||' '||b::text);
 PERFORM pg_temp.ia_ok((SELECT count(*) FROM residents WHERE last_name='Intakeone')=1,'one resident per referral');
 PERFORM pg_temp.ia_ok((SELECT count(*) FROM admission_cases WHERE referral_lead_id=f.lead1)=1,'one case per referral');
 PERFORM pg_temp.ia_ok((SELECT gender IS NULL AND status='inquiry' AND date_of_birth='1941-02-03' FROM residents WHERE id=(a->>'resident_id')::uuid),
  'unknown gender must stay null on the inquiry resident');
 PERFORM pg_temp.ia_ok((SELECT status='application_pending' FROM referral_leads WHERE id=f.lead1),'submitting links the referral as application_pending');
 PERFORM pg_temp.ia_ok((SELECT count(*)=1 FROM referral_episode_events WHERE referral_lead_id=f.lead1 AND request_key='intake:'||(a->>'admission_case_id')),'one intake event');
 PERFORM pg_temp.ia_ok((SELECT converted_at IS NULL AND converted_resident_id IS NULL FROM referral_leads WHERE id=f.lead1),'intake is not conversion');
 PERFORM pg_temp.ia_ok((SELECT target_move_in_date=f.today+7 AND notes='Daughter visiting Friday' FROM admission_cases WHERE id=(a->>'admission_case_id')::uuid),
  'the second start must not change the first case');
END $$;
-- Lost response: the same request returns the same result and writes nothing.
INSERT INTO ia_r SELECT 'r1_replay',pg_temp.ia_intake(admin_id,r1,lead1,fac,'submit',today+7,'Daughter visiting Friday') FROM ia,ia_req;
SELECT pg_temp.ia_ok((SELECT (value->>'replayed')::boolean AND value->>'admission_case_id'=(SELECT value->>'admission_case_id' FROM ia_r WHERE name='r1') FROM ia_r WHERE name='r1_replay')
 AND (SELECT count(*) FROM admission_intake_receipts WHERE referral_lead_id=(SELECT lead1 FROM ia))=2,'lost-response replay');
-- The same key with a changed request is refused.
SELECT pg_temp.ia_fail($q$SELECT pg_temp.ia_intake(admin_id,r1,lead1,fac,'submit',today+7,'Changed notes') FROM ia,ia_req$q$,'Idempotency key payload differs');

-- Draft, then submit, then a retried submit.
INSERT INTO ia_r SELECT 'd1',pg_temp.ia_intake(admin_id,d1,lead2,fac,'draft',NULL) FROM ia,ia_req;
SELECT pg_temp.ia_ok((SELECT value->>'outcome'='started_draft' AND value->>'admission_case_status'='draft' FROM ia_r WHERE name='d1')
 AND (SELECT status='contacted' FROM referral_leads WHERE id=(SELECT lead2 FROM ia)),'a draft intake leaves the referral where it was');
SELECT pg_temp.ia_fail($q$SELECT pg_temp.ia_intake(admin_id,gen_random_uuid(),lead2,fac,'submit',NULL) FROM ia$q$,'target move-in date');
INSERT INTO ia_r SELECT 's1',pg_temp.ia_intake(admin_id,s1,lead2,fac,'submit',today+3) FROM ia,ia_req;
INSERT INTO ia_r SELECT 's1_retry',pg_temp.ia_intake(admin_id,s1,lead2,fac,'submit',today+3) FROM ia,ia_req;
SELECT pg_temp.ia_ok((SELECT value->>'outcome'='submitted_draft' AND value->>'admission_case_id'=(SELECT value->>'admission_case_id' FROM ia_r WHERE name='d1') FROM ia_r WHERE name='s1')
 AND (SELECT (value->>'replayed')::boolean FROM ia_r WHERE name='s1_retry')
 AND (SELECT status='application_pending' FROM referral_leads WHERE id=(SELECT lead2 FROM ia))
 AND (SELECT count(*)=1 FROM residents WHERE last_name='Intaketwo'),'draft-to-submit retry');

-- A failure after the resident and case are written rolls all of it back; the
-- same request then succeeds (a failed request is not a receipt).
CREATE FUNCTION pg_temp.ia_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure after the case'; END $$;
CREATE TRIGGER ia_boom BEFORE INSERT ON referral_episode_events FOR EACH ROW EXECUTE FUNCTION pg_temp.ia_boom();
SELECT pg_temp.ia_fail($q$SELECT pg_temp.ia_intake(admin_id,f1,lead3,fac,'submit',today+5) FROM ia,ia_req$q$,'synthetic failure after the case');
SELECT pg_temp.ia_ok((SELECT count(*)=0 FROM residents WHERE last_name='Intakethree') AND (SELECT count(*)=0 FROM admission_cases WHERE referral_lead_id=(SELECT lead3 FROM ia))
 AND (SELECT count(*)=0 FROM admission_intake_receipts WHERE request_id=(SELECT f1 FROM ia_req)) AND (SELECT status='new' FROM referral_leads WHERE id=(SELECT lead3 FROM ia)),
 'a failed intake left a resident, case, receipt or referral change behind');
DROP TRIGGER ia_boom ON referral_episode_events;
SELECT pg_temp.ia_ok((pg_temp.ia_intake(admin_id,f1,lead3,fac,'submit',today+5)->>'outcome')='started','the failed request must succeed on retry') FROM ia,ia_req;
-- A past target date is refused before anything is written.
SELECT pg_temp.ia_fail($q$SELECT pg_temp.ia_intake(admin_id,gen_random_uuid(),lead_b,fac_b,'submit',today-1) FROM ia$q$,'today or later');
-- Actor revocation: the manager loses the building, then cannot start an intake there.
UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT manager_id FROM ia) AND facility_id=(SELECT fac FROM ia);
SELECT pg_temp.ia_fail($q$SELECT pg_temp.ia_intake(manager_id,gen_random_uuid(),lead1,fac,'submit',today+7) FROM ia$q$,'no longer have access');

-- ===========================================================================
-- B. Approval and arrival
-- ===========================================================================
CREATE TEMP TABLE ia_case AS SELECT (value->>'admission_case_id')::uuid c,(value->>'resident_id')::uuid r FROM ia_r WHERE name='r1';
UPDATE residents SET gender='female' WHERE id=(SELECT r FROM ia_case);
UPDATE admission_cases SET financial_clearance_at=now(),physician_orders_received_at=now(),bed_id=(SELECT bed1 FROM ia) WHERE id=(SELECT c FROM ia_case);
INSERT INTO form_1823_records(admission_case_id,resident_id,facility_id,organization_id,status,physician_name,exam_date,expiration_date)
 SELECT c,r,fac,org,'received','Synthetic physician',today-1,today+365 FROM ia,ia_case;
INSERT INTO admission_document_checklist_items(admission_case_id,organization_id,facility_id,document_type,required,received_at,notes)
 SELECT c,org,fac,'form_1823',true,now(),'Synthetic verified document' FROM ia,ia_case
 ON CONFLICT(admission_case_id,document_type) WHERE deleted_at IS NULL DO UPDATE SET received_at=excluded.received_at,notes=excluded.notes;
INSERT INTO admission_document_checklist_items(admission_case_id,organization_id,facility_id,document_type,required)
 SELECT c,org,fac,'admission_agreement',true FROM ia,ia_case ON CONFLICT DO NOTHING;
INSERT INTO admission_case_rate_terms(admission_case_id,accommodation_type,quoted_base_rate_cents,created_by) SELECT c,'private',10000,admin_id FROM ia,ia_case;
SELECT pg_temp.ia_ok((haven.admission_arrival_readiness(c)->>'ready')::boolean,'fixture must be ready: '||haven.admission_arrival_readiness(c)::text) FROM ia_case;

-- Nothing but the arrival records a move-in: the legacy status update, a direct
-- write of the arrival, and a case created already moved in are all refused.
SELECT pg_temp.ia_fail($q$UPDATE admission_cases SET status='move_in' WHERE id=(SELECT c FROM ia_case)$q$,'Move-in is recorded by confirming the actual arrival');
SELECT pg_temp.ia_fail($q$UPDATE admission_cases SET actual_arrival_at=now() WHERE id=(SELECT c FROM ia_case)$q$,'Arrival is recorded only by confirming it');
SELECT pg_temp.ia_fail($q$INSERT INTO admission_cases(organization_id,facility_id,resident_id,status) SELECT org,fac,r,'move_in' FROM ia,ia_case$q$,'Move-in is recorded');
-- No approval, no arrival.
SELECT pg_temp.ia_fail($q$SELECT confirm_admission_arrival_review(c,admin_id,today) FROM ia,ia_case$q$,'must approve the current readiness');
-- Only administrators approve, and only the readiness they reviewed.
SELECT pg_temp.ia_fail($q$SELECT admission_arrival_approve(c,medtech_id,pg_temp.ia_fp(c),gen_random_uuid()) FROM ia,ia_case$q$,'Only an administrator');
SELECT pg_temp.ia_fail($q$SELECT admission_arrival_approve(c,recruiter_id,pg_temp.ia_fp(c),gen_random_uuid()) FROM ia,ia_case$q$,'Only an administrator');
SELECT pg_temp.ia_fail($q$SELECT admission_arrival_approve(c,outsider_id,pg_temp.ia_fp(c),gen_random_uuid()) FROM ia,ia_case$q$,'Only an administrator');
SELECT pg_temp.ia_fail($q$SELECT admission_arrival_approve(c,admin_id,md5('stale'),gen_random_uuid()) FROM ia,ia_case$q$,'readiness changed since you reviewed it');
INSERT INTO ia_r SELECT 'a1',admission_arrival_approve(c,admin_id,pg_temp.ia_fp(c),a1) FROM ia,ia_case,ia_req;
INSERT INTO ia_r SELECT 'a1_replay',admission_arrival_approve(c,admin_id,pg_temp.ia_fp(c),a1) FROM ia,ia_case,ia_req;
SELECT pg_temp.ia_ok((SELECT (value->>'replayed')::boolean FROM ia_r WHERE name='a1_replay') AND (SELECT count(*)=1 FROM admission_arrival_approvals WHERE admission_case_id=(SELECT c FROM ia_case)),'approval replay');
SELECT pg_temp.ia_ok((haven.admission_arrival_approval_current(c)).id IS NOT NULL,'the approval is in force') FROM ia_case;
-- A material change voids it; the status says why.
UPDATE admission_cases SET target_move_in_date=target_move_in_date+1 WHERE id=(SELECT c FROM ia_case);
SELECT pg_temp.ia_ok((admission_arrival_status(c,admin_id)->>'approval_invalid_because')='readiness_changed' AND admission_arrival_status(c,admin_id)->'approval'='null'::jsonb,
 'a material change must void the approval: '||admission_arrival_status(c,admin_id)::text) FROM ia,ia_case;
SELECT pg_temp.ia_fail($q$SELECT confirm_admission_arrival_review(c,admin_id,today) FROM ia,ia_case$q$,'must approve the current readiness');
-- An approver who loses the building no longer counts.
SELECT admission_arrival_approve(c,admin2_id,pg_temp.ia_fp(c),gen_random_uuid()) FROM ia,ia_case;
UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT admin2_id FROM ia);
SELECT pg_temp.ia_ok((admission_arrival_status(c,admin_id)->>'approval_invalid_because')='approver_no_longer_authorized','a revoked approver must not count') FROM ia,ia_case;
-- The rule can narrow who approves; the approval then must come from an owner.
INSERT INTO operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
 SELECT org,fac,'admissions.arrival_approval_roles','["owner"]'::jsonb,today-1,'Probe: owners only' FROM ia;
SELECT pg_temp.ia_fail($q$SELECT admission_arrival_approve(c,admin_id,pg_temp.ia_fp(c),gen_random_uuid()) FROM ia,ia_case$q$,'Only an administrator');
SELECT admission_arrival_approve(c,owner_id,pg_temp.ia_fp(c),gen_random_uuid()) FROM ia,ia_case;
DELETE FROM operating_rules WHERE facility_id=(SELECT fac FROM ia) AND rule_key='admissions.arrival_approval_roles';
-- A recruiter can never confirm; a revoked med-tech cannot either.
SELECT pg_temp.ia_fail($q$SELECT confirm_admission_arrival_review(c,recruiter_id,today) FROM ia,ia_case$q$,'no longer have access to confirm');
UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT medtech_id FROM ia);
SELECT pg_temp.ia_fail($q$SELECT confirm_admission_arrival_review(c,medtech_id,today) FROM ia,ia_case$q$,'no longer have access to confirm');
-- Simultaneous arrival: the second confirmation returns the same resident and records nothing twice.
-- The arrival is given as yesterday's date only (a late entry inside the back-date window).
SELECT pg_temp.ia_ok(confirm_admission_arrival_review(c,admin_id,today-1)=r AND confirm_admission_arrival_review(c,admin_id,today-1)=r,'arrival and its replay') FROM ia,ia_case;
DO $$ DECLARE f record; k record; BEGIN
 SELECT * INTO f FROM ia; SELECT * INTO k FROM ia_case;
 PERFORM pg_temp.ia_ok((SELECT actual_arrival_precision='date' AND arrival_approval_id IS NOT NULL AND status='move_in' FROM admission_cases WHERE id=k.c),'date-only precision and the approval are kept');
 PERFORM pg_temp.ia_ok((SELECT status='converted' AND converted_resident_id=k.r FROM referral_leads WHERE id=f.lead1),'the arrival converts the referral');
 PERFORM pg_temp.ia_ok((SELECT count(*)=1 FROM referral_episode_events WHERE referral_lead_id=f.lead1 AND request_key LIKE 'arrival:%'),'one conversion event');
 PERFORM pg_temp.ia_ok((SELECT count(*)=1 FROM shift_handoff_notes WHERE source_kind='admission_arrival' AND resident_id=k.r AND priority='high'
   AND note LIKE '%Still outstanding: Admission Agreement, Care plan%' AND acknowledged_at IS NULL),'one receiving note naming what is outstanding: '||
   coalesce((SELECT string_agg(note,' | ') FROM shift_handoff_notes WHERE resident_id=k.r),'none'));
 PERFORM pg_temp.ia_ok((admission_arrival_status(k.c,f.admin_id)->'receiving'->>'acknowledged_at') IS NULL,'receiving not yet acknowledged');
 UPDATE shift_handoff_notes SET acknowledged_by=f.manager_id,acknowledged_at=now() WHERE source_kind='admission_arrival' AND resident_id=k.r;
 PERFORM pg_temp.ia_ok((admission_arrival_status(k.c,f.admin_id)->'receiving'->>'acknowledged_by_name')='Intake manager','the receiving acknowledgment is shown');
 PERFORM pg_temp.ia_ok(jsonb_array_length(admission_arrival_status(k.c,f.admin_id)->'outstanding')>=2,'outstanding commitments stay listed until done');
END $$;
-- The referral cannot be taken out of converted while the arrival stands.
SELECT pg_temp.ia_fail($q$UPDATE referral_leads SET status='application_pending' WHERE id=(SELECT lead1 FROM ia)$q$,'Reverse the arrival on the admission');

-- ===========================================================================
-- C. Reversal
-- ===========================================================================
SELECT pg_temp.ia_fail($q$SELECT admission_arrival_reverse(c,medtech_id,'Wrong resident',gen_random_uuid()) FROM ia,ia_case$q$,'Only an administrator');
SELECT pg_temp.ia_fail($q$SELECT admission_arrival_reverse(c,admin_id,'  ',gen_random_uuid()) FROM ia,ia_case$q$,'Say why');
INSERT INTO ia_r SELECT 'rev1',admission_arrival_reverse(c,admin_id,'Entered for the wrong day',rev1) FROM ia,ia_case,ia_req;
INSERT INTO ia_r SELECT 'rev1_replay',admission_arrival_reverse(c,admin_id,'Entered for the wrong day',rev1) FROM ia,ia_case,ia_req;
DO $$ DECLARE f record; k record; v jsonb; BEGIN
 SELECT * INTO f FROM ia; SELECT * INTO k FROM ia_case; SELECT value INTO v FROM ia_r WHERE name='rev1';
 PERFORM pg_temp.ia_ok((SELECT (value->>'replayed')::boolean FROM ia_r WHERE name='rev1_replay'),'reversal replay');
 PERFORM pg_temp.ia_ok((SELECT status='pending_admission' AND bed_id IS NULL FROM residents WHERE id=k.r),'the resident returns to pending admission');
 PERFORM pg_temp.ia_ok((SELECT status='hold' AND current_resident_id IS NULL AND reserved_for_admission_case_id=k.c FROM beds WHERE id=f.bed1),'the bed is held for the admission again');
 PERFORM pg_temp.ia_ok((SELECT status='bed_reserved' AND actual_arrival_at IS NULL AND arrival_approval_id IS NULL FROM admission_cases WHERE id=k.c),'the case returns to bed reserved');
 PERFORM pg_temp.ia_ok((SELECT status='application_pending' AND converted_resident_id IS NULL FROM referral_leads WHERE id=f.lead1),'the referral is compensated');
 PERFORM pg_temp.ia_ok((SELECT count(*)=1 FROM referral_episode_events WHERE referral_lead_id=f.lead1 AND request_key='arrival-reversal:'||(v->>'id')),'one compensating event');
 PERFORM pg_temp.ia_ok((SELECT count(*)=2 FROM shift_handoff_notes WHERE source_id=(v->>'id')::uuid AND category='follow_up' AND priority='high'),'census and finance review notes');
 PERFORM pg_temp.ia_ok((SELECT cardinality(voided_status_history_ids)>=1 FROM admission_arrival_reversals WHERE id=(v->>'id')::uuid)
   AND NOT EXISTS(SELECT 1 FROM resident_status_history WHERE resident_id=k.r AND deleted_at IS NULL AND status='active'),'the mistaken census interval is voided');
 PERFORM pg_temp.ia_ok((SELECT roster_census_count FROM stand_up_roster_census_as_of(f.org,f.fac,now()-interval '1 minute'))=0,'census from effective dates no longer counts the reversed arrival');
 PERFORM pg_temp.ia_ok((admission_arrival_status(k.c,f.admin_id)->'approval')='null'::jsonb
   AND (admission_arrival_status(k.c,f.admin_id)->>'approval_invalid_because')='superseded_by_reversal','the reversal voids the approval');
END $$;
SELECT pg_temp.ia_fail($q$SELECT confirm_admission_arrival_review(c,admin_id,today) FROM ia,ia_case$q$,'must approve the current readiness');
-- Approved again and confirmed again: a new conversion event and a new receiving note.
SELECT admission_arrival_approve(c,admin_id,pg_temp.ia_fp(c),gen_random_uuid()) FROM ia,ia_case;
-- The corrected arrival: two hours ago, with its time.
SELECT confirm_admission_arrival_review(c,admin_id,((now()-interval '2 hours') AT TIME ZONE 'America/New_York')::date,now()-interval '2 hours') FROM ia,ia_case;
SELECT pg_temp.ia_ok((SELECT actual_arrival_precision='instant' FROM admission_cases WHERE id=(SELECT c FROM ia_case)),'an arrival with a time is an instant');
SELECT pg_temp.ia_ok((SELECT status='converted' FROM referral_leads WHERE id=(SELECT lead1 FROM ia))
 AND (SELECT count(*)=1 FROM referral_episode_events WHERE referral_lead_id=(SELECT lead1 FROM ia) AND request_key='arrival:'||(SELECT c FROM ia_case)||':2')
 AND (SELECT count(*)=2 FROM shift_handoff_notes WHERE source_kind='admission_arrival' AND resident_id=(SELECT r FROM ia_case)),'confirmed again after the reversal');

-- ===========================================================================
-- D. Return and transfer keep the referral's link
-- ===========================================================================
CREATE FUNCTION pg_temp.ia_ready_case(p_resident uuid,p_fac uuid,p_bed uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE c uuid; f record; BEGIN
 SELECT * INTO f FROM ia;
 INSERT INTO admission_cases(organization_id,facility_id,resident_id,status,bed_id,financial_clearance_at,physician_orders_received_at,target_move_in_date)
  VALUES(f.org,p_fac,p_resident,'pending_clearance',p_bed,now(),now(),f.today) RETURNING id INTO c;
 INSERT INTO form_1823_records(admission_case_id,resident_id,facility_id,organization_id,status,physician_name,exam_date,expiration_date,updated_at)
  VALUES(c,p_resident,p_fac,f.org,'received','Synthetic physician',f.today-1,f.today+365,now()+interval '1 second');
 INSERT INTO admission_document_checklist_items(admission_case_id,organization_id,facility_id,document_type,required,received_at,notes)
  VALUES(c,f.org,p_fac,'form_1823',true,now(),'Synthetic verified document')
  ON CONFLICT(admission_case_id,document_type) WHERE deleted_at IS NULL DO UPDATE SET received_at=excluded.received_at,notes=excluded.notes;
 INSERT INTO admission_case_rate_terms(admission_case_id,accommodation_type,quoted_base_rate_cents,created_by) VALUES(c,'private',10000,f.admin_id);
 PERFORM admission_arrival_approve(c,f.admin_id,pg_temp.ia_fp(c),gen_random_uuid());
 RETURN c;
END $$;
-- Return: discharged, then admitted again to the same building under a new admission.
UPDATE residents SET status='discharged',discharge_date=((now()-interval '1 hour') AT TIME ZONE 'America/New_York')::date,discharge_reason='other',bed_id=NULL,status_effective_at=now()-interval '1 hour'
 WHERE id=(SELECT r FROM ia_case);
CREATE TEMP TABLE ia_return AS SELECT pg_temp.ia_ready_case(r,fac,bed2) c FROM ia,ia_case;
SELECT confirm_admission_arrival_review(c,admin_id,((now()-interval '50 minutes') AT TIME ZONE 'America/New_York')::date,now()-interval '50 minutes') FROM ia,ia_return;
SELECT pg_temp.ia_ok((SELECT status='converted' AND converted_resident_id=(SELECT r FROM ia_case) FROM referral_leads WHERE id=(SELECT lead1 FROM ia))
 AND (SELECT count(*)=1 FROM referral_episode_events WHERE referral_lead_id=(SELECT lead1 FROM ia) AND request_key='return:'||(SELECT c FROM ia_return)
   AND from_status='converted' AND to_status='converted'),'a return records its link and keeps the conversion');

-- Internal transfer: the same resident moves to another building under a new admission there.
UPDATE residents SET status='discharged',discharge_date=((now()-interval '30 minutes') AT TIME ZONE 'America/New_York')::date,discharge_reason='other',bed_id=NULL,status_effective_at=now()-interval '30 minutes'
 WHERE id=(SELECT r FROM ia_case);
UPDATE residents SET facility_id=(SELECT fac_b FROM ia) WHERE id=(SELECT r FROM ia_case);
CREATE TEMP TABLE ia_transfer AS SELECT pg_temp.ia_ready_case(r,fac_b,bed_b) c FROM ia,ia_case;
SELECT confirm_admission_arrival_review(c,admin_id,today) FROM ia,ia_transfer;
SELECT pg_temp.ia_ok((SELECT status='converted' AND facility_id=(SELECT fac FROM ia) FROM referral_leads WHERE id=(SELECT lead1 FROM ia))
 AND (SELECT count(*)=1 FROM referral_episode_events WHERE referral_lead_id=(SELECT lead1 FROM ia) AND request_key='transfer:'||(SELECT c FROM ia_transfer)
   AND details->>'arrival_facility_id'=(SELECT fac_b::text FROM ia)),'a transfer records its link and keeps the original referral');

-- ===========================================================================
-- E. Prior records for review, never rewritten
-- ===========================================================================
SET LOCAL session_replication_role=replica;
INSERT INTO referral_leads(organization_id,facility_id,first_name,last_name,status,converted_at,facility_consideration_id,episode_sequence,episode_revision,work_state,receipt_precision,preferred_contact)
 SELECT org,fac,'Synthetic','Legacyconverted','converted',now()-interval '30 days',l.facility_consideration_id,99,l.episode_revision,'closed',l.receipt_precision,l.preferred_contact
 FROM ia, referral_leads l WHERE l.id=ia.lead3;
INSERT INTO admission_cases(organization_id,facility_id,resident_id,status) SELECT org,fac,(SELECT id FROM residents WHERE last_name='Intakethree'),'move_in' FROM ia;
SET LOCAL session_replication_role=origin;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'session_id',f.admin_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',p.organization_id,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM ia f JOIN user_profiles p ON p.id=f.admin_id;
SET LOCAL ROLE authenticated;
INSERT INTO ia_r SELECT 'recon',referral_conversion_reconciliation(fac) FROM ia;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SELECT pg_temp.ia_ok((SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(value) x WHERE x->>'kind'='converted_without_arrival')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(value) x WHERE x->>'kind'='move_in_without_arrival')
 AND value::text !~* 'Synthetic|Legacyconverted' FROM ia_r WHERE name='recon'),'the reconciliation list: '||(SELECT value::text FROM ia_r WHERE name='recon'));
SELECT pg_temp.ia_ok((SELECT status='converted' FROM referral_leads WHERE last_name='Legacyconverted'),'reconciliation rewrote nothing');
ROLLBACK;
