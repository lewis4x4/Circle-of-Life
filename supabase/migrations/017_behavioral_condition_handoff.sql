-- Behavioral logs, condition changes, shift handoffs (spec 04-daily-operations)
-- linked_incident_id: incidents module not in Phase 1 — no FK

CREATE TABLE behavioral_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  daily_log_id uuid REFERENCES daily_logs (id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  shift shift_type NOT NULL,
  logged_by uuid NOT NULL REFERENCES auth.users (id),
  antecedent text,
  behavior text NOT NULL,
  behavior_type text NOT NULL,
  consequence text,
  intervention_used text[],
  intervention_effective boolean,
  duration_minutes integer,
  involved_residents uuid[],
  involved_staff uuid[],
  injury_occurred boolean NOT NULL DEFAULT false,
  injury_details text,
  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,
  family_notified boolean NOT NULL DEFAULT false,
  family_notified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_behavioral_resident ON behavioral_logs (resident_id, occurred_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_behavioral_facility ON behavioral_logs (facility_id, occurred_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_behavioral_type ON behavioral_logs (resident_id, behavior_type)
WHERE
  deleted_at IS NULL;

CREATE TABLE condition_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  reported_at timestamptz NOT NULL DEFAULT now(),
  reported_by uuid NOT NULL REFERENCES auth.users (id),
  shift shift_type NOT NULL,
  change_type text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'moderate',
  nurse_notified boolean NOT NULL DEFAULT false,
  nurse_notified_at timestamptz,
  nurse_notified_by uuid REFERENCES auth.users (id),
  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,
  physician_response text,
  family_notified boolean NOT NULL DEFAULT false,
  family_notified_at timestamptz,
  care_plan_review_triggered boolean NOT NULL DEFAULT false,
  linked_incident_id uuid,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_condition_changes_resident ON condition_changes (resident_id, reported_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_condition_changes_facility ON condition_changes (facility_id, reported_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_condition_changes_unresolved ON condition_changes (facility_id)
WHERE
  deleted_at IS NULL
  AND resolved_at IS NULL;

CREATE TABLE shift_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  unit_id uuid REFERENCES units (id),
  handoff_date date NOT NULL,
  outgoing_shift shift_type NOT NULL,
  incoming_shift shift_type NOT NULL,
  outgoing_staff_id uuid NOT NULL REFERENCES auth.users (id),
  incoming_staff_id uuid REFERENCES auth.users (id),
  auto_summary jsonb NOT NULL DEFAULT '{}',
  outgoing_notes text,
  incoming_acknowledged boolean NOT NULL DEFAULT false,
  incoming_acknowledged_at timestamptz,
  incoming_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_handoffs_facility_date ON shift_handoffs (facility_id, handoff_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_handoffs_outgoing ON shift_handoffs (outgoing_staff_id, handoff_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_handoffs_unacknowledged ON shift_handoffs (facility_id)
WHERE
  deleted_at IS NULL
  AND incoming_acknowledged = FALSE;
