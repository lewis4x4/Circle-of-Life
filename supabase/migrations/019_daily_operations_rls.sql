-- RLS for daily operations (spec 04; helpers = haven.*)

ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_daily_logs_in_accessible_facilities ON daily_logs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('family', 'broker'));

CREATE POLICY caregivers_plus_insert_daily_logs ON daily_logs
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY caregivers_update_daily_logs ON daily_logs
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (logged_by = auth.uid ()
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

ALTER TABLE adl_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_adl_logs ON adl_logs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('family', 'broker', 'dietary', 'maintenance_role'));

CREATE POLICY caregivers_plus_insert_adl_logs ON adl_logs
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY caregivers_plus_update_adl_logs ON adl_logs
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (logged_by = auth.uid ()
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

ALTER TABLE resident_medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_resident_medications ON resident_medications
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('dietary', 'maintenance_role'));

CREATE POLICY nurse_plus_manage_resident_medications ON resident_medications
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE emar_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_emar_records ON emar_records
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('dietary', 'maintenance_role', 'family'));

CREATE POLICY caregivers_plus_insert_emar_records ON emar_records
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY caregivers_update_emar_records ON emar_records
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (administered_by = auth.uid ()
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

ALTER TABLE behavioral_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinical_staff_see_behavioral_logs ON behavioral_logs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('dietary', 'maintenance_role', 'family'));

CREATE POLICY caregivers_plus_insert_behavioral_logs ON behavioral_logs
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY nurse_plus_update_behavioral_logs ON behavioral_logs
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE condition_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinical_staff_see_condition_changes ON condition_changes
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('dietary', 'maintenance_role'));

CREATE POLICY caregivers_plus_insert_condition_changes ON condition_changes
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY nurse_plus_update_condition_changes ON condition_changes
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE shift_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_shift_handoffs ON shift_handoffs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY staff_create_shift_handoffs ON shift_handoffs
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY staff_update_shift_handoffs ON shift_handoffs
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (outgoing_staff_id = auth.uid ()
      OR incoming_staff_id = auth.uid ()
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_activities ON activities
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY staff_manage_activities ON activities
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE activity_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_activity_sessions ON activity_sessions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY staff_manage_activity_sessions ON activity_sessions
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE activity_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_activity_attendance ON activity_attendance
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY staff_manage_activity_attendance ON activity_attendance
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));
