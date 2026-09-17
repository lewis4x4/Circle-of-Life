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
-- 2. anon holds nothing on any of the module's eleven tables.
--
-- anon is the publishable key. Every one of these tables carries either
-- resident clinical instructions, the ladder that decides who gets woken up, or
-- the record of who was told what about a missed check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_tables CONSTANT text[] := ARRAY['facility_shift_definitions', 'facility_cadence_versions', 'facility_cadence_windows', 'resident_monitoring_orders', 'resident_monitoring_order_events', 'resident_monitoring_order_notifications', 'facility_escalation_versions', 'facility_escalation_rungs', 'facility_escalation_rung_shift_overrides', 'observation_escalation_dispatches', 'observation_escalation_deliveries'];
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
  c_service_only CONSTANT text[] := ARRAY['public.record_cadence_observation_tasks(jsonb)', 'public.generate_monitoring_order_tasks(uuid,timestamptz)', 'public.record_observation_escalation_rung(uuid,text,timestamptz)', 'public.expire_monitoring_orders()', 'public.advance_observation_task_lapse(uuid,uuid,timestamptz)', 'public.ensure_facility_observation_defaults(uuid)', 'public.fn_facilities_seed_observation_defaults()', 'public.resolve_observation_task_assignees(uuid,date,text,uuid[])', 'public.record_observation_staffing_gap(uuid,text,date)', 'public.observation_windows_under_monitoring_order(uuid,timestamptz)', 'public.reinstate_standard_observation_windows(uuid,timestamptz)', 'haven.observation_escalation_recipients(uuid,uuid,uuid,uuid)', 'haven.notify_monitoring_order_created(uuid)'];
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
  c_caller_facing CONSTANT text[] := ARRAY['public.create_monitoring_order(uuid,integer,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text)', 'public.cancel_monitoring_order(uuid,text)', 'public.submit_observation(uuid,jsonb,text,text,text,text,text,text[],timestamptz,text,uuid,boolean,uuid,text,uuid,integer)'];
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
  c_module CONSTANT text[] := ARRAY['facility_cadence_in_force', 'facility_observation_windows_for_version', 'facility_observation_windows_for_date', 'facility_shift_window_at', 'facility_next_shift_window', 'facility_next_shift_observation_windows', 'record_cadence_observation_tasks', 'can_record_observation', 'can_cancel_monitoring_order', 'observation_grace_formula', 'monitoring_order_grace_minutes', 'generate_monitoring_order_tasks', 'notify_monitoring_order_created', 'create_monitoring_order', 'cancel_monitoring_order', 'expire_monitoring_orders', 'record_monitoring_order_event', 'monitoring_order_reason_from_watch_source', 'monitoring_order_bridge_defaults', 'bridge_watch_instance_to_monitoring_order', 'monitoring_order_interval_options', 'submit_observation', 'observation_quick_status_label', 'observation_vocab_label', 'compose_observation_summary', 'haven_compose_observation_summary', 'facility_escalation_in_force', 'observation_grace_minutes', 'observation_task_window_close', 'observation_escalation_rungs_at', 'observation_escalations_due', 'observation_escalation_recipients', 'record_observation_escalation_rung', 'advance_observation_task_lapse', 'send_test_escalation', 'observation_compliance_for_range', 'ensure_facility_observation_defaults', 'fn_facilities_seed_observation_defaults', 'assert_monitoring_order_facility_matches_resident', 'resolve_observation_task_assignees', 'record_observation_staffing_gap', 'monitoring_order_covers_window', 'facility_observation_windows_in_span', 'observation_windows_under_monitoring_order', 'reinstate_standard_observation_windows'];
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
-- 5. The three append only ledgers have no UPDATE and no DELETE policy.
--
-- resident_monitoring_order_events is the record of what a clinical order said
-- and when it changed. The two escalation ledgers are the record of what fired
-- and who was told. A row that can be edited afterwards is not evidence.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_ledgers CONSTANT text[] := ARRAY['resident_monitoring_order_events', 'observation_escalation_dispatches', 'observation_escalation_deliveries'];
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
  c_policies CONSTANT text[] := ARRAY['facility_shift_definitions.facility_shift_definitions_update', 'facility_cadence_versions.facility_cadence_versions_update', 'facility_cadence_windows.facility_cadence_windows_update', 'resident_monitoring_orders.resident_monitoring_orders_update', 'facility_escalation_versions.facility_escalation_versions_update', 'facility_escalation_rungs.facility_escalation_rungs_update', 'facility_escalation_rung_shift_overrides.facility_escalation_rung_shift_overrides_update'];
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
      pg_temp.sr_assert (v_using LIKE '%accessible_facility_ids%', format('%s on public.%s lost the facility predicate from USING.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (v_check IS NOT NULL, format('%s on public.%s has no WITH CHECK clause at all, so its USING clause is reused and any row it can read it can write anywhere.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (v_check LIKE '%accessible_facility_ids%', format('%s on public.%s dropped the facility predicate from WITH CHECK. A caller can read a row inside their scope and write it into a facility outside it.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (v_check LIKE '%organization_id%', format('%s on public.%s dropped the organization predicate from WITH CHECK.', v_policy, v_table));
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
      pg_temp.sr_assert (v_using LIKE '%' || v_parent || '%'
        AND v_using LIKE '%draft%'
        AND v_using LIKE '%pending_approval%', format('%s on public.%s no longer requires its parent version be draft or pending_approval in USING. The version in force became editable in place.', v_policy, v_table));
    PERFORM
      pg_temp.sr_assert (v_check LIKE '%' || v_parent || '%'
        AND v_check LIKE '%draft%'
        AND v_check LIKE '%pending_approval%', format('%s on public.%s no longer requires its parent version be draft or pending_approval in WITH CHECK, so a row can be reattached from a draft to the version in force.', v_policy, v_table));
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
    pg_temp.sr_assert (v_src LIKE '%interval_minutes%', 'haven.record_monitoring_order_event no longer names interval_minutes among the fields it records. That column is how often a resident is looked at.');

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

  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'create_monitoring_order';
  PERFORM
    pg_temp.sr_assert (v_src LIKE '%monitoring_order_covers_window%', 'public.create_monitoring_order no longer excuses on the window overlap test. Its 416 predicate was due_at > starts_at with no upper bound, so an order ending at midday excused that evening and that night as well and nothing ever put them back.');

  SELECT
    p.prosrc INTO v_src
  FROM
    pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE
    n.nspname = 'public'
    AND p.proname = 'observation_windows_under_monitoring_order';
  PERFORM
    pg_temp.sr_assert (v_src LIKE '%monitoring_order_covers_window%', 'public.observation_windows_under_monitoring_order stopped using the shared overlap test, so the generator and the create command can now disagree about which windows an order owns.');

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
        pg_temp.sr_assert (v_src LIKE '%reinstate_standard_observation_windows%', 'cancelling or expiring a Monitoring Order no longer reinstates the standard cadence. A resident coming off an order is somebody who just fell or just came back from hospital, and without this they have no observation task at all until the next generator tick.');
    END LOOP;
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
    pg_temp.sr_assert (v_source_cadence IS NOT NULL, 'the seeded cadence version is missing; migration 414 no longer seeds one.');

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
    pg_temp.sr_assert (v_source_ladder IS NOT NULL, 'the seeded escalation version is missing; migration 417 no longer seeds one.');

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
-- cross facility move was refused by that policy before migration 420 as well.
--
-- Which means a test that only attempts the move proves nothing about the fix:
-- it passes against the broken policy. The second half of this block therefore
-- widens the SELECT policy to the whole organization, inside this rolled back
-- transaction, and attempts the move again. With the sibling policy out of the
-- way the UPDATE policy's WITH CHECK is the only thing left, and that assertion
-- does fail without migration 420.
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

-- 10c. M1, demonstrated. The rungs of the ladder in force cannot be edited; the
--      rungs of a draft can.
DO $$
DECLARE
  v_active_ladder CONSTANT uuid := '5add0000-0000-4000-8000-00000000000b';
  v_draft_ladder CONSTANT uuid := '5add0000-0000-4000-8000-00000000000c';
  v_in_force integer;
  v_draft integer;
  v_override_in_force integer;
BEGIN
  SET LOCAL ROLE authenticated;

  UPDATE
    public.facility_escalation_rungs
  SET
    offset_minutes = offset_minutes + 1
  WHERE
    escalation_version_id = v_active_ladder;
  GET DIAGNOSTICS v_in_force = ROW_COUNT;
  PERFORM
    pg_temp.sr_assert (v_in_force = 0, format('an org_admin rewrote %s rung(s) of the escalation version currently in force. Every escalation row stamped with that version now recomputes against a ladder that was never in force.', v_in_force));

  UPDATE
    public.facility_escalation_rung_shift_overrides
  SET
    channels = ARRAY['in_app']
  WHERE
    escalation_version_id = v_active_ladder;
  GET DIAGNOSTICS v_override_in_force = ROW_COUNT;
  PERFORM
    pg_temp.sr_assert (v_override_in_force = 0, format('an org_admin rewrote %s per shift override(s) on the escalation version currently in force.', v_override_in_force));

  UPDATE
    public.facility_escalation_rungs
  SET
    offset_minutes = offset_minutes + 1
  WHERE
    escalation_version_id = v_draft_ladder;
  GET DIAGNOSTICS v_draft = ROW_COUNT;
  PERFORM
    pg_temp.sr_assert (v_draft > 0, 'an org_admin could not edit the rungs of a draft escalation version. The M1 fix is refusing the edit the versioning scheme exists to allow.');

  RESET ROLE;
END
$$;

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
    pg_temp.sr_assert (v_row.changed_fields::text LIKE '%reason_note%', 'the history row does not name the clinical reason change.');
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
        id = v_caregiver), v_org, v_facility_a, v_staff, jsonb_build_object('request_id', gen_random_uuid(), 'observed_at', now(), 'entered_at', now(), 'entry_mode', 'live', 'quick_status', 'calm', 'resident_location', 'room', 'resident_state', 'awake'));

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

ROLLBACK;
