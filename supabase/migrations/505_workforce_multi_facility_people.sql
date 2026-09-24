-- Allow workforce managers to see one employee through any current facility assignment they can access.
-- This preserves the employee's home facility while making the organization roster complete.
BEGIN;

CREATE FUNCTION haven.workforce_staff_assignment_scope(p_org uuid, p_staff uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_org = haven.organization_id()
    AND EXISTS (
      SELECT 1
      FROM public.staff_facility_assignments AS assignment
      JOIN public.facilities AS facility
        ON facility.id = assignment.facility_id
       AND facility.organization_id = assignment.organization_id
       AND facility.deleted_at IS NULL
      WHERE assignment.organization_id = p_org
        AND assignment.staff_id = p_staff
        AND assignment.facility_id IN (SELECT haven.accessible_facility_ids())
        AND assignment.deleted_at IS NULL
        AND assignment.start_date <= CURRENT_DATE
        AND (assignment.end_date IS NULL OR assignment.end_date >= CURRENT_DATE)
    );
$$;
REVOKE ALL ON FUNCTION haven.workforce_staff_assignment_scope(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.workforce_staff_assignment_scope(uuid, uuid) TO authenticated;

CREATE POLICY workforce_read_staff_current_facility_assignments
ON public.staff
FOR SELECT
TO authenticated
USING (
  organization_id = (SELECT haven.organization_id())
  AND deleted_at IS NULL
  AND (SELECT haven.app_role())::text IN ('owner', 'org_admin', 'facility_admin', 'manager')
  AND haven.workforce_staff_assignment_scope(staff.organization_id, staff.id)
);

COMMIT;
