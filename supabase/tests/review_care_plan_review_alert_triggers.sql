-- Local rollback-only probe: significant changes raise care_plan_review_alerts; a new active version resolves them (migration 394).
BEGIN;
CREATE TEMP TABLE cpa_fixture AS
SELECT gen_random_uuid() reporter, gen_random_uuid() reviewer, gen_random_uuid() resident, gen_random_uuid() unplanned,
       f.id facility, f.organization_id org
FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM cpa_fixture) THEN RAISE EXCEPTION 'Local replay seed facility required'; END IF; END $$;
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
SELECT reporter, reporter||'@review.invalid', jsonb_build_object('organization_id', org, 'app_role', 'caregiver'), '{}'::jsonb FROM cpa_fixture
UNION ALL SELECT reviewer, reviewer||'@review.invalid', jsonb_build_object('organization_id', org, 'app_role', 'nurse'), '{}'::jsonb FROM cpa_fixture;
INSERT INTO public.residents(id, facility_id, organization_id, first_name, last_name, date_of_birth, gender, status, acuity_level)
SELECT resident, facility, org, 'Review', 'Fixture', '1940-01-01'::date, 'female'::public.gender, 'active'::public.resident_status, 'level_1'::public.acuity_level FROM cpa_fixture
UNION ALL SELECT unplanned, facility, org, 'No', 'Plan', '1940-01-01'::date, 'female'::public.gender, 'active'::public.resident_status, 'level_1'::public.acuity_level FROM cpa_fixture;
CREATE FUNCTION pg_temp.cpa_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%', msg; END IF; END $$;
CREATE FUNCTION pg_temp.cpa_open(p_type text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.care_plan_review_alerts a JOIN cpa_fixture f ON a.resident_id = f.resident
   WHERE a.trigger_type = p_type AND a.status IN ('open','acknowledged') AND a.deleted_at IS NULL $$;

-- Active plan v1, effective Jan 10 (no recorded author so activation is not blocked by 391).
INSERT INTO public.care_plans(id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date, approved_by, approved_at)
SELECT 'c0000000-0000-4000-8000-000000000101', resident, facility, org, 1, 'active', '2026-01-10', '2027-01-10', reviewer, now() FROM cpa_fixture;

-- Fall → fall_incident. A second fall does not duplicate the open alert.
INSERT INTO public.incidents(resident_id, facility_id, organization_id, incident_number, category, severity, occurred_at, shift, location_description, description, immediate_actions, reported_by)
SELECT resident, facility, org, 'INC-PROBE-1', 'fall_without_injury', 'level_1', '2026-09-03 14:00-04', 'day', 'Room', 'Probe fall', 'Assisted up', reporter FROM cpa_fixture;
INSERT INTO public.incidents(resident_id, facility_id, organization_id, incident_number, category, severity, occurred_at, shift, location_description, description, immediate_actions, reported_by)
SELECT resident, facility, org, 'INC-PROBE-2', 'fall_with_injury', 'level_2', '2026-09-04 09:00-04', 'day', 'Hall', 'Probe fall 2', 'Nurse called', reporter FROM cpa_fixture;
SELECT pg_temp.cpa_assert(pg_temp.cpa_open('fall_incident') = 1, 'One open fall alert for two falls');
SELECT pg_temp.cpa_assert((SELECT trigger_detail LIKE 'Fall (fall without injury) on Sep 03, 2026' FROM public.care_plan_review_alerts a JOIN cpa_fixture f ON a.resident_id = f.resident WHERE trigger_type = 'fall_incident'), 'Fall detail names the category and Eastern date');

-- Elopement → condition_change.
INSERT INTO public.incidents(resident_id, facility_id, organization_id, incident_number, category, severity, occurred_at, shift, location_description, description, immediate_actions, reported_by)
SELECT resident, facility, org, 'INC-PROBE-3', 'elopement', 'level_3', '2026-09-05 20:00-04', 'evening', 'Front door', 'Probe elopement', 'Found', reporter FROM cpa_fixture;
SELECT pg_temp.cpa_assert(pg_temp.cpa_open('condition_change') = 1, 'Elopement raises a condition-change alert');

-- A resident with no active plan raises nothing.
INSERT INTO public.incidents(resident_id, facility_id, organization_id, incident_number, category, severity, occurred_at, shift, location_description, description, immediate_actions, reported_by)
SELECT unplanned, facility, org, 'INC-PROBE-4', 'fall_witnessed', 'level_1', '2026-09-05 20:00-04', 'evening', 'Room', 'Probe fall', 'Assisted', reporter FROM cpa_fixture;
SELECT pg_temp.cpa_assert((SELECT count(*) = 0 FROM public.care_plan_review_alerts a JOIN cpa_fixture f ON a.resident_id = f.unplanned), 'No plan, no alert');

-- Hospital hold → active raises hospital_return; a plain status touch does not.
UPDATE public.residents r SET status = 'hospital_hold' FROM cpa_fixture f WHERE r.id = f.resident;
SELECT pg_temp.cpa_assert(pg_temp.cpa_open('hospital_return') = 0, 'Going on hold is not a return');
UPDATE public.residents r SET status = 'active' FROM cpa_fixture f WHERE r.id = f.resident;
SELECT pg_temp.cpa_assert(pg_temp.cpa_open('hospital_return') = 1, 'Return from hospital raises an alert');

-- Acuity change.
UPDATE public.residents r SET acuity_level = 'level_2' FROM cpa_fixture f WHERE r.id = f.resident;
SELECT pg_temp.cpa_assert(pg_temp.cpa_open('acuity_change') = 1, 'Acuity change raises an alert');

-- Condition change row: flagged as triggered, deduped against the open condition_change alert.
INSERT INTO public.condition_changes(resident_id, facility_id, organization_id, reported_by, shift, change_type, description)
SELECT resident, facility, org, reporter, 'night', 'decreased_appetite', 'Probe condition change' FROM cpa_fixture;
SELECT pg_temp.cpa_assert((SELECT bool_and(care_plan_review_triggered) FROM public.condition_changes c JOIN cpa_fixture f ON c.resident_id = f.resident), 'Condition change marked as triggering a review');
SELECT pg_temp.cpa_assert(pg_temp.cpa_open('condition_change') = 1, 'Condition change deduped against the open alert');
INSERT INTO public.condition_changes(resident_id, facility_id, organization_id, reported_by, shift, change_type, description)
SELECT unplanned, facility, org, reporter, 'night', 'decreased_appetite', 'Probe, no plan' FROM cpa_fixture;
SELECT pg_temp.cpa_assert((SELECT NOT bool_or(care_plan_review_triggered) FROM public.condition_changes c JOIN cpa_fixture f ON c.resident_id = f.unplanned), 'No plan, not flagged');

-- Form 1823 newer than the plan → form_1823_renewed; older does not.
INSERT INTO public.form_1823_records(organization_id, facility_id, resident_id, exam_date, status, is_current)
SELECT org, facility, resident, '2025-12-01', 'received', true FROM cpa_fixture;
SELECT pg_temp.cpa_assert(pg_temp.cpa_open('form_1823_renewed') = 0, 'An older exam is not a renewal');
INSERT INTO public.form_1823_records(organization_id, facility_id, resident_id, exam_date, status, is_current)
SELECT org, facility, resident, '2026-09-04', 'received', true FROM cpa_fixture;
SELECT pg_temp.cpa_assert(pg_temp.cpa_open('form_1823_renewed') = 1, 'A newer exam raises an alert');

-- A new active version resolves every open alert on the old plan.
INSERT INTO public.care_plans(id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date, previous_version_id)
SELECT 'c0000000-0000-4000-8000-000000000102', resident, facility, org, 2, 'draft', '2026-09-15', '2027-09-15', 'c0000000-0000-4000-8000-000000000101' FROM cpa_fixture;
UPDATE public.care_plans p SET status = 'active', approved_by = f.reviewer, approved_at = now() FROM cpa_fixture f WHERE p.id = 'c0000000-0000-4000-8000-000000000102';
SELECT pg_temp.cpa_assert((SELECT count(*) = 0 FROM public.care_plan_review_alerts a JOIN cpa_fixture f ON a.resident_id = f.resident WHERE a.status IN ('open','acknowledged')), 'Activation resolves the older plan alerts');
SELECT pg_temp.cpa_assert((SELECT bool_and(resolution_notes = 'Superseded by v2' AND resolved_by = f.reviewer) FROM public.care_plan_review_alerts a JOIN cpa_fixture f ON a.resident_id = f.resident), 'Resolution names the version and approver');
ROLLBACK;
