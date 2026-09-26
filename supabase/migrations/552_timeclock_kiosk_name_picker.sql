-- Kiosk staff clock: pick your name, then enter your PIN.
-- The employee-number and badge paths are unchanged when p_staff_id is NULL.

CREATE OR REPLACE FUNCTION public.timeclock_kiosk_roster(p_device_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dev jsonb;
  v_org uuid;
  v_facility uuid;
BEGIN
  -- A throttled kiosk still lists names; only PIN entry waits.
  v_dev := haven.timeclock_resolve_device(p_device_token, 'kiosk', false);
  IF NOT (v_dev->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', v_dev->>'error');
  END IF;
  v_org := (v_dev->>'organization_id')::uuid;
  v_facility := (v_dev->>'facility_id')::uuid;

  RETURN jsonb_build_object(
    'ok', true,
    'throttled_until', v_dev->'throttled_until',
    'roster', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'staff_id', x.id,
        'display_name', CASE WHEN x.dupes > 1 THEN x.full_name ELSE x.short_name END
      ) ORDER BY x.sort_first, x.sort_last, x.id)
      FROM (
        SELECT s.id,
               haven.floor_display_name(s.first_name, s.preferred_name, s.last_name) AS short_name,
               btrim(COALESCE(NULLIF(btrim(s.preferred_name), ''), btrim(s.first_name)) || ' ' || COALESCE(btrim(s.last_name), '')) AS full_name,
               count(*) OVER (PARTITION BY haven.floor_display_name(s.first_name, s.preferred_name, s.last_name)) AS dupes,
               lower(COALESCE(NULLIF(btrim(s.preferred_name), ''), btrim(s.first_name))) AS sort_first,
               lower(btrim(COALESCE(s.last_name, ''))) AS sort_last
        FROM public.staff s
        JOIN public.timeclock_credentials c ON c.organization_id = s.organization_id AND c.staff_id = s.id
        WHERE s.organization_id = v_org
          AND s.deleted_at IS NULL
          AND s.employment_status IN ('active', 'on_leave')
          AND haven.timeclock_assigned_to_facility(s.id, v_facility)
      ) x
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.timeclock_kiosk_roster(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timeclock_kiosk_roster(text) TO service_role;

DROP FUNCTION haven.timeclock_resolve(text, text, text, text);

CREATE FUNCTION haven.timeclock_resolve(
  p_device_token text,
  p_identifier text,
  p_badge_lookup_hmac text,
  p_pin text,
  p_staff_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dev jsonb;
  v_pin jsonb;
  v_staff record;
  v_context jsonb;
  v_device_id uuid;
  v_facility_id uuid;
BEGIN
  v_dev := haven.timeclock_resolve_device(p_device_token, 'kiosk');
  v_context := v_dev - ARRAY['ok', 'error', 'device_label', 'throttled_until', 'roster_roles'];
  IF NOT (v_dev->>'ok')::boolean THEN
    RETURN v_context || jsonb_build_object('ok', false, 'error', v_dev->>'error');
  END IF;
  v_device_id := (v_dev->>'device_id')::uuid;
  v_facility_id := (v_dev->>'facility_id')::uuid;

  v_pin := haven.timeclock_verify_credential_pin(v_device_id, (v_dev->>'organization_id')::uuid, v_facility_id,
    p_staff_id,
    CASE WHEN p_staff_id IS NULL THEN p_identifier END,
    CASE WHEN p_staff_id IS NULL THEN p_badge_lookup_hmac END,
    p_pin);
  IF v_pin ? 'staff_id' THEN
    v_context := v_context || jsonb_build_object('staff_id', (v_pin->>'staff_id')::uuid);
  END IF;
  IF NOT (v_pin->>'ok')::boolean THEN
    -- tries_left only on the name path: the person is already named on screen, so it
    -- confirms nothing. Spec 37 section 12a still holds for employee number and badge.
    RETURN v_context || jsonb_build_object('ok', false, 'error', v_pin->>'error')
      || CASE WHEN p_staff_id IS NOT NULL AND v_pin ? 'tries_left'
              THEN jsonb_build_object('tries_left', v_pin->'tries_left') ELSE '{}'::jsonb END;
  END IF;

  SELECT s.id, s.first_name, s.preferred_name, s.facility_id, s.employment_status, s.deleted_at INTO v_staff
  FROM public.staff s WHERE s.id = (v_context->>'staff_id')::uuid;
  IF NOT FOUND OR v_staff.deleted_at IS NOT NULL OR v_staff.employment_status NOT IN ('active', 'on_leave') THEN
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'inactive_staff');
  END IF;
  IF v_staff.facility_id <> v_facility_id AND NOT haven.timeclock_assigned_to_facility(v_staff.id, v_facility_id) THEN
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'not_assigned');
  END IF;

  RETURN v_context || jsonb_build_object('ok', true, 'first_name', COALESCE(NULLIF(v_staff.preferred_name, ''), v_staff.first_name));
END;
$function$;

REVOKE ALL ON FUNCTION haven.timeclock_resolve(text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.timeclock_identify(text, text, text, text);

CREATE FUNCTION public.timeclock_identify(
  p_device_token text,
  p_identifier text,
  p_badge_lookup_hmac text,
  p_pin text,
  p_staff_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_r jsonb;
  v_state text;
  v_tz text;
  v_staff uuid;
BEGIN
  v_r := haven.timeclock_resolve(p_device_token, p_identifier, p_badge_lookup_hmac, p_pin, p_staff_id);
  IF NOT (v_r->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', v_r->>'error')
      || CASE WHEN v_r ? 'tries_left' THEN jsonb_build_object('tries_left', v_r->'tries_left') ELSE '{}'::jsonb END;
  END IF;
  v_staff := (v_r->>'staff_id')::uuid;
  v_state := haven.timeclock_state(v_staff, v_now);
  v_tz := haven.timeclock_facility_timezone((v_r->>'facility_id')::uuid);
  RETURN jsonb_build_object(
    'ok', true,
    'staff_id', v_staff, 'facility_id', (v_r->>'facility_id')::uuid,
    'first_name', v_r->>'first_name',
    'state', v_state,
    'next_actions', to_jsonb(haven.timeclock_next_actions(v_state)),
    'today_worked_minutes', haven.timeclock_today_minutes(v_staff, v_now, v_tz),
    'display_name', (SELECT haven.floor_display_name(st.first_name, st.preferred_name, st.last_name) FROM public.staff st WHERE st.id = v_staff),
    'last_out_at', (SELECT max(e.punched_at) FROM haven.timeclock_effective_punches(v_staff, v_now - interval '14 days', v_now + interval '1 second') e WHERE e.punch_type = 'out')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.timeclock_identify(text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timeclock_identify(text, text, text, text, uuid) TO service_role;

DROP FUNCTION public.timeclock_record_punch(text, text, text, text, text, timestamptz, uuid, boolean);

CREATE FUNCTION public.timeclock_record_punch(
  p_device_token text,
  p_identifier text,
  p_badge_lookup_hmac text,
  p_pin text,
  p_punch_type text,
  p_device_time timestamptz,
  p_client_punch_id uuid,
  p_captured_offline boolean,
  p_staff_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_r jsonb;
  v_device_id uuid;
  v_org uuid;
  v_facility uuid;
  v_staff uuid;
  v_state text;
  v_actions text[];
  v_existing record;
  v_known_device uuid;
  v_punched_at timestamptz;
  v_flags text[] := '{}';
  v_punch_id uuid;
  v_tz text;
  v_offline boolean := COALESCE(p_captured_offline, false);
BEGIN
  IF p_client_punch_id IS NULL OR p_punch_type IS NULL OR p_punch_type NOT IN ('in', 'out', 'meal_start', 'meal_end') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF v_offline AND p_device_time IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  -- Device first, so a replay of an already recorded punch never needs the PIN again.
  SELECT id INTO v_known_device
  FROM public.timeclock_devices
  WHERE token_hash = haven.timeclock_sha256(COALESCE(p_device_token, '')) AND revoked_at IS NULL AND device_kind = 'kiosk';
  IF v_known_device IS NOT NULL THEN
    SELECT p.id, p.staff_id, p.facility_id, p.punch_type, p.punched_at, p.flags INTO v_existing
    FROM public.time_punches p
    WHERE p.device_id = v_known_device AND p.client_punch_id = p_client_punch_id;
    IF FOUND THEN
      v_tz := haven.timeclock_facility_timezone(v_existing.facility_id);
      v_state := haven.timeclock_state(v_existing.staff_id, v_now);
      RETURN jsonb_build_object(
        'ok', true, 'replayed', true,
        'punch_id', v_existing.id,
        'first_name', (SELECT COALESCE(NULLIF(preferred_name, ''), first_name) FROM public.staff WHERE id = v_existing.staff_id),
        'punch_type', v_existing.punch_type,
        'punched_at', v_existing.punched_at,
        'flags', to_jsonb(v_existing.flags),
        'state', v_state,
        'next_actions', to_jsonb(haven.timeclock_next_actions(v_state)),
        'today_worked_minutes', haven.timeclock_today_minutes(v_existing.staff_id, v_now, v_tz),
        'display_name', (SELECT haven.floor_display_name(st.first_name, st.preferred_name, st.last_name) FROM public.staff st WHERE st.id = v_existing.staff_id),
        'last_out_at', (SELECT max(e.punched_at) FROM haven.timeclock_effective_punches(v_existing.staff_id, v_now - interval '14 days', v_now + interval '1 second') e WHERE e.punch_type = 'out')
      );
    END IF;
  END IF;

  v_r := haven.timeclock_resolve(p_device_token, p_identifier, p_badge_lookup_hmac, p_pin, p_staff_id);
  v_device_id := (v_r->>'device_id')::uuid;
  v_org := (v_r->>'organization_id')::uuid;
  v_facility := (v_r->>'facility_id')::uuid;
  v_staff := (v_r->>'staff_id')::uuid;

  IF NOT (v_r->>'ok')::boolean THEN
    IF v_offline AND v_device_id IS NOT NULL
       AND (v_r->>'error') IN ('not_recognized', 'locked', 'inactive_staff', 'not_assigned', 'pin_unavailable', 'facility_off') THEN
      INSERT INTO public.timeclock_sync_rejections (organization_id, facility_id, device_id, staff_id, client_punch_id, punch_type, device_time, reason)
      VALUES (v_org, v_facility, v_device_id, v_staff, p_client_punch_id, p_punch_type, p_device_time, v_r->>'error')
      ON CONFLICT (device_id, client_punch_id) DO NOTHING;
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', v_r->>'error')
      || CASE WHEN v_r ? 'tries_left' THEN jsonb_build_object('tries_left', v_r->'tries_left') ELSE '{}'::jsonb END;
  END IF;

  v_punched_at := CASE WHEN v_offline THEN p_device_time ELSE v_now END;
  v_state := haven.timeclock_state(v_staff, v_punched_at);
  v_actions := haven.timeclock_next_actions(v_state);
  IF NOT (p_punch_type = ANY (v_actions)) THEN
    IF v_offline THEN
      INSERT INTO public.timeclock_sync_rejections (organization_id, facility_id, device_id, staff_id, client_punch_id, punch_type, device_time, reason)
      VALUES (v_org, v_facility, v_device_id, v_staff, p_client_punch_id, p_punch_type, p_device_time, 'invalid_next_type')
      ON CONFLICT (device_id, client_punch_id) DO NOTHING;
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_next_type', 'state', v_state, 'next_actions', to_jsonb(v_actions));
  END IF;

  IF v_offline THEN
    v_flags := array_append(v_flags, 'offline_capture');
  ELSIF p_device_time IS NOT NULL AND abs(extract(epoch FROM (p_device_time - v_now))) > 120 THEN
    v_flags := array_append(v_flags, 'clock_skew');
  END IF;

  INSERT INTO public.time_punches (organization_id, facility_id, staff_id, punch_type, punched_at, device_time, device_id, captured_offline, client_punch_id, flags)
  VALUES (v_org, v_facility, v_staff, p_punch_type, v_punched_at, p_device_time, v_device_id, v_offline, p_client_punch_id, v_flags)
  RETURNING id INTO v_punch_id;

  v_tz := haven.timeclock_facility_timezone(v_facility);
  v_state := haven.timeclock_state(v_staff, v_now);
  RETURN jsonb_build_object(
    'ok', true, 'replayed', false,
    'punch_id', v_punch_id,
    'first_name', v_r->>'first_name',
    'punch_type', p_punch_type,
    'punched_at', v_punched_at,
    'flags', to_jsonb(v_flags),
    'state', v_state,
    'next_actions', to_jsonb(haven.timeclock_next_actions(v_state)),
    'today_worked_minutes', haven.timeclock_today_minutes(v_staff, v_now, v_tz),
    'display_name', (SELECT haven.floor_display_name(st.first_name, st.preferred_name, st.last_name) FROM public.staff st WHERE st.id = v_staff),
    'last_out_at', (SELECT max(e.punched_at) FROM haven.timeclock_effective_punches(v_staff, v_now - interval '14 days', v_now + interval '1 second') e WHERE e.punch_type = 'out')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.timeclock_record_punch(text, text, text, text, text, timestamptz, uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timeclock_record_punch(text, text, text, text, text, timestamptz, uuid, boolean, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
