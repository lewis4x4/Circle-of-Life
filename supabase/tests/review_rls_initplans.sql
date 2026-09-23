-- COL-696 (after COL-664 / 474): a no-argument haven.* helper called bare in a policy
-- runs once per row, and each call re-resolves the actor from user_profiles, auth.users
-- and auth.sessions. Wrap it: (SELECT haven.app_role()) is evaluated once per statement.
-- Fails the replay if any policy in public or haven calls one of these helpers bare.
BEGIN;
DO $probe$
DECLARE
  v text;
  bare constant text := '(?<!SELECT )haven\.(organization_id|app_role|authorized_user_id|can_run_board_check|can_run_staff_check|can_disposition_watchlist_signal|employee_manager)\(\)';
BEGIN
  SELECT string_agg(schemaname || '.' || tablename || ' "' || policyname || '"', ', ' ORDER BY schemaname, tablename, policyname)
    INTO v
  FROM pg_catalog.pg_policies
  WHERE schemaname IN ('public', 'haven')
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ bare;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'Policies call a no-argument haven helper bare (wrap it as (SELECT haven.x())): %', v;
  END IF;

  -- Every helper hoisted this way must stay STABLE, or wrapping would change results.
  SELECT string_agg(p.proname, ', ') INTO v
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'haven' AND p.pronargs = 0
    AND p.proname IN ('organization_id','app_role','authorized_user_id','can_run_board_check','can_run_staff_check','can_disposition_watchlist_signal','employee_manager')
    AND p.provolatile <> 's';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'Hoisted RLS helpers must be STABLE: %', v;
  END IF;

  IF has_function_privilege('authenticated', 'haven.wrap_rls_initplans(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'haven.wrap_rls_initplans(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'haven.wrap_rls_initplans is a migration tool and must not be callable by API roles';
  END IF;
END
$probe$;
ROLLBACK;
