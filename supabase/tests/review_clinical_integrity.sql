-- Local disposable replay only: every clinical fixture and auth adaptation rolls back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT UPDATE ON residents TO authenticated;
GRANT INSERT,UPDATE ON daily_logs,resident_medications,care_plans,care_plan_items,emar_records,med_passes,shift_tape_events TO authenticated;
CREATE TEMP TABLE clinical_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() witness,gen_random_uuid() resident,gen_random_uuid() resident2,gen_random_uuid() med,gen_random_uuid() shift_id,gen_random_uuid() pass_id,gen_random_uuid() task_id,gen_random_uuid() checklist_id,gen_random_uuid() ticket_id,f.id facility,f.organization_id org FROM facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Clinical reviewer"}'::jsonb FROM clinical_fixture
 UNION ALL SELECT witness,witness||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Clinical witness"}'::jsonb FROM clinical_fixture;
INSERT INTO user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor,actor||'@review.invalid','Clinical reviewer','owner'::app_role,org,true FROM clinical_fixture
 UNION ALL SELECT witness,witness||'@review.invalid','Clinical witness','nurse'::app_role,org,true FROM clinical_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM clinical_fixture UNION ALL SELECT witness,facility,org FROM clinical_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','app_role','owner','organization_id',org,'app_metadata',jsonb_build_object('app_role','owner','organization_id',org))::text,true) FROM clinical_fixture;
INSERT INTO residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender)
 SELECT resident,facility,org,'Clinical','Fixture','1940-01-01'::date,'female'::gender FROM clinical_fixture
 UNION ALL SELECT resident2,facility,org,'Clinical','Second','1940-01-01'::date,'female'::gender FROM clinical_fixture;

GRANT SELECT ON clinical_fixture TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; log_id uuid; BEGIN
 SELECT * INTO f FROM clinical_fixture;
 log_id:=append_caregiver_shift_note(f.resident,'First note');
 PERFORM append_caregiver_shift_note(f.resident,'Second note');
 IF (SELECT general_notes FROM daily_logs WHERE id=log_id) NOT LIKE '%First note%Second note%' THEN RAISE EXCEPTION 'Atomic note append lost prior text'; END IF;
 PERFORM record_caregiver_vitals(f.resident,'{"temperature":98.6,"blood_pressure_systolic":120,"blood_pressure_diastolic":80,"pulse":70}',now());
 PERFORM record_caregiver_vitals(f.resident,'{"pulse":75}',now());
 IF NOT EXISTS(SELECT 1 FROM daily_logs WHERE id=log_id AND temperature=98.6 AND blood_pressure_systolic=120 AND blood_pressure_diastolic=80 AND pulse=75) THEN RAISE EXCEPTION 'Partial vital entry erased measurements'; END IF;
 IF (SELECT count(*) FROM daily_vital_observations WHERE daily_log_id=log_id)<>2 THEN RAISE EXCEPTION 'Measurement history was overwritten'; END IF;
 BEGIN PERFORM record_caregiver_vitals(f.resident,'{}',now()); RAISE EXCEPTION 'Empty measurements accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Enter at least one measurement' THEN RAISE; END IF; END;
 BEGIN PERFORM record_caregiver_vitals(f.resident,'{"pulse":null}',now()); RAISE EXCEPTION 'Null measurement accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invalid measurement' THEN RAISE; END IF; END;
END $$;

DO $$ DECLARE f record; revision uuid:=gen_random_uuid(); order_data jsonb; plan_id uuid:=gen_random_uuid(); new_plan uuid:=gen_random_uuid(); BEGIN
 SELECT * INTO f FROM clinical_fixture;
 order_data:=jsonb_build_object('medication_name','Clinical fixture medication','strength','10 mg','route','oral','frequency','daily','scheduled_times',jsonb_build_array('08:00'),'instructions','One tablet per authorized order','prescriber_name','Fixture prescriber','start_date',current_date,'order_date',current_date,'controlled_schedule','non_controlled','form','tablet','end_date',current_date+10,'indication','Fixture indication','prn_effectiveness_check_minutes',45);
 PERFORM save_medication_order_review(f.med,f.resident,NULL,'save','Local fixture order',order_data);
 PERFORM save_medication_order_review(f.med,f.resident,NULL,'save','Local fixture order',order_data);
 IF (SELECT count(*) FROM resident_medications WHERE resident_id=f.resident)<>1 THEN RAISE EXCEPTION 'Medication retry duplicated order'; END IF;
 PERFORM save_medication_order_review(revision,f.resident,f.med,'save','Updated signed order',(order_data-'form'-'end_date'-'indication'-'prn_effectiveness_check_minutes')||'{"strength":"20 mg"}');
 IF NOT EXISTS(SELECT 1 FROM resident_medications WHERE id=revision AND end_date=current_date+10 AND form='tablet' AND indication='Fixture indication' AND prn_effectiveness_check_minutes=45) THEN RAISE EXCEPTION 'Medication revision erased clinical order fields'; END IF;
 IF NOT EXISTS(SELECT 1 FROM resident_medications WHERE id=f.med AND status='discontinued') OR NOT EXISTS(SELECT 1 FROM resident_medications WHERE id=revision AND previous_medication_id=f.med AND status='active') THEN RAISE EXCEPTION 'Medication revision did not preserve lineage'; END IF;
 PERFORM create_care_plan_revision_review(plan_id,f.resident,NULL,current_date,current_date+30,'Initial plan','[{"category":"bathing","title":"Bathing support","description":"Provide safe shower support","assistance_level":"supervision","frequency":"daily","goal":"Safe bathing","interventions":["Offer supervision"],"special_instructions":"Resident preference"}]');
 PERFORM create_care_plan_revision_review(plan_id,f.resident,NULL,current_date,current_date+30,'Initial plan','[{"category":"bathing","title":"Bathing support","description":"Provide safe shower support","assistance_level":"supervision","frequency":"daily","goal":"Safe bathing","interventions":["Offer supervision"],"special_instructions":"Resident preference"}]');
 UPDATE care_plans SET status='active',approved_by=f.actor,approved_at=now() WHERE id=plan_id;
 PERFORM create_care_plan_revision_review(new_plan,f.resident,plan_id,current_date,current_date+30,'Updated need','[{"category":"bathing","title":"Bathing support","description":"Provide safe shower support","assistance_level":"limited_assist","interventions":[]}]');
 IF (SELECT status FROM care_plans WHERE id=plan_id)<>'active' THEN RAISE EXCEPTION 'Draft revision retired active plan'; END IF;
 UPDATE care_plans SET status='active',approved_by=f.actor,approved_at=now() WHERE id=new_plan;
 IF (SELECT status FROM care_plans WHERE id=plan_id)<>'archived' THEN RAISE EXCEPTION 'Approved plan did not retire prior version'; END IF;
END $$;

RESET ROLE;
INSERT INTO med_tech_shifts(id,organization_id,facility_id,user_id,shift_start,shift_end,status)
 SELECT shift_id,org,facility,actor,now()-interval '1 hour',now()+interval '7 hours','active' FROM clinical_fixture;
INSERT INTO med_passes(id,organization_id,facility_id,shift_id,resident_id,resident_medication_id,scheduled_time,administered_by)
 SELECT pass_id,org,facility,shift_id,resident,(SELECT id FROM resident_medications WHERE previous_medication_id=f.med LIMIT 1),(current_date::text||' 08:00:00 America/New_York')::timestamptz,actor FROM clinical_fixture f;
CREATE FUNCTION pg_temp.fail_clinical_tape() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected tape failure'; END $$;
CREATE TRIGGER review_fail_clinical_tape BEFORE INSERT ON shift_tape_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_clinical_tape();
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM clinical_fixture;
 BEGIN PERFORM complete_med_pass_review(f.pass_id,'given','Observed actual administration',true); RAISE EXCEPTION 'Injected tape error did not fail'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected tape failure' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM emar_records WHERE med_pass_id=f.pass_id) OR (SELECT status FROM med_passes WHERE id=f.pass_id)<>'pending' THEN RAISE EXCEPTION 'Medication write survived receipt rollback'; END IF;
END $$;
DROP TRIGGER review_fail_clinical_tape ON shift_tape_events;
DO $$ DECLARE f record; receipt uuid; BEGIN
 SELECT * INTO f FROM clinical_fixture;
 receipt:=complete_med_pass_review(f.pass_id,'given','Observed actual administration',true);
 IF receipt<>complete_med_pass_review(f.pass_id,'given','Observed actual administration',true) OR (SELECT count(*) FROM emar_records WHERE med_pass_id=f.pass_id)<>1 THEN RAISE EXCEPTION 'Pass retry duplicated MAR'; END IF;
END $$;

INSERT INTO operation_task_instances(id,organization_id,facility_id,template_name,template_category,template_cadence_type,assigned_shift_date,assigned_to,requires_dual_sign)
 SELECT task_id,org,facility,'Clinical dual task','safety','daily',current_date,actor,true FROM clinical_fixture;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM clinical_fixture;
 IF complete_operation_task_review(f.task_id,f.actor,'owner','Performed task','{}')<>'awaiting_verification' THEN RAISE EXCEPTION 'Dual task falsely completed'; END IF;
 BEGIN PERFORM complete_operation_task_review(f.task_id,f.actor,'owner','Self verify','{}'); RAISE EXCEPTION 'Self verification accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'A different authorized staff member must verify this task' THEN RAISE; END IF; END;
 IF complete_operation_task_review(f.task_id,f.witness,'nurse','Verified task','{}')<>'completed' THEN RAISE EXCEPTION 'Independent verification failed'; END IF;
END $$;

INSERT INTO emergency_checklist_items(id,facility_id,organization_id,checklist_type,title,frequency_days,next_due_date)
 SELECT checklist_id,facility,org,'generator_test','Clinical fixture checklist',30,current_date FROM clinical_fixture;
INSERT INTO maintenance_tickets(id,facility_id,organization_id,submitted_by,asset_description,issue_description)
 SELECT ticket_id,facility,org,actor,'Clinical fixture asset','Fixture repair' FROM clinical_fixture;
DO $$ DECLARE f record; receipt uuid:=gen_random_uuid(); maintenance_id uuid:=gen_random_uuid(); payload jsonb; BEGIN
 SELECT * INTO f FROM clinical_fixture;
 PERFORM complete_emergency_checklist_review(receipt,f.checklist_id,ARRAY['Fixture staff'],'Recorded evidence');
 PERFORM complete_emergency_checklist_review(receipt,f.checklist_id,ARRAY['Fixture staff'],'Recorded evidence');
 IF (SELECT count(*) FROM emergency_checklist_completions WHERE checklist_item_id=f.checklist_id)<>1 OR NOT EXISTS(SELECT 1 FROM emergency_checklist_items WHERE id=f.checklist_id AND last_completed_at IS NOT NULL AND next_due_date>current_date) THEN RAISE EXCEPTION 'Checklist completion did not atomically advance due date'; END IF;
 payload:=jsonb_build_object('facility_id',f.facility,'organization_id',f.org,'task_type','fixture_repair','notes','Repair verified','related_ticket_id',f.ticket_id);
 PERFORM complete_maintenance_work_review(maintenance_id,payload,true);
 PERFORM complete_maintenance_work_review(maintenance_id,payload,true);
 IF (SELECT count(*) FROM maintenance_task_completions WHERE id=maintenance_id)<>1 OR NOT EXISTS(SELECT 1 FROM maintenance_tickets WHERE id=f.ticket_id AND status='completed' AND closed_at IS NOT NULL) THEN RAISE EXCEPTION 'Maintenance completion did not resolve ticket atomically'; END IF;
END $$;

DO $$ DECLARE f record; first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); outbreak uuid; BEGIN
 SELECT * INTO f FROM clinical_fixture;
 INSERT INTO infection_surveillance(id,resident_id,facility_id,organization_id,infection_type,onset_date,identified_by,symptoms) VALUES(first_id,f.resident,f.facility,f.org,'gi',current_date,f.actor,ARRAY['fixture symptom']),(second_id,f.resident2,f.facility,f.org,'gi',current_date,f.actor,ARRAY['fixture symptom']);
 PERFORM evaluate_infection_outbreak_atomic(first_id,f.actor,'gi',ARRAY['gi'],'[]');
 SELECT outbreak_id INTO outbreak FROM infection_surveillance WHERE id=first_id;
 PERFORM evaluate_infection_outbreak_atomic(first_id,f.actor,'gi',ARRAY['gi'],'[]');
 PERFORM evaluate_infection_outbreak_atomic(second_id,f.actor,'gi',ARRAY['gi'],'[]');
 IF outbreak IS NULL OR (SELECT total_cases FROM infection_outbreaks WHERE id=outbreak)<>(SELECT count(*) FROM infection_surveillance WHERE outbreak_id=outbreak AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Outbreak retries inflated case count'; END IF;
END $$;

-- Cross-surface collision: caregiver and cockpit must share one scheduled dose.
DO $$ DECLARE f record; med_id uuid; scheduled timestamptz; pending_id uuid:=gen_random_uuid(); pass2 uuid:=gen_random_uuid(); BEGIN
 SELECT * INTO f FROM clinical_fixture;
 SELECT id INTO med_id FROM resident_medications WHERE previous_medication_id=f.med LIMIT 1;
 scheduled:=((current_date-1)::text||' 08:00:00 America/New_York')::timestamptz;
 INSERT INTO emar_records(id,resident_id,resident_medication_id,facility_id,organization_id,scheduled_time,status) VALUES(pending_id,f.resident,med_id,f.facility,f.org,scheduled,'scheduled');
 IF record_caregiver_emar_review(gen_random_uuid(),med_id,scheduled,'given','Observed dose')<>pending_id THEN RAISE EXCEPTION 'Caregiver did not reuse scheduled MAR'; END IF;
 INSERT INTO med_passes(id,organization_id,facility_id,shift_id,resident_id,resident_medication_id,scheduled_time,administered_by) VALUES(pass2,f.org,f.facility,f.shift_id,f.resident,med_id,scheduled,f.actor);
 BEGIN PERFORM complete_med_pass_review(pass2,'given','Second surface',true); RAISE EXCEPTION 'Cross-surface duplicate accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'This scheduled dose has already been resolved. Refresh the queue' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM emar_records WHERE resident_medication_id=med_id AND scheduled_time=scheduled)<>1 THEN RAISE EXCEPTION 'Duplicate MAR row exists'; END IF;
 BEGIN PERFORM record_caregiver_emar_review(gen_random_uuid(),med_id,now(),'given','Invented schedule'); RAISE EXCEPTION 'Arbitrary slot accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Scheduled time must match the prescribed medication schedule' THEN RAISE; END IF; END;
 BEGIN PERFORM append_caregiver_shift_note(f.resident,NULL); RAISE EXCEPTION 'Null note accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'A signed-in author and note are required' THEN RAISE; END IF; END;
 BEGIN PERFORM create_care_plan_revision_review(gen_random_uuid(),f.resident,NULL,current_date,current_date+30,'Null plan',NULL); RAISE EXCEPTION 'Null plan items accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Effective date, review date and care needs are required' THEN RAISE; END IF; END;
 BEGIN INSERT INTO discharge_med_reconciliation(organization_id,facility_id,resident_id,status,pharmacist_reviewed_at,pharmacist_notes,med_snapshot_json) VALUES(f.org,f.facility,f.resident,'complete',now(),'External review evidence','{"medications":[],"no_medications_confirmed":true}'); RAISE EXCEPTION 'Null pharmacist NPI accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Pharmacist review evidence is required' THEN RAISE; END IF; END;
 IF has_table_privilege('authenticated','operation_task_instances','UPDATE') OR has_table_privilege('authenticated','operation_task_instances','INSERT') THEN RAISE EXCEPTION 'Client can forge operation verification'; END IF;
END $$;

DO $$ DECLARE f record; payload jsonb; receipt jsonb; template_id uuid:=gen_random_uuid(); result jsonb; BEGIN
 SELECT * INTO f FROM clinical_fixture;
 payload:=jsonb_build_object('create_request_id',gen_random_uuid(),'organization_id',f.org,'facility_id',f.facility,'resident_id',f.resident2,'status','draft','medicaid_pipeline_stage','prospect','created_by',f.actor,'updated_by',f.actor);
 receipt:=create_admission_case_review(payload);
 IF receipt->>'id' IS DISTINCT FROM create_admission_case_review(payload)->>'id' THEN RAISE EXCEPTION 'Admission request retry duplicated case'; END IF;
 BEGIN PERFORM create_admission_case_review(payload||jsonb_build_object('status','pending_clearance')); RAISE EXCEPTION 'Draft submission returned false success'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'An admission case already exists%' THEN RAISE; END IF; END;
 INSERT INTO operation_task_templates(id,organization_id,facility_id,name,description,category,cadence_type,assignee_role,created_by,updated_by) VALUES(template_id,f.org,f.facility,'Fixture template','Verified fixture','maintenance','monthly','maintenance',f.actor,f.actor);
 result:=publish_operation_template_review(template_id,jsonb_build_object('name','Fixture version two','created_by',f.actor,'updated_by',f.actor));
 IF (SELECT is_active FROM operation_task_templates WHERE id=template_id) OR (SELECT previous_version_id FROM operation_task_templates WHERE id=(result->>'id')::uuid)<>template_id THEN RAISE EXCEPTION 'Template publication did not retire prior version'; END IF;
END $$;

DO $$ DECLARE f record; admission uuid; fixture_bed uuid:=gen_random_uuid(); room uuid; BEGIN
 SELECT * INTO f FROM clinical_fixture;
 SELECT id INTO admission FROM admission_cases WHERE resident_id=f.resident2 AND create_request_id IS NOT NULL LIMIT 1;
 SELECT id INTO room FROM rooms WHERE facility_id=f.facility AND deleted_at IS NULL LIMIT 1;
 INSERT INTO beds(id,room_id,facility_id,organization_id,bed_label) VALUES(fixture_bed,room,f.facility,f.org,'Fixture '||fixture_bed);
 UPDATE admission_cases SET financial_clearance_at=now(),physician_orders_received_at=now(),bed_id=fixture_bed,status='bed_reserved',updated_by=f.actor WHERE id=admission;
 IF NOT EXISTS(SELECT 1 FROM beds b WHERE b.id=fixture_bed AND b.status='hold' AND b.reserved_for_admission_case_id=admission) THEN RAISE EXCEPTION 'Reservation did not hold the actual bed'; END IF;
 INSERT INTO form_1823_records(admission_case_id,resident_id,facility_id,organization_id,status,physician_name,exam_date,expiration_date,updated_at) VALUES(admission,f.resident2,f.facility,f.org,'received','Fixture physician',current_date,current_date+365,now()+interval '1 second');
 INSERT INTO admission_document_checklist_items(admission_case_id,organization_id,facility_id,document_type,required,received_at,notes) VALUES(admission,f.org,f.facility,'form_1823',true,now(),'Physical report verified') ON CONFLICT(admission_case_id,document_type) WHERE deleted_at IS NULL DO UPDATE SET received_at=excluded.received_at,notes=excluded.notes;
 INSERT INTO admission_case_rate_terms(admission_case_id,accommodation_type,quoted_base_rate_cents,created_by) VALUES(admission,'private',10000,f.actor);
 PERFORM confirm_admission_arrival_review(admission,f.actor,current_date);
 IF NOT EXISTS(SELECT 1 FROM residents WHERE id=f.resident2 AND status='active' AND residents.bed_id=fixture_bed) OR NOT EXISTS(SELECT 1 FROM beds b WHERE b.id=fixture_bed AND b.status='occupied' AND b.current_resident_id=f.resident2) THEN RAISE EXCEPTION 'Arrival did not atomically activate census and bed'; END IF;
END $$;

SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM clinical_fixture;
 BEGIN UPDATE emar_records SET status='scheduled' WHERE med_pass_id=f.pass_id; RAISE EXCEPTION 'Resolved dose reopened directly'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE emar_records SET deleted_at=now() WHERE med_pass_id=f.pass_id; RAISE EXCEPTION 'Resolved dose removed directly'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
