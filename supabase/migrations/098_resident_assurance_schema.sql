-- Resident Assurance Engine (Module 25) — core schema

CREATE TYPE resident_observation_plan_status AS ENUM (
  'draft',
  'active',
  'paused',
  'ended',
  'cancelled'
);

CREATE TYPE resident_observation_source_type AS ENUM (
  'care_plan',
  'manual',
  'policy',
  'order',
  'triggered'
);

CREATE TYPE resident_observation_interval_type AS ENUM (
  'continuous',
  'fixed_minutes',
  'per_shift',
  'daypart'
);

CREATE TYPE resident_observation_task_status AS ENUM (
  'upcoming',
  'due_soon',
  'due_now',
  'overdue',
  'critically_overdue',
  'missed',
  'completed_on_time',
  'completed_late',
  'excused',
  'reassigned',
  'escalated'
);

CREATE TYPE resident_observation_entry_mode AS ENUM (
  'live',
  'late',
  'offline_synced',
  'bulk'
);

CREATE TYPE resident_observation_quick_status AS ENUM (
  'awake',
  'asleep',
  'calm',
  'agitated',
  'confused',
  'distressed',
  'not_found',
  'refused'
);

CREATE TYPE resident_observation_exception_type AS ENUM (
  'resident_not_found',
  'resident_declined_interaction',
  'resident_appears_ill',
  'resident_appears_injured',
  'environmental_hazard_present',
  'family_concern_reported',
  'assignment_impossible',
  'other'
);

CREATE TYPE resident_observation_severity AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

CREATE TYPE resident_watch_status AS ENUM (
  'pending_approval',
  'active',
  'paused',
  'ended',
  'cancelled'
);

CREATE TYPE resident_observation_follow_up_status AS ENUM (
  'open',
  'in_progress',
  'resolved',
  'dismissed'
);

CREATE TYPE resident_observation_assignment_type AS ENUM (
  'primary',
  'reassignment',
  'rescue'
);

CREATE TABLE resident_observation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  status resident_observation_plan_status NOT NULL DEFAULT 'draft',
  source_type resident_observation_source_type NOT NULL DEFAULT 'manual',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  rationale text,
  created_by uuid REFERENCES auth.users (id),
  approved_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX idx_obs_plans_resident ON resident_observation_plans (resident_id, effective_from DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_obs_plans_facility_status ON resident_observation_plans (facility_id, status)
WHERE
  deleted_at IS NULL;

CREATE TABLE resident_observation_plan_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES resident_observation_plans (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  interval_type resident_observation_interval_type NOT NULL DEFAULT 'fixed_minutes',
  interval_minutes integer,
  shift shift_type,
  daypart_start time,
  daypart_end time,
  days_of_week integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  grace_minutes integer NOT NULL DEFAULT 15,
  required_fields_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  escalation_policy_key text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CHECK (interval_minutes IS NULL OR interval_minutes > 0),
  CHECK (grace_minutes >= 0)
);

CREATE INDEX idx_obs_rules_plan ON resident_observation_plan_rules (plan_id, sort_order)
WHERE
  deleted_at IS NULL;

CREATE TABLE resident_watch_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  name text NOT NULL,
  trigger_type text NOT NULL,
  duration_rule text,
  rule_definition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_required boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_obs_watch_protocols_facility ON resident_watch_protocols (facility_id, active)
WHERE
  deleted_at IS NULL;

CREATE TABLE resident_watch_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  protocol_id uuid REFERENCES resident_watch_protocols (id),
  triggered_by_type text NOT NULL,
  triggered_by_id uuid,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  status resident_watch_status NOT NULL DEFAULT 'pending_approval',
  approved_by uuid REFERENCES auth.users (id),
  ended_by uuid REFERENCES auth.users (id),
  end_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX idx_obs_watch_instances_resident ON resident_watch_instances (resident_id, starts_at DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE resident_observation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  plan_id uuid NOT NULL REFERENCES resident_observation_plans (id),
  plan_rule_id uuid REFERENCES resident_observation_plan_rules (id),
  watch_instance_id uuid REFERENCES resident_watch_instances (id),
  shift_assignment_id uuid REFERENCES shift_assignments (id),
  assigned_staff_id uuid REFERENCES staff (id),
  scheduled_for timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  grace_ends_at timestamptz NOT NULL,
  status resident_observation_task_status NOT NULL DEFAULT 'upcoming',
  completed_log_id uuid,
  reassigned_from_staff_id uuid REFERENCES staff (id),
  reassignment_reason text,
  excused_reason text,
  excused_by uuid REFERENCES auth.users (id),
  escalated_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CHECK (due_at >= scheduled_for),
  CHECK (grace_ends_at >= due_at)
);

CREATE INDEX idx_obs_tasks_staff_due ON resident_observation_tasks (assigned_staff_id, due_at)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_obs_tasks_facility_status_due ON resident_observation_tasks (facility_id, status, due_at)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_obs_tasks_resident_due ON resident_observation_tasks (resident_id, due_at DESC)
WHERE
  deleted_at IS NULL;

CREATE UNIQUE INDEX idx_obs_tasks_unique_occurrence ON resident_observation_tasks (resident_id, plan_rule_id, due_at)
WHERE
  deleted_at IS NULL
  AND plan_rule_id IS NOT NULL;

CREATE TABLE resident_observation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  task_id uuid NOT NULL REFERENCES resident_observation_tasks (id),
  assigned_staff_id uuid REFERENCES staff (id),
  staff_id uuid NOT NULL REFERENCES staff (id),
  observed_at timestamptz NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  entry_mode resident_observation_entry_mode NOT NULL DEFAULT 'live',
  quick_status resident_observation_quick_status NOT NULL,
  resident_location text,
  resident_position text,
  resident_state text,
  distress_present boolean NOT NULL DEFAULT false,
  breathing_concern boolean NOT NULL DEFAULT false,
  pain_concern boolean NOT NULL DEFAULT false,
  toileting_assisted boolean NOT NULL DEFAULT false,
  hydration_offered boolean NOT NULL DEFAULT false,
  repositioned boolean NOT NULL DEFAULT false,
  skin_concern_observed boolean NOT NULL DEFAULT false,
  fall_hazard_observed boolean NOT NULL DEFAULT false,
  refused_assistance boolean NOT NULL DEFAULT false,
  intervention_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  exception_present boolean NOT NULL DEFAULT false,
  note text,
  late_reason text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CHECK (entered_at >= observed_at OR entry_mode IN ('bulk', 'offline_synced'))
);

CREATE INDEX idx_obs_logs_task ON resident_observation_logs (task_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_obs_logs_resident_entered ON resident_observation_logs (resident_id, entered_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_obs_logs_staff_entered ON resident_observation_logs (staff_id, entered_at DESC)
WHERE
  deleted_at IS NULL;

ALTER TABLE resident_observation_tasks
  ADD CONSTRAINT resident_observation_tasks_completed_log_id_fkey
  FOREIGN KEY (completed_log_id) REFERENCES resident_observation_logs (id);

CREATE TABLE resident_observation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  log_id uuid NOT NULL REFERENCES resident_observation_logs (id),
  exception_type resident_observation_exception_type NOT NULL,
  severity resident_observation_severity NOT NULL DEFAULT 'medium',
  requires_follow_up boolean NOT NULL DEFAULT true,
  follow_up_status resident_observation_follow_up_status NOT NULL DEFAULT 'open',
  linked_incident_id uuid REFERENCES incidents (id),
  assigned_to_staff_id uuid REFERENCES staff (id),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users (id),
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_obs_exceptions_follow_up ON resident_observation_exceptions (facility_id, follow_up_status, severity)
WHERE
  deleted_at IS NULL;

CREATE TABLE resident_observation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  task_id uuid NOT NULL REFERENCES resident_observation_tasks (id) ON DELETE CASCADE,
  shift_assignment_id uuid REFERENCES shift_assignments (id),
  staff_id uuid NOT NULL REFERENCES staff (id),
  assignment_type resident_observation_assignment_type NOT NULL DEFAULT 'primary',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  reason text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (released_at IS NULL OR released_at >= assigned_at)
);

CREATE INDEX idx_obs_assignments_task ON resident_observation_assignments (task_id, assigned_at DESC);

CREATE TABLE resident_observation_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  task_id uuid NOT NULL REFERENCES resident_observation_tasks (id),
  escalation_level integer NOT NULL DEFAULT 1,
  escalation_type text NOT NULL,
  escalated_to_staff_id uuid REFERENCES staff (id),
  status resident_observation_follow_up_status NOT NULL DEFAULT 'open',
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution_note text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CHECK (escalation_level > 0)
);

CREATE INDEX idx_obs_escalations_status ON resident_observation_escalations (facility_id, status, triggered_at DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE resident_observation_integrity_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid REFERENCES residents (id),
  log_id uuid REFERENCES resident_observation_logs (id),
  staff_id uuid REFERENCES staff (id),
  flag_type text NOT NULL,
  severity resident_observation_severity NOT NULL DEFAULT 'medium',
  detected_at timestamptz NOT NULL DEFAULT now(),
  status resident_observation_follow_up_status NOT NULL DEFAULT 'open',
  reviewed_by uuid REFERENCES auth.users (id),
  disposition_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_obs_integrity_flags_status ON resident_observation_integrity_flags (facility_id, status, detected_at DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE resident_observation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid REFERENCES facilities (id),
  name text NOT NULL,
  description text,
  category text NOT NULL,
  preset_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_obs_templates_name ON resident_observation_templates (organization_id, facility_id, name)
WHERE
  deleted_at IS NULL;

CREATE TABLE resident_watch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  watch_instance_id uuid NOT NULL REFERENCES resident_watch_instances (id) ON DELETE CASCADE,
  task_id uuid REFERENCES resident_observation_tasks (id),
  log_id uuid REFERENCES resident_observation_logs (id),
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  note text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_obs_watch_events_instance ON resident_watch_events (watch_instance_id, occurred_at DESC);
