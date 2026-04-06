-- Phase 5: Quality Metrics — RLS + audit + updated_at

ALTER TABLE quality_measures ENABLE ROW LEVEL SECURITY;

CREATE POLICY quality_measures_select ON quality_measures
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

CREATE POLICY quality_measures_insert ON quality_measures
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY quality_measures_update ON quality_measures
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

ALTER TABLE quality_measure_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY quality_measure_results_select ON quality_measure_results
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY quality_measure_results_insert ON quality_measure_results
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY quality_measure_results_update ON quality_measure_results
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

ALTER TABLE pbj_export_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY pbj_export_batches_select ON pbj_export_batches
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY pbj_export_batches_insert ON pbj_export_batches
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY pbj_export_batches_update ON pbj_export_batches
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

CREATE TRIGGER tr_quality_measures_set_updated_at
  BEFORE UPDATE ON quality_measures
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_quality_measures_audit
  AFTER INSERT OR UPDATE OR DELETE ON quality_measures
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_quality_measure_results_set_updated_at
  BEFORE UPDATE ON quality_measure_results
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_quality_measure_results_audit
  AFTER INSERT OR UPDATE OR DELETE ON quality_measure_results
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_pbj_export_batches_set_updated_at
  BEFORE UPDATE ON pbj_export_batches
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_pbj_export_batches_audit
  AFTER INSERT OR UPDATE OR DELETE ON pbj_export_batches
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

GRANT SELECT ON quality_latest_facility_measures TO authenticated;

GRANT SELECT ON quality_latest_facility_measures TO service_role;
