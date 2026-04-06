-- Repair hosted auth seed drift for the Oakridge demo users.
-- Migration 033 seeded auth.users directly, but hosted auth schema expectations can drift.
-- This migration normalizes the demo identities into the current email/password shape.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  crypto_schema text;
  pw text;
  inst uuid := '00000000-0000-0000-0000-000000000000';
  ts timestamptz := now();
BEGIN
  SELECT
    CASE
      WHEN EXISTS (
        SELECT
          1
        FROM
          pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE
          p.proname = 'gen_salt'
          AND n.nspname = 'extensions') THEN
        'extensions'
      ELSE
        'public'
    END
  INTO crypto_schema;

  EXECUTE format('SELECT %I.crypt(%L, %I.gen_salt(%L))', crypto_schema, 'HavenDemo2026!', crypto_schema, 'bf')
  INTO pw;

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES
    (
      inst,
      'a0000000-0000-0000-0000-000000000001',
      'authenticated',
      'authenticated',
      'milton@circleoflife.demo',
      pw,
      ts,
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Milton Smith","email_verified":true}'::jsonb,
      ts,
      ts
    ),
    (
      inst,
      'a0000000-0000-0000-0000-000000000002',
      'authenticated',
      'authenticated',
      'jessica@circleoflife.demo',
      pw,
      ts,
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Jessica Murphy","email_verified":true}'::jsonb,
      ts,
      ts
    ),
    (
      inst,
      'a0000000-0000-0000-0000-000000000003',
      'authenticated',
      'authenticated',
      'sarah.williams@circleoflife.demo',
      pw,
      ts,
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Sarah Williams","email_verified":true}'::jsonb,
      ts,
      ts
    ),
    (
      inst,
      'a0000000-0000-0000-0000-000000000004',
      'authenticated',
      'authenticated',
      'maria.garcia@circleoflife.demo',
      pw,
      ts,
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Maria Garcia","email_verified":true}'::jsonb,
      ts,
      ts
    ),
    (
      inst,
      'a0000000-0000-0000-0000-000000000005',
      'authenticated',
      'authenticated',
      'james.thompson@circleoflife.demo',
      pw,
      ts,
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"James Thompson","email_verified":true}'::jsonb,
      ts,
      ts
    ),
    (
      inst,
      'a0000000-0000-0000-0000-000000000006',
      'authenticated',
      'authenticated',
      'robert.sullivan@family.demo',
      pw,
      ts,
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Robert Sullivan","email_verified":true}'::jsonb,
      ts,
      ts
    ),
    (
      inst,
      'a0000000-0000-0000-0000-000000000007',
      'authenticated',
      'authenticated',
      'linda.chen@family.demo',
      pw,
      ts,
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Linda Chen","email_verified":true}'::jsonb,
      ts,
      ts
    )
  ON CONFLICT (id) DO UPDATE
  SET
    aud = EXCLUDED.aud,
    role = EXCLUDED.role,
    email = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = EXCLUDED.email_confirmed_at,
    confirmation_token = EXCLUDED.confirmation_token,
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = EXCLUDED.updated_at;

  DELETE FROM auth.identities
  WHERE
    provider = 'email'
    AND user_id IN (
      'a0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000002',
      'a0000000-0000-0000-0000-000000000003',
      'a0000000-0000-0000-0000-000000000004',
      'a0000000-0000-0000-0000-000000000005',
      'a0000000-0000-0000-0000-000000000006',
      'a0000000-0000-0000-0000-000000000007'
    );

  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  )
  VALUES
    (
      'b0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000001',
      '{"sub":"a0000000-0000-0000-0000-000000000001","email":"milton@circleoflife.demo","email_verified":true,"phone_verified":false}'::jsonb,
      'email',
      'a0000000-0000-0000-0000-000000000001',
      ts,
      ts,
      ts
    ),
    (
      'b0000000-0000-0000-0000-000000000002',
      'a0000000-0000-0000-0000-000000000002',
      '{"sub":"a0000000-0000-0000-0000-000000000002","email":"jessica@circleoflife.demo","email_verified":true,"phone_verified":false}'::jsonb,
      'email',
      'a0000000-0000-0000-0000-000000000002',
      ts,
      ts,
      ts
    ),
    (
      'b0000000-0000-0000-0000-000000000003',
      'a0000000-0000-0000-0000-000000000003',
      '{"sub":"a0000000-0000-0000-0000-000000000003","email":"sarah.williams@circleoflife.demo","email_verified":true,"phone_verified":false}'::jsonb,
      'email',
      'a0000000-0000-0000-0000-000000000003',
      ts,
      ts,
      ts
    ),
    (
      'b0000000-0000-0000-0000-000000000004',
      'a0000000-0000-0000-0000-000000000004',
      '{"sub":"a0000000-0000-0000-0000-000000000004","email":"maria.garcia@circleoflife.demo","email_verified":true,"phone_verified":false}'::jsonb,
      'email',
      'a0000000-0000-0000-0000-000000000004',
      ts,
      ts,
      ts
    ),
    (
      'b0000000-0000-0000-0000-000000000005',
      'a0000000-0000-0000-0000-000000000005',
      '{"sub":"a0000000-0000-0000-0000-000000000005","email":"james.thompson@circleoflife.demo","email_verified":true,"phone_verified":false}'::jsonb,
      'email',
      'a0000000-0000-0000-0000-000000000005',
      ts,
      ts,
      ts
    ),
    (
      'b0000000-0000-0000-0000-000000000006',
      'a0000000-0000-0000-0000-000000000006',
      '{"sub":"a0000000-0000-0000-0000-000000000006","email":"robert.sullivan@family.demo","email_verified":true,"phone_verified":false}'::jsonb,
      'email',
      'a0000000-0000-0000-0000-000000000006',
      ts,
      ts,
      ts
    ),
    (
      'b0000000-0000-0000-0000-000000000007',
      'a0000000-0000-0000-0000-000000000007',
      '{"sub":"a0000000-0000-0000-0000-000000000007","email":"linda.chen@family.demo","email_verified":true,"phone_verified":false}'::jsonb,
      'email',
      'a0000000-0000-0000-0000-000000000007',
      ts,
      ts,
      ts
    );
END $$;
