-- Watchlist acceptance. Spec 25A section 7 and acceptance items 8, 9 and 10.
--
-- Run it against any database that has every migration applied:
--
--   node scripts/smart-rounding/run-watchlist-acceptance.mjs
--
-- or directly, against a replay you already have:
--
--   psql -d <replay> -v ON_ERROR_STOP=1 -f scripts/smart-rounding/watchlist-acceptance.sql
--
-- Everything happens inside one transaction that rolls back, so the script is
-- safe to re-run and leaves nothing behind. All fixture data is synthetic: no
-- resident, no staff member and no facility here corresponds to a real one, and
-- nothing is selected or seeded by facility name.
--
-- What it proves:
--
--   1. every open signal traces to a rule row, and carries that rule's severity
--   2. a disposition transition writes an append only ledger row with the user
--      and the time, and the ledger refuses a transition with nothing written
--      about what was done
--   3. observation_gap is classed as data quality, and cannot lift a resident
--      above Needs a look on its own
--   4. no resident level number exists in any view output
--   5. the measured Acute volume at a synthetic building the size of the pilot
--
-- Item 5 is a measurement, not a target. The fixture below is authored, so the
-- number it produces is a property of the fixture as much as of the thresholds.
-- It is stated rather than tuned.

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE FUNCTION pg_temp.wl_assert (ok boolean, msg text)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'watchlist-acceptance FAILED: %', msg;
  END IF;
END
$$;

CREATE TEMP TABLE wl_result (
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

CREATE FUNCTION pg_temp.wl_sign_in (p_user uuid)
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
    set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_user, 'session_id', p_user, 'auth_claim_version', v_version::text)::text, TRUE);
END
$$;

CREATE FUNCTION pg_temp.wl_sign_out ()
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  PERFORM
    set_config('request.jwt.claims', '{}', TRUE);
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Fixture. One synthetic building of thirty residents, configured with the
--    cadence and the rules the organization actually ships.
--
--    The rules and the bands are copied from the seeded organization defaults
--    rather than restated, so this file asserts against the list migration 425
--    ships and not against a second copy of it that could drift.
--
--    The month it describes: six falls across the building with two residents
--    falling twice, one resident who left the building inside ninety days, two
--    hospital returns, one medication refusal trend, one weight loss, one
--    Monitoring Order in force, and nothing at all written down for anybody,
--    which is the worst case for the documentation signal.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000002';
  v_facility CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000003';
  v_reviewer CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000004';
  v_cadence CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000005';
  v_reporter CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000006';
  v_source_facility uuid;
  v_source_cadence uuid;
  v_seed_org CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  v_resident uuid;
BEGIN
  INSERT INTO public.organizations (id, name)
    VALUES (v_org, 'Synthetic Watchlist Organization');
  INSERT INTO public.entities (id, organization_id, name)
    VALUES (v_entity, v_org, 'Synthetic Watchlist Entity');
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
    VALUES (v_facility, v_entity, v_org, 'Synthetic Watchlist Building', '1 Synthetic Way', 'Synthetic City', '00000', 40, 'America/New_York');

  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, ROLE, created_at, updated_at, confirmation_token)
    VALUES (v_reviewer, '00000000-0000-0000-0000-000000000000', 'synthetic-watchlist-reviewer@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), ''),
    (v_reporter, '00000000-0000-0000-0000-000000000000', 'synthetic-watchlist-reporter@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), '');

  INSERT INTO auth.sessions (id, user_id)
    VALUES (v_reviewer, v_reviewer),
    (v_reporter, v_reporter);

  INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role, is_active)
    VALUES (v_reviewer, v_org, 'synthetic-watchlist-reviewer@haven.test', 'Synthetic Watchlist Reviewer', 'facility_admin', TRUE),
    (v_reporter, v_org, 'synthetic-watchlist-reporter@haven.test', 'Synthetic Watchlist Reporter', 'nurse', TRUE);

  INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
    VALUES (v_reviewer, v_facility, v_org, TRUE),
    (v_reporter, v_facility, v_org, TRUE);

  -- Thirty residents, admitted long enough ago that every lookback span in the
  -- rules table falls inside their occupancy.
  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender, admission_date)
  SELECT
    ('c0de0005-0000-4000-8000-1' || lpad(n::text, 11, '0'))::uuid,
    v_facility,
    v_org,
    'Occupant',
    'Synthetic' || n::text,
    'active',
    'prefer_not_to_say',
    (now() - interval '200 days')::date
  FROM
    generate_series(1, 30) AS n;

  -- The rules and the bands this organization runs, copied from the seeded
  -- organization defaults. Nothing here restates a threshold.
  INSERT INTO public.watchlist_signal_rules (organization_id, facility_id, signal_key, label, description, severity_class, severity_weight, threshold_count, lookback_days, baseline_days, threshold_percent, secondary_threshold_percent, secondary_lookback_days, source_filter, enabled, source_kind, jurisdiction, sort_order)
  SELECT
    v_org,
    NULL,
    r.signal_key,
    r.label,
    r.description,
    r.severity_class,
    r.severity_weight,
    r.threshold_count,
    r.lookback_days,
    r.baseline_days,
    r.threshold_percent,
    r.secondary_threshold_percent,
    r.secondary_lookback_days,
    r.source_filter,
    r.enabled,
    r.source_kind,
    r.jurisdiction,
    r.sort_order
  FROM
    public.watchlist_signal_rules r
  WHERE
    r.organization_id = v_seed_org
    AND r.facility_id IS NULL
    AND r.deleted_at IS NULL;

  PERFORM
    pg_temp.wl_assert ((
      SELECT
        count(*)
      FROM public.watchlist_signal_rules
      WHERE
        organization_id = v_org) = 15, 'migration 425 no longer seeds the fifteen signals of spec section 7.2 as organization defaults');

  INSERT INTO public.watchlist_band_rules (organization_id, facility_id, rule_key, band_key, band_label, band_rank, min_open_signal_count, min_severity_weight, min_open_days, counts_data_quality, enabled, jurisdiction, sort_order)
  SELECT
    v_org,
    NULL,
    b.rule_key,
    b.band_key,
    b.band_label,
    b.band_rank,
    b.min_open_signal_count,
    b.min_severity_weight,
    b.min_open_days,
    b.counts_data_quality,
    b.enabled,
    b.jurisdiction,
    b.sort_order
  FROM
    public.watchlist_band_rules b
  WHERE
    b.organization_id = v_seed_org
    AND b.facility_id IS NULL
    AND b.deleted_at IS NULL;

  -- Cadence copied from a seeded building, so the documentation signal has
  -- windows to project and this file restates no observation time.
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
    pg_temp.wl_assert (v_source_cadence IS NOT NULL, 'the seeded cadence version from migration 417 is missing');

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
    w.cadence_version_id = v_source_cadence
    AND w.deleted_at IS NULL;

  -- Six falls in thirty days. Residents 1 and 2 fell twice.
  INSERT INTO public.incidents (resident_id, facility_id, organization_id, incident_number, category, severity, occurred_at, shift, location_description, description, immediate_actions, reported_by)
  SELECT
    ('c0de0005-0000-4000-8000-1' || lpad(spec.n::text, 11, '0'))::uuid,
    v_facility,
    v_org,
    'SYN-FALL-' || spec.seq::text,
    'fall_without_injury',
    'level_2',
    now() - make_interval(days => spec.days_ago),
    'day',
    'Synthetic location',
    'Synthetic acceptance fixture event.',
    'Synthetic acceptance fixture action.',
    v_reporter
  FROM (
    VALUES (1, 1, 3),
      (2, 1, 20),
      (3, 2, 5),
      (4, 2, 25),
      (5, 3, 9),
      (6, 4, 12)) AS spec (seq, n, days_ago);

  -- One resident left the building inside ninety days.
  INSERT INTO public.incidents (resident_id, facility_id, organization_id, incident_number, category, severity, occurred_at, shift, location_description, description, immediate_actions, reported_by)
    VALUES (('c0de0005-0000-4000-8000-1' || lpad('5', 11, '0'))::uuid, v_facility, v_org, 'SYN-ELOPE-1', 'elopement', 'level_3', now() - interval '40 days', 'night', 'Synthetic location', 'Synthetic acceptance fixture event.', 'Synthetic acceptance fixture action.', v_reporter);

  -- Two hospital returns inside thirty days. Resident 3 also fell, which is the
  -- two elevated signals the band rules call Acute.
  INSERT INTO public.resident_status_history (organization_id, facility_id, resident_id, status, effective_from, effective_to)
  SELECT
    v_org,
    v_facility,
    ('c0de0005-0000-4000-8000-1' || lpad(spec.n::text, 11, '0'))::uuid,
    'hospital_hold',
    now() - make_interval(days => spec.days_ago + 4),
    now() - make_interval(days => spec.days_ago)
  FROM (
    VALUES (3, 8),
      (6, 15)) AS spec (n, days_ago);

  -- One medication refusal trend: three refusals inside the seven day span.
  INSERT INTO public.resident_observation_plans (id, organization_id, entity_id, facility_id, resident_id, status, effective_from, rationale, created_by)
    VALUES ('c0de0005-0000-4000-8000-000000000010', v_org, v_entity, v_facility, ('c0de0005-0000-4000-8000-1' || lpad('7', 11, '0'))::uuid, 'active', now() - interval '200 days', 'Synthetic acceptance fixture plan, carrying the observation logs the chip signals read.', v_reporter);

  INSERT INTO public.staff (id, facility_id, organization_id, first_name, last_name, staff_role, hire_date, user_id, employment_status)
    VALUES ('c0de0005-0000-4000-8000-000000000011', v_facility, v_org, 'Synthetic', 'Reporter', 'resident_aide', current_date, v_reporter, 'active');

  INSERT INTO public.resident_observation_tasks (id, organization_id, facility_id, resident_id, plan_id, service_date, scheduled_for, due_at, grace_ends_at, status)
  SELECT
    ('c0de0005-0000-4000-8000-2' || lpad(n::text, 11, '0'))::uuid,
    v_org,
    v_facility,
    ('c0de0005-0000-4000-8000-1' || lpad('7', 11, '0'))::uuid,
    'c0de0005-0000-4000-8000-000000000010',
    (now() - make_interval(days => n))::date,
    now() - make_interval(days => n),
    now() - make_interval(days => n),
    now() - make_interval(days => n),
    'completed_on_time'
  FROM
    generate_series(1, 3) AS n;

  INSERT INTO public.resident_observation_logs (organization_id, facility_id, resident_id, task_id, staff_id, observed_at, entered_at, quick_status, chip_selections, composed_summary)
  SELECT
    v_org,
    v_facility,
    ('c0de0005-0000-4000-8000-1' || lpad('7', 11, '0'))::uuid,
    ('c0de0005-0000-4000-8000-2' || lpad(n::text, 11, '0'))::uuid,
    'c0de0005-0000-4000-8000-000000000011',
    now() - make_interval(days => n),
    now() - make_interval(days => n),
    'calm',
    '{"med_response":["refused_meds"]}'::jsonb,
    'Synthetic acceptance fixture observation.'
  FROM
    generate_series(1, 3) AS n;

  -- One weight loss: down more than the threshold percent inside the span.
  INSERT INTO public.daily_logs (resident_id, facility_id, organization_id, log_date, shift, logged_by, weight_lbs)
    VALUES (('c0de0005-0000-4000-8000-1' || lpad('8', 11, '0'))::uuid, v_facility, v_org, (now() - interval '28 days')::date, 'day', v_reporter, 160.00),
    (('c0de0005-0000-4000-8000-1' || lpad('8', 11, '0'))::uuid, v_facility, v_org, (now() - interval '2 days')::date, 'day', v_reporter, 148.00);

  -- One Monitoring Order in force.
  INSERT INTO public.resident_monitoring_orders (organization_id, entity_id, facility_id, resident_id, interval_minutes, starts_at, review_due_at, ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note, entered_by, status)
    VALUES (v_org, v_entity, v_facility, ('c0de0005-0000-4000-8000-1' || lpad('9', 11, '0'))::uuid, 60, now() - interval '3 days', now() + interval '4 days', 'physician', 'Synthetic ordering party', 'verbal', 'change_in_condition', 'Synthetic acceptance fixture reason.', v_reporter, 'active');

  INSERT INTO wl_result (check_name, detail)
    VALUES ('fixture', 'thirty synthetic residents at one synthetic building, running the fifteen seeded rules and the six seeded band rules copied from the organization defaults, with six falls, one elopement, two hospital returns, one medication refusal trend, one weight loss and one Monitoring Order');
END
$$;

-- This synthetic fixture describes configuration already in force before today.
UPDATE public.facility_observation_shift_history SET effective_from='-infinity'::timestamptz
WHERE created_at=transaction_timestamp() AND effective_to IS NULL;


-- ---------------------------------------------------------------------------
-- 2. The evaluation runs, and every signal it opens traces to a rule row.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000003';
  v_org CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000001';
  v_result jsonb;
  v_open integer;
  v_orphans integer;
  v_severity_drift integer;
BEGIN
  v_result := public.evaluate_watchlist_signals (v_facility);
  PERFORM
    pg_temp.wl_assert ((v_result ->> 'ok')::boolean, format('the evaluation did not run: %s', v_result));

  SELECT
    count(*) INTO v_open
  FROM
    public.watchlist_signal_instances i
  WHERE
    i.facility_id = v_facility
    AND i.status <> 'cleared'
    AND i.deleted_at IS NULL;
  PERFORM
    pg_temp.wl_assert (v_open > 0, 'the evaluation opened nothing at a building carrying six falls and an elopement');

  -- Acceptance item 8: every signal traces to a rule row.
  SELECT
    count(*) INTO v_orphans
  FROM
    public.watchlist_signal_instances i
    LEFT JOIN public.watchlist_signal_rules r ON r.id = i.signal_rule_id
      AND r.organization_id = i.organization_id
      AND r.signal_key = i.signal_key
      AND r.deleted_at IS NULL
  WHERE
    i.facility_id = v_facility
    AND r.id IS NULL;
  PERFORM
    pg_temp.wl_assert (v_orphans = 0, format('%s open signals do not trace to a rule row in their own organization', v_orphans));

  -- And carries that rule's classification, so a printed board and a printed
  -- rule list cannot disagree about what a signal means.
  SELECT
    count(*) INTO v_severity_drift
  FROM
    public.watchlist_signal_instances i
    JOIN public.watchlist_signal_rules r ON r.id = i.signal_rule_id
  WHERE
    i.facility_id = v_facility
    AND (i.severity_class <> r.severity_class
      OR i.source_kind <> r.source_kind);
  PERFORM
    pg_temp.wl_assert (v_severity_drift = 0, format('%s open signals carry a severity or source class their rule does not', v_severity_drift));

  INSERT INTO wl_result (check_name, detail)
    VALUES ('signals trace to rules', format('%s open signals at the synthetic building, every one of them resolving to a rule row in its own organization and carrying that rule''s severity class and source kind', v_open));
END
$$;

-- ---------------------------------------------------------------------------
-- 3. The disposition. Acceptance item 8's second half.
--
--    A reviewer moves a signal forward and writes one line about what was done,
--    and that transition lands in the append only ledger with their user id and
--    the time. A transition with nothing written is refused, because the line
--    is the whole survey value of the record.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000003';
  v_reviewer CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000004';
  v_instance uuid;
  v_before integer;
  v_after integer;
  v_row record;
  v_refused_state text;
  v_backwards_state text;
BEGIN
  SELECT
    i.id INTO v_instance
  FROM
    public.watchlist_signal_instances i
  WHERE
    i.facility_id = v_facility
    AND i.severity_class = 'critical'
    AND i.status = 'new'
  ORDER BY
    i.first_detected_at
  LIMIT 1;
  PERFORM
    pg_temp.wl_assert (v_instance IS NOT NULL, 'the fixture opened no critical signal to disposition');

  SELECT
    count(*) INTO v_before
  FROM
    public.watchlist_signal_dispositions
  WHERE
    signal_instance_id = v_instance;

  PERFORM
    pg_temp.wl_sign_in (v_reviewer);

  -- Nothing written about what was done, so nothing moves.
  BEGIN
    PERFORM
      public.disposition_watchlist_signal (v_instance, 'acknowledged', '   ');
  EXCEPTION
    WHEN OTHERS THEN
      v_refused_state := SQLSTATE;
  END;
  PERFORM
    pg_temp.wl_assert (v_refused_state = '22023', format('a disposition with nothing written about what was done should be refused as invalid input, SQLSTATE was %s', COALESCE(v_refused_state, 'none, it was accepted')));

  PERFORM
    public.disposition_watchlist_signal (v_instance, 'acknowledged', 'Synthetic acceptance fixture: reviewed with the nurse on shift.');

  -- Forward only. A signal that has been looked at does not become new again.
  BEGIN
    PERFORM
      public.disposition_watchlist_signal (v_instance, 'new', 'Synthetic acceptance fixture: reopening.');
  EXCEPTION
    WHEN OTHERS THEN
      v_backwards_state := SQLSTATE;
  END;
  PERFORM
    pg_temp.wl_assert (v_backwards_state = '22023', format('a Watchlist signal was moved backwards, SQLSTATE %s', COALESCE(v_backwards_state, 'none, it was accepted')));

  PERFORM
    pg_temp.wl_sign_out ();

  SELECT
    count(*) INTO v_after
  FROM
    public.watchlist_signal_dispositions
  WHERE
    signal_instance_id = v_instance;
  PERFORM
    pg_temp.wl_assert (v_after = v_before + 1, format('one transition should write exactly one ledger row, %s were written', v_after - v_before));

  SELECT
    d.from_status,
    d.to_status,
    d.note,
    d.actor_kind,
    d.acted_by,
    d.acted_by_role,
    d.acted_at INTO v_row
  FROM
    public.watchlist_signal_dispositions d
  WHERE
    d.signal_instance_id = v_instance
  ORDER BY
    d.ledger_seq DESC
  LIMIT 1;

  PERFORM
    pg_temp.wl_assert (v_row.from_status = 'new'
      AND v_row.to_status = 'acknowledged', 'the ledger row does not record the transition that happened');
  PERFORM
    pg_temp.wl_assert (v_row.actor_kind = 'user'
      AND v_row.acted_by = v_reviewer, 'the ledger row does not name the reviewer who acted');
  PERFORM
    pg_temp.wl_assert (v_row.acted_by_role IS NOT NULL, 'the ledger row does not record the role the reviewer held');
  PERFORM
    pg_temp.wl_assert (char_length(btrim(COALESCE(v_row.note, ''))) > 0, 'the ledger row carries no line about what was done');
  PERFORM
    pg_temp.wl_assert (v_row.acted_at IS NOT NULL, 'the ledger row carries no time');

  -- Append only, by policy and by grant.
  PERFORM
    pg_temp.wl_assert (NOT EXISTS (
        SELECT
          1
        FROM
          pg_catalog.pg_policies
        WHERE
          schemaname = 'public'
          AND tablename = 'watchlist_signal_dispositions'
          AND cmd IN ('UPDATE', 'DELETE')), 'public.watchlist_signal_dispositions grew an UPDATE or DELETE policy; the survey ledger is append only');
  PERFORM
    pg_temp.wl_assert (NOT EXISTS (
        SELECT
          1
        FROM
          information_schema.role_table_grants
        WHERE
          table_schema = 'public'
          AND table_name = 'watchlist_signal_dispositions'
          AND grantee = 'authenticated'
          AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')), 'authenticated holds a write grant on the disposition ledger');

  INSERT INTO wl_result (check_name, detail)
    VALUES ('disposition ledger', 'a transition wrote exactly one append only row carrying the from status, the to status, the reviewer, their role, the line they wrote and the time; a transition with nothing written and a transition backwards were both refused; the ledger holds no UPDATE or DELETE policy and no write grant to authenticated');
END
$$;

-- ---------------------------------------------------------------------------
-- 4. observation_gap is a documentation signal, and cannot make a resident look
--    like they are declining.
--
--    Spec section 7.2. This is the one that matters most on the page: a
--    building that is behind on its paperwork must not read as a building full
--    of residents in trouble.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000003';
  v_gap_only uuid;
  v_band text;
  v_clinical integer;
BEGIN
  PERFORM
    pg_temp.wl_assert (EXISTS (
        SELECT
          1
        FROM
          public.watchlist_signal_instances
        WHERE
          facility_id = v_facility
          AND signal_key = 'observation_gap'
          AND source_kind = 'data_quality'), 'observation_gap did not fire, or is not classed as a data quality signal');

  PERFORM
    pg_temp.wl_assert (NOT EXISTS (
        SELECT
          1
        FROM
          public.watchlist_signal_instances
        WHERE
          facility_id = v_facility
          AND signal_key = 'observation_gap'
          AND source_kind <> 'data_quality'), 'an observation_gap instance is classed as clinical');

  -- A resident whose only open signal is the documentation one.
  SELECT
    i.resident_id INTO v_gap_only
  FROM
    public.watchlist_signal_instances i
  WHERE
    i.facility_id = v_facility
    AND i.status <> 'cleared'
    AND i.deleted_at IS NULL
  GROUP BY
    i.resident_id
  HAVING
    count(*) FILTER (WHERE i.source_kind = 'clinical') = 0
    AND count(*) FILTER (WHERE i.signal_key = 'observation_gap') = 1
  LIMIT 1;
  PERFORM
    pg_temp.wl_assert (v_gap_only IS NOT NULL, 'the fixture produced no resident whose only open signal is the documentation one');

  SELECT
    b.band_key INTO v_band
  FROM
    public.watchlist_band_for_resident (v_gap_only) b;
  PERFORM
    pg_temp.wl_assert (v_band = 'needs_a_look', format('a resident carrying nothing but a documentation lapse reads as %s rather than needs_a_look', v_band));

  SELECT
    count(*) INTO v_clinical
  FROM
    public.v_watchlist_facility w
  WHERE
    w.facility_id = v_facility
    AND w.source_kind = 'clinical';

  INSERT INTO wl_result (check_name, detail)
    VALUES ('observation_gap is data quality', format('every observation_gap instance is classed data_quality, and a resident carrying nothing but one reads as Needs a look and never higher; %s clinical signals are open alongside them', v_clinical));
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Acceptance item 10. No resident level number anywhere.
--
--    Two assertions, because the name check alone is decoration. The first is
--    the one with teeth: severity_weight is the only number a resident level
--    composite could be built out of, and it appears on no view that carries a
--    resident_id. The second catches a column that arrives later calling itself
--    a score.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leak text;
BEGIN
  SELECT
    string_agg(format('%s.%s', c.table_name, c.column_name), ', ' ORDER BY c.table_name, c.column_name) INTO v_leak
  FROM
    information_schema.columns c
  WHERE
    c.table_schema = 'public'
    AND c.table_name IN ('v_watchlist_facility', 'v_watchlist_portfolio', 'v_facility_risk_index')
    AND c.column_name = 'severity_weight'
    AND EXISTS (
      SELECT
        1
      FROM
        information_schema.columns peer
      WHERE
        peer.table_schema = c.table_schema
        AND peer.table_name = c.table_name
        AND peer.column_name = 'resident_id');
  PERFORM
    pg_temp.wl_assert (v_leak IS NULL, format('a resident level view exposes a signal weight: %s. Summed per resident that is the composite score spec section 7.1 removed.', v_leak));

  SELECT
    string_agg(format('%s.%s', c.table_name, c.column_name), ', ' ORDER BY c.table_name, c.column_name) INTO v_leak
  FROM
    information_schema.columns c
  WHERE
    c.table_schema = 'public'
    AND c.table_name IN ('v_watchlist_facility', 'v_watchlist_portfolio', 'v_facility_risk_index')
    AND c.column_name ~ '(score|percent|rating|points|grade|composite|tier)'
    AND EXISTS (
      SELECT
        1
      FROM
        information_schema.columns peer
      WHERE
        peer.table_schema = c.table_schema
        AND peer.table_name = c.table_name
        AND peer.column_name = 'resident_id');
  PERFORM
    pg_temp.wl_assert (v_leak IS NULL, format('a resident level view grew a scored column: %s', v_leak));

  -- The facility composite is facility level, which is the whole reason it is
  -- allowed to exist.
  PERFORM
    pg_temp.wl_assert (NOT EXISTS (
        SELECT
          1
        FROM
          information_schema.columns
        WHERE
          table_schema = 'public'
          AND table_name = 'v_facility_risk_index'
          AND column_name = 'resident_id'), 'public.v_facility_risk_index grew a resident_id; a composite on a resident row is exactly what this module removed');

  -- And the band a resident carries is a word.
  PERFORM
    pg_temp.wl_assert ((
      SELECT
        data_type
      FROM information_schema.columns
      WHERE
        table_schema = 'public'
        AND table_name = 'v_watchlist_facility'
        AND column_name = 'band_label') = 'text', 'the band a resident carries is no longer text');

  INSERT INTO wl_result (check_name, detail)
    VALUES ('no resident level number', 'no view carrying a resident_id exposes a signal weight or any column named as a score, percentage, rating or tier; the facility composite carries no resident_id; the band is text. The numbers that remain on a resident row are a count of named signals, an age in days and a band rank, each of which traces to rows a reader can open.');
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Acceptance item 9. The measured Acute volume.
--
--    Measured, not targeted. The fixture is authored, so this number describes
--    the fixture as much as the thresholds, and it is printed rather than tuned.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000003';
  v_portfolio record;
  v_census integer;
BEGIN
  SELECT
    p.residents_on_watchlist,
    p.open_signal_count,
    p.open_acute_signal_count,
    p.acute_resident_count,
    p.data_quality_signal_count,
    p.worst_band_label,
    p.trend_direction,
    p.risk_index_latest INTO v_portfolio
  FROM
    public.v_watchlist_portfolio p
  WHERE
    p.facility_id = v_facility;

  SELECT
    count(*) INTO v_census
  FROM
    public.residents
  WHERE
    facility_id = v_facility
    AND deleted_at IS NULL
    AND status = 'active';

  INSERT INTO wl_result (check_name, detail)
    VALUES ('acute volume, measured', format('%s residents of %s are on the Watchlist. %s open signals, of which %s are documentation signals. %s residents are in the Acute band, carrying %s open clinical signals between them. Worst band in the building: %s. Ninety day facility trend: %s, latest index %s. Measured against a synthetic fixture, which is not real data.', v_portfolio.residents_on_watchlist, v_census, v_portfolio.open_signal_count, v_portfolio.data_quality_signal_count, v_portfolio.acute_resident_count, v_portfolio.open_acute_signal_count, COALESCE(v_portfolio.worst_band_label, 'none'), v_portfolio.trend_direction, v_portfolio.risk_index_latest));
END
$$;

-- ---------------------------------------------------------------------------
-- 7. A second evaluation is idempotent, and closes what stopped being true.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_facility CONSTANT uuid := 'c0de0005-0000-4000-8000-000000000003';
  v_result jsonb;
  v_open_before integer;
  v_open_after integer;
  v_cleared integer;
BEGIN
  SELECT
    count(*) INTO v_open_before
  FROM
    public.watchlist_signal_instances
  WHERE
    facility_id = v_facility
    AND status <> 'cleared';

  v_result := public.evaluate_watchlist_signals (v_facility);
  PERFORM
    pg_temp.wl_assert ((v_result ->> 'opened')::integer = 0, format('a second evaluation with nothing changed opened %s signals', v_result ->> 'opened'));
  PERFORM
    pg_temp.wl_assert ((v_result ->> 'cleared')::integer = 0, format('a second evaluation with nothing changed closed %s signals', v_result ->> 'cleared'));

  -- Now the Monitoring Order is stood down, and its signal has to go with it.
  UPDATE
    public.resident_monitoring_orders
  SET
    status = 'completed'
  WHERE
    facility_id = v_facility
    AND status = 'active';

  v_result := public.evaluate_watchlist_signals (v_facility);
  v_cleared := (v_result ->> 'cleared')::integer;
  PERFORM
    pg_temp.wl_assert (v_cleared >= 1, 'standing the Monitoring Order down did not close its Watchlist signal');

  SELECT
    count(*) INTO v_open_after
  FROM
    public.watchlist_signal_instances
  WHERE
    facility_id = v_facility
    AND status <> 'cleared';
  PERFORM
    pg_temp.wl_assert (v_open_after < v_open_before, 'the closed signal is still open');

  PERFORM
    pg_temp.wl_assert (EXISTS (
        SELECT
          1
        FROM
          public.watchlist_signal_dispositions
        WHERE
          facility_id = v_facility
          AND to_status = 'cleared'
          AND actor_kind = 'system'
          AND acted_by IS NULL), 'the evaluator closed a signal without leaving a system row in the ledger, or claimed a person did it');

  INSERT INTO wl_result (check_name, detail)
    VALUES ('idempotent, and it closes', format('a second evaluation with nothing changed opened nothing and closed nothing; standing the Monitoring Order down closed %s signal, recorded in the ledger as a system transition that names nobody', v_cleared));
END
$$;

SELECT
  check_name AS "check",
  detail
FROM
  wl_result
ORDER BY
  seq;

DO $$
BEGIN
  RAISE NOTICE 'watchlist-acceptance PASS';
END
$$;

ROLLBACK;
