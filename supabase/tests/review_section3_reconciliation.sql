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

GRANT SELECT ON clinical_fixture TO authenticated;
GRANT INSERT, UPDATE ON discharge_med_reconciliation TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record; rec uuid:=gen_random_uuid(); field text; rejected boolean; before_row jsonb;
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 INSERT INTO discharge_med_reconciliation(id,organization_id,facility_id,resident_id,status,pharmacist_reviewed_at,pharmacist_npi,pharmacist_notes,med_snapshot_json)
 VALUES(rec,f.org,f.facility,f.resident,'complete',now(),'1234567890','Signed external report','{"medications":[],"no_medications_confirmed":true}');
 SELECT to_jsonb(d) INTO before_row FROM discharge_med_reconciliation d WHERE id=rec;
 FOREACH field IN ARRAY ARRAY['pharmacist_reviewed_at','pharmacist_npi','pharmacist_notes','med_snapshot_json'] LOOP
  rejected:=false;
  BEGIN
   EXECUTE format('UPDATE discharge_med_reconciliation SET %I=NULL WHERE id=$1',field) USING rec;
  EXCEPTION WHEN raise_exception THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Complete reconciliation accepted erased %',field; END IF;
  IF (SELECT to_jsonb(d) FROM discharge_med_reconciliation d WHERE id=rec) IS DISTINCT FROM before_row THEN RAISE EXCEPTION 'Rejected change modified evidence'; END IF;
  RAISE NOTICE 'PASS: complete reconciliation rejects erased %',field;
 END LOOP;
 UPDATE discharge_med_reconciliation SET nurse_reconciliation_notes='Additional transition context' WHERE id=rec;
 IF (SELECT status FROM discharge_med_reconciliation WHERE id=rec)<>'complete' THEN RAISE EXCEPTION 'Valid update lost complete state'; END IF;
 UPDATE discharge_med_reconciliation SET status='draft',pharmacist_notes=NULL WHERE id=rec;
 IF NOT EXISTS(SELECT 1 FROM discharge_med_reconciliation WHERE id=rec AND status='draft' AND pharmacist_notes IS NULL) THEN RAISE EXCEPTION 'Explicit reopen blocked'; END IF;
 RAISE NOTICE 'PASS: valid updates and explicit draft reopening remain supported';
END $$;
RESET ROLE;
ROLLBACK;
