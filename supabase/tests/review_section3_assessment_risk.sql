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
GRANT INSERT,UPDATE ON assessments TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record; newer uuid:='ffffffff-ffff-4fff-8fff-fffffffffff0'; older uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 INSERT INTO assessments(id,resident_id,facility_id,organization_id,assessment_type,assessment_date,total_score,assessed_by)
 VALUES(newer,f.resident,f.facility,f.org,'morse_fall',current_date-1,65,f.actor);
 IF (SELECT fall_risk_level FROM residents WHERE id=f.resident)<>'high' THEN RAISE EXCEPTION 'Latest Morse assessment did not atomically set current risk'; END IF;
 INSERT INTO assessments(id,resident_id,facility_id,organization_id,assessment_type,assessment_date,total_score,assessed_by)
 VALUES(older,f.resident,f.facility,f.org,'morse_fall',current_date-10,0,f.actor);
 IF (SELECT fall_risk_level FROM residents WHERE id=f.resident)<>'high' THEN RAISE EXCEPTION 'Historical Morse assessment overwrote current risk'; END IF;
 UPDATE residents SET fall_risk_level='standard' WHERE id=f.resident;
 UPDATE assessments SET total_score=5 WHERE id=older;
 IF (SELECT fall_risk_level FROM residents WHERE id=f.resident)<>'standard' THEN RAISE EXCEPTION 'Historical correction overwrote manual risk'; END IF;
 UPDATE assessments SET notes='Additional history' WHERE id=newer;
 IF (SELECT fall_risk_level FROM residents WHERE id=f.resident)<>'standard' THEN RAISE EXCEPTION 'Note edit overwrote manual risk'; END IF;
 BEGIN
  UPDATE assessments SET assessment_date=current_date-20 WHERE id=newer;
  RAISE EXCEPTION 'Current assessment date demotion accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'This date correction would replace the current risk source%' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE assessments SET created_at=created_at+interval '1 day' WHERE id=newer;
  RAISE EXCEPTION 'Creation precedence rewrite accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Preserve assessment identity and creation time' THEN RAISE; END IF;
 END;
 UPDATE assessments SET total_score=10 WHERE id=newer;
 IF (SELECT fall_risk_level FROM residents WHERE id=f.resident)<>'low' THEN RAISE EXCEPTION 'Latest score correction failed'; END IF;
 INSERT INTO assessments(resident_id,facility_id,organization_id,assessment_type,assessment_date,total_score,assessed_by)
 VALUES(f.resident,f.facility,f.org,'morse_fall',current_date,50,f.actor);
 IF (SELECT fall_risk_level FROM residents WHERE id=f.resident)<>'high' THEN RAISE EXCEPTION 'New current assessment failed'; END IF;
 IF (SELECT count(*) FROM assessments WHERE resident_id=f.resident)<>3 THEN RAISE EXCEPTION 'Assessment history was lost'; END IF;
 RAISE NOTICE 'PASS: current and historical score ordering, corrections, manual risk and history';
END $$;
DO $$
DECLARE f record; first_id uuid:='00000000-0000-4000-8000-000000000001'; last_id uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff';
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 INSERT INTO assessments(id,resident_id,facility_id,organization_id,assessment_type,assessment_date,total_score,assessed_by,created_at)
 VALUES(last_id,f.resident2,f.facility,f.org,'morse_fall',current_date,60,f.actor,now());
 INSERT INTO assessments(id,resident_id,facility_id,organization_id,assessment_type,assessment_date,total_score,assessed_by,created_at)
 VALUES(first_id,f.resident2,f.facility,f.org,'morse_fall',current_date,10,f.actor,now());
 IF (SELECT fall_risk_level FROM residents WHERE id=f.resident2)<>'high' THEN RAISE EXCEPTION 'Equal-date/created UUID tie followed insertion order'; END IF;
 INSERT INTO assessments(resident_id,facility_id,organization_id,assessment_type,assessment_date,total_score,assessed_by,created_at)
 VALUES(f.resident2,f.facility,f.org,'morse_fall',current_date,30,f.actor,now()+interval '1 second') RETURNING id INTO first_id;
 IF (SELECT fall_risk_level FROM residents WHERE id=f.resident2)<>'standard' THEN RAISE EXCEPTION 'Creation tie-break ignored'; END IF;
 BEGIN
  UPDATE assessments SET deleted_at=now() WHERE id=first_id;
  RAISE EXCEPTION 'Authenticated assessment deletion unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT fall_risk_level FROM residents WHERE id=f.resident2)<>'standard' THEN RAISE EXCEPTION 'Removing assessment silently changed current risk'; END IF;
 RAISE NOTICE 'PASS: deterministic same-day ties and no inferred deletion fallback';
END $$;
RESET ROLE;
DO $$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 UPDATE assessments SET deleted_at=now() WHERE id=(SELECT id FROM assessments WHERE resident_id=f.resident2 ORDER BY assessment_date DESC,created_at DESC,id DESC LIMIT 1);
 IF (SELECT fall_risk_level FROM residents WHERE id=f.resident2)<>'standard' THEN RAISE EXCEPTION 'Service undo silently changed current risk'; END IF;
 RAISE NOTICE 'PASS: service undo preserves current risk without inventing fallback';
END $$;
CREATE FUNCTION pg_temp.fail_assessment_risk_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'injected current risk failure'; END $$;
CREATE TRIGGER review_fail_assessment_risk BEFORE UPDATE ON residents FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_assessment_risk_write();
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record; failed_id uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO f FROM clinical_fixture;
 BEGIN
  INSERT INTO assessments(id,resident_id,facility_id,organization_id,assessment_type,assessment_date,total_score,assessed_by,created_at)
  VALUES(failed_id,f.resident,f.facility,f.org,'morse_fall',current_date,0,f.actor,now()+interval '1 day');
  RAISE EXCEPTION 'Current risk write failure was ignored';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'injected current risk failure' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM assessments WHERE id=failed_id) THEN RAISE EXCEPTION 'Assessment survived failed risk update'; END IF;
 RAISE NOTICE 'PASS: assessment and risk roll back together';
END $$;
RESET ROLE;
ROLLBACK;
