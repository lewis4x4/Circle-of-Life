-- A resident in hospital stops accruing missed checks (spec 25A section 2.4).
--
-- Found by running the module against Haven HFO Staging, which is the first time
-- any of it has touched a real hosted database. The generator produced 69 tasks
-- for 23 residents across 3 windows, all stamped, and then the compliance read
-- would not reconcile:
--
--   status=active         residents=23   expected=138   with_task=69
--   status=hospital_hold  residents=1    expected=6     with_task=0
--
-- One resident on hospital_hold carried six expected windows and no tasks, so
-- they accrued six phantom missed checks for every day they were in hospital.
-- Spec 2.4 is explicit that hospital_hold, loa, discharged and deceased generate
-- no tasks. Generating nothing while remaining expected punishes a building for
-- a resident who is not in it, and it reads as a staffing failure. This is the
-- mirror of the C3 defect: that one made real misses disappear, this one invents
-- misses that never happened.
--
-- THE CAUSE, which is narrower than "the status was not checked".
--
-- public.observation_compliance_for_range consulted the current status only for
-- `inquiry` and `pending_admission`, plus one clause about a discharge with no
-- date. The four non generating statuses were caught by one thing and one thing
-- only: a resident_status_history row covering the date. Migration 217 installs
-- that table's capture trigger without backfilling, so a resident whose status
-- was set before it ran has no history row at all, and nothing then excluded
-- them. Reproduced here before fixing: two residents both sitting in
-- hospital_hold, one with a history row and one without. The one with history
-- returned no rows, correctly. The one without returned six expected and zero
-- satisfied.
--
-- That is also why the acceptance suite missed it. Its occupancy edge case
-- inserts the history row explicitly, so it only ever exercised the path that
-- worked.
--
-- THE FIX, in three parts.
--
--   1. One rule, in one place. The status test moves out of the occupancy
--      source and into `resolved`, where it applies to a resident day whichever
--      of the three coverage sources supplied it. Before, a day that arrived
--      through a task row or a Monitoring Order never had its status considered.
--
--   2. The current status is consulted, but only for dates it actually covers:
--      when no history row covers the date and none starts after it. A blanket
--      fallback to today's status would read it onto every past date and erase a
--      resident's recorded misses from before their last status change, which is
--      C3 over again in the other direction.
--
--   3. Evidence wins over status, per window rather than per day. A window that
--      carries a task, a log or a covering order stays expected whatever the
--      status says, so a resident who went to hospital at noon keeps their
--      morning checks and loses only the windows nothing generated.
--
-- A retired resident record still leaves a closed day unchanged: the join that
-- reads the current status is LEFT, and a status nobody can see is not evidence
-- of a non generating one.
BEGIN;

CREATE OR REPLACE FUNCTION public.observation_compliance_for_range (p_facility_id uuid, p_from date, p_to date)
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
    -- M8. residents.deleted_at is deliberately not read here, and must not be
    -- tidied back in. Soft delete describes the lifecycle of a record; it says
    -- nothing about whether a person was in the building on a date. Retiring a
    -- resident record used to remove their whole observation history from this
    -- function, so a past date that had already been closed and reported
    -- recomputed to a smaller number: the recorded misses vanished, the
    -- satisfied windows vanished with them, and the ratio moved up. An error
    -- that always flatters the facility is the worst kind here, and a closed
    -- day must not change.
    --
    -- A resident record created in error is corrected by saying so, with a
    -- status or a discharge date, which the predicates below already read. It
    -- is not corrected by a flag that silently rewrites history.
    r.admission_date IS NOT NULL
    AND r.admission_date <= s.the_date
    AND (r.discharge_date IS NULL
      OR r.discharge_date >= s.the_date)
    AND r.status NOT IN ('inquiry', 'pending_admission')
    -- Unknown occupancy end. Expecting checks forever on a resident who has
    -- left and left no date behind would be its own dishonest number.
    -- Kept although the generating test below now subsumes it: a resident who is
    -- discharged or deceased with no discharge date and no history at all has an
    -- unknown occupancy end, and expecting checks forever would be its own
    -- dishonest number.
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
    -- The status test that used to live here has moved into `resolved` below,
    -- as one rule in one place. It was here as a subtraction from occupancy
    -- only, which meant a day that arrived through a task row or a Monitoring
    -- Order never had its status considered at all.
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
    -- M7. haven.monitoring_order_in_force_until, not the timestamps alone. An
    -- order in a terminal status with no end date and no cancellation used to
    -- fall through to now() here and generate a fresh coverage day every day
    -- forever.
    CROSS JOIN LATERAL generate_series(GREATEST(date_trunc('day', o.starts_at AT TIME ZONE fac.tz), p_from::timestamp), LEAST(date_trunc('day', LEAST(haven.monitoring_order_in_force_until (o.status, o.ends_at, o.cancelled_at, o.closed_at), now()) AT TIME ZONE fac.tz), p_to::timestamp), interval '1 day') AS covered_day
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
    COALESCE(stamp.cadence_version_id, public.facility_cadence_in_force (c.fac_id, (c.the_date::timestamp AT TIME ZONE fac.tz))) AS version_id,
    -- Was this resident in a task generating status on this date?
    --
    -- Generating means exactly `active`, which is the same single value the task
    -- generator uses, so the two cannot disagree about who is due checks.
    --
    -- The day is expected unless there is positive evidence of a non generating
    -- status on it. Two kinds of evidence, and nothing else counts:
    --
    --   1. a resident_status_history row covering facility local noon that says
    --      something other than active
    --   2. nothing recorded for this date and nothing recorded after it, so
    --      whatever the resident's status is now has been in force since before
    --      the date, and it is not active
    --
    -- The second clause is the defect this migration exists to close. Migration
    -- 217 installs its capture trigger without backfilling, so a resident whose
    -- status was set before it ran has no history row at all, and the old
    -- predicate consulted nothing but history. A resident sitting in
    -- hospital_hold with no history row was therefore fully expected and
    -- accrued six phantom missed checks every day they were in hospital. Found
    -- on Haven HFO Staging, where exactly one resident was in that state.
    --
    -- The second clause is deliberately narrow. A blanket "fall back to the
    -- current status" would read today's status onto every past date and erase a
    -- resident's recorded misses from before their last status change, which is
    -- the C3 defect over again in the other direction. `no history row starting
    -- after this date` is what limits it to dates the current status actually
    -- covers.
    --
    -- res.status is null when the caller cannot see the resident row, which is
    -- what a retired record looks like under the residents SELECT policy. Not
    -- knowing the status is not evidence of a non generating one, so the day
    -- stays expected and the closed report stays stable.
    --
    -- The probe instant is facility local noon rather than midnight, so a
    -- resident who left at 18:00 still counts as present that day and one who
    -- left at 09:00 does not, which is the answer a shift would give.
    NOT (EXISTS (
        SELECT
          1
        FROM
          public.resident_status_history h
        WHERE
          h.resident_id = c.res_id
          AND h.deleted_at IS NULL
          AND h.status <> 'active'
          AND h.effective_from <= ((c.the_date + time '12:00') AT TIME ZONE fac.tz)
          AND (h.effective_to IS NULL
            OR h.effective_to > ((c.the_date + time '12:00') AT TIME ZONE fac.tz)))
      OR (res.status IS NOT NULL
        AND res.status <> 'active'
        AND NOT EXISTS (
          SELECT
            1
          FROM
            public.resident_status_history h
          WHERE
            h.resident_id = c.res_id
            AND h.deleted_at IS NULL
            AND h.effective_from <= ((c.the_date + time '12:00') AT TIME ZONE fac.tz)
            AND (h.effective_to IS NULL
              OR h.effective_to > ((c.the_date + time '12:00') AT TIME ZONE fac.tz)))
        AND NOT EXISTS (
          SELECT
            1
          FROM
            public.resident_status_history h
          WHERE
            h.resident_id = c.res_id
            AND h.deleted_at IS NULL
            AND h.effective_from > ((c.the_date + time '12:00') AT TIME ZONE fac.tz)))) AS generating
  FROM
    coverage c
    -- LEFT, never INNER. An inner join here is the M8 defect: it drops the row
    -- for a resident whose record has been retired, and with it a closed day
    -- that had already been reported.
    LEFT JOIN public.residents res ON res.id = c.res_id
    -- M8. The join to public.residents that used to sit here supplied no
    -- column: it was a visibility filter and nothing else, and its
    -- `deleted_at IS NULL` was the second half of the erasure above. It is gone
    -- rather than loosened, because the residents SELECT policy carries its own
    -- `deleted_at IS NULL` and an invoker rights function cannot see past it.
    -- Keeping the join would have meant a retired record still erased days that
    -- carry real task rows and real orders, which are evidence the day happened.
    --
    -- Nothing widens: every resident id in `coverage` arrived from residents,
    -- resident_observation_tasks or resident_monitoring_orders, all three read
    -- under the caller's own row level security.
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
    -- Ranked below standard_task and monitoring_order on purpose. If a task
    -- exists it is on the board and workable, and if an order covers the window
    -- the resident is being looked at more often, not less; in neither case is
    -- the operator's problem the shift. It is only when nothing is going to
    -- happen at all that the orphaned shift is the thing to say.
  WHEN live_shift.shift_key IS NULL THEN
    'orphaned_shift'
  ELSE
    'projected_only'
  END
FROM
  resolved r
  -- LEFT, never CROSS. A resident day with no cadence in force is the single
  -- most important row this function returns, and the CROSS JOIN in migration
  -- 414 deleted it.
  LEFT JOIN LATERAL public.facility_observation_windows_for_version (r.fac_id, r.version_id, r.the_date) w ON TRUE
  -- M5. The window names a shift; this is whether that shift is one the
  -- facility actually runs. The composite foreign key added in migration 426
  -- makes an unmatched key impossible, but a shift that has been deactivated or
  -- soft deleted still leaves its windows projecting here while
  -- public.facility_shift_window_at refuses to resolve them, so the generator
  -- writes no task and nothing ever escalates. That window is a configuration
  -- defect, not a missed check, and it is named below rather than counted
  -- silently against the building.
  LEFT JOIN LATERAL (
    SELECT
      s.shift_key
    FROM
      public.facility_shift_definitions s
    WHERE
      s.facility_id = r.fac_id
      AND s.shift_key = w.shift_key
      AND s.deleted_at IS NULL
      AND s.active) live_shift ON TRUE
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
      -- M7, the same rule as the coverage range above. Reading only the
      -- timestamps let an order in a terminal status go on reading as this
      -- resident's live expectation source long after it stopped.
      AND haven.monitoring_order_in_force_until (o.status, o.ends_at, o.cancelled_at, o.closed_at) > w.window_opens_at_utc
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
  -- Evidence wins over status, and it wins per window rather than per day.
  --
  -- A resident who was active all morning, whose tasks generated and whose
  -- checks a caregiver recorded, and who went to hospital at noon, keeps every
  -- morning window: those windows carry a task and a log, so they stay expected
  -- and stay satisfied. What they do not keep is the rest of the day, which
  -- nothing generated and nobody could have worked. Dropping the whole day
  -- would erase real recorded work, which is the C3 defect; keeping the whole
  -- day invents the misses this migration exists to remove.
  --
  -- A resident day that generates keeps every projected window, including the
  -- single no_cadence row for a day that projects none, because that row is a
  -- configuration defect a human has to see.
  WHERE
    r.generating
    OR standard_task.id IS NOT NULL
    OR satisfying_log.id IS NOT NULL
    OR covering_order.id IS NOT NULL
  ORDER BY
    r.fac_id,
    r.the_date,
    r.res_id,
    w.due_at_utc NULLS FIRST;
END;
$func$;



COMMENT ON FUNCTION public.observation_compliance_for_range (uuid, date, date) IS
  'The single compliance read for the observation module. One row per projected standard window occurrence per resident day, plus exactly one row per resident day that projects no window at all. A resident day is expected when the resident was in the task generating status on that date, resolved from resident_status_history where it covers the date and from the current status only for dates the current status covers, or when the window already carries a task, a log or a covering order. Expectation derived, never row derived: a resident on a Monitoring Order still expects the windows the cadence projects. Invoker rights, so row level security scopes the reader to their own buildings. expectation_source is standard_task, monitoring_order, projected_only, no_cadence or orphaned_shift; the last two are configuration gaps and a surface that folds them into a missed check has reintroduced the defect at the UI layer.';

NOTIFY pgrst,
'reload schema';

COMMIT;
