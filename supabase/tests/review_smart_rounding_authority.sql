-- Smart Rounding (spec 25A) authority probe.
--
-- The module shipped eleven tables, a compliance function and a dozen RPCs with
-- no probe coverage at all. scripts/pg-verify-migrations.mjs replays every
-- migration and then runs every review_*.sql, which makes this file the module's
-- only regression net: a later migration that loosens one of these is caught
-- here rather than in production.
--
-- Each assertion names what it protects. Read the message before changing the
-- probe.
--
-- Everything runs inside one transaction that rolls back. All fixture data is
-- synthetic: no resident, no staff member and no facility here corresponds to a
-- real one, and nothing is selected or seeded by facility name.
BEGIN;

SET LOCAL client_min_messages = warning;

CREATE FUNCTION pg_temp.sr_assert (ok boolean, msg text)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION '25A smart rounding authority: %', msg;
  END IF;
END
$$;

-- A note on how the source matching below is written.
--
-- Every one of these tests uses strpos, never LIKE. Underscore is a single
-- character wildcard in LIKE, and every identifier in this module has one, so
-- `prosrc LIKE '%orphaned_shift%'` matches the words "orphaned shift" in a
-- comment and passes against a body that no longer contains the code. That is
-- exactly what happened while this file was being written: the assertion held
-- green against a deliberately broken build. A check that reads like protection
-- and is not is worse than no check, which is the COL-391 lesson in
-- review_col37_security_advisor.sql. strpos is an exact substring search and has
-- no wildcards at all.

-- ---------------------------------------------------------------------------
-- 1. public.observation_compliance_for_range runs on the caller's authority.
--
-- Every compliance number in the module comes from this one function. As a
-- definer it would answer for every facility in the database whatever the
-- reader could reach, which is how a facility administrator ends up reading
-- another building's compliance. Invoker rights are the whole access control
-- story for the compliance read.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_definer boolean;
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
    pg_temp.sr_assert (v_definer IS NOT NULL, 'public.observation_compliance_for_range is gone. Every compliance read in the module goes through it.');
  PERFORM
    pg_temp.sr_assert (v_definer = FALSE, 'public.observation_compliance_for_range became SECURITY DEFINER. Row level security on residents, facilities and the task tables is the only thing scoping a compliance read to the caller''s buildings, and a definer bypasses all of it.');

  PERFORM
    pg_temp.sr_assert (NOT pg_catalog.has_function_privilege ('anon', 'public.observation_compliance_for_range(uuid,date,date)', 'EXECUTE'), 'anon can execute public.observation_compliance_for_range; the publishable key can read resident level compliance.');
  PERFORM
    pg_temp.sr_assert (pg_catalog.has_function_privilege ('authenticated', 'public.observation_compliance_for_range(uuid,date,date)', 'EXECUTE'), 'authenticated lost EXECUTE on public.observation_compliance_for_range; every rounding surface reads compliance through it.');
  PERFORM
    pg_temp.sr_assert (pg_catalog.has_function_privilege ('service_role', 'public.observation_compliance_for_range(uuid,date,date)', 'EXECUTE'), 'service_role lost EXECUTE on public.observation_compliance_for_range.');
END
$$;

-- ---------------------------------------------------------------------------
-- 2. anon holds nothing on any of the module's twenty five tables.
--
-- anon is the publishable key. Every one of these tables carries either
-- resident clinical instructions, the ladder that decides who gets woken up, or
-- the record of who was told what about a missed check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_tables CONSTANT text[] := ARRAY['facility_shift_definitions', 'facility_cadence_versions', 'facility_cadence_windows', 'resident_monitoring_orders', 'resident_monitoring_order_events', 'resident_monitoring_order_notifications', 'facility_escalation_versions', 'facility_escalation_rungs', 'facility_escalation_rung_shift_overrides', 'observation_escalation_dispatches', 'observation_escalation_deliveries', 'watchlist_signal_rules', 'watchlist_band_rules', 'watchlist_signal_instances', 'watchlist_signal_dispositions', 'watchlist_signal_notifications', 'cadence_templates', 'cadence_template_versions', 'cadence_template_windows', 'escalation_templates', 'escalation_template_versions', 'escalation_template_rungs', 'facility_config_template_bindings', 'jurisdiction_observation_floors', 'facility_observation_thresholds'];
  v_table text;
  v_anon text;
  v_rls boolean;
BEGIN
  FOREACH v_table IN ARRAY c_tables LOOP
    SELECT
      c.relrowsecurity INTO v_rls
    FROM
      pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE
      n.nspname = 'public'
      AND c.relname = v_table;
    PERFORM
      pg_temp.sr_assert (v_rls IS NOT NULL, format('public.%s is gone; the 25A module declared it.', v_table));
    PERFORM
      pg_temp.sr_assert (v_rls, format('public.%s has row level security disabled. Every table in this module is facility scoped and none of it is public.', v_table));

    SELECT
      string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type) INTO v_anon
    FROM
      information_schema.role_table_grants g
    WHERE
      g.table_schema = 'public'
      AND g.table_name = v_table
      AND g.grantee = 'anon';
    PERFORM
      pg_temp.sr_assert (v_anon IS NULL, format('anon holds %s on public.%s. That is the publishable key reading clinical monitoring configuration.', v_anon, v_table));
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. The service only commands stay off authenticated.
--
-- Each of these is a SECURITY DEFINER that writes on nobody's authority: the
-- task generator, the escalation engine and the expiry job call them as
-- service_role. Reachable from a signed in session, each one is a way to write
-- task rows, fire an escalation at the on call administrator, or stand orders
-- down, without passing the command that checks whether the caller may.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_service_only CONSTANT text[] := ARRAY['public.record_cadence_observation_tasks(jsonb)', 'public.generate_monitoring_order_tasks(uuid,timestamptz)', 'public.record_observation_escalation_rung(uuid,text,timestamptz)', 'public.expire_monitoring_orders()', 'public.advance_observation_task_lapse(uuid,uuid,timestamptz)', 'public.ensure_facility_observation_defaults(uuid)', 'public.fn_facilities_seed_observation_defaults()', 'public.resolve_observation_task_assignees(uuid,date,text,uuid[])', 'public.record_observation_staffing_gap(uuid,text,date)', 'public.observation_windows_under_monitoring_order(uuid,timestamptz)', 'public.reinstate_standard_observation_windows(uuid,timestamptz)', 'public.claim_observation_escalation_deliveries(uuid,uuid,uuid,timestamptz,integer)', 'public.record_observation_escalation_delivery_outcome(uuid,uuid,text,text,text,text,timestamptz,boolean,integer)', 'public.stand_down_ungenerated_observation_tasks(uuid,timestamptz)', 'haven.observation_escalation_recipients(uuid,uuid,uuid,uuid)', 'haven.notify_monitoring_order_created(uuid)', 'public.evaluate_watchlist_signals(uuid,timestamptz)', 'haven.notify_watchlist_acute(uuid,timestamptz)', 'haven.apply_observation_config_activation(text,uuid,timestamptz,uuid,boolean)', 'haven.replay_observation_windows(uuid,date,date,uuid,uuid)', 'public.activate_due_scheduled_config_versions(uuid,uuid,timestamptz)'];
  v_fn text;
  v_role text;
BEGIN
  FOREACH v_fn IN ARRAY c_service_only LOOP
    PERFORM
      pg_temp.sr_assert (to_regprocedure(v_fn) IS NOT NULL, format('%s is gone; the 25A module declared it as a service only command.', v_fn));
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      PERFORM
        pg_temp.sr_assert (NOT pg_catalog.has_function_privilege (v_role, v_fn, 'EXECUTE'), format('%s can execute %s. It is a SECURITY DEFINER that writes on nobody''s authority and only the cron callers are meant to reach it.', v_role, v_fn));
    END LOOP;
    PERFORM
      pg_temp.sr_assert (pg_catalog.has_function_privilege ('service_role', v_fn, 'EXECUTE')
        -- A trigger function is authorized at CREATE TRIGGER time, so the
        -- facilities seeder is allowed to hold nothing at all.
        OR v_fn = 'public.fn_facilities_seed_observation_defaults()', format('service_role lost EXECUTE on %s; the cron caller is the only caller it has.', v_fn));
  END LOOP;
END
$$;

-- The two commands a signed in caller is supposed to reach, kept reachable, so
-- a blanket revoke sweep cannot quietly take the product's own write paths out.
DO $$
DECLARE
  c_caller_facing CONSTANT text[] := ARRAY['public.create_monitoring_order(uuid,integer,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text)', 'public.cancel_monitoring_order(uuid,text)', 'public.submit_observation(uuid,jsonb,text,text,text,text,text,text[],timestamptz,text,uuid,boolean,uuid,text,uuid,integer)', 'public.disposition_watchlist_signal(uuid,text,text)', 'public.watchlist_rules_for_facility(uuid)', 'public.watchlist_band_for_resident(uuid)', 'public.create_cadence_version(uuid,text,jsonb,jsonb,timestamptz,uuid,uuid)', 'public.activate_cadence_version(text,uuid,uuid,text,timestamptz,text)', 'public.rollback_cadence_version(uuid,text,uuid,uuid,text,timestamptz,text)', 'public.apply_template_to_facilities(uuid[],text,uuid,uuid,text,timestamptz,text)', 'public.validate_cadence_version(uuid,uuid)', 'public.simulate_cadence_change(uuid,uuid,uuid,integer)', 'public.send_test_escalation(uuid,text)', 'public.observation_config_overview(uuid,uuid,uuid)', 'public.observation_config_change_log(uuid,integer)', 'public.observation_escalation_role_holders(uuid,uuid)', 'public.cadence_version_day_shape(uuid)', 'public.facility_observation_jurisdiction_floor(uuid,date)', 'public.facility_next_shift_boundary_at(uuid,timestamptz)', 'public.facility_is_shift_boundary(uuid,timestamptz)', 'public.facility_config_template_drift(timestamptz,uuid)'];
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY c_caller_facing LOOP
    PERFORM
      pg_temp.sr_assert (to_regprocedure(v_fn) IS NOT NULL, format('%s is gone.', v_fn));
    PERFORM
      pg_temp.sr_assert (NOT pg_catalog.has_function_privilege ('anon', v_fn, 'EXECUTE'), format('anon can execute %s.', v_fn));
    PERFORM
      pg_temp.sr_assert (pg_catalog.has_function_privilege ('authenticated', v_fn, 'EXECUTE'), format('authenticated lost EXECUTE on %s; this is an operator write path.', v_fn));
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Every SECURITY DEFINER in the module carries an explicit search_path.
--
-- A definer without one resolves unqualified names through whatever search_path
-- the caller set, which is the classic privilege escalation: create a schema,
-- put your own residents table in it, call the definer.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_module CONSTANT text[] := ARRAY['facility_cadence_in_force', 'facility_observation_windows_for_version', 'facility_observation_windows_for_date', 'facility_shift_window_at', 'facility_next_shift_window', 'facility_next_shift_observation_windows', 'record_cadence_observation_tasks', 'can_record_observation', 'can_cancel_monitoring_order', 'observation_grace_formula', 'monitoring_order_grace_minutes', 'generate_monitoring_order_tasks', 'notify_monitoring_order_created', 'create_monitoring_order', 'cancel_monitoring_order', 'expire_monitoring_orders', 'record_monitoring_order_event', 'monitoring_order_reason_from_watch_source', 'monitoring_order_bridge_defaults', 'bridge_watch_instance_to_monitoring_order', 'monitoring_order_interval_options', 'submit_observation', 'observation_quick_status_label', 'observation_vocab_label', 'compose_observation_summary', 'haven_compose_observation_summary', 'facility_escalation_in_force', 'observation_grace_minutes', 'observation_task_window_close', 'observation_escalation_rungs_at', 'observation_escalations_due', 'observation_escalation_recipients', 'record_observation_escalation_rung', 'advance_observation_task_lapse', 'send_test_escalation', 'observation_compliance_for_range', 'ensure_facility_observation_defaults', 'fn_facilities_seed_observation_defaults', 'assert_monitoring_order_facility_matches_resident', 'resolve_observation_task_assignees', 'record_observation_staffing_gap', 'monitoring_order_covers_window', 'facility_observation_windows_in_span', 'observation_windows_under_monitoring_order', 'reinstate_standard_observation_windows', 'monitoring_order_in_force_until', 'stamp_monitoring_order_closed_at', 'can_disposition_watchlist_signal', 'watchlist_rules_for_facility', 'watchlist_band_for_resident', 'evaluate_watchlist_signals', 'notify_watchlist_acute', 'disposition_watchlist_signal', 'record_watchlist_disposition', 'can_edit_observation_config', 'can_propose_observation_config', 'can_read_observation_config', 'facility_observation_jurisdiction_floor', 'cadence_version_day_shape', 'facility_next_shift_boundary_at', 'facility_is_shift_boundary', 'observation_escalation_role_holders', 'validate_cadence_version', 'apply_observation_config_activation', 'create_cadence_version', 'activate_cadence_version', 'rollback_cadence_version', 'apply_template_to_facilities', 'facility_config_template_drift', 'replay_observation_windows', 'simulate_cadence_change', 'observation_config_change_log', 'observation_config_overview', 'activate_due_scheduled_config_versions', 'haven_seed_facility_observation_thresholds'];
  v_bad text;
  v_found integer;
BEGIN
  SELECT
    count(*) INTO v_found
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname IN ('public', 'haven')
    AND p.proname = ANY (c_module);
  PERFORM
    pg_temp.sr_assert (v_found >= array_length(c_module, 1), format('only %s of the %s named 25A functions exist. A function in this list was renamed or dropped; update the list deliberately rather than letting the coverage shrink.', v_found, array_length(c_module, 1)));

  SELECT
    string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname) INTO v_bad
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname IN ('public', 'haven')
    AND p.proname = ANY (c_module)
    AND p.prosecdef
    AND NOT EXISTS (
      SELECT
        1
      FROM
        unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
      WHERE
        cfg LIKE 'search\_path=%');
  PERFORM
    pg_temp.sr_assert (v_bad IS NULL, format('these 25A SECURITY DEFINER functions have no explicit search_path: %s. An unqualified name in a definer body resolves through the caller''s search_path.', v_bad));
END
$$;

-- ---------------------------------------------------------------------------
-- 5. The four append only ledgers have no UPDATE and no DELETE policy.
--
-- resident_monitoring_order_events is the record of what a clinical order said
-- and when it changed. The two escalation ledgers are the record of what fired
-- and who was told. watchlist_signal_dispositions is the survey artifact: the
-- facility identified the risk on a date, a named person reviewed it, this is
-- what was done. A row that can be edited afterwards is not evidence.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_ledgers CONSTANT text[] := ARRAY['resident_monitoring_order_events', 'observation_escalation_dispatches', 'observation_escalation_deliveries', 'watchlist_signal_dispositions'];
  v_table text;
  v_policies text;
  v_grants text;
BEGIN
  FOREACH v_table IN ARRAY c_ledgers LOOP
    SELECT
      string_agg(pol.polname || ' (' || pol.polcmd::text || ')', ', ' ORDER BY pol.polname) INTO v_policies
    FROM
      pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE
      n.nspname = 'public'
      AND c.relname = v_table
      AND pol.polcmd::text IN ('w', 'd', '*');
    PERFORM
      pg_temp.sr_assert (v_policies IS NULL, format('public.%s gained an UPDATE or DELETE policy: %s. It is an append only ledger and the history is the evidence.', v_table, v_policies));

    SELECT
      string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type) INTO v_grants
    FROM
      information_schema.role_table_grants g
    WHERE
      g.table_schema = 'public'
      AND g.table_name = v_table
      AND g.grantee = 'authenticated'
      AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
    PERFORM
      pg_temp.sr_assert (v_grants IS NULL, format('authenticated holds %s on public.%s. A signed in caller must not be able to write an append only ledger directly; the definer commands write it.', v_grants, v_table));
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. M2. Every UPDATE policy in the module repeats the facility predicate in
--    its WITH CHECK clause.
--
-- USING decides which row a caller may touch. WITH CHECK decides what the row is
-- allowed to become. Seven policies carried the predicate in USING and dropped
-- it from WITH CHECK, so a caller could read a row inside their scope and write
-- it into a facility outside it, in one statement, landing the row somewhere
-- they can no longer see.
--
-- Asserted on all seven by policy text, and demonstrated below on the two whose
-- role list admits a facility scoped caller. For the other five the role list is
-- owner and org_admin, both of which reach every facility in the organization by
-- definition, so the predicate is defence in depth there rather than the thing
-- refusing today. It has to be present all the same: the role list is the part
-- most likely to widen.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_policies CONSTANT text[] := ARRAY['facility_shift_definitions.facility_shift_definitions_update', 'facility_cadence_versions.facility_cadence_versions_update', 'facility_cadence_windows.facility_cadence_windows_update', 'resident_monitoring_orders.resident_monitoring_orders_update', 'facility_escalation_versions.facility_escalation_versions_update', 'facility_escalation_rungs.facility_escalation_rungs_update', 'facility_escalation_rung_shift_overrides.facility_escalation_rung_shift_overrides_update', 'watchlist_signal_rules.watchlist_signal_rules_update', 'watchlist_band_rules.watchlist_band_rules_update', 'facility_observation_thresholds.facility_observation_thresholds_update'];
  v_entry text;
  v_table text;
  v_policy text;
  v_using text;
  v_check text;
BEGIN
  FOREACH v_entry IN ARRAY c_policies LOOP
    v_table := split_part(v_entry, '.', 1);
    v_policy := split_part(v_entry, '.', 2);

    SELECT
      pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
      pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) INTO v_using,
      v_check
    FROM
      pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE
      n.nspname = 'public'
      AND c.relname = v_table
      AND pol.polname = v_policy;

    PERFORM
      pg_temp.sr_assert (v_using IS NOT NULL, format('the UPDATE policy %s on public.%s is gone.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (strpos(v_using, 'accessible_facility_ids') > 0, format('%s on public.%s lost the facility predicate from USING.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (v_check IS NOT NULL, format('%s on public.%s has no WITH CHECK clause at all, so its USING clause is reused and any row it can read it can write anywhere.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (strpos(v_check, 'accessible_facility_ids') > 0, format('%s on public.%s dropped the facility predicate from WITH CHECK. A caller can read a row inside their scope and write it into a facility outside it.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (strpos(v_check, 'organization_id') > 0, format('%s on public.%s dropped the organization predicate from WITH CHECK.', v_policy, v_table));
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. M1. The contents of a version in force are not editable.
--
-- The gist exclusion constraint on both version tables guards the version
-- timeline. Nothing guarded version contents, so an org_admin could rewrite the
-- offsets, channels, recipients or protocol text of the escalation ladder
-- currently in force, in place, and every escalation row already stamped with
-- that version then recomputed against a ladder that was never in force.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_policies CONSTANT text[] := ARRAY['facility_cadence_windows.facility_cadence_windows_update.facility_cadence_versions', 'facility_escalation_rungs.facility_escalation_rungs_update.facility_escalation_versions', 'facility_escalation_rung_shift_overrides.facility_escalation_rung_shift_overrides_update.facility_escalation_versions'];
  v_entry text;
  v_table text;
  v_policy text;
  v_parent text;
  v_using text;
  v_check text;
BEGIN
  FOREACH v_entry IN ARRAY c_policies LOOP
    v_table := split_part(v_entry, '.', 1);
    v_policy := split_part(v_entry, '.', 2);
    v_parent := split_part(v_entry, '.', 3);

    SELECT
      pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
      pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) INTO v_using,
      v_check
    FROM
      pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE
      n.nspname = 'public'
      AND c.relname = v_table
      AND pol.polname = v_policy;

    PERFORM
      pg_temp.sr_assert (strpos(v_using, v_parent) > 0
        AND strpos(v_using, 'draft') > 0
        AND strpos(v_using, 'pending_approval') > 0, format('%s on public.%s no longer requires its parent version be draft or pending_approval in USING. The version in force became editable in place.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (strpos(v_check, v_parent) > 0
        AND strpos(v_check, 'draft') > 0
        AND strpos(v_check, 'pending_approval') > 0, format('%s on public.%s no longer requires its parent version be draft or pending_approval in WITH CHECK, so a row can be reattached from a draft to the version in force.', v_policy, v_table));
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 8. The Monitoring Order facility and its resident's facility are one fact,
--    and the trigger that says so fires AFTER, so row level security answers
--    an out of scope caller first.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_timing text;
BEGIN
  SELECT
    CASE WHEN (t.tgtype & 2) = 2 THEN
      'BEFORE'
    ELSE
      'AFTER'
    END INTO v_timing
  FROM
    pg_catalog.pg_trigger t
  WHERE
    t.tgrelid = 'public.resident_monitoring_orders'::regclass
    AND t.tgname = 'tr_resident_monitoring_orders_facility_matches_resident';

  PERFORM
    pg_temp.sr_assert (v_timing IS NOT NULL, 'tr_resident_monitoring_orders_facility_matches_resident is gone. Nothing then stops an order being moved into a building its resident does not live in.');
  PERFORM
    pg_temp.sr_assert (v_timing = 'AFTER', 'tr_resident_monitoring_orders_facility_matches_resident became a BEFORE trigger. It then raises before row level security has had a chance to answer, and an out of scope caller learns a facility exists instead of getting an empty result.');
END
$$;

-- ---------------------------------------------------------------------------
-- 9. The Monitoring Order history records more than a status transition.
--
-- The trigger used to return early whenever status was unchanged, so the
-- interval a resident is physically checked at, who ordered it, how the order
-- arrived and the clinical reason could all be rewritten on an active order with
-- no history row at all.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'haven'
    AND p.proname = 'record_monitoring_order_event';

  PERFORM
    pg_temp.sr_assert (v_src IS NOT NULL, 'haven.record_monitoring_order_event is gone; the Monitoring Order ledger is written by nothing.');
  PERFORM
    pg_temp.sr_assert (v_src NOT LIKE '%NEW.status IS NOT DISTINCT FROM OLD.status THEN%RETURN NEW%', 'haven.record_monitoring_order_event returns early when only the status is unchanged again. Every non status field on an active clinical order then changes with no history row.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'interval_minutes') > 0, 'haven.record_monitoring_order_event no longer names interval_minutes among the fields it records. That column is how often a resident is looked at.');

  PERFORM
    pg_temp.sr_assert (EXISTS (
        SELECT
          1
        FROM
          information_schema.columns c
        WHERE
          c.table_schema = 'public'
          AND c.table_name = 'resident_monitoring_order_events'
          AND c.column_name = 'changed_fields'), 'public.resident_monitoring_order_events.changed_fields is gone; a history row can no longer name what changed.');
END
$$;

-- ---------------------------------------------------------------------------
-- 9b. Monitoring Order suppression is per window and ending an order hands the
--     resident back.
--
-- Suppression used to be one instant test per resident, so an order starting
-- later today let the resident collect standard tasks across the order's hours,
-- and an order ending three hours into a twelve hour shift left the resident
-- with no task of any kind until the next tick. Behaviour is proved in
-- scripts/smart-rounding/order-boundary-acceptance.sql; what is held here is that
-- the three callers still go through the one overlap definition and that ending
-- an order still reinstates.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src text;
BEGIN
  PERFORM
    pg_temp.sr_assert (to_regprocedure('haven.monitoring_order_covers_window(timestamptz,timestamptz,timestamptz,timestamptz)') IS NOT NULL, 'haven.monitoring_order_covers_window is gone. It is the single definition of when an order owns a standard window, and three callers read it.');

  -- The excuse lives in haven.place_monitoring_order, the internal both entry
  -- points delegate to. Migration 426 moved it there; before that it was inline
  -- in create_monitoring_order, which is why this assertion names the internal
  -- and section 9f separately holds the delegation in place.
  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'haven'
    AND p.proname = 'place_monitoring_order';
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'monitoring_order_covers_window') > 0, 'placing a Monitoring Order no longer excuses on the window overlap test. The 416 predicate was due_at > starts_at with no upper bound, so an order ending at midday excused that evening and that night as well and nothing ever put them back.');

  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'observation_windows_under_monitoring_order';
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'monitoring_order_covers_window') > 0, 'public.observation_windows_under_monitoring_order stopped using the shared overlap test, so the generator and the create command can now disagree about which windows an order owns.');

  FOR v_src IN
  SELECT
    p.prosrc
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname IN ('cancel_monitoring_order', 'expire_monitoring_orders') LOOP
      PERFORM
        pg_temp.sr_assert (strpos(v_src, 'reinstate_standard_observation_windows') > 0, 'cancelling or expiring a Monitoring Order no longer reinstates the standard cadence. A resident coming off an order is somebody who just fell or just came back from hospital, and without this they have no observation task at all until the next generator tick.');
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 9c. M5. A window's shift_key is a reference, not a string.
--
-- facility_cadence_windows.shift_key carried a regex CHECK and nothing tying it
-- to a shift. `night` mistyped as `nights` took the window out of generation,
-- because public.facility_next_shift_observation_windows filters on the key, and
-- left it in the compliance expectation, because
-- public.facility_observation_windows_for_version joins no shift table. The
-- window becomes a permanent silent miss for every resident every day: no task,
-- so no ladder and no alert, and a compliance number counting it against the
-- building forever.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_referencing CONSTANT text[] := ARRAY['facility_cadence_windows', 'facility_escalation_rung_shift_overrides'];
  v_table text;
  v_def text;
  v_unique boolean;
BEGIN
  -- The parent side. Unconditional, because a partial unique index cannot back a
  -- foreign key, and because soft deleting a shift and creating a second one on
  -- the same key would silently re-point every window and override at it.
  SELECT
    EXISTS (
      SELECT
        1
      FROM
        pg_catalog.pg_constraint con
      WHERE
        con.conrelid = 'public.facility_shift_definitions'::regclass
        AND con.contype = 'u'
        AND pg_catalog.pg_get_constraintdef(con.oid) = 'UNIQUE (facility_id, shift_key)') INTO v_unique;
  PERFORM
    pg_temp.sr_assert (v_unique, 'public.facility_shift_definitions lost its unconditional UNIQUE (facility_id, shift_key). Nothing can reference a shift key without it, and two rows on one key silently re-point every window that names it.');

  FOREACH v_table IN ARRAY c_referencing LOOP
    SELECT
      pg_catalog.pg_get_constraintdef(con.oid) INTO v_def
    FROM
      pg_catalog.pg_constraint con
    WHERE
      con.conrelid = ('public.' || v_table)::regclass
      AND con.contype = 'f'
      AND con.confrelid = 'public.facility_shift_definitions'::regclass;

    PERFORM
      pg_temp.sr_assert (v_def IS NOT NULL, format('public.%s.shift_key no longer references public.facility_shift_definitions. A one character typo then takes the row out of generation and leaves it in the compliance expectation forever.', v_table));
    PERFORM
      pg_temp.sr_assert (strpos(v_def, '(facility_id, shift_key)') > 0, format('the shift reference on public.%s is not the composite (facility_id, shift_key): %s. A key alone is not unique across buildings.', v_table, v_def));
    PERFORM
      pg_temp.sr_assert (strpos(v_def, 'ON UPDATE CASCADE') > 0, format('the shift reference on public.%s lost ON UPDATE CASCADE, so renaming a shift is now impossible rather than propagated. A rename is a real operation the settings surface needs.', v_table));
    PERFORM
      pg_temp.sr_assert (strpos(v_def, 'ON DELETE RESTRICT') > 0, format('the shift reference on public.%s no longer restricts delete, so a shift can be removed out from under the rows that name it.', v_table));
  END LOOP;

  -- The residual hole the foreign key cannot close: a shift that is deactivated
  -- or soft deleted still leaves its windows projecting while the generator
  -- refuses to resolve them. The compliance read names those rows.
  SELECT
    p.prosrc INTO v_def
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'observation_compliance_for_range';
  PERFORM
    pg_temp.sr_assert (strpos(v_def, '''orphaned_shift''') > 0, 'public.observation_compliance_for_range no longer names a window whose shift has been retired. Those windows generate nothing and escalate nothing, and without the name they read as ordinary missed checks and mark the building down forever.');
END
$$;

-- ---------------------------------------------------------------------------
-- 9d. M7. An order in a terminal status stops being in force.
--
-- resident_monitoring_orders.status admits `completed`, nothing in the module
-- writes it, and the update policy lets a facility_admin write it directly. The
-- compliance read bounded the coverage day range and the covering order lateral
-- on timestamps alone, so an open ended order marked completed had no end date
-- and no cancellation, never closed, generated a fresh coverage day every day
-- forever, and went on reading as that resident's live expectation source long
-- after it had stopped. `expired` had the same hole.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src text;
  v_check text;
BEGIN
  PERFORM
    pg_temp.sr_assert (EXISTS (
        SELECT
          1
        FROM
          information_schema.columns c
        WHERE
          c.table_schema = 'public'
          AND c.table_name = 'resident_monitoring_orders'
          AND c.column_name = 'closed_at'), 'public.resident_monitoring_orders.closed_at is gone. Nothing then records when an order in a terminal status stopped being in force.');

  SELECT
    pg_catalog.pg_get_constraintdef(con.oid) INTO v_check
  FROM
    pg_catalog.pg_constraint con
  WHERE
    con.conrelid = 'public.resident_monitoring_orders'::regclass
    AND con.conname = 'resident_monitoring_orders_terminal_is_closed';
  PERFORM
    pg_temp.sr_assert (v_check IS NOT NULL, 'the CHECK that a terminal Monitoring Order carries a closing instant is gone, so an order can sit in a terminal status and never close.');

  PERFORM
    pg_temp.sr_assert (EXISTS (
        SELECT
          1
        FROM
          pg_catalog.pg_trigger t
        WHERE
          t.tgrelid = 'public.resident_monitoring_orders'::regclass
          AND t.tgname = 'tr_resident_monitoring_orders_closure'
          AND NOT t.tgisinternal), 'tr_resident_monitoring_orders_closure is gone. The closing instant then has to be remembered by every writer, and the one writer that forgets produces an order that reads as live forever.');

  PERFORM
    pg_temp.sr_assert (to_regprocedure('haven.monitoring_order_in_force_until(text,timestamptz,timestamptz,timestamptz)') IS NOT NULL, 'haven.monitoring_order_in_force_until is gone. It is the single definition of when an order stopped, read by both halves of the compliance read.');

  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'observation_compliance_for_range';

  PERFORM
    pg_temp.sr_assert ((length(v_src) - length(replace(v_src, 'monitoring_order_in_force_until', ''))) / length('monitoring_order_in_force_until') >= 2, 'public.observation_compliance_for_range reads haven.monitoring_order_in_force_until fewer than twice. Both the coverage day range and the covering order lateral have to read status, not only timestamps; fixing one leaves the other generating a fresh coverage day every day forever.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'COALESCE(o.cancelled_at, o.ends_at, now())') = 0, 'public.observation_compliance_for_range bounds the coverage day range on timestamps again. An order in a terminal status with no end date falls through to now() and never closes.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'COALESCE(o.cancelled_at, o.ends_at, ''infinity''::timestamptz)') = 0, 'public.observation_compliance_for_range bounds the covering order lateral on timestamps again. An order in a terminal status with no end date reads as in force until infinity.');

  -- The suppression reads are correct only because they filter on status. If
  -- that filter goes, a completed order starts suppressing standard windows.
  FOR v_src IN
  SELECT
    p.prosrc
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname IN ('observation_windows_under_monitoring_order', 'reinstate_standard_observation_windows') LOOP
      PERFORM
        pg_temp.sr_assert (strpos(v_src, 'o.status = ''active''') > 0, 'a Monitoring Order suppression read stopped filtering on status = active. An order in a terminal status would then go on taking standard windows off the board.');
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 9e. M8. A closed day does not change when a resident record is retired.
--
-- The occupancy source and the resolved join both filtered public.residents on
-- deleted_at, so an ordinary record retirement took a resident's whole
-- observation history out of the compliance contract and a past date that had
-- already been closed and reported recomputed to a smaller number. The recorded
-- misses went first and the satisfied windows went with them, so the ratio moved
-- up: an error that always flatters the facility.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'observation_compliance_for_range';

  -- Migration 427 brought a join to public.residents back, as a LEFT join, to
  -- read the current status. What must never come back is either deleted_at
  -- filter, and the join must never become an inner one: both drop the row for a
  -- resident whose record has been retired, and with it a closed day that had
  -- already been reported.
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'res.deleted_at IS NULL') = 0, 'public.observation_compliance_for_range filters the residents join on deleted_at again. The residents SELECT policy carries its own deleted_at test, so a retired record then erases days that carry real task rows.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'r.deleted_at IS NULL') = 0, 'public.observation_compliance_for_range filters residents on deleted_at again in its occupancy source. Retiring a record then rewrites closed reports, and always in the direction that flatters the building.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'JOIN public.residents res') = 0
      OR strpos(v_src, 'LEFT JOIN public.residents res') > 0, 'public.observation_compliance_for_range joins public.residents with an inner join. It reads the current status from there, and an inner join drops the resident day entirely when the record has been retired.');
END
$$;

-- ---------------------------------------------------------------------------
-- 9f. M11. Both ways of placing a Monitoring Order do the same thing.
--
-- The care event bridge used to INSERT straight into the table and skip every
-- side effect the create command performs: no order tasks until the next
-- generator tick, nobody notified, and the resident's standard cadence still
-- running underneath. It also attributed the order to whichever organization
-- administrator sorted first by created_at and hardcoded a generic nurse as the
-- ordering party.
--
-- The shared internal takes its actor as an argument rather than reading the
-- session, because a trigger firing under a care event write has none. That
-- makes its grant posture the whole of its safety: it performs no authorization,
-- so nothing that can be called from a request may reach it. Same posture as
-- haven.complete_rounding_task_core.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_internal CONSTANT text := 'haven.place_monitoring_order(uuid,integer,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,uuid,uuid)';
  v_role text;
  v_src text;
  v_check text;
BEGIN
  PERFORM
    pg_temp.sr_assert (to_regprocedure(c_internal) IS NOT NULL, 'haven.place_monitoring_order is gone. It is the single internal behind both ways of placing a Monitoring Order, and without it the two entry points drift apart again.');

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    PERFORM
      pg_temp.sr_assert (NOT pg_catalog.has_function_privilege (v_role, c_internal, 'EXECUTE'), format('%s can execute haven.place_monitoring_order. It takes the acting user as an argument and performs no authorization of its own, so any role that can call it can record a clinical order under somebody else''s name.', v_role));
  END LOOP;

  FOR v_src IN
  SELECT
    p.prosrc
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'public'
    AND p.proname = 'create_monitoring_order')
    OR (n.nspname = 'haven'
      AND p.proname = 'bridge_watch_instance_to_monitoring_order') LOOP
      PERFORM
        pg_temp.sr_assert (strpos(v_src, 'place_monitoring_order') > 0, 'one of the two Monitoring Order entry points stopped going through haven.place_monitoring_order. Whichever one it is now skips excusing the standard windows, writing the order tasks and notifying the administrator.');
    END LOOP;

  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'haven'
    AND p.proname = 'bridge_watch_instance_to_monitoring_order';

  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'INSERT INTO public.resident_monitoring_orders') = 0, 'the care event bridge writes the order table directly again, which is how it came to skip every side effect of the create command.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'Facility nurse on duty') = 0, 'the care event bridge hardcodes an ordering party again. A watch instance that names nobody must produce an order that names nobody.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'app_role IN (''owner'', ''org_admin'')') = 0, 'the care event bridge picks an organization administrator to attribute the order to again. An order attributed to somebody who never saw it is worse than one attributed to nobody.');

  -- And the table lets it say nobody.
  PERFORM
    pg_temp.sr_assert ((
      SELECT
        c.is_nullable
      FROM information_schema.columns c
      WHERE
        c.table_schema = 'public'
        AND c.table_name = 'resident_monitoring_orders'
        AND c.column_name = 'entered_by') = 'YES', 'public.resident_monitoring_orders.entered_by is NOT NULL again, so a system placed order has to be blamed on somebody.');

  SELECT
    pg_catalog.pg_get_constraintdef(con.oid) INTO v_check
  FROM
    pg_catalog.pg_constraint con
  WHERE
    con.conrelid = 'public.resident_monitoring_orders'::regclass
    AND con.conname = 'resident_monitoring_orders_ordered_by_type_check';
  PERFORM
    pg_temp.sr_assert (strpos(v_check, 'care_event') > 0, 'ordered_by_type no longer admits care_event, so a bridged order has to claim a clinical party its source never named.');

  PERFORM
    pg_temp.sr_assert (EXISTS (
        SELECT
          1
        FROM
          pg_catalog.pg_constraint con
        WHERE
          con.conrelid = 'public.resident_monitoring_orders'::regclass
          AND con.conname = 'resident_monitoring_orders_party_named_unless_care_event'), 'the CHECK that only a care_event order may leave the ordering party unnamed is gone. An operator entered order with no party is a different defect from an honest system one.');
END
$$;

-- ---------------------------------------------------------------------------
-- 9g. A resident in hospital stops accruing missed checks.
--
-- Found on Haven HFO Staging, the first time this module touched a real hosted
-- database: one resident on hospital_hold carried six expected windows and no
-- tasks, so they accrued six phantom missed checks for every day they were in
-- hospital. Spec 2.4 generates no tasks for hospital_hold, loa, discharged or
-- deceased; generating nothing while remaining expected punishes a building for
-- a resident who is not in it, and it reads as a staffing failure.
--
-- The cause was narrow: the four non generating statuses were caught by a
-- resident_status_history row covering the date and by nothing else, and
-- migration 217 installs that table's capture trigger without backfilling, so a
-- resident whose status was set before it ran has no row at all.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'observation_compliance_for_range';

  -- The history-first implementation evaluates each occurrence, not a noon
  -- generating flag. Assert behavior below rather than one spelling of SQL.
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'OR standard_task.id IS NOT NULL') > 0
      AND strpos(v_src, 'OR satisfying_log.id IS NOT NULL') > 0, 'public.observation_compliance_for_range no longer lets a task or a log keep a window that the status would drop. A resident who went to hospital mid shift then loses the checks that were actually recorded that morning.');
END
$$;

-- Residents without history retain the generating-status rule, and today's
-- status cannot erase an independently recorded active day.
DO $$
DECLARE v_fac uuid; v_org uuid; v_tz text; v_day date; v_expected integer;
 v_active uuid:=gen_random_uuid(); v_away uuid:=gen_random_uuid(); v_past uuid:=gen_random_uuid();
BEGIN
 SELECT f.id,f.organization_id,f.timezone INTO v_fac,v_org,v_tz FROM public.facilities f
 WHERE f.deleted_at IS NULL AND EXISTS(SELECT 1 FROM public.facility_observation_windows_for_date(f.id,(now() AT TIME ZONE f.timezone)::date)) LIMIT 1;
 PERFORM pg_temp.sr_assert(v_fac IS NOT NULL,'status authority fixture needs a configured facility');
 v_day:=(now() AT TIME ZONE v_tz)::date;
 SELECT count(*) INTO v_expected FROM public.facility_observation_windows_for_date(v_fac,v_day);
 INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,status,gender,admission_date)
 VALUES(v_active,v_org,v_fac,'Active authority','Synthetic','active','prefer_not_to_say',v_day-20),
 (v_away,v_org,v_fac,'Away authority','Synthetic','hospital_hold','prefer_not_to_say',v_day-20),
 (v_past,v_org,v_fac,'Historical authority','Synthetic','hospital_hold','prefer_not_to_say',v_day-20);
 DELETE FROM public.resident_status_history WHERE resident_id IN(v_active,v_away,v_past);
 PERFORM pg_temp.sr_assert((SELECT count(*) FROM public.observation_compliance_for_range(v_fac,v_day,v_day) WHERE resident_id=v_active)=v_expected,'active resident without status history lost expected windows');
 PERFORM pg_temp.sr_assert(NOT EXISTS(SELECT 1 FROM public.observation_compliance_for_range(v_fac,v_day,v_day) WHERE resident_id=v_away),'hospital_hold resident without history acquired phantom expected checks');
 INSERT INTO public.resident_status_history(organization_id,facility_id,resident_id,status,effective_from,effective_to)
 VALUES(v_org,v_fac,v_past,'active',((v_day-1)::timestamp AT TIME ZONE v_tz),(v_day::timestamp AT TIME ZONE v_tz)),
 (v_org,v_fac,v_past,'hospital_hold',(v_day::timestamp AT TIME ZONE v_tz),NULL);
 SELECT count(*) INTO v_expected FROM public.facility_observation_windows_for_date(v_fac,v_day-1);
 PERFORM pg_temp.sr_assert(v_expected>0,'historical status authority fixture needs a full cadence day');
 PERFORM pg_temp.sr_assert((SELECT count(*) FROM public.observation_compliance_for_range(v_fac,v_day-1,v_day-1) WHERE resident_id=v_past)=v_expected,'current hospital status erased the recorded active day');
 PERFORM pg_temp.sr_assert(NOT EXISTS(SELECT 1 FROM public.observation_compliance_for_range(v_fac,v_day,v_day) WHERE resident_id=v_past),'recorded hospital day acquired expected windows');
END $$;

-- ---------------------------------------------------------------------------
-- 9h. M6. The delivery drain is scoped to the tick and claims what it sends.
--
-- loadQueuedDeliveries in observation-escalation-engine/store.ts filtered on
-- `status = 'queued'` and `send_after <= now` and nothing else. It selected
-- organization_id and facility_id and filtered on neither, and its only caller
-- passed neither although the tick receives both. Reproduced with two synthetic
-- tenants: a tick scoped to one building of one tenant selected all three queued
-- rows, including the other tenant's. Every delivery body names a room and a
-- building, so a per facility cron entry was a cross tenant disclosure path.
--
-- The scope now lives in the database rather than in the Edge Function, which is
-- what this file can hold. The caller side is held by the two scope tests in
-- supabase/functions/observation-escalation-engine/engine.test.ts, which
-- npm run test:edge runs.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_claim CONSTANT text := 'public.claim_observation_escalation_deliveries(uuid,uuid,uuid,timestamptz,integer)';
  v_src text;
  v_defaults integer;
  v_check text;
BEGIN
  PERFORM
    pg_temp.sr_assert (to_regprocedure(c_claim) IS NOT NULL, 'public.claim_observation_escalation_deliveries is gone. The drain then goes back to reading every queued delivery in the database, whichever tenant it belongs to.');

  -- No default on the organization argument. A caller that forgets the scope
  -- must fail to resolve the function rather than drain everybody.
  SELECT
    p.pronargdefaults INTO v_defaults
  FROM
    pg_catalog.pg_proc p
  WHERE
    p.oid = to_regprocedure(c_claim);
  PERFORM
    pg_temp.sr_assert (v_defaults = 0, format('public.claim_observation_escalation_deliveries has %s defaulted argument(s). A default on the organization turns a forgotten scope into a silent cross tenant drain instead of an error.', v_defaults));

  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
  WHERE
    p.oid = to_regprocedure(c_claim);

  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'candidate.organization_id = p_organization_id') > 0, 'the delivery claim no longer filters on the organization. That is the cross tenant disclosure path this function exists to close.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'candidate.facility_id = p_facility_id') > 0, 'the delivery claim no longer filters on the facility when the tick names one, so a per facility cron entry sends other buildings'' messages.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, '''sending''') > 0, 'the delivery claim no longer moves a row to sending. Without the status transition two overlapping ticks both send the same delivery; a row lock will not do, because the send happens after the transaction commits.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'SKIP LOCKED') > 0, 'the delivery claim no longer skips locked rows, so two simultaneous claims queue behind each other on the same candidates.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'observation_delivery_claim_timeout') > 0, 'the delivery claim no longer returns a claim its owner never finished. A tick killed mid send then holds a resident''s escalation forever.');

  SELECT
    pg_catalog.pg_get_constraintdef(con.oid) INTO v_check
  FROM
    pg_catalog.pg_constraint con
  WHERE
    con.conrelid = 'public.observation_escalation_deliveries'::regclass
    AND con.conname = 'observation_escalation_deliveries_status_check';
  PERFORM
    pg_temp.sr_assert (strpos(v_check, 'sending') > 0, 'observation_escalation_deliveries cannot hold the sending state, so a claim has nowhere to live.');

  -- The seam the first version of this fix opened, and the reason the outcome
  -- write is a command rather than a filtered update from the Edge Function.
  --
  -- The claim moves the row to `sending`. store.ts was still filtering its
  -- outcome update on `status = 'queued'`, so it matched zero rows, and
  -- PostgREST returns no error for an update that matches nothing: the write
  -- succeeded silently, the outcome was never recorded, the row stayed claimed,
  -- and the stale claim reclaim sent the message again every timeout interval.
  -- A duplicate send per tick had become an unbounded resend loop.
  --
  -- The guard now lives in the same place as the claim it has to agree with,
  -- which is the only place a probe can read it.
  PERFORM
    pg_temp.sr_assert (to_regprocedure('public.record_observation_escalation_delivery_outcome(uuid,uuid,text,text,text,text,timestamptz,boolean,integer)') IS NOT NULL, 'public.record_observation_escalation_delivery_outcome is gone. The outcome write goes back to the Edge Function, where its status guard and the claim can disagree without anything noticing.');

  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
  WHERE
    p.oid = to_regprocedure('public.record_observation_escalation_delivery_outcome(uuid,uuid,text,text,text,text,timestamptz,boolean,integer)');

  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'd.status = ''sending''') > 0, 'the outcome write no longer requires the row to be in the state the claim leaves it in. The first version of this guard said queued, matched nothing, and every delivery resent every claim timeout forever.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'd.claim_token = p_claim_token') > 0, 'the outcome write no longer requires the caller to hold the claim, so a tick that finishes after its claim was reclaimed overwrites the result of the tick that actually sent the message.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'v_rows = 0') > 0
      AND strpos(v_src, 'RAISE EXCEPTION') > 0, 'the outcome write no longer raises when it matches no row. A send whose outcome cannot be recorded is exactly the case that must not be silent, because the alternative is sending it again.');

  -- And the bound, so retryable can never mean forever whatever the cause.
  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
  WHERE
    p.oid = to_regprocedure(c_claim);
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'observation_delivery_max_attempts') > 0, 'the delivery claim no longer bounds how many times one delivery may be handed out. The stale claim reclaim is then an unbounded resend for any delivery whose outcome cannot be written.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'send_attempts = d.send_attempts + 1') > 0, 'the delivery claim no longer counts attempts, so the bound above can never be reached.');
END
$$;

-- ---------------------------------------------------------------------------
-- 9i. M9. A transferred resident leaves no live tasks behind.
--
-- The generator picked departed residents as
-- `facility_id = thisFacility AND status <> 'active'`. A transfer satisfies
-- neither half. Reproduced: the stand down found zero candidates at the old
-- building while the resident's task sat upcoming there.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src text;
BEGIN
  PERFORM
    pg_temp.sr_assert (to_regprocedure('public.stand_down_ungenerated_observation_tasks(uuid,timestamptz)') IS NOT NULL, 'public.stand_down_ungenerated_observation_tasks is gone. The generator then carries its own stand down predicate again, and it disagreed with the exclusion predicate.');

  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
  WHERE
    p.oid = to_regprocedure('public.stand_down_ungenerated_observation_tasks(uuid,timestamptz)');

  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'res.facility_id IS DISTINCT FROM t.facility_id') > 0, 'the stand down no longer notices a resident who has transferred. Their outstanding tasks stay live at the building they left, climb the escalation ladder and reach the terminal rung as an SMS and a critical alert naming a room they are not in.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 't.due_at > p_at') > 0, 'the stand down no longer limits itself to windows that have not come due. Excusing a window that already lapsed erases a real miss.');

  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'generate_monitoring_order_tasks';
  PERFORM
    pg_temp.sr_assert (strpos(v_src, 'r.facility_id = o.facility_id') > 0, 'public.generate_monitoring_order_tasks generates for an order whose resident has left the building again. The stand down then excuses those tasks and this hands them straight back on the next tick, so the board churns every few minutes and the ladder collects fresh tasks each time.');
END
$$;

-- ---------------------------------------------------------------------------
-- 9j. M10. A rung that could reach nobody does not take the anchor.
--
-- record_observation_escalation_rung wrote the dispatch row, which is the
-- (task_id, rung_key) idempotency anchor, before recipients resolved. The
-- seeded nudge is assigned_staff_only with an empty target_staff_roles, so on a
-- task with no assigned staff it reached nobody and the anchor was taken
-- forever. Reproduced: the first call answered fired true with zero recipients,
-- the second answered already_fired. The nudge is the rung that catches most
-- misses before they reach a human, so this disabled the early warning on
-- exactly the tasks most likely to be missed.
--
-- Asserted by the order of the statements in the body, which is the thing that
-- was wrong. C1's guards must still come first, all of them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src text;
  v_lock integer;
  v_already integer;
  v_terminal integer;
  v_recipients integer;
  v_anchor integer;
BEGIN
  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'record_observation_escalation_rung';

  v_lock := strpos(v_src, 'FOR UPDATE');
  v_already := strpos(v_src, '''already_fired''');
  v_terminal := strpos(v_src, '''completed_on_time'', ''completed_late'', ''excused'', ''missed'', ''reassigned''');
  v_recipients := strpos(v_src, 'haven.observation_escalation_recipients');
  v_anchor := strpos(v_src, 'INSERT INTO public.observation_escalation_dispatches');

  PERFORM
    pg_temp.sr_assert (v_lock > 0
      AND v_already > 0
      AND v_terminal > 0
      AND v_recipients > 0
      AND v_anchor > 0, 'one of the five landmarks in record_observation_escalation_rung is gone; this assertion can no longer reason about their order.');

  -- C1, unchanged and still first.
  PERFORM
    pg_temp.sr_assert (v_lock < v_already, 'the task is no longer re-selected FOR UPDATE before the idempotency answer. The engine reads its queue seconds to minutes earlier and a completion in flight must be seen.');
  PERFORM
    pg_temp.sr_assert (v_already < v_terminal, 'the idempotency answer no longer comes before the completion answer. A rung that already fired did fire, whatever the task did afterwards.');
  PERFORM
    pg_temp.sr_assert (v_terminal < v_recipients, 'the terminal status guard no longer comes before anything is resolved or written. A caregiver who finished the check inside the engine''s read to write gap gets escalated on.');

  -- M10, the new ordering.
  PERFORM
    pg_temp.sr_assert (v_recipients < v_anchor, 'record_observation_escalation_rung resolves recipients after writing the dispatch row again. The dispatch row is the (task_id, rung_key) anchor, so a nudge that reached nobody burns the rung for that task permanently, and a pool task is exactly the task most likely to be missed.');
  PERFORM
    pg_temp.sr_assert (strpos(v_src, '''no_assignee_yet''') > 0, 'a staff reminder with no staff member to remind no longer answers no_assignee_yet. It either anchors on nobody or it disappears; the first burns the rung and the second hides it.');
END
$$;

-- ---------------------------------------------------------------------------
-- 10. Behaviour, not policy text. A synthetic organization with two buildings.
--
-- Selected and seeded by organization, never by facility name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.uid ()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = public
  AS $f$
  SELECT
    NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'sub', '')::uuid
$f$;

CREATE FUNCTION pg_temp.sr_sign_in (p_user uuid, p_session uuid)
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

-- Row level security only applies to a non superuser, and the replay runs as the
-- owner. These grants are the minimum that lets the policies be the thing under
-- test; they are rolled back with everything else.
GRANT USAGE ON SCHEMA haven, auth TO authenticated;

DO $$
DECLARE
  v_org CONSTANT uuid := '5add0000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := '5add0000-0000-4000-8000-000000000002';
  v_facility_a CONSTANT uuid := '5add0000-0000-4000-8000-000000000003';
  v_facility_b CONSTANT uuid := '5add0000-0000-4000-8000-000000000004';
  v_resident CONSTANT uuid := '5add0000-0000-4000-8000-000000000005';
  v_scoped CONSTANT uuid := '5add0000-0000-4000-8000-000000000006';
  v_org_admin CONSTANT uuid := '5add0000-0000-4000-8000-000000000007';
  v_caregiver CONSTANT uuid := '5add0000-0000-4000-8000-000000000008';
  v_active_cadence CONSTANT uuid := '5add0000-0000-4000-8000-000000000009';
  v_draft_cadence CONSTANT uuid := '5add0000-0000-4000-8000-00000000000a';
  v_active_ladder CONSTANT uuid := '5add0000-0000-4000-8000-00000000000b';
  v_draft_ladder CONSTANT uuid := '5add0000-0000-4000-8000-00000000000c';
  v_staff CONSTANT uuid := '5add0000-0000-4000-8000-00000000000d';
  v_source_cadence uuid;
  v_source_ladder uuid;
BEGIN
  INSERT INTO public.organizations (id, name)
    VALUES (v_org, 'Synthetic Smart Rounding Authority Organization');
  INSERT INTO public.entities (id, organization_id, name)
    VALUES (v_entity, v_org, 'Synthetic Smart Rounding Authority Entity');
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
    VALUES (v_facility_a, v_entity, v_org, 'Synthetic Authority Building One', '1 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York'),
    (v_facility_b, v_entity, v_org, 'Synthetic Authority Building Two', '2 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York');

  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender)
    VALUES (v_resident, v_facility_a, v_org, 'Monitored', 'Synthetic', 'active', 'prefer_not_to_say');

  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, ROLE, created_at, updated_at, confirmation_token)
    VALUES (v_scoped, '00000000-0000-0000-0000-000000000000', 'synthetic-scoped@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), ''),
    (v_org_admin, '00000000-0000-0000-0000-000000000000', 'synthetic-orgadmin@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), ''),
    (v_caregiver, '00000000-0000-0000-0000-000000000000', 'synthetic-caregiver@haven.test', '', now(), '{}', '{}', 'authenticated', 'authenticated', now(), now(), '');
  INSERT INTO auth.sessions (id, user_id)
    VALUES (v_scoped, v_scoped),
    (v_org_admin, v_org_admin),
    (v_caregiver, v_caregiver);

  INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role, is_active)
    VALUES (v_scoped, v_org, 'synthetic-scoped@haven.test', 'Synthetic Scoped Administrator', 'facility_admin', TRUE),
    (v_org_admin, v_org, 'synthetic-orgadmin@haven.test', 'Synthetic Organization Administrator', 'org_admin', TRUE),
    (v_caregiver, v_org, 'synthetic-caregiver@haven.test', 'Synthetic Caregiver', 'caregiver', TRUE);

  -- The scoped administrator reaches building one and nothing else. That is the
  -- whole point of the fixture.
  INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
    VALUES (v_scoped, v_facility_a, v_org, TRUE),
    (v_caregiver, v_facility_a, v_org, TRUE);

  INSERT INTO public.staff (id, facility_id, organization_id, first_name, last_name, staff_role, hire_date, user_id, employment_status)
    VALUES (v_staff, v_facility_a, v_org, 'Synthetic', 'Caregiver', 'resident_aide', current_date, v_caregiver, 'active');

  -- Cadence and escalation configuration copied from the seeded versions, so
  -- this probe restates no observation time, no grace value and no offset.
  SELECT
    v.id INTO v_source_cadence
  FROM
    public.facility_cadence_versions v
  WHERE
    v.status = 'active'
    AND v.deleted_at IS NULL
    AND v.facility_id <> v_facility_a
  ORDER BY
    v.created_at
  LIMIT 1;
  PERFORM
    pg_temp.sr_assert (v_source_cadence IS NOT NULL, 'the seeded cadence version is missing; migration 417 no longer seeds one.');

  SELECT
    v.id INTO v_source_ladder
  FROM
    public.facility_escalation_versions v
  WHERE
    v.status = 'active'
    AND v.deleted_at IS NULL
    AND v.facility_id <> v_facility_a
  ORDER BY
    v.created_at
  LIMIT 1;
  PERFORM
    pg_temp.sr_assert (v_source_ladder IS NOT NULL, 'the seeded escalation version is missing; migration 420 no longer seeds one.');

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
    VALUES (v_facility_a),
      (v_facility_b)) AS f (id)
    CROSS JOIN public.facility_shift_definitions s
  WHERE
    s.facility_id = (
      SELECT
        facility_id
      FROM
        public.facility_cadence_versions
      WHERE
        id = v_source_cadence);

  INSERT INTO public.facility_cadence_versions (id, organization_id, facility_id, version_number, status, effective_from, change_reason)
    VALUES (v_active_cadence, v_org, v_facility_a, 1, 'active', now() - interval '30 days', 'Synthetic authority fixture, in force'),
    (v_draft_cadence, v_org, v_facility_a, 2, 'draft', now() + interval '30 days', 'Synthetic authority fixture, draft');

  INSERT INTO public.facility_cadence_windows (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
  SELECT
    v_org,
    v_facility_a,
    target.id,
    w.window_key,
    w.label,
    w.due_at_local,
    w.grace_before_minutes,
    w.grace_after_minutes,
    w.shift_key,
    w.sort_order,
    w.enabled
  FROM (
    VALUES (v_active_cadence),
      (v_draft_cadence)) AS target (id)
    CROSS JOIN public.facility_cadence_windows w
  WHERE
    w.cadence_version_id = v_source_cadence;

  INSERT INTO public.facility_escalation_versions (id, organization_id, facility_id, version_number, status, effective_from, change_reason)
    VALUES (v_active_ladder, v_org, v_facility_a, 1, 'active', now() - interval '30 days', 'Synthetic authority fixture, in force'),
    (v_draft_ladder, v_org, v_facility_a, 2, 'draft', now() + interval '30 days', 'Synthetic authority fixture, draft');

  INSERT INTO public.facility_escalation_rungs (organization_id, facility_id, escalation_version_id, rung_key, label, offset_minutes, is_terminal, assigned_staff_only, include_assigned_staff, use_standing_alert_routes, target_staff_roles, channels, protocol_text, enabled, sort_order)
  SELECT
    v_org,
    v_facility_a,
    target.id,
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
    r.enabled,
    r.sort_order
  FROM (
    VALUES (v_active_ladder),
      (v_draft_ladder)) AS target (id)
    CROSS JOIN public.facility_escalation_rungs r
  WHERE
    r.escalation_version_id = v_source_ladder;

  INSERT INTO public.facility_escalation_rung_shift_overrides (organization_id, facility_id, escalation_version_id, escalation_rung_id, shift_key, offset_minutes, channels)
  SELECT
    v_org,
    v_facility_a,
    mine.escalation_version_id,
    mine.id,
    o.shift_key,
    o.offset_minutes,
    o.channels
  FROM
    public.facility_escalation_rung_shift_overrides o
    JOIN public.facility_escalation_rungs source ON source.id = o.escalation_rung_id
    JOIN public.facility_escalation_rungs mine ON mine.rung_key = source.rung_key
      AND mine.facility_id = v_facility_a
  WHERE
    o.escalation_version_id = v_source_ladder;

  INSERT INTO public.resident_monitoring_orders (organization_id, entity_id, facility_id, resident_id, interval_minutes, starts_at, review_due_at, ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note, entered_by, status)
    VALUES (v_org, v_entity, v_facility_a, v_resident, 60, now(), now() + interval '3 days', 'facility_nurse', 'Ordering party', 'verbal', 'post_fall', 'Synthetic authority fixture order.', v_scoped, 'active');
END
$$;

-- 10a. M2, demonstrated, and isolated so it is the WITH CHECK clause under test.
--
-- Read this before simplifying the test. On PostgreSQL 17 a bare UPDATE that
-- moves a row out of the reach of the table's SELECT policy raises 42501 on its
-- own, with no RETURNING clause and whatever the UPDATE policy's WITH CHECK
-- says. Verified against a two column table with nothing else on it. Every one
-- of this module's seven tables has a facility scoped SELECT policy, so the
-- cross facility move was refused by that policy before migration 423 as well.
--
-- Which means a test that only attempts the move proves nothing about the fix:
-- it passes against the broken policy. The second half of this block therefore
-- widens the SELECT policy to the whole organization, inside this rolled back
-- transaction, and attempts the move again. With the sibling policy out of the
-- way the UPDATE policy's WITH CHECK is the only thing left, and that assertion
-- does fail without migration 423.
SELECT
  pg_temp.sr_sign_in ('5add0000-0000-4000-8000-000000000006', '5add0000-0000-4000-8000-000000000006');

DO $$
DECLARE
  v_facility_a CONSTANT uuid := '5add0000-0000-4000-8000-000000000003';
  v_facility_b CONSTANT uuid := '5add0000-0000-4000-8000-000000000004';
  v_moved integer;
  v_legitimate integer;
  v_refused boolean := FALSE;
  v_still_here uuid;
BEGIN
  SET LOCAL ROLE authenticated;

  PERFORM
    pg_temp.sr_assert (haven.app_role ()::text = 'facility_admin', 'the scoped fixture caller should resolve as facility_admin, got ' || COALESCE(haven.app_role ()::text, 'null'));
  PERFORM
    pg_temp.sr_assert (NOT EXISTS (
        SELECT
          1
        FROM
          haven.accessible_facility_ids () AS reachable (id)
        WHERE
          reachable.id = v_facility_b), 'the scoped fixture caller can reach building two; the fixture is not testing what it says it is.');

  -- No RETURNING clause, deliberately. Postgres applies the SELECT policy to a
  -- RETURNING row as an extra WITH CHECK, so an UPDATE ... RETURNING that moves
  -- a row out of the caller's scope raises whether or not the UPDATE policy
  -- carries the facility predicate. That masks this defect completely: the
  -- version of this test that used RETURNING passed against the broken policy.
  -- A bare UPDATE is both the real attack and the only shape that proves the
  -- WITH CHECK clause is the thing refusing.
  --
  -- What the fix produces is a raised 42501, not a silent `UPDATE 0`. USING
  -- filters rows out silently; WITH CHECK refuses the row the statement would
  -- have produced and raises. Before the fix this statement reported UPDATE 1
  -- and the order was gone.
  BEGIN
    UPDATE
      public.resident_monitoring_orders
    SET
      facility_id = v_facility_b
    WHERE
      facility_id = v_facility_a;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_moved := 0;
      v_refused := TRUE;
  END;

  PERFORM
    pg_temp.sr_assert (v_moved = 0, format('a facility_admin scoped to one building moved %s Monitoring Order(s) into a building they cannot reach. resident_monitoring_orders_update dropped the facility predicate from WITH CHECK again.', v_moved));
  PERFORM
    pg_temp.sr_assert (v_refused, 'the cross facility move neither raised nor moved anything, which means the statement did not reach the policy at all and this assertion is proving nothing.');

  SELECT
    facility_id INTO v_still_here
  FROM
    public.resident_monitoring_orders
  WHERE
    resident_id = '5add0000-0000-4000-8000-000000000005';
  PERFORM
    pg_temp.sr_assert (v_still_here = v_facility_a, 'the Monitoring Order left building one.');

  -- And the in scope update a facility administrator is supposed to be able to
  -- make still works, so the fix refuses the right thing and not everything.
  UPDATE
    public.resident_monitoring_orders
  SET
    status = 'cancelled',
    cancelled_by = '5add0000-0000-4000-8000-000000000006',
    cancelled_at = now(),
    cancel_reason = 'Synthetic in scope cancellation'
  WHERE
    facility_id = v_facility_a;
  GET DIAGNOSTICS v_legitimate = ROW_COUNT;

  PERFORM
    pg_temp.sr_assert (v_legitimate = 1, format('a facility_admin could not stand down a Monitoring Order in their own building; %s row(s) updated. The M2 fix is refusing legitimate work.', v_legitimate));

  RESET ROLE;
END
$$;

-- The isolation. Rolled back with the rest of the probe; nothing here changes a
-- policy anybody runs on.
DROP POLICY resident_monitoring_orders_select ON public.resident_monitoring_orders;

CREATE POLICY resident_monitoring_orders_select ON public.resident_monitoring_orders
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

DO $$
DECLARE
  v_facility_a CONSTANT uuid := '5add0000-0000-4000-8000-000000000003';
  v_facility_b CONSTANT uuid := '5add0000-0000-4000-8000-000000000004';
  v_moved integer := 0;
  v_refused boolean := FALSE;
BEGIN
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE
      public.resident_monitoring_orders
    SET
      facility_id = v_facility_b
    WHERE
      facility_id = v_facility_a;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_refused := TRUE;
  END;

  RESET ROLE;

  PERFORM
    pg_temp.sr_assert (v_refused
      AND v_moved = 0, format('with the SELECT policy widened to the organization, a facility_admin scoped to one building moved %s Monitoring Order(s) into a building they cannot reach. resident_monitoring_orders_update is relying on a sibling policy instead of carrying the facility predicate in its own WITH CHECK clause.', v_moved));
END
$$;

DROP POLICY resident_monitoring_orders_select ON public.resident_monitoring_orders;

CREATE POLICY resident_monitoring_orders_select ON public.resident_monitoring_orders
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- 10b. M2, the other half. A caller who reaches both buildings still cannot put
--      an order in the wrong one, because the order and its resident are one
--      fact.
SELECT
  pg_temp.sr_sign_in ('5add0000-0000-4000-8000-000000000007', '5add0000-0000-4000-8000-000000000007');

DO $$
DECLARE
  v_facility_b CONSTANT uuid := '5add0000-0000-4000-8000-000000000004';
  v_resident CONSTANT uuid := '5add0000-0000-4000-8000-000000000005';
BEGIN
  SET LOCAL ROLE authenticated;

  PERFORM
    pg_temp.sr_assert (EXISTS (
        SELECT
          1
        FROM
          haven.accessible_facility_ids () AS reachable (id)
        WHERE
          reachable.id = v_facility_b), 'the org_admin fixture caller cannot reach building two; the fixture is not testing what it says it is.');

  BEGIN
    UPDATE
      public.resident_monitoring_orders
    SET
      facility_id = v_facility_b
    WHERE
      resident_id = v_resident;
    RESET ROLE;
    PERFORM
      pg_temp.sr_assert (FALSE, 'an org_admin moved a Monitoring Order into a building its resident does not live in. The order now claims to belong somewhere the resident is not, and every facility scoped read disagrees about whose resident it is.');
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  RESET ROLE;
END
$$;

-- 10c. Configuration children are command-only. Draft changes create forward
-- proposals through the role-gated RPC; neither INSERT nor UPDATE may bypass it.
DO $$
BEGIN
 SET LOCAL ROLE authenticated;
 BEGIN
  UPDATE public.facility_escalation_rungs SET offset_minutes=offset_minutes+1
   WHERE escalation_version_id='5add0000-0000-4000-8000-00000000000b';
  RAISE EXCEPTION 'Direct effective rung update unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.facility_escalation_rung_shift_overrides SET channels=ARRAY['in_app']
   WHERE escalation_version_id='5add0000-0000-4000-8000-00000000000b';
  RAISE EXCEPTION 'Direct effective override update unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.facility_escalation_rungs SET offset_minutes=offset_minutes+1
   WHERE escalation_version_id='5add0000-0000-4000-8000-00000000000c';
  RAISE EXCEPTION 'Direct draft policy bypass unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
END $$;

-- 10e. M3, demonstrated. Changing the interval a resident is physically checked
--      at leaves a history row naming the old value and the new one.
DO $$
DECLARE
  v_org CONSTANT uuid := '5add0000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := '5add0000-0000-4000-8000-000000000002';
  v_facility_a CONSTANT uuid := '5add0000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := '5add0000-0000-4000-8000-000000000005';
  v_scoped CONSTANT uuid := '5add0000-0000-4000-8000-000000000006';
  v_order uuid;
  v_before integer;
  v_row record;
BEGIN
  INSERT INTO public.resident_monitoring_orders (organization_id, entity_id, facility_id, resident_id, interval_minutes, starts_at, review_due_at, ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note, entered_by, status)
    VALUES (v_org, v_entity, v_facility_a, v_resident, 60, now(), now() + interval '3 days', 'facility_nurse', 'Ordering party', 'verbal', 'change_in_condition', 'Synthetic history fixture order.', v_scoped, 'active')
  RETURNING
    id INTO v_order;

  SELECT
    count(*) INTO v_before
  FROM
    public.resident_monitoring_order_events
  WHERE
    monitoring_order_id = v_order;
  PERFORM
    pg_temp.sr_assert (v_before = 1, format('a new Monitoring Order should leave exactly one opening history row, got %s.', v_before));

  UPDATE
    public.resident_monitoring_orders
  SET
    interval_minutes = 30,
    reason_note = 'Synthetic history fixture order, revised.'
  WHERE
    id = v_order;

  -- Selected by event_type rather than by time. Every row written inside one
  -- transaction carries the same now(), so ordering by occurred_at picks an
  -- arbitrary row and the test would pass or fail on a uuid comparison.
  SELECT
    * INTO v_row
  FROM
    public.resident_monitoring_order_events
  WHERE
    monitoring_order_id = v_order
    AND event_type = 'field_change';

  PERFORM
    pg_temp.sr_assert (v_row.event_type = 'field_change', 'changing the interval and the clinical reason on an active Monitoring Order left no field_change row. The history records only status transitions again, so how often a resident is physically looked at can be halved with no trace.');
  PERFORM
    pg_temp.sr_assert (v_row.changed_fields @> '[{"field":"interval_minutes","from":60,"to":30}]'::jsonb, format('the history row does not name the interval change with its before and after values; changed_fields is %s.', v_row.changed_fields::text));
  PERFORM
    pg_temp.sr_assert (strpos(v_row.changed_fields::text, 'reason_note') > 0, 'the history row does not name the clinical reason change.');
  PERFORM
    pg_temp.sr_assert (v_row.from_status = 'active'
      AND v_row.to_status = 'active', 'a field change row should carry the unchanged status on both sides rather than inventing a transition.');

  -- An update that moves nothing material leaves nothing behind, so the ledger
  -- does not fill with rows that say a clinical order did not change.
  UPDATE
    public.resident_monitoring_orders
  SET
    updated_at = now()
  WHERE
    id = v_order;
  PERFORM
    pg_temp.sr_assert ((
      SELECT
        count(*)
      FROM public.resident_monitoring_order_events
      WHERE
        monitoring_order_id = v_order) = 2, 'a bare updated_at touch wrote a history row. The ledger should record material change, not every write.');
END
$$;

-- 10d. The caregiver completion guard. A task with no assigned staff and no live
--      assignment row is completable by nobody below nurse. This is intended,
--      and it is why the generator now assigns from the shift schedule instead
--      of leaving tasks in a facility pool that nobody on the floor can work.
DO $$
DECLARE
  v_org CONSTANT uuid := '5add0000-0000-4000-8000-000000000001';
  v_facility_a CONSTANT uuid := '5add0000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := '5add0000-0000-4000-8000-000000000005';
  v_caregiver CONSTANT uuid := '5add0000-0000-4000-8000-000000000008';
  v_staff CONSTANT uuid := '5add0000-0000-4000-8000-00000000000d';
  v_active_cadence CONSTANT uuid := '5add0000-0000-4000-8000-000000000009';
  v_unassigned uuid;
  v_assigned uuid;
  v_payload jsonb;
  v_refused boolean := FALSE;
  v_window record;
BEGIN
  SELECT
    * INTO v_window
  FROM
    public.facility_observation_windows_for_date (v_facility_a, (now() AT TIME ZONE 'America/New_York')::date)
  LIMIT 1;
  PERFORM
    pg_temp.sr_assert (v_window.window_key IS NOT NULL, 'the fixture facility projects no observation window; the cadence copy did not land.');

  INSERT INTO public.resident_observation_tasks (organization_id, facility_id, resident_id, cadence_version_id, window_key, service_date, scheduled_for, due_at, grace_ends_at, status, assigned_staff_id)
    VALUES (v_org, v_facility_a, v_resident, v_active_cadence, v_window.window_key, (now() AT TIME ZONE 'America/New_York')::date, v_window.window_opens_at_utc, v_window.due_at_utc, v_window.window_closes_at_utc, 'upcoming', NULL)
  RETURNING
    id INTO v_unassigned;

  v_payload := jsonb_build_object('request_id', gen_random_uuid(), 'observed_at', now(), 'entered_at', now(), 'entry_mode', 'live', 'quick_status', 'calm', 'resident_location', 'room', 'resident_state', 'awake');

  BEGIN
    PERFORM
      public.complete_rounding_task_review (v_unassigned, v_caregiver, 'caregiver', v_caregiver, (
        SELECT
          auth_claim_version
        FROM public.user_profiles
        WHERE
          id = v_caregiver), v_org, v_facility_a, v_staff, v_payload);
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_refused := TRUE;
  END;

  PERFORM
    pg_temp.sr_assert (v_refused, 'a caregiver completed an observation task with no assigned staff and no live assignment row. That guard is a tested SYS-001 invariant and the reason the generator has to assign from the shift schedule rather than leave tasks in a pool.');
  PERFORM
    pg_temp.sr_assert (NOT EXISTS (
        SELECT
          1
        FROM
          public.resident_observation_logs
        WHERE
          task_id = v_unassigned), 'the refused completion still wrote an observation log.');

  -- And the same caregiver completes the same shaped task once the assignment
  -- row the generator now writes exists, which is what makes the assignment fix
  -- a fix rather than a different way of being stuck.
  INSERT INTO public.observation_vocab(organization_id,facility_id,field_name,value_code,display_label,display_order,active)
    VALUES(v_org,v_facility_a,'mood_state','calm','Calm',1,true);

  INSERT INTO public.resident_observation_tasks (organization_id, facility_id, resident_id, cadence_version_id, monitoring_order_id, service_date, scheduled_for, due_at, grace_ends_at, status, assigned_staff_id)
    VALUES (v_org, v_facility_a, v_resident, v_active_cadence, NULL, (now() AT TIME ZONE 'America/New_York')::date, v_window.window_opens_at_utc, v_window.due_at_utc, v_window.window_closes_at_utc, 'upcoming', NULL)
  RETURNING
    id INTO v_assigned;

  INSERT INTO public.resident_observation_assignments (organization_id, facility_id, resident_id, task_id, staff_id, assignment_type)
    VALUES (v_org, v_facility_a, v_resident, v_assigned, v_staff, 'primary');

  PERFORM
    public.complete_rounding_task_review (v_assigned, v_caregiver, 'caregiver', v_caregiver, (
      SELECT
        auth_claim_version
      FROM public.user_profiles
      WHERE
        id = v_caregiver), v_org, v_facility_a, v_staff, jsonb_build_object('request_id', gen_random_uuid(), 'observed_at', now(), 'entered_at', now(), 'entry_mode', 'live', 'quick_status', 'calm', 'resident_location', 'room', 'resident_state', 'awake','chip_selections',jsonb_build_object('mood_state',jsonb_build_array('calm'))));

  PERFORM
    pg_temp.sr_assert (EXISTS (
        SELECT
          1
        FROM
          public.resident_observation_logs
        WHERE
          task_id = v_assigned), 'a caregiver holding the primary assignment row could not complete their own task. The assignment path the generator now writes through does not work.');
END
$$;

-- ---------------------------------------------------------------------------
-- 11. The Watchlist surface reads on the caller's authority, and carries no
--     resident level number.
--
-- Three views replace the resident safety score. As definer-rights views any
-- one of them would answer for every building in the database whatever the
-- reader could reach, which is the same defect the compliance read is guarded
-- against in section 1. And the number that made the old surface indefensible
-- must not come back under another name: severity_weight, summed per resident,
-- is exactly the composite spec section 7.1 removed, so it appears on no view
-- that carries a resident_id.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_views CONSTANT text[] := ARRAY['v_watchlist_facility', 'v_watchlist_portfolio', 'v_facility_risk_index'];
  v_view text;
  v_options text[];
  v_anon text;
  v_leak text;
BEGIN
  FOREACH v_view IN ARRAY c_views LOOP
    SELECT
      c.reloptions INTO v_options
    FROM
      pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE
      n.nspname = 'public'
      AND c.relname = v_view
      AND c.relkind = 'v';
    PERFORM
      pg_temp.sr_assert (v_options IS NOT NULL OR EXISTS (
          SELECT
            1
          FROM
            pg_catalog.pg_class c2
            JOIN pg_catalog.pg_namespace n2 ON n2.oid = c2.relnamespace
          WHERE
            n2.nspname = 'public'
            AND c2.relname = v_view), format('public.%s is gone; the 25A Watchlist declared it.', v_view));
    PERFORM
      pg_temp.sr_assert ('security_invoker=true' = ANY (COALESCE(v_options, ARRAY[]::text[])), format('public.%s lost security_invoker. A definer rights view answers for every building in the database whatever the reader can reach.', v_view));

    SELECT
      string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type) INTO v_anon
    FROM
      information_schema.role_table_grants g
    WHERE
      g.table_schema = 'public'
      AND g.table_name = v_view
      AND g.grantee = 'anon';
    PERFORM
      pg_temp.sr_assert (v_anon IS NULL, format('anon holds %s on public.%s. That is the publishable key reading the Watchlist.', v_anon, v_view));

    PERFORM
      pg_temp.sr_assert (pg_catalog.has_table_privilege ('authenticated', format('public.%s', v_view), 'SELECT'), format('authenticated lost SELECT on public.%s; the Watchlist reads through it.', v_view));
  END LOOP;

  SELECT
    string_agg(format('%s.%s', c.table_name, c.column_name), ', ' ORDER BY c.table_name, c.column_name) INTO v_leak
  FROM
    information_schema.columns c
  WHERE
    c.table_schema = 'public'
    AND c.table_name = ANY (c_views)
    AND (c.column_name = 'severity_weight'
      OR c.column_name ~ '(score|percent|rating|points|grade|composite|tier)')
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
    pg_temp.sr_assert (v_leak IS NULL, format('a resident level Watchlist view exposes %s. Spec 25A decision D5: no score, no percentage and no index on a resident row.', v_leak));

  PERFORM
    pg_temp.sr_assert (NOT EXISTS (
        SELECT
          1
        FROM
          information_schema.columns
        WHERE
          table_schema = 'public'
          AND table_name = 'v_facility_risk_index'
          AND column_name = 'resident_id'), 'public.v_facility_risk_index grew a resident_id. The facility composite is allowed to exist only because it is facility level.');
END
$$;

-- ---------------------------------------------------------------------------
-- 12. Nothing signed in writes a Watchlist signal instance directly.
--
-- authenticated holds SELECT and no more, and the table carries no INSERT and
-- no UPDATE policy. Both are needed: a grant with no policy refuses, but a
-- policy added later to a table that still holds the grant would open the
-- evaluator's output to hand editing, and a hand edited signal has no evidence
-- behind it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_grants text;
  v_policies text;
BEGIN
  SELECT
    string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type) INTO v_grants
  FROM
    information_schema.role_table_grants g
  WHERE
    g.table_schema = 'public'
    AND g.table_name = 'watchlist_signal_instances'
    AND g.grantee = 'authenticated'
    AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  PERFORM
    pg_temp.sr_assert (v_grants IS NULL, format('authenticated holds %s on public.watchlist_signal_instances. The evaluator and public.disposition_watchlist_signal are the only writers.', v_grants));

  SELECT
    string_agg(pol.polname || ' (' || pol.polcmd::text || ')', ', ' ORDER BY pol.polname) INTO v_policies
  FROM
    pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE
    n.nspname = 'public'
    AND c.relname = 'watchlist_signal_instances'
    AND pol.polcmd::text IN ('a', 'w', 'd', '*');
  PERFORM
    pg_temp.sr_assert (v_policies IS NULL, format('public.watchlist_signal_instances gained a write policy: %s.', v_policies));
END
$$;

-- ---------------------------------------------------------------------------
-- 13. Part 7. The organization template tables are organization scoped and
--     their UPDATE policies repeat the organization predicate in WITH CHECK.
--
-- Section 6 above checks the facility predicate on the facility scoped tables.
-- A template has no facility_id, so the predicate that matters is the
-- organization one, and it is the same class of defect: a policy that carries
-- the predicate in USING and drops it from WITH CHECK lets a caller read a row
-- inside their tenant and write it into another one.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_policies CONSTANT text[] := ARRAY['cadence_templates.cadence_templates_update', 'cadence_template_versions.cadence_template_versions_update', 'cadence_template_windows.cadence_template_windows_update', 'escalation_templates.escalation_templates_update', 'escalation_template_versions.escalation_template_versions_update', 'escalation_template_rungs.escalation_template_rungs_update'];
  v_entry text;
  v_table text;
  v_policy text;
  v_using text;
  v_check text;
BEGIN
  FOREACH v_entry IN ARRAY c_policies LOOP
    v_table := split_part(v_entry, '.', 1);
    v_policy := split_part(v_entry, '.', 2);

    SELECT
      pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
      pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) INTO v_using,
      v_check
    FROM
      pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE
      n.nspname = 'public'
      AND c.relname = v_table
      AND pol.polname = v_policy;

    PERFORM
      pg_temp.sr_assert (v_using IS NOT NULL, format('the UPDATE policy %s on public.%s is gone.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (v_check IS NOT NULL, format('%s on public.%s has no WITH CHECK clause at all, so its USING clause is reused and any row it can read it can write anywhere.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (strpos(v_using, 'organization_id') > 0, format('%s on public.%s lost the organization predicate from USING.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (strpos(v_check, 'organization_id') > 0, format('%s on public.%s dropped the organization predicate from WITH CHECK. A caller can read a template row inside their tenant and write it into another one.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (strpos(v_using, 'org_admin') > 0
        AND strpos(v_check, 'org_admin') > 0, format('%s on public.%s no longer restricts template edits to org_admin and owner. Spec 25A 6.12 puts template editing at the organization.', v_policy, v_table));
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 14. Part 7. The facility to template pointer has no write policy at all.
--
-- Only haven.apply_observation_config_activation writes it, at the moment a
-- version actually takes force. A hand edited binding would claim a building
-- inherits a template its windows do not match, and the portfolio drift view
-- would then be reporting against a claim rather than against a decision.
--
-- The grant and the policy are both asserted. A grant with no policy refuses,
-- but a policy added later to a table that still holds the grant would open it,
-- and a revoke sweep that left the policy would look like protection.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_grants text;
  v_policies text;
BEGIN
  SELECT
    string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type) INTO v_grants
  FROM
    information_schema.role_table_grants g
  WHERE
    g.table_schema = 'public'
    AND g.table_name = 'facility_config_template_bindings'
    AND g.grantee = 'authenticated'
    AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  PERFORM
    pg_temp.sr_assert (v_grants IS NULL, format('authenticated holds %s on public.facility_config_template_bindings. The activation command is the only writer; a hand edited binding makes the drift view report a claim rather than a decision.', v_grants));

  SELECT
    string_agg(pol.polname || ' (' || pol.polcmd::text || ')', ', ' ORDER BY pol.polname) INTO v_policies
  FROM
    pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE
    n.nspname = 'public'
    AND c.relname = 'facility_config_template_bindings'
    AND pol.polcmd::text IN ('a', 'w', 'd', '*');
  PERFORM
    pg_temp.sr_assert (v_policies IS NULL, format('public.facility_config_template_bindings gained a write policy: %s.', v_policies));
END
$$;

-- ---------------------------------------------------------------------------
-- 15. Part 7. The regulator's floor is readable by every signed in caller and
--     writable by none of them, and the FL_AHCA row still carries no number.
--
-- Spec 25A forbids inventing a regulatory floor and open item 6 has Compliance
-- supplying the Florida number or confirming there is none. A migration that
-- fills it in without a citation, or a policy that lets a tenant write its own
-- floor, are both ways the product starts asserting a rule nobody verified.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_grants text;
  v_policies text;
  v_row record;
BEGIN
  SELECT
    string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type) INTO v_grants
  FROM
    information_schema.role_table_grants g
  WHERE
    g.table_schema = 'public'
    AND g.table_name = 'jurisdiction_observation_floors'
    AND g.grantee = 'authenticated'
    AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  PERFORM
    pg_temp.sr_assert (v_grants IS NULL, format('authenticated holds %s on public.jurisdiction_observation_floors. Changing a regulatory floor is a migration with a citation on it, not a row edit.', v_grants));

  SELECT
    string_agg(pol.polname || ' (' || pol.polcmd::text || ')', ', ' ORDER BY pol.polname) INTO v_policies
  FROM
    pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE
    n.nspname = 'public'
    AND c.relname = 'jurisdiction_observation_floors'
    AND pol.polcmd::text IN ('a', 'w', 'd', '*');
  PERFORM
    pg_temp.sr_assert (v_policies IS NULL, format('public.jurisdiction_observation_floors gained a write policy: %s.', v_policies));

  SELECT
    j.minimum_windows_per_24h,
    j.maximum_unobserved_gap_minutes,
    j.floor_values_pending,
    j.citation_reference INTO v_row
  FROM
    public.jurisdiction_observation_floors j
  WHERE
    j.jurisdiction_key = 'FL_AHCA'
    AND j.deleted_at IS NULL;

  PERFORM
    pg_temp.sr_assert (v_row.floor_values_pending IS NOT NULL, 'the FL_AHCA jurisdiction floor row is gone; spec 25A section 6.10 ships it present with null values so the structure is ready.');
  PERFORM
    pg_temp.sr_assert (v_row.minimum_windows_per_24h IS NULL
      AND v_row.maximum_unobserved_gap_minutes IS NULL, format('the FL_AHCA floor has acquired numbers (%s windows, %s minute gap). No verified Florida minimum exists in repository authority; supply it with a citation through a deliberate migration and update this assertion in the same change.', v_row.minimum_windows_per_24h, v_row.maximum_unobserved_gap_minutes));
  PERFORM
    pg_temp.sr_assert (v_row.floor_values_pending, 'the FL_AHCA floor no longer reads as pending, so a surface would show "no floor exists" where the fact is "nobody has supplied the number".');
END
$$;

-- ---------------------------------------------------------------------------
-- 16. Part 7. The activation invariant, asserted on the data rather than on the
--     function body.
--
-- haven.apply_observation_config_activation closes the outgoing version at
-- exactly the instant the incoming one opens. Every seeded and migrated version
-- timeline in the database is checked for the two ways that can be wrong: a gap,
-- where a past instant resolves to no version at all, and an overlap, where it
-- resolves to whichever row sorted first.
--
-- The gist exclusion constraint catches the overlap. Nothing catches the gap,
-- which is why it is checked here.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT
    string_agg(format('%s version %s closes at %s but version %s opens at %s', kind, version_number, effective_to, next_number, next_from), '; ' ORDER BY kind, version_number) INTO v_bad
  FROM (
    SELECT
      'cadence' AS kind,
      v.version_number,
      v.effective_to,
      lead(v.version_number) OVER (PARTITION BY v.facility_id ORDER BY v.effective_from) AS next_number,
      lead(v.effective_from) OVER (PARTITION BY v.facility_id ORDER BY v.effective_from) AS next_from
    FROM
      public.facility_cadence_versions v
    WHERE
      v.deleted_at IS NULL
      AND v.status IN ('active', 'superseded')
    UNION ALL
    SELECT
      'escalation',
      v.version_number,
      v.effective_to,
      lead(v.version_number) OVER (PARTITION BY v.facility_id ORDER BY v.effective_from),
      lead(v.effective_from) OVER (PARTITION BY v.facility_id ORDER BY v.effective_from)
    FROM
      public.facility_escalation_versions v
    WHERE
      v.deleted_at IS NULL
      AND v.status IN ('active', 'superseded')) timeline
  WHERE
    next_from IS NOT NULL
    AND effective_to IS DISTINCT FROM next_from;

  PERFORM
    pg_temp.sr_assert (v_bad IS NULL, format('an observation configuration timeline has a gap or a shift in it: %s. public.facility_cadence_in_force resolves by effective_from, so a gap makes a past date answer from no version and an overlap makes it answer from whichever sorted first. Either way a past compliance report recomputes against configuration that was never in force.', v_bad));

  -- The open ended end of every timeline is the active version and nothing else.
  SELECT
    string_agg(format('%s version %s is %s with a null effective_to', kind, version_number, status), '; ' ORDER BY kind, version_number) INTO v_bad
  FROM (
    SELECT
      'cadence' AS kind,
      v.version_number,
      v.status
    FROM
      public.facility_cadence_versions v
    WHERE
      v.deleted_at IS NULL
      AND v.status = 'superseded'
      AND v.effective_to IS NULL
    UNION ALL
    SELECT
      'escalation',
      v.version_number,
      v.status
    FROM
      public.facility_escalation_versions v
    WHERE
      v.deleted_at IS NULL
      AND v.status = 'superseded'
      AND v.effective_to IS NULL) leftover;

  PERFORM
    pg_temp.sr_assert (v_bad IS NULL, format('a superseded observation configuration version is still open ended: %s. Supersession has to close effective_to, or two versions cover the same instant.', v_bad));
END
$$;

-- ---------------------------------------------------------------------------
-- 17. Part 7. The portfolio drift read runs on the caller's authority.
--
-- public.facility_config_template_drift crosses every building in the database
-- by construction. As a definer it would hand a facility administrator the
-- configuration posture of buildings they hold no access to, which is the same
-- defect assertion 1 covers for the compliance read.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_definer boolean;
BEGIN
  SELECT
    p.prosecdef INTO v_definer
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'facility_config_template_drift';

  PERFORM
    pg_temp.sr_assert (v_definer IS NOT NULL, 'public.facility_config_template_drift is gone; the portfolio settings view reads through it.');
  PERFORM
    pg_temp.sr_assert (v_definer = FALSE, 'public.facility_config_template_drift became SECURITY DEFINER. It crosses every building in the database and row level security is the only thing scoping it to the caller''s own.');

  PERFORM
    pg_temp.sr_assert ((
      SELECT
        c.reloptions @> ARRAY['security_invoker=true']
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE
        n.nspname = 'public'
        AND c.relname = 'v_facility_config_template_drift'), 'public.v_facility_config_template_drift lost security_invoker, so it answers with the view owner''s authority over every building.');
END
$$;

-- ---------------------------------------------------------------------------
-- 18. Part 7. The six hard blocks raise an errcode the operator surface will
--     actually show.
--
-- public.activate_cadence_version refuses a blocked change by re-raising the
-- first block's own message. Whether that message reaches a screen depends
-- entirely on the SQLSTATE it carries: src/lib/rounding/rounding-query-error.ts
-- shows a command's own sentence for P0001, P0002, 22023, 23505 and 42501, and
-- its own fallback for anything else.
--
-- 23514, check_violation, is deliberately not in that set, because every CHECK
-- constraint in the module raises it and its text is raw PostgreSQL. This raise
-- carried 23514 for one commit. The blocks were enforced the whole time and the
-- six messages an administrator most needs -- the overlap, the shift with
-- nothing on it, the early opening at a shift start -- were the only refusals in
-- the module that arrived as "that could not be done, retry".
--
-- Asserted on the body rather than on behaviour, because the message that
-- reaches a browser cannot be observed from SQL. strpos, never LIKE: every
-- identifier here contains an underscore and LIKE would match almost anything.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT
    p.prosrc INTO v_body
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'activate_cadence_version';

  PERFORM
    pg_temp.sr_assert (v_body IS NOT NULL, 'public.activate_cadence_version is gone; it is the only place the six hard blocks are enforced.');

  PERFORM
    pg_temp.sr_assert (strpos(v_body, 'validate_cadence_version') > 0, 'public.activate_cadence_version no longer calls public.validate_cadence_version, so the six hard blocks are enforced in the client only and an API call walks straight past them.');

  PERFORM
    pg_temp.sr_assert (strpos(v_body, '22023') > 0, 'public.activate_cadence_version no longer raises 22023. The block refusal has to carry an errcode src/lib/rounding/rounding-query-error.ts will show, or the operator reads a generic retry message instead of the reason.');

  PERFORM
    pg_temp.sr_assert (strpos(v_body, '23514') = 0, 'public.activate_cadence_version mentions 23514. check_violation is raised by every CHECK constraint in the module and is deliberately excluded from the operator refusal set, so a block raised with it is a block whose reason never reaches a screen.');
END
$$;

-- ---------------------------------------------------------------------------
-- 19. Part 8. The board's display thresholds are rows, and the ordering between
--     the two documentation lag thresholds is a constraint rather than a form.
--
-- Migration 431 moved three numbers out of TypeScript:
-- documentation_lag_notable_minutes and documentation_lag_serious_minutes off
-- src/components/rounding/IntegrityFlagCard.tsx, and
-- task_upcoming_lead_minutes off src/lib/rounding/update-task-status.ts. A
-- later migration that drops one of them silently returns the module to two
-- sources of truth for what an operator sees, which is the defect the Part 8
-- review found: the board was painting a task critically overdue on a schedule
-- the settings surface could not change.
--
-- The ordering CHECK matters on its own. Serious below notable makes a lag read
-- as serious and not notable at the same time, and no form can be the thing
-- that prevents it: public.facility_observation_thresholds carries an UPDATE
-- grant to authenticated.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_columns CONSTANT text[] := ARRAY['documentation_lag_notable_minutes', 'documentation_lag_serious_minutes', 'task_upcoming_lead_minutes'];
  v_column text;
  v_nullable text;
  v_org uuid;
  v_facility uuid;
  v_raised text;
BEGIN
  FOREACH v_column IN ARRAY c_columns LOOP
    SELECT
      c.is_nullable INTO v_nullable
    FROM
      information_schema.columns c
    WHERE
      c.table_schema = 'public'
      AND c.table_name = 'facility_observation_thresholds'
      AND c.column_name = v_column;
    PERFORM
      pg_temp.sr_assert (v_nullable IS NOT NULL, format('public.facility_observation_thresholds.%s is gone. Migration 431 moved it out of a TypeScript constant; dropping the column puts the number back in code.', v_column));
    PERFORM
      pg_temp.sr_assert (v_nullable = 'NO', format('public.facility_observation_thresholds.%s became nullable. A null display threshold makes the surface choose a fallback, which is the constant again.', v_column));
  END LOOP;

  -- The trigger that gives a new building a row at all. Without it a facility
  -- added after migration 428 has no thresholds and every read that needs one
  -- finds nothing.
  PERFORM
    pg_temp.sr_assert (EXISTS (
        SELECT
          1
        FROM
          pg_catalog.pg_trigger t
          JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE
          n.nspname = 'public'
          AND c.relname = 'facilities'
          AND t.tgname = 'tr_facilities_seed_observation_thresholds'
          AND NOT t.tgisinternal), 'tr_facilities_seed_observation_thresholds is gone from public.facilities. public.ensure_facility_observation_defaults predates the thresholds table and does not seed it, so this trigger is the only thing that gives a new building its thresholds.');

  -- Behaviour: the ordering is refused, by the database, on a real row.
  SELECT
    t.organization_id,
    t.facility_id INTO v_org,
    v_facility
  FROM
    public.facility_observation_thresholds t
  WHERE
    t.deleted_at IS NULL
  ORDER BY
    t.created_at,
    t.facility_id
  LIMIT 1;

  PERFORM
    pg_temp.sr_assert (v_facility IS NOT NULL, 'no facility carries a public.facility_observation_thresholds row, so the ordering constraint cannot be exercised. Migration 428 seeds one per facility and 431 backstops it.');

  BEGIN
    -- A bare UPDATE, and the assertion is on the raise rather than on a row
    -- count: a CHECK violation raises 23514 and a USING failure would filter
    -- silently to UPDATE 0. Never written with RETURNING, which re-applies the
    -- SELECT policy to the new row and passes against a broken one.
    UPDATE
      public.facility_observation_thresholds
    SET
      documentation_lag_notable_minutes = documentation_lag_serious_minutes + 1
    WHERE
      facility_id = v_facility;
    v_raised := NULL;
  EXCEPTION
    WHEN check_violation THEN
      v_raised := SQLSTATE;
  END;

  PERFORM
    pg_temp.sr_assert (v_raised = '23514', format('setting documentation_lag_notable_minutes above documentation_lag_serious_minutes was accepted (raised %s). The ordering has to be a constraint: authenticated holds UPDATE on this table, so a form is not the thing preventing it.', COALESCE(v_raised, 'nothing')));
END
$$;

-- ---------------------------------------------------------------------------
-- 20. Part 8. The Monitoring Order interval presets and the grace formula are
--     facility rows, and the signatures that could read the wrong building are
--     gone.
--
-- Two functions in this module returned constants for four parts behind a
-- comment promising configuration would replace them:
-- public.monitoring_order_interval_options and haven.observation_grace_formula.
-- Migration 432 made the promise true. The reason the old signatures are
-- asserted absent rather than merely deprecated: a zero argument overload
-- alongside a facility scoped one is a call that compiles, runs, and answers
-- for the wrong building, and a grace value computed against another facility's
-- divisor is a wrong answer that reads perfectly plausible.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_columns CONSTANT text[] := ARRAY['monitoring_order_interval_presets', 'monitoring_order_interval_min_minutes', 'monitoring_order_interval_max_minutes', 'observation_grace_divisor', 'observation_grace_floor_minutes', 'observation_grace_ceiling_minutes'];
  v_column text;
  v_nullable text;
  v_facility uuid;
  v_raised text;
  v_grace integer;
BEGIN
  FOREACH v_column IN ARRAY c_columns LOOP
    SELECT
      c.is_nullable INTO v_nullable
    FROM
      information_schema.columns c
    WHERE
      c.table_schema = 'public'
      AND c.table_name = 'facility_observation_thresholds'
      AND c.column_name = v_column;
    PERFORM
      pg_temp.sr_assert (v_nullable IS NOT NULL, format('public.facility_observation_thresholds.%s is gone. Migration 432 moved it out of a function body that returned a constant; dropping the column puts the constant back.', v_column));
    PERFORM
      pg_temp.sr_assert (v_nullable = 'NO', format('public.facility_observation_thresholds.%s became nullable. A null divisor or a null preset list makes the caller choose a fallback, which is the constant again.', v_column));
  END LOOP;

  -- The signatures that would read the wrong building.
  PERFORM
    pg_temp.sr_assert (NOT EXISTS (
        SELECT
          1
        FROM
          pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE
          n.nspname = 'public'
          AND p.proname = 'monitoring_order_interval_options'
          AND p.pronargs = 0), 'public.monitoring_order_interval_options() with no argument is back. It cannot know which building it is answering for, so it answers for whichever row it happens to find.');
  PERFORM
    pg_temp.sr_assert (EXISTS (
        SELECT
          1
        FROM
          pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE
          n.nspname = 'public'
          AND p.proname = 'monitoring_order_interval_options'
          AND p.pronargs = 1), 'public.monitoring_order_interval_options(uuid) is gone; the Monitoring Order entry form has no presets to offer.');
  PERFORM
    pg_temp.sr_assert (NOT EXISTS (
        SELECT
          1
        FROM
          pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE
          n.nspname = 'haven'
          AND p.proname = 'observation_grace_formula'
          AND p.pronargs = 0), 'haven.observation_grace_formula() with no argument is back, so the interval scaled grace rule has a divisor that belongs to no building.');
  PERFORM
    pg_temp.sr_assert (NOT EXISTS (
        SELECT
          1
        FROM
          pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE
          n.nspname = 'public'
          AND p.proname IN ('monitoring_order_grace_minutes', 'observation_grace_minutes')
          AND p.pronargs = 1), 'a single argument grace function is back. Grace is per facility since migration 432, and an interval-only signature computes it against whatever divisor it finds.');

  SELECT
    t.facility_id INTO v_facility
  FROM
    public.facility_observation_thresholds t
  WHERE
    t.deleted_at IS NULL
  ORDER BY
    t.created_at,
    t.facility_id
  LIMIT 1;

  PERFORM
    pg_temp.sr_assert (v_facility IS NOT NULL, 'no building carries a public.facility_observation_thresholds row, so neither the presets nor the grace formula can be exercised.');

  -- The seeded rule still gives the answers spec 5.2 names, now through a row.
  PERFORM
    pg_temp.sr_assert (public.monitoring_order_grace_minutes (v_facility, 30) = 10
      AND public.monitoring_order_grace_minutes (v_facility, 60) = 15
      AND public.monitoring_order_grace_minutes (v_facility, 120) = 30
      AND public.monitoring_order_grace_minutes (v_facility, 240) = 60, 'the seeded interval scaled grace rule no longer gives 10, 15, 30 and 60 at the four presets. Spec 5.2 names those, and migration 432 was meant to move the divisor into a row without changing any answer.');

  -- A building nobody configured raises rather than answering NULL. A NULL
  -- grace flows into resident_observation_tasks.grace_ends_at and fails on a
  -- NOT NULL a long way from the cause.
  BEGIN
    v_grace := public.monitoring_order_grace_minutes ('00000000-0000-0000-0000-0000000000ff'::uuid, 30);
    v_raised := NULL;
  EXCEPTION
    WHEN OTHERS THEN
      v_raised := SQLSTATE;
  END;

  PERFORM
    pg_temp.sr_assert (v_raised = '22023', format('the grace rule answered %s for a facility with no thresholds row instead of raising 22023. A null grace surfaces as a NOT NULL violation on a task insert, a long way from the building that was never configured.', COALESCE(v_grace::text, 'null')));

  -- A preset the entry form offers has to be one the task table will accept.
  -- Bare UPDATE, assertion on the raise: a CHECK violation raises 23514 and a
  -- USING failure would filter silently to UPDATE 0.
  BEGIN
    UPDATE
      public.facility_observation_thresholds
    SET
      monitoring_order_interval_presets = monitoring_order_interval_presets || ARRAY[monitoring_order_interval_max_minutes + 1]
    WHERE
      facility_id = v_facility;
    v_raised := NULL;
  EXCEPTION
    WHEN check_violation THEN
      v_raised := SQLSTATE;
  END;

  PERFORM
    pg_temp.sr_assert (v_raised = '23514', format('a Monitoring Order interval preset above the configured maximum was accepted (raised %s). The picker would offer the floor a value resident_monitoring_orders rejects on insert, and authenticated holds UPDATE on this table, so a form is not the thing preventing it.', COALESCE(v_raised, 'nothing')));
END
$$;

ROLLBACK;
