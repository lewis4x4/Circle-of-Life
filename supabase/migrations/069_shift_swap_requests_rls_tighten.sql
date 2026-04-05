-- Phase 1 acceptance audit R-3 (docs/PHASE1-ACCEPTANCE-REPORT.md):
-- Remove facility-wide SELECT on all rows with status = 'pending' for non-privileged staff.
-- Staff now see swap requests only when they are requesting/covering, or when role is
-- owner / org_admin / facility_admin / nurse (scheduling oversight).

DROP POLICY IF EXISTS staff_see_shift_swap_requests ON shift_swap_requests;

CREATE POLICY staff_see_shift_swap_requests ON shift_swap_requests
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (requesting_staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL)
      OR covering_staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL)
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')));
