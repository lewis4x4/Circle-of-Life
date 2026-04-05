-- Phase 3.5-E: insurance-osha-allocation (Module 18)

ALTER TABLE workers_comp_claims
  ADD COLUMN osha_recordable boolean NOT NULL DEFAULT false;

ALTER TABLE workers_comp_claims
  ADD COLUMN osha_300_line_id text;

CREATE TYPE premium_allocation_method AS ENUM (
  'per_licensed_bed',
  'per_census_day',
  'pct_of_premium',
  'custom'
);

CREATE TABLE entity_insurance_allocation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  premium_allocation_method premium_allocation_method NOT NULL DEFAULT 'per_licensed_bed',
  allocation_basis_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz,
  CONSTRAINT entity_insurance_allocation_entity_unique UNIQUE (entity_id)
);

ALTER TABLE certificates_of_insurance
  ADD COLUMN endorsement_summary text;

ALTER TABLE certificates_of_insurance
  ADD COLUMN ai_extracted_json jsonb;

ALTER TABLE entity_insurance_allocation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY entity_insurance_allocation_settings_rw ON entity_insurance_allocation_settings
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE TRIGGER tr_entity_insurance_allocation_set_updated_at
  BEFORE UPDATE ON entity_insurance_allocation_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_entity_insurance_allocation_audit
  AFTER INSERT OR UPDATE OR DELETE ON entity_insurance_allocation_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
