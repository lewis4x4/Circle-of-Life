-- Module 15 (spec 15-transportation): resident transport scheduling — Core table missing from initial 090 slice

CREATE TYPE transport_type AS ENUM (
  'facility_vehicle',
  'staff_personal_vehicle',
  'third_party'
);

CREATE TYPE transport_request_status AS ENUM (
  'requested',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled'
);

CREATE TABLE resident_transport_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  requested_by uuid NOT NULL REFERENCES user_profiles (id),
  transport_type transport_type NOT NULL DEFAULT 'facility_vehicle',
  appointment_date date NOT NULL,
  appointment_time time,
  destination_name text NOT NULL,
  destination_address text,
  purpose text NOT NULL,
  wheelchair_required boolean NOT NULL DEFAULT false,
  escort_required boolean NOT NULL DEFAULT false,
  escort_staff_id uuid REFERENCES staff (id),
  vehicle_id uuid REFERENCES fleet_vehicles (id),
  driver_staff_id uuid REFERENCES staff (id),
  pickup_time time,
  return_time time,
  status transport_request_status NOT NULL DEFAULT 'requested',
  cancellation_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_resident_transport_requests_facility ON resident_transport_requests (facility_id, appointment_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_resident_transport_requests_resident ON resident_transport_requests (resident_id, appointment_date DESC)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE resident_transport_requests IS 'Resident appointment transport requests; RLS spec 15.';

ALTER TABLE resident_transport_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_transport_requests_select ON resident_transport_requests
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

CREATE POLICY resident_transport_requests_write ON resident_transport_requests
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE TRIGGER tr_resident_transport_requests_set_updated_at
  BEFORE UPDATE ON resident_transport_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_transport_requests_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_transport_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
