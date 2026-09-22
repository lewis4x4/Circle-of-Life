-- Cadence and escalation settings acceptance. Spec 25A acceptance items 15, 16,
-- 17, 18, 20 and 21, plus the activation invariant tested at the four points
-- decision D14 names rather than the one point acceptance 16 names.
--
-- Run it against any database that has every migration applied:
--
--   node scripts/smart-rounding/run-config-invariants-acceptance.mjs
--
-- or directly, against a replay you already have:
--
--   psql -d <replay> -v ON_ERROR_STOP=1 -f scripts/smart-rounding/config-invariants-acceptance.sql
--
-- Everything happens inside one transaction that rolls back, so the script is
-- safe to re-run and leaves nothing behind. All fixture data is synthetic: no
-- resident, no staff member and no facility here corresponds to a real one, and
-- nothing is selected or seeded by facility name.
--
-- The one jurisdiction floor this file writes is keyed ZZ_SYNTHETIC against a
-- state code that does not exist. It is a fixture for the floor check and not a
-- claim about any regulator. The shipped FL_AHCA row keeps its null values.
--
-- What this file is really for
-- -------------------------------------------------------------------------
-- Acceptance item 16 is the anti-rewrite check and it is the single most
-- important assertion in this build: a compliance report run for a date before
-- a cadence change has to recompute to the same numbers after the change. If it
-- does not, then changing the 10:00 window to 11:00 in March silently rewrites
-- February, and an inspector who pulls six months of observation records gets a
-- report computed against times that were never in force. Every other test here
-- exists to stop that one from breaking by a route nobody checked.

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE FUNCTION pg_temp.cfg_assert (ok boolean, msg text)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'config-invariants-acceptance FAILED: %', msg;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.cfg_sign_in (p_user uuid, p_session uuid)
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

-- The compliance answer, reduced to the numbers a surface renders, plus the per
-- window and per service date breakdown. Every anti-rewrite assertion compares
-- this for the same range before and after a change.
--
-- The breakdown is part of the comparison on purpose: a total that matches
-- while the per window distribution has shifted is exactly the failure an
-- aggregate only check would pass.
CREATE FUNCTION pg_temp.cfg_compliance (p_facility uuid, p_from date, p_to date)
  RETURNS jsonb
  LANGUAGE sql
  AS $$
  WITH rows AS (
    SELECT
      COALESCE(c.window_key, 'no_cadence') AS window_key,
      c.satisfied,
      c.expectation_source,
      c.service_date
    FROM
      public.observation_compliance_for_range (p_facility, p_from, p_to) c
)
  SELECT
    jsonb_build_object('expected', (
        SELECT
          count(*)
        FROM rows), 'satisfied', (
        SELECT
          count(*)
        FROM
          rows
        WHERE
          satisfied), 'unconfigured', (
        SELECT
          count(*)
        FROM
          rows
        WHERE
          expectation_source = 'no_cadence'), 'by_window', COALESCE((
          SELECT
            jsonb_object_agg (window_key, n
            ORDER BY window_key)
          FROM (
            SELECT
              window_key,
              count(*) AS n
            FROM
              rows
            GROUP BY
              window_key) g), '{}'::jsonb), 'by_service_date', COALESCE((
          SELECT
            jsonb_object_agg (service_date::text, n
            ORDER BY service_date::text)
          FROM (
            SELECT
              service_date,
              count(*) AS n
            FROM
              rows
            GROUP BY
              service_date) g), '{}'::jsonb));
$$;

CREATE TEMP TABLE cfg_result (
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
-- 1. Fixture
--
--    One synthetic organization, four synthetic buildings, all four configured
--    by copying the seeded cadence and escalation versions rather than by
--    restating a single time, grace value or offset. Three of the four take the
--    template fan out; the fourth carries the six hard block tests so those
--    cannot disturb the buildings the anti-rewrite check reads.
--
--    An organization administrator and a facility administrator, so the propose
--    and approve split is exercised by two real callers rather than asserted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000002';
  v_fac_a CONSTANT uuid := 'c7f60000-0000-4000-8000-00000000000a';
  v_fac_b CONSTANT uuid := 'c7f60000-0000-4000-8000-00000000000b';
  v_fac_c CONSTANT uuid := 'c7f60000-0000-4000-8000-00000000000c';
  v_fac_d CONSTANT uuid := 'c7f60000-0000-4000-8000-00000000000d';
  v_admin_user CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000011';
  v_fac_admin_user CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000012';
  v_aide_user CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000013';
  v_template CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000021';
  v_template_version CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000022';
  v_esc_template CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000023';
  v_esc_template_version CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000024';
  v_source_cadence uuid;
  v_source_escalation uuid;
  v_source_facility uuid;
  v_facility uuid;
  v_resident uuid;
  v_task uuid;
  v_cadence uuid;
  v_escalation uuid;
  v_day date;
  v_win record;
  v_i integer;
  v_key_satisfied text;
  v_key_late text;
BEGIN
  INSERT INTO public.organizations (id, name)
    VALUES (v_org, 'Synthetic Configuration Organization');
  INSERT INTO public.entities (id, organization_id, name)
    VALUES (v_entity, v_org, 'Synthetic Configuration Entity');

  -- Four buildings. Building D sits in a synthetic state so the jurisdiction
  -- floor fixture cannot reach the other three.
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, state, zip, total_licensed_beds, timezone)
    VALUES (v_fac_a, v_entity, v_org, 'Synthetic Configuration Building 1', '1 Synthetic Way', 'Synthetic City', 'FL', '00000', 20, 'America/New_York'),
    (v_fac_b, v_entity, v_org, 'Synthetic Configuration Building 2', '2 Synthetic Way', 'Synthetic City', 'FL', '00000', 20, 'America/New_York'),
    (v_fac_c, v_entity, v_org, 'Synthetic Configuration Building 3', '3 Synthetic Way', 'Synthetic City', 'FL', '00000', 20, 'America/New_York'),
    (v_fac_d, v_entity, v_org, 'Synthetic Configuration Building 4', '4 Synthetic Way', 'Synthetic City', 'ZZ', '00000', 20, 'America/New_York');

  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, ROLE, created_at, updated_at, confirmation_token)
    VALUES (v_admin_user, '00000000-0000-0000-0000-000000000000', 'synthetic-cfg-org-admin@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), ''),
    (v_fac_admin_user, '00000000-0000-0000-0000-000000000000', 'synthetic-cfg-fac-admin@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), ''),
    (v_aide_user, '00000000-0000-0000-0000-000000000000', 'synthetic-cfg-aide@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), '');

  INSERT INTO auth.sessions (id, user_id)
    VALUES ('c7f60000-0000-4000-8000-000000000031', v_admin_user),
    ('c7f60000-0000-4000-8000-000000000032', v_fac_admin_user),
    ('c7f60000-0000-4000-8000-000000000033', v_aide_user);

  INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role, is_active, phone)
    VALUES (v_admin_user, v_org, 'synthetic-cfg-org-admin@haven.test', 'Synthetic Organization Administrator', 'org_admin', TRUE, '+15550000101'),
    (v_fac_admin_user, v_org, 'synthetic-cfg-fac-admin@haven.test', 'Synthetic Facility Administrator', 'facility_admin', TRUE, '+15550000102'),
    (v_aide_user, v_org, 'synthetic-cfg-aide@haven.test', 'Synthetic Resident Aide', 'med_tech', TRUE, '+15550000103');

  INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
  SELECT
    u.user_id,
    f.facility_id,
    v_org,
    f.facility_id = v_fac_a
  FROM (
    VALUES (v_admin_user), (v_fac_admin_user), (v_aide_user)) AS u (user_id)
    CROSS JOIN (
      VALUES (v_fac_a), (v_fac_b), (v_fac_c), (v_fac_d)) AS f (facility_id);

  INSERT INTO public.staff (facility_id, organization_id, first_name, last_name, staff_role, hire_date, user_id, phone)
    VALUES (v_fac_a, v_org, 'Synthetic', 'Administrator', 'administrator', current_date, v_fac_admin_user, '+15550000102'),
    (v_fac_a, v_org, 'Synthetic', 'Aide', 'resident_aide', current_date, v_aide_user, '+15550000103');

  -- Every building carries the two roles the seeded ladder targets, so the zero
  -- holder warning is exercised deliberately in the validation tests below
  -- rather than firing incidentally on every activation in this file.
  INSERT INTO public.staff (facility_id, organization_id, first_name, last_name, staff_role, hire_date)
  SELECT
    f.facility_id,
    v_org,
    'Synthetic',
    'Staff',
    r.staff_role,
    current_date
  FROM (
    VALUES (v_fac_a), (v_fac_b), (v_fac_c), (v_fac_d)) AS f (facility_id)
    CROSS JOIN (
      VALUES ('administrator'::public.staff_role), ('assistant_administrator'::public.staff_role)) AS r (staff_role);

  INSERT INTO public.notification_routes (organization_id, facility_id, name, channels, staff_role_targets, is_active)
    VALUES (v_org, v_fac_a, 'Synthetic standing alert audience', ARRAY['in_app'], ARRAY['administrator']::public.staff_role[], TRUE);

  -- The configuration every synthetic building inherits, read out of the seed
  -- rather than restated. Nothing in this file names a time.
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
    v.created_at,
    v.id
  LIMIT 1;
  PERFORM
    pg_temp.cfg_assert (v_source_cadence IS NOT NULL, 'the seeded cadence version from migration 417 is missing');

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
    pg_temp.cfg_assert (v_source_escalation IS NOT NULL, 'the seeded escalation version from migration 420 is missing');

  FOREACH v_facility IN ARRAY ARRAY[v_fac_a, v_fac_b, v_fac_c, v_fac_d] LOOP
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
      s.facility_id = v_source_facility
      AND s.deleted_at IS NULL;

    INSERT INTO public.facility_cadence_versions (organization_id, facility_id, version_number, status, effective_from, change_reason, activated_at)
      VALUES (v_org, v_facility, 1, 'active', date_trunc('day', now() - interval '60 days'), 'Synthetic acceptance fixture', now() - interval '60 days')
    RETURNING
      id INTO v_cadence;

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
      w.cadence_version_id = v_source_cadence
      AND w.deleted_at IS NULL;

    INSERT INTO public.facility_escalation_versions (organization_id, facility_id, version_number, status, effective_from, change_reason, activated_at)
      VALUES (v_org, v_facility, 1, 'active', date_trunc('day', now() - interval '60 days'), 'Synthetic acceptance fixture', now() - interval '60 days')
    RETURNING
      id INTO v_escalation;

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
      r.escalation_version_id = v_source_escalation
      AND r.deleted_at IS NULL;

    -- ON CONFLICT because a facility arrives with a thresholds row now:
    -- migration 431 put an AFTER INSERT trigger on public.facilities that
    -- seeds one, which is what closed the gap where a building created after
    -- the thresholds table existed had none at all. This fixture wants the
    -- source building's values specifically, so it overwrites rather than
    -- skipping.
    INSERT INTO public.facility_observation_thresholds (organization_id, facility_id, maximum_unobserved_gap_minutes, maximum_windows_per_resident_per_day, simulation_lookback_days, change_log_page_size)
    SELECT
      v_org,
      v_facility,
      t.maximum_unobserved_gap_minutes,
      t.maximum_windows_per_resident_per_day,
      t.simulation_lookback_days,
      t.change_log_page_size
    FROM
      public.facility_observation_thresholds t
    WHERE
      t.facility_id = v_source_facility
      AND t.deleted_at IS NULL
    ON CONFLICT (facility_id)
      DO UPDATE SET
        maximum_unobserved_gap_minutes = EXCLUDED.maximum_unobserved_gap_minutes,
        maximum_windows_per_resident_per_day = EXCLUDED.maximum_windows_per_resident_per_day,
        simulation_lookback_days = EXCLUDED.simulation_lookback_days,
        change_log_page_size = EXCLUDED.change_log_page_size;
  END LOOP;

  -- One organization template per kind, inherited from building 1's windows and
  -- rungs, so applying it to buildings 2 and 3 is a real fan out of a real
  -- template rather than a copy of a copy.
  INSERT INTO public.cadence_templates (id, organization_id, template_key, name, description)
    VALUES (v_template, v_org, 'synthetic_standard', 'Synthetic Standard', 'Synthetic acceptance fixture template');
  INSERT INTO public.cadence_template_versions (id, organization_id, cadence_template_id, version_number, status, change_reason, activated_at)
    VALUES (v_template_version, v_org, v_template, 1, 'active', 'Synthetic acceptance fixture', now());
  INSERT INTO public.cadence_template_windows (organization_id, cadence_template_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
  SELECT
    v_org,
    v_template_version,
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
    JOIN public.facility_cadence_versions v ON v.id = w.cadence_version_id
  WHERE
    v.facility_id = v_fac_a
    AND v.version_number = 1
    AND w.deleted_at IS NULL;

  INSERT INTO public.escalation_templates (id, organization_id, template_key, name, description)
    VALUES (v_esc_template, v_org, 'synthetic_ladder', 'Synthetic Ladder', 'Synthetic acceptance fixture template');
  INSERT INTO public.escalation_template_versions (id, organization_id, escalation_template_id, version_number, status, change_reason, activated_at)
    VALUES (v_esc_template_version, v_org, v_esc_template, 1, 'active', 'Synthetic acceptance fixture', now());
  INSERT INTO public.escalation_template_rungs (organization_id, escalation_template_version_id, rung_key, label, offset_minutes, is_terminal, assigned_staff_only, include_assigned_staff, use_standing_alert_routes, target_staff_roles, channels, protocol_text, sort_order, enabled)
  SELECT
    v_org,
    v_esc_template_version,
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
    JOIN public.facility_escalation_versions v ON v.id = r.escalation_version_id
  WHERE
    v.facility_id = v_fac_a
    AND v.version_number = 1
    AND r.deleted_at IS NULL;

  -- Buildings 1, 2 and 3 start on the templates. Building 4 is custom and stays
  -- custom.
  INSERT INTO public.facility_config_template_bindings (organization_id, facility_id, cadence_template_id, escalation_template_id, cadence_bound_at, escalation_bound_at)
    VALUES (v_org, v_fac_a, v_template, v_esc_template, now(), now()),
    (v_org, v_fac_b, v_template, v_esc_template, now(), now()),
    (v_org, v_fac_c, v_template, v_esc_template, now(), now());

  -- Two residents in building 1, admitted well before the report period, so the
  -- compliance read has real resident days to answer about.
  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender, admission_date)
    VALUES ('c7f60000-0000-4000-8000-000000000041', v_fac_a, v_org, 'Occupant', 'Synthetic', 'active', 'prefer_not_to_say', (now() - interval '90 days')::date),
    ('c7f60000-0000-4000-8000-000000000042', v_fac_a, v_org, 'Second', 'Synthetic', 'active', 'prefer_not_to_say', (now() - interval '90 days')::date);

  -- Tasks and logs across the last eight complete days, so both the compliance
  -- read and the replay have something to score. Every task is generated from
  -- the window projector, so no time is written here either.
  --
  -- The pattern is deliberate rather than random: the first window of the
  -- version's own order is observed inside its span, the second is observed one
  -- minute before its span shuts, and the rest are never observed at all. That
  -- gives the replay satisfied windows, a window satisfied only just in time,
  -- and missed windows, without this file naming a single clock time.
  --
  -- The two windows are chosen by the version's sort order and named by key, not
  -- by their position in the projection. The projection for a service date comes
  -- back with the overnight window first, because 02:00 is the earliest instant
  -- on that date, so a positional pick lands on a different window than the one
  -- a later test then tries to move.
  SELECT
    v.id INTO v_cadence
  FROM
    public.facility_cadence_versions v
  WHERE
    v.facility_id = v_fac_a
    AND v.version_number = 1;

  SELECT
    w.window_key INTO v_key_satisfied
  FROM
    public.facility_cadence_windows w
  WHERE
    w.cadence_version_id = v_cadence
    AND w.deleted_at IS NULL
    AND w.enabled
  ORDER BY
    w.sort_order
  LIMIT 1;

  SELECT
    w.window_key INTO v_key_late
  FROM
    public.facility_cadence_windows w
  WHERE
    w.cadence_version_id = v_cadence
    AND w.deleted_at IS NULL
    AND w.enabled
  ORDER BY
    w.sort_order OFFSET 1
  LIMIT 1;

  FOR v_i IN 1..8 LOOP
    v_day := ((now() AT TIME ZONE 'America/New_York')::date - v_i);
    FOREACH v_resident IN ARRAY ARRAY['c7f60000-0000-4000-8000-000000000041'::uuid, 'c7f60000-0000-4000-8000-000000000042'::uuid] LOOP
      FOR v_win IN
      SELECT
        row_number() OVER (ORDER BY w.due_at_utc) AS n,
        w.*
      FROM
        public.facility_observation_windows_for_version (v_fac_a, v_cadence, v_day) w LOOP
          INSERT INTO public.resident_observation_tasks (organization_id, entity_id, facility_id, resident_id, cadence_version_id, window_key, service_date, scheduled_for, due_at, grace_ends_at, status)
            VALUES (v_org, v_entity, v_fac_a, v_resident, v_cadence, v_win.window_key, v_day, v_win.window_opens_at_utc, v_win.due_at_utc, v_win.window_closes_at_utc, CASE WHEN v_win.window_key IN (v_key_satisfied, v_key_late) THEN
                'completed_on_time'::public.resident_observation_task_status
              ELSE
                'missed'::public.resident_observation_task_status
              END)
          RETURNING
            id INTO v_task;

          IF v_win.window_key = v_key_satisfied THEN
            INSERT INTO public.resident_observation_logs (organization_id, entity_id, facility_id, resident_id, task_id, staff_id, observed_at, quick_status, resident_location, resident_state, entry_mode)
              VALUES (v_org, v_entity, v_fac_a, v_resident, v_task, (
                  SELECT
                    s.id
                  FROM
                    public.staff s
                  WHERE
                    s.facility_id = v_fac_a
                    AND s.staff_role = 'resident_aide'
                  LIMIT 1), v_win.due_at_utc, 'calm', 'bedroom', 'resting_in_bed', 'live');
          ELSIF v_win.window_key = v_key_late THEN
            -- Observed one minute before the span shuts. Under the schedule
            -- in force it counts; move the window and it stops counting, which
            -- is what lets the simulation test prove the two sides of the
            -- comparison are computed separately.
            INSERT INTO public.resident_observation_logs (organization_id, entity_id, facility_id, resident_id, task_id, staff_id, observed_at, quick_status, resident_location, resident_state, entry_mode, late_reason)
              VALUES (v_org, v_entity, v_fac_a, v_resident, v_task, (
                  SELECT
                    s.id
                  FROM
                    public.staff s
                  WHERE
                    s.facility_id = v_fac_a
                    AND s.staff_role = 'resident_aide'
                  LIMIT 1), v_win.window_closes_at_utc - interval '1 minute', 'calm', 'bedroom', 'resting_in_bed', 'late', 'Synthetic late entry');
          END IF;
        END LOOP;
    END LOOP;
  END LOOP;

  INSERT INTO cfg_result (check_name, detail)
    VALUES ('fixture', format('4 synthetic buildings configured by inheriting the seeded cadence and ladder, 2 residents, %s tasks and %s observations across 8 complete days, 1 cadence template and 1 escalation template with 3 buildings on them', (
          SELECT
            count(*)
          FROM
            public.resident_observation_tasks t
          WHERE
            t.facility_id = v_fac_a), (
          SELECT
            count(*)
          FROM
            public.resident_observation_logs l
          WHERE
            l.facility_id = v_fac_a)));
END
$$;

-- This synthetic fixture describes configuration already in force before today.
UPDATE public.facility_observation_shift_history SET effective_from='-infinity'::timestamptz
WHERE created_at=transaction_timestamp() AND effective_to IS NULL;


-- Strip the service dates at or after a cutoff, so a spanning report can be
-- compared on the part of it that is already history.
CREATE FUNCTION pg_temp.cfg_past_only (p_report jsonb, p_before date)
  RETURNS jsonb
  LANGUAGE sql
  AS $$
  SELECT
    COALESCE(jsonb_object_agg (key, value
      ORDER BY key), '{}'::jsonb)
  FROM
    jsonb_each(p_report -> 'by_service_date')
  WHERE
    key::date < p_before;
$$;

-- Every terminal task and every escalation row, as one value. A configuration
-- change may not move any of it, under any of the three effective timing
-- options, and comparing the whole set is the only way to know.
CREATE FUNCTION pg_temp.cfg_settled_work (p_facility uuid)
  RETURNS jsonb
  LANGUAGE sql
  AS $$
  SELECT
    jsonb_build_object('tasks', COALESCE((
        SELECT
          jsonb_agg (jsonb_build_object('id', t.id, 'status', t.status, 'deleted_at', t.deleted_at, 'due_at', t.due_at, 'cadence_version_id', t.cadence_version_id, 'completed_log_id', t.completed_log_id)
          ORDER BY t.id)
      FROM public.resident_observation_tasks t
      WHERE
        t.facility_id = p_facility
        AND t.status IN ('completed_on_time', 'completed_late', 'missed', 'excused', 'reassigned')), '[]'::jsonb), 'escalations', COALESCE((
        SELECT
          jsonb_agg (jsonb_build_object('id', e.id, 'status', e.status, 'escalation_level', e.escalation_level, 'rung_key', e.rung_key, 'escalation_version_id', e.escalation_version_id, 'triggered_at', e.triggered_at)
          ORDER BY e.id)
      FROM public.resident_observation_escalations e
      WHERE
        e.facility_id = p_facility), '[]'::jsonb), 'logs', COALESCE((
        SELECT
          jsonb_agg (jsonb_build_object('id', l.id, 'observed_at', l.observed_at, 'task_id', l.task_id)
          ORDER BY l.id)
      FROM public.resident_observation_logs l
      WHERE
        l.facility_id = p_facility), '[]'::jsonb));
$$;

-- The window set of one version, so "the same window set" is a comparison and
-- not an assertion.
CREATE FUNCTION pg_temp.cfg_window_set (p_cadence_version_id uuid)
  RETURNS jsonb
  LANGUAGE sql
  AS $$
  SELECT
    COALESCE(jsonb_agg (jsonb_build_object('window_key', w.window_key, 'label', w.label, 'due_at_local', to_char(w.due_at_local, 'HH24:MI'), 'grace_before_minutes', w.grace_before_minutes, 'grace_after_minutes', w.grace_after_minutes, 'shift_key', w.shift_key, 'enabled', w.enabled)
      ORDER BY w.window_key), '[]'::jsonb)
  FROM
    public.facility_cadence_windows w
  WHERE
    w.cadence_version_id = p_cadence_version_id
    AND w.deleted_at IS NULL;
$$;

-- The windows of the version in force, as the JSON payload the settings surface
-- would send back with one field edited. Read from the rows, so this file names
-- no observation time and no grace value.
CREATE FUNCTION pg_temp.cfg_window_payload (p_cadence_version_id uuid)
  RETURNS jsonb
  LANGUAGE sql
  AS $$
  SELECT
    COALESCE(jsonb_agg (jsonb_build_object('window_key', w.window_key, 'label', w.label, 'due_at_local', to_char(w.due_at_local, 'HH24:MI'), 'grace_before_minutes', w.grace_before_minutes, 'grace_after_minutes', w.grace_after_minutes, 'shift_key', w.shift_key, 'sort_order', w.sort_order, 'enabled', w.enabled)
      ORDER BY w.sort_order, w.due_at_local), '[]'::jsonb)
  FROM
    public.facility_cadence_windows w
  WHERE
    w.cadence_version_id = p_cadence_version_id
    AND w.deleted_at IS NULL;
$$;

CREATE FUNCTION pg_temp.cfg_rung_payload (p_escalation_version_id uuid)
  RETURNS jsonb
  LANGUAGE sql
  AS $$
  SELECT
    COALESCE(jsonb_agg (jsonb_build_object('rung_key', r.rung_key, 'label', r.label, 'offset_minutes', r.offset_minutes, 'is_terminal', r.is_terminal, 'assigned_staff_only', r.assigned_staff_only, 'include_assigned_staff', r.include_assigned_staff, 'use_standing_alert_routes', r.use_standing_alert_routes, 'target_staff_roles', to_jsonb (r.target_staff_roles), 'channels', to_jsonb (r.channels), 'protocol_text', r.protocol_text, 'sort_order', r.sort_order, 'enabled', r.enabled)
      ORDER BY r.sort_order, r.rung_key), '[]'::jsonb)
  FROM
    public.facility_escalation_rungs r
  WHERE
    r.escalation_version_id = p_escalation_version_id
    AND r.deleted_at IS NULL;
$$;

-- Move one window later by the grace it already carries, which changes the
-- schedule without this file naming a time and without manufacturing an overlap.
CREATE FUNCTION pg_temp.cfg_shift_one_window (p_payload jsonb, p_window_key text)
  RETURNS jsonb
  LANGUAGE sql
  AS $$
  SELECT
    jsonb_agg (CASE WHEN w ->> 'window_key' = p_window_key THEN
        jsonb_set (w, '{due_at_local}', to_jsonb (to_char(((w ->> 'due_at_local')::time + make_interval(mins => (w ->> 'grace_after_minutes')::integer)), 'HH24:MI')))
      ELSE
        w
      END
      ORDER BY ordinality)
  FROM
    jsonb_array_elements(p_payload) WITH ORDINALITY AS t (w, ordinality);
$$;

-- ---------------------------------------------------------------------------
-- 2. Acceptance 15 and 16, and the activation invariant at all four of the
--    points decision D14 names.
--
--    Acceptance 15: activating a changed window creates a new
--    facility_cadence_versions row and leaves the prior version's effective_from
--    alone.
--
--    Recorded deviation from the spec's wording, on purpose. Acceptance 15 says
--    the prior version's effective_to is left untouched as well. It cannot be:
--    the active version is open ended, so its effective_to is null until
--    something closes it, and decision D14 requires the activation to close it
--    at exactly the instant the new version opens, in the same transaction.
--    Leaving it null would leave two versions covering the same instant, and
--    public.facility_cadence_in_force would answer from whichever sorted first.
--    What is asserted here is the invariant as D14 states it: effective_from
--    never moves, and effective_to closes exactly where the successor opens.
--
--    Acceptance 16 is the anti-rewrite check and it runs after every one of the
--    four activation routes, not only after the first.
-- ---------------------------------------------------------------------------
SELECT
  pg_temp.cfg_sign_in ('c7f60000-0000-4000-8000-000000000011', 'c7f60000-0000-4000-8000-000000000031');

DO $$
DECLARE
  v_org CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000001';
  v_facility CONSTANT uuid := 'c7f60000-0000-4000-8000-00000000000a';
  v_template CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000021';
  v_esc_template CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000023';
  v_name text;
  v_today date;
  v_from date;
  v_to date;
  v_span_to date;
  v_baseline jsonb;
  v_baseline_span jsonb;
  v_settled jsonb;
  v_after jsonb;
  v_v1 uuid;
  v_v1_from timestamptz;
  v_v1_to timestamptz;
  v_created jsonb;
  v_activated jsonb;
  v_new uuid;
  v_tick jsonb;
  v_effective timestamptz;
BEGIN
  PERFORM
    pg_temp.cfg_assert (haven.app_role ()::text = 'org_admin', 'the fixture caller should resolve as org_admin, got ' || COALESCE(haven.app_role ()::text, 'null'));

  SELECT
    f.name INTO v_name
  FROM
    public.facilities f
  WHERE
    f.id = v_facility;

  v_today := (now() AT TIME ZONE 'America/New_York')::date;
  v_from := v_today - 8;
  v_to := v_today - 1;
  v_span_to := v_today + 1;

  v_baseline := pg_temp.cfg_compliance (v_facility, v_from, v_to);
  v_baseline_span := pg_temp.cfg_compliance (v_facility, v_from, v_span_to);
  v_settled := pg_temp.cfg_settled_work (v_facility);

  PERFORM
    pg_temp.cfg_assert ((v_baseline ->> 'expected')::integer > 0, 'the baseline compliance report is empty, so the anti-rewrite check would pass against nothing');
  PERFORM
    pg_temp.cfg_assert ((v_baseline ->> 'satisfied')::integer > 0, 'the baseline compliance report has no satisfied windows, so an anti-rewrite failure could hide in a column of zeros');

  SELECT
    v.id,
    v.effective_from,
    v.effective_to INTO v_v1,
    v_v1_from,
    v_v1_to
  FROM
    public.facility_cadence_versions v
  WHERE
    v.facility_id = v_facility
    AND v.version_number = 1;

  -- ---- Acceptance 15: create does not touch the version in force -----------
  v_created := public.create_cadence_version (p_facility_id := v_facility, p_change_reason := 'Acceptance fixture: move one window later to prove a change creates a version rather than editing one.', p_windows := pg_temp.cfg_shift_one_window (pg_temp.cfg_window_payload (v_v1), 'mid_morning'));

  v_new := (v_created ->> 'cadence_version_id')::uuid;

  PERFORM
    pg_temp.cfg_assert (v_created ->> 'status' = 'draft', format('an org_admin proposal should land as draft, got %s', v_created ->> 'status'));
  PERFORM
    pg_temp.cfg_assert ((v_created ->> 'cadence_version_number')::integer = 2, format('the new cadence version should be number 2, got %s', v_created ->> 'cadence_version_number'));
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        v.effective_from = v_v1_from
        AND v.effective_to IS NOT DISTINCT FROM v_v1_to
        AND v.status = 'active'
      FROM public.facility_cadence_versions v
      WHERE
        v.id = v_v1), 'create_cadence_version mutated the version that was in force');
  PERFORM
    pg_temp.cfg_assert (pg_temp.cfg_compliance (v_facility, v_from, v_to) = v_baseline, 'proposing a change moved the compliance numbers before anything was activated');
  PERFORM
    pg_temp.cfg_assert (pg_temp.cfg_window_set (v_new) <> pg_temp.cfg_window_set (v_v1), 'the proposed version carries the same windows as the version in force, so nothing was actually changed');

  INSERT INTO cfg_result (check_name, detail)
    VALUES ('acceptance 15: a change creates a version', format('cadence version 2 created as draft with one window moved; version 1 keeps effective_from %s and effective_to %s and stays active', v_v1_from, COALESCE(v_v1_to::text, 'null')));

  -- ---- Invariant point 1: two adjacent versions, applied immediately -------
  v_activated := public.activate_cadence_version (p_change_reason := 'Acceptance fixture: apply immediately so the current board is rebuilt.', p_cadence_version_id := v_new, p_apply_mode := 'immediate', p_acknowledgment := v_name);

  v_effective := (v_activated -> 'cadence' ->> 'effective_from')::timestamptz;

  PERFORM
    pg_temp.cfg_assert ((v_activated ->> 'in_force')::boolean, 'an immediate apply did not put the version in force');
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        v.effective_from = v_v1_from
      FROM public.facility_cadence_versions v
      WHERE
        v.id = v_v1), 'activation moved the prior version effective_from');
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        v.effective_to = v_effective
        AND v.status = 'superseded'
      FROM public.facility_cadence_versions v
      WHERE
        v.id = v_v1), 'activation did not close the prior version effective_to at exactly the instant the new version opens');
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        v.status = 'active'
        AND v.effective_from = v_effective
        AND v.effective_to IS NULL
      FROM public.facility_cadence_versions v
      WHERE
        v.id = v_new), 'the activated version is not open ended and active');
  PERFORM
    pg_temp.cfg_assert (public.facility_cadence_in_force (v_facility, v_v1_from + interval '1 day') = v_v1, 'the version in force at a past instant is no longer version 1, so a past report would recompute against the wrong cadence');

  v_after := pg_temp.cfg_compliance (v_facility, v_from, v_to);
  PERFORM
    pg_temp.cfg_assert (v_after = v_baseline, format('ANTI-REWRITE FAILURE at two adjacent versions. before=%s after=%s', v_baseline, v_after));
  PERFORM
    pg_temp.cfg_assert (pg_temp.cfg_settled_work (v_facility) = v_settled, 'an immediate apply modified a completed task, a missed task, a log or an escalation');

  INSERT INTO cfg_result (check_name, detail)
    VALUES ('acceptance 16 point 1: two adjacent versions', format('immediate apply at %s; the same report over %s to %s returns expected=%s satisfied=%s unconfigured=%s before and after', v_effective, v_from, v_to, v_baseline ->> 'expected', v_baseline ->> 'satisfied', v_baseline ->> 'unconfigured'));

  -- ---- Invariant point 2: a scheduled version activating mid report period --
  v_created := public.create_cadence_version (p_facility_id := v_facility, p_change_reason := 'Acceptance fixture: a scheduled change that lands inside a report period.', p_windows := pg_temp.cfg_shift_one_window (pg_temp.cfg_window_payload (v_new), 'afternoon'));

  v_activated := public.activate_cadence_version (p_change_reason := 'Acceptance fixture: schedule it rather than apply it now.', p_cadence_version_id := (v_created ->> 'cadence_version_id')::uuid, p_apply_mode := 'scheduled', p_effective_from := now() + interval '2 hours', p_acknowledgment := v_name);

  PERFORM
    pg_temp.cfg_assert ((v_activated ->> 'scheduled')::boolean, 'a future dated change should be scheduled, not put in force immediately');
  PERFORM
    pg_temp.cfg_assert ((v_activated ->> 'in_force')::boolean IS FALSE, 'a future dated change claimed to be in force');
  PERFORM
    pg_temp.cfg_assert (public.facility_cadence_in_force (v_facility, now()) = v_new, 'a scheduled change displaced the version in force before its time');

  v_tick := public.activate_due_scheduled_config_versions (v_org, v_facility, now() + interval '3 hours');

  PERFORM
    pg_temp.cfg_assert ((v_tick ->> 'versions_activated')::integer = 1, format('the activator should have activated exactly one version, got %s with %s failures: %s', v_tick ->> 'versions_activated', v_tick ->> 'versions_failed', v_tick -> 'versions'));
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        v.status = 'superseded'
        AND v.effective_to = now() + interval '2 hours'
      FROM public.facility_cadence_versions v
      WHERE
        v.id = v_new), 'the activator did not close the outgoing version at the scheduled instant');

  v_after := pg_temp.cfg_compliance (v_facility, v_from, v_to);
  PERFORM
    pg_temp.cfg_assert (v_after = v_baseline, format('ANTI-REWRITE FAILURE after a scheduled activation. before=%s after=%s', v_baseline, v_after));
  PERFORM
    pg_temp.cfg_assert (pg_temp.cfg_past_only (pg_temp.cfg_compliance (v_facility, v_from, v_span_to), v_today) = pg_temp.cfg_past_only (v_baseline_span, v_today), 'a scheduled activation inside a report period rewrote the days before it');
  PERFORM
    pg_temp.cfg_assert (pg_temp.cfg_settled_work (v_facility) = v_settled, 'a scheduled activation modified a completed task, a missed task, a log or an escalation');

  v_new := (v_created ->> 'cadence_version_id')::uuid;

  INSERT INTO cfg_result (check_name, detail)
    VALUES ('acceptance 16 point 2: a scheduled version activating mid report period', format('scheduled for %s and activated by the tick; the report over %s to %s and the already past days of the report over %s to %s both recompute identically', now() + interval '2 hours', v_from, v_to, v_from, v_span_to));

  -- ---- Invariant point 3: a rollback ---------------------------------------
  v_activated := public.rollback_cadence_version (p_facility_id := v_facility, p_change_reason := 'Acceptance fixture: undo the window moves and go back to the original schedule.', p_restore_cadence_version_id := v_v1, p_apply_mode := 'scheduled', p_effective_from := now() + interval '4 hours', p_acknowledgment := v_name);

  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        v.effective_from = v_v1_from
        AND v.effective_to = v_effective
      FROM public.facility_cadence_versions v
      WHERE
        v.id = v_v1), 'the rollback rewrote the effective dates of the version it copied forward');
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        count(*)
      FROM
        public.facility_cadence_versions v
      WHERE
        v.facility_id = v_facility
        AND v.deleted_at IS NULL) = 4, 'the rollback deleted a version instead of copying one forward');

  v_tick := public.activate_due_scheduled_config_versions (v_org, v_facility, now() + interval '5 hours');
  PERFORM
    pg_temp.cfg_assert ((v_tick ->> 'versions_activated')::integer = 1, format('the rollback version should have activated on the tick, got %s: %s', v_tick ->> 'versions_activated', v_tick -> 'versions'));
  PERFORM
    pg_temp.cfg_assert (pg_temp.cfg_window_set (public.facility_cadence_in_force (v_facility, now() + interval '6 hours')) = pg_temp.cfg_window_set (v_v1), 'the rolled back version does not carry the window set it restored');

  v_after := pg_temp.cfg_compliance (v_facility, v_from, v_to);
  PERFORM
    pg_temp.cfg_assert (v_after = v_baseline, format('ANTI-REWRITE FAILURE after a rollback. before=%s after=%s', v_baseline, v_after));
  PERFORM
    pg_temp.cfg_assert (pg_temp.cfg_settled_work (v_facility) = v_settled, 'a rollback modified a completed task, a missed task, a log or an escalation');

  INSERT INTO cfg_result (check_name, detail)
    VALUES ('acceptance 16 point 3: a rollback', format('version 1 copied forward as version 4, effective %s; 4 versions on the record and none deleted; the same report recomputes identically', now() + interval '4 hours'));

  -- ---- Invariant point 4: a template applied to three facilities -----------
  v_activated := public.apply_template_to_facilities (p_facility_ids := ARRAY['c7f60000-0000-4000-8000-00000000000a'::uuid, 'c7f60000-0000-4000-8000-00000000000b'::uuid, 'c7f60000-0000-4000-8000-00000000000c'::uuid], p_change_reason := 'Acceptance fixture: push the organization template to three buildings.', p_cadence_template_id := v_template, p_escalation_template_id := v_esc_template, p_apply_mode := 'scheduled', p_effective_from := now() + interval '6 hours', p_acknowledgment := (
      SELECT
        t.name
      FROM
        public.cadence_templates t
      WHERE
        t.id = v_template));

  PERFORM
    pg_temp.cfg_assert ((v_activated ->> 'ok')::boolean, format('the template fan out reported failures: %s', v_activated -> 'facilities'));
  PERFORM
    pg_temp.cfg_assert ((v_activated ->> 'facilities_succeeded')::integer = 3, format('the template should have reached three buildings, reached %s', v_activated ->> 'facilities_succeeded'));

  v_tick := public.activate_due_scheduled_config_versions (v_org, NULL, now() + interval '7 hours');
  PERFORM
    pg_temp.cfg_assert ((v_tick ->> 'versions_activated')::integer = 6, format('three buildings times cadence and escalation is six versions to activate, got %s with %s failures: %s', v_tick ->> 'versions_activated', v_tick ->> 'versions_failed', v_tick -> 'versions'));

  v_after := pg_temp.cfg_compliance (v_facility, v_from, v_to);
  PERFORM
    pg_temp.cfg_assert (v_after = v_baseline, format('ANTI-REWRITE FAILURE after a template fan out. before=%s after=%s', v_baseline, v_after));
  PERFORM
    pg_temp.cfg_assert (pg_temp.cfg_settled_work (v_facility) = v_settled, 'a template fan out modified a completed task, a missed task, a log or an escalation');

  INSERT INTO cfg_result (check_name, detail)
    VALUES ('acceptance 16 point 4: a template applied to three buildings', format('six versions activated across three buildings, each effective %s; the same report at building 1 recomputes identically', now() + interval '6 hours'));
END
$$;

-- Edit one field on one window, reading the replacement out of the row so this
-- file still names no time and no grace value.
CREATE FUNCTION pg_temp.cfg_set_window_field (p_payload jsonb, p_window_key text, p_field text, p_value jsonb)
  RETURNS jsonb
  LANGUAGE sql
  AS $$
  SELECT
    jsonb_agg (CASE WHEN w ->> 'window_key' = p_window_key THEN
        jsonb_set (w, ARRAY[p_field], p_value)
      ELSE
        w
      END
      ORDER BY ordinality)
  FROM
    jsonb_array_elements(p_payload) WITH ORDINALITY AS t (w, ordinality);
$$;

CREATE FUNCTION pg_temp.cfg_set_rung_field (p_payload jsonb, p_rung_key text, p_field text, p_value jsonb)
  RETURNS jsonb
  LANGUAGE sql
  AS $$
  SELECT
    jsonb_agg (CASE WHEN r ->> 'rung_key' = p_rung_key THEN
        jsonb_set (r, ARRAY[p_field], p_value)
      ELSE
        r
      END
      ORDER BY ordinality)
  FROM
    jsonb_array_elements(p_payload) WITH ORDINALITY AS t (r, ordinality);
$$;

CREATE FUNCTION pg_temp.cfg_disable_shift (p_payload jsonb, p_shift_key text)
  RETURNS jsonb
  LANGUAGE sql
  AS $$
  SELECT
    jsonb_agg (CASE WHEN w ->> 'shift_key' = p_shift_key THEN
        jsonb_set (w, '{enabled}', 'false'::jsonb)
      ELSE
        w
      END
      ORDER BY ordinality)
  FROM
    jsonb_array_elements(p_payload) WITH ORDINALITY AS t (w, ordinality);
$$;

-- The codes a validation answered with, so "its own distinct error" is checked
-- as a set rather than by reading the first element and hoping.
CREATE FUNCTION pg_temp.cfg_block_codes (p_validation jsonb)
  RETURNS text[]
  LANGUAGE sql
  AS $$
  SELECT
    COALESCE(array_agg(DISTINCT b ->> 'code'), ARRAY[]::text[])
  FROM
    jsonb_array_elements(p_validation -> 'blocks') b;
$$;

-- ---------------------------------------------------------------------------
-- 3. Acceptance 17. Each of the six hard blocks in spec section 6.5 is rejected
--    with its own distinct error, and the refusal lives in the database rather
--    than only in the form.
--
--    Every case runs at building 4, which no other test in this file touches,
--    so a proposal that is deliberately broken cannot disturb the buildings the
--    anti-rewrite check reads.
--
--    Each case asserts three things: the validation reports exactly one block
--    code and no other, the message is the one written for that block, and
--    public.activate_cadence_version refuses with that same message. A block
--    enforced in the client only is a block an API call walks straight past.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'c7f60000-0000-4000-8000-00000000000d';
  v_name text;
  v_cadence uuid;
  v_escalation uuid;
  v_windows jsonb;
  v_rungs jsonb;
  v_created jsonb;
  v_validation jsonb;
  v_codes text[];
  v_message text;
  v_raised text;
  v_shift_start_window text;
  v_floor_minimum integer;
  v_detail text := '';
BEGIN
  SELECT
    f.name INTO v_name
  FROM
    public.facilities f
  WHERE
    f.id = v_facility;

  v_cadence := public.facility_cadence_in_force (v_facility, now());
  v_escalation := public.facility_escalation_in_force (v_facility, now());
  v_windows := pg_temp.cfg_window_payload (v_cadence);
  v_rungs := pg_temp.cfg_rung_payload (v_escalation);

  PERFORM
    pg_temp.cfg_assert (jsonb_array_length(public.validate_cadence_version (v_cadence, v_escalation) -> 'blocks') = 0, format('the configuration in force at building 4 does not validate, so every block test below would pass for the wrong reason: %s', public.validate_cadence_version (v_cadence, v_escalation) -> 'blocks'));

  -- ---- Block 1. Two enabled windows whose grace spans overlap -------------
  v_created := public.create_cadence_version (p_facility_id := v_facility, p_change_reason := 'Acceptance fixture: two windows on the same span.', p_windows := pg_temp.cfg_set_window_field (v_windows, 'afternoon', 'due_at_local', (
        SELECT
          to_jsonb (w ->> 'due_at_local')
        FROM
          jsonb_array_elements(v_windows) w
        WHERE
          w ->> 'window_key' = 'mid_morning')));

  v_validation := v_created -> 'validation';
  v_codes := pg_temp.cfg_block_codes (v_validation);
  PERFORM
    pg_temp.cfg_assert (v_codes = ARRAY['overlapping_grace_spans'], format('block 1 should report overlapping_grace_spans and nothing else, got %s: %s', v_codes, v_validation -> 'blocks'));
  v_message := v_validation -> 'blocks' -> 0 ->> 'message';
  v_detail := v_detail || format('1 overlapping_grace_spans: "%s"; ', v_message);

  BEGIN
    PERFORM
      public.activate_cadence_version (p_change_reason := 'Acceptance fixture: this must be refused.', p_cadence_version_id := (v_created ->> 'cadence_version_id')::uuid, p_apply_mode := 'immediate', p_acknowledgment := v_name);
    v_raised := NULL;
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := SQLERRM;
  END;
  PERFORM
    pg_temp.cfg_assert (v_raised = v_message, format('activation should have refused block 1 with its own message. expected "%s", raised "%s"', v_message, COALESCE(v_raised, 'nothing at all')));

  -- ---- Block 2. Zero enabled windows on a defined shift -------------------
  v_created := public.create_cadence_version (p_facility_id := v_facility, p_change_reason := 'Acceptance fixture: a shift with nothing on it.', p_windows := pg_temp.cfg_disable_shift (v_windows, 'night'));

  v_validation := v_created -> 'validation';
  v_codes := pg_temp.cfg_block_codes (v_validation);
  PERFORM
    pg_temp.cfg_assert (v_codes = ARRAY['shift_without_window'], format('block 2 should report shift_without_window and nothing else, got %s: %s', v_codes, v_validation -> 'blocks'));
  v_message := v_validation -> 'blocks' -> 0 ->> 'message';
  v_detail := v_detail || format('2 shift_without_window: "%s"; ', v_message);

  BEGIN
    PERFORM
      public.activate_cadence_version (p_change_reason := 'Acceptance fixture: this must be refused.', p_cadence_version_id := (v_created ->> 'cadence_version_id')::uuid, p_apply_mode := 'immediate', p_acknowledgment := v_name);
    v_raised := NULL;
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := SQLERRM;
  END;
  PERFORM
    pg_temp.cfg_assert (v_raised = v_message, format('activation should have refused block 2 with its own message. expected "%s", raised "%s"', v_message, COALESCE(v_raised, 'nothing at all')));

  -- ---- Block 3. Grace before a shift start --------------------------------
  --
  -- The window is found by matching a shift start time out of
  -- facility_shift_definitions, which is the same derivation the validation
  -- uses. Naming the window key outright would let the rule keep passing after
  -- a building moved its shift change, which is the defect this block exists
  -- to catch.
  SELECT
    w.window_key INTO v_shift_start_window
  FROM
    public.facility_cadence_windows w
    JOIN public.facility_shift_definitions s ON s.facility_id = v_facility
      AND s.deleted_at IS NULL
      AND s.active
      AND s.starts_at_local = w.due_at_local
  WHERE
    w.cadence_version_id = v_cadence
    AND w.deleted_at IS NULL
    AND w.enabled
  ORDER BY
    w.sort_order
  LIMIT 1;
  PERFORM
    pg_temp.cfg_assert (v_shift_start_window IS NOT NULL, 'no window is due at a shift start, so block 3 cannot be exercised');

  v_created := public.create_cadence_version (p_facility_id := v_facility, p_change_reason := 'Acceptance fixture: let the outgoing shift clear the incoming shift first look.', p_windows := pg_temp.cfg_set_window_field (v_windows, v_shift_start_window, 'grace_before_minutes', (
        SELECT
          to_jsonb ((w ->> 'grace_after_minutes')::integer)
        FROM
          jsonb_array_elements(v_windows) w
        WHERE
          w ->> 'window_key' = v_shift_start_window)));

  v_validation := v_created -> 'validation';
  v_codes := pg_temp.cfg_block_codes (v_validation);
  PERFORM
    pg_temp.cfg_assert (v_codes = ARRAY['shift_start_grace_before'], format('block 3 should report shift_start_grace_before and nothing else, got %s: %s', v_codes, v_validation -> 'blocks'));
  v_message := v_validation -> 'blocks' -> 0 ->> 'message';
  v_detail := v_detail || format('3 shift_start_grace_before: "%s"; ', v_message);

  BEGIN
    PERFORM
      public.activate_cadence_version (p_change_reason := 'Acceptance fixture: this must be refused.', p_cadence_version_id := (v_created ->> 'cadence_version_id')::uuid, p_apply_mode := 'immediate', p_acknowledgment := v_name);
    v_raised := NULL;
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := SQLERRM;
  END;
  PERFORM
    pg_temp.cfg_assert (v_raised = v_message, format('activation should have refused block 3 with its own message. expected "%s", raised "%s"', v_message, COALESCE(v_raised, 'nothing at all')));

  -- ---- Block 4. Rung offsets not strictly increasing ----------------------
  v_created := public.create_cadence_version (p_facility_id := v_facility, p_change_reason := 'Acceptance fixture: a ladder that does not climb.', p_escalation_rungs := pg_temp.cfg_set_rung_field (v_rungs, 'tier_2', 'offset_minutes', (
        SELECT
          to_jsonb ((r ->> 'offset_minutes')::integer)
        FROM
          jsonb_array_elements(v_rungs) r
        WHERE
          r ->> 'rung_key' = 'tier_1')));

  v_validation := v_created -> 'validation';
  v_codes := pg_temp.cfg_block_codes (v_validation);
  PERFORM
    pg_temp.cfg_assert (v_codes = ARRAY['rung_offsets_not_increasing'], format('block 4 should report rung_offsets_not_increasing and nothing else, got %s: %s', v_codes, v_validation -> 'blocks'));
  PERFORM
    pg_temp.cfg_assert (v_created ->> 'cadence_version_id' IS NULL, 'an escalation only proposal manufactured a cadence version identical to the one in force');
  v_message := v_validation -> 'blocks' -> 0 ->> 'message';
  v_detail := v_detail || format('4 rung_offsets_not_increasing: "%s"; ', v_message);

  BEGIN
    PERFORM
      public.activate_cadence_version (p_change_reason := 'Acceptance fixture: this must be refused.', p_escalation_version_id := (v_created ->> 'escalation_version_id')::uuid, p_apply_mode := 'immediate', p_acknowledgment := v_name);
    v_raised := NULL;
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := SQLERRM;
  END;
  PERFORM
    pg_temp.cfg_assert (v_raised = v_message, format('activation should have refused block 4 with its own message. expected "%s", raised "%s"', v_message, COALESCE(v_raised, 'nothing at all')));

  -- ---- Block 5. The terminal rung disabled --------------------------------
  v_created := public.create_cadence_version (p_facility_id := v_facility, p_change_reason := 'Acceptance fixture: turn the last rung off.', p_escalation_rungs := pg_temp.cfg_set_rung_field (v_rungs, 'tier_3', 'enabled', 'false'::jsonb));

  v_validation := v_created -> 'validation';
  v_codes := pg_temp.cfg_block_codes (v_validation);
  PERFORM
    pg_temp.cfg_assert (v_codes = ARRAY['terminal_rung_disabled'], format('block 5 should report terminal_rung_disabled and nothing else, got %s: %s', v_codes, v_validation -> 'blocks'));
  v_message := v_validation -> 'blocks' -> 0 ->> 'message';
  v_detail := v_detail || format('5 terminal_rung_disabled: "%s"; ', v_message);

  BEGIN
    PERFORM
      public.activate_cadence_version (p_change_reason := 'Acceptance fixture: this must be refused.', p_escalation_version_id := (v_created ->> 'escalation_version_id')::uuid, p_apply_mode := 'immediate', p_acknowledgment := v_name);
    v_raised := NULL;
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := SQLERRM;
  END;
  PERFORM
    pg_temp.cfg_assert (v_raised = v_message, format('activation should have refused block 5 with its own message. expected "%s", raised "%s"', v_message, COALESCE(v_raised, 'nothing at all')));

  -- ---- Block 6. Below the jurisdiction floor ------------------------------
  --
  -- The shipped FL_AHCA row has null values and passes, which is the point of
  -- decision 3 in migration 428 and of spec open item 6, so the floor check
  -- cannot be exercised against it without inventing a Florida number.
  --
  -- This fixture writes a floor keyed ZZ_SYNTHETIC against a state code that
  -- does not exist, and building 4 is the only building in it. It is a fixture
  -- for the check, not a claim about any regulator, and it is inserted here
  -- rather than at the top so the five blocks above are measured with no floor
  -- in play at all.
  SELECT
    (public.cadence_version_day_shape (v_cadence) ->> 'windows_per_day')::integer INTO v_floor_minimum;

  INSERT INTO public.jurisdiction_observation_floors (jurisdiction_key, label, state_code, minimum_windows_per_24h, citation_reference, floor_values_pending, effective_from)
    VALUES ('ZZ_SYNTHETIC', 'Synthetic acceptance regulator', 'ZZ', v_floor_minimum, 'Synthetic acceptance fixture, not a real citation', FALSE, current_date - 1);

  PERFORM
    pg_temp.cfg_assert ((public.facility_observation_jurisdiction_floor (v_facility) ->> 'minimum_windows_per_24h')::integer = v_floor_minimum, 'the synthetic floor did not resolve onto building 4');
  PERFORM
    pg_temp.cfg_assert ((public.facility_observation_jurisdiction_floor ('c7f60000-0000-4000-8000-00000000000a') ->> 'minimum_windows_per_24h') IS NULL, 'the shipped FL_AHCA floor has acquired a number; no verified Florida minimum exists and none may be invented');

  v_created := public.create_cadence_version (p_facility_id := v_facility, p_change_reason := 'Acceptance fixture: one fewer check per day than the regulator allows.', p_windows := pg_temp.cfg_set_window_field (v_windows, 'late_evening', 'enabled', 'false'::jsonb));

  v_validation := v_created -> 'validation';
  v_codes := pg_temp.cfg_block_codes (v_validation);
  PERFORM
    pg_temp.cfg_assert (v_codes = ARRAY['below_jurisdiction_floor'], format('block 6 should report below_jurisdiction_floor and nothing else, got %s: %s', v_codes, v_validation -> 'blocks'));
  v_message := v_validation -> 'blocks' -> 0 ->> 'message';
  v_detail := v_detail || format('6 below_jurisdiction_floor: "%s"', v_message);

  BEGIN
    PERFORM
      public.activate_cadence_version (p_change_reason := 'Acceptance fixture: this must be refused.', p_cadence_version_id := (v_created ->> 'cadence_version_id')::uuid, p_apply_mode := 'immediate', p_acknowledgment := v_name);
    v_raised := NULL;
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := SQLERRM;
  END;
  PERFORM
    pg_temp.cfg_assert (v_raised = v_message, format('activation should have refused block 6 with its own message. expected "%s", raised "%s"', v_message, COALESCE(v_raised, 'nothing at all')));

  -- Nothing broken was ever put in force.
  PERFORM
    pg_temp.cfg_assert (public.facility_cadence_in_force (v_facility, now()) = v_cadence, 'a refused proposal reached the building anyway');
  PERFORM
    pg_temp.cfg_assert (public.facility_escalation_in_force (v_facility, now()) = v_escalation, 'a refused escalation proposal reached the building anyway');

  INSERT INTO cfg_result (check_name, detail)
    VALUES ('acceptance 17: six hard blocks, six distinct errors', v_detail);
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Acceptance 18. public.simulate_cadence_change returns missed window and
--    per rung escalation counts for both the proposal and the configuration in
--    force, and it says out loud that it is a measurement and not a forecast.
--
--    Run as the facility administrator, because spec 6.12 puts simulate at
--    facility_admin and above while activation stays at org_admin. Proposing
--    from this caller also lands the version as pending_approval, which is the
--    propose and approve split working rather than asserted.
-- ---------------------------------------------------------------------------
SELECT
  pg_temp.cfg_sign_in ('c7f60000-0000-4000-8000-000000000012', 'c7f60000-0000-4000-8000-000000000032');

DO $$
DECLARE
  v_facility CONSTANT uuid := 'c7f60000-0000-4000-8000-00000000000a';
  v_cadence uuid;
  v_created jsonb;
  v_sim jsonb;
  v_rungs_in_force integer;
  v_rungs_proposed integer;
BEGIN
  PERFORM
    pg_temp.cfg_assert (haven.app_role ()::text = 'facility_admin', 'the simulation caller should resolve as facility_admin, got ' || COALESCE(haven.app_role ()::text, 'null'));

  v_cadence := public.facility_cadence_in_force (v_facility, now() + interval '8 hours');

  -- Moved by two grace steps rather than one, so the span no longer contains
  -- the late observation the fixture recorded. A proposal that leaves every
  -- number identical would let the two sides of the comparison be the same
  -- value printed twice and read as agreement.
  v_created := public.create_cadence_version (p_facility_id := v_facility, p_change_reason := 'Acceptance fixture: what would a later mid morning check have cost us?', p_windows := pg_temp.cfg_shift_one_window (pg_temp.cfg_shift_one_window (pg_temp.cfg_window_payload (v_cadence), 'mid_morning'), 'mid_morning'));

  PERFORM
    pg_temp.cfg_assert (v_created ->> 'status' = 'pending_approval', format('a facility_admin proposal should land as pending_approval, got %s', v_created ->> 'status'));

  v_sim := public.simulate_cadence_change (p_facility_id := v_facility, p_proposed_cadence_version_id := (v_created ->> 'cadence_version_id')::uuid);

  PERFORM
    pg_temp.cfg_assert ((v_sim ->> 'is_measurement_not_forecast')::boolean, 'the simulation does not carry the flag that stops a surface rendering it as a prediction');
  PERFORM
    pg_temp.cfg_assert (length(v_sim ->> 'measurement_note') > 0, 'the simulation carries no sentence saying it measures the past');
  PERFORM
    pg_temp.cfg_assert ((v_sim ->> 'lookback_days')::integer > 0, 'the simulation lookback did not resolve from the facility row');

  PERFORM
    pg_temp.cfg_assert ((v_sim -> 'in_force' ->> 'windows_generated')::integer > 0, 'the in force side of the simulation generated no windows');
  PERFORM
    pg_temp.cfg_assert ((v_sim -> 'proposed' ->> 'windows_generated')::integer > 0, 'the proposed side of the simulation generated no windows');
  PERFORM
    pg_temp.cfg_assert ((v_sim -> 'in_force' ->> 'would_be_missed')::integer > 0, 'the in force side reports no missed windows, so a missed count regression could not show');
  PERFORM
    pg_temp.cfg_assert ((v_sim -> 'in_force' ->> 'would_be_satisfied')::integer > 0, 'the in force side reports nothing satisfied, so the replay is not reading the observations');
  PERFORM
    pg_temp.cfg_assert (jsonb_array_length(v_sim -> 'in_force' -> 'missed_by_shift') > 1, 'missed windows are not broken down by shift');

  SELECT
    count(*) INTO v_rungs_in_force
  FROM
    jsonb_array_elements(v_sim -> 'in_force' -> 'escalations_by_rung');
  SELECT
    count(*) INTO v_rungs_proposed
  FROM
    jsonb_array_elements(v_sim -> 'proposed' -> 'escalations_by_rung');

  PERFORM
    pg_temp.cfg_assert (v_rungs_in_force > 0 AND v_rungs_proposed > 0, format('the simulation should report escalations per rung for both configurations, got %s and %s', v_rungs_in_force, v_rungs_proposed));
  PERFORM
    pg_temp.cfg_assert ((v_sim -> 'in_force' ->> 'escalations_total')::integer > 0, 'no rung would have fired on the in force configuration, so a per rung comparison means nothing');

  -- The nudge is not an escalation. It is reported separately and never in the
  -- escalation total, so a shift full of nudges cannot inflate an escalation
  -- count.
  PERFORM
    pg_temp.cfg_assert ((v_sim -> 'in_force' ->> 'nudges_total')::integer > 0, 'the replay fired no nudge, so the nudge accounting is untested');
  PERFORM
    pg_temp.cfg_assert (NOT EXISTS (
      SELECT
        1
      FROM
        jsonb_array_elements(v_sim -> 'in_force' -> 'escalations_by_rung') r
      WHERE
        r ->> 'rung_key' = 'nudge'), 'the nudge appears in the per rung escalation counts, which inflates the escalation total');

  PERFORM
    pg_temp.cfg_assert (v_sim -> 'change' ->> 'missed_delta' IS NOT NULL
      AND v_sim -> 'change' ->> 'escalations_delta' IS NOT NULL, 'the simulation reports no change against the configuration in force');
  -- The two sides have to be capable of disagreeing. A proposal that moves a
  -- window past an observation staff actually recorded produces more missed
  -- windows and more escalations, and if both sides still match then one of them
  -- is not being computed.
  PERFORM
    pg_temp.cfg_assert ((v_sim -> 'change' ->> 'missed_delta')::integer > 0, format('the proposal moves a window past a recorded observation and should read as more missed windows, got a delta of %s', v_sim -> 'change' ->> 'missed_delta'));
  PERFORM
    pg_temp.cfg_assert ((v_sim -> 'change' ->> 'escalations_delta')::integer > 0, format('more missed windows should mean more escalations, got a delta of %s', v_sim -> 'change' ->> 'escalations_delta'));
  PERFORM
    pg_temp.cfg_assert ((v_sim -> 'proposed' ->> 'would_be_satisfied')::integer < (v_sim -> 'in_force' ->> 'would_be_satisfied')::integer, 'the proposal should satisfy fewer windows against the same observations');
  PERFORM
    pg_temp.cfg_assert ((v_sim -> 'recorded' ->> 'expected')::integer > 0, 'the simulation does not report what was actually recorded beside what would have happened');

  INSERT INTO cfg_result (check_name, detail)
    VALUES ('acceptance 18: simulation of both configurations', format('%s day lookback over %s to %s. in force: %s windows, %s satisfied, %s missed, %s escalations across %s rungs, %s nudges. proposed: %s windows, %s satisfied, %s missed, %s escalations across %s rungs. change: missed %s, escalations %s. recorded: expected %s, satisfied %s, escalations %s. Labeled a measurement against past behavior, never a forecast', v_sim ->> 'lookback_days', v_sim ->> 'from_service_date', v_sim ->> 'to_service_date', v_sim -> 'in_force' ->> 'windows_generated', v_sim -> 'in_force' ->> 'would_be_satisfied', v_sim -> 'in_force' ->> 'would_be_missed', v_sim -> 'in_force' ->> 'escalations_total', v_rungs_in_force, v_sim -> 'in_force' ->> 'nudges_total', v_sim -> 'proposed' ->> 'windows_generated', v_sim -> 'proposed' ->> 'would_be_satisfied', v_sim -> 'proposed' ->> 'would_be_missed', v_sim -> 'proposed' ->> 'escalations_total', v_rungs_proposed, v_sim -> 'change' ->> 'missed_delta', v_sim -> 'change' ->> 'escalations_delta', v_sim -> 'recorded' ->> 'expected', v_sim -> 'recorded' ->> 'satisfied', v_sim -> 'recorded' ->> 'escalations'));
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Acceptance 20. A test send creates no escalation row.
--
--    public.send_test_escalation shipped with migration 420 and is unchanged by
--    this part. It is asserted here anyway, because the settings surface is what
--    puts the button in front of an administrator and a test send that quietly
--    started recording escalations would show up as a spike in missed checks
--    that never happened.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'c7f60000-0000-4000-8000-00000000000a';
  v_escalations_before integer;
  v_dispatches_before integer;
  v_tasks_before jsonb;
  v_result jsonb;
BEGIN
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
  v_tasks_before := pg_temp.cfg_settled_work (v_facility);

  v_result := public.send_test_escalation (v_facility, 'tier_2');

  PERFORM
    pg_temp.cfg_assert (left(v_result ->> 'body', 5) = 'TEST ', 'TEST must be the first word of the test send body, got: ' || left(v_result ->> 'body', 24));
  PERFORM
    pg_temp.cfg_assert ((v_result ->> 'escalation_recorded')::boolean IS FALSE, 'the test send claimed it recorded an escalation');
  PERFORM
    pg_temp.cfg_assert ((v_result ->> 'deliveries_queued')::integer > 0, 'the test send reached nobody, so it did not go through the real routing');
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        count(*)
      FROM
        public.resident_observation_escalations e
      WHERE
        e.facility_id = v_facility) = v_escalations_before, 'the test send wrote a row to resident_observation_escalations');
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        count(*)
      FROM
        public.observation_escalation_dispatches d
      WHERE
        d.facility_id = v_facility) = v_dispatches_before, 'the test send wrote a dispatch row, which would make a re-test look already fired');
  PERFORM
    pg_temp.cfg_assert (pg_temp.cfg_settled_work (v_facility) = v_tasks_before, 'the test send touched a task');
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        count(*)
      FROM
        public.observation_escalation_deliveries d
      WHERE
        d.facility_id = v_facility
        AND d.is_test
        AND left(d.message_body, 5) <> 'TEST ') = 0, 'a test delivery went out without TEST as the first word');

  INSERT INTO cfg_result (check_name, detail)
    VALUES ('acceptance 20: a test send records nothing', format('%s test deliveries queued through the real routing; resident_observation_escalations stayed at %s rows and observation_escalation_dispatches at %s', v_result ->> 'deliveries_queued', v_escalations_before, v_dispatches_before));
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Acceptance 21. A template applied to three facilities creates one new
--    version per facility with the same window set, each independently
--    effective dated, and the portfolio settings view reports zero drift
--    afterwards.
--
--    The fan out itself happened in section 2 as the fourth test of the
--    activation invariant. This section reads the result.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_template CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000021';
  v_template_version CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000022';
  v_facilities CONSTANT uuid[] := ARRAY['c7f60000-0000-4000-8000-00000000000a'::uuid, 'c7f60000-0000-4000-8000-00000000000b'::uuid, 'c7f60000-0000-4000-8000-00000000000c'::uuid];
  v_facility uuid;
  v_version uuid;
  v_template_set jsonb;
  v_versions uuid[] := ARRAY[]::uuid[];
  v_effective timestamptz[] := ARRAY[]::timestamptz[];
  v_drift record;
BEGIN
  SELECT
    COALESCE(jsonb_agg (jsonb_build_object('window_key', w.window_key, 'label', w.label, 'due_at_local', to_char(w.due_at_local, 'HH24:MI'), 'grace_before_minutes', w.grace_before_minutes, 'grace_after_minutes', w.grace_after_minutes, 'shift_key', w.shift_key, 'enabled', w.enabled)
      ORDER BY w.window_key), '[]'::jsonb) INTO v_template_set
  FROM
    public.cadence_template_windows w
  WHERE
    w.cadence_template_version_id = v_template_version
    AND w.deleted_at IS NULL;

  FOREACH v_facility IN ARRAY v_facilities LOOP
    SELECT
      v.id INTO v_version
    FROM
      public.facility_cadence_versions v
    WHERE
      v.facility_id = v_facility
      AND v.status = 'active'
      AND v.deleted_at IS NULL;

    PERFORM
      pg_temp.cfg_assert (v_version IS NOT NULL, format('building %s has no active cadence version after the fan out', v_facility));
    PERFORM
      pg_temp.cfg_assert (pg_temp.cfg_window_set (v_version) = v_template_set, format('building %s did not get the template window set', v_facility));
    PERFORM
      pg_temp.cfg_assert ((
        SELECT
          v.source_template_id
        FROM public.facility_cadence_versions v
        WHERE
          v.id = v_version) = v_template, format('building %s is not pointed at the template it was applied from', v_facility));

    v_versions := array_append(v_versions, v_version);
    v_effective := array_append(v_effective, (
        SELECT
          v.effective_from
        FROM
          public.facility_cadence_versions v
        WHERE
          v.id = v_version));
  END LOOP;

  -- One version per building, not one version shared by three. Each carries its
  -- own effective_from column, which is what makes per facility effective
  -- timing possible at all.
  PERFORM
    pg_temp.cfg_assert (array_length(v_versions, 1) = 3
      AND v_versions[1] <> v_versions[2]
      AND v_versions[2] <> v_versions[3]
      AND v_versions[1] <> v_versions[3], 'the fan out did not create one independent version per building');
  PERFORM
    pg_temp.cfg_assert (v_effective[1] IS NOT NULL AND v_effective[2] IS NOT NULL AND v_effective[3] IS NOT NULL, 'a version from the fan out has no effective_from of its own');

  -- Read at the instant the fan out takes effect, not at now(). Everything in
  -- section 2 was effective dated forward so the timeline could be walked in
  -- order inside one transaction, and at now() the version in force is still an
  -- earlier one. Measuring drift at now() here would be measuring the wrong
  -- version and reporting it as a fan out failure.
  FOR v_drift IN
  SELECT
    d.facility_id,
    d.on_cadence_template,
    d.on_escalation_template,
    d.cadence_drift_count,
    d.escalation_drift_count
  FROM
    public.facility_config_template_drift (now() + interval '7 hours', NULL) d
  WHERE
    d.facility_id = ANY (v_facilities) LOOP
      PERFORM
        pg_temp.cfg_assert (v_drift.on_cadence_template, format('building %s reads as custom after a template was applied to it', v_drift.facility_id));
      PERFORM
        pg_temp.cfg_assert (v_drift.cadence_drift_count = 0, format('building %s reports %s cadence rows adrift from the template it was just given', v_drift.facility_id, v_drift.cadence_drift_count));
      PERFORM
        pg_temp.cfg_assert (v_drift.escalation_drift_count = 0, format('building %s reports %s escalation rows adrift from the template it was just given', v_drift.facility_id, v_drift.escalation_drift_count));
    END LOOP;

  -- Building 4 was never on a template and must keep reading as custom, so a
  -- zero drift report cannot be a view that answers zero for everything.
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        NOT d.on_cadence_template
        AND d.cadence_drift_count IS NULL
      FROM public.facility_config_template_drift (now() + interval '7 hours', NULL) d
      WHERE
        d.facility_id = 'c7f60000-0000-4000-8000-00000000000d'), 'the drift view reports a template for a building that is custom, so its zeros mean nothing');

  -- The view exists and answers at now(), which is what a portfolio settings
  -- page reads. The binding is what it reports as on a template, and that is
  -- true from the moment the fan out was approved.
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        count(*)
      FROM public.v_facility_config_template_drift d
      WHERE
        d.facility_id = ANY (v_facilities)
        AND d.on_cadence_template
        AND d.on_escalation_template) = 3, 'the portfolio view does not report all three buildings as on a template');

  INSERT INTO cfg_result (check_name, detail)
    VALUES ('acceptance 21: a template applied to three buildings', format('three independent versions, all carrying the template window set, each with its own effective_from; the portfolio view reports 0 cadence drift and 0 escalation drift on all three and custom on the fourth'));
END
$$;

-- ---------------------------------------------------------------------------
-- 7. The two refusals no database constraint can make, and the one it can.
--
--    Decision D19 says the gist exclusion constraint is the floor and not the
--    ceiling. This section is what that means in practice:
--
--      - writing the versions in the wrong order aborts on the constraint,
--        which is the floor working
--      - activating a version backwards in time is perfectly legal as far as
--        every constraint is concerned, and reverses history
--      - moving effective_from on a version that has already generated a task
--        is also perfectly legal, and rescores work that was already scored
--
--    The last two are refused by haven.apply_observation_config_activation and
--    are asserted against that function directly, because a caller that gets
--    the order wrong is exactly what the invariant exists to stop.
-- ---------------------------------------------------------------------------
SELECT
  pg_temp.cfg_sign_in ('c7f60000-0000-4000-8000-000000000011', 'c7f60000-0000-4000-8000-000000000031');

DO $$
DECLARE
  v_facility CONSTANT uuid := 'c7f60000-0000-4000-8000-00000000000d';
  v_org CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := 'c7f60000-0000-4000-8000-000000000002';
  v_name text;
  v_active uuid;
  v_active_from timestamptz;
  v_created jsonb;
  v_candidate uuid;
  v_state text;
  v_resident uuid;
  v_task uuid;
  v_raised text;
  v_sqlstate text;
  v_detail text := '';
BEGIN
  SELECT
    f.name INTO v_name
  FROM
    public.facilities f
  WHERE
    f.id = v_facility;

  SELECT
    v.id,
    v.effective_from INTO v_active,
    v_active_from
  FROM
    public.facility_cadence_versions v
  WHERE
    v.facility_id = v_facility
    AND v.status = 'active'
    AND v.deleted_at IS NULL;

  -- ---- The floor: the wrong write order aborts ----------------------------
  v_created := public.create_cadence_version (p_facility_id := v_facility, p_change_reason := 'Acceptance fixture: a valid successor, written by hand in the wrong order.', p_windows := pg_temp.cfg_window_payload (v_active));
  v_candidate := (v_created ->> 'cadence_version_id')::uuid;

  BEGIN
    -- Open the incoming version while the outgoing one is still open ended,
    -- which is the order a hand written activation reaches for first.
    UPDATE
      public.facility_cadence_versions
    SET
      status = 'active',
      effective_from = v_active_from + interval '1 hour'
    WHERE
      id = v_candidate;
    v_raised := NULL;
    v_sqlstate := NULL;
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := SQLERRM;
      v_sqlstate := SQLSTATE;
  END;

  PERFORM
    pg_temp.cfg_assert (v_raised IS NOT NULL, 'two versions were both left active and open ended on one building, so the timeline constraint is gone');
  v_detail := v_detail || format('wrong write order aborts with SQLSTATE %s; ', v_sqlstate);

  -- ---- Refusal 1: activating backwards ------------------------------------
  BEGIN
    PERFORM
      haven.apply_observation_config_activation ('cadence', v_candidate, v_active_from - interval '1 day', NULL, FALSE);
    v_raised := NULL;
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := SQLERRM;
  END;

  PERFORM
    pg_temp.cfg_assert (v_raised IS NOT NULL
      AND strpos(v_raised, 'before version') > 0, format('activating a version before the one it supersedes should be refused by name, raised: %s', COALESCE(v_raised, 'nothing at all')));
  PERFORM
    pg_temp.cfg_assert (public.facility_cadence_in_force (v_facility, now()) = v_active, 'a refused backwards activation still displaced the version in force');
  v_detail := v_detail || format('backwards activation refused: "%s"; ', v_raised);

  -- ---- Refusal 2: moving effective_from on a version that generated work ---
  --
  -- The candidate is given one task stamped with it, which is what a generator
  -- run does, and then an attempt is made to activate it at a different
  -- instant. Its window times were what that task was scored against.
  SELECT
    r.id INTO v_resident
  FROM
    public.residents r
  WHERE
    r.facility_id = 'c7f60000-0000-4000-8000-00000000000a'
  LIMIT 1;

  INSERT INTO public.resident_observation_tasks (organization_id, entity_id, facility_id, resident_id, cadence_version_id, window_key, service_date, scheduled_for, due_at, grace_ends_at, status)
  SELECT
    v_org,
    v_entity,
    'c7f60000-0000-4000-8000-00000000000a',
    v_resident,
    v_candidate,
    'acceptance_stamp_probe',
    (now() AT TIME ZONE 'America/New_York')::date + 30,
    now() + interval '30 days',
    now() + interval '30 days',
    now() + interval '30 days',
    'upcoming'
  RETURNING
    id INTO v_task;

  SELECT
    v.status INTO v_state
  FROM
    public.facility_cadence_versions v
  WHERE
    v.id = v_candidate;

  BEGIN
    PERFORM
      haven.apply_observation_config_activation ('cadence', v_candidate, v_active_from + interval '9 hours', NULL, FALSE);
    v_raised := NULL;
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := SQLERRM;
  END;

  PERFORM
    pg_temp.cfg_assert (v_raised IS NOT NULL
      AND strpos(v_raised, 'already generated a record stamped with it') > 0, format('moving effective_from on a version that has generated a task should be refused by name, raised: %s', COALESCE(v_raised, 'nothing at all')));
  v_detail := v_detail || format('moving effective_from on a version that generated a task refused: "%s"; ', v_raised);

  -- The same version activates cleanly at the instant it already carries, which
  -- is the point: the refusal is about moving the date, not about the version.
  PERFORM
    haven.apply_observation_config_activation ('cadence', v_candidate, (
        SELECT
          v.effective_from
        FROM
          public.facility_cadence_versions v
        WHERE
          v.id = v_candidate), NULL, FALSE);

  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        v.status = 'active'
      FROM public.facility_cadence_versions v
      WHERE
        v.id = v_candidate), 'the version would not activate at the instant it already carried');
  PERFORM
    pg_temp.cfg_assert ((
      SELECT
        t.deleted_at IS NULL
        AND t.cadence_version_id = v_candidate
      FROM public.resident_observation_tasks t
      WHERE
        t.id = v_task), 'the activation cancelled a task that was stamped with the version being activated');

  v_detail := v_detail || 'the same version activates at the instant it already carried, and does not cancel its own tasks';

  INSERT INTO cfg_result (check_name, detail)
    VALUES ('the activation invariant refuses what no constraint can', v_detail);
END
$$;

-- ---------------------------------------------------------------------------
-- 8. Results
-- ---------------------------------------------------------------------------
SELECT
  check_name AS "check",
  detail
FROM
  cfg_result
ORDER BY
  seq;

DO $$
BEGIN
  RAISE NOTICE 'config-invariants-acceptance PASS';
END
$$;

ROLLBACK;
