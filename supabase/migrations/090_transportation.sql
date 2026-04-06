-- Phase 6: Transportation (spec 15-transportation) — fleet, inspections, driver credentials

CREATE TYPE fleet_vehicle_status AS ENUM (
  'active',
  'out_of_service',
  'retired'
);

CREATE TYPE vehicle_inspection_result AS ENUM (
  'pass',
  'fail',
  'conditional'
);

CREATE TYPE driver_credential_status AS ENUM (
  'active',
  'suspended',
  'expired'
);

CREATE TABLE fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  name text NOT NULL,
  vin text,
  license_plate text,
  make text,
  model text,
  model_year integer,
  passenger_capacity integer CHECK (
    passenger_capacity IS NULL
    OR passenger_capacity >= 0),
  status fleet_vehicle_status NOT NULL DEFAULT 'active',
  insurance_expires_on date,
  registration_expires_on date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_fleet_vehicles_facility ON fleet_vehicles (facility_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE vehicle_inspection_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  fleet_vehicle_id uuid NOT NULL REFERENCES fleet_vehicles (id) ON DELETE CASCADE,
  inspected_at timestamptz NOT NULL DEFAULT now (),
  inspector_label text,
  odometer_miles integer,
  result vehicle_inspection_result NOT NULL DEFAULT 'pass',
  defects_notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_vehicle_inspection_logs_vehicle ON vehicle_inspection_logs (fleet_vehicle_id, inspected_at DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE driver_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  staff_id uuid NOT NULL REFERENCES staff (id),
  status driver_credential_status NOT NULL DEFAULT 'active',
  license_class text,
  license_number text,
  license_expires_on date,
  medical_card_expires_on date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_driver_credentials_staff_facility_active ON driver_credentials (staff_id, facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_driver_credentials_facility ON driver_credentials (facility_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE fleet_vehicles IS 'Facility fleet; RLS spec 15.';

COMMENT ON TABLE vehicle_inspection_logs IS 'Inspection history per vehicle; RLS spec 15.';

COMMENT ON TABLE driver_credentials IS 'Driver license/med card tracking; RLS spec 15.';

-- RLS helpers: transport roles
ALTER TABLE fleet_vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY fleet_vehicles_select ON fleet_vehicles
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN (
      'owner',
      'org_admin',
      'facility_admin',
      'nurse',
      'caregiver',
      'dietary',
      'maintenance_role'));

CREATE POLICY fleet_vehicles_write ON fleet_vehicles
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'maintenance_role'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE vehicle_inspection_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY vehicle_inspection_logs_select ON vehicle_inspection_logs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN (
      'owner',
      'org_admin',
      'facility_admin',
      'nurse',
      'caregiver',
      'dietary',
      'maintenance_role'));

CREATE POLICY vehicle_inspection_logs_write ON vehicle_inspection_logs
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'maintenance_role'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE driver_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY driver_credentials_select ON driver_credentials
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN (
      'owner',
      'org_admin',
      'facility_admin',
      'nurse',
      'caregiver',
      'dietary',
      'maintenance_role'));

CREATE POLICY driver_credentials_write ON driver_credentials
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'maintenance_role'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE TRIGGER tr_fleet_vehicles_set_updated_at
  BEFORE UPDATE ON fleet_vehicles
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_fleet_vehicles_audit
  AFTER INSERT OR UPDATE OR DELETE ON fleet_vehicles
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_vehicle_inspection_logs_set_updated_at
  BEFORE UPDATE ON vehicle_inspection_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_vehicle_inspection_logs_audit
  AFTER INSERT OR UPDATE OR DELETE ON vehicle_inspection_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_driver_credentials_set_updated_at
  BEFORE UPDATE ON driver_credentials
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_driver_credentials_audit
  AFTER INSERT OR UPDATE OR DELETE ON driver_credentials
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
