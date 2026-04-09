-- Module 15 (spec 15-transportation): mileage reimbursement + wheelchair flag for fleet (Enhanced linkage)

ALTER TABLE fleet_vehicles
ADD COLUMN IF NOT EXISTS wheelchair_accessible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fleet_vehicles.wheelchair_accessible IS 'When true, vehicle can serve wheelchair_required transport requests (spec 15 business rule 5).';

CREATE TABLE mileage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  staff_id uuid NOT NULL REFERENCES staff (id),
  trip_date date NOT NULL,
  purpose text NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  round_trip boolean NOT NULL DEFAULT false,
  miles numeric(7, 1) NOT NULL,
  reimbursement_rate_cents integer NOT NULL,
  reimbursement_amount_cents integer NOT NULL,
  resident_id uuid REFERENCES residents (id),
  transport_request_id uuid REFERENCES resident_transport_requests (id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users (id),
  approved_at timestamptz,
  payroll_export_id uuid,
  notes text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CONSTRAINT mileage_logs_miles_nonnegative CHECK (miles >= 0::numeric),
  CONSTRAINT mileage_logs_reimbursement_nonnegative CHECK (reimbursement_amount_cents >= 0)
);

CREATE INDEX idx_mileage_logs_staff ON mileage_logs (staff_id, trip_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_mileage_logs_facility ON mileage_logs (facility_id, trip_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_mileage_logs_transport_request ON mileage_logs (transport_request_id)
WHERE
  deleted_at IS NULL
  AND transport_request_id IS NOT NULL;

CREATE INDEX idx_mileage_logs_unprocessed ON mileage_logs (facility_id)
WHERE
  payroll_export_id IS NULL
  AND approved_at IS NOT NULL
  AND deleted_at IS NULL;

COMMENT ON TABLE mileage_logs IS 'Staff mileage reimbursement; optional link to resident_transport_requests; RLS spec 15.';

ALTER TABLE mileage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY mileage_logs_select ON mileage_logs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (
      haven.app_role () IN (
        'owner',
        'org_admin',
        'facility_admin',
        'nurse',
        'caregiver',
        'dietary',
        'maintenance_role')
      OR EXISTS (
        SELECT
          1
        FROM
          staff s
        WHERE
          s.id = mileage_logs.staff_id
          AND s.user_id = auth.uid ()
      )
    )
  );

CREATE POLICY mileage_logs_write ON mileage_logs
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

CREATE TRIGGER tr_mileage_logs_set_updated_at
  BEFORE UPDATE ON mileage_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_mileage_logs_audit
  AFTER INSERT OR UPDATE OR DELETE ON mileage_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
