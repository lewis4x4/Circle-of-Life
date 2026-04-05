-- Phase 3.5-C: resident-advance-directives (Module 03)

CREATE TYPE polst_status AS ENUM (
  'none',
  'on_file',
  'verified',
  'revoked'
);

CREATE TABLE advance_directive_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  document_type text NOT NULL DEFAULT 'advance_directive',
  polst_status polst_status NOT NULL DEFAULT 'none',
  code_status text,
  physician_signature_date date,
  scanned_document_storage_path text,
  verified_by uuid REFERENCES auth.users (id),
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_advance_directives_resident ON advance_directive_documents (resident_id)
WHERE
  deleted_at IS NULL;

ALTER TABLE advance_directive_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY advance_directives_clinical ON advance_directive_documents
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()) );

CREATE TRIGGER tr_advance_directives_set_updated_at
  BEFORE UPDATE ON advance_directive_documents
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_advance_directives_audit
  AFTER INSERT OR UPDATE OR DELETE ON advance_directive_documents
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
