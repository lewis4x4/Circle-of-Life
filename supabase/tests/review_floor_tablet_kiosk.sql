-- COL-677 / COL-690 floor tablet and front-door kiosk (migration 494).
-- Spec 40 section 10 item 2. Native scratch-only probe: fixtures and the auth
-- adaptation roll back. Synthetic staff and visitors only ("Probe Alpha" ...).
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;

-- ---------------------------------------------------------------------------
-- 1. Grant posture, before any fixture or role switch.
-- ---------------------------------------------------------------------------
DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.floor_roster(text)', 'public.floor_verify_unlock(text,uuid,text,text)',
    'public.floor_heartbeat(text,uuid)', 'public.floor_end_unlock(text,uuid,text)',
    'public.floor_unlock_for_replay(text,uuid,uuid,timestamptz)',
    'public.floor_replay_complete_rounding_task(text,uuid,uuid,timestamptz,uuid,jsonb)',
    'public.floor_replay_submit_care_event(text,uuid,uuid,timestamptz,jsonb)',
    'public.visitor_kiosk_sign_in(text,uuid,text,text,text,text,text,text,boolean)',
    'public.visitor_kiosk_open_matches(text,text)', 'public.visitor_kiosk_sign_out(text,uuid)',
    'public.timeclock_enroll_device(text,text,text)'
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Floor/kiosk function % must be service_role only', fn;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.visitor_match_resident(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.visitor_match_resident(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.timeclock_create_enrollment_code(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.timeclock_set_device_roster_roles(uuid,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'Manager and front-desk function grants wrong';
  END IF;
  IF to_regprocedure('public.timeclock_create_enrollment_code(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'The one-argument enrollment code signature lingers as an overload';
  END IF;
  FOREACH fn IN ARRAY ARRAY['haven.timeclock_verify_credential_pin(uuid,uuid,uuid,uuid,text,text,text)',
    'haven.floor_replay_user(uuid,uuid)', 'haven.floor_replay_begin(uuid,uuid)', 'haven.floor_roster_members(uuid,timestamptz)'] LOOP
    IF has_function_privilege('authenticated', fn, 'EXECUTE') OR has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Private helper % is executable by a request role', fn;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.floor_unlocks', 'INSERT')
     OR has_table_privilege('authenticated', 'public.floor_unlocks', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.floor_unlocks', 'DELETE')
     OR has_table_privilege('service_role', 'public.floor_unlocks', 'INSERT')
     OR has_table_privilege('service_role', 'public.floor_unlocks', 'UPDATE')
     OR has_table_privilege('service_role', 'public.floor_unlocks', 'DELETE')
     OR has_table_privilege('anon', 'public.floor_unlocks', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.floor_unlocks', 'SELECT') THEN
    RAISE EXCEPTION 'floor_unlocks grant boundary failed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'floor_unlocks' AND cmd <> 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'visitor_log_entries' AND cmd IN ('UPDATE', 'DELETE')) THEN
    RAISE EXCEPTION 'A client write policy exists on floor_unlocks or visitor_log_entries';
  END IF;
  -- One PIN implementation: both callers go through the shared helper, and neither compares a hash itself.
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'haven.timeclock_resolve(text,text,text,text)'::regprocedure) NOT LIKE '%timeclock_verify_credential_pin%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.floor_verify_unlock(text,uuid,text,text)'::regprocedure) NOT LIKE '%timeclock_verify_credential_pin%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'haven.timeclock_resolve(text,text,text,text)'::regprocedure) LIKE '%crypt(%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.floor_verify_unlock(text,uuid,text,text)'::regprocedure) LIKE '%crypt(%' THEN
    RAISE EXCEPTION 'Kiosk and floor do not share one PIN and lockout implementation';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Fixtures
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE fk AS
SELECT gen_random_uuid() owner_user, gen_random_uuid() owner_session,
       gen_random_uuid() a_user, gen_random_uuid() a_session, gen_random_uuid() a_staff,
       gen_random_uuid() b_user, gen_random_uuid() b_session, gen_random_uuid() b_staff,
       gen_random_uuid() h_user, gen_random_uuid() h_staff,          -- housekeeper, on the clock
       gen_random_uuid() g_user, gen_random_uuid() g_staff,          -- med tech at the other facility, on the clock
       gen_random_uuid() t_user, gen_random_uuid() t_staff,          -- med tech, clocked in then terminated
       gen_random_uuid() n_staff,                                    -- on the clock, no login
       gen_random_uuid() o_user, gen_random_uuid() o_staff,          -- med tech, off the clock
       f.id facility, f.organization_id org, f.entity_id entity, r.id resident,
       gen_random_uuid() other_facility,
       gen_random_uuid() org2, gen_random_uuid() ent2, gen_random_uuid() fac2, gen_random_uuid() org2_device,
       gen_random_uuid() plan, gen_random_uuid() rule, gen_random_uuid() task
FROM public.facilities f
JOIN public.residents r ON r.facility_id = f.id AND r.organization_id = f.organization_id AND r.deleted_at IS NULL
WHERE f.deleted_at IS NULL ORDER BY f.name, r.id LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM fk) THEN RAISE EXCEPTION 'Seeded facility with a resident required'; END IF; END $$;

INSERT INTO public.facilities(id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds)
  SELECT other_facility, entity, org, 'Floor scope probe', 'Test', 'Test', '00000', 1 FROM fk;
INSERT INTO public.organizations(id, name) SELECT org2, 'Floor foreign organization probe' FROM fk;
INSERT INTO public.entities(id, organization_id, name) SELECT ent2, org2, 'Floor foreign entity probe' FROM fk;
INSERT INTO public.facilities(id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds)
  SELECT fac2, ent2, org2, 'Floor foreign facility probe', 'Test', 'Test', '00000', 1 FROM fk;

INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
  SELECT u, u || '@floor-review.invalid', '{}'::jsonb, '{}'::jsonb
  FROM fk, unnest(ARRAY[owner_user, a_user, b_user, h_user, g_user, t_user, o_user]) u;
INSERT INTO public.user_profiles(id, email, full_name, app_role, organization_id, is_active)
  SELECT owner_user, owner_user || '@floor-review.invalid', 'Floor owner probe', 'owner'::public.app_role, org, true FROM fk
  UNION ALL SELECT a_user, a_user || '@floor-review.invalid', 'Probe Alpha', 'med_tech'::public.app_role, org, true FROM fk
  UNION ALL SELECT b_user, b_user || '@floor-review.invalid', 'Probe Bravo', 'med_tech'::public.app_role, org, true FROM fk
  UNION ALL SELECT h_user, h_user || '@floor-review.invalid', 'Probe Hotel', 'housekeeper'::public.app_role, org, true FROM fk
  UNION ALL SELECT g_user, g_user || '@floor-review.invalid', 'Probe Golf', 'med_tech'::public.app_role, org, true FROM fk
  UNION ALL SELECT t_user, t_user || '@floor-review.invalid', 'Probe Tango', 'med_tech'::public.app_role, org, true FROM fk
  UNION ALL SELECT o_user, o_user || '@floor-review.invalid', 'Probe Oscar', 'med_tech'::public.app_role, org, true FROM fk;
INSERT INTO auth.sessions(id, user_id)
  SELECT owner_session, owner_user FROM fk UNION ALL SELECT a_session, a_user FROM fk UNION ALL SELECT b_session, b_user FROM fk;
INSERT INTO public.user_facility_access(user_id, facility_id, organization_id)
  SELECT u, facility, org FROM fk, unnest(ARRAY[a_user, b_user, h_user, t_user, o_user]) u;

INSERT INTO public.staff(id, organization_id, facility_id, user_id, first_name, last_name, staff_role, hire_date, employment_status)
  SELECT a_staff, org, facility, a_user, 'Probe', 'Alpha', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM fk
  UNION ALL SELECT b_staff, org, facility, b_user, 'Probe', 'Bravo', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM fk
  UNION ALL SELECT h_staff, org, facility, h_user, 'Probe', 'Hotel', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM fk
  UNION ALL SELECT g_staff, org, other_facility, g_user, 'Probe', 'Golf', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM fk
  UNION ALL SELECT t_staff, org, facility, t_user, 'Probe', 'Tango', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM fk
  UNION ALL SELECT n_staff, org, facility, NULL, 'Probe', 'November', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM fk
  UNION ALL SELECT o_staff, org, facility, o_user, 'Probe', 'Oscar', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM fk;

-- A rounding check for Probe Alpha at the facility, for the replay.
INSERT INTO public.resident_observation_plans(id, organization_id, facility_id, resident_id, status, source_type, effective_from, rationale)
  SELECT plan, org, facility, resident, 'active', 'manual', now(), 'COL-690 floor tablet offline replay regression fixture' FROM fk;
INSERT INTO public.resident_observation_plan_rules(id, plan_id, organization_id, facility_id, resident_id, interval_type, interval_minutes, grace_minutes)
  SELECT rule, plan, org, facility, resident, 'fixed_minutes', 60, 15 FROM fk;
INSERT INTO public.resident_observation_tasks(id, organization_id, facility_id, resident_id, plan_id, plan_rule_id, assigned_staff_id, scheduled_for, due_at, grace_ends_at, status)
  SELECT task, org, facility, resident, plan, rule, a_staff, now() - interval '1 hour', now(), now() + interval '15 minutes', 'upcoming'::public.resident_observation_task_status FROM fk;

CREATE FUNCTION pg_temp.fk_owner() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', f.owner_user, 'session_id', f.owner_session, 'role', 'authenticated',
    'auth_claim_version', p.auth_claim_version)::text, true)::void
  FROM fk f JOIN public.user_profiles p ON p.id = f.owner_user
$$;
CREATE FUNCTION pg_temp.fk_staff(p_user uuid, p_session uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'session_id', p_session, 'role', 'authenticated',
    'auth_claim_version', p.auth_claim_version)::text, true)::void
  FROM public.user_profiles p WHERE p.id = p_user
$$;
CREATE FUNCTION pg_temp.fk_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)::void
$$;
CREATE FUNCTION pg_temp.fk_fail(sql text, expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM) > 0 THEN RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'Expected failure: %', expected;
END $$;
CREATE TEMP TABLE fk_results(name text PRIMARY KEY, value jsonb);
GRANT ALL ON fk_results TO authenticated, service_role;
GRANT SELECT ON fk TO authenticated, service_role;
-- Hosted Supabase grants request roles SELECT on public tables by default; the
-- local replay does not, so state the reads the RLS policies depend on.
GRANT SELECT ON public.staff, public.staff_facility_assignments, public.facilities, public.user_facility_access, public.visitor_log_entries TO authenticated;
GRANT INSERT ON public.visitor_log_entries TO authenticated;

-- Owner: flags on at both facilities, credentials for everyone, three enrollment codes.
SELECT pg_temp.fk_owner();
SET LOCAL ROLE authenticated;
INSERT INTO public.timeclock_facility_settings(organization_id, facility_id, timeclock_enabled, updated_by)
  SELECT org, facility, true, owner_user FROM fk UNION ALL SELECT org, other_facility, true, owner_user FROM fk;
SELECT public.timeclock_set_credentials(a_staff, 'create', 'FA-1', '111111', NULL) FROM fk;
SELECT public.timeclock_set_credentials(b_staff, 'create', 'FB-2', '222222', NULL) FROM fk;
SELECT public.timeclock_set_credentials(h_staff, 'create', 'FH-3', '333333', NULL) FROM fk;
SELECT public.timeclock_set_credentials(g_staff, 'create', 'FG-4', '444444', NULL) FROM fk;
SELECT public.timeclock_set_credentials(t_staff, 'create', 'FT-5', '555555', NULL) FROM fk;
SELECT public.timeclock_set_credentials(n_staff, 'create', 'FN-6', '666666', NULL) FROM fk;
SELECT public.timeclock_set_credentials(o_staff, 'create', 'FO-7', '777777', NULL) FROM fk;
INSERT INTO fk_results SELECT 'kiosk_code', public.timeclock_create_enrollment_code(facility) FROM fk;
INSERT INTO fk_results SELECT 'floor_code', public.timeclock_create_enrollment_code(facility, 'floor') FROM fk;
INSERT INTO fk_results SELECT 'floor2_code', public.timeclock_create_enrollment_code(facility, 'floor') FROM fk;
SELECT pg_temp.fk_fail(format('SELECT public.timeclock_create_enrollment_code(%L, ''kitchen'')', facility), 'invalid device kind') FROM fk;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT value->>'device_kind' FROM fk_results WHERE name = 'kiosk_code') <> 'kiosk'
     OR (SELECT value->>'device_kind' FROM fk_results WHERE name = 'floor_code') <> 'floor' THEN
    RAISE EXCEPTION 'Enrollment code kind wrong';
  END IF;
END $$;
-- Invalid roster roles are data errors, not silently accepted.
SELECT pg_temp.fk_fail(format('UPDATE public.timeclock_facility_settings SET floor_roster_roles = ARRAY[''broker''] WHERE facility_id = %L', facility), 'floor_roster_roles_check') FROM fk;
SELECT pg_temp.fk_fail(format('UPDATE public.timeclock_facility_settings SET floor_roster_roles = ARRAY[''family'',''med_tech''] WHERE facility_id = %L', facility), 'floor_roster_roles_check') FROM fk;
SELECT pg_temp.fk_fail(format('UPDATE public.timeclock_facility_settings SET floor_roster_roles = ARRAY[''not_a_role''] WHERE facility_id = %L', facility), 'floor_roster_roles_check') FROM fk;
SELECT pg_temp.fk_fail(format('UPDATE public.timeclock_facility_settings SET floor_idle_lock_minutes = 0 WHERE facility_id = %L', facility), 'floor_idle_lock_minutes') FROM fk;

-- Enrollment (service_role): the kiosk page cannot consume a floor code.
SELECT pg_temp.fk_service();
SET LOCAL ROLE service_role;
INSERT INTO fk_results SELECT 'floor_via_kiosk_path', public.timeclock_enroll_device(value->>'code', 'Probe floor tablet') FROM fk_results WHERE name = 'floor_code';
INSERT INTO fk_results SELECT 'kiosk', public.timeclock_enroll_device(value->>'code', 'Probe front door') FROM fk_results WHERE name = 'kiosk_code';
INSERT INTO fk_results SELECT 'floor', public.timeclock_enroll_device(value->>'code', 'Probe floor tablet', 'floor') FROM fk_results WHERE name = 'floor_code';
INSERT INTO fk_results SELECT 'floor2', public.timeclock_enroll_device(value->>'code', 'Probe spare tablet', 'floor') FROM fk_results WHERE name = 'floor2_code';
RESET ROLE;
DO $$ BEGIN
  IF (SELECT value->>'error' FROM fk_results WHERE name = 'floor_via_kiosk_path') <> 'code_invalid' THEN RAISE EXCEPTION 'Kiosk path enrolled a floor code'; END IF;
  IF NOT (SELECT (value->>'ok')::boolean FROM fk_results WHERE name = 'floor') OR (SELECT value->>'device_kind' FROM fk_results WHERE name = 'floor') <> 'floor'
     OR (SELECT value->>'device_kind' FROM fk_results WHERE name = 'kiosk') <> 'kiosk' THEN
    RAISE EXCEPTION 'Enrollment kinds wrong';
  END IF;
END $$;

-- A floor device in another organization, enrolled directly (fixture only).
INSERT INTO public.timeclock_devices(id, organization_id, facility_id, label, token_hash, enrolled_by, device_kind)
  SELECT org2_device, org2, fac2, 'Foreign floor probe', haven.timeclock_sha256('foreign-floor-token'), owner_user, 'floor' FROM fk;
INSERT INTO public.timeclock_facility_settings(organization_id, facility_id, timeclock_enabled) SELECT org2, fac2, true FROM fk;

CREATE FUNCTION pg_temp.tok(p_name text) RETURNS text LANGUAGE sql AS $$ SELECT value->>'token' FROM fk_results WHERE name = p_name $$;
CREATE FUNCTION pg_temp.kiosk_punch(p_identifier text, p_pin text, p_type text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.timeclock_record_punch(pg_temp.tok('kiosk'), p_identifier, NULL, p_pin, p_type, clock_timestamp(), gen_random_uuid(), false)
$$;
CREATE FUNCTION pg_temp.unlock(p_token text, p_staff uuid, p_number text, p_pin text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.floor_verify_unlock(p_token, p_staff, p_number, p_pin)
$$;
CREATE FUNCTION pg_temp.roster_ids(p_token text) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg((x->>'staff_id')::uuid), '{}') FROM jsonb_array_elements(public.floor_roster(p_token)->'roster') x
$$;

-- ---------------------------------------------------------------------------
-- 3. Punches: A clocks in at the kiosk; others through direct fixture punches.
--    A floor tablet can never punch.
-- ---------------------------------------------------------------------------
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.kiosk_punch('FA-1', '111111', 'in');
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'Kiosk clock in failed: %', r; END IF;
  r := public.timeclock_record_punch(pg_temp.tok('floor'), 'FB-2', NULL, '222222', 'in', clock_timestamp(), gen_random_uuid(), false);
  IF r->>'error' <> 'device_unknown' THEN RAISE EXCEPTION 'A floor tablet punched: %', r; END IF;
  r := public.timeclock_identify(pg_temp.tok('floor'), 'FB-2', NULL, '222222');
  IF r->>'error' <> 'device_unknown' THEN RAISE EXCEPTION 'A floor tablet identified for a punch: %', r; END IF;
  IF (SELECT failure_count FROM public.timeclock_devices WHERE id = (SELECT (value->>'device_id')::uuid FROM fk_results WHERE name = 'floor')) <> 0 THEN
    RAISE EXCEPTION 'A refused floor punch counted against the floor tablet';
  END IF;
END $$;
INSERT INTO public.time_punches(organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
  SELECT org, facility, s, 'in', clock_timestamp() - interval '2 hours', gen_random_uuid()
  FROM fk, unnest(ARRAY[b_staff, h_staff, t_staff, n_staff]) s
  UNION ALL SELECT org, other_facility, g_staff, 'in', clock_timestamp() - interval '2 hours', gen_random_uuid() FROM fk;
UPDATE public.staff SET employment_status = 'terminated', termination_date = current_date WHERE id = (SELECT t_staff FROM fk);

-- ---------------------------------------------------------------------------
-- 4. The roster lists only on-clock staff in the roster roles, assigned here, with a login.
-- ---------------------------------------------------------------------------
DO $$ DECLARE r jsonb; ids uuid[]; f record; BEGIN
  SELECT * INTO f FROM fk;
  r := public.floor_roster(pg_temp.tok('floor'));
  IF NOT (r->>'ok')::boolean OR r->>'device_label' <> 'Probe floor tablet' OR (r->>'idle_lock_minutes')::int <> 3 OR r->>'facility_name' IS NULL THEN
    RAISE EXCEPTION 'Roster header wrong: %', r - 'roster';
  END IF;
  ids := pg_temp.roster_ids(pg_temp.tok('floor'));
  IF NOT (ids @> ARRAY[f.a_staff, f.b_staff]) THEN RAISE EXCEPTION 'On-clock med techs missing from the roster: %', r; END IF;
  IF ids && ARRAY[f.o_staff] THEN RAISE EXCEPTION 'Roster lists an off-clock person'; END IF;
  IF ids && ARRAY[f.g_staff] THEN RAISE EXCEPTION 'Roster lists another facility''s staff'; END IF;
  IF ids && ARRAY[f.t_staff] THEN RAISE EXCEPTION 'Roster lists a terminated person'; END IF;
  IF ids && ARRAY[f.h_staff] THEN RAISE EXCEPTION 'Roster lists a role outside the facility roster roles'; END IF;
  IF ids && ARRAY[f.n_staff] THEN RAISE EXCEPTION 'Roster lists a person with no login'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'roster') x WHERE (x->>'staff_id')::uuid = f.a_staff
             AND (x->>'display_name' <> 'Probe A.' OR x->>'initials' <> 'PA' OR x->>'role_label' <> 'Med tech'
                  OR x->>'clocked_in_at' IS NULL OR x->'last_on_this_device' <> 'null'::jsonb)) THEN
    RAISE EXCEPTION 'Roster row fields wrong: %', r->'roster';
  END IF;
  -- Facility default widened to housekeepers: now listed. Device list overrides the facility.
  UPDATE public.timeclock_facility_settings SET floor_roster_roles = ARRAY['med_tech', 'housekeeper'] WHERE facility_id = f.facility;
  IF NOT (pg_temp.roster_ids(pg_temp.tok('floor')) @> ARRAY[f.h_staff]) THEN RAISE EXCEPTION 'Facility roster roles ignored'; END IF;
  UPDATE public.timeclock_facility_settings SET floor_roster_roles = ARRAY['med_tech', 'facility_admin'] WHERE facility_id = f.facility;
  -- The foreign organization's tablet lists none of these people.
  IF cardinality(pg_temp.roster_ids('foreign-floor-token')) <> 0 THEN RAISE EXCEPTION 'Foreign tablet lists this organization''s staff'; END IF;
  -- A kiosk token is not a floor token.
  IF public.floor_roster(pg_temp.tok('kiosk'))->>'error' <> 'device_unknown' THEN RAISE EXCEPTION 'Kiosk token read a floor roster'; END IF;
  IF public.floor_roster('no-such-token')->>'error' <> 'device_unknown' THEN RAISE EXCEPTION 'Unknown token read a roster'; END IF;
END $$;

-- Per-device roster roles through the manager function.
SELECT pg_temp.fk_owner();
SET LOCAL ROLE authenticated;
SELECT public.timeclock_set_device_roster_roles((value->>'device_id')::uuid, ARRAY['facility_admin']) FROM fk_results WHERE name = 'floor2';
SELECT pg_temp.fk_fail(format('SELECT public.timeclock_set_device_roster_roles(%L, ARRAY[''family''])', value->>'device_id'), 'invalid roster roles') FROM fk_results WHERE name = 'floor2';
SELECT pg_temp.fk_fail(format('SELECT public.timeclock_set_device_roster_roles(%L, ARRAY[''med_tech''])', value->>'device_id'), 'floor tablets only') FROM fk_results WHERE name = 'kiosk';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.timeclock_list_devices((SELECT facility FROM fk))) d
                 WHERE d->>'device_kind' = 'floor' AND d->'roster_roles' = '["facility_admin"]'::jsonb) THEN
    RAISE EXCEPTION 'Device list lacks kind or roster roles';
  END IF;
END $$;
RESET ROLE;
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM fk;
  IF pg_temp.roster_ids(pg_temp.tok('floor2')) && ARRAY[f.a_staff, f.b_staff] THEN RAISE EXCEPTION 'Device roster roles ignored'; END IF;
  -- Tapping a med tech on a tablet that does not list med techs is refused like a wrong PIN.
  IF pg_temp.unlock(pg_temp.tok('floor2'), f.a_staff, NULL, '111111')->>'error' <> 'not_recognized' THEN RAISE EXCEPTION 'Unlock outside device roster roles'; END IF;
  UPDATE public.timeclock_devices SET roster_roles = NULL, failure_count = 0, failure_window_started_at = NULL WHERE id = (SELECT (value->>'device_id')::uuid FROM fk_results WHERE name = 'floor2');
END $$;

-- ---------------------------------------------------------------------------
-- 5. Unlock, new_unlock, ordering, audit.
-- ---------------------------------------------------------------------------
DO $$ DECLARE r jsonb; f record; n integer; BEGIN
  SELECT * INTO f FROM fk;
  r := pg_temp.unlock(pg_temp.tok('floor'), f.a_staff, NULL, '111111');
  IF NOT (r->>'ok')::boolean OR (r->>'user_id')::uuid <> f.a_user OR r->>'email' <> f.a_user || '@floor-review.invalid'
     OR NOT (r->>'on_clock')::boolean OR (r->>'idle_lock_minutes')::int <> 3 OR r->>'display_name' <> 'Probe A.'
     OR r->>'role_label' <> 'Med tech' OR r->>'clocked_in_at' IS NULL THEN
    RAISE EXCEPTION 'Roster unlock failed: %', r;
  END IF;
  INSERT INTO fk_results VALUES ('unlock_a1', r);
  IF (SELECT count(*) FROM public.audit_log WHERE table_name = 'floor_unlocks' AND record_id = (r->>'unlock_id')::uuid
      AND new_data->>'event' = 'floor_unlocked' AND new_data->>'method' = 'roster' AND NOT (new_data ? 'pin')) <> 1 THEN
    RAISE EXCEPTION 'floor_unlocked audit row missing or not metadata only';
  END IF;
  r := pg_temp.unlock(pg_temp.tok('floor'), f.b_staff, NULL, '222222');
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'Second unlock failed: %', r; END IF;
  INSERT INTO fk_results VALUES ('unlock_b1', r);
  IF (SELECT end_reason FROM public.floor_unlocks WHERE id = (SELECT (value->>'unlock_id')::uuid FROM fk_results WHERE name = 'unlock_a1')) <> 'new_unlock' THEN
    RAISE EXCEPTION 'The previous unlock on the tablet was not ended with new_unlock';
  END IF;
  SELECT count(*) INTO n FROM public.floor_unlocks WHERE device_id = (SELECT (value->>'device_id')::uuid FROM fk_results WHERE name = 'floor') AND ended_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'Tablet has % open unlocks', n; END IF;
  -- Last person on this tablet first.
  IF (public.floor_roster(pg_temp.tok('floor'))->'roster'->0->>'staff_id')::uuid <> f.b_staff THEN RAISE EXCEPTION 'Roster not ordered by last unlock on this tablet'; END IF;
  -- Exactly one of staff id or employee number.
  IF pg_temp.unlock(pg_temp.tok('floor'), f.a_staff, 'FA-1', '111111')->>'error' <> 'not_recognized'
     OR pg_temp.unlock(pg_temp.tok('floor'), NULL, NULL, '111111')->>'error' <> 'not_recognized' THEN
    RAISE EXCEPTION 'Unlock accepted both or neither identifier';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Employee number path: off-clock allowed and recorded; role, login, status enforced.
-- ---------------------------------------------------------------------------
DO $$ DECLARE r jsonb; f record; BEGIN
  SELECT * INTO f FROM fk;
  r := pg_temp.unlock(pg_temp.tok('floor2'), NULL, 'fo-7', '777777');
  IF NOT (r->>'ok')::boolean OR (r->>'on_clock')::boolean THEN RAISE EXCEPTION 'Off-clock employee number unlock failed: %', r; END IF;
  INSERT INTO fk_results VALUES ('unlock_o', r);
  IF (SELECT method FROM public.floor_unlocks WHERE id = (r->>'unlock_id')::uuid) <> 'employee_number' THEN RAISE EXCEPTION 'Method not recorded'; END IF;
  -- The same person tapped on the roster while off the clock: not listed, so not recognized.
  IF pg_temp.unlock(pg_temp.tok('floor2'), f.o_staff, NULL, '777777')->>'error' <> 'not_recognized' THEN RAISE EXCEPTION 'Off-clock roster tap unlocked'; END IF;
  IF pg_temp.unlock(pg_temp.tok('floor2'), NULL, 'FH-3', '333333')->>'error' <> 'not_allowed' THEN RAISE EXCEPTION 'Housekeeper unlocked a med tech tablet'; END IF;
  IF pg_temp.unlock(pg_temp.tok('floor2'), NULL, 'FN-6', '666666')->>'error' <> 'no_login' THEN RAISE EXCEPTION 'Staff without a login unlocked'; END IF;
  IF pg_temp.unlock(pg_temp.tok('floor2'), NULL, 'FT-5', '555555')->>'error' <> 'not_recognized' THEN RAISE EXCEPTION 'Terminated staff unlocked'; END IF;
  IF pg_temp.unlock(pg_temp.tok('floor2'), NULL, 'FG-4', '444444')->>'error' <> 'not_recognized' THEN RAISE EXCEPTION 'Other facility''s staff unlocked'; END IF;
  -- A wrong PIN never reaches the role or login answers.
  IF pg_temp.unlock(pg_temp.tok('floor2'), NULL, 'FN-6', '000000')->>'error' <> 'not_recognized' THEN RAISE EXCEPTION 'Login state leaked before the PIN'; END IF;
  -- The foreign organization's tablet recognizes nobody here, by tap or by number.
  IF pg_temp.unlock('foreign-floor-token', f.a_staff, NULL, '111111')->>'error' <> 'not_recognized'
     OR pg_temp.unlock('foreign-floor-token', NULL, 'FA-1', '111111')->>'error' <> 'not_recognized' THEN
    RAISE EXCEPTION 'Foreign tablet unlocked for this organization';
  END IF;
  IF pg_temp.unlock(pg_temp.tok('kiosk'), f.a_staff, NULL, '111111')->>'error' <> 'device_unknown' THEN RAISE EXCEPTION 'Kiosk token unlocked a floor session'; END IF;
  UPDATE public.timeclock_devices SET failure_count = 0, failure_window_started_at = NULL, throttled_until = NULL WHERE device_kind = 'floor';
  UPDATE public.timeclock_credentials SET failed_attempts = 0 WHERE organization_id = f.org;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Five bad PINs lock the credential, and the lock is the kiosk's lock too.
-- ---------------------------------------------------------------------------
DO $$ DECLARE r jsonb; f record; i integer; BEGIN
  SELECT * INTO f FROM fk;
  FOR i IN 1..5 LOOP
    r := pg_temp.unlock(pg_temp.tok('floor'), f.b_staff, NULL, '000000');
    IF r->>'error' <> 'not_recognized' THEN RAISE EXCEPTION 'Bad PIN % gave %', i, r; END IF;
  END LOOP;
  r := pg_temp.unlock(pg_temp.tok('floor'), f.b_staff, NULL, '222222');
  IF r->>'error' <> 'locked' THEN RAISE EXCEPTION 'Sixth attempt not locked: %', r; END IF;
  r := public.timeclock_identify(pg_temp.tok('kiosk'), 'FB-2', NULL, '222222');
  IF r->>'error' <> 'locked' THEN RAISE EXCEPTION 'Floor lockout not shared with the kiosk: %', r; END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE table_name = 'timeclock_credentials' AND record_id = f.b_staff AND new_data->>'event' = 'credential_locked') <> 1 THEN
    RAISE EXCEPTION 'credential_locked audit missing';
  END IF;
  -- And the other way: kiosk misses count toward the same five.
  UPDATE public.timeclock_credentials SET locked_until = NULL, failed_attempts = 0 WHERE staff_id = f.b_staff;
  FOR i IN 1..4 LOOP PERFORM public.timeclock_identify(pg_temp.tok('kiosk'), 'FB-2', NULL, '000000'); END LOOP;
  PERFORM pg_temp.unlock(pg_temp.tok('floor'), f.b_staff, NULL, '000000');
  IF public.timeclock_identify(pg_temp.tok('kiosk'), 'FB-2', NULL, '222222')->>'error' <> 'locked' THEN RAISE EXCEPTION 'Kiosk and floor misses are counted apart'; END IF;
  UPDATE public.timeclock_credentials SET locked_until = NULL, failed_attempts = 0 WHERE staff_id = f.b_staff;
  UPDATE public.timeclock_devices SET failure_count = 0, failure_window_started_at = NULL, throttled_until = NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Twenty bad PINs throttle the tablet (and only that tablet).
-- ---------------------------------------------------------------------------
DO $$ DECLARE r jsonb; f record; i integer; BEGIN
  SELECT * INTO f FROM fk;
  FOR i IN 1..20 LOOP PERFORM pg_temp.unlock(pg_temp.tok('floor'), NULL, 'NOBODY', '000000'); END LOOP;
  r := pg_temp.unlock(pg_temp.tok('floor'), f.a_staff, NULL, '111111');
  IF r->>'error' <> 'device_throttled' THEN RAISE EXCEPTION 'Tablet not throttled: %', r; END IF;
  IF (public.floor_roster(pg_temp.tok('floor'))->>'throttled_until') IS NULL THEN RAISE EXCEPTION 'Roster hides the throttle'; END IF;
  IF NOT (public.timeclock_identify(pg_temp.tok('kiosk'), 'FA-1', NULL, '111111')->>'ok')::boolean THEN RAISE EXCEPTION 'Throttle leaked to another device'; END IF;
  UPDATE public.timeclock_devices SET throttled_until = NULL, failure_count = 0, failure_window_started_at = NULL;
  -- Facility flag off: facility_off.
  UPDATE public.timeclock_facility_settings SET timeclock_enabled = false WHERE facility_id = f.facility;
  IF pg_temp.unlock(pg_temp.tok('floor'), f.a_staff, NULL, '111111')->>'error' <> 'facility_off'
     OR public.floor_roster(pg_temp.tok('floor'))->>'error' <> 'facility_off' THEN
    RAISE EXCEPTION 'Facility flag off ignored';
  END IF;
  UPDATE public.timeclock_facility_settings SET timeclock_enabled = true WHERE facility_id = f.facility;
END $$;

-- ---------------------------------------------------------------------------
-- 9. floor_unlocks is insert plus one end, for every role including the owner.
-- ---------------------------------------------------------------------------
SELECT pg_temp.fk_fail(format('UPDATE public.floor_unlocks SET staff_id = %L WHERE id = %L', o_staff, (SELECT value->>'unlock_id' FROM fk_results WHERE name = 'unlock_b1')), 'insert plus one end') FROM fk;
SELECT pg_temp.fk_fail(format('UPDATE public.floor_unlocks SET started_at = started_at - interval ''1 hour'' WHERE id = %L', (SELECT value->>'unlock_id' FROM fk_results WHERE name = 'unlock_b1')), 'insert plus one end');
SELECT pg_temp.fk_fail(format('UPDATE public.floor_unlocks SET ended_at = clock_timestamp(), end_reason = ''idle'', on_clock = false WHERE id = %L', (SELECT value->>'unlock_id' FROM fk_results WHERE name = 'unlock_b1')), 'insert plus one end');
-- A second end of an already ended row.
SELECT pg_temp.fk_fail(format('UPDATE public.floor_unlocks SET ended_at = clock_timestamp(), end_reason = ''idle'' WHERE id = %L', (SELECT value->>'unlock_id' FROM fk_results WHERE name = 'unlock_a1')), 'insert plus one end');
SELECT pg_temp.fk_fail(format('DELETE FROM public.floor_unlocks WHERE id = %L', (SELECT value->>'unlock_id' FROM fk_results WHERE name = 'unlock_a1')), 'insert plus one end');
SELECT pg_temp.fk_fail('TRUNCATE public.floor_unlocks', 'append only');
SET LOCAL ROLE service_role;
SELECT pg_temp.fk_fail(format('DELETE FROM public.floor_unlocks WHERE id = %L', (SELECT value->>'unlock_id' FROM fk_results WHERE name = 'unlock_a1')), 'permission denied');
RESET ROLE;
-- An end must carry its reason.
SELECT pg_temp.fk_fail(format('UPDATE public.floor_unlocks SET ended_at = clock_timestamp() WHERE id = %L', (SELECT value->>'unlock_id' FROM fk_results WHERE name = 'unlock_o')), 'insert plus one end');

-- ---------------------------------------------------------------------------
-- 10. Staff read their own unlocks; managers read the facility; nobody writes.
-- ---------------------------------------------------------------------------
SELECT pg_temp.fk_staff(a_user, a_session) FROM fk;
SET LOCAL ROLE authenticated;
DO $$ DECLARE own integer; others integer; BEGIN
  SELECT count(*) FILTER (WHERE user_id = (SELECT a_user FROM fk)), count(*) FILTER (WHERE user_id <> (SELECT a_user FROM fk)) INTO own, others FROM public.floor_unlocks;
  IF own < 1 OR others <> 0 THEN RAISE EXCEPTION 'Staff unlock view wrong (own %, others %)', own, others; END IF;
  BEGIN
    UPDATE public.floor_unlocks SET ended_at = clock_timestamp(), end_reason = 'idle';
    RAISE EXCEPTION 'Staff updated floor_unlocks';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.fk_owner();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(DISTINCT user_id) FROM public.floor_unlocks) < 3 THEN RAISE EXCEPTION 'Manager cannot read the facility''s unlocks'; END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 11. Heartbeat and end.
-- ---------------------------------------------------------------------------
DO $$ DECLARE r jsonb; f record; b uuid; o uuid; aged uuid; BEGIN
  SELECT * INTO f FROM fk;
  b := (SELECT (value->>'unlock_id')::uuid FROM fk_results WHERE name = 'unlock_b1');
  o := (SELECT (value->>'unlock_id')::uuid FROM fk_results WHERE name = 'unlock_o');
  r := public.floor_heartbeat(pg_temp.tok('floor'), b);
  IF NOT (r->>'active')::boolean THEN RAISE EXCEPTION 'Live unlock inactive: %', r; END IF;
  IF public.floor_heartbeat(pg_temp.tok('floor2'), b)->>'reason' <> 'unknown' THEN RAISE EXCEPTION 'Another tablet''s unlock answered'; END IF;
  IF public.floor_heartbeat('foreign-floor-token', b)->>'reason' <> 'unknown' THEN RAISE EXCEPTION 'Foreign tablet read an unlock'; END IF;
  IF public.floor_heartbeat('no-such-token', b)->>'reason' <> 'device_revoked' THEN RAISE EXCEPTION 'Unknown token not told to lock'; END IF;
  -- B punches out: next heartbeat ends B's roster unlock as clocked_out.
  INSERT INTO public.time_punches(organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
    VALUES (f.org, f.facility, f.b_staff, 'out', clock_timestamp(), gen_random_uuid());
  r := public.floor_heartbeat(pg_temp.tok('floor'), b);
  IF (r->>'active')::boolean OR r->>'reason' <> 'clocked_out' OR (SELECT end_reason FROM public.floor_unlocks WHERE id = b) <> 'clocked_out' THEN
    RAISE EXCEPTION 'Off-clock roster unlock kept alive: %', r;
  END IF;
  IF public.floor_heartbeat(pg_temp.tok('floor'), b)->>'reason' <> 'clocked_out' THEN RAISE EXCEPTION 'Ended unlock reason not repeated'; END IF;
  -- An employee-number unlock is never ended by the off-clock rule.
  IF NOT (public.floor_heartbeat(pg_temp.tok('floor2'), o)->>'active')::boolean THEN RAISE EXCEPTION 'Employee number unlock ended as off the clock'; END IF;
  -- 12-hour cap (fixture row inserted directly: the guard allows inserts only through the owner).
  INSERT INTO public.floor_unlocks(organization_id, facility_id, device_id, staff_id, user_id, method, on_clock, started_at)
    VALUES (f.org, f.facility, (SELECT (value->>'device_id')::uuid FROM fk_results WHERE name = 'floor'), f.a_staff, f.a_user, 'roster', true, clock_timestamp() - interval '13 hours')
    RETURNING id INTO aged;
  IF public.floor_heartbeat(pg_temp.tok('floor'), aged)->>'reason' <> 'max_age' THEN RAISE EXCEPTION 'Unlock older than 12 hours kept alive'; END IF;
  -- End: reasons are the client subset; idempotent; another tablet refused.
  IF public.floor_end_unlock(pg_temp.tok('floor2'), o, 'max_age')->>'error' <> 'invalid_reason' THEN RAISE EXCEPTION 'Client sent a server-only end reason'; END IF;
  IF public.floor_end_unlock(pg_temp.tok('floor'), o, 'idle')->>'error' <> 'unknown' THEN RAISE EXCEPTION 'Ended another tablet''s unlock'; END IF;
  r := public.floor_end_unlock(pg_temp.tok('floor2'), o, 'switch');
  IF NOT (r->>'ok')::boolean OR r->>'end_reason' <> 'switch' THEN RAISE EXCEPTION 'End failed: %', r; END IF;
  r := public.floor_end_unlock(pg_temp.tok('floor2'), o, 'sleep');
  IF NOT (r->>'ok')::boolean OR r->>'end_reason' <> 'switch' THEN RAISE EXCEPTION 'Second end not idempotent: %', r; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 12. Replay: owner, device and capture window are all proven.
-- ---------------------------------------------------------------------------
SELECT pg_temp.fk_service();
DO $$ DECLARE r jsonb; f record; a1 uuid; a1_start timestamptz; a1_end timestamptz; BEGIN
  SELECT * INTO f FROM fk;
  SELECT id, started_at, ended_at INTO a1, a1_start, a1_end FROM public.floor_unlocks
  WHERE id = (SELECT (value->>'unlock_id')::uuid FROM fk_results WHERE name = 'unlock_a1');
  r := public.floor_unlock_for_replay(pg_temp.tok('floor'), a1, f.a_user, a1_start + (a1_end - a1_start) / 2);
  IF NOT (r->>'ok')::boolean OR (r->>'staff_id')::uuid <> f.a_staff OR r->>'app_role' <> 'med_tech' OR (r->>'facility_id')::uuid <> f.facility THEN
    RAISE EXCEPTION 'Replay proof failed: %', r;
  END IF;
  IF public.floor_unlock_for_replay(pg_temp.tok('floor'), a1, f.b_user, a1_start)->>'error' <> 'unlock_mismatch' THEN RAISE EXCEPTION 'Replay accepted another person''s unlock'; END IF;
  IF public.floor_unlock_for_replay(pg_temp.tok('floor2'), a1, f.a_user, a1_start)->>'error' <> 'unlock_mismatch' THEN RAISE EXCEPTION 'Replay accepted another tablet'; END IF;
  IF public.floor_unlock_for_replay('foreign-floor-token', a1, f.a_user, a1_start)->>'error' <> 'unlock_mismatch' THEN RAISE EXCEPTION 'Replay accepted a foreign tablet'; END IF;
  IF public.floor_unlock_for_replay(pg_temp.tok('kiosk'), a1, f.a_user, a1_start)->>'error' <> 'device_unknown' THEN RAISE EXCEPTION 'Replay accepted a kiosk token'; END IF;
  IF public.floor_unlock_for_replay(pg_temp.tok('floor'), a1, f.a_user, a1_start - interval '10 minutes')->>'error' <> 'outside_unlock'
     OR public.floor_unlock_for_replay(pg_temp.tok('floor'), a1, f.a_user, a1_end + interval '10 minutes')->>'error' <> 'outside_unlock'
     OR public.floor_unlock_for_replay(pg_temp.tok('floor'), a1, f.a_user, clock_timestamp() + interval '1 hour')->>'error' <> 'outside_unlock'
     OR public.floor_unlock_for_replay(pg_temp.tok('floor'), a1, f.a_user, NULL)->>'error' <> 'outside_unlock' THEN
    RAISE EXCEPTION 'Replay accepted a capture time outside the unlock';
  END IF;
  -- Within the documented two-minute skew.
  IF NOT (public.floor_unlock_for_replay(pg_temp.tok('floor'), a1, f.a_user, a1_start - interval '90 seconds')->>'ok')::boolean THEN
    RAISE EXCEPTION 'Replay refused honest clock skew';
  END IF;
END $$;

-- Without the wrapper, a null session is still refused by the rounding writer,
-- even with the replay setting forged but no matching sub.
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM fk;
  BEGIN
    PERFORM public.complete_rounding_task_review(f.task, f.a_user, 'med_tech', NULL,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id = f.a_user), f.org, f.facility, f.a_staff,
      jsonb_build_object('request_id', gen_random_uuid(), 'observed_at', clock_timestamp(), 'quick_status', 'calm', 'offline', true));
    RAISE EXCEPTION 'A session-less rounding completion was accepted outside a floor replay';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('haven.floor_replay_unlock', (SELECT value->>'unlock_id' FROM fk_results WHERE name = 'unlock_a1'), true);
  BEGIN
    PERFORM public.complete_rounding_task_review(f.task, f.a_user, 'med_tech', NULL,
      (SELECT auth_claim_version FROM public.user_profiles WHERE id = f.a_user), f.org, f.facility, f.a_staff,
      jsonb_build_object('request_id', gen_random_uuid(), 'observed_at', clock_timestamp(), 'quick_status', 'calm', 'offline', true));
    RAISE EXCEPTION 'A forged replay setting without the owner''s sub was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM haven.current_authorized_actor()) <> 0 THEN RAISE EXCEPTION 'Forged replay setting resolved an actor'; END IF;
  PERFORM set_config('haven.floor_replay_unlock', '', true);
END $$;

-- A's queued check replays after B used the tablet, attributed to A.
DO $$ DECLARE r jsonb; f record; a1 uuid; a1_start timestamptz; log record; BEGIN
  SELECT * INTO f FROM fk;
  SELECT id, started_at INTO a1, a1_start FROM public.floor_unlocks WHERE id = (SELECT (value->>'unlock_id')::uuid FROM fk_results WHERE name = 'unlock_a1');
  r := public.floor_replay_complete_rounding_task(pg_temp.tok('floor'), a1, f.b_user, a1_start, f.task,
    jsonb_build_object('request_id', gen_random_uuid(), 'observed_at', a1_start, 'quick_status', 'calm'));
  IF r->>'error' <> 'unlock_mismatch' THEN RAISE EXCEPTION 'Rounding replay as another person: %', r; END IF;
  r := public.floor_replay_complete_rounding_task(pg_temp.tok('floor'), a1, f.a_user, a1_start, f.task,
    jsonb_build_object('request_id', gen_random_uuid(), 'observed_at', a1_start, 'quick_status', 'calm', 'resident_location', 'room'));
  IF NOT (r->>'ok')::boolean OR r->>'log_id' IS NULL THEN RAISE EXCEPTION 'Rounding replay failed: %', r; END IF;
  SELECT staff_id, created_by, entry_mode::text AS entry_mode INTO log FROM public.resident_observation_logs WHERE id = (r->>'log_id')::uuid;
  IF log.staff_id <> f.a_staff OR log.created_by <> f.a_user OR log.entry_mode <> 'offline_synced' THEN
    RAISE EXCEPTION 'Replayed check not attributed to its owner: %', row_to_json(log);
  END IF;
  -- The wrapper puts the request identity back.
  IF COALESCE(current_setting('haven.floor_replay_unlock', true), '') <> '' OR auth.jwt() ? 'sub' OR auth.jwt()->>'role' <> 'service_role' THEN
    RAISE EXCEPTION 'Replay identity leaked past the wrapper: %', auth.jwt();
  END IF;
END $$;

-- A's queued report replays as A; a report for another facility is refused.
DO $$ DECLARE r jsonb; f record; a1 uuid; a1_start timestamptz; BEGIN
  SELECT * INTO f FROM fk;
  SELECT id, started_at INTO a1, a1_start FROM public.floor_unlocks WHERE id = (SELECT (value->>'unlock_id')::uuid FROM fk_results WHERE name = 'unlock_a1');
  r := public.floor_replay_submit_care_event(pg_temp.tok('floor'), a1, f.a_user, a1_start,
    jsonb_build_object('client_event_id', gen_random_uuid(), 'facility_id', f.other_facility, 'kind', 'environment', 'answers', jsonb_build_object('what', 'broken_equipment')));
  IF r->>'error' <> 'wrong_facility' THEN RAISE EXCEPTION 'Care event replay for another facility: %', r; END IF;
  r := public.floor_replay_submit_care_event(pg_temp.tok('floor'), a1, f.a_user, a1_start,
    jsonb_build_object('client_event_id', gen_random_uuid(), 'facility_id', f.facility, 'kind', 'environment', 'captured_offline', true,
      'queue_owner_user_id', f.a_user, 'answers', jsonb_build_object('what', 'broken_equipment')));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'Care event replay failed: %', r; END IF;
  IF (SELECT reported_by FROM public.care_events WHERE organization_id = f.org ORDER BY created_at DESC LIMIT 1) <> f.a_user THEN
    RAISE EXCEPTION 'Replayed report not attributed to its owner';
  END IF;
  IF COALESCE(current_setting('haven.floor_replay_unlock', true), '') <> '' OR auth.jwt() ? 'sub' THEN RAISE EXCEPTION 'Replay identity leaked past the care event wrapper'; END IF;
END $$;

-- A revoked tablet: roster, unlock, heartbeat and replay all stop; its open unlock ends.
DO $$ DECLARE r jsonb; f record; BEGIN
  SELECT * INTO f FROM fk;
  r := pg_temp.unlock(pg_temp.tok('floor2'), f.a_staff, NULL, '111111');
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'Unlock before revoke failed: %', r; END IF;
  INSERT INTO fk_results VALUES ('unlock_a_floor2', r);
END $$;
SELECT pg_temp.fk_owner();
SET LOCAL ROLE authenticated;
SELECT public.timeclock_revoke_device((value->>'device_id')::uuid) FROM fk_results WHERE name = 'floor2';
RESET ROLE;
SELECT pg_temp.fk_service();
DO $$ DECLARE f record; u uuid; BEGIN
  SELECT * INTO f FROM fk;
  u := (SELECT (value->>'unlock_id')::uuid FROM fk_results WHERE name = 'unlock_a_floor2');
  IF (SELECT end_reason FROM public.floor_unlocks WHERE id = u) <> 'device_revoked' THEN RAISE EXCEPTION 'Revoke left the unlock open'; END IF;
  IF public.floor_roster(pg_temp.tok('floor2'))->>'error' <> 'device_unknown'
     OR pg_temp.unlock(pg_temp.tok('floor2'), f.a_staff, NULL, '111111')->>'error' <> 'device_unknown'
     OR public.floor_heartbeat(pg_temp.tok('floor2'), u)->>'reason' <> 'device_revoked'
     OR public.floor_unlock_for_replay(pg_temp.tok('floor2'), u, f.a_user, clock_timestamp())->>'error' <> 'device_unknown' THEN
    RAISE EXCEPTION 'A revoked tablet still works';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 13. Visitor kiosk.
-- ---------------------------------------------------------------------------
DO $$ DECLARE r jsonb; r2 jsonb; f record; c uuid := gen_random_uuid(); res record; e record; BEGIN
  SELECT * INTO f FROM fk;
  SELECT first_name, last_name INTO res FROM public.residents WHERE id = f.resident;
  -- Floor tokens are not kiosk tokens.
  IF public.visitor_kiosk_sign_in(pg_temp.tok('floor'), gen_random_uuid(), 'vendor_contractor', 'Probe Vendor', NULL, 'Probe Co', NULL, NULL, false)->>'error' <> 'device_unknown'
     OR public.visitor_kiosk_open_matches(pg_temp.tok('floor'), 'Probe')->>'error' <> 'device_unknown' THEN
    RAISE EXCEPTION 'A floor token reached the visitor kiosk';
  END IF;
  -- Visitor log works with the timeclock flag off.
  UPDATE public.timeclock_facility_settings SET timeclock_enabled = false WHERE facility_id = f.facility;
  r := public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), c, 'family_friend', '  Visitorprobe Quebec  ', '555-0100', NULL, 'Typed resident probe', NULL, false);
  UPDATE public.timeclock_facility_settings SET timeclock_enabled = true WHERE facility_id = f.facility;
  IF NOT (r->>'ok')::boolean OR (r->>'replayed')::boolean THEN RAISE EXCEPTION 'Kiosk sign in failed: %', r; END IF;
  r2 := public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), c, 'family_friend', 'Visitorprobe Quebec', NULL, NULL, 'Typed resident probe', NULL, false);
  IF NOT (r2->>'replayed')::boolean OR r2->>'entry_id' <> r->>'entry_id'
     OR (SELECT count(*) FROM public.visitor_log_entries WHERE kiosk_client_entry_id = c) <> 1 THEN
    RAISE EXCEPTION 'Kiosk sign in not idempotent: % / %', r, r2;
  END IF;
  SELECT * INTO e FROM public.visitor_log_entries WHERE id = (r->>'entry_id')::uuid;
  IF e.visitor_name <> 'Visitorprobe Quebec' OR e.signed_in_by IS NOT NULL OR e.resident_id IS NOT NULL OR e.visiting_type IS NOT NULL
     OR e.screening_passed IS NOT TRUE OR e.kiosk_device_id IS NULL THEN
    RAISE EXCEPTION 'Kiosk entry stored wrong: %', row_to_json(e);
  END IF;
  INSERT INTO fk_results VALUES ('visit', r);
  -- Company rules, name bounds, symptoms.
  IF public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'vendor_contractor', 'Probe Vendor', NULL, NULL, NULL, 'Ice machine', false)->>'error' <> 'invalid_input'
     OR public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'surveyor_regulator', 'Probe Inspector', NULL, '  ', NULL, NULL, false)->>'error' <> 'invalid_input'
     OR public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'family_friend', 'Probe Visitor', NULL, 'Probe Co', 'Typed', NULL, false)->>'error' <> 'invalid_input'
     OR public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'family_friend', '   ', NULL, NULL, 'Typed', NULL, false)->>'error' <> 'invalid_input'
     OR public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'family', 'Probe Visitor', NULL, NULL, 'Typed', NULL, false)->>'error' <> 'invalid_input' THEN
    RAISE EXCEPTION 'Kiosk sign in validation too loose';
  END IF;
  r := public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'healthcare_provider', 'Visitorprobe Romeo', NULL, 'Probe Home Health', NULL, NULL, true);
  IF (SELECT screening_passed FROM public.visitor_log_entries WHERE id = (r->>'entry_id')::uuid) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Reported symptoms did not fail screening';
  END IF;
  r := public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'surveyor_regulator', 'Probe Sierra', NULL, 'Probe Agency', NULL, NULL, false);
  IF (SELECT screening_passed FROM public.visitor_log_entries WHERE id = (r->>'entry_id')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'Inspector recorded as screened without being asked';
  END IF;
  -- Open matches: nothing under three letters, never a resident or typed name, at most five.
  IF jsonb_array_length(public.visitor_kiosk_open_matches(pg_temp.tok('kiosk'), 'Vi')->'matches') <> 0
     OR jsonb_array_length(public.visitor_kiosk_open_matches(pg_temp.tok('kiosk'), 'V1-')->'matches') <> 0 THEN
    RAISE EXCEPTION 'Open matches listed before three letters';
  END IF;
  r := public.visitor_kiosk_open_matches(pg_temp.tok('kiosk'), 'visitorp');
  IF jsonb_array_length(r->'matches') <> 2 OR NOT (r->'matches' @> jsonb_build_array(jsonb_build_object('display_name', 'Visitorprobe Q.', 'type_label', 'Visiting a resident'))) THEN
    RAISE EXCEPTION 'Open matches wrong: %', r;
  END IF;
  IF r::text LIKE '%Typed resident%' OR r::text LIKE '%' || res.first_name || ' ' || res.last_name || '%' OR r::text LIKE '%555-0100%' OR r::text LIKE '%Quebec%' THEN
    RAISE EXCEPTION 'Open matches leak a resident, typed name, phone or full name: %', r;
  END IF;
  IF jsonb_array_length(public.visitor_kiosk_open_matches(pg_temp.tok('kiosk'), 'vis%')->'matches') <> 0 THEN RAISE EXCEPTION 'Prefix wildcard not escaped'; END IF;
  FOR i IN 1..6 LOOP
    PERFORM public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'vendor_contractor', 'Manyprobe ' || i, NULL, 'Probe Co', NULL, NULL, false);
  END LOOP;
  IF jsonb_array_length(public.visitor_kiosk_open_matches(pg_temp.tok('kiosk'), 'Manyprobe')->'matches') <> 5 THEN RAISE EXCEPTION 'Open matches not capped at five'; END IF;
  -- Sign out once, as kiosk_self.
  r := public.visitor_kiosk_sign_out(pg_temp.tok('kiosk'), (SELECT (value->>'entry_id')::uuid FROM fk_results WHERE name = 'visit'));
  IF NOT (r->>'ok')::boolean OR r->>'display_name' <> 'Visitorprobe Q.'
     OR (SELECT sign_out_method FROM public.visitor_log_entries WHERE id = (SELECT (value->>'entry_id')::uuid FROM fk_results WHERE name = 'visit')) <> 'kiosk_self' THEN
    RAISE EXCEPTION 'Kiosk sign out failed: %', r;
  END IF;
  IF public.visitor_kiosk_sign_out(pg_temp.tok('kiosk'), (SELECT (value->>'entry_id')::uuid FROM fk_results WHERE name = 'visit'))->>'error' <> 'already_signed_out' THEN
    RAISE EXCEPTION 'Signed out twice';
  END IF;
  IF public.visitor_kiosk_sign_out(pg_temp.tok('kiosk'), gen_random_uuid())->>'error' <> 'not_found' THEN RAISE EXCEPTION 'Unknown entry signed out'; END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE table_name = 'visitor_log_entries' AND record_id = (SELECT (value->>'entry_id')::uuid FROM fk_results WHERE name = 'visit')
      AND new_data->>'event' IN ('visitor_signed_in_kiosk', 'visitor_signed_out_kiosk')) <> 2 THEN
    RAISE EXCEPTION 'Kiosk visitor audit rows missing';
  END IF;
END $$;

-- Front desk matches the typed resident, once; a staff client cannot forge a kiosk row.
SELECT pg_temp.fk_owner();
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; e record; f record; BEGIN
  SELECT * INTO f FROM fk;
  r := public.visitor_match_resident((SELECT (value->>'entry_id')::uuid FROM fk_results WHERE name = 'visit'), f.resident);
  SELECT * INTO e FROM public.visitor_log_entries WHERE id = (r->>'entry_id')::uuid;
  IF (r->>'resident_id')::uuid <> f.resident OR e.visiting_type <> 'resident' OR e.visiting_name_text <> 'Typed resident probe'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k) <> ARRAY['entry_id', 'resident_id'] THEN
    RAISE EXCEPTION 'Match resident failed or returned more than two ids: %', r;
  END IF;
  BEGIN
    PERFORM public.visitor_match_resident(e.id, f.resident);
    RAISE EXCEPTION 'Matched twice';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.visitor_log_entries(organization_id, facility_id, visitor_name, visitor_type, kiosk_device_id, kiosk_client_entry_id)
      VALUES (f.org, f.facility, 'Forged kiosk probe', 'vendor_contractor', (SELECT (value->>'device_id')::uuid FROM fk_results WHERE name = 'kiosk'), gen_random_uuid());
    RAISE EXCEPTION 'Staff client forged a kiosk entry';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 14. One clock: where the kiosk timeclock is on, staff cannot clock themselves
--     in through time_records; managers can still add a record.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.time_records TO authenticated;
SELECT pg_temp.fk_staff(b_user, b_session) FROM fk;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM fk;
  BEGIN
    INSERT INTO public.time_records(staff_id, facility_id, organization_id, clock_in, clock_in_method, created_by)
      VALUES (f.b_staff, f.facility, f.org, clock_timestamp(), 'mobile', f.b_user);
    RAISE EXCEPTION 'Staff clocked in through time_records where the kiosk timeclock is on';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.timeclock_facility_settings SET timeclock_enabled = false WHERE facility_id = (SELECT facility FROM fk);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; rec uuid; BEGIN
  SELECT * INTO f FROM fk;
  INSERT INTO public.time_records(staff_id, facility_id, organization_id, clock_in, clock_in_method, created_by)
    VALUES (f.b_staff, f.facility, f.org, clock_timestamp() - interval '1 hour', 'mobile', f.b_user) RETURNING id INTO rec;
  INSERT INTO fk_results VALUES ('self_clock_in', to_jsonb(rec));
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM fk_results WHERE name = 'self_clock_in') THEN RAISE EXCEPTION 'Staff self clock in refused with the kiosk timeclock off'; END IF;
END $$;
-- Flag back on: the open record can be closed, not kept open or reopened.
UPDATE public.timeclock_facility_settings SET timeclock_enabled = true WHERE facility_id = (SELECT facility FROM fk);
SET LOCAL ROLE authenticated;
DO $$ DECLARE rec uuid := (SELECT (value #>> '{}')::uuid FROM fk_results WHERE name = 'self_clock_in'); n integer; BEGIN
  BEGIN
    UPDATE public.time_records SET clock_in = clock_in - interval '5 minutes' WHERE id = rec;
    RAISE EXCEPTION 'Staff kept a time record open where the kiosk timeclock is on';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.time_records SET clock_out = clock_timestamp(), clock_out_method = 'mobile' WHERE id = rec;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Staff could not close an open time record (% rows)', n; END IF;
  BEGIN
    UPDATE public.time_records SET clock_out = NULL WHERE id = rec;
    RAISE EXCEPTION 'Staff reopened a time record where the kiosk timeclock is on';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Manager path unchanged: the owner adds a record for a staff member with the flag on.
SELECT pg_temp.fk_owner();
SET LOCAL ROLE authenticated;
INSERT INTO public.time_records(staff_id, facility_id, organization_id, clock_in, clock_out, clock_in_method, created_by)
  SELECT b_staff, facility, org, clock_timestamp() - interval '3 hours', clock_timestamp() - interval '2 hours', 'manual', owner_user FROM fk;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 15. Kiosk receipts carry display_name and last_out_at (screens 12 and 13).
-- ---------------------------------------------------------------------------
DO $$ DECLARE r jsonb; r2 jsonb; c uuid := gen_random_uuid(); BEGIN
  r := public.timeclock_identify(pg_temp.tok('kiosk'), 'FA-1', NULL, '111111');
  IF NOT (r->>'ok')::boolean OR r->>'display_name' <> 'Probe A.' OR r->>'first_name' <> 'Probe' OR r->>'state' <> 'in'
     OR NOT (r ? 'last_out_at') OR r->'last_out_at' <> 'null'::jsonb OR NOT (r ? 'today_worked_minutes') THEN
    RAISE EXCEPTION 'Identify receipt wrong before any out punch: %', r;
  END IF;
  r := public.timeclock_identify(pg_temp.tok('kiosk'), 'FB-2', NULL, '222222');
  IF r->>'display_name' <> 'Probe B.' OR r->>'last_out_at' IS NULL
     OR (r->>'last_out_at')::timestamptz <> (SELECT max(punched_at) FROM public.time_punches WHERE staff_id = (SELECT b_staff FROM fk) AND punch_type = 'out') THEN
    RAISE EXCEPTION 'Identify last_out_at wrong: %', r;
  END IF;
  r := public.timeclock_record_punch(pg_temp.tok('kiosk'), 'FA-1', NULL, '111111', 'out', clock_timestamp(), c, false);
  IF NOT (r->>'ok')::boolean OR (r->>'replayed')::boolean OR r->>'display_name' <> 'Probe A.'
     OR (r->>'last_out_at')::timestamptz IS DISTINCT FROM (r->>'punched_at')::timestamptz THEN
    RAISE EXCEPTION 'Punch receipt wrong: %', r;
  END IF;
  r2 := public.timeclock_record_punch(pg_temp.tok('kiosk'), 'FA-1', NULL, '111111', 'out', clock_timestamp(), c, false);
  IF NOT (r2->>'replayed')::boolean OR r2->>'display_name' <> 'Probe A.' OR r2->>'last_out_at' IS DISTINCT FROM r->>'last_out_at' THEN
    RAISE EXCEPTION 'Replayed punch receipt wrong: %', r2;
  END IF;
  -- Refusals are unchanged: no receipt fields on an error, and a floor token still cannot identify.
  r := public.timeclock_identify(pg_temp.tok('kiosk'), 'FA-1', NULL, '000000');
  IF (r->>'ok')::boolean OR r ? 'display_name' THEN RAISE EXCEPTION 'Refusal leaked receipt fields: %', r; END IF;
  IF public.timeclock_identify(pg_temp.tok('floor'), 'FA-1', NULL, '111111')->>'error' <> 'device_unknown' THEN RAISE EXCEPTION 'Floor token identified'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 16. Who charted it: names for staff at the caller's facilities only.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.floor_staff_display_names(uuid[])', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.floor_staff_display_names(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.floor_staff_display_names(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'floor_staff_display_names grants wrong';
  END IF;
  IF (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest((SELECT proargnames FROM pg_proc WHERE oid = 'public.floor_staff_display_names(uuid[])'::regprocedure)) a(attname)
      WHERE a.attname <> 'p_staff_ids') <> ARRAY['display_name', 'staff_id'] THEN
    RAISE EXCEPTION 'floor_staff_display_names returns more than a staff id and a name';
  END IF;
END $$;
INSERT INTO public.staff(id, organization_id, facility_id, first_name, last_name, staff_role, hire_date, employment_status)
  SELECT '00000000-0000-4000-8000-00000000f2f2', org2, fac2, 'Probe', 'Foxtrot', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM fk;
SELECT pg_temp.fk_staff(b_user, b_session) FROM fk;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; names jsonb; BEGIN
  SELECT * INTO f FROM fk;
  SELECT jsonb_object_agg(staff_id, display_name) INTO names
  FROM public.floor_staff_display_names(ARRAY[f.a_staff, f.b_staff, f.n_staff, f.g_staff, '00000000-0000-4000-8000-00000000f2f2'::uuid]);
  IF names->>f.a_staff::text <> 'Probe A.' OR names->>f.b_staff::text <> 'Probe B.' OR names->>f.n_staff::text <> 'Probe N.' THEN
    RAISE EXCEPTION 'Same-facility names missing: %', names;
  END IF;
  IF names ? f.g_staff::text THEN RAISE EXCEPTION 'Another facility''s staff name visible'; END IF;
  IF names ? '00000000-0000-4000-8000-00000000f2f2' THEN RAISE EXCEPTION 'Another organization''s staff name visible'; END IF;
  IF (SELECT count(*) FROM public.floor_staff_display_names(array_fill(f.a_staff, ARRAY[201]))) <> 0 THEN RAISE EXCEPTION 'Name lookup not capped at 200 ids'; END IF;
END $$;
RESET ROLE;
-- A live assignment to the caller's facility makes the name visible.
INSERT INTO public.staff_facility_assignments(organization_id, staff_id, facility_id, start_date, end_date)
  SELECT org, g_staff, facility, current_date - 1, current_date + 1 FROM fk;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.floor_staff_display_names(ARRAY[(SELECT g_staff FROM fk)]) WHERE display_name = 'Probe G.') THEN
    RAISE EXCEPTION 'Name of staff assigned to the caller''s facility not visible';
  END IF;
END $$;
RESET ROLE;
-- No signed-in actor, no names.
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.floor_staff_display_names(ARRAY[(SELECT a_staff FROM fk)])) THEN RAISE EXCEPTION 'Names returned without an actor'; END IF;
END $$;
GRANT SELECT ON fk TO anon;
SET LOCAL ROLE anon;
SELECT pg_temp.fk_fail(format('SELECT * FROM public.floor_staff_display_names(ARRAY[%L::uuid])', a_staff), 'permission denied') FROM fk;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 17. The server reads the one-clock flag with service_role: three columns,
--     read only. authenticated keeps exactly its 408 grants.
-- ---------------------------------------------------------------------------
DO $$ DECLARE c text; BEGIN
  FOREACH c IN ARRAY ARRAY['organization_id', 'facility_id', 'timeclock_enabled'] LOOP
    IF NOT has_column_privilege('service_role', 'public.timeclock_facility_settings', c, 'SELECT') THEN
      RAISE EXCEPTION 'service_role cannot read timeclock_facility_settings.%', c;
    END IF;
  END LOOP;
  FOR c IN SELECT a.attname FROM pg_attribute a
           WHERE a.attrelid = 'public.timeclock_facility_settings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
             AND a.attname NOT IN ('organization_id', 'facility_id', 'timeclock_enabled') LOOP
    IF has_column_privilege('service_role', 'public.timeclock_facility_settings', c, 'SELECT') THEN
      RAISE EXCEPTION 'service_role can read timeclock_facility_settings.%', c;
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.timeclock_facility_settings', 'SELECT')
     OR has_any_column_privilege('service_role', 'public.timeclock_facility_settings', 'INSERT')
     OR has_any_column_privilege('service_role', 'public.timeclock_facility_settings', 'UPDATE')
     OR has_table_privilege('service_role', 'public.timeclock_facility_settings', 'DELETE')
     OR has_table_privilege('service_role', 'public.timeclock_facility_settings', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role holds more than a three-column read on timeclock_facility_settings';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.timeclock_facility_settings', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.timeclock_facility_settings', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.timeclock_facility_settings', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.timeclock_facility_settings', 'DELETE')
     OR has_table_privilege('authenticated', 'public.timeclock_facility_settings', 'TRUNCATE')
     OR has_any_column_privilege('anon', 'public.timeclock_facility_settings', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated or anon grants on timeclock_facility_settings changed';
  END IF;
END $$;
-- And the read works under the role, reaching only the three columns. Hosted
-- service_role bypasses RLS; the replay role does not until told to (rolled back).
ALTER ROLE service_role BYPASSRLS;
SELECT pg_temp.fk_service();
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF (SELECT timeclock_enabled FROM public.timeclock_facility_settings WHERE facility_id = (SELECT facility FROM fk)) IS NOT TRUE THEN
    RAISE EXCEPTION 'service_role flag read wrong';
  END IF;
  BEGIN
    PERFORM floor_roster_roles FROM public.timeclock_facility_settings LIMIT 1;
    RAISE EXCEPTION 'service_role read floor_roster_roles';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 18. On the clock means on the clock AT THIS FACILITY (spec 40 section 1).
-- ---------------------------------------------------------------------------
UPDATE public.timeclock_devices SET failure_count = 0, failure_window_started_at = NULL, throttled_until = NULL;
UPDATE public.timeclock_credentials SET failed_attempts = 0, locked_until = NULL WHERE organization_id = (SELECT org FROM fk);
SELECT pg_temp.fk_service();
DO $$ DECLARE r jsonb; f record; u uuid; BEGIN
  SELECT * INTO f FROM fk;
  -- Probe Golf works both buildings (live assignment here from section 16) and
  -- punched in at the other one (section 3): not on this tablet's roster.
  IF NOT haven.timeclock_assigned_to_facility(f.g_staff, f.facility) OR haven.timeclock_state(f.g_staff, clock_timestamp()) <> 'in' THEN
    RAISE EXCEPTION 'Fixture: Probe Golf should be assigned here and on the clock elsewhere';
  END IF;
  IF pg_temp.roster_ids(pg_temp.tok('floor')) && ARRAY[f.g_staff] THEN RAISE EXCEPTION 'Roster lists someone on the clock only at another facility'; END IF;
  IF pg_temp.unlock(pg_temp.tok('floor'), f.g_staff, NULL, '444444')->>'error' <> 'not_recognized' THEN
    RAISE EXCEPTION 'Roster tap unlocked for someone on the clock only elsewhere';
  END IF;
  r := pg_temp.unlock(pg_temp.tok('floor'), NULL, 'FG-4', '444444');
  IF NOT (r->>'ok')::boolean OR (r->>'on_clock')::boolean OR r->'clocked_in_at' <> 'null'::jsonb
     OR (SELECT on_clock FROM public.floor_unlocks WHERE id = (r->>'unlock_id')::uuid) THEN
    RAISE EXCEPTION 'Employee number unlock for someone on the clock elsewhere not recorded off the clock: %', r;
  END IF;
  -- Probe Alpha clocks in here, unlocks by roster, then clocks out here and in at the other facility.
  INSERT INTO public.time_punches(organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
    VALUES (f.org, f.facility, f.a_staff, 'in', clock_timestamp(), gen_random_uuid());
  r := pg_temp.unlock(pg_temp.tok('floor'), f.a_staff, NULL, '111111');
  IF NOT (r->>'ok')::boolean OR NOT (r->>'on_clock')::boolean OR r->>'clocked_in_at' IS NULL THEN RAISE EXCEPTION 'Roster unlock here failed: %', r; END IF;
  u := (r->>'unlock_id')::uuid;
  IF NOT (public.floor_heartbeat(pg_temp.tok('floor'), u)->>'active')::boolean THEN RAISE EXCEPTION 'Live roster unlock ended early'; END IF;
  INSERT INTO public.time_punches(organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
    VALUES (f.org, f.facility, f.a_staff, 'out', clock_timestamp(), gen_random_uuid());
  INSERT INTO public.time_punches(organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
    VALUES (f.org, f.other_facility, f.a_staff, 'in', clock_timestamp() + interval '1 millisecond', gen_random_uuid());
  IF haven.timeclock_state(f.a_staff, clock_timestamp() + interval '1 second') <> 'in' THEN RAISE EXCEPTION 'Fixture: Probe Alpha should be on the clock elsewhere'; END IF;
  r := public.floor_heartbeat(pg_temp.tok('floor'), u);
  IF (r->>'active')::boolean OR r->>'reason' <> 'clocked_out' THEN
    RAISE EXCEPTION 'Heartbeat kept a roster unlock for someone now on the clock only elsewhere: %', r;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 19. tries_left after a wrong PIN: roster taps only, never the employee
--     number path or the kiosk (spec 37 section 12a).
-- ---------------------------------------------------------------------------
UPDATE public.timeclock_devices SET failure_count = 0, failure_window_started_at = NULL, throttled_until = NULL;
UPDATE public.timeclock_credentials SET failed_attempts = 0, locked_until = NULL WHERE organization_id = (SELECT org FROM fk);
DO $$ DECLARE r jsonb; f record; i integer; BEGIN
  SELECT * INTO f FROM fk;
  -- Probe Bravo back on the clock here, for the roster.
  INSERT INTO public.time_punches(organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
    VALUES (f.org, f.facility, f.b_staff, 'in', clock_timestamp(), gen_random_uuid());
  r := pg_temp.unlock(pg_temp.tok('floor'), f.b_staff, NULL, '000000');
  IF r->>'error' <> 'not_recognized' OR (r->>'tries_left')::int <> 4 THEN RAISE EXCEPTION 'First roster miss: %', r; END IF;
  r := pg_temp.unlock(pg_temp.tok('floor'), f.b_staff, NULL, '000000');
  IF (r->>'tries_left')::int <> 3 THEN RAISE EXCEPTION 'Second roster miss: %', r; END IF;
  -- Employee number path: never.
  r := pg_temp.unlock(pg_temp.tok('floor'), NULL, 'FB-2', '000000');
  IF r->>'error' <> 'not_recognized' OR r ? 'tries_left' THEN RAISE EXCEPTION 'Employee number miss revealed tries_left: %', r; END IF;
  r := pg_temp.unlock(pg_temp.tok('floor'), NULL, 'NOBODY', '000000');
  IF r ? 'tries_left' THEN RAISE EXCEPTION 'Unknown employee number revealed tries_left: %', r; END IF;
  -- Kiosk: never, identify or punch.
  r := public.timeclock_identify(pg_temp.tok('kiosk'), 'FB-2', NULL, '000000');
  IF r->>'error' <> 'not_recognized' OR r ? 'tries_left' THEN RAISE EXCEPTION 'Kiosk identify revealed tries_left: %', r; END IF;
  r := pg_temp.kiosk_punch('FB-2', '000000', 'out');
  IF (r->>'ok')::boolean OR r ? 'tries_left' THEN RAISE EXCEPTION 'Kiosk punch revealed tries_left: %', r; END IF;
  -- Four misses so far; the fifth (a roster tap) locks and says so.
  r := pg_temp.unlock(pg_temp.tok('floor'), f.b_staff, NULL, '000000');
  IF (r->>'tries_left')::int <> 0 THEN RAISE EXCEPTION 'Fifth miss should leave 0 tries: %', r; END IF;
  IF pg_temp.unlock(pg_temp.tok('floor'), f.b_staff, NULL, '222222')->>'error' <> 'locked' THEN RAISE EXCEPTION 'Not locked after five misses'; END IF;
  UPDATE public.timeclock_credentials SET failed_attempts = 0, locked_until = NULL WHERE staff_id = f.b_staff;
  UPDATE public.timeclock_devices SET failure_count = 0, failure_window_started_at = NULL, throttled_until = NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 20. visitor_match_resident: front-desk roles, own facilities, two ids back.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-4000-8000-0000000fa001', 'family-floor-probe@floor-review.invalid', '{}'::jsonb, '{}'::jsonb);
INSERT INTO public.user_profiles(id, email, full_name, app_role, organization_id, is_active)
  SELECT '00000000-0000-4000-8000-0000000fa001', 'family-floor-probe@floor-review.invalid', 'Floor family probe', 'family'::public.app_role, org, true FROM fk;
INSERT INTO auth.sessions(id, user_id)
  VALUES ('00000000-0000-4000-8000-0000000fa002', '00000000-0000-4000-8000-0000000fa001');
INSERT INTO auth.sessions(id, user_id) SELECT '00000000-0000-4000-8000-0000000fa003', h_user FROM fk;
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM fk;
  INSERT INTO fk_results SELECT 'match_here', public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'family_friend', 'Matchprobe Uniform', NULL, NULL, 'Typed match probe', NULL, false);
  -- A kiosk entry at the other facility (fixture row).
  INSERT INTO public.visitor_log_entries(id, organization_id, facility_id, visitor_name, visitor_type, visiting_name_text, kiosk_device_id, kiosk_client_entry_id)
    VALUES ('00000000-0000-4000-8000-0000000fa010', f.org, f.other_facility, 'Matchprobe Victor', 'family_friend', 'Typed elsewhere', (SELECT (value->>'device_id')::uuid FROM fk_results WHERE name = 'kiosk'), gen_random_uuid());
END $$;
CREATE FUNCTION pg_temp.try_match(p_entry uuid, p_resident uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.visitor_match_resident(p_entry, p_resident);
  RETURN 'ok';
EXCEPTION WHEN insufficient_privilege THEN RETURN 'refused';
END $$;
SELECT pg_temp.fk_staff(h_user, '00000000-0000-4000-8000-0000000fa003'::uuid) FROM fk;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF pg_temp.try_match((SELECT (value->>'entry_id')::uuid FROM fk_results WHERE name = 'match_here'), (SELECT resident FROM fk)) <> 'refused' THEN
    RAISE EXCEPTION 'Housekeeper matched a visitor to a resident';
  END IF;
END $$;
RESET ROLE;
SELECT pg_temp.fk_staff('00000000-0000-4000-8000-0000000fa001'::uuid, '00000000-0000-4000-8000-0000000fa002'::uuid);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF pg_temp.try_match((SELECT (value->>'entry_id')::uuid FROM fk_results WHERE name = 'match_here'), (SELECT resident FROM fk)) <> 'refused' THEN
    RAISE EXCEPTION 'Family matched a visitor to a resident';
  END IF;
END $$;
RESET ROLE;
SELECT pg_temp.fk_staff(b_user, b_session) FROM fk;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
  IF pg_temp.try_match('00000000-0000-4000-8000-0000000fa010', (SELECT resident FROM fk)) <> 'refused' THEN
    RAISE EXCEPTION 'Matched an entry at a facility the caller cannot access';
  END IF;
  r := public.visitor_match_resident((SELECT (value->>'entry_id')::uuid FROM fk_results WHERE name = 'match_here'), (SELECT resident FROM fk));
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k) <> ARRAY['entry_id', 'resident_id']
     OR (r->>'resident_id')::uuid <> (SELECT resident FROM fk) THEN
    RAISE EXCEPTION 'Med tech match failed: %', r;
  END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 21. Kiosk visitor rate limits live in the database (spec 40 section 5).
-- ---------------------------------------------------------------------------
UPDATE public.timeclock_devices SET failure_count = 0, failure_window_started_at = NULL, throttled_until = NULL;
SELECT pg_temp.fk_service();
DO $$ DECLARE r jsonb; f record; n integer; i integer; replay uuid := gen_random_uuid(); kiosk uuid; BEGIN
  SELECT * INTO f FROM fk;
  kiosk := (SELECT (value->>'device_id')::uuid FROM fk_results WHERE name = 'kiosk');
  IF (SELECT kiosk_visitor_sign_ins_per_10_minutes FROM public.timeclock_facility_settings WHERE facility_id = f.facility) <> 30 THEN
    RAISE EXCEPTION 'Kiosk sign-in cap default is not 30';
  END IF;
  SELECT count(*) INTO n FROM public.visitor_log_entries WHERE kiosk_device_id = kiosk AND created_at >= now() - interval '10 minutes';
  UPDATE public.timeclock_facility_settings SET kiosk_visitor_sign_ins_per_10_minutes = n + 1 WHERE facility_id = f.facility;
  r := public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), replay, 'vendor_contractor', 'Capprobe One', NULL, 'Probe Co', NULL, NULL, false);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'Sign in under the cap refused: %', r; END IF;
  r := public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'vendor_contractor', 'Capprobe Two', NULL, 'Probe Co', NULL, NULL, false);
  IF r->>'error' <> 'device_throttled' THEN RAISE EXCEPTION 'Sign in over the cap accepted: %', r; END IF;
  -- A retry of an entry already recorded still answers: it adds nothing.
  IF NOT (public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), replay, 'vendor_contractor', 'Capprobe One', NULL, 'Probe Co', NULL, NULL, false)->>'replayed')::boolean THEN
    RAISE EXCEPTION 'Replay refused at the cap';
  END IF;
  UPDATE public.timeclock_facility_settings SET kiosk_visitor_sign_ins_per_10_minutes = 30 WHERE facility_id = f.facility;
  PERFORM pg_temp.fk_fail(format('UPDATE public.timeclock_facility_settings SET kiosk_visitor_sign_ins_per_10_minutes = 0 WHERE facility_id = %L', f.facility), 'kiosk_visitor_cap_check');
  -- Twenty wrong staff PINs throttle punching, never visitors.
  FOR i IN 1..20 LOOP PERFORM public.timeclock_identify(pg_temp.tok('kiosk'), 'NOBODY', NULL, '000000'); END LOOP;
  IF public.timeclock_identify(pg_temp.tok('kiosk'), 'FA-1', NULL, '111111')->>'error' <> 'device_throttled' THEN RAISE EXCEPTION 'Fixture: staff PIN throttle not reached'; END IF;
  r := public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'vendor_contractor', 'Capprobe Pin', NULL, 'Probe Co', NULL, NULL, false);
  IF NOT (r->>'ok')::boolean OR public.visitor_kiosk_open_matches(pg_temp.tok('kiosk'), 'Capprobe')->>'ok' <> 'true' THEN
    RAISE EXCEPTION 'Staff PIN misses turned visitors away: %', r;
  END IF;
  UPDATE public.timeclock_devices SET throttled_until = NULL, failure_count = 0, failure_window_started_at = NULL WHERE id = kiosk;
  -- Twenty sign-out misses throttle the visitor calls: sign-in, matches and sign-out all wait.
  FOR i IN 1..10 LOOP PERFORM public.visitor_kiosk_sign_out(pg_temp.tok('kiosk'), gen_random_uuid()); END LOOP;
  FOR i IN 1..10 LOOP PERFORM public.visitor_kiosk_sign_out(pg_temp.tok('kiosk'), (SELECT (value->>'entry_id')::uuid FROM fk_results WHERE name = 'visit')); END LOOP;
  IF public.visitor_kiosk_sign_in(pg_temp.tok('kiosk'), gen_random_uuid(), 'vendor_contractor', 'Capprobe Three', NULL, 'Probe Co', NULL, NULL, false)->>'error' <> 'device_throttled'
     OR public.visitor_kiosk_open_matches(pg_temp.tok('kiosk'), 'Capprobe')->>'error' <> 'device_throttled'
     OR public.visitor_kiosk_sign_out(pg_temp.tok('kiosk'), gen_random_uuid())->>'error' <> 'device_throttled' THEN
    RAISE EXCEPTION 'Sign-out misses did not throttle the visitor calls';
  END IF;
  -- ...and never a punch: the staff counter is untouched.
  IF (SELECT failure_count FROM public.timeclock_devices WHERE id = kiosk) <> 0
     OR NOT (public.timeclock_identify(pg_temp.tok('kiosk'), 'FA-1', NULL, '111111')->>'ok')::boolean THEN
    RAISE EXCEPTION 'Visitor sign-out misses blocked a staff punch';
  END IF;
  UPDATE public.timeclock_devices SET visitor_throttled_until = NULL, visitor_failure_count = 0, visitor_failure_window_started_at = NULL WHERE id = kiosk;
END $$;

ROLLBACK;
