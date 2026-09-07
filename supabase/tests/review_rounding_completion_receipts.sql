-- Section 2 rollback-only fixture. Set -v rounding_before=1 to reproduce approved baseline defects.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'role','') $$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
CREATE TEMP TABLE rounding_fixture AS
SELECT gen_random_uuid() actor,gen_random_uuid() actor_session,gen_random_uuid() staff_id,
 gen_random_uuid() other_actor,gen_random_uuid() other_session,gen_random_uuid() other_staff,
 gen_random_uuid() plan,gen_random_uuid() rule,gen_random_uuid() task,
 gen_random_uuid() direct_task,gen_random_uuid() rollback_task,gen_random_uuid() request_id,
 f.organization_id organization,f.id facility,r.id resident,now()-interval '10 minutes' observed_at
FROM public.facilities f JOIN public.residents r ON r.facility_id=f.id AND r.organization_id=f.organization_id
WHERE f.deleted_at IS NULL AND r.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM rounding_fixture) THEN RAISE EXCEPTION 'Seeded facility required'; END IF; END $$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT actor,actor||'@rounding.invalid','{}'::jsonb,'{}'::jsonb FROM rounding_fixture
UNION ALL SELECT other_actor,other_actor||'@rounding.invalid','{}'::jsonb,'{}'::jsonb FROM rounding_fixture;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
SELECT actor,organization,actor||'@rounding.invalid','Section 2 caregiver','caregiver'::public.app_role,true FROM rounding_fixture
UNION ALL SELECT other_actor,organization,other_actor||'@rounding.invalid','Section 2 manager','facility_admin'::public.app_role,true FROM rounding_fixture;
INSERT INTO auth.sessions(id,user_id)
SELECT actor_session,actor FROM rounding_fixture UNION ALL SELECT other_session,other_actor FROM rounding_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
SELECT actor,facility,organization FROM rounding_fixture UNION ALL SELECT other_actor,facility,organization FROM rounding_fixture;
INSERT INTO public.staff(id,user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date)
SELECT staff_id,actor,facility,organization,'Section 2','Caregiver','cna'::public.staff_role,'active'::public.employment_status,current_date FROM rounding_fixture
UNION ALL SELECT other_staff,other_actor,facility,organization,'Section 2','Manager','cna'::public.staff_role,'active'::public.employment_status,current_date FROM rounding_fixture;
INSERT INTO public.resident_observation_plans(id,organization_id,facility_id,resident_id,status,source_type,effective_from,rationale)
SELECT plan,organization,facility,resident,'active','manual',now(),'Section 2 rounding receipt integrity regression fixture' FROM rounding_fixture;
INSERT INTO public.resident_observation_plan_rules(id,plan_id,organization_id,facility_id,resident_id,interval_type,interval_minutes,grace_minutes)
SELECT rule,plan,organization,facility,resident,'fixed_minutes',60,15 FROM rounding_fixture;
INSERT INTO public.resident_observation_tasks(id,organization_id,facility_id,resident_id,plan_id,plan_rule_id,assigned_staff_id,scheduled_for,due_at,grace_ends_at,status)
SELECT task,organization,facility,resident,plan,rule,staff_id,now()-interval '1 hour',now(),now()+interval '15 minutes','upcoming'::public.resident_observation_task_status FROM rounding_fixture
UNION ALL SELECT direct_task,organization,facility,resident,plan,rule,staff_id,now(),now()+interval '1 hour',now()+interval '75 minutes','upcoming'::public.resident_observation_task_status FROM rounding_fixture
UNION ALL SELECT rollback_task,organization,facility,resident,plan,rule,staff_id,now(),now()+interval '2 hours',now()+interval '135 minutes','upcoming'::public.resident_observation_task_status FROM rounding_fixture;
GRANT SELECT ON rounding_fixture TO authenticated,service_role;
CREATE FUNCTION pg_temp.round_payload(p_request uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('request_id',coalesce(p_request,request_id),'observed_at',observed_at,
 'quick_status','not_found','late_reason','Resident checked during earlier outage',
 'entered_at',now(),'entry_mode','late','completion_status','completed_on_time',
 'exception_type','resident_not_found','exception_severity','medium','exception_present',true) FROM rounding_fixture
$$;
CREATE FUNCTION pg_temp.round_complete(p_task uuid DEFAULT NULL,p_payload jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.complete_rounding_task_review(coalesce(p_task,task),actor,'caregiver',actor_session,
 (SELECT auth_claim_version FROM public.user_profiles WHERE id=actor),organization,facility,staff_id,
 coalesce(p_payload,pg_temp.round_payload())) FROM rounding_fixture
$$;
CREATE FUNCTION pg_temp.round_claims(p_manager boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('sub',CASE WHEN p_manager THEN other_actor ELSE actor END,
 'session_id',CASE WHEN p_manager THEN other_session ELSE actor_session END,'role','authenticated',
 'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=CASE WHEN p_manager THEN other_actor ELSE actor END),'app_role',CASE WHEN p_manager THEN 'facility_admin' ELSE 'caregiver' END)::text,true)::void FROM rounding_fixture
$$;
\if :{?rounding_before}
SET LOCAL ROLE service_role;
DO $$ DECLARE first_result jsonb; BEGIN
 first_result:=pg_temp.round_complete();
 BEGIN
  PERFORM pg_temp.round_complete();
  RAISE EXCEPTION 'Expected baseline retry rejection was absent';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Observation task is no longer completable' THEN RAISE; END IF;
  RAISE NOTICE 'REPRODUCED SYS-003: identical lost-response replay fails despite committed log %',first_result->>'log_id';
 END;
 IF EXISTS(SELECT 1 FROM public.resident_observation_integrity_flags WHERE log_id=(first_result->>'log_id')::uuid) THEN
  RAISE EXCEPTION 'Unexpected baseline transactional integrity flag';
 END IF;
 RAISE NOTICE 'REPRODUCED SYS-003: atomic core commits late exception completion without required integrity flag';
END $$;
RESET ROLE;
-- Hosted defaults grant these tables; explicit grant makes the local role fixture reflect that API posture.
GRANT UPDATE ON public.resident_observation_tasks,public.resident_observation_logs TO authenticated;
SELECT pg_temp.round_claims();
SET LOCAL ROLE authenticated;
UPDATE public.resident_observation_tasks SET status='completed_on_time' WHERE id=(SELECT direct_task FROM rounding_fixture);
UPDATE public.resident_observation_logs SET observed_at=observed_at-interval '1 day' WHERE task_id=(SELECT task FROM rounding_fixture);
DO $$ BEGIN
 IF (SELECT status FROM public.resident_observation_tasks WHERE id=(SELECT direct_task FROM rounding_fixture))<>'completed_on_time' THEN RAISE EXCEPTION 'Baseline task bypass absent'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.resident_observation_logs WHERE task_id=(SELECT task FROM rounding_fixture) AND observed_at<(SELECT observed_at FROM rounding_fixture)) THEN RAISE EXCEPTION 'Baseline log bypass absent'; END IF;
 RAISE NOTICE 'REPRODUCED SYS-004: assigned caregiver directly finalizes task without log and rewrites clinical observation time';
END $$;
RESET ROLE;
ROLLBACK;
\quit
\endif
REVOKE SELECT ON public.rounding_completion_receipts FROM authenticated;

CREATE FUNCTION pg_temp.round_assert(p_ok boolean,p_label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %',p_label; END IF;
 RAISE NOTICE 'PASS: %',p_label;
END $$;
CREATE FUNCTION pg_temp.round_reject(p_sql text,p_code text,p_label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>p_code THEN RAISE EXCEPTION 'FAIL: % expected %, got %: %',p_label,p_code,SQLSTATE,SQLERRM; END IF;
  RAISE NOTICE 'PASS: %',p_label; RETURN;
 END;
 RAISE EXCEPTION 'FAIL: % unexpectedly succeeded',p_label;
END $$;
CREATE TEMP TABLE rounding_results(first_result jsonb);
GRANT SELECT,INSERT ON rounding_results TO service_role;
GRANT SELECT ON rounding_results TO authenticated;
SET LOCAL ROLE service_role;
INSERT INTO rounding_results SELECT pg_temp.round_complete();
SELECT pg_temp.round_assert((SELECT first_result->>'status'='completed_on_time' AND (first_result->>'integrityFlagCreated')::boolean FROM rounding_results),'core and late integrity commit together');
SELECT pg_temp.round_assert((SELECT count(*)=1 FROM public.resident_observation_logs WHERE task_id=(SELECT task FROM rounding_fixture)),'one task log');
SELECT pg_temp.round_assert((SELECT count(*)=1 FROM public.resident_observation_exceptions WHERE log_id=(SELECT (first_result->>'log_id')::uuid FROM rounding_results)),'one linked exception');
SELECT pg_temp.round_assert((SELECT count(*)=1 FROM public.resident_observation_integrity_flags WHERE log_id=(SELECT (first_result->>'log_id')::uuid FROM rounding_results)),'one linked integrity flag');
SELECT pg_temp.round_assert((SELECT count(*)=1 FROM public.rounding_completion_receipts WHERE id=(SELECT request_id FROM rounding_fixture)),'one durable receipt');
CREATE TEMP TABLE rounding_audit_before AS SELECT count(*) n FROM public.audit_log;
SELECT pg_temp.round_assert((pg_temp.round_complete()-'replayed')=(SELECT first_result-'replayed' FROM rounding_results),'identical replay returns original response');
SELECT pg_temp.round_assert((pg_temp.round_complete()->>'replayed')::boolean,'identical retry is acknowledged as replay');
SELECT pg_temp.round_assert((pg_temp.round_complete(NULL,pg_temp.round_payload()||jsonb_build_object('offline',true,'entered_at',now()+interval '1 day','entry_mode','offline_synced','completion_status','completed_late'))-'replayed')=(SELECT first_result-'replayed' FROM rounding_results),'online to offline replay ignores delivery and server-derived metadata');
SELECT pg_temp.round_assert((SELECT count(*) FROM public.audit_log)=(SELECT n FROM rounding_audit_before),'replay does not append audit or clinical rows');
SELECT pg_temp.round_reject('SELECT pg_temp.round_complete(NULL,pg_temp.round_payload()||''{"note":"Changed observation"}''::jsonb)','23505','same request with changed clinical payload conflicts');
SELECT pg_temp.round_reject('SELECT pg_temp.round_complete((SELECT direct_task FROM rounding_fixture))','23505','same request with changed task conflicts');
SELECT pg_temp.round_reject('SELECT pg_temp.round_complete(NULL,pg_temp.round_payload(gen_random_uuid()))','P0001','different request cannot complete finished task');
SELECT pg_temp.round_reject($q$SELECT public.complete_rounding_task_review(task,other_actor,'facility_admin',other_session,(SELECT auth_claim_version FROM public.user_profiles WHERE id=other_actor),organization,facility,other_staff,pg_temp.round_payload()) FROM rounding_fixture$q$,'23505','another authorized actor cannot replay somebody else receipt');
SELECT pg_temp.round_reject($q$SELECT public.complete_rounding_task_review(task,actor,'caregiver',actor_session,(SELECT auth_claim_version FROM public.user_profiles WHERE id=actor),gen_random_uuid(),facility,staff_id,pg_temp.round_payload()) FROM rounding_fixture$q$,'P0002','foreign organization task is hidden');
SELECT pg_temp.round_reject($q$SELECT public.complete_rounding_task_review(task,actor,'caregiver',actor_session,(SELECT auth_claim_version FROM public.user_profiles WHERE id=actor),organization,gen_random_uuid(),staff_id,pg_temp.round_payload()) FROM rounding_fixture$q$,'P0002','foreign facility task is hidden');
SELECT pg_temp.round_reject($q$SELECT public.complete_rounding_task_review(task,actor,'owner',actor_session,(SELECT auth_claim_version FROM public.user_profiles WHERE id=actor),organization,facility,staff_id,pg_temp.round_payload()) FROM rounding_fixture$q$,'42501','stale claimed role denies replay');
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id=(SELECT actor FROM rounding_fixture) AND facility_id=(SELECT facility FROM rounding_fixture);
SET LOCAL ROLE service_role;
SELECT pg_temp.round_reject('SELECT pg_temp.round_complete()','42501','revocation denies receipt replay');
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=NULL WHERE user_id=(SELECT actor FROM rounding_fixture) AND facility_id=(SELECT facility FROM rounding_fixture);
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT actor FROM rounding_fixture);
SET LOCAL ROLE service_role;
SELECT pg_temp.round_reject('SELECT pg_temp.round_complete()','42501','disabled actor cannot replay');
RESET ROLE;
UPDATE public.user_profiles SET is_active=true WHERE id=(SELECT actor FROM rounding_fixture);
UPDATE public.staff SET employment_status='terminated' WHERE id=(SELECT staff_id FROM rounding_fixture);
SET LOCAL ROLE service_role;
SELECT pg_temp.round_reject('SELECT pg_temp.round_complete()','42501','terminated staff cannot replay');
RESET ROLE;
UPDATE public.staff SET employment_status='active' WHERE id=(SELECT staff_id FROM rounding_fixture);
DELETE FROM auth.sessions WHERE id=(SELECT actor_session FROM rounding_fixture);
SET LOCAL ROLE service_role;
SELECT pg_temp.round_reject('SELECT pg_temp.round_complete()','42501','deleted session cannot replay');
RESET ROLE;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM rounding_fixture;
UPDATE public.resident_observation_tasks SET assigned_staff_id=(SELECT other_staff FROM rounding_fixture) WHERE id=(SELECT task FROM rounding_fixture);
SET LOCAL ROLE service_role;
SELECT pg_temp.round_reject('SELECT pg_temp.round_complete()','42501','changed assignment denies receipt replay');
RESET ROLE;
UPDATE public.resident_observation_tasks SET assigned_staff_id=(SELECT staff_id FROM rounding_fixture) WHERE id=(SELECT task FROM rounding_fixture);

-- Failure injection is test-only and rolled back. No production escape hatch.
CREATE FUNCTION pg_temp.fail_rounding_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('rounding_test.fail_stage',true)=TG_TABLE_NAME THEN RAISE EXCEPTION 'injected rounding stage failure'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER test_round_log BEFORE INSERT ON public.resident_observation_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_rounding_write();
CREATE TRIGGER test_round_exception BEFORE INSERT ON public.resident_observation_exceptions FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_rounding_write();
CREATE TRIGGER test_round_task BEFORE UPDATE ON public.resident_observation_tasks FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_rounding_write();
CREATE TRIGGER test_round_integrity BEFORE INSERT ON public.resident_observation_integrity_flags FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_rounding_write();
CREATE TRIGGER test_round_receipt BEFORE INSERT ON public.rounding_completion_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_rounding_write();
CREATE TRIGGER test_round_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_rounding_write();
SET LOCAL ROLE service_role;
DO $$ DECLARE stage text; audit_before bigint; BEGIN
 FOREACH stage IN ARRAY ARRAY['resident_observation_logs','resident_observation_exceptions','resident_observation_tasks','resident_observation_integrity_flags','rounding_completion_receipts','audit_log'] LOOP
  SELECT count(*) INTO audit_before FROM public.audit_log;
  PERFORM set_config('rounding_test.fail_stage',stage,true);
  PERFORM pg_temp.round_reject('SELECT pg_temp.round_complete((SELECT rollback_task FROM rounding_fixture),pg_temp.round_payload(gen_random_uuid()))','P0001','rollback on '||stage||' failure');
  PERFORM set_config('rounding_test.fail_stage','',true);
  PERFORM pg_temp.round_assert(
   NOT EXISTS(SELECT 1 FROM public.resident_observation_logs WHERE task_id=(SELECT rollback_task FROM rounding_fixture))
   AND NOT EXISTS(SELECT 1 FROM public.rounding_completion_receipts WHERE task_id=(SELECT rollback_task FROM rounding_fixture))
   AND (SELECT status='upcoming' AND completed_log_id IS NULL FROM public.resident_observation_tasks WHERE id=(SELECT rollback_task FROM rounding_fixture))
   AND (SELECT count(*) FROM public.audit_log)=audit_before,'no partial state after '||stage||' failure');
 END LOOP;
END $$;
RESET ROLE;

-- Column ACL, RLS, and invoker guards all remain effective even with forged settings.
SELECT pg_temp.round_claims();
SET LOCAL ROLE authenticated;
SELECT set_config('haven.rounding_command','trusted',true),set_config('haven.role_hint','service_role',true);
SELECT pg_temp.round_reject($q$UPDATE public.resident_observation_logs SET observed_at=now() WHERE task_id=(SELECT task FROM rounding_fixture)$q$,'42501','direct observation edit denied');
SELECT pg_temp.round_reject($q$INSERT INTO public.resident_observation_logs(organization_id,facility_id,resident_id,task_id,staff_id,observed_at,quick_status) SELECT organization,facility,resident,direct_task,staff_id,now(),'awake' FROM rounding_fixture$q$,'42501','direct observation insertion denied');
SELECT pg_temp.round_reject($q$UPDATE public.resident_observation_tasks SET completed_log_id=(SELECT (first_result->>'log_id')::uuid FROM rounding_results) WHERE id=(SELECT direct_task FROM rounding_fixture)$q$,'42501','direct completed-log pointer denied');
WITH changed AS(UPDATE public.resident_observation_tasks SET status='completed_on_time' WHERE id=(SELECT direct_task FROM rounding_fixture) RETURNING id)
SELECT pg_temp.round_assert(NOT EXISTS(SELECT 1 FROM changed),'caregiver cannot directly finalize assigned task');
SELECT pg_temp.round_reject($q$SELECT * FROM public.rounding_completion_receipts$q$,'42501','receipts not visible to authenticated clients');
SELECT pg_temp.round_reject($q$SELECT pg_temp.round_complete()$q$,'42501','authenticated caller cannot invoke service command');
RESET ROLE;
SELECT pg_temp.round_claims(true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.round_reject($q$UPDATE public.resident_observation_tasks SET status='completed_on_time' WHERE id=(SELECT direct_task FROM rounding_fixture)$q$,'42501','manager cannot forge completion using allowed status column');
SELECT pg_temp.round_reject($q$UPDATE public.resident_observation_tasks SET status='excused',excused_reason='forged identity',excused_by=(SELECT actor FROM rounding_fixture) WHERE id=(SELECT direct_task FROM rounding_fixture)$q$,'42501','manager cannot forge excusing actor');
UPDATE public.resident_observation_tasks SET status='excused',excused_reason='Watch ended safely',excused_by=(SELECT other_actor FROM rounding_fixture) WHERE id=(SELECT direct_task FROM rounding_fixture);
SELECT pg_temp.round_assert((SELECT status='excused' AND updated_by=(SELECT other_actor FROM rounding_fixture) FROM public.resident_observation_tasks WHERE id=(SELECT direct_task FROM rounding_fixture)),'manager excusal remains authorized and attributed');
SELECT pg_temp.round_reject($q$UPDATE public.resident_observation_tasks SET status='excused',excused_reason='overwrite completion',excused_by=(SELECT other_actor FROM rounding_fixture) WHERE id=(SELECT task FROM rounding_fixture)$q$,'P0001','stale manager excuse cannot overwrite completion');
RESET ROLE;
-- Even accidental future grants cannot mutate evidence or call the private core.
GRANT UPDATE ON public.rounding_completion_receipts,public.resident_observation_logs,public.resident_observation_tasks TO service_role;
SET LOCAL ROLE service_role;
SELECT pg_temp.round_reject($q$UPDATE public.rounding_completion_receipts SET payload='{}' WHERE id=(SELECT request_id FROM rounding_fixture)$q$,'42501','receipt immutable with accidental future grant');
SELECT pg_temp.round_reject($q$UPDATE public.resident_observation_logs SET note='rewrite' WHERE task_id=(SELECT task FROM rounding_fixture)$q$,'42501','clinical log immutable with accidental future grant');
SELECT pg_temp.round_reject($q$UPDATE public.resident_observation_tasks SET status='overdue' WHERE id=(SELECT task FROM rounding_fixture)$q$,'P0001','stale service escalation cannot overwrite completion');
SELECT pg_temp.round_assert(NOT has_function_privilege('service_role','haven.complete_rounding_task_core(uuid,uuid,text,uuid,integer,uuid,uuid,uuid,jsonb)','EXECUTE'),'private core is unavailable to service role');
RESET ROLE;
-- Protected columns stay inaccessible across every ordinary clinical/admin role.
DO $$ DECLARE role_name text; column_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['owner','org_admin','facility_admin','nurse','caregiver','family'] LOOP
  UPDATE public.user_profiles SET app_role=role_name::public.app_role WHERE id=(SELECT other_actor FROM rounding_fixture);
  PERFORM pg_temp.round_claims(true);
  SET LOCAL ROLE authenticated;
  FOREACH column_name IN ARRAY ARRAY['organization_id','facility_id','resident_id','assigned_staff_id','completed_log_id','deleted_at','notes'] LOOP
   PERFORM pg_temp.round_reject(format('UPDATE public.resident_observation_tasks SET %I=%I WHERE id=(SELECT rollback_task FROM rounding_fixture)',column_name,column_name),'42501',role_name||' cannot directly change task '||column_name);
  END LOOP;
  FOREACH column_name IN ARRAY ARRAY['observed_at','entered_at','staff_id','created_by','resident_id','task_id','quick_status','note','deleted_at'] LOOP
   PERFORM pg_temp.round_reject(format('UPDATE public.resident_observation_logs SET %I=%I WHERE task_id=(SELECT task FROM rounding_fixture)',column_name,column_name),'42501',role_name||' cannot directly change log '||column_name);
  END LOOP;
  PERFORM pg_temp.round_reject('DELETE FROM public.resident_observation_tasks WHERE id=(SELECT rollback_task FROM rounding_fixture)','42501',role_name||' cannot delete a task');
  RESET ROLE;
 END LOOP;
END $$;
ROLLBACK;
