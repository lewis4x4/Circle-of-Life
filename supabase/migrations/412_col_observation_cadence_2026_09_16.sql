-- Smart Rounding: facility observation cadence as versioned configuration.
-- Spec: docs/specs/25A-smart-rounding-cadence-and-watchlist.md sections 2, 6.1, 6.3.
--
-- The 2026-09-16 cadence decision replaces the 2026-08-14 per facility presets
-- seeded by migration 310 and the wing staggered times seeded by migration 219.
-- Six windows per resident per 24 hours at every facility, three per 12 hour
-- shift, with a 60 minute grace that is one sided at the two shift change
-- windows so the incoming shift is the one that lays eyes on the resident.
--
-- Everything in this file that looks like a policy number is seed data, not a
-- constant. Configuration is versioned and effective dated from the first
-- migration: a change creates a new version and never mutates the version that
-- was in force, so a compliance report run for a past date recomputes to the
-- same numbers after the cadence changes. Task rows carry cadence_version_id so
-- the compliance read joins through the stamp rather than through current
-- configuration.
--
-- No observation time, grace value or shift boundary may appear in any
-- TypeScript file or Edge Function body. public.facility_observation_windows_for_date
-- is the single place window arithmetic lives; callers read rows from it.
--
-- Spec deviation recorded here on purpose: spec section 2.1 names the 22:00
-- window `evening`. The build rule for this module forbids writing or rendering
-- `evening` anywhere in the rounding surface, because the retired three daypart
-- model used that word for a shift. The window is therefore seeded as
-- `late_evening`. Changing it back is a one line seed change.

BEGIN;

-- ---------------------------------------------------------------------------
-- Shift definitions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_shift_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  shift_key text NOT NULL CHECK (shift_key ~ '^[a-z0-9_]+$'),
  -- The roster still speaks the fixed shift_type enum. shift_key is editable
  -- configuration and may be renamed; shift_assignments.shift_type is not and
  -- cannot. Joining a renamed key straight onto the enum matches nothing and
  -- fails silently, which reads as "nobody was assigned" rather than as an
  -- error, so the mapping is stored rather than inferred from the key.
  roster_shift_type public.shift_type NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  starts_at_local time NOT NULL,
  ends_at_local time NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_shift_definitions_key
  ON public.facility_shift_definitions (facility_id, shift_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_facility_shift_definitions_facility_order
  ON public.facility_shift_definitions (facility_id, sort_order)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.facility_shift_definitions IS
  'Per facility shift model for the observation module. Two 12 hour shifts at every facility; the count, keys, labels and local times are all editable configuration.';
COMMENT ON COLUMN public.facility_shift_definitions.roster_shift_type IS
  'Which shift_type value on shift_assignments this shift corresponds to. shift_key is renameable configuration; the roster enum is not. Assignment lookup joins through this column so renaming a shift cannot silently orphan every assignment.';
COMMENT ON COLUMN public.facility_shift_definitions.ends_at_local IS
  'Local end time. When it is at or before starts_at_local the shift crosses midnight and runs to the same clock time on the next day.';

-- ---------------------------------------------------------------------------
-- Cadence versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_cadence_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL CHECK (status IN ('draft', 'pending_approval', 'scheduled', 'active', 'superseded')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NULL,
  change_reason text NOT NULL CHECK (char_length(change_reason) BETWEEN 1 AND 500),
  source_template_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  activated_by uuid NULL REFERENCES public.user_profiles (id),
  activated_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT facility_cadence_versions_facility_version_key UNIQUE (facility_id, version_number),
  CONSTRAINT facility_cadence_versions_effective_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_cadence_versions_one_active
  ON public.facility_cadence_versions (facility_id)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_facility_cadence_versions_facility_effective
  ON public.facility_cadence_versions (facility_id, effective_from DESC)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.facility_cadence_versions IS
  'Effective dated observation cadence versions. A change creates a new version; a version that was in force is never mutated. resident_observation_tasks.cadence_version_id stamps which version generated each task.';
COMMENT ON COLUMN public.facility_cadence_versions.source_template_id IS
  'Organization cadence template this version was copied from, when any. Left unconstrained here; the foreign key to cadence_templates lands with the templates migration.';

-- ---------------------------------------------------------------------------
-- Cadence windows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_cadence_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  cadence_version_id uuid NOT NULL REFERENCES public.facility_cadence_versions (id) ON DELETE CASCADE,
  window_key text NOT NULL CHECK (window_key ~ '^[a-z0-9_]+$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  due_at_local time NOT NULL,
  grace_before_minutes integer NOT NULL CHECK (grace_before_minutes >= 0),
  grace_after_minutes integer NOT NULL CHECK (grace_after_minutes >= 0),
  shift_key text NOT NULL CHECK (shift_key ~ '^[a-z0-9_]+$'),
  sort_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT facility_cadence_windows_version_key UNIQUE (cadence_version_id, window_key)
);

CREATE INDEX IF NOT EXISTS idx_facility_cadence_windows_version_order
  ON public.facility_cadence_windows (cadence_version_id, sort_order)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.facility_cadence_windows IS
  'The observation windows belonging to one cadence version. Times are facility local; public.facility_observation_windows_for_date converts them against facilities.timezone.';
COMMENT ON COLUMN public.facility_cadence_windows.grace_before_minutes IS
  'Minutes the window opens before its due time. Zero on a window whose due time is a shift start, so the outgoing shift cannot clear the incoming shift first look.';

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.facility_shift_definitions, public.facility_cadence_versions,
  public.facility_cadence_windows FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON public.facility_shift_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.facility_cadence_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.facility_cadence_windows TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_shift_definitions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_cadence_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_cadence_windows TO service_role;

ALTER TABLE public.facility_shift_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_cadence_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_cadence_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_shift_definitions_select ON public.facility_shift_definitions;
CREATE POLICY facility_shift_definitions_select ON public.facility_shift_definitions
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP POLICY IF EXISTS facility_shift_definitions_insert ON public.facility_shift_definitions;
CREATE POLICY facility_shift_definitions_insert ON public.facility_shift_definitions
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP POLICY IF EXISTS facility_shift_definitions_update ON public.facility_shift_definitions;
CREATE POLICY facility_shift_definitions_update ON public.facility_shift_definitions
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS facility_cadence_versions_select ON public.facility_cadence_versions;
CREATE POLICY facility_cadence_versions_select ON public.facility_cadence_versions
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- Proposing a change is facility_admin and manager work; activating it is not.
-- The propose and approve split is enforced by the versioning RPCs; at table
-- level a proposal may only ever land as draft or pending_approval.
DROP POLICY IF EXISTS facility_cadence_versions_insert ON public.facility_cadence_versions;
CREATE POLICY facility_cadence_versions_insert ON public.facility_cadence_versions
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (haven.app_role () IN ('owner', 'org_admin')
      OR (haven.app_role () IN ('facility_admin', 'manager')
        AND status IN ('draft', 'pending_approval'))));

DROP POLICY IF EXISTS facility_cadence_versions_update ON public.facility_cadence_versions;
CREATE POLICY facility_cadence_versions_update ON public.facility_cadence_versions
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS facility_cadence_windows_select ON public.facility_cadence_windows;
CREATE POLICY facility_cadence_windows_select ON public.facility_cadence_windows
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP POLICY IF EXISTS facility_cadence_windows_insert ON public.facility_cadence_windows;
CREATE POLICY facility_cadence_windows_insert ON public.facility_cadence_windows
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_cadence_versions v
      WHERE
        v.id = cadence_version_id
        AND v.facility_id = facility_cadence_windows.facility_id
        AND v.deleted_at IS NULL
        AND (haven.app_role () IN ('owner', 'org_admin')
          OR (haven.app_role () IN ('facility_admin', 'manager')
            AND v.status IN ('draft', 'pending_approval')))));

DROP POLICY IF EXISTS facility_cadence_windows_update ON public.facility_cadence_windows;
CREATE POLICY facility_cadence_windows_update ON public.facility_cadence_windows
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_cadence_versions v
      WHERE
        v.id = facility_cadence_windows.cadence_version_id
        AND v.deleted_at IS NULL
        AND v.status IN ('draft', 'pending_approval')
        AND (haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'manager'))))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'manager'));

-- ---------------------------------------------------------------------------
-- Updated at and audit triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS tr_facility_shift_definitions_set_updated_at ON public.facility_shift_definitions;
CREATE TRIGGER tr_facility_shift_definitions_set_updated_at
  BEFORE UPDATE ON public.facility_shift_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_facility_cadence_versions_set_updated_at ON public.facility_cadence_versions;
CREATE TRIGGER tr_facility_cadence_versions_set_updated_at
  BEFORE UPDATE ON public.facility_cadence_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_facility_cadence_windows_set_updated_at ON public.facility_cadence_windows;
CREATE TRIGGER tr_facility_cadence_windows_set_updated_at
  BEFORE UPDATE ON public.facility_cadence_windows
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_facility_shift_definitions_audit ON public.facility_shift_definitions;
CREATE TRIGGER tr_facility_shift_definitions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_shift_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_facility_cadence_versions_audit ON public.facility_cadence_versions;
CREATE TRIGGER tr_facility_cadence_versions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_cadence_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_facility_cadence_windows_audit ON public.facility_cadence_windows;
CREATE TRIGGER tr_facility_cadence_windows_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_cadence_windows
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

-- ---------------------------------------------------------------------------
-- Seed: two 12 hour shifts at every COL facility
--
-- Selected by organization rather than by a name list. Migration 318 realigned
-- two of the five facility names to their registered form, so any later
-- migration carrying the pre-318 names silently seeds three facilities and
-- reports success. Every facility in the organization inherits the cadence,
-- which is also what should happen when a sixth building is added.
-- ---------------------------------------------------------------------------
WITH col_facility AS (
  SELECT
    f.id,
    f.organization_id
  FROM
    public.facilities f
  WHERE
    f.organization_id = '00000000-0000-0000-0000-000000000001'
    AND f.deleted_at IS NULL
),
shift_seed (shift_key, roster_shift_type, label, starts_at_local, ends_at_local, sort_order) AS (
  VALUES ('day', 'day'::public.shift_type, 'Day', '06:00'::time, '18:00'::time, 0),
    ('night', 'night'::public.shift_type, 'Night', '18:00'::time, '06:00'::time, 1)
)
INSERT INTO public.facility_shift_definitions (organization_id, facility_id, shift_key, roster_shift_type, label, starts_at_local, ends_at_local, sort_order, active)
SELECT
  cf.organization_id,
  cf.id,
  ss.shift_key,
  ss.roster_shift_type,
  ss.label,
  ss.starts_at_local,
  ss.ends_at_local,
  ss.sort_order,
  TRUE
FROM
  col_facility cf
  CROSS JOIN shift_seed ss
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      public.facility_shift_definitions existing
    WHERE
      existing.facility_id = cf.id
      AND existing.shift_key = ss.shift_key
      AND existing.deleted_at IS NULL);

-- ---------------------------------------------------------------------------
-- Seed: cadence version 1, active, at every COL facility
-- ---------------------------------------------------------------------------
INSERT INTO public.facility_cadence_versions (organization_id, facility_id, version_number, status, effective_from, change_reason, activated_at)
SELECT
  f.organization_id,
  f.id,
  1,
  'active',
  '2026-09-16T00:00:00Z'::timestamptz,
  'Uniform six window observation cadence adopted by the 2026-09-16 cadence decision. Supersedes the 2026-08-14 per facility presets and the wing staggered times at Plantation.',
  '2026-09-16T00:00:00Z'::timestamptz
FROM
  public.facilities f
WHERE
  f.organization_id = '00000000-0000-0000-0000-000000000001'
  AND f.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.facility_cadence_versions existing
    WHERE
      existing.facility_id = f.id
      AND existing.version_number = 1);

-- ---------------------------------------------------------------------------
-- Seed: the six windows on version 1
--
-- Grace is 60 minutes either side except at the two shift change windows,
-- where grace before is zero. A symmetric grace on the 06:00 window would open
-- it at 05:00 and let the outgoing shift clear it before the incoming shift
-- arrives, which defeats the only reason that check exists.
-- ---------------------------------------------------------------------------
WITH window_seed (window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order) AS (
  VALUES ('shift_change_am', 'Morning shift change check', '06:00'::time, 0, 60, 'day', 0),
    ('mid_morning', 'Mid morning check', '10:00'::time, 60, 60, 'day', 1),
    ('afternoon', 'Afternoon check', '14:00'::time, 60, 60, 'day', 2),
    ('shift_change_pm', 'Night shift change check', '18:00'::time, 0, 60, 'night', 3),
    ('late_evening', 'Late evening check', '22:00'::time, 60, 60, 'night', 4),
    ('overnight', 'Overnight check', '02:00'::time, 60, 60, 'night', 5)
)
INSERT INTO public.facility_cadence_windows (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
SELECT
  v.organization_id,
  v.facility_id,
  v.id,
  ws.window_key,
  ws.label,
  ws.due_at_local,
  ws.grace_before_minutes,
  ws.grace_after_minutes,
  ws.shift_key,
  ws.sort_order,
  TRUE
FROM
  public.facility_cadence_versions v
  CROSS JOIN window_seed ws
WHERE
  v.organization_id = '00000000-0000-0000-0000-000000000001'
  AND v.version_number = 1
  AND v.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.facility_cadence_windows existing
    WHERE
      existing.cadence_version_id = v.id
      AND existing.window_key = ws.window_key);

-- ---------------------------------------------------------------------------
-- Task stamping
-- ---------------------------------------------------------------------------
ALTER TABLE public.resident_observation_tasks
  ADD COLUMN IF NOT EXISTS cadence_version_id uuid NULL REFERENCES public.facility_cadence_versions (id),
  ADD COLUMN IF NOT EXISTS window_key text NULL,
  ADD COLUMN IF NOT EXISTS service_date date NULL;

-- Facility cadence has no per resident plan, so a generated task no longer
-- carries plan_id. A task now names its source: a legacy per resident plan, or
-- a cadence version, or (from the Monitoring Orders migration on) an order.
ALTER TABLE public.resident_observation_tasks
  ALTER COLUMN plan_id DROP NOT NULL;

COMMENT ON COLUMN public.resident_observation_tasks.cadence_version_id IS
  'Cadence version in force when this task was generated. Compliance reads join through this stamp so a later cadence change cannot rewrite a past number.';
COMMENT ON COLUMN public.resident_observation_tasks.window_key IS
  'facility_cadence_windows.window_key this task satisfies. Null on legacy plan rule tasks.';
COMMENT ON COLUMN public.resident_observation_tasks.service_date IS
  'Facility local calendar date the window belongs to. The overnight window on the night shift that starts the previous evening carries the later date.';
COMMENT ON COLUMN public.resident_observation_tasks.plan_id IS
  'Legacy per resident observation plan. Null on facility cadence tasks, which carry cadence_version_id instead.';

CREATE INDEX IF NOT EXISTS idx_obs_tasks_cadence_version
  ON public.resident_observation_tasks (cadence_version_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_obs_tasks_facility_service_date
  ON public.resident_observation_tasks (facility_id, service_date)
  WHERE deleted_at IS NULL;

-- Idempotency: one task per resident per window per service date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_tasks_window_occurrence
  ON public.resident_observation_tasks (resident_id, window_key, service_date)
  WHERE deleted_at IS NULL AND window_key IS NOT NULL;

-- Existing tasks predate versioned configuration and version 1 is the only
-- version that has ever existed, so stamping them with it loses no history.
UPDATE
  public.resident_observation_tasks t
SET
  cadence_version_id = v.id
FROM
  public.facility_cadence_versions v
WHERE
  v.facility_id = t.facility_id
  AND v.version_number = 1
  AND v.deleted_at IS NULL
  AND t.cadence_version_id IS NULL;

-- ---------------------------------------------------------------------------
-- Read helpers. Every window time calculation in the product goes through
-- these, so no caller carries a time, a grace value or a shift boundary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.facility_cadence_in_force (p_facility_id uuid, p_at timestamptz)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    v.id
  FROM
    public.facility_cadence_versions v
  WHERE
    v.facility_id = p_facility_id
    AND v.deleted_at IS NULL
    AND v.status IN ('active', 'superseded')
    AND v.effective_from <= p_at
    AND (v.effective_to IS NULL OR v.effective_to > p_at)
  ORDER BY
    v.effective_from DESC,
    v.version_number DESC
  LIMIT 1;
$func$;

COMMENT ON FUNCTION public.facility_cadence_in_force (uuid, timestamptz) IS
  'The cadence version in force at an instant, including a superseded version when the instant is in the past. Returns null when the facility has no cadence. COL-37 ruling: switch to invoker -- cadence configuration is facility policy, not a privileged read. The facilities SELECT policy and the cadence tables'' own SELECT policies already return exactly the facilities the caller is granted, so invoker rights give a caregiver the times in force on their own building and nothing else. The generator runs as service_role, which bypasses RLS and needs no definer rights.';

CREATE OR REPLACE FUNCTION public.facility_observation_windows_for_date (p_facility_id uuid, p_service_date date)
  RETURNS TABLE (
    cadence_version_id uuid,
    window_key text,
    label text,
    shift_key text,
    due_at_utc timestamptz,
    window_opens_at_utc timestamptz,
    window_closes_at_utc timestamptz)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH facility AS (
    SELECT
      f.id,
      f.timezone
    FROM
      public.facilities f
    WHERE
      f.id = p_facility_id
      AND f.deleted_at IS NULL
),
in_force AS (
  SELECT
    public.facility_cadence_in_force (fac.id, (p_service_date::timestamp AT TIME ZONE fac.timezone)) AS version_id,
    fac.timezone
  FROM
    facility fac
),
resolved AS (
  SELECT
    w.cadence_version_id AS version_id,
    w.window_key AS key,
    w.label AS window_label,
    w.shift_key AS shift,
    w.sort_order,
    w.due_at_local,
    w.grace_before_minutes,
    w.grace_after_minutes,
    ((p_service_date + w.due_at_local) AT TIME ZONE fk.timezone) AS due_utc
  FROM
    in_force fk
    JOIN public.facility_cadence_windows w ON w.cadence_version_id = fk.version_id
  WHERE
    w.deleted_at IS NULL
    AND w.enabled
)
SELECT
  r.version_id,
  r.key,
  r.window_label,
  r.shift,
  r.due_utc,
  r.due_utc - make_interval(mins => r.grace_before_minutes),
  r.due_utc + make_interval(mins => r.grace_after_minutes)
FROM
  resolved r
ORDER BY
  r.sort_order,
  r.due_at_local;
$func$;

COMMENT ON FUNCTION public.facility_observation_windows_for_date (uuid, date) IS
  'The observation windows in force for a facility on a local service date, converted against facilities.timezone. The single place window arithmetic lives; no caller may carry a time or a grace value. COL-37 ruling: switch to invoker -- cadence configuration is facility policy, not a privileged read. The facilities SELECT policy and the cadence tables'' own SELECT policies already return exactly the facilities the caller is granted, so invoker rights give a caregiver the times in force on their own building and nothing else. The generator runs as service_role, which bypasses RLS and needs no definer rights.';

CREATE OR REPLACE FUNCTION public.facility_shift_window_at (p_facility_id uuid, p_at timestamptz)
  RETURNS TABLE (
    shift_key text,
    roster_shift_type public.shift_type,
    shift_service_date date,
    starts_at_utc timestamptz,
    ends_at_utc timestamptz)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH facility AS (
    SELECT
      f.id,
      f.timezone
    FROM
      public.facilities f
    WHERE
      f.id = p_facility_id
      AND f.deleted_at IS NULL
),
local_now AS (
  SELECT
    fac.timezone,
    (p_at AT TIME ZONE fac.timezone) AS ts
  FROM
    facility fac
),
candidate AS (
  SELECT
    s.shift_key AS key,
    s.roster_shift_type AS roster_type,
    d.day AS service_day,
    (d.day + s.starts_at_local) AS local_start,
    (d.day + s.starts_at_local) + CASE WHEN s.ends_at_local > s.starts_at_local THEN
      (s.ends_at_local - s.starts_at_local)
    ELSE
      (interval '24 hours' - (s.starts_at_local - s.ends_at_local))
    END AS local_end
  FROM
    public.facility_shift_definitions s
    CROSS JOIN local_now ln
    CROSS JOIN LATERAL unnest(ARRAY[ln.ts::date - 1, ln.ts::date]) AS d (day)
  WHERE
    s.facility_id = p_facility_id
    AND s.deleted_at IS NULL
    AND s.active
)
SELECT
  c.key,
  c.roster_type,
  c.service_day,
  (c.local_start AT TIME ZONE ln.timezone),
  (c.local_end AT TIME ZONE ln.timezone)
FROM
  candidate c
  CROSS JOIN local_now ln
WHERE
  ln.ts >= c.local_start
  AND ln.ts < c.local_end
ORDER BY
  c.local_start DESC
LIMIT 1;
$func$;

COMMENT ON FUNCTION public.facility_shift_window_at (uuid, timestamptz) IS
  'The shift in force at an instant, resolved from facility_shift_definitions. shift_service_date is the local date the shift started, which is the date a shift_assignments row uses. COL-37 ruling: switch to invoker -- cadence configuration is facility policy, not a privileged read. The facilities SELECT policy and the cadence tables'' own SELECT policies already return exactly the facilities the caller is granted, so invoker rights give a caregiver the times in force on their own building and nothing else. The generator runs as service_role, which bypasses RLS and needs no definer rights.';

CREATE OR REPLACE FUNCTION public.facility_next_shift_window (p_facility_id uuid, p_at timestamptz)
  RETURNS TABLE (
    shift_key text,
    roster_shift_type public.shift_type,
    shift_service_date date,
    starts_at_utc timestamptz,
    ends_at_utc timestamptz)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    nxt.shift_key,
    nxt.roster_shift_type,
    nxt.shift_service_date,
    nxt.starts_at_utc,
    nxt.ends_at_utc
  FROM
    public.facility_shift_window_at (p_facility_id, p_at) cur
    CROSS JOIN LATERAL public.facility_shift_window_at (p_facility_id, cur.ends_at_utc) nxt;
$func$;

COMMENT ON FUNCTION public.facility_next_shift_window (uuid, timestamptz) IS
  'The shift that follows the one in force at an instant. The task generator works one shift ahead so a caregiver coming on duty sees every window of their shift at once. COL-37 ruling: switch to invoker -- cadence configuration is facility policy, not a privileged read. The facilities SELECT policy and the cadence tables'' own SELECT policies already return exactly the facilities the caller is granted, so invoker rights give a caregiver the times in force on their own building and nothing else. The generator runs as service_role, which bypasses RLS and needs no definer rights.';

CREATE OR REPLACE FUNCTION public.facility_next_shift_observation_windows (p_facility_id uuid, p_at timestamptz)
  RETURNS TABLE (
    cadence_version_id uuid,
    window_key text,
    label text,
    shift_key text,
    roster_shift_type public.shift_type,
    shift_service_date date,
    service_date date,
    due_at_utc timestamptz,
    window_opens_at_utc timestamptz,
    window_closes_at_utc timestamptz,
    starts_shift boolean)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH facility AS (
    SELECT
      f.id,
      f.timezone
    FROM
      public.facilities f
    WHERE
      f.id = p_facility_id
      AND f.deleted_at IS NULL
),
nxt AS (
  SELECT
    n.shift_key AS key,
    n.roster_shift_type AS roster_type,
    n.shift_service_date AS service_day,
    n.starts_at_utc,
    n.ends_at_utc
  FROM
    public.facility_next_shift_window (p_facility_id, p_at) n
),
spanned_date AS (
  SELECT DISTINCT
    d AS local_date
  FROM
    nxt n
    CROSS JOIN facility fac
    CROSS JOIN LATERAL unnest(ARRAY[(n.starts_at_utc AT TIME ZONE fac.timezone)::date, (n.ends_at_utc AT TIME ZONE fac.timezone)::date]) AS d
)
SELECT
  w.cadence_version_id,
  w.window_key,
  w.label,
  w.shift_key,
  n.roster_type,
  n.service_day,
  sd.local_date,
  w.due_at_utc,
  w.window_opens_at_utc,
  w.window_closes_at_utc,
  EXISTS (
    SELECT
      1
    FROM
      public.facility_shift_definitions s
      CROSS JOIN facility fac
    WHERE
      s.facility_id = p_facility_id
      AND s.deleted_at IS NULL
      AND s.active
      AND s.shift_key = w.shift_key
      AND ((sd.local_date + s.starts_at_local) AT TIME ZONE fac.timezone) = w.due_at_utc)
FROM
  nxt n
  CROSS JOIN spanned_date sd
  CROSS JOIN LATERAL public.facility_observation_windows_for_date (p_facility_id, sd.local_date) w
WHERE
  w.shift_key = n.key
  AND w.due_at_utc >= n.starts_at_utc
  AND w.due_at_utc < n.ends_at_utc
ORDER BY
  w.due_at_utc;
$func$;

COMMENT ON FUNCTION public.facility_next_shift_observation_windows (uuid, timestamptz) IS
  'Every observation window due during the next shift, with its service date and whether its due time is that shift start. The task generator reads this and carries no time of its own. COL-37 ruling: switch to invoker -- cadence configuration is facility policy, not a privileged read. The facilities SELECT policy and the cadence tables'' own SELECT policies already return exactly the facilities the caller is granted, so invoker rights give a caregiver the times in force on their own building and nothing else. The generator runs as service_role, which bypasses RLS and needs no definer rights.';

-- ---------------------------------------------------------------------------
-- Task writer. The idempotency index is partial, which Postgres will not infer
-- from a bare conflict target, so the generator inserts through this function
-- rather than through a REST upsert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_cadence_observation_tasks (p_rows jsonb)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_inserted integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Cadence observation task payload must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.resident_observation_tasks (organization_id, entity_id, facility_id, resident_id, cadence_version_id, window_key, service_date, shift_assignment_id, assigned_staff_id, scheduled_for, due_at, grace_ends_at, status)
  SELECT
    r.organization_id,
    r.entity_id,
    r.facility_id,
    r.resident_id,
    r.cadence_version_id,
    r.window_key,
    r.service_date,
    r.shift_assignment_id,
    r.assigned_staff_id,
    r.scheduled_for,
    r.due_at,
    r.grace_ends_at,
    COALESCE(r.status, 'upcoming')::public.resident_observation_task_status
  FROM
    jsonb_to_recordset(p_rows) AS r (organization_id uuid, entity_id uuid, facility_id uuid, resident_id uuid, cadence_version_id uuid, window_key text, service_date date, shift_assignment_id uuid, assigned_staff_id uuid, scheduled_for timestamptz, due_at timestamptz, grace_ends_at timestamptz, status text)
  ON CONFLICT (resident_id, window_key, service_date)
    WHERE deleted_at IS NULL AND window_key IS NOT NULL
    DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$func$;

COMMENT ON FUNCTION public.record_cadence_observation_tasks (jsonb) IS
  'Inserts generated facility cadence tasks, ignoring any that already exist for the same resident, window and service date. A second generator run inserts nothing.';

-- ---------------------------------------------------------------------------
-- Grants on the helpers
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.facility_cadence_in_force (uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_cadence_in_force (uuid, timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.facility_observation_windows_for_date (uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_observation_windows_for_date (uuid, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.facility_shift_window_at (uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_shift_window_at (uuid, timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.facility_next_shift_window (uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_next_shift_window (uuid, timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.facility_next_shift_observation_windows (uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_next_shift_observation_windows (uuid, timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_cadence_observation_tasks (jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_cadence_observation_tasks (jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Retire the wing staggered plan applier in place. It stays callable and keeps
-- its grant so nothing that references it breaks; it now names the decision
-- that replaced it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_plantation_wing_observation_plan (p_resident_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven
  AS $$
BEGIN
  RAISE EXCEPTION 'Wing staggered observation times are retired. The 2026-09-16 uniform facility cadence in facility_cadence_versions applies at every facility, including this one.'
    USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plantation_wing_observation_plan (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_plantation_wing_observation_plan (uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_plantation_wing_observation_plan (uuid) IS
  'Deprecated and deliberately not dropped. The wing stagger was superseded by the 2026-09-16 uniform cadence; whether the stagger covered a staffing constraint is an open owner decision.';

-- ---------------------------------------------------------------------------
-- public.apply_col_discovery_round_observation_plan is deliberately left
-- working. It carries the 2026-08-14 times, but the SYS-001 lifecycle
-- authorization work wrapped it in a five argument overload that
-- supabase/tests/review_authoritative_actor.sql exercises as an authorization
-- fixture, so retiring the body fails an unrelated acceptance probe. Cadence is
-- facility level and inherited from here on, and the operator entry point that
-- called it is removed with the per resident plan form, so nothing reaches it
-- in the product.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Supersede the 2026-08-14 per facility templates the same way that decision
-- superseded the ones before it: deactivate, never delete.
-- ---------------------------------------------------------------------------
UPDATE
  public.resident_observation_templates
SET
  active = FALSE,
  deleted_at = now(),
  updated_at = now()
WHERE
  organization_id = '00000000-0000-0000-0000-000000000001'
  AND deleted_at IS NULL
  AND name LIKE 'COL Discovery Rounds%';

NOTIFY pgrst,
'reload schema';

COMMIT;
