-- Local rollback-only probe: a care plan may name only this resident's current Form 1823 as its source (migration 396).
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT, UPDATE ON public.care_plans, public.care_plan_items TO authenticated;
-- The revision RPC locks the resident row (SELECT ... FOR UPDATE) as the invoker.
GRANT UPDATE ON public.residents TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE src_fixture AS
SELECT gen_random_uuid() actor, gen_random_uuid() session, gen_random_uuid() resident, gen_random_uuid() other_resident,
       gen_random_uuid() current_form, gen_random_uuid() old_form, gen_random_uuid() other_form, f.id facility, f.organization_id org
FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM src_fixture) THEN RAISE EXCEPTION 'Local replay seed facility required'; END IF; END $$;
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
SELECT actor, actor||'@review.invalid', jsonb_build_object('organization_id', org, 'app_role', 'med_tech'), '{}'::jsonb FROM src_fixture;
INSERT INTO public.user_profiles(id, organization_id, full_name, email, app_role, is_active)
SELECT actor, org, 'Synthetic nurse', actor||'@review.invalid', 'med_tech', true FROM src_fixture;
INSERT INTO auth.sessions(id, user_id) SELECT session, actor FROM src_fixture;
INSERT INTO public.user_facility_access(user_id, facility_id, organization_id) SELECT actor, facility, org FROM src_fixture ON CONFLICT DO NOTHING;
INSERT INTO public.residents(id, facility_id, organization_id, first_name, last_name, date_of_birth, gender)
SELECT resident, facility, org, 'Review', 'Fixture', '1940-01-01'::date, 'female'::public.gender FROM src_fixture
UNION ALL SELECT other_resident, facility, org, 'Other', 'Fixture', '1940-01-01'::date, 'female'::public.gender FROM src_fixture;
INSERT INTO public.form_1823_records(id, organization_id, facility_id, resident_id, exam_date, status, is_current)
SELECT current_form, org, facility, resident, '2026-09-04'::date, 'received'::public.form_1823_status, true FROM src_fixture
UNION ALL SELECT old_form, org, facility, resident, '2025-01-04'::date, 'received'::public.form_1823_status, false FROM src_fixture
UNION ALL SELECT other_form, org, facility, other_resident, '2026-09-04'::date, 'received'::public.form_1823_status, true FROM src_fixture;
GRANT SELECT ON src_fixture TO authenticated;
CREATE FUNCTION pg_temp.src_error(stmt text, code text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE = code THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected SQLSTATE %', code; END $$;
CREATE FUNCTION pg_temp.src_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%', msg; END IF; END $$;
GRANT ALL ON FUNCTION pg_temp.src_error(text, text) TO authenticated;
GRANT ALL ON FUNCTION pg_temp.src_assert(boolean, text) TO authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', a.actor, 'session_id', a.session, 'role', 'authenticated', 'app_role', 'med_tech', 'organization_id', a.org, 'auth_claim_version', p.auth_claim_version, 'iat', extract(epoch FROM clock_timestamp())::bigint)::text, true) FROM src_fixture a JOIN public.user_profiles p ON p.id = a.actor;
SET LOCAL ROLE authenticated;

-- One need drafted from the 1823.
CREATE TEMP TABLE src_items AS SELECT '[{"category":"bathing","title":"Bathing","description":"Needs assistance with bathing per the Form 1823 exam Sep 4, 2026","assistance_level":"limited_assist","frequency":"Each occasion","goal":"","interventions":[],"special_instructions":""}]'::jsonb items;
GRANT SELECT ON src_items TO authenticated;

-- A superseded form, or another resident's form, is refused.
SELECT pg_temp.src_error(format($q$SELECT public.create_care_plan_revision_review('c0000000-0000-4000-8000-000000000301', %L, NULL, current_date, current_date + 365, 'probe', (SELECT items FROM src_items), %L)$q$, resident, old_form), 'P0001') FROM src_fixture;
SELECT pg_temp.src_error(format($q$SELECT public.create_care_plan_revision_review('c0000000-0000-4000-8000-000000000302', %L, NULL, current_date, current_date + 365, 'probe', (SELECT items FROM src_items), %L)$q$, resident, other_form), 'P0001') FROM src_fixture;
SELECT pg_temp.src_assert((SELECT count(*) = 0 FROM public.care_plans p JOIN src_fixture f ON p.resident_id = f.resident), 'Refused drafts write nothing');

-- The current form is accepted and recorded on the version.
SELECT public.create_care_plan_revision_review('c0000000-0000-4000-8000-000000000303', resident, NULL, current_date, current_date + 365, 'probe', (SELECT items FROM src_items), current_form) FROM src_fixture;
SELECT pg_temp.src_assert((SELECT p.source_form_1823_id = f.current_form AND p.status = 'under_review' FROM public.care_plans p JOIN src_fixture f ON p.resident_id = f.resident WHERE p.id = 'c0000000-0000-4000-8000-000000000303'), 'Source recorded on the draft');
-- Idempotent replay with the same content returns the same id; different source is a different request.
SELECT pg_temp.src_assert((SELECT public.create_care_plan_revision_review('c0000000-0000-4000-8000-000000000303', resident, NULL, current_date, current_date + 365, 'probe', (SELECT items FROM src_items), current_form) = 'c0000000-0000-4000-8000-000000000303' FROM src_fixture), 'Exact replay acknowledged');
SELECT pg_temp.src_error(format($q$SELECT public.create_care_plan_revision_review('c0000000-0000-4000-8000-000000000303', %L, NULL, current_date, current_date + 365, 'probe', (SELECT items FROM src_items), NULL)$q$, resident), 'P0001') FROM src_fixture;
RESET ROLE;
ROLLBACK;
