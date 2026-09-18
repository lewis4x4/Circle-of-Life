-- Smart Rounding assignment acceptance (spec 25A sections 2.2 and 3.5, build
-- notes decision D12 as corrected).
--
-- The generator used to leave a task unassigned whenever no shift_assignments
-- row already named the resident. An unassigned task with no live assignment row
-- is completable by nobody below nurse, which is a tested SYS-001 invariant, so
-- those checks sat on the board unworkable by the floor. The owner decision was
-- to auto assign from the employee shift schedule.
--
-- Three cases, one per step of the fallback chain:
--
--   1. a facility with a resident split assigns exactly as before
--   2. a facility where staff are scheduled and nobody split the residents
--      assigns every task to a scheduled staff member, writes the assignment
--      row, and a caregiver among them can complete their own check
--   3. a facility with nobody scheduled invents no assignee, raises a visible
--      defect naming the facility, the shift and the service date, and still
--      generates the tasks
--
-- Run it against any database that has every migration applied:
--
--   node scripts/smart-rounding/run-assignment-acceptance.mjs
--
-- or directly, against a replay you already have:
--
--   psql -d <replay> -v ON_ERROR_STOP=1 -f scripts/smart-rounding/assignment-acceptance.sql
--
-- Everything happens inside one transaction that rolls back. All fixture data is
-- synthetic: no resident, no staff member and no facility here corresponds to a
-- real one, and nothing is selected or seeded by facility name.

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE FUNCTION pg_temp.as_assert (ok boolean, msg text)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'assignment-acceptance FAILED: %', msg;
  END IF;
END
$$;

CREATE TEMP TABLE as_result (
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
-- 1. Fixture. One synthetic organization, three buildings, six residents each,
--    and a shift roster that differs per building so each building exercises a
--    different step of the chain.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '5a550000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := '5a550000-0000-4000-8000-000000000002';
  v_split CONSTANT uuid := '5a550000-0000-4000-8000-000000000003';
  v_roster CONSTANT uuid := '5a550000-0000-4000-8000-000000000004';
  v_empty CONSTANT uuid := '5a550000-0000-4000-8000-000000000005';
  v_source_cadence uuid;
  v_donor_facility uuid;
BEGIN
  INSERT INTO public.organizations (id, name)
    VALUES (v_org, 'Synthetic Assignment Organization');
  INSERT INTO public.entities (id, organization_id, name)
    VALUES (v_entity, v_org, 'Synthetic Assignment Entity');
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
    VALUES (v_split, v_entity, v_org, 'Synthetic Assignment Building With A Resident Split', '1 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York'),
    (v_roster, v_entity, v_org, 'Synthetic Assignment Building With A Roster Only', '2 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York'),
    (v_empty, v_entity, v_org, 'Synthetic Assignment Building With Nobody Scheduled', '3 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York');

  -- Six residents per building, on fixed ids, because the round robin is a hash
  -- of the resident id and a random id would make the distribution this script
  -- reports different on every run.
  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender, admission_date)
  SELECT
    ('5a550000-0000-4000-8000-0aa' || f.slot || lpad(i::text, 8, '0'))::uuid,
    f.id,
    v_org,
    'Resident',
    'Synthetic',
    'active',
    'prefer_not_to_say',
    current_date - 30
  FROM (
    VALUES (v_split, '1'),
      (v_roster, '2'),
      (v_empty, '3')) AS f (id, slot)
    CROSS JOIN generate_series(1, 6) AS i;

  -- The cadence and shift model are copied from the organization the seeds
  -- configured, so this script restates no observation time and no grace value.
  SELECT
    v.id,
    v.facility_id INTO v_source_cadence,
    v_donor_facility
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
    pg_temp.as_assert (v_source_cadence IS NOT NULL, 'the seeded cadence version from migration 417 is missing');

  INSERT INTO public.facility_shift_definitions (organization_id, facility_id, shift_key, roster_shift_type, label, starts_at_local, ends_at_local, sort_order)
  SELECT
    v_org,
    f.id,
    s.shift_key,
    s.roster_shift_type,
    s.label,
    s.starts_at_local,
    s.ends_at_local,
    s.sort_order
  FROM (
    VALUES (v_split),
      (v_roster),
      (v_empty)) AS f (id)
    CROSS JOIN public.facility_shift_definitions s
  WHERE
    s.facility_id = v_donor_facility;

  INSERT INTO public.facility_cadence_versions (organization_id, facility_id, version_number, status, effective_from, change_reason)
  SELECT
    v_org,
    f.id,
    1,
    'active',
    now() - interval '30 days',
    'Synthetic assignment acceptance fixture'
  FROM (
    VALUES (v_split),
      (v_roster),
      (v_empty)) AS f (id);

  INSERT INTO public.facility_cadence_windows (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
  SELECT
    v_org,
    mine.facility_id,
    mine.id,
    w.window_key,
    w.label,
    w.due_at_local,
    w.grace_before_minutes,
    w.grace_after_minutes,
    w.shift_key,
    w.sort_order,
    w.enabled
  FROM
    public.facility_cadence_versions mine
    CROSS JOIN public.facility_cadence_windows w
  WHERE
    mine.organization_id = v_org
    AND w.cadence_version_id = v_source_cadence;

  INSERT INTO as_result (check_name, detail)
  SELECT
    'fixture',
    format('%s buildings, %s residents, %s windows per cadence version', count(DISTINCT f.id), (
        SELECT
          count(*)
        FROM public.residents
        WHERE
          organization_id = v_org), (
        SELECT
          count(*)
        FROM public.facility_cadence_windows
        WHERE
          organization_id = v_org) / count(DISTINCT f.id))
  FROM
    public.facilities f
  WHERE
    f.organization_id = v_org;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The roster. Three staff scheduled at the split building and at the roster
--    only building, nobody at the third.
--
--    The split building's rows carry assigned_resident_ids; the roster only
--    building's rows carry none, which is the case the old generator left
--    unassigned and the floor could not work.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '5a550000-0000-4000-8000-000000000001';
  v_split CONSTANT uuid := '5a550000-0000-4000-8000-000000000003';
  v_roster CONSTANT uuid := '5a550000-0000-4000-8000-000000000004';
  v_shift_date date;
  v_roster_shift public.shift_type;
  v_staff uuid[];
  v_residents uuid[];
  v_facility uuid;
  v_schedule uuid;
  v_slot text;
  i integer;
BEGIN
  -- The shift the generator would be writing for, resolved from configuration
  -- rather than named here.
  SELECT
    nxt.shift_service_date,
    nxt.roster_shift_type::public.shift_type INTO v_shift_date,
    v_roster_shift
  FROM
    public.facility_next_shift_window (v_split, now()) nxt;
  PERFORM
    pg_temp.as_assert (v_shift_date IS NOT NULL, 'the fixture facility resolves no next shift; the shift model copy did not land');

  FOR v_facility, v_slot IN
  SELECT
    *
  FROM (
    VALUES (v_split, '1'),
      (v_roster, '2')) AS f (id, slot) LOOP
      INSERT INTO public.schedules (id, facility_id, organization_id, week_start_date, status)
        VALUES (('5a550000-0000-4000-8000-0bb' || v_slot || lpad('1', 8, '0'))::uuid, v_facility, v_org, date_trunc('week', v_shift_date)::date, 'published')
      RETURNING
        id INTO v_schedule;

      INSERT INTO public.staff (id, facility_id, organization_id, first_name, last_name, staff_role, hire_date, employment_status)
      SELECT
        ('5a550000-0000-4000-8000-0cc' || v_slot || lpad(n.idx::text, 8, '0'))::uuid,
        v_facility,
        v_org,
        'Staff',
        'Synthetic',
        'resident_aide',
        current_date - 100,
        'active'
      FROM
        generate_series(1, 3) AS n (idx);

      SELECT
        array_agg(s.id ORDER BY s.id) INTO v_staff
      FROM
        public.staff s
      WHERE
        s.facility_id = v_facility;

      SELECT
        array_agg(r.id ORDER BY r.id) INTO v_residents
      FROM
        public.residents r
      WHERE
        r.facility_id = v_facility;

      FOR i IN 1..3 LOOP
        INSERT INTO public.shift_assignments (schedule_id, staff_id, facility_id, organization_id, shift_date, shift_type, status, assigned_resident_ids)
          VALUES (v_schedule, v_staff[i], v_facility, v_org, v_shift_date, v_roster_shift, 'confirmed',
            -- The split building hands each staff member two residents. The
            -- roster only building hands out nothing, which is the gap.
            CASE WHEN v_facility = v_split THEN
              ARRAY[v_residents[i * 2 - 1], v_residents[i * 2]]
            ELSE
              NULL
            END);
      END LOOP;
    END LOOP;

  INSERT INTO as_result (check_name, detail)
    VALUES ('roster', format('3 staff scheduled at two buildings for %s, none at the third', v_shift_date));
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Case one. A resident split assigns exactly as it did before.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_split CONSTANT uuid := '5a550000-0000-4000-8000-000000000003';
  v_shift_date date;
  v_roster_shift text;
  v_rows integer;
  v_wrong integer;
BEGIN
  SELECT
    nxt.shift_service_date,
    nxt.roster_shift_type INTO v_shift_date,
    v_roster_shift
  FROM
    public.facility_next_shift_window (v_split, now()) nxt;

  SELECT
    count(*) FILTER (WHERE a.assignment_source = 'resident_split'),
    count(*) FILTER (WHERE NOT EXISTS (
        SELECT
          1
        FROM
          public.shift_assignments sa
        WHERE
          sa.id = a.shift_assignment_id
          AND a.resident_id = ANY (sa.assigned_resident_ids))) INTO v_rows,
    v_wrong
  FROM
    public.resolve_observation_task_assignees (v_split, v_shift_date, v_roster_shift, (
        SELECT
          array_agg(id)
        FROM public.residents
        WHERE
          facility_id = v_split)) a;

  PERFORM
    pg_temp.as_assert (v_rows = 6, format('the resident split should have answered for all 6 residents, got %s', v_rows));
  PERFORM
    pg_temp.as_assert (v_wrong = 0, format('%s resident(s) were assigned to a shift_assignments row that does not name them', v_wrong));

  INSERT INTO as_result (check_name, detail)
    VALUES ('case 1, resident split', format('%s of 6 residents assigned from the split they were already in, 0 misrouted', v_rows));
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Case two. Staff are scheduled and nobody split the residents.
--
--    Every resident gets a scheduled staff member, the choice is the documented
--    hash rather than an accident of ordering, two calls agree, and the work is
--    spread rather than piled on the first name in the list.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_roster CONSTANT uuid := '5a550000-0000-4000-8000-000000000004';
  v_shift_date date;
  v_roster_shift text;
  v_residents uuid[];
  v_assigned integer;
  v_off_roster integer;
  v_distinct integer;
  v_unstable integer;
  v_off_formula integer;
BEGIN
  SELECT
    nxt.shift_service_date,
    nxt.roster_shift_type INTO v_shift_date,
    v_roster_shift
  FROM
    public.facility_next_shift_window (v_roster, now()) nxt;

  SELECT
    array_agg(id) INTO v_residents
  FROM
    public.residents
  WHERE
    facility_id = v_roster;

  CREATE TEMP TABLE as_first_call AS
  SELECT
    *
  FROM
    public.resolve_observation_task_assignees (v_roster, v_shift_date, v_roster_shift, v_residents);

  SELECT
    count(*) FILTER (WHERE assignment_source = 'shift_roster'),
    count(*) FILTER (WHERE staff_id IS NULL OR NOT EXISTS (
        SELECT
          1
        FROM
          public.shift_assignments sa
        WHERE
          sa.facility_id = v_roster
          AND sa.shift_date = v_shift_date
          AND sa.staff_id = as_first_call.staff_id)),
    count(DISTINCT staff_id) INTO v_assigned,
    v_off_roster,
    v_distinct
  FROM
    as_first_call;

  PERFORM
    pg_temp.as_assert (v_assigned = 6, format('all 6 residents should have been assigned from the shift roster, got %s. A resident with no assignee produces a task the floor cannot work.', v_assigned));
  PERFORM
    pg_temp.as_assert (v_off_roster = 0, format('%s resident(s) were assigned to somebody who is not on the schedule for that shift. No assignee may be invented.', v_off_roster));
  PERFORM
    pg_temp.as_assert (v_distinct > 1, format('all 6 residents landed on %s staff member(s). Round robin means the work is spread, not that one person owns the building.', v_distinct));

  -- Stability. A second call with the same roster and the same residents has to
  -- answer identically, or a re-tick of the generator reshuffles the board.
  SELECT
    count(*) INTO v_unstable
  FROM
    as_first_call f
    JOIN public.resolve_observation_task_assignees (v_roster, v_shift_date, v_roster_shift, v_residents) s ON s.resident_id = f.resident_id
  WHERE
    s.staff_id IS DISTINCT FROM f.staff_id;
  PERFORM
    pg_temp.as_assert (v_unstable = 0, format('%s resident(s) got a different assignee on the second call. The generator runs every few minutes; an unstable choice moves the board under the floor.', v_unstable));

  -- And the choice is the documented one: position of the staff member in the
  -- list ordered by staff_id, indexed by a stable hash of the resident id.
  -- Recomputed here independently of the function.
  SELECT
    count(*) INTO v_off_formula
  FROM
    as_first_call f
    JOIN LATERAL (
      SELECT
        ring.staff_id
      FROM (
        SELECT
          sa.staff_id,
          row_number() OVER (ORDER BY sa.staff_id) - 1 AS pos,
          count(*) OVER () AS n
        FROM (
          SELECT DISTINCT
            staff_id
          FROM
            public.shift_assignments
          WHERE
            facility_id = v_roster
            AND shift_date = v_shift_date
            AND deleted_at IS NULL) sa) ring
    WHERE
      ring.pos = ((hashtextextended(f.resident_id::text, 0) % ring.n) + ring.n) % ring.n) expected ON TRUE
  WHERE
    expected.staff_id IS DISTINCT FROM f.staff_id;
  PERFORM
    pg_temp.as_assert (v_off_formula = 0, format('%s resident(s) were not placed where a stable hash of the resident id against the ordered staff list puts them. The choice has stopped being reproducible from the data.', v_off_formula));

  INSERT INTO as_result (check_name, detail)
  SELECT
    'case 2, shift roster',
    format('6 of 6 residents assigned across %s scheduled staff, stable on a second call, matching the documented hash: %s', v_distinct, string_agg(DISTINCT right(staff_id::text, 4) || '=' || cnt::text, ', '))
  FROM (
    SELECT
      staff_id,
      count(*) AS cnt
    FROM
      as_first_call
    GROUP BY
      staff_id) spread;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Case two, continued. The task write assigns the task and writes the
--    assignment row, and a caregiver among the scheduled staff completes one.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '5a550000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := '5a550000-0000-4000-8000-000000000002';
  v_roster CONSTANT uuid := '5a550000-0000-4000-8000-000000000004';
  v_shift_date date;
  v_roster_shift text;
  v_version uuid;
  v_payload jsonb;
  v_written integer;
  v_tasks integer;
  v_unassigned integer;
  v_without_row integer;
  v_second integer;
  v_worked record;
  v_user uuid;
  v_session CONSTANT uuid := '5a550000-0000-4000-8000-000000000009';
  v_result jsonb;
BEGIN
  SELECT
    nxt.shift_service_date,
    nxt.roster_shift_type INTO v_shift_date,
    v_roster_shift
  FROM
    public.facility_next_shift_window (v_roster, now()) nxt;

  SELECT
    id INTO v_version
  FROM
    public.facility_cadence_versions
  WHERE
    facility_id = v_roster
    AND status = 'active';

  -- Exactly the payload the generator builds, assignees included.
  SELECT
    jsonb_agg(jsonb_build_object('organization_id', v_org, 'entity_id', v_entity, 'facility_id', v_roster, 'resident_id', a.resident_id, 'cadence_version_id', v_version, 'window_key', w.window_key, 'service_date', w.service_date, 'shift_assignment_id', a.shift_assignment_id, 'assigned_staff_id', a.staff_id, 'scheduled_for', w.window_opens_at_utc, 'due_at', w.due_at_utc, 'grace_ends_at', w.window_closes_at_utc, 'status', 'upcoming')) INTO v_payload
  FROM
    public.facility_next_shift_observation_windows (v_roster, now()) w
    CROSS JOIN public.resolve_observation_task_assignees (v_roster, v_shift_date, v_roster_shift, (
        SELECT
          array_agg(id)
        FROM public.residents
        WHERE
          facility_id = v_roster)) a;

  v_written := public.record_cadence_observation_tasks (v_payload);
  PERFORM
    pg_temp.as_assert (v_written > 0, 'the generator payload wrote no tasks at all');

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
          AND ra.released_at IS NULL
          AND ra.assignment_type = 'primary')) INTO v_tasks,
    v_unassigned,
    v_without_row
  FROM
    public.resident_observation_tasks t
  WHERE
    t.facility_id = v_roster;

  PERFORM
    pg_temp.as_assert (v_unassigned = 0, format('%s of %s generated tasks have no assignee. Those are completable by nobody below nurse.', v_unassigned, v_tasks));
  PERFORM
    pg_temp.as_assert (v_without_row = 0, format('%s of %s generated tasks have no live primary assignment row. The assignee guard then passes only through assigned_staff_id and there is no audit trail naming who owns the check.', v_without_row, v_tasks));

  -- Idempotent. A second identical run writes nothing and assigns nothing.
  v_second := public.record_cadence_observation_tasks (v_payload);
  PERFORM
    pg_temp.as_assert (v_second = 0, format('a second identical generator run wrote %s more task(s)', v_second));
  PERFORM
    pg_temp.as_assert ((
      SELECT
        count(*)
      FROM public.resident_observation_assignments ra
      JOIN public.resident_observation_tasks t ON t.id = ra.task_id
      WHERE
        t.facility_id = v_roster) = v_tasks, 'the second run duplicated assignment rows');

  -- A caregiver among the scheduled staff completes one of their own checks.
  SELECT
    t.id AS task_id,
    t.assigned_staff_id,
    t.resident_id INTO v_worked
  FROM
    public.resident_observation_tasks t
  WHERE
    t.facility_id = v_roster
  ORDER BY
    t.due_at
  LIMIT 1;

  v_user := '5a550000-0000-4000-8000-00000000000a';
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, ROLE, created_at, updated_at, confirmation_token)
    VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'synthetic-roster-caregiver@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), '');
  INSERT INTO auth.sessions (id, user_id)
    VALUES (v_session, v_user);
  INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role, is_active)
    VALUES (v_user, v_org, 'synthetic-roster-caregiver@haven.test', 'Synthetic Roster Caregiver', 'caregiver', TRUE);
  INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
    VALUES (v_user, v_roster, v_org, TRUE);
  UPDATE
    public.staff
  SET
    user_id = v_user
  WHERE
    id = v_worked.assigned_staff_id;

  PERFORM
    set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_user, 'session_id', v_session, 'auth_claim_version', (
        SELECT
          auth_claim_version::text
        FROM public.user_profiles
        WHERE
          id = v_user))::text, TRUE);

  v_result := public.complete_rounding_task_review (v_worked.task_id, v_user, 'caregiver', v_session, (
      SELECT
        auth_claim_version
      FROM public.user_profiles
      WHERE
        id = v_user), v_org, v_roster, v_worked.assigned_staff_id, jsonb_build_object('request_id', gen_random_uuid(), 'observed_at', now(), 'entered_at', now(), 'entry_mode', 'live', 'quick_status', 'calm', 'resident_location', 'room', 'resident_state', 'awake'));

  PERFORM
    pg_temp.as_assert (v_result ->> 'log_id' IS NOT NULL, 'a caregiver the generator assigned from the shift roster could not complete their own check. The assignment is not reaching the assignee guard.');

  INSERT INTO as_result (check_name, detail)
    VALUES ('case 2, workable', format('%s tasks written, 0 unassigned, %s primary assignment rows, a caregiver completed one, a second run wrote 0', v_tasks, v_tasks));
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Case three. Nobody is scheduled.
--
--    No assignee is invented, the tasks are still generated so the gap is
--    counted rather than hidden, and the shift is raised as a visible defect
--    naming the building, the shift and the service date.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '5a550000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := '5a550000-0000-4000-8000-000000000002';
  v_empty CONSTANT uuid := '5a550000-0000-4000-8000-000000000005';
  v_shift_date date;
  v_roster_shift text;
  v_shift_key text;
  v_version uuid;
  v_none integer;
  v_invented integer;
  v_written integer;
  v_recorded boolean;
  v_again boolean;
  v_alert record;
BEGIN
  SELECT
    nxt.shift_service_date,
    nxt.roster_shift_type,
    nxt.shift_key INTO v_shift_date,
    v_roster_shift,
    v_shift_key
  FROM
    public.facility_next_shift_window (v_empty, now()) nxt;

  SELECT
    count(*) FILTER (WHERE assignment_source = 'none_scheduled'),
    count(*) FILTER (WHERE staff_id IS NOT NULL) INTO v_none,
    v_invented
  FROM
    public.resolve_observation_task_assignees (v_empty, v_shift_date, v_roster_shift, (
        SELECT
          array_agg(id)
        FROM public.residents
        WHERE
          facility_id = v_empty));

  PERFORM
    pg_temp.as_assert (v_none = 6, format('a building with nobody scheduled should answer none_scheduled for all 6 residents, got %s', v_none));
  PERFORM
    pg_temp.as_assert (v_invented = 0, format('%s assignee(s) were invented at a building where nobody is scheduled. A task assigned to somebody who is not working looks covered and is not.', v_invented));

  SELECT
    id INTO v_version
  FROM
    public.facility_cadence_versions
  WHERE
    facility_id = v_empty
    AND status = 'active';

  SELECT
    public.record_cadence_observation_tasks (jsonb_agg(jsonb_build_object('organization_id', v_org, 'entity_id', v_entity, 'facility_id', v_empty, 'resident_id', r.id, 'cadence_version_id', v_version, 'window_key', w.window_key, 'service_date', w.service_date, 'shift_assignment_id', NULL, 'assigned_staff_id', NULL, 'scheduled_for', w.window_opens_at_utc, 'due_at', w.due_at_utc, 'grace_ends_at', w.window_closes_at_utc, 'status', 'upcoming'))) INTO v_written
  FROM
    public.facility_next_shift_observation_windows (v_empty, now()) w
    CROSS JOIN public.residents r
  WHERE
    r.facility_id = v_empty;

  PERFORM
    pg_temp.as_assert (v_written > 0, 'a building with nobody scheduled generated no tasks. The gap has to be counted, not hidden: those residents still have to be looked at.');
  PERFORM
    pg_temp.as_assert ((
      SELECT
        count(*)
      FROM public.resident_observation_assignments ra
      JOIN public.resident_observation_tasks t ON t.id = ra.task_id
      WHERE
        t.facility_id = v_empty) = 0, 'assignment rows were written at a building where nobody is scheduled');

  v_recorded := public.record_observation_staffing_gap (v_empty, v_shift_key, v_shift_date);
  PERFORM
    pg_temp.as_assert (v_recorded, 'no defect was raised for a shift nobody is scheduled to work');

  -- The facilities insert trigger already filed a cadence configuration alert
  -- for this synthetic building. The staffing gap is a different defect on a
  -- different module, so it is selected by source_module rather than by being
  -- the only row.
  SELECT
    * INTO v_alert
  FROM
    public.exec_alerts
  WHERE
    facility_id = v_empty
    AND source_module = 'staff'
    AND resolved_at IS NULL
    AND deleted_at IS NULL;

  PERFORM
    pg_temp.as_assert (v_alert.id IS NOT NULL, 'no staffing defect row was filed for the shift nobody is scheduled to work');
  PERFORM
    pg_temp.as_assert (v_alert.title LIKE '%' || (
      SELECT
        name
      FROM public.facilities
      WHERE
        id = v_empty) || '%', format('the defect does not name the building: %s', v_alert.title));
  PERFORM
    pg_temp.as_assert (v_alert.title LIKE '%' || (
      SELECT
        label
      FROM public.facility_shift_definitions
      WHERE
        facility_id = v_empty
        AND shift_key = v_shift_key) || '%', format('the defect does not name the shift: %s', v_alert.title));
  PERFORM
    pg_temp.as_assert (v_alert.title LIKE '%' || to_char(v_shift_date, 'FMMonth FMDD, YYYY') || '%', format('the defect does not name the service date: %s', v_alert.title));
  PERFORM
    pg_temp.as_assert (v_alert.severity::text IN ('warning', 'critical'), 'the staffing defect is filed as information rather than as a problem');

  -- The cron ticks every few minutes. The gap is raised once.
  v_again := public.record_observation_staffing_gap (v_empty, v_shift_key, v_shift_date);
  PERFORM
    pg_temp.as_assert (NOT v_again, 'the staffing defect was raised twice for the same shift; the alert board fills up and stops being read');

  INSERT INTO as_result (check_name, detail)
    VALUES ('case 3, nobody scheduled', format('6 of 6 residents answered none_scheduled, 0 assignees invented, %s tasks still generated, one alert raised and not repeated: %s', v_written, v_alert.title));
END
$$;

-- ---------------------------------------------------------------------------
-- 7. M9. A transferred resident leaves nothing live behind.
--
--    The generator picked departed residents as
--    `facility_id = thisFacility AND status <> 'active'`. A transferred
--    resident's facility_id points at the new building and their status is still
--    active, so they matched neither half, and their outstanding tasks stayed
--    live at the building they had left: they run to overdue, climb the ladder
--    and reach the terminal rung as an SMS and a critical alert naming a room
--    the resident is not in, while the same resident is checked normally at the
--    new building.
--
--    Same class as the hospital_hold defect staging surfaced: the generator
--    decided who to exclude by one predicate while the tasks already on the
--    board were governed by another. There is one definition now.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := '5a550000-0000-4000-8000-000000000001';
  -- The roster building is the one this script has already written tasks for.
  v_from CONSTANT uuid := '5a550000-0000-4000-8000-000000000004';
  v_to CONSTANT uuid := '5a550000-0000-4000-8000-000000000003';
  v_mover uuid;
  v_stayer uuid;
  v_live_before integer;
  v_stood_down integer;
  v_mover_status text;
  v_stayer_status text;
  v_mover_reason text;
  v_second integer;
BEGIN
  SELECT
    id INTO v_mover
  FROM
    public.residents
  WHERE
    facility_id = v_from
  ORDER BY
    id
  LIMIT 1;
  SELECT
    id INTO v_stayer
  FROM
    public.residents
  WHERE
    facility_id = v_from
    AND id <> v_mover
  ORDER BY
    id
  LIMIT 1;
  PERFORM
    pg_temp.as_assert (v_mover IS NOT NULL
      AND v_stayer IS NOT NULL, 'the fixture needs two residents at the building being left');

  SELECT
    count(*) INTO v_live_before
  FROM
    public.resident_observation_tasks
  WHERE
    facility_id = v_from
    AND resident_id = v_mover
    AND status IN ('upcoming', 'due_soon')
    AND due_at > now();
  PERFORM
    pg_temp.as_assert (v_live_before > 0, 'the fixture needs at least one not yet due task for the resident who is about to transfer');

  -- The transfer. facility_id moves; the status stays active, because the
  -- resident is still a resident.
  UPDATE
    public.residents
  SET
    facility_id = v_to
  WHERE
    id = v_mover;

  v_stood_down := public.stand_down_ungenerated_observation_tasks (v_from, now());

  -- An earlier case in this script completed one of this resident's checks.
  -- A completed check is a record of work and is never stood down; the
  -- assertion is about the windows that were still open.
  SELECT
    status::text,
    excused_reason INTO v_mover_status,
    v_mover_reason
  FROM
    public.resident_observation_tasks
  WHERE
    facility_id = v_from
    AND resident_id = v_mover
    AND status NOT IN ('completed_on_time', 'completed_late')
  ORDER BY
    due_at
  LIMIT 1;

  SELECT
    status::text INTO v_stayer_status
  FROM
    public.resident_observation_tasks
  WHERE
    facility_id = v_from
    AND resident_id = v_stayer
    AND due_at > now()
  ORDER BY
    due_at
  LIMIT 1;

  PERFORM
    pg_temp.as_assert (NOT EXISTS (
        SELECT
          1
        FROM
          public.resident_observation_tasks
        WHERE
          facility_id = v_from
          AND resident_id = v_mover
          AND status IN ('upcoming', 'due_soon')
          AND due_at > now()), 'the transferred resident still has live tasks at the building they left. Those run to overdue, climb the ladder and reach the terminal rung as an SMS and a critical alert naming a room they are not in.');
  PERFORM
    pg_temp.as_assert (v_stood_down >= v_live_before, format('the stand down excused %s task(s) and the transferred resident had %s live at the old building. Anything left behind climbs the ladder to a terminal rung naming a room they are not in.', v_stood_down, v_live_before));
  PERFORM
    pg_temp.as_assert (v_mover_status = 'excused', format('the transferred resident''s task at the old building reads %s', COALESCE(v_mover_status, 'missing')));
  PERFORM
    pg_temp.as_assert (v_mover_reason = 'Resident has transferred to another facility', format('the stand down reason is %s, which does not say what happened', COALESCE(v_mover_reason, 'null')));
  PERFORM
    pg_temp.as_assert (v_stayer_status = 'upcoming', format('the resident who did not move had their task stood down as well, reading %s. A stand down that clears the board is not a fix.', COALESCE(v_stayer_status, 'missing')));

  -- Nothing left to do on a second pass, and nothing hands the tasks back.
  v_second := public.stand_down_ungenerated_observation_tasks (v_from, now());
  PERFORM
    pg_temp.as_assert (v_second = 0, format('a second stand down excused %s more task(s)', v_second));
  PERFORM
    pg_temp.as_assert (public.generate_monitoring_order_tasks (v_from, NULL) >= 0, 'the order generator failed after the transfer');
  PERFORM
    pg_temp.as_assert (NOT EXISTS (
        SELECT
          1
        FROM
          public.resident_observation_tasks t
          JOIN public.resident_monitoring_orders o ON o.id = t.monitoring_order_id
        WHERE
          t.facility_id = v_from
          AND t.resident_id = v_mover
          AND t.status IN ('upcoming', 'due_soon')), 'a Monitoring Order handed the transferred resident fresh tasks at the building they left, so the board churns between excused and upcoming on every tick');

  UPDATE
    public.residents
  SET
    facility_id = v_from
  WHERE
    id = v_mover;

  INSERT INTO as_result (check_name, detail)
    VALUES ('case 4, a transfer leaves nothing live', format('the transferred resident had %s live task(s) at the old building and the stand down excused %s of them as a transfer; the resident who stayed keeps theirs; a second pass excuses 0 and no order hands any back', v_live_before, v_stood_down));
END
$$;

SELECT
  seq,
  check_name,
  detail
FROM
  as_result
ORDER BY
  seq;

ROLLBACK;
