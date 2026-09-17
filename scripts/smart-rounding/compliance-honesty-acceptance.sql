-- Compliance honesty acceptance. The three routes by which a resident day used
-- to vanish from the compliance record, each asserted to read as a defect now.
--
-- Run it against any database that has every migration applied:
--
--   node scripts/smart-rounding/run-compliance-honesty-acceptance.mjs
--
-- or directly, against a replay you already have:
--
--   psql -d <replay> -v ON_ERROR_STOP=1 -f scripts/smart-rounding/compliance-honesty-acceptance.sql
--
-- Everything happens inside one transaction that rolls back, so the script is
-- safe to re-run and leaves nothing behind. All fixture data is synthetic: no
-- resident, no staff member and no facility here corresponds to a real one.
--
-- The defect this file exists to keep fixed. Migration 414 derived the set of
-- resident days from task rows and Monitoring Order days. A resident day with
-- neither produced no rows at all, so expected was zero, satisfied was zero,
-- and a dashboard read zero over zero as a hundred percent or as no data. Three
-- routes reach that state:
--
--   (a) the generator never ran, or errored for that facility
--   (b) no cadence version is in force for the date, which used to drop the
--       resident day entirely because the projection was a CROSS JOIN LATERAL
--   (c) a facility created after migrations 412 and 415 inherits no shift
--       model, no cadence and no escalation ladder, and reads as a quiet
--       building
--
-- public.observation_compliance_for_range answers all three with expected
-- greater than zero and unsatisfied. Silence is the one answer it may not give.

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE FUNCTION pg_temp.ch_assert (ok boolean, msg text)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'compliance-honesty-acceptance FAILED: %', msg;
  END IF;
END
$$;

CREATE TEMP TABLE ch_result (
  seq serial,
  check_name text,
  detail text
);

-- ---------------------------------------------------------------------------
-- 1. Fixture. One synthetic organization, one configured building, three
--    residents in three different states.
--
--    The cadence at the configured building is a copy of the seeded version,
--    windows and grace values included, so this file never restates a time. Its
--    effective_from is deliberately recent, which is what creates the window of
--    earlier dates route (b) is about.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000002';
  v_facility CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000004';
  v_hospital CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000005';
  v_prospect CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000006';
  v_cadence CONSTANT uuid := 'c0de0000-0000-4000-8000-00000000000b';
  v_escalation CONSTANT uuid := 'c0de0000-0000-4000-8000-00000000000c';
  v_source_cadence uuid;
  v_source_escalation uuid;
  v_source_facility uuid;
BEGIN
  INSERT INTO public.organizations (id, name)
    VALUES (v_org, 'Synthetic Compliance Honesty Organization');
  INSERT INTO public.entities (id, organization_id, name)
    VALUES (v_entity, v_org, 'Synthetic Compliance Honesty Entity');
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
    VALUES (v_facility, v_entity, v_org, 'Synthetic Configured Building', '1 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York');

  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender, admission_date)
    VALUES (v_resident, v_facility, v_org, 'Occupant', 'Synthetic', 'active', 'prefer_not_to_say', (now() - interval '20 days')::date),
    (v_hospital, v_facility, v_org, 'Away', 'Synthetic', 'hospital_hold', 'prefer_not_to_say', (now() - interval '20 days')::date),
    -- An inquiry is not in the building and must never appear as an expectation.
    (v_prospect, v_facility, v_org, 'Enquiring', 'Synthetic', 'inquiry', 'prefer_not_to_say', NULL);

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
    pg_temp.ch_assert (v_source_cadence IS NOT NULL, 'the seeded cadence version from migration 414 is missing');

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
    pg_temp.ch_assert (v_source_escalation IS NOT NULL, 'the seeded escalation version from migration 417 is missing');

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

  -- Ten days of residency, five days of cadence. The five days in between are
  -- route (b).
  INSERT INTO public.facility_cadence_versions (id, organization_id, facility_id, version_number, status, effective_from, change_reason)
    VALUES (v_cadence, v_org, v_facility, 1, 'active', date_trunc('day', now() - interval '5 days'), 'Synthetic acceptance fixture');

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
    VALUES (v_escalation, v_org, v_facility, 1, 'active', date_trunc('day', now() - interval '5 days'), 'Synthetic acceptance fixture');

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
    src.shift_key,
    src.offset_minutes,
    src.channels
  FROM
    public.facility_escalation_rung_shift_overrides src
    JOIN public.facility_escalation_rungs donor ON donor.id = src.escalation_rung_id
    JOIN public.facility_escalation_rungs mine ON mine.escalation_version_id = v_escalation
      AND mine.rung_key = donor.rung_key
  WHERE
    src.escalation_version_id = v_source_escalation;

  -- The resident who was in hospital for two of the ten days. The status
  -- history trigger wrote an active span when the row was inserted; close it
  -- and open a hospital_hold span so the fixture has a real absence to subtract.
  UPDATE
    public.resident_status_history
  SET
    effective_to = now() - interval '9 days'
  WHERE
    resident_id = v_hospital
    AND effective_to IS NULL;

  INSERT INTO public.resident_status_history (organization_id, facility_id, resident_id, status, effective_from, effective_to)
    VALUES (v_org, v_facility, v_hospital, 'hospital_hold', now() - interval '9 days', now() - interval '7 days'),
    (v_org, v_facility, v_hospital, 'active', now() - interval '7 days', NULL);

  INSERT INTO ch_result (check_name, detail)
  SELECT
    'fixture',
    format('%s windows and %s rungs copied from the seeded versions; residency starts %s, cadence takes effect %s', (
        SELECT
          count(*)
        FROM public.facility_cadence_windows
        WHERE
          cadence_version_id = v_cadence), (
        SELECT
          count(*)
        FROM public.facility_escalation_rungs
        WHERE
          escalation_version_id = v_escalation), (now() - interval '20 days')::date, (now() - interval '5 days')::date);
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Route (a). The generator never ran.
--
-- A resident is in the building, a cadence is in force, and not one task row
-- exists. The old view derived the day from task rows and Monitoring Order
-- days, so it returned nothing and a dashboard read zero over zero as perfect
-- compliance. Six windows are expected and none of them was met.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000004';
  v_day date;
  v_tasks integer;
  v_expected integer;
  v_satisfied integer;
  v_no_cadence integer;
BEGIN
  v_day := ((now() - interval '2 days') AT TIME ZONE 'America/New_York')::date;

  SELECT
    count(*) INTO v_tasks
  FROM
    public.resident_observation_tasks
  WHERE
    resident_id = v_resident
    AND service_date = v_day;
  PERFORM
    pg_temp.ch_assert (v_tasks = 0, format('the fixture needs a day with no task rows at all, got %s', v_tasks));

  SELECT
    count(*),
    count(*) FILTER (WHERE satisfied),
    count(*) FILTER (WHERE expectation_source = 'no_cadence') INTO v_expected,
    v_satisfied,
    v_no_cadence
  FROM
    public.observation_compliance_for_range (v_facility, v_day, v_day)
  WHERE
    resident_id = v_resident;

  PERFORM
    pg_temp.ch_assert (v_expected = 6, format('a resident day the generator never touched should still expect six windows, got %s', v_expected));
  PERFORM
    pg_temp.ch_assert (v_satisfied = 0, format('nothing was recorded, so nothing may read as satisfied, got %s', v_satisfied));
  PERFORM
    pg_temp.ch_assert (v_no_cadence = 0, format('a cadence is in force on this date, so no row may read as no_cadence, got %s', v_no_cadence));
  PERFORM
    pg_temp.ch_assert (NOT EXISTS (
        SELECT
          1
        FROM
          public.observation_compliance_for_range (v_facility, v_day, v_day)
        WHERE
          resident_id = v_resident
          AND expectation_source <> 'projected_only'), 'every window on a day with no tasks should name projected_only as its source');

  INSERT INTO ch_result (check_name, detail)
    VALUES ('route (a): generator never ran', format('on %s the resident has %s task rows and reads %s/%s satisfied, not zero over zero', v_day, v_tasks, v_satisfied, v_expected));
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Route (b). No cadence version in force for the date.
--
-- The demonstrated case: a resident admitted before the cadence version's
-- effective_from. Both the resolver and the projector return nothing, and
-- because migration 416 projected through a CROSS JOIN LATERAL the entire
-- resident day was deleted from the answer rather than read as
-- expected-and-unsatisfied. Every one of those days now yields exactly one row
-- that says so.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000004';
  v_from date;
  v_to date;
  v_days integer;
  v_covered integer;
  v_no_cadence_days integer;
  v_no_cadence_rows integer;
  v_satisfied integer;
  v_flagged integer;
BEGIN
  v_from := ((now() - interval '10 days') AT TIME ZONE 'America/New_York')::date;
  v_to := ((now() - interval '2 days') AT TIME ZONE 'America/New_York')::date;
  v_days := (v_to - v_from) + 1;

  -- Not one day of the range is missing. This is the assertion the old view
  -- could not pass: it returned rows only from the cadence's effective_from
  -- onward and said nothing at all about the days before it.
  SELECT
    count(DISTINCT service_date) INTO v_covered
  FROM
    public.observation_compliance_for_range (v_facility, v_from, v_to)
  WHERE
    resident_id = v_resident;
  PERFORM
    pg_temp.ch_assert (v_covered = v_days, format('a %s day range over an occupied resident should return %s service dates, got %s', v_days, v_days, v_covered));

  SELECT
    count(DISTINCT service_date),
    count(*) INTO v_no_cadence_days,
    v_no_cadence_rows
  FROM
    public.observation_compliance_for_range (v_facility, v_from, v_to)
  WHERE
    resident_id = v_resident
    AND expectation_source = 'no_cadence';
  PERFORM
    pg_temp.ch_assert (v_no_cadence_days > 0, 'the fixture expects days before the cadence took effect and found none');
  PERFORM
    pg_temp.ch_assert (v_no_cadence_rows = v_no_cadence_days, format('a resident day with no cadence must yield exactly one row, got %s rows across %s days', v_no_cadence_rows, v_no_cadence_days));

  -- That row is a defect, not silence and not a pass.
  SELECT
    count(*) INTO v_satisfied
  FROM
    public.observation_compliance_for_range (v_facility, v_from, v_to)
  WHERE
    resident_id = v_resident
    AND expectation_source = 'no_cadence'
    AND satisfied;
  PERFORM
    pg_temp.ch_assert (v_satisfied = 0, format('%s no_cadence row(s) read as satisfied', v_satisfied));

  SELECT
    count(*) INTO v_flagged
  FROM
    public.observation_compliance_for_range (v_facility, v_from, v_to)
  WHERE
    resident_id = v_resident
    AND expectation_source = 'no_cadence'
    AND no_cadence_in_force
    AND window_key IS NULL
    AND cadence_version_id IS NULL;
  PERFORM
    pg_temp.ch_assert (v_flagged = v_no_cadence_rows, format('every no_cadence row must carry no_cadence_in_force true with a null window and a null version, %s of %s did', v_flagged, v_no_cadence_rows));

  INSERT INTO ch_result (check_name, detail)
    VALUES ('route (b): no cadence in force', format('%s of %s service dates in %s..%s carry no cadence and each yields exactly one unsatisfied no_cadence row; not one day is dropped', v_no_cadence_days, v_days, v_from, v_to));
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Occupancy is the floor, and it is a floor with edges.
--
--    A resident who was never admitted is never expected. A resident who was in
--    hospital is not expected on the days they were away, which is why
--    resident_status_history is read subtractively: it can remove a day it
--    knows about, and its gaps can only ever leave a day expected, which is the
--    direction that shows a defect rather than hides one.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000003';
  v_hospital CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000005';
  v_prospect CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000006';
  v_from date;
  v_to date;
  v_away_day date;
  v_present_day date;
  v_rows integer;
BEGIN
  v_from := ((now() - interval '10 days') AT TIME ZONE 'America/New_York')::date;
  v_to := ((now() - interval '2 days') AT TIME ZONE 'America/New_York')::date;
  v_away_day := ((now() - interval '8 days') AT TIME ZONE 'America/New_York')::date;
  v_present_day := ((now() - interval '3 days') AT TIME ZONE 'America/New_York')::date;

  SELECT
    count(*) INTO v_rows
  FROM
    public.observation_compliance_for_range (v_facility, v_from, v_to)
  WHERE
    resident_id = v_prospect;
  PERFORM
    pg_temp.ch_assert (v_rows = 0, format('an inquiry was never in the building and must never be expected, got %s rows', v_rows));

  SELECT
    count(*) INTO v_rows
  FROM
    public.observation_compliance_for_range (v_facility, v_away_day, v_away_day)
  WHERE
    resident_id = v_hospital;
  PERFORM
    pg_temp.ch_assert (v_rows = 0, format('a resident in hospital must not read as missed checks, got %s rows on %s', v_rows, v_away_day));

  SELECT
    count(*) INTO v_rows
  FROM
    public.observation_compliance_for_range (v_facility, v_present_day, v_present_day)
  WHERE
    resident_id = v_hospital;
  PERFORM
    pg_temp.ch_assert (v_rows = 6, format('the same resident is expected on six windows the day they were back in the building, got %s', v_rows));

  INSERT INTO ch_result (check_name, detail)
    VALUES ('occupancy edges', format('an inquiry returns 0 rows across %s..%s; a resident on hospital hold returns 0 rows on %s and 6 on %s', v_from, v_to, v_away_day, v_present_day));
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Route (c). A facility created after the migrations ran.
--
-- The sixth building. Migrations 412 and 415 seed every facility that existed
-- when they ran, so a building added afterwards inherited no shift model, no
-- cadence version and no escalation ladder, generated nothing, escalated
-- nothing, and read as a quiet facility. The AFTER INSERT trigger now gives it
-- the configuration its organization is actually running.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000002';
  v_new_facility CONSTANT uuid := 'c0de0000-0000-4000-8000-00000000000d';
  v_new_resident CONSTANT uuid := 'c0de0000-0000-4000-8000-00000000000e';
  v_shifts integer;
  v_windows integer;
  v_rungs integer;
  v_overrides integer;
  v_cadence uuid;
  v_escalation uuid;
  v_day date;
  v_expected integer;
  v_satisfied integer;
  v_again jsonb;
BEGIN
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
    VALUES (v_new_facility, v_entity, v_org, 'Synthetic Sixth Building', '2 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York');

  SELECT
    count(*) INTO v_shifts
  FROM
    public.facility_shift_definitions
  WHERE
    facility_id = v_new_facility
    AND active
    AND deleted_at IS NULL;
  PERFORM
    pg_temp.ch_assert (v_shifts = 2, format('a new building should inherit the organization shift model, got %s shift definitions', v_shifts));

  SELECT
    v.id INTO v_cadence
  FROM
    public.facility_cadence_versions v
  WHERE
    v.facility_id = v_new_facility
    AND v.status = 'active'
    AND v.deleted_at IS NULL;
  PERFORM
    pg_temp.ch_assert (v_cadence IS NOT NULL, 'a new building should inherit an active cadence version');

  SELECT
    count(*) INTO v_windows
  FROM
    public.facility_cadence_windows
  WHERE
    cadence_version_id = v_cadence
    AND enabled
    AND deleted_at IS NULL;
  PERFORM
    pg_temp.ch_assert (v_windows = 6, format('the inherited cadence should carry six enabled windows, got %s', v_windows));

  SELECT
    v.id INTO v_escalation
  FROM
    public.facility_escalation_versions v
  WHERE
    v.facility_id = v_new_facility
    AND v.status = 'active'
    AND v.deleted_at IS NULL;
  PERFORM
    pg_temp.ch_assert (v_escalation IS NOT NULL, 'a new building should inherit an active escalation version');

  SELECT
    count(*) INTO v_rungs
  FROM
    public.facility_escalation_rungs
  WHERE
    escalation_version_id = v_escalation
    AND enabled
    AND deleted_at IS NULL;
  PERFORM
    pg_temp.ch_assert (v_rungs = 4, format('the inherited ladder should carry four rungs, got %s', v_rungs));

  SELECT
    count(*) INTO v_overrides
  FROM
    public.facility_escalation_rung_shift_overrides
  WHERE
    escalation_version_id = v_escalation
    AND deleted_at IS NULL;
  PERFORM
    pg_temp.ch_assert (v_overrides = 3, format('the inherited ladder should carry three night overrides, got %s', v_overrides));

  -- Idempotent: a second call adds nothing and opens no second version.
  v_again := public.ensure_facility_observation_defaults (v_new_facility);
  PERFORM
    pg_temp.ch_assert ((v_again ->> 'shift_definitions_added')::integer = 0
      AND (v_again ->> 'cadence_windows_added')::integer = 0
      AND (v_again ->> 'escalation_rungs_added')::integer = 0, format('a second call to ensure_facility_observation_defaults wrote rows: %s', v_again::text));
  SELECT
    count(*) INTO v_windows
  FROM
    public.facility_cadence_versions
  WHERE
    facility_id = v_new_facility
    AND deleted_at IS NULL;
  PERFORM
    pg_temp.ch_assert (v_windows = 1, format('the new building should own exactly one cadence version, got %s', v_windows));

  -- And the inherited cadence is live: a resident in the new building is
  -- expected on its windows from the day they were admitted.
  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender, admission_date)
    VALUES (v_new_resident, v_new_facility, v_org, 'Newbuild', 'Synthetic', 'active', 'prefer_not_to_say', (now() - interval '1 day')::date);

  v_day := (now() AT TIME ZONE 'America/New_York')::date;
  SELECT
    count(*),
    count(*) FILTER (WHERE satisfied) INTO v_expected,
    v_satisfied
  FROM
    public.observation_compliance_for_range (v_new_facility, v_day, v_day)
  WHERE
    resident_id = v_new_resident;
  PERFORM
    pg_temp.ch_assert (v_expected = 6, format('a resident in the new building should be expected on six windows, got %s', v_expected));
  PERFORM
    pg_temp.ch_assert (v_satisfied = 0, format('nothing was recorded in the new building, got %s satisfied', v_satisfied));

  INSERT INTO ch_result (check_name, detail)
    VALUES ('route (c): facility created after the migrations', format('inherited %s shifts, a cadence version with %s windows and an escalation version with %s rungs and %s night overrides; a resident there reads %s/%s', v_shifts, 6, v_rungs, v_overrides, v_satisfied, v_expected));
END
$$;

-- ---------------------------------------------------------------------------
-- 6. An organization with nothing to inherit from is a visible gap, not a
--    guess.
--
--    Copying another tenant's observation policy would be worse than saying
--    nothing, and saying nothing quietly is the defect this whole file is
--    about. So the command refuses, the trigger records an open exec_alerts
--    row, and the compliance read reports the building's resident days as
--    no_cadence.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000011';
  v_entity CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000012';
  v_facility CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000013';
  v_resident CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000014';
  v_alerts integer;
  v_day date;
  v_rows integer;
  v_no_cadence integer;
BEGIN
  INSERT INTO public.organizations (id, name)
    VALUES (v_org, 'Synthetic Unconfigured Organization');
  INSERT INTO public.entities (id, organization_id, name)
    VALUES (v_entity, v_org, 'Synthetic Unconfigured Entity');
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
    VALUES (v_facility, v_entity, v_org, 'Synthetic First Building', '3 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York');

  -- The facility insert succeeded, which is the guarantee that matters: a fault
  -- in seeding observation configuration may never fail the creation of a
  -- building.
  PERFORM
    pg_temp.ch_assert (EXISTS (
        SELECT
          1
        FROM
          public.facilities
        WHERE
          id = v_facility), 'the facility insert must survive a failure to seed observation defaults');

  SELECT
    count(*) INTO v_alerts
  FROM
    public.exec_alerts
  WHERE
    facility_id = v_facility
    AND source_module = 'compliance'
    AND resolved_at IS NULL
    AND deleted_at IS NULL;
  PERFORM
    pg_temp.ch_assert (v_alerts = 1, format('an unconfigurable building should raise exactly one open exec alert, got %s', v_alerts));

  PERFORM
    pg_temp.ch_assert (NOT EXISTS (
        SELECT
          1
        FROM
          public.facility_cadence_versions
        WHERE
          facility_id = v_facility), 'nothing may be guessed for an organization with no configuration of its own');

  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender, admission_date)
    VALUES (v_resident, v_facility, v_org, 'Unconfigured', 'Synthetic', 'active', 'prefer_not_to_say', (now() - interval '3 days')::date);

  v_day := ((now() - interval '1 day') AT TIME ZONE 'America/New_York')::date;
  SELECT
    count(*),
    count(*) FILTER (WHERE expectation_source = 'no_cadence'
      AND no_cadence_in_force
      AND NOT satisfied) INTO v_rows,
    v_no_cadence
  FROM
    public.observation_compliance_for_range (v_facility, v_day, v_day)
  WHERE
    resident_id = v_resident;
  PERFORM
    pg_temp.ch_assert (v_rows = 1, format('an unconfigured building should return one row per resident day, got %s', v_rows));
  PERFORM
    pg_temp.ch_assert (v_no_cadence = 1, 'that row must read as an unsatisfied no_cadence expectation');

  INSERT INTO ch_result (check_name, detail)
    VALUES ('no donor configuration', format('the building was created, nothing was guessed, %s open exec alert names the gap, and its resident days read as unsatisfied no_cadence', v_alerts));
END
$$;

-- ---------------------------------------------------------------------------
-- 7. The read follows the reader's authority.
--
--    The function it replaced was a security_invoker view, and invoker rights
--    are the whole reason a compliance read can be handed to a caregiver at
--    all. What is asserted here is the property, not the effect: the function
--    is not SECURITY DEFINER, so row level security on residents, facilities,
--    the task tables and the log tables applies to whoever calls it.
--
--    The effect is deliberately not asserted. This replay has no Supabase
--    default privileges, so the authenticated role cannot even SELECT
--    public.residents here and an RLS reach test would fail for the wrong
--    reason; the mirror of that trap is the recorded Haven finding that
--    has_table_privilege(...) = false assertions read the other way on a hosted
--    project. Reach is a hosted check and is recorded as one rather than
--    claimed here.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_definer boolean;
  v_anon boolean;
  v_authenticated boolean;
  v_service boolean;
BEGIN
  SELECT
    p.prosecdef INTO v_definer
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'observation_compliance_for_range';
  PERFORM
    pg_temp.ch_assert (v_definer IS FALSE, 'the compliance contract must run with invoker rights, not as its owner');

  SELECT
    pg_catalog.has_function_privilege('anon', 'public.observation_compliance_for_range(uuid,date,date)', 'EXECUTE'),
    pg_catalog.has_function_privilege('authenticated', 'public.observation_compliance_for_range(uuid,date,date)', 'EXECUTE'),
    pg_catalog.has_function_privilege('service_role', 'public.observation_compliance_for_range(uuid,date,date)', 'EXECUTE') INTO v_anon,
    v_authenticated,
    v_service;
  PERFORM
    pg_temp.ch_assert (v_anon IS FALSE, 'anon must not reach the compliance contract');
  PERFORM
    pg_temp.ch_assert (v_authenticated, 'a signed in caller must reach the compliance contract');
  PERFORM
    pg_temp.ch_assert (v_service, 'service_role must reach the compliance contract');

  PERFORM
    pg_temp.ch_assert (NOT EXISTS (
        SELECT
          1
        FROM
          pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE
          n.nspname = 'public'
          AND c.relname = 'v_resident_observation_compliance'), 'the view the function replaces must be gone, not left beside it');

  INSERT INTO ch_result (check_name, detail)
    VALUES ('invoker rights', 'the contract is a set returning function with invoker rights, executable by authenticated and service_role and not by anon; the view it replaced no longer exists');
END
$$;

-- ---------------------------------------------------------------------------
-- 8. The contract refuses an impossible question rather than answering it with
--    silence, which is the same rule the rest of this file enforces.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000003';
  v_refused integer := 0;
BEGIN
  BEGIN
    PERFORM
      count(*)
    FROM
      public.observation_compliance_for_range (v_facility, current_date, current_date - 1);
  EXCEPTION
    WHEN OTHERS THEN
      v_refused := v_refused + 1;
  END;
  BEGIN
    PERFORM
      count(*)
    FROM
      public.observation_compliance_for_range (v_facility, current_date - 400, current_date);
  EXCEPTION
    WHEN OTHERS THEN
      v_refused := v_refused + 1;
  END;
  PERFORM
    pg_temp.ch_assert (v_refused = 2, format('a reversed range and a 401 day range should both raise, %s did', v_refused));
  INSERT INTO ch_result (check_name, detail)
    VALUES ('range guard', 'a reversed range and a range over 366 days both raise rather than returning an empty compliance answer');
END
$$;

SELECT
  check_name AS "check",
  detail
FROM
  ch_result
ORDER BY
  seq;

DO $$
BEGIN
  RAISE NOTICE 'compliance-honesty-acceptance PASS';
END
$$;

ROLLBACK;
