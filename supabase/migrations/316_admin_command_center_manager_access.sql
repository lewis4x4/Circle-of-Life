-- Forward-fix manager access for projects where the Command Center projection
-- was applied before the manager role was added to its allowlist.
-- Fresh replays already receive the updated definition from migration 315;
-- this guarded rewrite keeps deployed projects aligned without changing the
-- function signature or bypassing its existing RLS-backed query behavior.

DO $migration$
DECLARE
  current_definition text;
  updated_definition text;
  previous_guard constant text :=
    'IF haven.app_role() NOT IN (''owner'', ''org_admin'', ''facility_admin'') THEN';
  manager_guard constant text :=
    'IF haven.app_role() NOT IN (''owner'', ''org_admin'', ''facility_admin'', ''manager'') THEN';
BEGIN
  SELECT pg_get_functiondef(
    'public.admin_command_center_projection(uuid)'::regprocedure
  )
  INTO current_definition;

  IF strpos(current_definition, manager_guard) > 0 THEN
    RETURN;
  END IF;

  updated_definition := replace(
    current_definition,
    previous_guard,
    manager_guard
  );

  IF updated_definition = current_definition THEN
    RAISE EXCEPTION
      'admin_command_center_projection role guard did not match the expected definition';
  END IF;

  EXECUTE updated_definition;
END;
$migration$;

REVOKE ALL ON FUNCTION public.admin_command_center_projection(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_command_center_projection(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_command_center_projection(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_command_center_projection(uuid) IS
  'RLS-preserving Command Center projection for owner, org_admin, facility_admin, and manager roles.';
