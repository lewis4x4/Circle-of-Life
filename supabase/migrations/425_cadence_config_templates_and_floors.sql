-- Smart Rounding: organization configuration templates, the facility to
-- template pointer, the jurisdiction floor, and the two facility level
-- thresholds the settings validation warns against.
--
-- Spec: docs/specs/25A-smart-rounding-cadence-and-watchlist.md sections 6.2,
-- 6.5, 6.8, 6.10, 6.13.
--
-- Migration 414 already built the versioned cadence shape and migration 417
-- built the versioned escalation shape, both seeded active at every facility in
-- the organization. Nothing here recreates any of that. What is genuinely
-- missing is everything above the facility: a named organization template a
-- building can be on, the record of which building is on which template, the
-- regulator's floor the configuration may not be set below, and the two
-- thresholds section 6.5 warns against but nothing yet stores.
--
-- Three decisions recorded here rather than left to be rediscovered.
--
-- 1. No existing version row is touched. Stamping source_template_id onto the
--    cadence and escalation versions that are already in force would annotate
--    provenance onto rows the whole module promises never to mutate in place,
--    and a reader has no way to tell an annotation from a policy edit after the
--    fact. The facility to template pointer is therefore its own table, read by
--    the settings surface and by the drift view, and source_template_id carries
--    provenance for versions created from a template from this point on.
--
-- 2. The seeded template inherits its windows from the organization's oldest
--    active cadence version rather than restating the six times. Every
--    observation time, grace value and escalation offset in this module still
--    lives in exactly one place, which is what makes changing one a row edit.
--    The same reasoning is already written down for
--    public.ensure_facility_observation_defaults.
--
-- 3. The FL_AHCA floor ships with its numbers null and marked TBD. No verified
--    Florida minimum observation frequency exists in repository authority, the
--    spec forbids inventing one, and a null floor passes the floor check while
--    leaving the structure ready for the number when Compliance supplies it.
--
-- Selected by organization throughout, never by facility name. Migration 318
-- realigned two of the five facility names to their registered form, so any
-- seed carrying a name list silently touches three facilities out of five and
-- reports success.
--
-- No named person appears here. No resident identifying data appears here.

BEGIN;

-- ---------------------------------------------------------------------------
-- Organization cadence templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cadence_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  template_key text NOT NULL CHECK (template_key ~ '^[a-z0-9_]+$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 500),
  active boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cadence_templates_key
  ON public.cadence_templates (organization_id, template_key)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.cadence_templates IS
  'Named organization level observation cadence templates. A facility is either on a template or custom; public.facility_config_template_bindings records which. Spec 25A section 6.8.';

CREATE TABLE IF NOT EXISTS public.cadence_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  cadence_template_id uuid NOT NULL REFERENCES public.cadence_templates (id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'superseded')),
  change_reason text NOT NULL CHECK (char_length(change_reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  activated_at timestamptz NULL,
  activated_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT cadence_template_versions_template_version_key UNIQUE (cadence_template_id, version_number)
);

-- A template version is not effective dated. Nothing generates a task from a
-- template: a template is copied into a facility version, and the facility
-- version is the effective dated thing. That is why there is no gist exclusion
-- constraint here and why there is one on facility_cadence_versions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cadence_template_versions_one_active
  ON public.cadence_template_versions (cadence_template_id)
  WHERE status = 'active' AND deleted_at IS NULL;

COMMENT ON TABLE public.cadence_template_versions IS
  'Versions of an organization cadence template. Not effective dated: a template is never in force anywhere, it is copied into a facility cadence version, and that version carries the timeline.';

CREATE TABLE IF NOT EXISTS public.cadence_template_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  cadence_template_version_id uuid NOT NULL REFERENCES public.cadence_template_versions (id) ON DELETE CASCADE,
  window_key text NOT NULL CHECK (window_key ~ '^[a-z0-9_]+$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  due_at_local time NOT NULL,
  grace_before_minutes integer NOT NULL CHECK (grace_before_minutes >= 0),
  grace_after_minutes integer NOT NULL CHECK (grace_after_minutes >= 0),
  shift_key text NOT NULL CHECK (shift_key ~ '^[a-z0-9_]+$'),
  sort_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT cadence_template_windows_version_key UNIQUE (cadence_template_version_id, window_key)
);

CREATE INDEX IF NOT EXISTS idx_cadence_template_windows_version_order
  ON public.cadence_template_windows (cadence_template_version_id, sort_order)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.cadence_template_windows IS
  'The observation windows one cadence template version carries. Shaped exactly like public.facility_cadence_windows minus the facility, so applying a template is a column for column copy.';

-- ---------------------------------------------------------------------------
-- Organization escalation templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.escalation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  template_key text NOT NULL CHECK (template_key ~ '^[a-z0-9_]+$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NULL CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 500),
  active boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_escalation_templates_key
  ON public.escalation_templates (organization_id, template_key)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.escalation_templates IS
  'Named organization level escalation ladder templates. Spec 25A section 6.8.';

CREATE TABLE IF NOT EXISTS public.escalation_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  escalation_template_id uuid NOT NULL REFERENCES public.escalation_templates (id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'superseded')),
  change_reason text NOT NULL CHECK (char_length(change_reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  activated_at timestamptz NULL,
  activated_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT escalation_template_versions_template_version_key UNIQUE (escalation_template_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_escalation_template_versions_one_active
  ON public.escalation_template_versions (escalation_template_id)
  WHERE status = 'active' AND deleted_at IS NULL;

COMMENT ON TABLE public.escalation_template_versions IS
  'Versions of an organization escalation template. Not effective dated, for the same reason cadence template versions are not: nothing fires from a template.';

CREATE TABLE IF NOT EXISTS public.escalation_template_rungs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  escalation_template_version_id uuid NOT NULL REFERENCES public.escalation_template_versions (id) ON DELETE CASCADE,
  rung_key text NOT NULL CHECK (rung_key ~ '^[a-z0-9_]+$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  offset_minutes integer NOT NULL,
  is_terminal boolean NOT NULL DEFAULT FALSE,
  assigned_staff_only boolean NOT NULL DEFAULT FALSE,
  include_assigned_staff boolean NOT NULL DEFAULT FALSE,
  use_standing_alert_routes boolean NOT NULL DEFAULT FALSE,
  target_staff_roles public.staff_role[] NOT NULL DEFAULT ARRAY[]::public.staff_role[],
  channels text[] NOT NULL,
  protocol_text text NULL,
  enabled boolean NOT NULL DEFAULT TRUE,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT escalation_template_rungs_version_key UNIQUE (escalation_template_version_id, rung_key),
  -- The same four constraints facility_escalation_rungs carries, restated here
  -- rather than left to be caught on apply. A template that cannot be applied
  -- is a template that looks like a working ladder and is not.
  CONSTRAINT escalation_template_rungs_channels_known CHECK (array_length(channels, 1) >= 1
    AND channels <@ ARRAY['in_app', 'push', 'sms']),
  CONSTRAINT escalation_template_rungs_has_audience CHECK (COALESCE(array_length(target_staff_roles, 1), 0) > 0
    OR use_standing_alert_routes
    OR include_assigned_staff),
  CONSTRAINT escalation_template_rungs_assigned_only_includes_assigned CHECK (NOT assigned_staff_only
    OR include_assigned_staff),
  CONSTRAINT escalation_template_rungs_protocol_on_terminal CHECK (protocol_text IS NULL OR is_terminal),
  CONSTRAINT escalation_template_rungs_level_positive CHECK (assigned_staff_only OR sort_order > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_escalation_template_rungs_one_terminal
  ON public.escalation_template_rungs (escalation_template_version_id)
  WHERE is_terminal AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_escalation_template_rungs_version_order
  ON public.escalation_template_rungs (escalation_template_version_id, sort_order)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.escalation_template_rungs IS
  'The rungs one escalation template version carries. Shaped exactly like public.facility_escalation_rungs minus the facility, so applying a template is a column for column copy. Per shift overrides are deliberately not templated: a shift key is facility configuration and a template cannot know a building runs a shift by that name.';

-- ---------------------------------------------------------------------------
-- The facility to template pointer
--
-- One row per facility, both pointers nullable. A null pointer means custom for
-- that kind of configuration, which is the state a facility lands in when an
-- administrator edits its windows or its rungs directly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_config_template_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  cadence_template_id uuid NULL REFERENCES public.cadence_templates (id),
  escalation_template_id uuid NULL REFERENCES public.escalation_templates (id),
  cadence_bound_at timestamptz NULL,
  escalation_bound_at timestamptz NULL,
  cadence_detached_at timestamptz NULL,
  escalation_detached_at timestamptz NULL,
  detach_reason text NULL CHECK (detach_reason IS NULL OR char_length(detach_reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT facility_config_template_bindings_facility_key UNIQUE (facility_id)
);

COMMENT ON TABLE public.facility_config_template_bindings IS
  'Which organization template each facility is on, per spec 25A section 6.8. A null pointer means custom for that kind of configuration. One row per facility, so a building cannot be on two cadence templates at once.';
COMMENT ON COLUMN public.facility_config_template_bindings.cadence_detached_at IS
  'When this facility last stopped inheriting a cadence template. Editing a facility cadence directly detaches it, and the surface names what it stops inheriting before it happens.';

-- ---------------------------------------------------------------------------
-- The jurisdiction floor
--
-- Multi state means multi regulator. This table is the only place a regulatory
-- minimum may live, and nothing in code may carry one.
--
-- It has no organization_id and no facility_id: a regulator's minimum is not
-- one tenant's configuration. Row level security therefore reads differently
-- from every other table in this module, and deliberately: every signed in
-- caller may read the floor that applies to them, and nobody signed in may
-- write one. Changing a regulatory floor is a migration with a citation on it.
--
-- FL_AHCA ships with its numbers null and marked TBD. No verified Florida
-- minimum observation frequency exists in repository authority. Open item 6 in
-- spec section 11 has the Director of Operations and Compliance supplying the
-- number and the citation, or confirming that no numeric floor exists. With
-- null values the floor check passes and the structure is ready.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jurisdiction_observation_floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_key text NOT NULL CHECK (jurisdiction_key ~ '^[A-Z][A-Z0-9_]+$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  -- Resolution is by state code against public.facilities.state, so which
  -- regulator applies to a building is data rather than a branch in a function.
  state_code text NOT NULL CHECK (state_code ~ '^[A-Z]{2}$'),
  minimum_windows_per_24h integer NULL CHECK (minimum_windows_per_24h IS NULL OR minimum_windows_per_24h > 0),
  maximum_unobserved_gap_minutes integer NULL CHECK (maximum_unobserved_gap_minutes IS NULL OR maximum_unobserved_gap_minutes > 0),
  citation_reference text NULL CHECK (citation_reference IS NULL OR char_length(citation_reference) BETWEEN 1 AND 200),
  -- True while the numbers above are unverified. A null floor with this flag
  -- set reads as "not yet supplied" on the settings surface rather than as
  -- "no floor exists", which are different facts and must not look alike.
  floor_values_pending boolean NOT NULL DEFAULT FALSE,
  pending_note text NULL CHECK (pending_note IS NULL OR char_length(pending_note) BETWEEN 1 AND 500),
  effective_from date NOT NULL,
  effective_to date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT jurisdiction_observation_floors_effective_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- A pending floor is one whose numbers are not yet known, so it may not carry
  -- one. A supplied floor is one that carries at least one number and a
  -- citation for it.
  CONSTRAINT jurisdiction_observation_floors_pending_has_no_values CHECK (NOT floor_values_pending
    OR (minimum_windows_per_24h IS NULL AND maximum_unobserved_gap_minutes IS NULL)),
  CONSTRAINT jurisdiction_observation_floors_values_cite CHECK ((minimum_windows_per_24h IS NULL
      AND maximum_unobserved_gap_minutes IS NULL)
    OR citation_reference IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jurisdiction_observation_floors_key_effective
  ON public.jurisdiction_observation_floors (jurisdiction_key, effective_from)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jurisdiction_observation_floors_state
  ON public.jurisdiction_observation_floors (state_code, effective_from DESC)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.jurisdiction_observation_floors IS
  'The regulator minimum a facility observation cadence may not be configured below, keyed by jurisdiction and resolved by state code. The only place a regulatory number may live; no Florida rule appears in any code path. A row with null values and floor_values_pending set means the number has not been supplied, which is not the same fact as no floor existing.';
COMMENT ON COLUMN public.jurisdiction_observation_floors.minimum_windows_per_24h IS
  'Minimum enabled observation windows per resident per 24 hours. Null means no verified number, and the floor check passes. Never guess this value.';

-- ---------------------------------------------------------------------------
-- The two facility thresholds section 6.5 warns against
--
-- Both are warnings with typed acknowledgment, never hard blocks, so an
-- administrator who has a reason can still proceed. They live in a row so no
-- threshold appears in a TypeScript file.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_observation_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  maximum_unobserved_gap_minutes integer NOT NULL CHECK (maximum_unobserved_gap_minutes > 0),
  maximum_windows_per_resident_per_day integer NOT NULL CHECK (maximum_windows_per_resident_per_day > 0),
  simulation_lookback_days integer NOT NULL CHECK (simulation_lookback_days BETWEEN 1 AND 366),
  change_log_page_size integer NOT NULL CHECK (change_log_page_size BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT facility_observation_thresholds_facility_key UNIQUE (facility_id)
);

COMMENT ON TABLE public.facility_observation_thresholds IS
  'Per facility warning thresholds and read defaults for the cadence settings surface, per spec 25A section 6.2. Rows rather than constants, so no threshold and no lookback span appears in a TypeScript file or an Edge Function body.';
COMMENT ON COLUMN public.facility_observation_thresholds.maximum_unobserved_gap_minutes IS
  'Largest unobserved gap the facility accepts without a typed acknowledgment. Seeded from the gap the facility cadence already produces, so the warning means "worse than what this building runs today" and no number is invented.';
COMMENT ON COLUMN public.facility_observation_thresholds.simulation_lookback_days IS
  'Default lookback for public.simulate_cadence_change. Lives here so the settings surface calls the simulation without carrying a span of its own.';

-- ---------------------------------------------------------------------------
-- The foreign keys migration 414 and migration 417 deliberately deferred
-- ---------------------------------------------------------------------------
ALTER TABLE public.facility_cadence_versions
  DROP CONSTRAINT IF EXISTS facility_cadence_versions_source_template_id_fkey;

ALTER TABLE public.facility_cadence_versions
  ADD CONSTRAINT facility_cadence_versions_source_template_id_fkey
  FOREIGN KEY (source_template_id) REFERENCES public.cadence_templates (id);

ALTER TABLE public.facility_escalation_versions
  DROP CONSTRAINT IF EXISTS facility_escalation_versions_source_template_id_fkey;

ALTER TABLE public.facility_escalation_versions
  ADD CONSTRAINT facility_escalation_versions_source_template_id_fkey
  FOREIGN KEY (source_template_id) REFERENCES public.escalation_templates (id);

COMMENT ON COLUMN public.facility_cadence_versions.source_template_id IS
  'Organization cadence template this version was copied from, when any. Provenance only: the pointer that says which template a facility is on is public.facility_config_template_bindings, because a facility on a template still has versions that predate it.';
COMMENT ON COLUMN public.facility_escalation_versions.source_template_id IS
  'Organization escalation template this version was copied from, when any. Provenance only; public.facility_config_template_bindings is the pointer.';

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.cadence_templates, public.cadence_template_versions,
  public.cadence_template_windows, public.escalation_templates,
  public.escalation_template_versions, public.escalation_template_rungs,
  public.facility_config_template_bindings, public.jurisdiction_observation_floors,
  public.facility_observation_thresholds FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON public.cadence_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cadence_template_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cadence_template_windows TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.escalation_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.escalation_template_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.escalation_template_rungs TO authenticated;
GRANT SELECT ON public.facility_config_template_bindings TO authenticated;
GRANT SELECT ON public.jurisdiction_observation_floors TO authenticated;
GRANT SELECT, UPDATE ON public.facility_observation_thresholds TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_template_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadence_template_windows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalation_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalation_template_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalation_template_rungs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_config_template_bindings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jurisdiction_observation_floors TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_observation_thresholds TO service_role;

ALTER TABLE public.cadence_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cadence_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cadence_template_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalation_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalation_template_rungs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_config_template_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jurisdiction_observation_floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_observation_thresholds ENABLE ROW LEVEL SECURITY;

-- Templates are organization level, so there is no facility predicate to
-- repeat: a template belongs to the organization and every caller inside it
-- may read it. Editing one is org_admin and owner, per spec 6.12.
DROP POLICY IF EXISTS cadence_templates_select ON public.cadence_templates;
CREATE POLICY cadence_templates_select ON public.cadence_templates
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

DROP POLICY IF EXISTS cadence_templates_insert ON public.cadence_templates;
CREATE POLICY cadence_templates_insert ON public.cadence_templates
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS cadence_templates_update ON public.cadence_templates;
CREATE POLICY cadence_templates_update ON public.cadence_templates
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS cadence_template_versions_select ON public.cadence_template_versions;
CREATE POLICY cadence_template_versions_select ON public.cadence_template_versions
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

DROP POLICY IF EXISTS cadence_template_versions_insert ON public.cadence_template_versions;
CREATE POLICY cadence_template_versions_insert ON public.cadence_template_versions
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS cadence_template_versions_update ON public.cadence_template_versions;
CREATE POLICY cadence_template_versions_update ON public.cadence_template_versions
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS cadence_template_windows_select ON public.cadence_template_windows;
CREATE POLICY cadence_template_windows_select ON public.cadence_template_windows
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

-- A template version that is already active is not edited in place, for the
-- same reason a facility version in force is not: something was applied from
-- it, and the record of what was applied has to stay readable.
DROP POLICY IF EXISTS cadence_template_windows_insert ON public.cadence_template_windows;
CREATE POLICY cadence_template_windows_insert ON public.cadence_template_windows
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        public.cadence_template_versions v
      WHERE
        v.id = cadence_template_version_id
        AND v.organization_id = cadence_template_windows.organization_id
        AND v.deleted_at IS NULL
        AND v.status = 'draft'));

DROP POLICY IF EXISTS cadence_template_windows_update ON public.cadence_template_windows;
CREATE POLICY cadence_template_windows_update ON public.cadence_template_windows
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        public.cadence_template_versions v
      WHERE
        v.id = cadence_template_windows.cadence_template_version_id
        AND v.deleted_at IS NULL
        AND v.status = 'draft'))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        public.cadence_template_versions v
      WHERE
        v.id = cadence_template_windows.cadence_template_version_id
        AND v.organization_id = haven.organization_id ()
        AND v.deleted_at IS NULL
        AND v.status = 'draft'));

DROP POLICY IF EXISTS escalation_templates_select ON public.escalation_templates;
CREATE POLICY escalation_templates_select ON public.escalation_templates
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

DROP POLICY IF EXISTS escalation_templates_insert ON public.escalation_templates;
CREATE POLICY escalation_templates_insert ON public.escalation_templates
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS escalation_templates_update ON public.escalation_templates;
CREATE POLICY escalation_templates_update ON public.escalation_templates
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS escalation_template_versions_select ON public.escalation_template_versions;
CREATE POLICY escalation_template_versions_select ON public.escalation_template_versions
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

DROP POLICY IF EXISTS escalation_template_versions_insert ON public.escalation_template_versions;
CREATE POLICY escalation_template_versions_insert ON public.escalation_template_versions
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS escalation_template_versions_update ON public.escalation_template_versions;
CREATE POLICY escalation_template_versions_update ON public.escalation_template_versions
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS escalation_template_rungs_select ON public.escalation_template_rungs;
CREATE POLICY escalation_template_rungs_select ON public.escalation_template_rungs
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

DROP POLICY IF EXISTS escalation_template_rungs_insert ON public.escalation_template_rungs;
CREATE POLICY escalation_template_rungs_insert ON public.escalation_template_rungs
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        public.escalation_template_versions v
      WHERE
        v.id = escalation_template_version_id
        AND v.organization_id = escalation_template_rungs.organization_id
        AND v.deleted_at IS NULL
        AND v.status = 'draft'));

DROP POLICY IF EXISTS escalation_template_rungs_update ON public.escalation_template_rungs;
CREATE POLICY escalation_template_rungs_update ON public.escalation_template_rungs
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        public.escalation_template_versions v
      WHERE
        v.id = escalation_template_rungs.escalation_template_version_id
        AND v.deleted_at IS NULL
        AND v.status = 'draft'))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        public.escalation_template_versions v
      WHERE
        v.id = escalation_template_rungs.escalation_template_version_id
        AND v.organization_id = haven.organization_id ()
        AND v.deleted_at IS NULL
        AND v.status = 'draft'));

-- The binding is read by anyone who can see the building and written only by
-- public.activate_cadence_version and public.apply_template_to_facilities,
-- which are the two commands that can move a facility onto or off a template.
-- There is deliberately no INSERT and no UPDATE policy: a hand edited binding
-- would claim a building inherits a template its windows do not match, and the
-- drift view would then be reporting against a claim rather than a decision.
DROP POLICY IF EXISTS facility_config_template_bindings_select ON public.facility_config_template_bindings;
CREATE POLICY facility_config_template_bindings_select ON public.facility_config_template_bindings
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- The regulator's floor is readable by every signed in caller and writable by
-- none. Changing one is a migration with a citation on it.
DROP POLICY IF EXISTS jurisdiction_observation_floors_select ON public.jurisdiction_observation_floors;
CREATE POLICY jurisdiction_observation_floors_select ON public.jurisdiction_observation_floors
  FOR SELECT
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS facility_observation_thresholds_select ON public.facility_observation_thresholds;
CREATE POLICY facility_observation_thresholds_select ON public.facility_observation_thresholds
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP POLICY IF EXISTS facility_observation_thresholds_update ON public.facility_observation_thresholds;
CREATE POLICY facility_observation_thresholds_update ON public.facility_observation_thresholds
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- ---------------------------------------------------------------------------
-- Updated at and audit triggers on every new mutable table
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS tr_cadence_templates_set_updated_at ON public.cadence_templates;
CREATE TRIGGER tr_cadence_templates_set_updated_at
  BEFORE UPDATE ON public.cadence_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_cadence_template_versions_set_updated_at ON public.cadence_template_versions;
CREATE TRIGGER tr_cadence_template_versions_set_updated_at
  BEFORE UPDATE ON public.cadence_template_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_cadence_template_windows_set_updated_at ON public.cadence_template_windows;
CREATE TRIGGER tr_cadence_template_windows_set_updated_at
  BEFORE UPDATE ON public.cadence_template_windows
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_escalation_templates_set_updated_at ON public.escalation_templates;
CREATE TRIGGER tr_escalation_templates_set_updated_at
  BEFORE UPDATE ON public.escalation_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_escalation_template_versions_set_updated_at ON public.escalation_template_versions;
CREATE TRIGGER tr_escalation_template_versions_set_updated_at
  BEFORE UPDATE ON public.escalation_template_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_escalation_template_rungs_set_updated_at ON public.escalation_template_rungs;
CREATE TRIGGER tr_escalation_template_rungs_set_updated_at
  BEFORE UPDATE ON public.escalation_template_rungs
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_facility_config_template_bindings_set_updated_at ON public.facility_config_template_bindings;
CREATE TRIGGER tr_facility_config_template_bindings_set_updated_at
  BEFORE UPDATE ON public.facility_config_template_bindings
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_jurisdiction_observation_floors_set_updated_at ON public.jurisdiction_observation_floors;
CREATE TRIGGER tr_jurisdiction_observation_floors_set_updated_at
  BEFORE UPDATE ON public.jurisdiction_observation_floors
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_facility_observation_thresholds_set_updated_at ON public.facility_observation_thresholds;
CREATE TRIGGER tr_facility_observation_thresholds_set_updated_at
  BEFORE UPDATE ON public.facility_observation_thresholds
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_cadence_templates_audit ON public.cadence_templates;
CREATE TRIGGER tr_cadence_templates_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cadence_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_cadence_template_versions_audit ON public.cadence_template_versions;
CREATE TRIGGER tr_cadence_template_versions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cadence_template_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_cadence_template_windows_audit ON public.cadence_template_windows;
CREATE TRIGGER tr_cadence_template_windows_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cadence_template_windows
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_escalation_templates_audit ON public.escalation_templates;
CREATE TRIGGER tr_escalation_templates_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.escalation_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_escalation_template_versions_audit ON public.escalation_template_versions;
CREATE TRIGGER tr_escalation_template_versions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.escalation_template_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_escalation_template_rungs_audit ON public.escalation_template_rungs;
CREATE TRIGGER tr_escalation_template_rungs_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.escalation_template_rungs
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_facility_config_template_bindings_audit ON public.facility_config_template_bindings;
CREATE TRIGGER tr_facility_config_template_bindings_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_config_template_bindings
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_jurisdiction_observation_floors_audit ON public.jurisdiction_observation_floors;
CREATE TRIGGER tr_jurisdiction_observation_floors_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.jurisdiction_observation_floors
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_facility_observation_thresholds_audit ON public.facility_observation_thresholds;
CREATE TRIGGER tr_facility_observation_thresholds_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_observation_thresholds
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

-- ---------------------------------------------------------------------------
-- Seed: the FL_AHCA floor row, values null, marked pending
-- ---------------------------------------------------------------------------
INSERT INTO public.jurisdiction_observation_floors (jurisdiction_key, label, state_code, minimum_windows_per_24h, maximum_unobserved_gap_minutes, citation_reference, floor_values_pending, pending_note, effective_from)
SELECT
  'FL_AHCA',
  'Florida Agency for Health Care Administration',
  'FL',
  NULL,
  NULL,
  NULL,
  TRUE,
  'No verified Florida minimum observation frequency exists in repository authority. Spec 25A open item 6 has the Director of Operations and Compliance supplying the number and the citation, or confirming that no numeric floor exists. Until then the floor check passes and nothing is guessed.',
  '2026-09-16'::date
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      public.jurisdiction_observation_floors existing
    WHERE
      existing.jurisdiction_key = 'FL_AHCA'
      AND existing.deleted_at IS NULL);

-- ---------------------------------------------------------------------------
-- Seed: COL Standard Six, inherited from the cadence already in force
--
-- The template is created once per organization that has an active cadence
-- version to inherit from. Nothing is restated: the six windows, their labels,
-- their due times and their asymmetric grace all come out of
-- facility_cadence_windows, which is where migration 414 put them.
--
-- The source version is the organization's oldest active one, chosen the same
-- way public.ensure_facility_observation_defaults chooses it, so both commands
-- inherit from the same place.
-- ---------------------------------------------------------------------------
INSERT INTO public.cadence_templates (organization_id, template_key, name, description, active)
SELECT DISTINCT
  v.organization_id,
  'col_standard_six',
  'COL Standard Six',
  'Six observation windows per resident per 24 hours, three on each 12 hour shift, with a one sided grace at the two shift change windows so the incoming shift is the one that lays eyes on the resident. Adopted by the 2026-09-16 cadence decision.',
  TRUE
FROM
  public.facility_cadence_versions v
WHERE
  v.status = 'active'
  AND v.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.cadence_templates existing
    WHERE
      existing.organization_id = v.organization_id
      AND existing.template_key = 'col_standard_six'
      AND existing.deleted_at IS NULL);

INSERT INTO public.cadence_template_versions (organization_id, cadence_template_id, version_number, status, change_reason, activated_at)
SELECT
  t.organization_id,
  t.id,
  1,
  'active',
  'Initial template version, inherited from the cadence already in force at every building in the organization rather than restating the times. Spec 25A section 6.8.',
  now()
FROM
  public.cadence_templates t
WHERE
  t.template_key = 'col_standard_six'
  AND t.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.cadence_template_versions existing
    WHERE
      existing.cadence_template_id = t.id
      AND existing.version_number = 1);

WITH source_version AS (
  SELECT DISTINCT ON (v.organization_id)
    v.organization_id,
    v.id
  FROM
    public.facility_cadence_versions v
  WHERE
    v.status = 'active'
    AND v.deleted_at IS NULL
  ORDER BY
    v.organization_id,
    v.created_at,
    v.id
)
INSERT INTO public.cadence_template_windows (organization_id, cadence_template_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
SELECT
  tv.organization_id,
  tv.id,
  w.window_key,
  w.label,
  w.due_at_local,
  w.grace_before_minutes,
  w.grace_after_minutes,
  w.shift_key,
  w.sort_order,
  w.enabled
FROM
  public.cadence_template_versions tv
  JOIN public.cadence_templates t ON t.id = tv.cadence_template_id
    AND t.template_key = 'col_standard_six'
  JOIN source_version sv ON sv.organization_id = tv.organization_id
  JOIN public.facility_cadence_windows w ON w.cadence_version_id = sv.id
    AND w.deleted_at IS NULL
WHERE
  tv.version_number = 1
  AND tv.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.cadence_template_windows existing
    WHERE
      existing.cadence_template_version_id = tv.id
      AND existing.window_key = w.window_key);

-- ---------------------------------------------------------------------------
-- Seed: COL Standard Ladder, inherited from the escalation policy in force
--
-- Spec 6.8 names cadence and escalation templates together, and
-- public.apply_template_to_facilities takes both, so shipping a cadence
-- template with no escalation counterpart would leave half the command with
-- nothing to apply.
-- ---------------------------------------------------------------------------
INSERT INTO public.escalation_templates (organization_id, template_key, name, description, active)
SELECT DISTINCT
  v.organization_id,
  'col_standard_ladder',
  'COL Standard Ladder',
  'A staff nudge before the window closes, then three escalation rungs measured from window close, with night channel overrides. Adopted by the 2026-09-16 cadence decision.',
  TRUE
FROM
  public.facility_escalation_versions v
WHERE
  v.status = 'active'
  AND v.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.escalation_templates existing
    WHERE
      existing.organization_id = v.organization_id
      AND existing.template_key = 'col_standard_ladder'
      AND existing.deleted_at IS NULL);

INSERT INTO public.escalation_template_versions (organization_id, escalation_template_id, version_number, status, change_reason, activated_at)
SELECT
  t.organization_id,
  t.id,
  1,
  'active',
  'Initial template version, inherited from the escalation policy already in force at every building in the organization rather than restating the offsets. Spec 25A section 6.8.',
  now()
FROM
  public.escalation_templates t
WHERE
  t.template_key = 'col_standard_ladder'
  AND t.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.escalation_template_versions existing
    WHERE
      existing.escalation_template_id = t.id
      AND existing.version_number = 1);

WITH source_version AS (
  SELECT DISTINCT ON (v.organization_id)
    v.organization_id,
    v.id
  FROM
    public.facility_escalation_versions v
  WHERE
    v.status = 'active'
    AND v.deleted_at IS NULL
  ORDER BY
    v.organization_id,
    v.created_at,
    v.id
)
INSERT INTO public.escalation_template_rungs (organization_id, escalation_template_version_id, rung_key, label, offset_minutes, is_terminal, assigned_staff_only, include_assigned_staff, use_standing_alert_routes, target_staff_roles, channels, protocol_text, sort_order, enabled)
SELECT
  tv.organization_id,
  tv.id,
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
  public.escalation_template_versions tv
  JOIN public.escalation_templates t ON t.id = tv.escalation_template_id
    AND t.template_key = 'col_standard_ladder'
  JOIN source_version sv ON sv.organization_id = tv.organization_id
  JOIN public.facility_escalation_rungs r ON r.escalation_version_id = sv.id
    AND r.deleted_at IS NULL
WHERE
  tv.version_number = 1
  AND tv.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.escalation_template_rungs existing
    WHERE
      existing.escalation_template_version_id = tv.id
      AND existing.rung_key = r.rung_key);

-- ---------------------------------------------------------------------------
-- Seed: point every facility in the organization at both templates
--
-- Selected by organization. A facility whose configuration was seeded from the
-- same decision the template was inherited from is on that template by
-- definition, and the drift view proves it rather than asserting it.
-- ---------------------------------------------------------------------------
INSERT INTO public.facility_config_template_bindings (organization_id, facility_id, cadence_template_id, escalation_template_id, cadence_bound_at, escalation_bound_at)
SELECT
  f.organization_id,
  f.id,
  ct.id,
  et.id,
  now(),
  now()
FROM
  public.facilities f
  LEFT JOIN public.cadence_templates ct ON ct.organization_id = f.organization_id
    AND ct.template_key = 'col_standard_six'
    AND ct.deleted_at IS NULL
  LEFT JOIN public.escalation_templates et ON et.organization_id = f.organization_id
    AND et.template_key = 'col_standard_ladder'
    AND et.deleted_at IS NULL
WHERE
  f.deleted_at IS NULL
  AND (ct.id IS NOT NULL OR et.id IS NOT NULL)
  AND EXISTS (
    SELECT
      1
    FROM
      public.facility_cadence_versions v
    WHERE
      v.facility_id = f.id
      AND v.status = 'active'
      AND v.deleted_at IS NULL)
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.facility_config_template_bindings existing
    WHERE
      existing.facility_id = f.id);

-- ---------------------------------------------------------------------------
-- Seed: the two thresholds, per facility
--
-- The gap threshold is derived from the gap the facility's own cadence already
-- produces, so the warning means "worse than what this building runs today"
-- and no number is invented. The windows per day ceiling is the one number
-- spec section 6.5 states outright, and the comment names it as the source.
-- The simulation lookback and the change log page size are read defaults, not
-- policy; they live here so the surface carries neither.
-- ---------------------------------------------------------------------------
WITH facility_gap AS (
  SELECT
    f.id AS facility_id,
    f.organization_id,
    -- The largest gap between one window closing and the next opening, wrapped
    -- across midnight. Computed from the rows, never from a known answer.
    COALESCE((
      SELECT
        max(gap)
      FROM (
        SELECT
          CASE WHEN lead(opens) OVER (ORDER BY opens) IS NULL THEN
            (min(opens) OVER () + 1440) - closes
          ELSE
            lead(opens) OVER (ORDER BY opens) - closes
          END AS gap
        FROM (
          SELECT
            (extract(hour FROM w.due_at_local)::integer * 60 + extract(minute FROM w.due_at_local)::integer) - w.grace_before_minutes AS opens,
            (extract(hour FROM w.due_at_local)::integer * 60 + extract(minute FROM w.due_at_local)::integer) + w.grace_after_minutes AS closes
          FROM
            public.facility_cadence_windows w
            JOIN public.facility_cadence_versions v ON v.id = w.cadence_version_id
          WHERE
            v.facility_id = f.id
            AND v.status = 'active'
            AND v.deleted_at IS NULL
            AND w.deleted_at IS NULL
            AND w.enabled) spans) gaps), 1440) AS largest_gap_minutes
  FROM
    public.facilities f
  WHERE
    f.deleted_at IS NULL
)
INSERT INTO public.facility_observation_thresholds (organization_id, facility_id, maximum_unobserved_gap_minutes, maximum_windows_per_resident_per_day, simulation_lookback_days, change_log_page_size)
SELECT
  fg.organization_id,
  fg.facility_id,
  GREATEST(fg.largest_gap_minutes, 1),
  -- Spec 25A section 6.5, fourth warning: more than 8 windows per resident per
  -- day asks for a typed acknowledgment.
  8,
  -- Spec 25A section 6.7 leaves N to the caller. Two weeks is the shortest span
  -- that covers both shifts on every day of the week, which is what a shift
  -- level comparison needs to mean anything.
  14,
  -- Spec 25A section 6.11: the settings page shows the last ten changes inline.
  10
FROM
  facility_gap fg
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      public.facility_observation_thresholds existing
    WHERE
      existing.facility_id = fg.facility_id);

NOTIFY pgrst,
'reload schema';

COMMIT;
