-- Phase 6: Training & Competency — RLS + audit (spec 12-training-competency)

ALTER TABLE competency_demonstrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY competency_demonstrations_select_admins ON competency_demonstrations
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY competency_demonstrations_select_self ON competency_demonstrations
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        staff s
      WHERE
        s.id = competency_demonstrations.staff_id
        AND s.user_id = auth.uid ()
        AND s.deleted_at IS NULL));

CREATE POLICY competency_demonstrations_manage_admins ON competency_demonstrations
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE TRIGGER tr_competency_demonstrations_set_updated_at
  BEFORE UPDATE ON competency_demonstrations
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_competency_demonstrations_audit
  AFTER INSERT OR UPDATE OR DELETE ON competency_demonstrations
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
