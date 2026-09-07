-- SYS-001 rollback-only authorization, onboarding, Storage, and InitPlan probe.
BEGIN;

GRANT USAGE ON SCHEMA auth, storage, haven TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'role','')
$$;

CREATE TEMP TABLE actor_fixture AS
SELECT gen_random_uuid() actor,gen_random_uuid() actor_session,
  gen_random_uuid() family_user,gen_random_uuid() family_session,
  gen_random_uuid() onboarding_user,gen_random_uuid() onboarding_session,
  gen_random_uuid() legacy_user,gen_random_uuid() legacy_session,
  gen_random_uuid() mismatch_user,gen_random_uuid() mismatch_session,
  gen_random_uuid() edge_admin,gen_random_uuid() edge_admin_session,
  gen_random_uuid() edge_facility_admin,gen_random_uuid() edge_facility_admin_session,
  gen_random_uuid() restriction_target,gen_random_uuid() restriction_target_session,
  gen_random_uuid() restriction_failure_target,gen_random_uuid() restriction_failure_session,
  gen_random_uuid() expansion_failure_target,gen_random_uuid() expansion_failure_session,
  gen_random_uuid() reactivation_target,gen_random_uuid() reactivation_target_session,
  gen_random_uuid() second_resident,gen_random_uuid() storage_object,gen_random_uuid() storage_object_two,
  gen_random_uuid() operation_task,gen_random_uuid() defer_task,gen_random_uuid() defer_failure_task,
  gen_random_uuid() rounding_task,gen_random_uuid() rounding_reassign_task,gen_random_uuid() rounding_terminal_task,
  gen_random_uuid() rounding_terminal_log,gen_random_uuid() rounding_terminal_assignment,
  gen_random_uuid() rounding_staff,gen_random_uuid() rounding_other_staff,
  gen_random_uuid() rounding_plan,gen_random_uuid() rounding_rule,gen_random_uuid() rounding_flag,
  gen_random_uuid() ingest_document,gen_random_uuid() ingest_chunk,gen_random_uuid() ingest_authorization_run,
  gen_random_uuid() ingest_document_two,gen_random_uuid() ingest_chunk_two,gen_random_uuid() ingest_authorization_run_two,
  gen_random_uuid() parser_fact,gen_random_uuid() parser_null_fact,gen_random_uuid() parser_fail_fact,
  gen_random_uuid() parser_old_value,gen_random_uuid() parser_fail_old_value,
  gen_random_uuid() perf_marker,
  f.id facility,f.organization_id organization,r.id resident
FROM public.facilities f JOIN public.residents r
  ON r.facility_id=f.id AND r.organization_id=f.organization_id AND r.deleted_at IS NULL
WHERE f.deleted_at IS NULL
  AND f.name IN ('Oakridge ALF','Rising Oaks ALF','Homewood Lodge ALF','Grande Cypress ALF')
LIMIT 1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM actor_fixture) THEN RAISE EXCEPTION 'SYS-001 seeded facility/resident required'; END IF; END $$;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT actor,actor||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','owner'),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT family_user,family_user||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','family'),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT onboarding_user,onboarding_user||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','onboarding','auth_claim_version',1),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT legacy_user,legacy_user||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','caregiver'),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT mismatch_user,mismatch_user||'@sys001.invalid','{}'::jsonb,'{}'::jsonb FROM actor_fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT edge_admin,edge_admin||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','owner'),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT edge_facility_admin,edge_facility_admin||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','facility_admin'),'{}'::jsonb FROM actor_fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT restriction_target,restriction_target||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','manager'),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT restriction_failure_target,restriction_failure_target||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','manager'),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT expansion_failure_target,expansion_failure_target||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','caregiver'),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT reactivation_target,reactivation_target||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','caregiver'),'{}'::jsonb FROM actor_fixture;

INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
SELECT actor,organization,actor||'@sys001.invalid','SYS-001 actor','owner'::public.app_role,true FROM actor_fixture
UNION ALL SELECT family_user,organization,family_user||'@sys001.invalid','SYS-001 family','family'::public.app_role,true FROM actor_fixture
UNION ALL SELECT legacy_user,organization,legacy_user||'@sys001.invalid','SYS-001 legacy','caregiver'::public.app_role,true FROM actor_fixture;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
SELECT edge_admin,organization,edge_admin||'@sys001.invalid','SYS-001 Edge admin','owner'::public.app_role,true FROM actor_fixture
UNION ALL SELECT edge_facility_admin,organization,edge_facility_admin||'@sys001.invalid','SYS-001 Edge facility admin','facility_admin'::public.app_role,true FROM actor_fixture;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
SELECT restriction_target,organization,restriction_target||'@sys001.invalid','SYS-001 restriction target','manager'::public.app_role,true FROM actor_fixture
UNION ALL SELECT restriction_failure_target,organization,restriction_failure_target||'@sys001.invalid','SYS-001 restriction rollback target','manager'::public.app_role,true FROM actor_fixture
UNION ALL SELECT expansion_failure_target,organization,expansion_failure_target||'@sys001.invalid','SYS-001 expansion rollback target','caregiver'::public.app_role,true FROM actor_fixture
UNION ALL SELECT reactivation_target,organization,reactivation_target||'@sys001.invalid','SYS-001 reactivation target','caregiver'::public.app_role,true FROM actor_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
SELECT actor,facility,organization FROM actor_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
SELECT edge_facility_admin,facility,organization FROM actor_fixture;
INSERT INTO auth.sessions(id,user_id)
SELECT actor_session,actor FROM actor_fixture
UNION ALL SELECT family_session,family_user FROM actor_fixture
UNION ALL SELECT onboarding_session,onboarding_user FROM actor_fixture
UNION ALL SELECT legacy_session,legacy_user FROM actor_fixture
UNION ALL SELECT mismatch_session,mismatch_user FROM actor_fixture;
INSERT INTO auth.sessions(id,user_id)
SELECT edge_admin_session,edge_admin FROM actor_fixture
UNION ALL SELECT edge_facility_admin_session,edge_facility_admin FROM actor_fixture;
INSERT INTO auth.sessions(id,user_id)
SELECT restriction_target_session,restriction_target FROM actor_fixture
UNION ALL SELECT restriction_failure_session,restriction_failure_target FROM actor_fixture
UNION ALL SELECT expansion_failure_session,expansion_failure_target FROM actor_fixture
UNION ALL SELECT reactivation_target_session,reactivation_target FROM actor_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,is_primary,granted_by)
SELECT restriction_target,facility,organization,true,actor FROM actor_fixture
UNION ALL SELECT restriction_failure_target,facility,organization,true,actor FROM actor_fixture
UNION ALL SELECT expansion_failure_target,facility,organization,true,actor FROM actor_fixture
UNION ALL SELECT reactivation_target,facility,organization,true,actor FROM actor_fixture;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender)
SELECT second_resident,facility,organization,'SYS-001','Unlinked','1940-01-01','female' FROM actor_fixture;
INSERT INTO public.family_resident_links(user_id,resident_id,organization_id,relationship)
SELECT family_user,resident,organization,'family' FROM actor_fixture;
INSERT INTO public.onboarding_questions(id,prompt,department,importance,answer_type)
VALUES('sys001.authorization','SYS-001 authorization probe','Security','critical','long_text');
INSERT INTO public.operation_task_instances(
  id,organization_id,facility_id,template_name,template_category,template_cadence_type,assigned_shift_date,status
)
SELECT operation_task,organization,facility,'SYS-001 service actor task','safety','daily',current_date,'pending'
FROM actor_fixture;
INSERT INTO public.operation_task_instances(
  id,organization_id,facility_id,template_name,template_category,template_cadence_type,assigned_shift_date,status
)
SELECT defer_task,organization,facility,'SYS-001 atomic defer task','safety','daily',current_date,'pending'
FROM actor_fixture
UNION ALL
SELECT defer_failure_task,organization,facility,'SYS-001 atomic defer failure task','safety','daily',current_date,'pending'
FROM actor_fixture;

INSERT INTO public.staff(
  id,user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date
)
SELECT rounding_staff,actor,facility,organization,'SYS-001','Rounding actor',
  'cna'::public.staff_role,'active'::public.employment_status,current_date
FROM actor_fixture
UNION ALL
SELECT rounding_other_staff,NULL,facility,organization,'SYS-001','Other assignee',
  'cna'::public.staff_role,'active'::public.employment_status,current_date
FROM actor_fixture;
INSERT INTO public.resident_observation_plans(
  id,organization_id,facility_id,resident_id,status,source_type,effective_from,rationale
)
SELECT rounding_plan,organization,facility,resident,'active','manual',now(),'SYS-001 rounding authorization plan'
FROM actor_fixture;
INSERT INTO public.resident_observation_plan_rules(
  id,plan_id,organization_id,facility_id,resident_id,interval_type,interval_minutes,grace_minutes
)
SELECT rounding_rule,rounding_plan,organization,facility,resident,'fixed_minutes',60,15
FROM actor_fixture;
INSERT INTO public.resident_observation_tasks(
  id,organization_id,facility_id,resident_id,plan_id,plan_rule_id,assigned_staff_id,
  scheduled_for,due_at,grace_ends_at,status
)
SELECT rounding_task,organization,facility,resident,rounding_plan,rounding_rule,rounding_staff,
  now()-interval '30 minutes',now()+interval '30 minutes',now()+interval '45 minutes',
  'upcoming'::public.resident_observation_task_status
FROM actor_fixture
UNION ALL
SELECT rounding_reassign_task,organization,facility,resident,rounding_plan,rounding_rule,rounding_staff,
  now()+interval '1 hour',now()+interval '2 hours',now()+interval '2 hours 15 minutes',
  'due_soon'::public.resident_observation_task_status
FROM actor_fixture
UNION ALL
SELECT rounding_terminal_task,organization,facility,resident,rounding_plan,rounding_rule,rounding_staff,
  now()-interval '2 hours',now()-interval '1 hour',now()-interval '45 minutes',
  'completed_on_time'::public.resident_observation_task_status
FROM actor_fixture;
INSERT INTO public.resident_observation_assignments(
  organization_id,facility_id,resident_id,task_id,staff_id,assignment_type,created_by
)
SELECT organization,facility,resident,rounding_task,rounding_staff,'primary',actor FROM actor_fixture;
INSERT INTO public.resident_observation_assignments(
  organization_id,facility_id,resident_id,task_id,staff_id,assignment_type,created_by
)
SELECT organization,facility,resident,rounding_reassign_task,rounding_staff,'primary',actor FROM actor_fixture;
INSERT INTO public.resident_observation_assignments(
  id,organization_id,facility_id,resident_id,task_id,staff_id,assignment_type,created_by
)
SELECT rounding_terminal_assignment,organization,facility,resident,rounding_terminal_task,rounding_staff,'primary',actor
FROM actor_fixture;
INSERT INTO public.resident_observation_logs(
  id,organization_id,facility_id,resident_id,task_id,assigned_staff_id,staff_id,
  observed_at,entered_at,entry_mode,quick_status,created_by
)
SELECT rounding_terminal_log,organization,facility,resident,rounding_terminal_task,rounding_staff,rounding_staff,
  now()-interval '1 hour',now()-interval '1 hour','live','awake',actor FROM actor_fixture;
UPDATE public.resident_observation_tasks AS task SET completed_log_id=fixture.rounding_terminal_log
FROM actor_fixture AS fixture WHERE task.id=fixture.rounding_terminal_task;
INSERT INTO public.resident_observation_integrity_flags(
  id,organization_id,facility_id,resident_id,staff_id,flag_type,severity,status
)
SELECT rounding_flag,organization,facility,resident,rounding_staff,'sys001_authority','medium','open'
FROM actor_fixture;
INSERT INTO public.documents(id,workspace_id,title,status,uploaded_by,ingest_attempt_count)
SELECT ingest_document,organization,'SYS-001 interrupted ingest null uploader','processing',NULL,0 FROM actor_fixture
UNION ALL
SELECT ingest_document_two,organization,'SYS-001 interrupted ingest different uploader','processing',edge_facility_admin,0 FROM actor_fixture;
INSERT INTO public.chunks(id,document_id,workspace_id,chunk_index,content,chunk_type)
SELECT ingest_chunk,ingest_document,organization,0,'partial chunk','paragraph' FROM actor_fixture
UNION ALL
SELECT ingest_chunk_two,ingest_document_two,organization,0,'partial chunk two','paragraph' FROM actor_fixture;
INSERT INTO public.document_extracted_facts(
  id,organization_id,facility_id,document_id,fact_key,fact_label,extracted_value,
  confidence,source_excerpt,evidence,proposed_module_code,proposed_field_path,approval_status
)
SELECT parser_fact,organization,facility,ingest_document,'parser_current','Parser current',
  '{"value":"current"}'::jsonb,0.9,'current excerpt','{"parser_version":"test"}'::jsonb,
  'M17','sys001.parser','pending' FROM actor_fixture
UNION ALL
SELECT parser_null_fact,organization,NULL,ingest_document,'parser_null','Parser null',
  '{"value":"org-wide"}'::jsonb,0.8,'null excerpt','{"parser_version":"test"}'::jsonb,
  'M17','sys001.null','pending' FROM actor_fixture
UNION ALL
SELECT parser_fail_fact,organization,facility,ingest_document,'parser_fail','Parser fail',
  '{"value":"replacement"}'::jsonb,0.7,'fail excerpt','{"parser_version":"test"}'::jsonb,
  'M17','sys001.fail','pending' FROM actor_fixture;
INSERT INTO public.facility_launch_module_values(
  id,organization_id,facility_id,module_code,field_path,value,source_document_id,applied_by
)
SELECT parser_old_value,organization,facility,'M17','sys001.parser','{"value":"old"}'::jsonb,ingest_document,edge_admin FROM actor_fixture
UNION ALL
SELECT parser_fail_old_value,organization,facility,'M17','sys001.fail','{"value":"preserve"}'::jsonb,ingest_document,edge_admin FROM actor_fixture;

GRANT SELECT ON actor_fixture TO authenticated, service_role;
CREATE FUNCTION pg_temp.set_claims(p_user uuid,p_session uuid,p_version jsonb,p_claimed_role text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE claims jsonb;
BEGIN
  claims:=jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated',
    'app_role',p_claimed_role,'app_metadata',jsonb_build_object('app_role',p_claimed_role));
  IF p_version IS NOT NULL THEN claims:=jsonb_set(claims,'{auth_claim_version}',p_version,true); END IF;
  PERFORM set_config('request.jwt.claims',claims::text,true);
END $$;
CREATE FUNCTION pg_temp.expect_rejected(p_case text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.haven_assert_authorized_request();
    RAISE EXCEPTION 'SYS-001 unexpectedly accepted: %',p_case;
  EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>'PGRST' THEN RAISE; END IF; END;
END $$;
CREATE FUNCTION pg_temp.rounding_completion_payload() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'request_id',gen_random_uuid(),'observed_at',now(),'entered_at',now(),'entry_mode','live','quick_status','awake',
    'distress_present',false,'breathing_concern',false,'pain_concern',false,
    'toileting_assisted',false,'hydration_offered',false,'repositioned',false,
    'skin_concern_observed',false,'fall_hazard_observed',false,'refused_assistance',false,
    'intervention_codes','[]'::jsonb,'exception_present',false,'completion_status','completed_on_time'
  )
$$;

-- Hook emits real integer authority claims and replaces stale role/org metadata.
DO $$ DECLARE f actor_fixture%ROWTYPE; result jsonb; version integer; BEGIN
  SELECT * INTO STRICT f FROM actor_fixture;
  SELECT auth_claim_version INTO version FROM public.user_profiles WHERE id=f.actor;
  result:=public.haven_custom_access_token_hook(jsonb_build_object('user_id',f.actor,'claims',
    jsonb_build_object('sub',f.actor,'role','authenticated','app_metadata',jsonb_build_object('app_role','caregiver'))));
  IF jsonb_typeof(result#>'{claims,auth_claim_version}')<>'number'
     OR (result#>>'{claims,auth_claim_version}')::integer<>version
     OR result#>>'{claims,app_role}'<>'owner'
     OR result#>>'{claims,app_metadata,app_role}'<>'owner'
     OR (result#>>'{claims,organization_id}')::uuid<>f.organization THEN RAISE EXCEPTION 'Managed hook claims incorrect'; END IF;
  result:=public.haven_custom_access_token_hook(jsonb_build_object('user_id',f.onboarding_user,'claims',jsonb_build_object('role','authenticated')));
  IF jsonb_typeof(result#>'{claims,auth_claim_version}')<>'number'
     OR result#>>'{claims,app_role}'<>'onboarding'
     OR (result#>>'{claims,organization_id}')::uuid<>f.organization THEN RAISE EXCEPTION 'Onboarding hook claims incorrect'; END IF;
  IF has_function_privilege('authenticated','public.haven_custom_access_token_hook(jsonb)','EXECUTE')
     OR NOT has_function_privilege('supabase_auth_admin','public.haven_custom_access_token_hook(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Custom token hook grants incorrect';
  END IF;
END $$;

-- An unmanaged onboarding identity above version one requires an explicit matching claim.
UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{auth_claim_version}','2')
WHERE id=(SELECT onboarding_user FROM actor_fixture);
SELECT pg_temp.set_claims(onboarding_user,onboarding_session,NULL,'onboarding') FROM actor_fixture;
SELECT pg_temp.expect_rejected('missing onboarding claim above version one');
UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{auth_claim_version}','1')
WHERE id=(SELECT onboarding_user FROM actor_fixture);

-- Lifecycle authority and failure-injection tests. All records roll back.
CREATE FUNCTION pg_temp.restrict_access(target uuid, operation text, role public.app_role DEFAULT NULL,
  facility uuid DEFAULT NULL, request_key text DEFAULT gen_random_uuid()::text)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.restrict_user_access_review(target,f.actor,f.actor_session,
   (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),f.organization,
   operation,request_key,role,facility,'lifecycle proof') FROM actor_fixture f
$$;
CREATE FUNCTION pg_temp.prepare_access(target uuid, operation text, role public.app_role DEFAULT NULL,
  facilities uuid[] DEFAULT '{}', primary_facility uuid DEFAULT NULL, request_key text DEFAULT gen_random_uuid()::text)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_user_access_expansion_review(target,f.actor,f.actor_session,
   (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),f.organization,
   operation,request_key,role,facilities,primary_facility,'lifecycle proof') FROM actor_fixture f
$$;
CREATE FUNCTION pg_temp.observe_auth_sync(job jsonb) RETURNS void LANGUAGE sql AS $$
 UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||jsonb_build_object(
   'app_role',job->>'desired_app_role','organization_id',job->>'organization_id',
   'auth_claim_version',(job->>'desired_claim_version')::integer,'haven_auth_sync_job_id',job->>'id',
   'haven_auth_ban_job_id',job->>'id','haven_auth_ban_version',(job->>'desired_claim_version')::integer),
   banned_until=CASE WHEN (job->>'should_ban')::boolean THEN now()+interval '100 years' ELSE NULL END
 WHERE id=(job->>'target_user_id')::uuid
$$;
CREATE FUNCTION pg_temp.finish_access(job jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE leased jsonb;
BEGIN
 leased:=public.claim_user_auth_sync_job((job->>'id')::uuid,60);
 PERFORM public.validate_user_auth_sync_job((leased->>'id')::uuid,(leased->>'lease_token')::uuid);
 PERFORM pg_temp.observe_auth_sync(leased);
 PERFORM public.mark_user_auth_sync_succeeded((leased->>'id')::uuid,(leased->>'lease_token')::uuid);
 RETURN public.finalize_user_auth_sync_job((leased->>'id')::uuid,(leased->>'lease_token')::uuid);
END $$;

CREATE TEMP TABLE lifecycle_versions AS
SELECT restriction_target AS user_id,auth_claim_version AS old_version
FROM actor_fixture JOIN public.user_profiles ON id=restriction_target;
DO $$ DECLARE f actor_fixture%ROWTYPE; result jsonb; leased jsonb; replay jsonb; BEGIN
 SELECT * INTO STRICT f FROM actor_fixture;
 result:=pg_temp.restrict_access(f.restriction_target,'demote','caregiver',NULL,'restrict-replay');
 leased:=public.claim_user_auth_sync_job((result->>'id')::uuid,60);
 PERFORM public.fail_user_auth_sync_job((leased->>'id')::uuid,(leased->>'lease_token')::uuid,'provider_unavailable');
 replay:=pg_temp.restrict_access(f.restriction_target,'demote','caregiver',NULL,'restrict-replay');
 IF replay->>'id'<>result->>'id' OR
   (SELECT count(*) FROM public.user_management_audit_log WHERE target_user_id=f.restriction_target AND action='update_role')<>1
   OR (SELECT app_role FROM public.user_profiles WHERE id=f.restriction_target)<>'caregiver'
   OR NOT EXISTS(SELECT 1 FROM public.user_auth_sync_jobs WHERE id=(result->>'id')::uuid
     AND phase='pending_auth' AND attempt_count=1 AND last_error_code='provider_unavailable') THEN
   RAISE EXCEPTION 'Restriction/replay did not preserve atomic denial, audit, and retry'; END IF;
 BEGIN
   PERFORM pg_temp.restrict_access(f.restriction_target,'disable',NULL,NULL,'restrict-replay');
   RAISE EXCEPTION 'Reused key accepted different payload';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
SELECT pg_temp.set_claims(f.restriction_target,f.restriction_target_session,to_jsonb(v.old_version),'manager')
FROM actor_fixture f JOIN lifecycle_versions v ON v.user_id=f.restriction_target;
SELECT pg_temp.expect_rejected('old JWT after demotion');

CREATE FUNCTION pg_temp.fail_lifecycle_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.target_user_id=(SELECT restriction_failure_target FROM actor_fixture) THEN
   RAISE EXCEPTION 'injected lifecycle audit failure'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sys001_fail_lifecycle_audit BEFORE INSERT ON public.user_management_audit_log
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_lifecycle_audit();
DO $$ DECLARE f actor_fixture%ROWTYPE; old_version integer; job jsonb; BEGIN
 SELECT * INTO STRICT f FROM actor_fixture;
 SELECT auth_claim_version INTO old_version FROM public.user_profiles WHERE id=f.restriction_failure_target;
 BEGIN
   PERFORM pg_temp.restrict_access(f.restriction_failure_target,'disable');
   RAISE EXCEPTION 'Audit failure did not abort restriction';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected lifecycle audit failure' THEN RAISE; END IF; END;
 IF NOT (SELECT is_active FROM public.user_profiles WHERE id=f.restriction_failure_target)
   OR (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.restriction_failure_target)<>old_version
   OR EXISTS(SELECT 1 FROM public.user_auth_sync_jobs WHERE target_user_id=f.restriction_failure_target) THEN
   RAISE EXCEPTION 'Failed restriction audit left partial state'; END IF;
 job:=pg_temp.prepare_access(f.restriction_failure_target,'promote','facility_admin');
 BEGIN
   PERFORM pg_temp.finish_access(job);
   RAISE EXCEPTION 'Audit failure did not abort expansion';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected lifecycle audit failure' THEN RAISE; END IF; END;
 IF (SELECT app_role FROM public.user_profiles WHERE id=f.restriction_failure_target)<>'manager'
   OR (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.restriction_failure_target)<>old_version THEN
   RAISE EXCEPTION 'Failed expansion audit created authority'; END IF;
END $$;
DROP TRIGGER sys001_fail_lifecycle_audit ON public.user_management_audit_log;

DO $$ DECLARE f actor_fixture%ROWTYPE; job jsonb; lease jsonb; old_token uuid; restored jsonb; BEGIN
 SELECT * INTO STRICT f FROM actor_fixture;
 job:=pg_temp.prepare_access(f.expansion_failure_target,'promote','nurse');
 -- A concurrent second expansion cannot reserve the same authority version.
 BEGIN
   PERFORM pg_temp.prepare_access(f.expansion_failure_target,'promote','manager');
   RAISE EXCEPTION 'Parallel expansion accepted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 lease:=public.claim_user_auth_sync_job((job->>'id')::uuid,60);
 old_token:=(lease->>'lease_token')::uuid;
 IF public.claim_user_auth_sync_job((job->>'id')::uuid,60) IS NOT NULL THEN
   RAISE EXCEPTION 'Live lease could be stolen'; END IF;
 UPDATE public.user_auth_sync_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=(job->>'id')::uuid;
 lease:=public.claim_user_auth_sync_job((job->>'id')::uuid,60);
 BEGIN
   PERFORM public.mark_user_auth_sync_succeeded((job->>'id')::uuid,old_token);
   RAISE EXCEPTION 'Expired lease wrote receipt';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 -- Restriction between provider preparation and finalization must defeat expansion.
 PERFORM pg_temp.observe_auth_sync(lease);
 PERFORM public.mark_user_auth_sync_succeeded((job->>'id')::uuid,(lease->>'lease_token')::uuid);
 PERFORM pg_temp.restrict_access(f.expansion_failure_target,'demote','dietary_aide');
 BEGIN
   PERFORM public.finalize_user_auth_sync_job((job->>'id')::uuid,(lease->>'lease_token')::uuid);
   RAISE EXCEPTION 'Stale expansion granted authority';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
   PERFORM public.validate_user_auth_sync_job((job->>'id')::uuid,(lease->>'lease_token')::uuid);
   RAISE EXCEPTION 'Stale Auth retry accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM public.fail_user_auth_sync_job((job->>'id')::uuid,(lease->>'lease_token')::uuid,'40001');
 IF (SELECT phase FROM public.user_auth_sync_jobs WHERE id=(job->>'id')::uuid)<>'dead_letter' THEN
   RAISE EXCEPTION 'Stale expansion remained retryable'; END IF;
 -- Explicit reactivation restores only named facilities and matches reserved version.
 PERFORM pg_temp.restrict_access(f.reactivation_target,'soft_delete');
 BEGIN
   PERFORM pg_temp.prepare_access(f.reactivation_target,'reactivate');
   RAISE EXCEPTION 'Implicit facility restoration accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 job:=pg_temp.prepare_access(f.reactivation_target,'reactivate',NULL,ARRAY[f.facility],f.facility);
 restored:=pg_temp.finish_access(job);
 IF NOT (SELECT is_active FROM public.user_profiles WHERE id=f.reactivation_target)
   OR (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.reactivation_target)<>(job->>'desired_claim_version')::integer
   OR (SELECT count(*) FROM public.user_facility_access WHERE user_id=f.reactivation_target AND revoked_at IS NULL)<>1 THEN
   RAISE EXCEPTION 'Explicit reactivation or reserved version failed'; END IF;
 -- Choosing a primary facility uses exact-version synchronization even on an existing grant.
 job:=pg_temp.prepare_access(f.reactivation_target,'grant_facility',NULL,ARRAY[f.facility],f.facility);
 PERFORM pg_temp.finish_access(job);
 -- Last-facility revoke disables access and preserves attribution/history.
 PERFORM pg_temp.restrict_access(f.reactivation_target,'revoke_facility',NULL,f.facility);
 IF (SELECT is_active FROM public.user_profiles WHERE id=f.reactivation_target)
   OR EXISTS(SELECT 1 FROM public.user_facility_access WHERE user_id=f.reactivation_target AND revoked_at IS NULL) THEN
   RAISE EXCEPTION 'Last-facility revoke retained authority'; END IF;
 -- A repeated disable with a fresh command must cancel an already prepared reactivation.
 job:=pg_temp.prepare_access(f.reactivation_target,'reactivate',NULL,ARRAY[f.facility],f.facility);
 PERFORM pg_temp.restrict_access(f.reactivation_target,'disable');
 BEGIN
   PERFORM pg_temp.finish_access(job);
   RAISE EXCEPTION 'Repeated disable did not fence prepared reactivation';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM pg_temp.restrict_access(f.reactivation_target,'hard_delete');
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=f.reactivation_target)
   OR NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=f.reactivation_target AND deleted_at IS NOT NULL)
   OR NOT EXISTS(SELECT 1 FROM public.user_facility_access WHERE user_id=f.reactivation_target) THEN
   RAISE EXCEPTION 'Login retirement removed durable identity/history'; END IF;
 -- Promotion replay must remain a receipt even when a fresh role comparison now sees equality.
 job:=pg_temp.prepare_access(f.restriction_target,'promote','nurse','{}',NULL,'promotion-replay');
 PERFORM pg_temp.finish_access(job);
 restored:=pg_temp.restrict_access(f.restriction_target,'demote','nurse',NULL,'promotion-replay');
 IF restored->>'id'<>job->>'id' OR (SELECT auth_claim_version FROM public.user_profiles
   WHERE id=f.restriction_target)<>(job->>'desired_claim_version')::integer THEN
   RAISE EXCEPTION 'Promotion replay created a second authority change'; END IF;
 -- Revoke actor session before an expansion finalizes; it must not grant authority.
 job:=pg_temp.prepare_access(f.expansion_failure_target,'promote','nurse');
 DELETE FROM auth.sessions WHERE id=f.actor_session;
 BEGIN
   PERFORM pg_temp.finish_access(job);
   RAISE EXCEPTION 'Revoked actor authorized expansion';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO auth.sessions(id,user_id) VALUES(f.actor_session,f.actor);
END $$;

-- Version-1 compatibility: missing claim passes only before any authority change.
SELECT pg_temp.set_claims(legacy_user,legacy_session,NULL,'owner') FROM actor_fixture;
SELECT public.haven_assert_authorized_request();
UPDATE public.user_profiles SET app_role='manager' WHERE id=(SELECT legacy_user FROM actor_fixture);
SELECT pg_temp.expect_rejected('missing version after authority change');
SELECT pg_temp.set_claims(f.legacy_user,f.legacy_session,to_jsonb(p.auth_claim_version),'owner')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.legacy_user;
SELECT public.haven_assert_authorized_request();
DO $$ BEGIN IF haven.app_role()<>'manager'::public.app_role THEN RAISE EXCEPTION 'Immediate fresh integer version failed'; END IF; END $$;

-- Active owner receives current database authority despite stale caregiver JWT metadata.
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f actor_fixture%ROWTYPE; edge_actor jsonb; shell_actor jsonb; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  PERFORM public.haven_assert_authorized_request();
  edge_actor:=public.haven_current_edge_actor();
  shell_actor:=public.haven_current_shell_actor();
  IF haven.app_role()<>'owner'::public.app_role OR haven.organization_id()<>f.organization
     OR NOT haven.has_facility_access(f.facility) OR NOT haven.can_access_resident(f.resident)
     OR NOT EXISTS(SELECT 1 FROM public.residents WHERE id=f.resident) THEN RAISE EXCEPTION 'Current owner authority failed'; END IF;
  IF (edge_actor->>'user_id')::uuid<>f.actor
     OR (edge_actor->>'session_id')::uuid<>f.actor_session
     OR (edge_actor->>'organization_id')::uuid<>f.organization
     OR edge_actor->>'app_role'<>'owner'
     OR NOT (edge_actor->'accessible_facility_ids') @> pg_catalog.jsonb_build_array(f.facility) THEN
    RAISE EXCEPTION 'Atomic Edge actor snapshot incorrect';
  END IF;
  IF shell_actor->>'user_id'<>f.actor::text OR shell_actor->>'app_role'<>'owner'
     OR shell_actor->>'organization_id'<>f.organization::text OR (shell_actor->>'is_managed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Current shell actor snapshot incorrect';
  END IF;
  PERFORM public.allocate_incident_number(f.facility);
END $$;
RESET ROLE;

DO $$ BEGIN
  IF has_function_privilege('anon','public.haven_current_edge_actor()','EXECUTE')
     OR has_function_privilege('service_role','public.haven_current_edge_actor()','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.haven_current_edge_actor()','EXECUTE') THEN
    RAISE EXCEPTION 'Edge actor RPC grants incorrect';
  END IF;
  IF has_function_privilege('anon','public.haven_current_shell_actor()','EXECUTE')
     OR has_function_privilege('service_role','public.haven_current_shell_actor()','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.haven_current_shell_actor()','EXECUTE') THEN
    RAISE EXCEPTION 'Shell actor RPC grants incorrect';
  END IF;
END $$;

-- Workspace Storage owner policies require the current actor, not auth.uid alone.
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects(id,bucket_id,name) SELECT storage_object,'workspace-files',actor||'/'||storage_object||'/one.txt' FROM actor_fixture;
RESET ROLE;
UPDATE public.user_profiles SET app_role='caregiver' WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('stale owner after demotion');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f actor_fixture%ROWTYPE; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  IF EXISTS(SELECT 1 FROM storage.objects WHERE id=f.storage_object) THEN RAISE EXCEPTION 'Stale Storage SELECT authorized'; END IF;
  BEGIN INSERT INTO storage.objects(id,bucket_id,name) VALUES(f.storage_object_two,'workspace-files',f.actor||'/'||f.storage_object_two||'/two.txt');
    RAISE EXCEPTION 'Stale Storage INSERT authorized'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE storage.objects SET metadata='{"stale":true}' WHERE id=f.storage_object;
  DELETE FROM storage.objects WHERE id=f.storage_object;
END $$;
RESET ROLE;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE id=(SELECT storage_object FROM actor_fixture) AND metadata='{}') THEN
  RAISE EXCEPTION 'Stale Storage UPDATE/DELETE changed object'; END IF; END $$;

-- Fresh current caregiver token owns its path, but stale owner metadata cannot authorize question-bank DML.
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'owner')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF haven.app_role()<>'caregiver'::public.app_role OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE id=(SELECT storage_object FROM actor_fixture)) THEN
    RAISE EXCEPTION 'Current-role/stale-metadata check failed'; END IF;
  BEGIN INSERT INTO onboarding_questions(id,prompt,department,importance,answer_type)
    VALUES('sys001.forged-owner','forged','Security','critical','long_text');
    RAISE EXCEPTION 'Stale owner metadata authorized onboarding DML'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE storage.objects SET metadata='{"fresh":true}' WHERE id=(SELECT storage_object FROM actor_fixture);
  DELETE FROM storage.objects WHERE id=(SELECT storage_object FROM actor_fixture);
END $$;
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM storage.objects WHERE id=(SELECT storage_object FROM actor_fixture)) THEN RAISE EXCEPTION 'Fresh owner-path delete failed'; END IF; END $$;

-- Dedicated onboarding identity reads questions and writes only its current organization responses.
SELECT pg_temp.set_claims(onboarding_user,onboarding_session,'1'::jsonb,'owner') FROM actor_fixture;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f actor_fixture%ROWTYPE; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  PERFORM public.haven_assert_authorized_request();
  IF haven.jwt_app_role_text()<>'onboarding' OR haven.effective_onboarding_organization_id()<>f.organization
     OR NOT EXISTS(SELECT 1 FROM onboarding_questions WHERE id='sys001.authorization') THEN RAISE EXCEPTION 'Onboarding read denied'; END IF;
  INSERT INTO onboarding_responses(organization_id,question_id,value,entered_by_user_id)
    VALUES(f.organization,'sys001.authorization','allowed',f.onboarding_user);
  IF NOT EXISTS(SELECT 1 FROM onboarding_responses WHERE question_id='sys001.authorization' AND value='allowed') THEN RAISE EXCEPTION 'Onboarding write denied'; END IF;
END $$;
RESET ROLE;
UPDATE auth.users SET banned_until='infinity' WHERE id=(SELECT onboarding_user FROM actor_fixture);
SELECT pg_temp.expect_rejected('banned onboarding identity');
UPDATE auth.users SET banned_until=NULL WHERE id=(SELECT onboarding_user FROM actor_fixture);
SELECT public.haven_assert_authorized_request();
UPDATE auth.users SET deleted_at=now() WHERE id=(SELECT onboarding_user FROM actor_fixture);
SELECT pg_temp.expect_rejected('deleted onboarding Auth identity');
UPDATE auth.users SET deleted_at=NULL WHERE id=(SELECT onboarding_user FROM actor_fixture);
SELECT public.haven_assert_authorized_request();

-- Family access remains linked-resident-only and reacts immediately to revocation.
SELECT pg_temp.set_claims(family_user,family_session,NULL,'owner') FROM actor_fixture;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f actor_fixture%ROWTYPE; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  IF haven.app_role()<>'family'::public.app_role OR NOT haven.can_access_resident(f.resident)
     OR haven.can_access_resident(f.second_resident)
     OR NOT EXISTS(SELECT 1 FROM residents WHERE id=f.resident)
     OR EXISTS(SELECT 1 FROM residents WHERE id=f.second_resident) THEN RAISE EXCEPTION 'Family linked/unlinked boundary failed'; END IF;
END $$;
RESET ROLE;
UPDATE public.family_resident_links SET revoked_at=now() WHERE user_id=(SELECT family_user FROM actor_fixture);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF haven.can_access_resident((SELECT resident FROM actor_fixture))
  OR EXISTS(SELECT 1 FROM residents WHERE id=(SELECT resident FROM actor_fixture)) THEN RAISE EXCEPTION 'Revoked family link retained access'; END IF; END $$;
RESET ROLE;

-- Inactive/deleted/version/facility/session/Auth-user state each fails closed.
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('inactive');
UPDATE public.user_profiles SET is_active=true WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('reactivated old token');
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
UPDATE public.user_profiles SET deleted_at=now() WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('deleted');
UPDATE public.user_profiles SET deleted_at=NULL WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('restored old token');
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('facility revoked old token');
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
SELECT public.haven_assert_authorized_request();
DO $$ BEGIN IF haven.has_facility_access((SELECT facility FROM actor_fixture)) THEN RAISE EXCEPTION 'Fresh token retained revoked facility'; END IF; END $$;
UPDATE public.user_facility_access SET revoked_at=NULL WHERE user_id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('facility regrant old token');
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
DELETE FROM auth.sessions WHERE id=(SELECT actor_session FROM actor_fixture);
SELECT pg_temp.expect_rejected('missing session');
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF public.haven_current_edge_actor() IS NOT NULL THEN RAISE EXCEPTION 'Edge actor accepted missing session'; END IF; END $$;
RESET ROLE;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM actor_fixture;
SELECT public.haven_assert_authorized_request();
UPDATE auth.users SET banned_until='infinity' WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('managed auth ban');
UPDATE auth.users SET banned_until=NULL WHERE id=(SELECT actor FROM actor_fixture);
SELECT public.haven_assert_authorized_request();

-- Malformed/overflow identity and version inputs plus session-user mismatch.
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bad","session_id":"bad","auth_claim_version":1}',true);
SELECT pg_temp.expect_rejected('malformed sub/session');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',actor_session,
  'auth_claim_version','999999999999999999999999')::text,true) FROM actor_fixture;
SELECT pg_temp.expect_rejected('overflow version');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',actor_session,
  'auth_claim_version','1.5')::text,true) FROM actor_fixture;
SELECT pg_temp.expect_rejected('malformed version');
SELECT pg_temp.set_claims(f.actor,f.mismatch_session,to_jsonb(p.auth_claim_version),'owner')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
SELECT pg_temp.expect_rejected('session user mismatch');

-- PostgREST assertion bypasses machine identities; a service-only RPC remains callable.
CREATE OR REPLACE FUNCTION pg_temp.fail_parser_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.metadata->>'fact_id'=(SELECT parser_fail_fact::text FROM actor_fixture) THEN
    RAISE EXCEPTION 'injected parser audit failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sys001_fail_parser_audit BEFORE INSERT ON public.document_audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_parser_audit();
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public, haven TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
GRANT INSERT ON public.operation_audit_log TO service_role;
GRANT UPDATE ON public.user_profiles,public.facilities,public.user_facility_access,public.documents TO service_role;
GRANT DELETE ON public.chunks TO service_role;
UPDATE public.resident_observation_assignments SET released_at=now()
WHERE task_id=(SELECT rounding_task FROM actor_fixture) AND staff_id=(SELECT rounding_staff FROM actor_fixture);
INSERT INTO public.resident_observation_assignments(
  organization_id,facility_id,resident_id,task_id,staff_id,assignment_type,created_by
)
SELECT organization,facility,resident,rounding_task,rounding_other_staff,'reassignment',actor FROM actor_fixture;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE f actor_fixture%ROWTYPE; result jsonb; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  PERFORM public.haven_assert_authorized_request();
  result:=public.ai_tool_facility_directory(f.organization,f.actor,'caregiver',ARRAY[f.facility],f.facility);
  IF result IS NULL THEN RAISE EXCEPTION 'Machine service RPC failed'; END IF;
  result:=public.review_facility_launch_fact(
    f.parser_fact,'approve_and_apply_fact','approved',f.edge_admin,f.edge_admin_session,
    (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.edge_admin),f.organization
  );
  IF result->>'approval_status'<>'applied' OR result->>'replay'<>'false'
     OR NOT EXISTS(SELECT 1 FROM public.facility_launch_module_values
       WHERE source_fact_id=f.parser_fact AND superseded_at IS NULL) THEN
    RAISE EXCEPTION 'Parser atomic apply failed';
  END IF;
  result:=public.review_facility_launch_fact(
    f.parser_fact,'approve_and_apply_fact','approved',f.edge_admin,f.edge_admin_session,
    (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.edge_admin),f.organization
  );
  IF result->>'replay'<>'true'
     OR (SELECT count(*) FROM public.facility_launch_module_values WHERE source_fact_id=f.parser_fact)<>1
     OR (SELECT count(*) FROM public.document_audit_events WHERE metadata->>'fact_id'=f.parser_fact::text)<>1 THEN
    RAISE EXCEPTION 'Parser exact replay was not idempotent';
  END IF;
  BEGIN
    PERFORM public.review_facility_launch_fact(
      f.parser_null_fact,'approve_fact',NULL,f.edge_facility_admin,f.edge_facility_admin_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.edge_facility_admin),f.organization
    );
    RAISE EXCEPTION 'Facility admin reviewed organization-wide fact';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  result:=public.review_facility_launch_fact(
    f.parser_null_fact,'approve_fact','owner org-wide review',f.edge_admin,f.edge_admin_session,
    (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.edge_admin),f.organization
  );
  IF result->>'approval_status'<>'approved' THEN
    RAISE EXCEPTION 'Owner could not review organization-wide fact';
  END IF;
  BEGIN
    PERFORM public.review_facility_launch_fact(
      f.parser_fail_fact,'approve_and_apply_fact','must roll back',f.edge_admin,f.edge_admin_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.edge_admin),f.organization
    );
    RAISE EXCEPTION 'Parser audit failure did not abort';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'injected parser audit failure' THEN RAISE; END IF;
  END;
  IF (SELECT approval_status FROM public.document_extracted_facts WHERE id=f.parser_fail_fact)<>'pending'
     OR NOT EXISTS(SELECT 1 FROM public.facility_launch_module_values WHERE id=f.parser_fail_old_value AND superseded_at IS NULL)
     OR EXISTS(SELECT 1 FROM public.facility_launch_module_values WHERE source_fact_id=f.parser_fail_fact) THEN
    RAISE EXCEPTION 'Parser audit failure did not roll back all writes';
  END IF;
  UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id=f.edge_facility_admin AND facility_id=f.facility;
  BEGIN
    PERFORM public.review_facility_launch_fact(
      f.parser_fact,'approve_fact',NULL,f.edge_facility_admin,f.edge_facility_admin_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.edge_facility_admin),f.organization
    );
    RAISE EXCEPTION 'Revoked facility admin retained parser authority';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.create_kb_ingest_authorization_run(
    f.ingest_authorization_run,f.ingest_document,f.edge_admin,f.edge_admin_session,
    (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.edge_admin),f.organization,NULL
  );
  PERFORM public.create_kb_ingest_authorization_run(
    f.ingest_authorization_run,f.ingest_document,f.edge_admin,f.edge_admin_session,
    (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.edge_admin),f.organization,NULL
  );
  BEGIN
    PERFORM public.create_kb_ingest_authorization_run(
      f.ingest_authorization_run,f.ingest_document_two,f.edge_admin,f.edge_admin_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.edge_admin),f.organization,NULL
    );
    RAISE EXCEPTION 'Ingest receipt replay mismatch accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  PERFORM public.start_kb_ingest_authorization_mutation(f.ingest_authorization_run);
  PERFORM public.fail_kb_ingest_authority_change(f.ingest_authorization_run);
  IF EXISTS(SELECT 1 FROM public.chunks WHERE id=f.ingest_chunk)
     OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=f.ingest_document
       AND status='ingest_failed' AND ingest_last_error='authorization_changed'
       AND ingest_attempt_count=1 AND ingest_retry_at IS NULL)
     OR NOT EXISTS(SELECT 1 FROM public.ingest_authorization_runs
       WHERE id=f.ingest_authorization_run AND status='authorization_changed') THEN
    RAISE EXCEPTION 'Interrupted ingest cleanup failed';
  END IF;
  PERFORM public.fail_kb_ingest_authority_change(f.ingest_authorization_run);
  IF (SELECT ingest_attempt_count FROM public.documents WHERE id=f.ingest_document)<>1 THEN
    RAISE EXCEPTION 'Interrupted ingest cleanup was not idempotent';
  END IF;
  PERFORM public.create_kb_ingest_authorization_run(
    f.ingest_authorization_run_two,f.ingest_document_two,f.edge_admin,f.edge_admin_session,
    (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.edge_admin),f.organization,NULL
  );
  PERFORM public.start_kb_ingest_authorization_mutation(f.ingest_authorization_run_two);
  PERFORM public.fail_kb_ingest_authority_change(f.ingest_authorization_run_two);
  IF EXISTS(SELECT 1 FROM public.chunks WHERE id=f.ingest_chunk_two)
     OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=f.ingest_document_two
       AND status='ingest_failed' AND ingest_last_error='authorization_changed') THEN
    RAISE EXCEPTION 'Receipt cleanup depended on document uploader';
  END IF;
  BEGIN
    PERFORM public.complete_operation_task_review(f.operation_task,f.actor,'owner','stale role attempt','{}');
    RAISE EXCEPTION 'Service task RPC trusted stale actor role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT status FROM public.operation_task_instances WHERE id=f.operation_task)<>'pending' THEN
    RAISE EXCEPTION 'Rejected stale actor mutated operation task';
  END IF;
  BEGIN
    PERFORM public.defer_operation_task_review(
      f.defer_task,f.actor,'owner',now()+interval '2 days','stale actor defer',
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        'operation-defer-v1:'||f.actor::text||':'||f.defer_task::text,'UTF8'
      )),'hex')
    );
    RAISE EXCEPTION 'Service defer RPC trusted stale actor role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT status FROM public.operation_task_instances WHERE id=f.defer_task)<>'pending' THEN
    RAISE EXCEPTION 'Rejected stale actor mutated deferred task';
  END IF;
  BEGIN
    PERFORM public.apply_col_discovery_round_observation_plan(
      f.resident,f.actor,'owner',f.actor_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor)
    );
    RAISE EXCEPTION 'Service rounding RPC trusted stale actor role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.apply_col_discovery_round_observation_plan(
      f.resident,f.actor,'caregiver',f.mismatch_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor)
    );
    RAISE EXCEPTION 'Service discovery RPC accepted another user session';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.complete_rounding_task_review(
      f.rounding_task,f.actor,'caregiver',f.actor_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),
      f.organization,f.facility,f.rounding_staff,pg_temp.rounding_completion_payload()
    );
    RAISE EXCEPTION 'Stale task assignee completed after active reassignment';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT status FROM public.resident_observation_tasks WHERE id=f.rounding_task)<>'upcoming'
     OR EXISTS(SELECT 1 FROM public.resident_observation_logs WHERE task_id=f.rounding_task) THEN
    RAISE EXCEPTION 'Rejected stale assignee left a completion mutation';
  END IF;
END $$;
RESET ROLE;
DO $$ DECLARE f actor_fixture%ROWTYPE; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
 BEGIN
  PERFORM public.complete_operation_task_review(f.operation_task,f.actor,'caregiver','unassigned attempt','{}');
  RAISE EXCEPTION 'Caregiver completed unassigned operation task';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.defer_operation_task_review(f.defer_task,f.actor,'caregiver',now()+interval '2 days','unassigned attempt',
    encode(sha256(convert_to('operation-defer-v1:'||f.actor::text||':'||f.defer_task::text,'UTF8')),'hex'));
  RAISE EXCEPTION 'Caregiver deferred unassigned operation task';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM haven.assert_rounding_service_actor(f.actor,'caregiver',f.actor_session,NULL,
    f.organization,f.facility,false,true);
  RAISE EXCEPTION 'Rounding accepted missing claim at version above one';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id=f.actor AND facility_id=f.facility AND revoked_at IS NULL;
 BEGIN
  PERFORM haven.assert_rounding_service_actor(f.actor,'caregiver',f.actor_session,
    (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),f.organization,f.facility,false,true);
  RAISE EXCEPTION 'Rounding accepted absent facility grant';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.user_facility_access SET revoked_at=NULL WHERE user_id=f.actor AND facility_id=f.facility;
 UPDATE public.resident_observation_tasks SET assigned_staff_id=NULL WHERE id=f.rounding_reassign_task;
 UPDATE public.resident_observation_assignments SET released_at=now() WHERE task_id=f.rounding_reassign_task AND released_at IS NULL;
 BEGIN
  PERFORM public.complete_rounding_task_review(f.rounding_reassign_task,f.actor,'caregiver',f.actor_session,
    (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),f.organization,f.facility,
    f.rounding_staff,pg_temp.rounding_completion_payload());
  RAISE EXCEPTION 'Caregiver completed unassigned task';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.resident_observation_tasks SET assigned_staff_id=f.rounding_staff WHERE id=f.rounding_reassign_task;
END $$;
RESET ROLE;
UPDATE public.user_profiles SET app_role='owner' WHERE id=(SELECT actor FROM actor_fixture);
UPDATE public.staff SET employment_status='suspended' WHERE id=(SELECT rounding_staff FROM actor_fixture);
SET LOCAL ROLE service_role;
DO $$ DECLARE f actor_fixture%ROWTYPE; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  BEGIN
    PERFORM public.complete_rounding_task_review(
      f.rounding_task,f.actor,'owner',f.actor_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),
      f.organization,f.facility,f.rounding_staff,pg_temp.rounding_completion_payload()
    );
    RAISE EXCEPTION 'Manager without active staff completed rounding task';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT status FROM public.resident_observation_tasks WHERE id=f.rounding_task)<>'upcoming'
     OR EXISTS(SELECT 1 FROM public.resident_observation_logs WHERE task_id=f.rounding_task) THEN
    RAISE EXCEPTION 'Manager without staff left a completion mutation';
  END IF;
END $$;
RESET ROLE;
UPDATE public.staff SET employment_status='active' WHERE id=(SELECT rounding_staff FROM actor_fixture);
UPDATE public.resident_observation_assignments SET released_at=now()
WHERE task_id=(SELECT rounding_task FROM actor_fixture) AND staff_id=(SELECT rounding_other_staff FROM actor_fixture)
  AND released_at IS NULL;
UPDATE public.resident_observation_assignments SET released_at=NULL
WHERE task_id=(SELECT rounding_task FROM actor_fixture) AND staff_id=(SELECT rounding_staff FROM actor_fixture);
UPDATE public.staff SET employment_status='terminated' WHERE id=(SELECT rounding_other_staff FROM actor_fixture);
SET LOCAL ROLE service_role;
DO $$ DECLARE f actor_fixture%ROWTYPE; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  BEGIN
    PERFORM public.reassign_rounding_task_review(
      f.rounding_reassign_task,f.rounding_other_staff,'terminated assignee',f.actor,'owner',f.actor_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),f.organization,f.facility
    );
    RAISE EXCEPTION 'Terminated staff accepted for rounding reassignment';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.update_rounding_integrity_flag_review(
      f.rounding_flag,'assign','terminated assignee',f.rounding_other_staff,f.actor,'owner',f.actor_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),f.organization,f.facility
    );
    RAISE EXCEPTION 'Terminated staff accepted for integrity assignment';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT assigned_staff_id FROM public.resident_observation_tasks WHERE id=f.rounding_reassign_task)<>f.rounding_staff
     OR (SELECT assigned_to_staff_id FROM public.resident_observation_integrity_flags WHERE id=f.rounding_flag) IS NOT NULL THEN
    RAISE EXCEPTION 'Rejected inactive assignee changed rounding state';
  END IF;
END $$;
RESET ROLE;
UPDATE public.staff SET employment_status='active' WHERE id=(SELECT rounding_other_staff FROM actor_fixture);
SET LOCAL ROLE service_role;
DO $$ DECLARE f actor_fixture%ROWTYPE; first_result jsonb; replay_result jsonb; request_key text; rounding_plan uuid; rounding_replay uuid; terminal_audit_before integer; defer_at timestamptz:=pg_catalog.clock_timestamp()+interval '1 second'; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  IF public.complete_operation_task_review(f.operation_task,f.actor,'owner','current owner completion','{}')<>'completed' THEN
    RAISE EXCEPTION 'Current service task actor could not complete task';
  END IF;
  IF (public.complete_rounding_task_review(
      f.rounding_task,f.actor,'owner',f.actor_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),
      f.organization,f.facility,f.rounding_staff,pg_temp.rounding_completion_payload()
    )->>'status')<>'completed_on_time' THEN
    RAISE EXCEPTION 'Current rounding manager could not complete task';
  END IF;
  IF (SELECT count(*) FROM public.resident_observation_logs WHERE task_id=f.rounding_task)<>1
     OR (SELECT completed_log_id FROM public.resident_observation_tasks WHERE id=f.rounding_task) IS NULL THEN
    RAISE EXCEPTION 'Atomic rounding completion did not persist one log receipt';
  END IF;
  SELECT count(*) INTO terminal_audit_before FROM public.audit_log
  WHERE (table_name='resident_observation_tasks' AND record_id=f.rounding_terminal_task)
     OR (table_name='resident_observation_assignments' AND record_id=f.rounding_terminal_assignment);
  BEGIN
    PERFORM public.reassign_rounding_task_review(
      f.rounding_terminal_task,f.rounding_other_staff,'terminal overwrite attempt',f.actor,'owner',f.actor_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),f.organization,f.facility
    );
    RAISE EXCEPTION 'Terminal rounding task was reassigned';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'Observation task cannot be reassigned from its current status' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.resident_observation_tasks WHERE id=f.rounding_terminal_task)<>'completed_on_time'
     OR (SELECT completed_log_id FROM public.resident_observation_tasks WHERE id=f.rounding_terminal_task)<>f.rounding_terminal_log
     OR (SELECT count(*) FROM public.resident_observation_assignments WHERE task_id=f.rounding_terminal_task)<>1
     OR (SELECT count(*) FROM public.audit_log
         WHERE (table_name='resident_observation_tasks' AND record_id=f.rounding_terminal_task)
            OR (table_name='resident_observation_assignments' AND record_id=f.rounding_terminal_assignment))<>terminal_audit_before THEN
    RAISE EXCEPTION 'Rejected terminal reassignment changed status, receipt, assignment, or audit';
  END IF;
  IF (public.reassign_rounding_task_review(
      f.rounding_reassign_task,f.rounding_other_staff,'current reassignment',f.actor,'owner',f.actor_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),f.organization,f.facility
    )->>'status')<>'reassigned' THEN RAISE EXCEPTION 'Current rounding reassignment failed'; END IF;
  IF (public.update_rounding_integrity_flag_review(
      f.rounding_flag,'assign','current assignment',f.rounding_other_staff,f.actor,'owner',f.actor_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),f.organization,f.facility
    )->>'assigned_staff_id') IS DISTINCT FROM f.rounding_other_staff::text THEN
    RAISE EXCEPTION 'Current integrity assignment failed';
  END IF;
  IF public.generate_rounding_tasks_review(
      jsonb_build_array(jsonb_build_object(
        'organization_id',f.organization,'facility_id',f.facility,'resident_id',f.resident,
        'plan_id',f.rounding_plan,'plan_rule_id',f.rounding_rule,'assigned_staff_id',f.rounding_other_staff,
        'scheduled_for',now()+interval '2 hours','due_at',now()+interval '3 hours',
        'grace_ends_at',now()+interval '3 hours 15 minutes','status','upcoming','notes','SYS-001 generation proof'
      )),f.actor,'owner',f.actor_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor),f.organization,f.facility
    )<>1 THEN RAISE EXCEPTION 'Current rounding generation failed'; END IF;
  BEGIN
    PERFORM public.apply_col_discovery_round_observation_plan(
      f.resident,f.actor,'owner',f.mismatch_session,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor)
    );
    RAISE EXCEPTION 'Discovery plan accepted another user session for a current owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  rounding_plan:=public.apply_col_discovery_round_observation_plan(
    f.resident,f.actor,'owner',f.actor_session,
    (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor)
  );
  rounding_replay:=public.apply_col_discovery_round_observation_plan(
    f.resident,f.actor,'owner',f.actor_session,
    (SELECT auth_claim_version FROM public.user_profiles WHERE id=f.actor)
  );
  IF rounding_plan IS NULL OR rounding_replay IS DISTINCT FROM rounding_plan
     OR (SELECT created_by FROM public.resident_observation_plans WHERE id=rounding_plan) IS DISTINCT FROM f.actor THEN
    RAISE EXCEPTION 'Current service rounding actor did not receive one attributed replay-safe plan';
  END IF;
  request_key:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'operation-defer-v1:'||f.actor::text||':'||f.defer_task::text,'UTF8'
  )),'hex');
  first_result:=public.defer_operation_task_review(f.defer_task,f.actor,'owner',defer_at,'Atomic defer proof',request_key);
  PERFORM pg_catalog.pg_sleep(1.1);
  replay_result:=public.defer_operation_task_review(f.defer_task,f.actor,'owner',defer_at,'Atomic defer proof',request_key);
  IF first_result->>'new_task_id' IS DISTINCT FROM replay_result->>'new_task_id'
     OR coalesce((replay_result->>'replayed')::boolean,false) IS NOT TRUE
     OR (SELECT status FROM public.operation_task_instances WHERE id=f.defer_task)<>'deferred'
     OR (SELECT count(*) FROM public.operation_audit_log WHERE task_instance_id=f.defer_task AND event_type='deferred')<>1 THEN
    RAISE EXCEPTION 'Atomic defer replay did not return its single committed receipt';
  END IF;
  BEGIN
    PERFORM public.defer_operation_task_review(f.defer_task,f.actor,'owner',defer_at+interval '1 hour','Changed payload',request_key);
    RAISE EXCEPTION 'Changed defer payload reused committed request key';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'This defer request was already saved with different content. Refresh the task before retrying' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$ DECLARE f actor_fixture%ROWTYPE; request_key text; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  request_key:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'operation-defer-v1:'||f.actor::text||':'||f.defer_failure_task::text,'UTF8'
  )),'hex');
  BEGIN
    PERFORM public.defer_operation_task_review(f.defer_failure_task,f.actor,'owner',pg_catalog.clock_timestamp()-interval '1 second','Past request',request_key);
    RAISE EXCEPTION 'Brand-new past defer was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Deferred time must be in the future' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.defer_operation_task_review(f.defer_failure_task,f.actor,'owner',pg_catalog.clock_timestamp(),'Equal-now request',request_key);
    RAISE EXCEPTION 'Brand-new equal-now defer was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Deferred time must be in the future' THEN RAISE; END IF; END;
END $$;
RESET ROLE;

CREATE FUNCTION pg_temp.fail_defer_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.task_instance_id=(SELECT defer_failure_task FROM actor_fixture) THEN RAISE EXCEPTION 'injected defer audit failure'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sys001_fail_defer_audit BEFORE INSERT ON public.operation_audit_log
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_defer_audit();
SET LOCAL ROLE service_role;
DO $$ DECLARE f actor_fixture%ROWTYPE; request_key text; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  request_key:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'operation-defer-v1:'||f.actor::text||':'||f.defer_failure_task::text,'UTF8'
  )),'hex');
  BEGIN
    PERFORM public.defer_operation_task_review(f.defer_failure_task,f.actor,'owner',now()+interval '3 days','Failure injection',request_key);
    RAISE EXCEPTION 'Injected defer audit failure did not roll back';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected defer audit failure' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DROP TRIGGER sys001_fail_defer_audit ON public.operation_audit_log;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.operation_task_instances
    WHERE id=(SELECT defer_failure_task FROM actor_fixture) AND (status<>'pending' OR deferred_replacement_task_id IS NOT NULL))
    OR (SELECT count(*) FROM public.operation_task_instances WHERE template_name='SYS-001 atomic defer failure task')<>1 THEN
    RAISE EXCEPTION 'Atomic defer failure left partial task state';
  END IF;
END $$;

-- Function posture and representative RLS plans prove locked helpers + named InitPlans.
DO $$ BEGIN
  IF has_function_privilege('authenticated','haven.current_authorized_actor()','EXECUTE')
     OR has_function_privilege('service_role','haven.current_authorized_actor()','EXECUTE') THEN RAISE EXCEPTION 'Internal actor resolver exposed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='haven' AND p.proname IN('current_authorized_actor','authorized_user_id','organization_id','app_role',
      'has_facility_access','accessible_facility_ids','can_access_resident','jwt_app_role_text',
      'can_access_onboarding_workspace','effective_onboarding_organization_id','is_onboarding_org_admin_jwt')
      AND (NOT p.prosecdef OR NOT ('search_path=""'=ANY(p.proconfig)))) THEN RAISE EXCEPTION 'Authorization helper posture failed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
    AND policyname LIKE 'storage_wf_owner_%' AND coalesce(qual,with_check) NOT LIKE '%authorized_user_id%') THEN
    RAISE EXCEPTION 'Workspace Storage owner policy lacks current actor'; END IF;
  IF has_function_privilege('service_role','public.apply_col_discovery_round_observation_plan(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.apply_col_discovery_round_observation_plan(uuid,uuid,text,uuid,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.apply_col_discovery_round_observation_plan(uuid,uuid,text,uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Rounding service RPC grants incorrect';
  END IF;
  IF has_function_privilege('authenticated','public.complete_rounding_task_review(uuid,uuid,text,uuid,integer,uuid,uuid,uuid,jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.complete_rounding_task_review(uuid,uuid,text,uuid,integer,uuid,uuid,uuid,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.reassign_rounding_task_review(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.reassign_rounding_task_review(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.update_rounding_integrity_flag_review(uuid,text,text,uuid,uuid,text,uuid,integer,uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.update_rounding_integrity_flag_review(uuid,text,text,uuid,uuid,text,uuid,integer,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.generate_rounding_tasks_review(jsonb,uuid,text,uuid,integer,uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.generate_rounding_tasks_review(jsonb,uuid,text,uuid,integer,uuid,uuid)','EXECUTE')
     OR has_function_privilege('service_role','haven.assert_rounding_service_actor(uuid,text,uuid,integer,uuid,uuid,boolean,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Rounding command grants incorrect';
  END IF;
END $$;

-- Scaled operational/reporting fixtures exercise real hot policies. Restore the
-- actor's current owner role so both policy contracts legitimately return rows.
UPDATE public.user_profiles SET app_role='owner' WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
INSERT INTO public.daily_logs(resident_id,facility_id,organization_id,log_date,shift,logged_by,general_notes)
SELECT f.resident,f.facility,f.organization,current_date-series,'day'::public.shift_type,f.actor,'SYS001-PERF'
FROM actor_fixture f CROSS JOIN generate_series(1,500) AS series;
INSERT INTO public.report_runs(organization_id,source_type,source_id,generated_by_user_id,run_scope_json,status)
SELECT f.organization,'template'::public.report_source_type,f.perf_marker,f.actor,jsonb_build_object('facility_id',f.facility),'running'::public.report_run_status
FROM actor_fixture f CROSS JOIN generate_series(1,500);
ANALYZE public.daily_logs;
ANALYZE public.report_runs;

CREATE TEMP TABLE explain_lines(path text,line_no bigserial,line text);
GRANT INSERT,SELECT ON explain_lines TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE explain_lines_line_no_seq TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE plan_line record; f actor_fixture%ROWTYPE; BEGIN
  SELECT * INTO STRICT f FROM actor_fixture;
  IF (SELECT count(*) FROM public.daily_logs WHERE general_notes='SYS001-PERF')<>500
     OR (SELECT count(*) FROM public.report_runs WHERE source_id=f.perf_marker)<>500 THEN
    RAISE EXCEPTION 'Scaled hot-policy fixtures were not visible';
  END IF;
  FOR plan_line IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, VERBOSE) SELECT id FROM public.residents LIMIT 5' LOOP
    INSERT INTO explain_lines(path,line) VALUES('residents',plan_line."QUERY PLAN");
  END LOOP;
  FOR plan_line IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, VERBOSE) SELECT id FROM public.daily_logs WHERE general_notes=''SYS001-PERF''' LOOP
    INSERT INTO explain_lines(path,line) VALUES('daily_logs',plan_line."QUERY PLAN");
  END LOOP;
  FOR plan_line IN EXECUTE format(
    'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, VERBOSE) SELECT id FROM public.report_runs WHERE source_id=%L::uuid',f.perf_marker
  ) LOOP
    INSERT INTO explain_lines(path,line) VALUES('report_runs',plan_line."QUERY PLAN");
  END LOOP;
END $$;
RESET ROLE;
DO $$ DECLARE path_name text; helper_name text; BEGIN
  FOREACH path_name IN ARRAY ARRAY['residents','daily_logs','report_runs'] LOOP
    FOREACH helper_name IN ARRAY ARRAY['haven.organization_id()','haven.app_role()','haven.accessible_facility_ids()'] LOOP
      IF NOT EXISTS(
        SELECT 1
        FROM explain_lines init_line
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            (SELECT min(next_init.line_no) FROM explain_lines next_init
             WHERE next_init.path=init_line.path AND next_init.line_no>init_line.line_no
               AND next_init.line LIKE '%InitPlan%'),
            (SELECT max(last_line.line_no)+1 FROM explain_lines last_line WHERE last_line.path=init_line.path)
          ) AS next_init_line_no
        ) block_end
        JOIN explain_lines helper_line ON helper_line.path=init_line.path
          AND helper_line.line_no>init_line.line_no AND helper_line.line_no<block_end.next_init_line_no
        JOIN explain_lines execution_line ON execution_line.path=init_line.path
          AND execution_line.line_no>=init_line.line_no AND execution_line.line_no<block_end.next_init_line_no
        WHERE init_line.path=path_name AND init_line.line LIKE '%InitPlan%'
          AND helper_line.line LIKE '%'||helper_name||'%'
          AND execution_line.line LIKE '%loops=1%'
      ) THEN RAISE EXCEPTION '% policy lacks a same-block loops=1 InitPlan for %',path_name,helper_name; END IF;
    END LOOP;
  END LOOP;
END $$;

ROLLBACK;
