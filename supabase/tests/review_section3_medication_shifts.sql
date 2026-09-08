-- Local disposable replay only: every clinical fixture and auth adaptation rolls back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT UPDATE ON residents TO authenticated;
GRANT INSERT,UPDATE ON daily_logs,resident_medications,care_plans,care_plan_items,emar_records,med_passes,shift_tape_events TO authenticated;
CREATE TEMP TABLE clinical_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() actor_session,gen_random_uuid() witness,gen_random_uuid() resident,gen_random_uuid() resident2,gen_random_uuid() med,gen_random_uuid() shift_id,gen_random_uuid() pass_id,gen_random_uuid() task_id,gen_random_uuid() checklist_id,gen_random_uuid() ticket_id,f.id facility,f.organization_id org FROM facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Clinical reviewer"}'::jsonb FROM clinical_fixture
 UNION ALL SELECT witness,witness||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Clinical witness"}'::jsonb FROM clinical_fixture;
INSERT INTO user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor,actor||'@review.invalid','Clinical reviewer','owner'::app_role,org,true FROM clinical_fixture
 UNION ALL SELECT witness,witness||'@review.invalid','Clinical witness','nurse'::app_role,org,true FROM clinical_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM clinical_fixture UNION ALL SELECT witness,facility,org FROM clinical_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM clinical_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,
  'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
  'role','authenticated','app_role','owner','organization_id',f.org,
  'app_metadata',jsonb_build_object('app_role','owner','organization_id',f.org))::text,true)
FROM clinical_fixture f JOIN public.user_profiles p ON p.id=f.actor;
INSERT INTO residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender)
 SELECT resident,facility,org,'Clinical','Fixture','1940-01-01'::date,'female'::gender FROM clinical_fixture
 UNION ALL SELECT resident2,facility,org,'Clinical','Second','1940-01-01'::date,'female'::gender FROM clinical_fixture;

UPDATE residents SET status='active' WHERE id IN(SELECT resident FROM clinical_fixture UNION ALL SELECT resident2 FROM clinical_fixture);
ALTER TABLE clinical_fixture ADD COLUMN operator_session uuid DEFAULT gen_random_uuid();
UPDATE user_profiles SET app_role='med_tech' WHERE id=(SELECT witness FROM clinical_fixture);
INSERT INTO auth.sessions(id,user_id) SELECT operator_session,witness FROM clinical_fixture;
INSERT INTO staff(user_id,organization_id,facility_id,first_name,last_name,staff_role,hire_date)
 SELECT witness,org,facility,'Medication','Operator','lpn',current_date FROM clinical_fixture;
INSERT INTO resident_medications(id,resident_id,facility_id,organization_id,medication_name,strength,route,frequency,scheduled_times,instructions,prescriber_name,start_date,order_date,controlled_schedule,status)
 SELECT med,resident,facility,org,'Fixture scheduled medicine','10 mg','oral','daily',ARRAY[date_trunc('minute',now() AT TIME ZONE 'America/New_York')::time],'Per fixture order','Fixture physician',current_date-30,current_date-30,'non_controlled','active' FROM clinical_fixture;
GRANT SELECT ON clinical_fixture TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record; result uuid;
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(list_medication_shift_staff(f.facility)) t WHERE t->>'id'=f.witness::text) THEN RAISE EXCEPTION 'Eligible medication operator not listed'; END IF;
 result:=create_med_tech_shift(f.shift_id,f.facility,f.witness,now()-interval '1 hour',now()+interval '7 hours',ARRAY[f.resident]);
 IF result<>create_med_tech_shift(f.shift_id,f.facility,f.witness,now()-interval '1 hour',now()+interval '7 hours',ARRAY[f.resident]) THEN RAISE EXCEPTION 'Create replay changed identity'; END IF;
 IF (SELECT count(*) FROM med_tech_shifts WHERE id=f.shift_id)<>1 OR (SELECT count(*) FROM med_tech_shift_residents WHERE shift_id=f.shift_id)<>1 THEN RAISE EXCEPTION 'Create replay duplicated assignment'; END IF;
 BEGIN
  PERFORM create_med_tech_shift(f.shift_id,f.facility,f.witness,now()-interval '1 hour',now()+interval '7 hours',ARRAY[f.resident2]);
  RAISE EXCEPTION 'Changed request payload accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN PERFORM start_med_tech_shift(f.shift_id); RAISE EXCEPTION 'Manager started another operator shift'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS: eligible staff, atomic create, exact replay and wrong-operator denial';
END $$;
RESET ROLE;
DO $$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 UPDATE residents SET status='discharged' WHERE id=f.resident;
 UPDATE staff SET employment_status='terminated' WHERE user_id=f.witness;
 IF create_med_tech_shift(f.shift_id,f.facility,f.witness,now()-interval '1 hour',now()+interval '7 hours',ARRAY[f.resident])<>f.shift_id THEN RAISE EXCEPTION 'Exact saved request not recovered after eligibility change'; END IF;
 UPDATE residents SET status='active' WHERE id=f.resident;
 UPDATE staff SET employment_status='active' WHERE user_id=f.witness;
 RAISE NOTICE 'PASS: existing exact request recoverable after mutable eligibility changes';
END $$;
UPDATE resident_medications SET frequency='other' WHERE id=(SELECT med FROM clinical_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.witness,'session_id',f.operator_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM clinical_fixture f JOIN user_profiles p ON p.id=f.witness;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 BEGIN UPDATE med_tech_shifts SET status='active',clocked_in_at=now() WHERE id=f.shift_id; RAISE EXCEPTION 'Direct activation bypassed producer'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM start_med_tech_shift(f.shift_id); RAISE EXCEPTION 'Unspecified cadence generated doses';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'This medication has an unspecified cadence%' THEN RAISE; END IF; END;
 IF (SELECT status FROM med_tech_shifts WHERE id=f.shift_id)<>'scheduled' OR EXISTS(SELECT 1 FROM med_passes WHERE shift_id=f.shift_id) THEN RAISE EXCEPTION 'Failed production left partial active shift or passes'; END IF;
 RAISE NOTICE 'PASS: unknown cadence rejected with no partial activation';
END $$;
RESET ROLE;
UPDATE resident_medications SET frequency='daily' WHERE id=(SELECT med FROM clinical_fixture);
CREATE FUNCTION pg_temp.fail_medication_start_tape() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected medication start tape failure'; END $$;
CREATE TRIGGER review_fail_medication_start_tape BEFORE INSERT ON shift_tape_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_medication_start_tape();
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 BEGIN PERFORM start_med_tech_shift(f.shift_id); RAISE EXCEPTION 'Tape failure ignored'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected medication start tape failure' THEN RAISE; END IF; END;
 IF (SELECT status FROM med_tech_shifts WHERE id=f.shift_id)<>'scheduled' OR EXISTS(SELECT 1 FROM med_passes WHERE shift_id=f.shift_id) THEN RAISE EXCEPTION 'Tape failure left partial production'; END IF;
 RAISE NOTICE 'PASS: generated passes and shift activation roll back on tape failure';
END $$;
RESET ROLE;
DROP TRIGGER review_fail_medication_start_tape ON shift_tape_events;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record; receipt uuid;
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 PERFORM start_med_tech_shift(f.shift_id);
 PERFORM start_med_tech_shift(f.shift_id);
 IF NOT EXISTS(SELECT 1 FROM med_tech_shifts WHERE id=f.shift_id AND status='active' AND clocked_in_at IS NOT NULL) THEN RAISE EXCEPTION 'Shift was not activated'; END IF;
 IF (SELECT count(*) FROM med_passes WHERE shift_id=f.shift_id)<>1 THEN RAISE EXCEPTION 'Start/refresh did not produce exactly one pass'; END IF;
 IF (SELECT count(*) FROM shift_tape_events WHERE shift_id=f.shift_id AND event_type='shift_started')<>1 THEN RAISE EXCEPTION 'Start replay duplicated tape'; END IF;
 IF EXISTS(SELECT 1 FROM emar_records WHERE resident_medication_id=f.med) THEN RAISE EXCEPTION 'Starting a shift fabricated medication administration'; END IF;
 BEGIN UPDATE med_tech_shifts SET shift_start=shift_start-interval '1 hour' WHERE id=f.shift_id; RAISE EXCEPTION 'Operator changed assigned window'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE med_passes SET scheduled_time=scheduled_time+interval '1 minute' WHERE shift_id=f.shift_id; RAISE EXCEPTION 'Operator changed dose schedule'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE med_passes SET status='given' WHERE shift_id=f.shift_id; RAISE EXCEPTION 'Pass completed without eMAR'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO med_passes(organization_id,facility_id,shift_id,resident_id,resident_medication_id,scheduled_time,administered_by) SELECT organization_id,facility_id,shift_id,resident_id,resident_medication_id,scheduled_time,administered_by FROM med_passes WHERE shift_id=f.shift_id; RAISE EXCEPTION 'Operator fabricated pass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS: generated schedule, assignment window and eMAR evidence protected from direct writes';
 SELECT id INTO receipt FROM med_passes WHERE shift_id=f.shift_id;
 BEGIN
  INSERT INTO emar_records(resident_id,resident_medication_id,facility_id,organization_id,scheduled_time,actual_time,status,administered_by,is_prn,med_pass_id)
  SELECT resident_id,resident_medication_id,facility_id,organization_id,scheduled_time+interval '1 day',now(),'held',f.witness,false,id FROM med_passes WHERE id=receipt;
  RAISE EXCEPTION 'Another occurrence linked to this pass';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM emar_records WHERE med_pass_id=receipt) THEN RAISE EXCEPTION 'Wrong-dose linkage left an administration record'; END IF;
 RAISE NOTICE 'PASS: eMAR cannot substitute another scheduled occurrence';
 PERFORM complete_med_pass_review(receipt,'given','Observed synthetic dose',true);
 PERFORM start_med_tech_shift(f.shift_id);
 IF (SELECT count(*) FROM med_passes WHERE shift_id=f.shift_id)<>1 OR (SELECT count(*) FROM emar_records WHERE resident_medication_id=f.med)<>1 THEN RAISE EXCEPTION 'Documented dose duplicated'; END IF;
 RAISE NOTICE 'PASS: operational start, idempotent queue and real existing completion command';
END $$;
RESET ROLE;
UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT witness FROM clinical_fixture) AND facility_id=(SELECT facility FROM clinical_fixture);
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 BEGIN PERFORM start_med_tech_shift(f.shift_id); RAISE EXCEPTION 'Revoked operator refreshed queue'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS: current facility revocation denies refresh';
END $$;
RESET ROLE;
DO $$
DECLARE slots timestamptz[];
BEGIN
 SELECT array_agg(t ORDER BY t) INTO slots FROM haven.medication_shift_slots('2026-11-01 00:00-04','2026-11-01 08:00-05','America/New_York','daily','2026-10-01',NULL,ARRAY['01:30'::time]) t;
 IF slots IS DISTINCT FROM ARRAY['2026-11-01 05:30+00'::timestamptz] THEN RAISE EXCEPTION 'Repeated clock time differs from caregiver canonical occurrence'; END IF;
 SELECT array_agg(t ORDER BY t) INTO slots FROM haven.medication_shift_slots('2026-09-08 23:00-04','2026-09-09 07:00-04','America/New_York','daily','2026-09-01',NULL,ARRAY['23:00'::time,'00:00'::time,'07:00'::time]) t;
 IF slots IS DISTINCT FROM ARRAY['2026-09-09 03:00+00'::timestamptz,'2026-09-09 04:00+00'::timestamptz] THEN RAISE EXCEPTION 'Overnight or exclusive end boundary failed'; END IF;
 IF EXISTS(SELECT 1 FROM haven.medication_shift_slots('2026-09-08 00:00-04','2026-09-09 00:00-04','America/New_York','weekly','2026-09-02',NULL,ARRAY['08:00'::time])) THEN RAISE EXCEPTION 'Weekly cadence invented a dose'; END IF;
 IF EXISTS(SELECT 1 FROM haven.medication_shift_slots('2026-02-28 00:00-05','2026-03-01 00:00-05','America/New_York','monthly','2026-01-31',NULL,ARRAY['08:00'::time])) THEN RAISE EXCEPTION 'Monthly cadence invented a replacement date'; END IF;
 IF EXISTS(SELECT 1 FROM haven.medication_shift_slots('2026-09-08 00:00-04','2026-09-09 00:00-04','America/New_York','prn','2026-09-01',NULL,ARRAY['08:00'::time])) THEN RAISE EXCEPTION 'PRN doses fabricated'; END IF;
 BEGIN PERFORM haven.medication_shift_slots('2026-03-08 00:00-05','2026-03-08 08:00-04','America/New_York','daily','2026-03-01',NULL,ARRAY['02:30'::time]); RAISE EXCEPTION 'Nonexistent wall time accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'A prescribed time does not exist%' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: DST, overnight, exclusive end, weekly, monthly and PRN boundaries';
END $$;
ROLLBACK;
