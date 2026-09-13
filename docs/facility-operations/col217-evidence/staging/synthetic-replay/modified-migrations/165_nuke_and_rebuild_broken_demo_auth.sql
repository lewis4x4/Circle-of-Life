-- Migration 165: Nuclear rebuild of broken demo auth.users rows.
--
-- GoTrue returns "Database error loading user" for IDs 003, 005, 007, 008-011.
-- The rows are so corrupt that UPDATE cannot fix them and DELETE via admin API
-- returns 500. We must delete via SQL and re-insert clean rows.
--
-- Strategy:
-- 1. Drop FK on user_profiles.id → auth.users(id) temporarily
-- 2. Delete broken auth.users rows (sessions + identities already cleared by 164)
-- 3. Re-insert with clean data
-- 4. Restore FK constraint

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  crypto_schema text;
  pw text;
  inst uuid;
  ts timestamptz := now();
  broken_ids uuid[] := ARRAY[
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000007',
    'a0000000-0000-0000-0000-000000000008',
    'a0000000-0000-0000-0000-000000000009',
    'a0000000-0000-0000-0000-000000000010',
    'a0000000-0000-0000-0000-000000000011'
  ];
BEGIN
  -- Resolve pgcrypto
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'gen_salt' AND n.nspname = 'extensions'
    ) THEN 'extensions' ELSE 'public'
  END INTO crypto_schema;

  EXECUTE format(
    'SELECT %I.crypt(%L, %I.gen_salt(%L))',
    crypto_schema, 'Sp33dy22', crypto_schema, 'bf'
  ) INTO pw;

  -- Get instance_id from a working user
  SELECT instance_id INTO inst
  FROM auth.users
  WHERE id = 'a0000000-0000-0000-0000-000000000001';
  IF inst IS NULL THEN
    inst := '00000000-0000-0000-0000-000000000000';
  END IF;

  -- ── 1. Disable FK checks for the duration of this block ──
  -- (postgres role has superuser, so session_replication_role works)
  SET session_replication_role = 'replica';

  -- ── 2. Clean up any remaining auth data for broken users ──
  DELETE FROM auth.mfa_factors WHERE user_id = ANY(broken_ids);
  DELETE FROM auth.sessions WHERE user_id = ANY(broken_ids);
  DELETE FROM auth.identities WHERE user_id = ANY(broken_ids);
  DELETE FROM auth.users WHERE id = ANY(broken_ids);

  RAISE NOTICE 'Deleted broken auth rows for % users', array_length(broken_ids, 1);

  -- ── 3. Re-insert auth.users with clean rows ──
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
    (inst, 'a0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
     'synthetic-2fc22c1aa3@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"nurse"}'::jsonb,
     '{"full_name":"Synthetic full_name c56a8b8ad4","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
     'synthetic-ac844d9cd5@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"caregiver"}'::jsonb,
     '{"full_name":"Synthetic full_name 14dec61b7e","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated',
     'synthetic-3785ef655c@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"family"}'::jsonb,
     '{"full_name":"Synthetic full_name 8d29b5387b","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated',
     'synthetic-bb50c86f98@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"org_admin"}'::jsonb,
     '{"full_name":"Synthetic full_name 7e6566c120","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated',
     'synthetic-21aae64649@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"dietary"}'::jsonb,
     '{"full_name":"Synthetic full_name fa5c8a067a","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated',
     'synthetic-bfe7fb9012@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"maintenance_role"}'::jsonb,
     '{"full_name":"Synthetic full_name e7a7ce62c5","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated',
     'synthetic-3c87f98f6c@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"broker"}'::jsonb,
     '{"full_name":"Synthetic full_name 1e3e98924d","email_verified":true}'::jsonb,
     ts, ts);

  -- ── 4. Re-insert auth.identities (email is GENERATED from identity_data) ──
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003',
     '{"sub":"a0000000-0000-0000-0000-000000000003","email":"synthetic-2fc22c1aa3@example.invalid","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000003', ts, ts, ts),
    ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005',
     '{"sub":"a0000000-0000-0000-0000-000000000005","email":"synthetic-ac844d9cd5@example.invalid","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000005', ts, ts, ts),
    ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000007',
     '{"sub":"a0000000-0000-0000-0000-000000000007","email":"synthetic-3785ef655c@example.invalid","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000007', ts, ts, ts),
    ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000008',
     '{"sub":"a0000000-0000-0000-0000-000000000008","email":"synthetic-bb50c86f98@example.invalid","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000008', ts, ts, ts),
    ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000009',
     '{"sub":"a0000000-0000-0000-0000-000000000009","email":"synthetic-21aae64649@example.invalid","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000009', ts, ts, ts),
    ('b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000010',
     '{"sub":"a0000000-0000-0000-0000-000000000010","email":"synthetic-bfe7fb9012@example.invalid","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000010', ts, ts, ts),
    ('b0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000011',
     '{"sub":"a0000000-0000-0000-0000-000000000011","email":"synthetic-3c87f98f6c@example.invalid","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000011', ts, ts, ts);

  -- ── 5. Re-enable FK checks ──
  SET session_replication_role = 'origin';

  RAISE NOTICE 'Rebuilt 7 broken demo auth.users + identities';
END $$;

NOTIFY pgrst, 'reload schema';
