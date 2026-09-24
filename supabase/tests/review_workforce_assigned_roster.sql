-- Disposable replay: a secondary assignment grants roster identity, not a staff row.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;

CREATE TEMP TABLE workforce_roster_fixture AS
SELECT f.organization_id AS org, f.id AS facility,
  (SELECT other.id FROM public.facilities other
   WHERE other.organization_id = f.organization_id AND other.deleted_at IS NULL AND other.id <> f.id
   LIMIT 1) AS home_facility,
  gen_random_uuid() AS manager_id, gen_random_uuid() AS session_id, gen_random_uuid() AS visitor_id
FROM public.facilities f
WHERE f.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.facilities other
              WHERE other.organization_id = f.organization_id AND other.deleted_at IS NULL AND other.id <> f.id)
LIMIT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM workforce_roster_fixture) THEN
    RAISE EXCEPTION 'Two replay facilities in one organization are required';
  END IF;
END $$;

INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
SELECT manager_id, manager_id || '@workforce-roster.invalid',
  jsonb_build_object('organization_id', org, 'app_role', 'manager'), '{}'::jsonb
FROM workforce_roster_fixture;
INSERT INTO public.user_profiles(id, email, full_name, app_role, organization_id, is_active)
SELECT manager_id, manager_id || '@workforce-roster.invalid', 'Workforce roster review',
  'manager'::public.app_role, org, true
FROM workforce_roster_fixture;
INSERT INTO auth.sessions(id, user_id)
SELECT session_id, manager_id FROM workforce_roster_fixture;
INSERT INTO public.user_facility_access(user_id, facility_id, organization_id)
SELECT manager_id, facility, org FROM workforce_roster_fixture;
INSERT INTO public.staff(id, organization_id, facility_id, first_name, last_name,
  staff_role, hire_date, hourly_rate, ssn_last_four)
SELECT visitor_id, org, home_facility, 'Synthetic', 'Visitor',
  'resident_aide'::public.staff_role, CURRENT_DATE - 100, 4200, '4242'
FROM workforce_roster_fixture;
INSERT INTO public.staff_facility_assignments(organization_id, staff_id, facility_id,
  role_at_facility, start_date)
SELECT org, visitor_id, facility, 'resident_aide'::public.staff_role,
  (pg_catalog.now() AT TIME ZONE 'America/New_York')::date - 2
FROM workforce_roster_fixture;

GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON workforce_roster_fixture TO authenticated;
GRANT SELECT ON public.staff TO authenticated;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.workforce_assigned_roster(uuid[])', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.workforce_assigned_roster(uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.workforce_assigned_roster(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'Workforce roster function grant boundary failed';
  END IF;
END $$;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', f.manager_id, 'session_id', f.session_id,
  'auth_claim_version', p.auth_claim_version,
  'role', 'authenticated', 'app_role', 'manager', 'organization_id', f.org,
  'iat', extract(epoch FROM clock_timestamp())::bigint
)::text, true)
FROM workforce_roster_fixture f JOIN public.user_profiles p ON p.id = f.manager_id;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; projected jsonb; keys text[]; BEGIN
  SELECT * INTO f FROM workforce_roster_fixture;
  IF EXISTS (SELECT 1 FROM public.staff WHERE id = f.visitor_id) THEN
    RAISE EXCEPTION 'Secondary assignment exposed the full staff row';
  END IF;
  SELECT to_jsonb(row) INTO projected
  FROM public.workforce_assigned_roster(ARRAY[f.facility]) AS row
  WHERE row.staff_id = f.visitor_id;
  SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_object_keys(projected) AS key;
  IF projected IS NULL OR projected->>'first_name' IS DISTINCT FROM 'Synthetic'
    OR projected->>'last_name' IS DISTINCT FROM 'Visitor'
    OR keys IS DISTINCT FROM ARRAY['facility_id', 'first_name', 'last_name', 'staff_id', 'staff_role'] THEN
    RAISE EXCEPTION 'Narrow secondary roster projection failed';
  END IF;
  BEGIN
    PERFORM * FROM public.workforce_assigned_roster(ARRAY[f.home_facility]);
    RAISE EXCEPTION 'Ungrantable facility was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

UPDATE public.staff_facility_assignments
SET end_date = (pg_catalog.now() AT TIME ZONE 'America/New_York')::date - 1
WHERE staff_id = (SELECT visitor_id FROM workforce_roster_fixture);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM workforce_roster_fixture;
  IF EXISTS (SELECT 1 FROM public.workforce_assigned_roster(ARRAY[f.facility])) THEN
    RAISE EXCEPTION 'Ended assignment remained visible';
  END IF;
END $$;
RESET ROLE;

UPDATE public.user_facility_access SET revoked_at = pg_catalog.now()
WHERE user_id = (SELECT manager_id FROM workforce_roster_fixture);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM workforce_roster_fixture;
  BEGIN
    PERFORM * FROM public.workforce_assigned_roster(ARRAY[f.facility]);
    RAISE EXCEPTION 'Revoked facility remained readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;
