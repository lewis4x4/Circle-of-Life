-- Disposable PostgreSQL replay only. Synthetic fixtures and settings roll back.
BEGIN;

CREATE TEMP TABLE clock_age_fixture AS
SELECT f.organization_id org, f.entity_id entity, gen_random_uuid() facility,
  gen_random_uuid() other_facility, '2090-03-20 18:00:00Z'::timestamptz as_of
FROM public.facilities f WHERE f.deleted_at IS NULL AND f.entity_id IS NOT NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM clock_age_fixture) THEN RAISE EXCEPTION 'Replay seed facility required'; END IF; END $$;
INSERT INTO public.facilities(id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
SELECT facility, entity, org, 'Clock evidence probe', '1 Probe Way', 'Probe', '00000', 10, 'America/New_York' FROM clock_age_fixture
UNION ALL SELECT other_facility, entity, org, 'Clock evidence other', '2 Probe Way', 'Probe', '00000', 10, 'America/New_York' FROM clock_age_fixture;
INSERT INTO public.timeclock_facility_settings(organization_id, facility_id, timeclock_enabled)
SELECT org, facility, true FROM clock_age_fixture;

CREATE TEMP TABLE clock_age_staff AS
SELECT label, gen_random_uuid() staff_id, gen_random_uuid() user_id, gen_random_uuid() punch_id
FROM unnest(ARRAY['fresh','ninety','threshold','stale','meal','out','corrected','corrected_old','voided','elsewhere','no_grant','inactive','wrong_role']) label;
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
SELECT s.user_id, s.user_id || '@clock-evidence.invalid',
  jsonb_build_object('organization_id', f.org, 'app_role', CASE WHEN s.label='wrong_role' THEN 'housekeeper' ELSE 'med_tech' END),
  jsonb_build_object('full_name', 'Synthetic clock evidence')
FROM clock_age_staff s CROSS JOIN clock_age_fixture f;
INSERT INTO public.user_profiles(id, email, full_name, app_role, organization_id, is_active)
SELECT s.user_id, s.user_id || '@clock-evidence.invalid', 'Synthetic clock evidence',
  (CASE WHEN s.label='wrong_role' THEN 'housekeeper' ELSE 'med_tech' END)::public.app_role, f.org, s.label<>'inactive'
FROM clock_age_staff s CROSS JOIN clock_age_fixture f
ON CONFLICT (id) DO UPDATE SET app_role=excluded.app_role, organization_id=excluded.organization_id, is_active=excluded.is_active;
INSERT INTO public.user_facility_access(user_id, facility_id, organization_id)
SELECT s.user_id, f.facility, f.org FROM clock_age_staff s CROSS JOIN clock_age_fixture f WHERE s.label<>'no_grant';
INSERT INTO public.staff(id, organization_id, facility_id, user_id, first_name, last_name, staff_role, hire_date, employment_status)
SELECT s.staff_id, f.org, f.facility, s.user_id, 'Synthetic', s.label, 'resident_aide', '2089-01-01', 'active'
FROM clock_age_staff s CROSS JOIN clock_age_fixture f;
INSERT INTO public.time_punches(id, organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
SELECT s.punch_id, f.org, CASE WHEN s.label='elsewhere' THEN f.other_facility ELSE f.facility END, s.staff_id, 'in',
  f.as_of-make_interval(mins=>CASE s.label WHEN 'fresh' THEN 30 WHEN 'ninety' THEN 90 WHEN 'threshold' THEN 960
    WHEN 'stale' THEN 961 WHEN 'meal' THEN 600 WHEN 'corrected' THEN 1080 ELSE 20 END), gen_random_uuid()
FROM clock_age_staff s CROSS JOIN clock_age_fixture f;
INSERT INTO public.time_punches(organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
SELECT f.org, f.facility, s.staff_id, CASE WHEN s.label='meal' THEN 'meal_start' ELSE 'out' END,
  f.as_of-interval '5 minutes', gen_random_uuid()
FROM clock_age_staff s CROSS JOIN clock_age_fixture f WHERE s.label IN ('meal','out');
INSERT INTO public.time_punch_corrections(organization_id, facility_id, staff_id, correction_type, target_punch_id, corrected_punched_at, reason, corrected_by)
SELECT f.org, f.facility, s.staff_id, 'change_time', s.punch_id,
  f.as_of-make_interval(mins=>CASE WHEN s.label='corrected' THEN 90 ELSE 961 END), 'manager_verified_time', s.user_id
FROM clock_age_staff s CROSS JOIN clock_age_fixture f WHERE s.label IN ('corrected','corrected_old');
INSERT INTO public.time_punch_corrections(organization_id, facility_id, staff_id, correction_type, target_punch_id, reason, corrected_by)
SELECT f.org, f.facility, s.staff_id, 'void_punch', s.punch_id, 'duplicate', s.user_id
FROM clock_age_staff s CROSS JOIN clock_age_fixture f WHERE s.label='voided';

CREATE FUNCTION pg_temp.clock_age_owners() RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(s.label ORDER BY s.label), '{}'::text[])
  FROM clock_age_fixture f
  CROSS JOIN LATERAL haven.observation_on_clock_staff(f.facility, f.as_of) owners
  JOIN clock_age_staff s ON s.staff_id=owners.staff_id
$$;

DO $$ DECLARE actual text[]; minutes integer; role_name text; function_id oid; original_flag boolean; BEGIN
  IF (SELECT rounding_clock_evidence_max_age_minutes FROM public.timeclock_facility_settings WHERE facility_id=(SELECT facility FROM clock_age_fixture))<>960 THEN
    RAISE EXCEPTION 'Clock evidence policy does not preserve the 960-minute default';
  END IF;
  actual:=pg_temp.clock_age_owners();
  IF actual IS DISTINCT FROM ARRAY['corrected','fresh','meal','ninety','threshold'] THEN
    RAISE EXCEPTION 'Default cutoff changed eligibility or corrections: %',actual;
  END IF;
  -- Exactly sixteen hours remains included, but an older opening, a clock-out,
  -- a void, the other building and missing/inactive/incorrect role authority do not.
  SELECT timeclock_enabled INTO original_flag FROM public.timeclock_facility_settings WHERE facility_id=(SELECT facility FROM clock_age_fixture);
  UPDATE public.timeclock_facility_settings SET rounding_clock_evidence_max_age_minutes=60
  WHERE facility_id=(SELECT facility FROM clock_age_fixture);
  actual:=pg_temp.clock_age_owners();
  IF actual IS DISTINCT FROM ARRAY['fresh'] THEN
    RAISE EXCEPTION 'Configured shorter cutoff did not filter opening evidence: %',actual;
  END IF;
  -- A recent meal punch does not freshen a stale opening. Corrected openings
  -- use their corrected time, not the raw eighteen-hour-old clock-in.
  UPDATE public.timeclock_facility_settings SET rounding_clock_evidence_max_age_minutes=120
  WHERE facility_id=(SELECT facility FROM clock_age_fixture);
  IF pg_temp.clock_age_owners() IS DISTINCT FROM ARRAY['corrected','fresh','ninety'] THEN
    RAISE EXCEPTION 'Configured cutoff lost corrected evidence or counted a stale meal opening';
  END IF;
  UPDATE public.timeclock_facility_settings SET rounding_clock_evidence_max_age_minutes=1
  WHERE facility_id=(SELECT facility FROM clock_age_fixture);
  IF pg_temp.clock_age_owners() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'Minimum cutoff was not applied'; END IF;
  UPDATE public.timeclock_facility_settings SET rounding_clock_evidence_max_age_minutes=960
  WHERE facility_id=(SELECT facility FROM clock_age_fixture);
  IF pg_temp.clock_age_owners() IS DISTINCT FROM ARRAY['corrected','fresh','meal','ninety','threshold'] THEN
    RAISE EXCEPTION 'Restoring default did not restore the original eligibility';
  END IF;
  IF (SELECT timeclock_enabled FROM public.timeclock_facility_settings WHERE facility_id=(SELECT facility FROM clock_age_fixture)) IS DISTINCT FROM original_flag THEN
    RAISE EXCEPTION 'Evidence policy changed timeclock enablement';
  END IF;
  FOREACH minutes IN ARRAY ARRAY[0,-1,961,NULL]::integer[] LOOP
    BEGIN
      UPDATE public.timeclock_facility_settings SET rounding_clock_evidence_max_age_minutes=minutes
      WHERE facility_id=(SELECT facility FROM clock_age_fixture);
      RAISE EXCEPTION 'Invalid clock evidence minutes accepted: %',minutes;
    EXCEPTION WHEN check_violation OR not_null_violation THEN NULL;
    END;
  END LOOP;
  function_id:='haven.observation_on_clock_staff(uuid,timestamptz)'::regprocedure;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,function_id,'EXECUTE') THEN RAISE EXCEPTION 'Private clock evidence helper exposed to %',role_name; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=function_id AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'Private clock evidence helper exposed to PUBLIC'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid=function_id) THEN RAISE EXCEPTION 'Clock evidence helper unexpectedly became a definer'; END IF;
END $$;

UPDATE public.timeclock_facility_settings SET timeclock_enabled=false
WHERE facility_id=(SELECT facility FROM clock_age_fixture);
DO $$ BEGIN IF pg_temp.clock_age_owners() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'Disabled timeclock assigned a rounding owner'; END IF; END $$;
DELETE FROM public.timeclock_facility_settings WHERE facility_id=(SELECT facility FROM clock_age_fixture);
DO $$ BEGIN IF pg_temp.clock_age_owners() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'Missing timeclock settings assigned a rounding owner'; END IF; END $$;

DO $$ BEGIN RAISE NOTICE 'PASS: default/boundary parity, configured freshness, corrected/mealtime evidence, scope and authority, invalid settings, disabled/missing settings and private ACL'; END $$;
ROLLBACK;
