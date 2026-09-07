-- SYS-001: current profile/Auth state is authoritative for every user token.
-- Version 1 accepts legacy JWTs without auth_claim_version. Once any authority
-- change increments the row, only a freshly hooked token can authorize access.

CREATE OR REPLACE FUNCTION haven.guard_profile_authorization_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.app_role IS DISTINCT FROM OLD.app_role
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    IF OLD.auth_claim_version = 2147483647 THEN
      RAISE EXCEPTION 'Authorization version exhausted' USING ERRCODE = '22003';
    END IF;
    NEW.auth_claim_version := GREATEST(NEW.auth_claim_version, OLD.auth_claim_version + 1);
  ELSIF NEW.auth_claim_version < OLD.auth_claim_version THEN
    NEW.auth_claim_version := OLD.auth_claim_version;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION haven.guard_profile_authorization_version() FROM PUBLIC;

CREATE TRIGGER guard_profile_authorization_version
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION haven.guard_profile_authorization_version();

CREATE OR REPLACE FUNCTION haven.advance_user_authorization_version(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  UPDATE public.user_profiles AS profile
  SET auth_claim_version = profile.auth_claim_version + 1
  WHERE profile.id = p_user_id
$function$;

REVOKE ALL ON FUNCTION haven.advance_user_authorization_version(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION haven.advance_facility_access_authorization_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM haven.advance_user_authorization_version(NEW.user_id);
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM haven.advance_user_authorization_version(OLD.user_id);
    RETURN OLD;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    PERFORM haven.advance_user_authorization_version(OLD.user_id);
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      PERFORM haven.advance_user_authorization_version(NEW.user_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION haven.advance_facility_access_authorization_version() FROM PUBLIC;

CREATE TRIGGER advance_facility_access_authorization_version
  AFTER INSERT OR UPDATE OR DELETE ON public.user_facility_access
  FOR EACH ROW
  EXECUTE FUNCTION haven.advance_facility_access_authorization_version();

CREATE OR REPLACE FUNCTION public.haven_custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid;
  v_claims jsonb;
  v_app_metadata jsonb;
  v_role text;
  v_organization_id uuid;
  v_raw_organization text;
  v_raw_version text;
  v_version integer;
BEGIN
  BEGIN
    v_user_id := NULLIF(event ->> 'user_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid custom-access-token user_id' USING ERRCODE = '22023';
  END;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing custom-access-token user_id' USING ERRCODE = '22023';
  END IF;

  SELECT profile.app_role::text, profile.organization_id, profile.auth_claim_version
  INTO v_role, v_organization_id, v_version
  FROM public.user_profiles AS profile
  WHERE profile.id = v_user_id;

  IF NOT FOUND THEN
    SELECT
      NULLIF(pg_catalog.btrim(auth_user.raw_app_meta_data ->> 'app_role'), ''),
      NULLIF(auth_user.raw_app_meta_data ->> 'organization_id', ''),
      NULLIF(auth_user.raw_app_meta_data ->> 'auth_claim_version', '')
    INTO v_role, v_raw_organization, v_raw_version
    FROM auth.users AS auth_user
    WHERE auth_user.id = v_user_id
      AND auth_user.deleted_at IS NULL
      AND (auth_user.banned_until IS NULL OR auth_user.banned_until <= pg_catalog.now());

    IF v_role IS DISTINCT FROM 'onboarding' THEN
      RETURN event;
    END IF;
    BEGIN
      v_organization_id := COALESCE(v_raw_organization::uuid, '00000000-0000-0000-0000-000000000001'::uuid);
      v_version := COALESCE(v_raw_version::integer, 1);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid onboarding authority metadata' USING ERRCODE = '22023';
    END;
    IF v_version < 1 THEN
      RAISE EXCEPTION 'Invalid onboarding authority version' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_claims := COALESCE(event -> 'claims', '{}'::jsonb);
  v_app_metadata := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb);
  v_claims := pg_catalog.jsonb_set(v_claims, '{auth_claim_version}', pg_catalog.to_jsonb(v_version), true);
  v_claims := pg_catalog.jsonb_set(v_claims, '{app_role}', pg_catalog.to_jsonb(v_role), true);
  v_claims := pg_catalog.jsonb_set(v_claims, '{organization_id}', COALESCE(pg_catalog.to_jsonb(v_organization_id), 'null'::jsonb), true);
  v_app_metadata := pg_catalog.jsonb_set(v_app_metadata, '{auth_claim_version}', pg_catalog.to_jsonb(v_version), true);
  v_app_metadata := pg_catalog.jsonb_set(v_app_metadata, '{app_role}', pg_catalog.to_jsonb(v_role), true);
  v_app_metadata := pg_catalog.jsonb_set(v_app_metadata, '{organization_id}', COALESCE(pg_catalog.to_jsonb(v_organization_id), 'null'::jsonb), true);
  v_claims := pg_catalog.jsonb_set(v_claims, '{app_metadata}', v_app_metadata, true);
  RETURN pg_catalog.jsonb_set(event, '{claims}', v_claims, true);
END;
$function$;

REVOKE ALL ON FUNCTION public.haven_custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.haven_custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- Internal actor resolver. JWT supplies only signed identity/session/version.
-- Current role and organization always come from database state.
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
     OR NOT (v_claim_version=v_current_version OR (v_claim_version IS NULL AND v_current_version=1)) THEN RETURN; END IF;
  actor_user_id := v_user_id;
  actor_role_text := 'onboarding';
  actor_app_role := NULL;
  actor_claim_version := v_current_version;
  actor_is_managed := false;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION haven.current_authorized_actor() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.authorized_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT actor.actor_user_id FROM haven.current_authorized_actor() AS actor WHERE actor.actor_is_managed LIMIT 1
$function$;
CREATE OR REPLACE FUNCTION haven.organization_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT actor.actor_organization_id FROM haven.current_authorized_actor() AS actor WHERE actor.actor_is_managed LIMIT 1
$function$;
CREATE OR REPLACE FUNCTION haven.app_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT actor.actor_app_role FROM haven.current_authorized_actor() AS actor WHERE actor.actor_is_managed LIMIT 1
$function$;
CREATE OR REPLACE FUNCTION haven.has_facility_access(p_facility_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT COALESCE((SELECT CASE
    WHEN actor.actor_app_role IN ('owner','org_admin') THEN EXISTS (
      SELECT 1 FROM public.facilities AS facility WHERE facility.id=p_facility_id
        AND facility.organization_id=actor.actor_organization_id AND facility.deleted_at IS NULL)
    ELSE EXISTS (
      SELECT 1 FROM public.user_facility_access AS access
      JOIN public.facilities AS facility ON facility.id=access.facility_id
      WHERE access.user_id=actor.actor_user_id AND access.facility_id=p_facility_id
        AND access.organization_id=actor.actor_organization_id AND access.revoked_at IS NULL
        AND facility.organization_id=actor.actor_organization_id AND facility.deleted_at IS NULL)
  END FROM haven.current_authorized_actor() AS actor WHERE actor.actor_is_managed), false)
$function$;
CREATE OR REPLACE FUNCTION haven.accessible_facility_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  WITH actor AS MATERIALIZED (
    SELECT * FROM haven.current_authorized_actor() AS current_actor WHERE current_actor.actor_is_managed
  )
  SELECT facility.id FROM actor JOIN public.facilities AS facility
    ON facility.organization_id=actor.actor_organization_id AND facility.deleted_at IS NULL
  WHERE actor.actor_app_role IN ('owner','org_admin')
  UNION
  SELECT access.facility_id FROM actor JOIN public.user_facility_access AS access
    ON access.user_id=actor.actor_user_id AND access.organization_id=actor.actor_organization_id AND access.revoked_at IS NULL
  JOIN public.facilities AS facility ON facility.id=access.facility_id
    AND facility.organization_id=actor.actor_organization_id AND facility.deleted_at IS NULL
  WHERE actor.actor_app_role NOT IN ('owner','org_admin')
$function$;
CREATE OR REPLACE FUNCTION haven.can_access_resident(p_resident_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT COALESCE((SELECT CASE WHEN actor.actor_app_role <> 'family' THEN true ELSE EXISTS (
    SELECT 1 FROM public.family_resident_links AS link WHERE link.user_id=actor.actor_user_id
      AND link.resident_id=p_resident_id AND link.organization_id=actor.actor_organization_id AND link.revoked_at IS NULL)
  END FROM haven.current_authorized_actor() AS actor WHERE actor.actor_is_managed), false)
$function$;
CREATE OR REPLACE FUNCTION haven.jwt_app_role_text()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT actor.actor_role_text FROM haven.current_authorized_actor() AS actor LIMIT 1
$function$;
CREATE OR REPLACE FUNCTION haven.can_access_onboarding_workspace()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT COALESCE((SELECT actor.actor_role_text IN (
    'onboarding','owner','org_admin','facility_admin','nurse','dietary','maintenance_role','broker'
  ) FROM haven.current_authorized_actor() AS actor), false)
$function$;
CREATE OR REPLACE FUNCTION haven.effective_onboarding_organization_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT actor.actor_organization_id FROM haven.current_authorized_actor() AS actor
  WHERE actor.actor_role_text IN ('onboarding','owner','org_admin','facility_admin','nurse','dietary','maintenance_role','broker') LIMIT 1
$function$;
CREATE OR REPLACE FUNCTION haven.is_onboarding_org_admin_jwt()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT COALESCE((SELECT actor.actor_is_managed AND actor.actor_role_text IN ('owner','org_admin')
  FROM haven.current_authorized_actor() AS actor), false)
$function$;

REVOKE ALL ON FUNCTION haven.authorized_user_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION haven.organization_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION haven.app_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION haven.has_facility_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION haven.accessible_facility_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION haven.can_access_resident(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION haven.jwt_app_role_text() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION haven.can_access_onboarding_workspace() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION haven.effective_onboarding_organization_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION haven.is_onboarding_org_admin_jwt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.authorized_user_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION haven.organization_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION haven.app_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION haven.has_facility_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION haven.accessible_facility_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION haven.can_access_resident(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION haven.jwt_app_role_text() TO authenticated;
GRANT EXECUTE ON FUNCTION haven.can_access_onboarding_workspace() TO authenticated;
GRANT EXECUTE ON FUNCTION haven.effective_onboarding_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION haven.is_onboarding_org_admin_jwt() TO authenticated;

CREATE OR REPLACE FUNCTION public.haven_assert_authorized_request()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_claims jsonb;
BEGIN
  v_claims := auth.jwt();
  IF v_claims ->> 'role' IS DISTINCT FROM 'authenticated' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM haven.current_authorized_actor()) THEN
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE=pg_catalog.json_build_object('code','HAVEN_AUTHORIZATION_STALE','message','Sign in again to continue.',
        'details','The Haven account, session, or authorization state is no longer current.','hint',NULL)::text,
      DETAIL=pg_catalog.json_build_object('status',401,'status_text','Unauthorized')::text;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.haven_assert_authorized_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.haven_assert_authorized_request() TO anon, authenticated, service_role;

DO $configuration$
DECLARE v_existing text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticator') THEN
    SELECT setting INTO v_existing FROM pg_catalog.pg_roles AS role,
      LATERAL pg_catalog.unnest(role.rolconfig) AS setting
    WHERE role.rolname='authenticator' AND setting LIKE 'pgrst.db_pre_request=%';
    IF v_existing IS NULL THEN
      EXECUTE 'ALTER ROLE authenticator SET pgrst.db_pre_request = ''public.haven_assert_authorized_request''';
    ELSIF v_existing <> 'pgrst.db_pre_request=public.haven_assert_authorized_request' THEN
      RAISE EXCEPTION 'Conflicting pgrst.db_pre_request: %',v_existing USING ERRCODE='55000';
    END IF;
  END IF;
END;
$configuration$;

-- High-cardinality resident policy: session/version lookups become InitPlans.
DROP POLICY IF EXISTS staff_see_residents_in_accessible_facilities ON public.residents;
CREATE POLICY staff_see_residents_in_accessible_facilities ON public.residents FOR SELECT TO authenticated USING (
  organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL AND (
    ((SELECT haven.app_role()) <> 'family' AND facility_id IN (SELECT haven.accessible_facility_ids()))
    OR ((SELECT haven.app_role()) = 'family' AND EXISTS (
      SELECT 1 FROM public.family_resident_links AS link WHERE link.user_id=(SELECT haven.authorized_user_id())
        AND link.resident_id=residents.id AND link.organization_id=residents.organization_id AND link.revoked_at IS NULL))));
DROP POLICY IF EXISTS clinical_staff_insert_residents ON public.residents;
CREATE POLICY clinical_staff_insert_residents ON public.residents FOR INSERT TO authenticated WITH CHECK (
  organization_id=(SELECT haven.organization_id()) AND facility_id IN (SELECT haven.accessible_facility_ids())
  AND (SELECT haven.app_role()) IN ('owner','org_admin','facility_admin','nurse'));
DROP POLICY IF EXISTS clinical_staff_update_residents ON public.residents;
CREATE POLICY clinical_staff_update_residents ON public.residents FOR UPDATE TO authenticated USING (
  organization_id=(SELECT haven.organization_id()) AND facility_id IN (SELECT haven.accessible_facility_ids())
  AND (SELECT haven.app_role()) IN ('owner','org_admin','facility_admin','nurse','caregiver')) WITH CHECK (
  organization_id=(SELECT haven.organization_id()) AND facility_id IN (SELECT haven.accessible_facility_ids())
  AND (SELECT haven.app_role()) IN ('owner','org_admin','facility_admin','nurse','caregiver'));

DROP POLICY IF EXISTS user_dashboard_preferences_select ON public.user_dashboard_preferences;
DROP POLICY IF EXISTS user_dashboard_preferences_insert ON public.user_dashboard_preferences;
DROP POLICY IF EXISTS user_dashboard_preferences_update ON public.user_dashboard_preferences;
DROP POLICY IF EXISTS user_dashboard_preferences_delete ON public.user_dashboard_preferences;
CREATE POLICY user_dashboard_preferences_select ON public.user_dashboard_preferences FOR SELECT TO authenticated
  USING (user_id=(SELECT haven.authorized_user_id()) AND deleted_at IS NULL);
CREATE POLICY user_dashboard_preferences_insert ON public.user_dashboard_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id=(SELECT haven.authorized_user_id()));
CREATE POLICY user_dashboard_preferences_update ON public.user_dashboard_preferences FOR UPDATE TO authenticated
  USING (user_id=(SELECT haven.authorized_user_id()) AND deleted_at IS NULL)
  WITH CHECK (user_id=(SELECT haven.authorized_user_id()));
CREATE POLICY user_dashboard_preferences_delete ON public.user_dashboard_preferences FOR DELETE TO authenticated
  USING (user_id=(SELECT haven.authorized_user_id()));

DROP POLICY IF EXISTS onboarding_questions_select ON public.onboarding_questions;
DROP POLICY IF EXISTS onboarding_questions_insert ON public.onboarding_questions;
DROP POLICY IF EXISTS onboarding_questions_update ON public.onboarding_questions;
DROP POLICY IF EXISTS onboarding_questions_delete ON public.onboarding_questions;
CREATE POLICY onboarding_questions_select ON public.onboarding_questions FOR SELECT TO authenticated
  USING ((SELECT haven.can_access_onboarding_workspace()));
CREATE POLICY onboarding_questions_insert ON public.onboarding_questions FOR INSERT TO authenticated
  WITH CHECK ((SELECT haven.is_onboarding_org_admin_jwt()));
CREATE POLICY onboarding_questions_update ON public.onboarding_questions FOR UPDATE TO authenticated
  USING ((SELECT haven.is_onboarding_org_admin_jwt())) WITH CHECK ((SELECT haven.is_onboarding_org_admin_jwt()));
CREATE POLICY onboarding_questions_delete ON public.onboarding_questions FOR DELETE TO authenticated
  USING ((SELECT haven.is_onboarding_org_admin_jwt()));
DROP POLICY IF EXISTS onboarding_responses_select ON public.onboarding_responses;
DROP POLICY IF EXISTS onboarding_responses_insert ON public.onboarding_responses;
DROP POLICY IF EXISTS onboarding_responses_update ON public.onboarding_responses;
DROP POLICY IF EXISTS onboarding_responses_delete ON public.onboarding_responses;
CREATE POLICY onboarding_responses_select ON public.onboarding_responses FOR SELECT TO authenticated USING (
  (SELECT haven.can_access_onboarding_workspace()) AND organization_id=(SELECT haven.effective_onboarding_organization_id()));
CREATE POLICY onboarding_responses_insert ON public.onboarding_responses FOR INSERT TO authenticated WITH CHECK (
  (SELECT haven.can_access_onboarding_workspace()) AND organization_id=(SELECT haven.effective_onboarding_organization_id()));
CREATE POLICY onboarding_responses_update ON public.onboarding_responses FOR UPDATE TO authenticated USING (
  (SELECT haven.can_access_onboarding_workspace()) AND organization_id=(SELECT haven.effective_onboarding_organization_id())) WITH CHECK (
  (SELECT haven.can_access_onboarding_workspace()) AND organization_id=(SELECT haven.effective_onboarding_organization_id()));
CREATE POLICY onboarding_responses_delete ON public.onboarding_responses FOR DELETE TO authenticated USING (
  (SELECT haven.can_access_onboarding_workspace()) AND organization_id=(SELECT haven.effective_onboarding_organization_id()));

DROP POLICY IF EXISTS "Owners see their own workspace files" ON public.workspace_files;
DROP POLICY IF EXISTS "Break-glass read of workspace files" ON public.workspace_files;
DROP POLICY IF EXISTS "Owners create their own workspace files" ON public.workspace_files;
DROP POLICY IF EXISTS "Owners update their own workspace files" ON public.workspace_files;
DROP POLICY IF EXISTS "Admins transfer workspace file ownership" ON public.workspace_files;
CREATE POLICY "Owners see their own workspace files" ON public.workspace_files FOR SELECT TO authenticated USING (
  organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL
  AND owner_user_id=(SELECT haven.authorized_user_id()));
CREATE POLICY "Break-glass read of workspace files" ON public.workspace_files FOR SELECT TO authenticated USING (
  organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL
  AND (SELECT haven.app_role()) IN ('owner','org_admin') AND EXISTS (
    SELECT 1 FROM public.workspace_breakglass_grants AS grant_row WHERE grant_row.resource_type='workspace_file'
      AND grant_row.resource_id=workspace_files.id AND grant_row.accessor_user_id=(SELECT haven.authorized_user_id())
      AND grant_row.expires_at>pg_catalog.now()));
CREATE POLICY "Owners create their own workspace files" ON public.workspace_files FOR INSERT TO authenticated WITH CHECK (
  organization_id=(SELECT haven.organization_id()) AND owner_user_id=(SELECT haven.authorized_user_id()));
CREATE POLICY "Owners update their own workspace files" ON public.workspace_files FOR UPDATE TO authenticated USING (
  organization_id=(SELECT haven.organization_id()) AND owner_user_id=(SELECT haven.authorized_user_id())) WITH CHECK (
  organization_id=(SELECT haven.organization_id()) AND owner_user_id=(SELECT haven.authorized_user_id()));
CREATE POLICY "Admins transfer workspace file ownership" ON public.workspace_files FOR UPDATE TO authenticated USING (
  organization_id=(SELECT haven.organization_id()) AND (SELECT haven.app_role()) IN ('owner','org_admin')) WITH CHECK (
  organization_id=(SELECT haven.organization_id()) AND (SELECT haven.app_role()) IN ('owner','org_admin'));

DROP POLICY IF EXISTS storage_wf_owner_select ON storage.objects;
DROP POLICY IF EXISTS storage_wf_owner_insert ON storage.objects;
DROP POLICY IF EXISTS storage_wf_owner_update ON storage.objects;
DROP POLICY IF EXISTS storage_wf_owner_delete ON storage.objects;
DROP POLICY IF EXISTS storage_wf_breakglass_select ON storage.objects;
CREATE POLICY storage_wf_owner_select ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='workspace-files' AND (storage.foldername(name))[1]=(SELECT haven.authorized_user_id())::text);
CREATE POLICY storage_wf_owner_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='workspace-files' AND (storage.foldername(name))[1]=(SELECT haven.authorized_user_id())::text);
CREATE POLICY storage_wf_owner_update ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id='workspace-files' AND (storage.foldername(name))[1]=(SELECT haven.authorized_user_id())::text) WITH CHECK (
  bucket_id='workspace-files' AND (storage.foldername(name))[1]=(SELECT haven.authorized_user_id())::text);
CREATE POLICY storage_wf_owner_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id='workspace-files' AND (storage.foldername(name))[1]=(SELECT haven.authorized_user_id())::text);
CREATE POLICY storage_wf_breakglass_select ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='workspace-files' AND (SELECT haven.app_role()) IN ('owner','org_admin') AND EXISTS (
    SELECT 1 FROM public.workspace_breakglass_grants AS grant_row WHERE grant_row.resource_type='workspace_file'
      AND grant_row.resource_id::text=(storage.foldername(objects.name))[2]
      AND grant_row.accessor_user_id=(SELECT haven.authorized_user_id()) AND grant_row.expires_at>pg_catalog.now()));

-- Daily operations are a sustained row-volume path. Preserve the final 019
-- role/facility semantics while evaluating row-invariant authority as InitPlans.
DROP POLICY IF EXISTS staff_see_daily_logs_in_accessible_facilities ON public.daily_logs;
CREATE POLICY staff_see_daily_logs_in_accessible_facilities ON public.daily_logs FOR SELECT TO authenticated USING (
  organization_id=(SELECT haven.organization_id())
  AND deleted_at IS NULL
  AND facility_id IN (SELECT haven.accessible_facility_ids())
  AND (SELECT haven.app_role()) NOT IN ('family','broker'));
DROP POLICY IF EXISTS caregivers_plus_insert_daily_logs ON public.daily_logs;
CREATE POLICY caregivers_plus_insert_daily_logs ON public.daily_logs FOR INSERT TO authenticated WITH CHECK (
  organization_id=(SELECT haven.organization_id())
  AND facility_id IN (SELECT haven.accessible_facility_ids())
  AND (SELECT haven.app_role()) IN ('owner','org_admin','facility_admin','nurse','caregiver'));
DROP POLICY IF EXISTS caregivers_update_daily_logs ON public.daily_logs;
CREATE POLICY caregivers_update_daily_logs ON public.daily_logs FOR UPDATE TO authenticated USING (
  organization_id=(SELECT haven.organization_id())
  AND facility_id IN (SELECT haven.accessible_facility_ids())
  AND (logged_by=(SELECT haven.authorized_user_id())
    OR (SELECT haven.app_role()) IN ('owner','org_admin','facility_admin','nurse')));

-- report_runs is the persisted history/current execution path used by report
-- hubs, report detail, PDF generation, and the scheduler. Preserve migration
-- 323's final role, scope, status, ownership, and receipt semantics.
DROP POLICY IF EXISTS report_runs_select ON public.report_runs;
CREATE POLICY report_runs_select ON public.report_runs FOR SELECT TO authenticated USING (
  organization_id=(SELECT haven.organization_id())
  AND (SELECT haven.app_role()) IN ('owner','org_admin','facility_admin')
  AND ((SELECT haven.app_role()) IN ('owner','org_admin')
    OR (run_scope_json->>'facility_id')::uuid IN (SELECT haven.accessible_facility_ids())));
DROP POLICY IF EXISTS report_runs_insert ON public.report_runs;
CREATE POLICY report_runs_insert ON public.report_runs FOR INSERT TO authenticated WITH CHECK (
  organization_id=(SELECT haven.organization_id())
  AND generated_by_user_id=(SELECT haven.authorized_user_id())
  AND (SELECT haven.app_role()) IN ('owner','org_admin','facility_admin')
  AND status='running' AND result_snapshot_json IS NULL AND schedule_id IS NULL
  AND ((SELECT haven.app_role()) IN ('owner','org_admin')
    OR (run_scope_json->>'facility_id')::uuid IN (SELECT haven.accessible_facility_ids())));
DROP POLICY IF EXISTS report_runs_finalize_own ON public.report_runs;
CREATE POLICY report_runs_finalize_own ON public.report_runs FOR UPDATE TO authenticated USING (
  organization_id=(SELECT haven.organization_id())
  AND generated_by_user_id=(SELECT haven.authorized_user_id())
  AND status='running'
  AND (SELECT haven.app_role()) IN ('owner','org_admin','facility_admin')) WITH CHECK (
  organization_id=(SELECT haven.organization_id())
  AND generated_by_user_id=(SELECT haven.authorized_user_id())
  AND status IN ('completed','failed'));

-- Service-role task completion must not trust route-supplied actor role. Re-read
-- current profile, organization, facility, grant, and assignment/admin scope
-- while the task row is locked in the same transaction as the mutation.
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
     OR NOT (
       t.assigned_to=p_actor_id
       OR (t.assigned_to IS NULL AND t.assigned_role=v_current_role)
       OR v_current_role IN('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role')
     ) THEN
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
REVOKE ALL ON FUNCTION public.complete_operation_task_review(uuid,uuid,text,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_operation_task_review(uuid,uuid,text,text,text[]) TO service_role;

ALTER TABLE public.operation_task_instances
  ADD COLUMN defer_request_key text,
  ADD COLUMN defer_request_hash text,
  ADD COLUMN deferred_replacement_task_id uuid REFERENCES public.operation_task_instances(id);
CREATE UNIQUE INDEX idx_operation_task_defer_request_key
  ON public.operation_task_instances(defer_request_key)
  WHERE defer_request_key IS NOT NULL;

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
     OR NOT (
       t.assigned_to=p_actor_id
       OR (t.assigned_to IS NULL AND t.assigned_role=v_current_role)
       OR v_current_role IN('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role')
     ) THEN
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
REVOKE ALL ON FUNCTION public.defer_operation_task_review(uuid,uuid,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.defer_operation_task_review(uuid,uuid,text,timestamptz,text,text) TO service_role;

-- Rounding's request-scoped writes use current RLS at the statement boundary.
-- Keep its staff and manager policies aligned with the current actor helpers.
CREATE OR REPLACE FUNCTION haven.current_staff_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT staff.id
  FROM public.staff AS staff
  WHERE staff.user_id=(SELECT haven.authorized_user_id())
    AND staff.organization_id=(SELECT haven.organization_id())
    AND staff.employment_status='active'
    AND staff.deleted_at IS NULL
    AND staff.facility_id IN(SELECT haven.accessible_facility_ids())
$function$;
REVOKE ALL ON FUNCTION haven.current_staff_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.current_staff_ids() TO authenticated,service_role;

DROP POLICY IF EXISTS resident_observation_escalations_update ON public.resident_observation_escalations;
CREATE POLICY resident_observation_escalations_update ON public.resident_observation_escalations
FOR UPDATE TO authenticated USING(
  organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL
  AND (SELECT haven.app_role()) IN('owner','org_admin','facility_admin','nurse')
  AND facility_id IN(SELECT haven.accessible_facility_ids())
) WITH CHECK(
  organization_id=(SELECT haven.organization_id())
  AND (SELECT haven.app_role()) IN('owner','org_admin','facility_admin','nurse')
  AND facility_id IN(SELECT haven.accessible_facility_ids())
);

DROP POLICY IF EXISTS roa_update_policy ON public.resident_observation_assignments;
CREATE POLICY roa_update_policy ON public.resident_observation_assignments
FOR UPDATE TO authenticated USING(
  organization_id=(SELECT haven.organization_id())
  AND (SELECT haven.app_role()) IN('owner','org_admin','facility_admin','nurse')
  AND facility_id IN(SELECT haven.accessible_facility_ids())
) WITH CHECK(
  organization_id=(SELECT haven.organization_id())
  AND (SELECT haven.app_role()) IN('owner','org_admin','facility_admin','nurse')
  AND facility_id IN(SELECT haven.accessible_facility_ids())
);

DROP POLICY IF EXISTS resident_watch_events_insert ON public.resident_watch_events;
CREATE POLICY resident_watch_events_insert ON public.resident_watch_events
FOR INSERT TO authenticated WITH CHECK(
  organization_id=(SELECT haven.organization_id())
  AND (SELECT haven.app_role()) IN('owner','org_admin','facility_admin','nurse')
  AND facility_id IN(SELECT haven.accessible_facility_ids())
);

DROP POLICY IF EXISTS resident_observation_exceptions_insert ON public.resident_observation_exceptions;
CREATE POLICY resident_observation_exceptions_insert ON public.resident_observation_exceptions
FOR INSERT TO authenticated WITH CHECK(
  organization_id=(SELECT haven.organization_id())
  AND facility_id IN(SELECT haven.accessible_facility_ids())
  AND ((SELECT haven.app_role()) IN('owner','org_admin','facility_admin','nurse') OR EXISTS(
    SELECT 1 FROM public.resident_observation_logs AS log
    WHERE log.id=public.resident_observation_exceptions.log_id
      AND log.organization_id=public.resident_observation_exceptions.organization_id
      AND log.facility_id=public.resident_observation_exceptions.facility_id
      AND log.created_by=(SELECT haven.authorized_user_id()) AND log.deleted_at IS NULL
  ))
);

DROP POLICY IF EXISTS resident_observation_integrity_flags_insert ON public.resident_observation_integrity_flags;
CREATE POLICY resident_observation_integrity_flags_insert ON public.resident_observation_integrity_flags
FOR INSERT TO authenticated WITH CHECK(
  organization_id=(SELECT haven.organization_id())
  AND facility_id IN(SELECT haven.accessible_facility_ids())
  AND ((SELECT haven.app_role()) IN('owner','org_admin','facility_admin','nurse') OR (
    staff_id IN(SELECT haven.current_staff_ids()) AND EXISTS(
      SELECT 1 FROM public.resident_observation_logs AS log
      WHERE log.id=public.resident_observation_integrity_flags.log_id
        AND log.organization_id=public.resident_observation_integrity_flags.organization_id
        AND log.facility_id=public.resident_observation_integrity_flags.facility_id
        AND log.created_by=(SELECT haven.authorized_user_id()) AND log.deleted_at IS NULL
    )
  ))
);

-- Internal verifier for service-only rounding commands. Signed claim facts are
-- extracted server-side after getUser/getClaims and matched to locked current
-- Auth, session, profile, facility, grant, and staff rows.
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
     OR NOT(p_claim_version=v_version OR (p_claim_version IS NULL AND v_version=1))
     OR (p_manager_only AND v_role NOT IN('owner','org_admin','facility_admin','nurse'))
     OR (v_role NOT IN('owner','org_admin') AND NOT v_has_grant) THEN
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
REVOKE ALL ON FUNCTION haven.assert_rounding_service_actor(uuid,text,uuid,integer,uuid,uuid,boolean,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.generate_rounding_tasks_review(
  p_rows jsonb,p_actor_id uuid,p_actor_role text,p_session_id uuid,p_claim_version integer,
  p_organization_id uuid,p_facility_id uuid
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_count integer;
BEGIN
  PERFORM haven.assert_rounding_service_actor(p_actor_id,p_actor_role,p_session_id,p_claim_version,
    p_organization_id,p_facility_id,true,false);
  IF pg_catalog.jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid rounding task payload' USING ERRCODE='22023';
  END IF;
  IF EXISTS(
    SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_rows) AS row(
      organization_id uuid,facility_id uuid,resident_id uuid,plan_id uuid,plan_rule_id uuid
    )
    WHERE row.organization_id IS DISTINCT FROM p_organization_id OR row.facility_id IS DISTINCT FROM p_facility_id
      OR NOT EXISTS(SELECT 1 FROM public.residents AS resident WHERE resident.id=row.resident_id
        AND resident.organization_id=p_organization_id AND resident.facility_id=p_facility_id AND resident.deleted_at IS NULL)
      OR NOT EXISTS(SELECT 1 FROM public.resident_observation_plans AS plan WHERE plan.id=row.plan_id
        AND plan.organization_id=p_organization_id AND plan.facility_id=p_facility_id AND plan.resident_id=row.resident_id
        AND plan.deleted_at IS NULL)
  ) THEN RAISE EXCEPTION 'Invalid rounding task scope' USING ERRCODE='42501'; END IF;

  INSERT INTO public.resident_observation_tasks(
    organization_id,entity_id,facility_id,resident_id,plan_id,plan_rule_id,watch_instance_id,
    shift_assignment_id,assigned_staff_id,scheduled_for,due_at,grace_ends_at,status,notes
  ) SELECT row.organization_id,row.entity_id,row.facility_id,row.resident_id,row.plan_id,row.plan_rule_id,
      row.watch_instance_id,row.shift_assignment_id,row.assigned_staff_id,row.scheduled_for,row.due_at,
      row.grace_ends_at,row.status::public.resident_observation_task_status,row.notes
    FROM pg_catalog.jsonb_to_recordset(p_rows) AS row(
      organization_id uuid,entity_id uuid,facility_id uuid,resident_id uuid,plan_id uuid,plan_rule_id uuid,
      watch_instance_id uuid,shift_assignment_id uuid,assigned_staff_id uuid,scheduled_for timestamptz,
      due_at timestamptz,grace_ends_at timestamptz,status text,notes text
    )
  ON CONFLICT(resident_id,plan_rule_id,due_at) WHERE deleted_at IS NULL AND plan_rule_id IS NOT NULL
  DO UPDATE SET entity_id=excluded.entity_id,facility_id=excluded.facility_id,plan_id=excluded.plan_id,
    watch_instance_id=excluded.watch_instance_id,shift_assignment_id=excluded.shift_assignment_id,
    assigned_staff_id=excluded.assigned_staff_id,scheduled_for=excluded.scheduled_for,
    grace_ends_at=excluded.grace_ends_at,status=excluded.status,notes=excluded.notes;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $function$;
REVOKE ALL ON FUNCTION public.generate_rounding_tasks_review(jsonb,uuid,text,uuid,integer,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.generate_rounding_tasks_review(jsonb,uuid,text,uuid,integer,uuid,uuid) TO service_role;

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
     AND NOT(CASE WHEN v_has_active_assignment THEN v_is_active_assignee ELSE v_task.assigned_staff_id=v_staff_id END) THEN
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
REVOKE ALL ON FUNCTION public.complete_rounding_task_review(uuid,uuid,text,uuid,integer,uuid,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_rounding_task_review(uuid,uuid,text,uuid,integer,uuid,uuid,uuid,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reassign_rounding_task_review(
  p_task_id uuid,p_new_staff_id uuid,p_reason text,p_actor_id uuid,p_actor_role text,
  p_session_id uuid,p_claim_version integer,p_organization_id uuid,p_facility_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_task public.resident_observation_tasks%ROWTYPE; v_released_at timestamptz:=pg_catalog.now();
BEGIN
  SELECT * INTO STRICT v_task FROM public.resident_observation_tasks
  WHERE id=p_task_id AND organization_id=p_organization_id AND facility_id=p_facility_id AND deleted_at IS NULL FOR UPDATE;
  PERFORM haven.assert_rounding_service_actor(p_actor_id,p_actor_role,p_session_id,p_claim_version,
    p_organization_id,p_facility_id,true,false);
  -- The live board treats these as actionable work. Missed is retained as
  -- evidence; escalated has no documented reassignment transition and fails
  -- closed. Reassigned remains actionable for a later supervisor handoff.
  IF v_task.completed_log_id IS NOT NULL OR v_task.status NOT IN(
    'upcoming','due_soon','due_now','overdue','critically_overdue','reassigned'
  ) THEN
    RAISE EXCEPTION 'Observation task cannot be reassigned from its current status' USING ERRCODE='P0001';
  END IF;
  PERFORM 1 FROM public.staff AS staff WHERE staff.id=p_new_staff_id AND staff.organization_id=p_organization_id
    AND staff.facility_id=p_facility_id AND staff.employment_status='active' AND staff.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assigned staff member is unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.resident_observation_assignments AS assignment
    WHERE assignment.task_id=v_task.id AND assignment.released_at IS NULL ORDER BY assignment.id FOR UPDATE;
  IF v_task.assigned_staff_id IS NOT NULL THEN
    UPDATE public.resident_observation_assignments SET released_at=v_released_at
    WHERE task_id=v_task.id AND staff_id=v_task.assigned_staff_id AND organization_id=p_organization_id
      AND facility_id=p_facility_id AND released_at IS NULL;
  END IF;
  INSERT INTO public.resident_observation_assignments(
    organization_id,entity_id,facility_id,resident_id,task_id,shift_assignment_id,staff_id,
    assignment_type,assigned_at,reason,created_by
  ) VALUES(p_organization_id,v_task.entity_id,p_facility_id,v_task.resident_id,v_task.id,
    v_task.shift_assignment_id,p_new_staff_id,'reassignment',v_released_at,p_reason,p_actor_id);
  UPDATE public.resident_observation_tasks SET assigned_staff_id=p_new_staff_id,
    reassigned_from_staff_id=v_task.assigned_staff_id,reassignment_reason=p_reason,status='reassigned',updated_by=p_actor_id
  WHERE id=v_task.id;
  RETURN pg_catalog.jsonb_build_object('task_id',v_task.id,'assigned_staff_id',p_new_staff_id,'status','reassigned');
END $function$;
REVOKE ALL ON FUNCTION public.reassign_rounding_task_review(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_rounding_task_review(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.update_rounding_integrity_flag_review(
  p_flag_id uuid,p_action text,p_note text,p_assigned_staff_id uuid,p_actor_id uuid,p_actor_role text,
  p_session_id uuid,p_claim_version integer,p_organization_id uuid,p_facility_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_flag public.resident_observation_integrity_flags%ROWTYPE; v_status text; v_now timestamptz:=pg_catalog.now();
BEGIN
  SELECT * INTO STRICT v_flag FROM public.resident_observation_integrity_flags
  WHERE id=p_flag_id AND organization_id=p_organization_id AND facility_id=p_facility_id AND deleted_at IS NULL FOR UPDATE;
  PERFORM haven.assert_rounding_service_actor(p_actor_id,p_actor_role,p_session_id,p_claim_version,
    p_organization_id,p_facility_id,true,false);
  IF p_action='assign' THEN
    IF p_assigned_staff_id IS NOT NULL THEN
      PERFORM 1 FROM public.staff AS staff WHERE staff.id=p_assigned_staff_id AND staff.organization_id=p_organization_id
        AND staff.facility_id=p_facility_id AND staff.employment_status='active' AND staff.deleted_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Assigned staff member is unavailable' USING ERRCODE='42501'; END IF;
    END IF;
    UPDATE public.resident_observation_integrity_flags SET assigned_to_staff_id=p_assigned_staff_id,
      assigned_at=CASE WHEN p_assigned_staff_id IS NULL THEN NULL ELSE v_now END,
      disposition_note=CASE WHEN coalesce(p_note,'')='' THEN disposition_note ELSE p_note END,
      reviewed_by=p_actor_id,updated_by=p_actor_id WHERE id=v_flag.id RETURNING status::text INTO v_status;
  ELSIF p_action='start_review' THEN
    IF v_flag.status<>'open' THEN RAISE EXCEPTION 'Integrity flag state changed'; END IF;
    UPDATE public.resident_observation_integrity_flags SET status='in_progress',
      disposition_note=CASE WHEN coalesce(p_note,'')='' THEN disposition_note ELSE p_note END,
      reviewed_by=p_actor_id,updated_by=p_actor_id WHERE id=v_flag.id RETURNING status::text INTO v_status;
  ELSIF p_action IN('resolve','dismiss') THEN
    IF v_flag.status IN('resolved','dismissed') THEN RAISE EXCEPTION 'Integrity flag state changed'; END IF;
    UPDATE public.resident_observation_integrity_flags SET status=p_action::public.resident_observation_follow_up_status,
      disposition_note=coalesce(nullif(p_note,''),CASE WHEN p_action='resolve'
        THEN 'Resolved from the Smart Rounding integrity review queue.'
        ELSE 'Dismissed from the Smart Rounding integrity review queue.' END),
      reviewed_by=p_actor_id,updated_by=p_actor_id WHERE id=v_flag.id RETURNING status::text INTO v_status;
  ELSE RAISE EXCEPTION 'Invalid integrity action' USING ERRCODE='22023'; END IF;
  RETURN pg_catalog.jsonb_build_object('id',v_flag.id,'status',v_status,'assigned_staff_id',p_assigned_staff_id);
END $function$;
REVOKE ALL ON FUNCTION public.update_rounding_integrity_flag_review(uuid,text,text,uuid,uuid,text,uuid,integer,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_rounding_integrity_flag_review(uuid,text,text,uuid,uuid,text,uuid,integer,uuid,uuid)
  TO service_role;

-- The browser-facing one-argument discovery command continues to use current
-- RLS authority. Service-role routes must use this actor-bound overload so a
-- stale route snapshot cannot bypass current role, organization, or grant.
CREATE OR REPLACE FUNCTION public.apply_col_discovery_round_observation_plan(
  p_resident_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_session_id uuid,
  p_claim_version integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_resident public.residents%ROWTYPE;
  v_actor jsonb;
  v_claims jsonb;
  v_plan_id uuid;
BEGIN
  SELECT resident.* INTO STRICT v_resident
  FROM public.residents AS resident
  JOIN public.facilities AS facility
    ON facility.id=resident.facility_id
   AND facility.organization_id=resident.organization_id
   AND facility.deleted_at IS NULL
  WHERE resident.id=p_resident_id AND resident.deleted_at IS NULL
  FOR UPDATE OF resident
  FOR SHARE OF facility;

  v_actor:=haven.assert_rounding_service_actor(p_actor_id,p_actor_role,p_session_id,p_claim_version,
    v_resident.organization_id,v_resident.facility_id,true,false);

  v_claims:=coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  v_claims:=pg_catalog.jsonb_set(v_claims,'{role}',pg_catalog.to_jsonb('service_role'::text),true);
  v_claims:=pg_catalog.jsonb_set(v_claims,'{sub}',pg_catalog.to_jsonb(p_actor_id::text),true);
  PERFORM pg_catalog.set_config('request.jwt.claims',v_claims::text,true);
  v_plan_id:=public.apply_col_discovery_round_observation_plan(p_resident_id);
  RETURN v_plan_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.apply_col_discovery_round_observation_plan(uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.apply_col_discovery_round_observation_plan(uuid,uuid,text,uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_col_discovery_round_observation_plan(uuid,uuid,text,uuid,integer) TO service_role;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
