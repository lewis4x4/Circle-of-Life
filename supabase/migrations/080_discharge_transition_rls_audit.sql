-- Phase 4: Discharge and Transition — RLS + audit + updated_at

ALTER TABLE discharge_med_reconciliation ENABLE ROW LEVEL SECURITY;

CREATE POLICY discharge_med_reconciliation_select ON discharge_med_reconciliation
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY discharge_med_reconciliation_insert ON discharge_med_reconciliation
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY discharge_med_reconciliation_update ON discharge_med_reconciliation
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

CREATE TRIGGER tr_discharge_med_reconciliation_set_updated_at
  BEFORE UPDATE ON discharge_med_reconciliation
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_discharge_med_reconciliation_audit
  AFTER INSERT OR UPDATE OR DELETE ON discharge_med_reconciliation
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
