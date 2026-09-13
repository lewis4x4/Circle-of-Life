-- Migration 166: Rebuild broken demo auth rows WITH triggers enabled.
--
-- Migration 165 deleted and re-inserted rows with session_replication_role='replica',
-- which disabled all triggers including GoTrue's internal triggers.
-- This migration deletes those rows again and re-inserts with triggers active.

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

  SELECT instance_id INTO inst
  FROM auth.users
  WHERE id = 'a0000000-0000-0000-0000-000000000001';
  IF inst IS NULL THEN
    inst := '00000000-0000-0000-0000-000000000000';
  END IF;

  -- ── STEP 1: Delete with FK checks disabled ──
  SET LOCAL session_replication_role = 'replica';

  DELETE FROM auth.mfa_factors WHERE user_id = ANY(broken_ids);
  DELETE FROM auth.sessions WHERE user_id = ANY(broken_ids);
  DELETE FROM auth.identities WHERE user_id = ANY(broken_ids);
  DELETE FROM auth.users WHERE id = ANY(broken_ids);

  RAISE NOTICE 'Deleted broken rows (replica mode)';

  -- ── STEP 2: Re-enable triggers BEFORE insert ──
  SET LOCAL session_replication_role = 'origin';

  RAISE NOTICE 'Triggers re-enabled, inserting fresh rows';

  -- ── STEP 3: Insert auth.users with triggers active ──
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
    (inst, 'a0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
     'synthetic-2fc22c1aa3@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"nurse"}'::jsonb,
     '{"full_name":"Synthetic full_name c56a8b8ad4","email_verified":true}'::jsonb, ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
     'synthetic-ac844d9cd5@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"caregiver"}'::jsonb,
     '{"full_name":"Synthetic full_name 14dec61b7e","email_verified":true}'::jsonb, ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated',
     'synthetic-3785ef655c@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"family"}'::jsonb,
     '{"full_name":"Synthetic full_name 8d29b5387b","email_verified":true}'::jsonb, ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated',
     'synthetic-bb50c86f98@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"org_admin"}'::jsonb,
     '{"full_name":"Synthetic full_name 7e6566c120","email_verified":true}'::jsonb, ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated',
     'synthetic-21aae64649@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"dietary"}'::jsonb,
     '{"full_name":"Synthetic full_name fa5c8a067a","email_verified":true}'::jsonb, ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated',
     'synthetic-bfe7fb9012@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"maintenance_role"}'::jsonb,
     '{"full_name":"Synthetic full_name e7a7ce62c5","email_verified":true}'::jsonb, ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated',
     'synthetic-3c87f98f6c@example.invalid', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"broker"}'::jsonb,
     '{"full_name":"Synthetic full_name 1e3e98924d","email_verified":true}'::jsonb, ts, ts);

  -- ── STEP 4: Insert identities (email column is GENERATED) ──
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

  RAISE NOTICE 'Done — 7 auth.users + 7 auth.identities rebuilt with triggers active';
END $$;
