-- Allow nurse/admin roles to record staffing ratio snapshots (spec 11).
-- Previously only SELECT existed; inserts failed under RLS for all roles.

CREATE POLICY admin_insert_staffing_ratio_snapshots ON staffing_ratio_snapshots
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
