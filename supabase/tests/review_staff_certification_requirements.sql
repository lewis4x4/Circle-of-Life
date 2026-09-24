-- COL-709 / COL-710: certification requirements per job role and the
-- "expiring soon" window are configuration.
-- Native scratch-only probe; every fixture rolls back. Synthetic users only.
--
-- Protects: every organization starts with the 60-day window the code used and
-- with no requirement at all (nothing is decided for the admins); a facility
-- admin can set a requirement and a window for a building they can reach but
-- not the organization default; an org admin can set the default; a med-tech
-- cannot set either; nobody can backdate a rule; the window stays within 7-365
-- days; a malformed certification type is refused; a facility admin cannot read
-- another building's override.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_certification_settings s
        WHERE s.organization_id = o.id AND s.facility_id IS NULL AND s.expiring_soon_days = 60
      )
  ) THEN
    RAISE EXCEPTION 'COL-710: an organization has no 60-day expiring-soon default';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_certification_requirements) THEN
    RAISE EXCEPTION 'COL-709: the migration decided a certification requirement for the admins';
  END IF;
END $$;

CREATE TEMP TABLE sc AS
SELECT gen_random_uuid() fa, gen_random_uuid() fa_session,
       gen_random_uuid() oa, gen_random_uuid() oa_session,
       gen_random_uuid() tech, gen_random_uuid() tech_session,
       gen_random_uuid() entity, gen_random_uuid() facility, gen_random_uuid() other_facility, o.id org
FROM public.organizations o WHERE o.deleted_at IS NULL ORDER BY o.id LIMIT 1;
GRANT SELECT ON sc TO authenticated;

INSERT INTO public.entities(id,organization_id,name,entity_type,status) SELECT entity, org, 'Cert Probe LLC', 'llc', 'active'::public.entity_status FROM sc;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone)
  SELECT facility, entity, org, 'Cert Probe House', '1 Probe Way', 'Probeville', '00000', 10, 'America/New_York' FROM sc
  UNION ALL SELECT other_facility, entity, org, 'Cert Probe Annex', '2 Probe Way', 'Probeville', '00000', 10, 'America/New_York' FROM sc;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT u, u||'@review.invalid', '{}'::jsonb, '{}'::jsonb FROM sc, LATERAL unnest(ARRAY[fa, oa, tech]) u;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT fa, fa||'@review.invalid','Fay Probe','facility_admin'::public.app_role,org,true FROM sc
  UNION ALL SELECT oa, oa||'@review.invalid','Otto Probe','org_admin'::public.app_role,org,true FROM sc
  UNION ALL SELECT tech, tech||'@review.invalid','Tess Probe','med_tech'::public.app_role,org,true FROM sc;
INSERT INTO auth.sessions(id,user_id)
  SELECT fa_session, fa FROM sc UNION ALL SELECT oa_session, oa FROM sc UNION ALL SELECT tech_session, tech FROM sc;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
  SELECT fa, facility, org FROM sc UNION ALL SELECT tech, facility, org FROM sc;

CREATE FUNCTION pg_temp.sc_as(p_user uuid, p_session uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated',
    'auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',p.organization_id,
    'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)::void
  FROM public.user_profiles p WHERE p.id = p_user
$$;

-- 1. A facility admin sets their building's requirement and window.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sc_as(fa, fa_session) FROM sc;
INSERT INTO public.staff_certification_requirements(organization_id,facility_id,staff_role,certification_type,required,effective_from,change_reason,created_by)
  SELECT org, facility, 'medication_tech'::public.staff_role, 'medication_administration', true, now(), 'probe', fa FROM sc;
INSERT INTO public.staff_certification_settings(organization_id,facility_id,expiring_soon_days,effective_from,change_reason,created_by)
  SELECT org, facility, 45, now(), 'probe', fa FROM sc;
DO $$ DECLARE f sc; BEGIN
  SELECT * INTO f FROM sc;
  -- ... but not the organization default.
  BEGIN
    INSERT INTO public.staff_certification_requirements(organization_id,facility_id,staff_role,certification_type,required,effective_from,change_reason,created_by)
      VALUES (f.org, NULL, 'medication_tech', 'bls_cpr', true, now(), 'probe', f.fa);
    RAISE EXCEPTION 'COL-709: a facility admin set the organization default requirement';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- ... nor another building.
  BEGIN
    INSERT INTO public.staff_certification_requirements(organization_id,facility_id,staff_role,certification_type,required,effective_from,change_reason,created_by)
      VALUES (f.org, f.other_facility, 'medication_tech', 'bls_cpr', true, now(), 'probe', f.fa);
    RAISE EXCEPTION 'COL-709: a facility admin set a requirement for a building they cannot reach';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- ... and not backdated.
  BEGIN
    INSERT INTO public.staff_certification_settings(organization_id,facility_id,expiring_soon_days,effective_from,change_reason,created_by)
      VALUES (f.org, f.facility, 30, now() - interval '2 days', 'probe', f.fa);
    RAISE EXCEPTION 'COL-710: a backdated window was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- The window guardrail.
  BEGIN
    INSERT INTO public.staff_certification_settings(organization_id,facility_id,expiring_soon_days,effective_from,change_reason,created_by)
      VALUES (f.org, f.facility, 3, now() + interval '1 minute', 'probe', f.fa);
    RAISE EXCEPTION 'COL-710: a 3-day window was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.staff_certification_settings(organization_id,facility_id,expiring_soon_days,effective_from,change_reason,created_by)
      VALUES (f.org, f.facility, 400, now() + interval '2 minutes', 'probe', f.fa);
    RAISE EXCEPTION 'COL-710: a 400-day window was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.staff_certification_requirements(organization_id,facility_id,staff_role,certification_type,required,effective_from,change_reason,created_by)
      VALUES (f.org, f.facility, 'medication_tech', 'BLS / CPR', true, now() + interval '3 minutes', 'probe', f.fa);
    RAISE EXCEPTION 'COL-709: a malformed certification type was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.staff_certification_requirements WHERE facility_id = f.facility) <> 1 THEN
    RAISE EXCEPTION 'COL-709: the facility admin cannot read back the requirement they set';
  END IF;
END $$;
RESET ROLE;

-- 2. An org admin sets the organization default.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sc_as(oa, oa_session) FROM sc;
INSERT INTO public.staff_certification_requirements(organization_id,facility_id,staff_role,certification_type,required,effective_from,change_reason,created_by)
  SELECT org, NULL, 'resident_aide'::public.staff_role, 'bls_cpr', true, now(), 'probe', oa FROM sc;
INSERT INTO public.staff_certification_requirements(organization_id,facility_id,staff_role,certification_type,required,effective_from,change_reason,created_by)
  SELECT org, other_facility, 'resident_aide'::public.staff_role, 'bls_cpr', false, now(), 'probe', oa FROM sc;
RESET ROLE;

-- 3. The facility admin sees the default but not the other building's override.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sc_as(fa, fa_session) FROM sc;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_certification_requirements WHERE facility_id IS NULL AND staff_role = 'resident_aide') THEN
    RAISE EXCEPTION 'COL-709: a facility admin cannot read the organization default requirement';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_certification_requirements WHERE facility_id = (SELECT other_facility FROM sc)) THEN
    RAISE EXCEPTION 'COL-709: a facility admin can read another building''s override';
  END IF;
END $$;
RESET ROLE;

-- 4. A med-tech sets nothing.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sc_as(tech, tech_session) FROM sc;
DO $$ DECLARE f sc; BEGIN
  SELECT * INTO f FROM sc;
  BEGIN
    INSERT INTO public.staff_certification_requirements(organization_id,facility_id,staff_role,certification_type,required,effective_from,change_reason,created_by)
      VALUES (f.org, f.facility, 'medication_tech', 'bls_cpr', false, now(), 'probe', f.tech);
    RAISE EXCEPTION 'COL-709: a med-tech set a certification requirement';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.staff_certification_settings(organization_id,facility_id,expiring_soon_days,effective_from,change_reason,created_by)
      VALUES (f.org, f.facility, 30, now(), 'probe', f.tech);
    RAISE EXCEPTION 'COL-710: a med-tech set the expiring-soon window';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- 5. Rules are append only for request roles.
DO $$ BEGIN
  IF has_table_privilege('authenticated', 'public.staff_certification_requirements', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.staff_certification_requirements', 'DELETE')
     OR has_table_privilege('authenticated', 'public.staff_certification_settings', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.staff_certification_settings', 'DELETE')
     OR has_table_privilege('anon', 'public.staff_certification_requirements', 'SELECT')
     OR has_table_privilege('anon', 'public.staff_certification_settings', 'SELECT') THEN
    RAISE EXCEPTION 'COL-709: certification rules are not append only for request roles';
  END IF;
END $$;

ROLLBACK;
