-- Smart Rounding: the compliance read becomes a date spine, so a resident day
-- with no generated tasks reads as a defect instead of disappearing.
--
-- Spec: docs/specs/25A-smart-rounding-cadence-and-watchlist.md sections 4.3 and 5.
-- Replaces public.v_resident_observation_compliance from migration 414.
--
-- The defect, demonstrated rather than theorized.
-- ------------------------------------------------------------------
-- Migration 414 derived the set of resident days from two sources: days that
-- already carry standard cadence task rows, and days covered by a Monitoring
-- Order. A resident day with neither contributes no rows at all, so expected is
-- zero, satisfied is zero, and a dashboard reads zero over zero as a hundred
-- percent or as "no data". Three routes reach that state and all three are the
-- same class of failure, a silence that reads as health:
--
--   (a) the generator did not run, or errored for that facility. It catches per
--       facility exceptions into a log line, so the building simply has no
--       tasks for the day and the compliance read has nothing to draw the day
--       from.
--   (b) no cadence version is in force for the date. Both the resolver and the
--       projector return nothing, and because 414 projected through a
--       CROSS JOIN LATERAL the entire resident day was dropped rather than
--       reading as expected and unsatisfied. A Monitoring Order running from
--       09-10 to 09-20 produced compliance rows only from 09-16 onward, because
--       version 1's effective_from is 09-16. Six days of hourly checks on a
--       resident who had just fallen, silently absent from the record.
--   (c) a facility created after migrations 412 and 415 ran inherits no shift
--       model, no cadence version and no escalation version, and therefore
--       reads as nothing wrong at all.
--
-- The root cause is grain, not predicates. A view cannot generate a date spine,
-- and the question the module has to answer -- "was every expected check done"
-- -- is asked of a calendar, not of a table of rows that happen to exist. The
-- contract is therefore a parameterized set returning function over an explicit
-- date range, and the view is deleted rather than left beside it. Nothing
-- consumes the view yet, so replacing it now is cheap; replacing it after four
-- more parts build on it is not.
--
-- This file also closes route (c) at its source, by giving a facility a way to
-- inherit its organization's observation configuration on insert.

BEGIN;

-- ---------------------------------------------------------------------------
-- public.observation_compliance_for_range
--
-- The single compliance contract for the observation module. Every later part
-- calls this instead of counting task rows.
--
-- Signature
--   public.observation_compliance_for_range(p_facility_id uuid,
--                                           p_from date,
--                                           p_to date)
--
-- p_facility_id null means every facility the caller can reach, which is what
-- an organization level rollup wants. p_from and p_to are inclusive facility
-- local service dates. The range is capped at 366 days and a reversed range is
-- an error rather than an empty result, because an empty result from a
-- compliance read is the exact failure this function exists to remove.
--
-- Grain
--   One row per (resident_id, service_date, window_key), where the window is a
--   projected standard window occurrence, plus exactly one row per
--   (resident_id, service_date) with a null window_key when the resident day
--   projects no window at all.
--
--   Expected  = count(*)
--   Satisfied = count(*) FILTER (WHERE satisfied)
--
--   Never count resident_observation_tasks to get either number. A resident on
--   a 30 minute Monitoring Order has no standard task rows at all and still
--   produces six rows a day, which is the point of absorption; a resident whose
--   facility generated nothing has no task rows either and now produces six
--   unsatisfied rows rather than none.
--
-- Where the resident days come from, three sources unioned
--   1. occupancy. A date spine crossed with the residents who were in the
--      building on that date. This is the source migration 414 lacked and the
--      only one that can speak about a day nothing was written for.
--   2. days that carry standard cadence task rows.
--   3. days covered by a Monitoring Order.
--   Two and three are kept because a day outside the occupancy calculation that
--   nonetheless carries real tasks or a real order must still appear. Occupancy
--   is the floor, not the filter.
--
-- Occupancy, defined
--   A resident occupies a facility on a date when admission_date is on or
--   before it, discharge_date is null or on or after it, the resident is not
--   deleted, and status is neither inquiry nor pending_admission.
--
--   resident_status_history (migration 217) is used, but only to subtract days,
--   never to supply them. That is deliberate. 217 installs its capture trigger
--   without backfilling, so every resident admitted before it ran has no
--   history row until their status next changes. Driving occupancy from that
--   table would silently drop those residents from the compliance read, which
--   is the identical failure mode this migration exists to fix. Used
--   subtractively its incompleteness can only ever leave a day expected, which
--   is the direction that shows a defect rather than hides one. Where history
--   does exist it removes the days a resident was on hospital_hold, loa,
--   discharged, deceased or not yet admitted, so a resident in hospital does
--   not read as six missed checks a day.
--
--   One exclusion beyond that: a resident whose status is discharged or
--   deceased with no discharge_date and no history row at all has an unknown
--   occupancy end, and is left out of the occupancy source entirely rather than
--   expected forever. Their real task rows still bring their real days in
--   through source two.
--
-- The projection is LEFT JOIN LATERAL, never CROSS JOIN
--   A resident day for which no cadence version resolves, or whose version
--   defines no enabled window, yields exactly one row with window_key null,
--   satisfied false and expectation_source 'no_cadence'. It must read as a
--   defect, never as silence. no_cadence_in_force distinguishes the two causes:
--   true means no version resolved at all, false on a 'no_cadence' row means a
--   version was in force and projected nothing.
--
-- Version resolution is unchanged from 414 and still stamp first
--   The cadence version for a resident day is the stamp on that resident's
--   standard tasks for the date where any exist, and public.facility_cadence_in_force
--   at local midnight where none do. The projection takes the resolved version
--   as an argument, so on the day a cadence change activates mid shift the read
--   scores tasks against the version that generated them.
--   cadence_version_matches_projection stays on the row so a caller can assert
--   the invariant rather than trust it; it is null on a 'no_cadence' row,
--   because there is no projection to agree or disagree with.
--
-- Caller shape
--   SELECT count(*) AS expected,
--          count(*) FILTER (WHERE satisfied) AS satisfied,
--          count(*) FILTER (WHERE expectation_source = 'no_cadence') AS unconfigured
--   FROM public.observation_compliance_for_range($1, $2, $3);
--
--   For one day, pass the same date twice.
--
-- Authority
--   Invoker rights, like the view it replaces. The function is not SECURITY
--   DEFINER, so row level security on residents, facilities,
--   resident_observation_tasks, resident_monitoring_orders,
--   resident_observation_logs and resident_status_history applies to the
--   caller. A reader sees exactly the facilities they can reach.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.observation_compliance_for_range (uuid, date, date);

CREATE FUNCTION public.observation_compliance_for_range (p_facility_id uuid, p_from date, p_to date)
  RETURNS TABLE (
    organization_id uuid,
    facility_id uuid,
    resident_id uuid,
    service_date date,
    window_key text,
    window_label text,
    shift_key text,
    cadence_version_id uuid,
    stamped_cadence_version_id uuid,
    projected_cadence_version_id uuid,
    cadence_version_matches_projection boolean,
    no_cadence_in_force boolean,
    due_at_utc timestamptz,
    window_opens_at_utc timestamptz,
    window_closes_at_utc timestamptz,
    task_id uuid,
    task_status text,
    covered_by_monitoring_order_id uuid,
    satisfied_by_log_id uuid,
    satisfied_at timestamptz,
    satisfied_by_monitoring_order_id uuid,
    satisfied boolean,
    absorbed boolean,
    expectation_source text)
  LANGUAGE plpgsql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
#variable_conflict use_column
-- The OUT parameters above carry the same names as the columns the body
-- selects. Column wins; nothing in this body reads an OUT parameter.
DECLARE
  v_span integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'observation_compliance_for_range requires a from date and a to date'
      USING ERRCODE = '22023';
  END IF;

  IF p_to < p_from THEN
    RAISE EXCEPTION 'observation_compliance_for_range was called with % after %, which would return nothing; a compliance read must not answer an impossible question with silence', p_from, p_to
      USING ERRCODE = '22023';
  END IF;

  v_span := (p_to - p_from) + 1;
  IF v_span > 366 THEN
    RAISE EXCEPTION 'observation_compliance_for_range covers % days; the limit is 366', v_span
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH facility AS (
    SELECT
      f.id,
      f.organization_id AS org_id,
      COALESCE(f.timezone, 'America/New_York') AS tz
    FROM
      public.facilities f
    WHERE
      f.deleted_at IS NULL
      AND (p_facility_id IS NULL
        OR f.id = p_facility_id)
),
spine AS (
  SELECT
    d::date AS the_date
  FROM
    generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') AS d
),
-- Source one. The date spine crossed with who was in the building. This is the
-- source a view could not express and the reason the contract is a function.
occupancy AS (
  SELECT
    r.organization_id AS org_id,
    r.facility_id AS fac_id,
    r.id AS res_id,
    s.the_date
  FROM
    public.residents r
    JOIN facility fac ON fac.id = r.facility_id
    CROSS JOIN spine s
  WHERE
    r.deleted_at IS NULL
    AND r.admission_date IS NOT NULL
    AND r.admission_date <= s.the_date
    AND (r.discharge_date IS NULL
      OR r.discharge_date >= s.the_date)
    AND r.status NOT IN ('inquiry', 'pending_admission')
    -- Unknown occupancy end. Expecting checks forever on a resident who has
    -- left and left no date behind would be its own dishonest number.
    AND NOT (r.status IN ('discharged', 'deceased')
      AND r.discharge_date IS NULL
      AND NOT EXISTS (
        SELECT
          1
        FROM
          public.resident_status_history h0
        WHERE
          h0.resident_id = r.id
          AND h0.deleted_at IS NULL))
    -- History subtracts days, never supplies them. See the header. The probe
    -- instant is facility local noon rather than midnight, so a resident who
    -- left at 18:00 still counts as present that day and one who left at 09:00
    -- does not, which is the answer a shift would give.
    AND NOT EXISTS (
      SELECT
        1
      FROM
        public.resident_status_history h
      WHERE
        h.resident_id = r.id
        AND h.deleted_at IS NULL
        AND h.status IN ('hospital_hold', 'loa', 'discharged', 'deceased', 'inquiry', 'pending_admission')
        AND h.effective_from <= ((s.the_date + time '12:00') AT TIME ZONE fac.tz)
        AND (h.effective_to IS NULL
          OR h.effective_to > ((s.the_date + time '12:00') AT TIME ZONE fac.tz)))
),
coverage AS (
  SELECT
    org_id,
    fac_id,
    res_id,
    the_date
  FROM
    occupancy
  UNION
  -- Source two. Days that carry standard cadence task rows, whatever occupancy
  -- says. A real task row is evidence the day existed.
  SELECT
    t.organization_id,
    t.facility_id,
    t.resident_id,
    t.service_date
  FROM
    public.resident_observation_tasks t
    JOIN facility fac ON fac.id = t.facility_id
  WHERE
    t.deleted_at IS NULL
    AND t.window_key IS NOT NULL
    AND t.service_date BETWEEN p_from AND p_to
  UNION
  -- Source three. Days a resident was under a Monitoring Order and therefore
  -- has no standard tasks to draw the day from. This is the half that makes
  -- absorption work.
  SELECT
    o.organization_id,
    o.facility_id,
    o.resident_id,
    covered_day::date
  FROM
    public.resident_monitoring_orders o
    JOIN facility fac ON fac.id = o.facility_id
    CROSS JOIN LATERAL generate_series(GREATEST(date_trunc('day', o.starts_at AT TIME ZONE fac.tz), p_from::timestamp), LEAST(date_trunc('day', LEAST(COALESCE(o.cancelled_at, o.ends_at, now()), now()) AT TIME ZONE fac.tz), p_to::timestamp), interval '1 day') AS covered_day
  WHERE
    o.deleted_at IS NULL
),
resolved AS (
  SELECT
    c.org_id,
    c.fac_id,
    c.res_id,
    c.the_date,
    stamp.cadence_version_id AS stamped_version_id,
    COALESCE(stamp.cadence_version_id, public.facility_cadence_in_force (c.fac_id, (c.the_date::timestamp AT TIME ZONE fac.tz))) AS version_id
  FROM
    coverage c
    JOIN public.residents res ON res.id = c.res_id
      AND res.deleted_at IS NULL
    JOIN facility fac ON fac.id = c.fac_id
    LEFT JOIN LATERAL (
      SELECT
        t.cadence_version_id
      FROM
        public.resident_observation_tasks t
      WHERE
        t.resident_id = c.res_id
        AND t.service_date = c.the_date
        AND t.window_key IS NOT NULL
        AND t.cadence_version_id IS NOT NULL
        AND t.deleted_at IS NULL
      ORDER BY
        t.due_at
      LIMIT 1) stamp ON TRUE
)
SELECT
  r.org_id,
  r.fac_id,
  r.res_id,
  r.the_date,
  w.window_key,
  w.label,
  w.shift_key,
  r.version_id,
  r.stamped_version_id,
  w.cadence_version_id,
  -- Null on a resident day that projected no window: there is no projection to
  -- agree or disagree with, and answering false there would read as a broken
  -- invariant rather than as a missing cadence.
  CASE WHEN w.window_key IS NULL THEN
    NULL::boolean
  ELSE
    (r.version_id IS NOT DISTINCT FROM w.cadence_version_id)
  END,
  (r.version_id IS NULL),
  w.due_at_utc,
  w.window_opens_at_utc,
  w.window_closes_at_utc,
  standard_task.id,
  standard_task.status::text,
  covering_order.id,
  satisfying_log.id,
  satisfying_log.observed_at,
  satisfying_log.monitoring_order_id,
  (satisfying_log.id IS NOT NULL),
  (covering_order.id IS NOT NULL
    AND satisfying_log.monitoring_order_id IS NOT NULL),
  CASE WHEN w.window_key IS NULL THEN
    'no_cadence'
  WHEN covering_order.id IS NOT NULL THEN
    'monitoring_order'
  WHEN standard_task.id IS NOT NULL THEN
    'standard_task'
  ELSE
    'projected_only'
  END
FROM
  resolved r
  -- LEFT, never CROSS. A resident day with no cadence in force is the single
  -- most important row this function returns, and the CROSS JOIN in migration
  -- 414 deleted it.
  LEFT JOIN LATERAL public.facility_observation_windows_for_version (r.fac_id, r.version_id, r.the_date) w ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      t.id,
      t.status
    FROM
      public.resident_observation_tasks t
    WHERE
      t.resident_id = r.res_id
      AND t.service_date = r.the_date
      AND t.window_key = w.window_key
      AND t.monitoring_order_id IS NULL
      AND t.deleted_at IS NULL
    ORDER BY
      -- A task that is still being worked describes the window better than one
      -- an order stood down, so prefer it when both exist.
      (t.status = 'excused'),
      t.due_at
    LIMIT 1) standard_task ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      o.id
    FROM
      public.resident_monitoring_orders o
    WHERE
      o.resident_id = r.res_id
      AND o.deleted_at IS NULL
      AND o.starts_at <= w.window_closes_at_utc
      AND COALESCE(o.cancelled_at, o.ends_at, 'infinity'::timestamptz) > w.window_opens_at_utc
    ORDER BY
      o.starts_at DESC
    LIMIT 1) covering_order ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      l.id,
      l.observed_at,
      lt.monitoring_order_id
    FROM
      public.resident_observation_logs l
      JOIN public.resident_observation_tasks lt ON lt.id = l.task_id
    WHERE
      l.resident_id = r.res_id
      AND l.deleted_at IS NULL
      AND l.observed_at >= w.window_opens_at_utc
      AND l.observed_at <= w.window_closes_at_utc
    ORDER BY
      l.observed_at
    LIMIT 1) satisfying_log ON TRUE
  ORDER BY
    r.fac_id,
    r.the_date,
    r.res_id,
    w.due_at_utc NULLS FIRST;
END;
$func$;

COMMENT ON FUNCTION public.observation_compliance_for_range (uuid, date, date) IS
  'The compliance contract for the observation module. One row per resident per facility local service date per projected standard window, plus exactly one row with a null window_key for a resident day that projects nothing. Expected is count(*), satisfied is count(*) FILTER (WHERE satisfied). Resident days come from a date spine crossed with occupancy, unioned with days carrying task rows and days covered by a Monitoring Order, so a facility whose generator never ran reads as expected and unsatisfied instead of as zero over zero. Expectation derived, never row derived. Later parts call this and must not re-derive compliance by counting resident_observation_tasks.';

REVOKE ALL ON FUNCTION public.observation_compliance_for_range (uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.observation_compliance_for_range (uuid, date, date) TO authenticated, service_role;

-- The view is deleted, not deprecated. It answers the same question at the
-- wrong grain, and two compliance reads that disagree is worse than one that
-- was replaced. Nothing consumes it: the only readers at this point are the
-- acceptance scripts, which move to the function in the same change.
DROP VIEW IF EXISTS public.v_resident_observation_compliance;

-- ---------------------------------------------------------------------------
-- public.ensure_facility_observation_defaults
--
-- Route (c): a facility created after migrations 412 and 415 ran inherits
-- nothing. Its shift model, its cadence and its escalation ladder are all
-- seeded by those two files, which select every facility that existed at the
-- moment they ran. A sixth building added next month gets none of it, generates
-- no tasks, escalates nothing, and reads as a quiet facility.
--
-- This command gives one facility the observation configuration its
-- organization is actually running, idempotently, and an AFTER INSERT trigger
-- on public.facilities calls it so a new building inherits automatically.
--
-- Why it inherits rather than re-seeds
-- ------------------------------------
-- The obvious implementation restates the 2026-09-16 seed: two shifts, six
-- windows, four rungs, three night overrides. It was rejected for two reasons.
--
-- It would put every observation time, grace value and escalation offset in the
-- module into a second place, and the moment an administrator changes the
-- cadence through the settings surface, the two disagree with no way to tell
-- which is right. A building added in 2027 would inherit a policy the
-- organization stopped running in 2026, and would do it silently.
--
-- So the source is a donor: the organization's own oldest active cadence
-- version and the active escalation version of the same facility. A new COL
-- building inherits what COL runs today, and every configuration number in the
-- module still lives in exactly one place.
--
-- The seeds in 412 and 415 are deliberately NOT refactored to call this
-- function. They cannot: they run before this file exists in a replay from
-- migration 001, so any call would fail on a fresh database. Rewriting them to
-- call a function defined later would trade a duplicated VALUES list for a
-- broken replay, which is the worse defect. Recorded rather than left implicit.
--
-- When the organization has no donor
-- ----------------------------------
-- The first facility of a brand new organization has nothing to inherit from,
-- and guessing an ALF's observation policy from another tenant's rows would be
-- worse than saying so. The command returns seeded false with a reason, the
-- trigger records the gap as an open exec_alerts row, and
-- public.observation_compliance_for_range reports every resident day at that
-- building as expectation_source 'no_cadence'. The gap is loud in three places
-- and guessed in none.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_facility_observation_defaults (p_facility_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_facility record;
  v_donor_facility_id uuid;
  v_donor_cadence_id uuid;
  v_donor_escalation_id uuid;
  v_effective_from timestamptz;
  v_cadence_id uuid;
  v_escalation_id uuid;
  v_shifts integer := 0;
  v_windows integer := 0;
  v_rungs integer := 0;
  v_overrides integer := 0;
BEGIN
  SELECT
    f.id,
    f.organization_id,
    f.created_at,
    COALESCE(f.timezone, 'America/New_York') AS tz INTO v_facility
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_facility.id IS NULL THEN
    RAISE EXCEPTION 'ensure_facility_observation_defaults: facility % does not exist', p_facility_id
      USING ERRCODE = '22023';
  END IF;

  -- The start of the building's own local day, not the instant it was created.
  -- public.facility_cadence_in_force is asked about local midnight when a
  -- compliance read resolves a service date, so a version that opens at 14:20
  -- leaves its own first day reading as no_cadence, which is a defect the
  -- building did not have.
  v_effective_from := (date_trunc('day', COALESCE(v_facility.created_at, now()) AT TIME ZONE v_facility.tz) AT TIME ZONE v_facility.tz);

  -- The donor is the organization's oldest active cadence version that actually
  -- projects a window. Oldest rather than newest so the answer is stable when a
  -- facility is added twice in a row, and the same facility supplies the shift
  -- model and the escalation ladder so a new building cannot end up with one
  -- building's windows and another's rungs.
  SELECT
    v.id,
    v.facility_id INTO v_donor_cadence_id,
    v_donor_facility_id
  FROM
    public.facility_cadence_versions v
    JOIN public.facilities df ON df.id = v.facility_id
      AND df.deleted_at IS NULL
  WHERE
    v.organization_id = v_facility.organization_id
    AND v.facility_id <> p_facility_id
    AND v.status = 'active'
    AND v.deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_cadence_windows w
      WHERE
        w.cadence_version_id = v.id
        AND w.deleted_at IS NULL
        AND w.enabled)
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_shift_definitions s
      WHERE
        s.facility_id = v.facility_id
        AND s.deleted_at IS NULL
        AND s.active)
  ORDER BY
    v.created_at,
    v.facility_id
  LIMIT 1;

  IF v_donor_cadence_id IS NULL THEN
    RETURN jsonb_build_object('facility_id', p_facility_id, 'seeded', FALSE, 'reason', 'no_donor_configuration_in_organization');
  END IF;

  SELECT
    v.id INTO v_donor_escalation_id
  FROM
    public.facility_escalation_versions v
  WHERE
    v.facility_id = v_donor_facility_id
    AND v.status = 'active'
    AND v.deleted_at IS NULL
  LIMIT 1;

  -- Shift definitions. Keyed by shift_key, so a facility that already has one
  -- shift configured keeps it and gains only what it is missing.
  INSERT INTO public.facility_shift_definitions (organization_id, facility_id, shift_key, roster_shift_type, label, starts_at_local, ends_at_local, sort_order, active)
  SELECT
    v_facility.organization_id,
    p_facility_id,
    s.shift_key,
    s.roster_shift_type,
    s.label,
    s.starts_at_local,
    s.ends_at_local,
    s.sort_order,
    TRUE
  FROM
    public.facility_shift_definitions s
  WHERE
    s.facility_id = v_donor_facility_id
    AND s.deleted_at IS NULL
    AND s.active
    AND NOT EXISTS (
      SELECT
        1
      FROM
        public.facility_shift_definitions existing
      WHERE
        existing.facility_id = p_facility_id
        AND existing.shift_key = s.shift_key
        AND existing.deleted_at IS NULL);
  GET DIAGNOSTICS v_shifts = ROW_COUNT;

  -- Cadence. Only when the facility has no version at all: a facility that has
  -- ever been configured owns its own timeline and nothing here may open a
  -- version inside it.
  SELECT
    v.id INTO v_cadence_id
  FROM
    public.facility_cadence_versions v
  WHERE
    v.facility_id = p_facility_id
    AND v.deleted_at IS NULL
  LIMIT 1;

  IF v_cadence_id IS NULL THEN
    INSERT INTO public.facility_cadence_versions (organization_id, facility_id, version_number, status, effective_from, change_reason, activated_at)
      VALUES (v_facility.organization_id, p_facility_id, 1, 'active', v_effective_from, 'Observation cadence inherited from the organization''s active cadence when this facility was created. A new building starts on the policy the organization is running, not on a policy it stopped running.', v_effective_from)
    RETURNING
      id INTO v_cadence_id;

    INSERT INTO public.facility_cadence_windows (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
    SELECT
      v_facility.organization_id,
      p_facility_id,
      v_cadence_id,
      w.window_key,
      w.label,
      w.due_at_local,
      w.grace_before_minutes,
      w.grace_after_minutes,
      w.shift_key,
      w.sort_order,
      w.enabled
    FROM
      public.facility_cadence_windows w
    WHERE
      w.cadence_version_id = v_donor_cadence_id
      AND w.deleted_at IS NULL;
    GET DIAGNOSTICS v_windows = ROW_COUNT;
  END IF;

  -- Escalation. Same rule, same reason.
  SELECT
    v.id INTO v_escalation_id
  FROM
    public.facility_escalation_versions v
  WHERE
    v.facility_id = p_facility_id
    AND v.deleted_at IS NULL
  LIMIT 1;

  IF v_escalation_id IS NULL AND v_donor_escalation_id IS NOT NULL THEN
    INSERT INTO public.facility_escalation_versions (organization_id, facility_id, version_number, status, effective_from, change_reason, activated_at)
      VALUES (v_facility.organization_id, p_facility_id, 1, 'active', v_effective_from, 'Escalation ladder inherited from the organization''s active policy when this facility was created. A building with no ladder escalates nothing and reads as a quiet building.', v_effective_from)
    RETURNING
      id INTO v_escalation_id;

    INSERT INTO public.facility_escalation_rungs (organization_id, facility_id, escalation_version_id, rung_key, label, offset_minutes, is_terminal, assigned_staff_only, include_assigned_staff, use_standing_alert_routes, target_staff_roles, channels, protocol_text, sort_order, enabled)
    SELECT
      v_facility.organization_id,
      p_facility_id,
      v_escalation_id,
      r.rung_key,
      r.label,
      r.offset_minutes,
      r.is_terminal,
      r.assigned_staff_only,
      r.include_assigned_staff,
      r.use_standing_alert_routes,
      r.target_staff_roles,
      r.channels,
      r.protocol_text,
      r.sort_order,
      r.enabled
    FROM
      public.facility_escalation_rungs r
    WHERE
      r.escalation_version_id = v_donor_escalation_id
      AND r.deleted_at IS NULL;
    GET DIAGNOSTICS v_rungs = ROW_COUNT;

    INSERT INTO public.facility_escalation_rung_shift_overrides (organization_id, facility_id, escalation_version_id, escalation_rung_id, shift_key, offset_minutes, channels)
    SELECT
      v_facility.organization_id,
      p_facility_id,
      v_escalation_id,
      mine.id,
      src.shift_key,
      src.offset_minutes,
      src.channels
    FROM
      public.facility_escalation_rung_shift_overrides src
      JOIN public.facility_escalation_rungs donor_rung ON donor_rung.id = src.escalation_rung_id
      JOIN public.facility_escalation_rungs mine ON mine.escalation_version_id = v_escalation_id
        AND mine.rung_key = donor_rung.rung_key
    WHERE
      src.escalation_version_id = v_donor_escalation_id
      AND src.deleted_at IS NULL;
    GET DIAGNOSTICS v_overrides = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('facility_id', p_facility_id, 'seeded', TRUE, 'donor_facility_id', v_donor_facility_id, 'shift_definitions_added', v_shifts, 'cadence_version_id', v_cadence_id, 'cadence_windows_added', v_windows, 'escalation_version_id', v_escalation_id, 'escalation_rungs_added', v_rungs, 'escalation_rung_overrides_added', v_overrides);
END;
$func$;

COMMENT ON FUNCTION public.ensure_facility_observation_defaults (uuid) IS
  'Gives one facility the observation configuration its organization is already running: the shift model, an active cadence version with its windows, and an active escalation version with its rungs and shift overrides, copied from the organization''s oldest active cadence version and that facility''s escalation policy. Idempotent, and it never opens a version inside a timeline a facility already owns. Returns seeded false with a reason when the organization has nothing to inherit from, which is a gap to be reported rather than guessed at. COL-37 ruling: revoke to service_role. It writes facility configuration across the whole organization''s cadence and escalation tables and reads a donor facility the caller may have no access to, so definer rights are required and the grant is not. Its only caller in the product is the AFTER INSERT trigger on public.facilities, which is itself definer and therefore reaches it as the owner; the settings surface proposes and activates versions through its own RPCs instead.';

REVOKE ALL ON FUNCTION public.ensure_facility_observation_defaults (uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_facility_observation_defaults (uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- The trigger, and why it cannot fail a facility insert.
--
-- Creating a building is not an observation module operation, and a fault in
-- seeding its cadence must never roll back the building. The call therefore
-- sits inside its own exception block, and the alert that records a failure
-- sits inside a second one, so neither path can propagate.
--
-- Swallowing it silently would recreate exactly the defect this migration
-- exists to fix, so a gap is recorded three ways: an open exec_alerts row a
-- human sees without opening the module, a server WARNING, and every resident
-- day at that building reading as expectation_source 'no_cadence' in
-- public.observation_compliance_for_range.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_facilities_seed_observation_defaults ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_result jsonb;
  v_severity public.exec_alert_severity;
  v_title text;
BEGIN
  BEGIN
    v_result := public.ensure_facility_observation_defaults (NEW.id);
  EXCEPTION
    WHEN OTHERS THEN
      v_result := jsonb_build_object('facility_id', NEW.id, 'seeded', FALSE, 'reason', 'error', 'sqlstate', SQLSTATE, 'message', SQLERRM);
  END;

  IF COALESCE((v_result ->> 'seeded')::boolean, FALSE) THEN
    RETURN NULL;
  END IF;

  v_severity := CASE WHEN (v_result ->> 'reason') = 'error' THEN
    'critical'
  ELSE
    'warning'
  END;
  v_title := format('Observation cadence is not configured at %s', NEW.name);

  RAISE WARNING 'observation defaults were not seeded for facility %: %', NEW.id, v_result;

  BEGIN
    INSERT INTO public.exec_alerts (organization_id, entity_id, facility_id, source_module, severity, title, body)
    SELECT
      NEW.organization_id,
      NEW.entity_id,
      NEW.id,
      'compliance',
      v_severity,
      v_title,
      'This building has no observation cadence and no escalation ladder, so it generates no observation tasks and escalates nothing. Until it is configured, every resident day here reads as an unmet expectation rather than as compliance. Open Cadence Settings for this facility.'
    WHERE
      NOT EXISTS (
        SELECT
          1
        FROM
          public.exec_alerts existing
        WHERE
          existing.organization_id = NEW.organization_id
          AND existing.facility_id = NEW.id
          AND existing.title = v_title
          AND existing.resolved_at IS NULL
          AND existing.deleted_at IS NULL);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'could not record the observation cadence gap for facility %: %', NEW.id, SQLERRM;
  END;

  RETURN NULL;
END;
$func$;

COMMENT ON FUNCTION public.fn_facilities_seed_observation_defaults () IS
  'AFTER INSERT on public.facilities. Gives a new building the organization''s observation configuration, and records a visible gap when it cannot. Cannot fail the facility insert: both the seeding call and the alert that reports its failure run inside their own exception blocks. COL-37 ruling: definer required. It seeds configuration and writes an exec_alerts row on behalf of whoever created the building, who is not necessarily allowed to do either, and it must succeed for a facility insert made by any role. Execute is revoked from everyone but service_role all the same; a trigger function is authorized at CREATE TRIGGER time, not at fire time, so nothing reaches it except the trigger.';

REVOKE ALL ON FUNCTION public.fn_facilities_seed_observation_defaults () FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_facilities_seed_observation_defaults () TO service_role;

DROP TRIGGER IF EXISTS tr_facilities_seed_observation_defaults ON public.facilities;

CREATE TRIGGER tr_facilities_seed_observation_defaults
  AFTER INSERT ON public.facilities
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_facilities_seed_observation_defaults ();

NOTIFY pgrst,
'reload schema';

COMMIT;
