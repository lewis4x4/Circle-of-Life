-- Escalation policy acceptance, spec 25A items 7 and 20 plus the per shift
-- override rule and the re-tick rule, asserted in SQL against a replayed
-- database.
--
--   node scripts/smart-rounding/run-escalation-ladder-acceptance.mjs
--
-- or directly, against a replay you already have:
--
--   psql -d <replay> -v ON_ERROR_STOP=1 -f scripts/smart-rounding/escalation-ladder-acceptance.sql
--
-- Everything happens inside one transaction that rolls back, including the
-- auth.uid() redefinition that stands in for a signed in caller, so the script
-- is safe to re-run and leaves nothing behind. All fixture data is synthetic:
-- no resident, no staff member and no facility here corresponds to a real one.
--
-- "Clock advanced" means the explicit p_at argument on
-- public.observation_escalations_due and
-- public.record_observation_escalation_rung, which is how the engine passes the
-- tick instant. The script walks that instant from window_close minus 15
-- through window_close plus 90 and asserts what exists at each stop.
--
-- The script asserts no offset it wrote itself. Every expected fire time is
-- read back out of facility_escalation_rungs, so a facility that reconfigures
-- its ladder changes the expectations with it and the test still means
-- something.

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE FUNCTION pg_temp.esc_assert (ok boolean, msg text)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'escalation-ladder-acceptance FAILED: %', msg;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.esc_sign_in (p_user uuid, p_session uuid)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_version integer;
BEGIN
  SELECT
    up.auth_claim_version INTO v_version
  FROM
    public.user_profiles up
  WHERE
    up.id = p_user;
  PERFORM
    set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_user, 'session_id', p_session, 'auth_claim_version', v_version::text)::text, TRUE);
END
$$;

CREATE TEMP TABLE esc_result (
  seq serial,
  check_name text,
  detail text
);

CREATE OR REPLACE FUNCTION auth.uid ()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = public
  AS $f$
  SELECT
    NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'sub', '')::uuid
$f$;

-- ---------------------------------------------------------------------------
-- 1. One grace rule, not two. The standard cadence grace and the interval
--    scaled grace are the same function, which is spec section 5.2's point.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_expected CONSTANT integer[] := ARRAY[10, 15, 30, 60];
  v_intervals CONSTANT integer[] := ARRAY[30, 60, 120, 240];
  v_got integer;
  i integer;
  v_seeded_grace integer;
BEGIN
  FOR i IN 1..4 LOOP
    v_got := public.observation_grace_minutes (v_intervals[i]);
    PERFORM
      pg_temp.esc_assert (v_got = public.monitoring_order_grace_minutes (v_intervals[i]), format('observation_grace_minutes and monitoring_order_grace_minutes disagree at interval %s', v_intervals[i]));
    PERFORM
      pg_temp.esc_assert (v_got = v_expected[i], format('grace at interval %s should be %s, got %s', v_intervals[i], v_expected[i], v_got));
  END LOOP;

  -- The seeded standard cadence grace is what the formula returns for the
  -- standard spacing. If somebody edits one and not the other this fails.
  SELECT
    DISTINCT w.grace_after_minutes INTO v_seeded_grace
  FROM
    public.facility_cadence_windows w
    JOIN public.facility_cadence_versions v ON v.id = w.cadence_version_id
  WHERE
    v.version_number = 1
    AND w.window_key = 'mid_morning'
  LIMIT 1;
  PERFORM
    pg_temp.esc_assert (v_seeded_grace = public.observation_grace_minutes (240), format('the seeded mid_morning grace (%s) should fall out of the one grace rule at the standard spacing (%s)', v_seeded_grace, public.observation_grace_minutes (240)));

  INSERT INTO esc_result (check_name, detail)
    VALUES ('one grace rule', format('interval 30/60/120/240 gives 10/15/30/60 through both entry points; the seeded standard grace is %s and comes from the same formula', v_seeded_grace));
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Fixture. A synthetic organization, one facility, one resident, an aide the
--    task is assigned to, and an administrator. Shift definitions, cadence and
--    escalation policy are all copied from the seeded rows so the test never
--    restates a time, an offset or a channel.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000002';
  v_facility CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000004';
  v_aide_user CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000005';
  v_admin_user CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000006';
  v_aide_staff CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000007';
  v_admin_staff CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000008';
  v_cadence CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000009';
  v_escalation CONSTANT uuid := 'e5ca0000-0000-4000-8000-00000000000a';
  v_source_cadence uuid;
  v_source_escalation uuid;
  v_source_facility uuid;
BEGIN
  INSERT INTO public.organizations (id, name)
    VALUES (v_org, 'Synthetic Escalation Organization');
  INSERT INTO public.entities (id, organization_id, name)
    VALUES (v_entity, v_org, 'Synthetic Escalation Entity');
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
    VALUES (v_facility, v_entity, v_org, 'Synthetic Escalation Facility', '1 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York');

  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender)
    VALUES (v_resident, v_facility, v_org, 'Watched', 'Synthetic', 'active', 'prefer_not_to_say');

  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, ROLE, created_at, updated_at, confirmation_token)
    VALUES (v_aide_user, '00000000-0000-0000-0000-000000000000', 'synthetic-esc-aide@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), ''),
    (v_admin_user, '00000000-0000-0000-0000-000000000000', 'synthetic-esc-admin@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), '');
  INSERT INTO auth.sessions (id, user_id)
    VALUES ('e5ca0000-0000-4000-8000-00000000000b', v_aide_user),
    ('e5ca0000-0000-4000-8000-00000000000c', v_admin_user);

  INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role, is_active, phone)
    VALUES (v_aide_user, v_org, 'synthetic-esc-aide@haven.test', 'Synthetic Aide', 'caregiver', TRUE, '+15550000001'),
    (v_admin_user, v_org, 'synthetic-esc-admin@haven.test', 'Synthetic Administrator', 'facility_admin', TRUE, '+15550000002');
  INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
    VALUES (v_aide_user, v_facility, v_org, TRUE),
    (v_admin_user, v_facility, v_org, TRUE);

  INSERT INTO public.staff (id, facility_id, organization_id, first_name, last_name, staff_role, hire_date, user_id, phone)
    VALUES (v_aide_staff, v_facility, v_org, 'Synthetic', 'Aide', 'resident_aide', current_date, v_aide_user, '+15550000001'),
    (v_admin_staff, v_facility, v_org, 'Synthetic', 'Administrator', 'administrator', current_date, v_admin_user, '+15550000002');

  -- A standing route that targets the administrator, so the recipient
  -- resolution exercises the real notification_routes path rather than the
  -- no-route fallback.
  INSERT INTO public.notification_routes (organization_id, facility_id, name, channels, staff_role_targets, is_active)
    VALUES (v_org, v_facility, 'Synthetic standing alert audience', ARRAY['in_app'], ARRAY['administrator']::public.staff_role[], TRUE);

  SELECT
    v.id,
    v.facility_id INTO v_source_cadence,
    v_source_facility
  FROM
    public.facility_cadence_versions v
  WHERE
    v.status = 'active'
    AND v.deleted_at IS NULL
  ORDER BY
    v.created_at
  LIMIT 1;
  PERFORM
    pg_temp.esc_assert (v_source_cadence IS NOT NULL, 'the seeded cadence version from migration 412 is missing');

  SELECT
    v.id INTO v_source_escalation
  FROM
    public.facility_escalation_versions v
  WHERE
    v.facility_id = v_source_facility
    AND v.status = 'active'
    AND v.deleted_at IS NULL
  LIMIT 1;
  PERFORM
    pg_temp.esc_assert (v_source_escalation IS NOT NULL, 'the seeded escalation version from migration 415 is missing');

  INSERT INTO public.facility_shift_definitions (organization_id, facility_id, shift_key, roster_shift_type, label, starts_at_local, ends_at_local, sort_order)
  SELECT
    v_org,
    v_facility,
    s.shift_key,
    s.roster_shift_type,
    s.label,
    s.starts_at_local,
    s.ends_at_local,
    s.sort_order
  FROM
    public.facility_shift_definitions s
  WHERE
    s.facility_id = v_source_facility;

  INSERT INTO public.facility_cadence_versions (id, organization_id, facility_id, version_number, status, effective_from, change_reason)
    VALUES (v_cadence, v_org, v_facility, 1, 'active', now() - interval '60 days', 'Synthetic acceptance fixture');

  INSERT INTO public.facility_cadence_windows (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
  SELECT
    v_org,
    v_facility,
    v_cadence,
    w.window_key,
    w.label,
    w.due_at_local,
    w.grace_before_minutes,
    w.grace_after_minutes,
    w.shift_key,
    w.sort_order,
    w.enabled
  FROM
    public.facility_cadence_windows w
  WHERE
    w.cadence_version_id = v_source_cadence;

  INSERT INTO public.facility_escalation_versions (id, organization_id, facility_id, version_number, status, effective_from, change_reason)
    VALUES (v_escalation, v_org, v_facility, 1, 'active', now() - interval '60 days', 'Synthetic acceptance fixture');

  INSERT INTO public.facility_escalation_rungs (organization_id, facility_id, escalation_version_id, rung_key, label, offset_minutes, is_terminal, assigned_staff_only, include_assigned_staff, use_standing_alert_routes, target_staff_roles, channels, protocol_text, sort_order, enabled)
  SELECT
    v_org,
    v_facility,
    v_escalation,
    r.rung_key,
    r.label,
    r.offset_minutes,
    r.is_terminal,
    r.assigned_staff_only,
    r.include_assigned_staff,
    r.use_standing_alert_routes,
    r.target_staff_roles,
    r.channels,
    r.protocol_text,
    r.sort_order,
    r.enabled
  FROM
    public.facility_escalation_rungs r
  WHERE
    r.escalation_version_id = v_source_escalation;

  INSERT INTO public.facility_escalation_rung_shift_overrides (organization_id, facility_id, escalation_version_id, escalation_rung_id, shift_key, offset_minutes, channels)
  SELECT
    v_org,
    v_facility,
    v_escalation,
    mine.id,
    ov.shift_key,
    ov.offset_minutes,
    ov.channels
  FROM
    public.facility_escalation_rung_shift_overrides ov
    JOIN public.facility_escalation_rungs source ON source.id = ov.escalation_rung_id
    JOIN public.facility_escalation_rungs mine ON mine.escalation_version_id = v_escalation
      AND mine.rung_key = source.rung_key
  WHERE
    source.escalation_version_id = v_source_escalation;

  INSERT INTO esc_result (check_name, detail)
  SELECT
    'fixture',
    format('%s rungs and %s shift overrides copied from the seeded escalation version', (
        SELECT
          count(*)
        FROM public.facility_escalation_rungs
        WHERE
          escalation_version_id = v_escalation), (
        SELECT
          count(*)
        FROM public.facility_escalation_rung_shift_overrides
        WHERE
          escalation_version_id = v_escalation));
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Acceptance item 7, clock advanced.
--
-- A missed mid_morning window produces escalation rows at window_close plus 30,
-- 60 and 90, and a nudge at window_close minus 15. The offsets are read out of
-- the rung rows rather than written here, and the tick instant is walked by
-- hand through the p_at argument the engine uses.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000002';
  v_facility CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000004';
  v_aide_staff CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000007';
  v_cadence CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000009';
  v_service_date date;
  v_task uuid;
  v_window record;
  v_close timestamptz;
  v_rung record;
  v_fired jsonb;
  v_due integer;
  v_count integer;
  v_status text;
  v_detail text := '';
BEGIN
  v_service_date := ((now() - interval '2 days') AT TIME ZONE 'America/New_York')::date;

  SELECT
    w.* INTO v_window
  FROM
    public.facility_observation_windows_for_version (v_facility, v_cadence, v_service_date) w
  WHERE
    w.window_key = 'mid_morning';
  PERFORM
    pg_temp.esc_assert (v_window.window_key IS NOT NULL, 'the mid_morning window did not project for the fixture facility');

  INSERT INTO public.resident_observation_tasks (organization_id, entity_id, facility_id, resident_id, cadence_version_id, window_key, service_date, assigned_staff_id, scheduled_for, due_at, grace_ends_at, status)
    VALUES (v_org, v_entity, v_facility, v_resident, v_cadence, 'mid_morning', v_service_date, v_aide_staff, v_window.window_opens_at_utc, v_window.due_at_utc, v_window.window_closes_at_utc, 'upcoming')
  RETURNING
    id INTO v_task;

  -- The resolver, not the stored column, is what the ladder measures from.
  v_close := public.observation_task_window_close (v_task);
  PERFORM
    pg_temp.esc_assert (v_close = v_window.window_closes_at_utc, format('window close should resolve to the projected close, got %s against %s', v_close, v_window.window_closes_at_utc));

  -- Nothing is due before the first rung's offset has passed.
  SELECT
    count(*) INTO v_due
  FROM
    public.observation_escalations_due (v_org, v_facility, v_close - interval '30 minutes', 500);
  PERFORM
    pg_temp.esc_assert (v_due = 0, format('no rung should be due half an hour before the window closes, got %s', v_due));

  -- Walk every enabled rung in ladder order at exactly its own fire time.
  FOR v_rung IN
  SELECT
    r.rung_key,
    r.offset_minutes,
    r.assigned_staff_only,
    r.is_terminal,
    r.sort_order
  FROM
    public.observation_escalation_rungs_at (v_facility, v_close, 'day') r
  ORDER BY
    r.offset_minutes LOOP
      SELECT
        count(*) INTO v_due
      FROM
        public.observation_escalations_due (v_org, v_facility, v_close + make_interval(mins => v_rung.offset_minutes), 500) d
      WHERE
        d.rung_key = v_rung.rung_key
        AND d.task_id = v_task;
      PERFORM
        pg_temp.esc_assert (v_due = 1, format('rung %s should be due exactly at window close %s minutes, got %s rows', v_rung.rung_key, v_rung.offset_minutes, v_due));

      -- And not a minute earlier.
      SELECT
        count(*) INTO v_due
      FROM
        public.observation_escalations_due (v_org, v_facility, v_close + make_interval(mins => v_rung.offset_minutes) - interval '1 minute', 500) d
      WHERE
        d.rung_key = v_rung.rung_key
        AND d.task_id = v_task;
      PERFORM
        pg_temp.esc_assert (v_due = 0, format('rung %s must not be due a minute early', v_rung.rung_key));

      v_fired := public.record_observation_escalation_rung (v_task, v_rung.rung_key, v_close + make_interval(mins => v_rung.offset_minutes));
      PERFORM
        pg_temp.esc_assert ((v_fired ->> 'fired')::boolean, format('rung %s did not fire: %s', v_rung.rung_key, v_fired ->> 'reason'));
      PERFORM
        pg_temp.esc_assert ((v_fired ->> 'is_escalation')::boolean = NOT v_rung.assigned_staff_only, format('rung %s reported the wrong kind', v_rung.rung_key));

      v_detail := v_detail || format('%s at close%s%s min; ', v_rung.rung_key, CASE WHEN v_rung.offset_minutes >= 0 THEN
        ' +'
      ELSE
        ' '
      END, v_rung.offset_minutes);
    END LOOP;

  -- The nudge fired and is not an escalation.
  SELECT
    count(*) INTO v_count
  FROM
    public.observation_escalation_dispatches d
  WHERE
    d.task_id = v_task;
  PERFORM
    pg_temp.esc_assert (v_count = 4, format('four rungs should have fired, got %s dispatch rows', v_count));

  SELECT
    count(*) INTO v_count
  FROM
    public.observation_escalation_dispatches d
  WHERE
    d.task_id = v_task
    AND d.rung_key = 'nudge'
    AND d.escalation_id IS NULL;
  PERFORM
    pg_temp.esc_assert (v_count = 1, 'the nudge should have a dispatch row with no escalation attached');

  SELECT
    count(*) INTO v_count
  FROM
    public.resident_observation_escalations e
  WHERE
    e.task_id = v_task;
  PERFORM
    pg_temp.esc_assert (v_count = 3, format('the nudge must not create an escalation row; expected 3 escalations, got %s', v_count));

  -- Each escalation fired at its own offset, is stamped with the version and
  -- the rung, and carries the ladder position as its level.
  FOR v_rung IN
  SELECT
    e.rung_key,
    e.escalation_level,
    e.triggered_at,
    e.escalation_version_id,
    r.offset_minutes,
    r.sort_order
  FROM
    public.resident_observation_escalations e
    JOIN public.observation_escalation_rungs_at (v_facility, v_close, 'day') r ON r.rung_key = e.rung_key
  WHERE
    e.task_id = v_task LOOP
      PERFORM
        pg_temp.esc_assert (v_rung.triggered_at = v_close + make_interval(mins => v_rung.offset_minutes), format('escalation %s fired at %s, expected window close %s minutes', v_rung.rung_key, v_rung.triggered_at, v_rung.offset_minutes));
      PERFORM
        pg_temp.esc_assert (v_rung.escalation_version_id = 'e5ca0000-0000-4000-8000-00000000000a'::uuid, format('escalation %s is not stamped with the version in force', v_rung.rung_key));
      PERFORM
        pg_temp.esc_assert (v_rung.escalation_level = v_rung.sort_order, format('escalation %s recorded level %s against ladder position %s', v_rung.rung_key, v_rung.escalation_level, v_rung.sort_order));
    END LOOP;

  -- The terminal rung marks the task missed, and nothing else did.
  SELECT
    t.status::text INTO v_status
  FROM
    public.resident_observation_tasks t
  WHERE
    t.id = v_task;
  PERFORM
    pg_temp.esc_assert (v_status = 'missed', format('the terminal rung should leave the task missed, got %s', v_status));

  -- The nudge reached the assigned staff member and not the administrator.
  SELECT
    count(*) INTO v_count
  FROM
    public.observation_escalation_deliveries dl
    JOIN public.observation_escalation_dispatches d ON d.id = dl.dispatch_id
  WHERE
    d.task_id = v_task
    AND dl.rung_key = 'nudge'
    AND dl.target_user_id = 'e5ca0000-0000-4000-8000-000000000005'::uuid;
  PERFORM
    pg_temp.esc_assert (v_count >= 1, 'the nudge should reach the staff member the task is assigned to');

  SELECT
    count(*) INTO v_count
  FROM
    public.observation_escalation_deliveries dl
    JOIN public.observation_escalation_dispatches d ON d.id = dl.dispatch_id
  WHERE
    d.task_id = v_task
    AND dl.rung_key = 'nudge'
    AND dl.target_user_id = 'e5ca0000-0000-4000-8000-000000000006'::uuid;
  PERFORM
    pg_temp.esc_assert (v_count = 0, 'the nudge is a staff reminder and must not reach the administrator');

  -- The administrator hears about tier 1.
  SELECT
    count(*) INTO v_count
  FROM
    public.observation_escalation_deliveries dl
    JOIN public.observation_escalation_dispatches d ON d.id = dl.dispatch_id
  WHERE
    d.task_id = v_task
    AND dl.rung_key = 'tier_1'
    AND dl.target_user_id = 'e5ca0000-0000-4000-8000-000000000006'::uuid;
  PERFORM
    pg_temp.esc_assert (v_count >= 1, 'tier 1 should reach the administrator through the notification route');

  INSERT INTO esc_result (check_name, detail)
    VALUES ('acceptance 7: ladder, clock advanced', rtrim(v_detail, '; ') || format(' -- 4 dispatches, 3 escalations, task left %s', v_status));
END
$$;

-- ---------------------------------------------------------------------------
-- 4. A re-tick does not double fire.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000001';
  v_facility CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000003';
  v_task uuid;
  v_close timestamptz;
  v_rung record;
  v_fired jsonb;
  v_dispatches integer;
  v_escalations integer;
  v_deliveries integer;
  v_after_dispatches integer;
  v_after_escalations integer;
  v_after_deliveries integer;
  v_due integer;
BEGIN
  SELECT
    t.id INTO v_task
  FROM
    public.resident_observation_tasks t
  WHERE
    t.facility_id = v_facility
    AND t.window_key = 'mid_morning';
  v_close := public.observation_task_window_close (v_task);

  SELECT
    count(*) INTO v_dispatches
  FROM
    public.observation_escalation_dispatches
  WHERE
    task_id = v_task;
  SELECT
    count(*) INTO v_escalations
  FROM
    public.resident_observation_escalations
  WHERE
    task_id = v_task;
  SELECT
    count(*) INTO v_deliveries
  FROM
    public.observation_escalation_deliveries dl
    JOIN public.observation_escalation_dispatches d ON d.id = dl.dispatch_id
  WHERE
    d.task_id = v_task;

  -- The tick that follows the last one finds nothing due for this task.
  SELECT
    count(*) INTO v_due
  FROM
    public.observation_escalations_due (v_org, v_facility, v_close + interval '1 day', 500) d
  WHERE
    d.task_id = v_task;
  PERFORM
    pg_temp.esc_assert (v_due = 0, format('a later tick should find nothing due for a task whose ladder is spent, got %s', v_due));

  -- And calling the command again anyway changes nothing.
  FOR v_rung IN
  SELECT
    r.rung_key,
    r.offset_minutes
  FROM
    public.observation_escalation_rungs_at (v_facility, v_close, 'day') r LOOP
      v_fired := public.record_observation_escalation_rung (v_task, v_rung.rung_key, v_close + interval '1 day');
      PERFORM
        pg_temp.esc_assert ((v_fired ->> 'fired')::boolean IS FALSE, format('rung %s fired twice', v_rung.rung_key));
      PERFORM
        pg_temp.esc_assert (v_fired ->> 'reason' = 'already_fired', format('rung %s answered %s rather than already_fired', v_rung.rung_key, v_fired ->> 'reason'));
    END LOOP;

  SELECT
    count(*) INTO v_after_dispatches
  FROM
    public.observation_escalation_dispatches
  WHERE
    task_id = v_task;
  SELECT
    count(*) INTO v_after_escalations
  FROM
    public.resident_observation_escalations
  WHERE
    task_id = v_task;
  SELECT
    count(*) INTO v_after_deliveries
  FROM
    public.observation_escalation_deliveries dl
    JOIN public.observation_escalation_dispatches d ON d.id = dl.dispatch_id
  WHERE
    d.task_id = v_task;

  PERFORM
    pg_temp.esc_assert (v_after_dispatches = v_dispatches, format('dispatch rows moved from %s to %s on a re-tick', v_dispatches, v_after_dispatches));
  PERFORM
    pg_temp.esc_assert (v_after_escalations = v_escalations, format('escalation rows moved from %s to %s on a re-tick', v_escalations, v_after_escalations));
  PERFORM
    pg_temp.esc_assert (v_after_deliveries = v_deliveries, format('delivery rows moved from %s to %s on a re-tick', v_deliveries, v_after_deliveries));

  INSERT INTO esc_result (check_name, detail)
    VALUES ('re-tick', format('a second pass over all four rungs answers already_fired and leaves %s dispatches, %s escalations and %s deliveries unchanged', v_dispatches, v_escalations, v_deliveries));
END
$$;

-- ---------------------------------------------------------------------------
-- 5. The night shift override changes channels and not the offset.
--
-- Spec 6.9. A tier 1 push at 02:00 every night gets the channel muted inside a
-- week and takes tier 3 with it, so the night rung is quieter. It is not
-- slower: a resident unseen overnight is not less urgent.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000003';
  v_org CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000002';
  v_resident CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000004';
  v_cadence CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000009';
  v_service_date date;
  v_window record;
  v_night_task uuid;
  v_close timestamptz;
  v_shift text;
  v_day record;
  v_night record;
  v_detail text := '';
  v_overridden integer := 0;
BEGIN
  v_service_date := ((now() - interval '2 days') AT TIME ZONE 'America/New_York')::date;

  SELECT
    w.* INTO v_window
  FROM
    public.facility_observation_windows_for_version (v_facility, v_cadence, v_service_date) w
  WHERE
    w.window_key = 'late_evening';
  PERFORM
    pg_temp.esc_assert (v_window.window_key IS NOT NULL, 'the late_evening window did not project');

  INSERT INTO public.resident_observation_tasks (organization_id, entity_id, facility_id, resident_id, cadence_version_id, window_key, service_date, scheduled_for, due_at, grace_ends_at, status)
    VALUES (v_org, v_entity, v_facility, v_resident, v_cadence, 'late_evening', v_service_date, v_window.window_opens_at_utc, v_window.due_at_utc, v_window.window_closes_at_utc, 'upcoming')
  RETURNING
    id INTO v_night_task;

  v_close := public.observation_task_window_close (v_night_task);

  -- The shift the window closes on is resolved from the shift definitions, not
  -- asserted here.
  SELECT
    sw.shift_key INTO v_shift
  FROM
    public.facility_shift_window_at (v_facility, v_close) sw;
  PERFORM
    pg_temp.esc_assert (v_shift IS NOT NULL, 'the late_evening window close did not land on any defined shift');

  FOR v_day IN
  SELECT
    r.rung_key,
    r.offset_minutes,
    r.channels,
    r.shift_override_applied
  FROM
    public.observation_escalation_rungs_at (v_facility, v_close, 'day') r
  ORDER BY
    r.sort_order LOOP
      SELECT
        n.rung_key,
        n.offset_minutes,
        n.channels,
        n.shift_override_applied INTO v_night
      FROM
        public.observation_escalation_rungs_at (v_facility, v_close, v_shift) n
      WHERE
        n.rung_key = v_day.rung_key;

      PERFORM
        pg_temp.esc_assert (v_night.offset_minutes = v_day.offset_minutes, format('rung %s changed offset between shifts: %s against %s', v_day.rung_key, v_day.offset_minutes, v_night.offset_minutes));

      IF v_night.shift_override_applied THEN
        v_overridden := v_overridden + 1;
        v_detail := v_detail || format('%s %s -> %s; ', v_day.rung_key, array_to_string(v_day.channels, '+'), array_to_string(v_night.channels, '+'));
      END IF;
    END LOOP;

  PERFORM
    pg_temp.esc_assert (v_overridden >= 1, 'no rung carried a shift override, so the override rule was not exercised');

  -- And the rung the engine actually fires on the night task uses the
  -- overridden channels.
  PERFORM
    public.record_observation_escalation_rung (v_night_task, 'tier_1', v_close + interval '30 minutes');

  PERFORM
    pg_temp.esc_assert ((
      SELECT
        d.channels
      FROM public.observation_escalation_dispatches d
      WHERE
        d.task_id = v_night_task
        AND d.rung_key = 'tier_1') = (
      SELECT
        n.channels
      FROM public.observation_escalation_rungs_at (v_facility, v_close, v_shift) n
      WHERE
        n.rung_key = 'tier_1'), 'the fired dispatch did not record the shift overridden channels');

  INSERT INTO esc_result (check_name, detail)
    VALUES (format('shift override on the %s shift', v_shift), rtrim(v_detail, '; ') || format(' -- offsets unchanged on all rungs, %s rung(s) overridden', v_overridden));
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Acceptance item 20. send_test_escalation delivers through the real routing
--    with TEST as the first word of the body, creates no escalation row, no
--    dispatch row, and touches no task.
-- ---------------------------------------------------------------------------
SELECT
  pg_temp.esc_sign_in ('e5ca0000-0000-4000-8000-000000000006', 'e5ca0000-0000-4000-8000-00000000000c');

DO $$
DECLARE
  v_facility CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000003';
  v_escalations_before integer;
  v_dispatches_before integer;
  v_tasks_before jsonb;
  v_result jsonb;
  v_escalations_after integer;
  v_dispatches_after integer;
  v_tasks_after jsonb;
  v_bodies integer;
  v_bad_bodies integer;
  v_recipients integer;
BEGIN
  PERFORM
    pg_temp.esc_assert (haven.app_role ()::text = 'facility_admin', 'the fixture caller should resolve as facility_admin, got ' || COALESCE(haven.app_role ()::text, 'null'));

  SELECT
    count(*) INTO v_escalations_before
  FROM
    public.resident_observation_escalations e
  WHERE
    e.facility_id = v_facility;
  SELECT
    count(*) INTO v_dispatches_before
  FROM
    public.observation_escalation_dispatches d
  WHERE
    d.facility_id = v_facility;
  SELECT
    jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'escalated_at', t.escalated_at) ORDER BY t.id) INTO v_tasks_before
  FROM
    public.resident_observation_tasks t
  WHERE
    t.facility_id = v_facility;

  v_result := public.send_test_escalation (v_facility, 'tier_2');

  PERFORM
    pg_temp.esc_assert (v_result ->> 'rung_key' = 'tier_2', 'the test send did not report the rung it sent');
  PERFORM
    pg_temp.esc_assert (left(v_result ->> 'body', 5) = 'TEST ', 'TEST must be the first word of the body, got: ' || left(v_result ->> 'body', 20));
  PERFORM
    pg_temp.esc_assert ((v_result ->> 'escalation_recorded')::boolean IS FALSE, 'the test send claimed it recorded an escalation');

  v_recipients := (v_result ->> 'recipients')::integer;
  PERFORM
    pg_temp.esc_assert (v_recipients >= 1, 'the test send resolved no recipient through the real routing');

  SELECT
    count(*) INTO v_escalations_after
  FROM
    public.resident_observation_escalations e
  WHERE
    e.facility_id = v_facility;
  SELECT
    count(*) INTO v_dispatches_after
  FROM
    public.observation_escalation_dispatches d
  WHERE
    d.facility_id = v_facility;
  SELECT
    jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'escalated_at', t.escalated_at) ORDER BY t.id) INTO v_tasks_after
  FROM
    public.resident_observation_tasks t
  WHERE
    t.facility_id = v_facility;

  PERFORM
    pg_temp.esc_assert (v_escalations_after = v_escalations_before, format('a test send created %s escalation rows', v_escalations_after - v_escalations_before));
  PERFORM
    pg_temp.esc_assert (v_dispatches_after = v_dispatches_before, format('a test send created %s dispatch rows', v_dispatches_after - v_dispatches_before));
  PERFORM
    pg_temp.esc_assert (v_tasks_after = v_tasks_before, 'a test send changed a task');

  SELECT
    count(*) INTO v_bodies
  FROM
    public.observation_escalation_deliveries dl
  WHERE
    dl.facility_id = v_facility
    AND dl.is_test;
  PERFORM
    pg_temp.esc_assert (v_bodies >= 1, 'the test send queued no delivery');

  SELECT
    count(*) INTO v_bad_bodies
  FROM
    public.observation_escalation_deliveries dl
  WHERE
    dl.facility_id = v_facility
    AND dl.is_test
    AND (dl.message_body IS NULL
      OR left(dl.message_body, 5) <> 'TEST ');
  PERFORM
    pg_temp.esc_assert (v_bad_bodies = 0, format('%s test deliveries do not start with TEST', v_bad_bodies));

  -- And no real delivery stores a body at all, which is the structural reason
  -- no resident detail can sit in that column.
  PERFORM
    pg_temp.esc_assert (NOT EXISTS (
        SELECT
          1
        FROM
          public.observation_escalation_deliveries dl
        WHERE
          NOT dl.is_test
          AND dl.message_body IS NOT NULL), 'a real delivery stored a message body');

  INSERT INTO esc_result (check_name, detail)
    VALUES ('acceptance 20: test send', format('tier_2 test delivered to %s recipient(s) over %s, body starts with TEST, zero escalation rows, zero dispatch rows, no task touched', v_recipients, v_result ->> 'channels'));
END
$$;

-- ---------------------------------------------------------------------------
-- 7. The test send is gated. A caregiver cannot fire one.
-- ---------------------------------------------------------------------------
SELECT
  pg_temp.esc_sign_in ('e5ca0000-0000-4000-8000-000000000005', 'e5ca0000-0000-4000-8000-00000000000b');

DO $$
DECLARE
  v_facility CONSTANT uuid := 'e5ca0000-0000-4000-8000-000000000003';
  v_blocked boolean := FALSE;
BEGIN
  BEGIN
    PERFORM
      public.send_test_escalation (v_facility, 'tier_2');
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_blocked := TRUE;
  END;
  PERFORM
    pg_temp.esc_assert (v_blocked, 'a caregiver was allowed to send a test escalation');
  INSERT INTO esc_result (check_name, detail)
    VALUES ('test send permission', 'a caregiver is refused; facility administrator and above may send');
END
$$;

SELECT
  check_name AS "check",
  detail
FROM
  esc_result
ORDER BY
  seq;

DO $$
BEGIN
  RAISE NOTICE 'escalation-ladder-acceptance PASS';
END
$$;

ROLLBACK;
