-- Time records: facility visibility for nurses + admin/nurse manual punches (spec 11).
-- Existing INSERT policy only allows self clock-in; supervisors could not add corrective entries.

CREATE POLICY nurse_see_facility_time_records ON time_records
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () = 'nurse');

CREATE POLICY admin_insert_time_records ON time_records
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')
    AND EXISTS (
      SELECT
        1
      FROM
        staff s
      WHERE
        s.id = staff_id
        AND s.organization_id = organization_id
        AND s.facility_id = facility_id
        AND s.deleted_at IS NULL));
