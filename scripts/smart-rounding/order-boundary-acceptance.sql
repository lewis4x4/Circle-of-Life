-- Monitoring Order boundary acceptance (spec 25A section 4.3, migration 421).
--
-- The boundaries are the two edges of an order: the instant it takes effect and
-- the instant it ends. Both used to be evaluated once per resident, at tick
-- time, and both were wrong.
--
-- Suppression used to be one question per resident at one instant: "is an order
-- in force right now?" If yes, the resident lost every window of the shift being
-- generated. Two failures fell out of that, and this script proves both are
-- closed and that ending an order hands the resident straight back.
--
--   1. an order starting mid shift leaves the earlier standard windows in place
--      and suppresses only the windows it covers, with no window carrying both a
--      standard task and an order task
--   2. an order ending mid shift leaves the later standard windows in place
--   3. public.create_monitoring_order excuses only the windows its order covers,
--      so an order that ends at midday does not silently delete that evening
--   4. cancelling an order immediately puts the rest of the current shift's
--      standard windows back on the board, both the ones that were excused and
--      the ones the generator never wrote
--   5. public.observation_compliance_for_range still reads honestly across all
--      of it: every resident day expects the same projected windows whatever the
--      orders did, and nothing is double counted
--
-- Run it against any database that has every migration applied:
--
--   node scripts/smart-rounding/run-order-boundary-acceptance.mjs
--
-- or directly, against a replay you already have:
--
--   psql -d <replay> -v ON_ERROR_STOP=1 -f scripts/smart-rounding/order-boundary-acceptance.sql
--
-- Every time in this script is read from the cadence projection, never written
-- down, so it restates no observation time and no grace value. Everything runs
-- inside one transaction that rolls back. All fixture data is synthetic and
-- nothing is selected or seeded by facility name.

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE FUNCTION pg_temp.su_assert (ok boolean, msg text)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'order-boundary-acceptance FAILED: %', msg;
  END IF;
END
$$;

CREATE TEMP TABLE su_result (
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

CREATE FUNCTION pg_temp.su_sign_in (p_user uuid, p_session uuid)
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

-- ---------------------------------------------------------------------------
-- 1. Fixture. One synthetic building, five residents, one administrator who can
--    both enter and stand down an order, and staff on the roster for the
--    current shift and the next one so assignment resolves.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '50990000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := '50990000-0000-4000-8000-000000000002';
  v_facility CONSTANT uuid := '50990000-0000-4000-8000-000000000003';
  v_admin CONSTANT uuid := '50990000-0000-4000-8000-000000000004';
  v_schedule CONSTANT uuid := '50990000-0000-4000-8000-000000000005';
  v_staff CONSTANT uuid := '50990000-0000-4000-8000-000000000006';
  v_source_cadence uuid;
  v_donor uuid;
BEGIN
  INSERT INTO public.organizations (id, name)
    VALUES (v_org, 'Synthetic Suppression Organization');
  INSERT INTO public.entities (id, organization_id, name)
    VALUES (v_entity, v_org, 'Synthetic Suppression Entity');
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
    VALUES (v_facility, v_entity, v_org, 'Synthetic Suppression Building', '1 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York');

  -- starts_later, ends_early, excuse_bound, cancelled, suppressed, control.
  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender, admission_date)
  SELECT
    ('50990000-0000-4000-8000-0dd' || lpad(i::text, 9, '0'))::uuid,
    v_facility,
    v_org,
    'Resident',
    'Synthetic',
    'active',
    'prefer_not_to_say',
    current_date - 60
  FROM
    generate_series(1, 6) AS g (i);

  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, ROLE, created_at, updated_at, confirmation_token)
    VALUES (v_admin, '00000000-0000-0000-0000-000000000000', 'synthetic-suppression-admin@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), '');
  INSERT INTO auth.sessions (id, user_id)
    VALUES (v_admin, v_admin);
  INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role, is_active)
    VALUES (v_admin, v_org, 'synthetic-suppression-admin@haven.test', 'Synthetic Suppression Administrator', 'facility_admin', TRUE);
  INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
    VALUES (v_admin, v_facility, v_org, TRUE);

  SELECT
    v.id,
    v.facility_id INTO v_source_cadence,
    v_donor
  FROM
    public.facility_cadence_versions v
  WHERE
    v.status = 'active'
    AND v.deleted_at IS NULL
    AND v.organization_id <> v_org
  ORDER BY
    v.created_at
  LIMIT 1;
  PERFORM
    pg_temp.su_assert (v_source_cadence IS NOT NULL, 'the seeded cadence version from migration 414 is missing');

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
    s.facility_id = v_donor;

  INSERT INTO public.facility_cadence_versions (id, organization_id, facility_id, version_number, status, effective_from, change_reason)
    VALUES ('50990000-0000-4000-8000-000000000007', v_org, v_facility, 1, 'active', now() - interval '60 days', 'Synthetic suppression fixture');

  INSERT INTO public.facility_cadence_windows (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
  SELECT
    v_org,
    v_facility,
    '50990000-0000-4000-8000-000000000007',
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

  -- One staff member on the roster for every shift date and shift type this
  -- script can touch, so assignment never becomes the reason something fails.
  INSERT INTO public.schedules (id, facility_id, organization_id, week_start_date, status)
    VALUES (v_schedule, v_facility, v_org, date_trunc('week', current_date)::date, 'published');
  INSERT INTO public.staff (id, facility_id, organization_id, first_name, last_name, staff_role, hire_date, employment_status)
    VALUES (v_staff, v_facility, v_org, 'Staff', 'Synthetic', 'resident_aide', current_date - 100, 'active');
  INSERT INTO public.shift_assignments (schedule_id, staff_id, facility_id, organization_id, shift_date, shift_type, status)
  SELECT
    v_schedule,
    v_staff,
    v_facility,
    v_org,
    d.day,
    t.shift_type,
    'confirmed'
  FROM
    generate_series(current_date - 2, current_date + 2, interval '1 day') AS d (day)
    CROSS JOIN (
      SELECT DISTINCT
        roster_shift_type AS shift_type
      FROM
        public.facility_shift_definitions
      WHERE
        facility_id = v_facility) t;

  INSERT INTO su_result (check_name, detail)
  SELECT
    'fixture',
    format('%s residents, %s windows in the cadence version, shifts %s', (
        SELECT
          count(*)
        FROM public.residents
        WHERE
          facility_id = v_facility), (
        SELECT
          count(*)
        FROM public.facility_cadence_windows
        WHERE
          facility_id = v_facility), (
        SELECT
          string_agg(label, ' and ' ORDER BY sort_order)
        FROM public.facility_shift_definitions
        WHERE
          facility_id = v_facility));
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The shift the generator would be writing, and its windows, read from the
--    projection. Nothing below names a clock time.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE su_next_windows AS
SELECT
  row_number() OVER (ORDER BY w.due_at_utc) AS position,
  count(*) OVER () AS window_count,
  w.*
FROM
  public.facility_next_shift_observation_windows ('50990000-0000-4000-8000-000000000003', now()) w;

DO $$
BEGIN
  PERFORM
    pg_temp.su_assert ((
      SELECT
        count(*)
      FROM su_next_windows) >= 2, 'the fixture shift projects fewer than two windows, so there is no "earlier" and "later" to test');
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Case one. An order that starts at the last window of the shift suppresses
--    that window and nothing before it.
--
--    Case two. An order that ends at the first window's due time suppresses that
--    window and nothing after it.
--
--    Both orders are inserted directly rather than through
--    public.create_monitoring_order, so that this pair tests the generator's
--    suppression read on its own; the command's own excuse is section 5.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '50990000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := '50990000-0000-4000-8000-000000000002';
  v_facility CONSTANT uuid := '50990000-0000-4000-8000-000000000003';
  v_admin CONSTANT uuid := '50990000-0000-4000-8000-000000000004';
  v_starts_later CONSTANT uuid := '50990000-0000-4000-8000-0dd000000001';
  v_ends_early CONSTANT uuid := '50990000-0000-4000-8000-0dd000000002';
  v_first record;
  v_last record;
  v_count integer;
  v_covered_later text[];
  v_covered_early text[];
BEGIN
  SELECT
    * INTO v_first
  FROM
    su_next_windows
  WHERE
    position = 1;
  SELECT
    * INTO v_last
  FROM
    su_next_windows
  WHERE
    position = window_count;
  v_count := v_first.window_count;

  INSERT INTO public.resident_monitoring_orders (organization_id, entity_id, facility_id, resident_id, interval_minutes, starts_at, ends_at, review_due_at, ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note, entered_by, status)
    VALUES (v_org, v_entity, v_facility, v_starts_later, 30, v_last.window_opens_at_utc, NULL, v_last.window_opens_at_utc + interval '3 days', 'facility_nurse', 'Ordering party', 'verbal', 'post_fall', 'Starts at the last window of the shift.', v_admin, 'active'),
    -- Ends when the first window's grace shuts. Not at its due time: the first
    -- window of a shift has zero grace before it by design, so an order ending
    -- exactly at the due time would be half open against a window that opens at
    -- the same instant and would cover nothing, which is correct and would make
    -- this test prove nothing.
    (v_org, v_entity, v_facility, v_ends_early, 30, v_first.window_opens_at_utc - interval '2 days', v_first.window_closes_at_utc, NULL, 'facility_nurse', 'Ordering party', 'verbal', 'post_hospital_return', 'Ends when the first window of the shift closes.', v_admin, 'active');

  SELECT
    array_agg(c.window_key ORDER BY c.window_key) INTO v_covered_later
  FROM
    public.observation_windows_under_monitoring_order (v_facility, now()) c
  WHERE
    c.resident_id = v_starts_later;

  SELECT
    array_agg(c.window_key ORDER BY c.window_key) INTO v_covered_early
  FROM
    public.observation_windows_under_monitoring_order (v_facility, now()) c
  WHERE
    c.resident_id = v_ends_early;

  PERFORM
    pg_temp.su_assert (v_covered_later = ARRAY[v_last.window_key], format('an order starting at the last window of the shift should suppress that window and no other. Covered: %s. The old per resident test suppressed all %s.', COALESCE(array_to_string(v_covered_later, ', '), '<none>'), v_count));
  PERFORM
    pg_temp.su_assert (v_covered_early = ARRAY[v_first.window_key], format('an order ending at the first window of the shift should suppress that window and no other. Covered: %s. The old per resident test suppressed all %s, which is how a resident coming off an order went most of a shift with nobody scheduled to look at them.', COALESCE(array_to_string(v_covered_early, ', '), '<none>'), v_count));

  INSERT INTO su_result (check_name, detail)
    VALUES ('case 1, order starts mid shift', format('%s windows in the shift; the order covers only %s, the %s earlier one(s) stay on the board', v_count, v_last.window_key, v_count - 1)),
    ('case 2, order ends mid shift', format('%s windows in the shift; the order covers only %s, the %s later one(s) stay on the board', v_count, v_first.window_key, v_count - 1));
END
$$;

-- ---------------------------------------------------------------------------
-- 4. The generator writes what is left, and no window ends up carrying both a
--    standard task and an order task.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '50990000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := '50990000-0000-4000-8000-000000000002';
  v_facility CONSTANT uuid := '50990000-0000-4000-8000-000000000003';
  v_starts_later CONSTANT uuid := '50990000-0000-4000-8000-0dd000000001';
  v_ends_early CONSTANT uuid := '50990000-0000-4000-8000-0dd000000002';
  v_control CONSTANT uuid := '50990000-0000-4000-8000-0dd000000006';
  v_version uuid;
  v_shift record;
  v_payload jsonb;
  v_written integer;
  v_count integer;
  v_later integer;
  v_early integer;
  v_control_tasks integer;
  v_double integer;
  v_orders integer;
BEGIN
  SELECT
    id INTO v_version
  FROM
    public.facility_cadence_versions
  WHERE
    facility_id = v_facility
    AND status = 'active';
  SELECT
    * INTO v_shift
  FROM
    public.facility_next_shift_window (v_facility, now());
  SELECT
    window_count INTO v_count
  FROM
    su_next_windows
  LIMIT 1;

  PERFORM
    public.generate_monitoring_order_tasks (v_facility, NULL);

  -- Exactly what the Edge Function builds: every resident against every window,
  -- minus the (resident, window, service date) triples an order covers.
  SELECT
    jsonb_agg(jsonb_build_object('organization_id', v_org, 'entity_id', v_entity, 'facility_id', v_facility, 'resident_id', r.id, 'cadence_version_id', w.cadence_version_id, 'window_key', w.window_key, 'service_date', w.service_date, 'shift_assignment_id', a.shift_assignment_id, 'assigned_staff_id', a.staff_id, 'scheduled_for', w.window_opens_at_utc, 'due_at', w.due_at_utc, 'grace_ends_at', w.window_closes_at_utc, 'status', 'upcoming')) INTO v_payload
  FROM
    public.residents r
    CROSS JOIN su_next_windows w
    LEFT JOIN public.resolve_observation_task_assignees (v_facility, v_shift.shift_service_date, v_shift.roster_shift_type::text, (
      SELECT
        array_agg(id)
      FROM public.residents
      WHERE
        facility_id = v_facility)) a ON a.resident_id = r.id
  WHERE
    r.facility_id = v_facility
    AND NOT EXISTS (
      SELECT
        1
      FROM
        public.observation_windows_under_monitoring_order (v_facility, now()) c
      WHERE
        c.resident_id = r.id
        AND c.window_key = w.window_key
        AND c.service_date = w.service_date);

  v_written := public.record_cadence_observation_tasks (v_payload);

  SELECT
    count(*) FILTER (WHERE t.resident_id = v_starts_later),
    count(*) FILTER (WHERE t.resident_id = v_ends_early),
    count(*) FILTER (WHERE t.resident_id = v_control) INTO v_later,
    v_early,
    v_control_tasks
  FROM
    public.resident_observation_tasks t
  WHERE
    t.facility_id = v_facility
    AND t.window_key IS NOT NULL
    AND t.deleted_at IS NULL;

  PERFORM
    pg_temp.su_assert (v_control_tasks = v_count, format('the control resident should carry all %s standard windows, got %s', v_count, v_control_tasks));
  PERFORM
    pg_temp.su_assert (v_later = v_count - 1, format('the resident whose order starts at the last window should keep %s standard windows, got %s', v_count - 1, v_later));
  PERFORM
    pg_temp.su_assert (v_early = v_count - 1, format('the resident whose order ends at the first window should keep %s standard windows, got %s', v_count - 1, v_early));

  -- The defect the per resident test produced at the other end: a standard task
  -- and an order task owning the same span for the same resident, with the
  -- standard one running to overdue and reaching the escalation ladder for a
  -- check the order replaced.
  SELECT
    count(*) INTO v_double
  FROM
    public.resident_observation_tasks standard
    JOIN public.resident_observation_tasks ordered ON ordered.resident_id = standard.resident_id
      AND ordered.monitoring_order_id IS NOT NULL
      AND ordered.deleted_at IS NULL
      AND ordered.status NOT IN ('excused')
      AND ordered.due_at >= standard.scheduled_for
      AND ordered.due_at <= standard.grace_ends_at
  WHERE
    standard.facility_id = v_facility
    AND standard.window_key IS NOT NULL
    AND standard.deleted_at IS NULL
    AND standard.status NOT IN ('excused');

  PERFORM
    pg_temp.su_assert (v_double = 0, format('%s standard window(s) are carrying an order check inside their span as well as a standard task. Both would be worked, and the standard one runs to overdue for a check the order already replaced.', v_double));

  SELECT
    count(*) INTO v_orders
  FROM
    public.resident_observation_tasks
  WHERE
    facility_id = v_facility
    AND monitoring_order_id IS NOT NULL
    AND deleted_at IS NULL;

  INSERT INTO su_result (check_name, detail)
    VALUES ('generator write', format('%s standard tasks written across %s residents; control %s/%s, order starting late %s/%s, order ending early %s/%s; %s order tasks alongside and 0 windows double booked', v_written, (
          SELECT
            count(*)
          FROM public.residents
          WHERE
            facility_id = v_facility), v_control_tasks, v_count, v_later, v_count, v_early, v_count, v_orders));
END
$$;

-- ---------------------------------------------------------------------------
-- 5. create_monitoring_order excuses only the windows its order covers.
--
-- The 416 predicate was `due_at > starts_at` with no upper bound, so an order
-- ending mid shift excused every later standard window for good.
-- ---------------------------------------------------------------------------
SELECT
  pg_temp.su_sign_in ('50990000-0000-4000-8000-000000000004', '50990000-0000-4000-8000-000000000004');

DO $$
DECLARE
  v_facility CONSTANT uuid := '50990000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := '50990000-0000-4000-8000-0dd000000003';
  v_first record;
  v_count integer;
  v_excused integer;
  v_still_upcoming integer;
  v_order uuid;
BEGIN
  SELECT
    * INTO v_first
  FROM
    su_next_windows
  WHERE
    position = 1;
  v_count := v_first.window_count;

  -- This resident already has the whole shift on the board, which is the state
  -- the bug needed: an order entered after the generator has run.
  SELECT
    count(*) INTO v_still_upcoming
  FROM
    public.resident_observation_tasks
  WHERE
    resident_id = v_resident
    AND window_key IS NOT NULL
    AND status = 'upcoming';
  PERFORM
    pg_temp.su_assert (v_still_upcoming = v_count, format('the fixture resident should start with all %s standard windows on the board, got %s', v_count, v_still_upcoming));

  v_order := public.create_monitoring_order (p_resident_id => v_resident, p_interval_minutes => 30, p_ordered_by_type => 'hospital_discharge', p_ordered_by_name => 'Discharging hospital', p_order_received_as => 'discharge_paperwork', p_reason_category => 'post_hospital_return', p_reason_note => 'Thirty minute checks until the first window closes.', p_starts_at => v_first.window_opens_at_utc, p_ends_at => v_first.window_closes_at_utc, p_review_due_at => NULL);

  SELECT
    count(*) FILTER (WHERE status = 'excused'),
    count(*) FILTER (WHERE status = 'upcoming') INTO v_excused,
    v_still_upcoming
  FROM
    public.resident_observation_tasks
  WHERE
    resident_id = v_resident
    AND window_key IS NOT NULL
    AND deleted_at IS NULL;

  PERFORM
    pg_temp.su_assert (v_excused = 1, format('entering an order that covers one window excused %s standard window(s). The 416 predicate had no upper bound, so an order ending at midday deleted that evening and that night as well and nothing ever put them back.', v_excused));
  PERFORM
    pg_temp.su_assert (v_still_upcoming = v_count - 1, format('%s standard window(s) should have survived the order, got %s', v_count - 1, v_still_upcoming));

  INSERT INTO su_result (check_name, detail)
    VALUES ('case 3, create excuses only what it covers', format('an order covering 1 of %s windows excused 1 and left %s upcoming', v_count, v_still_upcoming));
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Ending an order hands the resident straight back to the standard cadence.
--
--    Two residents, because a window can be in either state when the order ends:
--    already on the board and excused, or never written at all because the
--    generator suppressed it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '50990000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := '50990000-0000-4000-8000-000000000002';
  v_facility CONSTANT uuid := '50990000-0000-4000-8000-000000000003';
  v_excused_path CONSTANT uuid := '50990000-0000-4000-8000-0dd000000004';
  v_suppressed_path CONSTANT uuid := '50990000-0000-4000-8000-0dd000000005';
  v_version uuid;
  v_shift record;
  v_current_windows integer;
  v_order_a uuid;
  v_order_b uuid;
  v_payload jsonb;
  v_excused integer;
  v_back integer;
  v_written integer;
  v_no_assignee integer;
  v_no_row integer;
  v_second integer;
BEGIN
  SELECT
    id INTO v_version
  FROM
    public.facility_cadence_versions
  WHERE
    facility_id = v_facility
    AND status = 'active';

  -- The shift running now, not the one being generated. This is the shift a
  -- resident is standing in when their order is stood down.
  SELECT
    * INTO v_shift
  FROM
    public.facility_shift_window_at (v_facility, now());

  -- The excused path: the generator already wrote this resident's current shift.
  SELECT
    jsonb_agg(jsonb_build_object('organization_id', v_org, 'entity_id', v_entity, 'facility_id', v_facility, 'resident_id', v_excused_path, 'cadence_version_id', w.cadence_version_id, 'window_key', w.window_key, 'service_date', w.service_date, 'shift_assignment_id', NULL, 'assigned_staff_id', NULL, 'scheduled_for', w.window_opens_at_utc, 'due_at', w.due_at_utc, 'grace_ends_at', w.window_closes_at_utc, 'status', 'upcoming')) INTO v_payload
  FROM
    public.facility_observation_windows_in_span (v_facility, v_shift.shift_key, v_shift.starts_at_utc, v_shift.ends_at_utc) w;
  PERFORM
    public.record_cadence_observation_tasks (COALESCE(v_payload, '[]'::jsonb));

  -- An open ended order over the whole of the rest of this shift, entered
  -- through the command so the excuse runs.
  v_order_a := public.create_monitoring_order (p_resident_id => v_excused_path, p_interval_minutes => 30, p_ordered_by_type => 'facility_nurse', p_ordered_by_name => 'Ordering party', p_order_received_as => 'verbal', p_reason_category => 'post_fall', p_reason_note => 'Open ended, stood down mid shift.', p_starts_at => v_shift.starts_at_utc, p_ends_at => NULL, p_review_due_at => now() + interval '3 days');
  v_order_b := public.create_monitoring_order (p_resident_id => v_suppressed_path, p_interval_minutes => 30, p_ordered_by_type => 'facility_nurse', p_ordered_by_name => 'Ordering party', p_order_received_as => 'verbal', p_reason_category => 'post_fall', p_reason_note => 'Open ended, never generated for.', p_starts_at => v_shift.starts_at_utc, p_ends_at => NULL, p_review_due_at => now() + interval '3 days');

  SELECT
    count(*) INTO v_excused
  FROM
    public.resident_observation_tasks
  WHERE
    resident_id = v_excused_path
    AND window_key IS NOT NULL
    AND status = 'excused';
  PERFORM
    pg_temp.su_assert (v_excused > 0, 'the order did not take this resident''s current shift windows off the board, so the reinstatement test proves nothing');

  -- How many windows of this shift are still workable and would therefore be
  -- handed back.
  SELECT
    count(*) INTO v_current_windows
  FROM
    public.facility_observation_windows_in_span (v_facility, v_shift.shift_key, v_shift.starts_at_utc, v_shift.ends_at_utc) w
  WHERE
    w.window_closes_at_utc > now();

  PERFORM
    public.cancel_monitoring_order (v_order_a, 'Resident is settled, standing the order down.');
  PERFORM
    public.cancel_monitoring_order (v_order_b, 'Resident is settled, standing the order down.');

  SELECT
    count(*) INTO v_back
  FROM
    public.resident_observation_tasks t
    JOIN public.facility_observation_windows_in_span (v_facility, v_shift.shift_key, v_shift.starts_at_utc, v_shift.ends_at_utc) w ON w.window_key = t.window_key
      AND w.service_date = t.service_date
  WHERE
    t.resident_id = v_excused_path
    AND t.window_key IS NOT NULL
    AND t.status = 'upcoming'
    AND w.window_closes_at_utc > now();
  PERFORM
    pg_temp.su_assert (v_back = v_current_windows, format('cancelling the order put %s of the %s still workable window(s) of this shift back for the resident whose tasks had been excused. Before this, nothing reinstated them and the resident had no observation task at all until the next tick.', v_back, v_current_windows));

  SELECT
    count(*),
    count(*) FILTER (WHERE t.assigned_staff_id IS NULL),
    count(*) FILTER (WHERE NOT EXISTS (
        SELECT
          1
        FROM
          public.resident_observation_assignments ra
        WHERE
          ra.task_id = t.id
          AND ra.released_at IS NULL)) INTO v_written,
    v_no_assignee,
    v_no_row
  FROM
    public.resident_observation_tasks t
    JOIN public.facility_observation_windows_in_span (v_facility, v_shift.shift_key, v_shift.starts_at_utc, v_shift.ends_at_utc) w ON w.window_key = t.window_key
      AND w.service_date = t.service_date
  WHERE
    t.resident_id = v_suppressed_path
    AND t.window_key IS NOT NULL
    AND t.status = 'upcoming'
    AND w.window_closes_at_utc > now();

  PERFORM
    pg_temp.su_assert (v_written = v_current_windows, format('cancelling the order wrote %s of the %s still workable window(s) for the resident the generator had suppressed entirely, so those windows existed nowhere.', v_written, v_current_windows));
  PERFORM
    pg_temp.su_assert (v_no_assignee = 0, format('%s reinstated task(s) have no assignee, so the floor cannot work them', v_no_assignee));
  PERFORM
    pg_temp.su_assert (v_no_row = 0, format('%s reinstated task(s) have no live assignment row', v_no_row));

  -- Idempotent. Running the reinstatement again changes nothing.
  v_second := public.reinstate_standard_observation_windows (v_suppressed_path, now());
  PERFORM
    pg_temp.su_assert (v_second = 0, format('a second reinstatement wrote or reinstated %s more row(s)', v_second));

  INSERT INTO su_result (check_name, detail)
    VALUES ('case 4, cancelling hands the resident back', format('%s still workable window(s) in the shift; the excused resident got %s back and the suppressed resident got %s written with an assignee and an assignment row; a second call did nothing', v_current_windows, v_back, v_written));
END
$$;

-- ---------------------------------------------------------------------------
-- 7. The compliance read is still honest across all of it.
--
--    Expectation derived, per build note D13: every active resident day expects
--    the windows the cadence version in force projects, whatever the orders did.
--    An order does not reduce what was expected; it changes what satisfied it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := '50990000-0000-4000-8000-000000000003';
  v_date date;
  v_projected integer;
  v_residents integer;
  v_rows integer;
  v_no_cadence integer;
  v_wrong text;
BEGIN
  SELECT
    (now() AT TIME ZONE 'America/New_York')::date INTO v_date;

  SELECT
    count(*) INTO v_projected
  FROM
    public.facility_observation_windows_for_date (v_facility, v_date);

  SELECT
    count(*) INTO v_residents
  FROM
    public.residents
  WHERE
    facility_id = v_facility
    AND deleted_at IS NULL;

  SELECT
    count(*),
    count(*) FILTER (WHERE c.expectation_source = 'no_cadence') INTO v_rows,
    v_no_cadence
  FROM
    public.observation_compliance_for_range (v_facility, v_date, v_date) c;

  PERFORM
    pg_temp.su_assert (v_no_cadence = 0, format('%s resident day(s) read as no_cadence at a building whose cadence version is active', v_no_cadence));
  PERFORM
    pg_temp.su_assert (v_rows = v_projected * v_residents, format('the compliance read returned %s rows for %s residents at %s projected windows. An order must not change what was expected of a resident day, only what satisfied it.', v_rows, v_residents, v_projected));

  SELECT
    string_agg(format('%s=%s', right(resident_id::text, 4), expected), ', ' ORDER BY resident_id) INTO v_wrong
  FROM (
    SELECT
      c.resident_id,
      count(*) AS expected
    FROM
      public.observation_compliance_for_range (v_facility, v_date, v_date) c
    GROUP BY
      c.resident_id) per_resident
  WHERE
    expected <> v_projected;

  PERFORM
    pg_temp.su_assert (v_wrong IS NULL, format('these residents expect a different number of windows than the cadence projects: %s. Per window suppression must not change the expectation, and a duplicated task must not inflate it.', v_wrong));

  INSERT INTO su_result (check_name, detail)
    VALUES ('case 5, compliance stays honest', format('every one of %s residents expects %s windows on %s, %s rows total, 0 no_cadence, none inflated by an order', v_residents, v_projected, v_date, v_rows));
END
$$;

SELECT
  seq,
  check_name,
  detail
FROM
  su_result
ORDER BY
  seq;

ROLLBACK;
