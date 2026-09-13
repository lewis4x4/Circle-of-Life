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
CREATE FUNCTION pg_temp.es_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL156 %',msg; END IF; END $$;
CREATE TEMP TABLE es AS SELECT gen_random_uuid() subject,gen_random_uuid() task;
GRANT ALL ON es TO authenticated;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record) SELECT org,facility,admin,'employee_personnel',admin,'Synthetic personnel review',true FROM employee_fixture;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,employee_id) SELECT subject,org,facility,'employee',employee FROM es,employee_fixture;
SET LOCAL ROLE authenticated;
INSERT INTO employee_receipts VALUES('hfo-rule',public.save_operation_requirement_draft_review((SELECT id FROM public.operation_activities WHERE activity_key='hfo-al-w06-01' AND organization_id=(SELECT org FROM employee_fixture)),'{"title":"Employee source context","wording":"Review existing employee evidence","allowed_recorder_roles":["owner"],"subject_kind":"employee"}'));
SELECT public.publish_operation_requirement_review((SELECT (value->>'id')::uuid FROM employee_receipts WHERE name='hfo-rule'),clock_timestamp()-interval '1 hour');
INSERT INTO employee_receipts VALUES('hfo-site',public.save_operation_facility_requirement_draft_review((SELECT id FROM public.operation_activities WHERE activity_key='hfo-al-w06-01' AND organization_id=(SELECT org FROM employee_fixture)),(SELECT facility FROM employee_fixture),jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT value->>'id' FROM employee_receipts WHERE name='hfo-rule'),'schedule_status','needs_confirmation')));
SELECT public.publish_operation_facility_requirement_review((SELECT (value->>'id')::uuid FROM employee_receipts WHERE name='hfo-site'),clock_timestamp()-interval '30 minutes');
INSERT INTO employee_receipts VALUES('hfo-task',public.create_operation_manual_occurrence_review((SELECT id FROM public.operation_activities WHERE activity_key='hfo-al-w06-01' AND organization_id=(SELECT org FROM employee_fixture)),(SELECT facility FROM employee_fixture),(SELECT subject FROM es),'col156-manual-001','{}'));
UPDATE es SET task=(SELECT (value->>'id')::uuid FROM employee_receipts WHERE name='hfo-task');
INSERT INTO employee_receipts VALUES('draft',public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'create','{"code":"TRN-24","title":"Synthetic CPR","category":"training","source_file":"synthetic","source_page":1,"source_excerpt":"Synthetic approved wording","recurrence_status":"one_time","content":"Synthetic policy","required_signers":[],"applies_to_staff_roles":["resident_aide"]}'));
SELECT public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'approve',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='draft'),'review_note','Synthetic authorized rule'));
INSERT INTO employee_receipts VALUES('record',public.haven_employee_file_command((SELECT employee FROM employee_fixture),'submit_record',jsonb_build_object('requirement_id',(SELECT value->>'id' FROM employee_receipts WHERE name='draft'),'completed_on',(clock_timestamp() AT TIME ZONE 'Etc/GMT+12')::date,'expires_on',(clock_timestamp() AT TIME ZONE 'Etc/GMT+12')::date,'evidence_reference','Synthetic signed paper')));
SELECT public.haven_employee_file_command((SELECT employee FROM employee_fixture),'review_record',jsonb_build_object('id',(SELECT value->>'id' FROM employee_receipts WHERE name='record'),'status','verified','review_note','Synthetic receipt reviewed'));
RESET ROLE;
UPDATE public.facilities SET timezone='Etc/GMT+12' WHERE id=(SELECT facility FROM employee_fixture);
SELECT pg_temp.employee_actor(false); SET LOCAL ROLE authenticated;
CREATE TEMP TABLE es_a AS SELECT public.employee_operation_source_snapshot(task,'col156-refresh-001') reply FROM es;
GRANT ALL ON es_a TO authenticated;
SELECT pg_temp.es_assert((SELECT reply->>'availability'='available' AND jsonb_array_length(reply->'history')=1 FROM es_a),'first current snapshot failed');
SELECT pg_temp.es_assert(jsonb_array_length(public.employee_operation_source_snapshot((SELECT task FROM es),'col156-refresh-002')->'history')=1,'unchanged refresh appended');
SELECT pg_temp.es_assert(jsonb_array_length(public.employee_operation_source_snapshot((SELECT task FROM es),'col156-refresh-001')->'history')=1,'request replay appended');
RESET ROLE;
INSERT INTO public.employee_file_requirements(organization_id,facility_id,code,title,category,source_file,source_page,created_by) SELECT org,facility,'TRN-26','PRIVATE TB','training','private',1,admin FROM employee_fixture;
SELECT pg_temp.employee_actor(false); SET LOCAL ROLE authenticated;
SELECT pg_temp.es_assert(public.employee_operation_source_snapshot((SELECT task FROM es))->>'source_version'=(SELECT reply->>'source_version' FROM es_a),'hidden medical source changed personnel hash');
SELECT pg_temp.es_assert(public.employee_operation_source_snapshot((SELECT task FROM es))::text NOT LIKE '%PRIVATE TB%','medical draft leaked');
RESET ROLE;
UPDATE public.staff SET staff_role='administrator' WHERE id=(SELECT employee FROM employee_fixture);
SELECT pg_temp.employee_actor(false); SET LOCAL ROLE authenticated;
INSERT INTO haven.employee_source_transitions(task_id,sequence) OVERRIDING SYSTEM VALUE SELECT task,9223372036854770000 FROM es;
SELECT pg_temp.es_assert((SELECT max(sequence)=2 FROM haven.employee_source_transitions),'caller overrode transition order');
SELECT pg_temp.es_assert(jsonb_array_length(public.employee_operation_source_snapshot((SELECT task FROM es),'col156-refresh-003')->'history')=2,'changed source did not append');
RESET ROLE;
UPDATE public.staff SET staff_role='resident_aide' WHERE id=(SELECT employee FROM employee_fixture);
SELECT pg_temp.employee_actor(false); SET LOCAL ROLE authenticated;
SELECT pg_temp.es_assert(jsonb_array_length(public.employee_operation_source_snapshot((SELECT task FROM es),'col156-refresh-004')->'history')=3,'A B A transition collapsed');
RESET ROLE;
-- Advance only the synthetic facility's local date, without rewriting verified
-- evidence. The source hash stays fixed; expiry-state history changes once.
CREATE TEMP TABLE es_timezone AS SELECT timezone original FROM public.facilities WHERE id=(SELECT facility FROM employee_fixture);
GRANT SELECT ON es_timezone TO authenticated;
UPDATE public.facilities SET timezone='Etc/GMT-14' WHERE id=(SELECT facility FROM employee_fixture);
SELECT pg_temp.employee_actor(false); SET LOCAL ROLE authenticated;
CREATE TEMP TABLE es_clock AS SELECT public.employee_operation_source_snapshot((SELECT task FROM es),'col156-expiry-001') reply;
GRANT SELECT ON es_clock TO authenticated;
SELECT pg_temp.es_assert((SELECT reply->>'source_version'=(SELECT reply->>'source_version' FROM es_a) FROM es_clock),'clock-only expiry changed source identity');
SELECT pg_temp.es_assert((SELECT reply->>'state_version' IS DISTINCT FROM (SELECT reply->>'state_version' FROM es_a) FROM es_clock),'clock-only expiry did not change state');
SELECT pg_temp.es_assert(jsonb_array_length(public.employee_operation_source_snapshot((SELECT task FROM es),'col156-expiry-002')->'history')=4,'same expiry state duplicated');
RESET ROLE;
UPDATE public.facilities SET timezone=(SELECT original FROM es_timezone) WHERE id=(SELECT facility FROM employee_fixture);
SELECT pg_temp.employee_actor(false); SET LOCAL ROLE authenticated;
SELECT public.employee_operation_source_snapshot((SELECT task FROM es),'col156-expiry-return');
RESET ROLE;
-- Both independent medical grant surfaces are required even for TRN training codes.
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record) SELECT org,facility,admin,'employee_medical',admin,'Synthetic medical source access',true FROM employee_fixture;
SELECT pg_temp.employee_actor(false); SET LOCAL ROLE authenticated;
SELECT pg_temp.es_assert(NOT (public.employee_operation_source_snapshot((SELECT task FROM es))->>'can_medical')::boolean,'HFO medical grant alone bypassed native grant');
SELECT public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'grant_medical',jsonb_build_object('user_id',(SELECT admin FROM employee_fixture),'review_note','Synthetic independent medical reviewer'));
SELECT pg_temp.es_assert((public.employee_operation_source_snapshot((SELECT task FROM es))->>'can_medical')::boolean,'both grants failed');
SELECT pg_temp.es_assert(public.employee_operation_source_snapshot((SELECT task FROM es))::text LIKE '%PRIVATE TB%','authorized source missing');
SELECT public.employee_operation_source_snapshot((SELECT task FROM es),'col156-medical-001');
SELECT public.haven_employee_requirement_command((SELECT facility FROM employee_fixture),'revoke_medical',jsonb_build_object('user_id',(SELECT admin FROM employee_fixture),'review_note','Synthetic revocation'));
SELECT pg_temp.es_assert(NOT (public.employee_operation_source_snapshot((SELECT task FROM es))->>'can_medical')::boolean AND public.employee_operation_source_snapshot((SELECT task FROM es))::text NOT LIKE '%PRIVATE TB%','medical revocation did not mask data');
SELECT pg_temp.es_assert(jsonb_array_length(public.employee_operation_source_snapshot((SELECT task FROM es))->'history')=5,'medical prior history leaked after revocation');
SELECT pg_temp.employee_expect('DELETE FROM haven.employee_source_transitions','permission denied');
SELECT pg_temp.employee_expect('UPDATE haven.employee_source_requests SET request_key=''forged''','permission denied');
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id=(SELECT admin FROM employee_fixture);
SELECT pg_temp.employee_actor(false); SET LOCAL ROLE authenticated;
SELECT pg_temp.employee_expect(format('SELECT public.employee_operation_source_snapshot(%L)',(SELECT task FROM es)),'scope unavailable');
ROLLBACK;
