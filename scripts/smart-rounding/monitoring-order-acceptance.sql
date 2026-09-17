-- Monitoring Orders acceptance, spec 25A items 5 and 6 plus the grace rule and
-- the expiry rule, asserted in SQL against a replayed database.
--
-- Run it against any database that has every migration applied:
--
--   node scripts/smart-rounding/run-monitoring-order-acceptance.mjs
--
-- or directly, against a replay you already have:
--
--   psql -d <replay> -v ON_ERROR_STOP=1 -f scripts/smart-rounding/monitoring-order-acceptance.sql
--
-- Everything happens inside one transaction that rolls back, including the
-- auth.uid() redefinition that stands in for a signed in caller, so the script
-- is safe to re-run and leaves nothing behind. All fixture data is synthetic:
-- no resident, no staff member and no facility here corresponds to a real one.

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE FUNCTION pg_temp.mo_assert (ok boolean, msg text)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'monitoring-order-acceptance FAILED: %', msg;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.mo_sign_in (p_user uuid, p_session uuid)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_version integer;
BEGIN
  -- The claim version is whatever the profile is on right now. Access grants
  -- bump it, so hardcoding 1 makes the fixture caller stop resolving the moment
  -- the fixture gives them a facility.
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

CREATE TEMP TABLE mo_result (
  seq serial,
  check_name text,
  detail text
);

-- auth.uid() in the replay stub always returns null. Supabase resolves it from
-- the request claims; do the same here so the definer commands see a caller.
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
-- 1. The grace rule. One formula, four intervals, spec section 5.2.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_expected CONSTANT integer[] := ARRAY[10, 15, 30, 60];
  v_intervals CONSTANT integer[] := ARRAY[30, 60, 120, 240];
  v_got integer;
  i integer;
BEGIN
  FOR i IN 1..4 LOOP
    v_got := public.monitoring_order_grace_minutes (v_intervals[i]);
    PERFORM
      pg_temp.mo_assert (v_got = v_expected[i], format('grace at interval %s should be %s, got %s', v_intervals[i], v_expected[i], v_got));
  END LOOP;
  INSERT INTO mo_result (check_name, detail)
    VALUES ('grace formula', 'interval 30/60/120/240 gives grace 10/15/30/60');
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Fixture. A synthetic organization, one facility, two residents, a
--    Resident Aide and a facility administrator.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000002';
  v_facility CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000004';
  v_control CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000005';
  v_aide CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000006';
  v_admin CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000007';
  v_aide_session CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000008';
  v_admin_session CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000009';
  v_version CONSTANT uuid := '5c3f0000-0000-4000-8000-00000000000a';
  v_source_version uuid;
BEGIN
  INSERT INTO public.organizations (id, name)
    VALUES (v_org, 'Synthetic Monitoring Order Organization');
  INSERT INTO public.entities (id, organization_id, name)
    VALUES (v_entity, v_org, 'Synthetic Monitoring Order Entity');
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
    VALUES (v_facility, v_entity, v_org, 'Synthetic Monitoring Order Facility', '1 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York');

  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender)
    VALUES (v_resident, v_facility, v_org, 'Ordered', 'Synthetic', 'active', 'prefer_not_to_say'),
    (v_control, v_facility, v_org, 'Control', 'Synthetic', 'active', 'prefer_not_to_say');

  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, ROLE, created_at, updated_at, confirmation_token)
    VALUES (v_aide, '00000000-0000-0000-0000-000000000000', 'synthetic-aide@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), ''),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'synthetic-admin@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), '');
  INSERT INTO auth.sessions (id, user_id)
    VALUES (v_aide_session, v_aide),
    (v_admin_session, v_admin);

  INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role, is_active)
    VALUES (v_aide, v_org, 'synthetic-aide@haven.test', 'Synthetic Aide', 'caregiver', TRUE),
    (v_admin, v_org, 'synthetic-admin@haven.test', 'Synthetic Administrator', 'facility_admin', TRUE);
  INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
    VALUES (v_aide, v_facility, v_org, TRUE),
    (v_admin, v_facility, v_org, TRUE);

  INSERT INTO public.staff (id, facility_id, organization_id, first_name, last_name, staff_role, hire_date, user_id)
    VALUES (gen_random_uuid(), v_facility, v_org, 'Synthetic', 'Aide', 'resident_aide', current_date, v_aide);

  -- The cadence for this facility is a copy of the seeded 2026-09-16 version,
  -- windows and grace values included, so the test never restates a time.
  SELECT
    v.id INTO v_source_version
  FROM
    public.facility_cadence_versions v
  WHERE
    v.status = 'active'
    AND v.deleted_at IS NULL
  ORDER BY
    v.created_at
  LIMIT 1;
  PERFORM
    pg_temp.mo_assert (v_source_version IS NOT NULL, 'the seeded cadence version from migration 412 is missing');

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
    s.facility_id = (
      SELECT
        facility_id
      FROM
        public.facility_cadence_versions
      WHERE
        id = v_source_version);

  INSERT INTO public.facility_cadence_versions (id, organization_id, facility_id, version_number, status, effective_from, change_reason)
    VALUES (v_version, v_org, v_facility, 1, 'active', now() - interval '30 days', 'Synthetic acceptance fixture');

  INSERT INTO public.facility_cadence_windows (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
  SELECT
    v_org,
    v_facility,
    v_version,
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
    w.cadence_version_id = v_source_version;

  INSERT INTO mo_result (check_name, detail)
  SELECT
    'fixture',
    format('%s windows copied from the seeded cadence version', count(*))
  FROM
    public.facility_cadence_windows
  WHERE
    cadence_version_id = v_version;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Acceptance 6. A Resident Aide enters the order and it is active at once.
--    There is no pending state to pass through and nothing waits on anybody.
-- ---------------------------------------------------------------------------
SELECT pg_temp.mo_sign_in ('5c3f0000-0000-4000-8000-000000000006', '5c3f0000-0000-4000-8000-000000000008');

DO $$
DECLARE
  v_facility CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000004';
  v_version CONSTANT uuid := '5c3f0000-0000-4000-8000-00000000000a';
  v_order_id uuid;
  v_status text;
  v_events integer;
  v_standard_excused integer;
  v_still_generating integer;
BEGIN
  PERFORM
    pg_temp.mo_assert (haven.app_role ()::text = 'caregiver', 'the fixture caller should resolve as caregiver, got ' || COALESCE(haven.app_role ()::text, 'null'));

  -- A standard window already on the board for this resident, so the test can
  -- prove the order takes it off.
  INSERT INTO public.resident_observation_tasks (organization_id, facility_id, resident_id, cadence_version_id, window_key, service_date, scheduled_for, due_at, grace_ends_at, status)
  SELECT
    '5c3f0000-0000-4000-8000-000000000001',
    v_facility,
    v_resident,
    v_version,
    w.window_key,
    ((now() + interval '36 hours') AT TIME ZONE 'America/New_York')::date,
    w.window_opens_at_utc,
    w.due_at_utc,
    w.window_closes_at_utc,
    'upcoming'
  FROM
    public.facility_observation_windows_for_date (v_facility, ((now() + interval '36 hours') AT TIME ZONE 'America/New_York')::date) w;

  v_order_id := public.create_monitoring_order (p_resident_id => v_resident, p_interval_minutes => 30, p_ordered_by_type => 'hospital_discharge', p_ordered_by_name => 'Discharging hospital', p_order_received_as => 'discharge_paperwork', p_reason_category => 'post_hospital_return', p_reason_note => 'Thirty minute checks for the first day back.', p_starts_at => now(), p_ends_at => NULL, p_review_due_at => now() + interval '3 days');

  SELECT
    status INTO v_status
  FROM
    public.resident_monitoring_orders
  WHERE
    id = v_order_id;
  PERFORM
    pg_temp.mo_assert (v_status = 'active', 'a new Monitoring Order must be active immediately, got ' || COALESCE(v_status, 'null'));

  PERFORM
    pg_temp.mo_assert (NOT EXISTS (
        SELECT
          1
        FROM
          information_schema.columns c
        WHERE
          c.table_schema = 'public'
          AND c.table_name = 'resident_monitoring_orders'
          AND (c.column_name ~* 'approv' OR c.column_name ~* 'pending')), 'the order table must carry no approval or pending column');

  PERFORM
    pg_temp.mo_assert (NOT EXISTS (
        SELECT
          1
        FROM
          pg_catalog.pg_constraint con
        WHERE
          con.conrelid = 'public.resident_monitoring_orders'::regclass
          AND pg_catalog.pg_get_constraintdef(con.oid) ~* '(pending|awaiting_approval)'), 'the status CHECK must admit no pending value');

  SELECT
    count(*) INTO v_events
  FROM
    public.resident_monitoring_order_events
  WHERE
    monitoring_order_id = v_order_id
    AND to_status = 'active'
    AND from_status IS NULL;
  PERFORM
    pg_temp.mo_assert (v_events = 1, 'the opening history row is missing');

  -- Standard windows stop for this resident.
  SELECT
    count(*) INTO v_standard_excused
  FROM
    public.resident_observation_tasks
  WHERE
    resident_id = v_resident
    AND window_key IS NOT NULL
    AND status = 'excused';
  PERFORM
    pg_temp.mo_assert (v_standard_excused >= 6, 'the resident''s not yet worked standard windows should have been stood down, got ' || v_standard_excused);

  -- And the generator's own skip predicate now names this resident, which is
  -- what stops the next tick from writing any more.
  SELECT
    count(*) INTO v_still_generating
  FROM
    public.resident_monitoring_orders o
  WHERE
    o.facility_id = v_facility
    AND o.status = 'active'
    AND o.deleted_at IS NULL
    AND o.starts_at <= now()
    AND (o.ends_at IS NULL OR o.ends_at > now())
    AND o.resident_id = v_resident;
  PERFORM
    pg_temp.mo_assert (v_still_generating = 1, 'the task generator''s active order predicate should return this resident');

  INSERT INTO mo_result (check_name, detail)
    VALUES ('acceptance 6', format('caregiver created order %s, status active on the first write, %s standard windows stood down, no approval or pending column exists', left(v_order_id::text, 8), v_standard_excused));
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Acceptance 5. Thirty minute spacing, ten minute grace, and the standard
--    windows the order checks fall inside read as satisfied in the compliance
--    view even though no standard task row exists for them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000001';
  v_facility CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000004';
  v_control CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000005';
  v_version CONSTANT uuid := '5c3f0000-0000-4000-8000-00000000000a';
  v_order_id uuid;
  v_staff uuid;
  v_generated integer;
  v_regenerated integer;
  v_service_date date;
  v_task_count integer;
  v_bad_spacing integer;
  v_bad_grace integer;
  v_standard_rows integer;
  v_expected integer;
  v_satisfied integer;
  v_absorbed integer;
  v_control_expected integer;
  v_control_satisfied integer;
BEGIN
  SELECT
    id INTO v_order_id
  FROM
    public.resident_monitoring_orders
  WHERE
    resident_id = v_resident
    AND status = 'active';
  SELECT
    id INTO v_staff
  FROM
    public.staff
  WHERE
    facility_id = v_facility
  LIMIT 1;

  -- Three days of order tasks, so one whole facility local day sits inside the
  -- order's window with no edge to reason about.
  v_generated := public.generate_monitoring_order_tasks (v_facility, now() + interval '72 hours');
  PERFORM
    pg_temp.mo_assert (v_generated > 0, 'the order generated no tasks');

  -- Idempotent: a second tick writes nothing.
  v_regenerated := public.generate_monitoring_order_tasks (v_facility, now() + interval '72 hours');
  PERFORM
    pg_temp.mo_assert (v_regenerated = 0, 'a second generator tick inserted ' || v_regenerated || ' duplicate order tasks');

  -- Spacing and grace.
  SELECT
    count(*) INTO v_task_count
  FROM
    public.resident_observation_tasks
  WHERE
    monitoring_order_id = v_order_id;

  SELECT
    count(*) INTO v_bad_spacing
  FROM (
    SELECT
      due_at - lag(due_at) OVER (ORDER BY due_at) AS gap
    FROM
      public.resident_observation_tasks
    WHERE
      monitoring_order_id = v_order_id) spaced
WHERE
  gap IS NOT NULL
    AND gap <> interval '30 minutes';
  PERFORM
    pg_temp.mo_assert (v_bad_spacing = 0, v_bad_spacing || ' order tasks are not 30 minutes apart');

  SELECT
    count(*) INTO v_bad_grace
  FROM
    public.resident_observation_tasks
  WHERE
    monitoring_order_id = v_order_id
    AND grace_ends_at - due_at <> interval '10 minutes';
  PERFORM
    pg_temp.mo_assert (v_bad_grace = 0, v_bad_grace || ' order tasks do not carry the 10 minute grace the interval scales to');

  -- Order tasks are distinguishable: monitoring_order_id set, window_key null.
  PERFORM
    pg_temp.mo_assert (NOT EXISTS (
        SELECT
          1
        FROM
          public.resident_observation_tasks
        WHERE
          monitoring_order_id IS NOT NULL
          AND window_key IS NOT NULL), 'an order task must never carry a window_key');

  -- The service day that sits wholly inside the order.
  v_service_date := ((now() + interval '36 hours') AT TIME ZONE 'America/New_York')::date;

  -- Record an observation against the first order task inside each projected
  -- standard window for that day. This is what absorption has to notice.
  INSERT INTO public.resident_observation_logs (organization_id, facility_id, resident_id, task_id, staff_id, observed_at, entered_at, entry_mode, quick_status)
  SELECT
    v_org,
    v_facility,
    v_resident,
    inside.task_id,
    v_staff,
    inside.due_at,
    now(),
    'bulk',
    'calm'
  FROM
    public.facility_observation_windows_for_date (v_facility, v_service_date) w
    CROSS JOIN LATERAL (
      SELECT
        t.id AS task_id,
        t.due_at
      FROM
        public.resident_observation_tasks t
      WHERE
        t.monitoring_order_id = v_order_id
        AND t.due_at >= w.window_opens_at_utc
        AND t.due_at <= w.window_closes_at_utc
      ORDER BY
        t.due_at
      LIMIT 1) inside;

  -- No standard task row exists for that resident on that day. This is the
  -- trap: an absorption view that counted task rows would report six misses.
  SELECT
    count(*) INTO v_standard_rows
  FROM
    public.resident_observation_tasks
  WHERE
    resident_id = v_resident
    AND service_date = v_service_date
    AND window_key IS NOT NULL
    AND status <> 'excused';
  PERFORM
    pg_temp.mo_assert (v_standard_rows = 0, 'the fixture expects no live standard task rows for the ordered resident, got ' || v_standard_rows);

  SELECT
    count(*),
    count(*) FILTER (WHERE satisfied),
    count(*) FILTER (WHERE absorbed) INTO v_expected,
    v_satisfied,
    v_absorbed
  FROM
    public.observation_compliance_for_range (v_facility, v_service_date, v_service_date)
  WHERE
    resident_id = v_resident;

  PERFORM
    pg_temp.mo_assert (v_expected = 6, 'the ordered resident should still be expected on six windows, got ' || v_expected);
  PERFORM
    pg_temp.mo_assert (v_satisfied = 6, 'all six standard windows should read satisfied by the order checks, got ' || v_satisfied);
  PERFORM
    pg_temp.mo_assert (v_absorbed = 6, 'all six should be marked absorbed by a Monitoring Order check, got ' || v_absorbed);
  -- The six rows are projected, not counted. Every one of them names the order
  -- as what covered it, and none of them is satisfied by a standard task: the
  -- only standard task rows left for this resident on this day were stood down
  -- when the order took effect.
  PERFORM
    pg_temp.mo_assert (NOT EXISTS (
        SELECT
          1
        FROM
          public.observation_compliance_for_range (v_facility, v_service_date, v_service_date)
        WHERE
          resident_id = v_resident
          AND expectation_source <> 'monitoring_order'), 'every projected window for a resident under an order must name the order as its source');
  PERFORM
    pg_temp.mo_assert (NOT EXISTS (
        SELECT
          1
        FROM
          public.observation_compliance_for_range (v_facility, v_service_date, v_service_date) c
          JOIN public.resident_observation_tasks t ON t.id = c.task_id
        WHERE
          c.resident_id = v_resident
          AND t.status <> 'excused'), 'no live standard task row may exist behind a satisfied window while an order is in force');

  -- The control resident is on the standard cadence, has tasks, and has done
  -- nothing. The same view has to say so.
  INSERT INTO public.resident_observation_tasks (organization_id, facility_id, resident_id, cadence_version_id, window_key, service_date, scheduled_for, due_at, grace_ends_at, status)
  SELECT
    v_org,
    v_facility,
    v_control,
    v_version,
    w.window_key,
    v_service_date,
    w.window_opens_at_utc,
    w.due_at_utc,
    w.window_closes_at_utc,
    'upcoming'
  FROM
    public.facility_observation_windows_for_date (v_facility, v_service_date) w;

  SELECT
    count(*),
    count(*) FILTER (WHERE satisfied) INTO v_control_expected,
    v_control_satisfied
  FROM
    public.observation_compliance_for_range (v_facility, v_service_date, v_service_date)
  WHERE
    resident_id = v_control;
  PERFORM
    pg_temp.mo_assert (v_control_expected = 6, 'the control resident should be expected on six windows, got ' || v_control_expected);
  PERFORM
    pg_temp.mo_assert (v_control_satisfied = 0, 'the control resident has recorded nothing and should read zero satisfied, got ' || v_control_satisfied);

  INSERT INTO mo_result (check_name, detail)
    VALUES ('acceptance 5', format('%s order tasks at 30 minute spacing with 10 minute grace; on %s the ordered resident has 0 standard task rows, %s/%s windows expected and satisfied, %s absorbed; the control resident reads %s/%s', v_task_count, v_service_date, v_satisfied, v_expected, v_absorbed, v_control_satisfied, v_control_expected));
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Expiry. An end date that has passed expires. A past review date on an open
--    ended order does not, because expiring it would quietly end the elevated
--    observation for a resident nobody has looked at again.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000001';
  v_facility CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000003';
  v_aide CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000006';
  v_open_resident uuid := gen_random_uuid();
  v_ended_resident uuid := gen_random_uuid();
  v_open_order uuid;
  v_ended_order uuid;
  v_expired integer;
  v_open_status text;
  v_ended_status text;
BEGIN
  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender)
    VALUES (v_open_resident, v_facility, v_org, 'Openended', 'Synthetic', 'active', 'prefer_not_to_say'),
    (v_ended_resident, v_facility, v_org, 'Ended', 'Synthetic', 'active', 'prefer_not_to_say');

  -- Open ended, review date already in the past.
  INSERT INTO public.resident_monitoring_orders (organization_id, facility_id, resident_id, interval_minutes, starts_at, ends_at, review_due_at, ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note, entered_by, status)
    VALUES (v_org, v_facility, v_open_resident, 60, now() - interval '10 days', NULL, now() - interval '2 days', 'physician', 'Ordering physician', 'verbal', 'change_in_condition', 'Open ended, review overdue.', v_aide, 'active')
  RETURNING
    id INTO v_open_order;

  -- End date already passed.
  INSERT INTO public.resident_monitoring_orders (organization_id, facility_id, resident_id, interval_minutes, starts_at, ends_at, review_due_at, ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note, entered_by, status)
    VALUES (v_org, v_facility, v_ended_resident, 60, now() - interval '10 days', now() - interval '1 day', NULL, 'physician', 'Ordering physician', 'verbal', 'post_fall', 'Ran to its end date.', v_aide, 'active')
  RETURNING
    id INTO v_ended_order;

  v_expired := public.expire_monitoring_orders ();

  SELECT
    status INTO v_open_status
  FROM
    public.resident_monitoring_orders
  WHERE
    id = v_open_order;
  SELECT
    status INTO v_ended_status
  FROM
    public.resident_monitoring_orders
  WHERE
    id = v_ended_order;

  PERFORM
    pg_temp.mo_assert (v_open_status = 'active', 'an open ended order with a past review date must stay active, got ' || v_open_status);
  PERFORM
    pg_temp.mo_assert (v_ended_status = 'expired', 'an order whose end date has passed must expire, got ' || v_ended_status);
  PERFORM
    pg_temp.mo_assert (EXISTS (
        SELECT
          1
        FROM
          public.resident_monitoring_order_events
        WHERE
          monitoring_order_id = v_ended_order
          AND from_status = 'active'
          AND to_status = 'expired'), 'the expiry transition should have written a history row');

  INSERT INTO mo_result (check_name, detail)
    VALUES ('expiry', format('%s order expired on its end date; the open ended order with a review date %s days past stayed active', v_expired, 2));
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Cancellation is the restricted half of the permission table. The aide who
--    may enter an order may not stand one down.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_resident CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000004';
  v_order uuid;
  v_refused boolean := FALSE;
  v_status text;
  v_pending_tasks integer;
BEGIN
  SELECT
    id INTO v_order
  FROM
    public.resident_monitoring_orders
  WHERE
    resident_id = v_resident
    AND status = 'active';
  BEGIN
    PERFORM
      public.cancel_monitoring_order (v_order, 'Aide attempting to cancel');
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_refused := TRUE;
  END;
  PERFORM
    pg_temp.mo_assert (v_refused, 'a caregiver must not be able to cancel a Monitoring Order');

  PERFORM
    pg_temp.mo_sign_in ('5c3f0000-0000-4000-8000-000000000007', '5c3f0000-0000-4000-8000-000000000009');

  PERFORM
    public.cancel_monitoring_order (v_order, 'Resident settled, returning to the standard cadence.');

  SELECT
    status INTO v_status
  FROM
    public.resident_monitoring_orders
  WHERE
    id = v_order;
  PERFORM
    pg_temp.mo_assert (v_status = 'cancelled', 'the administrator''s cancel should have landed, got ' || v_status);
  PERFORM
    pg_temp.mo_assert (EXISTS (
        SELECT
          1
        FROM
          public.resident_monitoring_order_events
        WHERE
          monitoring_order_id = v_order
          AND from_status = 'active'
          AND to_status = 'cancelled'
          AND note IS NOT NULL), 'the cancellation history row should carry the reason');

  SELECT
    count(*) INTO v_pending_tasks
  FROM
    public.resident_observation_tasks
  WHERE
    monitoring_order_id = v_order
    AND status IN ('upcoming', 'due_soon')
    AND due_at > now();
  PERFORM
    pg_temp.mo_assert (v_pending_tasks = 0, v_pending_tasks || ' order tasks are still live after the order was cancelled');

  INSERT INTO mo_result (check_name, detail)
    VALUES ('permissions', 'caregiver refused with 42501; facility_admin cancelled, history row carries the reason, remaining order tasks stood down');
END
$$;

-- ---------------------------------------------------------------------------
-- 7. The bridge exists and is idle, which is the correct state at this branch
--    point: nothing inserts into resident_watch_instances yet.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000001';
  v_facility CONSTANT uuid := '5c3f0000-0000-4000-8000-000000000003';
  v_resident uuid := gen_random_uuid();
  v_watch uuid;
  v_orders integer;
  v_second integer;
BEGIN
  PERFORM
    pg_temp.mo_assert (EXISTS (
        SELECT
          1
        FROM
          pg_catalog.pg_trigger
        WHERE
          tgrelid = 'public.resident_watch_instances'::regclass
          AND tgname = 'tr_resident_watch_instances_monitoring_order_bridge'), 'the watch instance bridge trigger is missing');

  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender)
    VALUES (v_resident, v_facility, v_org, 'Bridged', 'Synthetic', 'active', 'prefer_not_to_say');
  INSERT INTO public.resident_watch_instances (organization_id, facility_id, resident_id, triggered_by_type, starts_at, status)
    VALUES (v_org, v_facility, v_resident, 'fall_event', now(), 'active')
  RETURNING
    id INTO v_watch;

  SELECT
    count(*) INTO v_orders
  FROM
    public.resident_monitoring_orders
  WHERE
    source_watch_instance_id = v_watch
    AND reason_category = 'post_fall'
    AND ordered_by_type = 'facility_nurse'
    AND order_received_as = 'written_order'
    AND status = 'active';
  PERFORM
    pg_temp.mo_assert (v_orders = 1, 'the bridge should have created exactly one order from the watch instance, got ' || v_orders);

  -- A second watch instance for the same resident must not create a second
  -- active order.
  INSERT INTO public.resident_watch_instances (organization_id, facility_id, resident_id, triggered_by_type, starts_at, status)
    VALUES (v_org, v_facility, v_resident, 'behavior_event', now(), 'active');
  SELECT
    count(*) INTO v_second
  FROM
    public.resident_monitoring_orders
  WHERE
    resident_id = v_resident
    AND status = 'active'
    AND deleted_at IS NULL;
  PERFORM
    pg_temp.mo_assert (v_second = 1, 'one active order per resident, got ' || v_second);

  INSERT INTO mo_result (check_name, detail)
    VALUES ('watch bridge', 'a watch instance creates one facility_nurse order with the reason derived from its source; a second instance for the same resident creates none');
END
$$;

SELECT
  check_name AS "check",
  detail
FROM
  mo_result
ORDER BY
  seq;

DO $$
BEGIN
  RAISE NOTICE 'monitoring-order-acceptance PASS';
END
$$;

ROLLBACK;
