-- Created through supabase migration new; numbered for the repository replay order.
BEGIN;

ALTER TABLE public.referral_triage_inbox
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN requested_facility_id uuid REFERENCES public.facilities(id),
  ADD COLUMN public_request_key uuid UNIQUE,
  ADD COLUMN public_request_hash text,
  ADD COLUMN public_client_fingerprint text,
  ADD CONSTRAINT referral_triage_public_provenance CHECK (
    (public_request_key IS NULL AND public_request_hash IS NULL AND public_client_fingerprint IS NULL AND created_by IS NOT NULL)
    OR (public_request_key IS NOT NULL AND public_request_hash IS NOT NULL
        AND public_client_fingerprint IS NOT NULL AND public_client_fingerprint ~ '^[0-9a-f]{64}$'
        AND created_by IS NULL AND requested_facility_id IS NOT NULL
        AND source_channel IN ('public_website_inquiry', 'public_website_tour'))
  );

CREATE INDEX idx_referral_triage_public_client_recent
  ON public.referral_triage_inbox (public_client_fingerprint, created_at)
  WHERE public_request_key IS NOT NULL;

-- The privileged implementation stays in the unexposed haven schema. The
-- public Data API wrapper below remains SECURITY INVOKER and service-role-only.
CREATE FUNCTION haven.public_referral_intake_internal(
  p_request_key uuid, p_facility_id uuid, p_kind text,
  p_name text, p_phone text, p_email text, p_notes text, p_client_fingerprint text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_organization uuid;
  v_facility_name text;
  v_id uuid;
  v_hash text;
  v_existing public.referral_triage_inbox%ROWTYPE;
BEGIN
  IF p_request_key IS NULL OR p_facility_id IS NULL
     OR p_client_fingerprint IS NULL OR p_client_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_kind IS NULL OR p_kind NOT IN ('inquiry', 'tour')
     OR NULLIF(pg_catalog.btrim(p_name), '') IS NULL OR pg_catalog.length(p_name) > 160
     OR NULLIF(pg_catalog.btrim(p_phone), '') IS NULL OR pg_catalog.length(p_phone) > 40
     OR NULLIF(pg_catalog.btrim(p_email), '') IS NULL OR pg_catalog.length(p_email) > 254
     OR NULLIF(pg_catalog.btrim(p_notes), '') IS NULL OR pg_catalog.length(p_notes) > 4000 THEN
    RAISE EXCEPTION 'Invalid public referral request' USING ERRCODE = '22023';
  END IF;
  SELECT facility.organization_id, facility.name INTO v_organization, v_facility_name
  FROM public.facilities AS facility
  JOIN public.organizations AS organization ON organization.id = facility.organization_id
  WHERE facility.id = p_facility_id AND facility.deleted_at IS NULL
    AND facility.status = 'active' AND organization.deleted_at IS NULL;
  IF v_organization IS NULL THEN
    RAISE EXCEPTION 'Public referral facility unavailable' USING ERRCODE = '42501';
  END IF;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(p_facility_id, p_kind, p_name, p_phone, p_email, p_notes)::text,
    'UTF8')), 'hex');

  -- Serialize new submissions from the same client across concurrent servers.
  -- Existing requests are recovered before counting; retries consume no quota.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-referral-client:' || p_client_fingerprint, 0));
  SELECT * INTO v_existing FROM public.referral_triage_inbox
  WHERE public_request_key = p_request_key;
  IF FOUND THEN
    IF v_existing.public_request_hash IS DISTINCT FROM v_hash
       OR v_existing.organization_id IS DISTINCT FROM v_organization THEN
      RAISE EXCEPTION 'Public request key already used for different content' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.referral_triage_inbox
      WHERE public_client_fingerprint = p_client_fingerprint
        AND public_request_key IS NOT NULL
        AND created_at >= pg_catalog.now() - interval '10 minutes') >= 20 THEN
    RAISE EXCEPTION 'Public request limit exceeded' USING ERRCODE = 'P0429';
  END IF;

  INSERT INTO public.referral_triage_inbox (
    organization_id, requested_facility_id, display_name, source_channel,
    phone, email, notes, received_at, received_precision, created_by,
    public_request_key, public_request_hash, public_client_fingerprint
  ) VALUES (
    v_organization, p_facility_id, p_name, 'public_website_' || p_kind,
    p_phone, p_email, 'Requested community: ' || v_facility_name || E'\n' || p_notes, pg_catalog.now(), 'instant', NULL,
    p_request_key, v_hash, p_client_fingerprint
  ) ON CONFLICT (public_request_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT * INTO STRICT v_existing FROM public.referral_triage_inbox
  WHERE public_request_key = p_request_key;
  IF v_existing.public_request_hash IS DISTINCT FROM v_hash
     OR v_existing.organization_id IS DISTINCT FROM v_organization THEN
    RAISE EXCEPTION 'Public request key already used for different content' USING ERRCODE = '23505';
  END IF;
  -- A retry never updates, reopens, or restores a triaged/retired request.
  RETURN v_existing.id;
END;
$function$;

REVOKE ALL ON FUNCTION haven.public_referral_intake_internal(uuid,uuid,text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION haven.public_referral_intake_internal(uuid,uuid,text,text,text,text,text,text)
  TO service_role;

CREATE FUNCTION public.public_referral_intake(
  p_request_key uuid, p_facility_id uuid, p_kind text,
  p_name text, p_phone text, p_email text, p_notes text, p_client_fingerprint text
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT haven.public_referral_intake_internal(
    p_request_key, p_facility_id, p_kind,
    p_name, p_phone, p_email, p_notes, p_client_fingerprint
  )
$function$;

REVOKE ALL ON FUNCTION public.public_referral_intake(uuid,uuid,text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_referral_intake(uuid,uuid,text,text,text,text,text,text)
  TO service_role;

COMMENT ON COLUMN public.referral_triage_inbox.requested_facility_id IS
  'Public preference only; does not confer staff facility authority or confirm placement/tour.';
COMMENT ON COLUMN public.referral_triage_inbox.public_request_key IS
  'Anonymous request identity for atomic retry recovery; never an authenticated staff actor.';
COMMENT ON COLUMN public.referral_triage_inbox.public_client_fingerprint IS
  'Server-only purpose-bound HMAC-SHA256 client fingerprint for abuse limits; never a raw IP address.';
COMMENT ON FUNCTION haven.public_referral_intake_internal(uuid,uuid,text,text,text,text,text,text) IS
  'Unexposed privileged implementation for the service-role-only public referral wrapper.';
NOTIFY pgrst, 'reload schema';
COMMIT;
