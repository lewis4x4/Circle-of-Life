-- Migration 170: Seed med_tech demo user for the Med-Tech Shift Cockpit
-- Password: Sp33dy22 (same as all demo users)
-- IMPORTANT: Set all token columns to '' to prevent GoTrue NULL crash (see migration 168)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  crypto_schema text;
  pw text;
  inst uuid := '00000000-0000-0000-0000-000000000000';
  org  uuid := '00000000-0000-0000-0000-000000000001';
  fac  uuid := '00000000-0000-0000-0002-000000000001';
  ts   timestamptz := now();
BEGIN
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

  -- ── Auth user ──
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    email_change_confirm_status, phone_change, phone_change_token,
    reauthentication_token
  ) VALUES (
    'a0000000-0000-0000-0000-000000000012', inst,
    'medtech@circleoflifealf.com', pw, ts,
    '{"provider":"email","providers":["email"],"app_role":"med_tech"}',
    '{"full_name":"Maria Ochoa","email_verified":true}',
    'authenticated', 'authenticated',
    ts, ts,
    '', '', '', '', '', 0, '', '', ''
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    email = EXCLUDED.email,
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    recovery_token = '',
    email_change_token_new = '',
    email_change = '',
    email_change_token_current = '',
    email_change_confirm_status = 0,
    phone_change = '',
    phone_change_token = '',
    reauthentication_token = '',
    updated_at = EXCLUDED.updated_at;

  -- ── Auth identity ──
  DELETE FROM auth.identities WHERE user_id = 'a0000000-0000-0000-0000-000000000012';

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (
    'b0000000-0000-0000-0000-000000000012',
    'a0000000-0000-0000-0000-000000000012',
    '{"sub":"a0000000-0000-0000-0000-000000000012","email":"medtech@circleoflifealf.com","email_verified":true,"phone_verified":false}',
    'email', 'a0000000-0000-0000-0000-000000000012', ts, ts, ts
  );
END $$;

-- ── User profile ──
INSERT INTO user_profiles (id, organization_id, email, full_name, phone, app_role) VALUES
  ('a0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001',
   'medtech@circleoflifealf.com', 'Maria Ochoa', '386-339-1650', 'med_tech')
ON CONFLICT (id) DO UPDATE SET
  app_role = EXCLUDED.app_role,
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name;

-- ── Facility access (Oakridge) ──
INSERT INTO user_facility_access (id, user_id, facility_id, organization_id, is_primary) VALUES
  ('f0000000-fa00-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000012',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', true)
ON CONFLICT DO NOTHING;
