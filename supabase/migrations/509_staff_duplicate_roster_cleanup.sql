-- COL-793: 20 staff members existed twice on production.
--
-- Root cause: migration 281_phase1_staff_seed.sql inserts its 20 roster rows without a
-- conflict key. It ran on production on 2026-05-25 15:40 UTC and again on 2026-06-29 02:36 UTC,
-- so every 281 row has a second, byte-identical copy (same facility, name, phone, role and
-- hire date). Brian approved the cleanup on 2026-09-24.
--
-- What this migration does:
--   1. Soft-deletes the twenty 2026-06-29 copies on production, listed by id. Each copy is
--      matched on its exact current values and only while its 2026-05-25 twin is still active
--      with the same identity, so a re-run (or a run where the row has since changed) is a no-op.
--      The 2026-05-25 rows survive: the three recruiter logins (Todd Denmark, April Powell,
--      Jessica Lawson) are linked to them, and no row in either copy had any reference in the
--      46 staff foreign keys (checked per table, bounded by id, 2026-09-24). Nothing is repointed.
--   2. Soft-deletes six retired COL-504 smoke-test actors on Haven HFO Staging ("COL504 Nurse",
--      logins banned and deactivated, no references) that would otherwise violate the guard.
--      These ids do not exist on production.
--   3. Adds the guard: at most one active staff row per facility, first name, last name
--      (case- and whitespace-insensitive) and hire date. Re-running the 281 seed is refused.
--
-- Left for a human (not touched): Charlene Elmore at Homewood also has a 2026-05-14 row
-- (3b43a9f9…, administrator, hire date 2026-05-14, has her login) beside the surviving
-- 2026-05-25 row (9db6892d…, assistant_administrator, hire date 2014-01-01). They differ in role,
-- hire date and phone, so which one is right is a business call. The guard does not cover
-- that pair because the hire dates differ.

BEGIN;

-- Any reference on a row about to be retired stops the migration instead of orphaning history.
DO $$
DECLARE
  v_ids uuid[] := ARRAY[
    '60ac550d-6481-4146-8a0e-64292d53f5ee',
    'd334cae0-601b-48e6-a60c-8b316540644d',
    'e3a883f3-94f7-42f9-9832-5f745771a675',
    '88aeb5c2-d7a8-49c2-9ed9-c068cf678ba8',
    '689c6266-8524-42c2-9a86-9930ced0bfbf',
    '49eaafda-79f2-4d42-bb39-c2ca752d4baa',
    '84d624c3-93da-4c6e-9267-dc035529f8e6',
    '63530c07-ce18-4eb6-af51-8968ce6088e3',
    '05606833-f4b9-4bea-ac99-0a7666845f2b',
    'ceb819d2-62aa-430a-a6a4-2914fce6b0dd',
    'e8d541bd-eff1-4335-bb97-167767cd266b',
    '58a22d04-1371-40af-a97a-2a61a8cb024d',
    '78fec17a-7185-4a41-85e2-f49afa84bc66',
    'f4268d16-93b6-4b47-b2e1-27d49e3282ca',
    'f020330c-90aa-47b6-8e20-a074e7d0d124',
    '118fa225-23bc-4cc4-8a9f-32e700873669',
    'dd258664-9447-4280-9bb2-993538ae66ca',
    'acb5a361-0fae-48be-b6ce-0dde2729fc04',
    'c9fe041d-86f0-4640-92b2-4bc79b056048',
    'b1d37589-4195-4ad3-85de-07e306a08624',
    '86435fe8-d24e-4b49-8be3-697e262ccc68', '76d28a38-a9e7-4764-b0da-5e93e0503743',
    '8786bb72-0d47-4270-85b7-0b3ca263b114', '649ddd67-8839-45cf-8c0f-3c5a4b02dd45',
    'adc55a5d-ec77-4e03-b581-78529f9a3871', '2e542fd9-d9ff-407f-b777-2e16f742bb6b'
  ]::uuid[];
  v_hit text;
BEGIN
  -- Only rows that are still active can be retired below; already-retired ids are ignored.
  SELECT array_agg(id) INTO v_ids FROM public.staff WHERE id = ANY (v_ids) AND deleted_at IS NULL;
  IF v_ids IS NULL THEN
    RETURN;
  END IF;
  SELECT string_agg(DISTINCT ref, ', ') INTO v_hit FROM (
    SELECT 'background_screenings.staff_id' AS ref FROM public.background_screenings WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'competency_demonstrations.staff_id' FROM public.competency_demonstrations WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'controlled_substance_count_variance_events.witness_staff_id' FROM public.controlled_substance_count_variance_events WHERE witness_staff_id = ANY (v_ids)
    UNION ALL SELECT 'driver_credentials.staff_id' FROM public.driver_credentials WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'emar_administration_witnesses.witness_staff_id' FROM public.emar_administration_witnesses WHERE witness_staff_id = ANY (v_ids)
    UNION ALL SELECT 'employee_duty_events.staff_id' FROM public.employee_duty_events WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'employee_file_records.staff_id' FROM public.employee_file_records WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'floor_unlocks.staff_id' FROM public.floor_unlocks WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'inservice_log_attendees.staff_id' FROM public.inservice_log_attendees WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'lab_observations.staff_id' FROM public.lab_observations WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'mileage_logs.staff_id' FROM public.mileage_logs WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'on_call_schedules.staff_id' FROM public.on_call_schedules WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'onboarding_manual_signoffs.staff_id' FROM public.onboarding_manual_signoffs WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'operation_activity_subjects.employee_id' FROM public.operation_activity_subjects WHERE employee_id = ANY (v_ids)
    UNION ALL SELECT 'payroll_export_lines.staff_id' FROM public.payroll_export_lines WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'resident_observation_assignments.staff_id' FROM public.resident_observation_assignments WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'resident_observation_escalations.escalated_to_staff_id' FROM public.resident_observation_escalations WHERE escalated_to_staff_id = ANY (v_ids)
    UNION ALL SELECT 'resident_observation_exceptions.assigned_to_staff_id' FROM public.resident_observation_exceptions WHERE assigned_to_staff_id = ANY (v_ids)
    UNION ALL SELECT 'resident_observation_integrity_flags.assigned_to_staff_id' FROM public.resident_observation_integrity_flags WHERE assigned_to_staff_id = ANY (v_ids)
    UNION ALL SELECT 'resident_observation_integrity_flags.staff_id' FROM public.resident_observation_integrity_flags WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'resident_observation_logs.assigned_staff_id' FROM public.resident_observation_logs WHERE assigned_staff_id = ANY (v_ids)
    UNION ALL SELECT 'resident_observation_logs.staff_id' FROM public.resident_observation_logs WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'resident_observation_tasks.assigned_staff_id' FROM public.resident_observation_tasks WHERE assigned_staff_id = ANY (v_ids)
    UNION ALL SELECT 'resident_observation_tasks.reassigned_from_staff_id' FROM public.resident_observation_tasks WHERE reassigned_from_staff_id = ANY (v_ids)
    UNION ALL SELECT 'resident_transport_requests.driver_staff_id' FROM public.resident_transport_requests WHERE driver_staff_id = ANY (v_ids)
    UNION ALL SELECT 'resident_transport_requests.escort_staff_id' FROM public.resident_transport_requests WHERE escort_staff_id = ANY (v_ids)
    UNION ALL SELECT 'rounding_completion_receipts.staff_id' FROM public.rounding_completion_receipts WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'shift_assignments.staff_id' FROM public.shift_assignments WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'shift_swap_requests.covering_staff_id' FROM public.shift_swap_requests WHERE covering_staff_id = ANY (v_ids)
    UNION ALL SELECT 'shift_swap_requests.requesting_staff_id' FROM public.shift_swap_requests WHERE requesting_staff_id = ANY (v_ids)
    UNION ALL SELECT 'staff_attendance_events.staff_id' FROM public.staff_attendance_events WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'staff_attestations.staff_id' FROM public.staff_attestations WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'staff_background_checks.staff_id' FROM public.staff_background_checks WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'staff_certifications.staff_id' FROM public.staff_certifications WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'staff_check_results.duplicate_of_staff_id' FROM public.staff_check_results WHERE duplicate_of_staff_id = ANY (v_ids)
    UNION ALL SELECT 'staff_check_results.subject_staff_id' FROM public.staff_check_results WHERE subject_staff_id = ANY (v_ids)
    UNION ALL SELECT 'staff_discipline_records.staff_id' FROM public.staff_discipline_records WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'staff_facility_assignments.staff_id' FROM public.staff_facility_assignments WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'staff_illness_records.staff_id' FROM public.staff_illness_records WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'staff_training_completions.staff_id' FROM public.staff_training_completions WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'time_punch_corrections.staff_id' FROM public.time_punch_corrections WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'time_punches.staff_id' FROM public.time_punches WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'time_records.staff_id' FROM public.time_records WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'timeclock_credentials.staff_id' FROM public.timeclock_credentials WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'timeclock_sync_rejections.staff_id' FROM public.timeclock_sync_rejections WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'workers_comp_claims.staff_id' FROM public.workers_comp_claims WHERE staff_id = ANY (v_ids)
    UNION ALL SELECT 'behavioral_logs.involved_staff' FROM public.behavioral_logs WHERE involved_staff && v_ids
  ) hits;
  IF v_hit IS NOT NULL THEN
    RAISE EXCEPTION 'COL-793: a duplicate staff row now has references (%); repoint them to the surviving row first', v_hit;
  END IF;
END
$$;

-- 1. Production: retire the 2026-06-29 copies of the 281 roster.
UPDATE public.staff AS dup
SET deleted_at = now(),
    notes = 'COL-793: duplicate of staff ' || v.keep_id::text
      || ' created by the 2026-06-29 re-run of the roster seed (migration 281); soft-deleted 2026-09-24.'
FROM (VALUES
    ('60ac550d-6481-4146-8a0e-64292d53f5ee'::uuid, 'e3d94b92-19a7-40be-b0eb-07dd6219390f'::uuid, '00000000-0000-0000-0002-000000000005'::uuid, 'Lori', 'Brown', DATE '2020-01-01', '386-628-8756', 'assistant_administrator'),  -- Lori Brown, Grande Cypress
    ('d334cae0-601b-48e6-a60c-8b316540644d'::uuid, '42bb1fcf-80ec-40d1-9a03-6cd62ddbde4f'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'Todd', 'Denmark', DATE '2014-01-01', '386-288-1372', 'marketing_consultant'),  -- Todd Denmark, Oakridge (keeper has the login)
    ('e3a883f3-94f7-42f9-9832-5f745771a675'::uuid, 'a035acf0-2230-402d-948c-c2b6dda49e81'::uuid, '00000000-0000-0000-0002-000000000002'::uuid, 'Crystal', 'Ducksworth', DATE '2015-01-01', '352-210-2999', 'administrator'),  -- Crystal Ducksworth, Rising Oaks
    ('88aeb5c2-d7a8-49c2-9ed9-c068cf678ba8'::uuid, '64a1daa1-8b2e-4e89-8bfe-ff511d673f16'::uuid, '00000000-0000-0000-0002-000000000002'::uuid, 'Robin', 'Ducksworth', DATE '2015-01-01', '352-538-9283', 'assistant_administrator'),  -- Robin Ducksworth, Rising Oaks
    ('689c6266-8524-42c2-9a86-9930ced0bfbf'::uuid, '9db6892d-bfbd-416d-82d8-195723bc2e49'::uuid, '00000000-0000-0000-0002-000000000003'::uuid, 'Charlene', 'Elmore', DATE '2014-01-01', '386-688-4437', 'assistant_administrator'),  -- Charlene Elmore, Homewood
    ('49eaafda-79f2-4d42-bb39-c2ca752d4baa'::uuid, '17e0aa25-aafb-4a48-aa22-2e39e9600bac'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'Sulma', 'Estrada', DATE '2014-01-01', '386-365-7242', 'administrator'),  -- Sulma Estrada, Oakridge
    ('84d624c3-93da-4c6e-9267-dc035529f8e6'::uuid, 'b1b2a57e-4889-473d-9e4a-aaeceddb31df'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'Mindy', 'Gaskins', DATE '2014-01-01', '352-552-4388', 'assistant_administrator'),  -- Mindy Gaskins, Oakridge
    ('63530c07-ce18-4eb6-af51-8968ce6088e3'::uuid, 'b702b426-0440-4b00-961a-e8f70d213997'::uuid, '00000000-0000-0000-0002-000000000004'::uuid, 'Bobbi Jo', 'Hare', DATE '2015-01-01', '386-438-4775', 'administrator'),  -- Bobbi Jo Hare, Plantation
    ('05606833-f4b9-4bea-ac99-0a7666845f2b'::uuid, '212b0b1b-e3da-4d1d-b516-c4dfdfdc1246'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'Jessica', 'Lawson', DATE '2014-01-01', '386-688-3589', 'admin_support_coordinator'),  -- Jessica Lawson, Oakridge (keeper has the login)
    ('ceb819d2-62aa-430a-a6a4-2914fce6b0dd'::uuid, '9ba86cff-ab0c-4efa-aa5b-259c6198021d'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'Jessica', 'Murphy', DATE '2014-01-01', '386-688-9318', 'cfo'),  -- Jessica Murphy, Oakridge
    ('e8d541bd-eff1-4335-bb97-167767cd266b'::uuid, '8989ea77-30b1-4a81-bb24-d029ccfaace3'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'Terrill', 'Murphy', DATE '2014-01-01', '386-688-9318', 'maintenance_director'),  -- Terrill Murphy, Oakridge
    ('58a22d04-1371-40af-a97a-2a61a8cb024d'::uuid, 'e5b627fa-2747-4cad-ace1-5fdbf0912c87'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'Michelle', 'Norris', DATE '2014-01-01', '386-209-1440', 'coo'),  -- Michelle Norris, Oakridge
    ('78fec17a-7185-4a41-85e2-f49afa84bc66'::uuid, '37bd0dbe-a469-4b49-8241-aadcf243376a'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'April', 'Powell', DATE '2014-01-01', '386-867-5909', 'marketing_consultant'),  -- April Powell, Oakridge (keeper has the login)
    ('f4268d16-93b6-4b47-b2e1-27d49e3282ca'::uuid, 'fb4c16a3-88fa-4177-b78d-62e84d2468a5'::uuid, '00000000-0000-0000-0002-000000000003'::uuid, 'Jackie', 'Ramirez', DATE '2014-01-01', '352-210-8789', 'administrator'),  -- Jackie Ramirez, Homewood
    ('f020330c-90aa-47b6-8e20-a074e7d0d124'::uuid, '7d180ac7-7d88-4bd0-a544-9d5dd63454ee'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'Scott', 'Reeves', DATE '2014-01-01', '386-288-6593', 'maintenance'),  -- Scott Reeves, Oakridge
    ('118fa225-23bc-4cc4-8a9f-32e700873669'::uuid, '5250699d-45e7-4361-9ed2-c4a7914f6053'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'Richard', 'Rehberg', DATE '2014-01-01', '386-292-0806', 'maintenance_standby'),  -- Richard Rehberg, Oakridge
    ('dd258664-9447-4280-9bb2-993538ae66ca'::uuid, '7c5c5d1b-8e4e-48a1-85e9-e9a07dae20df'::uuid, '00000000-0000-0000-0002-000000000004'::uuid, 'Sandy', 'Rehberg', DATE '2015-01-01', '386-324-1139', 'assistant_administrator'),  -- Sandy Rehberg, Plantation
    ('acb5a361-0fae-48be-b6ce-0dde2729fc04'::uuid, '90959cdf-3ec4-4f08-930e-8d783e86e107'::uuid, '00000000-0000-0000-0002-000000000005'::uuid, 'Jennifer', 'Smith', DATE '2020-01-01', '386-365-4050', 'administrator'),  -- Jennifer Smith, Grande Cypress
    ('c9fe041d-86f0-4640-92b2-4bc79b056048'::uuid, 'b2dcdf42-c180-4ab6-b5b8-cf6fffd07927'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'Milton', 'Smith', DATE '2014-01-01', '386-984-0798', 'owner'),  -- Milton Smith, Oakridge
    ('b1d37589-4195-4ad3-85de-07e306a08624'::uuid, 'ce5441ea-b194-4b27-b6c8-5accffd373ab'::uuid, '00000000-0000-0000-0002-000000000001'::uuid, 'Darren', 'Webb', DATE '2014-01-01', '850-443-2367', 'ceo')  -- Darren Webb, Oakridge
) AS v(dup_id, keep_id, facility_id, first_name, last_name, hire_date, phone, staff_role)
JOIN public.staff AS keep ON keep.id = v.keep_id
WHERE dup.id = v.dup_id
  AND dup.deleted_at IS NULL
  AND dup.user_id IS NULL
  AND dup.notes IS NULL
  AND dup.created_at >= TIMESTAMPTZ '2026-06-29 00:00:00+00'
  AND dup.created_at < TIMESTAMPTZ '2026-06-30 00:00:00+00'
  AND dup.facility_id = v.facility_id
  AND dup.first_name = v.first_name
  AND dup.last_name = v.last_name
  AND dup.hire_date = v.hire_date
  AND dup.phone = v.phone
  AND dup.staff_role::text = v.staff_role
  AND keep.deleted_at IS NULL
  AND keep.created_at < dup.created_at
  AND keep.facility_id = v.facility_id
  AND keep.first_name = v.first_name
  AND keep.last_name = v.last_name
  AND keep.hire_date = v.hire_date
  AND keep.phone = v.phone
  AND keep.staff_role::text = v.staff_role;

-- 2. Haven HFO Staging: retire the COL-504 smoke actors (logins already banned by the smoke).
UPDATE public.staff AS s
SET deleted_at = now(),
    notes = 'COL-793: retired COL-504 staging smoke actor; soft-deleted 2026-09-24 before the duplicate-staff guard.'
FROM (VALUES
    ('86435fe8-d24e-4b49-8be3-697e262ccc68'::uuid, 'col504-1afefff2-nurse@example.invalid'),
    ('76d28a38-a9e7-4764-b0da-5e93e0503743'::uuid, 'col504-998f141c-nurse@example.invalid'),
    ('8786bb72-0d47-4270-85b7-0b3ca263b114'::uuid, 'col504-9ce684e7-nurse@example.invalid'),
    ('649ddd67-8839-45cf-8c0f-3c5a4b02dd45'::uuid, 'col504-dfaaf039-nurse@example.invalid'),
    ('adc55a5d-ec77-4e03-b581-78529f9a3871'::uuid, 'col504-09d01557-nurse@example.invalid'),
    ('2e542fd9-d9ff-407f-b777-2e16f742bb6b'::uuid, 'col504-729a6053-nurse@example.invalid')
) AS v(staff_id, email)
WHERE s.id = v.staff_id
  AND s.email = v.email
  AND s.first_name = 'COL504'
  AND s.deleted_at IS NULL
  AND s.notes IS NULL;

-- 3. Guard: one active staff row per person per facility.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_active_facility_name_hire_date
  ON public.staff (facility_id, lower(btrim(first_name)), lower(btrim(last_name)), hire_date)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX public.idx_staff_active_facility_name_hire_date IS
  'COL-793: an import cannot create a second active staff row for the same facility, name and hire date.';

COMMIT;
