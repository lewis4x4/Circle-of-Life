-- Idempotent tracking repair for manfqmasfqppukpobpld (applied 2026-08-19).
-- DDL for 310–314 was already live; 315–316 were applied in the same session.
-- Remote 314 was misnamed as workspace_cast (local 315). 308/309 names were
-- occupied by early Command Center applies that later became 313/315.

UPDATE supabase_migrations.schema_migrations
SET name = 'fix_team_space_members_rls_recursion'
WHERE version = '314';

UPDATE supabase_migrations.schema_migrations
SET name = 'revoke_anon_security_definer_rpc_execute'
WHERE version = '308';

UPDATE supabase_migrations.schema_migrations
SET name = 'family_portal_messages_one_way'
WHERE version = '309';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES
  ('310', 'col_discovery_round_cadence_jessica_2026_08_14'),
  ('311', 'snack_logs_time_and_passer_only'),
  ('312', 'revoke_anon_col_discovery_round_rpcs'),
  ('313', 'admin_command_center_projection'),
  ('315', 'admin_command_center_projection_workspace_cast'),
  ('316', 'admin_command_center_manager_access')
ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;
