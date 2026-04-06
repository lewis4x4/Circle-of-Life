-- Phase 4: Admissions and Move-In — RLS + audit + updated_at on admission_cases

ALTER TABLE admission_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY admission_cases_select ON admission_cases
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY admission_cases_insert ON admission_cases
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY admission_cases_update ON admission_cases
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

ALTER TABLE admission_case_rate_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY admission_case_rate_terms_select ON admission_case_rate_terms
  FOR SELECT
  USING (
    EXISTS (
      SELECT
        1
      FROM
        admission_cases ac
      WHERE
        ac.id = admission_case_rate_terms.admission_case_id
        AND ac.organization_id = haven.organization_id ()
        AND ac.deleted_at IS NULL
        AND ac.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())));

CREATE POLICY admission_case_rate_terms_insert ON admission_case_rate_terms
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT
        1
      FROM
        admission_cases ac
      WHERE
        ac.id = admission_case_rate_terms.admission_case_id
        AND ac.organization_id = haven.organization_id ()
        AND ac.facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY admission_case_rate_terms_update ON admission_case_rate_terms
  FOR UPDATE
  USING (
    EXISTS (
      SELECT
        1
      FROM
        admission_cases ac
      WHERE
        ac.id = admission_case_rate_terms.admission_case_id
        AND ac.organization_id = haven.organization_id ()
        AND ac.deleted_at IS NULL
        AND ac.facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'))
  WITH CHECK (
    EXISTS (
      SELECT
        1
      FROM
        admission_cases ac
      WHERE
        ac.id = admission_case_rate_terms.admission_case_id
        AND ac.organization_id = haven.organization_id ()
        AND ac.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())));

CREATE POLICY admission_case_rate_terms_delete ON admission_case_rate_terms
  FOR DELETE
  USING (
    EXISTS (
      SELECT
        1
      FROM
        admission_cases ac
      WHERE
        ac.id = admission_case_rate_terms.admission_case_id
        AND ac.organization_id = haven.organization_id ()
        AND ac.deleted_at IS NULL
        AND ac.facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE TRIGGER tr_admission_cases_set_updated_at
  BEFORE UPDATE ON admission_cases
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_admission_cases_audit
  AFTER INSERT OR UPDATE OR DELETE ON admission_cases
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_admission_case_rate_terms_audit
  AFTER INSERT OR UPDATE OR DELETE ON admission_case_rate_terms
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
