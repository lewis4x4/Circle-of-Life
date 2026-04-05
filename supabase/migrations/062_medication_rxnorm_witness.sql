-- Phase 3.5-D: medication-rxnorm-witness (Module 06)

CREATE TABLE medication_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  rxcui text NOT NULL UNIQUE,
  ndc text,
  display_name text NOT NULL,
  tty text,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX idx_medication_reference_ndc ON medication_reference (ndc)
WHERE
  ndc IS NOT NULL;

ALTER TABLE resident_medications
  ADD COLUMN medication_reference_id uuid REFERENCES medication_reference (id);

CREATE INDEX idx_resident_meds_ref ON resident_medications (medication_reference_id)
WHERE
  medication_reference_id IS NOT NULL;

ALTER TABLE medication_reference ENABLE ROW LEVEL SECURITY;

CREATE POLICY medication_reference_read ON medication_reference
  FOR SELECT
  USING (TRUE);

CREATE TABLE controlled_substance_count_variance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  controlled_substance_count_id uuid NOT NULL REFERENCES controlled_substance_counts (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  witness_staff_id uuid REFERENCES staff (id),
  supervisor_notified_at timestamptz,
  variance_amount integer NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_csc_variance_count ON controlled_substance_count_variance_events (controlled_substance_count_id)
WHERE
  deleted_at IS NULL;

ALTER TABLE controlled_substance_count_variance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY csc_variance_clinical ON controlled_substance_count_variance_events
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE TRIGGER tr_csc_variance_audit
  AFTER INSERT OR UPDATE OR DELETE ON controlled_substance_count_variance_events
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
