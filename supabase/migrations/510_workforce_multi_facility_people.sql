-- Expose current secondary-facility roster identity without widening SELECT on
-- public.staff, which also contains pay rates, SSN last four and other HR data.
BEGIN;

CREATE FUNCTION public.workforce_assigned_roster(p_facility_ids uuid[])
RETURNS TABLE (
  staff_id uuid,
  facility_id uuid,
  first_name text,
  last_name text,
  staff_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor record;
  facility_today date;
BEGIN
  SELECT * INTO actor
  FROM haven.current_authorized_actor()
  WHERE actor_is_managed
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce roster unavailable' USING ERRCODE = '42501';
  END IF;
  IF actor.actor_user_id IS DISTINCT FROM auth.uid()
    OR actor.actor_role_text IS NULL
    OR actor.actor_role_text NOT IN ('owner', 'org_admin', 'facility_admin', 'manager') THEN
    RAISE EXCEPTION 'Workforce roster unavailable' USING ERRCODE = '42501';
  END IF;

  IF p_facility_ids IS NULL OR cardinality(p_facility_ids) NOT BETWEEN 1 AND 100
    OR EXISTS (
      SELECT 1 FROM unnest(p_facility_ids) AS requested(id)
      WHERE requested.id IS NULL OR NOT haven.has_facility_access(requested.id)
    ) THEN
    RAISE EXCEPTION 'Workforce roster unavailable' USING ERRCODE = '42501';
  END IF;

  facility_today := (pg_catalog.now() AT TIME ZONE 'America/New_York')::date;
  RETURN QUERY
    SELECT DISTINCT ON (assignment.staff_id, assignment.facility_id)
      assignment.staff_id, assignment.facility_id,
      person.first_name, person.last_name,
      COALESCE(assignment.role_at_facility, person.staff_role)::text
    FROM public.staff_facility_assignments AS assignment
    JOIN public.staff AS person ON person.id = assignment.staff_id
    WHERE assignment.organization_id = actor.actor_organization_id
      AND person.organization_id = actor.actor_organization_id
      AND assignment.facility_id = ANY (p_facility_ids)
      AND assignment.deleted_at IS NULL
      AND person.deleted_at IS NULL
      AND assignment.start_date <= facility_today
      AND (assignment.end_date IS NULL OR assignment.end_date >= facility_today)
    ORDER BY assignment.staff_id, assignment.facility_id,
      assignment.start_date DESC, assignment.updated_at DESC, assignment.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.workforce_assigned_roster(uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.workforce_assigned_roster(uuid[]) TO authenticated;
COMMENT ON FUNCTION public.workforce_assigned_roster(uuid[]) IS
  'COL-37 ruling: definer required -- staff RLS correctly hides a visitor whose home facility is outside the caller''s grants. The body validates the current managed actor, role, and every requested facility against live access before returning only staff ID, facility ID, name, and role. It never returns pay, SSN, date of birth, or the full staff row.';

COMMIT;
