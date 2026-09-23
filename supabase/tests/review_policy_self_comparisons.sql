-- COL-680: no RLS policy may compare a column with itself. Native scratch-only
-- probe; every fixture rolls back.
--
-- Protects: an unqualified column inside a policy's EXISTS subquery resolves to
-- the subquery's own table (`s.organization_id = organization_id` reads as
-- `s.organization_id = s.organization_id`), so the check is always true. Four
-- INSERT policies shipped that way. This fails on any public policy whose
-- expression contains `(x.col = x.col)`, and proves the time_records manual
-- punch policy now refuses another organization's or building's staff id.
BEGIN;

DO $$ DECLARE bad text; BEGIN
  SELECT string_agg(format('%s.%s (%s)', tablename, policyname, cmd), ', ' ORDER BY tablename, policyname) INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '\(([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*) = \1\.\2\)';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'COL-680: these policies compare a column with itself (qualify the outer column with its table name): %', bad;
  END IF;
END $$;

GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
-- Hosted Supabase grants this by default; the replay has no default privileges.
GRANT INSERT ON public.time_records TO authenticated;

CREATE TEMP TABLE pc AS
SELECT gen_random_uuid() admin_user, gen_random_uuid() admin_session,
       gen_random_uuid() entity, gen_random_uuid() facility, gen_random_uuid() other_facility, o.id org,
       gen_random_uuid() other_org, gen_random_uuid() other_entity, gen_random_uuid() foreign_facility,
       gen_random_uuid() own_staff, gen_random_uuid() elsewhere_staff, gen_random_uuid() foreign_staff
FROM public.organizations o WHERE o.deleted_at IS NULL ORDER BY o.id LIMIT 1;
GRANT SELECT ON pc TO authenticated;

INSERT INTO public.organizations(id, name) SELECT other_org, 'Policy Probe Other Org' FROM pc;
INSERT INTO public.entities(id,organization_id,name,entity_type,status)
  SELECT entity, org, 'Policy Probe LLC', 'llc', 'active'::public.entity_status FROM pc
  UNION ALL SELECT other_entity, other_org, 'Policy Probe Other LLC', 'llc', 'active'::public.entity_status FROM pc;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT facility, entity, org, 'Policy Probe House', '1 Probe Way', 'Probeville', '00000', 10 FROM pc
  UNION ALL SELECT other_facility, entity, org, 'Policy Probe Annex', '2 Probe Way', 'Probeville', '00000', 10 FROM pc
  UNION ALL SELECT foreign_facility, other_entity, other_org, 'Policy Probe Elsewhere', '3 Probe Way', 'Probeville', '00000', 10 FROM pc;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT admin_user, admin_user||'@review.invalid', '{}'::jsonb, '{}'::jsonb FROM pc;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT admin_user, admin_user||'@review.invalid', 'Ada Admin', 'facility_admin'::public.app_role, org, true FROM pc;
INSERT INTO auth.sessions(id,user_id) SELECT admin_session, admin_user FROM pc;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT admin_user, facility, org FROM pc;
INSERT INTO public.staff(id,facility_id,organization_id,first_name,last_name,staff_role,hire_date)
  SELECT own_staff, facility, org, 'Own', 'Probe', 'cna'::public.staff_role, current_date - 30 FROM pc
  UNION ALL SELECT elsewhere_staff, other_facility, org, 'Annex', 'Probe', 'cna'::public.staff_role, current_date - 30 FROM pc
  UNION ALL SELECT foreign_staff, foreign_facility, other_org, 'Foreign', 'Probe', 'cna'::public.staff_role, current_date - 30 FROM pc;

CREATE FUNCTION pg_temp.pc_as(p_user uuid, p_session uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated',
    'auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',p.organization_id,
    'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)::void
  FROM public.user_profiles p WHERE p.id = p_user
$$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.pc_as(admin_user, admin_session) FROM pc;
DO $$ DECLARE f pc; BEGIN
  SELECT * INTO f FROM pc;
  -- Positive control: an administrator keys a punch for their own building's staff.
  INSERT INTO public.time_records(staff_id,facility_id,organization_id,clock_in,clock_in_method,approved)
    VALUES (f.own_staff, f.facility, f.org, now(), 'manual', false);
  BEGIN
    INSERT INTO public.time_records(staff_id,facility_id,organization_id,clock_in,clock_in_method,approved)
      VALUES (f.foreign_staff, f.facility, f.org, now(), 'manual', false);
    RAISE EXCEPTION 'COL-680: an administrator keyed a punch for another organization''s staff';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.time_records(staff_id,facility_id,organization_id,clock_in,clock_in_method,approved)
      VALUES (f.elsewhere_staff, f.facility, f.org, now(), 'manual', false);
    RAISE EXCEPTION 'COL-680: an administrator keyed a punch at their building for staff of another building';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

ROLLBACK;
