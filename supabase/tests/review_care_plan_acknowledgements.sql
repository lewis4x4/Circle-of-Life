-- Local rollback-only probe: acknowledgements are recorded only against the active plan, and never edited (migration 395).
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.care_plan_acknowledgements TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE ack_fixture AS
SELECT gen_random_uuid() actor, gen_random_uuid() session, gen_random_uuid() approver, gen_random_uuid() resident, f.id facility, f.organization_id org
FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM ack_fixture) THEN RAISE EXCEPTION 'Local replay seed facility required'; END IF; END $$;
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
SELECT actor, actor||'@review.invalid', jsonb_build_object('organization_id', org, 'app_role', 'med_tech'), '{}'::jsonb FROM ack_fixture
UNION ALL SELECT approver, approver||'@review.invalid', jsonb_build_object('organization_id', org, 'app_role', 'facility_admin'), '{}'::jsonb FROM ack_fixture;
INSERT INTO public.user_profiles(id, organization_id, full_name, email, app_role, is_active)
SELECT actor, org, 'Synthetic nurse', actor||'@review.invalid', 'med_tech', true FROM ack_fixture;
INSERT INTO auth.sessions(id, user_id) SELECT session, actor FROM ack_fixture;
INSERT INTO public.user_facility_access(user_id, facility_id, organization_id) SELECT actor, facility, org FROM ack_fixture ON CONFLICT DO NOTHING;
INSERT INTO public.residents(id, facility_id, organization_id, first_name, last_name, date_of_birth, gender)
SELECT resident, facility, org, 'Review', 'Fixture', '1940-01-01', 'female' FROM ack_fixture;
INSERT INTO public.care_plans(id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date, approved_by, approved_at)
SELECT 'c0000000-0000-4000-8000-000000000201', resident, facility, org, 1, 'active', current_date, current_date + 365, approver, now() FROM ack_fixture;
INSERT INTO public.care_plans(id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date)
SELECT 'c0000000-0000-4000-8000-000000000202', resident, facility, org, 2, 'draft', current_date, current_date + 365 FROM ack_fixture;
GRANT SELECT ON ack_fixture TO authenticated;
CREATE FUNCTION pg_temp.ack_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%', msg; END IF; END $$;
CREATE FUNCTION pg_temp.ack_error(stmt text, code text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE = code THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected SQLSTATE %', code; END $$;
GRANT ALL ON FUNCTION pg_temp.ack_assert(boolean, text) TO authenticated;
GRANT ALL ON FUNCTION pg_temp.ack_error(text, text) TO authenticated;

-- Table-level rules hold regardless of role.
SELECT pg_temp.ack_error(format($q$INSERT INTO public.care_plan_acknowledgements(organization_id, facility_id, care_plan_id, resident_id, signer_role, signer_name, method, recorded_by) VALUES (%L, %L, 'c0000000-0000-4000-8000-000000000201', %L, 'resident', 'R F', 'in_person_signature', %L)$q$, org, facility, resident, actor), '23514') FROM ack_fixture;

SELECT set_config('request.jwt.claims', jsonb_build_object('sub', a.actor, 'session_id', a.session, 'role', 'authenticated', 'app_role', 'med_tech', 'organization_id', a.org, 'auth_claim_version', p.auth_claim_version, 'iat', extract(epoch FROM clock_timestamp())::bigint)::text, true) FROM ack_fixture a JOIN public.user_profiles p ON p.id = a.actor;
SET LOCAL ROLE authenticated;

-- A nurse records an acknowledgement against the active plan.
INSERT INTO public.care_plan_acknowledgements(organization_id, facility_id, care_plan_id, resident_id, signer_role, signer_name, relationship_to_resident, method, recorded_by)
SELECT org, facility, 'c0000000-0000-4000-8000-000000000201', resident, 'responsible_party', 'Alice Example', 'daughter', 'paper_on_file', actor FROM ack_fixture;
SELECT pg_temp.ack_assert((SELECT count(*) = 1 FROM public.care_plan_acknowledgements WHERE care_plan_id = 'c0000000-0000-4000-8000-000000000201'), 'Nurse can record against the active plan');

-- Not against a draft.
SELECT pg_temp.ack_error(format($q$INSERT INTO public.care_plan_acknowledgements(organization_id, facility_id, care_plan_id, resident_id, signer_role, signer_name, method, recorded_by) VALUES (%L, %L, 'c0000000-0000-4000-8000-000000000202', %L, 'resident', 'Review Fixture', 'verbal_review', %L)$q$, org, facility, resident, actor), '42501') FROM ack_fixture;
-- Not on someone else's behalf.
SELECT pg_temp.ack_error(format($q$INSERT INTO public.care_plan_acknowledgements(organization_id, facility_id, care_plan_id, resident_id, signer_role, signer_name, method, recorded_by) VALUES (%L, %L, 'c0000000-0000-4000-8000-000000000201', %L, 'resident', 'Review Fixture', 'verbal_review', %L)$q$, org, facility, resident, approver), '42501') FROM ack_fixture;

-- Evidence is not edited or removed: no policy, so nothing is affected.
DO $$ DECLARE n integer; BEGIN
  UPDATE public.care_plan_acknowledgements SET signer_name = 'Changed' WHERE care_plan_id = 'c0000000-0000-4000-8000-000000000201';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'UPDATE affected % row(s)', n; END IF;
  DELETE FROM public.care_plan_acknowledgements WHERE care_plan_id = 'c0000000-0000-4000-8000-000000000201';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'DELETE affected % row(s)', n; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.ack_assert((SELECT signer_name = 'Alice Example' FROM public.care_plan_acknowledgements WHERE care_plan_id = 'c0000000-0000-4000-8000-000000000201'), 'Row unchanged');
ROLLBACK;
