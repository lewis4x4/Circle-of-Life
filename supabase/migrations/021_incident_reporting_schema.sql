-- Incident and risk management schema (spec 07)

CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  incident_number text NOT NULL,
  category incident_category NOT NULL,
  severity incident_severity NOT NULL,
  status incident_status NOT NULL DEFAULT 'open',
  occurred_at timestamptz NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  shift shift_type NOT NULL,
  location_description text NOT NULL,
  location_type text,
  unit_id uuid REFERENCES units (id),
  room_id uuid REFERENCES rooms (id),
  description text NOT NULL,
  immediate_actions text NOT NULL,
  contributing_factors text[],
  fall_witnessed boolean,
  fall_type text,
  fall_activity text,
  fall_assistive_device_used boolean,
  fall_footwear text,
  fall_bed_rails text,
  fall_call_light_accessible boolean,
  injury_occurred boolean NOT NULL DEFAULT false,
  injury_description text,
  injury_severity text,
  injury_body_location text,
  injury_treatment text,
  elopement_last_seen_at timestamptz,
  elopement_last_seen_location text,
  elopement_found_at timestamptz,
  elopement_found_location text,
  elopement_law_enforcement_called boolean,
  elopement_law_enforcement_called_at timestamptz,
  elopement_outcome text,
  reported_by uuid NOT NULL REFERENCES auth.users (id),
  witness_names text[],
  witness_statements text[],
  nurse_notified boolean NOT NULL DEFAULT false,
  nurse_notified_at timestamptz,
  nurse_notified_by uuid REFERENCES auth.users (id),
  administrator_notified boolean NOT NULL DEFAULT false,
  administrator_notified_at timestamptz,
  owner_notified boolean NOT NULL DEFAULT false,
  owner_notified_at timestamptz,
  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,
  physician_orders_received text,
  family_notified boolean NOT NULL DEFAULT false,
  family_notified_at timestamptz,
  family_notified_by uuid REFERENCES auth.users (id),
  family_notified_method text,
  ahca_reportable boolean NOT NULL DEFAULT false,
  ahca_reported boolean NOT NULL DEFAULT false,
  ahca_reported_at timestamptz,
  insurance_reportable boolean NOT NULL DEFAULT false,
  insurance_reported boolean NOT NULL DEFAULT false,
  insurance_reported_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users (id),
  resolution_notes text,
  care_plan_updated boolean NOT NULL DEFAULT false,
  care_plan_update_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_incidents_resident ON incidents (resident_id, occurred_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_incidents_facility ON incidents (facility_id, occurred_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_incidents_org ON incidents (organization_id, occurred_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_incidents_category ON incidents (facility_id, category, occurred_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_incidents_severity ON incidents (facility_id, severity)
WHERE
  deleted_at IS NULL
  AND status != 'closed';

CREATE INDEX idx_incidents_status ON incidents (facility_id, status)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_incidents_number ON incidents (incident_number)
WHERE
  deleted_at IS NULL;

CREATE UNIQUE INDEX idx_incidents_number_unique ON incidents (incident_number);

CREATE TABLE incident_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents (id),
  resident_id uuid REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  task_type text NOT NULL,
  description text NOT NULL,
  due_at timestamptz NOT NULL,
  assigned_to uuid REFERENCES auth.users (id),
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users (id),
  completion_notes text,
  overdue_alert_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_followups_incident ON incident_followups (incident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_followups_assigned ON incident_followups (assigned_to)
WHERE
  deleted_at IS NULL
  AND completed_at IS NULL;

CREATE INDEX idx_followups_overdue ON incident_followups (due_at)
WHERE
  deleted_at IS NULL
  AND completed_at IS NULL;

CREATE TABLE incident_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  storage_path text NOT NULL,
  description text,
  taken_at timestamptz NOT NULL DEFAULT now(),
  taken_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_incident_photos ON incident_photos (incident_id);

CREATE TABLE incident_sequences (
  facility_id uuid NOT NULL REFERENCES facilities (id),
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (facility_id, year)
);
