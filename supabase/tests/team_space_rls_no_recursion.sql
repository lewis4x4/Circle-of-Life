-- Post-migration assertions for the Team Spaces RLS recursion repair.
-- Run after all migrations via scripts/pg-verify-migrations.mjs.

DO $$
DECLARE
  recursive_policy_count integer;
BEGIN
  SELECT count(*)
  INTO recursive_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('team_spaces', 'team_space_members', 'workspace_pages')
    AND policyname IN (
      'Members and admins see team spaces',
      'Leads and admins update team spaces',
      'Members and admins see space members',
      'Leads and admins add space members',
      'Leads and admins update space members',
      'Team members read shared workspace pages'
    )
    AND (
      COALESCE(qual, '') LIKE '%FROM team_space_members%'
      OR COALESCE(with_check, '') LIKE '%FROM team_space_members%'
    );

  IF recursive_policy_count > 0 THEN
    RAISE EXCEPTION 'team_space_rls: a policy still queries team_space_members directly';
  END IF;

  IF has_function_privilege('anon', 'haven.is_team_space_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'team_space_rls: anon can execute is_team_space_member';
  END IF;

  IF has_function_privilege('anon', 'haven.is_team_space_lead(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'team_space_rls: anon can execute is_team_space_lead';
  END IF;

  IF NOT has_function_privilege('authenticated', 'haven.is_team_space_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'team_space_rls: authenticated cannot execute is_team_space_member';
  END IF;

  IF NOT has_function_privilege('authenticated', 'haven.is_team_space_lead(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'team_space_rls: authenticated cannot execute is_team_space_lead';
  END IF;
END;
$$;
