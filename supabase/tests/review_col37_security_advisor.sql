-- COL-37: hold the Security Advisor remediations in 389 and 390 in place.
--
-- Each assertion names what it protects. If one of these starts failing, read
-- the message before changing the probe -- the point is that a later migration
-- cannot quietly undo the fix.

BEGIN;

-- 1. resident_billable_status runs on the caller's authority, not its owner's.
DO $$
BEGIN
  IF COALESCE((
    SELECT option_value
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
    LATERAL pg_catalog.pg_options_to_table(c.reloptions)
    WHERE n.nspname = 'public' AND c.relname = 'resident_billable_status'
      AND option_name = 'security_invoker'
  ), 'false') <> 'true' THEN
    RAISE EXCEPTION 'COL-37: public.resident_billable_status is back to owner rights and no longer honours RLS on public.residents';
  END IF;
END $$;

-- 2. anon holds nothing on that view, and authenticated may only read it.
DO $$
DECLARE v_anon text; v_authenticated text;
BEGIN
  SELECT string_agg(DISTINCT p.privilege_type, ',' ORDER BY p.privilege_type)
    INTO v_anon
  FROM information_schema.role_table_grants p
  WHERE p.table_schema = 'public' AND p.table_name = 'resident_billable_status'
    AND p.grantee = 'anon';
  IF v_anon IS NOT NULL THEN
    RAISE EXCEPTION 'COL-37: anon regained % on public.resident_billable_status -- the publishable key can read census status again', v_anon;
  END IF;

  SELECT string_agg(DISTINCT p.privilege_type, ',' ORDER BY p.privilege_type)
    INTO v_authenticated
  FROM information_schema.role_table_grants p
  WHERE p.table_schema = 'public' AND p.table_name = 'resident_billable_status'
    AND p.grantee = 'authenticated';
  IF v_authenticated IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'COL-37: authenticated holds % on public.resident_billable_status; the view is auto-updatable, so anything past SELECT is a write path into public.residents', COALESCE(v_authenticated, '<none>');
  END IF;
END $$;

-- 3. Every trigger function 389, 390 and 397 revoked is unreachable as a
--    function and still attached as a trigger.
DO $$
DECLARE v_fn text;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY[
    'haven_payroll_batch_guard',
    'haven_payroll_line_guard',
    '_kb_seed_targets_touch',
    'haven_csc_discrepancy_defaults',
    'haven_exec_nlq_messages_touch_session',
    'seed_admission_case_form_1823',
    -- 394's care-plan review alert triggers, revoked in 397.
    'care_plan_alert_on_condition_change',
    'care_plan_alert_on_form_1823',
    'care_plan_alert_on_incident',
    'care_plan_alert_on_resident_change',
    'care_plan_alerts_resolve_on_activation'
  ]) LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace,
      LATERAL pg_catalog.aclexplode(p.proacl) AS acl
      WHERE n.nspname = 'public' AND p.proname = v_fn
        AND acl.privilege_type = 'EXECUTE'
        AND COALESCE(acl.grantee::regrole::text, 'public') IN ('public', '-', 'anon', 'authenticated', 'service_role')
    ) THEN
      RAISE EXCEPTION 'COL-37: public.%() is executable by a request role again; it is a trigger guard and nothing should call it directly', v_fn;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn AND NOT t.tgisinternal
    ) THEN
      RAISE EXCEPTION 'COL-37: public.%() is no longer attached to any trigger -- the payroll guard stopped guarding', v_fn;
    END IF;
  END LOOP;
END $$;

-- 4. Revoking EXECUTE does not stop a trigger from firing. Proven here rather
--    than asserted, because 389 rests on it and the payroll write path is the
--    thing that would break if it were false.
CREATE FUNCTION pg_temp.col37_guard_proof() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  NEW.guarded := true;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION pg_temp.col37_guard_proof() FROM PUBLIC;
CREATE TEMP TABLE col37_guard_fixture (id integer, guarded boolean DEFAULT false);
CREATE TRIGGER col37_guard_proof BEFORE INSERT ON col37_guard_fixture
  FOR EACH ROW EXECUTE FUNCTION pg_temp.col37_guard_proof();
GRANT INSERT, SELECT ON col37_guard_fixture TO authenticated;

DO $$
DECLARE v_guarded boolean;
BEGIN
  SET LOCAL ROLE authenticated;
  INSERT INTO col37_guard_fixture (id) VALUES (1);
  SELECT guarded INTO v_guarded FROM col37_guard_fixture WHERE id = 1;
  RESET ROLE;
  IF v_guarded IS NOT TRUE THEN
    RAISE EXCEPTION 'COL-37: a BEFORE trigger did not fire for a role without EXECUTE on its function -- revisit the payroll revokes in 389';
  END IF;
END $$;

-- 4b. increment_usage writes a usage row for whatever user id it is handed, as
--     a definer. Only service_role may call it, in every environment.
DO $$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF pg_catalog.has_function_privilege(v_role, 'public.increment_usage(uuid, text, bigint, bigint)', 'EXECUTE') THEN
      RAISE EXCEPTION 'COL-37: % can execute public.increment_usage(uuid, text, bigint, bigint); it is a definer that writes counters for an arbitrary user id', v_role;
    END IF;
  END LOOP;
END $$;

-- 5. haven_assert_authorized_request keeps its grant. This one is the
--    exception, and a blanket advisor sweep would break every hosted request.
DO $$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT pg_catalog.has_function_privilege(v_role, 'public.haven_assert_authorized_request()', 'EXECUTE') THEN
      RAISE EXCEPTION 'COL-37: % lost EXECUTE on public.haven_assert_authorized_request(); PostgREST calls it through pgrst.db_pre_request before every request, so this refuses the whole API', v_role;
    END IF;
  END LOOP;
END $$;

-- 6. No function in public or haven resolves names through the caller's
--    search_path. This is the standing gate, not a snapshot of the ten that 390
--    fixed: a new definer function without a pinned path is the same bug.
DO $$
DECLARE v_unpinned text;
BEGIN
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname)
    INTO v_unpinned
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE n.nspname IN ('public', 'haven')
    AND l.lanname NOT IN ('c', 'internal')
    AND p.proconfig IS NULL;
  IF v_unpinned IS NOT NULL THEN
    RAISE EXCEPTION 'COL-37: these functions have a mutable search_path and need SET search_path on their definition: %', v_unpinned;
  END IF;
END $$;

-- 7. COL-391's ratchet. Every SECURITY DEFINER function in public that a signed
--    in user can execute must carry a ruling in its comment -- the literal
--    'COL-37 ruling:' followed by why the grant is correct, or why the definer
--    is required. The array below is the backlog that has not been ruled on
--    yet: 44 of the 53 the 2026-09-15 advisor run found. It only ever shrinks.
--    A function that is neither ruled nor listed fails here, which is the point
--    -- a new feature cannot add definer RPC surface without a ruling.
DO $$
DECLARE
  v_pending text[] := ARRAY[
    'apply_col_discovery_round_observation_plan',
    'apply_plantation_wing_observation_plan',
    'corporate_deliverable_command',
    'corporate_deliverable_history',
    'corporate_deliverable_snapshot',
    'exclude_payroll_draft_punch',
    'execute_compliance_rule',
    'finalize_resident_record_intake_source',
    'get_compliance_rule_status',
    'grace_top_flows',
    'haven_create_invoice_with_line_items',
    'haven_current_edge_actor',
    'haven_current_shell_actor',
    'haven_employee_file_command',
    'haven_employee_file_staff',
    'haven_employee_requirement_command',
    'haven_publish_rate_schedule',
    'haven_replace_active_resident_rate_agreement',
    'payroll_export_snapshot',
    'prepare_resident_record_intake',
    'prepare_resident_record_intake_source',
    'referral_duplicate_candidates',
    'referral_episode_capture',
    'referral_episode_command',
    'referral_episode_downstream_review',
    'referral_episode_history_read',
    'referral_episode_initial_revision',
    'referral_episode_model_read',
    'referral_lead_create',
    'referral_lead_create_from_hl7',
    'referral_lead_update',
    'referral_leads_authorized_export',
    'referral_leads_authorized_read',
    'referral_source_create',
    'referral_triage_authorized_read',
    'referral_triage_submit',
    'refresh_payroll_time_records',
    'resident_record_intake_command',
    'resident_record_intake_match_candidates',
    'resident_record_intake_snapshot',
    'resident_record_intake_source_target',
    'system_alert_email_test',
    'system_alert_settings_get',
    'system_alert_settings_update'
  ];
  v_unruled text;
  v_stale text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.proname)
    INTO v_unruled
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND COALESCE(pg_catalog.obj_description(p.oid, 'pg_proc'), '') NOT LIKE '%COL-37 ruling:%'
    AND NOT (p.proname = ANY (v_pending));
  IF v_unruled IS NOT NULL THEN
    RAISE EXCEPTION 'COL-391: these SECURITY DEFINER functions are executable by authenticated with no COL-37 ruling recorded on them: %. Rule on each one (definer required / switch to invoker / revoke to service_role) and record it as a COMMENT containing "COL-37 ruling:".', v_unruled;
  END IF;

  -- The pending list must not outlive the work. Once a function is ruled, its
  -- name comes out of the array in the same change -- otherwise the list stops
  -- describing the backlog and starts hiding it. Functions absent from this
  -- database are skipped: staging and a clean local replay do not always carry
  -- the same surface as production.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
    INTO v_stale
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (v_pending)
    AND (
      NOT p.prosecdef
      OR COALESCE(pg_catalog.obj_description(p.oid, 'pg_proc'), '') LIKE '%COL-37 ruling:%'
    );
  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'COL-391: these functions have been ruled on but are still in this probe''s pending list: %. Remove them from v_pending in the same change that rules on them.', v_stale;
  END IF;
END $$;

-- 8. The four functions 393 found to be incidental definers stay invokers.
--    Section 7 cannot catch a revert on its own -- their comments already carry
--    a ruling, so flipping SECURITY DEFINER back on would read as ruled.
DO $$
DECLARE v_reverted text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
    INTO v_reverted
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.proname = ANY (ARRAY[
      'rename_nlq_thread',
      'set_nlq_thread_pinned',
      'set_nlq_thread_archived',
      'search_nlq_threads'
    ]);
  IF v_reverted IS NOT NULL THEN
    RAISE EXCEPTION 'COL-391: % went back to SECURITY DEFINER. 393 ruled these incidental -- their bodies restate the exec_nlq_sessions policies, so caller authority reaches the same rows. If that stopped being true, say so in the comment and in this assertion rather than reverting quietly.', v_reverted;
  END IF;
END $$;

-- 9. No role guard compares the app_role enum against an empty string.
--    haven.app_role() returns public.app_role, so COALESCE(haven.app_role(), '')
--    resolves '' to that enum and Postgres folds the coercion at plan time: the
--    statement raises 22P02 every time it runs, before the guard decides
--    anything. 275, 276 and 277 shipped six NLQ RPCs with that guard and none of
--    them has ever executed. A check that raises instead of deciding is worse
--    than no check, because it reads like protection. Cast to text first.
DO $$
DECLARE v_broken text;
BEGIN
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname)
    INTO v_broken
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'haven')
    AND p.prosrc LIKE '%app_role(), ''''%';
  IF v_broken IS NOT NULL THEN
    RAISE EXCEPTION 'COL-391: these functions guard on COALESCE(haven.app_role(), ''''), which raises 22P02 invalid input value for enum app_role at plan time and never reaches the comparison: %. Write it as COALESCE(haven.app_role()::text, '''') or compare against enum literals.', v_broken;
  END IF;
END $$;

ROLLBACK;
