-- COL-677 / COL-693: Smart Rounding checks owned by on-clock staff (migration 495).
-- Spec 40 section 8 and section 10 item 6.
--
-- With no shift_assignments at all, the timeclock is the staffing record:
--   * a check due after a med tech clocks in is owned by that med tech, both
--     when the generator writes it (resolve_observation_task_assignees) and
--     when an unowned check is picked up (assign_unowned_observation_tasks);
--   * a re-run changes no owner, even after the people on the clock change;
--   * nobody off the clock, at another facility, punched in elsewhere, without
--     a facility grant, or in a role that cannot record checks is ever chosen;
--   * the owner roles are facility configuration (rounding_owner_roles): by
--     default only med techs, so an administrator who punches in owns nothing
--     until the facility names facility_admin, and the setting refuses roles
--     that cannot complete any check;
--   * a person on a meal break is still on shift and can be chosen;
--   * the incoming shift is never owned by the shift on the clock;
--   * the staffing gap is not raised while somebody eligible is on the clock,
--     and is raised when nobody is;
--   * a missed check still names its on-clock owner, in the task and in the
--     escalation deliveries its rungs address;
--   * the generator's real write path (record_cadence_observation_tasks,
--     migration 433) adopts an unowned check of the same cadence version once
--     somebody is on the clock, and never re-assigns an owned one;
--   * at a shift handoff the outgoing tech, still clocked in, owns nothing
--     once the incoming tech has clocked in for the shift (lead minutes are a
--     facility setting), and owns the checks when nobody else is on the clock;
--   * a "Nobody is scheduled" alert raised before anybody clocked in is
--     resolved once somebody eligible is on the clock for that shift.
--
-- One transaction that rolls back. Synthetic facility, residents and staff
-- only ("Probe ..."); nothing is selected by a real person's name.
BEGIN;

SET LOCAL client_min_messages = warning;

CREATE FUNCTION pg_temp.ro_assert (ok boolean, msg text)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'COL-693 rounding owner from punches: %', msg;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Grant posture. The private helpers are reachable by nobody; the two
--    commands the generator calls are service_role only, and the resolver is a
--    definer precisely because the timeclock helpers hold no service_role grant.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.resolve_observation_task_assignees(uuid,date,text,uuid[])', 'public.assign_unowned_observation_tasks(uuid,timestamptz)', 'public.record_observation_staffing_gap(uuid,text,date)', 'public.resolve_observation_staffing_gap(uuid,text,date)'] LOOP
    PERFORM pg_temp.ro_assert (to_regprocedure(v_fn) IS NOT NULL, format('%s is gone', v_fn));
    PERFORM pg_temp.ro_assert (NOT has_function_privilege('anon', v_fn, 'EXECUTE') AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'), format('%s is executable by a request role', v_fn));
    PERFORM pg_temp.ro_assert (has_function_privilege('service_role', v_fn, 'EXECUTE'), format('service_role lost EXECUTE on %s; the task generator is its caller', v_fn));
    PERFORM pg_temp.ro_assert ((SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure), format('%s is not SECURITY DEFINER; service_role cannot read the private timeclock helpers', v_fn));
    PERFORM pg_temp.ro_assert (strpos(COALESCE(obj_description(v_fn::regprocedure, 'pg_proc'), ''), 'COL-37 ruling:') > 0, format('%s carries no COL-37 ruling', v_fn));
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['haven.observation_on_clock_staff(uuid,timestamptz)', 'haven.observation_shift_owner_staff(uuid,timestamptz,timestamptz)', 'haven.observation_staffing_gap_title(uuid,text,date)', 'haven.resolve_observation_task_assignees_at(uuid,date,text,uuid[],timestamptz)', 'haven.timeclock_state(uuid,timestamptz)'] LOOP
    PERFORM pg_temp.ro_assert (NOT has_function_privilege('anon', v_fn, 'EXECUTE') AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') AND NOT has_function_privilege('service_role', v_fn, 'EXECUTE'), format('private helper %s is executable by a request role', v_fn));
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Fixture: a new building in the seeded organization (the facilities
--    trigger copies the shift model, cadence and ladder), a second building,
--    eight residents, no shift_assignments, and staff who each exercise one
--    exclusion.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE ro AS
SELECT
  f.organization_id AS org,
  f.entity_id AS entity,
  '0a820000-0000-4000-8000-000000000003'::uuid AS fac,
  '0a820000-0000-4000-8000-000000000004'::uuid AS other_fac,
  '0a820000-0000-4000-8000-0000000000a1'::uuid AS a_user, -- med tech, clocks in
  '0a820000-0000-4000-8000-0000000000a2'::uuid AS a_staff,
  '0a820000-0000-4000-8000-0000000000b1'::uuid AS m_user, -- med tech, on a meal break
  '0a820000-0000-4000-8000-0000000000b2'::uuid AS m_staff,
  '0a820000-0000-4000-8000-0000000000c1'::uuid AS o_user, -- med tech, clocked out
  '0a820000-0000-4000-8000-0000000000c2'::uuid AS o_staff,
  '0a820000-0000-4000-8000-0000000000d1'::uuid AS h_user, -- housekeeper, on the clock
  '0a820000-0000-4000-8000-0000000000d2'::uuid AS h_staff,
  '0a820000-0000-4000-8000-0000000000e1'::uuid AS x_user, -- med tech of the other building, on the clock there
  '0a820000-0000-4000-8000-0000000000e2'::uuid AS x_staff,
  '0a820000-0000-4000-8000-0000000000f1'::uuid AS y_user, -- med tech of this building, punched in at the other
  '0a820000-0000-4000-8000-0000000000f2'::uuid AS y_staff,
  '0a820000-0000-4000-8000-000000000011'::uuid AS n_user, -- med tech, on the clock, no facility grant
  '0a820000-0000-4000-8000-000000000012'::uuid AS n_staff,
  '0a820000-0000-4000-8000-000000000021'::uuid AS k_user, -- administrator, on the clock
  '0a820000-0000-4000-8000-000000000022'::uuid AS k_staff,
  '0a820000-0000-4000-8000-000000000005'::uuid AS hand_fac, -- the handoff building
  '0a820000-0000-4000-8000-000000000031'::uuid AS night_user, -- outgoing med tech, still clocked in
  '0a820000-0000-4000-8000-000000000032'::uuid AS night_staff,
  '0a820000-0000-4000-8000-000000000041'::uuid AS day_user, -- incoming med tech
  '0a820000-0000-4000-8000-000000000042'::uuid AS day_staff
FROM
  public.facilities f
WHERE
  f.deleted_at IS NULL
  AND EXISTS (
    SELECT
      1
    FROM
      public.facility_cadence_versions v
    WHERE
      v.facility_id = f.id
      AND v.status = 'active')
ORDER BY
  f.id
LIMIT 1;

DO $$
BEGIN
  PERFORM pg_temp.ro_assert (EXISTS (SELECT 1 FROM ro), 'a seeded facility with an active cadence is required as the donor');
END
$$;

INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
SELECT fac, entity, org, 'Rounding owner probe', '1 Probe Way', 'Probe', '00000', 10, 'America/New_York' FROM ro
UNION ALL
SELECT other_fac, entity, org, 'Rounding owner probe other', '2 Probe Way', 'Probe', '00000', 10, 'America/New_York' FROM ro
UNION ALL
SELECT hand_fac, entity, org, 'Rounding owner probe handoff', '3 Probe Way', 'Probe', '00000', 10, 'America/New_York' FROM ro;

-- This synthetic fixture describes configuration already in force before today.
UPDATE public.facility_observation_shift_history SET effective_from = '-infinity'::timestamptz
WHERE created_at = transaction_timestamp() AND effective_to IS NULL;

INSERT INTO public.timeclock_facility_settings (organization_id, facility_id, timeclock_enabled)
SELECT org, fac, true FROM ro
UNION ALL
SELECT org, other_fac, true FROM ro
UNION ALL
SELECT org, hand_fac, true FROM ro;

INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender, admission_date)
SELECT ('0a820000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, fac, org, 'Probe', 'Resident', 'active'::public.resident_status, 'prefer_not_to_say'::public.gender, current_date - 30
FROM ro, generate_series(1, 8) AS i
UNION ALL
SELECT ('0a820000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid, hand_fac, org, 'Probe', 'Resident', 'active'::public.resident_status, 'prefer_not_to_say'::public.gender, current_date - 30
FROM ro, generate_series(1, 4) AS i;

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
SELECT u, u || '@rounding-owner-review.invalid', '{}'::jsonb, '{}'::jsonb
FROM ro, unnest(ARRAY[a_user, m_user, o_user, h_user, x_user, y_user, n_user, k_user, night_user, day_user]) u;

INSERT INTO public.user_profiles (id, email, full_name, app_role, organization_id, is_active)
SELECT u.id, u.id || '@rounding-owner-review.invalid', u.label, u.role::public.app_role, ro.org, true
FROM ro
CROSS JOIN LATERAL (
  VALUES (ro.a_user, 'Probe Alpha', 'med_tech'),
    (ro.m_user, 'Probe Mike', 'med_tech'),
    (ro.o_user, 'Probe Oscar', 'med_tech'),
    (ro.h_user, 'Probe Hotel', 'housekeeper'),
    (ro.x_user, 'Probe Xray', 'med_tech'),
    (ro.y_user, 'Probe Yankee', 'med_tech'),
    (ro.n_user, 'Probe November', 'med_tech'),
    (ro.k_user, 'Probe Kilo', 'facility_admin'),
    (ro.night_user, 'Probe Nightingale', 'med_tech'),
    (ro.day_user, 'Probe Daybreak', 'med_tech')) AS u (id, label, role);

INSERT INTO public.user_facility_access (user_id, facility_id, organization_id)
SELECT u, fac, org FROM ro, unnest(ARRAY[a_user, m_user, o_user, h_user, y_user, k_user]) u
UNION ALL
SELECT x_user, other_fac, org FROM ro
UNION ALL
SELECT y_user, other_fac, org FROM ro
UNION ALL
SELECT u, hand_fac, org FROM ro, unnest(ARRAY[night_user, day_user]) u;

INSERT INTO public.staff (id, organization_id, facility_id, user_id, first_name, last_name, staff_role, hire_date, employment_status)
SELECT s.id, ro.org, s.facility, s.user_id, 'Probe', s.label, 'resident_aide'::public.staff_role, current_date - 100, 'active'::public.employment_status
FROM ro
CROSS JOIN LATERAL (
  VALUES (ro.a_staff, ro.fac, ro.a_user, 'Alpha'),
    (ro.m_staff, ro.fac, ro.m_user, 'Mike'),
    (ro.o_staff, ro.fac, ro.o_user, 'Oscar'),
    (ro.h_staff, ro.fac, ro.h_user, 'Hotel'),
    (ro.x_staff, ro.other_fac, ro.x_user, 'Xray'),
    (ro.y_staff, ro.fac, ro.y_user, 'Yankee'),
    (ro.n_staff, ro.fac, ro.n_user, 'November'),
    (ro.k_staff, ro.fac, ro.k_user, 'Kilo'),
    (ro.night_staff, ro.hand_fac, ro.night_user, 'Nightingale'),
    (ro.day_staff, ro.hand_fac, ro.day_user, 'Daybreak')) AS s (id, facility, user_id, label);

-- Everybody who is never eligible is on the clock (or was) from the start, so
-- every assertion below runs with them present.
INSERT INTO public.time_punches (organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
SELECT ro.org, p.facility, p.staff, p.kind, p.at, gen_random_uuid()
FROM ro
CROSS JOIN LATERAL (
  VALUES (ro.o_staff, ro.fac, 'in', now() - interval '5 hours'),
    (ro.o_staff, ro.fac, 'out', now() - interval '1 hour'),
    (ro.h_staff, ro.fac, 'in', now() - interval '1 hour'),
    (ro.x_staff, ro.other_fac, 'in', now() - interval '1 hour'),
    (ro.y_staff, ro.other_fac, 'in', now() - interval '1 hour'),
    (ro.n_staff, ro.fac, 'in', now() - interval '1 hour'),
    (ro.k_staff, ro.fac, 'in', now() - interval '1 hour')) AS p (staff, facility, kind, at);

-- The shift in progress and the one after it, from configuration.
CREATE TEMP TABLE ro_shift AS
SELECT
  'current'::text AS phase, s.*
FROM
  ro, public.facility_shift_window_at (ro.fac, now()) s
UNION ALL
SELECT
  'next', s.*
FROM
  ro, public.facility_next_shift_window (ro.fac, now()) s;

DO $$
BEGIN
  PERFORM pg_temp.ro_assert ((SELECT rounding_owner_roles FROM public.timeclock_facility_settings JOIN ro ON facility_id = ro.fac) = ARRAY['med_tech'], 'rounding_owner_roles does not default to med_tech only');
  PERFORM pg_temp.ro_assert ((SELECT count(*) FROM ro_shift) = 2, 'the probe facility resolves no current and next shift; the seeded shift model did not land');
  PERFORM pg_temp.ro_assert ((SELECT rounding_clock_in_lead_minutes FROM public.timeclock_facility_settings JOIN ro ON facility_id = ro.fac) = 30, 'rounding_clock_in_lead_minutes does not default to 30');
  PERFORM pg_temp.ro_assert ((SELECT row(s.starts_at_utc, s.roster_shift_type, s.shift_service_date) FROM ro, public.facility_shift_window_at (ro.hand_fac, now()) s)
    = (SELECT row(starts_at_utc, roster_shift_type, shift_service_date) FROM ro_shift WHERE phase = 'current'), 'the handoff building does not share the probe building''s shift model');
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM public.shift_assignments sa JOIN ro ON sa.facility_id = ro.fac), 'the probe facility must have no shift_assignments');
END
$$;

-- The generator's write, emulated through its real path: one check per
-- resident for a window of the given shift, stamped with the facility's active
-- cadence version and owned by whatever the resolver answers, written by
-- record_cadence_observation_tasks. A re-run with the same window is the
-- generator's next tick: 433's ON CONFLICT adopts an unowned check of the same
-- cadence version and leaves an owned one alone. Returns inserted plus adopted.
CREATE FUNCTION pg_temp.ro_generate_at (p_fac uuid, p_phase text, p_window_key text, p_due timestamptz)
  RETURNS integer
  LANGUAGE sql
  AS $$
  SELECT
    public.record_cadence_observation_tasks (jsonb_agg(jsonb_build_object('organization_id', ro.org, 'entity_id', ro.entity, 'facility_id', p_fac, 'resident_id', a.resident_id, 'cadence_version_id', (
            SELECT
              v.id
            FROM public.facility_cadence_versions v
            WHERE
              v.facility_id = p_fac
              AND v.status = 'active'
              AND v.deleted_at IS NULL
            ORDER BY v.effective_from DESC
            LIMIT 1), 'window_key', p_window_key, 'service_date', s.shift_service_date, 'shift_assignment_id', a.shift_assignment_id, 'assigned_staff_id', a.staff_id, 'scheduled_for', p_due - interval '30 minutes', 'due_at', p_due, 'grace_ends_at', p_due + interval '30 minutes', 'status', 'upcoming')))
  FROM
    ro
    JOIN ro_shift s ON s.phase = p_phase
    CROSS JOIN LATERAL public.resolve_observation_task_assignees (p_fac, s.shift_service_date, s.roster_shift_type::text, ARRAY (
        SELECT
          r.id
        FROM public.residents r
        WHERE
          r.facility_id = p_fac)) a;
$$;

CREATE FUNCTION pg_temp.ro_generate (p_phase text, p_window_key text, p_due timestamptz)
  RETURNS integer
  LANGUAGE sql
  AS $$
  SELECT pg_temp.ro_generate_at ((SELECT fac FROM ro), p_phase, p_window_key, p_due);
$$;

-- ---------------------------------------------------------------------------
-- 3. Nobody eligible on the clock yet. The shift in progress resolves to
--    none_scheduled, the incoming shift to awaiting_clock_in, and neither
--    writes an owner. The incoming shift is not a gap yet.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cur record;
  v_next record;
  v_sources text[];
BEGIN
  SELECT * INTO v_cur FROM ro_shift WHERE phase = 'current';
  SELECT * INTO v_next FROM ro_shift WHERE phase = 'next';

  SELECT array_agg(DISTINCT a.assignment_source) INTO v_sources
  FROM ro, public.resolve_observation_task_assignees (ro.fac, v_cur.shift_service_date, v_cur.roster_shift_type::text, ARRAY (SELECT r.id FROM public.residents r WHERE r.facility_id = ro.fac)) a;
  PERFORM pg_temp.ro_assert (v_sources = ARRAY['none_scheduled'], format('with nobody eligible on the clock the shift in progress must resolve none_scheduled, got %s (an off-clock, housekeeper, administrator-by-default, other-building, punched-elsewhere or ungranted person was chosen)', v_sources));

  SELECT array_agg(DISTINCT a.assignment_source) INTO v_sources
  FROM ro, public.resolve_observation_task_assignees (ro.fac, v_next.shift_service_date, v_next.roster_shift_type::text, ARRAY (SELECT r.id FROM public.residents r WHERE r.facility_id = ro.fac)) a;
  PERFORM pg_temp.ro_assert (v_sources = ARRAY['awaiting_clock_in'], format('the incoming shift at a building that staffs from punches must resolve awaiting_clock_in, got %s', v_sources));

  PERFORM pg_temp.ro_assert (public.record_observation_staffing_gap ((SELECT fac FROM ro), v_next.shift_key, v_next.shift_service_date) = FALSE, 'the incoming shift was raised as a staffing gap before anybody could clock in for it');

  -- Two unowned checks per resident: one later in the shift in progress, one in
  -- the incoming shift.
  PERFORM pg_temp.ro_assert (pg_temp.ro_generate ('current', 'probe_current', now() + (v_cur.ends_at_utc - now()) / 2) = 8, 'the current shift checks were not written');
  PERFORM pg_temp.ro_assert (pg_temp.ro_generate ('current', 'probe_current_b', now() + (v_cur.ends_at_utc - now()) / 2) = 8, 'the second set of current shift checks was not written');
  PERFORM pg_temp.ro_assert (pg_temp.ro_generate ('current', 'probe_current', now() + (v_cur.ends_at_utc - now()) / 2) = 0, 'a re-run with nobody on the clock adopted or wrote something');
  PERFORM pg_temp.ro_assert (pg_temp.ro_generate ('next', 'probe_next', v_next.starts_at_utc + interval '1 hour') = 8, 'the incoming shift checks were not written');
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.fac WHERE t.assigned_staff_id IS NOT NULL), 'a check got an owner while nobody eligible was on the clock');

  PERFORM pg_temp.ro_assert (public.assign_unowned_observation_tasks ((SELECT fac FROM ro), now()) = 0, 'the unowned pass assigned a check while nobody eligible was on the clock');

  -- The first tick of the shift found nobody: the gap is raised, and it stays
  -- open while nobody is on the clock.
  PERFORM pg_temp.ro_assert (public.record_observation_staffing_gap ((SELECT fac FROM ro), v_cur.shift_key, v_cur.shift_service_date) = TRUE, 'the shift in progress with nobody scheduled and nobody on the clock was not raised');
  PERFORM pg_temp.ro_assert (public.resolve_observation_staffing_gap ((SELECT fac FROM ro), v_cur.shift_key, v_cur.shift_service_date) = FALSE, 'a gap was resolved while nobody was on the clock');
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Probe Alpha clocks in. Within one run, as service_role (the generator's
--    role), the unowned checks of the shift in progress go to Alpha, with a
--    primary assignment row and no shift assignment. The incoming shift stays
--    unowned. The resolver answers on_clock and the gap is not raised.
-- ---------------------------------------------------------------------------
-- Alpha's punch is inside the shift (half way between its start and now), so
-- Alpha clocked in for this shift whatever the time of day the probe runs.
INSERT INTO public.time_punches (organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
SELECT org, fac, a_staff, 'in', s.starts_at_utc + (now() - s.starts_at_utc) / 2, gen_random_uuid()
FROM ro, ro_shift s WHERE s.phase = 'current';

-- The next tick of the generator, through its real write: the probe_current
-- checks written unowned above are adopted by the on-clock med tech.
SELECT set_config('ro.adopted', pg_temp.ro_generate ('current', 'probe_current', now() + (ends_at_utc - now()) / 2)::text, true)
FROM ro_shift WHERE phase = 'current';
SELECT set_config('ro.readopted', pg_temp.ro_generate ('current', 'probe_current', now() + (ends_at_utc - now()) / 2)::text, true)
FROM ro_shift WHERE phase = 'current';

SELECT set_config('ro.cur_date', shift_service_date::text, true), set_config('ro.cur_type', roster_shift_type::text, true)
FROM ro_shift WHERE phase = 'current';

SET LOCAL ROLE service_role;
SELECT set_config('ro.assigned', public.assign_unowned_observation_tasks ('0a820000-0000-4000-8000-000000000003'::uuid, now())::text, true);
SELECT set_config('ro.reassigned', public.assign_unowned_observation_tasks ('0a820000-0000-4000-8000-000000000003'::uuid, now())::text, true);
SELECT set_config('ro.service_resolve', a.assignment_source || ':' || COALESCE(a.staff_id::text, ''), true)
FROM public.resolve_observation_task_assignees ('0a820000-0000-4000-8000-000000000003'::uuid, current_setting('ro.cur_date')::date, current_setting('ro.cur_type'), ARRAY['0a820000-0000-4000-8000-000000000101'::uuid]) a;
RESET ROLE;

DO $$
DECLARE
  v_cur record;
  v_bad integer;
  v_sources text[];
BEGIN
  SELECT * INTO v_cur FROM ro_shift WHERE phase = 'current';
  PERFORM pg_temp.ro_assert (current_setting('ro.adopted')::integer = 8, format('the generator''s re-run adopted %s of the 8 unowned current shift checks for the med tech who clocked in', current_setting('ro.adopted')));
  PERFORM pg_temp.ro_assert (current_setting('ro.readopted')::integer = 0, 'a further generator re-run adopted or re-assigned an owned check');
  PERFORM pg_temp.ro_assert (current_setting('ro.assigned')::integer = 8, format('the unowned pass assigned %s of the 8 remaining current shift checks to the med tech who clocked in', current_setting('ro.assigned')));
  PERFORM pg_temp.ro_assert (current_setting('ro.reassigned')::integer = 0, 'a second run of the unowned pass assigned something again');
  PERFORM pg_temp.ro_assert (current_setting('ro.service_resolve') = 'on_clock:' || (SELECT a_staff FROM ro), format('the resolver, called as service_role, answered %s rather than on_clock with the med tech who clocked in', current_setting('ro.service_resolve')));

  SELECT count(*) INTO v_bad
  FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.fac
  WHERE t.window_key IN ('probe_current', 'probe_current_b')
    AND (t.assigned_staff_id IS DISTINCT FROM ro.a_staff OR t.shift_assignment_id IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM public.resident_observation_assignments a WHERE a.task_id = t.id AND a.staff_id = ro.a_staff
        AND a.assignment_type = 'primary' AND a.released_at IS NULL AND a.shift_assignment_id IS NULL));
  PERFORM pg_temp.ro_assert (v_bad = 0, format('%s of 16 current shift checks are not owned by the on-clock med tech with a primary assignment row', v_bad));

  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.fac WHERE t.window_key = 'probe_next' AND t.assigned_staff_id IS NOT NULL), 'the shift on the clock was given the incoming shift''s checks');
  SELECT array_agg(DISTINCT a.assignment_source) INTO v_sources
  FROM ro, ro_shift s, public.resolve_observation_task_assignees (ro.fac, s.shift_service_date, s.roster_shift_type::text, ARRAY (SELECT r.id FROM public.residents r WHERE r.facility_id = ro.fac)) a
  WHERE s.phase = 'next';
  PERFORM pg_temp.ro_assert (v_sources = ARRAY['awaiting_clock_in'], format('with a med tech on the clock now, the incoming shift must still resolve awaiting_clock_in, got %s', v_sources));

  -- The gap raised on the first tick is resolved now that Alpha is on the
  -- clock, once, with a note; and it is not raised again.
  PERFORM pg_temp.ro_assert (public.resolve_observation_staffing_gap ((SELECT fac FROM ro), v_cur.shift_key, v_cur.shift_service_date) = TRUE, 'the open gap alert was not resolved once a med tech was on the clock');
  PERFORM pg_temp.ro_assert (EXISTS (SELECT 1 FROM public.exec_alerts e JOIN ro ON e.facility_id = ro.fac
    WHERE e.title = haven.observation_staffing_gap_title (ro.fac, v_cur.shift_key, v_cur.shift_service_date)
      AND e.resolved_at IS NOT NULL AND e.status = 'resolved' AND e.current_value_json ->> 'resolved_reason' = 'on_clock_staff'
      AND e.current_value_json ->> 'resolution_note' IS NOT NULL), 'the resolved gap alert carries no resolved_at, status or note');
  PERFORM pg_temp.ro_assert (public.resolve_observation_staffing_gap ((SELECT fac FROM ro), v_cur.shift_key, v_cur.shift_service_date) = FALSE, 'the gap alert was resolved twice');
  PERFORM pg_temp.ro_assert (public.record_observation_staffing_gap ((SELECT fac FROM ro), v_cur.shift_key, v_cur.shift_service_date) = FALSE, 'the staffing gap was raised while a med tech is on the clock');
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM public.exec_alerts e JOIN ro ON e.facility_id = ro.fac WHERE e.resolved_at IS NULL), 'an exec alert is open for a shift with a med tech on the clock');
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Probe Mike clocks in and goes on a meal break. A person on a meal break is
--    on shift: the ring now holds Alpha and Mike. A re-run changes no owner
--    that was already written; new checks spread over both by the stable hash,
--    and the same question asked twice gets the same answer.
-- ---------------------------------------------------------------------------
-- Mike clocked in 20 minutes before the shift started (inside the default 30
-- minute lead) and is on a meal break half way between then and now.
INSERT INTO public.time_punches (organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
SELECT org, fac, m_staff, 'in', s.starts_at_utc - interval '20 minutes', gen_random_uuid() FROM ro, ro_shift s WHERE s.phase = 'current'
UNION ALL
SELECT org, fac, m_staff, 'meal_start', s.starts_at_utc - interval '20 minutes' + (now() - s.starts_at_utc + interval '20 minutes') / 2, gen_random_uuid() FROM ro, ro_shift s WHERE s.phase = 'current';

DO $$
DECLARE
  v_cur record;
  v_owners uuid[];
  v_first jsonb;
  v_second jsonb;
BEGIN
  SELECT * INTO v_cur FROM ro_shift WHERE phase = 'current';

  PERFORM pg_temp.ro_assert (public.assign_unowned_observation_tasks ((SELECT fac FROM ro), now()) = 0, 'a re-run after the clock changed touched an owned check');
  PERFORM pg_temp.ro_assert (pg_temp.ro_generate ('current', 'probe_current', now() + (v_cur.ends_at_utc - now()) / 2) = 0, 'a generator re-run after the clock changed re-assigned an owned check');
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.fac WHERE t.window_key IN ('probe_current', 'probe_current_b') AND t.assigned_staff_id IS DISTINCT FROM ro.a_staff), 'an owned check changed owner when somebody else clocked in');
  PERFORM pg_temp.ro_assert ((SELECT count(*) FROM public.resident_observation_assignments a JOIN public.resident_observation_tasks t ON t.id = a.task_id JOIN ro ON t.facility_id = ro.fac
    WHERE t.window_key IN ('probe_current', 'probe_current_b') AND a.released_at IS NULL) = 16, 'a re-run added or moved an assignment row on an owned check');

  SELECT jsonb_agg(to_jsonb(a) ORDER BY a.resident_id) INTO v_first
  FROM ro, public.resolve_observation_task_assignees (ro.fac, v_cur.shift_service_date, v_cur.roster_shift_type::text, ARRAY (SELECT r.id FROM public.residents r WHERE r.facility_id = ro.fac)) a;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY a.resident_id) INTO v_second
  FROM ro, public.resolve_observation_task_assignees (ro.fac, v_cur.shift_service_date, v_cur.roster_shift_type::text, ARRAY (SELECT r.id FROM public.residents r WHERE r.facility_id = ro.fac)) a;
  PERFORM pg_temp.ro_assert (v_first = v_second, 'the resolver is not stable: the same question answered differently');

  PERFORM pg_temp.ro_assert (pg_temp.ro_generate ('current', 'probe_current_2', now() + (v_cur.ends_at_utc - now()) / 3) = 8, 'the second current shift checks were not written');
  SELECT array_agg(DISTINCT t.assigned_staff_id ORDER BY t.assigned_staff_id) INTO v_owners
  FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.fac WHERE t.window_key = 'probe_current_2';
  PERFORM pg_temp.ro_assert (v_owners = (SELECT ARRAY(SELECT unnest(ARRAY[a_staff, m_staff]) ORDER BY 1) FROM ro), format('new checks should spread over exactly the two eligible people on the clock (Alpha, and Mike on a meal break); owners were %s', v_owners));
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.fac
    WHERE t.window_key = 'probe_current_2' AND NOT EXISTS (SELECT 1 FROM public.resident_observation_assignments a WHERE a.task_id = t.id AND a.staff_id = t.assigned_staff_id AND a.released_at IS NULL)), 'a generated on_clock check has no primary assignment row');
END
$$;

-- ---------------------------------------------------------------------------
-- 5b. The owner roles are facility configuration. Probe Kilo, an administrator,
--     has been on the clock throughout and owned nothing under the default.
--     Naming facility_admin brings Kilo into the ring; the setting refuses an
--     empty list, a null, and any role that cannot complete every check.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM ro, haven.observation_on_clock_staff (ro.fac, now()) c WHERE c.staff_id = ro.k_staff), 'a punched-in administrator was counted as an owner under the med_tech default');
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.fac WHERE t.assigned_staff_id = ro.k_staff), 'a punched-in administrator was given a check under the med_tech default');
END
$$;

UPDATE public.timeclock_facility_settings SET rounding_owner_roles = ARRAY['med_tech', 'facility_admin']
WHERE facility_id = '0a820000-0000-4000-8000-000000000003';

DO $$
DECLARE
  v_owners uuid[];
  v_role text[];
  v_refused boolean;
BEGIN
  SELECT array_agg(c.staff_id ORDER BY c.staff_id) INTO v_owners FROM ro, haven.observation_on_clock_staff (ro.fac, now()) c;
  PERFORM pg_temp.ro_assert (v_owners = (SELECT ARRAY(SELECT unnest(ARRAY[a_staff, m_staff, k_staff]) ORDER BY 1) FROM ro), format('with facility_admin configured the on-clock owners should be Alpha, Mike and Kilo; got %s', v_owners));

  FOREACH v_role SLICE 1 IN ARRAY ARRAY[ARRAY['housekeeper', 'med_tech'], ARRAY['manager', 'med_tech'], ARRAY['nurse', 'med_tech'], ARRAY[NULL, 'med_tech']]::text[][] LOOP
    v_refused := false;
    BEGIN
      UPDATE public.timeclock_facility_settings SET rounding_owner_roles = v_role WHERE facility_id = (SELECT fac FROM ro);
    EXCEPTION WHEN check_violation THEN
      v_refused := true;
    END;
    PERFORM pg_temp.ro_assert (v_refused, format('rounding_owner_roles accepted %s', v_role));
  END LOOP;
  v_refused := false;
  BEGIN
    UPDATE public.timeclock_facility_settings SET rounding_owner_roles = ARRAY[]::text[] WHERE facility_id = (SELECT fac FROM ro);
  EXCEPTION WHEN check_violation THEN
    v_refused := true;
  END;
  PERFORM pg_temp.ro_assert (v_refused, 'rounding_owner_roles accepted an empty list');
END
$$;

UPDATE public.timeclock_facility_settings SET rounding_owner_roles = DEFAULT
WHERE facility_id = '0a820000-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- 6. A missed check names its on-clock owner. The building's own ladder
--    addresses its owner on every rung that includes the assigned staff
--    member, and the terminal rung marks it missed and keeps
--    assigned_staff_id and the assignment row.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_task uuid;
  v_close timestamptz;
  v_rung text;
  v_fired jsonb;
  v_rung_row record;
  v_owner_rungs integer := 0;
BEGIN
  SELECT t.id INTO v_task FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.fac
  WHERE t.window_key = 'probe_current' ORDER BY t.resident_id LIMIT 1;
  v_close := public.observation_task_window_close (v_task);
  SELECT r.rung_key INTO v_rung
  FROM ro, public.observation_escalation_rungs_at (ro.fac, v_close, (SELECT sw.shift_key FROM public.facility_shift_window_at (ro.fac, v_close) sw)) r
  WHERE r.is_terminal;
  PERFORM pg_temp.ro_assert (v_rung IS NOT NULL, 'the probe facility has no terminal escalation rung in force');

  FOR v_rung_row IN
    SELECT r.rung_key
    FROM ro, public.observation_escalation_rungs_at (ro.fac, v_close, (SELECT sw.shift_key FROM public.facility_shift_window_at (ro.fac, v_close) sw)) r
    WHERE NOT r.is_terminal AND (r.include_assigned_staff OR r.assigned_staff_only)
  LOOP
    v_fired := public.record_observation_escalation_rung (v_task, v_rung_row.rung_key, v_close + interval '1 hour');
    PERFORM pg_temp.ro_assert ((v_fired ->> 'fired')::boolean IS TRUE, format('rung %s did not fire for an owned check: %s', v_rung_row.rung_key, v_fired));
    PERFORM pg_temp.ro_assert (EXISTS (SELECT 1 FROM public.observation_escalation_deliveries d JOIN public.observation_escalation_dispatches x ON x.id = d.dispatch_id JOIN ro ON d.target_user_id = ro.a_user
      WHERE x.task_id = v_task AND x.rung_key = v_rung_row.rung_key), format('rung %s did not address the on-clock owner', v_rung_row.rung_key));
    v_owner_rungs := v_owner_rungs + 1;
  END LOOP;
  PERFORM pg_temp.ro_assert (v_owner_rungs > 0, 'the probe ladder has no rung that addresses the assigned staff member');

  v_fired := public.record_observation_escalation_rung (v_task, v_rung, v_close + interval '6 hours');
  PERFORM pg_temp.ro_assert ((v_fired ->> 'fired')::boolean IS NOT FALSE, format('the terminal rung did not fire: %s', v_fired));
  PERFORM pg_temp.ro_assert ((SELECT status::text FROM public.resident_observation_tasks WHERE id = v_task) = 'missed', 'the terminal rung did not mark the check missed');
  PERFORM pg_temp.ro_assert ((SELECT t.assigned_staff_id FROM public.resident_observation_tasks t WHERE t.id = v_task) = (SELECT a_staff FROM ro), 'a missed check lost the on-clock owner it was assigned to');
  PERFORM pg_temp.ro_assert (EXISTS (SELECT 1 FROM public.resident_observation_assignments a JOIN ro ON a.staff_id = ro.a_staff WHERE a.task_id = v_task AND a.released_at IS NULL), 'a missed check lost its primary assignment row');
  PERFORM pg_temp.ro_assert (EXISTS (SELECT 1 FROM public.observation_escalation_deliveries d JOIN public.observation_escalation_dispatches x ON x.id = d.dispatch_id JOIN ro ON d.target_user_id = ro.a_user
    WHERE x.task_id = v_task), 'the escalation ledger of the missed check never names its owner');
END
$$;

-- ---------------------------------------------------------------------------
-- 7. A building whose timeclock is off behaves as before: people on the clock
--    own nothing, and the incoming shift is a gap as soon as nobody is
--    scheduled for it.
-- ---------------------------------------------------------------------------
UPDATE public.timeclock_facility_settings SET timeclock_enabled = false
WHERE facility_id = '0a820000-0000-4000-8000-000000000003';

DO $$
DECLARE
  v_cur record;
  v_next record;
  v_sources text[];
BEGIN
  SELECT * INTO v_cur FROM ro_shift WHERE phase = 'current';
  SELECT * INTO v_next FROM ro_shift WHERE phase = 'next';
  SELECT array_agg(DISTINCT a.assignment_source) INTO v_sources
  FROM ro, public.resolve_observation_task_assignees (ro.fac, v_cur.shift_service_date, v_cur.roster_shift_type::text, ARRAY (SELECT r.id FROM public.residents r WHERE r.facility_id = ro.fac)) a;
  PERFORM pg_temp.ro_assert (v_sources = ARRAY['none_scheduled'], format('with the timeclock off, the shift in progress must resolve none_scheduled, got %s', v_sources));
  PERFORM pg_temp.ro_assert (public.record_observation_staffing_gap ((SELECT fac FROM ro), v_next.shift_key, v_next.shift_service_date) = TRUE, 'with the timeclock off, the incoming shift with nobody scheduled was not raised');
END
$$;

UPDATE public.timeclock_facility_settings SET timeclock_enabled = true
WHERE facility_id = '0a820000-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- 8. Everybody eligible clocks out. The shift in progress is a gap again, and
--    the alert is raised once.
-- ---------------------------------------------------------------------------
INSERT INTO public.time_punches (organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
SELECT org, fac, a_staff, 'out', now(), gen_random_uuid() FROM ro
UNION ALL
SELECT org, fac, m_staff, 'meal_end', now() - interval '1 minute', gen_random_uuid() FROM ro
UNION ALL
SELECT org, fac, m_staff, 'out', now(), gen_random_uuid() FROM ro;

DO $$
DECLARE
  v_cur record;
BEGIN
  SELECT * INTO v_cur FROM ro_shift WHERE phase = 'current';
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM ro, haven.observation_on_clock_staff (ro.fac, now())), 'somebody ineligible is still counted as on the clock');
  PERFORM pg_temp.ro_assert (public.record_observation_staffing_gap ((SELECT fac FROM ro), v_cur.shift_key, v_cur.shift_service_date) = TRUE, 'the staffing gap was not raised for the shift in progress with nobody scheduled and nobody on the clock');
  PERFORM pg_temp.ro_assert (public.record_observation_staffing_gap ((SELECT fac FROM ro), v_cur.shift_key, v_cur.shift_service_date) = FALSE, 'the staffing gap was raised twice');
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.fac WHERE t.window_key IN ('probe_current', 'probe_current_b', 'probe_current_2') AND t.assigned_staff_id IS NULL), 'clocking out took an owner away from a check');
END
$$;

-- ---------------------------------------------------------------------------
-- 9. Shift handoff, in its own building. Nightingale clocked in 45 minutes
--    before the shift in progress started (outside the default 30 minute
--    lead: the outgoing shift) and is still on the clock. Daybreak clocked in
--    10 minutes before it started. Daybreak owns the shift's checks and
--    Nightingale owns nothing; with Daybreak gone, Nightingale is the fallback.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.ro_assert (pg_temp.ro_generate_at ((SELECT hand_fac FROM ro), 'current', 'hand_a', (SELECT now() + (ends_at_utc - now()) / 2 FROM ro_shift WHERE phase = 'current')) = 4, 'the handoff building''s checks were not written');
END
$$;

INSERT INTO public.time_punches (organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
SELECT org, hand_fac, night_staff, 'in', s.starts_at_utc - interval '45 minutes', gen_random_uuid() FROM ro, ro_shift s WHERE s.phase = 'current';

DO $$
DECLARE
  v_cur record;
  v_answer text[];
BEGIN
  SELECT * INTO v_cur FROM ro_shift WHERE phase = 'current';
  SELECT array_agg(DISTINCT a.assignment_source || ':' || a.staff_id) INTO v_answer
  FROM ro, public.resolve_observation_task_assignees (ro.hand_fac, v_cur.shift_service_date, v_cur.roster_shift_type::text, ARRAY (SELECT r.id FROM public.residents r WHERE r.facility_id = ro.hand_fac)) a;
  PERFORM pg_temp.ro_assert (v_answer = (SELECT ARRAY['on_clock:' || night_staff] FROM ro), format('with only the outgoing tech on the clock, the fallback should give them the shift''s checks; got %s', v_answer));
END
$$;

INSERT INTO public.time_punches (organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
SELECT org, hand_fac, day_staff, 'in', s.starts_at_utc - interval '10 minutes', gen_random_uuid() FROM ro, ro_shift s WHERE s.phase = 'current';

DO $$
DECLARE
  v_cur record;
  v_answer text[];
  v_owners uuid[];
  v_refused boolean;
BEGIN
  SELECT * INTO v_cur FROM ro_shift WHERE phase = 'current';
  SELECT array_agg(DISTINCT a.assignment_source || ':' || a.staff_id) INTO v_answer
  FROM ro, public.resolve_observation_task_assignees (ro.hand_fac, v_cur.shift_service_date, v_cur.roster_shift_type::text, ARRAY (SELECT r.id FROM public.residents r WHERE r.facility_id = ro.hand_fac)) a;
  PERFORM pg_temp.ro_assert (v_answer = (SELECT ARRAY['on_clock:' || day_staff] FROM ro), format('the outgoing tech, still clocked in, was offered the incoming shift''s checks; got %s', v_answer));

  -- The first day tick through the real write path: every check goes to the
  -- incoming tech, none to the outgoing one.
  PERFORM pg_temp.ro_assert (pg_temp.ro_generate_at ((SELECT hand_fac FROM ro), 'current', 'hand_a', now() + (v_cur.ends_at_utc - now()) / 2) = 4, 'the handoff checks were not adopted');
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.hand_fac WHERE t.assigned_staff_id IS DISTINCT FROM ro.day_staff), 'a handoff check is not owned by the incoming tech');
  PERFORM pg_temp.ro_assert (public.assign_unowned_observation_tasks ((SELECT hand_fac FROM ro), now()) = 0, 'the unowned pass found something left at the handoff building');

  -- The lead time is configuration: at 60 minutes the outgoing tech counts as
  -- having clocked in for this shift too.
  UPDATE public.timeclock_facility_settings SET rounding_clock_in_lead_minutes = 60 WHERE facility_id = (SELECT hand_fac FROM ro);
  SELECT array_agg(o.staff_id ORDER BY o.staff_id) INTO v_owners FROM ro, haven.observation_shift_owner_staff (ro.hand_fac, now(), v_cur.starts_at_utc) o;
  PERFORM pg_temp.ro_assert (v_owners = (SELECT ARRAY(SELECT unnest(ARRAY[night_staff, day_staff]) ORDER BY 1) FROM ro), format('with a 60 minute lead both techs should count for the shift; got %s', v_owners));
  v_refused := false;
  BEGIN
    UPDATE public.timeclock_facility_settings SET rounding_clock_in_lead_minutes = 241 WHERE facility_id = (SELECT hand_fac FROM ro);
  EXCEPTION WHEN check_violation THEN
    v_refused := true;
  END;
  PERFORM pg_temp.ro_assert (v_refused, 'rounding_clock_in_lead_minutes accepted 241');
  v_refused := false;
  BEGIN
    UPDATE public.timeclock_facility_settings SET rounding_clock_in_lead_minutes = -1 WHERE facility_id = (SELECT hand_fac FROM ro);
  EXCEPTION WHEN check_violation THEN
    v_refused := true;
  END;
  PERFORM pg_temp.ro_assert (v_refused, 'rounding_clock_in_lead_minutes accepted -1');
  UPDATE public.timeclock_facility_settings SET rounding_clock_in_lead_minutes = DEFAULT WHERE facility_id = (SELECT hand_fac FROM ro);
END
$$;

-- Daybreak leaves; Nightingale is the only one on the clock.
INSERT INTO public.time_punches (organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
SELECT org, hand_fac, day_staff, 'out', now(), gen_random_uuid() FROM ro;

DO $$
DECLARE
  v_cur record;
BEGIN
  SELECT * INTO v_cur FROM ro_shift WHERE phase = 'current';
  PERFORM pg_temp.ro_assert (pg_temp.ro_generate_at ((SELECT hand_fac FROM ro), 'current', 'hand_b', now() + (v_cur.ends_at_utc - now()) / 3) = 4, 'the fallback checks were not written');
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.hand_fac WHERE t.window_key = 'hand_b' AND t.assigned_staff_id IS DISTINCT FROM ro.night_staff), 'with only the outgoing tech on the clock the fallback did not give them the new checks');
  PERFORM pg_temp.ro_assert (NOT EXISTS (SELECT 1 FROM public.resident_observation_tasks t JOIN ro ON t.facility_id = ro.hand_fac WHERE t.window_key = 'hand_a' AND t.assigned_staff_id IS DISTINCT FROM ro.day_staff), 'the incoming tech''s checks moved when they clocked out');
END
$$;

ROLLBACK;
