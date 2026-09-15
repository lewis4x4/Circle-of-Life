-- Local rollback-only probe: a care plan's author cannot be its approver (migration 391).
BEGIN;
CREATE TEMP TABLE sod_fixture AS
SELECT gen_random_uuid() author, gen_random_uuid() reviewer, gen_random_uuid() resident, f.id facility, f.organization_id org
FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM sod_fixture) THEN RAISE EXCEPTION 'Local replay seed facility required'; END IF; END $$;
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
SELECT author, author||'@review.invalid', jsonb_build_object('organization_id', org, 'app_role', 'facility_admin'), '{}'::jsonb FROM sod_fixture
UNION ALL SELECT reviewer, reviewer||'@review.invalid', jsonb_build_object('organization_id', org, 'app_role', 'nurse'), '{}'::jsonb FROM sod_fixture;
INSERT INTO public.residents(id, facility_id, organization_id, first_name, last_name, date_of_birth, gender)
SELECT resident, facility, org, 'Review', 'Fixture', '1940-01-01', 'female' FROM sod_fixture;
CREATE FUNCTION pg_temp.sod_error(stmt text, code text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE = code THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected SQLSTATE %', code; END $$;
CREATE FUNCTION pg_temp.sod_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%', msg; END IF; END $$;

-- Draft authored by `author`.
INSERT INTO public.care_plans(id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date, created_by)
SELECT 'c0000000-0000-4000-8000-000000000001', resident, facility, org, 1, 'draft', current_date, current_date + 365, author FROM sod_fixture;

-- An empty version cannot be approved by anyone (398).
SELECT pg_temp.sod_error(format($q$UPDATE public.care_plans SET status = 'active', approved_at = now(), approved_by = %L WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, reviewer), '23514') FROM sod_fixture;
INSERT INTO public.care_plan_items(care_plan_id, resident_id, facility_id, organization_id, category, title, description, assistance_level)
SELECT 'c0000000-0000-4000-8000-000000000001', resident, facility, org, 'bathing', 'Bathing', 'Assist', 'limited_assist' FROM sod_fixture;

-- The author signing it is refused at the table.
SELECT pg_temp.sod_error(format($q$UPDATE public.care_plans SET status = 'active', approved_at = now(), approved_by = %L WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, author), '23514') FROM sod_fixture;
-- Activating with no approver at all is refused.
SELECT pg_temp.sod_error($q$UPDATE public.care_plans SET status = 'active' WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, '23514');
-- A different reviewer may sign.
UPDATE public.care_plans p SET status = 'active', approved_at = now(), approved_by = f.reviewer FROM sod_fixture f WHERE p.id = 'c0000000-0000-4000-8000-000000000001';
SELECT pg_temp.sod_assert((SELECT status = 'active' FROM public.care_plans WHERE id = 'c0000000-0000-4000-8000-000000000001'), 'Reviewer approval goes active');

-- Legacy rows with no recorded author are not blocked (archive the active one first: one active plan per resident).
UPDATE public.care_plans SET status = 'archived' WHERE id = 'c0000000-0000-4000-8000-000000000001';
INSERT INTO public.care_plans(id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date, created_by)
SELECT 'c0000000-0000-4000-8000-000000000002', resident, facility, org, 2, 'draft', current_date, current_date + 365, NULL FROM sod_fixture;
INSERT INTO public.care_plan_items(care_plan_id, resident_id, facility_id, organization_id, category, title, description, assistance_level)
SELECT 'c0000000-0000-4000-8000-000000000002', resident, facility, org, 'bathing', 'Bathing', 'Assist', 'limited_assist' FROM sod_fixture;
UPDATE public.care_plans p SET status = 'active', approved_at = now(), approved_by = f.author FROM sod_fixture f WHERE p.id = 'c0000000-0000-4000-8000-000000000002';
SELECT pg_temp.sod_assert((SELECT status = 'active' FROM public.care_plans WHERE id = 'c0000000-0000-4000-8000-000000000002'), 'Unknown author does not block approval');
ROLLBACK;
