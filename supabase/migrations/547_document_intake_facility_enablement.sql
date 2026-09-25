-- COL-771: Document Intake is switched on one facility at a time.
--
-- Brian, 2026-09-25: "Intake starts on Homewood only 10/1." Migration 545 let
-- any upload role add documents at any facility it can reach. This adds the
-- per-organization list of facilities where intake is on; uploads anywhere
-- else are refused with a plain message. Facilities are added to the list as
-- each one is accepted (COL-843) — data, not code.
BEGIN;

ALTER TABLE public.document_intake_settings
  ADD COLUMN enabled_facility_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE OR REPLACE FUNCTION haven.document_intake_settings_for(p_org uuid) RETURNS public.document_intake_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT s FROM public.document_intake_settings s WHERE s.organization_id = p_org),
    ROW(p_org, 20, 24, 20971520,
      ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator'],
      ARRAY['owner','org_admin','facility_admin','manager','admin_assistant'],
      ARRAY['owner','org_admin'], now(), NULL, '{}'::uuid[])::public.document_intake_settings);
$$;

CREATE OR REPLACE FUNCTION haven.document_intake_can_upload(p_org uuid, p_facility uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; s public.document_intake_settings;
BEGIN
  SELECT * INTO a FROM haven.current_authorized_actor();
  IF a.actor_user_id IS NULL OR NOT a.actor_is_managed OR a.actor_organization_id IS DISTINCT FROM p_org OR p_facility IS NULL THEN RETURN false; END IF;
  s := haven.document_intake_settings_for(p_org);
  RETURN a.actor_role_text = ANY (s.upload_roles) AND haven.has_facility_access(p_facility)
     AND p_facility = ANY (s.enabled_facility_ids);
END $$;

-- The upload RPC gives a clearer reason than "cannot add documents" when the
-- facility simply is not switched on yet.
CREATE OR REPLACE FUNCTION public.document_intake_facility_enabled(p_facility uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_facility = ANY ((haven.document_intake_settings_for(haven.organization_id())).enabled_facility_ids);
$$;
REVOKE ALL ON FUNCTION public.document_intake_facility_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_intake_facility_enabled(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.document_intake_facility_enabled(uuid) IS
  'COL-771. COL-37 ruling: definer required to read the organization intake settings; returns one boolean for the caller''s own organization only.';

COMMIT;
NOTIFY pgrst, 'reload schema';
