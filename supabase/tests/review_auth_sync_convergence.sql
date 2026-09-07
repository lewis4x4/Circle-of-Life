-- Rollback-only, deliberately interleaved remote Auth completions.
BEGIN;
CREATE FUNCTION pg_temp.apply_remote_auth(job jsonb) RETURNS void LANGUAGE sql AS $$
 UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||jsonb_build_object(
   'app_role',job->>'desired_app_role','organization_id',job->>'organization_id',
   'auth_claim_version',(job->>'desired_claim_version')::integer,'haven_auth_sync_job_id',job->>'id',
   'haven_auth_ban_job_id',job->>'id','haven_auth_ban_version',(job->>'desired_claim_version')::integer),
   banned_until=CASE WHEN (job->>'should_ban')::boolean THEN now()+interval '100 years' ELSE NULL END
 WHERE id=(job->>'target_user_id')::uuid
$$;
CREATE FUNCTION pg_temp.finish_sync(job jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.validate_user_auth_sync_job((job->>'id')::uuid,(job->>'lease_token')::uuid);
 PERFORM pg_temp.apply_remote_auth(job);
 PERFORM public.mark_user_auth_sync_succeeded((job->>'id')::uuid,(job->>'lease_token')::uuid);
 RETURN public.finalize_user_auth_sync_job((job->>'id')::uuid,(job->>'lease_token')::uuid);
END $$;
DO $test$
DECLARE org uuid; facility uuid; actor uuid:=gen_random_uuid(); session_id uuid:=gen_random_uuid();
 target uuid:=gen_random_uuid(); actor_version integer; a jsonb; b jsonb; repair jsonb; observed jsonb;
BEGIN
 SELECT f.organization_id,f.id INTO STRICT org,facility FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 VALUES(actor,actor||'@sync.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{}'),
   (target,target||'@sync.invalid',jsonb_build_object('organization_id',org,'app_role','caregiver'),'{}');
 INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
 VALUES(actor,org,actor||'@sync.invalid','Sync actor','owner',true),
   (target,org,target||'@sync.invalid','Sync target','caregiver',true)
 ON CONFLICT(id) DO UPDATE SET organization_id=org,app_role=EXCLUDED.app_role,is_active=true;
 INSERT INTO auth.sessions(id,user_id) VALUES(session_id,actor);
 INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,is_primary,granted_by)
 VALUES(target,facility,org,true,actor);
 SELECT auth_claim_version INTO actor_version FROM public.user_profiles WHERE id=actor;
 a:=public.restrict_user_access_review(target,actor,session_id,actor_version,org,'disable','converge-disable');
 a:=public.claim_user_auth_sync_job((a->>'id')::uuid,60);
 b:=public.prepare_user_access_expansion_review(target,actor,session_id,actor_version,org,'reactivate',
   'converge-reactivate',NULL,ARRAY[facility],facility);
 IF public.claim_user_auth_sync_job((b->>'id')::uuid,60) IS NOT NULL THEN
   RAISE EXCEPTION 'Different jobs acquired live leases for the same target'; END IF;
 -- A's remote ban is still in flight as its lease expires. B finishes first.
 UPDATE public.user_auth_sync_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=(a->>'id')::uuid;
 b:=public.claim_user_auth_sync_job((b->>'id')::uuid,60);
 PERFORM pg_temp.finish_sync(b);
 PERFORM pg_temp.apply_remote_auth(a);
 BEGIN
   PERFORM public.mark_user_auth_sync_succeeded((a->>'id')::uuid,(a->>'lease_token')::uuid);
   RAISE EXCEPTION 'Expired A marked remote success after B';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 PERFORM public.request_user_auth_reconciliation((a->>'id')::uuid);
 PERFORM public.fail_user_auth_sync_job((a->>'id')::uuid,(a->>'lease_token')::uuid,'40001');
 observed:=public.user_auth_sync_status_review(target,org);
 IF observed->>'phase'='finalized' THEN RAISE EXCEPTION 'B falsely reports synchronized after late A ban'; END IF;
 PERFORM public.reconcile_user_auth_sync_targets(20);
 SELECT to_jsonb(job) INTO STRICT repair FROM public.user_auth_sync_jobs job
 WHERE target_user_id=target AND operation='reconcile' AND phase='pending_auth';
 repair:=public.claim_user_auth_sync_job((repair->>'id')::uuid,60);
 IF (repair->>'should_ban')::boolean THEN RAISE EXCEPTION 'Repair retained old ban intent'; END IF;
 -- Provider failure must leave observed drift and pending repair, not finalization.
 BEGIN
   PERFORM public.mark_user_auth_sync_succeeded((repair->>'id')::uuid,(repair->>'lease_token')::uuid);
   RAISE EXCEPTION 'Failed provider update marked synchronized';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 PERFORM pg_temp.finish_sync(repair);
 IF (public.user_auth_sync_status_review(target,org)->>'phase')<>'finalized'
   OR (SELECT latest_command_job_id FROM public.user_auth_sync_targets WHERE target_user_id=target)<>(b->>'id')::uuid
   OR (SELECT banned_until>now() FROM auth.users WHERE id=target) IS TRUE THEN
   RAISE EXCEPTION 'Latest active/unbanned state did not converge: status=%, banned=%, jobs=%',
     public.user_auth_sync_status_review(target,org),(SELECT banned_until FROM auth.users WHERE id=target),
     (SELECT jsonb_agg(jsonb_build_object('operation',operation,'phase',phase,'created_at',created_at))
       FROM public.user_auth_sync_jobs WHERE target_user_id=target); END IF;
 -- A timed out locally, then writes remotely AFTER repair and after dirty state
 -- was observed clean. No worker callback survives. The bounded watch detects it.
 UPDATE public.user_auth_sync_targets SET checked_at=now()-interval '2 minutes' WHERE target_user_id=target;
 PERFORM pg_temp.apply_remote_auth(a);
 PERFORM public.reconcile_user_auth_sync_targets(20);
 SELECT to_jsonb(job) INTO STRICT repair FROM public.user_auth_sync_jobs job
 WHERE target_user_id=target AND operation='reconcile' AND phase='pending_auth';
 repair:=public.claim_user_auth_sync_job((repair->>'id')::uuid,60);
 PERFORM pg_temp.finish_sync(repair);
 IF NOT haven.user_auth_matches_state(target,'caregiver',org,
   (SELECT auth_claim_version FROM public.user_profiles WHERE id=target),false) THEN
   RAISE EXCEPTION 'Lost-worker late write did not converge'; END IF;
 -- Same interleaving for stale promotion metadata after a newer demotion.
 a:=public.prepare_user_access_expansion_review(target,actor,session_id,actor_version,org,'promote','converge-promote','nurse');
 a:=public.claim_user_auth_sync_job((a->>'id')::uuid,60);
 b:=public.restrict_user_access_review(target,actor,session_id,actor_version,org,'demote','converge-demote','dietary_aide');
 UPDATE public.user_auth_sync_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=(a->>'id')::uuid;
 b:=public.claim_user_auth_sync_job((b->>'id')::uuid,60);
 PERFORM pg_temp.finish_sync(b);
 PERFORM pg_temp.apply_remote_auth(a);
 PERFORM public.fail_user_auth_sync_job((a->>'id')::uuid,(a->>'lease_token')::uuid,'40001');
 PERFORM public.request_user_auth_reconciliation((a->>'id')::uuid);
 PERFORM public.reconcile_user_auth_sync_targets(20);
 SELECT to_jsonb(job) INTO STRICT repair FROM public.user_auth_sync_jobs job
 WHERE target_user_id=target AND operation='reconcile' AND phase='pending_auth';
 repair:=public.claim_user_auth_sync_job((repair->>'id')::uuid,60);
 PERFORM pg_temp.finish_sync(repair);
 IF NOT haven.user_auth_matches_state(target,'dietary_aide',org,
   (SELECT auth_claim_version FROM public.user_profiles WHERE id=target),false) THEN
   RAISE EXCEPTION 'Stale role metadata did not converge'; END IF;
 -- A separate current security hold must survive all ordinary lifecycle edits
 -- and the watch. Its latest ban marker does not identify an obsolete own ban.
 UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=target;
 BEGIN
   PERFORM public.prepare_user_access_expansion_review(target,actor,session_id,actor_version,org,
     'promote','security-hold-promote','nurse');
   RAISE EXCEPTION 'Promotion implicitly accepted an independent Auth hold';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM public.prepare_user_access_expansion_review(target,actor,session_id,actor_version,org,
     'grant_facility','security-hold-grant',NULL,ARRAY[facility],facility);
   RAISE EXCEPTION 'Facility grant implicitly accepted an independent Auth hold';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.user_auth_sync_targets SET checked_at='-infinity' WHERE target_user_id=target;
 PERFORM public.reconcile_user_auth_sync_targets(20);
 IF EXISTS(SELECT 1 FROM public.user_auth_sync_jobs WHERE target_user_id=target AND phase IN('pending_auth','auth_succeeded'))
   OR (public.user_auth_sync_status_review(target,org)->>'phase')<>'dead_letter'
   OR NOT (SELECT banned_until>now() FROM auth.users WHERE id=target) THEN
   RAISE EXCEPTION 'Independent current Auth hold was automatically cleared or hidden'; END IF;
 IF has_table_privilege('service_role','public.user_auth_sync_targets','SELECT')
   OR has_function_privilege('authenticated','public.reconcile_user_auth_sync_targets(integer)','EXECUTE') THEN
   RAISE EXCEPTION 'Reconciliation control is not service-command-only'; END IF;
END $test$;
ROLLBACK;
