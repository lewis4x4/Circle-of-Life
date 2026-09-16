-- COL-352 timeclock: native scratch-only probe; fixtures and auth adaptation roll back.
-- Synthetic staff only ("Test Staff A" ...). No real names, PINs or badges.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;

CREATE TEMP TABLE tc_fixture AS
SELECT gen_random_uuid() owner_actor, gen_random_uuid() owner_session,
       gen_random_uuid() staff_user, gen_random_uuid() staff_session,
       f.id facility, f.organization_id org, f.entity_id entity,
       gen_random_uuid() other_facility,
       gen_random_uuid() staff_a, gen_random_uuid() staff_b, gen_random_uuid() staff_c, gen_random_uuid() staff_d
FROM public.facilities f WHERE f.deleted_at IS NULL ORDER BY f.name LIMIT 1;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT owner_actor, owner_actor||'@review.invalid', jsonb_build_object('organization_id',org,'app_role','owner'), '{"full_name":"Timeclock owner probe"}'::jsonb FROM tc_fixture
  UNION ALL
  SELECT staff_user, staff_user||'@review.invalid', jsonb_build_object('organization_id',org,'app_role','caregiver'), '{"full_name":"Timeclock staff probe"}'::jsonb FROM tc_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT owner_actor, owner_actor||'@review.invalid','Timeclock owner probe','owner'::public.app_role,org,true FROM tc_fixture
  UNION ALL
  SELECT staff_user, staff_user||'@review.invalid','Timeclock staff probe','caregiver'::public.app_role,org,true FROM tc_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session, owner_actor FROM tc_fixture UNION ALL SELECT staff_session, staff_user FROM tc_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT other_facility, entity, org, 'Timeclock scope probe', 'Test', 'Test', '00000', 1 FROM tc_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT staff_user, facility, org FROM tc_fixture;

INSERT INTO public.staff(id,organization_id,facility_id,user_id,first_name,last_name,staff_role,hire_date,employment_status)
  SELECT staff_a, org, facility, staff_user, 'Test Staff', 'A', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM tc_fixture
  UNION ALL SELECT staff_b, org, facility, NULL, 'Test Staff', 'B', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM tc_fixture
  UNION ALL SELECT staff_c, org, other_facility, NULL, 'Test Staff', 'C', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM tc_fixture
  UNION ALL SELECT staff_d, org, facility, NULL, 'Test Staff', 'D', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM tc_fixture;

CREATE FUNCTION pg_temp.tc_actor(p_which text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
  IF p_which = 'owner' THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',f.owner_actor,'session_id',f.owner_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)
      FROM tc_fixture f JOIN public.user_profiles p ON p.id = f.owner_actor;
  ELSE
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',f.staff_user,'session_id',f.staff_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)
      FROM tc_fixture f JOIN public.user_profiles p ON p.id = f.staff_user;
  END IF;
END $$;
CREATE FUNCTION pg_temp.tc_fail(sql text, expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM) > 0 THEN RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'Expected failure: %', expected;
END $$;
CREATE TEMP TABLE tc_results(name text PRIMARY KEY, value jsonb);
GRANT ALL ON tc_results TO authenticated, service_role;
GRANT SELECT ON tc_fixture TO authenticated, service_role;

-- 1. Grant posture, before any role switch.
DO $$ BEGIN
  IF has_table_privilege('authenticated','public.timeclock_credentials','SELECT')
     OR has_table_privilege('anon','public.timeclock_credentials','SELECT')
     OR has_table_privilege('service_role','public.timeclock_credentials','SELECT')
     OR has_table_privilege('authenticated','public.timeclock_devices','SELECT')
     OR has_table_privilege('authenticated','public.timeclock_enrollment_codes','SELECT')
     OR has_table_privilege('authenticated','public.time_punches','INSERT')
     OR has_table_privilege('authenticated','public.time_punches','UPDATE')
     OR has_table_privilege('authenticated','public.time_punches','DELETE')
     OR has_table_privilege('authenticated','public.time_punch_corrections','UPDATE')
     OR has_table_privilege('authenticated','public.time_punch_corrections','DELETE')
     OR has_table_privilege('anon','public.time_punches','SELECT')
  THEN RAISE EXCEPTION 'Timeclock table grant boundary failed'; END IF;
  IF has_function_privilege('anon','public.timeclock_record_punch(text,text,text,text,text,timestamptz,uuid,boolean)','EXECUTE')
     OR has_function_privilege('authenticated','public.timeclock_record_punch(text,text,text,text,text,timestamptz,uuid,boolean)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.timeclock_record_punch(text,text,text,text,text,timestamptz,uuid,boolean)','EXECUTE')
     OR has_function_privilege('authenticated','public.timeclock_enroll_device(text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.timeclock_identify(text,text,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.timeclock_set_credentials(uuid,text,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.timeclock_set_credentials(uuid,text,text,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','haven.timeclock_resolve(text,text,text,text)','EXECUTE')
     OR has_function_privilege('service_role','haven.timeclock_effective_punches(uuid,timestamptz,timestamptz)','EXECUTE')
  THEN RAISE EXCEPTION 'Timeclock function grant boundary failed'; END IF;
END $$;

-- 2. Credentials are unreadable by every client role (RLS on, no grants).
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    BEGIN
      PERFORM count(*) FROM public.timeclock_credentials;
      RAISE EXCEPTION 'timeclock_credentials readable by %', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM count(*) FROM public.timeclock_devices;
      RAISE EXCEPTION 'timeclock_devices readable by %', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
  END LOOP;
END $$;

-- Hosted Supabase grants request roles SELECT on public tables by default; the
-- local replay does not, so state the roster reads the RLS policies depend on.
GRANT SELECT ON public.staff, public.staff_facility_assignments, public.facilities, public.user_facility_access TO authenticated;

-- 3. Owner sets the facility flag, creates credentials and an enrollment code.
SELECT pg_temp.tc_actor('owner');
SET LOCAL ROLE authenticated;
INSERT INTO public.timeclock_facility_settings(organization_id, facility_id, timeclock_enabled, updated_by)
  SELECT org, facility, true, owner_actor FROM tc_fixture;
INSERT INTO tc_results SELECT 'cred_a', public.timeclock_set_credentials(staff_a, 'create', 'a-100', '123456', NULL) FROM tc_fixture;
INSERT INTO tc_results SELECT 'cred_b', public.timeclock_set_credentials(staff_b, 'create', 'B200', '654321', NULL) FROM tc_fixture;
INSERT INTO tc_results SELECT 'cred_c', public.timeclock_set_credentials(staff_c, 'create', 'C300', '111111', NULL) FROM tc_fixture;
INSERT INTO tc_results SELECT 'cred_d', public.timeclock_set_credentials(staff_d, 'create', 'D400', '222222', NULL) FROM tc_fixture;
INSERT INTO tc_results SELECT 'badge_a', public.timeclock_set_credentials(staff_a, 'set_badge', NULL, NULL, repeat('ab', 32)) FROM tc_fixture;
SELECT pg_temp.tc_fail(format('SELECT public.timeclock_set_credentials(%L,''create'',''A100'',''999999'',NULL)', staff_b), 'credential exists') FROM tc_fixture;
SELECT pg_temp.tc_fail(format('SELECT public.timeclock_set_credentials(%L,''set_number'',''A-100'',NULL,NULL)', staff_b), 'employee_number_taken') FROM tc_fixture;
SELECT pg_temp.tc_fail(format('SELECT public.timeclock_set_credentials(%L,''set_pin'',NULL,''12'',NULL)', staff_a), 'invalid PIN') FROM tc_fixture;
INSERT INTO tc_results SELECT 'code', public.timeclock_create_enrollment_code(facility) FROM tc_fixture;
DO $$ BEGIN
  IF (SELECT value->>'employee_number' FROM tc_results WHERE name='cred_a') <> 'A-100' THEN RAISE EXCEPTION 'Employee number not normalised'; END IF;
  IF NOT (SELECT (value->>'has_badge')::boolean FROM tc_results WHERE name='badge_a') THEN RAISE EXCEPTION 'Badge not registered'; END IF;
  IF length((SELECT value->>'code' FROM tc_results WHERE name='code')) <> 8 THEN RAISE EXCEPTION 'Enrollment code shape'; END IF;
END $$;
RESET ROLE;

-- Deactivate B after credentials exist (COL-349 shape: terminated, not deleted).
UPDATE public.staff SET employment_status = 'terminated', termination_date = current_date WHERE id = (SELECT staff_b FROM tc_fixture);
SELECT pg_temp.tc_actor('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.tc_fail(format('SELECT public.timeclock_set_credentials(%L,''set_pin'',NULL,''999999'',NULL)', staff_b), 'inactive_staff') FROM tc_fixture;
RESET ROLE;

-- 4. Kiosk enrolls with the code (service_role); the same code cannot enroll twice.
SET LOCAL ROLE service_role;
INSERT INTO tc_results SELECT 'device', public.timeclock_enroll_device(value->>'code', 'Probe tablet') FROM tc_results WHERE name='code';
INSERT INTO tc_results SELECT 'device_again', public.timeclock_enroll_device(value->>'code', 'Probe tablet 2') FROM tc_results WHERE name='code';
RESET ROLE;
DO $$ BEGIN
  IF NOT (SELECT (value->>'ok')::boolean FROM tc_results WHERE name='device') THEN RAISE EXCEPTION 'Enrollment failed'; END IF;
  IF (SELECT value->>'error' FROM tc_results WHERE name='device_again') <> 'code_invalid' THEN RAISE EXCEPTION 'Code reused'; END IF;
END $$;

CREATE FUNCTION pg_temp.tc_punch(p_identifier text, p_pin text, p_type text, p_client uuid DEFAULT gen_random_uuid(), p_offline boolean DEFAULT false, p_device_time timestamptz DEFAULT NULL, p_badge text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.timeclock_record_punch((SELECT value->>'token' FROM tc_results WHERE name='device'), p_identifier, p_badge, p_pin, p_type,
    COALESCE(p_device_time, clock_timestamp()), p_client, p_offline)
$$;

-- 5. Happy path for Test Staff A: in, meal, out. Badge HMAC works as the identifier too.
DO $$ DECLARE r jsonb; c uuid := gen_random_uuid(); n integer; BEGIN
  r := pg_temp.tc_punch('a-100', '123456', 'in', c);
  IF NOT (r->>'ok')::boolean OR r->>'punch_type' <> 'in' OR r->>'first_name' <> 'Test Staff' OR r->'next_actions' <> '["out","meal_start"]'::jsonb THEN RAISE EXCEPTION 'Clock in failed: %', r; END IF;
  -- Same client_punch_id twice inserts once.
  r := pg_temp.tc_punch('a-100', '123456', 'in', c);
  IF NOT (r->>'ok')::boolean OR NOT (r->>'replayed')::boolean THEN RAISE EXCEPTION 'Replay not idempotent: %', r; END IF;
  SELECT count(*) INTO n FROM public.time_punches WHERE staff_id = (SELECT staff_a FROM tc_fixture);
  IF n <> 1 THEN RAISE EXCEPTION 'Duplicate punch inserted (%)', n; END IF;
  -- Invalid next type: a second in.
  r := pg_temp.tc_punch('a-100', '123456', 'in');
  IF (r->>'ok')::boolean OR r->>'error' <> 'invalid_next_type' THEN RAISE EXCEPTION 'Second in accepted: %', r; END IF;
  r := pg_temp.tc_punch('a-100', '123456', 'meal_start');
  IF NOT (r->>'ok')::boolean OR r->'next_actions' <> '["meal_end"]'::jsonb THEN RAISE EXCEPTION 'Meal start failed: %', r; END IF;
  r := pg_temp.tc_punch(NULL, '123456', 'meal_end', gen_random_uuid(), false, NULL, repeat('ab', 32));
  IF NOT (r->>'ok')::boolean OR r->>'punch_type' <> 'meal_end' THEN RAISE EXCEPTION 'Badge meal end failed: %', r; END IF;
  -- Clock skew: device time 5 minutes behind is flagged, never rejected.
  r := pg_temp.tc_punch('a-100', '123456', 'out', gen_random_uuid(), false, clock_timestamp() - interval '5 minutes');
  IF NOT (r->>'ok')::boolean OR NOT (r->'flags' ? 'clock_skew') OR r->'next_actions' <> '["in"]'::jsonb THEN RAISE EXCEPTION 'Clock out / skew flag failed: %', r; END IF;
  IF (r->>'today_worked_minutes')::integer < 0 THEN RAISE EXCEPTION 'Negative minutes'; END IF;
  -- Online punches carry server time: three within a second of the device clock, one skewed by five minutes.
  IF (SELECT count(*) FROM public.time_punches WHERE staff_id = (SELECT staff_a FROM tc_fixture) AND NOT captured_offline AND abs(extract(epoch FROM (punched_at - device_time))) < 2) <> 3
     OR (SELECT count(*) FROM public.time_punches WHERE staff_id = (SELECT staff_a FROM tc_fixture) AND NOT captured_offline AND abs(extract(epoch FROM (punched_at - device_time))) BETWEEN 290 AND 310 AND flags @> ARRAY['clock_skew']) <> 1 THEN
    RAISE EXCEPTION 'Online punch time must be server time';
  END IF;
END $$;

-- 6. Offline capture: punch time is the device time, flagged offline_capture; today's minutes count the shift.
DO $$ DECLARE r jsonb; t0 timestamptz := clock_timestamp(); m integer; BEGIN
  r := pg_temp.tc_punch('D400', '222222', 'in', gen_random_uuid(), true, t0 - interval '3 hours');
  IF NOT (r->>'ok')::boolean OR NOT (r->'flags' ? 'offline_capture') OR (r->>'punched_at')::timestamptz <> t0 - interval '3 hours' THEN RAISE EXCEPTION 'Offline in failed: %', r; END IF;
  r := pg_temp.tc_punch('D400', '222222', 'meal_start', gen_random_uuid(), true, t0 - interval '2 hours');
  r := pg_temp.tc_punch('D400', '222222', 'meal_end', gen_random_uuid(), true, t0 - interval '90 minutes');
  r := pg_temp.tc_punch('D400', '222222', 'out');
  m := (r->>'today_worked_minutes')::integer;
  IF m NOT BETWEEN 149 AND 151 THEN RAISE EXCEPTION 'Today minutes % (expected 150: 60 before meal + 90 after)', m; END IF;
  -- Offline punch with a wrong PIN is recorded as a sync rejection for the manager, tied to the staff member.
  r := pg_temp.tc_punch('D400', '000000', 'in', gen_random_uuid(), true, t0);
  IF (r->>'ok')::boolean OR r->>'error' <> 'not_recognized' THEN RAISE EXCEPTION 'Wrong offline PIN accepted: %', r; END IF;
  IF (SELECT count(*) FROM public.timeclock_sync_rejections WHERE staff_id = (SELECT staff_d FROM tc_fixture) AND reason = 'not_recognized') <> 1 THEN RAISE EXCEPTION 'Rejection row missing'; END IF;
  -- Offline punch whose PIN was lost (page reload) is recorded as pin_unavailable.
  r := pg_temp.tc_punch('D400', '', 'in', gen_random_uuid(), true, t0);
  IF (SELECT count(*) FROM public.timeclock_sync_rejections WHERE staff_id = (SELECT staff_d FROM tc_fixture) AND reason = 'pin_unavailable') <> 1 THEN RAISE EXCEPTION 'pin_unavailable row missing'; END IF;
END $$;
UPDATE public.timeclock_credentials SET failed_attempts = 0 WHERE staff_id = (SELECT staff_d FROM tc_fixture);

-- 7. Wrong PIN increments; the sixth attempt is locked even with the right PIN; the lock expires.
DO $$ DECLARE r jsonb; i integer; BEGIN
  FOR i IN 1..5 LOOP
    r := pg_temp.tc_punch('A-100', '000000', 'in');
    IF r->>'error' <> 'not_recognized' THEN RAISE EXCEPTION 'Attempt % gave %', i, r; END IF;
  END LOOP;
  r := pg_temp.tc_punch('A-100', '123456', 'in');
  IF r->>'error' <> 'locked' THEN RAISE EXCEPTION 'Sixth attempt not locked: %', r; END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE table_name = 'timeclock_credentials' AND new_data->>'event' = 'credential_locked' AND record_id = (SELECT staff_a FROM tc_fixture)) <> 1 THEN RAISE EXCEPTION 'Lock audit event missing'; END IF;
  UPDATE public.timeclock_credentials SET locked_until = clock_timestamp() - interval '1 second' WHERE staff_id = (SELECT staff_a FROM tc_fixture);
  r := pg_temp.tc_punch('A-100', '123456', 'in');
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'Punch after lock expiry failed: %', r; END IF;
END $$;

-- 8. Deactivated staff, staff not assigned to the facility, facility flag off.
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.tc_punch('B200', '654321', 'in');
  IF r->>'error' <> 'inactive_staff' THEN RAISE EXCEPTION 'Terminated staff accepted: %', r; END IF;
  r := pg_temp.tc_punch('C300', '111111', 'in');
  IF r->>'error' <> 'not_assigned' THEN RAISE EXCEPTION 'Unassigned staff accepted: %', r; END IF;
  UPDATE public.timeclock_facility_settings SET timeclock_enabled = false WHERE facility_id = (SELECT facility FROM tc_fixture);
  r := pg_temp.tc_punch('A-100', '123456', 'out');
  IF r->>'error' <> 'facility_off' THEN RAISE EXCEPTION 'Flag off ignored: %', r; END IF;
  UPDATE public.timeclock_facility_settings SET timeclock_enabled = true WHERE facility_id = (SELECT facility FROM tc_fixture);
END $$;

-- 9. Device throttle: 20 unknown identifiers in 10 minutes throttles the tablet for 5 minutes.
DO $$ DECLARE r jsonb; i integer; BEGIN
  FOR i IN 1..20 LOOP r := pg_temp.tc_punch('NOBODY', '000000', 'in'); END LOOP;
  r := pg_temp.tc_punch('A-100', '123456', 'out');
  IF r->>'error' <> 'device_throttled' THEN RAISE EXCEPTION 'Device not throttled: %', r; END IF;
  UPDATE public.timeclock_devices SET throttled_until = NULL;
END $$;

-- 10. Revoked device is rejected immediately.
SELECT pg_temp.tc_actor('owner');
SET LOCAL ROLE authenticated;
SELECT public.timeclock_revoke_device((value->>'device_id')::uuid) FROM tc_results WHERE name='device';
DO $$ BEGIN
  IF jsonb_array_length(public.timeclock_list_devices((SELECT facility FROM tc_fixture))) < 1 THEN RAISE EXCEPTION 'Device list empty'; END IF;
  IF public.timeclock_list_devices((SELECT facility FROM tc_fixture))::text LIKE '%token_hash%' THEN RAISE EXCEPTION 'Device list leaks token hash'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.tc_punch('A-100', '123456', 'out');
  IF r->>'error' <> 'device_unknown' THEN RAISE EXCEPTION 'Revoked device accepted: %', r; END IF;
END $$;

-- 11. Punches are append only: owner cannot update or delete under RLS; the guard blocks even the table owner.
SELECT pg_temp.tc_actor('owner');
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM public.time_punches WHERE staff_id = (SELECT staff_a FROM tc_fixture);
  IF n < 5 THEN RAISE EXCEPTION 'Owner cannot read punches (%)', n; END IF;
  BEGIN
    UPDATE public.time_punches SET punched_at = clock_timestamp() WHERE staff_id = (SELECT staff_a FROM tc_fixture);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'Owner updated % punches', n; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.time_punches WHERE staff_id = (SELECT staff_a FROM tc_fixture);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'Owner deleted % punches', n; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.time_punches(organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
      SELECT org, facility, staff_a, 'in', clock_timestamp(), gen_random_uuid() FROM tc_fixture;
    RAISE EXCEPTION 'Owner inserted a punch directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- Corrections: add, void, change time and acknowledge; reason required by shape; never updatable.
INSERT INTO public.time_punch_corrections(organization_id, facility_id, staff_id, correction_type, punch_type, corrected_punched_at, reason, note, corrected_by)
  SELECT org, facility, staff_a, 'add_punch', 'out', clock_timestamp(), 'missed_punch', 'Forgot to clock out', owner_actor FROM tc_fixture;
INSERT INTO public.time_punch_corrections(organization_id, facility_id, staff_id, correction_type, target_punch_id, reason, corrected_by)
  SELECT f.org, f.facility, f.staff_a, 'void_punch', p.id, 'duplicate', f.owner_actor FROM tc_fixture f JOIN public.time_punches p ON p.staff_id = f.staff_a AND p.punch_type = 'in' ORDER BY p.punched_at DESC LIMIT 1;
INSERT INTO public.time_punch_corrections(organization_id, facility_id, staff_id, correction_type, exception_key, reason, corrected_by)
  SELECT org, facility, staff_a, 'acknowledge', 'clock_skew:probe', 'manager_verified_time', owner_actor FROM tc_fixture;
SELECT pg_temp.tc_fail(format('INSERT INTO public.time_punch_corrections(organization_id, facility_id, staff_id, correction_type, exception_key, reason, corrected_by) VALUES (%L,%L,%L,''acknowledge'',''x'',''duplicate'',%L)', org, facility, staff_a, owner_actor), 'time_punch_corrections_shape') FROM tc_fixture;
SELECT pg_temp.tc_fail(format('INSERT INTO public.time_punch_corrections(organization_id, facility_id, staff_id, correction_type, target_punch_id, reason, corrected_by) SELECT %L,%L,%L,''void_punch'',id,''duplicate'',%L FROM public.time_punches WHERE staff_id = %L LIMIT 1', org, facility, staff_a, owner_actor, staff_d), 'does not belong') FROM tc_fixture;
DO $$ DECLARE n integer; BEGIN
  BEGIN
    UPDATE public.time_punch_corrections SET note = 'edited' WHERE staff_id = (SELECT staff_a FROM tc_fixture);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'Owner edited % corrections', n; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.time_punch_corrections WHERE staff_id = (SELECT staff_a FROM tc_fixture);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'Owner deleted % corrections', n; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.tc_fail(format('UPDATE public.time_punches SET punched_at = clock_timestamp() WHERE staff_id = %L', staff_a), 'append only') FROM tc_fixture;
SELECT pg_temp.tc_fail(format('DELETE FROM public.time_punch_corrections WHERE staff_id = %L', staff_a), 'append only') FROM tc_fixture;

-- 12. Staff see only their own punches; managers see the facility.
SELECT pg_temp.tc_actor('staff');
SET LOCAL ROLE authenticated;
DO $$ DECLARE own integer; others integer; BEGIN
  SELECT count(*) INTO own FROM public.time_punches WHERE staff_id = (SELECT staff_a FROM tc_fixture);
  SELECT count(*) INTO others FROM public.time_punches WHERE staff_id <> (SELECT staff_a FROM tc_fixture);
  IF own < 5 OR others <> 0 THEN RAISE EXCEPTION 'Staff self view wrong (own %, others %)', own, others; END IF;
  IF (SELECT count(*) FROM public.time_punch_corrections WHERE staff_id <> (SELECT staff_a FROM tc_fixture)) <> 0 THEN RAISE EXCEPTION 'Staff sees other corrections'; END IF;
  BEGIN
    PERFORM public.timeclock_credential_status((SELECT staff_a FROM tc_fixture));
    RAISE EXCEPTION 'Caregiver read credential status';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- 13. Employee numbers are readable by managers for accessible staff only, and never by a caregiver.
SELECT pg_temp.tc_actor('owner');
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
  r := public.timeclock_employee_numbers(ARRAY[(SELECT staff_a FROM tc_fixture), (SELECT staff_d FROM tc_fixture)]);
  IF jsonb_array_length(r) <> 2 OR r::text NOT LIKE '%A-100%' OR r::text LIKE '%pin_hash%' THEN RAISE EXCEPTION 'Employee numbers wrong: %', r; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.tc_actor('staff');
SET LOCAL ROLE authenticated;
SELECT pg_temp.tc_fail(format('SELECT public.timeclock_employee_numbers(ARRAY[%L::uuid])', staff_a), 'forbidden') FROM tc_fixture;
RESET ROLE;

-- 14. Effective punches apply the void and the added punch.
DO $$ DECLARE n_raw integer; n_eff integer; BEGIN
  SELECT count(*) INTO n_raw FROM public.time_punches WHERE staff_id = (SELECT staff_a FROM tc_fixture);
  SELECT count(*) INTO n_eff FROM haven.timeclock_effective_punches((SELECT staff_a FROM tc_fixture), clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 day');
  IF n_eff <> n_raw THEN RAISE EXCEPTION 'Effective count % vs raw % (one void, one add)', n_eff, n_raw; END IF;
END $$;

ROLLBACK;
