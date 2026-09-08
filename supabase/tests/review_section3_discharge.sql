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

CREATE TEMP TABLE discharge_bed_fixture AS
 SELECT gen_random_uuid() bed_id,r.id room_id,f.facility,f.org,f.resident FROM clinical_fixture f JOIN rooms r ON r.facility_id=f.facility AND r.deleted_at IS NULL LIMIT 1;
INSERT INTO beds(id,room_id,facility_id,organization_id,bed_label,status,current_resident_id)
 SELECT bed_id,room_id,facility,org,'Discharge fixture','occupied',resident FROM discharge_bed_fixture;
UPDATE residents SET bed_id=(SELECT bed_id FROM discharge_bed_fixture) WHERE id=(SELECT resident FROM clinical_fixture);
-- Verify the clinical role that cannot directly manage the bed inventory.
UPDATE user_profiles SET app_role='nurse' WHERE id=(SELECT actor FROM clinical_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM clinical_fixture f JOIN user_profiles p ON p.id=f.actor;
GRANT SELECT ON clinical_fixture,discharge_bed_fixture TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record; b record;
BEGIN
 SELECT * INTO f FROM clinical_fixture; SELECT * INTO b FROM discharge_bed_fixture;
 UPDATE residents SET status='discharged',discharge_date=current_date,bed_id=NULL,updated_by=f.actor WHERE id=f.resident;
 IF NOT EXISTS(SELECT 1 FROM beds WHERE id=b.bed_id AND status='available' AND current_resident_id IS NULL) THEN RAISE EXCEPTION 'Official discharge did not release the occupied bed'; END IF;
 UPDATE residents SET status='discharged',discharge_date=current_date,bed_id=NULL,updated_by=f.actor WHERE id=f.resident;
 BEGIN
  UPDATE residents SET bed_id=b.bed_id WHERE id=f.resident;
  RAISE EXCEPTION 'Terminal resident acquired a bed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'A discharged resident cannot be assigned a bed' THEN RAISE; END IF;
 END;
 RAISE NOTICE 'PASS: atomic release, repeat discharge and terminal bed protection';
END $$;
RESET ROLE;
-- A mismatched occupant must leave both sides untouched.
UPDATE residents SET status='active',bed_id=(SELECT bed_id FROM discharge_bed_fixture) WHERE id=(SELECT resident FROM clinical_fixture);
UPDATE beds SET status='occupied',current_resident_id=(SELECT resident2 FROM clinical_fixture) WHERE id=(SELECT bed_id FROM discharge_bed_fixture);
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 BEGIN
  UPDATE residents SET status='discharged',bed_id=NULL WHERE id=f.resident;
  RAISE EXCEPTION 'Mismatched bed discharge accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'The resident bed assignment does not match current occupancy; reconcile it before discharge' THEN RAISE; END IF;
 END;
 IF NOT EXISTS(SELECT 1 FROM residents WHERE id=f.resident AND status='active' AND bed_id IS NOT NULL) THEN RAISE EXCEPTION 'Failed discharge changed resident'; END IF;
 IF NOT EXISTS(SELECT 1 FROM beds WHERE id=(SELECT bed_id FROM discharge_bed_fixture) AND current_resident_id=f.resident2) THEN RAISE EXCEPTION 'Failed discharge changed other occupant'; END IF;
 RAISE NOTICE 'PASS: mismatched occupant rolls back discharge';
END $$;
RESET ROLE;
DO $$
DECLARE f record; b record; extra uuid:=gen_random_uuid(); other_facility uuid;
BEGIN
 SELECT * INTO f FROM clinical_fixture; SELECT * INTO b FROM discharge_bed_fixture;
 UPDATE beds SET current_resident_id=f.resident WHERE id=b.bed_id;
 INSERT INTO beds(id,room_id,facility_id,organization_id,bed_label,status,current_resident_id)
 VALUES(extra,b.room_id,f.facility,f.org,'Extra fixture','occupied',f.resident);
 BEGIN
  UPDATE residents SET status='discharged',bed_id=NULL WHERE id=f.resident;
  RAISE EXCEPTION 'Extra occupancy accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'The resident bed assignment does not match current occupancy; reconcile it before discharge' THEN RAISE; END IF;
 END;
 UPDATE beds SET current_resident_id=NULL WHERE id=extra;
 SELECT id INTO STRICT other_facility FROM facilities WHERE id<>f.facility AND deleted_at IS NULL LIMIT 1;
 UPDATE beds SET facility_id=other_facility WHERE id=b.bed_id;
 BEGIN
  UPDATE residents SET status='discharged',bed_id=NULL WHERE id=f.resident;
  RAISE EXCEPTION 'Cross-facility bed accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'The resident bed assignment does not match current occupancy; reconcile it before discharge' THEN RAISE; END IF;
 END;
 IF NOT EXISTS(SELECT 1 FROM residents WHERE id=f.resident AND status='active' AND bed_id=b.bed_id) THEN RAISE EXCEPTION 'Scope mismatch changed resident'; END IF;
 UPDATE beds SET facility_id=f.facility WHERE id=b.bed_id;
 RAISE NOTICE 'PASS: extra occupancy and cross-facility bed reject without partial discharge';
END $$;
DO $$
DECLARE f record; b record; preserved bed_status; reservation uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO f FROM clinical_fixture; SELECT * INTO b FROM discharge_bed_fixture;
 FOREACH preserved IN ARRAY ARRAY['maintenance','offline','hold']::bed_status[] LOOP
  UPDATE residents SET status='active',bed_id=b.bed_id WHERE id=f.resident;
  UPDATE beds SET status=preserved,current_resident_id=f.resident,is_temporarily_blocked=true,blocked_reason='Fixture block' WHERE id=b.bed_id;
  UPDATE residents SET status='discharged',bed_id=NULL WHERE id=f.resident;
  IF NOT EXISTS(SELECT 1 FROM beds WHERE id=b.bed_id AND status=preserved AND current_resident_id IS NULL AND is_temporarily_blocked AND blocked_reason='Fixture block') THEN RAISE EXCEPTION 'Discharge removed a bed block'; END IF;
 END LOOP;
 INSERT INTO admission_cases(id,organization_id,facility_id,resident_id,status) VALUES(reservation,f.org,f.facility,f.resident2,'draft');
 UPDATE residents SET status='active',bed_id=b.bed_id WHERE id=f.resident;
 UPDATE beds SET status='occupied',current_resident_id=f.resident,reserved_for_admission_case_id=reservation WHERE id=b.bed_id;
 UPDATE residents SET status='deceased',bed_id=NULL WHERE id=f.resident;
 IF NOT EXISTS(SELECT 1 FROM beds WHERE id=b.bed_id AND status='hold' AND current_resident_id IS NULL AND reserved_for_admission_case_id=reservation AND is_temporarily_blocked) THEN RAISE EXCEPTION 'Discharge removed a reservation'; END IF;
 RAISE NOTICE 'PASS: maintenance, offline, hold, temporary block and reservation preserved';
 UPDATE residents SET status='active',bed_id=b.bed_id WHERE id=f.resident;
 UPDATE beds SET status='occupied',current_resident_id=f.resident WHERE id=b.bed_id;
END $$;
CREATE FUNCTION pg_temp.fail_discharge_bed_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected bed failure'; END $$;
CREATE TRIGGER review_fail_discharge_bed BEFORE UPDATE ON beds FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_discharge_bed_write();
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 BEGIN
  UPDATE residents SET status='discharged',bed_id=NULL WHERE id=f.resident;
  RAISE EXCEPTION 'Bed failure did not roll back discharge';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected bed failure' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM residents WHERE id=f.resident AND status='active' AND bed_id IS NOT NULL) THEN RAISE EXCEPTION 'Resident survived failed bed transaction'; END IF;
 IF NOT EXISTS(SELECT 1 FROM beds WHERE id=(SELECT bed_id FROM discharge_bed_fixture) AND current_resident_id=f.resident) THEN RAISE EXCEPTION 'Bed changed on failed discharge'; END IF;
 RAISE NOTICE 'PASS: nurse discharge rolls back atomically on bed failure';
END $$;
RESET ROLE;
ROLLBACK;
