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

-- 3. Every trigger function 389 and 390 revoked is unreachable as a function
--    and still attached as a trigger.
DO $$
DECLARE v_fn text;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY[
    'haven_payroll_batch_guard',
    'haven_payroll_line_guard',
    '_kb_seed_targets_touch',
    'haven_csc_discrepancy_defaults',
    'haven_exec_nlq_messages_touch_session',
    'seed_admission_case_form_1823'
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

ROLLBACK;
