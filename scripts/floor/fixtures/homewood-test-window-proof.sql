-- COL-849 local proof: the Homewood test window, end to end, on a scratch database.
--
-- Included by supabase/tests/review_homewood_test_window.sql, which runs it inside a
-- throwaway copy of the replayed database (the open and wipe scripts commit, so they
-- cannot share the replay's own database). Never run against a hosted project.
--
-- Order:
--   1. Production shape at Homewood: the real COL-695 pause and COL-735 night-window
--      scripts, Brian, two med techs, an administrator with a phone, the Oct 1 cron job,
--      timeclock on, the four iPads enrolled, PINs set.
--   2. Pre-window activity through the real functions, then moved to 2026-09-24 so it sits
--      before the window start. Pre-window rows now exist in every inventory table.
--   3. The open script (dry run, then apply).
--   4. Window activity through the real functions: punches, a lockout and an unlock, an
--      offline rejection, visitors of all four kinds, floor unlock and switch, charted and
--      late checks, a missed check escalated to the last rung, Something happened reports
--      with a photo, watchlist and monitoring notices, a handoff. Rows the flows do not
--      produce (another producer's alert, a staff-typed visitor, an admissions note, rows
--      at another facility) are added so the proof shows they are kept.
--   5. Photo removal (what homewood-test-window-photos.mjs does through the Storage API),
--      the wipe dry run, then the wipe.
--   6. Assertions, and the [LOCAL PROOF] table.
-- Synthetic people only ("Proof Alpha" ...). Brian's profile uses his real login email so
-- the scripts find him the way they will on production.

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
-- Hosted Supabase grants every public table to the request roles by default; the replay
-- stub does not. Mirror that so the flows run as they do on production.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;

-- The Oct 1 cron job, as scheduled on production (pg_cron is not in the replay).
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, nodename text DEFAULT 'localhost',
  nodeport integer DEFAULT 5432, database text DEFAULT current_database(), username text DEFAULT current_user, active boolean NOT NULL DEFAULT true, jobname text);
INSERT INTO cron.job (jobname, schedule, command) VALUES ('col695-homewood-timeclock-on', '30 9 1 10 *', $cmd$
DO $tc$
BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::date <> DATE '2026-10-01' THEN
    RAISE NOTICE 'COL-695 timeclock go-live: not 2026-10-01 in New York; nothing done';
  ELSE
    INSERT INTO public.timeclock_facility_settings (organization_id, facility_id, timeclock_enabled)
    VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0002-000000000003', true)
    ON CONFLICT (organization_id, facility_id) DO UPDATE SET timeclock_enabled = true;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'col695-homewood-timeclock-on';
END
$tc$;
$cmd$);

-- The inventory, in the wipe's delete order (the proof checks the wipe uses the same list).
CREATE TEMP TABLE px_tables (tbl text PRIMARY KEY, ord integer NOT NULL);
INSERT INTO px_tables (tbl, ord) VALUES
  ('observation_escalation_deliveries', 1), ('observation_escalation_dispatches', 2), ('resident_observation_escalations', 3),
  ('watchlist_signal_notifications', 4), ('watchlist_signal_dispositions', 5), ('resident_monitoring_order_notifications', 6),
  ('care_event_deliveries', 7), ('exec_alert_user_state', 8), ('exec_actions', 9), ('exec_alerts', 10),
  ('resident_watch_events', 11), ('resident_observation_exceptions', 12), ('resident_observation_integrity_flags', 13),
  ('rounding_completion_receipts', 14), ('resident_observation_assignments', 15), ('resident_observation_tasks', 16),
  ('resident_observation_logs', 17), ('resident_monitoring_order_events', 18), ('resident_monitoring_orders', 19),
  ('watchlist_signal_instances', 20), ('incident_photos', 21), ('incident_followups', 22),
  ('regulatory_reporting_obligations', 23), ('incident_rca', 24), ('incident_root_causes', 25), ('care_plan_review_alerts', 26),
  ('resident_watch_instances', 27), ('care_events', 28), ('incidents', 29), ('behavioral_logs', 30), ('condition_changes', 31),
  ('shift_handoff_notes', 32), ('shift_handoffs', 33), ('visitor_log_entries', 34), ('med_passes', 35), ('shift_tape_events', 36),
  ('med_tech_shift_residents', 37), ('med_tech_shifts', 38), ('time_punch_corrections', 39), ('time_punches', 40),
  ('timeclock_sync_rejections', 41), ('floor_unlocks', 42);
CREATE TEMP TABLE px AS
SELECT '00000000-0000-0000-0000-000000000001'::uuid AS org,
       '00000000-0000-0000-0002-000000000003'::uuid AS hw,
       '00000000-0000-0000-0002-000000000001'::uuid AS other_fac,
       '2026-09-25 20:24:02.307103+00'::timestamptz AS ws,
       gen_random_uuid() AS brian, gen_random_uuid() AS brian_s,
       gen_random_uuid() AS admin_u, gen_random_uuid() AS admin_s, NULL::uuid AS admin_staff,
       gen_random_uuid() AS a_u, gen_random_uuid() AS a_s, gen_random_uuid() AS a_staff,
       gen_random_uuid() AS b_u, gen_random_uuid() AS b_s, gen_random_uuid() AS b_staff,
       NULL::uuid AS entity, NULL::uuid AS r1, NULL::uuid AS r2, NULL::uuid AS r3, NULL::uuid AS r4,
       NULL::text AS kiosk_token, NULL::text AS floor_token, NULL::uuid AS monitoring_order;
UPDATE px SET entity = (SELECT f.entity_id FROM public.facilities f WHERE f.id = px.hw),
  admin_staff = (SELECT s.id FROM public.staff s WHERE s.facility_id = px.hw AND s.staff_role = 'administrator' AND s.deleted_at IS NULL
                 AND nullif(btrim(s.phone), '') IS NOT NULL ORDER BY s.id LIMIT 1),
  r1 = (SELECT r.id FROM public.residents r WHERE r.facility_id = px.hw AND r.deleted_at IS NULL ORDER BY r.id LIMIT 1 OFFSET 0),
  r2 = (SELECT r.id FROM public.residents r WHERE r.facility_id = px.hw AND r.deleted_at IS NULL ORDER BY r.id LIMIT 1 OFFSET 1),
  r3 = (SELECT r.id FROM public.residents r WHERE r.facility_id = px.hw AND r.deleted_at IS NULL ORDER BY r.id LIMIT 1 OFFSET 2),
  r4 = (SELECT r.id FROM public.residents r WHERE r.facility_id = px.hw AND r.deleted_at IS NULL ORDER BY r.id LIMIT 1 OFFSET 3);
CREATE FUNCTION pg_temp.col849_scope_column(p_tbl text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tbl WHEN 'time_punch_corrections' THEN 'corrected_at' WHEN 'floor_unlocks' THEN 'started_at' WHEN 'shift_tape_events' THEN 'occurred_at' ELSE 'created_at' END
$$;
-- Rows at Homewood whose scope column is at or after (p_after) or before a given instant.
CREATE FUNCTION pg_temp.col849_where(p_tbl text, p_at timestamptz, p_after boolean) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE p_tbl
    WHEN 'incident_root_causes' THEN format('x.incident_id IN (SELECT i.id FROM public.incidents i WHERE i.facility_id = %L AND i.created_at %s %L)', (SELECT hw FROM px), CASE WHEN p_after THEN '>=' ELSE '<' END, p_at)
    WHEN 'exec_alert_user_state' THEN format('x.exec_alert_id IN (SELECT a.id FROM public.exec_alerts a WHERE a.facility_id = %L AND a.created_at %s %L)', (SELECT hw FROM px), CASE WHEN p_after THEN '>=' ELSE '<' END, p_at)
    WHEN 'exec_actions' THEN format('x.alert_id IN (SELECT a.id FROM public.exec_alerts a WHERE a.facility_id = %L AND a.created_at %s %L)', (SELECT hw FROM px), CASE WHEN p_after THEN '>=' ELSE '<' END, p_at)
    ELSE format('x.facility_id = %L AND x.%I %s %L', (SELECT hw FROM px), pg_temp.col849_scope_column(p_tbl), CASE WHEN p_after THEN '>=' ELSE '<' END, p_at) END
$$;

DO $$ BEGIN
  IF (SELECT r4 IS NULL OR admin_staff IS NULL OR entity IS NULL FROM px) THEN
    RAISE EXCEPTION 'The replay has no Homewood with four residents and an administrator with a phone';
  END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(p_user uuid, p_session uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p.id, 'session_id', p_session, 'role', 'authenticated',
    'auth_claim_version', p.auth_claim_version, 'app_role', p.app_role, 'organization_id', p.organization_id,
    'iat', extract(epoch FROM clock_timestamp())::bigint)::text, false)::void
  FROM public.user_profiles p WHERE p.id = p_user;
  SELECT set_config('haven.care_event_definer', '', false)::void;
$$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)::void
$$;
CREATE FUNCTION pg_temp.ok(p jsonb, p_what text) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
  IF p IS NULL OR coalesce((p->>'ok')::boolean, true) IS NOT TRUE OR p ? 'error' THEN
    RAISE EXCEPTION '% failed: %', p_what, p;
  END IF;
  RETURN p;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Production shape
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
SELECT u, e, '{}'::jsonb, '{}'::jsonb FROM px, LATERAL (VALUES (brian, 'blewis@lewisinsurance.com'), (admin_u, admin_u || '@col849-proof.invalid'),
  (a_u, a_u || '@col849-proof.invalid'), (b_u, b_u || '@col849-proof.invalid')) v(u, e);
INSERT INTO public.user_profiles (id, email, full_name, app_role, organization_id, is_active)
SELECT brian, 'blewis@lewisinsurance.com', 'Proof Owner', 'owner'::public.app_role, org, true FROM px
UNION ALL SELECT admin_u, admin_u || '@col849-proof.invalid', 'Proof Administrator', 'facility_admin'::public.app_role, org, true FROM px
UNION ALL SELECT a_u, a_u || '@col849-proof.invalid', 'Proof Alpha', 'med_tech'::public.app_role, org, true FROM px
UNION ALL SELECT b_u, b_u || '@col849-proof.invalid', 'Proof Bravo', 'med_tech'::public.app_role, org, true FROM px;
INSERT INTO auth.sessions (id, user_id)
SELECT brian_s, brian FROM px UNION ALL SELECT admin_s, admin_u FROM px UNION ALL SELECT a_s, a_u FROM px UNION ALL SELECT b_s, b_u FROM px;
INSERT INTO public.user_facility_access (user_id, facility_id, organization_id)
SELECT u, hw, org FROM px, unnest(ARRAY[brian, admin_u, a_u, b_u]) u;
UPDATE public.staff s SET user_id = px.admin_u FROM px WHERE s.id = px.admin_staff;
INSERT INTO public.staff (id, organization_id, facility_id, user_id, first_name, last_name, staff_role, hire_date, employment_status)
SELECT a_staff, org, hw, a_u, 'Proof', 'Alpha', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM px
UNION ALL SELECT b_staff, org, hw, b_u, 'Proof', 'Bravo', 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status FROM px;

-- The COL-695 pause and the COL-735 night windows, exactly as run on production.
SET haven.col695_apply = 'homewood-pause-cadence';
\ir ../homewood-pause-cadence.sql
SET haven.col735_apply = 'homewood-night-windows-off';
\ir ../homewood-night-windows-off.sql

-- Timeclock on (Brian, 2026-09-25 20:24 ET), PINs and the four iPads.
INSERT INTO public.timeclock_facility_settings (organization_id, facility_id, timeclock_enabled)
SELECT org, hw, true FROM px ON CONFLICT (organization_id, facility_id) DO UPDATE SET timeclock_enabled = true;
SELECT pg_temp.as_user(brian, brian_s) FROM px;
SELECT pg_temp.ok(public.timeclock_set_credentials(a_staff, 'create', 'HW-A1', '111111', NULL), 'PIN for Alpha') FROM px;
SELECT pg_temp.ok(public.timeclock_set_credentials(b_staff, 'create', 'HW-B2', '222222', NULL), 'PIN for Bravo') FROM px;
CREATE TEMP TABLE px_codes AS
SELECT 'kiosk'::text AS k, public.timeclock_create_enrollment_code(hw, 'kiosk') AS c FROM px
UNION ALL SELECT 'floor', public.timeclock_create_enrollment_code(hw, 'floor') FROM px
UNION ALL SELECT 'floor2', public.timeclock_create_enrollment_code(hw, 'floor') FROM px
UNION ALL SELECT 'floor3', public.timeclock_create_enrollment_code(hw, 'floor') FROM px;
SELECT pg_temp.as_service();
UPDATE px SET kiosk_token = (SELECT pg_temp.ok(public.timeclock_enroll_device(c->>'code', 'HL-KIOSK-01', 'kiosk'), 'kiosk enrollment')->>'token' FROM px_codes WHERE k = 'kiosk'),
              floor_token = (SELECT pg_temp.ok(public.timeclock_enroll_device(c->>'code', 'HL-FLOOR-01', 'floor'), 'floor enrollment')->>'token' FROM px_codes WHERE k = 'floor');
SELECT pg_temp.ok(public.timeclock_enroll_device(c->>'code', 'HL-FLOOR-0' || right(k, 1), 'floor'), 'spare floor enrollment') FROM px_codes WHERE k IN ('floor2', 'floor3');

-- A monitoring order written before the window, so notices about it can be written in both phases.
INSERT INTO public.resident_monitoring_orders (organization_id, entity_id, facility_id, resident_id, interval_minutes, starts_at, review_due_at,
  ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note, entered_by, status)
SELECT org, entity, hw, r4, 60, now() - interval '2 days', now() + interval '5 days', 'physician', 'Proof Physician', 'verbal', 'post_fall',
       'COL-849 proof fixture', brian, 'active' FROM px RETURNING id \gset px_
UPDATE px SET monitoring_order = :'px_id';
UPDATE public.resident_monitoring_orders SET created_at = '2026-09-20 12:00:00+00' WHERE id = (SELECT monitoring_order FROM px);

-- ---------------------------------------------------------------------------
-- 2 and 4. The flows, driven through the real functions. p_phase is 'pre' or 'window'.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.col849_drive(p_phase text) RETURNS void LANGUAGE plpgsql AS $drive$
DECLARE
  x record;
  v jsonb;
  v_unlock uuid;
  v_cadence uuid;
  v_service date;
  v_task1 uuid := gen_random_uuid();
  v_task2 uuid := gen_random_uuid();
  v_task3 uuid := gen_random_uuid();
  v_ce uuid;
  v_ce_behavior uuid;
  v_ce_condition uuid;
  v_incident uuid;
  v_alert uuid;
  v_path text;
  v_entry uuid;
  v_instance uuid;
  v_rule record;
  v_n integer;
  v_kinds text[] := ARRAY['family_friend', 'healthcare_provider', 'vendor_contractor', 'surveyor_regulator'];
  v_kind text;
BEGIN
  SELECT * INTO x FROM px;

  -- Kiosk: Alpha clocks in; Bravo misses the PIN five times, is locked, and is unlocked.
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.ok(public.timeclock_record_punch(x.kiosk_token, 'HW-A1', NULL, '111111', 'in', clock_timestamp(), gen_random_uuid(), false), p_phase || ' Alpha clock in');
  FOR v_n IN 1..5 LOOP
    v := public.timeclock_identify(x.kiosk_token, 'HW-B2', NULL, '999999');
  END LOOP;
  IF v->>'error' <> 'locked' AND NOT EXISTS (SELECT 1 FROM public.timeclock_credentials c WHERE c.staff_id = x.b_staff AND c.locked_until > now()) THEN
    RAISE EXCEPTION '% five wrong PINs did not lock Bravo: %', p_phase, v;
  END IF;
  PERFORM pg_temp.as_user(x.brian, x.brian_s);
  PERFORM pg_temp.ok(public.timeclock_unlock_credential(x.b_staff), p_phase || ' administrator unlock');
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.ok(public.timeclock_record_punch(x.kiosk_token, 'HW-B2', NULL, '222222', 'in', clock_timestamp(), gen_random_uuid(), false), p_phase || ' Bravo clock in');
  -- An offline meal end with no meal start: recorded as a sync rejection.
  v := public.timeclock_record_punch(x.kiosk_token, 'HW-A1', NULL, '111111', 'meal_end', clock_timestamp() - interval '2 minutes', gen_random_uuid(), true);
  IF NOT EXISTS (SELECT 1 FROM public.timeclock_sync_rejections r WHERE r.facility_id = x.hw AND r.staff_id = x.a_staff AND r.created_at >= now()) THEN
    INSERT INTO public.timeclock_sync_rejections (organization_id, facility_id, device_id, staff_id, client_punch_id, punch_type, device_time, reason)
    SELECT x.org, x.hw, d.id, x.a_staff, gen_random_uuid(), 'meal_end', clock_timestamp() - interval '2 minutes', 'sequence'
    FROM public.timeclock_devices d WHERE d.facility_id = x.hw AND d.label = 'HL-KIOSK-01';
  END IF;

  -- Kiosk visitors: the four kinds, one feeling sick; the leaving list; sign out.
  FOREACH v_kind IN ARRAY v_kinds LOOP
    v := pg_temp.ok(public.visitor_kiosk_sign_in(x.kiosk_token, gen_random_uuid(), v_kind, 'Proof Visitor ' || v_kind, '555-010-0100',
           CASE WHEN v_kind = 'family_friend' THEN NULL ELSE 'Proof Company' END,
           CASE WHEN v_kind IN ('family_friend', 'healthcare_provider') THEN 'Proof Resident' ELSE NULL END,
           CASE WHEN v_kind = 'vendor_contractor' THEN 'Proof delivery' ELSE NULL END, v_kind = 'family_friend'), p_phase || ' visitor ' || v_kind);
    v_entry := (v->>'entry_id')::uuid;
    IF v_kind = 'family_friend' THEN
      PERFORM pg_temp.as_user(x.brian, x.brian_s);
      PERFORM pg_temp.ok(public.visitor_match_resident(v_entry, x.r1), p_phase || ' match resident');
      PERFORM pg_temp.as_service();
    END IF;
  END LOOP;
  v := public.visitor_kiosk_open_matches(x.kiosk_token, 'Pro');
  FOR v_entry IN SELECT e.id FROM public.visitor_log_entries e WHERE e.facility_id = x.hw AND e.kiosk_device_id IS NOT NULL AND e.checked_out_at IS NULL LOOP
    PERFORM pg_temp.ok(public.visitor_kiosk_sign_out(x.kiosk_token, v_entry), p_phase || ' visitor sign out');
  END LOOP;

  -- Floor: Alpha unlocks from the roster, switches to Bravo, Bravo goes idle.
  v := pg_temp.ok(public.floor_verify_unlock(x.floor_token, x.a_staff, NULL, '111111'), p_phase || ' Alpha unlock');
  v_unlock := (v->>'unlock_id')::uuid;
  PERFORM public.floor_heartbeat(x.floor_token, v_unlock);
  PERFORM public.floor_end_unlock(x.floor_token, v_unlock, 'switch');
  v := pg_temp.ok(public.floor_verify_unlock(x.floor_token, NULL, 'HW-B2', '222222'), p_phase || ' Bravo unlock by employee number');
  PERFORM public.floor_end_unlock(x.floor_token, (v->>'unlock_id')::uuid, 'idle');

  -- Smart Rounding: the generator's write under the cadence version in force (the test
  -- cadence in the window; version 1 before it), three checks.
  IF p_phase = 'window' THEN
    v_cadence := public.facility_cadence_in_force(x.hw, now());
    v_service := (now() AT TIME ZONE 'America/New_York')::date;
  ELSE
    SELECT v2.id INTO v_cadence FROM public.facility_cadence_versions v2 WHERE v2.facility_id = x.hw AND v2.version_number = 1;
    v_service := DATE '2026-09-24';
  END IF;
  PERFORM public.record_cadence_observation_tasks(jsonb_build_array(
    jsonb_build_object('organization_id', x.org, 'entity_id', x.entity, 'facility_id', x.hw, 'resident_id', x.r1, 'cadence_version_id', v_cadence,
      'window_key', 'mid_morning', 'service_date', v_service, 'assigned_staff_id', x.a_staff,
      'scheduled_for', now() - interval '20 minutes', 'due_at', now() + interval '10 minutes', 'grace_ends_at', now() + interval '40 minutes'),
    jsonb_build_object('organization_id', x.org, 'entity_id', x.entity, 'facility_id', x.hw, 'resident_id', x.r2, 'cadence_version_id', v_cadence,
      'window_key', 'afternoon', 'service_date', v_service, 'assigned_staff_id', x.a_staff,
      'scheduled_for', now() - interval '4 hours', 'due_at', now() - interval '3 hours', 'grace_ends_at', now() - interval '150 minutes'),
    jsonb_build_object('organization_id', x.org, 'entity_id', x.entity, 'facility_id', x.hw, 'resident_id', x.r3, 'cadence_version_id', v_cadence,
      'window_key', 'shift_change_pm', 'service_date', v_service, 'assigned_staff_id', NULL,
      'scheduled_for', now() - interval '90 minutes', 'due_at', now() - interval '60 minutes', 'grace_ends_at', now() - interval '30 minutes')));
  SELECT t.id INTO STRICT v_task1 FROM public.resident_observation_tasks t WHERE t.resident_id = x.r1 AND t.window_key = 'mid_morning' AND t.service_date = v_service AND t.deleted_at IS NULL;
  SELECT t.id INTO STRICT v_task2 FROM public.resident_observation_tasks t WHERE t.resident_id = x.r2 AND t.window_key = 'afternoon' AND t.service_date = v_service AND t.deleted_at IS NULL;
  SELECT t.id INTO STRICT v_task3 FROM public.resident_observation_tasks t WHERE t.resident_id = x.r3 AND t.window_key = 'shift_change_pm' AND t.service_date = v_service AND t.deleted_at IS NULL;

  -- Chart a check (on time, with a concern) and a late one (claimed first, late reason).
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.ok(public.complete_rounding_task_review(v_task1, x.a_u, 'med_tech', x.a_s, (SELECT p.auth_claim_version FROM public.user_profiles p WHERE p.id = x.a_u),
    x.org, x.hw, x.a_staff, jsonb_build_object('request_id', gen_random_uuid(), 'observed_at', now(), 'entered_at', now(), 'entry_mode', 'live',
      'quick_status', 'awake', 'resident_location', 'dining_room', 'resident_state', 'eating_meal',
      'chip_selections', jsonb_build_object('meal_intake', jsonb_build_array('ate_well'), 'mood_state', jsonb_build_array('pleasant')),
      'completion_status', 'completed_on_time', 'exception_present', true, 'exception_type', 'resident_not_found',
      'exception_severity', 'medium')), p_phase || ' chart a check');
  PERFORM pg_temp.as_user(x.a_u, x.a_s);
  PERFORM public.claim_observation_task(v_task3);
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.ok(public.complete_rounding_task_review(v_task3, x.a_u, 'med_tech', x.a_s, (SELECT p.auth_claim_version FROM public.user_profiles p WHERE p.id = x.a_u),
    x.org, x.hw, x.a_staff, jsonb_build_object('request_id', gen_random_uuid(), 'observed_at', now() - interval '5 minutes', 'entered_at', now(), 'entry_mode', 'late',
      'late_reason', 'Resident was in the dining room', 'quick_status', 'calm', 'resident_location', 'resident_room', 'resident_state', 'resting_in_bed',
      'chip_selections', jsonb_build_object('med_response', jsonb_build_array('took_meds')), 'completion_status', 'completed_late')), p_phase || ' chart a late check');

  -- A missed check escalates to the last rung.
  FOR v_kind IN SELECT r.rung_key FROM public.facility_escalation_rungs r JOIN public.facility_escalation_versions ev ON ev.id = r.escalation_version_id
                WHERE r.facility_id = x.hw AND ev.status = 'active' AND r.enabled AND r.deleted_at IS NULL ORDER BY r.sort_order LOOP
    PERFORM public.record_observation_escalation_rung(v_task2, v_kind, now());
  END LOOP;
  IF (SELECT t.status::text FROM public.resident_observation_tasks t WHERE t.id = v_task2) <> 'missed' THEN
    RAISE EXCEPTION '% the missed check did not reach the last rung', p_phase;
  END IF;

  -- A staffing gap alert (the generator's other exec alert).
  INSERT INTO public.exec_alerts (organization_id, entity_id, facility_id, source_module, severity, title, body)
  SELECT x.org, x.entity, x.hw, 'staff', 'warning', haven.observation_staffing_gap_title(x.hw, 'night', v_service), 'COL-849 proof staffing gap';

  -- Something happened: a Level 2 fall with a photo, a behavior and a condition change.
  PERFORM pg_temp.as_user(x.a_u, x.a_s);
  v := public.submit_care_event(jsonb_build_object('client_event_id', gen_random_uuid(), 'facility_id', x.hw, 'resident_id', x.r1, 'kind', 'fall',
         'occurred_at', (now() - interval '5 minutes')::text,
         'answers', jsonb_build_object('hurt', 'a_little', 'head', 'no', 'witnessed', 'yes', 'going_out', 'no')));
  v_ce := (v->>'care_event_id')::uuid;
  IF v_ce IS NULL THEN RAISE EXCEPTION '% fall report failed: %', p_phase, v; END IF;
  SELECT ce.incident_id INTO v_incident FROM public.care_events ce WHERE ce.id = v_ce;
  IF v_incident IS NULL THEN RAISE EXCEPTION '% the Level 2 fall raised no incident', p_phase; END IF;
  v_path := x.org || '/' || x.hw || '/' || v_ce || '/' || gen_random_uuid() || '.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('incident-photos', v_path, x.a_u);
  PERFORM pg_temp.as_user(x.a_u, x.a_s);
  PERFORM public.attach_care_event_file(v_ce, v_path, 'photo', 'Proof fall photo');
  v := public.submit_care_event(jsonb_build_object('client_event_id', gen_random_uuid(), 'facility_id', x.hw, 'resident_id', x.r2, 'kind', 'behavior',
         'answers', jsonb_build_object('what', 'yelling', 'touched', 'no_one', 'over', 'yes')));
  v_ce_behavior := (v->>'care_event_id')::uuid;
  PERFORM pg_temp.as_user(x.a_u, x.a_s);
  v := public.submit_care_event(jsonb_build_object('client_event_id', gen_random_uuid(), 'facility_id', x.hw, 'resident_id', x.r3, 'kind', 'condition_change',
         'answers', jsonb_build_object('signs', jsonb_build_array('weak_dizzy'), 'onset', 'today')));
  v_ce_condition := (v->>'care_event_id')::uuid;
  IF v_ce_behavior IS NULL OR v_ce_condition IS NULL THEN RAISE EXCEPTION '% behavior or condition report failed: %', p_phase, v; END IF;
  PERFORM public.care_event_escalation_tick();

  -- Rows the administrator adds while working the test incident.
  SELECT a.id INTO v_alert FROM public.exec_alerts a WHERE a.deep_link_path = '/admin/care-events/' || v_ce;
  IF v_alert IS NULL THEN RAISE EXCEPTION '% the fall raised no exec alert', p_phase; END IF;
  INSERT INTO public.exec_alert_user_state (organization_id, exec_alert_id, user_id, acknowledged_at) VALUES (x.org, v_alert, x.admin_u, now());
  INSERT INTO public.exec_actions (organization_id, alert_id, title, owner_user_id, created_by) VALUES (x.org, v_alert, 'Proof follow-up', x.admin_u, x.admin_u);
  INSERT INTO public.incident_rca (incident_id, organization_id, facility_id) VALUES (v_incident, x.org, x.hw);
  INSERT INTO public.incident_root_causes (incident_id, root_cause_id) SELECT v_incident, t.id FROM public.incident_root_cause_taxonomy t ORDER BY t.id LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM public.care_plan_review_alerts c WHERE c.trigger_source_id = v_incident) THEN
    INSERT INTO public.care_plan_review_alerts (care_plan_id, resident_id, facility_id, organization_id, trigger_type, trigger_detail, trigger_source_id, status)
    SELECT cp.id, x.r1, x.hw, x.org, 'fall_incident', 'COL-849 proof', v_incident, 'open'
    FROM public.care_plans cp WHERE cp.resident_id = x.r1 AND cp.deleted_at IS NULL ORDER BY cp.created_at DESC LIMIT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.regulatory_reporting_obligations o WHERE o.incident_id = v_incident) THEN
    INSERT INTO public.regulatory_reporting_obligations (incident_id, facility_id, organization_id, jurisdiction, authority, due_at)
    SELECT v_incident, x.hw, x.org, 'FL', 'AHCA', now() + interval '1 day';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.resident_watch_instances w WHERE w.triggered_by_id = v_incident) THEN
    INSERT INTO public.resident_watch_instances (organization_id, entity_id, facility_id, resident_id, protocol_id, triggered_by_type, triggered_by_id, starts_at, status)
    SELECT x.org, x.entity, x.hw, x.r1, p.id, 'incident_fall', v_incident, now(), 'active'
    FROM public.resident_watch_protocols p WHERE p.organization_id = x.org AND p.deleted_at IS NULL ORDER BY p.id LIMIT 1;
  END IF;
  INSERT INTO public.resident_watch_events (organization_id, entity_id, facility_id, resident_id, watch_instance_id, task_id, event_type)
  SELECT x.org, x.entity, x.hw, x.r1, w.id, v_task1, 'observation' FROM public.resident_watch_instances w WHERE w.triggered_by_id = v_incident LIMIT 1;

  -- Watchlist: an acute signal (its insert writes the disposition), its notices, and the
  -- Smart Rounding exec alert the engine raises for in-app notices.
  PERFORM set_config('request.jwt.claims', '', false);  -- the watchlist engine writes as the system
  SELECT r.* INTO v_rule FROM public.watchlist_signal_rules r WHERE r.organization_id = x.org AND r.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.watchlist_signal_instances i WHERE i.resident_id = x.r2 AND i.signal_key = r.signal_key AND i.status <> 'cleared' AND i.deleted_at IS NULL)
  ORDER BY r.sort_order, r.id LIMIT 1;
  INSERT INTO public.watchlist_signal_instances (organization_id, entity_id, facility_id, resident_id, signal_rule_id, signal_key, severity_class, severity_weight, source_kind,
    first_detected_at, last_evaluated_at, evidence)
  VALUES (x.org, x.entity, x.hw, x.r2, v_rule.id, v_rule.signal_key, 'critical', 90, 'clinical', now(), now(), '{"proof": "COL-849"}'::jsonb)
  RETURNING id INTO v_instance;
  v_n := haven.notify_watchlist_acute(x.hw, now());
  IF v_n = 0 THEN
    -- The replay's band rules did not rate the signal acute; queue the notices notify_watchlist_acute writes.
    INSERT INTO public.watchlist_signal_notifications (organization_id, facility_id, signal_instance_id, notification_route_id, target_role, target_user_id, target_phone, channel, status, send_after)
    SELECT x.org, x.hw, v_instance, NULL::uuid, 'administrator', x.admin_u, '555-010-0199', ch, 'queued', now() FROM unnest(ARRAY['in_app', 'push', 'sms']) ch
    UNION ALL SELECT x.org, x.hw, v_instance, NULL::uuid, 'owner', x.brian, NULL, 'push', 'queued', now();
  END IF;
  PERFORM public.claim_smart_rounding_notifications(x.org, x.hw, gen_random_uuid(), now(), 50);

  -- Monitoring order notices (the order itself predates the window).
  INSERT INTO public.resident_monitoring_order_notifications (organization_id, facility_id, monitoring_order_id, target_role, target_user_id, target_phone, channel, status, send_after)
  SELECT x.org, x.hw, x.monitoring_order, 'administrator', x.admin_u, '555-010-0199', ch, 'queued', now() FROM unnest(ARRAY['in_app', 'sms']) ch;

  -- Handoff: Alpha writes, Bravo reads.
  PERFORM pg_temp.as_user(x.a_u, x.a_s);
  INSERT INTO public.shift_handoff_notes (organization_id, facility_id, shift_date, shift, note, priority, category, created_by)
  SELECT x.org, x.hw, v_service, 'day', 'COL-849 proof handoff', 'normal', 'other', x.a_u;
  PERFORM pg_temp.as_user(x.b_u, x.b_s);
  UPDATE public.shift_handoff_notes n SET acknowledged_by = x.b_u, acknowledged_at = now()
  WHERE n.facility_id = x.hw AND n.note = 'COL-849 proof handoff' AND n.acknowledged_at IS NULL;
  INSERT INTO public.shift_handoffs (facility_id, organization_id, handoff_date, outgoing_shift, incoming_shift, outgoing_staff_id, incoming_staff_id, outgoing_notes)
  VALUES (x.hw, x.org, v_service, 'day', 'night', x.a_u, x.b_u, 'COL-849 proof');

  -- A manager correction on the timesheet, then everyone clocks out.
  INSERT INTO public.time_punch_corrections (organization_id, facility_id, staff_id, correction_type, punch_type, corrected_punched_at, reason, corrected_by)
  VALUES (x.org, x.hw, x.b_staff, 'add_punch', 'meal_start', now() - interval '30 minutes', 'missed_punch', x.brian);
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.ok(public.timeclock_record_punch(x.kiosk_token, 'HW-A1', NULL, '111111', 'meal_start', clock_timestamp(), gen_random_uuid(), false), p_phase || ' Alpha meal start');
  PERFORM pg_temp.ok(public.timeclock_record_punch(x.kiosk_token, 'HW-A1', NULL, '111111', 'meal_end', clock_timestamp(), gen_random_uuid(), false), p_phase || ' Alpha meal end');
  PERFORM pg_temp.ok(public.timeclock_record_punch(x.kiosk_token, 'HW-A1', NULL, '111111', 'out', clock_timestamp(), gen_random_uuid(), false), p_phase || ' Alpha clock out');
  PERFORM pg_temp.ok(public.timeclock_record_punch(x.kiosk_token, 'HW-B2', NULL, '222222', 'out', clock_timestamp(), gen_random_uuid(), false), p_phase || ' Bravo clock out');

  -- A medication pass on Alpha's shift if the clock-in did not generate one.
  IF NOT EXISTS (SELECT 1 FROM public.med_passes m JOIN public.med_tech_shifts s ON s.id = m.shift_id WHERE s.facility_id = x.hw AND s.created_at >= now() - interval '1 hour') THEN
    INSERT INTO public.med_passes (organization_id, facility_id, shift_id, resident_id, resident_medication_id, administered_by)
    SELECT x.org, x.hw, s.id, rm.resident_id, rm.id, x.a_u
    FROM public.med_tech_shifts s, public.resident_medications rm
    WHERE s.facility_id = x.hw AND s.user_id = x.a_u AND s.created_at >= now() - interval '1 hour' AND rm.facility_id = x.hw
    ORDER BY s.created_at DESC, rm.id LIMIT 1;
  END IF;
  PERFORM set_config('request.jwt.claims', '', false);
END
$drive$;

-- Every inventory table must hold a row from the phase just driven.
CREATE FUNCTION pg_temp.col849_expect_every_table(p_since timestamptz, p_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; v_n bigint; v_missing text[] := ARRAY[]::text[];
BEGIN
  FOR r IN SELECT t.tbl FROM px_tables t ORDER BY t.ord LOOP
    EXECUTE format('SELECT count(*) FROM public.%I x WHERE %s', r.tbl, pg_temp.col849_where(r.tbl, p_since, true)) INTO v_n;
    IF v_n = 0 THEN v_missing := v_missing || r.tbl; END IF;
  END LOOP;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'The % phase wrote no row to: %', p_phase, array_to_string(v_missing, ', ');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Pre-window activity, moved to 2026-09-24 (before the window start). The move is a
--    fixture step: the append-only guards are switched off for it by name and back on.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE px_times AS SELECT clock_timestamp() AS t0, NULL::timestamptz AS t1;
SELECT pg_temp.col849_drive('pre');
SELECT pg_temp.col849_expect_every_table((SELECT t0 FROM px_times), 'pre-window');
-- Pre-window alerts were resolved before the window (homewood-clear-pre-go-live.sql did this on production).
UPDATE public.exec_alerts a SET resolved_at = now(), status = 'resolved' WHERE a.facility_id = (SELECT hw FROM px) AND a.resolved_at IS NULL;
UPDATE public.care_plan_review_alerts c SET status = 'resolved', resolved_at = now() WHERE c.facility_id = (SELECT hw FROM px) AND c.status IN ('open', 'acknowledged');
-- Monitoring orders the pre-window falls placed were completed before the window.
UPDATE public.resident_monitoring_orders o SET status = 'completed', closed_at = now()
WHERE o.facility_id = (SELECT hw FROM px) AND o.source_watch_instance_id IS NOT NULL AND o.status = 'active';

DO $shift$
DECLARE
  c_guards CONSTANT text[] := ARRAY['time_punches.tr_time_punches_append_only', 'time_punch_corrections.tr_time_punch_corrections_append_only',
    'timeclock_sync_rejections.tr_timeclock_sync_rejections_append_only', 'resident_observation_logs.tr_rounding_logs_immutable',
    'rounding_completion_receipts.tr_rounding_completion_receipts_immutable', 'floor_unlocks.tr_floor_unlocks_guard'];
  -- Everything at Homewood stamped inside the window so far moves: the pre-window drive and
  -- the replay's own seed rows (the replay ran today, so its seeds carry today's clock).
  v_t0 CONSTANT timestamptz := (SELECT ws FROM px);
  v_delta interval := (SELECT t0 FROM px_times) - '2026-09-24 14:00:00+00'::timestamptz;
  v_guard text;
  v_n bigint;
  r record;
BEGIN
  PERFORM set_config('haven.care_event_definer', '1', true);  -- the fixture move is not a reporter edit
  FOREACH v_guard IN ARRAY c_guards LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', split_part(v_guard, '.', 1), split_part(v_guard, '.', 2));
  END LOOP;
  -- Children through their parents first, then every table by its own scope column.
  UPDATE public.exec_alert_user_state x SET created_at = x.created_at - v_delta
  WHERE x.exec_alert_id IN (SELECT a.id FROM public.exec_alerts a WHERE a.facility_id = (SELECT hw FROM px) AND a.created_at >= v_t0);
  UPDATE public.exec_actions x SET created_at = x.created_at - v_delta
  WHERE x.alert_id IN (SELECT a.id FROM public.exec_alerts a WHERE a.facility_id = (SELECT hw FROM px) AND a.created_at >= v_t0);
  FOR r IN SELECT t.tbl FROM px_tables t WHERE t.tbl NOT IN ('exec_alert_user_state', 'exec_actions', 'incident_root_causes') LOOP
    EXECUTE format('UPDATE public.%I x SET %I = x.%I - %L::interval WHERE x.facility_id = %L AND x.%I >= %L',
                   r.tbl, pg_temp.col849_scope_column(r.tbl), pg_temp.col849_scope_column(r.tbl), v_delta, (SELECT hw FROM px), pg_temp.col849_scope_column(r.tbl), v_t0);
  END LOOP;
  UPDATE storage.objects o SET created_at = o.created_at - v_delta WHERE o.bucket_id = 'incident-photos' AND o.created_at >= v_t0;
  FOREACH v_guard IN ARRAY c_guards LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', split_part(v_guard, '.', 1), split_part(v_guard, '.', 2));
  END LOOP;
  FOR r IN SELECT t.tbl FROM px_tables t LOOP
    EXECUTE format('SELECT count(*) FROM public.%I x WHERE %s', r.tbl, pg_temp.col849_where(r.tbl, (SELECT ws FROM px), false)) INTO v_n;
    IF v_n = 0 THEN RAISE EXCEPTION 'No pre-window row in %', r.tbl; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I x WHERE %s', r.tbl, pg_temp.col849_where(r.tbl, (SELECT ws FROM px), true)) INTO v_n;
    IF v_n > 0 THEN RAISE EXCEPTION '% rows of % are still inside the window after the fixture move', v_n, r.tbl; END IF;
  END LOOP;
END
$shift$;

-- Rows at other facilities, to show the wipe leaves them alone.
INSERT INTO public.exec_alerts (organization_id, facility_id, source_module, severity, title, body)
SELECT org, other_fac, 'staff', 'warning', 'Nobody is scheduled for the Day at Oakridge ALF on September 26, 2026', 'COL-849 proof, other facility' FROM px;
INSERT INTO public.visitor_log_entries (organization_id, facility_id, visitor_name, visitor_type, checked_in_at)
SELECT org, other_fac, 'Proof Other Facility Visitor', 'family_friend', now() FROM px;
SELECT set_config('request.jwt.claims', '', false), set_config('haven.admission_handoff', '7b0c5a4e-0849-4000-8000-000000000001', false);
INSERT INTO public.shift_handoff_notes (organization_id, facility_id, shift_date, shift, note, priority, category, source_kind, source_id)
SELECT org, other_fac, current_date, 'day', 'COL-849 proof, other facility', 'normal', 'other', 'admission_arrival', '7b0c5a4e-0849-4000-8000-000000000001' FROM px;
CREATE FUNCTION pg_temp.col849_other_facilities_hash() RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; v text; v_all text := '';
BEGIN
  FOR r IN SELECT t.tbl FROM px_tables t WHERE EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = format('public.%I', t.tbl)::regclass AND a.attname = 'facility_id') ORDER BY t.ord LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text), '''' ORDER BY md5(to_jsonb(x)::text)), '''')) FROM public.%I x WHERE x.facility_id <> %L', r.tbl, (SELECT hw FROM px)) INTO v;
    v_all := v_all || r.tbl || ':' || v || ';';
  END LOOP;
  RETURN md5(v_all);
END $$;
CREATE TEMP TABLE px_state AS
SELECT pg_temp.col849_other_facilities_hash() AS other_hash_before, NULL::text AS other_hash_after,
       NULL::jsonb AS config_before, NULL::jsonb AS config_after,
       (SELECT count(*) FROM public.timeclock_devices d WHERE d.facility_id = (SELECT hw FROM px)) AS devices_before,
       (SELECT count(*) FROM public.timeclock_credentials c WHERE c.staff_id IN ((SELECT a_staff FROM px), (SELECT b_staff FROM px))) AS credentials_before,
       NULL::text AS dry_run_stop;

-- ---------------------------------------------------------------------------
-- 3. Open the window: dry run (records the configuration before), then apply.
-- ---------------------------------------------------------------------------
\ir ../homewood-test-window-open.sql
UPDATE px_state SET config_before = pg_temp.col849_config((SELECT org FROM px), (SELECT hw FROM px));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.facility_cadence_versions v WHERE v.facility_id = (SELECT hw FROM px) AND v.change_reason LIKE 'COL-849%') THEN
    RAISE EXCEPTION 'The open dry run changed the cadence';
  END IF;
END $$;
SET haven.col849_apply = 'homewood-test-window-open';
\ir ../homewood-test-window-open.sql
DO $$
DECLARE x record; v_test uuid; v_resume uuid;
BEGIN
  SELECT * INTO x FROM px;
  v_test := public.facility_cadence_in_force(x.hw, now());
  IF NOT EXISTS (SELECT 1 FROM public.facility_cadence_versions v WHERE v.id = v_test AND v.change_reason LIKE 'COL-849 test window:%'
                 AND v.effective_to = '2026-10-01 00:00:00+00') THEN
    RAISE EXCEPTION 'The test cadence is not in force until 2026-10-01 00:00+00';
  END IF;
  IF (SELECT count(*) FROM public.facility_cadence_windows w WHERE w.cadence_version_id = v_test AND w.enabled) <> 4 THEN
    RAISE EXCEPTION 'The test cadence does not carry version 3''s four enabled windows';
  END IF;
  IF public.facility_cadence_in_force(x.hw, '2026-10-01 00:00:00+00') IS NOT NULL THEN
    RAISE EXCEPTION 'A cadence is in force at 2026-10-01 00:00+00';
  END IF;
  SELECT v.id INTO v_resume FROM public.facility_cadence_versions v WHERE v.facility_id = x.hw AND v.version_number = 3;
  IF NOT EXISTS (SELECT 1 FROM public.facility_cadence_versions v WHERE v.id = v_resume AND v.status = 'scheduled' AND v.effective_from = '2026-10-01 10:00:00+00') THEN
    RAISE EXCEPTION 'Version 3 is no longer scheduled for 2026-10-01 10:00+00';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.timeclock_facility_settings t WHERE t.facility_id = x.hw AND t.timeclock_enabled) THEN
    RAISE EXCEPTION 'Timeclock is not on after the open';
  END IF;
END $$;
-- A second apply is a no-op.
SET haven.col849_apply = 'homewood-test-window-open';
\ir ../homewood-test-window-open.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM public.facility_cadence_versions v WHERE v.facility_id = (SELECT hw FROM px) AND v.change_reason LIKE 'COL-849%') <> 2
     OR (SELECT count(*) FROM public.audit_log a WHERE a.table_name = 'homewood_test_window') <> 1 THEN
    RAISE EXCEPTION 'A second open apply changed something';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The window.
-- ---------------------------------------------------------------------------
UPDATE px_times SET t1 = clock_timestamp();
SELECT pg_temp.col849_drive('window');
SELECT pg_temp.col849_expect_every_table((SELECT t1 FROM px_times), 'window');

-- Outside alerts reached Brian only: every Homewood push, SMS, voice or email row in the
-- window for anyone else was written as skipped by the fence, and Brian's were not.
DO $$
DECLARE x record; v_others integer; v_brian integer; v_fenced integer;
BEGIN
  SELECT * INTO x FROM px;
  SELECT count(*) FILTER (WHERE d.target_user_id IS DISTINCT FROM x.brian AND d.status NOT IN ('skipped')),
         count(*) FILTER (WHERE d.target_user_id = x.brian AND d.status IN ('queued', 'sending')),
         count(*) FILTER (WHERE d.skip_reason = 'col849_test_window')
  INTO v_others, v_brian, v_fenced
  FROM (SELECT o.target_user_id, o.status, o.skip_reason, o.channel::text AS channel FROM public.observation_escalation_deliveries o WHERE o.facility_id = x.hw AND o.created_at >= (SELECT t1 FROM px_times)
        UNION ALL SELECT c.target_user_id, c.status, c.skip_reason, c.channel FROM public.care_event_deliveries c WHERE c.facility_id = x.hw AND c.created_at >= (SELECT t1 FROM px_times)
        UNION ALL SELECT w.target_user_id, w.status, w.skip_reason, w.channel FROM public.watchlist_signal_notifications w WHERE w.facility_id = x.hw AND w.created_at >= (SELECT t1 FROM px_times)
        UNION ALL SELECT m.target_user_id, m.status, m.skip_reason, m.channel FROM public.resident_monitoring_order_notifications m WHERE m.facility_id = x.hw AND m.created_at >= (SELECT t1 FROM px_times)) d
  WHERE d.channel <> 'in_app';
  IF v_others <> 0 THEN RAISE EXCEPTION '% outside alerts for someone other than Brian were not fenced', v_others; END IF;
  IF v_brian = 0 THEN RAISE EXCEPTION 'No outside alert was queued for Brian'; END IF;
  IF v_fenced = 0 THEN RAISE EXCEPTION 'The fence never acted; the proof did not exercise it'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.observation_escalation_deliveries o WHERE o.facility_id = x.hw AND o.created_at >= (SELECT t1 FROM px_times) AND o.channel = 'in_app' AND o.target_user_id = x.admin_u AND o.status = 'queued') THEN
    RAISE EXCEPTION 'In-app escalations to the administrator should still be queued';
  END IF;
  UPDATE px_state SET dry_run_stop = format('others fenced %s, Brian queued %s', v_fenced, v_brian);
END $$;

-- A setting changed while testing (Settings, Timeclock) is put back by the wipe.
UPDATE public.timeclock_facility_settings t SET floor_idle_lock_minutes = 5, kiosk_visitor_sign_ins_per_10_minutes = 40 FROM px WHERE t.facility_id = px.hw;

-- Kept: rows at Homewood in the window that the floor and kiosk flows do not produce.
CREATE TEMP TABLE px_kept (tbl text, id uuid);
WITH a AS (INSERT INTO public.exec_alerts (organization_id, facility_id, source_module, severity, title, body)
           SELECT org, hw, 'finance', 'info', 'COL-849 proof: an alert from another producer', 'kept' FROM px RETURNING id)
INSERT INTO px_kept SELECT 'exec_alerts', id FROM a;
WITH v AS (INSERT INTO public.visitor_log_entries (organization_id, facility_id, visitor_name, visitor_type, checked_in_at)
           SELECT org, hw, 'Proof Front Desk Visitor', 'vendor_contractor', now() FROM px RETURNING id)
INSERT INTO px_kept SELECT 'visitor_log_entries', id FROM v;
SELECT set_config('request.jwt.claims', '', false), set_config('haven.admission_handoff', '7b0c5a4e-0849-4000-8000-000000000002', false);
WITH n AS (INSERT INTO public.shift_handoff_notes (organization_id, facility_id, shift_date, shift, note, priority, category, source_kind, source_id)
           SELECT org, hw, current_date, 'day', 'COL-849 proof: an admissions note', 'normal', 'other', 'admission_arrival', '7b0c5a4e-0849-4000-8000-000000000002' FROM px RETURNING id)
INSERT INTO px_kept SELECT 'shift_handoff_notes', id FROM n;

-- ---------------------------------------------------------------------------
-- 5. Close the window.
-- ---------------------------------------------------------------------------
\ir ../homewood-test-window-wipe.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM col849_report r WHERE r.section = 'STOP' AND r.detail = 'test photos are still in Storage') THEN
    RAISE EXCEPTION 'The wipe dry run did not stop on photos still in Storage';
  END IF;
  IF EXISTS (SELECT 1 FROM col849_report r WHERE r.section = 'STOP' AND r.detail <> 'test photos are still in Storage') THEN
    RAISE EXCEPTION 'The wipe dry run reported an unexpected stop: %', (SELECT string_agg(r.detail, '; ') FROM col849_report r WHERE r.section = 'STOP');
  END IF;
  IF (SELECT array_agg(c.tbl ORDER BY c.ord) FROM col849_counts c) IS DISTINCT FROM (SELECT array_agg(t.tbl ORDER BY t.ord) FROM px_tables t) THEN
    RAISE EXCEPTION 'The wipe inventory differs from the proof inventory';
  END IF;
  IF EXISTS (SELECT 1 FROM col849_counts c WHERE c.window_rows = 0) THEN
    RAISE EXCEPTION 'The proof left inventory tables without window rows: %', (SELECT string_agg(c.tbl, ', ') FROM col849_counts c WHERE c.window_rows = 0);
  END IF;
END $$;
CREATE TEMP TABLE px_proof AS SELECT c.ord, c.tbl, c.window_rows AS window_before, c.pre_rows AS pre_before, c.pre_hash AS pre_hash_before,
  c.kept_window_rows AS kept_before, NULL::bigint AS deleted, NULL::bigint AS window_after, NULL::bigint AS pre_after, NULL::text AS pre_hash_after FROM col849_counts c;

-- What homewood-test-window-photos.mjs --apply does through the Storage API.
DELETE FROM storage.objects o USING px WHERE o.bucket_id = 'incident-photos' AND o.name LIKE px.org || '/' || px.hw || '/%' AND o.created_at >= px.ws;

SET haven.col849_apply = 'homewood-test-window-wipe';
\ir ../homewood-test-window-wipe.sql
UPDATE px_proof p SET deleted = c.deleted, window_after = c.window_rows_after, pre_after = c.pre_rows_after, pre_hash_after = c.pre_hash_after
FROM col849_counts c WHERE c.tbl = p.tbl;
UPDATE px_state SET other_hash_after = pg_temp.col849_other_facilities_hash(), config_after = pg_temp.col849_config((SELECT org FROM px), (SELECT hw FROM px));

-- A second apply finds nothing to do.
SET haven.col849_apply = 'homewood-test-window-wipe';
\ir ../homewood-test-window-wipe.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM col849_counts c WHERE c.deleted <> 0) THEN
    RAISE EXCEPTION 'A second wipe deleted rows';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Assertions and the proof table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE x record; s record; v_key text; v_n integer;
BEGIN
  SELECT * INTO x FROM px;
  SELECT * INTO s FROM px_state;
  IF EXISTS (SELECT 1 FROM px_proof p WHERE p.window_after <> 0 OR p.deleted <> p.window_before) THEN
    RAISE EXCEPTION 'Window rows survived: %', (SELECT string_agg(p.tbl, ', ') FROM px_proof p WHERE p.window_after <> 0 OR p.deleted <> p.window_before);
  END IF;
  IF EXISTS (SELECT 1 FROM px_proof p WHERE p.pre_before = 0 OR p.pre_after <> p.pre_before OR p.pre_hash_after <> p.pre_hash_before) THEN
    RAISE EXCEPTION 'Pre-window rows changed: %', (SELECT string_agg(p.tbl, ', ') FROM px_proof p WHERE p.pre_after <> p.pre_before OR p.pre_hash_after <> p.pre_hash_before);
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgname IN ('tr_time_punches_append_only', 'tr_time_punch_corrections_append_only',
      'tr_timeclock_sync_rejections_append_only', 'tr_rounding_logs_immutable', 'tr_rounding_completion_receipts_immutable', 'tr_rounding_task_write_guard', 'tr_floor_unlocks_guard')) <> 7 THEN
    RAISE EXCEPTION 'A guard trigger is not enabled after the wipe';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled <> 'O' AND t.tgrelid IN (SELECT format('public.%I', p.tbl)::regclass FROM px_tables p)) <> 0 THEN
    RAISE EXCEPTION 'A trigger on an inventory table is left disabled';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['cadence_versions', 'cadence_windows', 'escalation_versions', 'escalation_rungs', 'escalation_rung_shift_overrides',
      'template_binding', 'notification_routes', 'care_event_escalation_policies', 'incident_sequences', 'timeclock_settings', 'fence_triggers', 'fence_function', 'cron'] LOOP
    IF (s.config_after -> v_key) IS DISTINCT FROM (s.config_before -> v_key) THEN
      RAISE EXCEPTION 'Configuration % differs from its value before the open', v_key;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.timeclock_facility_settings t WHERE t.facility_id = x.hw AND t.timeclock_enabled) THEN
    RAISE EXCEPTION 'Timeclock is still on at Homewood';
  END IF;
  -- Nothing the test made is left: the only Homewood rows still stamped inside the window
  -- are the three rows from other producers.
  FOR v_key IN SELECT t.tbl FROM px_tables t LOOP
    EXECUTE format('SELECT count(*) FROM public.%I x WHERE %s', v_key, pg_temp.col849_where(v_key, x.ws, true)) INTO v_n;
    IF v_n <> (SELECT count(*) FROM px_kept k WHERE k.tbl = v_key) THEN
      RAISE EXCEPTION '% Homewood rows of % are still inside the window after the wipe', v_n, v_key;
    END IF;
  END LOOP;
  IF s.other_hash_after IS DISTINCT FROM s.other_hash_before THEN
    RAISE EXCEPTION 'Rows at another facility changed';
  END IF;
  IF (SELECT count(*) FROM px_kept k WHERE (k.tbl = 'exec_alerts' AND EXISTS (SELECT 1 FROM public.exec_alerts a WHERE a.id = k.id))
      OR (k.tbl = 'visitor_log_entries' AND EXISTS (SELECT 1 FROM public.visitor_log_entries a WHERE a.id = k.id))
      OR (k.tbl = 'shift_handoff_notes' AND EXISTS (SELECT 1 FROM public.shift_handoff_notes a WHERE a.id = k.id))) <> 3 THEN
    RAISE EXCEPTION 'A row from another producer was deleted';
  END IF;
  IF (SELECT count(*) FROM public.timeclock_devices d WHERE d.facility_id = x.hw) <> s.devices_before
     OR (SELECT count(*) FROM public.timeclock_credentials c WHERE c.staff_id IN (x.a_staff, x.b_staff)) <> s.credentials_before THEN
    RAISE EXCEPTION 'Devices or credentials were deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.timeclock_credentials c WHERE c.staff_id IN (x.a_staff, x.b_staff) AND (c.failed_attempts <> 0 OR c.locked_until IS NOT NULL))
     OR EXISTS (SELECT 1 FROM public.timeclock_devices d WHERE d.facility_id = x.hw AND (d.failure_count <> 0 OR d.throttled_until IS NOT NULL OR d.visitor_failure_count <> 0)) THEN
    RAISE EXCEPTION 'Lockouts or throttles were not reset';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'col695-homewood-timeclock-on' AND j.active AND j.schedule = '30 9 1 10 *') THEN
    RAISE EXCEPTION 'The Oct 1 cron job was touched';
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_log a WHERE a.table_name = 'resident_observation_logs' AND a.action = 'DELETE' AND a.facility_id = x.hw;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'The audit trail did not record the deletion of rounding logs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facility_cadence_versions v WHERE v.facility_id = x.hw AND v.version_number = 2 AND v.status = 'active' AND v.effective_to IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.facility_cadence_versions v WHERE v.facility_id = x.hw AND v.version_number = 3 AND v.status = 'scheduled' AND v.effective_from = '2026-10-01 10:00:00+00')
     OR (SELECT count(*) FROM public.facility_cadence_versions v WHERE v.facility_id = x.hw) <> 3 THEN
    RAISE EXCEPTION 'Cadence is not back to version 2 active and version 3 scheduled';
  END IF;
END $$;

\echo '[LOCAL PROOF]'
SELECT p.ord AS "#", p.tbl AS "table", p.window_before AS "window rows before", p.window_after AS "window rows after",
       CASE WHEN p.window_before > 0 THEN round(100.0 * p.deleted / p.window_before) || '%' END AS "removed",
       p.pre_before AS "pre-window before", p.pre_after AS "pre-window after",
       CASE WHEN p.pre_hash_after = p.pre_hash_before THEN 'unchanged' ELSE 'CHANGED' END AS "pre-window rows",
       p.kept_before AS "other producers kept"
FROM px_proof p ORDER BY p.ord;
SELECT 'guard ' || c.relname || '.' || t.tgname AS "check", CASE WHEN t.tgenabled = 'O' THEN 'enabled' ELSE 'NOT ENABLED' END AS "result"
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal AND t.tgname IN ('tr_time_punches_append_only', 'tr_time_punch_corrections_append_only', 'tr_timeclock_sync_rejections_append_only',
  'tr_rounding_logs_immutable', 'tr_rounding_completion_receipts_immutable', 'tr_rounding_task_write_guard', 'tr_floor_unlocks_guard')
UNION ALL
SELECT 'configuration ' || k, CASE WHEN (s.config_after -> k) IS NOT DISTINCT FROM (s.config_before -> k) THEN 'equal to before the open' ELSE 'DIFFERENT' END
FROM px_state s, unnest(ARRAY['cadence_versions', 'cadence_windows', 'escalation_versions', 'escalation_rungs', 'escalation_rung_shift_overrides',
  'template_binding', 'notification_routes', 'care_event_escalation_policies', 'incident_sequences', 'timeclock_settings', 'fence_triggers', 'cron']) k
UNION ALL SELECT 'timeclock_enabled at Homewood', (SELECT t.timeclock_enabled::text FROM public.timeclock_facility_settings t, px WHERE t.facility_id = px.hw)
UNION ALL SELECT 'cron col695-homewood-timeclock-on', (SELECT j.schedule || CASE WHEN j.active THEN ', active' ELSE ', NOT ACTIVE' END FROM cron.job j WHERE j.jobname = 'col695-homewood-timeclock-on')
UNION ALL SELECT 'rows at other facilities', CASE WHEN s.other_hash_after = s.other_hash_before THEN 'unchanged' ELSE 'CHANGED' END FROM px_state s
UNION ALL SELECT 'rows from other producers in the window', (SELECT count(*) || ' of 3 kept' FROM px_kept k WHERE EXISTS (SELECT 1 FROM public.exec_alerts a WHERE a.id = k.id)
  OR EXISTS (SELECT 1 FROM public.visitor_log_entries a WHERE a.id = k.id) OR EXISTS (SELECT 1 FROM public.shift_handoff_notes a WHERE a.id = k.id))
UNION ALL SELECT 'outside alerts during the window', s.dry_run_stop FROM px_state s;
