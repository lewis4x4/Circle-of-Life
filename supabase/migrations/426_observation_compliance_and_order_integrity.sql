-- Two defects that each corrupt a compliance number silently (spec 25A).
--
-- M5. NOTHING TIED A WINDOW'S shift_key TO A SHIFT.
--
-- facility_cadence_windows.shift_key carried a regex CHECK and no reference to
-- facility_shift_definitions. A one character typo, `night` to `nights`, took
-- the window out of generation and left it in the compliance expectation:
-- public.facility_next_shift_observation_windows filters `w.shift_key = n.key`
-- so the generator never sees it, while
-- public.facility_observation_windows_for_version joins no shift table at all
-- and keeps projecting it as expected. The window becomes a permanent silent
-- miss for every resident every day. No task, so no ladder and no alert, and a
-- compliance number counting it against the building forever.
--
-- facility_escalation_rung_shift_overrides.shift_key had the same gap, where a
-- typo silently reverts a night rung to day channels with no error.
--
-- Closed here with a composite foreign key on (facility_id, shift_key), which
-- needs a full uniqueness guarantee on the parent rather than the partial one
-- migration 417 created. See the ruling on soft delete and rename below.
--
-- M7. `completed` WAS A LEGAL ORDER STATUS THAT NEVER CLOSED.
--
-- resident_monitoring_orders.status admits `completed`. Nothing in the module
-- writes it, and the update policy lets a facility_admin write it directly.
-- public.observation_compliance_for_range bounded the coverage day range with
-- `LEAST(COALESCE(cancelled_at, ends_at, now()), now())` and the covering order
-- lateral with `COALESCE(cancelled_at, ends_at, 'infinity')`. Both keyed on
-- timestamps; neither read status. So an open ended order marked `completed`
-- had no ends_at and no cancelled_at, never closed, generated a fresh coverage
-- day every day forever, and went on reading as that resident's live
-- expectation source long after the order had stopped. `expired` had the same
-- hole: public.expire_monitoring_orders only ever expires an order that already
-- has an end date, but a direct UPDATE was under no such rule.
--
-- Closed here by making a terminal status structurally carry the instant it
-- closed, and by reading status rather than only timestamps in both places.
BEGIN;

-- ---------------------------------------------------------------------------
-- M5, part one. A shift key is the shift's identity at a building.
--
-- Migration 417's unique index is partial on `deleted_at IS NULL`, and a
-- partial index cannot back a foreign key. The replacement is unconditional,
-- which is a ruling and not an accident:
--
--   A shift key is unique at a facility for the life of the facility, whether
--   or not the shift is soft deleted.
--
-- Soft deleting `night` and creating a second `night` would silently re-point
-- every window and every escalation override from the old shift to the new one,
-- which is the class of defect the foreign key exists to prevent. Reviving a
-- retired shift is clearing deleted_at, not inserting a second row.
--
-- The partial index is dropped as redundant: an unconditional unique index on
-- the same two columns serves every read the partial one served.
-- ---------------------------------------------------------------------------
-- Replay order matters here. On a second apply the two foreign keys below
-- already exist and depend on this unique index, so dropping it first fails with
-- 2BP01. The references come off, the parent is rebuilt, and they go back on.
ALTER TABLE public.facility_cadence_windows
  DROP CONSTRAINT IF EXISTS facility_cadence_windows_shift_key_fkey;

ALTER TABLE public.facility_escalation_rung_shift_overrides
  DROP CONSTRAINT IF EXISTS facility_escalation_rung_shift_overrides_shift_key_fkey;

ALTER TABLE public.facility_shift_definitions
  DROP CONSTRAINT IF EXISTS facility_shift_definitions_facility_shift_key;

ALTER TABLE public.facility_shift_definitions
  ADD CONSTRAINT facility_shift_definitions_facility_shift_key UNIQUE (facility_id, shift_key);

DROP INDEX IF EXISTS public.idx_facility_shift_definitions_key;

COMMENT ON COLUMN public.facility_shift_definitions.shift_key IS
  'The shift''s identity at this facility, unique for the life of the facility whether or not the row is soft deleted. facility_cadence_windows and facility_escalation_rung_shift_overrides both point at it by composite foreign key, so a typo is rejected rather than becoming a window that no shift generates and every compliance read still expects.';

-- ---------------------------------------------------------------------------
-- M5, part two. The two references.
--
-- ON UPDATE CASCADE, because renaming a shift is a real operation the settings
-- surface needs and the alternative to cascading is a foreign key that makes it
-- impossible. A rename is one UPDATE on the definition and every window and
-- override follows it in the same statement. Note that a referential action
-- runs as the table owner and is not filtered by row level security, so a
-- rename reaches the windows of a cadence version that is already in force.
-- That is correct: shift_key is a pointer to the shift, not a policy value, and
-- renaming a shift changes no window's due time, no grace value and no
-- escalation offset. The version's contents are unchanged.
--
-- ON DELETE RESTRICT, because a shift that still owns windows may not be hard
-- deleted. Soft deleting it is still allowed and deliberately does not cascade:
-- the windows keep pointing at a row that exists, which is what lets the
-- compliance read below name them rather than lose them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.facility_cadence_windows
  ADD CONSTRAINT facility_cadence_windows_shift_key_fkey FOREIGN KEY (facility_id, shift_key) REFERENCES public.facility_shift_definitions (facility_id, shift_key) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.facility_escalation_rung_shift_overrides
  ADD CONSTRAINT facility_escalation_rung_shift_overrides_shift_key_fkey FOREIGN KEY (facility_id, shift_key) REFERENCES public.facility_shift_definitions (facility_id, shift_key) ON UPDATE CASCADE ON DELETE RESTRICT;

-- The foreign key needs an index on the referencing side for the cascade and
-- for the restrict check, and neither table had one on these columns.
CREATE INDEX IF NOT EXISTS idx_facility_cadence_windows_shift
  ON public.facility_cadence_windows (facility_id, shift_key);

CREATE INDEX IF NOT EXISTS idx_facility_escalation_rung_shift_overrides_shift
  ON public.facility_escalation_rung_shift_overrides (facility_id, shift_key);

-- ---------------------------------------------------------------------------
-- M7, part one. A terminal status carries the instant it closed.
--
-- closed_at is stamped by a trigger rather than asked of the writer, so a direct
-- UPDATE that sets `completed` cannot leave the order open, and the CHECK below
-- cannot be satisfied by an accident of ordering. A BEFORE trigger runs before a
-- CHECK is evaluated, which is what makes the pair work.
-- ---------------------------------------------------------------------------
ALTER TABLE public.resident_monitoring_orders
  ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL;

COMMENT ON COLUMN public.resident_monitoring_orders.closed_at IS
  'When the order stopped being in force, stamped by tr_resident_monitoring_orders_closure on any move out of active. Null while active and never null otherwise. haven.monitoring_order_in_force_until reads it, so an order in a terminal status cannot go on reading as a live expectation source because nobody filled in a date.';

CREATE OR REPLACE FUNCTION haven.stamp_monitoring_order_closed_at ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
BEGIN
  IF NEW.status = 'active' THEN
    NEW.closed_at := NULL;
  ELSIF NEW.closed_at IS NULL THEN
    NEW.closed_at := COALESCE(NEW.cancelled_at, LEAST(NEW.ends_at, now()), now());
  END IF;
  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION haven.stamp_monitoring_order_closed_at () IS
  'Stamps resident_monitoring_orders.closed_at on any move out of active, and clears it on a move back. A definer so the stamp lands whatever the writer''s authority is; execute is revoked from every request role and a trigger function is authorized at CREATE TRIGGER time rather than at fire time.';

REVOKE ALL ON FUNCTION haven.stamp_monitoring_order_closed_at () FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_resident_monitoring_orders_closure ON public.resident_monitoring_orders;

CREATE TRIGGER tr_resident_monitoring_orders_closure
  BEFORE INSERT OR UPDATE ON public.resident_monitoring_orders
  FOR EACH ROW
  EXECUTE FUNCTION haven.stamp_monitoring_order_closed_at ();

-- Any order already sitting in a terminal status gets the closing instant it
-- should have had. updated_at is the last resort rather than now(), so a
-- backfill does not claim an order that stopped last week stopped today.
UPDATE
  public.resident_monitoring_orders
SET
  closed_at = COALESCE(cancelled_at, LEAST(ends_at, updated_at), updated_at)
WHERE
  status <> 'active'
  AND closed_at IS NULL;

ALTER TABLE public.resident_monitoring_orders
  DROP CONSTRAINT IF EXISTS resident_monitoring_orders_terminal_is_closed;

ALTER TABLE public.resident_monitoring_orders
  ADD CONSTRAINT resident_monitoring_orders_terminal_is_closed CHECK ((status = 'active'
      AND closed_at IS NULL)
    OR (status <> 'active'
      AND closed_at IS NOT NULL));

-- ---------------------------------------------------------------------------
-- M7, part two. One definition of when an order stopped being in force.
--
-- Active: the order runs to its end date, or forever if it has none.
-- Anything else: the earliest of the closing instant, the cancellation and the
-- end date. Earliest, so an order marked completed today that nominally ran
-- until next week stops today rather than next week, and so an order cancelled
-- after its end date reads as having stopped at its end date.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.monitoring_order_in_force_until (p_status text, p_ends_at timestamptz, p_cancelled_at timestamptz, p_closed_at timestamptz)
  RETURNS timestamptz
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog
  AS $func$
  SELECT
    CASE WHEN p_status = 'active' THEN
      COALESCE(p_ends_at, 'infinity'::timestamptz)
    ELSE
      LEAST(COALESCE(p_closed_at, 'infinity'::timestamptz), COALESCE(p_cancelled_at, 'infinity'::timestamptz), COALESCE(p_ends_at, 'infinity'::timestamptz))
    END;
$func$;

COMMENT ON FUNCTION haven.monitoring_order_in_force_until (text, timestamptz, timestamptz, timestamptz) IS
  'The instant a Monitoring Order stopped being in force, or infinity while it is still running. The single definition read by public.observation_compliance_for_range in both the coverage day range and the covering order lateral. Reading only the timestamps let an order in a terminal status with no end date generate a fresh coverage day every day forever and go on reading as a resident''s live expectation source.';

REVOKE ALL ON FUNCTION haven.monitoring_order_in_force_until (text, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION haven.monitoring_order_in_force_until (text, timestamptz, timestamptz, timestamptz) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- M7, part three, and M5, part three. The compliance read.
--
-- Replaced from migration 421 with three changes and nothing else:
--
--   1. the coverage day range closes an order through
--      haven.monitoring_order_in_force_until rather than through
--      COALESCE(cancelled_at, ends_at, now())
--   2. the covering order lateral does the same rather than
--      COALESCE(cancelled_at, ends_at, 'infinity')
--   3. a projected window whose shift is deactivated, soft deleted or otherwise
--      not one the facility runs reads as expectation_source 'orphaned_shift'
--
-- expectation_source gains one value. Callers that switch on it must treat
-- 'orphaned_shift' the way they treat 'no_cadence': an unsatisfied expectation
-- whose cause is a configuration gap rather than a missed check, named
-- differently and never rounded away. The caller shape in the build notes
-- becomes:
--
--   SELECT count(*)                                                    AS expected,
--          count(*) FILTER (WHERE satisfied)                           AS satisfied,
--          count(*) FILTER (WHERE expectation_source
--                           IN ('no_cadence', 'orphaned_shift'))       AS unconfigured
--   FROM public.observation_compliance_for_range($1, $2, $3);
--
-- Everything else in this body, including the occupancy sources, the
-- LEFT JOIN LATERAL projection, the range guards and the grants, is unchanged.
-- ---------------------------------------------------------------------------
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
    COALESCE(stamp.cadence_version_id, public.facility_cadence_in_force (c.fac_id, (c.the_date::timestamp AT TIME ZONE fac.tz))) AS version_id
  FROM
    coverage c
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
  ORDER BY
    r.fac_id,
    r.the_date,
    r.res_id,
    w.due_at_utc NULLS FIRST;
END;
$func$;


COMMENT ON FUNCTION public.observation_compliance_for_range (uuid, date, date) IS
  'The single compliance read for the observation module. One row per projected standard window occurrence per resident day, plus exactly one row per resident day that projects no window at all. Expectation derived, never row derived: a resident on a Monitoring Order still expects the windows the cadence projects. Invoker rights, so row level security scopes the reader to their own buildings. expectation_source is standard_task, monitoring_order, projected_only, no_cadence or orphaned_shift; the last two are configuration gaps and a surface that folds them into a missed check has reintroduced the defect at the UI layer.';


-- ---------------------------------------------------------------------------
-- M11, part one. The order table stops requiring a person and a name.
--
-- entered_by was NOT NULL, so the care event bridge had to find somebody to
-- blame and fell back to whichever organization administrator sorted first by
-- created_at. ordered_by_name was NOT NULL, so the bridge hardcoded a generic
-- nurse string. Between them, an order nobody entered was attributed to a named
-- person who had never seen it.
--
-- Both become nullable. An order placed by the system was entered by nobody, and
-- an unattributed order is better than a misattributed one.
-- ---------------------------------------------------------------------------
ALTER TABLE public.resident_monitoring_orders
  ALTER COLUMN entered_by DROP NOT NULL;

ALTER TABLE public.resident_monitoring_orders
  ALTER COLUMN ordered_by_name DROP NOT NULL;

ALTER TABLE public.resident_monitoring_orders
  DROP CONSTRAINT IF EXISTS resident_monitoring_orders_ordered_by_name_check;

ALTER TABLE public.resident_monitoring_orders
  ADD CONSTRAINT resident_monitoring_orders_ordered_by_name_check CHECK (ordered_by_name IS NULL OR char_length(btrim(ordered_by_name)) BETWEEN 1 AND 120);

-- care_event joins the list, because that is where a bridged order genuinely
-- came from. Naming a clinical party the watch instance never named is the
-- invention this value exists to avoid.
ALTER TABLE public.resident_monitoring_orders
  DROP CONSTRAINT IF EXISTS resident_monitoring_orders_ordered_by_type_check;

ALTER TABLE public.resident_monitoring_orders
  ADD CONSTRAINT resident_monitoring_orders_ordered_by_type_check CHECK (ordered_by_type IN ('physician', 'hospital_discharge', 'home_health_nurse', 'hospice_nurse', 'facility_nurse', 'facility_admin', 'care_event'));

-- A human entered order still has to name who ordered it. Only the care event
-- source may leave the party unnamed.
ALTER TABLE public.resident_monitoring_orders
  DROP CONSTRAINT IF EXISTS resident_monitoring_orders_party_named_unless_care_event;

ALTER TABLE public.resident_monitoring_orders
  ADD CONSTRAINT resident_monitoring_orders_party_named_unless_care_event CHECK (ordered_by_name IS NOT NULL OR ordered_by_type = 'care_event');

COMMENT ON COLUMN public.resident_monitoring_orders.entered_by IS
  'The person who entered the order, or null when the system placed it from a care event. Never a stand in: attributing a clinical order to an administrator who was picked because they sorted first is worse than recording that nobody entered it.';
COMMENT ON COLUMN public.resident_monitoring_orders.ordered_by_name IS
  'The ordering party, as the operator wrote it. Null only on a care_event order whose watch instance named nobody. An unattributed order is better than a misattributed one.';
COMMENT ON COLUMN public.resident_monitoring_orders.ordered_by_type IS
  'Who ordered it. care_event means the order was placed by the care event bridge rather than entered by a person, which is a provenance the operator can see rather than a clinical party that was guessed.';

-- ---------------------------------------------------------------------------
-- M11, part two. One internal, so both entry points have identical effects.
--
-- The bridge inserted straight into the table and skipped every side effect the
-- create command performs: no order tasks until the next generator tick, nobody
-- notified, and the resident's standard cadence still running underneath, which
-- doubles the board and runs the standard tasks to overdue on the ladder for
-- checks the order replaced. It was not caught earlier because the bridge is
-- idle at this branch point; nothing writes resident_watch_instances yet. It
-- goes live silently the moment the care event trigger lands.
--
-- The actor is an argument, never the session. A trigger firing under a care
-- event write has no auth.uid() to read, and a function that accepted an actor
-- from a request role would be a way to record a clinical order under somebody
-- else's name. This one is revoked from PUBLIC, anon, authenticated and
-- service_role alike, exactly as haven.complete_rounding_task_core is: the only
-- things that can reach it are the two definers below, which the database
-- authorizes as their owner, and a trigger, which is authorized at CREATE
-- TRIGGER time. It performs no authorization of its own and must never be
-- granted to anything.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.place_monitoring_order (p_resident_id uuid, p_interval_minutes integer, p_ordered_by_type text, p_ordered_by_name text, p_order_received_as text, p_reason_category text, p_reason_note text, p_starts_at timestamptz, p_ends_at timestamptz, p_review_due_at timestamptz, p_document_path text, p_actor_id uuid, p_source_watch_instance_id uuid DEFAULT NULL)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_resident record;
  v_starts_at timestamptz;
  v_order_id uuid;
BEGIN
  -- residents carries no entity_id; the legal entity comes from the building.
  SELECT
    r.id,
    r.organization_id,
    f.entity_id,
    r.facility_id INTO v_resident
  FROM
    public.residents r
    JOIN public.facilities f ON f.id = r.facility_id
      AND f.deleted_at IS NULL
  WHERE
    r.id = p_resident_id
    AND r.deleted_at IS NULL;

  IF v_resident.id IS NULL THEN
    RAISE EXCEPTION 'Resident not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_starts_at := COALESCE(p_starts_at, now());

  INSERT INTO public.resident_monitoring_orders (organization_id, entity_id, facility_id, resident_id, source_watch_instance_id, interval_minutes, starts_at, ends_at, review_due_at, ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note, document_path, entered_by, created_by, status)
    VALUES (v_resident.organization_id, v_resident.entity_id, v_resident.facility_id, p_resident_id, p_source_watch_instance_id, p_interval_minutes, v_starts_at, p_ends_at, p_review_due_at, p_ordered_by_type, NULLIF(btrim(COALESCE(p_ordered_by_name, '')), ''), p_order_received_as, p_reason_category, btrim(p_reason_note), NULLIF(btrim(COALESCE(p_document_path, '')), ''), p_actor_id, p_actor_id, 'active')
  RETURNING
    id INTO v_order_id;

  -- The standard windows this order covers stop for this resident. Covered, not
  -- merely later: scheduled_for and grace_ends_at are the window's own span and
  -- haven.monitoring_order_covers_window is the same overlap test the generator
  -- suppresses on, so an order that ends at 15:00 leaves that evening's windows
  -- exactly where they are.
  UPDATE
    public.resident_observation_tasks t
  SET
    status = 'excused',
    excused_reason = 'Replaced by a Monitoring Order'
  WHERE
    t.resident_id = p_resident_id
    AND t.deleted_at IS NULL
    AND t.monitoring_order_id IS NULL
    AND t.window_key IS NOT NULL
    AND t.status IN ('upcoming', 'due_soon')
    AND haven.monitoring_order_covers_window (v_starts_at, p_ends_at, t.scheduled_for, t.grace_ends_at);

  PERFORM
    public.generate_monitoring_order_tasks (v_resident.facility_id, NULL);

  PERFORM
    haven.notify_monitoring_order_created (v_order_id);

  RETURN v_order_id;
END;
$func$;

COMMENT ON FUNCTION haven.place_monitoring_order (uuid, integer, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text, uuid, uuid) IS
  'Places a Monitoring Order and performs every side effect one entails: excusing the standard windows it covers, writing its first order tasks and queueing the administrator notification. The single internal behind public.create_monitoring_order and the care event bridge, so an order placed by a care event is indistinguishable in effect from one a nurse entered. Performs NO authorization and takes its actor as an argument rather than reading the session, because a trigger firing under a care event write has no session to read. Revoked from every role including service_role for that reason; only the two definers that own the authorization decisions may reach it.';

REVOKE ALL ON FUNCTION haven.place_monitoring_order (uuid, integer, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- M11, part three. create_monitoring_order keeps every guard and delegates.
--
-- Changed from migration 424: the insert, the excuse, the task generation and
-- the notification move into haven.place_monitoring_order. Every authorization
-- check, the open ended review rule and the one active order rule are unchanged
-- and still happen here, before anything is written.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_monitoring_order (p_resident_id uuid, p_interval_minutes integer, p_ordered_by_type text, p_ordered_by_name text, p_order_received_as text, p_reason_category text, p_reason_note text, p_starts_at timestamptz DEFAULT NULL, p_ends_at timestamptz DEFAULT NULL, p_review_due_at timestamptz DEFAULT NULL, p_document_path text DEFAULT NULL)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_caller uuid;
  v_role text;
  v_resident record;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'A signed in staff member is required to enter a Monitoring Order'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    r.id,
    r.organization_id,
    r.facility_id INTO v_resident
  FROM
    public.residents r
  WHERE
    r.id = p_resident_id
    AND r.deleted_at IS NULL;

  IF v_resident.id IS NULL THEN
    RAISE EXCEPTION 'Resident not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_role := haven.app_role()::text;
  IF haven.organization_id() IS DISTINCT FROM v_resident.organization_id OR NOT haven.has_facility_access(v_resident.facility_id) THEN
    RAISE EXCEPTION 'Not allowed to enter a Monitoring Order at this facility'
      USING ERRCODE = '42501';
  END IF;
  IF NOT haven.can_record_observation(v_role) THEN
    RAISE EXCEPTION 'This role cannot enter a Monitoring Order'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.user_profiles up
    WHERE
      up.id = v_caller
      AND up.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'The signed in user has no staff profile to record against'
      USING ERRCODE = '42501';
  END IF;

  -- A person entering an order names the party. Only the care event bridge may
  -- leave it unnamed, and only because the watch instance named nobody.
  IF char_length(btrim(COALESCE(p_ordered_by_name, ''))) = 0 THEN
    RAISE EXCEPTION 'Say who ordered the monitoring'
      USING ERRCODE = '22023';
  END IF;

  IF p_ends_at IS NULL AND p_review_due_at IS NULL THEN
    RAISE EXCEPTION 'An open ended Monitoring Order needs a review date, so somebody has to decide about it again'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT
      1
    FROM
      public.resident_monitoring_orders existing
    WHERE
      existing.resident_id = p_resident_id
      AND existing.status = 'active'
      AND existing.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This resident is already on a Monitoring Order. Cancel it before entering a different interval.'
      USING ERRCODE = '23505';
  END IF;

  RETURN haven.place_monitoring_order (p_resident_id => p_resident_id, p_interval_minutes => p_interval_minutes, p_ordered_by_type => p_ordered_by_type, p_ordered_by_name => p_ordered_by_name, p_order_received_as => p_order_received_as, p_reason_category => p_reason_category, p_reason_note => p_reason_note, p_starts_at => p_starts_at, p_ends_at => p_ends_at, p_review_due_at => p_review_due_at, p_document_path => p_document_path, p_actor_id => v_caller, p_source_watch_instance_id => NULL);
END;
$func$;

COMMENT ON FUNCTION public.create_monitoring_order (uuid, integer, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text) IS
  'Enters a Monitoring Order and puts it in force immediately. Resident Aide and above at a facility the caller can reach, and the ordering party must be named. Delegates the write and every side effect to haven.place_monitoring_order, which the care event bridge also uses, so the two entry points cannot drift apart. There is no approval step. COL-37 ruling: definer required -- a caregiver has no INSERT grant on resident_observation_tasks and no write path to the notification ledger, and the command re-checks organization, facility access and role itself before writing anything.';

-- ---------------------------------------------------------------------------
-- M11, part four. The bridge goes through the same internal, and attributes the
-- order honestly or not at all.
--
-- Changed from migration 419: the direct INSERT becomes a call to
-- haven.place_monitoring_order, so a bridged order now excuses the standard
-- windows it covers, writes its order tasks immediately and notifies the
-- administrator. The ordering party is resolved from the watch instance instead
-- of being hardcoded, and the entered_by fallback to an arbitrary organization
-- administrator is gone. Both guards and the already finished check are
-- unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.bridge_watch_instance_to_monitoring_order ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_defaults record;
  v_interval integer;
  v_actor uuid;
  v_ordered_by_name text;
  v_review_due_at timestamptz;
  v_ends_at timestamptz;
BEGIN
  -- A watch instance that arrived already finished has nothing to observe.
  IF NEW.status IN ('ended', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Guard one: this watch instance already has its order. The partial unique
  -- index on source_watch_instance_id enforces it too; this keeps the trigger
  -- from raising rather than returning.
  IF EXISTS (
    SELECT
      1
    FROM
      public.resident_monitoring_orders o
    WHERE
      o.source_watch_instance_id = NEW.id
      AND o.deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;

  -- Guard two: the resident is already on an order. One active order per
  -- resident is an invariant of the model, not a race to lose.
  IF EXISTS (
    SELECT
      1
    FROM
      public.resident_monitoring_orders o
    WHERE
      o.resident_id = NEW.resident_id
      AND o.status = 'active'
      AND o.deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;

  SELECT
    * INTO v_defaults
  FROM
    haven.monitoring_order_bridge_defaults ();

  SELECT
    COALESCE(NULLIF(p.rule_definition_json ->> 'interval_minutes', '')::integer, v_defaults.interval_minutes) INTO v_interval
  FROM
    public.resident_watch_protocols p
  WHERE
    p.id = NEW.protocol_id;

  v_interval := COALESCE(v_interval, v_defaults.interval_minutes);
  IF v_interval < 15 OR v_interval > 720 THEN
    v_interval := v_defaults.interval_minutes;
  END IF;

  -- Two different questions, answered from two different places.
  --
  -- Who entered it: whoever caused this row to exist. The approver, then whoever
  -- last wrote it, then the session if there is one. All three are people who
  -- actually touched the watch instance. There is no fallback to an
  -- administrator picked by sort order, because an order attributed to somebody
  -- who never saw it is worse than an order attributed to nobody, and null is
  -- now a legal answer.
  SELECT
    up.id INTO v_actor
  FROM
    public.user_profiles up
  WHERE
    up.id IN (COALESCE(NEW.approved_by, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(NEW.updated_by, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid))
    AND up.deleted_at IS NULL
  ORDER BY
    (up.id = NEW.approved_by) DESC,
    (up.id = auth.uid()) DESC
  LIMIT 1;

  -- Who ordered the monitoring: only the approver of the watch instance, which
  -- is the nearest thing in this table to a person deciding the resident needs
  -- watching. Not whoever last edited the row, and not whoever happened to have
  -- a session open when a care event fired. Those people entered it; they did
  -- not order it. When the watch instance names no approver the order names
  -- nobody, and ordered_by_type says care_event so a reader can see why.
  SELECT
    up.full_name INTO v_ordered_by_name
  FROM
    public.user_profiles up
  WHERE
    up.id = NEW.approved_by
    AND up.deleted_at IS NULL;

  v_ends_at := NEW.ends_at;
  IF v_ends_at IS NOT NULL AND v_ends_at <= NEW.starts_at THEN
    v_ends_at := NULL;
  END IF;
  IF v_ends_at IS NULL THEN
    v_review_due_at := NEW.starts_at + make_interval(hours => v_defaults.review_after_hours);
  ELSE
    v_review_due_at := NULL;
  END IF;

  -- The bridge must never be the reason a care event write fails. It skips on
  -- its own guards above; anything unexpected past this point is recorded and
  -- swallowed rather than rolled back into the caller's transaction.
  BEGIN
    PERFORM
      haven.place_monitoring_order (p_resident_id => NEW.resident_id, p_interval_minutes => v_interval,
        -- Provenance, not a guessed clinical party. The watch instance says a
        -- care event happened; it does not say a nurse gave an order.
        p_ordered_by_type => 'care_event', p_ordered_by_name => v_ordered_by_name, p_order_received_as => 'written_order', p_reason_category => haven.monitoring_order_reason_from_watch_source (NEW.triggered_by_type), p_reason_note => 'Created from a care event watch instance. Source: ' || COALESCE(NEW.triggered_by_type, 'unrecorded') || '.', p_starts_at => NEW.starts_at, p_ends_at => v_ends_at, p_review_due_at => v_review_due_at, p_document_path => NULL, p_actor_id => v_actor, p_source_watch_instance_id => NEW.id);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Monitoring Order bridge could not place an order for watch instance %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION haven.bridge_watch_instance_to_monitoring_order () IS
  'Creates the Monitoring Order that corresponds to a new resident_watch_instances row, through haven.place_monitoring_order, so a bridged order excuses the standard windows it covers, writes its order tasks and notifies the administrator exactly as an operator entered one does. The ordering party is whoever the watch instance names and nobody otherwise: ordered_by_type is care_event and ordered_by_name is null rather than a clinical party the source never stated. Idle until the care event trigger that writes resident_watch_instances lands, which is spec open item 8, and it must never be the reason a care event write fails.';

NOTIFY pgrst,
'reload schema';

COMMIT;
