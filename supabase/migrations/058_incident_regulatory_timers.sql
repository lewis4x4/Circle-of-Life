-- Phase 3.5-C: incident-regulatory-timers (Module 07)

ALTER TABLE incidents
  ADD COLUMN regulatory_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE regulatory_reporting_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  incident_id uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  jurisdiction text NOT NULL DEFAULT 'FL_AHCA',
  authority text,
  due_at timestamptz NOT NULL,
  submitted_at timestamptz,
  authority_case_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_reg_obligations_incident ON regulatory_reporting_obligations (incident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_reg_obligations_due ON regulatory_reporting_obligations (facility_id, due_at)
WHERE
  deleted_at IS NULL
  AND submitted_at IS NULL;

CREATE TABLE notification_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid REFERENCES facilities (id),
  name text NOT NULL,
  severity_min incident_severity NOT NULL DEFAULT 'level_4',
  channels text[] NOT NULL DEFAULT '{}',
  staff_role_targets staff_role[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE TABLE on_call_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  staff_id uuid NOT NULL REFERENCES staff (id),
  shift_date date NOT NULL,
  shift_type shift_type NOT NULL,
  is_primary boolean NOT NULL DEFAULT true,
  phone_override text,
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_on_call_facility_date ON on_call_schedules (facility_id, shift_date)
WHERE
  deleted_at IS NULL;

CREATE TABLE incident_root_cause_taxonomy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

INSERT INTO incident_root_cause_taxonomy (code, label, sort_order)
VALUES
  ('environment', 'Environment / equipment', 10),
  ('staffing', 'Staffing / workload', 20),
  ('communication', 'Communication', 30),
  ('clinical', 'Clinical judgment', 40),
  ('other', 'Other', 99);

ALTER TABLE incident_root_cause_taxonomy ENABLE ROW LEVEL SECURITY;

CREATE POLICY incident_root_cause_taxonomy_read ON incident_root_cause_taxonomy
  FOR SELECT
  USING (TRUE);

CREATE TABLE incident_root_causes (
  incident_id uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  root_cause_id uuid NOT NULL REFERENCES incident_root_cause_taxonomy (id),
  PRIMARY KEY (incident_id, root_cause_id)
);

ALTER TABLE regulatory_reporting_obligations ENABLE ROW LEVEL SECURITY;

CREATE POLICY reg_obligations_clinical ON regulatory_reporting_obligations
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ());

ALTER TABLE notification_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_routes_admin ON notification_routes
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

ALTER TABLE on_call_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY on_call_schedules_admin ON on_call_schedules
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ());

ALTER TABLE incident_root_causes ENABLE ROW LEVEL SECURITY;

CREATE POLICY incident_root_causes_read ON incident_root_causes
  FOR SELECT
  USING (
    EXISTS (
      SELECT
        1
      FROM
        incidents i
      WHERE
        i.id = incident_root_causes.incident_id
        AND i.organization_id = haven.organization_id ()
        AND i.deleted_at IS NULL));

CREATE POLICY incident_root_causes_write ON incident_root_causes
  FOR ALL
  USING (
    EXISTS (
      SELECT
        1
      FROM
        incidents i
      WHERE
        i.id = incident_root_causes.incident_id
        AND i.organization_id = haven.organization_id ()
        AND i.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND i.deleted_at IS NULL))
  WITH CHECK (
    EXISTS (
      SELECT
        1
      FROM
        incidents i
      WHERE
        i.id = incident_root_causes.incident_id
        AND i.organization_id = haven.organization_id ()));

CREATE TRIGGER tr_reg_obligations_set_updated_at
  BEFORE UPDATE ON regulatory_reporting_obligations
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_reg_obligations_audit
  AFTER INSERT OR UPDATE OR DELETE ON regulatory_reporting_obligations
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_notification_routes_set_updated_at
  BEFORE UPDATE ON notification_routes
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();
