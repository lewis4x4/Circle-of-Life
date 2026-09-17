-- Smart Rounding: observation escalation policy as versioned configuration.
-- Spec: docs/specs/25A-smart-rounding-cadence-and-watchlist.md sections 5, 6.1,
-- 6.3, 6.9, 6.12.
--
-- The escalation ladder is rows, not code. Every offset, every recipient role,
-- every channel and the tier 3 protocol text live in facility scoped tables
-- that an administrator edits without a migration or a deploy. Nothing in
-- supabase/functions/observation-escalation-engine carries a timer, an offset,
-- a recipient or a channel; it reads this configuration and writes what the
-- configuration told it to write.
--
-- The structure mirrors the cadence configuration in migration 412 statement
-- for statement, on purpose: same version table shape, same one active version
-- per facility partial index, same propose and approve split in the insert
-- policy, same invoker rights on the read helpers. Somebody who has read one
-- can read the other.
--
-- Offsets are measured from window_close = due_at + grace_after_minutes, and
-- they are signed. The nudge is negative because it is a warning before the
-- window shuts, and it is a staff reminder rather than an escalation: it writes
-- no row in resident_observation_escalations and therefore cannot inflate an
-- escalation count.
--
-- The grace rule is not restated here. public.monitoring_order_grace_minutes
-- from migration 414 is the single definition, reading its divisor and bounds
-- from haven.observation_grace_formula, and the standard cadence falls out of
-- the same formula at 240 minute spacing. This file adds a module neutral name
-- that delegates to it and no second copy of the arithmetic.
--
-- No Florida rule and no regulatory timer appears in any code path. The tier 3
-- rung carries the facility's own protocol as configuration text, which an
-- administrator can rewrite, and which no function reads as a deadline.

BEGIN;

-- ---------------------------------------------------------------------------
-- Escalation versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_escalation_versions (
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
  CONSTRAINT facility_escalation_versions_facility_version_key UNIQUE (facility_id, version_number),
  CONSTRAINT facility_escalation_versions_effective_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_escalation_versions_one_active
  ON public.facility_escalation_versions (facility_id)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_facility_escalation_versions_facility_effective
  ON public.facility_escalation_versions (facility_id, effective_from DESC)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.facility_escalation_versions IS
  'Effective dated escalation policy versions, shaped exactly like facility_cadence_versions. A change creates a new version; a version that was in force is never mutated. resident_observation_escalations.escalation_version_id stamps which version fired each escalation, so a later policy change cannot rewrite what the ladder was on the day it ran.';
COMMENT ON COLUMN public.facility_escalation_versions.source_template_id IS
  'Organization escalation template this version was copied from, when any. Left unconstrained here; the foreign key to escalation_templates lands with the templates migration.';

-- ---------------------------------------------------------------------------
-- Escalation rungs
--
-- Four seeded rungs, but the count is configuration too: a facility may add a
-- rung, disable one, or move one, and nothing in code assumes four.
--
-- Three booleans describe who a rung reaches, because the spec's ladder needs
-- all three and one of them alone cannot express it:
--
--   assigned_staff_only        the rung is a staff reminder, not an escalation.
--                              It writes no resident_observation_escalations row.
--   include_assigned_staff     the rung also reaches the staff member the task
--                              is assigned to. Spec 5.1 tier 1 is "assigned
--                              staff plus facility administrator".
--   use_standing_alert_routes  the rung reaches the facility's whole standing
--                              alert audience, not only the routes that target
--                              its own roles. Spec 5.1 tier 2 is "administrator
--                              plus standing alert audience".
--
-- target_staff_roles is staff_role, not app_role. Delivery resolves through
-- notification_routes.staff_role_targets, which is a staff_role array, and the
-- roles the spec names for escalation (administrator, assistant administrator)
-- exist only in that enum. Permission gates elsewhere in this file use
-- haven.app_role and therefore say manager where the spec says assistant
-- administrator. Two enums, two jobs; mixing them silently matches nothing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_escalation_rungs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  escalation_version_id uuid NOT NULL REFERENCES public.facility_escalation_versions (id) ON DELETE CASCADE,
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
  CONSTRAINT facility_escalation_rungs_version_key UNIQUE (escalation_version_id, rung_key),
  CONSTRAINT facility_escalation_rungs_channels_known CHECK (array_length(channels, 1) >= 1
    AND channels <@ ARRAY['in_app', 'push', 'sms']),
  -- A rung that reaches nobody is a configuration mistake that looks like a
  -- working ladder. Either it names roles, or it rides the standing audience,
  -- or it reaches the assigned staff member.
  CONSTRAINT facility_escalation_rungs_has_audience CHECK (COALESCE(array_length(target_staff_roles, 1), 0) > 0
    OR use_standing_alert_routes
    OR include_assigned_staff),
  -- An assigned staff only rung is by definition addressed to the assigned
  -- staff member.
  CONSTRAINT facility_escalation_rungs_assigned_only_includes_assigned CHECK (NOT assigned_staff_only
    OR include_assigned_staff),
  -- The protocol belongs to the last rung. Anywhere else it is text nobody reads.
  CONSTRAINT facility_escalation_rungs_protocol_on_terminal CHECK (protocol_text IS NULL OR is_terminal),
  -- sort_order is the escalation_level written on the escalation row, so a rung
  -- that produces one must sort above zero. The nudge sorts at zero and writes
  -- no escalation row, which is what keeps it out of the count.
  CONSTRAINT facility_escalation_rungs_level_positive CHECK (assigned_staff_only OR sort_order > 0)
);

-- At most one terminal rung per version. "Exactly one" is the seeded shape and
-- what the settings validation enforces on a proposed version; at table level
-- Postgres can only refuse the second one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_escalation_rungs_one_terminal
  ON public.facility_escalation_rungs (escalation_version_id)
  WHERE is_terminal AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_facility_escalation_rungs_version_order
  ON public.facility_escalation_rungs (escalation_version_id, sort_order)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.facility_escalation_rungs IS
  'The rungs belonging to one escalation policy version. offset_minutes is signed and measured from window_close; a negative offset fires before the window shuts. Recipients are roles, never a named person and never an email address.';
COMMENT ON COLUMN public.facility_escalation_rungs.offset_minutes IS
  'Minutes from window_close. Negative fires before the window closes. window_close is due_at plus the window grace for a cadence task and due_at plus the interval scaled grace for an order task; public.observation_task_window_close is the single resolver.';
COMMENT ON COLUMN public.facility_escalation_rungs.assigned_staff_only IS
  'True on a rung that is a staff reminder rather than an escalation. Such a rung writes no resident_observation_escalations row, so it cannot inflate an escalation count; its firing is recorded in observation_escalation_dispatches instead.';
COMMENT ON COLUMN public.facility_escalation_rungs.target_staff_roles IS
  'staff_role, not app_role, because delivery resolves through notification_routes.staff_role_targets, which is a staff_role array. Empty on a rung addressed only to the assigned staff member.';
COMMENT ON COLUMN public.facility_escalation_rungs.sort_order IS
  'Also the escalation_level written on the resident_observation_escalations row, so the ladder position and the recorded level cannot drift apart.';
COMMENT ON COLUMN public.facility_escalation_rungs.protocol_text IS
  'The facility''s own protocol for this rung, as configuration text an administrator can rewrite. No function reads it as a deadline and nothing in code branches on it.';

-- ---------------------------------------------------------------------------
-- Per shift overrides
--
-- Spec 6.9. Night shift runs one or two staff, and the channel mix that is
-- reasonable at 10:00 with three people on the floor is not reasonable at 02:00
-- with one. A rung without an override row applies unchanged to every shift.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_escalation_rung_shift_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  escalation_version_id uuid NOT NULL REFERENCES public.facility_escalation_versions (id) ON DELETE CASCADE,
  escalation_rung_id uuid NOT NULL REFERENCES public.facility_escalation_rungs (id) ON DELETE CASCADE,
  shift_key text NOT NULL CHECK (shift_key ~ '^[a-z0-9_]+$'),
  offset_minutes integer NULL,
  channels text[] NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT facility_escalation_rung_shift_overrides_rung_shift_key UNIQUE (escalation_rung_id, shift_key),
  CONSTRAINT facility_escalation_rung_shift_overrides_channels_known CHECK (channels IS NULL
    OR (array_length(channels, 1) >= 1
      AND channels <@ ARRAY['in_app', 'push', 'sms'])),
  -- An override that overrides nothing is a row that reads as a policy decision
  -- and is not one.
  CONSTRAINT facility_escalation_rung_shift_overrides_not_empty CHECK (offset_minutes IS NOT NULL OR channels IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_facility_escalation_rung_shift_overrides_rung
  ON public.facility_escalation_rung_shift_overrides (escalation_rung_id, shift_key)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.facility_escalation_rung_shift_overrides IS
  'Per shift override of a rung offset, its channels, or both, keyed by facility_shift_definitions.shift_key. A rung with no override row for a shift applies unchanged on that shift.';
COMMENT ON COLUMN public.facility_escalation_rung_shift_overrides.channels IS
  'Null means the rung channels apply. A tier 1 push at 02:00 every night gets the channel muted inside a week, and once it is muted the rungs that matter are muted with it, which is why channel control is per rung per shift rather than per rung.';

-- ---------------------------------------------------------------------------
-- What fired, and who was told.
--
-- Two ledgers, because they answer two questions and conflating them is what
-- makes an escalation count lie.
--
-- observation_escalation_dispatches is one row per rung per task: the record
-- that the rung fired. Every rung lands here, the nudge included. Its unique
-- index on (task_id, rung_key) is the idempotency anchor, so a re-tick of the
-- engine cannot fire a rung twice however many times it runs.
--
-- observation_escalation_deliveries is one row per recipient per channel: the
-- record that somebody was told. The engine drains it the way
-- care-event-dispatcher drains care_event_deliveries, over the same channels.
--
-- The nudge writes a dispatch row and delivery rows and no
-- resident_observation_escalations row at all. An escalation count is
-- count(*) from resident_observation_escalations, so a nudge cannot inflate it
-- no matter how many nudges a shift produces.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.observation_escalation_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  entity_id uuid NULL REFERENCES public.entities (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  resident_id uuid NOT NULL REFERENCES public.residents (id),
  task_id uuid NOT NULL REFERENCES public.resident_observation_tasks (id),
  escalation_version_id uuid NOT NULL REFERENCES public.facility_escalation_versions (id),
  escalation_rung_id uuid NOT NULL REFERENCES public.facility_escalation_rungs (id),
  rung_key text NOT NULL,
  is_terminal boolean NOT NULL DEFAULT FALSE,
  -- Null on an assigned staff only rung, which is a reminder and not an
  -- escalation. The column is the join that proves it.
  escalation_id uuid NULL REFERENCES public.resident_observation_escalations (id),
  shift_key text NULL,
  window_closes_at timestamptz NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now(),
  channels text[] NOT NULL,
  recipients_resolved integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT observation_escalation_dispatches_task_rung_key UNIQUE (task_id, rung_key)
);

CREATE INDEX IF NOT EXISTS idx_observation_escalation_dispatches_facility_fired
  ON public.observation_escalation_dispatches (facility_id, fired_at DESC);

CREATE INDEX IF NOT EXISTS idx_observation_escalation_dispatches_version
  ON public.observation_escalation_dispatches (escalation_version_id);

COMMENT ON TABLE public.observation_escalation_dispatches IS
  'Append only record of every escalation rung that fired against a task, the nudge included. One row per (task_id, rung_key), which is what makes a re-tick of observation-escalation-engine idempotent. escalation_id is null on an assigned staff only rung, so counting escalations means counting resident_observation_escalations and a nudge cannot inflate it.';

CREATE TABLE IF NOT EXISTS public.observation_escalation_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  dispatch_id uuid NULL REFERENCES public.observation_escalation_dispatches (id) ON DELETE CASCADE,
  notification_route_id uuid NULL REFERENCES public.notification_routes (id),
  rung_key text NOT NULL,
  target_role text NOT NULL,
  target_user_id uuid NULL REFERENCES public.user_profiles (id),
  target_phone text NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'push', 'sms')),
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  skip_reason text NULL,
  error_message text NULL,
  provider_message_id text NULL,
  is_test boolean NOT NULL DEFAULT FALSE,
  -- Only a test send stores its body, and a test send has no resident, so the
  -- CHECK is the structural guarantee that no protected health information can
  -- reach this column. Real sends compose their body at delivery time and store
  -- none of it.
  message_body text NULL,
  send_after timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT observation_escalation_deliveries_body_test_only CHECK (message_body IS NULL OR is_test),
  CONSTRAINT observation_escalation_deliveries_test_body_prefix CHECK (message_body IS NULL OR message_body LIKE 'TEST %'),
  -- A test send touches no task, so it has no dispatch to hang from. A real
  -- delivery always does.
  CONSTRAINT observation_escalation_deliveries_dispatch_required CHECK (is_test OR dispatch_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_observation_escalation_deliveries_pending
  ON public.observation_escalation_deliveries (status, send_after)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_observation_escalation_deliveries_dispatch
  ON public.observation_escalation_deliveries (dispatch_id, created_at DESC);

COMMENT ON TABLE public.observation_escalation_deliveries IS
  'Queued and completed escalation deliveries, one row per recipient per channel, shaped like care_event_deliveries so the same channels reach the same places. Rows with is_test are test sends from public.send_test_escalation: they carry no dispatch, touch no task and create no escalation row.';
COMMENT ON COLUMN public.observation_escalation_deliveries.message_body IS
  'Set only on a test send, whose body starts with the word TEST and names no resident. A real delivery composes its body at send time and stores none of it, so this column can never hold protected health information.';

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.facility_escalation_versions, public.facility_escalation_rungs,
  public.facility_escalation_rung_shift_overrides, public.observation_escalation_dispatches,
  public.observation_escalation_deliveries FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON public.facility_escalation_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.facility_escalation_rungs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.facility_escalation_rung_shift_overrides TO authenticated;
GRANT SELECT ON public.observation_escalation_dispatches TO authenticated;
GRANT SELECT ON public.observation_escalation_deliveries TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_escalation_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_escalation_rungs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_escalation_rung_shift_overrides TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.observation_escalation_dispatches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.observation_escalation_deliveries TO service_role;

ALTER TABLE public.facility_escalation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_escalation_rungs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_escalation_rung_shift_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observation_escalation_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observation_escalation_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_escalation_versions_select ON public.facility_escalation_versions;
CREATE POLICY facility_escalation_versions_select ON public.facility_escalation_versions
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- Proposing a change is facility_admin and manager work; activating it is not.
-- Same split as the cadence version table: at table level a proposal may only
-- ever land as draft or pending_approval.
DROP POLICY IF EXISTS facility_escalation_versions_insert ON public.facility_escalation_versions;
CREATE POLICY facility_escalation_versions_insert ON public.facility_escalation_versions
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (haven.app_role () IN ('owner', 'org_admin')
      OR (haven.app_role () IN ('facility_admin', 'manager')
        AND status IN ('draft', 'pending_approval'))));

DROP POLICY IF EXISTS facility_escalation_versions_update ON public.facility_escalation_versions;
CREATE POLICY facility_escalation_versions_update ON public.facility_escalation_versions
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS facility_escalation_rungs_select ON public.facility_escalation_rungs;
CREATE POLICY facility_escalation_rungs_select ON public.facility_escalation_rungs
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP POLICY IF EXISTS facility_escalation_rungs_insert ON public.facility_escalation_rungs;
CREATE POLICY facility_escalation_rungs_insert ON public.facility_escalation_rungs
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_escalation_versions v
      WHERE
        v.id = escalation_version_id
        AND v.facility_id = facility_escalation_rungs.facility_id
        AND v.deleted_at IS NULL
        AND (haven.app_role () IN ('owner', 'org_admin')
          OR (haven.app_role () IN ('facility_admin', 'manager')
            AND v.status IN ('draft', 'pending_approval')))));

DROP POLICY IF EXISTS facility_escalation_rungs_update ON public.facility_escalation_rungs;
CREATE POLICY facility_escalation_rungs_update ON public.facility_escalation_rungs
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS facility_escalation_rung_shift_overrides_select ON public.facility_escalation_rung_shift_overrides;
CREATE POLICY facility_escalation_rung_shift_overrides_select ON public.facility_escalation_rung_shift_overrides
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP POLICY IF EXISTS facility_escalation_rung_shift_overrides_insert ON public.facility_escalation_rung_shift_overrides;
CREATE POLICY facility_escalation_rung_shift_overrides_insert ON public.facility_escalation_rung_shift_overrides
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_escalation_versions v
      WHERE
        v.id = escalation_version_id
        AND v.facility_id = facility_escalation_rung_shift_overrides.facility_id
        AND v.deleted_at IS NULL
        AND (haven.app_role () IN ('owner', 'org_admin')
          OR (haven.app_role () IN ('facility_admin', 'manager')
            AND v.status IN ('draft', 'pending_approval')))));

DROP POLICY IF EXISTS facility_escalation_rung_shift_overrides_update ON public.facility_escalation_rung_shift_overrides;
CREATE POLICY facility_escalation_rung_shift_overrides_update ON public.facility_escalation_rung_shift_overrides
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

-- The two ledgers are readable and never writable by a signed in caller. The
-- engine writes them through definer commands as service_role, which is what
-- keeps a rung from being marked fired by anybody who can reach the API.
DROP POLICY IF EXISTS observation_escalation_dispatches_select ON public.observation_escalation_dispatches;
CREATE POLICY observation_escalation_dispatches_select ON public.observation_escalation_dispatches
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP POLICY IF EXISTS observation_escalation_deliveries_select ON public.observation_escalation_deliveries;
CREATE POLICY observation_escalation_deliveries_select ON public.observation_escalation_deliveries
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'manager')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- ---------------------------------------------------------------------------
-- Updated at and audit triggers
--
-- The three configuration tables carry both. observation_escalation_dispatches
-- carries the audit trigger and no updated at trigger, because it is append
-- only and has no updated_at column. observation_escalation_deliveries carries
-- the updated at trigger only: it is a per recipient per channel fan out that
-- a dispatcher rewrites on every send, and auditing it would bury the
-- configuration changes the audit log exists to surface. The dispatch row above
-- it is audited, and it is the one that records a policy decision.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS tr_facility_escalation_versions_set_updated_at ON public.facility_escalation_versions;
CREATE TRIGGER tr_facility_escalation_versions_set_updated_at
  BEFORE UPDATE ON public.facility_escalation_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_facility_escalation_rungs_set_updated_at ON public.facility_escalation_rungs;
CREATE TRIGGER tr_facility_escalation_rungs_set_updated_at
  BEFORE UPDATE ON public.facility_escalation_rungs
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_facility_escalation_rung_shift_overrides_set_updated_at ON public.facility_escalation_rung_shift_overrides;
CREATE TRIGGER tr_facility_escalation_rung_shift_overrides_set_updated_at
  BEFORE UPDATE ON public.facility_escalation_rung_shift_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_observation_escalation_deliveries_set_updated_at ON public.observation_escalation_deliveries;
CREATE TRIGGER tr_observation_escalation_deliveries_set_updated_at
  BEFORE UPDATE ON public.observation_escalation_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_facility_escalation_versions_audit ON public.facility_escalation_versions;
CREATE TRIGGER tr_facility_escalation_versions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_escalation_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_facility_escalation_rungs_audit ON public.facility_escalation_rungs;
CREATE TRIGGER tr_facility_escalation_rungs_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_escalation_rungs
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_facility_escalation_rung_shift_overrides_audit ON public.facility_escalation_rung_shift_overrides;
CREATE TRIGGER tr_facility_escalation_rung_shift_overrides_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_escalation_rung_shift_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_observation_escalation_dispatches_audit ON public.observation_escalation_dispatches;
CREATE TRIGGER tr_observation_escalation_dispatches_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.observation_escalation_dispatches
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

-- ---------------------------------------------------------------------------
-- Seed: escalation version 1, active, at every facility in the organization.
--
-- Selected by organization, never by a name list. Migration 318 realigned two
-- of the five facility names to their registered form, so a seed carrying the
-- pre-318 names silently touches three facilities out of five and reports
-- success. Every facility in the organization inherits the ladder, which is
-- also what should happen when a sixth building is added.
-- ---------------------------------------------------------------------------
INSERT INTO public.facility_escalation_versions (organization_id, facility_id, version_number, status, effective_from, change_reason, activated_at)
SELECT
  f.organization_id,
  f.id,
  1,
  'active',
  '2026-09-16T00:00:00Z'::timestamptz,
  'Escalation ladder adopted by the 2026-09-16 cadence decision: a staff nudge before the window closes, then three rungs measured from window close. Seeded defaults, editable per facility from this point on.',
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
      public.facility_escalation_versions existing
    WHERE
      existing.facility_id = f.id
      AND existing.version_number = 1);

-- ---------------------------------------------------------------------------
-- Seed: the four rungs on version 1.
--
-- Offsets are minutes from window_close. The nudge is negative: it is a warning
-- fifteen minutes before the window shuts, addressed to the staff member who
-- owns the task and nobody else, and it writes no escalation row. It exists
-- because a warning catches most misses before they reach anyone, which is what
-- keeps tier 1 volume low enough that an administrator still reads tier 1.
--
-- Recorded honestly, from spec section 5.1: with a sixty minute grace a 10:00
-- window now reaches the administrator at 11:30 rather than at 10:30. The first
-- human visible alert is an hour later than it was. Moving tier 1 to offset
-- zero is a row edit from here, not a deploy.
-- ---------------------------------------------------------------------------
WITH rung_seed (rung_key, label, offset_minutes, is_terminal, assigned_staff_only, include_assigned_staff, use_standing_alert_routes, target_staff_roles, channels, protocol_text, sort_order) AS (
  VALUES ('nudge', 'Staff nudge', -15, FALSE, TRUE, TRUE, FALSE, ARRAY[]::public.staff_role[], ARRAY['push'], NULL::text, 0),
    ('tier_1', 'First escalation', 30, FALSE, FALSE, TRUE, FALSE, ARRAY['administrator']::public.staff_role[], ARRAY['in_app', 'push'], NULL::text, 1),
    ('tier_2', 'Second escalation', 60, FALSE, FALSE, FALSE, TRUE, ARRAY['administrator', 'assistant_administrator']::public.staff_role[], ARRAY['in_app', 'push'], NULL::text, 2),
    ('tier_3', 'Final escalation', 90, TRUE, FALSE, FALSE, TRUE, ARRAY['administrator', 'assistant_administrator']::public.staff_role[], ARRAY['in_app', 'push', 'sms'],
      'Facility protocol for a resident who has still not been seen. The administrator on call takes direct responsibility for locating the resident and confirming their condition in person, and the building is walked room by room until they are found. If the resident has not been located and confirmed safe within the facility''s own sixty minute protocol window, or at any earlier moment when the resident is found injured, unresponsive, distressed or off the property, staff call 911 first and tell the administrator second. The decision to call 911 belongs to the staff member standing there and never waits for anybody''s approval. Record what happened on the resident record before the shift ends. This text is facility policy and an administrator may rewrite it; nothing in Haven reads it as a deadline or acts on it.'::text, 3)
)
INSERT INTO public.facility_escalation_rungs (organization_id, facility_id, escalation_version_id, rung_key, label, offset_minutes, is_terminal, assigned_staff_only, include_assigned_staff, use_standing_alert_routes, target_staff_roles, channels, protocol_text, sort_order, enabled)
SELECT
  v.organization_id,
  v.facility_id,
  v.id,
  rs.rung_key,
  rs.label,
  rs.offset_minutes,
  rs.is_terminal,
  rs.assigned_staff_only,
  rs.include_assigned_staff,
  rs.use_standing_alert_routes,
  rs.target_staff_roles,
  rs.channels,
  rs.protocol_text,
  rs.sort_order,
  TRUE
FROM
  public.facility_escalation_versions v
  CROSS JOIN rung_seed rs
WHERE
  v.organization_id = '00000000-0000-0000-0000-000000000001'
  AND v.version_number = 1
  AND v.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.facility_escalation_rungs existing
    WHERE
      existing.escalation_version_id = v.id
      AND existing.rung_key = rs.rung_key);

-- ---------------------------------------------------------------------------
-- Seed: the night shift channel overrides, spec 6.9.
--
-- Only the channels change. The offsets are deliberately left null, because a
-- resident unseen at 02:00 is not less urgent than one unseen at 10:00 and the
-- ladder should not run slower overnight. What changes is how loudly it rings:
-- a tier 1 push at 02:00 every night gets the whole channel muted inside a
-- week, and once an administrator mutes Haven notifications, tier 2 and tier 3
-- are muted with it. Tier 3 keeps all three channels, and carries a row here
-- rather than no row so the decision is visible as a decision.
-- ---------------------------------------------------------------------------
WITH override_seed (rung_key, shift_key, channels) AS (
  VALUES ('tier_1', 'night', ARRAY['in_app']),
    ('tier_2', 'night', ARRAY['in_app', 'push']),
    ('tier_3', 'night', ARRAY['in_app', 'push', 'sms'])
)
INSERT INTO public.facility_escalation_rung_shift_overrides (organization_id, facility_id, escalation_version_id, escalation_rung_id, shift_key, offset_minutes, channels)
SELECT
  r.organization_id,
  r.facility_id,
  r.escalation_version_id,
  r.id,
  os.shift_key,
  NULL,
  os.channels
FROM
  public.facility_escalation_rungs r
  JOIN public.facility_escalation_versions v ON v.id = r.escalation_version_id
  JOIN override_seed os ON os.rung_key = r.rung_key
WHERE
  v.organization_id = '00000000-0000-0000-0000-000000000001'
  AND v.version_number = 1
  AND v.deleted_at IS NULL
  AND r.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.facility_escalation_rung_shift_overrides existing
    WHERE
      existing.escalation_rung_id = r.id
      AND existing.shift_key = os.shift_key);

-- ---------------------------------------------------------------------------
-- Escalation stamping.
--
-- Same shape as the cadence stamp on resident_observation_tasks: the row
-- records which version fired it, so a later policy change cannot rewrite what
-- the ladder was on the day it ran.
-- ---------------------------------------------------------------------------
ALTER TABLE public.resident_observation_escalations
  ADD COLUMN IF NOT EXISTS escalation_version_id uuid NULL REFERENCES public.facility_escalation_versions (id),
  ADD COLUMN IF NOT EXISTS rung_key text NULL;

COMMENT ON COLUMN public.resident_observation_escalations.escalation_version_id IS
  'Escalation policy version in force when this escalation fired. Reads join through this stamp so a later policy change cannot rewrite a past escalation.';
COMMENT ON COLUMN public.resident_observation_escalations.rung_key IS
  'facility_escalation_rungs.rung_key that fired. Null on rows that predate versioned escalation policy.';

-- One rung fires at most once per task. A re-tick of the engine, a retry, or
-- two overlapping cron runs cannot double fire a rung.
CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_escalations_task_rung
  ON public.resident_observation_escalations (task_id, rung_key)
  WHERE rung_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_obs_escalations_version
  ON public.resident_observation_escalations (escalation_version_id)
  WHERE deleted_at IS NULL;

-- Existing rows predate versioned escalation policy and version 1 is the only
-- version that has ever existed, so stamping them with it loses no history.
-- rung_key is deliberately left null on them: they were fired by the retired
-- hardcoded ladder and did not come from a rung.
UPDATE
  public.resident_observation_escalations e
SET
  escalation_version_id = v.id
FROM
  public.facility_escalation_versions v
WHERE
  v.facility_id = e.facility_id
  AND v.version_number = 1
  AND v.deleted_at IS NULL
  AND e.escalation_version_id IS NULL;

-- ---------------------------------------------------------------------------
-- Read helpers. Every offset, every channel and every window close calculation
-- in the product goes through these, so no caller carries a timer, an offset
-- or a channel of its own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.facility_escalation_in_force (p_facility_id uuid, p_at timestamptz)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    v.id
  FROM
    public.facility_escalation_versions v
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

COMMENT ON FUNCTION public.facility_escalation_in_force (uuid, timestamptz) IS
  'The escalation policy version in force at an instant, including a superseded version when the instant is in the past. Mirrors public.facility_cadence_in_force. Invoker rights: escalation policy is facility policy, not a privileged read, and the policy tables own SELECT policies already scope the caller. The engine runs as service_role, which bypasses RLS and needs no definer rights.';

-- The grace rule already exists exactly once, in migration 414. This is a
-- module neutral name for it, not a second copy: the escalation work reads
-- grace for a standard cadence interval as well as for an order interval, and
-- calling a function named for Monitoring Orders to do it would read as if
-- there were two rules. There is one. The body delegates and does no
-- arithmetic.
CREATE OR REPLACE FUNCTION public.observation_grace_minutes (p_interval_minutes integer)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    public.monitoring_order_grace_minutes (p_interval_minutes);
$func$;

COMMENT ON FUNCTION public.observation_grace_minutes (integer) IS
  'Grace in minutes for any observation interval, standard cadence or Monitoring Order. Delegates to public.monitoring_order_grace_minutes, which is the single definition of the rule and reads its divisor and bounds from haven.observation_grace_formula. This function restates no arithmetic; spec section 5.2 is explicit that there is one rule and not two.';

-- ---------------------------------------------------------------------------
-- The window close resolver.
--
-- Escalation offsets are measured from window_close, and window_close comes
-- from a different place depending on what kind of task it is:
--
--   cadence task  due_at plus the window's own grace_after_minutes, read from
--                 the cadence version the task is stamped with, so a later
--                 cadence change cannot move the close of a window that has
--                 already been scored
--   order task    due_at plus the interval scaled grace for the order's
--                 interval, through the one grace rule
--   legacy task   the stored grace_ends_at, which is all a per resident plan
--                 task ever had
--
-- One function, so the Edge Function carries no arithmetic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.observation_task_window_close (p_task_id uuid)
  RETURNS timestamptz
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    CASE WHEN o.id IS NOT NULL THEN
      t.due_at + make_interval(mins => public.observation_grace_minutes (o.interval_minutes))
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
  'The instant a task''s observation window closes: due_at plus the stamped cadence window grace for a cadence task, due_at plus the interval scaled grace for a Monitoring Order task, and the stored grace_ends_at for a legacy plan task. The single resolver; every escalation offset is measured from what this returns and no caller computes it.';

-- ---------------------------------------------------------------------------
-- The rungs in force at an instant, with the shift override already applied.
--
-- A rung with no override row for the shift comes back unchanged, which is what
-- "rungs without an override apply to every shift" means in one place rather
-- than in every caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.observation_escalation_rungs_at (p_facility_id uuid, p_at timestamptz, p_shift_key text DEFAULT NULL)
  RETURNS TABLE (
    escalation_version_id uuid,
    version_effective_from timestamptz,
    rung_id uuid,
    rung_key text,
    label text,
    offset_minutes integer,
    is_terminal boolean,
    assigned_staff_only boolean,
    include_assigned_staff boolean,
    use_standing_alert_routes boolean,
    target_staff_roles public.staff_role[],
    channels text[],
    protocol_text text,
    shift_key text,
    shift_override_applied boolean,
    sort_order integer)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    r.escalation_version_id,
    v.effective_from,
    r.id,
    r.rung_key,
    r.label,
    COALESCE(ov.offset_minutes, r.offset_minutes),
    r.is_terminal,
    r.assigned_staff_only,
    r.include_assigned_staff,
    r.use_standing_alert_routes,
    r.target_staff_roles,
    COALESCE(ov.channels, r.channels),
    r.protocol_text,
    p_shift_key,
    (ov.id IS NOT NULL),
    r.sort_order
  FROM
    public.facility_escalation_rungs r
    JOIN public.facility_escalation_versions v ON v.id = r.escalation_version_id
    LEFT JOIN public.facility_escalation_rung_shift_overrides ov ON ov.escalation_rung_id = r.id
      AND ov.shift_key = p_shift_key
      AND ov.deleted_at IS NULL
  WHERE
    r.escalation_version_id = public.facility_escalation_in_force (p_facility_id, p_at)
    AND r.deleted_at IS NULL
    AND r.enabled
  ORDER BY
    r.sort_order,
    r.offset_minutes;
$func$;

COMMENT ON FUNCTION public.observation_escalation_rungs_at (uuid, timestamptz, text) IS
  'The escalation rungs in force at a facility at an instant, with the per shift override for the named shift already folded in. Pass the shift the window close falls on; a rung with no override row for that shift comes back unchanged. The only place the override rule is applied.';

REVOKE ALL ON FUNCTION public.facility_escalation_in_force (uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_escalation_in_force (uuid, timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.observation_grace_minutes (integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.observation_grace_minutes (integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.observation_task_window_close (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.observation_task_window_close (uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.observation_escalation_rungs_at (uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.observation_escalation_rungs_at (uuid, timestamptz, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What the engine reads on a tick.
--
-- Every rung whose fire time has passed and which has not already fired against
-- that task. The NOT EXISTS against the dispatch ledger is what makes a re-tick
-- a no-op; the unique index behind it is what makes two overlapping ticks a
-- no-op as well.
--
-- Bounded two ways, both from configuration rather than from a constant:
--   scheduled_for <= p_at   the window has at least opened. A rung cannot be
--                           due before the window it measures from exists.
--   window close >= the version's effective_from
--                           a policy version that took effect this morning does
--                           not retro-fire every miss the building ever had.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.observation_escalations_due (p_organization_id uuid, p_facility_id uuid DEFAULT NULL, p_at timestamptz DEFAULT now(), p_limit integer DEFAULT 500)
  RETURNS TABLE (
    task_id uuid,
    organization_id uuid,
    facility_id uuid,
    resident_id uuid,
    escalation_version_id uuid,
    rung_key text,
    label text,
    is_terminal boolean,
    assigned_staff_only boolean,
    channels text[],
    shift_key text,
    window_closes_at timestamptz,
    fire_at timestamptz)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH candidate AS (
    SELECT
      t.id,
      -- Aliased because the function's own OUT parameters carry these names.
      t.organization_id AS task_organization_id,
      t.facility_id AS task_facility_id,
      t.resident_id AS task_resident_id,
      public.observation_task_window_close (t.id) AS closes_at
    FROM
      public.resident_observation_tasks t
    WHERE
      t.organization_id = p_organization_id
      AND (p_facility_id IS NULL OR t.facility_id = p_facility_id)
      AND t.deleted_at IS NULL
      AND t.scheduled_for <= p_at
      AND t.status NOT IN ('completed_on_time', 'completed_late', 'missed', 'excused', 'reassigned')
),
shifted AS (
  SELECT
    c.id,
    c.task_organization_id,
    c.task_facility_id,
    c.task_resident_id,
    c.closes_at,
    sw.shift_key AS shift
  FROM
    candidate c
    LEFT JOIN LATERAL public.facility_shift_window_at (c.task_facility_id, c.closes_at) sw ON TRUE
  WHERE
    c.closes_at IS NOT NULL
)
SELECT
  s.id,
  s.task_organization_id,
  s.task_facility_id,
  s.task_resident_id,
  r.escalation_version_id,
  r.rung_key,
  r.label,
  r.is_terminal,
  r.assigned_staff_only,
  r.channels,
  s.shift,
  s.closes_at,
  s.closes_at + make_interval(mins => r.offset_minutes)
FROM
  shifted s
  CROSS JOIN LATERAL public.observation_escalation_rungs_at (s.task_facility_id, s.closes_at, s.shift) r
WHERE
  s.closes_at + make_interval(mins => r.offset_minutes) <= p_at
  AND s.closes_at >= r.version_effective_from
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.observation_escalation_dispatches d
    WHERE
      d.task_id = s.id
      AND d.rung_key = r.rung_key)
ORDER BY
  s.closes_at + make_interval(mins => r.offset_minutes)
LIMIT p_limit;
$func$;

COMMENT ON FUNCTION public.observation_escalations_due (uuid, uuid, timestamptz, integer) IS
  'Every escalation rung that is due to fire and has not already fired for that task. The single read observation-escalation-engine makes; the offsets, the channels, the shift overrides and the window close all resolve here so the function body carries none of them.';

REVOKE ALL ON FUNCTION public.observation_escalations_due (uuid, uuid, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.observation_escalations_due (uuid, uuid, timestamptz, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Recipient resolution.
--
-- Roles, never a named person and never an email address in a rung row. The
-- rung names staff_role values; notification_routes.staff_role_targets is what
-- turns them into people, because that is the repository's routing table and it
-- speaks staff_role.
--
-- Three sources, unioned and deduplicated by user:
--   1. the staff member the task is assigned to, when the rung includes them
--   2. every active route for the facility whose staff_role_targets overlap the
--      rung's roles, narrowed to the overlap, plus that route's user_targets
--   3. every active route for the facility regardless of overlap, when the rung
--      rides the standing alert audience
--
-- And a fallback: when none of that resolves to anybody, the rung's own roles
-- are matched against the facility's staff directly, so a facility that has
-- configured no notification route still reaches its administrator instead of
-- escalating into silence. Care events and Monitoring Orders both do this.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.observation_escalation_recipients (p_organization_id uuid, p_facility_id uuid, p_rung_id uuid, p_assigned_staff_id uuid DEFAULT NULL)
  RETURNS TABLE (
    notification_route_id uuid,
    target_role text,
    target_user_id uuid,
    target_phone text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_rung record;
  v_found integer;
BEGIN
  SELECT
    r.target_staff_roles,
    r.include_assigned_staff,
    r.use_standing_alert_routes INTO v_rung
  FROM
    public.facility_escalation_rungs r
  WHERE
    r.id = p_rung_id
    AND r.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY WITH assigned AS (
    SELECT
      NULL::uuid AS route_id,
      s.staff_role::text AS role_name,
      s.user_id AS uid,
      NULLIF(btrim(s.phone), '') AS phone
    FROM
      public.staff s
    WHERE
      v_rung.include_assigned_staff
      AND p_assigned_staff_id IS NOT NULL
      AND s.id = p_assigned_staff_id
      AND s.deleted_at IS NULL
      AND s.employment_status = 'active'
      AND s.user_id IS NOT NULL
),
matched_route AS (
  SELECT
    nr.id,
    nr.user_targets,
    CASE WHEN v_rung.use_standing_alert_routes THEN
      COALESCE(nr.staff_role_targets, ARRAY[]::public.staff_role[])
    ELSE
      ARRAY (
        SELECT
          a
        FROM
          unnest(COALESCE(nr.staff_role_targets, ARRAY[]::public.staff_role[])) a
        INTERSECT
        SELECT
          b
        FROM
          unnest(v_rung.target_staff_roles) b)
    END AS roles
  FROM
    public.notification_routes nr
  WHERE
    nr.organization_id = p_organization_id
    AND (nr.facility_id IS NULL
      OR nr.facility_id = p_facility_id)
    AND nr.is_active
    AND nr.deleted_at IS NULL
    AND (v_rung.use_standing_alert_routes
      OR (nr.staff_role_targets IS NOT NULL
        AND nr.staff_role_targets && v_rung.target_staff_roles))
),
from_route AS (
  SELECT
    mr.id AS route_id,
    s.staff_role::text AS role_name,
    s.user_id AS uid,
    NULLIF(btrim(s.phone), '') AS phone
  FROM
    matched_route mr
    JOIN public.staff s ON s.organization_id = p_organization_id
      AND s.facility_id = p_facility_id
      AND s.employment_status = 'active'
      AND s.deleted_at IS NULL
      AND s.user_id IS NOT NULL
      AND s.staff_role = ANY (mr.roles)
  UNION
  SELECT
    mr.id,
    up.app_role::text,
    up.id,
    NULLIF(btrim(up.phone), '')
  FROM
    matched_route mr
    JOIN public.user_profiles up ON mr.user_targets IS NOT NULL
      AND up.id = ANY (mr.user_targets)
      AND up.organization_id = p_organization_id
      AND up.is_active
      AND up.deleted_at IS NULL
)
SELECT DISTINCT ON (u.uid)
  u.route_id,
  u.role_name,
  u.uid,
  u.phone
FROM (
  SELECT
    *
  FROM
    assigned
  UNION ALL
  SELECT
    *
  FROM
    from_route) u
WHERE
  EXISTS (
    SELECT
      1
    FROM
      public.user_profiles keep
    WHERE
      keep.id = u.uid)
ORDER BY
  u.uid,
  u.route_id NULLS FIRST;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found > 0 THEN
    RETURN;
  END IF;

  -- Nothing configured, or nothing the routes resolved to. The rung's own roles
  -- still reach somebody at this facility rather than escalating into silence.
  RETURN QUERY
  SELECT DISTINCT ON (s.user_id)
    NULL::uuid,
    s.staff_role::text,
    s.user_id,
    NULLIF(btrim(s.phone), '')
  FROM
    public.staff s
  WHERE
    s.organization_id = p_organization_id
    AND s.facility_id = p_facility_id
    AND s.employment_status = 'active'
    AND s.deleted_at IS NULL
    AND s.user_id IS NOT NULL
    AND s.staff_role = ANY (v_rung.target_staff_roles)
    AND EXISTS (
      SELECT
        1
      FROM
        public.user_profiles keep
      WHERE
        keep.id = s.user_id)
  ORDER BY
    s.user_id;
END;
$func$;

COMMENT ON FUNCTION haven.observation_escalation_recipients (uuid, uuid, uuid, uuid) IS
  'The people one escalation rung reaches at one facility, resolved through notification_routes.staff_role_targets and the rung''s own staff_role list, with the facility staff fallback when no route resolves. Roles in, people out: no rung row ever names a person or an email address.';

-- Not granted to authenticated. Its only callers are the two definer commands
-- above, which run as the owner and reach it regardless, and a resolver that
-- enumerates who is on shift at a building is not a read to hand out.
REVOKE ALL ON FUNCTION haven.observation_escalation_recipients (uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION haven.observation_escalation_recipients (uuid, uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Firing a rung.
--
-- One command, idempotent by the dispatch ledger's unique index rather than by
-- a read-then-write the engine could race with itself on.
--
-- An assigned staff only rung writes no resident_observation_escalations row.
-- That is the whole reason the dispatch ledger exists: the nudge has to be
-- recorded, because a nudge that fired twice is a bug and a nudge that never
-- fired is a different bug, and it must not be counted, because an escalation
-- count that includes a warning nobody escalated to is a number that makes the
-- ladder look worse than the building is.
--
-- Task status moves with the ladder rather than with a clock: the first rung
-- that is a real escalation marks the task critically overdue, and the terminal
-- rung marks it missed. Which rung that is comes from the rows, so a facility
-- that reorders its ladder changes when a task reads as missed without anybody
-- editing a threshold.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_observation_escalation_rung (p_task_id uuid, p_rung_key text, p_at timestamptz DEFAULT now())
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_task record;
  v_rung record;
  v_close timestamptz;
  v_shift text;
  v_dispatch_id uuid;
  v_escalation_id uuid := NULL;
  v_facility_name text;
  v_channel text;
  v_rows integer;
  v_queued integer := 0;
  v_recipients integer := 0;
BEGIN
  SELECT
    t.id,
    t.organization_id,
    t.entity_id,
    t.facility_id,
    t.resident_id,
    t.assigned_staff_id INTO v_task
  FROM
    public.resident_observation_tasks t
  WHERE
    t.id = p_task_id
    AND t.deleted_at IS NULL;

  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'task_not_found');
  END IF;

  v_close := public.observation_task_window_close (p_task_id);
  IF v_close IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'no_window_close');
  END IF;

  SELECT
    sw.shift_key INTO v_shift
  FROM
    public.facility_shift_window_at (v_task.facility_id, v_close) sw;

  SELECT
    r.* INTO v_rung
  FROM
    public.observation_escalation_rungs_at (v_task.facility_id, v_close, v_shift) r
  WHERE
    r.rung_key = p_rung_key;

  IF v_rung.rung_key IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'rung_not_in_force');
  END IF;

  INSERT INTO public.observation_escalation_dispatches (organization_id, entity_id, facility_id, resident_id, task_id, escalation_version_id, escalation_rung_id, rung_key, is_terminal, shift_key, window_closes_at, fired_at, channels)
    VALUES (v_task.organization_id, v_task.entity_id, v_task.facility_id, v_task.resident_id, v_task.id, v_rung.escalation_version_id, v_rung.rung_id, v_rung.rung_key, v_rung.is_terminal, v_shift, v_close, p_at, v_rung.channels)
  ON CONFLICT (task_id, rung_key)
    DO NOTHING
  RETURNING
    id INTO v_dispatch_id;

  IF v_dispatch_id IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'already_fired', 'rung_key', p_rung_key);
  END IF;

  IF NOT v_rung.assigned_staff_only THEN
    INSERT INTO public.resident_observation_escalations (organization_id, entity_id, facility_id, resident_id, task_id, escalation_level, escalation_type, escalation_version_id, rung_key, triggered_at)
      VALUES (v_task.organization_id, v_task.entity_id, v_task.facility_id, v_task.resident_id, v_task.id, v_rung.sort_order, 'auto_overdue', v_rung.escalation_version_id, v_rung.rung_key, p_at)
    RETURNING
      id INTO v_escalation_id;

    UPDATE
      public.observation_escalation_dispatches
    SET
      escalation_id = v_escalation_id
    WHERE
      id = v_dispatch_id;
  END IF;

  FOREACH v_channel IN ARRAY v_rung.channels LOOP
    INSERT INTO public.observation_escalation_deliveries (organization_id, facility_id, dispatch_id, notification_route_id, rung_key, target_role, target_user_id, target_phone, channel, status, send_after)
    SELECT
      v_task.organization_id,
      v_task.facility_id,
      v_dispatch_id,
      rec.notification_route_id,
      v_rung.rung_key,
      rec.target_role,
      rec.target_user_id,
      rec.target_phone,
      v_channel,
      'queued',
      p_at
    FROM
      haven.observation_escalation_recipients (v_task.organization_id, v_task.facility_id, v_rung.rung_id, v_task.assigned_staff_id) rec;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_queued := v_queued + v_rows;
    v_recipients := GREATEST(v_recipients, v_rows);
  END LOOP;

  -- A rung that resolved to nobody is recorded as a skipped delivery rather
  -- than as no delivery, so "nobody was told" is visible in the ledger instead
  -- of looking like a tick that never ran.
  IF v_queued = 0 THEN
    INSERT INTO public.observation_escalation_deliveries (organization_id, facility_id, dispatch_id, notification_route_id, rung_key, target_role, target_user_id, target_phone, channel, status, skip_reason, send_after)
      VALUES (v_task.organization_id, v_task.facility_id, v_dispatch_id, NULL, v_rung.rung_key, 'unresolved', NULL, NULL, v_rung.channels[1], 'skipped', 'no_target', p_at);
  END IF;

  UPDATE
    public.observation_escalation_dispatches
  SET
    recipients_resolved = v_recipients
  WHERE
    id = v_dispatch_id;

  IF v_rung.is_terminal THEN
    UPDATE
      public.resident_observation_tasks
    SET
      status = 'missed',
      escalated_at = COALESCE(escalated_at, p_at)
    WHERE
      id = p_task_id
      AND status NOT IN ('completed_on_time', 'completed_late', 'excused', 'reassigned');
  ELSIF NOT v_rung.assigned_staff_only THEN
    UPDATE
      public.resident_observation_tasks
    SET
      status = 'critically_overdue',
      escalated_at = COALESCE(escalated_at, p_at)
    WHERE
      id = p_task_id
      AND status IN ('upcoming', 'due_soon', 'due_now', 'overdue');
  END IF;

  -- The terminal rung is the one an owner should see without opening the
  -- module. Earlier rungs stay inside the rounding surface.
  --
  -- source_module is 'compliance'. The retired engine wrote 'resident_assurance',
  -- which is not a value of exec_alert_source_module and never has been, so
  -- every exec alert it tried to raise failed. That was the second piece of
  -- drift in that function, alongside the two columns it wrote that do not
  -- exist.
  IF v_rung.is_terminal THEN
    SELECT
      f.name INTO v_facility_name
    FROM
      public.facilities f
    WHERE
      f.id = v_task.facility_id;

    INSERT INTO public.exec_alerts (organization_id, entity_id, facility_id, source_module, severity, title, body)
    SELECT
      v_task.organization_id,
      v_task.entity_id,
      v_task.facility_id,
      'compliance',
      'critical',
      format('%s: observation window at %s', v_rung.label, COALESCE(v_facility_name, 'this facility')),
      format('An observation window closed without a check and reached the last rung of the facility escalation policy. Open Smart Rounding for the resident and the window.')
    WHERE
      NOT EXISTS (
        SELECT
          1
        FROM
          public.exec_alerts existing
        WHERE
          existing.organization_id = v_task.organization_id
          AND existing.facility_id = v_task.facility_id
          AND existing.title = format('%s: observation window at %s', v_rung.label, COALESCE(v_facility_name, 'this facility'))
          AND existing.resolved_at IS NULL
          AND existing.deleted_at IS NULL);
  END IF;

  RETURN jsonb_build_object('fired', TRUE, 'rung_key', v_rung.rung_key, 'dispatch_id', v_dispatch_id, 'escalation_id', v_escalation_id, 'is_escalation', NOT v_rung.assigned_staff_only, 'channels', to_jsonb (v_rung.channels), 'shift_key', v_shift, 'deliveries_queued', v_queued, 'recipients', v_recipients);
END;
$func$;

COMMENT ON FUNCTION public.record_observation_escalation_rung (uuid, text, timestamptz) IS
  'Fires one escalation rung against one task, once. Writes the dispatch ledger row, the resident_observation_escalations row when the rung is a real escalation rather than a staff nudge, and one delivery row per recipient per channel. Returns fired false with a reason when the rung already fired, which is what makes a re-tick of the engine a no-op.';

REVOKE ALL ON FUNCTION public.record_observation_escalation_rung (uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_observation_escalation_rung (uuid, text, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- A task whose window has closed with no check is overdue. No threshold: the
-- window close is the threshold, and it comes from configuration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_observation_task_lapse (p_organization_id uuid, p_facility_id uuid DEFAULT NULL, p_at timestamptz DEFAULT now())
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_rows integer;
BEGIN
  UPDATE
    public.resident_observation_tasks t
  SET
    status = 'overdue'
  WHERE
    t.organization_id = p_organization_id
    AND (p_facility_id IS NULL
      OR t.facility_id = p_facility_id)
    AND t.deleted_at IS NULL
    AND t.status IN ('upcoming', 'due_soon', 'due_now')
    AND public.observation_task_window_close (t.id) < p_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$func$;

COMMENT ON FUNCTION public.advance_observation_task_lapse (uuid, uuid, timestamptz) IS
  'Marks tasks overdue once their window has closed, using public.observation_task_window_close rather than a threshold. Carries no minute value of its own.';

REVOKE ALL ON FUNCTION public.advance_observation_task_lapse (uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_observation_task_lapse (uuid, uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- Test send. Spec 6.9 and acceptance item 20.
--
-- Delivers through the real routing to the real current recipients, over the
-- rung's real channels for the shift that is running right now, with TEST as
-- the first word of the body. It creates no resident_observation_escalations
-- row, writes no dispatch row and touches no task, so an administrator can
-- prove the ladder reaches somebody without putting a fictional miss into the
-- record.
--
-- An assigned staff only rung has no task and therefore no assigned staff
-- member, so the test resolves the caller's own staff row at that facility.
-- Testing the nudge sends the nudge to the person who asked for it, which is
-- the only honest answer when there is no task to be assigned to.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_test_escalation (p_facility_id uuid, p_rung_key text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_role text;
  v_org uuid;
  v_now CONSTANT timestamptz := now();
  v_shift text;
  v_rung record;
  v_facility_name text;
  v_caller_staff_id uuid;
  v_body text;
  v_channel text;
  v_rows integer;
  v_queued integer := 0;
  v_recipients integer := 0;
BEGIN
  v_role := haven.app_role ()::text;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'org_admin', 'facility_admin') THEN
    RAISE EXCEPTION 'A test escalation may only be sent by a facility administrator or above'
      USING ERRCODE = '42501';
  END IF;

  IF NOT haven.has_facility_access (p_facility_id) THEN
    RAISE EXCEPTION 'No access to this facility'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    f.organization_id,
    f.name INTO v_org,
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

  SELECT
    sw.shift_key INTO v_shift
  FROM
    public.facility_shift_window_at (p_facility_id, v_now) sw;

  SELECT
    r.* INTO v_rung
  FROM
    public.observation_escalation_rungs_at (p_facility_id, v_now, v_shift) r
  WHERE
    r.rung_key = p_rung_key;

  IF v_rung.rung_key IS NULL THEN
    RAISE EXCEPTION 'No enabled escalation rung named % is in force at this facility', p_rung_key
      USING ERRCODE = '22023';
  END IF;

  SELECT
    s.id INTO v_caller_staff_id
  FROM
    public.staff s
  WHERE
    s.user_id = auth.uid ()
    AND s.facility_id = p_facility_id
    AND s.deleted_at IS NULL
    AND s.employment_status = 'active'
  LIMIT 1;

  v_body := format('TEST only, no action needed. This is a test of the %s step of the escalation policy at %s on the %s shift. Nothing happened to a resident and no escalation was recorded.', v_rung.label, COALESCE(v_facility_name, 'this facility'), COALESCE(v_shift, 'current'));

  FOREACH v_channel IN ARRAY v_rung.channels LOOP
    INSERT INTO public.observation_escalation_deliveries (organization_id, facility_id, dispatch_id, notification_route_id, rung_key, target_role, target_user_id, target_phone, channel, status, is_test, message_body, send_after)
    SELECT
      v_org,
      p_facility_id,
      NULL,
      rec.notification_route_id,
      v_rung.rung_key,
      rec.target_role,
      rec.target_user_id,
      rec.target_phone,
      v_channel,
      'queued',
      TRUE,
      v_body,
      v_now
    FROM
      haven.observation_escalation_recipients (v_org, p_facility_id, v_rung.rung_id, v_caller_staff_id) rec;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_queued := v_queued + v_rows;
    v_recipients := GREATEST(v_recipients, v_rows);
  END LOOP;

  IF v_queued = 0 THEN
    INSERT INTO public.observation_escalation_deliveries (organization_id, facility_id, dispatch_id, notification_route_id, rung_key, target_role, target_user_id, target_phone, channel, status, skip_reason, is_test, message_body, send_after)
      VALUES (v_org, p_facility_id, NULL, NULL, v_rung.rung_key, 'unresolved', NULL, NULL, v_rung.channels[1], 'skipped', 'no_target', TRUE, v_body, v_now);
  END IF;

  RETURN jsonb_build_object('rung_key', v_rung.rung_key, 'label', v_rung.label, 'shift_key', v_shift, 'channels', to_jsonb (v_rung.channels), 'shift_override_applied', v_rung.shift_override_applied, 'recipients', v_recipients, 'deliveries_queued', v_queued, 'body', v_body, 'escalation_recorded', FALSE);
END;
$func$;

COMMENT ON FUNCTION public.send_test_escalation (uuid, text) IS
  'Sends a test of one escalation rung through the real routing to the real current recipients, over the rung''s real channels for the shift running now, with TEST as the first word of the body. Creates no resident_observation_escalations row, no dispatch row and touches no task. COL-37 ruling: definer required -- public.observation_escalation_deliveries carries a SELECT policy and deliberately no INSERT policy, because the only writers are the engine and this command, so an invoker insert would be refused by row-level security. Resolving the real recipients also reads public.staff and public.notification_routes across the facility, which a facility administrator does not otherwise hold a row on. The body checks haven.app_role() against owner, org_admin and facility_admin and haven.has_facility_access() before it writes anything, and it can write nothing but a test delivery row.';

REVOKE ALL ON FUNCTION public.send_test_escalation (uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_test_escalation (uuid, text) TO authenticated, service_role;

NOTIFY pgrst,
'reload schema';

COMMIT;
