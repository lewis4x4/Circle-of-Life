-- Smart Rounding: the commands that let an administrator change the observation
-- schedule without a migration, a deploy, or a developer.
--
-- Spec: docs/specs/25A-smart-rounding-cadence-and-watchlist.md section 6,
-- acceptance items 15 to 21.
--
-- Seven commands, plus the reads the settings surface needs so that no
-- observation time, grace value, escalation offset, recipient, channel, shift
-- boundary, threshold or lookback span has to appear in a TypeScript file:
--
--   public.create_cadence_version          propose a change
--   public.activate_cadence_version        put it in force
--   public.rollback_cadence_version        copy an earlier version forward
--   public.apply_template_to_facilities    fan a template out
--   public.validate_cadence_version        the six hard blocks and four warnings
--   public.simulate_cadence_change         replay against what actually happened
--   public.send_test_escalation            already shipped by migration 417, unchanged
--
-- The one invariant this whole module rests on
-- -------------------------------------------------------------------------
-- public.facility_cadence_in_force resolves by status IN ('active',
-- 'superseded') ordered by effective_from descending. That is only correct if
-- supersession closes the outgoing version's effective_to at exactly the
-- instant the incoming one opens. A gap makes a past date answer from no
-- version; an overlap makes it answer from the wrong one, which is a past
-- compliance report silently recomputed against a cadence that was never in
-- force, and that is the single failure this versioning scheme exists to
-- prevent.
--
-- The invariant therefore lives in exactly one function,
-- haven.apply_observation_config_activation, and every path that activates
-- anything goes through it: the operator command, the rollback, the template
-- fan out and the scheduled activator. It closes the outgoing version before it
-- opens the incoming one, because the gist exclusion constraint added by
-- migrations 414 and 417 rejects the other order outright. That constraint is
-- the floor and not the ceiling: it cannot tell a backwards activation from a
-- forwards one, and it cannot refuse to move the effective_from of a version
-- that has already generated a task. Those two refusals are written out here.
--
-- Role gates read haven.app_role(), which is the app_role enum. Spec 6.12 says
-- assistant_administrator; that value exists only in staff_role, and the
-- authentication enum carries manager in that position, so every gate below
-- says manager. Recipient targeting still goes through
-- notification_routes.staff_role_targets and does use assistant_administrator.
--
-- No named person appears here. No resident identifying data appears here. No
-- regulatory floor is invented here: the floor check reads
-- public.jurisdiction_observation_floors and a null floor passes.

BEGIN;

-- ---------------------------------------------------------------------------
-- Permission helpers, defined once so five commands cannot drift apart
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.can_edit_observation_config (p_facility_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = haven, pg_catalog
  AS $func$
  SELECT haven.app_role ()::text IN ('owner', 'org_admin')
    AND haven.has_facility_access (p_facility_id);
$func$;

COMMENT ON FUNCTION haven.can_edit_observation_config (uuid) IS
  'True when the caller may put an observation cadence or escalation change in force at this facility. Spec 25A 6.12: org_admin and owner. A cadence change is policy for an entire building and does not happen without the organization signing off.';

CREATE OR REPLACE FUNCTION haven.can_propose_observation_config (p_facility_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = haven, pg_catalog
  AS $func$
  SELECT haven.app_role ()::text IN ('owner', 'org_admin', 'facility_admin', 'manager')
    AND haven.has_facility_access (p_facility_id);
$func$;

COMMENT ON FUNCTION haven.can_propose_observation_config (uuid) IS
  'True when the caller may propose an observation cadence or escalation change at this facility. Spec 25A 6.12: facility_admin and manager propose, creating a pending_approval version. manager is where the spec says assistant_administrator, which is a staff_role and not an app_role.';

CREATE OR REPLACE FUNCTION haven.can_read_observation_config (p_facility_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = haven, pg_catalog
  AS $func$
  SELECT haven.app_role ()::text IN ('owner', 'org_admin', 'facility_admin', 'manager')
    AND haven.has_facility_access (p_facility_id);
$func$;

COMMENT ON FUNCTION haven.can_read_observation_config (uuid) IS
  'True when the caller may read the observation configuration, the preview, the simulation and the change log at this facility. Spec 25A 6.12: facility_admin and above.';

REVOKE ALL ON FUNCTION haven.can_edit_observation_config (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.can_edit_observation_config (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION haven.can_propose_observation_config (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.can_propose_observation_config (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION haven.can_read_observation_config (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.can_read_observation_config (uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The jurisdiction floor that applies to one building
--
-- Resolved by state code against public.facilities.state, so which regulator
-- applies to a building is data rather than a branch in a function body. A
-- building in a state with no row has no floor, which passes; a row whose
-- numbers are null also passes, and the surface says which of the two it is.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.facility_observation_jurisdiction_floor (p_facility_id uuid, p_on date DEFAULT CURRENT_DATE)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    COALESCE(jsonb_build_object('jurisdiction_key', j.jurisdiction_key, 'label', j.label, 'minimum_windows_per_24h', j.minimum_windows_per_24h, 'maximum_unobserved_gap_minutes', j.maximum_unobserved_gap_minutes, 'citation_reference', j.citation_reference, 'floor_values_pending', j.floor_values_pending, 'pending_note', j.pending_note), jsonb_build_object('jurisdiction_key', NULL, 'label', NULL, 'minimum_windows_per_24h', NULL, 'maximum_unobserved_gap_minutes', NULL, 'citation_reference', NULL, 'floor_values_pending', FALSE, 'pending_note', 'No jurisdiction floor row covers this building''s state on this date.'))
  FROM
    public.facilities f
    LEFT JOIN public.jurisdiction_observation_floors j ON j.state_code = f.state
      AND j.deleted_at IS NULL
      AND j.effective_from <= p_on
      AND (j.effective_to IS NULL OR j.effective_to >= p_on)
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL
  ORDER BY
    j.effective_from DESC NULLS LAST
  LIMIT 1;
$func$;

COMMENT ON FUNCTION public.facility_observation_jurisdiction_floor (uuid, date) IS
  'The regulator minimum that applies to one building on one date, resolved by state code. Null numbers mean no verified floor and the floor check passes; floor_values_pending distinguishes "not yet supplied" from "no floor exists", which are different facts.';

REVOKE ALL ON FUNCTION public.facility_observation_jurisdiction_floor (uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_observation_jurisdiction_floor (uuid, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The shape of one cadence version's 24 hours
--
-- Everything the preview strip draws and everything the validation measures:
-- each window as minutes from local midnight, which of them overlap, how many
-- there are, and the largest span in which nobody looks at the resident.
--
-- Minutes rather than clock strings, so the surface can draw the strip without
-- carrying a time of its own. opens_minute may be negative and closes_minute
-- may exceed 1440 where a window's grace crosses midnight; the strip draws
-- modulo 1440 and the overlap arithmetic below handles the wrap directly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cadence_version_day_shape (p_cadence_version_id uuid)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH win AS (
    SELECT
      w.window_key,
      w.label,
      w.shift_key,
      w.enabled,
      w.sort_order,
      w.grace_before_minutes,
      w.grace_after_minutes,
      (extract(hour FROM w.due_at_local)::integer * 60 + extract(minute FROM w.due_at_local)::integer) AS due_minute
    FROM
      public.facility_cadence_windows w
    WHERE
      w.cadence_version_id = p_cadence_version_id
      AND w.deleted_at IS NULL
),
span AS (
  SELECT
    win.*,
    win.due_minute - win.grace_before_minutes AS opens_minute,
    win.due_minute + win.grace_after_minutes AS closes_minute
  FROM
    win
),
-- Two enabled windows overlap when their grace spans intersect. The day wraps,
-- so each pair is tested against the other shifted a day back and a day
-- forward as well: a 23:30 window with an hour of grace after it overlaps a
-- 00:15 window on the following calendar day, and on a repeating schedule that
-- is the same collision.
overlap AS (
  SELECT
    a.window_key,
    b.window_key AS other_window_key,
    b.label AS other_label
  FROM
    span a
    JOIN span b ON b.window_key <> a.window_key
    CROSS JOIN LATERAL (
      VALUES (-1440), (0), (1440)) AS d (day_shift)
  WHERE
    a.enabled
    AND b.enabled
    AND a.opens_minute < b.closes_minute + d.day_shift
    AND b.opens_minute + d.day_shift < a.closes_minute
),
enabled_span AS (
  SELECT
    opens_minute,
    closes_minute
  FROM
    span
  WHERE
    enabled
),
gap AS (
  SELECT
    closes_minute AS gap_starts_minute,
    COALESCE(lead(opens_minute) OVER (ORDER BY opens_minute), min(opens_minute) OVER () + 1440) AS gap_ends_minute
  FROM
    enabled_span
),
widest AS (
  SELECT
    gap_starts_minute,
    gap_ends_minute,
    gap_ends_minute - gap_starts_minute AS gap_minutes
  FROM
    gap
  ORDER BY
    gap_ends_minute - gap_starts_minute DESC,
    gap_starts_minute
  LIMIT 1
)
SELECT
  jsonb_build_object('cadence_version_id', p_cadence_version_id, 'windows_per_day', (
      SELECT
        count(*)
      FROM
        span
      WHERE
        enabled), 'largest_unobserved_gap_minutes', COALESCE((
      SELECT
        gap_minutes
      FROM widest), 1440), 'largest_gap_starts_minute', (
    SELECT
      gap_starts_minute
    FROM widest), 'largest_gap_ends_minute', (
    SELECT
      gap_ends_minute
    FROM widest), 'has_overlap', EXISTS (
    SELECT
      1
    FROM
      overlap), 'windows', COALESCE((
      SELECT
        jsonb_agg (jsonb_build_object('window_key', s.window_key, 'label', s.label, 'shift_key', s.shift_key, 'enabled', s.enabled, 'due_minute', s.due_minute, 'opens_minute', s.opens_minute, 'closes_minute', s.closes_minute, 'grace_before_minutes', s.grace_before_minutes, 'grace_after_minutes', s.grace_after_minutes, 'overlaps_window_keys', COALESCE((
              SELECT
                jsonb_agg (DISTINCT o.other_window_key)
              FROM overlap o
              WHERE
                o.window_key = s.window_key), '[]'::jsonb))
          ORDER BY s.sort_order, s.due_minute)
      FROM span s), '[]'::jsonb));
$func$;

COMMENT ON FUNCTION public.cadence_version_day_shape (uuid) IS
  'One cadence version''s 24 hours, as minutes from facility local midnight: every window with its grace span, which windows overlap, how many enabled windows there are and the largest span in which nobody looks at the resident. The single place the strip and the validation get their geometry, so neither the settings surface nor the validation carries a time.';

REVOKE ALL ON FUNCTION public.cadence_version_day_shape (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cadence_version_day_shape (uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The next shift boundary
--
-- Read from facility_shift_definitions through the shift resolver migration 414
-- already owns, so the default effective timing carries no boundary of its own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.facility_next_shift_boundary_at (p_facility_id uuid, p_at timestamptz DEFAULT now())
  RETURNS timestamptz
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    sw.ends_at_utc
  FROM
    public.facility_shift_window_at (p_facility_id, p_at) sw;
$func$;

COMMENT ON FUNCTION public.facility_next_shift_boundary_at (uuid, timestamptz) IS
  'The instant the shift running at p_at ends, which is the start of the next one. The default effective_from for a cadence or escalation change, per spec 25A 6.4. Returns null when the building has no shift model, and the activation command refuses rather than guessing a boundary.';

REVOKE ALL ON FUNCTION public.facility_next_shift_boundary_at (uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_next_shift_boundary_at (uuid, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Who holds each role a rung targets, at this building, right now
--
-- Spec 6.6 requires the preview to show recipient resolution per rung: the
-- roles, and how many people currently hold each at this facility. Spec 6.5's
-- third warning fires when a targeted role has zero holders.
--
-- Definer, because it reads public.staff across the building and a facility
-- administrator does not otherwise hold a row on every staff member. It returns
-- counts only: no name, no phone number and no email address ever leaves this
-- function, which is also why the preview can show it to anyone who can read
-- the configuration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.observation_escalation_role_holders (p_facility_id uuid, p_escalation_version_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT haven.can_read_observation_config (p_facility_id) THEN
    RAISE EXCEPTION 'Reading the escalation recipient resolution needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(jsonb_agg (entry ORDER BY sort_order, rung_key), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      r.sort_order,
      r.rung_key,
      jsonb_build_object('rung_key', r.rung_key, 'label', r.label, 'offset_minutes', r.offset_minutes, 'is_terminal', r.is_terminal, 'assigned_staff_only', r.assigned_staff_only, 'include_assigned_staff', r.include_assigned_staff, 'use_standing_alert_routes', r.use_standing_alert_routes, 'channels', to_jsonb (r.channels), 'enabled', r.enabled, 'standing_alert_route_count', (
          SELECT
            count(*)
          FROM
            public.notification_routes nr
          WHERE
            nr.facility_id = p_facility_id
            AND nr.is_active
            AND nr.deleted_at IS NULL), 'roles', COALESCE((
            SELECT
              jsonb_agg (jsonb_build_object('staff_role', role_name, 'holder_count', (
                    SELECT
                      count(*)
                    FROM
                      public.staff s
                    WHERE
                      s.facility_id = p_facility_id
                      AND s.staff_role = role_name
                      AND s.employment_status = 'active'
                      AND s.deleted_at IS NULL))
                ORDER BY role_name::text)
            FROM
              unnest(r.target_staff_roles) AS role_name), '[]'::jsonb)) AS entry
    FROM
      public.facility_escalation_rungs r
    WHERE
      r.escalation_version_id = p_escalation_version_id
      AND r.deleted_at IS NULL) rungs;

  RETURN v_result;
END;
$func$;

COMMENT ON FUNCTION public.observation_escalation_role_holders (uuid, uuid) IS
  'For every rung on one escalation version, the roles it targets and how many active staff members hold each of those roles at this building right now. Counts only: no name, no phone number and no email address leaves this function. COL-37 ruling: definer required, because it reads public.staff across the building and a facility administrator holds no row on every staff member. The body gates on haven.can_read_observation_config first and can write nothing.';

REVOKE ALL ON FUNCTION public.observation_escalation_role_holders (uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.observation_escalation_role_holders (uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.validate_cadence_version
--
-- Spec 6.5. Six hard blocks, each with its own message so a test can assert
-- them case by case, and four warnings that need a typed acknowledgment.
--
-- It returns the findings rather than raising on the first one, because a form
-- that reports one problem at a time makes an administrator submit six times to
-- discover six. public.activate_cadence_version calls it and raises the first
-- block verbatim, so the block cannot be enforced in the client only: refusing
-- in the browser and not in the database is how a configuration nobody
-- validated reaches a building through an API call.
--
-- Block 3 derives the shift start from public.facility_shift_definitions and
-- never from a hardcoded 06:00 or 18:00. A building that moves its shift change
-- to 07:00 gets the rule applied at 07:00 with no code change, which is the
-- whole point of the shift model being configuration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_cadence_version (p_cadence_version_id uuid DEFAULT NULL, p_escalation_version_id uuid DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_facility_id uuid;
  v_cadence_facility uuid;
  v_escalation_facility uuid;
  v_shape jsonb;
  v_current_shape jsonb;
  v_current_cadence uuid;
  v_floor jsonb;
  v_thresholds record;
  v_blocks jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_row record;
  v_windows_per_day integer := NULL;
  v_gap integer := NULL;
  v_current_windows_per_day integer := NULL;
BEGIN
  IF p_cadence_version_id IS NULL AND p_escalation_version_id IS NULL THEN
    RAISE EXCEPTION 'validate_cadence_version needs a cadence version, an escalation version, or both'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    v.facility_id INTO v_cadence_facility
  FROM
    public.facility_cadence_versions v
  WHERE
    v.id = p_cadence_version_id
    AND v.deleted_at IS NULL;

  SELECT
    v.facility_id INTO v_escalation_facility
  FROM
    public.facility_escalation_versions v
  WHERE
    v.id = p_escalation_version_id
    AND v.deleted_at IS NULL;

  IF p_cadence_version_id IS NOT NULL AND v_cadence_facility IS NULL THEN
    RAISE EXCEPTION 'Cadence version not found'
      USING ERRCODE = '22023';
  END IF;

  IF p_escalation_version_id IS NOT NULL AND v_escalation_facility IS NULL THEN
    RAISE EXCEPTION 'Escalation version not found'
      USING ERRCODE = '22023';
  END IF;

  IF v_cadence_facility IS NOT NULL AND v_escalation_facility IS NOT NULL AND v_cadence_facility <> v_escalation_facility THEN
    RAISE EXCEPTION 'The cadence version and the escalation version belong to different buildings and cannot be validated as one change'
      USING ERRCODE = '22023';
  END IF;

  v_facility_id := COALESCE(v_cadence_facility, v_escalation_facility);

  IF NOT haven.can_read_observation_config (v_facility_id) THEN
    RAISE EXCEPTION 'Validating an observation configuration needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    t.maximum_unobserved_gap_minutes,
    t.maximum_windows_per_resident_per_day INTO v_thresholds
  FROM
    public.facility_observation_thresholds t
  WHERE
    t.facility_id = v_facility_id
    AND t.deleted_at IS NULL;

  -- -----------------------------------------------------------------------
  -- Cadence blocks
  -- -----------------------------------------------------------------------
  IF p_cadence_version_id IS NOT NULL THEN
    v_shape := public.cadence_version_day_shape (p_cadence_version_id);
    v_windows_per_day := (v_shape ->> 'windows_per_day')::integer;
    v_gap := (v_shape ->> 'largest_unobserved_gap_minutes')::integer;

    -- Block 1. Two enabled windows whose grace spans overlap.
    FOR v_row IN
    SELECT DISTINCT
      least(w ->> 'window_key', other) AS a_key,
      greatest(w ->> 'window_key', other) AS b_key
    FROM
      jsonb_array_elements(v_shape -> 'windows') w
      CROSS JOIN LATERAL jsonb_array_elements_text(w -> 'overlaps_window_keys') AS o (other)
    WHERE
      (w ->> 'enabled')::boolean
    ORDER BY
      1,
      2 LOOP
        v_blocks := v_blocks || jsonb_build_object('code', 'overlapping_grace_spans', 'message', format('Two enabled windows overlap. %s and %s share time, so one observation would satisfy both windows and silently inflate compliance.', v_row.a_key, v_row.b_key));
      END LOOP;

    -- Block 2. Zero enabled windows on any defined shift.
    FOR v_row IN
    SELECT
      s.shift_key,
      s.label
    FROM
      public.facility_shift_definitions s
    WHERE
      s.facility_id = v_facility_id
      AND s.deleted_at IS NULL
      AND s.active
      AND NOT EXISTS (
        SELECT
          1
        FROM
          public.facility_cadence_windows w
        WHERE
          w.cadence_version_id = p_cadence_version_id
          AND w.deleted_at IS NULL
          AND w.enabled
          AND w.shift_key = s.shift_key)
      ORDER BY
        s.sort_order,
        s.shift_key LOOP
          v_blocks := v_blocks || jsonb_build_object('code', 'shift_without_window', 'message', format('The %s shift has no enabled observation window. Every defined shift must carry at least one check.', v_row.label));
        END LOOP;

    -- Block 3. grace_before_minutes above zero on a window whose due time is a
    -- shift start. Derived from the shift definitions, never from a hardcoded
    -- 06:00 or 18:00.
    FOR v_row IN
    SELECT
      w.window_key,
      w.label,
      w.grace_before_minutes,
      s.label AS shift_label
    FROM
      public.facility_cadence_windows w
      JOIN public.facility_shift_definitions s ON s.facility_id = v_facility_id
        AND s.deleted_at IS NULL
        AND s.active
        AND s.starts_at_local = w.due_at_local
    WHERE
      w.cadence_version_id = p_cadence_version_id
      AND w.deleted_at IS NULL
      AND w.enabled
      AND w.grace_before_minutes > 0
    ORDER BY
      w.sort_order,
      w.window_key LOOP
        v_blocks := v_blocks || jsonb_build_object('code', 'shift_start_grace_before', 'message', format('%s is due at the start of the %s shift and opens %s minutes early. The incoming shift must be the one that lays eyes on the resident, so grace before has to be zero on a window due at a shift start.', v_row.label, v_row.shift_label, v_row.grace_before_minutes));
      END LOOP;

    -- Block 6. Window frequency below the jurisdiction floor. A null floor
    -- passes; nothing here invents a number.
    v_floor := public.facility_observation_jurisdiction_floor (v_facility_id);

    IF (v_floor ->> 'minimum_windows_per_24h') IS NOT NULL AND v_windows_per_day < (v_floor ->> 'minimum_windows_per_24h')::integer THEN
      v_blocks := v_blocks || jsonb_build_object('code', 'below_jurisdiction_floor', 'message', format('%s enabled windows per 24 hours is below the %s floor of %s. The regulator minimum may not be configured away.', v_windows_per_day, v_floor ->> 'jurisdiction_key', v_floor ->> 'minimum_windows_per_24h'));
    ELSIF (v_floor ->> 'maximum_unobserved_gap_minutes') IS NOT NULL AND v_gap > (v_floor ->> 'maximum_unobserved_gap_minutes')::integer THEN
      v_blocks := v_blocks || jsonb_build_object('code', 'below_jurisdiction_floor', 'message', format('The largest unobserved gap of %s minutes exceeds the %s floor of %s minutes. The regulator minimum may not be configured away.', v_gap, v_floor ->> 'jurisdiction_key', v_floor ->> 'maximum_unobserved_gap_minutes'));
    END IF;
  END IF;

  -- -----------------------------------------------------------------------
  -- Escalation blocks
  -- -----------------------------------------------------------------------
  IF p_escalation_version_id IS NOT NULL THEN
    -- Block 4. Rung offsets not strictly increasing. Compared in sort order,
    -- because sort_order is also the escalation level written on the row, so a
    -- later rung that fires earlier records a higher level at an earlier time.
    FOR v_row IN
    SELECT
      prev_key,
      prev_offset,
      rung_key,
      offset_minutes
    FROM (
      SELECT
        r.rung_key,
        r.offset_minutes,
        lag(r.rung_key) OVER (ORDER BY r.sort_order, r.rung_key) AS prev_key,
        lag(r.offset_minutes) OVER (ORDER BY r.sort_order, r.rung_key) AS prev_offset
      FROM
        public.facility_escalation_rungs r
      WHERE
        r.escalation_version_id = p_escalation_version_id
        AND r.deleted_at IS NULL
        AND r.enabled) ordered
    WHERE
      prev_offset IS NOT NULL
      AND offset_minutes <= prev_offset LOOP
        v_blocks := v_blocks || jsonb_build_object('code', 'rung_offsets_not_increasing', 'message', format('Escalation rung offsets are not strictly increasing. %s fires at %s minutes and %s fires at %s minutes, so the later rung does not come later.', v_row.prev_key, v_row.prev_offset, v_row.rung_key, v_row.offset_minutes));
      END LOOP;

    -- Block 5. The terminal rung disabled. A version with no terminal rung at
    -- all is the same defect by another route and reads the same message.
    FOR v_row IN
    SELECT
      r.rung_key,
      r.label
    FROM
      public.facility_escalation_rungs r
    WHERE
      r.escalation_version_id = p_escalation_version_id
      AND r.deleted_at IS NULL
      AND r.is_terminal
      AND NOT r.enabled LOOP
        v_blocks := v_blocks || jsonb_build_object('code', 'terminal_rung_disabled', 'message', format('The terminal escalation rung %s is disabled. The last rung protocol may be rewritten but its existence may not be turned off.', v_row.label));
      END LOOP;

    IF NOT EXISTS (
      SELECT
        1
      FROM
        public.facility_escalation_rungs r
      WHERE
        r.escalation_version_id = p_escalation_version_id
        AND r.deleted_at IS NULL
        AND r.is_terminal) THEN
      v_blocks := v_blocks || jsonb_build_object('code', 'terminal_rung_disabled', 'message', 'The terminal escalation rung is missing. The last rung protocol may be rewritten but its existence may not be turned off.');
    END IF;
  END IF;

  -- -----------------------------------------------------------------------
  -- Warnings. Typed acknowledgment, never a refusal: an administrator with a
  -- reason still gets to proceed, on the record.
  -- -----------------------------------------------------------------------
  IF p_cadence_version_id IS NOT NULL THEN
    v_current_cadence := public.facility_cadence_in_force (v_facility_id, now());

    IF v_current_cadence IS NOT NULL AND v_current_cadence <> p_cadence_version_id THEN
      v_current_shape := public.cadence_version_day_shape (v_current_cadence);
      v_current_windows_per_day := (v_current_shape ->> 'windows_per_day')::integer;
    END IF;

    IF v_thresholds.maximum_unobserved_gap_minutes IS NOT NULL AND v_gap > v_thresholds.maximum_unobserved_gap_minutes THEN
      v_warnings := v_warnings || jsonb_build_object('code', 'largest_gap_exceeds_threshold', 'requires_acknowledgment', TRUE, 'message', format('The largest span in which nobody looks at a resident becomes %s minutes, past the %s minutes this building accepts.', v_gap, v_thresholds.maximum_unobserved_gap_minutes));
    END IF;

    IF v_current_windows_per_day IS NOT NULL AND v_windows_per_day < v_current_windows_per_day THEN
      v_warnings := v_warnings || jsonb_build_object('code', 'windows_per_day_decreased', 'requires_acknowledgment', TRUE, 'message', format('Checks per resident per day fall from %s to %s.', v_current_windows_per_day, v_windows_per_day));
    END IF;

    IF v_thresholds.maximum_windows_per_resident_per_day IS NOT NULL AND v_windows_per_day > v_thresholds.maximum_windows_per_resident_per_day THEN
      v_warnings := v_warnings || jsonb_build_object('code', 'windows_per_day_above_ceiling', 'requires_acknowledgment', TRUE, 'message', format('%s checks per resident per day is more than the %s this building treats as workable.', v_windows_per_day, v_thresholds.maximum_windows_per_resident_per_day));
    END IF;
  END IF;

  IF p_escalation_version_id IS NOT NULL THEN
    FOR v_row IN
    SELECT
      rung ->> 'label' AS rung_label,
      role_entry ->> 'staff_role' AS staff_role
    FROM
      jsonb_array_elements(public.observation_escalation_role_holders (v_facility_id, p_escalation_version_id)) rung
      CROSS JOIN LATERAL jsonb_array_elements(rung -> 'roles') AS role_entry
    WHERE
      (rung ->> 'enabled')::boolean
      AND (role_entry ->> 'holder_count')::integer = 0 LOOP
        v_warnings := v_warnings || jsonb_build_object('code', 'rung_role_has_no_holders', 'requires_acknowledgment', TRUE, 'message', format('Nobody at this building currently holds the %s role that %s is addressed to, so that rung reaches nobody through it.', v_row.staff_role, v_row.rung_label));
      END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', jsonb_array_length(v_blocks) = 0, 'facility_id', v_facility_id, 'cadence_version_id', p_cadence_version_id, 'escalation_version_id', p_escalation_version_id, 'windows_per_day', v_windows_per_day, 'current_windows_per_day', v_current_windows_per_day, 'largest_unobserved_gap_minutes', v_gap, 'jurisdiction_floor', v_floor, 'blocks', v_blocks, 'warnings', v_warnings);
END;
$func$;

COMMENT ON FUNCTION public.validate_cadence_version (uuid, uuid) IS
  'The six hard blocks and four typed acknowledgment warnings of spec 25A section 6.5, for a proposed cadence version, a proposed escalation version, or both. Returns every finding rather than raising on the first, so a form reports six problems once instead of one problem six times; public.activate_cadence_version calls it and raises the first block verbatim, which is what stops a block being enforced in the client only. Block 3 derives the shift start from public.facility_shift_definitions and never from a hardcoded time. Block 6 reads public.jurisdiction_observation_floors, and a null floor passes because no verified Florida minimum exists and none is invented here. COL-37 ruling: definer required, because the zero holder warning reads staff counts across the building through public.observation_escalation_role_holders. The body gates on haven.can_read_observation_config first and writes nothing at all.';

REVOKE ALL ON FUNCTION public.validate_cadence_version (uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_cadence_version (uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The activation invariant, in one place
--
-- Decision D14. Every path that puts a version in force goes through this
-- function: the operator command, the rollback, the template fan out and the
-- scheduled activator. It is the only writer of status = 'active' and the only
-- writer of effective_to on a superseded version.
--
-- What it does, in this order and for this reason:
--
--   1. It closes the outgoing version first. The gist exclusion constraint
--      added by migrations 414 and 417 rejects two open ended ranges on one
--      facility, and the partial unique index rejects two active rows, so
--      opening the incoming version first aborts the transaction. That is the
--      floor. The order is written out here so the timeline is correct rather
--      than merely not corrupt.
--   2. It refuses an effective_from earlier than the outgoing version's, which
--      no constraint can catch: a range that starts before the previous one and
--      is closed off correctly is perfectly legal and reverses history.
--   3. It refuses to move effective_from on a version that has already
--      generated a task or fired an escalation, which no constraint can catch
--      either. Those rows are stamped with this version and scored against the
--      window times it was in force for.
--   4. It never modifies a completed task, a missed task, an excused task, a
--      reassigned task, or any escalation row. The immediate apply path soft
--      deletes only tasks that are still pending and have never had a rung
--      fire against them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.apply_observation_config_activation (p_kind text, p_version_id uuid, p_effective_from timestamptz, p_actor uuid DEFAULT NULL, p_cancel_pending boolean DEFAULT FALSE)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_facility_id uuid;
  v_status text;
  v_stored_from timestamptz;
  v_version_number integer;
  v_incoming_in_use boolean := FALSE;
  v_prior_id uuid;
  v_prior_from timestamptz;
  v_prior_number integer;
  v_prior_in_use boolean := FALSE;
  v_cancelled integer := 0;
  v_org uuid;
  v_source_template uuid;
  v_activation_reason text;
  v_now CONSTANT timestamptz := now();
BEGIN
  IF p_kind NOT IN ('cadence', 'escalation') THEN
    RAISE EXCEPTION 'Unknown observation configuration kind %', p_kind
      USING ERRCODE = '22023';
  END IF;

  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'An activation needs an effective_from; this building has no shift model to resolve the next boundary from'
      USING ERRCODE = '22023';
  END IF;

  -- Gather, locking the incoming row so two activations cannot interleave.
  IF p_kind = 'cadence' THEN
    SELECT
      v.facility_id,
      v.status,
      v.effective_from,
      v.version_number INTO v_facility_id,
      v_status,
      v_stored_from,
      v_version_number
    FROM
      public.facility_cadence_versions v
    WHERE
      v.id = p_version_id
      AND v.deleted_at IS NULL
    FOR UPDATE;
  ELSE
    SELECT
      v.facility_id,
      v.status,
      v.effective_from,
      v.version_number INTO v_facility_id,
      v_status,
      v_stored_from,
      v_version_number
    FROM
      public.facility_escalation_versions v
    WHERE
      v.id = p_version_id
      AND v.deleted_at IS NULL
    FOR UPDATE;
  END IF;

  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'That % version does not exist', p_kind
      USING ERRCODE = '22023';
  END IF;

  IF v_status = 'active' THEN
    RAISE EXCEPTION 'That % version is already in force', p_kind
      USING ERRCODE = '22023';
  END IF;

  IF v_status = 'superseded' THEN
    RAISE EXCEPTION 'That % version has already been superseded. Roll it forward into a new version rather than reactivating it, so the timeline keeps its order', p_kind
      USING ERRCODE = '22023';
  END IF;

  -- Has the incoming version already produced a record that was scored against
  -- the times it carries? If so its effective_from is no longer ours to move.
  IF p_kind = 'cadence' THEN
    SELECT
      EXISTS (
        SELECT
          1
        FROM
          public.resident_observation_tasks t
        WHERE
          t.cadence_version_id = p_version_id) INTO v_incoming_in_use;
  ELSE
    SELECT
      EXISTS (
        SELECT
          1
        FROM
          public.resident_observation_escalations e
        WHERE
          e.escalation_version_id = p_version_id)
      OR EXISTS (
        SELECT
          1
        FROM
          public.observation_escalation_dispatches d
        WHERE
          d.escalation_version_id = p_version_id) INTO v_incoming_in_use;
  END IF;

  IF v_incoming_in_use AND v_stored_from <> p_effective_from THEN
    RAISE EXCEPTION 'That % version has already generated a record stamped with it, so its effective_from cannot be moved from % to %. Create a new version instead', p_kind, v_stored_from, p_effective_from
      USING ERRCODE = '22023';
  END IF;

  -- The version going out.
  IF p_kind = 'cadence' THEN
    SELECT
      v.id,
      v.effective_from,
      v.version_number INTO v_prior_id,
      v_prior_from,
      v_prior_number
    FROM
      public.facility_cadence_versions v
    WHERE
      v.facility_id = v_facility_id
      AND v.status = 'active'
      AND v.deleted_at IS NULL
    FOR UPDATE;
  ELSE
    SELECT
      v.id,
      v.effective_from,
      v.version_number INTO v_prior_id,
      v_prior_from,
      v_prior_number
    FROM
      public.facility_escalation_versions v
    WHERE
      v.facility_id = v_facility_id
      AND v.status = 'active'
      AND v.deleted_at IS NULL
    FOR UPDATE;
  END IF;

  IF v_prior_id IS NOT NULL THEN
    IF p_effective_from < v_prior_from THEN
      RAISE EXCEPTION 'A % version cannot take effect at %, before version % which took effect at %. Activating backwards would make a past compliance report recompute against configuration that was never in force', p_kind, p_effective_from, v_prior_number, v_prior_from
        USING ERRCODE = '22023';
    END IF;

    IF p_kind = 'cadence' THEN
      SELECT
        EXISTS (
          SELECT
            1
          FROM
            public.resident_observation_tasks t
          WHERE
            t.cadence_version_id = v_prior_id) INTO v_prior_in_use;
    ELSE
      SELECT
        EXISTS (
          SELECT
            1
          FROM
            public.resident_observation_escalations e
          WHERE
            e.escalation_version_id = v_prior_id)
        OR EXISTS (
          SELECT
            1
          FROM
            public.observation_escalation_dispatches d
          WHERE
            d.escalation_version_id = v_prior_id) INTO v_prior_in_use;
    END IF;

    -- An effective_from equal to the outgoing version's leaves that version
    -- covering an empty span. The exclusion constraint accepts it, because an
    -- empty range overlaps nothing, and public.facility_cadence_in_force would
    -- then never answer from a version whose rows are still stamped on real
    -- work.
    IF p_effective_from = v_prior_from AND v_prior_in_use THEN
      RAISE EXCEPTION 'A % version cannot take effect at exactly %, the instant version % took effect, because that version has already generated records and would be left covering no time at all', p_kind, p_effective_from, v_prior_number
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Close the outgoing version, then open the incoming one. This order is the
  -- whole invariant; the other order aborts on the exclusion constraint.
  IF v_prior_id IS NOT NULL THEN
    IF p_kind = 'cadence' THEN
      UPDATE
        public.facility_cadence_versions
      SET
        status = 'superseded',
        effective_to = p_effective_from
      WHERE
        id = v_prior_id;
    ELSE
      UPDATE
        public.facility_escalation_versions
      SET
        status = 'superseded',
        effective_to = p_effective_from
      WHERE
        id = v_prior_id;
    END IF;
  END IF;

  IF p_kind = 'cadence' THEN
    UPDATE
      public.facility_cadence_versions
    SET
      status = 'active',
      effective_from = p_effective_from,
      effective_to = NULL,
      activated_at = v_now,
      activated_by = COALESCE(p_actor, activated_by)
    WHERE
      id = p_version_id;
  ELSE
    UPDATE
      public.facility_escalation_versions
    SET
      status = 'active',
      effective_from = p_effective_from,
      effective_to = NULL,
      activated_at = v_now,
      activated_by = COALESCE(p_actor, activated_by)
    WHERE
      id = p_version_id;
  END IF;

  -- Immediate apply only. Spec 6.4: pending tasks in the current shift are
  -- cancelled and regenerated; a completed task, a missed task and a fired
  -- escalation are never touched under any option.
  --
  -- Cancellation is a soft delete rather than a status change, for two
  -- reasons. There is no cancelled value in resident_observation_task_status,
  -- and excused means forgiven, which is a different fact. And the idempotency
  -- index on (resident_id, window_key, service_date) is partial on
  -- deleted_at IS NULL, so a soft deleted row frees the slot and the generator
  -- regenerates the window cleanly on its next tick. The expectation does not
  -- vanish with the row: public.observation_compliance_for_range projects the
  -- window from the cadence version either way.
  IF p_cancel_pending AND p_kind = 'cadence' THEN
    UPDATE
      public.resident_observation_tasks t
    SET
      deleted_at = v_now,
      updated_at = v_now
    WHERE
      t.facility_id = v_facility_id
      AND t.deleted_at IS NULL
      AND t.window_key IS NOT NULL
      AND t.monitoring_order_id IS NULL
      AND t.cadence_version_id IS DISTINCT FROM p_version_id
      AND t.due_at >= p_effective_from
      AND t.status IN ('upcoming', 'due_soon', 'due_now', 'overdue', 'critically_overdue')
      AND NOT EXISTS (
        SELECT
          1
        FROM
          public.observation_escalation_dispatches d
        WHERE
          d.task_id = t.id);
    GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  END IF;

  -- The template binding follows the version that is actually in force, and it
  -- is maintained here rather than in the operator command so that a scheduled
  -- change moves the building onto or off a template at the moment it takes
  -- effect and not at the moment somebody approved it.
  --
  -- Spec 6.8: editing a facility directly detaches it to custom. A version with
  -- no source_template_id is a direct edit, whatever produced it.
  SELECT
    f.organization_id INTO v_org
  FROM
    public.facilities f
  WHERE
    f.id = v_facility_id;

  IF p_kind = 'cadence' THEN
    SELECT
      v.source_template_id,
      v.activation_reason INTO v_source_template,
      v_activation_reason
    FROM
      public.facility_cadence_versions v
    WHERE
      v.id = p_version_id;
  ELSE
    SELECT
      v.source_template_id,
      v.activation_reason INTO v_source_template,
      v_activation_reason
    FROM
      public.facility_escalation_versions v
    WHERE
      v.id = p_version_id;
  END IF;

  INSERT INTO public.facility_config_template_bindings AS binding (organization_id, facility_id, cadence_template_id, escalation_template_id, cadence_bound_at, escalation_bound_at, cadence_detached_at, escalation_detached_at, detach_reason, created_by)
    VALUES (v_org, v_facility_id, CASE WHEN p_kind = 'cadence' THEN
        v_source_template
      END, CASE WHEN p_kind = 'escalation' THEN
        v_source_template
      END, CASE WHEN p_kind = 'cadence' AND v_source_template IS NOT NULL THEN
        v_now
      END, CASE WHEN p_kind = 'escalation' AND v_source_template IS NOT NULL THEN
        v_now
      END, CASE WHEN p_kind = 'cadence' AND v_source_template IS NULL THEN
        v_now
      END, CASE WHEN p_kind = 'escalation' AND v_source_template IS NULL THEN
        v_now
      END, CASE WHEN v_source_template IS NULL THEN
        v_activation_reason
      END, p_actor)
  ON CONFLICT (facility_id)
    DO UPDATE SET
      cadence_template_id = CASE WHEN p_kind = 'cadence' THEN
        v_source_template
      ELSE
        binding.cadence_template_id
      END, escalation_template_id = CASE WHEN p_kind = 'escalation' THEN
        v_source_template
      ELSE
        binding.escalation_template_id
      END, cadence_bound_at = CASE WHEN p_kind = 'cadence' AND v_source_template IS NOT NULL THEN
        v_now
      ELSE
        binding.cadence_bound_at
      END, escalation_bound_at = CASE WHEN p_kind = 'escalation' AND v_source_template IS NOT NULL THEN
        v_now
      ELSE
        binding.escalation_bound_at
      END, cadence_detached_at = CASE WHEN p_kind = 'cadence' AND v_source_template IS NULL THEN
        v_now
      ELSE
        binding.cadence_detached_at
      END, escalation_detached_at = CASE WHEN p_kind = 'escalation' AND v_source_template IS NULL THEN
        v_now
      ELSE
        binding.escalation_detached_at
      END, detach_reason = CASE WHEN v_source_template IS NULL THEN
        COALESCE(v_activation_reason, binding.detach_reason)
      ELSE
        binding.detach_reason
      END, updated_at = v_now;

  RETURN jsonb_build_object('kind', p_kind, 'facility_id', v_facility_id, 'version_id', p_version_id, 'version_number', v_version_number, 'effective_from', p_effective_from, 'superseded_version_id', v_prior_id, 'superseded_version_number', v_prior_number, 'superseded_effective_to', CASE WHEN v_prior_id IS NULL THEN
        NULL
      ELSE
        p_effective_from
      END, 'pending_tasks_cancelled', v_cancelled, 'on_template_id', v_source_template);
END;
$func$;

COMMENT ON FUNCTION haven.apply_observation_config_activation (text, uuid, timestamptz, uuid, boolean) IS
  'The single writer of an active observation configuration version, cadence or escalation. Closes the outgoing version''s effective_to at exactly the instant the incoming one opens, in the same transaction and in that order, because the gist exclusion constraint aborts the other order. Refuses an effective_from earlier than the outgoing version''s, and refuses to move effective_from on a version that has already generated a task or fired an escalation; neither refusal is something a constraint can make. Never modifies a completed, missed, excused or reassigned task and never touches an escalation row. Service only by design: public.activate_cadence_version applies the role gate and then calls this, and the scheduled activator calls it as service_role where there is no app_role to gate on.';

REVOKE ALL ON FUNCTION haven.apply_observation_config_activation (text, uuid, timestamptz, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION haven.apply_observation_config_activation (text, uuid, timestamptz, uuid, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- Is an instant a shift boundary at this building?
--
-- Spec 6.4: a scheduled change that does not land on a shift boundary warns and
-- needs an acknowledgment, because staff mid shift do not get the board
-- rearranged under them by accident.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.facility_is_shift_boundary (p_facility_id uuid, p_at timestamptz)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    EXISTS (
      SELECT
        1
      FROM
        public.facilities f
        JOIN public.facility_shift_definitions s ON s.facility_id = f.id
          AND s.deleted_at IS NULL
          AND s.active
      WHERE
        f.id = p_facility_id
        AND f.deleted_at IS NULL
        AND date_trunc('minute', (p_at AT TIME ZONE f.timezone)::time::interval) = date_trunc('minute', s.starts_at_local::interval));
$func$;

COMMENT ON FUNCTION public.facility_is_shift_boundary (uuid, timestamptz) IS
  'True when an instant falls on the local start time of one of this building''s shifts, read from public.facility_shift_definitions. A building that moves its shift change gets the answer moved with it.';

REVOKE ALL ON FUNCTION public.facility_is_shift_boundary (uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_is_shift_boundary (uuid, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.create_cadence_version
--
-- Proposes a change. It creates a new version and never mutates the version
-- that is in force, which is acceptance item 15's first half.
--
-- A proposal may carry windows, rungs, or both. Passing null for either means
-- that kind of configuration is not changing, so editing one rung does not
-- manufacture a cadence version identical to the one already in force.
--
-- Spec 6.12: org_admin and owner create a draft they can then activate;
-- facility_admin and manager create a pending_approval version somebody else
-- has to approve. The status the caller lands in is decided here, never passed
-- in, because a parameter an administrator controls is not an approval gate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_cadence_version (p_facility_id uuid, p_change_reason text, p_windows jsonb DEFAULT NULL, p_escalation_rungs jsonb DEFAULT NULL, p_effective_from timestamptz DEFAULT NULL, p_source_cadence_template_id uuid DEFAULT NULL, p_source_escalation_template_id uuid DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_org uuid;
  v_actor uuid;
  v_status text;
  v_effective_from timestamptz;
  v_cadence_id uuid := NULL;
  v_escalation_id uuid := NULL;
  v_cadence_number integer;
  v_escalation_number integer;
  v_rung record;
BEGIN
  IF p_change_reason IS NULL OR btrim(p_change_reason) = '' THEN
    RAISE EXCEPTION 'Every observation configuration change needs a reason. Say what changed and why, so the change log is worth reading in six months'
      USING ERRCODE = '22023';
  END IF;

  IF p_windows IS NULL AND p_escalation_rungs IS NULL THEN
    RAISE EXCEPTION 'A proposal has to change something: pass the observation windows, the escalation rungs, or both'
      USING ERRCODE = '22023';
  END IF;

  IF haven.can_edit_observation_config (p_facility_id) THEN
    v_status := 'draft';
  ELSIF haven.can_propose_observation_config (p_facility_id) THEN
    -- Spec 6.12 and open item 7: facility administrators propose rather than
    -- edit. A cadence change is policy for an entire building.
    v_status := 'pending_approval';
  ELSE
    RAISE EXCEPTION 'Proposing an observation configuration change needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    f.organization_id INTO v_org
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Facility not found'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    p.id INTO v_actor
  FROM
    public.user_profiles p
  WHERE
    p.id = auth.uid ();

  -- A provisional effective_from, because the column is NOT NULL and a draft
  -- has to land somewhere. Activation resolves the real one from the apply
  -- mode and overwrites this.
  v_effective_from := COALESCE(p_effective_from, public.facility_next_shift_boundary_at (p_facility_id, now()), now());

  IF p_windows IS NOT NULL THEN
    IF jsonb_typeof(p_windows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_windows) = 0 THEN
      RAISE EXCEPTION 'The observation windows have to be a non empty JSON array'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      COALESCE(max(v.version_number), 0) + 1 INTO v_cadence_number
    FROM
      public.facility_cadence_versions v
    WHERE
      v.facility_id = p_facility_id;

    INSERT INTO public.facility_cadence_versions (organization_id, facility_id, version_number, status, effective_from, change_reason, source_template_id, created_by)
      VALUES (v_org, p_facility_id, v_cadence_number, v_status, v_effective_from, p_change_reason, p_source_cadence_template_id, v_actor)
    RETURNING
      id INTO v_cadence_id;

    INSERT INTO public.facility_cadence_windows (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled, created_by)
    SELECT
      v_org,
      p_facility_id,
      v_cadence_id,
      w.window_key,
      w.label,
      w.due_at_local,
      w.grace_before_minutes,
      w.grace_after_minutes,
      w.shift_key,
      COALESCE(w.sort_order, 0),
      COALESCE(w.enabled, TRUE),
      v_actor
    FROM
      jsonb_to_recordset(p_windows) AS w (window_key text, label text, due_at_local time, grace_before_minutes integer, grace_after_minutes integer, shift_key text, sort_order integer, enabled boolean);
  END IF;

  IF p_escalation_rungs IS NOT NULL THEN
    IF jsonb_typeof(p_escalation_rungs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_escalation_rungs) = 0 THEN
      RAISE EXCEPTION 'The escalation rungs have to be a non empty JSON array'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      COALESCE(max(v.version_number), 0) + 1 INTO v_escalation_number
    FROM
      public.facility_escalation_versions v
    WHERE
      v.facility_id = p_facility_id;

    INSERT INTO public.facility_escalation_versions (organization_id, facility_id, version_number, status, effective_from, change_reason, source_template_id, created_by)
      VALUES (v_org, p_facility_id, v_escalation_number, v_status, v_effective_from, p_change_reason, p_source_escalation_template_id, v_actor)
    RETURNING
      id INTO v_escalation_id;

    INSERT INTO public.facility_escalation_rungs (organization_id, facility_id, escalation_version_id, rung_key, label, offset_minutes, is_terminal, assigned_staff_only, include_assigned_staff, use_standing_alert_routes, target_staff_roles, channels, protocol_text, sort_order, enabled, created_by)
    SELECT
      v_org,
      p_facility_id,
      v_escalation_id,
      r.rung_key,
      r.label,
      r.offset_minutes,
      COALESCE(r.is_terminal, FALSE),
      COALESCE(r.assigned_staff_only, FALSE),
      COALESCE(r.include_assigned_staff, FALSE),
      COALESCE(r.use_standing_alert_routes, FALSE),
      COALESCE(r.target_staff_roles, ARRAY[]::public.staff_role[]),
      r.channels,
      r.protocol_text,
      COALESCE(r.sort_order, 0),
      COALESCE(r.enabled, TRUE),
      v_actor
    FROM
      jsonb_to_recordset(p_escalation_rungs) AS r (rung_key text, label text, offset_minutes integer, is_terminal boolean, assigned_staff_only boolean, include_assigned_staff boolean, use_standing_alert_routes boolean, target_staff_roles public.staff_role[], channels text[], protocol_text text, sort_order integer, enabled boolean);

    -- Per shift overrides ride along on the rung they belong to. A shift key is
    -- facility configuration, so an override cannot be templated, but it can
    -- certainly be proposed.
    FOR v_rung IN
    SELECT
      r.rung_key,
      r.shift_overrides
    FROM
      jsonb_to_recordset(p_escalation_rungs) AS r (rung_key text, shift_overrides jsonb)
    WHERE
      r.shift_overrides IS NOT NULL
      AND jsonb_typeof(r.shift_overrides) = 'array' LOOP
        INSERT INTO public.facility_escalation_rung_shift_overrides (organization_id, facility_id, escalation_version_id, escalation_rung_id, shift_key, offset_minutes, channels, created_by)
        SELECT
          v_org,
          p_facility_id,
          v_escalation_id,
          rung.id,
          ov.shift_key,
          ov.offset_minutes,
          ov.channels,
          v_actor
        FROM
          public.facility_escalation_rungs rung
          CROSS JOIN LATERAL jsonb_to_recordset(v_rung.shift_overrides) AS ov (shift_key text, offset_minutes integer, channels text[])
        WHERE
          rung.escalation_version_id = v_escalation_id
          AND rung.rung_key = v_rung.rung_key;
      END LOOP;
  END IF;

  RETURN jsonb_build_object('facility_id', p_facility_id, 'status', v_status, 'cadence_version_id', v_cadence_id, 'cadence_version_number', v_cadence_number, 'escalation_version_id', v_escalation_id, 'escalation_version_number', v_escalation_number, 'provisional_effective_from', v_effective_from, 'validation', public.validate_cadence_version (v_cadence_id, v_escalation_id));
END;
$func$;

COMMENT ON FUNCTION public.create_cadence_version (uuid, text, jsonb, jsonb, timestamptz, uuid, uuid) IS
  'Proposes an observation cadence change, an escalation change, or both, at one facility. Creates a new version and never mutates the version in force, which is the first half of spec 25A acceptance item 15. The status is decided by the caller''s role and never passed in: org_admin and owner get a draft they can activate, facility_admin and manager get a pending_approval version somebody else has to approve, per spec 6.12. change_reason is required. COL-37 ruling: definer required, because the versions tables carry an INSERT policy that admits facility_admin only for draft and pending_approval and the command has to decide that status itself rather than trust it. The body gates on haven.can_edit_observation_config and haven.can_propose_observation_config before it writes.';

REVOKE ALL ON FUNCTION public.create_cadence_version (uuid, text, jsonb, jsonb, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cadence_version (uuid, text, jsonb, jsonb, timestamptz, uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Why now, as well as why
--
-- change_reason records why a proposal was written. An activation is a second
-- decision, often taken by a different person days later, and spec 6.11 asks
-- for a required reason on every configuration change. Recording the second one
-- in the same column would overwrite the first, and overwriting anything on a
-- version is exactly what this module does not do.
-- ---------------------------------------------------------------------------
ALTER TABLE public.facility_cadence_versions
  ADD COLUMN IF NOT EXISTS activation_reason text NULL,
  ADD COLUMN IF NOT EXISTS apply_mode text NULL;

ALTER TABLE public.facility_escalation_versions
  ADD COLUMN IF NOT EXISTS activation_reason text NULL,
  ADD COLUMN IF NOT EXISTS apply_mode text NULL;

ALTER TABLE public.facility_cadence_versions
  DROP CONSTRAINT IF EXISTS facility_cadence_versions_activation_reason_length;

ALTER TABLE public.facility_cadence_versions
  ADD CONSTRAINT facility_cadence_versions_activation_reason_length CHECK (activation_reason IS NULL
    OR char_length(activation_reason) BETWEEN 1 AND 500);

ALTER TABLE public.facility_cadence_versions
  DROP CONSTRAINT IF EXISTS facility_cadence_versions_apply_mode_known;

ALTER TABLE public.facility_cadence_versions
  ADD CONSTRAINT facility_cadence_versions_apply_mode_known CHECK (apply_mode IS NULL
    OR apply_mode IN ('next_shift_boundary', 'scheduled', 'immediate'));

ALTER TABLE public.facility_escalation_versions
  DROP CONSTRAINT IF EXISTS facility_escalation_versions_activation_reason_length;

ALTER TABLE public.facility_escalation_versions
  ADD CONSTRAINT facility_escalation_versions_activation_reason_length CHECK (activation_reason IS NULL
    OR char_length(activation_reason) BETWEEN 1 AND 500);

ALTER TABLE public.facility_escalation_versions
  DROP CONSTRAINT IF EXISTS facility_escalation_versions_apply_mode_known;

ALTER TABLE public.facility_escalation_versions
  ADD CONSTRAINT facility_escalation_versions_apply_mode_known CHECK (apply_mode IS NULL
    OR apply_mode IN ('next_shift_boundary', 'scheduled', 'immediate'));

COMMENT ON COLUMN public.facility_cadence_versions.activation_reason IS
  'Why this version was put in force, recorded separately from change_reason so activating a proposal cannot overwrite why the proposal was written. Required by public.activate_cadence_version.';
COMMENT ON COLUMN public.facility_cadence_versions.apply_mode IS
  'Which of the three effective timing options put this version in force: next_shift_boundary, scheduled, or immediate. Spec 25A section 6.4.';
COMMENT ON COLUMN public.facility_escalation_versions.activation_reason IS
  'Why this version was put in force, recorded separately from change_reason. Required by public.activate_cadence_version.';
COMMENT ON COLUMN public.facility_escalation_versions.apply_mode IS
  'Which of the three effective timing options put this version in force. Spec 25A section 6.4.';

-- ---------------------------------------------------------------------------
-- public.activate_cadence_version
--
-- Puts a proposed version in force. Spec 6.4 for the three effective timing
-- options, 6.5 for the blocks and the typed acknowledgment, 6.12 for the role.
--
-- The timeline invariant lives in haven.apply_observation_config_activation and
-- is not restated here. What this command owns is the authorization, the six
-- hard blocks, the acknowledgment, and the template binding that follows a
-- direct edit.
--
-- On the errcode the hard blocks raise, which is load bearing and was wrong for
-- one commit.
--
-- The rounding surface shows a command's own sentence only for the SQLSTATEs
-- named in COMMAND_REFUSAL_CODES in src/lib/rounding/rounding-query-error.ts,
-- and shows its own fallback for everything else. That set is P0001, P0002,
-- 22023, 23505 and 42501. It deliberately excludes 23514, check_violation,
-- because any CHECK constraint anywhere in the module raises 23514 and its text
-- is raw PostgreSQL that means nothing to an operator.
--
-- This raise carried 23514. The blocks were enforced, but the six messages an
-- administrator most needs to read -- the overlap, the shift with nothing on it,
-- the early opening at a shift start -- were the only refusals in the whole
-- module that arrived on screen as "that change could not be put in force,
-- retry". The block worked and the reason was illegible, which is the same
-- defect class as the generic error copy that hid three unrelated query bugs on
-- the live board.
--
-- It raises 22023, invalid_parameter_value, which is what every other refusal in
-- this migration uses and what the code means here: a stated rule about the
-- input. Widening the shared refusal set instead would have traded one invisible
-- message for many unreadable ones.
--
-- Two tests hold it. review_smart_rounding_authority.sql asserts this body
-- raises 22023 and mentions 23514 nowhere, and
-- src/hooks/useObservationCadenceSettings.test.tsx asserts all six messages
-- reach a caller verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_cadence_version (p_change_reason text, p_cadence_version_id uuid DEFAULT NULL, p_escalation_version_id uuid DEFAULT NULL, p_apply_mode text DEFAULT 'next_shift_boundary', p_effective_from timestamptz DEFAULT NULL, p_acknowledgment text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_facility_id uuid;
  v_cadence_facility uuid;
  v_escalation_facility uuid;
  v_org uuid;
  v_facility_name text;
  v_actor uuid;
  v_validation jsonb;
  v_effective_from timestamptz;
  v_needs_ack boolean := FALSE;
  v_ack_reasons text[] := ARRAY[]::text[];
  v_cadence_result jsonb := NULL;
  v_escalation_result jsonb := NULL;
  v_cadence_template uuid;
  v_escalation_template uuid;
  v_now CONSTANT timestamptz := now();
BEGIN
  IF p_change_reason IS NULL OR btrim(p_change_reason) = '' THEN
    RAISE EXCEPTION 'Putting an observation configuration change in force needs a reason. Say why it is happening now'
      USING ERRCODE = '22023';
  END IF;

  IF p_cadence_version_id IS NULL AND p_escalation_version_id IS NULL THEN
    RAISE EXCEPTION 'activate_cadence_version needs a cadence version, an escalation version, or both'
      USING ERRCODE = '22023';
  END IF;

  IF p_apply_mode NOT IN ('next_shift_boundary', 'scheduled', 'immediate') THEN
    RAISE EXCEPTION 'Unknown effective timing %. The three options are next_shift_boundary, scheduled and immediate', p_apply_mode
      USING ERRCODE = '22023';
  END IF;

  SELECT
    v.facility_id INTO v_cadence_facility
  FROM
    public.facility_cadence_versions v
  WHERE
    v.id = p_cadence_version_id
    AND v.deleted_at IS NULL;

  SELECT
    v.facility_id INTO v_escalation_facility
  FROM
    public.facility_escalation_versions v
  WHERE
    v.id = p_escalation_version_id
    AND v.deleted_at IS NULL;

  IF p_cadence_version_id IS NOT NULL AND v_cadence_facility IS NULL THEN
    RAISE EXCEPTION 'Cadence version not found'
      USING ERRCODE = '22023';
  END IF;

  IF p_escalation_version_id IS NOT NULL AND v_escalation_facility IS NULL THEN
    RAISE EXCEPTION 'Escalation version not found'
      USING ERRCODE = '22023';
  END IF;

  IF v_cadence_facility IS NOT NULL AND v_escalation_facility IS NOT NULL AND v_cadence_facility <> v_escalation_facility THEN
    RAISE EXCEPTION 'The cadence version and the escalation version belong to different buildings and cannot be activated as one change'
      USING ERRCODE = '22023';
  END IF;

  v_facility_id := COALESCE(v_cadence_facility, v_escalation_facility);

  IF NOT haven.can_edit_observation_config (v_facility_id) THEN
    RAISE EXCEPTION 'Putting an observation cadence or escalation change in force needs an organization administrator or the owner. A facility administrator proposes the change and somebody at the organization approves it'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    f.organization_id,
    f.name INTO v_org,
    v_facility_name
  FROM
    public.facilities f
  WHERE
    f.id = v_facility_id
    AND f.deleted_at IS NULL;

  SELECT
    p.id INTO v_actor
  FROM
    public.user_profiles p
  WHERE
    p.id = auth.uid ();

  -- The six hard blocks, enforced here and not only in the client. The errcode
  -- is 22023 and which code it is matters; the note above CREATE OR REPLACE
  -- says why, and review_smart_rounding_authority.sql refuses any other.
  v_validation := public.validate_cadence_version (p_cadence_version_id, p_escalation_version_id);

  IF (v_validation ->> 'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '%', v_validation -> 'blocks' -> 0 ->> 'message'
      USING ERRCODE = '22023';
  END IF;

  -- Effective timing, spec 6.4.
  IF p_apply_mode = 'next_shift_boundary' THEN
    v_effective_from := public.facility_next_shift_boundary_at (v_facility_id, v_now);
    IF v_effective_from IS NULL THEN
      RAISE EXCEPTION 'This building has no shift model, so there is no next shift boundary to take effect at. Schedule the change or apply it immediately'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_apply_mode = 'scheduled' THEN
    IF p_effective_from IS NULL THEN
      RAISE EXCEPTION 'A scheduled change needs the date and time it takes effect'
        USING ERRCODE = '22023';
    END IF;
    IF p_effective_from <= v_now THEN
      RAISE EXCEPTION 'A scheduled change has to take effect in the future. To change the board now, apply the change immediately and acknowledge it'
        USING ERRCODE = '22023';
    END IF;
    v_effective_from := p_effective_from;
    IF NOT public.facility_is_shift_boundary (v_facility_id, v_effective_from) THEN
      v_needs_ack := TRUE;
      v_ack_reasons := array_append(v_ack_reasons, 'the change lands part way through a shift rather than on a shift boundary'::text);
    END IF;
  ELSE
    v_effective_from := v_now;
    v_needs_ack := TRUE;
    v_ack_reasons := array_append(v_ack_reasons, 'the change applies immediately and cancels the pending checks on the current board'::text);
  END IF;

  IF jsonb_array_length(v_validation -> 'warnings') > 0 THEN
    v_needs_ack := TRUE;
    SELECT
      v_ack_reasons || array_agg((w ->> 'message')::text) INTO v_ack_reasons
    FROM
      jsonb_array_elements(v_validation -> 'warnings') w
    WHERE
      (w ->> 'requires_acknowledgment')::boolean;
  END IF;

  IF v_needs_ack AND (p_acknowledgment IS NULL OR lower(btrim(p_acknowledgment)) <> lower(btrim(v_facility_name))) THEN
    RAISE EXCEPTION 'This change needs a typed acknowledgment because %. Type the building name exactly to confirm', array_to_string(v_ack_reasons, ', and ')
      USING ERRCODE = '22023';
  END IF;

  -- A change that takes effect in the future is marked scheduled and left for
  -- the activator. Marking it active now with a future effective_from would
  -- close the outgoing version's effective_to at a date that has not arrived,
  -- so a second change needed before then would have nowhere in the timeline to
  -- go, and public.facility_cadence_in_force would be answering from a version
  -- nobody had reached yet. Migration 414 put draft, pending and scheduled
  -- outside the exclusion constraint for exactly this reason.
  --
  -- next_shift_boundary and scheduled are therefore both future dated and both
  -- land as scheduled; only immediate activates inside this call.
  IF v_effective_from > v_now THEN
    IF p_cadence_version_id IS NOT NULL THEN
      UPDATE
        public.facility_cadence_versions
      SET
        status = 'scheduled',
        effective_from = v_effective_from,
        activation_reason = p_change_reason,
        apply_mode = p_apply_mode,
        activated_by = COALESCE(v_actor, activated_by)
      WHERE
        id = p_cadence_version_id;
    END IF;

    IF p_escalation_version_id IS NOT NULL THEN
      UPDATE
        public.facility_escalation_versions
      SET
        status = 'scheduled',
        effective_from = v_effective_from,
        activation_reason = p_change_reason,
        apply_mode = p_apply_mode,
        activated_by = COALESCE(v_actor, activated_by)
      WHERE
        id = p_escalation_version_id;
    END IF;

    RETURN jsonb_build_object('facility_id', v_facility_id, 'apply_mode', p_apply_mode, 'effective_from', v_effective_from, 'scheduled', TRUE, 'in_force', FALSE, 'acknowledgment_required', v_needs_ack, 'cadence_version_id', p_cadence_version_id, 'escalation_version_id', p_escalation_version_id, 'warnings', v_validation -> 'warnings');
  END IF;

  -- Cadence first, so a combined change cannot leave an escalation version in
  -- force against a cadence that failed to activate.
  IF p_cadence_version_id IS NOT NULL THEN
    UPDATE
      public.facility_cadence_versions
    SET
      activation_reason = p_change_reason,
      apply_mode = p_apply_mode
    WHERE
      id = p_cadence_version_id;

    -- Cancellation is filtered to tasks due at or after effective_from that are
    -- still pending and have never had a rung fire, so an immediate apply
    -- clears the rest of the current shift and a boundary apply clears only
    -- what sits past the boundary. Nothing on the shift being worked right now
    -- moves under a boundary or scheduled change, which is what spec 6.4 means
    -- by "nothing on the current board changes".
    v_cadence_result := haven.apply_observation_config_activation ('cadence', p_cadence_version_id, v_effective_from, v_actor, TRUE);

    SELECT
      v.source_template_id INTO v_cadence_template
    FROM
      public.facility_cadence_versions v
    WHERE
      v.id = p_cadence_version_id;
  END IF;

  IF p_escalation_version_id IS NOT NULL THEN
    UPDATE
      public.facility_escalation_versions
    SET
      activation_reason = p_change_reason,
      apply_mode = p_apply_mode
    WHERE
      id = p_escalation_version_id;

    v_escalation_result := haven.apply_observation_config_activation ('escalation', p_escalation_version_id, v_effective_from, v_actor, FALSE);

    SELECT
      v.source_template_id INTO v_escalation_template
    FROM
      public.facility_escalation_versions v
    WHERE
      v.id = p_escalation_version_id;
  END IF;

  RETURN jsonb_build_object('facility_id', v_facility_id, 'apply_mode', p_apply_mode, 'effective_from', v_effective_from, 'scheduled', FALSE, 'in_force', TRUE, 'acknowledgment_required', v_needs_ack, 'cadence', v_cadence_result, 'escalation', v_escalation_result, 'on_cadence_template_id', v_cadence_template, 'on_escalation_template_id', v_escalation_template, 'warnings', v_validation -> 'warnings');
END;
$func$;

COMMENT ON FUNCTION public.activate_cadence_version (text, uuid, uuid, text, timestamptz, text) IS
  'Puts a proposed observation cadence version, escalation version, or both in force at one facility. Owns the authorization (org_admin and owner, spec 6.12), the six hard blocks of spec 6.5 enforced in the database and not only in the client, the three effective timing options of spec 6.4, the typed acknowledgment, and the template binding that a direct edit detaches. The timeline invariant itself lives in haven.apply_observation_config_activation, which closes the outgoing version before it opens the incoming one and refuses a backwards activation; it is not restated here so it cannot drift. COL-37 ruling: definer required, because it writes public.facility_config_template_bindings, which carries a SELECT policy and deliberately no write policy. The body gates on haven.can_edit_observation_config before anything is written.';

REVOKE ALL ON FUNCTION public.activate_cadence_version (text, uuid, uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_cadence_version (text, uuid, uuid, text, timestamptz, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.rollback_cadence_version
--
-- Spec 6.11: rollback creates a new forward version copying an earlier one. It
-- never deletes a version and never rewrites effective_from on a version that
-- was in force. Going back is therefore a change like any other, with a reason
-- on it and a place in the timeline, which is what keeps a past compliance
-- report reproducible after somebody undoes a mistake.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rollback_cadence_version (p_facility_id uuid, p_change_reason text, p_restore_cadence_version_id uuid DEFAULT NULL, p_restore_escalation_version_id uuid DEFAULT NULL, p_apply_mode text DEFAULT 'next_shift_boundary', p_effective_from timestamptz DEFAULT NULL, p_acknowledgment text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_windows jsonb := NULL;
  v_rungs jsonb := NULL;
  v_cadence_template uuid := NULL;
  v_escalation_template uuid := NULL;
  v_restore_cadence_number integer := NULL;
  v_restore_escalation_number integer := NULL;
  v_created jsonb;
  v_activated jsonb;
BEGIN
  IF p_change_reason IS NULL OR btrim(p_change_reason) = '' THEN
    RAISE EXCEPTION 'A rollback needs a reason. Say what is being undone and why'
      USING ERRCODE = '22023';
  END IF;

  IF p_restore_cadence_version_id IS NULL AND p_restore_escalation_version_id IS NULL THEN
    RAISE EXCEPTION 'A rollback needs the earlier cadence version, the earlier escalation version, or both'
      USING ERRCODE = '22023';
  END IF;

  IF NOT haven.can_edit_observation_config (p_facility_id) THEN
    RAISE EXCEPTION 'Rolling an observation configuration back needs an organization administrator or the owner'
      USING ERRCODE = '42501';
  END IF;

  IF p_restore_cadence_version_id IS NOT NULL THEN
    SELECT
      v.version_number,
      v.source_template_id INTO v_restore_cadence_number,
      v_cadence_template
    FROM
      public.facility_cadence_versions v
    WHERE
      v.id = p_restore_cadence_version_id
      AND v.facility_id = p_facility_id
      AND v.deleted_at IS NULL;

    IF v_restore_cadence_number IS NULL THEN
      RAISE EXCEPTION 'That cadence version does not belong to this building'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      jsonb_agg (jsonb_build_object('window_key', w.window_key, 'label', w.label, 'due_at_local', to_char(w.due_at_local, 'HH24:MI'), 'grace_before_minutes', w.grace_before_minutes, 'grace_after_minutes', w.grace_after_minutes, 'shift_key', w.shift_key, 'sort_order', w.sort_order, 'enabled', w.enabled)
        ORDER BY w.sort_order, w.due_at_local) INTO v_windows
    FROM
      public.facility_cadence_windows w
    WHERE
      w.cadence_version_id = p_restore_cadence_version_id
      AND w.deleted_at IS NULL;
  END IF;

  IF p_restore_escalation_version_id IS NOT NULL THEN
    SELECT
      v.version_number,
      v.source_template_id INTO v_restore_escalation_number,
      v_escalation_template
    FROM
      public.facility_escalation_versions v
    WHERE
      v.id = p_restore_escalation_version_id
      AND v.facility_id = p_facility_id
      AND v.deleted_at IS NULL;

    IF v_restore_escalation_number IS NULL THEN
      RAISE EXCEPTION 'That escalation version does not belong to this building'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      jsonb_agg (jsonb_build_object('rung_key', r.rung_key, 'label', r.label, 'offset_minutes', r.offset_minutes, 'is_terminal', r.is_terminal, 'assigned_staff_only', r.assigned_staff_only, 'include_assigned_staff', r.include_assigned_staff, 'use_standing_alert_routes', r.use_standing_alert_routes, 'target_staff_roles', to_jsonb (r.target_staff_roles), 'channels', to_jsonb (r.channels), 'protocol_text', r.protocol_text, 'sort_order', r.sort_order, 'enabled', r.enabled, 'shift_overrides', COALESCE((
              SELECT
                jsonb_agg (jsonb_build_object('shift_key', ov.shift_key, 'offset_minutes', ov.offset_minutes, 'channels', to_jsonb (ov.channels)))
              FROM public.facility_escalation_rung_shift_overrides ov
              WHERE
                ov.escalation_rung_id = r.id
                AND ov.deleted_at IS NULL), '[]'::jsonb))
        ORDER BY r.sort_order, r.rung_key) INTO v_rungs
    FROM
      public.facility_escalation_rungs r
    WHERE
      r.escalation_version_id = p_restore_escalation_version_id
      AND r.deleted_at IS NULL;
  END IF;

  v_created := public.create_cadence_version (p_facility_id := p_facility_id, p_change_reason := format('Rollback to %s. %s', trim(concat_ws(' and ', CASE WHEN v_restore_cadence_number IS NOT NULL THEN
          format('cadence version %s', v_restore_cadence_number)
        END, CASE WHEN v_restore_escalation_number IS NOT NULL THEN
          format('escalation version %s', v_restore_escalation_number)
        END)), p_change_reason), p_windows := v_windows, p_escalation_rungs := v_rungs, p_effective_from := p_effective_from, p_source_cadence_template_id := v_cadence_template, p_source_escalation_template_id := v_escalation_template);

  v_activated := public.activate_cadence_version (p_change_reason := p_change_reason, p_cadence_version_id := (v_created ->> 'cadence_version_id')::uuid, p_escalation_version_id := (v_created ->> 'escalation_version_id')::uuid, p_apply_mode := p_apply_mode, p_effective_from := p_effective_from, p_acknowledgment := p_acknowledgment);

  RETURN jsonb_build_object('facility_id', p_facility_id, 'restored_from_cadence_version_number', v_restore_cadence_number, 'restored_from_escalation_version_number', v_restore_escalation_number, 'created', v_created, 'activated', v_activated);
END;
$func$;

COMMENT ON FUNCTION public.rollback_cadence_version (uuid, text, uuid, uuid, text, timestamptz, text) IS
  'Copies an earlier cadence version, escalation version, or both forward into a new version and puts it in force. Never deletes a version and never rewrites effective_from on a version that was in force, per spec 25A section 6.11, so undoing a mistake leaves a past compliance report reproducible. Delegates to public.create_cadence_version and public.activate_cadence_version rather than writing versions itself, so the timeline invariant and the six hard blocks apply to a rollback exactly as they apply to a forward change. COL-37 ruling: switch to invoker -- every read it makes is a cadence or escalation row the caller already holds through the facility scoped SELECT policies, and every write goes through one of the two definer commands above, each of which gates itself. Definer rights would add nothing here and would let a future edit to this body write on nobody''s authority. The role gate on haven.can_edit_observation_config stays in the body so the refusal names the reason rather than filtering to zero rows.';

REVOKE ALL ON FUNCTION public.rollback_cadence_version (uuid, text, uuid, uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rollback_cadence_version (uuid, text, uuid, uuid, text, timestamptz, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.apply_template_to_facilities
--
-- Spec 6.8. One new version per facility, each independently effective dated,
-- each pointed at the template it came from, so the drift view reads zero
-- afterwards. Acceptance item 21.
--
-- Each facility is applied inside its own exception block, so a building that
-- refuses the change is reported by id rather than aborting the fan out for the
-- other four. A template applied to three facilities that silently applied to
-- two would be the fan out version of the defect this module exists to remove.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_template_to_facilities (p_facility_ids uuid[], p_change_reason text, p_cadence_template_id uuid DEFAULT NULL, p_escalation_template_id uuid DEFAULT NULL, p_apply_mode text DEFAULT 'next_shift_boundary', p_effective_from timestamptz DEFAULT NULL, p_acknowledgment text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_windows jsonb := NULL;
  v_rungs jsonb := NULL;
  v_facility_id uuid;
  v_created jsonb;
  v_activated jsonb;
  v_outcomes jsonb := '[]'::jsonb;
  v_template_name text;
  v_facility_name text;
  v_succeeded integer := 0;
  v_failed integer := 0;
BEGIN
  IF p_change_reason IS NULL OR btrim(p_change_reason) = '' THEN
    RAISE EXCEPTION 'Applying a template needs a reason. Say what changed in the template and why it is being pushed out'
      USING ERRCODE = '22023';
  END IF;

  IF p_cadence_template_id IS NULL AND p_escalation_template_id IS NULL THEN
    RAISE EXCEPTION 'apply_template_to_facilities needs a cadence template, an escalation template, or both'
      USING ERRCODE = '22023';
  END IF;

  IF p_facility_ids IS NULL OR array_length(p_facility_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Name the buildings the template is being applied to'
      USING ERRCODE = '22023';
  END IF;

  IF haven.app_role ()::text NOT IN ('owner', 'org_admin') THEN
    RAISE EXCEPTION 'Applying an organization template needs an organization administrator or the owner'
      USING ERRCODE = '42501';
  END IF;

  -- The acknowledgment for a fan out is the template name, typed once, and this
  -- is the only place it is checked.
  --
  -- public.activate_cadence_version asks for the building name because a direct
  -- edit is a decision about one building. A fan out is a decision about a
  -- template, and asking an administrator to type five building names in turn
  -- would either be skipped or automated, which is how a confirmation stops
  -- being one. Typing the template name is the stronger gate for an
  -- organization level action, and the per building diff preview spec 6.8 asks
  -- for is what the administrator reads before typing it. Each building's own
  -- name is then supplied to the per facility activation below, so that gate
  -- keeps working exactly as written for every other caller.
  IF p_acknowledgment IS NOT NULL THEN
    SELECT
      name INTO v_template_name
    FROM (
      SELECT
        t.name
      FROM
        public.cadence_templates t
      WHERE
        t.id = p_cadence_template_id
        AND t.organization_id = haven.organization_id ()
        AND t.deleted_at IS NULL
      UNION ALL
      SELECT
        t.name
      FROM
        public.escalation_templates t
      WHERE
        t.id = p_escalation_template_id
        AND t.organization_id = haven.organization_id ()
        AND t.deleted_at IS NULL) named
    WHERE
      lower(btrim(name)) = lower(btrim(p_acknowledgment))
    LIMIT 1;

    IF v_template_name IS NULL THEN
      RAISE EXCEPTION 'That acknowledgment does not match the name of either template being applied. Type the template name exactly to confirm'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_cadence_template_id IS NOT NULL THEN
    SELECT
      jsonb_agg (jsonb_build_object('window_key', w.window_key, 'label', w.label, 'due_at_local', to_char(w.due_at_local, 'HH24:MI'), 'grace_before_minutes', w.grace_before_minutes, 'grace_after_minutes', w.grace_after_minutes, 'shift_key', w.shift_key, 'sort_order', w.sort_order, 'enabled', w.enabled)
        ORDER BY w.sort_order, w.due_at_local) INTO v_windows
    FROM
      public.cadence_template_windows w
      JOIN public.cadence_template_versions tv ON tv.id = w.cadence_template_version_id
    WHERE
      tv.cadence_template_id = p_cadence_template_id
      AND tv.status = 'active'
      AND tv.deleted_at IS NULL
      AND tv.organization_id = haven.organization_id ()
      AND w.deleted_at IS NULL;

    IF v_windows IS NULL THEN
      RAISE EXCEPTION 'That cadence template has no active version with windows on it'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_escalation_template_id IS NOT NULL THEN
    SELECT
      jsonb_agg (jsonb_build_object('rung_key', r.rung_key, 'label', r.label, 'offset_minutes', r.offset_minutes, 'is_terminal', r.is_terminal, 'assigned_staff_only', r.assigned_staff_only, 'include_assigned_staff', r.include_assigned_staff, 'use_standing_alert_routes', r.use_standing_alert_routes, 'target_staff_roles', to_jsonb (r.target_staff_roles), 'channels', to_jsonb (r.channels), 'protocol_text', r.protocol_text, 'sort_order', r.sort_order, 'enabled', r.enabled)
        ORDER BY r.sort_order, r.rung_key) INTO v_rungs
    FROM
      public.escalation_template_rungs r
      JOIN public.escalation_template_versions tv ON tv.id = r.escalation_template_version_id
    WHERE
      tv.escalation_template_id = p_escalation_template_id
      AND tv.status = 'active'
      AND tv.deleted_at IS NULL
      AND tv.organization_id = haven.organization_id ()
      AND r.deleted_at IS NULL;

    IF v_rungs IS NULL THEN
      RAISE EXCEPTION 'That escalation template has no active version with rungs on it'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  FOREACH v_facility_id IN ARRAY p_facility_ids LOOP
    BEGIN
      SELECT
        f.name INTO v_facility_name
      FROM
        public.facilities f
      WHERE
        f.id = v_facility_id
        AND f.deleted_at IS NULL;

      v_created := public.create_cadence_version (p_facility_id := v_facility_id, p_change_reason := p_change_reason, p_windows := v_windows, p_escalation_rungs := v_rungs, p_effective_from := p_effective_from, p_source_cadence_template_id := p_cadence_template_id, p_source_escalation_template_id := p_escalation_template_id);

      v_activated := public.activate_cadence_version (p_change_reason := p_change_reason, p_cadence_version_id := (v_created ->> 'cadence_version_id')::uuid, p_escalation_version_id := (v_created ->> 'escalation_version_id')::uuid, p_apply_mode := p_apply_mode, p_effective_from := p_effective_from, p_acknowledgment := CASE WHEN v_template_name IS NOT NULL THEN
          v_facility_name
        END);

      v_succeeded := v_succeeded + 1;
      v_outcomes := v_outcomes || jsonb_build_object('facility_id', v_facility_id, 'ok', TRUE, 'cadence_version_id', v_created ->> 'cadence_version_id', 'escalation_version_id', v_created ->> 'escalation_version_id', 'effective_from', v_activated ->> 'effective_from');
    EXCEPTION
      WHEN OTHERS THEN
        -- The subtransaction this block opens rolls back only this building's
        -- work. The other buildings keep theirs, and this one is reported by id
        -- rather than disappearing into a cheerful total.
        v_failed := v_failed + 1;
        v_outcomes := v_outcomes || jsonb_build_object('facility_id', v_facility_id, 'ok', FALSE, 'reason', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', v_failed = 0, 'cadence_template_id', p_cadence_template_id, 'escalation_template_id', p_escalation_template_id, 'apply_mode', p_apply_mode, 'facilities_attempted', array_length(p_facility_ids, 1), 'facilities_succeeded', v_succeeded, 'facilities_failed', v_failed, 'facilities', v_outcomes);
END;
$func$;

COMMENT ON FUNCTION public.apply_template_to_facilities (uuid[], text, uuid, uuid, text, timestamptz, text) IS
  'Applies an organization cadence template, escalation template, or both to a list of buildings, creating one new version per facility, each independently effective dated and each pointed at the template it came from, so the portfolio drift view reads zero afterwards. Spec 25A section 6.8 and acceptance item 21. Each building is applied in its own exception block: one that refuses is reported by id rather than aborting the fan out, because a template that silently applied to two buildings out of three and reported success is the fan out form of the defect this module exists to remove. The acknowledgment for a fan out is the template name typed once, not five building names in turn, and each building''s own name is supplied to the per facility activation so that gate keeps working as written. COL-37 ruling: switch to invoker -- it reads organization template rows and facility names the caller already holds, and every write goes through public.create_cadence_version and public.activate_cadence_version, each of which gates itself. A building the caller cannot reach comes back with no name, the per facility activation refuses it, and it is reported as a failure rather than silently applied.';

REVOKE ALL ON FUNCTION public.apply_template_to_facilities (uuid[], text, uuid, uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_template_to_facilities (uuid[], text, uuid, uuid, text, timestamptz, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The portfolio settings view
--
-- Spec 6.8's last bullet: every facility, the template each is on, custom or
-- inherited, and drift from the template.
--
-- Drift is measured by comparing the window set in force against the template's
-- active window set, column by column, in both directions. A count rather than
-- a boolean, because "this building differs from the template in one window"
-- and "this building differs in all six" are different situations and a boolean
-- makes them look alike.
--
-- security_invoker, so the reader sees exactly the buildings their own row level
-- security grants them. A portfolio view is the surface most likely to leak a
-- building, and a definer view would hand every facility to whoever asked.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_facility_config_template_drift;

-- The measurement takes the instant it measures at, because a building can be
-- on a template and already carrying a scheduled change that is not in force
-- yet, and "does this building match its template" has a different answer at
-- those two instants. The view below reads it at now(), which is what a
-- portfolio settings page wants; the acceptance script reads it at the instant a
-- fan out takes effect, which is what proves the fan out landed.
--
-- Invoker rights, deliberately not SECURITY DEFINER, so row level security on
-- public.facilities and the configuration tables scopes the caller to their own
-- buildings. A portfolio read is the surface most likely to leak a building.
CREATE OR REPLACE FUNCTION public.facility_config_template_drift (p_at timestamptz DEFAULT now(), p_facility_id uuid DEFAULT NULL)
  RETURNS TABLE (
    organization_id uuid,
    facility_id uuid,
    facility_name text,
    cadence_version_id uuid,
    escalation_version_id uuid,
    cadence_template_id uuid,
    cadence_template_name text,
    escalation_template_id uuid,
    escalation_template_name text,
    on_cadence_template boolean,
    on_escalation_template boolean,
    cadence_drift_count bigint,
    escalation_drift_count bigint)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
WITH in_force AS (
  SELECT
    f.id AS facility_id,
    f.organization_id,
    f.name AS facility_name,
    public.facility_cadence_in_force (f.id, p_at) AS cadence_version_id,
    public.facility_escalation_in_force (f.id, p_at) AS escalation_version_id
  FROM
    public.facilities f
  WHERE
    f.deleted_at IS NULL
    AND (p_facility_id IS NULL OR f.id = p_facility_id)
),
bound AS (
  SELECT
    i.*,
    b.cadence_template_id,
    b.escalation_template_id,
    ct.name AS cadence_template_name,
    et.name AS escalation_template_name,
    ctv.id AS cadence_template_version_id,
    etv.id AS escalation_template_version_id
  FROM
    in_force i
    LEFT JOIN public.facility_config_template_bindings b ON b.facility_id = i.facility_id
      AND b.deleted_at IS NULL
    LEFT JOIN public.cadence_templates ct ON ct.id = b.cadence_template_id
      AND ct.deleted_at IS NULL
    LEFT JOIN public.escalation_templates et ON et.id = b.escalation_template_id
      AND et.deleted_at IS NULL
    LEFT JOIN public.cadence_template_versions ctv ON ctv.cadence_template_id = ct.id
      AND ctv.status = 'active'
      AND ctv.deleted_at IS NULL
    LEFT JOIN public.escalation_template_versions etv ON etv.escalation_template_id = et.id
      AND etv.status = 'active'
      AND etv.deleted_at IS NULL
)
SELECT
  b.organization_id,
  b.facility_id,
  b.facility_name,
  b.cadence_version_id,
  b.escalation_version_id,
  b.cadence_template_id,
  b.cadence_template_name,
  b.escalation_template_id,
  b.escalation_template_name,
  (b.cadence_template_id IS NOT NULL) AS on_cadence_template,
  (b.escalation_template_id IS NOT NULL) AS on_escalation_template,
  CASE WHEN b.cadence_template_id IS NULL THEN
    NULL
  ELSE
    (
      SELECT
        count(*)
      FROM ((
          SELECT
            w.window_key,
            w.label,
            w.due_at_local,
            w.grace_before_minutes,
            w.grace_after_minutes,
            w.shift_key,
            w.enabled
          FROM
            public.facility_cadence_windows w
          WHERE
            w.cadence_version_id = b.cadence_version_id
            AND w.deleted_at IS NULL)
        EXCEPT ALL (
          SELECT
            tw.window_key,
            tw.label,
            tw.due_at_local,
            tw.grace_before_minutes,
            tw.grace_after_minutes,
            tw.shift_key,
            tw.enabled
          FROM
            public.cadence_template_windows tw
          WHERE
            tw.cadence_template_version_id = b.cadence_template_version_id
            AND tw.deleted_at IS NULL)
        UNION ALL (
          SELECT
            tw.window_key,
            tw.label,
            tw.due_at_local,
            tw.grace_before_minutes,
            tw.grace_after_minutes,
            tw.shift_key,
            tw.enabled
          FROM
            public.cadence_template_windows tw
          WHERE
            tw.cadence_template_version_id = b.cadence_template_version_id
            AND tw.deleted_at IS NULL
          EXCEPT ALL
          SELECT
            w.window_key,
            w.label,
            w.due_at_local,
            w.grace_before_minutes,
            w.grace_after_minutes,
            w.shift_key,
            w.enabled
          FROM
            public.facility_cadence_windows w
          WHERE
            w.cadence_version_id = b.cadence_version_id
            AND w.deleted_at IS NULL)) difference)
  END AS cadence_drift_count,
  CASE WHEN b.escalation_template_id IS NULL THEN
    NULL
  ELSE
    (
      SELECT
        count(*)
      FROM ((
          SELECT
            r.rung_key,
            r.label,
            r.offset_minutes,
            r.is_terminal,
            r.assigned_staff_only,
            r.include_assigned_staff,
            r.use_standing_alert_routes,
            r.target_staff_roles,
            r.channels,
            r.enabled
          FROM
            public.facility_escalation_rungs r
          WHERE
            r.escalation_version_id = b.escalation_version_id
            AND r.deleted_at IS NULL)
        EXCEPT ALL (
          SELECT
            tr.rung_key,
            tr.label,
            tr.offset_minutes,
            tr.is_terminal,
            tr.assigned_staff_only,
            tr.include_assigned_staff,
            tr.use_standing_alert_routes,
            tr.target_staff_roles,
            tr.channels,
            tr.enabled
          FROM
            public.escalation_template_rungs tr
          WHERE
            tr.escalation_template_version_id = b.escalation_template_version_id
            AND tr.deleted_at IS NULL)
        UNION ALL (
          SELECT
            tr.rung_key,
            tr.label,
            tr.offset_minutes,
            tr.is_terminal,
            tr.assigned_staff_only,
            tr.include_assigned_staff,
            tr.use_standing_alert_routes,
            tr.target_staff_roles,
            tr.channels,
            tr.enabled
          FROM
            public.escalation_template_rungs tr
          WHERE
            tr.escalation_template_version_id = b.escalation_template_version_id
            AND tr.deleted_at IS NULL
          EXCEPT ALL
          SELECT
            r.rung_key,
            r.label,
            r.offset_minutes,
            r.is_terminal,
            r.assigned_staff_only,
            r.include_assigned_staff,
            r.use_standing_alert_routes,
            r.target_staff_roles,
            r.channels,
            r.enabled
          FROM
            public.facility_escalation_rungs r
          WHERE
            r.escalation_version_id = b.escalation_version_id
            AND r.deleted_at IS NULL)) difference)
  END AS escalation_drift_count
FROM
  bound b;
$func$;

COMMENT ON FUNCTION public.facility_config_template_drift (timestamptz, uuid) IS
  'One row per building at one instant: the cadence and escalation versions in force then, the organization template each building is on or null for custom, and how many window or rung rows differ from that template in either direction. Spec 25A section 6.8 portfolio settings view and acceptance item 21. A count rather than a boolean, because differing in one window and differing in all six are different situations. Invoker rights, so a reader sees exactly the buildings their own row level security grants them.';

REVOKE ALL ON FUNCTION public.facility_config_template_drift (timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_config_template_drift (timestamptz, uuid) TO authenticated, service_role;

CREATE VIEW public.v_facility_config_template_drift WITH ( security_invoker = TRUE
) AS
SELECT
  d.organization_id,
  d.facility_id,
  d.facility_name,
  d.cadence_version_id,
  d.escalation_version_id,
  d.cadence_template_id,
  d.cadence_template_name,
  d.escalation_template_id,
  d.escalation_template_name,
  d.on_cadence_template,
  d.on_escalation_template,
  d.cadence_drift_count,
  d.escalation_drift_count
FROM
  public.facility_config_template_drift (now(), NULL) d;

COMMENT ON VIEW public.v_facility_config_template_drift IS
  'The portfolio settings view of spec 25A section 6.8, reading public.facility_config_template_drift at now(). security_invoker, so a reader sees exactly the buildings their own row level security grants them.';

REVOKE ALL ON public.v_facility_config_template_drift FROM PUBLIC, anon;
GRANT SELECT ON public.v_facility_config_template_drift TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The replay, one body, used for both sides of the comparison
--
-- Decision D13 and build notes 4b: absorption is expectation derived, never row
-- derived, so a replay may not count task rows. The set of resident days comes
-- straight out of public.observation_compliance_for_range, which is the single
-- authority on which resident day is expected and which is not, and the only
-- thing this function substitutes is the window projection. Re-deriving
-- occupancy here would reintroduce the exact defect that function exists to
-- fix, in a place nobody would look for it.
--
-- A null cadence version means "whatever was in force on that date", which is
-- the baseline side; a version id means "project this proposal onto the same
-- resident days", which is the proposed side. One body, so the two sides cannot
-- be measured by two different methods and the difference read as a difference
-- in configuration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.replay_observation_windows (p_facility_id uuid, p_from date, p_to date, p_cadence_version_id uuid DEFAULT NULL, p_escalation_version_id uuid DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_tz text;
  v_escalation_version uuid;
  v_result jsonb;
BEGIN
  SELECT
    COALESCE(f.timezone, 'America/New_York') INTO v_tz
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'Facility not found'
      USING ERRCODE = '22023';
  END IF;

  v_escalation_version := COALESCE(p_escalation_version_id, public.facility_escalation_in_force (p_facility_id, now()));

  WITH resident_day AS (
    SELECT DISTINCT
      c.resident_id,
      c.service_date
    FROM
      public.observation_compliance_for_range (p_facility_id, p_from, p_to) c
),
  projected AS (
    SELECT
      rd.resident_id,
      rd.service_date,
      w.cadence_version_id,
      w.window_key,
      w.label,
      w.shift_key,
      w.due_at_utc,
      w.window_opens_at_utc,
      w.window_closes_at_utc
    FROM
      resident_day rd
      CROSS JOIN LATERAL public.facility_observation_windows_for_version (p_facility_id, COALESCE(p_cadence_version_id, public.facility_cadence_in_force (p_facility_id, (rd.service_date::timestamp AT TIME ZONE v_tz))), rd.service_date) w
),
  satisfaction AS (
    SELECT
      p.*,
      l.id AS log_id,
      l.observed_at
    FROM
      projected p
      LEFT JOIN LATERAL (
        SELECT
          lg.id,
          lg.observed_at
        FROM
          public.resident_observation_logs lg
        WHERE
          lg.resident_id = p.resident_id
          AND lg.deleted_at IS NULL
          AND lg.observed_at >= p.window_opens_at_utc
          AND lg.observed_at < p.window_closes_at_utc
        ORDER BY
          lg.observed_at
        LIMIT 1) l ON TRUE
),
  rung AS (
    SELECT
      r.id AS rung_id,
      r.rung_key,
      r.label,
      r.offset_minutes,
      r.assigned_staff_only,
      r.sort_order
    FROM
      public.facility_escalation_rungs r
    WHERE
      r.escalation_version_id = v_escalation_version
      AND r.deleted_at IS NULL
      AND r.enabled
),
  fired AS (
    SELECT
      r.rung_key,
      r.label,
      r.assigned_staff_only,
      r.sort_order,
      count(*) FILTER (WHERE s.log_id IS NULL
        OR s.observed_at > s.window_closes_at_utc + make_interval(mins => COALESCE(ov.offset_minutes, r.offset_minutes))) AS fired_count
    FROM
      rung r
      CROSS JOIN satisfaction s
      LEFT JOIN public.facility_escalation_rung_shift_overrides ov ON ov.escalation_rung_id = r.rung_id
        AND ov.shift_key = s.shift_key
        AND ov.deleted_at IS NULL
    GROUP BY
      r.rung_key,
      r.label,
      r.assigned_staff_only,
      r.sort_order
)
  SELECT
    jsonb_build_object('cadence_version_id', p_cadence_version_id, 'escalation_version_id', v_escalation_version, 'resident_days', (
        SELECT
          count(*)
        FROM resident_day), 'windows_generated', (
      SELECT
        count(*)
      FROM satisfaction), 'would_be_satisfied', (
      SELECT
        count(*)
      FROM
        satisfaction
      WHERE
        log_id IS NOT NULL), 'would_be_missed', (
      SELECT
        count(*)
      FROM
        satisfaction
      WHERE
        log_id IS NULL), 'missed_by_shift', COALESCE((
        SELECT
          jsonb_agg (jsonb_build_object('shift_key', shift_key, 'missed', missed)
          ORDER BY shift_key)
        FROM (
          SELECT
            shift_key,
            count(*) FILTER (WHERE log_id IS NULL) AS missed
          FROM
            satisfaction
          GROUP BY
            shift_key) by_shift), '[]'::jsonb), 'escalations_by_rung', COALESCE((
        SELECT
          jsonb_agg (jsonb_build_object('rung_key', rung_key, 'label', label, 'fired', fired_count)
          ORDER BY sort_order, rung_key)
        FROM
          fired
        WHERE
          NOT assigned_staff_only), '[]'::jsonb), 'escalations_total', COALESCE((
        SELECT
          sum(fired_count)
        FROM
          fired
        WHERE
          NOT assigned_staff_only), 0), 'nudges_total', COALESCE((
        SELECT
          sum(fired_count)
        FROM
          fired
        WHERE
          assigned_staff_only), 0)) INTO v_result;

  RETURN v_result;
END;
$func$;

COMMENT ON FUNCTION haven.replay_observation_windows (uuid, date, date, uuid, uuid) IS
  'Replays one cadence and escalation configuration against the observations a building actually recorded over a date range, and reports windows generated, satisfied, missed by shift, and rungs that would have fired. The resident days come from public.observation_compliance_for_range rather than from task rows, because absorption is expectation derived and a resident on a Monitoring Order has no standard task to count. A null cadence version replays whatever was in force on each date, which is the baseline; a version id replays that proposal onto the same resident days. One body, so the two sides of a simulation cannot be measured by two different methods. A nudge is counted separately and never in the escalation total.';

REVOKE ALL ON FUNCTION haven.replay_observation_windows (uuid, date, date, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION haven.replay_observation_windows (uuid, date, date, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- public.simulate_cadence_change
--
-- Spec 6.7. Runs the proposed configuration against the last N days of actual
-- observations and reports what would have happened, beside what was actually
-- recorded.
--
-- The honesty note is part of the payload, not a decoration on the surface. The
-- replay assumes staff behavior is unchanged, and staff behavior changes when
-- the schedule changes, so this is a measurement against past behavior and not
-- a prediction. The surface says so in one line and never presents it as a
-- forecast; the flag is here so a caller cannot render it as one by accident.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.simulate_cadence_change (p_facility_id uuid, p_proposed_cadence_version_id uuid DEFAULT NULL, p_proposed_escalation_version_id uuid DEFAULT NULL, p_lookback_days integer DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_tz text;
  v_lookback integer;
  v_from date;
  v_to date;
  v_recorded record;
  v_in_force jsonb;
  v_proposed jsonb;
  v_recorded_escalations integer;
BEGIN
  IF NOT haven.can_read_observation_config (p_facility_id) THEN
    RAISE EXCEPTION 'Simulating an observation configuration change needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  IF p_proposed_cadence_version_id IS NULL AND p_proposed_escalation_version_id IS NULL THEN
    RAISE EXCEPTION 'A simulation needs a proposed cadence version, a proposed escalation version, or both'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(f.timezone, 'America/New_York') INTO v_tz
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'Facility not found'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(p_lookback_days, t.simulation_lookback_days) INTO v_lookback
  FROM
    public.facility_observation_thresholds t
  WHERE
    t.facility_id = p_facility_id
    AND t.deleted_at IS NULL;

  v_lookback := COALESCE(v_lookback, p_lookback_days);

  IF v_lookback IS NULL THEN
    RAISE EXCEPTION 'This building has no simulation lookback configured, so name the number of days to replay'
      USING ERRCODE = '22023';
  END IF;

  IF v_lookback < 1 OR v_lookback > 366 THEN
    RAISE EXCEPTION 'A simulation lookback of % days is outside the 1 to 366 day range the compliance read answers for', v_lookback
      USING ERRCODE = '22023';
  END IF;

  -- Complete days only. Today is still being worked and would read as a day of
  -- missed checks that nobody has missed yet.
  v_to := ((now() AT TIME ZONE v_tz)::date - 1);
  v_from := v_to - (v_lookback - 1);

  SELECT
    count(*) AS expected,
    count(*) FILTER (WHERE c.satisfied) AS satisfied,
    count(*) FILTER (WHERE NOT c.satisfied
      AND c.expectation_source <> 'no_cadence') AS missed,
    count(*) FILTER (WHERE c.expectation_source = 'no_cadence') AS unconfigured INTO v_recorded
  FROM
    public.observation_compliance_for_range (p_facility_id, v_from, v_to) c;

  SELECT
    count(*) INTO v_recorded_escalations
  FROM
    public.resident_observation_escalations e
  WHERE
    e.facility_id = p_facility_id
    AND e.deleted_at IS NULL
    AND e.triggered_at >= (v_from::timestamp AT TIME ZONE v_tz)
    AND e.triggered_at < ((v_to + 1)::timestamp AT TIME ZONE v_tz);

  v_in_force := haven.replay_observation_windows (p_facility_id, v_from, v_to, NULL, NULL);
  v_proposed := haven.replay_observation_windows (p_facility_id, v_from, v_to, p_proposed_cadence_version_id, p_proposed_escalation_version_id);

  RETURN jsonb_build_object('facility_id', p_facility_id, 'lookback_days', v_lookback, 'from_service_date', v_from, 'to_service_date', v_to, 'is_measurement_not_forecast', TRUE, 'measurement_note', 'This replays the proposed schedule against the observations staff actually recorded. Staff behavior changes when the schedule changes, so it measures the past and does not predict the future.', 'recorded', jsonb_build_object('expected', v_recorded.expected, 'satisfied', v_recorded.satisfied, 'missed', v_recorded.missed, 'unconfigured', v_recorded.unconfigured, 'escalations', v_recorded_escalations), 'in_force', v_in_force, 'proposed', v_proposed, 'change', jsonb_build_object('missed_delta', (v_proposed ->> 'would_be_missed')::integer - (v_in_force ->> 'would_be_missed')::integer, 'windows_delta', (v_proposed ->> 'windows_generated')::integer - (v_in_force ->> 'windows_generated')::integer, 'escalations_delta', (v_proposed ->> 'escalations_total')::integer - (v_in_force ->> 'escalations_total')::integer, 'nudges_delta', (v_proposed ->> 'nudges_total')::integer - (v_in_force ->> 'nudges_total')::integer));
END;
$func$;

COMMENT ON FUNCTION public.simulate_cadence_change (uuid, uuid, uuid, integer) IS
  'Replays a proposed cadence and escalation configuration against the observations a building actually recorded, over the lookback the building configures, and reports windows generated, would have been satisfied, would have been missed in total and by shift, escalations by rung, and the same numbers for the configuration in force. Spec 25A section 6.7 and acceptance item 18. Compliance is read through public.observation_compliance_for_range and never by counting task rows. It carries is_measurement_not_forecast and a sentence saying so, because the replay assumes staff behavior is unchanged and staff behavior changes when the schedule does; the surface renders that line and never presents this as a prediction. COL-37 ruling: definer required, because the replay reads public.resident_observation_logs and the escalation ledger across the building and composes only counts.';

REVOKE ALL ON FUNCTION public.simulate_cadence_change (uuid, uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.simulate_cadence_change (uuid, uuid, uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tier 3: the change log with reasons
--
-- Spec 6.11. Who, when, what changed and why, with the rows on either side of
-- the change so the surface can draw a diff without a second round trip per
-- entry. The page size is read from the facility row, so the settings surface
-- carries no number of its own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.observation_config_change_log (p_facility_id uuid, p_limit integer DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_limit integer;
  v_result jsonb;
BEGIN
  IF NOT haven.can_read_observation_config (p_facility_id) THEN
    RAISE EXCEPTION 'Reading the observation configuration change log needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(p_limit, t.change_log_page_size) INTO v_limit
  FROM
    public.facility_observation_thresholds t
  WHERE
    t.facility_id = p_facility_id
    AND t.deleted_at IS NULL;

  v_limit := COALESCE(v_limit, p_limit);

  IF v_limit IS NULL OR v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'The change log page size has to be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(jsonb_agg (entry ORDER BY created_at DESC, version_number DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      v.created_at,
      v.version_number,
      jsonb_build_object('kind', 'cadence', 'version_id', v.id, 'version_number', v.version_number, 'status', v.status, 'effective_from', v.effective_from, 'effective_to', v.effective_to, 'change_reason', v.change_reason, 'activation_reason', v.activation_reason, 'apply_mode', v.apply_mode, 'created_at', v.created_at, 'created_by_name', cp.full_name, 'activated_at', v.activated_at, 'activated_by_name', ap.full_name, 'source_template_id', v.source_template_id, 'rows', COALESCE((
            SELECT
              jsonb_agg (jsonb_build_object('window_key', w.window_key, 'label', w.label, 'due_at_local', to_char(w.due_at_local, 'HH24:MI'), 'grace_before_minutes', w.grace_before_minutes, 'grace_after_minutes', w.grace_after_minutes, 'shift_key', w.shift_key, 'enabled', w.enabled)
              ORDER BY w.sort_order, w.due_at_local)
            FROM public.facility_cadence_windows w
            WHERE
              w.cadence_version_id = v.id
              AND w.deleted_at IS NULL), '[]'::jsonb), 'previous_rows', COALESCE((
            SELECT
              jsonb_agg (jsonb_build_object('window_key', w.window_key, 'label', w.label, 'due_at_local', to_char(w.due_at_local, 'HH24:MI'), 'grace_before_minutes', w.grace_before_minutes, 'grace_after_minutes', w.grace_after_minutes, 'shift_key', w.shift_key, 'enabled', w.enabled)
              ORDER BY w.sort_order, w.due_at_local)
            FROM public.facility_cadence_windows w
            WHERE
              w.cadence_version_id = (
                SELECT
                  prev.id
                FROM
                  public.facility_cadence_versions prev
                WHERE
                  prev.facility_id = v.facility_id
                  AND prev.version_number < v.version_number
                  AND prev.deleted_at IS NULL
                ORDER BY
                  prev.version_number DESC
                LIMIT 1)
              AND w.deleted_at IS NULL), '[]'::jsonb)) AS entry
    FROM
      public.facility_cadence_versions v
      LEFT JOIN public.user_profiles cp ON cp.id = v.created_by
      LEFT JOIN public.user_profiles ap ON ap.id = v.activated_by
    WHERE
      v.facility_id = p_facility_id
      AND v.deleted_at IS NULL
    UNION ALL
    SELECT
      v.created_at,
      v.version_number,
      jsonb_build_object('kind', 'escalation', 'version_id', v.id, 'version_number', v.version_number, 'status', v.status, 'effective_from', v.effective_from, 'effective_to', v.effective_to, 'change_reason', v.change_reason, 'activation_reason', v.activation_reason, 'apply_mode', v.apply_mode, 'created_at', v.created_at, 'created_by_name', cp.full_name, 'activated_at', v.activated_at, 'activated_by_name', ap.full_name, 'source_template_id', v.source_template_id, 'rows', COALESCE((
            SELECT
              jsonb_agg (jsonb_build_object('rung_key', r.rung_key, 'label', r.label, 'offset_minutes', r.offset_minutes, 'is_terminal', r.is_terminal, 'channels', to_jsonb (r.channels), 'target_staff_roles', to_jsonb (r.target_staff_roles), 'enabled', r.enabled)
              ORDER BY r.sort_order, r.rung_key)
            FROM public.facility_escalation_rungs r
            WHERE
              r.escalation_version_id = v.id
              AND r.deleted_at IS NULL), '[]'::jsonb), 'previous_rows', COALESCE((
            SELECT
              jsonb_agg (jsonb_build_object('rung_key', r.rung_key, 'label', r.label, 'offset_minutes', r.offset_minutes, 'is_terminal', r.is_terminal, 'channels', to_jsonb (r.channels), 'target_staff_roles', to_jsonb (r.target_staff_roles), 'enabled', r.enabled)
              ORDER BY r.sort_order, r.rung_key)
            FROM public.facility_escalation_rungs r
            WHERE
              r.escalation_version_id = (
                SELECT
                  prev.id
                FROM
                  public.facility_escalation_versions prev
                WHERE
                  prev.facility_id = v.facility_id
                  AND prev.version_number < v.version_number
                  AND prev.deleted_at IS NULL
                ORDER BY
                  prev.version_number DESC
                LIMIT 1)
              AND r.deleted_at IS NULL), '[]'::jsonb)) AS entry
    FROM
      public.facility_escalation_versions v
      LEFT JOIN public.user_profiles cp ON cp.id = v.created_by
      LEFT JOIN public.user_profiles ap ON ap.id = v.activated_by
    WHERE
      v.facility_id = p_facility_id
      AND v.deleted_at IS NULL
    ORDER BY
      1 DESC,
      2 DESC
    LIMIT v_limit) log;

  RETURN v_result;
END;
$func$;

COMMENT ON FUNCTION public.observation_config_change_log (uuid, integer) IS
  'The most recent observation configuration changes at one building, cadence and escalation together: who, when, what changed, why it changed, why it was put in force, and the rows on either side of the change so a diff renders without a round trip per entry. Spec 25A section 6.11. The page size comes from public.facility_observation_thresholds so the settings surface carries no number of its own. COL-37 ruling: definer required, because it resolves actor names from public.user_profiles, which a facility administrator holds no row on for an organization level actor. The body gates on haven.can_read_observation_config and writes nothing.';

REVOKE ALL ON FUNCTION public.observation_config_change_log (uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.observation_config_change_log (uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tier 1, and the preview of spec 6.6
--
-- One read for the whole settings surface, so no part of it has to hold a time,
-- a grace value, an offset, a channel, a threshold or a resident count.
--
-- Called with no proposal it answers Tier 1: the 24 hour strip, the ladder in
-- wall clock terms, the template name or Custom, and the effective from date.
-- Called with a proposal it answers the preview: the same shape for current and
-- proposed side by side, the daily task total from the live active resident
-- count, the recipient resolution per rung, and the validation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.observation_config_overview (p_facility_id uuid, p_proposed_cadence_version_id uuid DEFAULT NULL, p_proposed_escalation_version_id uuid DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_org uuid;
  v_tz text;
  v_facility_name text;
  v_cadence uuid;
  v_escalation uuid;
  v_active_residents integer;
  v_shifts jsonb;
  v_binding record;
  v_current_cadence_row record;
  v_current_escalation_row record;
BEGIN
  IF NOT haven.can_read_observation_config (p_facility_id) THEN
    RAISE EXCEPTION 'Reading the observation configuration needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    f.organization_id,
    COALESCE(f.timezone, 'America/New_York'),
    f.name INTO v_org,
    v_tz,
    v_facility_name
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Facility not found'
      USING ERRCODE = '22023';
  END IF;

  v_cadence := public.facility_cadence_in_force (p_facility_id, now());
  v_escalation := public.facility_escalation_in_force (p_facility_id, now());

  SELECT
    count(*) INTO v_active_residents
  FROM
    public.residents r
  WHERE
    r.facility_id = p_facility_id
    AND r.deleted_at IS NULL
    AND r.status = 'active';

  SELECT
    COALESCE(jsonb_agg (jsonb_build_object('shift_key', s.shift_key, 'label', s.label, 'starts_at_local', to_char(s.starts_at_local, 'HH24:MI'), 'ends_at_local', to_char(s.ends_at_local, 'HH24:MI'), 'starts_minute', extract(hour FROM s.starts_at_local)::integer * 60 + extract(minute FROM s.starts_at_local)::integer, 'ends_minute', extract(hour FROM s.ends_at_local)::integer * 60 + extract(minute FROM s.ends_at_local)::integer)
      ORDER BY s.sort_order, s.shift_key), '[]'::jsonb) INTO v_shifts
  FROM
    public.facility_shift_definitions s
  WHERE
    s.facility_id = p_facility_id
    AND s.deleted_at IS NULL
    AND s.active;

  SELECT
    b.cadence_template_id,
    ct.name AS cadence_template_name,
    b.escalation_template_id,
    et.name AS escalation_template_name INTO v_binding
  FROM
    public.facility_config_template_bindings b
    LEFT JOIN public.cadence_templates ct ON ct.id = b.cadence_template_id
      AND ct.deleted_at IS NULL
    LEFT JOIN public.escalation_templates et ON et.id = b.escalation_template_id
      AND et.deleted_at IS NULL
  WHERE
    b.facility_id = p_facility_id
    AND b.deleted_at IS NULL;

  SELECT
    v.version_number,
    v.effective_from,
    v.change_reason,
    v.activation_reason INTO v_current_cadence_row
  FROM
    public.facility_cadence_versions v
  WHERE
    v.id = v_cadence;

  SELECT
    v.version_number,
    v.effective_from INTO v_current_escalation_row
  FROM
    public.facility_escalation_versions v
  WHERE
    v.id = v_escalation;

  RETURN jsonb_build_object('facility_id', p_facility_id, 'facility_name', v_facility_name, 'timezone', v_tz, 'active_resident_count', v_active_residents, 'shifts', v_shifts, 'cadence_template_id', v_binding.cadence_template_id, 'cadence_template_name', v_binding.cadence_template_name, 'escalation_template_id', v_binding.escalation_template_id, 'escalation_template_name', v_binding.escalation_template_name, 'jurisdiction_floor', public.facility_observation_jurisdiction_floor (p_facility_id), 'thresholds', (
      SELECT
        jsonb_build_object('maximum_unobserved_gap_minutes', t.maximum_unobserved_gap_minutes, 'maximum_windows_per_resident_per_day', t.maximum_windows_per_resident_per_day, 'simulation_lookback_days', t.simulation_lookback_days, 'change_log_page_size', t.change_log_page_size)
      FROM
        public.facility_observation_thresholds t
      WHERE
        t.facility_id = p_facility_id
        AND t.deleted_at IS NULL), 'current', jsonb_build_object('cadence_version_id', v_cadence, 'cadence_version_number', v_current_cadence_row.version_number, 'cadence_effective_from', v_current_cadence_row.effective_from, 'cadence_change_reason', v_current_cadence_row.change_reason, 'escalation_version_id', v_escalation, 'escalation_version_number', v_current_escalation_row.version_number, 'escalation_effective_from', v_current_escalation_row.effective_from, 'day_shape', CASE WHEN v_cadence IS NULL THEN
        NULL
      ELSE
        public.cadence_version_day_shape (v_cadence)
      END, 'daily_task_total', CASE WHEN v_cadence IS NULL THEN
        NULL
      ELSE
        v_active_residents * (public.cadence_version_day_shape (v_cadence) ->> 'windows_per_day')::integer
      END, 'ladder', CASE WHEN v_escalation IS NULL THEN
        '[]'::jsonb
      ELSE
        public.observation_escalation_role_holders (p_facility_id, v_escalation)
      END), 'proposed', CASE WHEN p_proposed_cadence_version_id IS NULL AND p_proposed_escalation_version_id IS NULL THEN
      NULL
    ELSE
      jsonb_build_object('cadence_version_id', p_proposed_cadence_version_id, 'escalation_version_id', p_proposed_escalation_version_id, 'day_shape', CASE WHEN p_proposed_cadence_version_id IS NULL THEN
          NULL
        ELSE
          public.cadence_version_day_shape (p_proposed_cadence_version_id)
        END, 'daily_task_total', CASE WHEN p_proposed_cadence_version_id IS NULL THEN
          NULL
        ELSE
          v_active_residents * (public.cadence_version_day_shape (p_proposed_cadence_version_id) ->> 'windows_per_day')::integer
        END, 'ladder', CASE WHEN p_proposed_escalation_version_id IS NULL THEN
          '[]'::jsonb
        ELSE
          public.observation_escalation_role_holders (p_facility_id, p_proposed_escalation_version_id)
        END, 'validation', public.validate_cadence_version (p_proposed_cadence_version_id, p_proposed_escalation_version_id))
    END, 'next_shift_boundary_at', public.facility_next_shift_boundary_at (p_facility_id, now()));
END;
$func$;

COMMENT ON FUNCTION public.observation_config_overview (uuid, uuid, uuid) IS
  'One read for the whole cadence settings surface. With no proposal it answers spec 25A tier 1: the 24 hour strip as minutes from local midnight, the escalation ladder with its recipient resolution, the template name or null for custom, the effective from date, the jurisdiction floor and the building''s thresholds. With a proposal it also answers the spec 6.6 preview: the same shape for the proposal, the daily task total computed from the live active resident count, and the validation. Everything the surface renders comes from a row, so no observation time, grace value, escalation offset, channel, threshold or shift boundary has to appear in a TypeScript file. COL-37 ruling: definer required, because the recipient resolution reads staff counts across the building; the body gates on haven.can_read_observation_config and writes nothing.';

REVOKE ALL ON FUNCTION public.observation_config_overview (uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.observation_config_overview (uuid, uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The scheduled activator's command
--
-- Spec section 9: cadence-version-activator is a scheduled tick that activates
-- scheduled cadence and escalation versions when effective_from passes, and
-- marks superseded versions. This is the command it calls; the Edge Function
-- holds no arithmetic, no threshold and no literal of its own.
--
-- Service only. There is no app_role in a cron context to gate on, so the
-- authorization happened when a human called public.activate_cadence_version
-- and set the version to scheduled with a reason on it. Nothing here can put a
-- version in force that an administrator did not already approve.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_due_scheduled_config_versions (p_organization_id uuid, p_facility_id uuid DEFAULT NULL, p_at timestamptz DEFAULT now())
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_row record;
  v_outcome jsonb;
  v_outcomes jsonb := '[]'::jsonb;
  v_activated integer := 0;
  v_failed integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'activate_due_scheduled_config_versions needs an organization'
      USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
  SELECT
    kind,
    version_id,
    facility_id,
    effective_from,
    apply_mode
  FROM (
    SELECT
      'cadence'::text AS kind,
      v.id AS version_id,
      v.facility_id,
      v.effective_from,
      v.apply_mode
    FROM
      public.facility_cadence_versions v
    WHERE
      v.organization_id = p_organization_id
      AND (p_facility_id IS NULL OR v.facility_id = p_facility_id)
      AND v.status = 'scheduled'
      AND v.deleted_at IS NULL
      AND v.effective_from <= p_at
    UNION ALL
    SELECT
      'escalation'::text,
      v.id,
      v.facility_id,
      v.effective_from,
      v.apply_mode
    FROM
      public.facility_escalation_versions v
    WHERE
      v.organization_id = p_organization_id
      AND (p_facility_id IS NULL OR v.facility_id = p_facility_id)
      AND v.status = 'scheduled'
      AND v.deleted_at IS NULL
      AND v.effective_from <= p_at) due
  -- Oldest first, so two versions scheduled at the same building activate in
  -- the order they were meant to take effect and the timeline never reverses.
  ORDER BY
    effective_from,
    version_id LOOP
      BEGIN
        v_outcome := haven.apply_observation_config_activation (v_row.kind, v_row.version_id, v_row.effective_from, NULL, v_row.kind = 'cadence');
        v_activated := v_activated + 1;
        v_outcomes := v_outcomes || (v_outcome || jsonb_build_object('ok', TRUE));
      EXCEPTION
        WHEN OTHERS THEN
          v_failed := v_failed + 1;
          v_outcomes := v_outcomes || jsonb_build_object('ok', FALSE, 'kind', v_row.kind, 'facility_id', v_row.facility_id, 'version_id', v_row.version_id, 'effective_from', v_row.effective_from, 'reason', SQLERRM);
      END;
    END LOOP;

  RETURN jsonb_build_object('ok', v_failed = 0, 'organization_id', p_organization_id, 'at', p_at, 'versions_due', v_activated + v_failed, 'versions_activated', v_activated, 'versions_failed', v_failed, 'versions', v_outcomes);
END;
$func$;

COMMENT ON FUNCTION public.activate_due_scheduled_config_versions (uuid, uuid, timestamptz) IS
  'Activates every scheduled cadence and escalation version whose effective_from has passed, oldest first so a building with two scheduled changes takes them in the order they were meant to happen. Goes through haven.apply_observation_config_activation, so the timeline invariant is the same one the operator command uses. Service only: there is no app_role in a cron context, and the authorization already happened when an administrator scheduled the version with a reason on it. A version that refuses is reported by id rather than aborting the tick, because a scheduled change that silently did not happen is worse than one that says it could not.';

REVOKE ALL ON FUNCTION public.activate_due_scheduled_config_versions (uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_due_scheduled_config_versions (uuid, uuid, timestamptz) TO service_role;

NOTIFY pgrst,
'reload schema';

COMMIT;
