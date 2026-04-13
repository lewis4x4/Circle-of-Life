-- Reset all demo user passwords to a known value for UAT/demo.
-- These are seeded pilot accounts (a0000000-... UUIDs), not real users.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  crypto_schema text;
  pw text;
BEGIN
  -- Resolve pgcrypto schema (extensions on hosted, public on local)
  SELECT
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'gen_salt' AND n.nspname = 'extensions'
      ) THEN 'extensions'
      ELSE 'public'
    END
  INTO crypto_schema;

  EXECUTE format(
    'SELECT %I.crypt(%L, %I.gen_salt(%L))',
    crypto_schema, 'Sp33dy22', crypto_schema, 'bf'
  ) INTO pw;

  UPDATE auth.users
  SET
    encrypted_password = pw,
    updated_at = now()
  WHERE id IN (
    'a0000000-0000-0000-0000-000000000001',  -- Milton Smith
    'a0000000-0000-0000-0000-000000000002',  -- Jessica Murphy
    'a0000000-0000-0000-0000-000000000003',  -- Sarah Williams
    'a0000000-0000-0000-0000-000000000004',  -- Maria Garcia
    'a0000000-0000-0000-0000-000000000005',  -- James Thompson
    'a0000000-0000-0000-0000-000000000006',  -- Robert Sullivan
    'a0000000-0000-0000-0000-000000000007'   -- Linda Chen
  );

  RAISE NOTICE 'Demo user passwords reset — % rows updated',
    (SELECT count(*) FROM auth.users WHERE id::text LIKE 'a0000000-0000-0000-0000-00000000000%');
END $$;
