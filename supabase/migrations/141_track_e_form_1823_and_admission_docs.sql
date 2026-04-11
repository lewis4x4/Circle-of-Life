-- Track E — E6: Form 1823 entity + admission document checklist (18 types)

DO $$ BEGIN
  CREATE TYPE form_1823_status AS ENUM ('pending','received','expired','renewal_due');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE admission_document_type AS ENUM (
    'form_1823','facesheet_demographics','photo_identification','insurance_financial_cards',
    'admission_agreement','financial_agreement','resident_assessment','care_plan_acknowledgment',
    'medication_list','advance_directives','tuberculosis_screening','dietary_evaluation',
    'physician_orders','pet_addendum','privacy_practices_hipaa','resident_bill_of_rights',
    'acknowledgment_of_risk','catheter_care'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS form_1823_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  physician_name text,
  exam_date date,
  expiration_date date,
  status form_1823_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_form_1823_resident ON form_1823_records (resident_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS admission_document_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  admission_case_id uuid NOT NULL REFERENCES admission_cases (id) ON DELETE CASCADE,
  document_type admission_document_type NOT NULL,
  required boolean NOT NULL DEFAULT true,
  received_at timestamptz,
  waived_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admission_doc_checklist_unique ON admission_document_checklist_items (admission_case_id, document_type)
WHERE
  deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admission_doc_checklist_case ON admission_document_checklist_items (admission_case_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE form_1823_records IS 'Florida AHCA Form 1823 (Physician Report) as first-class record; not only a checklist row.';
COMMENT ON TABLE admission_document_checklist_items IS 'Per-admission-case document tracking; catheter_care conditional in app when resident has catheter.';

ALTER TABLE form_1823_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS form_1823_select ON form_1823_records;
CREATE POLICY form_1823_select ON form_1823_records
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP POLICY IF EXISTS form_1823_insert ON form_1823_records;
CREATE POLICY form_1823_insert ON form_1823_records
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

DROP POLICY IF EXISTS form_1823_update ON form_1823_records;
CREATE POLICY form_1823_update ON form_1823_records
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE admission_document_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admission_doc_checklist_select ON admission_document_checklist_items;
CREATE POLICY admission_doc_checklist_select ON admission_document_checklist_items
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP POLICY IF EXISTS admission_doc_checklist_insert ON admission_document_checklist_items;
CREATE POLICY admission_doc_checklist_insert ON admission_document_checklist_items
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP POLICY IF EXISTS admission_doc_checklist_update ON admission_document_checklist_items;
CREATE POLICY admission_doc_checklist_update ON admission_document_checklist_items
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP TRIGGER IF EXISTS tr_form_1823_set_updated_at ON form_1823_records;
CREATE TRIGGER tr_form_1823_set_updated_at
  BEFORE UPDATE ON form_1823_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_form_1823_audit ON form_1823_records;
CREATE TRIGGER tr_form_1823_audit
  AFTER INSERT OR UPDATE OR DELETE ON form_1823_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_admission_doc_checklist_set_updated_at ON admission_document_checklist_items;
CREATE TRIGGER tr_admission_doc_checklist_set_updated_at
  BEFORE UPDATE ON admission_document_checklist_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_admission_doc_checklist_audit ON admission_document_checklist_items;
CREATE TRIGGER tr_admission_doc_checklist_audit
  AFTER INSERT OR UPDATE OR DELETE ON admission_document_checklist_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
