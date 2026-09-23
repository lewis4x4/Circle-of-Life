-- COL-677 / COL-690: shared floor tablets and the front-door kiosk.
-- Spec: docs/specs/40-floor-tablet-and-kiosk.md (sections 3, 4, 5).
--
-- A floor tablet is a timeclock device of kind 'floor'. It lists the staff on
-- the clock at its facility and unlocks for one of them with the same PIN they
-- punch with. The PIN check, the 5-miss credential lockout and the 20-miss
-- device throttle are ONE implementation shared with the kiosk
-- (haven.timeclock_verify_credential_pin), so a lock earned on one device holds
-- on every device. public.floor_unlocks is the attribution ledger: insert plus
-- one end, for every role.
--
-- The front-door kiosk (kind 'kiosk') also signs visitors into
-- public.visitor_log_entries. It never lists a resident: the visitor types who
-- they are seeing and the front desk matches it (visitor_match_resident).
--
-- Offline replay: rounding checks and care events queued on a floor tablet
-- replay after the tablet has locked, when their owner has no live session.
-- floor_replay_complete_rounding_task and floor_replay_submit_care_event prove
-- the owner through the unlock row the item was captured under, then call the
-- SAME writers the signed-in paths call. The owner's current role, organization,
-- facility grant and staff row are re-checked by those writers, so a replay can
-- never write what the owner could not have written while signed in.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Device kind, roster roles, floor settings
-- ---------------------------------------------------------------------------
-- A roster role list is data (per device, else per facility), bounded here to
-- login roles that exist, are held today and belong to staff.
CREATE FUNCTION haven.floor_roster_roles_valid(p_roles text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_roles IS NOT NULL
    AND pg_catalog.cardinality(p_roles) BETWEEN 1 AND 20
    AND pg_catalog.array_position(p_roles, NULL) IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.unnest(p_roles) AS r(role_name)
      WHERE NOT (r.role_name = ANY (pg_catalog.enum_range(NULL::public.app_role)::text[]))
         OR NOT (r.role_name <> ALL (ARRAY['family', 'broker', 'nurse', 'caregiver', 'dietary', 'dietary_aide']))
    )
$$;
REVOKE ALL ON FUNCTION haven.floor_roster_roles_valid(text[]) FROM PUBLIC, anon, authenticated, service_role;
-- The CHECK constraints below run it as the writing role: owners and org admins
-- update timeclock_facility_settings directly under RLS.
GRANT EXECUTE ON FUNCTION haven.floor_roster_roles_valid(text[]) TO authenticated;
COMMENT ON FUNCTION haven.floor_roster_roles_valid(text[]) IS
  'COL-690: a floor roster role list names 1 to 20 current staff login roles; never family, broker or a role retired by migration 468.';

ALTER TABLE public.timeclock_devices
  ADD COLUMN device_kind text NOT NULL DEFAULT 'kiosk' CHECK (device_kind IN ('kiosk', 'floor')),
  ADD COLUMN roster_roles text[] NULL
    CONSTRAINT timeclock_devices_roster_roles_check CHECK (roster_roles IS NULL OR haven.floor_roster_roles_valid(roster_roles));
COMMENT ON COLUMN public.timeclock_devices.device_kind IS 'COL-690: kiosk punches and signs visitors in; floor lists on-clock staff and unlocks for one of them. A floor device never punches.';
COMMENT ON COLUMN public.timeclock_devices.roster_roles IS 'COL-690: login roles this floor tablet lists; null uses timeclock_facility_settings.floor_roster_roles.';

ALTER TABLE public.timeclock_enrollment_codes
  ADD COLUMN device_kind text NOT NULL DEFAULT 'kiosk' CHECK (device_kind IN ('kiosk', 'floor'));

ALTER TABLE public.timeclock_facility_settings
  ADD COLUMN floor_idle_lock_minutes integer NOT NULL DEFAULT 3 CHECK (floor_idle_lock_minutes BETWEEN 1 AND 30),
  ADD COLUMN floor_roster_roles text[] NOT NULL DEFAULT ARRAY['med_tech', 'facility_admin']
    CONSTRAINT timeclock_facility_settings_floor_roster_roles_check CHECK (haven.floor_roster_roles_valid(floor_roster_roles));

-- ---------------------------------------------------------------------------
-- 2. The unlock ledger
-- ---------------------------------------------------------------------------
CREATE TABLE public.floor_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  device_id uuid NOT NULL REFERENCES public.timeclock_devices(id),
  staff_id uuid NOT NULL REFERENCES public.staff(id),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  method text NOT NULL CHECK (method IN ('roster', 'employee_number')),
  on_clock boolean NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz NULL,
  end_reason text NULL CHECK (end_reason IN ('sleep', 'idle', 'switch', 'clocked_out', 'device_revoked', 'max_age', 'new_unlock')),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX idx_floor_unlocks_device_started_at ON public.floor_unlocks (device_id, started_at DESC);
CREATE INDEX idx_floor_unlocks_facility_staff_started_at ON public.floor_unlocks (facility_id, staff_id, started_at DESC);
COMMENT ON TABLE public.floor_unlocks IS 'Who had a shared floor tablet and when (COL-690). Inserted and ended only by the floor definer functions; one end per row; never deleted by any role.';

REVOKE ALL ON public.floor_unlocks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.floor_unlocks TO authenticated;
ALTER TABLE public.floor_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Timeclock managers read floor unlocks for accessible facilities"
  ON public.floor_unlocks FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );
CREATE POLICY "Staff read their own floor unlocks"
  ON public.floor_unlocks FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND user_id = auth.uid()
  );
-- No INSERT, UPDATE or DELETE policy and no write grant: only definer functions write.

-- Insert plus one end is a trigger, not just a missing policy: it binds the
-- table owner and service_role too.
CREATE FUNCTION haven.floor_unlocks_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.ended_at IS NULL AND OLD.end_reason IS NULL
     AND NEW.ended_at IS NOT NULL AND NEW.end_reason IS NOT NULL
     AND (NEW.id, NEW.organization_id, NEW.facility_id, NEW.device_id, NEW.staff_id, NEW.user_id,
          NEW.method, NEW.on_clock, NEW.started_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.organization_id, OLD.facility_id, OLD.device_id, OLD.staff_id, OLD.user_id,
          OLD.method, OLD.on_clock, OLD.started_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'floor: floor_unlocks is insert plus one end; % refused', TG_OP USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION haven.floor_unlocks_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_floor_unlocks_guard
  BEFORE UPDATE OR DELETE ON public.floor_unlocks
  FOR EACH ROW EXECUTE FUNCTION haven.floor_unlocks_guard();
CREATE TRIGGER tr_floor_unlocks_no_truncate
  BEFORE TRUNCATE ON public.floor_unlocks
  FOR EACH STATEMENT EXECUTE FUNCTION haven.timeclock_guard_append_only();

-- ---------------------------------------------------------------------------
-- 3. Shared device and PIN code (kiosk and floor call the same functions)
-- ---------------------------------------------------------------------------
-- Device for a kiosk or floor call: token, not revoked, of the expected kind,
-- then throttle, then the facility flag -- the order haven.timeclock_resolve
-- always used. A token of the wrong kind is device_unknown, never a hint.
CREATE FUNCTION haven.timeclock_resolve_device(p_device_token text, p_device_kind text, p_check_throttle boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_dev record;
  v_enabled boolean;
  v_context jsonb;
BEGIN
  IF p_device_token IS NULL OR p_device_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;
  SELECT id, organization_id, facility_id, label, throttled_until, roster_roles INTO v_dev
  FROM public.timeclock_devices
  WHERE token_hash = haven.timeclock_sha256(p_device_token) AND revoked_at IS NULL AND device_kind = p_device_kind;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;
  UPDATE public.timeclock_devices SET last_seen_at = v_now WHERE id = v_dev.id;
  v_context := jsonb_build_object('device_id', v_dev.id, 'organization_id', v_dev.organization_id, 'facility_id', v_dev.facility_id);

  IF p_check_throttle AND v_dev.throttled_until IS NOT NULL AND v_dev.throttled_until > v_now THEN
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'device_throttled');
  END IF;

  SELECT timeclock_enabled INTO v_enabled
  FROM public.timeclock_facility_settings
  WHERE organization_id = v_dev.organization_id AND facility_id = v_dev.facility_id;
  IF NOT COALESCE(v_enabled, false) THEN
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'facility_off');
  END IF;

  RETURN v_context || jsonb_build_object('ok', true, 'device_label', v_dev.label,
    'throttled_until', CASE WHEN v_dev.throttled_until > v_now THEN v_dev.throttled_until END,
    'roster_roles', to_jsonb(v_dev.roster_roles));
END;
$$;
REVOKE ALL ON FUNCTION haven.timeclock_resolve_device(text, text, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- Credential, lockout and PIN. The one implementation: kiosk punches (through
-- haven.timeclock_resolve) and floor unlocks both land here. Identify the
-- credential by staff id (floor roster tap) or by employee number / badge HMAC
-- (kiosk, floor "use employee number"). 5 misses lock the credential for 15
-- minutes; every miss counts toward the device's 20-in-10-minutes throttle.
CREATE FUNCTION haven.timeclock_verify_credential_pin(
  p_device_id uuid, p_organization_id uuid, p_facility_id uuid,
  p_staff_id uuid, p_identifier text, p_badge_lookup_hmac text, p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_cred record;
  v_identifier text := upper(btrim(COALESCE(p_identifier, '')));
  v_locked timestamptz;
BEGIN
  -- FOR UPDATE: the lockout counter is only a limit if concurrent attempts serialize
  -- here. Without it, N parallel wrong PINs all read failed_attempts = 0 and all get a
  -- guess. The lock is held to the end of the transaction, which also serializes two
  -- punches for the same staff member so a double tap cannot open two shifts.
  IF p_staff_id IS NOT NULL THEN
    SELECT c.organization_id, c.staff_id, c.pin_hash, c.failed_attempts, c.locked_until INTO v_cred
    FROM public.timeclock_credentials c
    WHERE c.organization_id = p_organization_id AND c.staff_id = p_staff_id
    FOR UPDATE;
  ELSE
    SELECT c.organization_id, c.staff_id, c.pin_hash, c.failed_attempts, c.locked_until INTO v_cred
    FROM public.timeclock_credentials c
    WHERE c.organization_id = p_organization_id
      AND (
        (v_identifier <> '' AND c.employee_number = v_identifier)
        OR (p_badge_lookup_hmac IS NOT NULL AND p_badge_lookup_hmac <> '' AND c.badge_lookup_hmac = p_badge_lookup_hmac)
      )
    ORDER BY (c.employee_number = v_identifier) DESC
    LIMIT 1
    FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    PERFORM haven.timeclock_note_device_failure(p_device_id);
    RETURN jsonb_build_object('ok', false, 'error', 'not_recognized');
  END IF;

  IF v_cred.locked_until IS NOT NULL AND v_cred.locked_until > v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'locked', 'staff_id', v_cred.staff_id);
  END IF;

  IF p_pin IS NULL OR p_pin = '' THEN
    PERFORM haven.timeclock_note_device_failure(p_device_id);
    RETURN jsonb_build_object('ok', false, 'error', 'pin_unavailable', 'staff_id', v_cred.staff_id);
  END IF;

  IF crypt(p_pin, v_cred.pin_hash) <> v_cred.pin_hash THEN
    UPDATE public.timeclock_credentials
    SET failed_attempts = CASE WHEN failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END,
        locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN v_now + interval '15 minutes' ELSE locked_until END
    WHERE organization_id = v_cred.organization_id AND staff_id = v_cred.staff_id
    RETURNING locked_until INTO v_locked;
    IF v_locked IS NOT NULL AND v_locked > v_now THEN
      PERFORM haven.timeclock_audit('timeclock_credentials', v_cred.staff_id, 'UPDATE', 'credential_locked',
        NULL, p_organization_id, p_facility_id, jsonb_build_object('device_id', p_device_id));
    END IF;
    PERFORM haven.timeclock_note_device_failure(p_device_id);
    RETURN jsonb_build_object('ok', false, 'error', 'not_recognized', 'staff_id', v_cred.staff_id);
  END IF;

  UPDATE public.timeclock_credentials SET failed_attempts = 0
  WHERE organization_id = p_organization_id AND staff_id = v_cred.staff_id AND failed_attempts <> 0;
  RETURN jsonb_build_object('ok', true, 'staff_id', v_cred.staff_id);
END;
$$;
REVOKE ALL ON FUNCTION haven.timeclock_verify_credential_pin(uuid, uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Same external behavior as 408: same error codes, shapes, counters and audit
-- event. Now kiosk-kind only, so a floor tablet can never punch.
CREATE OR REPLACE FUNCTION haven.timeclock_resolve(
  p_device_token text, p_identifier text, p_badge_lookup_hmac text, p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
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
    NULL, p_identifier, p_badge_lookup_hmac, p_pin);
  IF v_pin ? 'staff_id' THEN
    v_context := v_context || jsonb_build_object('staff_id', (v_pin->>'staff_id')::uuid);
  END IF;
  IF NOT (v_pin->>'ok')::boolean THEN
    RETURN v_context || jsonb_build_object('ok', false, 'error', v_pin->>'error');
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
$$;
REVOKE ALL ON FUNCTION haven.timeclock_resolve(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Floor helpers
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.floor_role_label(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN 'Owner'
    WHEN 'org_admin' THEN 'Org admin'
    WHEN 'facility_admin' THEN 'Administrator'
    WHEN 'manager' THEN 'Manager'
    WHEN 'admin_assistant' THEN 'Admin assistant'
    WHEN 'coordinator' THEN 'Service coordinator'
    WHEN 'med_tech' THEN 'Med tech'
    WHEN 'cook' THEN 'Cook'
    WHEN 'housekeeper' THEN 'Housekeeper'
    WHEN 'maintenance_role' THEN 'Maintenance'
    WHEN 'recruiter' THEN 'Recruiter'
    ELSE 'Staff' END
$$;
REVOKE ALL ON FUNCTION haven.floor_role_label(text) FROM PUBLIC, anon, authenticated, service_role;

-- "Ashley W." from preferred or first name plus last initial.
CREATE FUNCTION haven.floor_display_name(p_first_name text, p_preferred_name text, p_last_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.btrim(
    COALESCE(NULLIF(pg_catalog.btrim(p_preferred_name), ''), pg_catalog.btrim(p_first_name), '')
    || CASE WHEN NULLIF(pg_catalog.btrim(p_last_name), '') IS NULL THEN ''
            ELSE ' ' || pg_catalog.upper(pg_catalog.left(pg_catalog.btrim(p_last_name), 1)) || '.' END)
$$;
REVOKE ALL ON FUNCTION haven.floor_display_name(text, text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION haven.floor_initials(p_first_name text, p_preferred_name text, p_last_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.upper(
    pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(p_preferred_name), ''), pg_catalog.btrim(p_first_name), ''), 1)
    || pg_catalog.left(COALESCE(pg_catalog.btrim(p_last_name), ''), 1))
$$;
REVOKE ALL ON FUNCTION haven.floor_initials(text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- The in punch that opened the current shift, from effective punches; null when off the clock.
CREATE FUNCTION haven.floor_clocked_in_at(p_staff_id uuid, p_at timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN haven.timeclock_state(p_staff_id, p_at) IN ('in', 'meal') THEN (
    SELECT e.punched_at
    FROM haven.timeclock_effective_punches(p_staff_id, p_at - interval '16 hours', p_at + interval '1 second') e
    WHERE e.punch_type = 'in'
    ORDER BY e.punched_at DESC
    LIMIT 1
  ) END
$$;
REVOKE ALL ON FUNCTION haven.floor_clocked_in_at(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Roster roles in force for a floor device: its own list, else the facility's.
CREATE FUNCTION haven.floor_effective_roster_roles(p_device_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(d.roster_roles, s.floor_roster_roles, ARRAY['med_tech', 'facility_admin'])
  FROM public.timeclock_devices d
  LEFT JOIN public.timeclock_facility_settings s ON s.organization_id = d.organization_id AND s.facility_id = d.facility_id
  WHERE d.id = p_device_id
$$;
REVOKE ALL ON FUNCTION haven.floor_effective_roster_roles(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Everyone a floor device may list right now. The single definition of the
-- roster: floor_roster reads it and floor_verify_unlock (roster method) checks
-- membership against it, so the two cannot disagree.
CREATE FUNCTION haven.floor_roster_members(p_device_id uuid, p_at timestamptz)
RETURNS TABLE (staff_id uuid, user_id uuid, app_role text, first_name text, preferred_name text, last_name text, clocked_in_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH dev AS (
    SELECT d.id, d.organization_id, d.facility_id, haven.floor_effective_roster_roles(d.id) AS roles
    FROM public.timeclock_devices d
    WHERE d.id = p_device_id AND d.device_kind = 'floor' AND d.revoked_at IS NULL
  ),
  candidates AS (
    SELECT s.id, s.user_id, p.app_role::text AS app_role, s.first_name, s.preferred_name, s.last_name
    FROM dev
    JOIN public.staff s ON s.organization_id = dev.organization_id
    JOIN public.user_profiles p ON p.id = s.user_id AND p.organization_id = s.organization_id
    JOIN auth.users au ON au.id = p.id
    WHERE s.deleted_at IS NULL
      AND s.employment_status IN ('active', 'on_leave')
      AND p.is_active AND p.deleted_at IS NULL
      AND au.deleted_at IS NULL AND (au.banned_until IS NULL OR au.banned_until <= now())
      AND p.app_role::text = ANY (dev.roles)
      AND haven.timeclock_assigned_to_facility(s.id, dev.facility_id)
  )
  SELECT c.id, c.user_id, c.app_role, c.first_name, c.preferred_name, c.last_name, haven.floor_clocked_in_at(c.id, p_at)
  FROM candidates c
  WHERE haven.timeclock_state(c.id, p_at) IN ('in', 'meal')
$$;
REVOKE ALL ON FUNCTION haven.floor_roster_members(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Floor device by token, INCLUDING revoked devices, for heartbeat and replay,
-- which must tell a revoked tablet apart from a wrong token.
CREATE FUNCTION haven.floor_device_by_token(p_device_token text)
RETURNS TABLE (id uuid, organization_id uuid, facility_id uuid, revoked_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT d.id, d.organization_id, d.facility_id, d.revoked_at
  FROM public.timeclock_devices d
  WHERE p_device_token IS NOT NULL AND p_device_token <> ''
    AND d.token_hash = haven.timeclock_sha256(p_device_token) AND d.device_kind = 'floor'
$$;
REVOKE ALL ON FUNCTION haven.floor_device_by_token(text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Device replay authority
-- ---------------------------------------------------------------------------
-- A floor replay wrapper (service_role only) validates the unlock, then sets
-- the transaction-local setting haven.floor_replay_unlock and the JWT sub to the
-- unlock's owner before calling the ordinary writer. This returns that owner
-- only when all of these hold, so the setting alone proves nothing:
--   * the request is service_role (an end-user JWT never reaches this branch);
--   * the unlock row exists on a floor device that is not revoked;
--   * the JWT sub equals the unlock's user, whose profile is in its organization;
--   * the caller's organization / facility, when given, are the unlock's.
CREATE FUNCTION haven.floor_replay_user(p_organization_id uuid, p_facility_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_raw text;
  v_user uuid;
BEGIN
  IF v_claims ->> 'role' IS DISTINCT FROM 'service_role' THEN RETURN NULL; END IF;
  v_raw := NULLIF(pg_catalog.current_setting('haven.floor_replay_unlock', true), '');
  IF v_raw IS NULL OR v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  SELECT u.user_id INTO v_user
  FROM public.floor_unlocks AS u
  JOIN public.timeclock_devices AS d ON d.id = u.device_id
  JOIN public.user_profiles AS p ON p.id = u.user_id AND p.organization_id = u.organization_id
  WHERE u.id = v_raw::uuid
    AND d.device_kind = 'floor' AND d.revoked_at IS NULL
    AND (p_organization_id IS NULL OR u.organization_id = p_organization_id)
    AND (p_facility_id IS NULL OR u.facility_id = p_facility_id);
  IF v_user IS NULL OR NULLIF(v_claims ->> 'sub', '') IS DISTINCT FROM v_user::text THEN RETURN NULL; END IF;
  RETURN v_user;
END;
$$;
REVOKE ALL ON FUNCTION haven.floor_replay_user(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.floor_replay_user(uuid, uuid) IS
  'COL-690: the owner a floor replay wrapper is writing as, or null. Needs service_role claims, haven.floor_replay_unlock naming a live floor device''s unlock, and a JWT sub equal to that unlock''s user.';

-- The actor resolver gains one branch, ahead of the unchanged authenticated
-- path: a service_role request inside a floor replay wrapper resolves to the
-- unlock owner's CURRENT profile (active, not banned, same organization). Every
-- role, organization and facility check downstream then reads the owner's
-- present authority, exactly as a signed-in request would.
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
  IF v_claims ->> 'role' = 'service_role' THEN
    v_user_id := haven.floor_replay_user(NULL, NULL);
    IF v_user_id IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT profile.id, profile.organization_id, profile.app_role::text, profile.app_role,
           profile.auth_claim_version, true
    FROM public.user_profiles AS profile
    JOIN auth.users AS auth_user ON auth_user.id=profile.id
    WHERE profile.id=v_user_id
      AND profile.organization_id IS NOT NULL
      AND profile.is_active
      AND profile.deleted_at IS NULL
      AND auth_user.deleted_at IS NULL
      AND (auth_user.banned_until IS NULL OR auth_user.banned_until <= pg_catalog.now())
    LIMIT 1;
    RETURN;
  END IF;
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
REVOKE ALL ON FUNCTION haven.current_authorized_actor() FROM PUBLIC, anon, authenticated, service_role;

-- Rounding service actor: a live auth session as before, or -- only with a null
-- session id -- the floor replay owner for this organization and facility.
-- Every other check (role, organization, claim version, facility grant, active
-- staff row at the facility) is unchanged.
CREATE OR REPLACE FUNCTION haven.assert_rounding_service_actor(p_actor_id uuid, p_actor_role text, p_session_id uuid, p_claim_version integer, p_organization_id uuid, p_facility_id uuid, p_manager_only boolean, p_require_staff boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text;
  v_organization uuid;
  v_version integer;
  v_has_grant boolean:=false;
  v_staff_id uuid;
  v_live boolean:=false;
BEGIN
  PERFORM 1 FROM public.facilities AS facility
  WHERE facility.id=p_facility_id AND facility.organization_id=p_organization_id AND facility.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rounding actor is no longer authorized' USING ERRCODE='42501'; END IF;

  SELECT true INTO v_has_grant FROM public.user_facility_access AS access
  WHERE access.user_id=p_actor_id AND access.organization_id=p_organization_id
    AND access.facility_id=p_facility_id AND access.revoked_at IS NULL
  FOR SHARE;

  IF p_session_id IS NOT NULL THEN
    PERFORM 1 FROM auth.sessions AS session
    WHERE session.id=p_session_id AND session.user_id=p_actor_id
    FOR SHARE;
    v_live:=FOUND;
  ELSE
    v_live:=COALESCE(haven.floor_replay_user(p_organization_id,p_facility_id)=p_actor_id,false);
  END IF;

  SELECT profile.app_role::text,profile.organization_id,profile.auth_claim_version
  INTO v_role,v_organization,v_version
  FROM public.user_profiles AS profile
  JOIN auth.users AS auth_user ON auth_user.id=profile.id
  WHERE v_live AND profile.id=p_actor_id AND profile.is_active AND profile.deleted_at IS NULL
    AND auth_user.deleted_at IS NULL
    AND (auth_user.banned_until IS NULL OR auth_user.banned_until<=pg_catalog.now())
  FOR SHARE OF profile,auth_user;

  IF v_role IS NULL OR v_role IS DISTINCT FROM p_actor_role
     OR v_organization IS DISTINCT FROM p_organization_id
     OR (p_claim_version=v_version OR (p_claim_version IS NULL AND v_version=1)) IS NOT TRUE
     OR (p_manager_only AND v_role NOT IN ('owner','org_admin','facility_admin','med_tech'))
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
REVOKE ALL ON FUNCTION haven.assert_rounding_service_actor(uuid,text,uuid,integer,uuid,uuid,boolean,boolean) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Enrollment, device list, revoke (kind-aware)
-- ---------------------------------------------------------------------------
-- The one-argument signature is dropped, not overloaded: one creator, one kind default.
DROP FUNCTION public.timeclock_create_enrollment_code(uuid);
CREATE FUNCTION public.timeclock_create_enrollment_code(p_facility_id uuid, p_device_kind text DEFAULT 'kiosk')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := gen_random_bytes(8);
  v_code text := '';
  v_expires timestamptz := clock_timestamp() + interval '15 minutes';
  v_id uuid;
  v_kind text := COALESCE(p_device_kind, 'kiosk');
  i integer;
BEGIN
  v_uid := haven.timeclock_assert_manager(p_facility_id, ARRAY['owner', 'org_admin']);
  IF v_kind NOT IN ('kiosk', 'floor') THEN
    RAISE EXCEPTION 'timeclock: invalid device kind' USING ERRCODE = '22023';
  END IF;
  v_org := haven.organization_id();
  FOR i IN 0..7 LOOP
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % char_length(v_alphabet)) + 1, 1);
  END LOOP;
  INSERT INTO public.timeclock_enrollment_codes (organization_id, facility_id, code_hash, created_by, expires_at, device_kind)
  VALUES (v_org, p_facility_id, haven.timeclock_sha256(v_code), v_uid, v_expires, v_kind)
  RETURNING id INTO v_id;
  PERFORM haven.timeclock_audit('timeclock_enrollment_codes', v_id, 'INSERT', 'enrollment_code_created', v_uid, v_org, p_facility_id,
    jsonb_build_object('device_kind', v_kind));
  RETURN jsonb_build_object('code', v_code, 'expires_at', v_expires, 'device_kind', v_kind);
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_create_enrollment_code(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_create_enrollment_code(uuid, text) TO authenticated;
COMMENT ON FUNCTION public.timeclock_create_enrollment_code(uuid, text) IS
  'Creates a one time 8 character tablet enrollment code, valid 15 minutes, for one facility and one device kind (kiosk or floor). COL-37 ruling: definer required -- timeclock_enrollment_codes holds no request-role grant so the code hash is never readable; the body checks auth.uid(), haven.app_role() in (owner, org_admin) and haven.accessible_facility_ids() first.';

-- Enrollment with the kind the enrolling page expects. A code of another kind is
-- code_invalid and is NOT consumed, so a floor code typed at /kiosk/setup still
-- works at /floor/setup.
CREATE FUNCTION public.timeclock_enroll_device(p_code text, p_label text, p_device_kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_code record;
  v_token text;
  v_device_id uuid;
  v_facility_name text;
BEGIN
  IF p_code IS NULL OR p_label IS NULL OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 60
     OR p_device_kind IS NULL OR p_device_kind NOT IN ('kiosk', 'floor') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'code_invalid');
  END IF;
  SELECT id, organization_id, facility_id, created_by, device_kind INTO v_code
  FROM public.timeclock_enrollment_codes
  WHERE code_hash = haven.timeclock_sha256(upper(btrim(p_code))) AND used_at IS NULL AND expires_at > v_now
    AND device_kind = p_device_kind
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'code_invalid');
  END IF;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.timeclock_devices (organization_id, facility_id, label, token_hash, enrolled_by, enrolled_at, last_seen_at, device_kind)
  VALUES (v_code.organization_id, v_code.facility_id, btrim(p_label), haven.timeclock_sha256(v_token), v_code.created_by, v_now, v_now, v_code.device_kind)
  RETURNING id INTO v_device_id;
  UPDATE public.timeclock_enrollment_codes SET used_at = v_now, used_by_device_id = v_device_id WHERE id = v_code.id;
  SELECT name INTO v_facility_name FROM public.facilities WHERE id = v_code.facility_id;
  PERFORM haven.timeclock_audit('timeclock_devices', v_device_id, 'INSERT', 'device_enrolled', v_code.created_by,
    v_code.organization_id, v_code.facility_id, jsonb_build_object('label', btrim(p_label), 'device_kind', v_code.device_kind));
  RETURN jsonb_build_object('ok', true, 'device_id', v_device_id, 'token', v_token,
    'facility_id', v_code.facility_id, 'facility_name', v_facility_name, 'device_kind', v_code.device_kind);
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_enroll_device(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timeclock_enroll_device(text, text, text) TO service_role;
COMMENT ON FUNCTION public.timeclock_enroll_device(text, text, text) IS
  'Exchanges a one time enrollment code of the expected kind (kiosk or floor) for a device token; the token is returned once and stored hashed. COL-37 ruling: definer required -- called by the session-less kiosk and floor setup routes through service_role; no request role may execute it.';

-- The 408 two-argument call is the kiosk page's; it now enrolls kiosk codes only.
CREATE OR REPLACE FUNCTION public.timeclock_enroll_device(p_code text, p_label text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT public.timeclock_enroll_device(p_code, p_label, 'kiosk')
$$;
REVOKE ALL ON FUNCTION public.timeclock_enroll_device(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timeclock_enroll_device(text, text) TO service_role;
COMMENT ON FUNCTION public.timeclock_enroll_device(text, text) IS
  'Kiosk enrollment (408 signature): timeclock_enroll_device(code, label, ''kiosk''). COL-37 ruling: definer required -- called by the session-less kiosk route through service_role; no request role may execute it.';

CREATE OR REPLACE FUNCTION public.timeclock_list_devices(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM haven.timeclock_assert_manager(p_facility_id, ARRAY['owner', 'org_admin', 'facility_admin']);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'label', d.label, 'enrolled_at', d.enrolled_at, 'last_seen_at', d.last_seen_at,
      'revoked_at', d.revoked_at, 'throttled_until', d.throttled_until,
      'device_kind', d.device_kind, 'roster_roles', to_jsonb(d.roster_roles)
    ) ORDER BY d.revoked_at NULLS FIRST, d.enrolled_at DESC)
    FROM public.timeclock_devices d
    WHERE d.facility_id = p_facility_id AND d.organization_id = haven.organization_id()
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_list_devices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_list_devices(uuid) TO authenticated;
COMMENT ON FUNCTION public.timeclock_list_devices(uuid) IS
  'Lists a facility''s tablets (kind and floor roster roles included) without the token hash. COL-37 ruling: definer required -- timeclock_devices holds no request-role grant precisely so token_hash is unreadable; the body checks auth.uid(), haven.app_role() and haven.accessible_facility_ids() first and projects only label, kind, roster roles and timestamps.';

-- Revoking a floor tablet also ends whoever has it open.
CREATE OR REPLACE FUNCTION public.timeclock_revoke_device(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_dev record;
BEGIN
  SELECT id, organization_id, facility_id, revoked_at INTO v_dev FROM public.timeclock_devices WHERE id = p_device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'timeclock: device not found' USING ERRCODE = 'P0002';
  END IF;
  v_uid := haven.timeclock_assert_manager(v_dev.facility_id, ARRAY['owner', 'org_admin']);
  IF v_dev.organization_id <> haven.organization_id() THEN
    RAISE EXCEPTION 'timeclock: forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_dev.revoked_at IS NULL THEN
    UPDATE public.timeclock_devices SET revoked_at = clock_timestamp(), revoked_by = v_uid WHERE id = p_device_id;
    UPDATE public.floor_unlocks SET ended_at = clock_timestamp(), end_reason = 'device_revoked'
    WHERE device_id = p_device_id AND ended_at IS NULL;
    PERFORM haven.timeclock_audit('timeclock_devices', p_device_id, 'UPDATE', 'device_revoked', v_uid, v_dev.organization_id, v_dev.facility_id);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_revoke_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_revoke_device(uuid) TO authenticated;
COMMENT ON FUNCTION public.timeclock_revoke_device(uuid) IS
  'Revokes a tablet; its token stops working on the next call and any open floor unlock on it ends. COL-37 ruling: definer required -- timeclock_devices and floor_unlocks hold no request-role write grant; the body checks auth.uid(), haven.app_role() in (owner, org_admin), the organization and haven.accessible_facility_ids() first.';

CREATE FUNCTION public.timeclock_set_device_roster_roles(p_device_id uuid, p_roster_roles text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_dev record;
BEGIN
  SELECT id, organization_id, facility_id, device_kind INTO v_dev FROM public.timeclock_devices WHERE id = p_device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'timeclock: device not found' USING ERRCODE = 'P0002';
  END IF;
  v_uid := haven.timeclock_assert_manager(v_dev.facility_id, ARRAY['owner', 'org_admin']);
  IF v_dev.organization_id <> haven.organization_id() THEN
    RAISE EXCEPTION 'timeclock: forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_dev.device_kind <> 'floor' THEN
    RAISE EXCEPTION 'timeclock: roster roles apply to floor tablets only' USING ERRCODE = '22023';
  END IF;
  IF p_roster_roles IS NOT NULL AND NOT haven.floor_roster_roles_valid(p_roster_roles) THEN
    RAISE EXCEPTION 'timeclock: invalid roster roles' USING ERRCODE = '22023';
  END IF;
  UPDATE public.timeclock_devices SET roster_roles = p_roster_roles WHERE id = p_device_id;
  PERFORM haven.timeclock_audit('timeclock_devices', p_device_id, 'UPDATE', 'device_roster_roles_set', v_uid, v_dev.organization_id, v_dev.facility_id,
    jsonb_build_object('roster_roles', to_jsonb(p_roster_roles)));
  RETURN jsonb_build_object('device_id', p_device_id, 'roster_roles', to_jsonb(p_roster_roles));
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_set_device_roster_roles(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_set_device_roster_roles(uuid, text[]) TO authenticated;
COMMENT ON FUNCTION public.timeclock_set_device_roster_roles(uuid, text[]) IS
  'Sets which login roles a floor tablet lists; null returns it to the facility default. COL-37 ruling: definer required -- timeclock_devices holds no request-role grant; the body checks auth.uid(), haven.app_role() in (owner, org_admin), the organization and haven.accessible_facility_ids() first.';

-- The kiosk identify step, unchanged from 408 except that the receipt also
-- carries display_name ("Ashley W.", the floor roster rule) and last_out_at
-- (the most recent effective out punch in the last 14 days, null if none) for
-- the kiosk confirmation screens. Floor tokens are still device_unknown
-- through haven.timeclock_resolve.
CREATE OR REPLACE FUNCTION public.timeclock_identify(
  p_device_token text, p_identifier text, p_badge_lookup_hmac text, p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_r jsonb;
  v_state text;
  v_tz text;
  v_staff uuid;
BEGIN
  v_r := haven.timeclock_resolve(p_device_token, p_identifier, p_badge_lookup_hmac, p_pin);
  IF NOT (v_r->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', v_r->>'error');
  END IF;
  v_staff := (v_r->>'staff_id')::uuid;
  v_state := haven.timeclock_state(v_staff, v_now);
  v_tz := haven.timeclock_facility_timezone((v_r->>'facility_id')::uuid);
  RETURN jsonb_build_object(
    'ok', true,
    'first_name', v_r->>'first_name',
    'state', v_state,
    'next_actions', to_jsonb(haven.timeclock_next_actions(v_state)),
    'today_worked_minutes', haven.timeclock_today_minutes(v_staff, v_now, v_tz),
    'display_name', (SELECT haven.floor_display_name(st.first_name, st.preferred_name, st.last_name) FROM public.staff st WHERE st.id = v_staff),
    'last_out_at', (SELECT max(e.punched_at) FROM haven.timeclock_effective_punches(v_staff, v_now - interval '14 days', v_now + interval '1 second') e WHERE e.punch_type = 'out')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_identify(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timeclock_identify(text, text, text, text) TO service_role;
COMMENT ON FUNCTION public.timeclock_identify(text, text, text, text) IS
  'Validates device, facility flag, credential, lockout, PIN and staff status without recording a punch, so the kiosk can offer only the valid next action; the receipt includes display_name and last_out_at. COL-37 ruling: definer required -- reads timeclock_credentials, which no request role may select; service_role only.';

-- The kiosk punch path, kiosk-kind only: the idempotent-replay lookup ignores
-- floor tokens, and haven.timeclock_resolve refuses them as device_unknown.
CREATE OR REPLACE FUNCTION public.timeclock_record_punch(
  p_device_token text, p_identifier text, p_badge_lookup_hmac text, p_pin text,
  p_punch_type text, p_device_time timestamptz, p_client_punch_id uuid, p_captured_offline boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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

  v_r := haven.timeclock_resolve(p_device_token, p_identifier, p_badge_lookup_hmac, p_pin);
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
    RETURN jsonb_build_object('ok', false, 'error', v_r->>'error');
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
$$;
REVOKE ALL ON FUNCTION public.timeclock_record_punch(text, text, text, text, text, timestamptz, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timeclock_record_punch(text, text, text, text, text, timestamptz, uuid, boolean) TO service_role;
COMMENT ON FUNCTION public.timeclock_record_punch(text, text, text, text, text, timestamptz, uuid, boolean) IS
  'Records one punch from a kiosk-kind tablet (receipt includes display_name and last_out_at) after validating device, facility flag, credential, lockout, PIN, staff status, facility membership and the valid next punch type; idempotent on (device, client_punch_id). A floor tablet never punches. Server time is the punch time unless captured offline. COL-37 ruling: definer required -- the only insert path into time_punches, which has no INSERT policy; service_role only.';

-- ---------------------------------------------------------------------------
-- 7. Floor path (service_role only; /api/floor/* owns the HTTP contract)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.floor_roster(p_device_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_dev jsonb;
  v_device_id uuid;
  v_facility_id uuid;
BEGIN
  -- A throttled tablet still shows who is on shift; only PIN entry waits.
  v_dev := haven.timeclock_resolve_device(p_device_token, 'floor', false);
  IF NOT (v_dev->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', v_dev->>'error');
  END IF;
  v_device_id := (v_dev->>'device_id')::uuid;
  v_facility_id := (v_dev->>'facility_id')::uuid;
  RETURN jsonb_build_object(
    'ok', true,
    'facility_name', (SELECT name FROM public.facilities WHERE id = v_facility_id),
    'device_label', v_dev->>'device_label',
    'idle_lock_minutes', (SELECT floor_idle_lock_minutes FROM public.timeclock_facility_settings
                          WHERE organization_id = (v_dev->>'organization_id')::uuid AND facility_id = v_facility_id),
    'throttled_until', v_dev->'throttled_until',
    'roster', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'staff_id', r.staff_id,
        'display_name', haven.floor_display_name(r.first_name, r.preferred_name, r.last_name),
        'initials', haven.floor_initials(r.first_name, r.preferred_name, r.last_name),
        'role_label', haven.floor_role_label(r.app_role),
        'clocked_in_at', r.clocked_in_at,
        'last_on_this_device', r.last_on
      ) ORDER BY r.last_on DESC NULLS LAST, r.clocked_in_at DESC NULLS LAST, r.staff_id)
      FROM (
        SELECT m.*, (SELECT max(u.started_at) FROM public.floor_unlocks u
                     WHERE u.device_id = v_device_id AND u.staff_id = m.staff_id) AS last_on
        FROM haven.floor_roster_members(v_device_id, v_now) m
      ) r
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.floor_roster(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.floor_roster(text) TO service_role;
COMMENT ON FUNCTION public.floor_roster(text) IS
  'Who is on shift for a floor tablet''s lock screen: active or on-leave staff with a login, in the tablet''s roster roles, assigned to its facility and clocked in (or on meal) now. Name, initials, role label, clock-in time and last unlock on this tablet; nobody else. COL-37 ruling: definer required -- reads timeclock_devices, time_punches and staff for a session-less tablet through service_role; no request role may execute it.';

CREATE FUNCTION public.floor_verify_unlock(p_device_token text, p_staff_id uuid, p_employee_number text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_dev jsonb;
  v_device_id uuid;
  v_org uuid;
  v_facility_id uuid;
  v_roles text[];
  v_method text;
  v_pin jsonb;
  v_staff record;
  v_login record;
  v_on_clock boolean;
  v_unlock_id uuid;
  v_idle integer;
BEGIN
  IF (p_staff_id IS NULL) = (NULLIF(btrim(COALESCE(p_employee_number, '')), '') IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_recognized');
  END IF;
  v_method := CASE WHEN p_staff_id IS NOT NULL THEN 'roster' ELSE 'employee_number' END;

  v_dev := haven.timeclock_resolve_device(p_device_token, 'floor');
  IF NOT (v_dev->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', v_dev->>'error');
  END IF;
  v_device_id := (v_dev->>'device_id')::uuid;
  v_org := (v_dev->>'organization_id')::uuid;
  v_facility_id := (v_dev->>'facility_id')::uuid;
  v_roles := haven.floor_effective_roster_roles(v_device_id);

  IF v_method = 'roster' THEN
    -- Not on this tablet's roster (off the clock, other facility, wrong role, no
    -- login): the same answer as a wrong PIN, and it counts toward the throttle.
    IF NOT EXISTS (SELECT 1 FROM haven.floor_roster_members(v_device_id, v_now) m WHERE m.staff_id = p_staff_id) THEN
      PERFORM haven.timeclock_note_device_failure(v_device_id);
      RETURN jsonb_build_object('ok', false, 'error', 'not_recognized');
    END IF;
    v_pin := haven.timeclock_verify_credential_pin(v_device_id, v_org, v_facility_id, p_staff_id, NULL, NULL, p_pin);
  ELSE
    v_pin := haven.timeclock_verify_credential_pin(v_device_id, v_org, v_facility_id, NULL, p_employee_number, NULL, p_pin);
  END IF;
  IF NOT (v_pin->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', CASE WHEN v_pin->>'error' = 'locked' THEN 'locked' ELSE 'not_recognized' END);
  END IF;

  -- The PIN was right. Only now say anything about who this is.
  SELECT s.id, s.user_id, s.first_name, s.preferred_name, s.last_name INTO v_staff
  FROM public.staff s
  WHERE s.id = (v_pin->>'staff_id')::uuid AND s.organization_id = v_org
    AND s.deleted_at IS NULL AND s.employment_status IN ('active', 'on_leave');
  IF NOT FOUND OR NOT haven.timeclock_assigned_to_facility(v_staff.id, v_facility_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_recognized');
  END IF;

  SELECT p.id, p.app_role::text AS app_role, au.email INTO v_login
  FROM public.user_profiles p
  JOIN auth.users au ON au.id = p.id
  WHERE p.id = v_staff.user_id AND p.organization_id = v_org AND p.is_active AND p.deleted_at IS NULL
    AND au.deleted_at IS NULL AND (au.banned_until IS NULL OR au.banned_until <= now());
  IF NOT FOUND OR v_login.email IS NULL OR v_login.email = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_login');
  END IF;
  IF NOT (v_login.app_role = ANY (v_roles)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  v_on_clock := haven.timeclock_state(v_staff.id, v_now) IN ('in', 'meal');
  IF v_method = 'roster' AND NOT v_on_clock THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_recognized');
  END IF;

  UPDATE public.floor_unlocks SET ended_at = v_now, end_reason = 'new_unlock'
  WHERE device_id = v_device_id AND ended_at IS NULL;
  INSERT INTO public.floor_unlocks (organization_id, facility_id, device_id, staff_id, user_id, method, on_clock, started_at)
  VALUES (v_org, v_facility_id, v_device_id, v_staff.id, v_login.id, v_method, v_on_clock, v_now)
  RETURNING id INTO v_unlock_id;
  PERFORM haven.timeclock_audit('floor_unlocks', v_unlock_id, 'INSERT', 'floor_unlocked', v_login.id, v_org, v_facility_id,
    jsonb_build_object('device_id', v_device_id, 'method', v_method, 'on_clock', v_on_clock));

  SELECT floor_idle_lock_minutes INTO v_idle FROM public.timeclock_facility_settings
  WHERE organization_id = v_org AND facility_id = v_facility_id;
  RETURN jsonb_build_object(
    'ok', true,
    'unlock_id', v_unlock_id,
    'user_id', v_login.id,
    'email', v_login.email,
    'on_clock', v_on_clock,
    'idle_lock_minutes', COALESCE(v_idle, 3),
    'display_name', haven.floor_display_name(v_staff.first_name, v_staff.preferred_name, v_staff.last_name),
    'role_label', haven.floor_role_label(v_login.app_role),
    'clocked_in_at', haven.floor_clocked_in_at(v_staff.id, v_now)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.floor_verify_unlock(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.floor_verify_unlock(text, uuid, text, text) TO service_role;
COMMENT ON FUNCTION public.floor_verify_unlock(text, uuid, text, text) IS
  'Unlocks a floor tablet for one person: roster tap or employee number, plus the timeclock PIN through the shared lockout and throttle code. Ends any open unlock on the tablet, records the new one and returns the auth email the route mints a session for. COL-37 ruling: definer required -- reads timeclock_credentials and auth.users and inserts floor_unlocks, none of which any request role may touch; service_role only.';

CREATE FUNCTION public.floor_heartbeat(p_device_token text, p_unlock_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_dev record;
  v_unlock record;
  v_reason text;
BEGIN
  SELECT * INTO v_dev FROM haven.floor_device_by_token(p_device_token);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('active', false, 'reason', 'device_revoked');
  END IF;
  IF v_dev.revoked_at IS NULL THEN
    UPDATE public.timeclock_devices SET last_seen_at = v_now WHERE id = v_dev.id;
  END IF;
  SELECT id, staff_id, method, started_at, ended_at, end_reason INTO v_unlock
  FROM public.floor_unlocks
  WHERE id = p_unlock_id AND device_id = v_dev.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('active', false, 'reason', 'unknown');
  END IF;
  IF v_unlock.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('active', false, 'reason', v_unlock.end_reason);
  END IF;
  v_reason := CASE
    WHEN v_dev.revoked_at IS NOT NULL THEN 'device_revoked'
    WHEN v_unlock.started_at < v_now - interval '12 hours' THEN 'max_age'
    WHEN v_unlock.method = 'roster' AND haven.timeclock_state(v_unlock.staff_id, v_now) NOT IN ('in', 'meal') THEN 'clocked_out'
  END;
  IF v_reason IS NOT NULL THEN
    UPDATE public.floor_unlocks SET ended_at = v_now, end_reason = v_reason WHERE id = v_unlock.id;
    RETURN jsonb_build_object('active', false, 'reason', v_reason);
  END IF;
  RETURN jsonb_build_object('active', true, 'reason', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.floor_heartbeat(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.floor_heartbeat(text, uuid) TO service_role;
COMMENT ON FUNCTION public.floor_heartbeat(text, uuid) IS
  'Keeps or ends a floor unlock: inactive once ended, when the tablet is revoked, after 12 hours, or when a roster unlock''s person is off the clock (ending the row with that reason). An unlock id that is not this tablet''s answers reason unknown. COL-37 ruling: definer required -- updates floor_unlocks, which has no request-role write grant, for a session-less tablet through service_role only.';

CREATE FUNCTION public.floor_end_unlock(p_device_token text, p_unlock_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_dev record;
  v_unlock record;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('sleep', 'idle', 'switch') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_reason');
  END IF;
  SELECT * INTO v_dev FROM haven.floor_device_by_token(p_device_token) d WHERE d.revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;
  SELECT id, ended_at, end_reason INTO v_unlock
  FROM public.floor_unlocks
  WHERE id = p_unlock_id AND device_id = v_dev.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown');
  END IF;
  IF v_unlock.ended_at IS NULL THEN
    UPDATE public.floor_unlocks SET ended_at = v_now, end_reason = p_reason WHERE id = v_unlock.id
    RETURNING ended_at, end_reason INTO v_unlock.ended_at, v_unlock.end_reason;
  END IF;
  RETURN jsonb_build_object('ok', true, 'ended_at', v_unlock.ended_at, 'end_reason', v_unlock.end_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.floor_end_unlock(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.floor_end_unlock(text, uuid, text) TO service_role;
COMMENT ON FUNCTION public.floor_end_unlock(text, uuid, text) IS
  'Ends this tablet''s unlock for sleep, idle or switch; idempotent once ended, and refuses another tablet''s unlock. COL-37 ruling: definer required -- updates floor_unlocks, which has no request-role write grant, for a session-less tablet through service_role only.';

-- Capture-time skew: a queued item's p_captured_at is the TABLET clock, while
-- started_at and ended_at are server time. Two minutes either side (the same
-- tolerance 408 uses before flagging clock_skew) absorbs honest drift without
-- letting an item claim an unlock it was not captured under.
CREATE FUNCTION public.floor_unlock_for_replay(p_device_token text, p_unlock_id uuid, p_owner_user_id uuid, p_captured_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_skew constant interval := interval '2 minutes';
  v_dev record;
  v_unlock record;
  v_role text;
BEGIN
  SELECT * INTO v_dev FROM haven.floor_device_by_token(p_device_token) d WHERE d.revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;
  SELECT id, organization_id, facility_id, staff_id, user_id, started_at, ended_at INTO v_unlock
  FROM public.floor_unlocks
  WHERE id = p_unlock_id AND device_id = v_dev.id AND user_id = p_owner_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unlock_mismatch');
  END IF;
  IF p_captured_at IS NULL OR NOT isfinite(p_captured_at)
     OR p_captured_at < v_unlock.started_at - v_skew
     OR p_captured_at > COALESCE(v_unlock.ended_at, v_now) + v_skew
     OR p_captured_at > v_now + v_skew THEN
    RETURN jsonb_build_object('ok', false, 'error', 'outside_unlock');
  END IF;
  SELECT p.app_role::text INTO v_role
  FROM public.user_profiles p
  WHERE p.id = v_unlock.user_id AND p.organization_id = v_unlock.organization_id AND p.is_active AND p.deleted_at IS NULL;
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_login');
  END IF;
  RETURN jsonb_build_object('ok', true, 'organization_id', v_unlock.organization_id, 'facility_id', v_unlock.facility_id,
    'staff_id', v_unlock.staff_id, 'user_id', v_unlock.user_id, 'app_role', v_role);
END;
$$;
REVOKE ALL ON FUNCTION public.floor_unlock_for_replay(text, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.floor_unlock_for_replay(text, uuid, uuid, timestamptz) TO service_role;
COMMENT ON FUNCTION public.floor_unlock_for_replay(text, uuid, uuid, timestamptz) IS
  'Proves a queued floor item belongs to its owner: the unlock is this live tablet''s and that owner''s, and the capture time falls inside the unlock (2 minutes of clock skew either side). COL-37 ruling: definer required -- reads timeclock_devices and floor_unlocks for a session-less tablet through service_role; no request role may execute it.';

-- Switch the request identity to the unlock owner for the writer call, and put
-- it back afterwards. auth.uid() and auth.jwt() read request.jwt.claim.sub,
-- request.jwt.claim and request.jwt.claims on hosted Supabase, so all three
-- move together. Only a service_role request may switch.
CREATE FUNCTION haven.floor_replay_begin(p_unlock_id uuid, p_owner_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_saved jsonb := pg_catalog.jsonb_build_object(
    'claims', pg_catalog.current_setting('request.jwt.claims', true),
    'claim', pg_catalog.current_setting('request.jwt.claim', true),
    'sub', pg_catalog.current_setting('request.jwt.claim.sub', true),
    'unlock', pg_catalog.current_setting('haven.floor_replay_unlock', true));
  v_claims jsonb := auth.jwt();
  v_owner jsonb := pg_catalog.jsonb_build_object('sub', p_owner_user_id);
BEGIN
  IF v_claims ->> 'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'floor: replay runs only for the service role' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claims', (v_claims || v_owner)::text, true);
  IF NULLIF(v_saved ->> 'claim', '') IS NOT NULL THEN
    PERFORM pg_catalog.set_config('request.jwt.claim', (v_claims || v_owner)::text, true);
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', p_owner_user_id::text, true);
  PERFORM pg_catalog.set_config('haven.floor_replay_unlock', p_unlock_id::text, true);
  RETURN v_saved;
END;
$$;
REVOKE ALL ON FUNCTION haven.floor_replay_begin(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION haven.floor_replay_end(p_saved jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', COALESCE(p_saved ->> 'claims', ''), true);
  PERFORM pg_catalog.set_config('request.jwt.claim', COALESCE(p_saved ->> 'claim', ''), true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_saved ->> 'sub', ''), true);
  PERFORM pg_catalog.set_config('haven.floor_replay_unlock', COALESCE(p_saved ->> 'unlock', ''), true);
END;
$$;
REVOKE ALL ON FUNCTION haven.floor_replay_end(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Rounding completion as the unlock owner, through the same
-- public.complete_rounding_task_review the signed-in route calls. p_payload is
-- that function's payload (request_id, observed_at, quick_status, ...). The
-- replay is recorded as an offline sync. Validation failures return
-- {ok:false,error}; the writer's own refusals raise with its SQLSTATE, exactly
-- as they do on the signed-in route.
CREATE FUNCTION public.floor_replay_complete_rounding_task(
  p_device_token text, p_unlock_id uuid, p_owner_user_id uuid, p_captured_at timestamptz,
  p_task_id uuid, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_proof jsonb;
  v_saved jsonb;
  v_version integer;
  v_staff uuid;
  v_result jsonb;
BEGIN
  IF p_task_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  v_proof := public.floor_unlock_for_replay(p_device_token, p_unlock_id, p_owner_user_id, p_captured_at);
  IF NOT (v_proof->>'ok')::boolean THEN
    RETURN v_proof;
  END IF;
  SELECT auth_claim_version INTO v_version FROM public.user_profiles WHERE id = p_owner_user_id;
  SELECT s.id INTO v_staff FROM public.staff s
  WHERE s.user_id = p_owner_user_id AND s.organization_id = (v_proof->>'organization_id')::uuid
    AND s.facility_id = (v_proof->>'facility_id')::uuid AND s.employment_status = 'active' AND s.deleted_at IS NULL
  ORDER BY s.id LIMIT 1;

  v_saved := haven.floor_replay_begin(p_unlock_id, p_owner_user_id);
  v_result := public.complete_rounding_task_review(
    p_task_id, p_owner_user_id, v_proof->>'app_role', NULL, v_version,
    (v_proof->>'organization_id')::uuid, (v_proof->>'facility_id')::uuid, v_staff,
    p_payload || jsonb_build_object('offline', true));
  PERFORM haven.floor_replay_end(v_saved);
  RETURN jsonb_build_object('ok', true) || v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.floor_replay_complete_rounding_task(text, uuid, uuid, timestamptz, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.floor_replay_complete_rounding_task(text, uuid, uuid, timestamptz, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.floor_replay_complete_rounding_task(text, uuid, uuid, timestamptz, uuid, jsonb) IS
  'Replays a rounding check queued on a floor tablet as its owner after the tablet locked. Proves the owner with floor_unlock_for_replay, then calls public.complete_rounding_task_review with a null session, which haven.assert_rounding_service_actor accepts only for this unlock''s owner, organization and facility; the owner''s current role, facility grant and staff row are re-checked there. COL-37 ruling: definer required -- the session-less tablet has no request role; service_role only.';

-- Care event as the unlock owner, through the same public.submit_care_event the
-- signed-in route calls. p_payload is that route's body (queue_owner_user_id is
-- dropped, as the route drops it); its facility must be the unlock's.
CREATE FUNCTION public.floor_replay_submit_care_event(
  p_device_token text, p_unlock_id uuid, p_owner_user_id uuid, p_captured_at timestamptz, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_proof jsonb;
  v_saved jsonb;
  v_result jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  v_proof := public.floor_unlock_for_replay(p_device_token, p_unlock_id, p_owner_user_id, p_captured_at);
  IF NOT (v_proof->>'ok')::boolean THEN
    RETURN v_proof;
  END IF;
  IF lower(p_payload->>'facility_id') IS DISTINCT FROM (v_proof->>'facility_id') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_facility');
  END IF;
  v_saved := haven.floor_replay_begin(p_unlock_id, p_owner_user_id);
  v_result := public.submit_care_event(p_payload - 'queue_owner_user_id');
  PERFORM haven.floor_replay_end(v_saved);
  RETURN jsonb_build_object('ok', true, 'receipt', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.floor_replay_submit_care_event(text, uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.floor_replay_submit_care_event(text, uuid, uuid, timestamptz, jsonb) TO service_role;
COMMENT ON FUNCTION public.floor_replay_submit_care_event(text, uuid, uuid, timestamptz, jsonb) IS
  'Replays a Something happened report queued on a floor tablet as its owner after the tablet locked. Proves the owner with floor_unlock_for_replay, then calls public.submit_care_event with haven.current_authorized_actor resolving to that owner''s current profile, so every role, organization and facility check is the owner''s present authority. COL-37 ruling: definer required -- the session-less tablet has no request role; service_role only.';

-- ---------------------------------------------------------------------------
-- 8. Visitor kiosk (table from 294, hardened in 412)
-- ---------------------------------------------------------------------------
ALTER TABLE public.visitor_log_entries
  ADD COLUMN kiosk_device_id uuid NULL REFERENCES public.timeclock_devices(id),
  ADD COLUMN visitor_company text NULL
    CONSTRAINT visitor_log_entries_visitor_company_check CHECK (visitor_company IS NULL OR char_length(btrim(visitor_company)) BETWEEN 1 AND 120),
  ADD COLUMN visiting_name_text text NULL
    CONSTRAINT visitor_log_entries_visiting_name_text_check CHECK (visiting_name_text IS NULL OR char_length(btrim(visiting_name_text)) BETWEEN 1 AND 120),
  ADD COLUMN kiosk_client_entry_id uuid NULL;

-- A kiosk entry carries its device and client id together and has no staff
-- signer; a staff entry carries neither. signed_in_by stays nullable as 294 had it.
ALTER TABLE public.visitor_log_entries
  ADD CONSTRAINT visitor_log_entries_kiosk_origin_check
    CHECK ((kiosk_device_id IS NULL) = (kiosk_client_entry_id IS NULL)
           AND (kiosk_device_id IS NULL OR signed_in_by IS NULL));

ALTER TABLE public.visitor_log_entries DROP CONSTRAINT visitor_log_entries_sign_out_method_check;
ALTER TABLE public.visitor_log_entries
  ADD CONSTRAINT visitor_log_entries_sign_out_method_check
    CHECK (sign_out_method IS NULL OR sign_out_method IN ('individual', 'bulk_end_of_day', 'kiosk_self'));

CREATE UNIQUE INDEX idx_visitor_log_entries_kiosk_device_client_entry
  ON public.visitor_log_entries (kiosk_device_id, kiosk_client_entry_id)
  WHERE kiosk_device_id IS NOT NULL AND kiosk_client_entry_id IS NOT NULL;

-- Staff sign visitors in from the front desk; a kiosk row is written only by the kiosk.
DROP POLICY "Staff record visitor log in accessible facilities" ON public.visitor_log_entries;
CREATE POLICY "Staff record visitor log in accessible facilities"
  ON public.visitor_log_entries FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() <> 'family'
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (signed_in_by IS NULL OR signed_in_by = auth.uid())
    AND voided_at IS NULL
    AND checked_out_at IS NULL
    AND kiosk_device_id IS NULL
    AND kiosk_client_entry_id IS NULL
  );

-- Kiosk device for a visitor call. The visitor log does not depend on the
-- timeclock rollout flag and is not throttled by staff PIN misses: a front door
-- that refuses visitors because of the staff clock would send them in unsigned.
CREATE FUNCTION haven.visitor_kiosk_device(p_device_token text)
RETURNS TABLE (id uuid, organization_id uuid, facility_id uuid)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF p_device_token IS NULL OR p_device_token = '' THEN RETURN; END IF;
  RETURN QUERY
  WITH seen AS (
    UPDATE public.timeclock_devices d SET last_seen_at = clock_timestamp()
    WHERE d.token_hash = haven.timeclock_sha256(p_device_token) AND d.revoked_at IS NULL AND d.device_kind = 'kiosk'
    RETURNING d.id, d.organization_id, d.facility_id
  )
  SELECT seen.id, seen.organization_id, seen.facility_id FROM seen;
END;
$$;
REVOKE ALL ON FUNCTION haven.visitor_kiosk_device(text) FROM PUBLIC, anon, authenticated, service_role;

-- "Jordan P." -- first word plus the last word's initial. Never a resident name.
CREATE FUNCTION haven.visitor_kiosk_display_name(p_visitor_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN pg_catalog.array_length(w.parts, 1) > 1
    THEN w.parts[1] || ' ' || pg_catalog.upper(pg_catalog.left(w.parts[pg_catalog.array_length(w.parts, 1)], 1)) || '.'
    ELSE w.parts[1] END
  FROM (SELECT pg_catalog.regexp_split_to_array(pg_catalog.btrim(COALESCE(p_visitor_name, '')), '\s+') AS parts) w
$$;
REVOKE ALL ON FUNCTION haven.visitor_kiosk_display_name(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION haven.visitor_kiosk_type_label(p_visitor_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_visitor_type IN ('family_friend', 'family') THEN 'Visiting a resident'
    WHEN p_visitor_type IN ('healthcare_provider', 'medical') THEN 'Healthcare provider'
    WHEN p_visitor_type IN ('vendor_contractor', 'vendor', 'contractor') THEN 'Vendor or contractor'
    WHEN p_visitor_type IN ('surveyor_regulator', 'official') THEN 'Inspector or official'
    ELSE 'Visitor' END
$$;
REVOKE ALL ON FUNCTION haven.visitor_kiosk_type_label(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.visitor_kiosk_sign_in(
  p_device_token text, p_client_entry_id uuid, p_visitor_type text, p_visitor_name text,
  p_visitor_phone text, p_visitor_company text, p_visiting_name_text text, p_purpose text, p_symptoms_reported boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_dev record;
  v_name text := btrim(COALESCE(p_visitor_name, ''));
  v_phone text := NULLIF(btrim(COALESCE(p_visitor_phone, '')), '');
  v_company text := NULLIF(btrim(COALESCE(p_visitor_company, '')), '');
  v_visiting text := NULLIF(btrim(COALESCE(p_visiting_name_text, '')), '');
  v_purpose text := NULLIF(btrim(COALESCE(p_purpose, '')), '');
  v_symptoms boolean := COALESCE(p_symptoms_reported, false);
  v_asks_health boolean := p_visitor_type IN ('family_friend', 'healthcare_provider');
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

  IF p_client_entry_id IS NULL
     OR p_visitor_type IS NULL OR p_visitor_type NOT IN ('family_friend', 'healthcare_provider', 'vendor_contractor', 'surveyor_regulator')
     OR char_length(v_name) NOT BETWEEN 1 AND 120
     OR (v_phone IS NOT NULL AND v_phone !~ '^[0-9()+\-. ]{7,20}$')
     OR (v_company IS NOT NULL AND char_length(v_company) > 120)
     OR (v_visiting IS NOT NULL AND char_length(v_visiting) > 120)
     OR (v_purpose IS NOT NULL AND char_length(v_purpose) > 280)
     -- Company or agency: required for providers, vendors and inspectors; a family visitor has none.
     OR ((p_visitor_type <> 'family_friend') <> (v_company IS NOT NULL))
     -- Who they are seeing: required for a family visit, optional for a provider, never for the rest.
     OR (p_visitor_type = 'family_friend' AND v_visiting IS NULL)
     OR (p_visitor_type IN ('vendor_contractor', 'surveyor_regulator') AND v_visiting IS NOT NULL)
     -- Only the visit and provider forms ask "feeling sick today".
     OR (NOT v_asks_health AND v_symptoms) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  INSERT INTO public.visitor_log_entries (
    organization_id, facility_id, visitor_name, visitor_type, visitor_phone, visitor_company, visiting_name_text,
    purpose, symptoms_reported, screening_passed, kiosk_device_id, kiosk_client_entry_id, checked_in_at
  ) VALUES (
    v_dev.organization_id, v_dev.facility_id, v_name, p_visitor_type, v_phone, v_company, v_visiting,
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
$$;
REVOKE ALL ON FUNCTION public.visitor_kiosk_sign_in(text, uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_kiosk_sign_in(text, uuid, text, text, text, text, text, text, boolean) TO service_role;
COMMENT ON FUNCTION public.visitor_kiosk_sign_in(text, uuid, text, text, text, text, text, text, boolean) IS
  'Signs a visitor in at the front-door kiosk: visit, healthcare provider, vendor or contractor, inspector or official. Idempotent on the tablet''s client entry id; a reported symptom records screening_passed = false. The resident is typed, never picked. COL-37 ruling: definer required -- the session-less kiosk has no request role, and kiosk rows are refused by the staff INSERT policy; service_role only.';

-- Open visits at the kiosk's facility since the last 24 hours, by name prefix.
-- Nothing before 3 letters, at most 5 rows, and only the visitor's own first
-- name and last initial: never a resident, a phone number or who they visited.
CREATE FUNCTION public.visitor_kiosk_open_matches(p_device_token text, p_prefix text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_dev record;
  v_prefix text := left(btrim(COALESCE(p_prefix, '')), 60);
BEGIN
  SELECT * INTO v_dev FROM haven.visitor_kiosk_device(p_device_token);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;
  IF char_length(regexp_replace(v_prefix, '[^[:alpha:]]', '', 'g')) < 3 THEN
    RETURN jsonb_build_object('ok', true, 'matches', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('ok', true, 'matches', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'entry_id', m.id,
      'display_name', haven.visitor_kiosk_display_name(m.visitor_name),
      'type_label', haven.visitor_kiosk_type_label(m.visitor_type),
      'checked_in_at', m.checked_in_at
    ) ORDER BY m.checked_in_at DESC)
    FROM (
      SELECT v.id, v.visitor_name, v.visitor_type, v.checked_in_at
      FROM public.visitor_log_entries v
      WHERE v.organization_id = v_dev.organization_id
        AND v.facility_id = v_dev.facility_id
        AND v.deleted_at IS NULL AND v.voided_at IS NULL AND v.checked_out_at IS NULL
        AND v.checked_in_at >= now() - interval '24 hours'
        AND lower(btrim(v.visitor_name)) LIKE replace(replace(replace(lower(v_prefix), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      ORDER BY v.checked_in_at DESC
      LIMIT 5
    ) m
  ), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.visitor_kiosk_open_matches(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_kiosk_open_matches(text, text) TO service_role;
COMMENT ON FUNCTION public.visitor_kiosk_open_matches(text, text) IS
  'Up to 5 open visits from the last 24 hours at the kiosk''s facility whose visitor name starts with a prefix of 3 or more letters; first name and last initial, type label and time in only. COL-37 ruling: definer required -- the session-less kiosk has no request role and must not read the visitor log through a policy; service_role only.';

CREATE FUNCTION public.visitor_kiosk_sign_out(p_device_token text, p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_dev record;
  e public.visitor_log_entries;
BEGIN
  SELECT * INTO v_dev FROM haven.visitor_kiosk_device(p_device_token);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;
  SELECT * INTO e FROM public.visitor_log_entries
  WHERE id = p_entry_id AND organization_id = v_dev.organization_id AND facility_id = v_dev.facility_id
    AND deleted_at IS NULL AND voided_at IS NULL AND checked_in_at >= now() - interval '24 hours'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF e.checked_out_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_signed_out');
  END IF;
  UPDATE public.visitor_log_entries
     SET checked_out_at = now(), signed_out_by = NULL, sign_out_method = 'kiosk_self'
   WHERE id = e.id RETURNING * INTO e;
  PERFORM haven.visitor_audit(e, 'visitor_signed_out_kiosk');
  RETURN jsonb_build_object('ok', true, 'checked_in_at', e.checked_in_at, 'checked_out_at', e.checked_out_at,
    'display_name', haven.visitor_kiosk_display_name(e.visitor_name));
END;
$$;
REVOKE ALL ON FUNCTION public.visitor_kiosk_sign_out(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_kiosk_sign_out(text, uuid) TO service_role;
COMMENT ON FUNCTION public.visitor_kiosk_sign_out(text, uuid) IS
  'A visitor signs themselves out at the kiosk, once: an open, unvoided visit from the last 24 hours at the kiosk''s facility, recorded as kiosk_self. COL-37 ruling: definer required -- authenticated has no UPDATE on public.visitor_log_entries and the session-less kiosk has no request role; service_role only.';

-- Front desk turns a typed "who are you visiting" into the resident record.
CREATE FUNCTION public.visitor_match_resident(p_entry_id uuid, p_resident_id uuid)
RETURNS public.visitor_log_entries
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE e public.visitor_log_entries;
BEGIN
  e := haven.visitor_entry_for_update(p_entry_id);
  IF e.voided_at IS NOT NULL THEN RAISE EXCEPTION 'This entry was voided' USING ERRCODE = '22023'; END IF;
  IF e.kiosk_device_id IS NULL OR e.visiting_name_text IS NULL THEN
    RAISE EXCEPTION 'Only a kiosk entry with a typed name can be matched' USING ERRCODE = '22023';
  END IF;
  IF e.resident_id IS NOT NULL THEN RAISE EXCEPTION 'This entry is already matched to a resident' USING ERRCODE = '22023'; END IF;
  IF p_resident_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.residents r
    WHERE r.id = p_resident_id AND r.facility_id = e.facility_id AND r.organization_id = e.organization_id AND r.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A visitor is signed in against a resident of this facility only' USING ERRCODE = '23514';
  END IF;
  UPDATE public.visitor_log_entries SET resident_id = p_resident_id, visiting_type = 'resident'
   WHERE id = e.id RETURNING * INTO e;
  PERFORM haven.visitor_audit(e, 'visitor_resident_matched');
  RETURN e;
END;
$$;
REVOKE ALL ON FUNCTION public.visitor_match_resident(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_match_resident(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.visitor_match_resident(uuid, uuid) IS
  'Matches a kiosk entry''s typed visit to a resident of the same facility, once. COL-37 ruling: definer required -- authenticated has no UPDATE on public.visitor_log_entries and no UPDATE policy exists, deliberately; the body asserts the caller''s facility grant with haven.has_facility_access, refuses the family role, takes FOR UPDATE, and writes an audit row. Keep it definer.';

-- ---------------------------------------------------------------------------
-- 9. One clock (spec 40 section 1): where the kiosk is live, staff do not
--    clock themselves in through time_records
-- ---------------------------------------------------------------------------
-- /caregiver/clock already refuses where timeclock_enabled is on; this makes
-- the database refuse a client that skips the page. Restrictive policies, so
-- the existing permissive ones (staff_clock_in_out, admin_insert_time_records,
-- staff_update_own_open_time_records) and every manager path stay as they
-- are. Owners, org admins and administrators are unaffected; everyone else may
-- not insert a time_records row at a facility whose flag is on, and may not
-- leave a row there open through an UPDATE (closing one that was opened before
-- the flag went on still works). Definer paths are not request roles and are
-- untouched.
CREATE FUNCTION haven.timeclock_enabled_for(p_facility_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT s.timeclock_enabled FROM public.timeclock_facility_settings AS s
    WHERE s.facility_id = p_facility_id
  ), false)
$$;
REVOKE ALL ON FUNCTION haven.timeclock_enabled_for(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION haven.timeclock_enabled_for(uuid) TO authenticated;
COMMENT ON FUNCTION haven.timeclock_enabled_for(uuid) IS
  'COL-690: is the kiosk timeclock live at this facility. COL-37 ruling: definer required -- the time_records policies evaluate it for staff, who cannot read timeclock_facility_settings (manager-only RLS); it returns one boolean for a facility id and nothing else.';

CREATE POLICY "Staff do not self clock in where the kiosk timeclock is on" ON public.time_records
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT haven.app_role()) IN ('owner', 'org_admin', 'facility_admin')
    OR NOT haven.timeclock_enabled_for(facility_id)
  );
CREATE POLICY "Staff do not open a time record where the kiosk timeclock is on" ON public.time_records
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    (SELECT haven.app_role()) IN ('owner', 'org_admin', 'facility_admin')
    OR NOT haven.timeclock_enabled_for(facility_id)
    OR clock_out IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 10. Who charted it: display names for staff at the caller's facilities
-- ---------------------------------------------------------------------------
-- Migration 475 lets a med tech read only their own staff row, so on a shared
-- tablet the next person cannot see who charted a check. This returns the
-- "Ashley W." name and nothing else -- no user id, contact data, role or status
-- -- for staff in the caller's organization whose home facility, or a live
-- dated assignment, is one the caller can access. At most 200 ids per call.
CREATE FUNCTION public.floor_staff_display_names(p_staff_ids uuid[])
RETURNS TABLE (staff_id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id, haven.floor_display_name(s.first_name, s.preferred_name, s.last_name)
  FROM public.staff AS s
  WHERE pg_catalog.cardinality(p_staff_ids) BETWEEN 1 AND 200
    AND s.id = ANY (p_staff_ids)
    AND s.organization_id = haven.organization_id()
    AND haven.app_role() IS DISTINCT FROM 'family'
    AND (
      s.facility_id IN (SELECT haven.accessible_facility_ids())
      OR EXISTS (
        SELECT 1 FROM public.staff_facility_assignments AS a
        WHERE a.staff_id = s.id AND a.organization_id = s.organization_id AND a.deleted_at IS NULL
          AND a.facility_id IN (SELECT haven.accessible_facility_ids())
          AND a.start_date <= ((pg_catalog.clock_timestamp() AT TIME ZONE haven.timeclock_facility_timezone(a.facility_id))::date)
          AND (a.end_date IS NULL OR a.end_date >= ((pg_catalog.clock_timestamp() AT TIME ZONE haven.timeclock_facility_timezone(a.facility_id))::date))
      )
    )
$$;
REVOKE ALL ON FUNCTION public.floor_staff_display_names(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.floor_staff_display_names(uuid[]) TO authenticated;
COMMENT ON FUNCTION public.floor_staff_display_names(uuid[]) IS
  'Display names ("Ashley W.") for up to 200 staff ids, limited to the caller''s organization and to staff whose home facility or live assignment is one the caller can access; returns nothing else about them. COL-37 ruling: definer required -- migration 475 restricts a med tech to their own staff row, so a shared floor tablet could not name who charted a check; the body scopes by haven.organization_id(), haven.accessible_facility_ids() and excludes family, and projects only the display name.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: DROP FUNCTION the floor_*, visitor_kiosk_*, visitor_match_resident,
-- timeclock_set_device_roster_roles and timeclock_enroll_device(text,text,text)
-- functions and the haven helpers above; restore 408's timeclock_resolve,
-- timeclock_enroll_device(text,text), timeclock_identify, timeclock_record_punch,
-- timeclock_list_devices, timeclock_revoke_device and
-- timeclock_create_enrollment_code(uuid), 468's assert_rounding_service_actor
-- and 327's current_authorized_actor; restore 412's sign_out_method check and
-- INSERT policy; drop the two restrictive time_records policies and
-- haven.timeclock_enabled_for; DROP FUNCTION public.floor_staff_display_names(uuid[]);
-- drop the new columns. floor_unlocks and kiosk visitor rows are
-- attribution evidence: keep them.
