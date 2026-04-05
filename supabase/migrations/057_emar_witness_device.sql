-- Phase 3.5-C: emar-witness-device (Module 04)

CREATE TABLE emar_administration_witnesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  emar_record_id uuid NOT NULL REFERENCES emar_records (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  witness_staff_id uuid NOT NULL REFERENCES staff (id),
  witness_method text NOT NULL DEFAULT 'observed'
    CHECK (witness_method IN ('observed', 'double_sign', 'video', 'other')),
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_emar_witness_emar ON emar_administration_witnesses (emar_record_id)
WHERE
  deleted_at IS NULL;

ALTER TABLE emar_records
  ADD COLUMN device_id text;

ALTER TABLE emar_records
  ADD COLUMN app_version text;

ALTER TABLE adl_logs
  ADD COLUMN duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0);

ALTER TABLE adl_logs
  ADD COLUMN assisting_staff_ids uuid[];

ALTER TABLE emar_administration_witnesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY emar_witness_clinical ON emar_administration_witnesses
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE TRIGGER tr_emar_witnesses_audit
  AFTER INSERT OR UPDATE OR DELETE ON emar_administration_witnesses
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
