-- Spec 25A, Part 8 review fix. The last three display thresholds the module
-- held as TypeScript constants become facility configuration.
--
-- Why this exists
-- ---------------------------------------------------------------------------
-- `scripts/smart-rounding/config-literals.mjs` found four literals left in the
-- module after Part 8's sweep, and the orchestrator ruled that none of them is
-- an acceptable exception. Three of the four are thresholds that decide what an
-- operator sees, and a threshold that decides what an operator sees is facility
-- policy by the same argument that put every observation time, grace value and
-- escalation offset in a row.
--
--   documentation_lag_notable_minutes  a documentation lag worth a tone change
--   documentation_lag_serious_minutes  a lag worth the strongest tone
--   task_upcoming_lead_minutes         how far ahead a check reads "due soon"
--
-- The first two are operator-visible severity on the Integrity surface, which
-- is a surface a surveyor reads. A building deciding that a quarter of an hour
-- between observing a resident and writing it down is notable, and an hour is
-- serious, is a facility judgment and not an engineering constant.
--
-- The fourth literal is not here, because it is not configuration. The board
-- was recomputing `overdue`, `critically_overdue` and `missed` client side from
-- constants that stopped governing anything when Part 4 replaced the escalation
-- engine: `public.record_observation_escalation_rung` writes those statuses
-- from `facility_escalation_rungs`, which an administrator can edit. Moving an
-- escalation rung in the settings surface therefore left the board painting a
-- task critically overdue on a schedule nobody could see or change. That
-- recomputation is deleted rather than relocated; the same rows the engine
-- reads are now the only answer.
--
-- Seeded from the values the code carried, so no building's behaviour changes
-- on the day this lands. Every one of them is editable afterwards.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The columns
--
-- Added nullable, backfilled, then made NOT NULL, so the migration replays
-- against a database that already holds threshold rows.
-- ---------------------------------------------------------------------------
ALTER TABLE public.facility_observation_thresholds
  ADD COLUMN IF NOT EXISTS documentation_lag_notable_minutes integer NULL,
  ADD COLUMN IF NOT EXISTS documentation_lag_serious_minutes integer NULL,
  ADD COLUMN IF NOT EXISTS task_upcoming_lead_minutes integer NULL;

-- The seeded values are the ones the retired constants carried. They are
-- written here, in migration seed data, which is the one place decision D2
-- allows an observation policy value to be a literal.
UPDATE
  public.facility_observation_thresholds
SET
  documentation_lag_notable_minutes = 15
WHERE
  documentation_lag_notable_minutes IS NULL;

UPDATE
  public.facility_observation_thresholds
SET
  documentation_lag_serious_minutes = 60
WHERE
  documentation_lag_serious_minutes IS NULL;

UPDATE
  public.facility_observation_thresholds
SET
  task_upcoming_lead_minutes = 30
WHERE
  task_upcoming_lead_minutes IS NULL;

ALTER TABLE public.facility_observation_thresholds
  ALTER COLUMN documentation_lag_notable_minutes SET NOT NULL,
  ALTER COLUMN documentation_lag_notable_minutes SET DEFAULT 15,
  ALTER COLUMN documentation_lag_serious_minutes SET NOT NULL,
  ALTER COLUMN documentation_lag_serious_minutes SET DEFAULT 60,
  ALTER COLUMN task_upcoming_lead_minutes SET NOT NULL,
  ALTER COLUMN task_upcoming_lead_minutes SET DEFAULT 30;

-- Serious has to be at least notable, or the Integrity surface reads a lag as
-- serious and not notable at the same time. The CHECK is the only place that
-- ordering is guaranteed; a form is not.
ALTER TABLE public.facility_observation_thresholds
  DROP CONSTRAINT IF EXISTS facility_observation_thresholds_lag_positive;

ALTER TABLE public.facility_observation_thresholds
  ADD CONSTRAINT facility_observation_thresholds_lag_positive CHECK (documentation_lag_notable_minutes > 0
    AND documentation_lag_serious_minutes > 0
    AND task_upcoming_lead_minutes > 0);

ALTER TABLE public.facility_observation_thresholds
  DROP CONSTRAINT IF EXISTS facility_observation_thresholds_lag_ordered;

ALTER TABLE public.facility_observation_thresholds
  ADD CONSTRAINT facility_observation_thresholds_lag_ordered CHECK (documentation_lag_serious_minutes >= documentation_lag_notable_minutes);

COMMENT ON COLUMN public.facility_observation_thresholds.documentation_lag_notable_minutes IS
  'Minutes between observing a resident and recording it at which the Integrity surface changes tone. Facility policy, not an engineering constant: this is operator-visible severity on a surface a surveyor reads. Seeded at the value src/components/rounding/IntegrityFlagCard.tsx held as a constant before Part 8.';

COMMENT ON COLUMN public.facility_observation_thresholds.documentation_lag_serious_minutes IS
  'Minutes of documentation lag at which the Integrity surface shows the strongest tone. Must be at or above documentation_lag_notable_minutes, enforced by CHECK rather than by a form.';

COMMENT ON COLUMN public.facility_observation_thresholds.task_upcoming_lead_minutes IS
  'How far ahead of its due time a check reads as due soon rather than upcoming on the board. The only display band left in this module: overdue, critically_overdue and missed all come from resident_observation_tasks.status, which the escalation engine writes from facility_escalation_rungs, so the board and the configured ladder cannot disagree.';

COMMENT ON TABLE public.facility_observation_thresholds IS
  'Per facility warning thresholds and read defaults for the cadence settings surface and the rounding board, per spec 25A section 6.2. Rows rather than constants, so no threshold and no lookback span appears in a TypeScript file or an Edge Function body.';

-- ---------------------------------------------------------------------------
-- 2. A facility added later gets a threshold row, inherited
--
-- A gap this migration found rather than created: nothing gives a facility
-- created after migration 425 a facility_observation_thresholds row at all.
-- `public.ensure_facility_observation_defaults` is the function that hands a
-- new building the configuration its organization is already running, but it
-- was written in migration 418, before this table existed, so it copies the
-- shift model, the cadence version and the escalation policy and knows nothing
-- about thresholds. Every read in this module that needs a threshold therefore
-- finds nothing for a building added next year.
--
-- Closed the way 418 closed the same problem for cadence: a trigger on
-- public.facilities. It copies the organization's oldest existing row whole,
-- all seven columns, so there is one answer per organization rather than a
-- column default nobody chose. When the organization has nothing to inherit
-- from, which is the first facility of a brand new organization, the row is
-- inserted naming only its keys and every threshold takes its column default.
--
-- No value appears in this body. That is the point: the seeded numbers live in
-- section 1's migration seed data and in the column defaults, and this function
-- copies rather than restates them.
--
-- It cannot fail a facility insert. A building that exists without a threshold
-- row reads as a configuration gap on the settings surface, which is
-- recoverable; a building that could not be created at all is not.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.haven_seed_facility_observation_thresholds ()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
BEGIN
  BEGIN
    INSERT INTO public.facility_observation_thresholds (organization_id, facility_id, maximum_unobserved_gap_minutes, maximum_windows_per_resident_per_day, simulation_lookback_days, change_log_page_size, documentation_lag_notable_minutes, documentation_lag_serious_minutes, task_upcoming_lead_minutes)
    SELECT
      NEW.organization_id,
      NEW.id,
      t.maximum_unobserved_gap_minutes,
      t.maximum_windows_per_resident_per_day,
      t.simulation_lookback_days,
      t.change_log_page_size,
      t.documentation_lag_notable_minutes,
      t.documentation_lag_serious_minutes,
      t.task_upcoming_lead_minutes
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

    -- Nothing to inherit from. Keys only, so every threshold takes the column
    -- default rather than a number chosen here.
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
      -- Deliberately swallowed. See the note above: a facility insert must not
      -- fail because its thresholds could not be seeded.
      NULL;
  END;
  RETURN NEW;
END
$func$;

COMMENT ON FUNCTION public.haven_seed_facility_observation_thresholds () IS
  'Gives a newly inserted facility a facility_observation_thresholds row, copied whole from the organization oldest existing row so one organization has one answer, or at the column defaults when there is nothing to inherit. Closes the gap that public.ensure_facility_observation_defaults carries because migration 418 predates the thresholds table. Carries no threshold value of its own and cannot fail a facility insert.';

REVOKE ALL ON FUNCTION public.haven_seed_facility_observation_thresholds () FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.haven_seed_facility_observation_thresholds () TO service_role;

DROP TRIGGER IF EXISTS tr_facilities_seed_observation_thresholds ON public.facilities;

CREATE TRIGGER tr_facilities_seed_observation_thresholds
  AFTER INSERT ON public.facilities
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_seed_facility_observation_thresholds ();

-- ---------------------------------------------------------------------------
-- 3. Every existing building gets a row
--
-- The board read fails closed when a facility has no threshold row, which is
-- honest but useless. Migration 425 seeded a row per facility; this backstops a
-- facility created between 425 and here.
-- ---------------------------------------------------------------------------
INSERT INTO public.facility_observation_thresholds (organization_id, facility_id, maximum_unobserved_gap_minutes, maximum_windows_per_resident_per_day, simulation_lookback_days, change_log_page_size)
SELECT
  f.organization_id,
  f.id,
  1440,
  8,
  14,
  10
FROM
  public.facilities f
WHERE
  f.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.facility_observation_thresholds existing
    WHERE
      existing.facility_id = f.id);

NOTIFY pgrst,
'reload schema';

COMMIT;
