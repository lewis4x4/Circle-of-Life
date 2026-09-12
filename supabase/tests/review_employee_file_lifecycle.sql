-- Disposable PostgreSQL replay only. All fixtures, session adaptation and grants roll back.
BEGIN;
-- Match the employee-file business guard even when the CI session date is already tomorrow.
CREATE FUNCTION pg_temp.employee_business_date() RETURNS date LANGUAGE sql STABLE AS $$
 SELECT (now() AT TIME ZONE 'America/New_York')::date
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
-- Supabase normally grants table SELECT; replay stubs omit its default privileges. RLS stays enabled.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE employee_fixture AS SELECT gen_random_uuid() admin,gen_random_uuid() worker,gen_random_uuid() employee,gen_random_uuid() admin_staff,gen_random_uuid() nurse,gen_random_uuid() nurse_session,gen_random_uuid() manager,gen_random_uuid() manager_session,
 gen_random_uuid() admin_session,gen_random_uuid() worker_session,gen_random_uuid() other_facility,gen_random_uuid() other_employee,f.id facility,f.organization_id org FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT admin,admin||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"File manager"}'::jsonb FROM employee_fixture
 UNION ALL SELECT worker,worker||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','caregiver'),'{"full_name":"File employee"}'::jsonb FROM employee_fixture
 UNION ALL SELECT nurse,nurse||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"File nurse"}'::jsonb FROM employee_fixture
 UNION ALL SELECT manager,manager||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','manager'),'{"full_name":"File supervisor"}'::jsonb FROM employee_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT admin,admin||'@review.invalid','File manager','owner'::public.app_role,org,true FROM employee_fixture
 UNION ALL SELECT worker,worker||'@review.invalid','File employee','caregiver'::public.app_role,org,true FROM employee_fixture
  UNION ALL SELECT nurse,nurse||'@review.invalid','File nurse','nurse'::public.app_role,org,true FROM employee_fixture
  UNION ALL SELECT manager,manager||'@review.invalid','File supervisor','manager'::public.app_role,org,true FROM employee_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT admin,facility,org FROM employee_fixture UNION ALL SELECT worker,facility,org FROM employee_fixture UNION ALL SELECT nurse,facility,org FROM employee_fixture UNION ALL SELECT manager,facility,org FROM employee_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT admin_session,admin FROM employee_fixture UNION ALL SELECT worker_session,worker FROM employee_fixture UNION ALL SELECT nurse_session,nurse FROM employee_fixture UNION ALL SELECT manager_session,manager FROM employee_fixture;
CREATE FUNCTION pg_temp.employee_actor(p_worker boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE f record; v_id uuid; v_session uuid; v_version integer; v_role text;
BEGIN SELECT * INTO f FROM employee_fixture; v_id:=CASE WHEN p_worker IS NULL THEN f.nurse WHEN p_worker THEN f.worker ELSE f.admin END; v_session:=CASE WHEN p_worker IS NULL THEN f.nurse_session WHEN p_worker THEN f.worker_session ELSE f.admin_session END;
 SELECT auth_claim_version,app_role::text INTO v_version,v_role FROM public.user_profiles WHERE id=v_id;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_id,'session_id',v_session,'role','authenticated','auth_claim_version',v_version,'app_role',v_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true);
END $$;
SELECT pg_temp.employee_actor(false);
INSERT INTO public.staff(id,organization_id,facility_id,user_id,first_name,last_name,staff_role,hire_date) SELECT employee,org,facility,worker,'File','Employee','resident_aide'::public.staff_role,pg_temp.employee_business_date()-100 FROM employee_fixture UNION ALL SELECT admin_staff,org,facility,admin,'File','Manager','administrator'::public.staff_role,pg_temp.employee_business_date()-100 FROM employee_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT x.other_facility,f.entity_id,x.org,'Unassigned employee probe','Test only','Test','00000',1 FROM employee_fixture x JOIN public.facilities f ON f.id=x.facility;
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date)
 SELECT other_employee,org,other_facility,'Other','Employee','resident_aide',pg_temp.employee_business_date()-100 FROM employee_fixture;
INSERT INTO public.staff_attendance_events(staff_id,facility_id,organization_id,event_type,occurred_at,reason,created_by,updated_by)
 SELECT other_employee,other_facility,org,'callout',now()-interval '1 hour','Unassigned facility probe',admin,admin FROM employee_fixture;
CREATE TEMP TABLE employee_receipts(name text PRIMARY KEY,value jsonb);
GRANT SELECT ON employee_fixture TO authenticated;
GRANT ALL ON employee_receipts TO authenticated;
CREATE FUNCTION pg_temp.employee_expect(p_sql text,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN IF position(p_message IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected rejection: %',p_message;
END $$;
SET LOCAL ROLE authenticated;
-- Minimal staff identity RPC supports a manager without granting the staff PII table.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.manager,'session_id',f.manager_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role','manager','organization_id',f.org)::text,true)
 FROM employee_fixture f JOIN public.user_profiles p ON p.id=f.manager;
DO $$ DECLARE projected jsonb; BEGIN
 IF EXISTS(SELECT 1 FROM public.staff WHERE id=(SELECT employee FROM employee_fixture)) THEN RAISE EXCEPTION 'Fixture manager unexpectedly has full staff-row access'; END IF;
 SELECT to_jsonb(x) INTO projected FROM public.haven_employee_file_staff((SELECT employee FROM employee_fixture)) x;
 IF projected IS NULL OR projected->>'first_name'<>'File' THEN RAISE EXCEPTION 'Scoped manager cannot resolve minimal employee identity'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(projected))<>9 OR projected ? 'hourly_rate' OR projected ? 'date_of_birth' OR projected ? 'ssn_last_four' THEN RAISE EXCEPTION 'Staff projection contains private columns'; END IF;
 IF EXISTS(SELECT 1 FROM public.haven_employee_file_staff(NULL)) THEN RAISE EXCEPTION 'Null staff lookup exposed manager roster'; END IF;
 IF EXISTS(SELECT 1 FROM public.haven_employee_file_staff(gen_random_uuid())) THEN RAISE EXCEPTION 'Unknown staff identity exposed'; END IF;
END $$;
-- Exact old staffing-console payload remains valid even without private staff SELECT.
INSERT INTO public.staff_attendance_events(staff_id,facility_id,organization_id,event_type,occurred_at,reason,created_by,updated_by)
 SELECT employee,facility,org,'callout',now()-interval '1 hour','Legacy compatibility probe',manager,manager FROM employee_fixture;
DO $$ DECLARE baseline jsonb; malicious jsonb; BEGIN
 SELECT to_jsonb(a) INTO baseline FROM public.staff_attendance_events a WHERE reason='Legacy compatibility probe' AND created_by=(SELECT manager FROM employee_fixture);
 IF baseline IS NULL OR baseline->>'review_status'<>'pending' THEN RAISE EXCEPTION 'Legacy insert did not remain pending'; END IF;
 FOR malicious IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  '{"review_status":"counted"}'::jsonb,'{"review_status":"excluded"}'::jsonb,
  '{"review_reason":"Preapproved"}'::jsonb,jsonb_build_object('reviewed_by',auth.uid()),jsonb_build_object('reviewed_at',now()),
  jsonb_build_object('staff_id',gen_random_uuid()),jsonb_build_object('organization_id',gen_random_uuid()),jsonb_build_object('facility_id',gen_random_uuid()),
  jsonb_build_object('created_by',(SELECT worker FROM employee_fixture)),jsonb_build_object('updated_by',(SELECT worker FROM employee_fixture)),
  jsonb_build_object('deleted_at',now()),jsonb_build_object('occurred_at',now()+interval '1 hour'),jsonb_build_object('shift_assignment_id',gen_random_uuid())
 )) LOOP
  PERFORM pg_temp.employee_expect(format('INSERT INTO public.staff_attendance_events SELECT (jsonb_populate_record(NULL::public.staff_attendance_events,%L::jsonb)).*',baseline||malicious||jsonb_build_object('id',gen_random_uuid())),'row-level security');
 END LOOP;
 PERFORM pg_temp.employee_expect(format('UPDATE public.staff_attendance_events SET review_status=''counted'' WHERE id=%L',baseline->>'id'),'permission denied');
 PERFORM pg_temp.employee_expect(format('DELETE FROM public.staff_attendance_events WHERE id=%L',baseline->>'id'),'permission denied');
END $$;
SELECT pg_temp.employee_actor(NULL);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.staff_attendance_events WHERE staff_id=(SELECT employee FROM employee_fixture) AND reason='Legacy compatibility probe') THEN RAISE EXCEPTION 'Nurse lost scoped attendance read'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_attendance_events WHERE staff_id=(SELECT other_employee FROM employee_fixture)) THEN RAISE EXCEPTION 'Nurse can read unassigned facility attendance'; END IF;
END $$;
SELECT pg_temp.employee_expect('INSERT INTO public.staff_attendance_events(staff_id,facility_id,organization_id,event_type,occurred_at,created_by,updated_by) SELECT employee,facility,org,''callout'',now(),nurse,nurse FROM employee_fixture','row-level security');
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''review_attendance'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('id',(SELECT id FROM public.staff_attendance_events WHERE reason='Legacy compatibility probe' AND staff_id=(SELECT employee FROM employee_fixture)),'review_status','counted','review_reason','Nurse attempted review')),'Independent manager required');
SELECT pg_temp.employee_actor(true);
SELECT pg_temp.employee_expect('INSERT INTO public.staff_attendance_events(staff_id,facility_id,organization_id,event_type,occurred_at,created_by,updated_by) SELECT employee,facility,org,''callout'',now(),worker,worker FROM employee_fixture','row-level security');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.haven_employee_file_staff((SELECT admin_staff FROM employee_fixture))) THEN RAISE EXCEPTION 'Caregiver can resolve nonself without medical grant'; END IF;
 IF (SELECT count(*) FROM public.haven_employee_file_staff(NULL))<>1 THEN RAISE EXCEPTION 'Self lookup must return only linked employee'; END IF;
END $$;
SELECT pg_temp.employee_actor(false);
SELECT public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'grant_medical',jsonb_build_object('user_id',(SELECT worker FROM employee_fixture)));
SELECT pg_temp.employee_actor(true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.staff WHERE id=(SELECT admin_staff FROM employee_fixture)) THEN RAISE EXCEPTION 'Medical grant broadened full staff-row RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.haven_employee_file_staff((SELECT admin_staff FROM employee_fixture))) THEN RAISE EXCEPTION 'Medical grantee cannot resolve minimal employee identity'; END IF;
 IF (SELECT count(*) FROM public.haven_employee_file_staff(NULL))<2 THEN RAISE EXCEPTION 'Reviewer listing omits explicit grant facility'; END IF;
END $$;
SELECT pg_temp.employee_actor(false);
SELECT public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'revoke_medical',jsonb_build_object('user_id',(SELECT worker FROM employee_fixture)));
SELECT pg_temp.employee_actor(true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.haven_employee_file_staff((SELECT admin_staff FROM employee_fixture))) THEN RAISE EXCEPTION 'Revoked medical grant retained nonself identity access'; END IF;
 IF (SELECT count(*) FROM public.haven_employee_file_staff(NULL))<>1 THEN RAISE EXCEPTION 'Revoked reviewer listing still exposes roster'; END IF;
END $$;
SELECT pg_temp.employee_actor(false);
-- Factual activity before clearance is retained with an unforgeable conservative snapshot.
INSERT INTO employee_receipts VALUES('uncleared_duty',public.haven_employee_file_command((SELECT employee FROM employee_fixture),'record_duty',jsonb_build_object('duty','medication','occurred_at',now()-interval '1 day','evidence_note','Actual activity reported for review','readiness_snapshot',jsonb_build_object('status','ready','requires_review',false))));
DO $$ DECLARE snapshot jsonb; BEGIN
 SELECT value->'readiness_snapshot' INTO snapshot FROM employee_receipts WHERE name='uncleared_duty';
 IF snapshot->>'status'<>'not_configured' OR (snapshot->>'requires_review')::boolean IS NOT TRUE OR snapshot->>'basis'<>'current_requirements_at_recording' THEN RAISE EXCEPTION 'Caller overrode conservative duty exception snapshot'; END IF;
 IF (SELECT (value->>'occurred_at')::timestamptz FROM employee_receipts WHERE name='uncleared_duty')<>now()-interval '1 day' THEN RAISE EXCEPTION 'Actual duty time was rewritten'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(snapshot))<>5 THEN RAISE EXCEPTION 'Duty snapshot contains non-aggregate evidence'; END IF;
END $$;
-- Multiple completions and distinct-day expectations are explicit; NULL preserves unresolved source counts.
INSERT INTO employee_receipts VALUES('count_requirement',public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'create','{"code":"probe-counts","title":"Hands-on sessions","category":"training","source_file":"test.pdf","minimum_completions":3,"minimum_distinct_days":2}'));
DO $$ BEGIN IF (SELECT (value->>'minimum_completions')::integer FROM employee_receipts WHERE name='count_requirement')<>3 OR (SELECT (value->>'minimum_distinct_days')::integer FROM employee_receipts WHERE name='count_requirement')<>2 THEN RAISE EXCEPTION 'Completion count contract not preserved'; END IF; END $$;
INSERT INTO employee_receipts VALUES('unknown_count_requirement',public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'create','{"code":"probe-counts-unknown","title":"Unresolved sessions","category":"training","source_file":"test.pdf","minimum_completions":null,"minimum_distinct_days":null}'));
DO $$ BEGIN IF (SELECT value->>'minimum_completions' FROM employee_receipts WHERE name='unknown_count_requirement') IS NOT NULL OR (SELECT value->>'minimum_distinct_days' FROM employee_receipts WHERE name='unknown_count_requirement') IS NOT NULL THEN RAISE EXCEPTION 'Unknown count silently defaulted'; END IF; END $$;
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_requirement_command(%L,''create'',%L)',(SELECT facility FROM employee_fixture),'{"code":"probe-counts-invalid","title":"Invalid sessions","category":"training","source_file":"test.pdf","minimum_completions":2,"minimum_distinct_days":3}'),'violates check constraint');
INSERT INTO employee_receipts VALUES('draft',public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'create','{"code":"probe-orientation","title":"Source orientation","category":"orientation","source_file":"test.pdf","source_page":1,"source_excerpt":"Signed orientation","content":"Employee and witness sign","required_signers":["employee","witness"]}'));
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_requirement_command(%L,''approve'',%L)',(SELECT facility FROM employee_fixture),jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='draft'),'review_note','Reviewed')),'Approval requires');
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''submit_record'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('requirement_id',(SELECT value->>'id' FROM employee_receipts WHERE name='draft'),'completed_on',pg_temp.employee_business_date())),'Approved applicable requirement');
INSERT INTO employee_receipts VALUES('requirement',public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'create','{"code":"probe-verified","title":"Source orientation","category":"orientation","recurrence_status":"one_time","source_file":"test.pdf","source_page":1,"source_excerpt":"Signed orientation","content":"Employee and witness sign","required_signers":["employee","witness"],"applies_to_staff_roles":["resident_aide"],"duty":"resident_interaction"}'));
SELECT public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'approve',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='requirement'),'review_note','Verified source and duties'));
SELECT pg_temp.employee_expect(format('UPDATE public.employee_file_requirements SET content=''tampered'' WHERE id=%L',(SELECT value->>'id' FROM employee_receipts WHERE name='requirement')),'permission denied');
SELECT pg_temp.employee_actor(true);
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''submit_record'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('requirement_id',(SELECT value->>'id' FROM employee_receipts WHERE name='requirement'),'completed_on',pg_temp.employee_business_date()+1)),'Completion cannot');
INSERT INTO employee_receipts VALUES('record',public.haven_employee_file_command((SELECT employee FROM employee_fixture),'submit_record',jsonb_build_object('requirement_id',(SELECT value->>'id' FROM employee_receipts WHERE name='requirement'),'completed_on',pg_temp.employee_business_date(),'notes','Immutable evidence')));
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''sign_record'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='record'),'functional_role','witness','signature_name','File employee')),'Independent authorized countersigner');
SELECT public.haven_employee_file_command((SELECT employee FROM employee_fixture),'sign_record',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='record'),'functional_role','employee','signature_name','File Employee'));
SELECT pg_temp.employee_expect(format('UPDATE public.employee_file_records SET notes=''tamper'' WHERE id=%L',(SELECT value->>'id' FROM employee_receipts WHERE name='record')),'permission denied');
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''attach_record'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='record'),'storage_path','invalid')),'Attachment is immutable');
SELECT pg_temp.employee_actor(false);
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''review_record'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='record'),'status','verified','review_note','Reviewed')),'Required signatures');
SELECT public.haven_employee_file_command((SELECT employee FROM employee_fixture),'sign_record',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='record'),'functional_role','witness','signature_name','File Manager'));
SELECT public.haven_employee_file_command((SELECT employee FROM employee_fixture),'review_record',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='record'),'status','verified','review_note','Both signatures checked'));
DO $$ BEGIN IF (SELECT count(DISTINCT record_snapshot_hash) FROM public.employee_file_signatures WHERE record_id=(SELECT (value->>'id')::uuid FROM employee_receipts WHERE name='record'))<>1 THEN RAISE EXCEPTION 'Signers did not sign identical evidence'; END IF; END $$;
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''review_record'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='record'),'status','rejected','review_note','Overwrite')),'Reviewed records are immutable');
INSERT INTO employee_receipts VALUES('cleared_duty',public.haven_employee_file_command((SELECT employee FROM employee_fixture),'record_duty',jsonb_build_object('duty','resident_interaction','occurred_at',now(),'evidence_note','Current approved requirement satisfied')));
DO $$ BEGIN IF (SELECT value->'readiness_snapshot'->>'status' FROM employee_receipts WHERE name='cleared_duty')<>'ready' THEN RAISE EXCEPTION 'Verified current duty was not recognized'; END IF; END $$;
-- Newest retired version must not revive its older approval.
INSERT INTO employee_receipts VALUES('retiring_requirement',public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'create','{"code":"probe-verified","title":"Retired successor","version":2,"category":"orientation","source_file":"test.pdf"}'));
SELECT public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'retire',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='retiring_requirement'),'review_note','Retire superseded policy lineage for test'));
INSERT INTO employee_receipts VALUES('retired_duty',public.haven_employee_file_command((SELECT employee FROM employee_fixture),'record_duty',jsonb_build_object('duty','resident_interaction','occurred_at',now(),'evidence_note','Retired requirements require review')));
DO $$ BEGIN IF (SELECT value->'readiness_snapshot'->>'status' FROM employee_receipts WHERE name='retired_duty')<>'not_configured' THEN RAISE EXCEPTION 'Retired latest version revived old clearance'; END IF; END $$;
-- Functional purpose is separate from authorization role; nurse cannot self-assert supervisor.
INSERT INTO employee_receipts VALUES('purpose_requirement',public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'create','{"code":"probe-purpose","title":"Purpose controls","category":"orientation","source_file":"test.pdf","source_page":3,"source_excerpt":"Supervisor and trainer","content":"Independent signatures","required_signers":["supervisor","trainer","witness"],"applies_to_staff_roles":["*"]}'));
SELECT public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'approve',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='purpose_requirement'),'review_note','Role purposes checked'));
INSERT INTO employee_receipts VALUES('purpose_record',public.haven_employee_file_command((SELECT employee FROM employee_fixture),'submit_record',jsonb_build_object('requirement_id',(SELECT value->>'id' FROM employee_receipts WHERE name='purpose_requirement'),'completed_on',pg_temp.employee_business_date())));
SELECT pg_temp.employee_actor(NULL);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.employee_file_records WHERE id=(SELECT (value->>'id')::uuid FROM employee_receipts WHERE name='purpose_record')) THEN RAISE EXCEPTION 'Eligible trainer cannot read signing evidence'; END IF; END $$;
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''sign_record'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='purpose_record'),'functional_role','supervisor','signature_name','File Nurse')),'Manager signer required');
SELECT public.haven_employee_file_command((SELECT employee FROM employee_fixture),'sign_record',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='purpose_record'),'functional_role','trainer','signature_name','File Nurse'));
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''sign_record'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='purpose_record'),'functional_role','witness','signature_name','File Nurse')),'cannot fulfill multiple purposes');
SELECT pg_temp.employee_actor(false);
-- Medical metadata and storage are invisible to an owner until an explicit scoped grant.
INSERT INTO employee_receipts VALUES('medical_requirement',public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'create','{"code":"probe-medical","title":"Provider evidence","category":"medical","source_file":"test.pdf","source_page":2,"source_excerpt":"Provider form","content":"Provider form","required_signers":["provider"],"applies_to_staff_roles":["*"]}'));
SELECT public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'approve',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='medical_requirement'),'review_note','Approved handling'));
SELECT pg_temp.employee_actor(true);
INSERT INTO employee_receipts VALUES('medical',public.haven_employee_file_command((SELECT employee FROM employee_fixture),'submit_record',jsonb_build_object('requirement_id',(SELECT value->>'id' FROM employee_receipts WHERE name='medical_requirement'),'completed_on',pg_temp.employee_business_date(),'notes','PRIVATE-MEDICAL-PROBE','evidence_reference','Signed provider paper reviewed separately')));
DO $$ DECLARE rid uuid; BEGIN SELECT (value->>'id')::uuid INTO rid FROM employee_receipts WHERE name='medical';
 IF NOT haven.employee_storage_access('employee-medical',rid||'/source.pdf',true) OR haven.employee_storage_access('employee-personnel',rid||'/source.pdf',true) THEN RAISE EXCEPTION 'Bucket category boundary failed'; END IF;
END $$;
INSERT INTO storage.objects(bucket_id,name,owner) SELECT 'employee-medical',(value->>'id')||'/source.pdf',(SELECT worker FROM employee_fixture) FROM employee_receipts WHERE name='medical' RETURNING name;
SELECT public.haven_employee_file_command((SELECT employee FROM employee_fixture),'attach_record',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='medical'),'storage_path',(SELECT value->>'id' FROM employee_receipts WHERE name='medical')||'/source.pdf'));
UPDATE storage.objects SET name=split_part(name,'/',1)||'/changed.pdf' WHERE bucket_id='employee-medical';
DELETE FROM storage.objects WHERE bucket_id='employee-medical';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='employee-medical' AND name=(SELECT value->>'id' FROM employee_receipts WHERE name='medical')||'/source.pdf') THEN RAISE EXCEPTION 'Protected upload was overwritten or deleted'; END IF; END $$;
SELECT pg_temp.employee_actor(false);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='employee-medical') THEN RAISE EXCEPTION 'Owner can see medical storage without grant'; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.employee_file_records WHERE id=(SELECT (value->>'id')::uuid FROM employee_receipts WHERE name='medical')) THEN RAISE EXCEPTION 'Owner can read confidential medical evidence without grant'; END IF; END $$;
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''review_record'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='medical'),'status','verified','review_note','Review')),'Confidential medical access');
SELECT public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'grant_medical',jsonb_build_object('user_id',(SELECT admin FROM employee_fixture)));
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''sign_record'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='medical'),'functional_role','provider','signature_name','File manager')),'Provider signature requires');
SELECT public.haven_employee_file_command((SELECT employee FROM employee_fixture),'review_record',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='medical'),'status','verified','review_note','Checked signed provider source reference'));
SELECT public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'revoke_medical',jsonb_build_object('user_id',(SELECT admin FROM employee_fixture)));
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.employee_file_records WHERE id=(SELECT (value->>'id')::uuid FROM employee_receipts WHERE name='medical')) THEN RAISE EXCEPTION 'Medical revocation did not apply immediately'; END IF; END $$;
INSERT INTO employee_receipts VALUES('self_attendance',public.haven_employee_file_command((SELECT admin_staff FROM employee_fixture),'record_attendance',jsonb_build_object('event_type','callout','occurred_at',now()-interval '1 hour')));
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''review_attendance'',%L)',(SELECT admin_staff FROM employee_fixture),jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='self_attendance'),'review_status','excluded','review_reason','Self exclusion')),'Independent manager required');
-- Attendance is reviewable; a corrective decision cannot terminate employment or erase occurrences.
INSERT INTO employee_receipts VALUES('attendance',public.haven_employee_file_command((SELECT employee FROM employee_fixture),'record_attendance',jsonb_build_object('event_type','late_callout','occurred_at',now()-interval '1 hour','minutes_deviation',10,'notification_method','phone')));
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_file_command(%L,''record_corrective_action'',%L)',(SELECT employee FROM employee_fixture),jsonb_build_object('attendance_event_id',(SELECT value->>'id' FROM employee_receipts WHERE name='attendance'),'action','written_warning','notes','Review')),'Reviewed counted occurrence');
SELECT public.haven_employee_file_command((SELECT employee FROM employee_fixture),'review_attendance',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='attendance'),'review_status','counted','review_reason','No approved exception'));
INSERT INTO employee_receipts VALUES('discipline',public.haven_employee_file_command((SELECT employee FROM employee_fixture),'record_corrective_action',jsonb_build_object('attendance_event_id',(SELECT value->>'id' FROM employee_receipts WHERE name='attendance'),'action','termination','notes','Human reviewed recommendation only')));
SELECT public.haven_employee_file_command((SELECT employee FROM employee_fixture),'retract_corrective_action',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='discipline'),'retraction_reason','Human approved correction','employee_requested_at',now()-interval '2 hour','review_meeting_at',now()-interval '1 hour'));
DO $$ BEGIN
 IF (SELECT employment_status FROM public.staff WHERE id=(SELECT employee FROM employee_fixture))<>'active' THEN RAISE EXCEPTION 'Discipline auto-changed employment'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staff_attendance_events WHERE id=(SELECT (value->>'id')::uuid FROM employee_receipts WHERE name='attendance') AND review_status='counted') THEN RAISE EXCEPTION 'Retraction erased occurrence'; END IF;
END $$;
SELECT pg_temp.employee_expect(format('DELETE FROM public.staff_attendance_events WHERE id=%L',(SELECT value->>'id' FROM employee_receipts WHERE name='attendance')),'permission denied');
SELECT public.haven_employee_file_command((SELECT employee FROM employee_fixture),'record_export','{}');
SELECT public.haven_employee_file_command((SELECT employee FROM employee_fixture),'record_download',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='record')));
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.employee_file_audit_events WHERE action='record_export' AND entity_id=(SELECT employee FROM employee_fixture)) THEN RAISE EXCEPTION 'Export request was not audited'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.employee_file_audit_events WHERE action='record_download' AND entity_id=(SELECT (value->>'id')::uuid FROM employee_receipts WHERE name='record')) THEN RAISE EXCEPTION 'Download request was not audited'; END IF;
END $$;
RESET ROLE;
-- Trigger protections also apply to privileged integration attempts.
-- Permission-only emergency suspension preserves evidence and the legacy callout bridge.
REVOKE EXECUTE ON FUNCTION public.haven_employee_file_command(uuid,text,jsonb),public.haven_employee_requirement_command(uuid,text,jsonb) FROM authenticated;
DO $$ BEGIN
 IF has_function_privilege('authenticated','public.haven_employee_file_command(uuid,text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.haven_employee_requirement_command(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Command suspension retained execute privilege'; END IF;
 IF NOT has_table_privilege('authenticated','public.staff_attendance_events','INSERT') THEN RAISE EXCEPTION 'Command suspension broke legacy attendance'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.employee_file_records WHERE id=(SELECT (value->>'id')::uuid FROM employee_receipts WHERE name='record')) OR NOT EXISTS(SELECT 1 FROM public.employee_file_signatures WHERE record_id=(SELECT (value->>'id')::uuid FROM employee_receipts WHERE name='record')) OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE name=(SELECT value->>'id' FROM employee_receipts WHERE name='medical')||'/source.pdf') THEN RAISE EXCEPTION 'Command suspension lost employee evidence'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.haven_employee_file_command(uuid,text,jsonb),public.haven_employee_requirement_command(uuid,text,jsonb) TO authenticated;
DO $$ BEGIN
 IF NOT has_function_privilege('authenticated','public.haven_employee_file_command(uuid,text,jsonb)','EXECUTE') OR NOT has_function_privilege('authenticated','public.haven_employee_requirement_command(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Command restoration failed'; END IF;
END $$;
SELECT pg_temp.employee_expect(format('UPDATE public.employee_file_records SET notes=''changed'' WHERE id=%L',(SELECT value->>'id' FROM employee_receipts WHERE name='record')),'Reviewed records are immutable');
SELECT pg_temp.employee_expect(format('DELETE FROM public.staff_attendance_events WHERE id=%L',(SELECT value->>'id' FROM employee_receipts WHERE name='attendance')),'Employee history cannot be deleted');
SELECT pg_temp.employee_expect(format('UPDATE public.employee_file_requirements SET content=''changed'' WHERE id=%L',(SELECT value->>'id' FROM employee_receipts WHERE name='requirement')),'Approved requirements are immutable');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.audit_log WHERE new_data::text LIKE '%PRIVATE-MEDICAL-PROBE%' OR old_data::text LIKE '%PRIVATE-MEDICAL-PROBE%') THEN RAISE EXCEPTION 'Medical payload leaked into general audit'; END IF; END $$;
-- New commands and RLS honor immediate session revocation.
DELETE FROM auth.sessions WHERE id=(SELECT admin_session FROM employee_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.employee_expect(format('SELECT public.haven_employee_requirement_command(%L,''create'',%L)',(SELECT facility FROM employee_fixture),'{}'),'Employee requirement management unavailable');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.employee_file_records) THEN RAISE EXCEPTION 'Revoked session retained employee-file access'; END IF; END $$;
RESET ROLE;
ROLLBACK;
