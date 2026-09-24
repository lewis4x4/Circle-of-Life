-- Workforce prerequisites: retain the already installed 494/495 identities and
-- reconcile the reviewed floor hardening applied in staging after those files.
-- Canonical source: COL-677 ccd795b3 + c26af4a73e611c616891f9f171765e937b9f00f8.
-- This migration does not enable timeclock, enroll/revoke devices, activate the
-- publisher, change its secrets, or deploy the separate floor application.
BEGIN;

-- Preserve existing staging counters; a fresh production install starts at zero.
ALTER TABLE public.timeclock_devices
  ADD COLUMN IF NOT EXISTS visitor_failure_count integer NOT NULL DEFAULT 0 CHECK (visitor_failure_count >= 0),
  ADD COLUMN IF NOT EXISTS visitor_failure_window_started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS visitor_throttled_until timestamptz NULL;

-- IF NOT EXISTS must not silently accept an incompatible prior definition.
DO $visitor_schema$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('visitor_failure_count','integer'::regtype,true,'0'::text),
      ('visitor_failure_window_started_at','timestamp with time zone'::regtype,false,NULL::text),
      ('visitor_throttled_until','timestamp with time zone'::regtype,false,NULL::text)
    ) expected(name,type_oid,required,default_expression)
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid='public.timeclock_devices'::regclass AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attnum IS NULL OR a.atttypid IS DISTINCT FROM expected.type_oid
      OR a.attnotnull IS DISTINCT FROM expected.required
      OR pg_catalog.pg_get_expr(d.adbin,d.adrelid) IS DISTINCT FROM expected.default_expression
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid='public.timeclock_devices'::regclass AND c.conname='timeclock_devices_visitor_failure_count_check'
      AND c.contype='c' AND c.convalidated
      AND pg_catalog.pg_get_constraintdef(c.oid)='CHECK ((visitor_failure_count >= 0))'
  ) THEN RAISE EXCEPTION 'Existing visitor throttle schema differs from the reviewed definition'; END IF;
END $visitor_schema$;

CREATE OR REPLACE FUNCTION haven.visitor_kiosk_note_failure(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_dev record;
BEGIN
  UPDATE public.timeclock_devices
  SET visitor_failure_window_started_at = CASE
        WHEN visitor_failure_window_started_at IS NULL OR visitor_failure_window_started_at < v_now - interval '10 minutes' THEN v_now
        ELSE visitor_failure_window_started_at END,
      visitor_failure_count = CASE
        WHEN visitor_failure_window_started_at IS NULL OR visitor_failure_window_started_at < v_now - interval '10 minutes' THEN 1
        ELSE visitor_failure_count + 1 END
  WHERE id = p_device_id
  RETURNING id, organization_id, facility_id, visitor_failure_count INTO v_dev;
  IF v_dev.visitor_failure_count >= 20 THEN
    UPDATE public.timeclock_devices
    SET visitor_throttled_until = v_now + interval '5 minutes', visitor_failure_count = 0, visitor_failure_window_started_at = NULL
    WHERE id = p_device_id;
    PERFORM haven.timeclock_audit('timeclock_devices', v_dev.id, 'UPDATE', 'visitor_kiosk_throttled', NULL, v_dev.organization_id, v_dev.facility_id);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION haven.visitor_kiosk_note_failure(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.visitor_kiosk_throttled(p_device_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.timeclock_devices d WHERE d.id = p_device_id AND d.visitor_throttled_until > clock_timestamp())
$$;
REVOKE ALL ON FUNCTION haven.visitor_kiosk_throttled(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.visitor_kiosk_sign_out(p_device_token text, p_entry_id uuid)
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
  IF haven.visitor_kiosk_throttled(v_dev.id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_throttled');
  END IF;
  SELECT * INTO e FROM public.visitor_log_entries
  WHERE id = p_entry_id AND organization_id = v_dev.organization_id AND facility_id = v_dev.facility_id
    AND deleted_at IS NULL AND voided_at IS NULL AND checked_in_at >= now() - interval '24 hours'
  FOR UPDATE;
  -- Misses count toward the visitor throttle, so the sign-out endpoint cannot
  -- be walked to learn who is in the building.
  IF NOT FOUND THEN
    PERFORM haven.visitor_kiosk_note_failure(v_dev.id);
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF e.checked_out_at IS NOT NULL THEN
    PERFORM haven.visitor_kiosk_note_failure(v_dev.id);
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

CREATE OR REPLACE FUNCTION haven.observation_clock_in_lead (p_facility_id uuid)
  RETURNS interval
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    make_interval(mins => COALESCE((
        SELECT
          t.rounding_clock_in_lead_minutes
        FROM public.timeclock_facility_settings t
        WHERE
          t.facility_id = p_facility_id), 30));
$func$;
REVOKE ALL ON FUNCTION haven.observation_clock_in_lead (uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.observation_clock_in_lead (uuid) IS
  'COL-693: timeclock_facility_settings.rounding_clock_in_lead_minutes as an interval (default 30 minutes when the facility has no settings row). Before a shift start it is how early a clock-in still counts as clocking in for that shift; after the start it is the handoff grace. Private helper.';

CREATE OR REPLACE FUNCTION haven.observation_shift_owner_staff (p_facility_id uuid, p_at timestamptz, p_shift_starts_at timestamptz)
  RETURNS TABLE (
    staff_id uuid)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH on_clock AS (
    SELECT
      c.staff_id,
      c.clocked_in_at
    FROM
      haven.observation_on_clock_staff (p_facility_id, p_at) c
),
lead AS (
  SELECT
    haven.observation_clock_in_lead (p_facility_id) AS lead_time
),
this_shift AS (
  SELECT
    c.staff_id
  FROM
    on_clock c,
    lead l
  WHERE
    c.clocked_in_at >= p_shift_starts_at - l.lead_time
)
SELECT
  t.staff_id
FROM
  this_shift t
UNION ALL
SELECT
  c.staff_id
FROM
  on_clock c,
  lead l
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      this_shift)
  AND p_at >= p_shift_starts_at + l.lead_time;
$func$;
REVOKE ALL ON FUNCTION haven.observation_shift_owner_staff (uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.observation_shift_owner_staff (uuid, timestamptz, timestamptz) IS
  'COL-693: the eligible on-clock staff who clocked in for the shift that starts at p_shift_starts_at (opening in punch no earlier than the start less timeclock_facility_settings.rounding_clock_in_lead_minutes, default 30). When nobody did: no rows while p_at is inside the handoff grace (before the start plus the same lead minutes), so the checks wait for the relief; after the grace, every eligible person on the clock (a double shift). Keeps the outgoing shift, still clocked in at a handoff, from owning the incoming shift''s checks. Private helper.';

CREATE OR REPLACE FUNCTION haven.resolve_observation_task_assignees_at (p_facility_id uuid, p_shift_service_date date, p_roster_shift_type text, p_resident_ids uuid[], p_at timestamptz)
  RETURNS TABLE (
    resident_id uuid,
    shift_assignment_id uuid,
    staff_id uuid,
    assignment_source text)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH scheduled AS (
    SELECT
      sa.id,
      sa.staff_id,
      sa.assigned_resident_ids
    FROM
      public.shift_assignments sa
    WHERE
      sa.facility_id = p_facility_id
      AND sa.shift_date = p_shift_service_date
      AND sa.shift_type = p_roster_shift_type::public.shift_type
      AND sa.status IN ('assigned', 'confirmed')
      AND sa.deleted_at IS NULL
),
split AS (
  SELECT DISTINCT ON (r.resident_id)
    r.resident_id,
    s.id AS shift_assignment_id,
    s.staff_id
  FROM
    unnest(p_resident_ids) AS r (resident_id)
    JOIN scheduled s ON r.resident_id = ANY (s.assigned_resident_ids)
  ORDER BY
    r.resident_id,
    s.id
),
roster AS (
  SELECT DISTINCT ON (s.staff_id)
    s.id,
    s.staff_id
  FROM
    scheduled s
  ORDER BY
    s.staff_id,
    s.id
),
ring AS (
  SELECT
    r.id,
    r.staff_id,
    row_number() OVER (ORDER BY r.staff_id, r.id) - 1 AS ring_position,
    count(*) OVER () AS ring_size
  FROM
    roster r
),
-- Which shift is being resolved, relative to the instant: the one in progress,
-- the one after it, or neither (a past shift, or a date the caller chose).
phase AS (
  SELECT
    (
      SELECT
        cur.starts_at_utc
      FROM
        public.facility_shift_window_at (p_facility_id, p_at) cur
      WHERE
        cur.shift_service_date = p_shift_service_date
        AND cur.roster_shift_type::text = p_roster_shift_type) AS current_starts_at,
    EXISTS (
      SELECT
        1
      FROM
        public.facility_next_shift_window (p_facility_id, p_at) nxt
      WHERE
        nxt.shift_service_date = p_shift_service_date
        AND nxt.roster_shift_type::text = p_roster_shift_type) AS is_next,
    EXISTS (
      SELECT
        1
      FROM
        public.timeclock_facility_settings t
      WHERE
        t.facility_id = p_facility_id
        AND t.timeclock_enabled) AS staffs_from_punches,
    haven.observation_clock_in_lead (p_facility_id) AS lead_time
),
clock_ring AS (
  SELECT
    c.staff_id,
    row_number() OVER (ORDER BY c.staff_id) - 1 AS ring_position,
    count(*) OVER () AS ring_size
  FROM
    phase ph
    CROSS JOIN LATERAL haven.observation_shift_owner_staff (p_facility_id, p_at, ph.current_starts_at) c
  WHERE
    ph.current_starts_at IS NOT NULL
    AND NOT EXISTS (
      SELECT
        1
      FROM
        scheduled)
)
SELECT
  r.resident_id,
  COALESCE(sp.shift_assignment_id, fallback.id) AS shift_assignment_id,
  COALESCE(sp.staff_id, fallback.staff_id, punched.staff_id) AS staff_id,
  CASE WHEN sp.staff_id IS NOT NULL THEN
    'resident_split'
  WHEN fallback.staff_id IS NOT NULL THEN
    'shift_roster'
  WHEN punched.staff_id IS NOT NULL THEN
    'on_clock'
  WHEN (ph.is_next
      OR p_at < ph.current_starts_at + ph.lead_time)
    AND ph.staffs_from_punches THEN
    'awaiting_clock_in'
  ELSE
    'none_scheduled'
  END AS assignment_source
FROM
  unnest(p_resident_ids) AS r (resident_id)
  CROSS JOIN phase ph
  LEFT JOIN split sp ON sp.resident_id = r.resident_id
  LEFT JOIN LATERAL (
    SELECT
      g.id,
      g.staff_id
    FROM
      ring g
    WHERE
      sp.staff_id IS NULL
      AND g.ring_position = ((hashtextextended(r.resident_id::text, 0) % g.ring_size) + g.ring_size) % g.ring_size) fallback ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      c.staff_id
    FROM
      clock_ring c
    WHERE
      sp.staff_id IS NULL
      AND fallback.staff_id IS NULL
      AND c.ring_position = ((hashtextextended(r.resident_id::text, 0) % c.ring_size) + c.ring_size) % c.ring_size) punched ON TRUE
ORDER BY
  r.resident_id;
$func$;
REVOKE ALL ON FUNCTION haven.resolve_observation_task_assignees_at (uuid, date, text, uuid[], timestamptz) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.resolve_observation_task_assignees_at (uuid, date, text, uuid[], timestamptz) IS
  'COL-693: the rounding owner chain at an instant -- resident_split, shift_roster, on_clock (shift in progress, nobody scheduled, eligible staff on the clock -- preferring those who clocked in for this shift -- stable hash ring), awaiting_clock_in (next shift, nobody scheduled, facility staffs from punches), else none_scheduled. Private; called by public.resolve_observation_task_assignees and public.assign_unowned_observation_tasks.';

CREATE OR REPLACE FUNCTION haven.observation_shift_staffing_state (p_facility_id uuid, p_shift_key text, p_service_date date, p_at timestamptz)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    CASE WHEN NOT EXISTS (
      SELECT
        1
      FROM
        public.timeclock_facility_settings t
      WHERE
        t.facility_id = p_facility_id
        AND t.timeclock_enabled) THEN
      'not_from_punches'
    WHEN cur.starts_at_utc IS NOT NULL THEN
      CASE WHEN EXISTS (
        SELECT
          1
        FROM
          haven.observation_shift_owner_staff (p_facility_id, p_at, cur.starts_at_utc)) THEN
        'staffed'
      WHEN p_at < cur.starts_at_utc + haven.observation_clock_in_lead (p_facility_id) THEN
        'awaiting_clock_in'
      ELSE
        'unstaffed'
      END
    WHEN EXISTS (
      SELECT
        1
      FROM
        public.facility_next_shift_window (p_facility_id, p_at) nxt
      WHERE
        nxt.shift_key = p_shift_key
        AND nxt.shift_service_date = p_service_date) THEN
      'awaiting_clock_in'
    ELSE
      'not_from_punches'
    END
  FROM (
    SELECT
      (
        SELECT
          c.starts_at_utc
        FROM
          public.facility_shift_window_at (p_facility_id, p_at) c
        WHERE
          c.shift_key = p_shift_key
          AND c.shift_service_date = p_service_date) AS starts_at_utc) cur;
$func$;
REVOKE ALL ON FUNCTION haven.observation_shift_staffing_state (uuid, text, date, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.observation_shift_staffing_state (uuid, text, date, timestamptz) IS
  'COL-693: whether a shift at a facility that staffs from punches is staffed at an instant: staffed, awaiting_clock_in (next shift, or shift in progress inside its handoff grace with nobody clocked in for it), unstaffed, or not_from_punches (timeclock off, or a shift that is neither current nor next). record_observation_staffing_gap raises nothing for staffed or awaiting_clock_in; resolve_observation_staffing_gap resolves only for staffed. Private helper.';

CREATE OR REPLACE FUNCTION public.record_observation_staffing_gap (p_facility_id uuid, p_shift_key text, p_service_date date)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_facility record;
  v_title text;
  v_recorded integer := 0;
  v_staffs_from_punches boolean;
BEGIN
  SELECT
    f.id,
    f.organization_id,
    f.entity_id,
    f.name INTO v_facility
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_facility.id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT
    EXISTS (
      SELECT
        1
      FROM
        public.timeclock_facility_settings t
      WHERE
        t.organization_id = v_facility.organization_id
        AND t.facility_id = p_facility_id
        AND t.timeclock_enabled) INTO v_staffs_from_punches;

  -- Staffed from the clock, or not a gap yet (the next shift, or the shift in
  -- progress inside its handoff grace with nobody clocked in for it).
  IF v_staffs_from_punches AND haven.observation_shift_staffing_state (p_facility_id, p_shift_key, p_service_date, now()) IN ('staffed', 'awaiting_clock_in') THEN
    RETURN FALSE;
  END IF;

  v_title := haven.observation_staffing_gap_title (p_facility_id, p_shift_key, p_service_date);

  INSERT INTO public.exec_alerts (organization_id, entity_id, facility_id, source_module, severity, title, body)
  SELECT
    v_facility.organization_id,
    v_facility.entity_id,
    v_facility.id,
    'staff',
    'warning',
    v_title,
    CASE WHEN v_staffs_from_punches THEN
      'Observation checks were generated for this shift and there is no staff member on the schedule or on the clock to own them. Nobody was invented as the assignee, so these checks are completable only by a med tech or an administrator until somebody clocks in at the front door or the schedule is filled in.'
    ELSE
      'Observation checks were generated for this shift and there is no staff member on the schedule to own them. Nobody was invented as the assignee, so these checks are completable only by a med tech or an administrator until the schedule is filled in. Open the schedule for this facility and this date.'
    END
  WHERE
    NOT EXISTS (
      SELECT
        1
      FROM
        public.exec_alerts existing
      WHERE
        existing.organization_id = v_facility.organization_id
        AND existing.facility_id = v_facility.id
        AND existing.title = v_title
        AND existing.resolved_at IS NULL
        AND existing.deleted_at IS NULL);

  GET DIAGNOSTICS v_recorded = ROW_COUNT;
  RETURN v_recorded > 0;
END;
$func$;
REVOKE ALL ON FUNCTION public.record_observation_staffing_gap (uuid, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_observation_staffing_gap (uuid, text, date) TO service_role;
COMMENT ON FUNCTION public.record_observation_staffing_gap (uuid, text, date) IS
  'Records an open exec_alerts row naming a facility, a shift and a service date for which observation tasks were generated and no staff member is scheduled to own them. COL-693: at a facility whose timeclock is enabled, nothing is raised while haven.observation_shift_staffing_state is staffed (the shift in progress has on-clock owners) or awaiting_clock_in (the next shift, or the shift in progress inside its handoff grace with nobody clocked in for it); both return false. Idempotent against an unresolved alert with the same title, so a cron that ticks every few minutes raises the gap once. COL-37 ruling: definer required, because the task generator writes an executive alert on behalf of nobody and has no caller authority to inherit, and the on-clock check reads the private timeclock ledgers. Execute is granted to service_role only.';

CREATE OR REPLACE FUNCTION public.resolve_observation_staffing_gap (p_facility_id uuid, p_shift_key text, p_service_date date)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_resolved integer := 0;
BEGIN
  -- Staffed means: the facility staffs from punches, the named shift is the
  -- one in progress, and it has on-clock owners (the outgoing shift counts
  -- only once the handoff grace is over).
  IF haven.observation_shift_staffing_state (p_facility_id, p_shift_key, p_service_date, now()) IS DISTINCT FROM 'staffed' THEN
    RETURN FALSE;
  END IF;

  UPDATE
    public.exec_alerts e
  SET
    resolved_at = now(),
    status = 'resolved',
    last_evaluated_at = now(),
    current_value_json = COALESCE(e.current_value_json, '{}'::jsonb) || jsonb_build_object('resolved_reason', 'on_clock_staff', 'resolution_note', 'Resolved automatically: a staff member who can own observation checks clocked in for this shift, and the unowned checks were assigned on the next run.')
  WHERE
    e.facility_id = p_facility_id
    AND e.organization_id = (
      SELECT
        f.organization_id
      FROM
        public.facilities f
      WHERE
        f.id = p_facility_id)
    AND e.title = haven.observation_staffing_gap_title (p_facility_id, p_shift_key, p_service_date)
    AND e.resolved_at IS NULL
    AND e.deleted_at IS NULL;

  GET DIAGNOSTICS v_resolved = ROW_COUNT;
  RETURN v_resolved > 0;
END;
$func$;
REVOKE ALL ON FUNCTION public.resolve_observation_staffing_gap (uuid, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_observation_staffing_gap (uuid, text, date) TO service_role;
COMMENT ON FUNCTION public.resolve_observation_staffing_gap (uuid, text, date) IS
  'COL-693: resolves the open "Nobody is scheduled" exec alert for a facility, shift and service date when haven.observation_shift_staffing_state says that shift is staffed: in progress at a facility whose timeclock is enabled, with on-clock owners (the outgoing shift counts only after the handoff grace). Sets resolved_at, status resolved and a resolution note in current_value_json; returns true when an alert was resolved. Does nothing otherwise, so a genuine gap stays open. De-duplication of record_observation_staffing_gap is unchanged. COL-37 ruling: definer required -- the task generator resolves an executive alert on behalf of nobody and the on-clock check reads the private timeclock ledgers; execute is granted to service_role only.';

NOTIFY pgrst, 'reload schema';
COMMIT;
