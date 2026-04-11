-- Track E — E3: ADL / LOC assessments (Module 02 handoff engine)

CREATE TYPE loc_tier AS ENUM (
  'none',
  'l1',
  'l2',
  'l3'
);

CREATE TABLE adl_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  score_bathing integer NOT NULL CHECK (
    score_bathing >= 0
    AND score_bathing <= 5
  ),
  score_dressing integer NOT NULL CHECK (
    score_dressing >= 0
    AND score_dressing <= 5
  ),
  score_toileting integer NOT NULL CHECK (
    score_toileting >= 0
    AND score_toileting <= 5
  ),
  score_transferring integer NOT NULL CHECK (
    score_transferring >= 0
    AND score_transferring <= 5
  ),
  score_continence integer NOT NULL CHECK (
    score_continence >= 0
    AND score_continence <= 5
  ),
  score_feeding integer NOT NULL CHECK (
    score_feeding >= 0
    AND score_feeding <= 5
  ),
  score_ambulation integer NOT NULL CHECK (
    score_ambulation >= 0
    AND score_ambulation <= 5
  ),
  score_grooming integer NOT NULL CHECK (
    score_grooming >= 0
    AND score_grooming <= 5
  ),
  total_score integer NOT NULL,
  loc_tier loc_tier NOT NULL,
  wander_guard boolean NOT NULL DEFAULT false,
  calculated_fee_cents integer NOT NULL DEFAULT 0 CHECK (calculated_fee_cents >= 0),
  assessed_by uuid REFERENCES auth.users (id),
  assessed_at timestamptz NOT NULL DEFAULT now (),
  next_reassessment_date date,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_adl_assessments_resident ON adl_assessments (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_adl_assessments_facility ON adl_assessments (facility_id, assessed_at DESC)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE adl_assessments IS 'ADL scoring + LOC tier + fee snapshot for admissions / recurring review (HAVEN handoff).';

ALTER TABLE adl_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY adl_assessments_select ON adl_assessments
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY adl_assessments_insert ON adl_assessments
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY adl_assessments_update ON adl_assessments
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE TRIGGER tr_adl_assessments_set_updated_at
  BEFORE UPDATE ON adl_assessments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_adl_assessments_audit
  AFTER INSERT OR UPDATE OR DELETE ON adl_assessments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
