-- COL-352: Haven timeclock. Staff punch on a facility bound tablet with a badge
-- or employee number plus a PIN; managers add corrections with a reason; the
-- ledger is append only for every role. Spec: docs/specs/37-timeclock.md.
--
-- Secrets never reach the database in the clear: PINs are bcrypt hashes,
-- device tokens and enrollment codes are SHA-256 hashes, and a badge is only
-- ever an HMAC computed by the Next.js server with TIMECLOCK_BADGE_HMAC_SECRET.
-- pgcrypto lives in `extensions` on hosted Supabase, so every function here
-- pins `search_path = public, extensions` and never qualifies crypt/digest.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
CREATE TABLE public.timeclock_facility_settings (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  timeclock_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid NULL REFERENCES public.user_profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, facility_id)
);
COMMENT ON TABLE public.timeclock_facility_settings IS 'Per facility timeclock rollout flag (COL-352). Default off; the kiosk refuses punches while off.';

CREATE TABLE public.timeclock_organization_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  timeclock_pay_period text NULL CHECK (timeclock_pay_period IN ('weekly', 'biweekly')),
  timeclock_pay_period_anchor date NULL
    CHECK (timeclock_pay_period_anchor IS NULL OR extract(isodow FROM timeclock_pay_period_anchor) = 1),
  updated_by uuid NULL REFERENCES public.user_profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((timeclock_pay_period IS NULL) = (timeclock_pay_period_anchor IS NULL))
);
COMMENT ON TABLE public.timeclock_organization_settings IS 'Pay period frequency and anchor Monday for the payroll export (COL-352). Null until set; must match ADP (TBD, COL-357).';

-- ---------------------------------------------------------------------------
-- Devices, enrollment codes, credentials
-- ---------------------------------------------------------------------------
CREATE TABLE public.timeclock_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  token_hash text NOT NULL UNIQUE,
  enrolled_by uuid NOT NULL REFERENCES public.user_profiles(id),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NULL,
  revoked_at timestamptz NULL,
  revoked_by uuid NULL REFERENCES public.user_profiles(id),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  failure_window_started_at timestamptz NULL,
  throttled_until timestamptz NULL
);
CREATE INDEX idx_timeclock_devices_facility ON public.timeclock_devices (facility_id) WHERE revoked_at IS NULL;

CREATE TABLE public.timeclock_enrollment_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  code_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  used_by_device_id uuid NULL REFERENCES public.timeclock_devices(id)
);

CREATE TABLE public.timeclock_credentials (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(id),
  employee_number text NOT NULL CHECK (employee_number ~ '^[A-Z0-9-]{1,20}$'),
  badge_lookup_hmac text NULL,
  pin_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz NULL,
  pin_set_by uuid NOT NULL REFERENCES public.user_profiles(id),
  pin_set_at timestamptz NOT NULL DEFAULT now(),
  badge_set_at timestamptz NULL,
  PRIMARY KEY (organization_id, staff_id),
  UNIQUE (organization_id, employee_number),
  UNIQUE (organization_id, badge_lookup_hmac)
);
COMMENT ON TABLE public.timeclock_credentials IS 'Kiosk credentials (COL-352). pin_hash is bcrypt; badge_lookup_hmac is an HMAC the server computes. No client role may read this table; only definer functions touch it.';

-- ---------------------------------------------------------------------------
-- Punches, corrections, sync rejections
-- ---------------------------------------------------------------------------
CREATE TABLE public.time_punches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  staff_id uuid NOT NULL REFERENCES public.staff(id),
  punch_type text NOT NULL CHECK (punch_type IN ('in', 'out', 'meal_start', 'meal_end')),
  punched_at timestamptz NOT NULL,
  device_time timestamptz NULL,
  device_id uuid NULL REFERENCES public.timeclock_devices(id),
  captured_offline boolean NOT NULL DEFAULT false,
  client_punch_id uuid NOT NULL,
  flags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, client_punch_id)
);
CREATE INDEX idx_time_punches_org_staff_punched_at ON public.time_punches (organization_id, staff_id, punched_at);
CREATE INDEX idx_time_punches_facility_punched_at ON public.time_punches (facility_id, punched_at);
COMMENT ON TABLE public.time_punches IS 'Append only punch ledger (COL-352). Inserted only by public.timeclock_record_punch; never updated or deleted by any role.';

CREATE TABLE public.time_punch_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  staff_id uuid NOT NULL REFERENCES public.staff(id),
  correction_type text NOT NULL CHECK (correction_type IN ('add_punch', 'void_punch', 'change_time', 'acknowledge')),
  target_punch_id uuid NULL REFERENCES public.time_punches(id),
  target_correction_id uuid NULL REFERENCES public.time_punch_corrections(id),
  punch_type text NULL CHECK (punch_type IN ('in', 'out', 'meal_start', 'meal_end')),
  corrected_punched_at timestamptz NULL,
  exception_key text NULL CHECK (exception_key IS NULL OR char_length(exception_key) BETWEEN 1 AND 120),
  reason text NOT NULL CHECK (reason IN ('missed_punch', 'wrong_punch_type', 'device_outage', 'manager_verified_time', 'duplicate')),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 280),
  corrected_by uuid NOT NULL REFERENCES public.user_profiles(id),
  corrected_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_punch_corrections_shape CHECK (
    (correction_type = 'add_punch'
      AND punch_type IS NOT NULL AND corrected_punched_at IS NOT NULL
      AND target_punch_id IS NULL AND target_correction_id IS NULL AND exception_key IS NULL)
    OR (correction_type = 'void_punch'
      AND ((target_punch_id IS NOT NULL)::int + (target_correction_id IS NOT NULL)::int) = 1
      AND punch_type IS NULL AND corrected_punched_at IS NULL AND exception_key IS NULL)
    OR (correction_type = 'change_time'
      AND ((target_punch_id IS NOT NULL)::int + (target_correction_id IS NOT NULL)::int) = 1
      AND corrected_punched_at IS NOT NULL AND punch_type IS NULL AND exception_key IS NULL)
    OR (correction_type = 'acknowledge'
      AND exception_key IS NOT NULL AND reason = 'manager_verified_time'
      AND target_punch_id IS NULL AND target_correction_id IS NULL
      AND punch_type IS NULL AND corrected_punched_at IS NULL)
  )
);
CREATE INDEX idx_time_punch_corrections_org_staff_corrected_at ON public.time_punch_corrections (organization_id, staff_id, corrected_at);
CREATE INDEX idx_time_punch_corrections_facility_corrected_at ON public.time_punch_corrections (facility_id, corrected_at);
COMMENT ON TABLE public.time_punch_corrections IS 'Append only manager corrections and exception acknowledgments (COL-352). A punch is never edited; the timesheet computes from punches plus corrections.';

CREATE TABLE public.timeclock_sync_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  device_id uuid NOT NULL REFERENCES public.timeclock_devices(id),
  staff_id uuid NULL REFERENCES public.staff(id),
  client_punch_id uuid NOT NULL,
  punch_type text NOT NULL,
  device_time timestamptz NULL,
  reason text NOT NULL CHECK (reason IN ('not_recognized', 'locked', 'inactive_staff', 'not_assigned', 'invalid_next_type', 'pin_unavailable', 'facility_off')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, client_punch_id)
);
CREATE INDEX idx_timeclock_sync_rejections_facility_created_at ON public.timeclock_sync_rejections (facility_id, created_at);
COMMENT ON TABLE public.timeclock_sync_rejections IS 'Offline punches the server refused at sync (COL-352). Surfaces to managers as the rejected_offline_sync exception; never shown on the kiosk.';

-- ---------------------------------------------------------------------------
-- Privileges: state them, do not inherit them
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.timeclock_facility_settings, public.timeclock_organization_settings,
  public.timeclock_devices, public.timeclock_enrollment_codes, public.timeclock_credentials,
  public.time_punches, public.time_punch_corrections, public.timeclock_sync_rejections
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON public.timeclock_facility_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.timeclock_organization_settings TO authenticated;
GRANT SELECT ON public.time_punches TO authenticated;
GRANT SELECT, INSERT ON public.time_punch_corrections TO authenticated;
GRANT SELECT ON public.timeclock_sync_rejections TO authenticated;
-- timeclock_devices, timeclock_enrollment_codes, timeclock_credentials: no request role holds anything.

ALTER TABLE public.timeclock_facility_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeclock_organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeclock_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeclock_enrollment_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeclock_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_punch_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeclock_sync_rejections ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "Timeclock managers read the facility flag"
  ON public.timeclock_facility_settings FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );
CREATE POLICY "Owners and org admins turn the facility timeclock on or off"
  ON public.timeclock_facility_settings FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin')
    AND updated_by = auth.uid()
  );
CREATE POLICY "Owners and org admins update the facility timeclock flag"
  ON public.timeclock_facility_settings FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin')
    AND updated_by = auth.uid()
  );

CREATE POLICY "Timeclock managers read the organization pay period"
  ON public.timeclock_organization_settings FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );
CREATE POLICY "Owners and org admins set the pay period"
  ON public.timeclock_organization_settings FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
    AND updated_by = auth.uid()
  );
CREATE POLICY "Owners and org admins update the pay period"
  ON public.timeclock_organization_settings FOR UPDATE
  USING (organization_id = haven.organization_id() AND haven.app_role() IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
    AND updated_by = auth.uid()
  );

-- timeclock_devices, timeclock_enrollment_codes, timeclock_credentials: RLS on, no policies.

CREATE POLICY "Timeclock managers read punches for accessible facilities"
  ON public.time_punches FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );
CREATE POLICY "Staff read their own punches"
  ON public.time_punches FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND EXISTS (SELECT 1 FROM public.staff s WHERE s.id = time_punches.staff_id AND s.user_id = auth.uid() AND s.deleted_at IS NULL)
  );
-- No INSERT policy: only public.timeclock_record_punch (definer) inserts. No UPDATE or DELETE policy for any role.

CREATE POLICY "Timeclock managers read corrections for accessible facilities"
  ON public.time_punch_corrections FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );
CREATE POLICY "Staff read corrections to their own punches"
  ON public.time_punch_corrections FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND EXISTS (SELECT 1 FROM public.staff s WHERE s.id = time_punch_corrections.staff_id AND s.user_id = auth.uid() AND s.deleted_at IS NULL)
  );
CREATE POLICY "Timeclock managers add corrections with a reason"
  ON public.time_punch_corrections FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND corrected_by = auth.uid()
  );
-- No UPDATE or DELETE policy for any role.

CREATE POLICY "Timeclock managers read sync rejections"
  ON public.timeclock_sync_rejections FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- ---------------------------------------------------------------------------
-- Guards: append only is a trigger, not just a missing policy
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.timeclock_guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'timeclock: % is append only; add a correction instead', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION haven.timeclock_guard_append_only() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_time_punches_append_only
  BEFORE UPDATE OR DELETE ON public.time_punches
  FOR EACH ROW EXECUTE FUNCTION haven.timeclock_guard_append_only();
CREATE TRIGGER tr_time_punch_corrections_append_only
  BEFORE UPDATE OR DELETE ON public.time_punch_corrections
  FOR EACH ROW EXECUTE FUNCTION haven.timeclock_guard_append_only();
CREATE TRIGGER tr_timeclock_sync_rejections_append_only
  BEFORE UPDATE OR DELETE ON public.timeclock_sync_rejections
  FOR EACH ROW EXECUTE FUNCTION haven.timeclock_guard_append_only();

CREATE OR REPLACE FUNCTION haven.timeclock_guard_correction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target record;
BEGIN
  IF NEW.target_punch_id IS NOT NULL THEN
    SELECT organization_id, facility_id, staff_id INTO v_target
      FROM public.time_punches WHERE id = NEW.target_punch_id;
    IF NOT FOUND OR v_target.organization_id <> NEW.organization_id
       OR v_target.facility_id <> NEW.facility_id OR v_target.staff_id <> NEW.staff_id THEN
      RAISE EXCEPTION 'timeclock: target punch does not belong to this staff member and facility' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.target_correction_id IS NOT NULL THEN
    SELECT organization_id, facility_id, staff_id, correction_type INTO v_target
      FROM public.time_punch_corrections WHERE id = NEW.target_correction_id;
    IF NOT FOUND OR v_target.organization_id <> NEW.organization_id
       OR v_target.facility_id <> NEW.facility_id OR v_target.staff_id <> NEW.staff_id
       OR v_target.correction_type <> 'add_punch' THEN
      RAISE EXCEPTION 'timeclock: only an added punch of the same staff member can be targeted' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id = NEW.staff_id AND s.organization_id = NEW.organization_id AND s.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'timeclock: staff member not found in this organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION haven.timeclock_guard_correction() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_time_punch_corrections_guard
  BEFORE INSERT ON public.time_punch_corrections
  FOR EACH ROW EXECUTE FUNCTION haven.timeclock_guard_correction();

-- updated_at and audit
CREATE TRIGGER tr_timeclock_facility_settings_set_updated_at
  BEFORE UPDATE ON public.timeclock_facility_settings
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER tr_timeclock_organization_settings_set_updated_at
  BEFORE UPDATE ON public.timeclock_organization_settings
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

CREATE TRIGGER tr_timeclock_facility_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.timeclock_facility_settings
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER tr_timeclock_organization_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.timeclock_organization_settings
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER tr_time_punch_corrections_audit
  AFTER INSERT ON public.time_punch_corrections
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
-- timeclock_devices / codes / credentials are audited by the definer functions
-- as metadata only, so no hash ever lands in audit_log.

-- haven_capture_audit_log takes record_id from NEW.id; the settings tables have
-- composite keys, so give them an id column for the audit row.
ALTER TABLE public.timeclock_facility_settings ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.timeclock_organization_settings ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();

-- ---------------------------------------------------------------------------
-- Private helpers (haven schema, no request-role grants)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.timeclock_sha256(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex')
$$;
REVOKE ALL ON FUNCTION haven.timeclock_sha256(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.timeclock_audit(
  p_table text, p_record_id uuid, p_action text, p_event text,
  p_user_id uuid, p_organization_id uuid, p_facility_id uuid, p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO public.audit_log (table_name, record_id, action, new_data, user_id, organization_id, facility_id)
  VALUES (p_table, p_record_id, p_action, jsonb_build_object('event', p_event) || COALESCE(p_extra, '{}'::jsonb),
          p_user_id, p_organization_id, p_facility_id);
$$;
REVOKE ALL ON FUNCTION haven.timeclock_audit(text, uuid, text, text, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Effective punches: voids removed, time changes applied, added punches included.
CREATE OR REPLACE FUNCTION haven.timeclock_effective_punches(p_staff_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (punch_id uuid, punch_type text, punched_at timestamptz, source text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH voided_punches AS (
    SELECT target_punch_id FROM public.time_punch_corrections
    WHERE staff_id = p_staff_id AND correction_type = 'void_punch' AND target_punch_id IS NOT NULL
  ),
  voided_corrections AS (
    SELECT target_correction_id FROM public.time_punch_corrections
    WHERE staff_id = p_staff_id AND correction_type = 'void_punch' AND target_correction_id IS NOT NULL
  ),
  changed_punches AS (
    SELECT DISTINCT ON (target_punch_id) target_punch_id, corrected_punched_at
    FROM public.time_punch_corrections
    WHERE staff_id = p_staff_id AND correction_type = 'change_time' AND target_punch_id IS NOT NULL
    ORDER BY target_punch_id, corrected_at DESC
  ),
  changed_corrections AS (
    SELECT DISTINCT ON (target_correction_id) target_correction_id, corrected_punched_at
    FROM public.time_punch_corrections
    WHERE staff_id = p_staff_id AND correction_type = 'change_time' AND target_correction_id IS NOT NULL
    ORDER BY target_correction_id, corrected_at DESC
  ),
  effective AS (
    SELECT p.id, p.punch_type, COALESCE(cp.corrected_punched_at, p.punched_at) AS punched_at, 'punch'::text AS source
    FROM public.time_punches p
    LEFT JOIN changed_punches cp ON cp.target_punch_id = p.id
    WHERE p.staff_id = p_staff_id AND p.id NOT IN (SELECT target_punch_id FROM voided_punches)
    UNION ALL
    SELECT c.id, c.punch_type, COALESCE(cc.corrected_punched_at, c.corrected_punched_at), 'correction'
    FROM public.time_punch_corrections c
    LEFT JOIN changed_corrections cc ON cc.target_correction_id = c.id
    WHERE c.staff_id = p_staff_id AND c.correction_type = 'add_punch'
      AND c.id NOT IN (SELECT target_correction_id FROM voided_corrections)
  )
  SELECT id, punch_type, punched_at, source FROM effective
  WHERE punched_at >= p_from AND punched_at < p_to
  ORDER BY punched_at, source
$$;
REVOKE ALL ON FUNCTION haven.timeclock_effective_punches(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- State from the last effective punch within 16 hours: 'out', 'in' or 'meal'.
CREATE OR REPLACE FUNCTION haven.timeclock_state(p_staff_id uuid, p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE e.punch_type
      WHEN 'in' THEN 'in'
      WHEN 'meal_end' THEN 'in'
      WHEN 'meal_start' THEN 'meal'
      ELSE 'out' END
    FROM haven.timeclock_effective_punches(p_staff_id, p_at - interval '16 hours', p_at + interval '1 second') e
    ORDER BY e.punched_at DESC, e.source DESC
    LIMIT 1
  ), 'out')
$$;
REVOKE ALL ON FUNCTION haven.timeclock_state(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.timeclock_next_actions(p_state text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_state
    WHEN 'in' THEN ARRAY['out', 'meal_start']
    WHEN 'meal' THEN ARRAY['meal_end']
    ELSE ARRAY['in'] END
$$;
REVOKE ALL ON FUNCTION haven.timeclock_next_actions(text) FROM PUBLIC, anon, authenticated, service_role;

-- Worked minutes inside [p_from, p_to): in/out segments minus meals, open
-- segment counted to p_to unless it is stale (over 16 hours). Integer minutes.
-- Workweek boundaries are not computed here; that rule lives only in
-- src/lib/timeclock/compute.ts. This helper serves the kiosk receipt.
CREATE OR REPLACE FUNCTION haven.timeclock_worked_minutes(p_staff_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  r record;
  v_open timestamptz := NULL;
  v_total integer := 0;
  v_a timestamptz;
  v_b timestamptz;
BEGIN
  FOR r IN
    SELECT punch_type, punched_at
    FROM haven.timeclock_effective_punches(p_staff_id, p_from - interval '24 hours', p_to)
    ORDER BY punched_at, source
  LOOP
    IF r.punch_type IN ('in', 'meal_end') THEN
      v_open := r.punched_at;
    ELSIF r.punch_type IN ('out', 'meal_start') THEN
      IF v_open IS NOT NULL THEN
        v_a := greatest(v_open, p_from);
        v_b := least(r.punched_at, p_to);
        IF v_b > v_a THEN
          v_total := v_total + floor(extract(epoch FROM (v_b - v_a)) / 60)::integer;
        END IF;
        v_open := NULL;
      END IF;
    END IF;
  END LOOP;
  IF v_open IS NOT NULL AND p_to - v_open <= interval '16 hours' THEN
    v_a := greatest(v_open, p_from);
    IF p_to > v_a THEN
      v_total := v_total + floor(extract(epoch FROM (p_to - v_a)) / 60)::integer;
    END IF;
  END IF;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION haven.timeclock_worked_minutes(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- "Today" for the receipt: from the earlier of the facility calendar day start
-- and the in punch that opened the current shift, to now.
CREATE OR REPLACE FUNCTION haven.timeclock_today_minutes(p_staff_id uuid, p_at timestamptz, p_timezone text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_day_start timestamptz;
  v_shift_start timestamptz;
BEGIN
  v_day_start := (date_trunc('day', p_at AT TIME ZONE p_timezone)) AT TIME ZONE p_timezone;
  SELECT e.punched_at INTO v_shift_start
  FROM haven.timeclock_effective_punches(p_staff_id, p_at - interval '16 hours', p_at + interval '1 second') e
  WHERE e.punch_type = 'in'
  ORDER BY e.punched_at DESC
  LIMIT 1;
  RETURN haven.timeclock_worked_minutes(p_staff_id, least(v_day_start, COALESCE(v_shift_start, v_day_start)), p_at);
END;
$$;
REVOKE ALL ON FUNCTION haven.timeclock_today_minutes(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;

-- Device failure accounting: 20 failures in a rolling 10 minute window
-- throttles the device for 5 minutes.
CREATE OR REPLACE FUNCTION haven.timeclock_note_device_failure(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_dev record;
BEGIN
  UPDATE public.timeclock_devices
  SET failure_window_started_at = CASE
        WHEN failure_window_started_at IS NULL OR failure_window_started_at < v_now - interval '10 minutes' THEN v_now
        ELSE failure_window_started_at END,
      failure_count = CASE
        WHEN failure_window_started_at IS NULL OR failure_window_started_at < v_now - interval '10 minutes' THEN 1
        ELSE failure_count + 1 END
  WHERE id = p_device_id
  RETURNING id, organization_id, facility_id, failure_count INTO v_dev;
  IF v_dev.failure_count >= 20 THEN
    UPDATE public.timeclock_devices
    SET throttled_until = v_now + interval '5 minutes', failure_count = 0, failure_window_started_at = NULL
    WHERE id = p_device_id;
    PERFORM haven.timeclock_audit('timeclock_devices', v_dev.id, 'UPDATE', 'device_throttled', NULL, v_dev.organization_id, v_dev.facility_id);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION haven.timeclock_note_device_failure(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Resolve device + credential + staff for a kiosk call. Returns ok:false with an
-- error code instead of raising so failure counters persist.
CREATE OR REPLACE FUNCTION haven.timeclock_resolve(
  p_device_token text, p_identifier text, p_badge_lookup_hmac text, p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_dev record;
  v_cred record;
  v_staff record;
  v_enabled boolean;
  v_identifier text := upper(btrim(COALESCE(p_identifier, '')));
  v_context jsonb;
  v_locked timestamptz;
BEGIN
  IF p_device_token IS NULL OR p_device_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;
  SELECT id, organization_id, facility_id, throttled_until INTO v_dev
  FROM public.timeclock_devices
  WHERE token_hash = haven.timeclock_sha256(p_device_token) AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;
  UPDATE public.timeclock_devices SET last_seen_at = v_now WHERE id = v_dev.id;
  v_context := jsonb_build_object('device_id', v_dev.id, 'organization_id', v_dev.organization_id, 'facility_id', v_dev.facility_id);

  IF v_dev.throttled_until IS NOT NULL AND v_dev.throttled_until > v_now THEN
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'device_throttled');
  END IF;

  SELECT timeclock_enabled INTO v_enabled
  FROM public.timeclock_facility_settings
  WHERE organization_id = v_dev.organization_id AND facility_id = v_dev.facility_id;
  IF NOT COALESCE(v_enabled, false) THEN
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'facility_off');
  END IF;

  SELECT c.organization_id, c.staff_id, c.pin_hash, c.failed_attempts, c.locked_until INTO v_cred
  FROM public.timeclock_credentials c
  WHERE c.organization_id = v_dev.organization_id
    AND (
      (v_identifier <> '' AND c.employee_number = v_identifier)
      OR (p_badge_lookup_hmac IS NOT NULL AND p_badge_lookup_hmac <> '' AND c.badge_lookup_hmac = p_badge_lookup_hmac)
    )
  ORDER BY (c.employee_number = v_identifier) DESC
  LIMIT 1;
  IF NOT FOUND THEN
    PERFORM haven.timeclock_note_device_failure(v_dev.id);
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'not_recognized');
  END IF;
  v_context := v_context || jsonb_build_object('staff_id', v_cred.staff_id);

  IF v_cred.locked_until IS NOT NULL AND v_cred.locked_until > v_now THEN
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'locked');
  END IF;

  IF p_pin IS NULL OR p_pin = '' THEN
    PERFORM haven.timeclock_note_device_failure(v_dev.id);
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'pin_unavailable');
  END IF;

  IF crypt(p_pin, v_cred.pin_hash) <> v_cred.pin_hash THEN
    UPDATE public.timeclock_credentials
    SET failed_attempts = CASE WHEN failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END,
        locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN v_now + interval '15 minutes' ELSE locked_until END
    WHERE organization_id = v_cred.organization_id AND staff_id = v_cred.staff_id
    RETURNING locked_until INTO v_locked;
    IF v_locked IS NOT NULL AND v_locked > v_now THEN
      PERFORM haven.timeclock_audit('timeclock_credentials', (v_context->>'staff_id')::uuid, 'UPDATE', 'credential_locked',
        NULL, v_dev.organization_id, v_dev.facility_id, jsonb_build_object('device_id', v_dev.id));
    END IF;
    PERFORM haven.timeclock_note_device_failure(v_dev.id);
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'not_recognized');
  END IF;

  UPDATE public.timeclock_credentials SET failed_attempts = 0
  WHERE organization_id = v_dev.organization_id AND staff_id = (v_context->>'staff_id')::uuid AND failed_attempts <> 0;

  SELECT s.id, s.first_name, s.preferred_name, s.facility_id, s.employment_status, s.deleted_at INTO v_staff
  FROM public.staff s WHERE s.id = (v_context->>'staff_id')::uuid;
  IF NOT FOUND OR v_staff.deleted_at IS NOT NULL OR v_staff.employment_status NOT IN ('active', 'on_leave') THEN
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'inactive_staff');
  END IF;
  IF v_staff.facility_id <> v_dev.facility_id AND NOT EXISTS (
    SELECT 1 FROM public.staff_facility_assignments a
    WHERE a.staff_id = v_staff.id AND a.facility_id = v_dev.facility_id
      AND a.deleted_at IS NULL AND a.end_date IS NULL
  ) THEN
    RETURN v_context || jsonb_build_object('ok', false, 'error', 'not_assigned');
  END IF;

  RETURN v_context || jsonb_build_object('ok', true, 'first_name', COALESCE(NULLIF(v_staff.preferred_name, ''), v_staff.first_name));
END;
$$;
REVOKE ALL ON FUNCTION haven.timeclock_resolve(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.timeclock_facility_timezone(p_facility_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT timezone FROM public.facilities WHERE id = p_facility_id), 'America/New_York')
$$;
REVOKE ALL ON FUNCTION haven.timeclock_facility_timezone(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Manager authority for the credential and device functions.
CREATE OR REPLACE FUNCTION haven.timeclock_assert_manager(p_facility_id uuid, p_roles text[])
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'timeclock: not authenticated' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(haven.app_role()::text, '') <> ALL (p_roles) THEN
    RAISE EXCEPTION 'timeclock: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_facility_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.facilities f
    WHERE f.id = p_facility_id AND f.organization_id = haven.organization_id() AND f.deleted_at IS NULL
      AND f.id IN (SELECT haven.accessible_facility_ids())
  ) THEN
    RAISE EXCEPTION 'timeclock: forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END;
$$;
REVOKE ALL ON FUNCTION haven.timeclock_assert_manager(uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Kiosk path (service_role only; the route handlers own the HTTP contract)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.timeclock_enroll_device(p_code text, p_label text)
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
  IF p_code IS NULL OR p_label IS NULL OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 60 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'code_invalid');
  END IF;
  SELECT id, organization_id, facility_id, created_by INTO v_code
  FROM public.timeclock_enrollment_codes
  WHERE code_hash = haven.timeclock_sha256(upper(btrim(p_code))) AND used_at IS NULL AND expires_at > v_now
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'code_invalid');
  END IF;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.timeclock_devices (organization_id, facility_id, label, token_hash, enrolled_by, enrolled_at, last_seen_at)
  VALUES (v_code.organization_id, v_code.facility_id, btrim(p_label), haven.timeclock_sha256(v_token), v_code.created_by, v_now, v_now)
  RETURNING id INTO v_device_id;
  UPDATE public.timeclock_enrollment_codes SET used_at = v_now, used_by_device_id = v_device_id WHERE id = v_code.id;
  SELECT name INTO v_facility_name FROM public.facilities WHERE id = v_code.facility_id;
  PERFORM haven.timeclock_audit('timeclock_devices', v_device_id, 'INSERT', 'device_enrolled', v_code.created_by,
    v_code.organization_id, v_code.facility_id, jsonb_build_object('label', btrim(p_label)));
  RETURN jsonb_build_object('ok', true, 'device_id', v_device_id, 'token', v_token,
    'facility_id', v_code.facility_id, 'facility_name', v_facility_name);
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_enroll_device(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timeclock_enroll_device(text, text) TO service_role;
COMMENT ON FUNCTION public.timeclock_enroll_device(text, text) IS
  'Exchanges a one time enrollment code for a device token; the token is returned once and stored hashed. COL-37 ruling: definer required -- called by the session-less kiosk route through service_role; no request role may execute it.';

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
BEGIN
  v_r := haven.timeclock_resolve(p_device_token, p_identifier, p_badge_lookup_hmac, p_pin);
  IF NOT (v_r->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', v_r->>'error');
  END IF;
  v_state := haven.timeclock_state((v_r->>'staff_id')::uuid, v_now);
  v_tz := haven.timeclock_facility_timezone((v_r->>'facility_id')::uuid);
  RETURN jsonb_build_object(
    'ok', true,
    'first_name', v_r->>'first_name',
    'state', v_state,
    'next_actions', to_jsonb(haven.timeclock_next_actions(v_state)),
    'today_worked_minutes', haven.timeclock_today_minutes((v_r->>'staff_id')::uuid, v_now, v_tz)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_identify(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timeclock_identify(text, text, text, text) TO service_role;
COMMENT ON FUNCTION public.timeclock_identify(text, text, text, text) IS
  'Validates device, facility flag, credential, lockout, PIN and staff status without recording a punch, so the kiosk can offer only the valid next action. COL-37 ruling: definer required -- reads timeclock_credentials, which no request role may select; service_role only.';

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
  WHERE token_hash = haven.timeclock_sha256(COALESCE(p_device_token, '')) AND revoked_at IS NULL;
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
        'today_worked_minutes', haven.timeclock_today_minutes(v_existing.staff_id, v_now, v_tz)
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
    'today_worked_minutes', haven.timeclock_today_minutes(v_staff, v_now, v_tz)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_record_punch(text, text, text, text, text, timestamptz, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timeclock_record_punch(text, text, text, text, text, timestamptz, uuid, boolean) TO service_role;
COMMENT ON FUNCTION public.timeclock_record_punch(text, text, text, text, text, timestamptz, uuid, boolean) IS
  'Records one punch after validating device, facility flag, credential, lockout, PIN, staff status, facility membership and the valid next punch type; idempotent on (device, client_punch_id). Server time is the punch time unless captured offline. COL-37 ruling: definer required -- the only insert path into time_punches, which has no INSERT policy; service_role only.';

-- ---------------------------------------------------------------------------
-- Manager path (authenticated; body checks role, organization and facility)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.timeclock_create_enrollment_code(p_facility_id uuid)
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
  i integer;
BEGIN
  v_uid := haven.timeclock_assert_manager(p_facility_id, ARRAY['owner', 'org_admin']);
  v_org := haven.organization_id();
  FOR i IN 0..7 LOOP
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % char_length(v_alphabet)) + 1, 1);
  END LOOP;
  INSERT INTO public.timeclock_enrollment_codes (organization_id, facility_id, code_hash, created_by, expires_at)
  VALUES (v_org, p_facility_id, haven.timeclock_sha256(v_code), v_uid, v_expires)
  RETURNING id INTO v_id;
  PERFORM haven.timeclock_audit('timeclock_enrollment_codes', v_id, 'INSERT', 'enrollment_code_created', v_uid, v_org, p_facility_id);
  RETURN jsonb_build_object('code', v_code, 'expires_at', v_expires);
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_create_enrollment_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_create_enrollment_code(uuid) TO authenticated;
COMMENT ON FUNCTION public.timeclock_create_enrollment_code(uuid) IS
  'Creates a one time 8 character tablet enrollment code, valid 15 minutes, for one facility. COL-37 ruling: definer required -- timeclock_enrollment_codes holds no request-role grant so the code hash is never readable; the body checks auth.uid(), haven.app_role() in (owner, org_admin) and haven.accessible_facility_ids() first.';

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
    PERFORM haven.timeclock_audit('timeclock_devices', p_device_id, 'UPDATE', 'device_revoked', v_uid, v_dev.organization_id, v_dev.facility_id);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_revoke_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_revoke_device(uuid) TO authenticated;
COMMENT ON FUNCTION public.timeclock_revoke_device(uuid) IS
  'Revokes a tablet; its token stops working on the next call. COL-37 ruling: definer required -- timeclock_devices holds no request-role grant; the body checks auth.uid(), haven.app_role() in (owner, org_admin), the organization and haven.accessible_facility_ids() first.';

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
      'revoked_at', d.revoked_at, 'throttled_until', d.throttled_until
    ) ORDER BY d.revoked_at NULLS FIRST, d.enrolled_at DESC)
    FROM public.timeclock_devices d
    WHERE d.facility_id = p_facility_id AND d.organization_id = haven.organization_id()
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_list_devices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_list_devices(uuid) TO authenticated;
COMMENT ON FUNCTION public.timeclock_list_devices(uuid) IS
  'Lists a facility''s tablets without the token hash. COL-37 ruling: definer required -- timeclock_devices holds no request-role grant precisely so token_hash is unreadable; the body checks auth.uid(), haven.app_role() and haven.accessible_facility_ids() first and projects only label and timestamps.';

CREATE OR REPLACE FUNCTION public.timeclock_credential_status(p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff record;
  v_cred record;
BEGIN
  SELECT id, organization_id, facility_id, employment_status, deleted_at INTO v_staff FROM public.staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'timeclock: staff not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM haven.timeclock_assert_manager(v_staff.facility_id, ARRAY['owner', 'org_admin', 'facility_admin']);
  IF v_staff.organization_id <> haven.organization_id() THEN
    RAISE EXCEPTION 'timeclock: forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT employee_number, badge_lookup_hmac IS NOT NULL AS has_badge, locked_until, pin_set_at, badge_set_at, failed_attempts
    INTO v_cred
  FROM public.timeclock_credentials WHERE organization_id = v_staff.organization_id AND staff_id = p_staff_id;
  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'eligible', v_staff.deleted_at IS NULL AND v_staff.employment_status IN ('active', 'on_leave'),
    'exists', FOUND,
    'employee_number', v_cred.employee_number,
    'has_badge', COALESCE(v_cred.has_badge, false),
    'locked_until', CASE WHEN v_cred.locked_until > clock_timestamp() THEN v_cred.locked_until ELSE NULL END,
    'pin_set_at', v_cred.pin_set_at,
    'badge_set_at', v_cred.badge_set_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_credential_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_credential_status(uuid) TO authenticated;
COMMENT ON FUNCTION public.timeclock_credential_status(uuid) IS
  'Reports whether a staff member has a PIN and badge and whether the credential is locked; never the hashes. COL-37 ruling: definer required -- timeclock_credentials holds no request-role grant; the body checks auth.uid(), haven.app_role(), the organization and haven.accessible_facility_ids() first.';

CREATE OR REPLACE FUNCTION public.timeclock_set_credentials(
  p_staff_id uuid, p_mode text, p_employee_number text, p_pin text, p_badge_lookup_hmac text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid;
  v_staff record;
  v_number text := upper(btrim(COALESCE(p_employee_number, '')));
  v_exists boolean;
  v_event text;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('create', 'set_number', 'set_pin', 'set_badge', 'clear_badge') THEN
    RAISE EXCEPTION 'timeclock: invalid mode' USING ERRCODE = '22023';
  END IF;
  SELECT id, organization_id, facility_id, employment_status, deleted_at INTO v_staff FROM public.staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'timeclock: staff not found' USING ERRCODE = 'P0002';
  END IF;
  v_uid := haven.timeclock_assert_manager(v_staff.facility_id, ARRAY['owner', 'org_admin', 'facility_admin']);
  IF v_staff.organization_id <> haven.organization_id() THEN
    RAISE EXCEPTION 'timeclock: forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_staff.deleted_at IS NOT NULL OR v_staff.employment_status NOT IN ('active', 'on_leave') THEN
    RAISE EXCEPTION 'timeclock: inactive_staff' USING ERRCODE = '22023';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.timeclock_credentials WHERE organization_id = v_staff.organization_id AND staff_id = p_staff_id) INTO v_exists;

  IF p_mode = 'create' THEN
    IF v_exists THEN
      RAISE EXCEPTION 'timeclock: credential exists' USING ERRCODE = '23505';
    END IF;
    IF v_number !~ '^[A-Z0-9-]{1,20}$' OR p_pin !~ '^[0-9]{6}$' THEN
      RAISE EXCEPTION 'timeclock: invalid employee number or PIN' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.timeclock_credentials WHERE organization_id = v_staff.organization_id AND employee_number = v_number) THEN
      RAISE EXCEPTION 'timeclock: employee_number_taken' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.timeclock_credentials (organization_id, staff_id, employee_number, pin_hash, pin_set_by, pin_set_at)
    VALUES (v_staff.organization_id, p_staff_id, v_number, crypt(p_pin, gen_salt('bf', 10)), v_uid, clock_timestamp());
    v_event := 'credential_set';
  ELSE
    IF NOT v_exists THEN
      RAISE EXCEPTION 'timeclock: no credential' USING ERRCODE = 'P0002';
    END IF;
    IF p_mode = 'set_number' THEN
      IF v_number !~ '^[A-Z0-9-]{1,20}$' THEN
        RAISE EXCEPTION 'timeclock: invalid employee number' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.timeclock_credentials WHERE organization_id = v_staff.organization_id AND employee_number = v_number AND staff_id <> p_staff_id) THEN
        RAISE EXCEPTION 'timeclock: employee_number_taken' USING ERRCODE = '23505';
      END IF;
      UPDATE public.timeclock_credentials SET employee_number = v_number
      WHERE organization_id = v_staff.organization_id AND staff_id = p_staff_id;
      v_event := 'employee_number_set';
    ELSIF p_mode = 'set_pin' THEN
      IF p_pin !~ '^[0-9]{6}$' THEN
        RAISE EXCEPTION 'timeclock: invalid PIN' USING ERRCODE = '22023';
      END IF;
      UPDATE public.timeclock_credentials
      SET pin_hash = crypt(p_pin, gen_salt('bf', 10)), pin_set_by = v_uid, pin_set_at = clock_timestamp(),
          failed_attempts = 0, locked_until = NULL
      WHERE organization_id = v_staff.organization_id AND staff_id = p_staff_id;
      v_event := 'pin_reset';
    ELSIF p_mode = 'set_badge' THEN
      IF p_badge_lookup_hmac IS NULL OR p_badge_lookup_hmac !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'timeclock: invalid badge key' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.timeclock_credentials WHERE organization_id = v_staff.organization_id AND badge_lookup_hmac = p_badge_lookup_hmac AND staff_id <> p_staff_id) THEN
        RAISE EXCEPTION 'timeclock: badge_taken' USING ERRCODE = '23505';
      END IF;
      UPDATE public.timeclock_credentials SET badge_lookup_hmac = p_badge_lookup_hmac, badge_set_at = clock_timestamp()
      WHERE organization_id = v_staff.organization_id AND staff_id = p_staff_id;
      v_event := 'badge_registered';
    ELSE
      UPDATE public.timeclock_credentials SET badge_lookup_hmac = NULL, badge_set_at = NULL
      WHERE organization_id = v_staff.organization_id AND staff_id = p_staff_id;
      v_event := 'badge_cleared';
    END IF;
  END IF;

  PERFORM haven.timeclock_audit('timeclock_credentials', p_staff_id, CASE WHEN p_mode = 'create' THEN 'INSERT' ELSE 'UPDATE' END,
    v_event, v_uid, v_staff.organization_id, v_staff.facility_id);
  RETURN public.timeclock_credential_status(p_staff_id);
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_set_credentials(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_set_credentials(uuid, text, text, text, text) TO authenticated;
COMMENT ON FUNCTION public.timeclock_set_credentials(uuid, text, text, text, text) IS
  'Creates or updates a staff member''s kiosk credential: employee number, bcrypt PIN, badge lookup key. Refuses staff that are not active or on leave. COL-37 ruling: definer required -- timeclock_credentials holds no request-role grant so hashes are write-only from the app; the body checks auth.uid(), haven.app_role() in (owner, org_admin, facility_admin), the organization and haven.accessible_facility_ids() first.';

CREATE OR REPLACE FUNCTION public.timeclock_unlock_credential(p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_staff record;
BEGIN
  SELECT id, organization_id, facility_id INTO v_staff FROM public.staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'timeclock: staff not found' USING ERRCODE = 'P0002';
  END IF;
  v_uid := haven.timeclock_assert_manager(v_staff.facility_id, ARRAY['owner', 'org_admin', 'facility_admin']);
  IF v_staff.organization_id <> haven.organization_id() THEN
    RAISE EXCEPTION 'timeclock: forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.timeclock_credentials SET failed_attempts = 0, locked_until = NULL
  WHERE organization_id = v_staff.organization_id AND staff_id = p_staff_id;
  PERFORM haven.timeclock_audit('timeclock_credentials', p_staff_id, 'UPDATE', 'credential_unlocked', v_uid, v_staff.organization_id, v_staff.facility_id);
  RETURN public.timeclock_credential_status(p_staff_id);
END;
$$;
REVOKE ALL ON FUNCTION public.timeclock_unlock_credential(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_unlock_credential(uuid) TO authenticated;
COMMENT ON FUNCTION public.timeclock_unlock_credential(uuid) IS
  'Clears a PIN lockout early. COL-37 ruling: definer required -- timeclock_credentials holds no request-role grant; the body checks auth.uid(), haven.app_role(), the organization and haven.accessible_facility_ids() first.';

NOTIFY pgrst, 'reload schema';
