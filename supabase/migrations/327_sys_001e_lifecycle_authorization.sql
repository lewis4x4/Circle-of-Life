-- SYS-001E: resumable user lifecycle synchronization and current shell actor.
-- Forward-only repair: missing version claims must fail closed for version > 1.
CREATE OR REPLACE FUNCTION haven.current_authorized_actor()
RETURNS TABLE (
  actor_user_id uuid,
  actor_organization_id uuid,
  actor_role_text text,
  actor_app_role public.app_role,
  actor_claim_version integer,
  actor_is_managed boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb;
  v_user_id uuid;
  v_session_id uuid;
  v_claim_version integer;
  v_claim_version_text text;
  v_raw_role text;
  v_raw_organization text;
  v_raw_version text;
  v_current_version integer;
BEGIN
  v_claims := auth.jwt();
  IF v_claims ->> 'role' IS DISTINCT FROM 'authenticated' THEN RETURN; END IF;
  BEGIN
    v_user_id := NULLIF(v_claims ->> 'sub', '')::uuid;
    v_session_id := NULLIF(v_claims ->> 'session_id', '')::uuid;
    v_claim_version_text := NULLIF(v_claims ->> 'auth_claim_version', '');
    IF v_claim_version_text IS NOT NULL THEN
      IF v_claim_version_text !~ '^[0-9]+$' THEN RETURN; END IF;
      v_claim_version := v_claim_version_text::integer;
      IF v_claim_version < 1 THEN RETURN; END IF;
    END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN;
  END;
  IF v_user_id IS NULL OR v_session_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT profile.id, profile.organization_id, profile.app_role::text, profile.app_role,
         profile.auth_claim_version, true
  FROM public.user_profiles AS profile
  JOIN auth.users AS auth_user ON auth_user.id=profile.id
  JOIN auth.sessions AS session ON session.id=v_session_id AND session.user_id=profile.id
  WHERE profile.id=v_user_id
    AND profile.organization_id IS NOT NULL
    AND profile.is_active
    AND profile.deleted_at IS NULL
    AND auth_user.deleted_at IS NULL
    AND (auth_user.banned_until IS NULL OR auth_user.banned_until <= pg_catalog.now())
    AND (v_claim_version=profile.auth_claim_version
      OR (v_claim_version IS NULL AND profile.auth_claim_version=1))
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.user_profiles AS profile WHERE profile.id=v_user_id) THEN RETURN; END IF;

  SELECT NULLIF(pg_catalog.btrim(auth_user.raw_app_meta_data ->> 'app_role'), ''),
         NULLIF(auth_user.raw_app_meta_data ->> 'organization_id', ''),
         NULLIF(auth_user.raw_app_meta_data ->> 'auth_claim_version', '')
  INTO v_raw_role, v_raw_organization, v_raw_version
  FROM auth.users AS auth_user
  JOIN auth.sessions AS session ON session.id=v_session_id AND session.user_id=auth_user.id
  WHERE auth_user.id=v_user_id
    AND auth_user.deleted_at IS NULL
    AND (auth_user.banned_until IS NULL OR auth_user.banned_until <= pg_catalog.now());
  IF NOT FOUND OR v_raw_role IS DISTINCT FROM 'onboarding' THEN RETURN; END IF;

  BEGIN
    actor_organization_id := COALESCE(v_raw_organization::uuid, '00000000-0000-0000-0000-000000000001'::uuid);
    v_current_version := COALESCE(v_raw_version::integer, 1);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN;
  END;
  IF v_current_version < 1
     OR (v_claim_version=v_current_version OR (v_claim_version IS NULL AND v_current_version=1)) IS NOT TRUE THEN RETURN; END IF;
  actor_user_id := v_user_id;
  actor_role_text := 'onboarding';
  actor_app_role := NULL;
  actor_claim_version := v_current_version;
  actor_is_managed := false;
  RETURN NEXT;
END;
$function$;



CREATE OR REPLACE FUNCTION haven.role_tier(p_role public.app_role)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
  SELECT CASE p_role
    WHEN 'owner' THEN 100 WHEN 'org_admin' THEN 90 WHEN 'facility_admin' THEN 80
    WHEN 'manager' THEN 70 WHEN 'coordinator' THEN 60
    WHEN 'admin_assistant' THEN 50 WHEN 'nurse' THEN 50
    WHEN 'dietary' THEN 40 WHEN 'maintenance_role' THEN 40
    WHEN 'broker' THEN 30 WHEN 'housekeeper' THEN 30 WHEN 'med_tech' THEN 25
    WHEN 'caregiver' THEN 20 WHEN 'dietary_aide' THEN 20 WHEN 'family' THEN 10
    ELSE 0 END
$function$;

CREATE TABLE public.user_auth_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  target_user_id uuid NOT NULL,
  acting_user_id uuid NOT NULL,
  actor_session_id uuid NOT NULL,
  actor_claim_version integer NOT NULL CHECK(actor_claim_version>=1),
  operation text NOT NULL CHECK(operation IN(
    'disable','soft_delete','hard_delete','demote','revoke_facility',
    'promote','reactivate','grant_facility','reconcile'
  )),
  direction text NOT NULL CHECK(direction IN('restrictive','expansive')),
  request_payload jsonb NOT NULL,
  expected_target_version integer NOT NULL CHECK(expected_target_version>=1),
  desired_app_role public.app_role NOT NULL,
  desired_organization_id uuid NOT NULL,
  desired_claim_version integer NOT NULL CHECK(desired_claim_version>=1),
  facility_ids uuid[] NOT NULL DEFAULT '{}',
  primary_facility_id uuid,
  should_ban boolean NOT NULL DEFAULT false,
  phase text NOT NULL DEFAULT 'pending_auth' CHECK(phase IN(
    'pending_auth','auth_succeeded','finalized','dead_letter'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 8),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_auth_sync_jobs_claim
  ON public.user_auth_sync_jobs(next_attempt_at,created_at)
  WHERE phase IN('pending_auth','auth_succeeded');
ALTER TABLE public.user_auth_sync_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_auth_sync_jobs FROM PUBLIC,anon,authenticated,service_role;

-- Retain only lifecycle-touched targets. Bounded indexed observation is required:
-- Auth has no fencing token, and a timed-out remote write may finish after repair.
CREATE TABLE public.user_auth_sync_targets (
  target_user_id uuid PRIMARY KEY REFERENCES public.user_profiles(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  -- Explicit current command, advanced under target authority locks. Wall-clock
  -- ties and late reconciliation completions cannot select an older intent.
  latest_command_job_id uuid NOT NULL REFERENCES public.user_auth_sync_jobs(id),
  checked_at timestamptz NOT NULL DEFAULT '-infinity'
);
CREATE INDEX idx_user_auth_sync_targets_check ON public.user_auth_sync_targets(checked_at,target_user_id);
ALTER TABLE public.user_auth_sync_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_auth_sync_targets FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION haven.user_auth_matches_state(
  p_user_id uuid,p_role public.app_role,p_organization_id uuid,p_version integer,p_should_ban boolean
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
 SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user_id AND u.deleted_at IS NULL
   AND u.raw_app_meta_data->>'app_role'=p_role::text
   AND u.raw_app_meta_data->>'organization_id'=p_organization_id::text
   AND coalesce(u.raw_app_meta_data->>'auth_claim_version','1')=p_version::text
   AND coalesce(u.banned_until>now(),false)=p_should_ban)
$function$;
REVOKE ALL ON FUNCTION haven.user_auth_matches_state(uuid,public.app_role,uuid,integer,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

-- A ban may be repaired only when provider metadata identifies one of our
-- obsolete restrictive writes, superseded by an explicitly finalized reactivation.
-- An independent current Auth/security hold is never inferred away from is_active.
CREATE OR REPLACE FUNCTION haven.can_repair_user_auth_ban(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
 SELECT EXISTS(SELECT 1 FROM auth.users u
   JOIN public.user_profiles profile ON profile.id=u.id AND profile.is_active AND profile.deleted_at IS NULL
   JOIN public.user_auth_sync_jobs old_job ON old_job.id::text=u.raw_app_meta_data->>'haven_auth_ban_job_id'
     AND old_job.target_user_id=u.id AND old_job.should_ban
     AND old_job.desired_claim_version::text=u.raw_app_meta_data->>'haven_auth_ban_version'
   WHERE u.id=p_user_id AND u.banned_until>now()
     AND old_job.desired_claim_version<profile.auth_claim_version
     AND EXISTS(SELECT 1 FROM public.user_auth_sync_jobs restored WHERE restored.target_user_id=u.id
       AND restored.operation='reactivate' AND restored.phase='finalized'
       AND restored.desired_claim_version>old_job.desired_claim_version
       AND restored.desired_claim_version<=profile.auth_claim_version))
$function$;
REVOKE ALL ON FUNCTION haven.can_repair_user_auth_ban(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION haven.assert_user_lifecycle_actor(
  p_actor_id uuid,p_actor_session_id uuid,p_actor_claim_version integer,
  p_organization_id uuid,p_target_user_id uuid,p_operation text,p_facility_ids uuid[]
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_actor public.user_profiles%ROWTYPE; v_target public.user_profiles%ROWTYPE;
BEGIN
  -- Lock actor and target in UUID order for every lifecycle command.
  PERFORM profile.id FROM public.user_profiles profile
  WHERE profile.id=ANY(ARRAY[p_actor_id,p_target_user_id]) ORDER BY profile.id FOR UPDATE;
  SELECT * INTO STRICT v_actor FROM public.user_profiles WHERE id=p_actor_id;
  SELECT * INTO STRICT v_target FROM public.user_profiles WHERE id=p_target_user_id;
  IF v_actor.organization_id<>p_organization_id OR NOT v_actor.is_active OR v_actor.deleted_at IS NOT NULL
     OR v_actor.auth_claim_version<>p_actor_claim_version
     OR v_actor.app_role NOT IN('owner','org_admin','facility_admin','manager')
     OR NOT EXISTS(SELECT 1 FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
       WHERE u.id=v_actor.id AND s.id=p_actor_session_id AND u.deleted_at IS NULL
         AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN
    RAISE EXCEPTION 'Lifecycle actor is no longer current' USING ERRCODE='42501';
  END IF;
  -- Hold actor's live Auth identity/session until this command commits.
  PERFORM u.id FROM auth.users u JOIN auth.sessions session ON session.user_id=u.id
  WHERE u.id=p_actor_id AND session.id=p_actor_session_id AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=now()) FOR SHARE OF u,session;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lifecycle session is no longer current' USING ERRCODE='42501'; END IF;
  PERFORM f.id FROM public.facilities f WHERE f.id=ANY(coalesce(p_facility_ids,'{}'))
    AND f.organization_id=p_organization_id AND f.deleted_at IS NULL ORDER BY f.id FOR SHARE;
  IF EXISTS(SELECT 1 FROM unnest(coalesce(p_facility_ids,'{}')) requested(id)
    WHERE NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=requested.id
      AND f.organization_id=p_organization_id AND f.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Lifecycle facility is unavailable' USING ERRCODE='42501'; END IF;
  IF v_target.organization_id<>p_organization_id OR p_actor_id=p_target_user_id THEN
    RAISE EXCEPTION 'Lifecycle target is not permitted' USING ERRCODE='42501';
  END IF;
  IF p_operation='reactivate' AND v_actor.app_role='owner' AND v_target.app_role='owner' THEN
    NULL; -- Existing canActorManageTarget contract: owner may reactivate owner.
  ELSIF haven.role_tier(v_actor.app_role)<=haven.role_tier(v_target.app_role) THEN
    RAISE EXCEPTION 'Lifecycle actor cannot manage target role' USING ERRCODE='42501';
  END IF;
  IF v_actor.app_role NOT IN('owner','org_admin') THEN
    IF EXISTS(SELECT 1 FROM unnest(coalesce(p_facility_ids,'{}')) requested(id)
      WHERE NOT EXISTS(SELECT 1 FROM public.user_facility_access access
        WHERE access.user_id=v_actor.id AND access.organization_id=p_organization_id
          AND access.facility_id=requested.id AND access.revoked_at IS NULL)) THEN
      RAISE EXCEPTION 'Lifecycle facility is no longer authorized' USING ERRCODE='42501';
    END IF;
    IF p_operation<>'reactivate' AND NOT EXISTS(
      SELECT 1 FROM public.user_facility_access actor_access
      JOIN public.user_facility_access target_access USING(organization_id,facility_id)
      WHERE actor_access.user_id=v_actor.id AND target_access.user_id=v_target.id
        AND actor_access.organization_id=p_organization_id
        AND actor_access.revoked_at IS NULL AND target_access.revoked_at IS NULL
    ) THEN RAISE EXCEPTION 'Lifecycle actor and target no longer share facility scope' USING ERRCODE='42501'; END IF;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION haven.assert_user_lifecycle_actor(uuid,uuid,integer,uuid,uuid,text,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.restrict_user_access_review(
  p_target_user_id uuid,p_acting_user_id uuid,p_actor_session_id uuid,p_actor_claim_version integer,
  p_organization_id uuid,p_operation text,p_request_key text,p_desired_role public.app_role DEFAULT NULL,
  p_facility_id uuid DEFAULT NULL,p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_job public.user_auth_sync_jobs%ROWTYPE; v_target public.user_profiles%ROWTYPE;
  v_now timestamptz:=clock_timestamp(); v_role public.app_role; v_ban boolean:=false;
  v_payload jsonb; v_audit text; v_remaining integer:=0;
BEGIN
  v_payload:=jsonb_build_object('acting_user_id',p_acting_user_id,'organization_id',p_organization_id,
    'operation',p_operation,'target_user_id',p_target_user_id,
    'desired_role',p_desired_role,'facility_id',p_facility_id,'reason',p_reason);
  IF p_operation IN('promote','demote') THEN
    v_payload:=jsonb_build_object('acting_user_id',p_acting_user_id,'organization_id',p_organization_id,
      'operation','set_role','target_user_id',p_target_user_id,'desired_role',p_desired_role,'reason',p_reason);
  END IF;
  IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid lifecycle request key' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_key,327));
  SELECT * INTO v_job FROM public.user_auth_sync_jobs WHERE request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF v_job.request_payload<>v_payload OR (v_job.direction<>'restrictive' AND NOT(v_job.operation IN('promote','demote') AND p_operation IN('promote','demote'))) OR v_job.acting_user_id<>p_acting_user_id OR v_job.organization_id<>p_organization_id THEN
      RAISE EXCEPTION 'Lifecycle request key payload mismatch' USING ERRCODE='23505'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.user_profiles a JOIN auth.users u ON u.id=a.id
      JOIN auth.sessions session ON session.user_id=a.id AND session.id=p_actor_session_id
      WHERE a.id=p_acting_user_id AND a.organization_id=p_organization_id AND a.is_active
        AND a.deleted_at IS NULL AND a.auth_claim_version=p_actor_claim_version
        AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN
      RAISE EXCEPTION 'Replay actor is no longer current' USING ERRCODE='42501'; END IF;
    RETURN to_jsonb(v_job);
  END IF;
  IF p_operation NOT IN('disable','soft_delete','hard_delete','demote','revoke_facility') THEN
    RAISE EXCEPTION 'Invalid restrictive lifecycle operation' USING ERRCODE='22023'; END IF;
  PERFORM haven.assert_user_lifecycle_actor(p_acting_user_id,p_actor_session_id,p_actor_claim_version,
    p_organization_id,p_target_user_id,p_operation,
    CASE WHEN p_facility_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[p_facility_id] END);
  SELECT * INTO STRICT v_target FROM public.user_profiles WHERE id=p_target_user_id;
  v_role:=v_target.app_role;
  IF p_operation='demote' THEN
    IF p_desired_role IS NULL OR haven.role_tier(p_desired_role)>haven.role_tier(v_target.app_role)
       OR haven.role_tier(p_desired_role)>=haven.role_tier((SELECT app_role FROM public.user_profiles WHERE id=p_acting_user_id)) THEN
      RAISE EXCEPTION 'Requested role is not a permitted restriction' USING ERRCODE='42501'; END IF;
    UPDATE public.user_profiles SET app_role=p_desired_role,updated_at=v_now WHERE id=v_target.id;
    v_audit:='update_role';
  ELSIF p_operation IN('disable','soft_delete','hard_delete') THEN
    UPDATE public.user_facility_access SET revoked_at=v_now,revoked_by=p_acting_user_id,is_primary=false
    WHERE user_id=v_target.id AND organization_id=p_organization_id AND revoked_at IS NULL;
    UPDATE public.user_profiles SET is_active=false,
      deleted_at=CASE WHEN p_operation='disable' THEN deleted_at ELSE coalesce(deleted_at,v_now) END,
      updated_at=v_now WHERE id=v_target.id;
    v_ban:=true; v_audit:=CASE WHEN p_operation='hard_delete' THEN 'hard_delete' ELSE 'soft_delete' END;
  ELSE
    IF p_facility_id IS NULL THEN RAISE EXCEPTION 'Facility is required' USING ERRCODE='22023'; END IF;
    UPDATE public.user_facility_access SET revoked_at=v_now,revoked_by=p_acting_user_id,is_primary=false
    WHERE user_id=v_target.id AND organization_id=p_organization_id AND facility_id=p_facility_id AND revoked_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Facility access is no longer current' USING ERRCODE='42501'; END IF;
    SELECT count(*)::integer INTO v_remaining FROM public.user_facility_access
      WHERE user_id=v_target.id AND organization_id=p_organization_id AND revoked_at IS NULL;
    IF v_remaining=0 AND v_target.app_role NOT IN('owner','org_admin') THEN
      UPDATE public.user_profiles SET is_active=false,deleted_at=coalesce(deleted_at,v_now),updated_at=v_now WHERE id=v_target.id;
      v_ban:=true;
    END IF;
    UPDATE public.user_facility_access SET is_primary=true WHERE id=(SELECT id FROM public.user_facility_access
      WHERE user_id=v_target.id AND organization_id=p_organization_id AND revoked_at IS NULL
      ORDER BY granted_at DESC,id DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM public.user_facility_access
      WHERE user_id=v_target.id AND organization_id=p_organization_id AND revoked_at IS NULL AND is_primary);
    v_audit:='revoke_access';
  END IF;
  -- Every restriction invalidates prepared expansions, including an idempotent
  -- state resave with a NEW command key (a replay returns above without a bump).
  UPDATE public.user_profiles SET auth_claim_version=greatest(auth_claim_version,v_target.auth_claim_version+1)
    WHERE id=p_target_user_id;
  SELECT * INTO STRICT v_target FROM public.user_profiles WHERE id=p_target_user_id;
  v_ban:=NOT v_target.is_active OR v_target.deleted_at IS NOT NULL;
  INSERT INTO public.user_management_audit_log(organization_id,acting_user_id,target_user_id,action,resource_type,changes,reason)
  VALUES(p_organization_id,p_acting_user_id,p_target_user_id,v_audit,
    CASE WHEN p_operation='revoke_facility' THEN 'facility_access' ELSE 'user' END,
    jsonb_build_object('before',jsonb_build_object('app_role',v_role),
      'after',jsonb_build_object('operation',p_operation,'app_role',v_target.app_role,
        'is_active',v_target.is_active,'deleted_at',v_target.deleted_at,
        'facility_id',p_facility_id,'auth_claim_version',v_target.auth_claim_version)),p_reason);
  INSERT INTO public.user_auth_sync_jobs(request_key,organization_id,target_user_id,acting_user_id,
    actor_session_id,actor_claim_version,operation,direction,request_payload,expected_target_version,
    desired_app_role,desired_organization_id,desired_claim_version,facility_ids,should_ban)
  VALUES(p_request_key,p_organization_id,p_target_user_id,p_acting_user_id,p_actor_session_id,p_actor_claim_version,
    p_operation,'restrictive',v_payload,v_target.auth_claim_version,v_target.app_role,p_organization_id,
    v_target.auth_claim_version,CASE WHEN p_facility_id IS NULL THEN '{}' ELSE ARRAY[p_facility_id] END,v_ban)
  RETURNING * INTO v_job;
  INSERT INTO public.user_auth_sync_targets(target_user_id,organization_id,latest_command_job_id)
  VALUES(v_job.target_user_id,v_job.organization_id,v_job.id) ON CONFLICT(target_user_id)
  DO UPDATE SET checked_at='-infinity',latest_command_job_id=EXCLUDED.latest_command_job_id;
  RETURN to_jsonb(v_job)||jsonb_build_object('remaining_facility_count',v_remaining);
END $function$;

CREATE OR REPLACE FUNCTION public.prepare_user_access_expansion_review(
  p_target_user_id uuid,p_acting_user_id uuid,p_actor_session_id uuid,p_actor_claim_version integer,
  p_organization_id uuid,p_operation text,p_request_key text,p_desired_role public.app_role DEFAULT NULL,
  p_facility_ids uuid[] DEFAULT '{}',p_primary_facility_id uuid DEFAULT NULL,p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_job public.user_auth_sync_jobs%ROWTYPE; v_target public.user_profiles%ROWTYPE;
  v_payload jsonb; v_role public.app_role; v_reserved integer; v_ids uuid[];
BEGIN
  v_ids:=ARRAY(SELECT DISTINCT id FROM unnest(coalesce(p_facility_ids,'{}')) id ORDER BY id);
  v_payload:=jsonb_build_object('acting_user_id',p_acting_user_id,'organization_id',p_organization_id,
    'operation',p_operation,'target_user_id',p_target_user_id,
    'desired_role',p_desired_role,'facility_ids',v_ids,'primary_facility_id',p_primary_facility_id,'reason',p_reason);
  IF p_operation IN('promote','demote') THEN
    v_payload:=jsonb_build_object('acting_user_id',p_acting_user_id,'organization_id',p_organization_id,
      'operation','set_role','target_user_id',p_target_user_id,'desired_role',p_desired_role,'reason',p_reason);
  END IF;
  IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid lifecycle request key' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_key,327));
  SELECT * INTO v_job FROM public.user_auth_sync_jobs WHERE request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF v_job.request_payload<>v_payload OR (v_job.direction<>'expansive' AND NOT(v_job.operation IN('promote','demote') AND p_operation IN('promote','demote'))) OR v_job.acting_user_id<>p_acting_user_id OR v_job.organization_id<>p_organization_id THEN
      RAISE EXCEPTION 'Lifecycle request key payload mismatch' USING ERRCODE='23505'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.user_profiles a JOIN auth.users u ON u.id=a.id
      JOIN auth.sessions session ON session.user_id=a.id AND session.id=p_actor_session_id
      WHERE a.id=p_acting_user_id AND a.organization_id=p_organization_id AND a.is_active
        AND a.deleted_at IS NULL AND a.auth_claim_version=p_actor_claim_version
        AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN
      RAISE EXCEPTION 'Replay actor is no longer current' USING ERRCODE='42501'; END IF;
    RETURN to_jsonb(v_job);
  END IF;
  IF p_operation NOT IN('promote','reactivate','grant_facility') THEN
    RAISE EXCEPTION 'Invalid expansive lifecycle operation' USING ERRCODE='22023'; END IF;
  PERFORM haven.assert_user_lifecycle_actor(p_acting_user_id,p_actor_session_id,p_actor_claim_version,
    p_organization_id,p_target_user_id,p_operation,v_ids);
  SELECT * INTO STRICT v_target FROM public.user_profiles WHERE id=p_target_user_id;
  v_role:=v_target.app_role;
  IF p_operation<>'reactivate' AND EXISTS(SELECT 1 FROM auth.users WHERE id=v_target.id AND banned_until>now()) THEN
    RAISE EXCEPTION 'Auth security hold requires explicit review' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_auth_sync_jobs WHERE target_user_id=p_target_user_id
    AND direction='expansive' AND phase IN('pending_auth','auth_succeeded')
    AND expected_target_version=v_target.auth_claim_version) THEN
    RAISE EXCEPTION 'An access expansion is already pending for this user' USING ERRCODE='55000'; END IF;
  IF p_operation='promote' THEN
    IF NOT v_target.is_active OR v_target.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Reactivate the account before promoting it' USING ERRCODE='55000'; END IF;
    IF p_desired_role IS NULL OR haven.role_tier(p_desired_role)<=haven.role_tier(v_target.app_role)
      OR haven.role_tier(p_desired_role)>=haven.role_tier((SELECT app_role FROM public.user_profiles WHERE id=p_acting_user_id)) THEN
      RAISE EXCEPTION 'Requested role is not a permitted promotion' USING ERRCODE='42501'; END IF;
    v_role:=p_desired_role; v_reserved:=v_target.auth_claim_version+1;
  ELSIF p_operation='grant_facility' THEN
    IF cardinality(v_ids)<>1 OR NOT v_target.is_active OR v_target.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Exactly one current facility grant is required' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.user_facility_access WHERE user_id=v_target.id
      AND facility_id=v_ids[1] AND revoked_at IS NULL) AND p_primary_facility_id IS DISTINCT FROM v_ids[1] THEN
      RAISE EXCEPTION 'Facility access already exists' USING ERRCODE='23505'; END IF;
    IF p_primary_facility_id IS NOT NULL AND p_primary_facility_id<>v_ids[1] THEN
      RAISE EXCEPTION 'Primary facility must match grant' USING ERRCODE='22023'; END IF;
    v_reserved:=v_target.auth_claim_version+1;
  ELSE
    IF v_target.is_active AND v_target.deleted_at IS NULL THEN RAISE EXCEPTION 'Target is already active' USING ERRCODE='55000'; END IF;
    IF v_target.app_role NOT IN('owner','org_admin') AND cardinality(v_ids)=0 THEN
      RAISE EXCEPTION 'Explicit facility restoration is required' USING ERRCODE='22023'; END IF;
    IF p_primary_facility_id IS NOT NULL AND NOT(p_primary_facility_id=ANY(v_ids)) THEN
      RAISE EXCEPTION 'Primary facility must be explicitly restored' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.user_facility_access WHERE user_id=v_target.id AND revoked_at IS NULL) THEN
      RAISE EXCEPTION 'Reactivation requires explicit clean facility scope' USING ERRCODE='55000'; END IF;
    v_reserved:=v_target.auth_claim_version+cardinality(v_ids)+1;
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_ids) requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.facilities f
    WHERE f.id=requested.id AND f.organization_id=p_organization_id AND f.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Requested facility is unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO public.user_auth_sync_jobs(request_key,organization_id,target_user_id,acting_user_id,
    actor_session_id,actor_claim_version,operation,direction,request_payload,expected_target_version,
    desired_app_role,desired_organization_id,desired_claim_version,facility_ids,primary_facility_id)
  VALUES(p_request_key,p_organization_id,p_target_user_id,p_acting_user_id,p_actor_session_id,p_actor_claim_version,
    p_operation,'expansive',v_payload,v_target.auth_claim_version,v_role,p_organization_id,v_reserved,v_ids,p_primary_facility_id)
  RETURNING * INTO v_job;
  INSERT INTO public.user_auth_sync_targets(target_user_id,organization_id,latest_command_job_id)
  VALUES(v_job.target_user_id,v_job.organization_id,v_job.id) ON CONFLICT(target_user_id)
  DO UPDATE SET checked_at='-infinity',latest_command_job_id=EXCLUDED.latest_command_job_id;
  RETURN to_jsonb(v_job);
END $function$;

CREATE OR REPLACE FUNCTION public.claim_user_auth_sync_job(p_job_id uuid DEFAULT NULL,p_lease_seconds integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_job public.user_auth_sync_jobs%ROWTYPE; v_token uuid:=gen_random_uuid();
BEGIN
  UPDATE public.user_auth_sync_jobs SET phase='dead_letter',last_error_code='attempts_exhausted',updated_at=now()
  WHERE phase IN('pending_auth','auth_succeeded') AND attempt_count>=8
    AND (lease_expires_at IS NULL OR lease_expires_at<=now());
  FOR v_job IN SELECT * FROM public.user_auth_sync_jobs candidate
    WHERE (p_job_id IS NULL OR id=p_job_id) AND phase IN('pending_auth','auth_succeeded')
      AND attempt_count<8 AND coalesce(next_attempt_at,'-infinity')<=now()
      AND (lease_expires_at IS NULL OR lease_expires_at<=now())
      AND NOT EXISTS(SELECT 1 FROM public.user_auth_sync_jobs other
        WHERE other.target_user_id=candidate.target_user_id AND other.id<>candidate.id
          AND other.lease_expires_at>now() AND other.phase IN('pending_auth','auth_succeeded'))
    ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 20
  LOOP
    -- Serialize the lease decision for all jobs for this target, not only this job.
    IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('auth-sync:'||v_job.target_user_id::text,327)) THEN
      CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM public.user_auth_sync_jobs other
      WHERE other.target_user_id=v_job.target_user_id AND other.id<>v_job.id
        AND other.lease_expires_at>now() AND other.phase IN('pending_auth','auth_succeeded')) THEN CONTINUE; END IF;
    UPDATE public.user_auth_sync_jobs SET attempt_count=attempt_count+1,lease_token=v_token,
      lease_expires_at=now()+make_interval(secs=>greatest(10,least(p_lease_seconds,300))),updated_at=now()
    WHERE id=v_job.id RETURNING * INTO v_job;
    RETURN to_jsonb(v_job)||jsonb_build_object('allow_unban',
      v_job.operation='reconcile' AND haven.can_repair_user_auth_ban(v_job.target_user_id));
  END LOOP;
  RETURN NULL;
END $function$;

-- Every late/failed provider completion makes actual-state observation due again,
-- even when that worker's lease was superseded. It never mutates job ownership.
CREATE OR REPLACE FUNCTION public.request_user_auth_reconciliation(p_job_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $function$
 UPDATE public.user_auth_sync_targets SET checked_at='-infinity'
 WHERE target_user_id=(SELECT target_user_id FROM public.user_auth_sync_jobs WHERE id=p_job_id)
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_user_auth_sync_targets(p_limit integer DEFAULT 20)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_watch public.user_auth_sync_targets%ROWTYPE; v_profile public.user_profiles%ROWTYPE;
  v_source public.user_auth_sync_jobs%ROWTYPE; v_created integer:=0;
BEGIN
 FOR v_watch IN SELECT * FROM public.user_auth_sync_targets
   WHERE checked_at<=now()-interval '1 minute'
   ORDER BY checked_at,target_user_id FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(p_limit,20))
 LOOP
   UPDATE public.user_auth_sync_targets SET checked_at=now() WHERE target_user_id=v_watch.target_user_id;
   SELECT * INTO v_profile FROM public.user_profiles WHERE id=v_watch.target_user_id;
   IF NOT FOUND THEN CONTINUE; END IF;
   -- Pending work owns its desired state. Expired or stale work is handled by
   -- its existing consumer, then this watch restores the current committed state.
   IF EXISTS(SELECT 1 FROM public.user_auth_sync_jobs WHERE target_user_id=v_watch.target_user_id
     AND phase IN('pending_auth','auth_succeeded')) THEN CONTINUE; END IF;
   IF haven.user_auth_matches_state(v_profile.id,v_profile.app_role,v_profile.organization_id,
     v_profile.auth_claim_version,NOT v_profile.is_active OR v_profile.deleted_at IS NOT NULL) THEN CONTINUE; END IF;
   IF v_profile.is_active AND v_profile.deleted_at IS NULL
     AND EXISTS(SELECT 1 FROM auth.users WHERE id=v_profile.id AND banned_until>now())
     AND NOT haven.can_repair_user_auth_ban(v_profile.id) THEN CONTINUE; END IF;
   SELECT * INTO v_source FROM public.user_auth_sync_jobs
     WHERE id=v_watch.latest_command_job_id AND target_user_id=v_watch.target_user_id;
   IF NOT FOUND THEN CONTINUE; END IF;
   INSERT INTO public.user_auth_sync_jobs(request_key,organization_id,target_user_id,acting_user_id,
     actor_session_id,actor_claim_version,operation,direction,request_payload,expected_target_version,
     desired_app_role,desired_organization_id,desired_claim_version,should_ban)
   VALUES('reconcile:'||gen_random_uuid(),v_profile.organization_id,v_profile.id,v_source.acting_user_id,
     v_source.actor_session_id,v_source.actor_claim_version,'reconcile','restrictive',
     jsonb_build_object('source_job_id',v_source.id),v_profile.auth_claim_version,v_profile.app_role,
     v_profile.organization_id,v_profile.auth_claim_version,NOT v_profile.is_active OR v_profile.deleted_at IS NOT NULL);
   v_created:=v_created+1;
 END LOOP;
 RETURN v_created;
END $function$;
REVOKE ALL ON FUNCTION public.request_user_auth_reconciliation(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reconcile_user_auth_sync_targets(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_user_auth_reconciliation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_user_auth_sync_targets(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_user_auth_sync_job(p_job_id uuid,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_job public.user_auth_sync_jobs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_job FROM public.user_auth_sync_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.lease_token IS DISTINCT FROM p_lease_token OR v_job.lease_expires_at IS NULL
     OR v_job.lease_expires_at<=now() OR v_job.phase NOT IN('pending_auth','auth_succeeded') THEN
    RAISE EXCEPTION 'Auth sync lease is no longer current' USING ERRCODE='55000'; END IF;
  IF v_job.direction='expansive' THEN
    PERFORM haven.assert_user_lifecycle_actor(v_job.acting_user_id,v_job.actor_session_id,v_job.actor_claim_version,
      v_job.organization_id,v_job.target_user_id,v_job.operation,v_job.facility_ids);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=v_job.target_user_id
    AND organization_id=v_job.organization_id AND auth_claim_version=v_job.expected_target_version) THEN
    RAISE EXCEPTION 'Target authorization changed during Auth sync' USING ERRCODE='40001'; END IF;
  IF NOT v_job.should_ban AND v_job.operation<>'reactivate'
    AND EXISTS(SELECT 1 FROM auth.users WHERE id=v_job.target_user_id AND banned_until>now())
    AND NOT(v_job.operation='reconcile' AND haven.can_repair_user_auth_ban(v_job.target_user_id)) THEN
    RAISE EXCEPTION 'Auth security hold requires explicit review' USING ERRCODE='42501'; END IF;
  RETURN to_jsonb(v_job);
END $function$;

CREATE OR REPLACE FUNCTION public.mark_user_auth_sync_succeeded(p_job_id uuid,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_job public.user_auth_sync_jobs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_job FROM public.user_auth_sync_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.lease_token IS DISTINCT FROM p_lease_token OR v_job.lease_expires_at<=now()
    OR v_job.lease_expires_at IS NULL OR v_job.phase NOT IN('pending_auth','auth_succeeded') THEN
    RAISE EXCEPTION 'Auth sync lease is no longer current' USING ERRCODE='55000'; END IF;
  PERFORM id FROM auth.users WHERE id=v_job.target_user_id FOR SHARE;
  IF NOT haven.user_auth_matches_state(v_job.target_user_id,v_job.desired_app_role,v_job.organization_id,
    v_job.desired_claim_version,v_job.should_ban) THEN
    RAISE EXCEPTION 'Auth desired state was not observed' USING ERRCODE='55000'; END IF;
  UPDATE public.user_auth_sync_jobs SET phase='auth_succeeded',updated_at=now()
  WHERE id=v_job.id RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END $function$;

CREATE OR REPLACE FUNCTION public.finalize_user_auth_sync_job(p_job_id uuid,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_job public.user_auth_sync_jobs%ROWTYPE; v_target public.user_profiles%ROWTYPE;
  v_facility uuid; v_now timestamptz:=clock_timestamp(); v_audit text;
BEGIN
  SELECT * INTO STRICT v_job FROM public.user_auth_sync_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.phase='finalized' THEN RETURN to_jsonb(v_job); END IF;
  IF v_job.phase<>'auth_succeeded' OR v_job.lease_token IS DISTINCT FROM p_lease_token OR v_job.lease_expires_at IS NULL OR v_job.lease_expires_at<=now() THEN
    RAISE EXCEPTION 'Auth sync job is not finalizable' USING ERRCODE='55000'; END IF;
  PERFORM public.validate_user_auth_sync_job(p_job_id,p_lease_token);
  PERFORM id FROM auth.users WHERE id=v_job.target_user_id FOR SHARE;
  IF NOT haven.user_auth_matches_state(v_job.target_user_id,v_job.desired_app_role,v_job.organization_id,
    v_job.desired_claim_version,v_job.should_ban) THEN
    RAISE EXCEPTION 'Auth desired state was not observed' USING ERRCODE='55000'; END IF;
  IF v_job.direction='expansive' THEN
    PERFORM haven.assert_user_lifecycle_actor(v_job.acting_user_id,v_job.actor_session_id,v_job.actor_claim_version,
      v_job.organization_id,v_job.target_user_id,v_job.operation,v_job.facility_ids);
    SELECT * INTO STRICT v_target FROM public.user_profiles WHERE id=v_job.target_user_id;
    IF v_target.auth_claim_version<>v_job.expected_target_version THEN
      RAISE EXCEPTION 'Target authorization changed during Auth sync' USING ERRCODE='40001'; END IF;
    IF v_job.operation='promote' THEN
      UPDATE public.user_profiles SET app_role=v_job.desired_app_role,updated_at=v_now WHERE id=v_target.id;
      v_audit:='update_role';
    ELSIF v_job.operation='grant_facility' THEN
      IF v_job.primary_facility_id IS NOT NULL THEN UPDATE public.user_facility_access SET is_primary=false
        WHERE user_id=v_target.id AND organization_id=v_job.organization_id AND revoked_at IS NULL; END IF;
      IF EXISTS(SELECT 1 FROM public.user_facility_access WHERE user_id=v_target.id
        AND facility_id=v_job.facility_ids[1] AND revoked_at IS NULL) THEN
        UPDATE public.user_facility_access SET is_primary=true WHERE user_id=v_target.id
          AND facility_id=v_job.facility_ids[1] AND revoked_at IS NULL;
        PERFORM haven.advance_user_authorization_version(v_target.id);
      ELSE
        INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,is_primary,granted_by)
        VALUES(v_target.id,v_job.facility_ids[1],v_job.organization_id,
          coalesce(v_job.primary_facility_id=v_job.facility_ids[1],false),v_job.acting_user_id);
      END IF;
      v_audit:='grant_access';
    ELSE
      FOREACH v_facility IN ARRAY v_job.facility_ids LOOP
        INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,is_primary,granted_by)
        VALUES(v_target.id,v_facility,v_job.organization_id,coalesce(v_facility=v_job.primary_facility_id,false),v_job.acting_user_id);
      END LOOP;
      UPDATE public.user_profiles SET is_active=true,deleted_at=NULL,updated_at=v_now WHERE id=v_target.id;
      v_audit:='reactivate';
    END IF;
    SELECT * INTO STRICT v_target FROM public.user_profiles WHERE id=v_job.target_user_id;
    IF v_target.auth_claim_version<>v_job.desired_claim_version THEN
      RAISE EXCEPTION 'Reserved authorization version mismatch' USING ERRCODE='40001'; END IF;
    INSERT INTO public.user_management_audit_log(organization_id,acting_user_id,target_user_id,action,resource_type,changes)
    VALUES(v_job.organization_id,v_job.acting_user_id,v_job.target_user_id,v_audit,
      CASE WHEN v_job.operation='grant_facility' THEN 'facility_access' ELSE 'user' END,
      jsonb_build_object('before',jsonb_build_object('auth_claim_version',v_job.expected_target_version),
        'after',jsonb_build_object('operation',v_job.operation,'app_role',v_target.app_role,
          'auth_claim_version',v_target.auth_claim_version,'facility_ids',v_job.facility_ids)));
  END IF;
  UPDATE public.user_auth_sync_jobs SET phase='finalized',lease_token=NULL,lease_expires_at=NULL,
    next_attempt_at=NULL,last_error_code=NULL,completed_at=now(),updated_at=now()
  WHERE id=v_job.id RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END $function$;

CREATE OR REPLACE FUNCTION public.fail_user_auth_sync_job(p_job_id uuid,p_lease_token uuid,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  UPDATE public.user_auth_sync_jobs SET
    phase=CASE WHEN attempt_count>=8 OR p_error_code IN('40001','42501') THEN 'dead_letter' ELSE phase END,
    last_error_code=left(regexp_replace(coalesce(p_error_code,'sync_failed'),'[^a-zA-Z0-9_.-]','','g'),80),
    next_attempt_at=CASE WHEN attempt_count>=8 THEN NULL ELSE now()+make_interval(mins=>least(attempt_count,5)) END,
    lease_token=NULL,lease_expires_at=NULL,updated_at=now()
  WHERE id=p_job_id AND lease_token=p_lease_token;
END $function$;

CREATE OR REPLACE FUNCTION public.haven_current_shell_actor()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT jsonb_build_object('user_id',actor.actor_user_id,'organization_id',actor.actor_organization_id,
    'app_role',actor.actor_role_text,'auth_claim_version',actor.actor_claim_version,
    'is_managed',actor.actor_is_managed,'full_name',profile.full_name,'avatar_url',profile.avatar_url,
    'organization_name',organization.name)
  FROM haven.current_authorized_actor() actor
  LEFT JOIN public.user_profiles profile ON actor.actor_is_managed AND profile.id=actor.actor_user_id
  LEFT JOIN public.organizations organization ON organization.id=actor.actor_organization_id LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.restrict_user_access_review(uuid,uuid,uuid,integer,uuid,text,text,public.app_role,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.prepare_user_access_expansion_review(uuid,uuid,uuid,integer,uuid,text,text,public.app_role,uuid[],uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_user_auth_sync_job(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.validate_user_auth_sync_job(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_user_auth_sync_job(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mark_user_auth_sync_succeeded(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finalize_user_auth_sync_job(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_user_auth_sync_job(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.haven_current_shell_actor() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.restrict_user_access_review(uuid,uuid,uuid,integer,uuid,text,text,public.app_role,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_user_access_expansion_review(uuid,uuid,uuid,integer,uuid,text,text,public.app_role,uuid[],uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_user_auth_sync_job(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_user_auth_sync_succeeded(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_user_auth_sync_job(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_user_auth_sync_job(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.haven_current_shell_actor() TO authenticated;

-- Forward repair for nullable authorization predicates found in the final review.
CREATE OR REPLACE FUNCTION haven.assert_rounding_service_actor(
  p_actor_id uuid,p_actor_role text,p_session_id uuid,p_claim_version integer,
  p_organization_id uuid,p_facility_id uuid,p_manager_only boolean,p_require_staff boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_role text;
  v_organization uuid;
  v_version integer;
  v_has_grant boolean:=false;
  v_staff_id uuid;
BEGIN
  PERFORM 1 FROM public.facilities AS facility
  WHERE facility.id=p_facility_id AND facility.organization_id=p_organization_id AND facility.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rounding actor is no longer authorized' USING ERRCODE='42501'; END IF;

  SELECT true INTO v_has_grant FROM public.user_facility_access AS access
  WHERE access.user_id=p_actor_id AND access.organization_id=p_organization_id
    AND access.facility_id=p_facility_id AND access.revoked_at IS NULL
  FOR SHARE;

  SELECT profile.app_role::text,profile.organization_id,profile.auth_claim_version
  INTO v_role,v_organization,v_version
  FROM public.user_profiles AS profile
  JOIN auth.users AS auth_user ON auth_user.id=profile.id
  JOIN auth.sessions AS session ON session.id=p_session_id AND session.user_id=profile.id
  WHERE profile.id=p_actor_id AND profile.is_active AND profile.deleted_at IS NULL
    AND auth_user.deleted_at IS NULL
    AND (auth_user.banned_until IS NULL OR auth_user.banned_until<=pg_catalog.now())
  FOR SHARE OF profile,auth_user,session;

  IF v_role IS NULL OR v_role IS DISTINCT FROM p_actor_role
     OR v_organization IS DISTINCT FROM p_organization_id
     OR (p_claim_version=v_version OR (p_claim_version IS NULL AND v_version=1)) IS NOT TRUE
     OR (p_manager_only AND v_role NOT IN('owner','org_admin','facility_admin','nurse'))
     OR (v_role NOT IN('owner','org_admin') AND v_has_grant IS NOT TRUE) THEN
    RAISE EXCEPTION 'Rounding actor is no longer authorized' USING ERRCODE='42501';
  END IF;

  SELECT staff.id INTO v_staff_id FROM public.staff AS staff
  WHERE staff.user_id=p_actor_id AND staff.organization_id=p_organization_id
    AND staff.facility_id=p_facility_id AND staff.employment_status='active' AND staff.deleted_at IS NULL
  ORDER BY staff.id LIMIT 1 FOR SHARE;
  IF p_require_staff AND v_staff_id IS NULL THEN
    RAISE EXCEPTION 'An active staff profile is required' USING ERRCODE='42501';
  END IF;
  RETURN pg_catalog.jsonb_build_object('role',v_role,'staff_id',v_staff_id);
END $function$;

-- Forward repair for nullable authorization predicates found in the final review.
CREATE OR REPLACE FUNCTION public.complete_rounding_task_review(
  p_task_id uuid,p_actor_id uuid,p_actor_role text,p_session_id uuid,p_claim_version integer,
  p_organization_id uuid,p_facility_id uuid,p_actual_staff_id uuid,p_payload jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_task public.resident_observation_tasks%ROWTYPE;
  v_actor jsonb;
  v_role text;
  v_staff_id uuid;
  v_has_active_assignment boolean;
  v_is_active_assignee boolean;
  v_log_id uuid;
  v_status public.resident_observation_task_status;
BEGIN
  SELECT * INTO STRICT v_task FROM public.resident_observation_tasks
  WHERE id=p_task_id AND organization_id=p_organization_id AND facility_id=p_facility_id AND deleted_at IS NULL
  FOR UPDATE;
  v_actor:=haven.assert_rounding_service_actor(p_actor_id,p_actor_role,p_session_id,p_claim_version,
    p_organization_id,p_facility_id,false,true);
  v_role:=v_actor->>'role';
  v_staff_id:=(v_actor->>'staff_id')::uuid;
  IF v_staff_id IS DISTINCT FROM p_actual_staff_id THEN
    RAISE EXCEPTION 'Rounding actor staff identity changed' USING ERRCODE='42501';
  END IF;

  PERFORM 1 FROM public.resident_observation_assignments AS assignment
  WHERE assignment.task_id=v_task.id AND assignment.organization_id=p_organization_id
    AND assignment.facility_id=p_facility_id AND assignment.released_at IS NULL
  ORDER BY assignment.id FOR SHARE;
  SELECT EXISTS(SELECT 1 FROM public.resident_observation_assignments AS assignment
      WHERE assignment.task_id=v_task.id AND assignment.organization_id=p_organization_id
        AND assignment.facility_id=p_facility_id AND assignment.released_at IS NULL),
    EXISTS(SELECT 1 FROM public.resident_observation_assignments AS assignment
      WHERE assignment.task_id=v_task.id AND assignment.organization_id=p_organization_id
        AND assignment.facility_id=p_facility_id AND assignment.released_at IS NULL
        AND assignment.staff_id=v_staff_id)
  INTO v_has_active_assignment,v_is_active_assignee;

  IF v_role NOT IN('owner','org_admin','facility_admin','nurse')
     AND (CASE WHEN v_has_active_assignment THEN v_is_active_assignee ELSE v_task.assigned_staff_id=v_staff_id END) IS NOT TRUE THEN
    RAISE EXCEPTION 'Rounding task assignee changed' USING ERRCODE='42501';
  END IF;
  IF v_task.status IN('completed_on_time','completed_late','excused') THEN
    RAISE EXCEPTION 'Observation task is no longer completable' USING ERRCODE='P0001';
  END IF;
  v_status:=(p_payload->>'completion_status')::public.resident_observation_task_status;
  IF v_status NOT IN('completed_on_time','completed_late') THEN
    RAISE EXCEPTION 'Invalid completion status' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.resident_observation_logs(
    organization_id,entity_id,facility_id,resident_id,task_id,assigned_staff_id,staff_id,
    observed_at,entered_at,entry_mode,quick_status,resident_location,resident_position,resident_state,
    distress_present,breathing_concern,pain_concern,toileting_assisted,hydration_offered,repositioned,
    skin_concern_observed,fall_hazard_observed,refused_assistance,intervention_codes,exception_present,
    note,late_reason,created_by
  ) VALUES(
    v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_task.id,
    v_task.assigned_staff_id,v_staff_id,(p_payload->>'observed_at')::timestamptz,
    (p_payload->>'entered_at')::timestamptz,(p_payload->>'entry_mode')::public.resident_observation_entry_mode,
    (p_payload->>'quick_status')::public.resident_observation_quick_status,p_payload->>'resident_location',
    p_payload->>'resident_position',p_payload->>'resident_state',
    coalesce((p_payload->>'distress_present')::boolean,false),coalesce((p_payload->>'breathing_concern')::boolean,false),
    coalesce((p_payload->>'pain_concern')::boolean,false),coalesce((p_payload->>'toileting_assisted')::boolean,false),
    coalesce((p_payload->>'hydration_offered')::boolean,false),coalesce((p_payload->>'repositioned')::boolean,false),
    coalesce((p_payload->>'skin_concern_observed')::boolean,false),coalesce((p_payload->>'fall_hazard_observed')::boolean,false),
    coalesce((p_payload->>'refused_assistance')::boolean,false),ARRAY(SELECT pg_catalog.jsonb_array_elements_text(
      coalesce(p_payload->'intervention_codes','[]'::jsonb))),coalesce((p_payload->>'exception_present')::boolean,false),
    p_payload->>'note',p_payload->>'late_reason',p_actor_id
  ) RETURNING id INTO v_log_id;

  IF nullif(p_payload->>'exception_type','') IS NOT NULL THEN
    INSERT INTO public.resident_observation_exceptions(
      organization_id,entity_id,facility_id,resident_id,log_id,exception_type,severity,requires_follow_up,follow_up_status
    ) VALUES(v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_log_id,
      (p_payload->>'exception_type')::public.resident_observation_exception_type,
      coalesce(nullif(p_payload->>'exception_severity',''),'medium')::public.resident_observation_severity,true,'open');
  END IF;

  UPDATE public.resident_observation_tasks SET status=v_status,completed_log_id=v_log_id,updated_by=p_actor_id
  WHERE id=v_task.id;
  RETURN pg_catalog.jsonb_build_object('log_id',v_log_id,'status',v_status::text);
END $function$;

CREATE OR REPLACE FUNCTION public.user_auth_sync_status_review(p_target_user_id uuid,p_organization_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
 SELECT jsonb_build_object('job_id',job.id,'phase',CASE WHEN profile.is_active AND profile.deleted_at IS NULL
   AND EXISTS(SELECT 1 FROM auth.users WHERE id=profile.id AND banned_until>now())
   AND NOT haven.can_repair_user_auth_ban(profile.id) THEN 'dead_letter' WHEN
   haven.user_auth_matches_state(profile.id,profile.app_role,profile.organization_id,profile.auth_claim_version,
     NOT profile.is_active OR profile.deleted_at IS NOT NULL) THEN job.phase ELSE 'pending_auth' END,
   'command_phase',job.phase,'operation',job.operation,'next_attempt_at',job.next_attempt_at)
 FROM public.user_auth_sync_targets watch JOIN public.user_auth_sync_jobs job ON job.id=watch.latest_command_job_id
 JOIN public.user_profiles profile ON profile.id=watch.target_user_id
 WHERE watch.target_user_id=p_target_user_id AND watch.organization_id=p_organization_id
   AND job.target_user_id=watch.target_user_id AND job.organization_id=watch.organization_id
$function$;
REVOKE ALL ON FUNCTION public.user_auth_sync_status_review(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.user_auth_sync_status_review(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_operation_task_review(
  p_task_id uuid,p_actor_id uuid,p_actor_role text,p_notes text,p_evidence text[] DEFAULT '{}'
)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  t public.operation_task_instances%ROWTYPE;
  target text;
  finalizer uuid;
  v_current_role text;
  v_current_organization uuid;
BEGIN
  SELECT * INTO STRICT t FROM public.operation_task_instances
  WHERE id=p_task_id AND deleted_at IS NULL FOR UPDATE;
  SELECT profile.app_role::text,profile.organization_id
  INTO v_current_role,v_current_organization
  FROM public.user_profiles AS profile
  WHERE profile.id=p_actor_id AND profile.is_active AND profile.deleted_at IS NULL
  FOR SHARE;
  IF v_current_role IS NULL OR v_current_organization IS DISTINCT FROM t.organization_id
     OR v_current_role IS DISTINCT FROM p_actor_role
     OR (
       t.assigned_to=p_actor_id
       OR (t.assigned_to IS NULL AND t.assigned_role=v_current_role)
       OR v_current_role IN('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role')
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.facilities AS facility
  WHERE facility.id=t.facility_id AND facility.organization_id=v_current_organization AND facility.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501';
  END IF;
  IF v_current_role NOT IN('owner','org_admin') THEN
    PERFORM 1 FROM public.user_facility_access AS access
    WHERE access.user_id=p_actor_id AND access.organization_id=v_current_organization
      AND access.facility_id=t.facility_id AND access.revoked_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501';
    END IF;
  END IF;
  IF t.status='completed' THEN RETURN 'completed'; END IF;
  IF t.status NOT IN('pending','in_progress','missed','deferred') THEN RAISE EXCEPTION 'Task cannot be completed from this state'; END IF;
  IF t.signed_by IS NOT NULL AND t.requires_dual_sign THEN
    IF t.signed_by=p_actor_id THEN RAISE EXCEPTION 'A different authorized staff member must verify this task'; END IF;
    target:='completed'; finalizer:=p_actor_id;
  ELSE
    target:=CASE WHEN t.requires_dual_sign THEN 'in_progress' ELSE 'completed' END;
    finalizer:=CASE WHEN t.requires_dual_sign THEN NULL ELSE p_actor_id END;
  END IF;
  UPDATE public.operation_task_instances SET status=target,signed_by=coalesce(t.signed_by,p_actor_id),
    signed_at=coalesce(t.signed_at,now()),second_sign_by=CASE WHEN t.requires_dual_sign THEN finalizer END,
    second_signed_at=CASE WHEN t.requires_dual_sign AND finalizer IS NOT NULL THEN now() END,
    completed_at=coalesce(t.completed_at,now()),
    completion_notes=CASE WHEN t.signed_by IS NULL THEN p_notes ELSE t.completion_notes END,
    completion_evidence_paths=CASE WHEN t.signed_by IS NULL THEN p_evidence ELSE t.completion_evidence_paths END,
    verified_by=finalizer,verified_at=CASE WHEN finalizer IS NOT NULL THEN now() END,
    sla_met=(t.due_at IS NULL OR t.due_at>=coalesce(t.completed_at,now())),updated_by=p_actor_id
  WHERE id=t.id;
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'completed',t.status,target,p_actor_id,v_current_role,p_notes,
    jsonb_build_object('awaiting_second_verification',finalizer IS NULL,'independent_verification',t.signed_by IS NOT NULL));
  RETURN CASE WHEN target='in_progress' THEN 'awaiting_verification' ELSE target END;
END $$;

CREATE OR REPLACE FUNCTION public.defer_operation_task_review(
  p_task_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_deferred_until timestamptz,
  p_cancellation_reason text,
  p_request_key text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  t public.operation_task_instances%ROWTYPE;
  v_current_role text;
  v_current_organization uuid;
  v_reason text;
  v_request_hash text;
  v_expected_key text;
  v_replacement_id uuid;
  v_shift_date date;
  v_shift text;
BEGIN
  SELECT * INTO STRICT t FROM public.operation_task_instances
  WHERE id=p_task_id AND deleted_at IS NULL FOR UPDATE;

  SELECT profile.app_role::text,profile.organization_id
  INTO v_current_role,v_current_organization
  FROM public.user_profiles AS profile
  WHERE profile.id=p_actor_id AND profile.is_active AND profile.deleted_at IS NULL
  FOR SHARE;
  IF v_current_role IS NULL OR v_current_organization IS DISTINCT FROM t.organization_id
     OR v_current_role IS DISTINCT FROM p_actor_role
     OR (
       t.assigned_to=p_actor_id
       OR (t.assigned_to IS NULL AND t.assigned_role=v_current_role)
       OR v_current_role IN('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role')
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.facilities AS facility
  WHERE facility.id=t.facility_id AND facility.organization_id=v_current_organization AND facility.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501'; END IF;
  IF v_current_role NOT IN('owner','org_admin') THEN
    PERFORM 1 FROM public.user_facility_access AS access
    WHERE access.user_id=p_actor_id AND access.organization_id=v_current_organization
      AND access.facility_id=t.facility_id AND access.revoked_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501'; END IF;
  END IF;

  v_reason:=coalesce(nullif(trim(p_cancellation_reason),''),'Deferred to a later queue date');
  v_expected_key:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'operation-defer-v1:'||p_actor_id::text||':'||p_task_id::text,'UTF8'
  )),'hex');
  IF p_request_key IS DISTINCT FROM v_expected_key THEN
    RAISE EXCEPTION 'Invalid defer request key' USING ERRCODE='22023';
  END IF;
  v_request_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'task_id',p_task_id,'actor_id',p_actor_id,'deferred_until',p_deferred_until,'reason',v_reason
  )::text,'UTF8')),'hex');

  IF t.defer_request_key IS NOT NULL THEN
    IF t.defer_request_key=p_request_key AND t.defer_request_hash=v_request_hash
       AND t.deferred_replacement_task_id IS NOT NULL THEN
      RETURN jsonb_build_object('new_task_id',t.deferred_replacement_task_id,'replayed',true);
    END IF;
    RAISE EXCEPTION 'This defer request was already saved with different content. Refresh the task before retrying';
  END IF;
  IF p_deferred_until IS NULL OR p_deferred_until<=pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Deferred time must be in the future';
  END IF;
  IF t.status NOT IN('pending','in_progress','missed') THEN
    RAISE EXCEPTION 'Task cannot be deferred from this state';
  END IF;

  v_shift_date:=(p_deferred_until AT TIME ZONE 'America/New_York')::date;
  v_shift:=CASE
    WHEN extract(hour FROM p_deferred_until AT TIME ZONE 'America/New_York') BETWEEN 7 AND 14 THEN 'day'
    WHEN extract(hour FROM p_deferred_until AT TIME ZONE 'America/New_York') BETWEEN 15 AND 22 THEN 'evening'
    ELSE 'night'
  END;
  INSERT INTO public.operation_task_instances(
    organization_id,facility_id,template_id,template_name,template_category,template_cadence_type,
    assigned_shift_date,assigned_shift,assigned_to,assigned_role,status,priority,license_threatening,
    estimated_minutes,requires_dual_sign,due_at,created_by,updated_by
  ) VALUES(
    t.organization_id,t.facility_id,t.template_id,t.template_name,t.template_category,t.template_cadence_type,
    v_shift_date,v_shift,t.assigned_to,t.assigned_role,'pending',t.priority,t.license_threatening,
    t.estimated_minutes,t.requires_dual_sign,p_deferred_until,p_actor_id,p_actor_id
  ) RETURNING id INTO v_replacement_id;

  UPDATE public.operation_task_instances SET
    status='deferred',deferred_until=p_deferred_until,cancellation_reason=v_reason,
    defer_request_key=p_request_key,defer_request_hash=v_request_hash,
    deferred_replacement_task_id=v_replacement_id,updated_at=now(),updated_by=p_actor_id
  WHERE id=t.id;

  INSERT INTO public.operation_audit_log(
    organization_id,facility_id,task_instance_id,event_type,from_status,to_status,
    actor_id,actor_role,event_notes,event_data
  ) VALUES(
    t.organization_id,t.facility_id,t.id,'deferred',t.status,'deferred',
    p_actor_id,v_current_role,v_reason,jsonb_build_object(
      'deferred_to',p_deferred_until,'new_task_id',v_replacement_id,'source','admin-operations',
      'request_key',p_request_key,'request_hash',v_request_hash,'receipt_version',1
    )
  );
  RETURN jsonb_build_object('new_task_id',v_replacement_id,'replayed',false);
END $$;

NOTIFY pgrst,'reload schema';
