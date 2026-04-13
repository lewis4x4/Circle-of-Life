-- Migration 164: Fix demo user auth — nuclear rebuild of auth identities.
--
-- Root cause: auth.identities.email is a GENERATED column (derived from
-- identity_data->>'email'). Earlier migrations (093/094) inserted identity
-- rows before this generated column existed. When Supabase Auth upgraded
-- and added the generated column, rows with stale or NULL identity_data
-- email caused GoTrue to crash with "Database error querying schema".
--
-- Fix: Delete and rebuild ALL demo auth.identities rows with correct
-- identity_data so the generated email column computes correctly.
-- Also re-sync auth.users passwords, emails, and app_role metadata.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  crypto_schema text;
  pw text;
  ts timestamptz := now();
  inst uuid;
BEGIN
  -- Resolve pgcrypto schema
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

  -- Get the instance_id from any existing auth.users row
  -- (Supabase hosted uses a specific instance UUID)
  SELECT instance_id INTO inst
  FROM auth.users
  LIMIT 1;

  -- Fallback if no users exist
  IF inst IS NULL THEN
    inst := '00000000-0000-0000-0000-000000000000';
  END IF;

  RAISE NOTICE 'Using instance_id: %', inst;

  -- ── 1. Delete existing sessions/refresh tokens for demo users ──
  DELETE FROM auth.sessions WHERE user_id IN (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007',
    'a0000000-0000-0000-0000-000000000008',
    'a0000000-0000-0000-0000-000000000009',
    'a0000000-0000-0000-0000-000000000010',
    'a0000000-0000-0000-0000-000000000011'
  );

  -- ── 2. Delete all demo identities ──
  DELETE FROM auth.identities WHERE user_id IN (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007',
    'a0000000-0000-0000-0000-000000000008',
    'a0000000-0000-0000-0000-000000000009',
    'a0000000-0000-0000-0000-000000000010',
    'a0000000-0000-0000-0000-000000000011'
  );

  -- ── 3. Upsert auth.users with correct data ──
  -- Original 7 demo users
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
    (inst, 'a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
     'milton.smith@circleoflifealf.com', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"owner"}'::jsonb,
     '{"full_name":"Milton Smith","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
     'jessica.murphy@circleoflifealf.com', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"facility_admin"}'::jsonb,
     '{"full_name":"Jessica Murphy","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
     'sarah.williams@circleoflifealf.com', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"nurse"}'::jsonb,
     '{"full_name":"Sarah Williams","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
     'maria.garcia@circleoflifealf.com', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"caregiver"}'::jsonb,
     '{"full_name":"Maria Garcia","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
     'james.thompson@circleoflifealf.com', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"caregiver"}'::jsonb,
     '{"full_name":"James Thompson","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated',
     'robert.sullivan@circleoflifealf.com', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"owner"}'::jsonb,
     '{"full_name":"Robert Sullivan","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated',
     'linda.chen@circleoflifealf.com', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"family"}'::jsonb,
     '{"full_name":"Linda Chen","email_verified":true}'::jsonb,
     ts, ts),
    -- 4 new role demo users
    (inst, 'a0000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated',
     'admin@circleoflifealf.com', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"org_admin"}'::jsonb,
     '{"full_name":"David Martinez","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated',
     'dietary@circleoflifealf.com', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"dietary"}'::jsonb,
     '{"full_name":"Patricia Nguyen","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated',
     'maintenance@circleoflifealf.com', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"maintenance_role"}'::jsonb,
     '{"full_name":"Carlos Rivera","email_verified":true}'::jsonb,
     ts, ts),
    (inst, 'a0000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated',
     'broker@circleoflifealf.com', pw, ts, '',
     '{"provider":"email","providers":["email"],"app_role":"broker"}'::jsonb,
     '{"full_name":"Angela Brooks","email_verified":true}'::jsonb,
     ts, ts)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = EXCLUDED.email_confirmed_at,
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = EXCLUDED.updated_at;

  -- ── 4. Rebuild identities ──
  -- `email` column is GENERATED ALWAYS from identity_data->>'email',
  -- so we MUST NOT include it in INSERT. It auto-computes from identity_data.

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
     '{"sub":"a0000000-0000-0000-0000-000000000001","email":"milton.smith@circleoflifealf.com","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000001', ts, ts, ts),

    ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002',
     '{"sub":"a0000000-0000-0000-0000-000000000002","email":"jessica.murphy@circleoflifealf.com","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000002', ts, ts, ts),

    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003',
     '{"sub":"a0000000-0000-0000-0000-000000000003","email":"sarah.williams@circleoflifealf.com","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000003', ts, ts, ts),

    ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004',
     '{"sub":"a0000000-0000-0000-0000-000000000004","email":"maria.garcia@circleoflifealf.com","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000004', ts, ts, ts),

    ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005',
     '{"sub":"a0000000-0000-0000-0000-000000000005","email":"james.thompson@circleoflifealf.com","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000005', ts, ts, ts),

    ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006',
     '{"sub":"a0000000-0000-0000-0000-000000000006","email":"robert.sullivan@circleoflifealf.com","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000006', ts, ts, ts),

    ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000007',
     '{"sub":"a0000000-0000-0000-0000-000000000007","email":"linda.chen@circleoflifealf.com","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000007', ts, ts, ts),

    ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000008',
     '{"sub":"a0000000-0000-0000-0000-000000000008","email":"admin@circleoflifealf.com","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000008', ts, ts, ts),

    ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000009',
     '{"sub":"a0000000-0000-0000-0000-000000000009","email":"dietary@circleoflifealf.com","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000009', ts, ts, ts),

    ('b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000010',
     '{"sub":"a0000000-0000-0000-0000-000000000010","email":"maintenance@circleoflifealf.com","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000010', ts, ts, ts),

    ('b0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000011',
     '{"sub":"a0000000-0000-0000-0000-000000000011","email":"broker@circleoflifealf.com","email_verified":true,"phone_verified":false}'::jsonb,
     'email', 'a0000000-0000-0000-0000-000000000011', ts, ts, ts)
  ON CONFLICT (provider_id, provider) DO UPDATE SET
    identity_data = EXCLUDED.identity_data,
    updated_at = EXCLUDED.updated_at;

  -- ── 5. Update user_profiles emails to match (001 and 002 had old emails) ──
  UPDATE user_profiles SET email = 'milton.smith@circleoflifealf.com'
    WHERE id = 'a0000000-0000-0000-0000-000000000001' AND email != 'milton.smith@circleoflifealf.com';
  UPDATE user_profiles SET email = 'jessica.murphy@circleoflifealf.com'
    WHERE id = 'a0000000-0000-0000-0000-000000000002' AND email != 'jessica.murphy@circleoflifealf.com';
  UPDATE user_profiles SET email = 'robert.sullivan@circleoflifealf.com', app_role = 'owner'
    WHERE id = 'a0000000-0000-0000-0000-000000000006';

  RAISE NOTICE 'Demo users rebuilt — 11 auth.users + 11 auth.identities (with email column)';
END $$;

-- Also fix the NOTIFY for good measure
NOTIFY pgrst, 'reload schema';
