-- COL-328 / REF-01: referral current-authority and sensitive-field boundary.
--
-- This is a security baseline, not an operating-policy approval. It makes the
-- explicit roles already used by the referral lead and outreach policies
-- authoritative, denies direct reads of sensitive lead columns, and exposes
-- the minimum RPC doors needed by the existing referral UI. Future operating
-- policy remains inactive until the authorized operator approves it.

BEGIN;

CREATE OR REPLACE FUNCTION haven.referral_capability(p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT CASE p_capability
      WHEN 'lead_read' THEN actor.actor_role_text = ANY (ARRAY[
        'owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse'
      ])
      WHEN 'contact_read' THEN actor.actor_role_text = ANY (ARRAY[
        'owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse'
      ])
      WHEN 'clinical_read' THEN actor.actor_role_text = ANY (ARRAY[
        'owner','org_admin','facility_admin','nurse'
      ])
      WHEN 'lead_write' THEN actor.actor_role_text = ANY (ARRAY[
        'owner','org_admin','facility_admin','nurse'
      ])
      WHEN 'lead_export' THEN actor.actor_role_text = ANY (ARRAY[
        'owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse'
      ])
      WHEN 'duplicate_review' THEN actor.actor_role_text = ANY (ARRAY[
        'owner','org_admin','facility_admin','nurse'
      ])
      WHEN 'triage_submit' THEN actor.actor_role_text = ANY (ARRAY[
        'owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse'
      ])
      WHEN 'triage_read' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin'])
      WHEN 'source_manage' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin'])
      ELSE false
    END
    FROM haven.current_authorized_actor() AS actor
    WHERE actor.actor_is_managed
    LIMIT 1
  ), false)
$function$;

COMMENT ON FUNCTION haven.referral_capability(text) IS
  'Current database-backed referral capability baseline. Unknown capabilities deny. This is not an operator-approved configurable policy.';

REVOKE ALL ON FUNCTION haven.referral_capability(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.referral_capability(text) TO authenticated, service_role;

DROP POLICY IF EXISTS referral_sources_select ON public.referral_sources;
CREATE POLICY referral_sources_select ON public.referral_sources
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND (SELECT haven.referral_capability('lead_read'))
    AND (facility_id IS NULL OR (SELECT haven.has_facility_access(facility_id)))
  );

DROP POLICY IF EXISTS referral_sources_insert ON public.referral_sources;
CREATE POLICY referral_sources_insert ON public.referral_sources
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT haven.organization_id())
    AND (SELECT haven.referral_capability('source_manage'))
    AND (facility_id IS NULL OR (SELECT haven.has_facility_access(facility_id)))
  );

DROP POLICY IF EXISTS referral_sources_update ON public.referral_sources;
CREATE POLICY referral_sources_update ON public.referral_sources
  FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND (SELECT haven.referral_capability('source_manage'))
    AND (facility_id IS NULL OR (SELECT haven.has_facility_access(facility_id)))
  )
  WITH CHECK (
    organization_id = (SELECT haven.organization_id())
    AND (SELECT haven.referral_capability('source_manage'))
    AND (facility_id IS NULL OR (SELECT haven.has_facility_access(facility_id)))
  );

DROP POLICY IF EXISTS referral_leads_select ON public.referral_leads;
CREATE POLICY referral_leads_select ON public.referral_leads
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND (SELECT haven.referral_capability('lead_read'))
    AND (SELECT haven.has_facility_access(facility_id))
  );

DROP POLICY IF EXISTS referral_leads_insert ON public.referral_leads;
CREATE POLICY referral_leads_insert ON public.referral_leads
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT haven.organization_id())
    AND (SELECT haven.referral_capability('lead_write'))
    AND (SELECT haven.has_facility_access(facility_id))
  );

DROP POLICY IF EXISTS referral_leads_update ON public.referral_leads;
CREATE POLICY referral_leads_update ON public.referral_leads
  FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND (SELECT haven.referral_capability('lead_write'))
    AND (SELECT haven.has_facility_access(facility_id))
  )
  WITH CHECK (
    organization_id = (SELECT haven.organization_id())
    AND (SELECT haven.referral_capability('lead_write'))
    AND (SELECT haven.has_facility_access(facility_id))
  );

CREATE OR REPLACE FUNCTION haven.guard_referral_source_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_organization_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  v_actor_id := haven.authorized_user_id();
  v_organization_id := haven.organization_id();
  IF v_actor_id IS NULL OR v_organization_id IS NULL
     OR NOT haven.referral_capability('source_manage') THEN
    RAISE EXCEPTION 'Referral source authority required' USING ERRCODE = '42501';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM v_organization_id THEN
    RAISE EXCEPTION 'Referral source organization unavailable' USING ERRCODE = '42501';
  END IF;
  IF NEW.facility_id IS NOT NULL AND NOT haven.has_facility_access(NEW.facility_id) THEN
    RAISE EXCEPTION 'Referral source facility unavailable' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := v_actor_id;
  ELSE
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'Referral source organization cannot be changed' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
  END IF;
  NEW.updated_by := v_actor_id;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION haven.guard_referral_source_authority() FROM PUBLIC;
DROP TRIGGER IF EXISTS tr_referral_source_authority ON public.referral_sources;
CREATE TRIGGER tr_referral_source_authority
  BEFORE INSERT OR UPDATE ON public.referral_sources
  FOR EACH ROW EXECUTE FUNCTION haven.guard_referral_source_authority();

CREATE OR REPLACE FUNCTION haven.guard_referral_lead_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_organization_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  v_actor_id := haven.authorized_user_id();
  v_organization_id := haven.organization_id();
  IF v_actor_id IS NULL OR v_organization_id IS NULL
     OR NOT haven.referral_capability('lead_write') THEN
    RAISE EXCEPTION 'Referral write authority required' USING ERRCODE = '42501';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM v_organization_id
     OR NOT haven.has_facility_access(NEW.facility_id) THEN
    RAISE EXCEPTION 'Referral lead scope unavailable' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.facility_id IS DISTINCT FROM OLD.facility_id THEN
      RAISE EXCEPTION 'Referral lead scope cannot be changed directly' USING ERRCODE = '42501';
    END IF;
    IF NEW.merged_into_lead_id IS DISTINCT FROM OLD.merged_into_lead_id
       OR NEW.merged_at IS DISTINCT FROM OLD.merged_at
       OR NEW.merged_by IS DISTINCT FROM OLD.merged_by THEN
      RAISE EXCEPTION 'Referral merges require the dedicated merge command' USING ERRCODE = '42501';
    END IF;
    IF NEW.pii_access_tier IS DISTINCT FROM OLD.pii_access_tier THEN
      RAISE EXCEPTION 'Referral PII tier requires controlled approval' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
  ELSE
    NEW.created_by := v_actor_id;
    NEW.pii_access_tier := 'standard_ops';
    IF NEW.merged_into_lead_id IS NOT NULL OR NEW.merged_at IS NOT NULL OR NEW.merged_by IS NOT NULL THEN
      RAISE EXCEPTION 'Referral merges require the dedicated merge command' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_by := v_actor_id;
  IF TG_OP = 'INSERT' THEN
    NEW.tour_owner_user_id := CASE
      WHEN NEW.tour_scheduled_for IS NOT NULL OR NEW.tour_completed_at IS NOT NULL
        THEN v_actor_id
      ELSE NULL
    END;
  ELSIF NEW.tour_scheduled_for IS DISTINCT FROM OLD.tour_scheduled_for
     OR NEW.tour_completed_at IS DISTINCT FROM OLD.tour_completed_at THEN
    NEW.tour_owner_user_id := CASE
      WHEN NEW.tour_scheduled_for IS NOT NULL OR NEW.tour_completed_at IS NOT NULL
        THEN v_actor_id
      ELSE NULL
    END;
  ELSIF NEW.tour_owner_user_id IS DISTINCT FROM OLD.tour_owner_user_id THEN
    RAISE EXCEPTION 'Tour ownership follows the current tour command actor' USING ERRCODE = '42501';
  END IF;

  IF NEW.referral_source_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.referral_sources AS source
    WHERE source.id = NEW.referral_source_id
      AND source.organization_id = NEW.organization_id
      AND source.deleted_at IS NULL
      AND (source.facility_id IS NULL OR source.facility_id = NEW.facility_id)
  ) THEN
    RAISE EXCEPTION 'Referral source unavailable for lead scope' USING ERRCODE = '42501';
  END IF;

  IF NEW.converted_resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.residents AS resident
    WHERE resident.id = NEW.converted_resident_id
      AND resident.organization_id = NEW.organization_id
      AND resident.facility_id = NEW.facility_id
      AND resident.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Converted resident unavailable for lead scope' USING ERRCODE = '42501';
  END IF;

  IF NEW.merged_into_lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.referral_leads AS winner
    WHERE winner.id = NEW.merged_into_lead_id
      AND winner.organization_id = NEW.organization_id
      AND winner.facility_id = NEW.facility_id
      AND winner.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Merge target unavailable for lead scope' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION haven.guard_referral_lead_authority() FROM PUBLIC;
DROP TRIGGER IF EXISTS tr_referral_lead_authority ON public.referral_leads;
CREATE TRIGGER tr_referral_lead_authority
  BEFORE INSERT OR UPDATE ON public.referral_leads
  FOR EACH ROW EXECUTE FUNCTION haven.guard_referral_lead_authority();

-- Direct clients retain the non-sensitive columns needed by legacy joins and
-- workflows. Contact, clinical, external-reference, and free-text fields are
-- available only through the current-authority projection below.
REVOKE ALL ON TABLE public.referral_leads FROM anon;
REVOKE SELECT ON TABLE public.referral_leads FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.referral_leads FROM authenticated;
GRANT SELECT (
  id, organization_id, facility_id, referral_source_id, status, pii_access_tier,
  first_name, last_name, preferred_name, converted_resident_id, converted_at,
  merged_into_lead_id, merged_at, merged_by, created_at, updated_at, created_by,
  updated_by, deleted_at, tour_scheduled_for, tour_completed_at,
  tour_owner_user_id, tour_expected_week, preferred_contact, inquiry_date,
  closed_at, closed_by_party, closure_reason_id
) ON public.referral_leads TO authenticated;

REVOKE ALL ON TABLE public.referral_sources FROM anon;
REVOKE DELETE, TRUNCATE ON TABLE public.referral_sources FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.referral_sources TO authenticated;
GRANT ALL ON TABLE public.referral_sources, public.referral_leads TO service_role;

CREATE OR REPLACE FUNCTION public.referral_leads_authorized_read(
  p_facility_id uuid DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL,
  p_status public.referral_lead_status DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  facility_id uuid,
  referral_source_id uuid,
  referral_source_name text,
  status public.referral_lead_status,
  pii_access_tier public.pii_access_tier,
  first_name text,
  last_name text,
  preferred_name text,
  date_of_birth date,
  phone text,
  email text,
  notes text,
  external_reference text,
  preferred_contact public.referral_lead_preferred_contact,
  inquiry_date date,
  converted_resident_id uuid,
  converted_at timestamptz,
  merged_into_lead_id uuid,
  merged_at timestamptz,
  merged_by uuid,
  tour_scheduled_for timestamptz,
  tour_completed_at timestamptz,
  tour_owner_user_id uuid,
  tour_expected_week date,
  closed_at timestamptz,
  closed_by_party text,
  closure_reason_id uuid,
  closure_note text,
  competitor_chosen text,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  updated_by uuid,
  can_read_clinical boolean,
  can_write boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT haven.referral_capability('lead_read') THEN
    RAISE EXCEPTION 'Referral read authority required' USING ERRCODE = '42501';
  END IF;
  IF p_facility_id IS NULL AND p_lead_id IS NULL THEN
    RAISE EXCEPTION 'Facility or lead scope required' USING ERRCODE = '22023';
  END IF;
  IF p_facility_id IS NOT NULL AND NOT haven.has_facility_access(p_facility_id) THEN
    RAISE EXCEPTION 'Referral facility unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_offset IS NULL
     OR p_limit < 1 OR p_limit > 500 OR p_offset < 0 THEN
    RAISE EXCEPTION 'Invalid referral page bounds' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    lead.id,
    lead.organization_id,
    lead.facility_id,
    lead.referral_source_id,
    source.name,
    lead.status,
    lead.pii_access_tier,
    lead.first_name,
    lead.last_name,
    lead.preferred_name,
    CASE WHEN haven.referral_capability('clinical_read')
           AND lead.pii_access_tier = 'clinical_precheck' THEN lead.date_of_birth END,
    CASE WHEN haven.referral_capability('contact_read')
           AND lead.pii_access_tier <> 'public_summary' THEN lead.phone END,
    CASE WHEN haven.referral_capability('contact_read')
           AND lead.pii_access_tier <> 'public_summary' THEN lead.email END,
    CASE WHEN haven.referral_capability('clinical_read')
           AND lead.pii_access_tier = 'clinical_precheck' THEN lead.notes END,
    CASE WHEN haven.referral_capability('clinical_read')
           AND lead.pii_access_tier = 'clinical_precheck' THEN lead.external_reference END,
    lead.preferred_contact,
    lead.inquiry_date,
    lead.converted_resident_id,
    lead.converted_at,
    lead.merged_into_lead_id,
    lead.merged_at,
    lead.merged_by,
    lead.tour_scheduled_for,
    lead.tour_completed_at,
    lead.tour_owner_user_id,
    lead.tour_expected_week,
    lead.closed_at,
    lead.closed_by_party,
    lead.closure_reason_id,
    CASE WHEN haven.referral_capability('clinical_read')
           AND lead.pii_access_tier = 'clinical_precheck' THEN lead.closure_note END,
    CASE WHEN haven.referral_capability('contact_read')
           AND lead.pii_access_tier <> 'public_summary' THEN lead.competitor_chosen END,
    lead.created_at,
    lead.updated_at,
    lead.created_by,
    lead.updated_by,
    haven.referral_capability('clinical_read')
      AND lead.pii_access_tier = 'clinical_precheck',
    haven.referral_capability('lead_write')
      AND lead.status NOT IN ('converted', 'merged', 'lost')
  FROM public.referral_leads AS lead
  LEFT JOIN public.referral_sources AS source
    ON source.id = lead.referral_source_id
   AND source.organization_id = lead.organization_id
   AND source.deleted_at IS NULL
  WHERE lead.organization_id = haven.organization_id()
    AND lead.deleted_at IS NULL
    AND haven.has_facility_access(lead.facility_id)
    AND (p_facility_id IS NULL OR lead.facility_id = p_facility_id)
    AND (p_lead_id IS NULL OR lead.id = p_lead_id)
    AND (p_status IS NULL OR lead.status = p_status)
  ORDER BY lead.updated_at DESC, lead.id
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

COMMENT ON FUNCTION public.referral_leads_authorized_read(uuid,uuid,public.referral_lead_status,integer,integer) IS
  'Current-authority referral projection. Clinical and free-text fields are NULL unless the current role has clinical_read and the lead is clinical_precheck.';

CREATE OR REPLACE FUNCTION public.referral_leads_authorized_export(
  p_facility_id uuid,
  p_status public.referral_lead_status DEFAULT NULL,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, organization_id uuid, facility_id uuid, referral_source_id uuid,
  referral_source_name text, status public.referral_lead_status,
  pii_access_tier public.pii_access_tier, first_name text, last_name text,
  preferred_name text, date_of_birth date, phone text, email text, notes text,
  external_reference text, preferred_contact public.referral_lead_preferred_contact,
  inquiry_date date, converted_resident_id uuid, converted_at timestamptz,
  merged_into_lead_id uuid, merged_at timestamptz, merged_by uuid,
  tour_scheduled_for timestamptz, tour_completed_at timestamptz,
  tour_owner_user_id uuid, tour_expected_week date, closed_at timestamptz,
  closed_by_party text, closure_reason_id uuid, closure_note text,
  competitor_chosen text, created_at timestamptz, updated_at timestamptz,
  created_by uuid, updated_by uuid, can_read_clinical boolean,
  can_write boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT haven.referral_capability('lead_export') THEN
    RAISE EXCEPTION 'Referral export authority required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_offset IS NULL
     OR p_limit < 1 OR p_limit > 500 OR p_offset < 0 THEN
    RAISE EXCEPTION 'Invalid referral export bounds' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT * FROM public.referral_leads_authorized_read(
    p_facility_id, NULL, p_status, p_limit, p_offset
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.referral_lead_create(
  p_facility_id uuid,
  p_first_name text,
  p_last_name text,
  p_referral_source_id uuid,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_preferred_contact public.referral_lead_preferred_contact DEFAULT 'either',
  p_inquiry_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT haven.referral_capability('lead_write')
     OR NOT haven.has_facility_access(p_facility_id) THEN
    RAISE EXCEPTION 'Referral write scope unavailable' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_first_name), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_last_name), '') IS NULL THEN
    RAISE EXCEPTION 'Referral name is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.referral_leads (
    organization_id, facility_id, referral_source_id, first_name, last_name,
    phone, email, preferred_contact, inquiry_date, status
  ) VALUES (
    haven.organization_id(), p_facility_id, p_referral_source_id,
    pg_catalog.btrim(p_first_name), pg_catalog.btrim(p_last_name),
    NULLIF(pg_catalog.btrim(p_phone), ''), NULLIF(pg_catalog.btrim(p_email), ''),
    p_preferred_contact, COALESCE(p_inquiry_date, (pg_catalog.now() AT TIME ZONE 'America/New_York')::date),
    'new'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.referral_lead_update(
  p_lead_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead public.referral_leads%ROWTYPE;
  v_updated_at timestamptz;
  v_allowed_keys text[] := ARRAY['status','tour_scheduled_for','tour_completed_at'];
BEGIN
  IF NOT haven.referral_capability('lead_write') THEN
    RAISE EXCEPTION 'Referral write authority required' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
     OR p_patch = '{}'::jsonb
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) AS key
       WHERE NOT (key = ANY(v_allowed_keys))
     ) THEN
    RAISE EXCEPTION 'Unsupported referral update field' USING ERRCODE = '22023';
  END IF;

  SELECT lead.* INTO v_lead
  FROM public.referral_leads AS lead
  WHERE lead.id = p_lead_id
    AND lead.organization_id = haven.organization_id()
    AND lead.deleted_at IS NULL
    AND haven.has_facility_access(lead.facility_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral lead unavailable' USING ERRCODE = '42501';
  END IF;
  -- Recheck after the row lock so a revocation committed while this command
  -- waited cannot authorize the mutation using the pre-lock actor snapshot.
  IF NOT haven.referral_capability('lead_write')
     OR NOT haven.has_facility_access(v_lead.facility_id) THEN
    RAISE EXCEPTION 'Referral write authority changed' USING ERRCODE = '42501';
  END IF;
  IF p_expected_updated_at IS NULL OR v_lead.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Referral lead changed; reload before saving' USING ERRCODE = '40001';
  END IF;
  IF v_lead.status IN ('converted', 'merged', 'lost') THEN
    RAISE EXCEPTION 'Closed referral transitions require their dedicated commands' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'status'
     AND (p_patch ->> 'status') IN ('converted', 'merged', 'lost') THEN
    RAISE EXCEPTION 'Converted, merged, and lost statuses require their dedicated commands' USING ERRCODE = '22023';
  END IF;

  UPDATE public.referral_leads AS lead
  SET status = CASE WHEN p_patch ? 'status'
        THEN (p_patch ->> 'status')::public.referral_lead_status ELSE lead.status END,
      tour_scheduled_for = CASE WHEN p_patch ? 'tour_scheduled_for'
        THEN (p_patch ->> 'tour_scheduled_for')::timestamptz ELSE lead.tour_scheduled_for END,
      tour_completed_at = CASE WHEN p_patch ? 'tour_completed_at'
        THEN (p_patch ->> 'tour_completed_at')::timestamptz ELSE lead.tour_completed_at END,
      tour_owner_user_id = CASE
        WHEN p_patch ? 'tour_scheduled_for' OR p_patch ? 'tour_completed_at'
          THEN haven.authorized_user_id()
        ELSE lead.tour_owner_user_id
      END
  WHERE lead.id = v_lead.id
  RETURNING lead.updated_at INTO v_updated_at;
  RETURN v_updated_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.referral_lead_create_from_hl7(
  p_inbound_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_inbound public.referral_hl7_inbound%ROWTYPE;
  v_lead_id uuid;
  v_pid_line text;
  v_field_separator text;
  v_patient_name text;
  v_first_name text := 'HL7';
  v_last_name text := 'Referral';
BEGIN
  IF NOT haven.referral_capability('lead_write') THEN
    RAISE EXCEPTION 'Referral write authority required' USING ERRCODE = '42501';
  END IF;

  SELECT inbound.* INTO v_inbound
  FROM public.referral_hl7_inbound AS inbound
  WHERE inbound.id = p_inbound_id
    AND inbound.organization_id = haven.organization_id()
    AND inbound.deleted_at IS NULL
    AND inbound.status = 'processed'
    AND inbound.linked_referral_lead_id IS NULL
    AND haven.has_facility_access(inbound.facility_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Processed HL7 referral is unavailable or already linked' USING ERRCODE = '42501';
  END IF;
  IF NOT haven.referral_capability('lead_write')
     OR NOT haven.has_facility_access(v_inbound.facility_id) THEN
    RAISE EXCEPTION 'Referral write authority changed' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.btrim(segment)
  INTO v_pid_line
  FROM pg_catalog.regexp_split_to_table(v_inbound.raw_message, E'\\r\\n|\\r|\\n') AS segment
  WHERE pg_catalog.left(pg_catalog.btrim(segment), 3) = 'PID'
  ORDER BY segment
  LIMIT 1;
  IF v_pid_line IS NOT NULL AND pg_catalog.length(v_pid_line) >= 4 THEN
    v_field_separator := pg_catalog.substr(v_pid_line, 4, 1);
    IF v_field_separator NOT IN (E'\\r', E'\\n', '') THEN
      v_patient_name := (pg_catalog.string_to_array(
        pg_catalog.substr(v_pid_line, 5), v_field_separator
      ))[5];
      IF NULLIF(pg_catalog.btrim(v_patient_name), '') IS NOT NULL THEN
        v_last_name := COALESCE(
          NULLIF(pg_catalog.btrim((pg_catalog.string_to_array(v_patient_name, '^'))[1]), ''),
          'Referral'
        );
        v_first_name := COALESCE(
          NULLIF(pg_catalog.btrim((pg_catalog.string_to_array(v_patient_name, '^'))[2]), ''),
          'HL7'
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO public.referral_leads (
    organization_id, facility_id, first_name, last_name, notes,
    external_reference, status
  ) VALUES (
    v_inbound.organization_id,
    v_inbound.facility_id,
    v_first_name,
    v_last_name,
    pg_catalog.concat_ws(
      E'\n',
      'Created from processed HL7 inbound queue.',
      CASE WHEN v_inbound.message_control_id IS NOT NULL
        THEN 'Message control ID: ' || v_inbound.message_control_id END,
      CASE WHEN v_inbound.trigger_event IS NOT NULL
        THEN 'Trigger: ' || v_inbound.trigger_event END,
      'Inbound row: ' || v_inbound.id::text
    ),
    'hl7:' || v_inbound.id::text,
    'new'
  ) RETURNING id INTO v_lead_id;

  UPDATE public.referral_hl7_inbound
  SET linked_referral_lead_id = v_lead_id,
      updated_by = haven.authorized_user_id()
  WHERE id = v_inbound.id;

  RETURN v_lead_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.referral_source_create(
  p_facility_id uuid,
  p_name text,
  p_source_type text,
  p_facility_only boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT haven.referral_capability('source_manage')
     OR NOT haven.has_facility_access(p_facility_id) THEN
    RAISE EXCEPTION 'Referral source scope unavailable' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_name), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_source_type), '') IS NULL THEN
    RAISE EXCEPTION 'Referral source name and type are required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.referral_sources (
    organization_id, facility_id, name, source_type, is_active
  ) VALUES (
    haven.organization_id(), CASE WHEN p_facility_only THEN p_facility_id END,
    pg_catalog.btrim(p_name), pg_catalog.btrim(p_source_type), true
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE TABLE public.referral_triage_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  display_name text NOT NULL CHECK (pg_catalog.btrim(display_name) <> ''),
  source_channel text NOT NULL CHECK (pg_catalog.btrim(source_channel) <> ''),
  phone text,
  email text,
  notes text,
  received_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz
);

COMMENT ON TABLE public.referral_triage_inbox IS
  'Restricted organization triage for intake with no authorized facility yet. It is not an organization-wide referral lead.';

CREATE INDEX idx_referral_triage_inbox_open
  ON public.referral_triage_inbox (organization_id, received_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.referral_triage_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY referral_triage_inbox_select ON public.referral_triage_inbox
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND (SELECT haven.referral_capability('triage_read'))
  );

REVOKE ALL ON TABLE public.referral_triage_inbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.referral_triage_inbox TO service_role;

CREATE TRIGGER tr_referral_triage_inbox_set_updated_at
  BEFORE UPDATE ON public.referral_triage_inbox
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

CREATE TRIGGER tr_referral_triage_inbox_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_triage_inbox
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE OR REPLACE FUNCTION public.referral_triage_submit(
  p_display_name text,
  p_source_channel text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_received_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT haven.referral_capability('triage_submit') THEN
    RAISE EXCEPTION 'Referral triage submission authority required' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_display_name), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_source_channel), '') IS NULL THEN
    RAISE EXCEPTION 'Display name and source channel are required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.referral_triage_inbox (
    organization_id, display_name, source_channel, phone, email, notes,
    received_at, created_by
  ) VALUES (
    haven.organization_id(), pg_catalog.btrim(p_display_name),
    pg_catalog.btrim(p_source_channel), NULLIF(pg_catalog.btrim(p_phone), ''),
    NULLIF(pg_catalog.btrim(p_email), ''), NULLIF(pg_catalog.btrim(p_notes), ''),
    COALESCE(p_received_at, pg_catalog.now()), haven.authorized_user_id()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.referral_triage_authorized_read(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, organization_id uuid, display_name text, source_channel text,
  phone text, email text, notes text, received_at timestamptz,
  created_by uuid, created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT haven.referral_capability('triage_read') THEN
    RAISE EXCEPTION 'Referral triage read authority required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_offset IS NULL
     OR p_limit < 1 OR p_limit > 500 OR p_offset < 0 THEN
    RAISE EXCEPTION 'Invalid referral triage page bounds' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT inbox.id, inbox.organization_id, inbox.display_name,
    inbox.source_channel, inbox.phone, inbox.email, inbox.notes,
    inbox.received_at, inbox.created_by, inbox.created_at, inbox.updated_at
  FROM public.referral_triage_inbox AS inbox
  WHERE inbox.organization_id = haven.organization_id()
    AND inbox.deleted_at IS NULL
  ORDER BY inbox.received_at DESC, inbox.id
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.referral_duplicate_candidates(p_lead_id uuid)
RETURNS TABLE (
  id uuid,
  facility_id uuid,
  first_name text,
  last_name text,
  status public.referral_lead_status
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_source public.referral_leads%ROWTYPE;
BEGIN
  IF NOT haven.referral_capability('duplicate_review') THEN
    RAISE EXCEPTION 'Referral duplicate review authority required' USING ERRCODE = '42501';
  END IF;
  SELECT lead.* INTO v_source
  FROM public.referral_leads AS lead
  WHERE lead.id = p_lead_id
    AND lead.organization_id = haven.organization_id()
    AND lead.deleted_at IS NULL
    AND haven.has_facility_access(lead.facility_id);
  IF NOT FOUND OR v_source.phone IS NULL OR v_source.date_of_birth IS NULL THEN
    RETURN;
  END IF;
  IF v_source.pii_access_tier <> 'clinical_precheck' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT candidate.id, candidate.facility_id, candidate.first_name,
    candidate.last_name, candidate.status
  FROM public.referral_leads AS candidate
  WHERE candidate.id <> v_source.id
    AND candidate.organization_id = v_source.organization_id
    AND candidate.deleted_at IS NULL
    AND haven.has_facility_access(candidate.facility_id)
    AND candidate.pii_access_tier = 'clinical_precheck'
    AND candidate.date_of_birth = v_source.date_of_birth
    AND pg_catalog.regexp_replace(candidate.phone, '[^0-9]', '', 'g') =
        pg_catalog.regexp_replace(v_source.phone, '[^0-9]', '', 'g')
  ORDER BY candidate.created_at, candidate.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.referral_leads_authorized_read(uuid,uuid,public.referral_lead_status,integer,integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.referral_leads_authorized_export(uuid,public.referral_lead_status,integer,integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.referral_lead_create(uuid,text,text,uuid,text,text,public.referral_lead_preferred_contact,date)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.referral_lead_update(uuid,timestamptz,jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.referral_lead_create_from_hl7(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.referral_source_create(uuid,text,text,boolean)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.referral_triage_submit(text,text,text,text,text,timestamptz)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.referral_triage_authorized_read(integer,integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.referral_duplicate_candidates(uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.referral_leads_authorized_read(uuid,uuid,public.referral_lead_status,integer,integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_leads_authorized_export(uuid,public.referral_lead_status,integer,integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_lead_create(uuid,text,text,uuid,text,text,public.referral_lead_preferred_contact,date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_lead_update(uuid,timestamptz,jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_lead_create_from_hl7(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_source_create(uuid,text,text,boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_triage_submit(text,text,text,text,text,timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_triage_authorized_read(integer,integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_duplicate_candidates(uuid)
  TO authenticated;

COMMIT;
