-- Phase 3.5-D: compliance-citation-keys (Module 08)

CREATE TABLE regulatory_rules (
  citation text PRIMARY KEY,
  title text NOT NULL,
  body_excerpt text,
  jurisdiction text NOT NULL DEFAULT 'FL',
  created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE regulatory_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY regulatory_rules_read ON regulatory_rules
  FOR SELECT
  USING (TRUE);

ALTER TABLE survey_deficiencies
  ADD COLUMN regulatory_rule_citation text REFERENCES regulatory_rules (citation);

CREATE INDEX idx_survey_deficiencies_reg_citation ON survey_deficiencies (regulatory_rule_citation)
WHERE
  deleted_at IS NULL
  AND regulatory_rule_citation IS NOT NULL;

ALTER TABLE policy_documents
  ADD COLUMN ai_generated boolean NOT NULL DEFAULT false;

ALTER TABLE policy_documents
  ADD COLUMN approved_by uuid REFERENCES auth.users (id);

ALTER TABLE policy_documents
  ADD COLUMN approved_at timestamptz;

UPDATE
  policy_documents
SET
  approved_at = COALESCE(published_at, created_at),
  approved_by = COALESCE(published_by, created_by)
WHERE
  status = 'published'
  AND approved_at IS NULL;

ALTER TABLE policy_documents
  ADD CONSTRAINT policy_documents_published_requires_approval CHECK (
    status <> 'published'
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));

CREATE TABLE compliance_survey_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  visit_date date NOT NULL,
  agency text NOT NULL DEFAULT 'AHCA',
  visit_type text NOT NULL DEFAULT 'routine',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE TABLE compliance_survey_visit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  survey_visit_id uuid NOT NULL REFERENCES compliance_survey_visits (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  body text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_compliance_survey_visits_facility ON compliance_survey_visits (facility_id, visit_date DESC)
WHERE
  deleted_at IS NULL;

ALTER TABLE compliance_survey_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY compliance_survey_visits_admin ON compliance_survey_visits
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ());

ALTER TABLE compliance_survey_visit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY compliance_survey_visit_notes_admin ON compliance_survey_visit_notes
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE TRIGGER tr_compliance_survey_visits_set_updated_at
  BEFORE UPDATE ON compliance_survey_visits
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_compliance_survey_visits_audit
  AFTER INSERT OR UPDATE OR DELETE ON compliance_survey_visits
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
