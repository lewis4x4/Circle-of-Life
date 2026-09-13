-- Seed demo users for the 4 roles that had no demo account:
--   org_admin, dietary, maintenance_role, broker
-- Password: Sp33dy22 (same as other demo users after migration 160)

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

  -- ── Auth users ──
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at, confirmation_token
  ) VALUES
    ('a0000000-0000-0000-0000-000000000008', inst,
     'synthetic-bb50c86f98@example.invalid', pw, ts,
     '{"provider":"email","providers":["email"]}',
     '{"full_name":"Synthetic full_name 7e6566c120","email_verified":true}',
     'authenticated','authenticated', ts, ts, ''),
    ('a0000000-0000-0000-0000-000000000009', inst,
     'synthetic-21aae64649@example.invalid', pw, ts,
     '{"provider":"email","providers":["email"]}',
     '{"full_name":"Synthetic full_name fa5c8a067a","email_verified":true}',
     'authenticated','authenticated', ts, ts, ''),
    ('a0000000-0000-0000-0000-000000000010', inst,
     'synthetic-bfe7fb9012@example.invalid', pw, ts,
     '{"provider":"email","providers":["email"]}',
     '{"full_name":"Synthetic full_name e7a7ce62c5","email_verified":true}',
     'authenticated','authenticated', ts, ts, ''),
    ('a0000000-0000-0000-0000-000000000011', inst,
     'synthetic-3c87f98f6c@example.invalid', pw, ts,
     '{"provider":"email","providers":["email"]}',
     '{"full_name":"Synthetic full_name 1e3e98924d","email_verified":true}',
     'authenticated','authenticated', ts, ts, '')
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    email = EXCLUDED.email,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = EXCLUDED.updated_at;

  -- ── Auth identities ──
  DELETE FROM auth.identities WHERE user_id IN (
    'a0000000-0000-0000-0000-000000000008',
    'a0000000-0000-0000-0000-000000000009',
    'a0000000-0000-0000-0000-000000000010',
    'a0000000-0000-0000-0000-000000000011'
  );

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES
    ('b0000000-0000-0000-0000-000000000008',
     'a0000000-0000-0000-0000-000000000008',
     '{"sub":"a0000000-0000-0000-0000-000000000008","email":"synthetic-bb50c86f98@example.invalid","email_verified":true,"phone_verified":false}',
     'email','a0000000-0000-0000-0000-000000000008', ts, ts, ts),
    ('b0000000-0000-0000-0000-000000000009',
     'a0000000-0000-0000-0000-000000000009',
     '{"sub":"a0000000-0000-0000-0000-000000000009","email":"synthetic-21aae64649@example.invalid","email_verified":true,"phone_verified":false}',
     'email','a0000000-0000-0000-0000-000000000009', ts, ts, ts),
    ('b0000000-0000-0000-0000-000000000010',
     'a0000000-0000-0000-0000-000000000010',
     '{"sub":"a0000000-0000-0000-0000-000000000010","email":"synthetic-bfe7fb9012@example.invalid","email_verified":true,"phone_verified":false}',
     'email','a0000000-0000-0000-0000-000000000010', ts, ts, ts),
    ('b0000000-0000-0000-0000-000000000011',
     'a0000000-0000-0000-0000-000000000011',
     '{"sub":"a0000000-0000-0000-0000-000000000011","email":"synthetic-3c87f98f6c@example.invalid","email_verified":true,"phone_verified":false}',
     'email','a0000000-0000-0000-0000-000000000011', ts, ts, ts);
END $$;

-- ── User profiles ──
INSERT INTO user_profiles (id, organization_id, email, full_name, phone, app_role) VALUES
  ('a0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001',
   'synthetic-bb50c86f98@example.invalid', 'Synthetic full_name 7e6566c120', '202-555-0166', 'org_admin'),
  ('a0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001',
   'synthetic-21aae64649@example.invalid', 'Synthetic full_name fa5c8a067a', '202-555-0193', 'dietary'),
  ('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001',
   'synthetic-bfe7fb9012@example.invalid', 'Synthetic full_name e7a7ce62c5', '202-555-0105', 'maintenance_role'),
  ('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001',
   'synthetic-3c87f98f6c@example.invalid', 'Synthetic full_name 1e3e98924d', '202-555-0174', 'broker')
ON CONFLICT (id) DO UPDATE SET
  app_role = EXCLUDED.app_role,
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name;

-- ── Facility access (Oakridge) ──
INSERT INTO user_facility_access (id, user_id, facility_id, organization_id, is_primary) VALUES
  ('f0000000-fa00-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000008',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', true),
  ('f0000000-fa00-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', true),
  ('f0000000-fa00-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', true),
  ('f0000000-fa00-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', true)
ON CONFLICT DO NOTHING;
