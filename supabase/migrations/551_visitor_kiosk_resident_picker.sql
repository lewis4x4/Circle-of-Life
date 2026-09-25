-- Kiosk resident picker: type-ahead over current residents, and resident_id on kiosk sign-in.

CREATE OR REPLACE FUNCTION public.visitor_kiosk_resident_matches(p_device_token text, p_prefix text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dev record;
  v_prefix text := lower(left(btrim(COALESCE(p_prefix, '')), 60));
  v_like text;
BEGIN
  SELECT * INTO v_dev FROM haven.visitor_kiosk_device(p_device_token);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;
  IF haven.visitor_kiosk_throttled(v_dev.id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_throttled');
  END IF;
  -- Nothing is returned until 3 letters are typed, so the tablet never lists the census.
  IF char_length(regexp_replace(v_prefix, '[^[:alpha:]]', '', 'g')) < 3 THEN
    RETURN jsonb_build_object('ok', true, 'matches', '[]'::jsonb);
  END IF;
  v_like := replace(replace(replace(v_prefix, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN jsonb_build_object('ok', true, 'matches', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'resident_id', m.id,
      'display_name', m.display_name,
      'room', m.room_number
    ) ORDER BY m.last_key, m.first_key)
    FROM (
      SELECT r.id,
             COALESCE(NULLIF(btrim(r.preferred_name), ''), btrim(r.first_name))
               || ' ' || upper(left(btrim(r.last_name), 1)) || '.' AS display_name,
             rm.room_number,
             lower(btrim(r.last_name)) AS last_key,
             lower(btrim(r.first_name)) AS first_key
      FROM public.residents r
      LEFT JOIN public.beds b ON b.id = r.bed_id
      LEFT JOIN public.rooms rm ON rm.id = b.room_id
      WHERE r.organization_id = v_dev.organization_id
        AND r.facility_id = v_dev.facility_id
        AND r.deleted_at IS NULL
        AND r.status IN ('active', 'hospital_hold', 'loa')
        AND (
          lower(btrim(r.first_name)) LIKE v_like
          OR lower(btrim(r.last_name)) LIKE v_like
          OR lower(btrim(COALESCE(r.preferred_name, ''))) LIKE v_like
          OR lower(btrim(r.first_name) || ' ' || btrim(r.last_name)) LIKE v_like
          OR lower(COALESCE(NULLIF(btrim(r.preferred_name), ''), btrim(r.first_name)) || ' ' || btrim(r.last_name)) LIKE v_like
        )
      ORDER BY lower(btrim(r.last_name)), lower(btrim(r.first_name))
      LIMIT 6
    ) m
  ), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.visitor_kiosk_resident_matches(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_kiosk_resident_matches(text, text) TO service_role;

DROP FUNCTION public.visitor_kiosk_sign_in(text, uuid, text, text, text, text, text, text, boolean);

CREATE FUNCTION public.visitor_kiosk_sign_in(
  p_device_token text,
  p_client_entry_id uuid,
  p_visitor_type text,
  p_visitor_name text,
  p_visitor_phone text,
  p_visitor_company text,
  p_visiting_name_text text,
  p_purpose text,
  p_symptoms_reported boolean,
  p_resident_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dev record;
  v_name text := btrim(COALESCE(p_visitor_name, ''));
  v_phone text := NULLIF(btrim(COALESCE(p_visitor_phone, '')), '');
  v_company text := NULLIF(btrim(COALESCE(p_visitor_company, '')), '');
  v_visiting text := NULLIF(btrim(COALESCE(p_visiting_name_text, '')), '');
  v_purpose text := NULLIF(btrim(COALESCE(p_purpose, '')), '');
  v_symptoms boolean := COALESCE(p_symptoms_reported, false);
  v_asks_health boolean := p_visitor_type IN ('family_friend', 'healthcare_provider');
  v_resident uuid;
  e public.visitor_log_entries;
BEGIN
  SELECT * INTO v_dev FROM haven.visitor_kiosk_device(p_device_token);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;

  SELECT * INTO e FROM public.visitor_log_entries
  WHERE kiosk_device_id = v_dev.id AND kiosk_client_entry_id = p_client_entry_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'entry_id', e.id, 'checked_in_at', e.checked_in_at);
  END IF;
  IF haven.visitor_kiosk_throttled(v_dev.id)
     OR haven.visitor_kiosk_over_cap(v_dev.id, v_dev.organization_id, v_dev.facility_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_throttled');
  END IF;

  -- A picked resident must be a current resident of this device's facility.
  IF p_resident_id IS NOT NULL THEN
    SELECT r.id INTO v_resident FROM public.residents r
    WHERE r.id = p_resident_id
      AND r.organization_id = v_dev.organization_id
      AND r.facility_id = v_dev.facility_id
      AND r.deleted_at IS NULL
      AND r.status IN ('active', 'hospital_hold', 'loa');
    IF v_resident IS NULL THEN
      PERFORM haven.visitor_kiosk_note_failure(v_dev.id);
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
    END IF;
  END IF;

  IF p_client_entry_id IS NULL
     OR p_visitor_type IS NULL OR p_visitor_type NOT IN ('family_friend', 'healthcare_provider', 'vendor_contractor', 'surveyor_regulator')
     OR char_length(v_name) NOT BETWEEN 1 AND 120
     OR (v_phone IS NOT NULL AND v_phone !~ '^[0-9()+\-. ]{7,20}$')
     OR (v_company IS NOT NULL AND char_length(v_company) > 120)
     OR (v_visiting IS NOT NULL AND char_length(v_visiting) > 120)
     OR (v_purpose IS NOT NULL AND char_length(v_purpose) > 280)
     -- Company or agency: required for providers, vendors and inspectors; a family visitor has none.
     OR ((p_visitor_type <> 'family_friend') <> (v_company IS NOT NULL))
     -- Picked resident or typed name, never both.
     OR (v_resident IS NOT NULL AND v_visiting IS NOT NULL)
     -- Who they are seeing: required for a family visit, optional for a provider, never for the rest.
     OR (p_visitor_type = 'family_friend' AND v_visiting IS NULL AND v_resident IS NULL)
     OR (p_visitor_type IN ('vendor_contractor', 'surveyor_regulator') AND (v_visiting IS NOT NULL OR v_resident IS NOT NULL))
     -- Only the visit and provider forms ask "feeling sick today".
     OR (NOT v_asks_health AND v_symptoms) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  INSERT INTO public.visitor_log_entries (
    organization_id, facility_id, visitor_name, visitor_type, visitor_phone, visitor_company, visiting_name_text,
    resident_id, visiting_type,
    purpose, symptoms_reported, screening_passed, kiosk_device_id, kiosk_client_entry_id, checked_in_at
  ) VALUES (
    v_dev.organization_id, v_dev.facility_id, v_name, p_visitor_type, v_phone, v_company, v_visiting,
    v_resident, CASE WHEN v_resident IS NOT NULL THEN 'resident' END,
    v_purpose, v_symptoms, CASE WHEN v_symptoms THEN false WHEN v_asks_health THEN true END,
    v_dev.id, p_client_entry_id, now()
  )
  ON CONFLICT (kiosk_device_id, kiosk_client_entry_id) WHERE kiosk_device_id IS NOT NULL AND kiosk_client_entry_id IS NOT NULL
  DO NOTHING
  RETURNING * INTO e;
  IF e.id IS NULL THEN
    SELECT * INTO e FROM public.visitor_log_entries
    WHERE kiosk_device_id = v_dev.id AND kiosk_client_entry_id = p_client_entry_id;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'entry_id', e.id, 'checked_in_at', e.checked_in_at);
  END IF;
  PERFORM haven.visitor_audit(e, 'visitor_signed_in_kiosk');
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'entry_id', e.id, 'checked_in_at', e.checked_in_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.visitor_kiosk_sign_in(text, uuid, text, text, text, text, text, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_kiosk_sign_in(text, uuid, text, text, text, text, text, text, boolean, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
