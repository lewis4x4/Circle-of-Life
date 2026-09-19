-- Spec 25A section 6.2, the last two promises the module deferred.
--
-- Two functions in this module returned constants with a comment saying the
-- cadence configuration work would replace them with a facility read. Part 7
-- built `public.facility_observation_thresholds` and did not do it, so the
-- promise stayed a promise:
--
--   public.monitoring_order_interval_options()  ARRAY[30, 60, 120, 240], 15, 720
--   haven.observation_grace_formula()           4.0, 10, 60
--
-- Spec 6.2 lists "Monitoring Order intervals: the preset list offered in the
-- picker, and the grace formula divisor" as per-facility configuration an
-- administrator edits without a migration or a deploy. Both are now rows.
--
-- How this surfaced is worth recording. The Part 8 hosted row level security
-- check ran against staging and reported that the interval options call
-- returned nothing. It had not: the script was reading a `RETURNS TABLE`
-- function as though it answered a single object, and PostgREST answers one
-- with an array of one row. Fixing the read exposed the deferred requirement
-- behind it, which had been sitting invisible behind a comment for four parts.
--
-- Seeded at the values the function bodies carried, so no building's behaviour
-- changes on the day this lands.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.facility_observation_thresholds
  ADD COLUMN IF NOT EXISTS monitoring_order_interval_presets integer[] NULL,
  ADD COLUMN IF NOT EXISTS monitoring_order_interval_min_minutes integer NULL,
  ADD COLUMN IF NOT EXISTS monitoring_order_interval_max_minutes integer NULL,
  ADD COLUMN IF NOT EXISTS observation_grace_divisor numeric NULL,
  ADD COLUMN IF NOT EXISTS observation_grace_floor_minutes integer NULL,
  ADD COLUMN IF NOT EXISTS observation_grace_ceiling_minutes integer NULL;

-- The seeded values, in migration seed data, which is the one place decision
-- D2 allows an observation policy value to be a literal. The bounds match the
-- CHECK on resident_monitoring_orders.interval_minutes; section 3 below makes
-- that agreement a constraint rather than a coincidence.
UPDATE
  public.facility_observation_thresholds
SET
  monitoring_order_interval_presets = COALESCE(monitoring_order_interval_presets, ARRAY[30, 60, 120, 240]::integer[]),
  monitoring_order_interval_min_minutes = COALESCE(monitoring_order_interval_min_minutes, 15),
  monitoring_order_interval_max_minutes = COALESCE(monitoring_order_interval_max_minutes, 720),
  observation_grace_divisor = COALESCE(observation_grace_divisor, 4.0::numeric),
  observation_grace_floor_minutes = COALESCE(observation_grace_floor_minutes, 10),
  observation_grace_ceiling_minutes = COALESCE(observation_grace_ceiling_minutes, 60)
WHERE
  monitoring_order_interval_presets IS NULL
  OR monitoring_order_interval_min_minutes IS NULL
  OR monitoring_order_interval_max_minutes IS NULL
  OR observation_grace_divisor IS NULL
  OR observation_grace_floor_minutes IS NULL
  OR observation_grace_ceiling_minutes IS NULL;

ALTER TABLE public.facility_observation_thresholds
  ALTER COLUMN monitoring_order_interval_presets SET NOT NULL,
  ALTER COLUMN monitoring_order_interval_presets SET DEFAULT ARRAY[30, 60, 120, 240]::integer[],
  ALTER COLUMN monitoring_order_interval_min_minutes SET NOT NULL,
  ALTER COLUMN monitoring_order_interval_min_minutes SET DEFAULT 15,
  ALTER COLUMN monitoring_order_interval_max_minutes SET NOT NULL,
  ALTER COLUMN monitoring_order_interval_max_minutes SET DEFAULT 720,
  ALTER COLUMN observation_grace_divisor SET NOT NULL,
  ALTER COLUMN observation_grace_divisor SET DEFAULT 4.0,
  ALTER COLUMN observation_grace_floor_minutes SET NOT NULL,
  ALTER COLUMN observation_grace_floor_minutes SET DEFAULT 10,
  ALTER COLUMN observation_grace_ceiling_minutes SET NOT NULL,
  ALTER COLUMN observation_grace_ceiling_minutes SET DEFAULT 60;

-- ---------------------------------------------------------------------------
-- 2. The constraints
--
-- authenticated holds UPDATE on this table, so every one of these has to be a
-- constraint. A form cannot be the thing that stops an administrator offering
-- the floor a 5 minute interval the task table will reject on insert.
-- ---------------------------------------------------------------------------
ALTER TABLE public.facility_observation_thresholds
  DROP CONSTRAINT IF EXISTS facility_observation_thresholds_interval_bounds;

ALTER TABLE public.facility_observation_thresholds
  ADD CONSTRAINT facility_observation_thresholds_interval_bounds CHECK (monitoring_order_interval_min_minutes >= 15
    AND monitoring_order_interval_max_minutes <= 720
    AND monitoring_order_interval_min_minutes <= monitoring_order_interval_max_minutes);

-- Two immutable helpers, because a CHECK constraint may not contain a subquery
-- and PostgreSQL has no array minimum or maximum in core: the obvious
-- `NOT EXISTS (SELECT 1 FROM unnest(...))` is rejected with
-- "cannot use subquery in check constraint". A function call in a CHECK is
-- allowed, and these are the smallest ones that express the rule.
--
-- The usual caveat applies and is worth naming: PostgreSQL does not revalidate
-- a CHECK when a function it calls changes. These two are total over their
-- input and have no reason to change; if one ever does, revalidate the
-- constraint rather than assuming the rows still satisfy it.
CREATE OR REPLACE FUNCTION haven.int_array_min (p_values integer[])
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
  SET search_path = pg_catalog
  AS $func$
  SELECT
    min(v)
  FROM
    unnest(p_values) AS v;
$func$;

CREATE OR REPLACE FUNCTION haven.int_array_max (p_values integer[])
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
  SET search_path = pg_catalog
  AS $func$
  SELECT
    max(v)
  FROM
    unnest(p_values) AS v;
$func$;

COMMENT ON FUNCTION haven.int_array_min (integer[]) IS
  'Smallest value in an integer array. Exists because a CHECK constraint may not contain a subquery and core PostgreSQL has no array minimum; used by facility_observation_thresholds_presets_within_bounds.';

COMMENT ON FUNCTION haven.int_array_max (integer[]) IS
  'Largest value in an integer array. Exists because a CHECK constraint may not contain a subquery and core PostgreSQL has no array maximum; used by facility_observation_thresholds_presets_within_bounds.';

REVOKE ALL ON FUNCTION haven.int_array_min (integer[]) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION haven.int_array_max (integer[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION haven.int_array_min (integer[]) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION haven.int_array_max (integer[]) TO authenticated, service_role;

ALTER TABLE public.facility_observation_thresholds
  DROP CONSTRAINT IF EXISTS facility_observation_thresholds_presets_within_bounds;

-- A preset outside the bounds is an entry form offering a value its own
-- validation refuses. A preset outside 15 to 720 is worse: the picker offers
-- it, the caregiver taps it, and resident_monitoring_orders_interval_minutes
-- rejects the insert with a constraint name.
ALTER TABLE public.facility_observation_thresholds
  ADD CONSTRAINT facility_observation_thresholds_presets_within_bounds CHECK (array_length(monitoring_order_interval_presets, 1) >= 1
    AND haven.int_array_min (monitoring_order_interval_presets) >= monitoring_order_interval_min_minutes
    AND haven.int_array_max (monitoring_order_interval_presets) <= monitoring_order_interval_max_minutes);

ALTER TABLE public.facility_observation_thresholds
  DROP CONSTRAINT IF EXISTS facility_observation_thresholds_grace_formula;

-- A divisor at or below zero divides by nothing or inverts the rule. A ceiling
-- below the floor makes LEAST(ceiling, GREATEST(floor, ...)) answer the ceiling
-- always, which silently flattens the interval scaling to one number.
ALTER TABLE public.facility_observation_thresholds
  ADD CONSTRAINT facility_observation_thresholds_grace_formula CHECK (observation_grace_divisor > 0
    AND observation_grace_floor_minutes > 0
    AND observation_grace_ceiling_minutes >= observation_grace_floor_minutes);

COMMENT ON COLUMN public.facility_observation_thresholds.monitoring_order_interval_presets IS
  'The Monitoring Order intervals the entry form offers as presets, per spec 25A section 6.2. A row since migration 432; public.monitoring_order_interval_options returned this list as a literal for four parts behind a comment promising configuration would replace it.';

COMMENT ON COLUMN public.facility_observation_thresholds.monitoring_order_interval_min_minutes IS
  'Smallest custom Monitoring Order interval this building accepts. Constrained at or above the floor of the CHECK on resident_monitoring_orders.interval_minutes, so the picker cannot offer a value the table refuses.';

COMMENT ON COLUMN public.facility_observation_thresholds.monitoring_order_interval_max_minutes IS
  'Largest custom Monitoring Order interval this building accepts. Constrained at or below the ceiling of the CHECK on resident_monitoring_orders.interval_minutes.';

COMMENT ON COLUMN public.facility_observation_thresholds.observation_grace_divisor IS
  'The divisor of the interval scaled grace rule, spec 25A section 5.2: LEAST(ceiling, GREATEST(floor, CEIL(interval / divisor))). A row since migration 432; haven.observation_grace_formula returned it as a literal before that.';

COMMENT ON COLUMN public.facility_observation_thresholds.observation_grace_floor_minutes IS
  'Smallest grace the interval scaled rule ever produces, however short the interval.';

COMMENT ON COLUMN public.facility_observation_thresholds.observation_grace_ceiling_minutes IS
  'Largest grace the interval scaled rule ever produces, however long the interval. At or above observation_grace_floor_minutes, or the rule flattens to one number.';

-- ---------------------------------------------------------------------------
-- 3. A new building inherits all of it
--
-- Migration 431's trigger names its columns, so the six added here have to be
-- named too or a building added next year starts on the column defaults rather
-- than on what its organization is running. Same body, wider column list.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.haven_seed_facility_observation_thresholds ()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
BEGIN
  BEGIN
    INSERT INTO public.facility_observation_thresholds (organization_id, facility_id, maximum_unobserved_gap_minutes, maximum_windows_per_resident_per_day, simulation_lookback_days, change_log_page_size, documentation_lag_notable_minutes, documentation_lag_serious_minutes, task_upcoming_lead_minutes, monitoring_order_interval_presets, monitoring_order_interval_min_minutes, monitoring_order_interval_max_minutes, observation_grace_divisor, observation_grace_floor_minutes, observation_grace_ceiling_minutes)
    SELECT
      NEW.organization_id,
      NEW.id,
      t.maximum_unobserved_gap_minutes,
      t.maximum_windows_per_resident_per_day,
      t.simulation_lookback_days,
      t.change_log_page_size,
      t.documentation_lag_notable_minutes,
      t.documentation_lag_serious_minutes,
      t.task_upcoming_lead_minutes,
      t.monitoring_order_interval_presets,
      t.monitoring_order_interval_min_minutes,
      t.monitoring_order_interval_max_minutes,
      t.observation_grace_divisor,
      t.observation_grace_floor_minutes,
      t.observation_grace_ceiling_minutes
    FROM
      public.facility_observation_thresholds t
    WHERE
      t.organization_id = NEW.organization_id
      AND t.facility_id <> NEW.id
      AND t.deleted_at IS NULL
    ORDER BY
      t.created_at,
      t.facility_id
    LIMIT 1
    ON CONFLICT (facility_id)
      DO NOTHING;

    INSERT INTO public.facility_observation_thresholds (organization_id, facility_id)
    SELECT
      NEW.organization_id,
      NEW.id
    WHERE
      NOT EXISTS (
        SELECT
          1
        FROM
          public.facility_observation_thresholds existing
        WHERE
          existing.facility_id = NEW.id)
    ON CONFLICT (facility_id)
      DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN
      -- Swallowed, never silently. See migration 431 for why.
      RAISE WARNING 'observation thresholds were not seeded for facility %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END
$func$;

-- ---------------------------------------------------------------------------
-- 4. The grace formula reads the row
--
-- The old zero argument signature is dropped rather than kept alongside. An
-- overload with no facility would have to guess one, and a grace value computed
-- against the wrong building is the kind of wrong answer that reads perfectly
-- plausible. Every caller is updated in this migration.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.observation_task_window_close (uuid);

DROP FUNCTION IF EXISTS public.observation_grace_minutes (integer);

DROP FUNCTION IF EXISTS public.monitoring_order_grace_minutes (integer);

DROP FUNCTION IF EXISTS haven.observation_grace_formula ();

DROP FUNCTION IF EXISTS public.monitoring_order_interval_options ();

CREATE OR REPLACE FUNCTION haven.observation_grace_formula (p_facility_id uuid)
  RETURNS TABLE (
    divisor numeric,
    floor_minutes integer,
    ceiling_minutes integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    t.observation_grace_divisor,
    t.observation_grace_floor_minutes,
    t.observation_grace_ceiling_minutes
  FROM
    public.facility_observation_thresholds t
  WHERE
    t.facility_id = p_facility_id
    AND t.deleted_at IS NULL;
$func$;

COMMENT ON FUNCTION haven.observation_grace_formula (uuid) IS
  'The divisor and the bounds of the interval scaled grace rule for one building, read from public.facility_observation_thresholds. Was a function body returning three constants until migration 432, behind a comment promising exactly this. Definer because the escalation engine and the task writer both need it for a building the caller may not be able to read directly; it exposes three integers of facility policy and no resident data.';

CREATE OR REPLACE FUNCTION public.monitoring_order_grace_minutes (p_facility_id uuid, p_interval_minutes integer)
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_grace integer;
BEGIN
  SELECT
    LEAST(g.ceiling_minutes, GREATEST(g.floor_minutes, ceil(p_interval_minutes::numeric / g.divisor)::integer)) INTO v_grace
  FROM
    haven.observation_grace_formula (p_facility_id) g;

  -- A building with no thresholds row would otherwise answer NULL, and a NULL
  -- grace flows into resident_observation_tasks.grace_ends_at and fails on a
  -- NOT NULL a long way from here. Migration 431 gives every facility a row and
  -- a trigger keeps that true, so this is a genuine defect rather than a state
  -- to tolerate.
  IF v_grace IS NULL THEN
    RAISE EXCEPTION 'facility % has no observation thresholds row, so the interval scaled grace rule has no divisor', p_facility_id
      USING ERRCODE = '22023';
  END IF;

  RETURN v_grace;
END
$func$;

COMMENT ON FUNCTION public.monitoring_order_grace_minutes (uuid, integer) IS
  'Grace in minutes for an observation interval at one building, per spec section 5.2: LEAST(ceiling, GREATEST(floor, CEIL(interval / divisor))). The single definition of the rule; the escalation engine and the Monitoring Order task writer both read it rather than restating it. Raises 22023 rather than answering NULL when the building has no thresholds row. COL-37 ruling: switch to invoker -- the interval scaled grace divisor is facility policy, not a privileged read. facility_observation_thresholds carries a facility scoped SELECT policy, so invoker rights answer for the buildings the caller is granted and no others, and the generator and the escalation engine run as service_role, which bypasses row level security and needs no definer rights.';

CREATE OR REPLACE FUNCTION public.observation_grace_minutes (p_facility_id uuid, p_interval_minutes integer)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    public.monitoring_order_grace_minutes (p_facility_id, p_interval_minutes);
$func$;

COMMENT ON FUNCTION public.observation_grace_minutes (uuid, integer) IS
  'Grace in minutes for any observation interval, standard cadence or Monitoring Order. Delegates to public.monitoring_order_grace_minutes, which is the single definition of the rule and reads its divisor and bounds from the facility row. This function restates no arithmetic; spec section 5.2 is explicit that there is one rule and not two.';

-- The resolver keeps its signature. It already joins the task, so the facility
-- it needs is on a row it is already reading and no caller changes.
CREATE OR REPLACE FUNCTION public.observation_task_window_close (p_task_id uuid)
  RETURNS timestamptz
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    CASE WHEN o.id IS NOT NULL THEN
      t.due_at + make_interval(mins => public.observation_grace_minutes (t.facility_id, o.interval_minutes))
    WHEN w.id IS NOT NULL THEN
      t.due_at + make_interval(mins => w.grace_after_minutes)
    ELSE
      t.grace_ends_at
    END
  FROM
    public.resident_observation_tasks t
    LEFT JOIN public.resident_monitoring_orders o ON o.id = t.monitoring_order_id
      AND o.deleted_at IS NULL
    LEFT JOIN public.facility_cadence_windows w ON w.cadence_version_id = t.cadence_version_id
      AND w.window_key = t.window_key
      AND w.deleted_at IS NULL
  WHERE
    t.id = p_task_id
    AND t.deleted_at IS NULL;
$func$;

COMMENT ON FUNCTION public.observation_task_window_close (uuid) IS
  'The instant a task''s observation window closes: due_at plus the stamped cadence window grace for a cadence task, due_at plus the interval scaled grace for a Monitoring Order task, and the stored grace_ends_at for a legacy plan task. The single resolver; every escalation offset is measured from what this returns and no caller computes it. Reads the task''s own facility_id for the grace formula, so the signature is unchanged by migration 432.';

-- ---------------------------------------------------------------------------
-- 5. The interval picker reads the row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.monitoring_order_interval_options (p_facility_id uuid)
  RETURNS TABLE (
    preset_minutes integer[],
    min_minutes integer,
    max_minutes integer)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    t.monitoring_order_interval_presets,
    t.monitoring_order_interval_min_minutes,
    t.monitoring_order_interval_max_minutes
  FROM
    public.facility_observation_thresholds t
  WHERE
    t.facility_id = p_facility_id
    AND t.deleted_at IS NULL;
$func$;

COMMENT ON FUNCTION public.monitoring_order_interval_options (uuid) IS
  'The Monitoring Order intervals one building offers as presets, and the bounds a custom value must fall inside, read from public.facility_observation_thresholds. Returns no row for a building with no thresholds row, which the entry form reads as a configuration gap rather than substituting a list of its own. Invoker rights: the facility scoped SELECT policy on the thresholds table is the access control.';

-- ---------------------------------------------------------------------------
-- 6. The one caller that has to change
--
-- public.generate_monitoring_order_tasks is replayed from its migration 427
-- text with a single line changed: the grace call now passes the order's own
-- facility. Nothing else in the body differs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_monitoring_order_tasks (p_facility_id uuid DEFAULT NULL, p_through timestamptz DEFAULT NULL)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_order record;
  v_timezone text;
  v_horizon timestamptz;
  v_grace integer;
  v_rows integer;
  v_inserted integer := 0;
BEGIN
  FOR v_order IN
  SELECT
    o.id,
    o.organization_id,
    o.entity_id,
    o.facility_id,
    o.resident_id,
    o.interval_minutes,
    o.starts_at,
    o.ends_at
  FROM
    public.resident_monitoring_orders o
  WHERE
    o.status = 'active'
    AND o.deleted_at IS NULL
    AND (p_facility_id IS NULL OR o.facility_id = p_facility_id)
    -- The resident is still in the building this order belongs to, and still in
    -- a status the module generates for.
    AND EXISTS (
      SELECT
        1
      FROM
        public.residents r
      WHERE
        r.id = o.resident_id
        AND r.deleted_at IS NULL
        AND r.facility_id = o.facility_id
        AND r.status = 'active')
  ORDER BY
    o.facility_id,
    o.starts_at LOOP
      SELECT
        COALESCE(f.timezone, 'America/New_York') INTO v_timezone
      FROM
        public.facilities f
      WHERE
        f.id = v_order.facility_id;

      IF p_through IS NOT NULL THEN
        v_horizon := p_through;
      ELSE
        SELECT
          nxt.ends_at_utc INTO v_horizon
        FROM
          public.facility_next_shift_window (v_order.facility_id, now()) nxt;
      END IF;

      -- A facility with no shift definitions yet generates nothing rather than
      -- guessing a horizon of its own.
      IF v_horizon IS NULL THEN
        CONTINUE;
      END IF;

      -- Safety stop. Nothing should ask for more than a week of order tasks in
      -- one call, and a 15 minute order over an open ended horizon would try to
      -- write forever.
      v_horizon := LEAST(v_horizon, now() + interval '7 days');
      IF v_order.ends_at IS NOT NULL THEN
        v_horizon := LEAST(v_horizon, v_order.ends_at);
      END IF;
      IF v_horizon < v_order.starts_at THEN
        CONTINUE;
      END IF;

      v_grace := public.monitoring_order_grace_minutes (v_order.facility_id, v_order.interval_minutes);

      INSERT INTO public.resident_observation_tasks (organization_id, entity_id, facility_id, resident_id, monitoring_order_id, service_date, scheduled_for, due_at, grace_ends_at, status)
      SELECT
        v_order.organization_id,
        v_order.entity_id,
        v_order.facility_id,
        v_order.resident_id,
        v_order.id,
        ((occurrence AT TIME ZONE v_timezone)::date),
        occurrence,
        occurrence,
        occurrence + make_interval(mins => v_grace),
        'upcoming'::public.resident_observation_task_status
      FROM
        generate_series(v_order.starts_at, v_horizon, make_interval(mins => v_order.interval_minutes)) AS occurrence
      WHERE
        -- Never backfill a check nobody could have done. An order entered at
        -- 21:00 with a start time of 21:00 produces its first task at 21:00, not
        -- a row for every interval since the paperwork was signed.
        occurrence + make_interval(mins => v_grace) >= now()
      ON CONFLICT (monitoring_order_id, due_at)
        WHERE deleted_at IS NULL AND monitoring_order_id IS NOT NULL
        DO NOTHING;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_inserted := v_inserted + v_rows;
    END LOOP;

  RETURN v_inserted;
END;
$func$;

COMMENT ON FUNCTION public.generate_monitoring_order_tasks (uuid, timestamptz) IS
  'Writes the observation tasks an active Monitoring Order is due, at interval_minutes from starts_at with grace from public.monitoring_order_grace_minutes read against the order''s own facility, out to the end of the next shift or to an explicit horizon. Generates nothing for an order whose resident has transferred away or is no longer in a generating status, so a stood down task is not handed straight back on the next tick. Idempotent: a second call inserts nothing. COL-37 ruling: definer required -- the task generator calls it as service_role and the create command calls it on behalf of a caregiver who has no INSERT grant on resident_observation_tasks, and it writes only rows derived from orders the caller already had to be permitted to create. Not granted to authenticated.';

-- ---------------------------------------------------------------------------
-- 7. Grants
--
-- Restated in full because every function above was dropped and recreated, and
-- a recreated function comes back with the default PUBLIC EXECUTE that the
-- module revokes everywhere.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION haven.observation_grace_formula (uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION haven.observation_grace_formula (uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.monitoring_order_grace_minutes (uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.monitoring_order_grace_minutes (uuid, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.observation_grace_minutes (uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.observation_grace_minutes (uuid, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.observation_task_window_close (uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.observation_task_window_close (uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.monitoring_order_interval_options (uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.monitoring_order_interval_options (uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.generate_monitoring_order_tasks (uuid, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.generate_monitoring_order_tasks (uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.haven_seed_facility_observation_thresholds () FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.haven_seed_facility_observation_thresholds () TO service_role;

NOTIFY pgrst,
'reload schema';

COMMIT;
