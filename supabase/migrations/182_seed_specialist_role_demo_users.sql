-- Seed demo users for the remaining Slice 3 specialist dashboards:
--   admin_assistant, coordinator, housekeeper
-- Password: HavenDemo2026!

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  crypto_schema text;
  pw text;
  inst uuid := '00000000-0000-0000-0000-000000000000';
  org  uuid := '00000000-0000-0000-0000-000000000001';
  fac  uuid := '00000000-0000-0000-0002-000000000001';
  ts   timestamptz := now();

  frontdesk_id uuid;
  coordinator_id uuid;
  housekeeper_id uuid;
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
    crypto_schema, 'HavenDemo2026!', crypto_schema, 'bf'
  ) INTO pw;

  SELECT id INTO frontdesk_id
  FROM auth.users
  WHERE lower(email) = 'frontdesk@circleoflifealf.com'
  LIMIT 1;

  IF frontdesk_id IS NULL THEN
    frontdesk_id := 'a0000000-0000-0000-0000-000000000013';
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role,
      created_at, updated_at,
      confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current,
      email_change_confirm_status, phone_change, phone_change_token,
      reauthentication_token
    ) VALUES (
      frontdesk_id, inst,
      'frontdesk@circleoflifealf.com', pw, ts,
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'app_role', 'admin_assistant',
        'organization_id', org::text
      ),
      jsonb_build_object(
        'full_name', 'Jessica Lawson',
        'email_verified', true
      ),
      'authenticated', 'authenticated',
      ts, ts,
      '', '', '', '', '', 0, '', '', ''
    );
  ELSE
    UPDATE auth.users
    SET
      email = 'frontdesk@circleoflifealf.com',
      encrypted_password = pw,
      email_confirmed_at = COALESCE(email_confirmed_at, ts),
      raw_app_meta_data = jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'app_role', 'admin_assistant',
        'organization_id', org::text
      ),
      raw_user_meta_data = jsonb_build_object(
        'full_name', 'Jessica Lawson',
        'email_verified', true
      ),
      recovery_token = '',
      email_change_token_new = '',
      email_change = '',
      email_change_token_current = '',
      email_change_confirm_status = 0,
      phone_change = '',
      phone_change_token = '',
      reauthentication_token = '',
      updated_at = ts
    WHERE id = frontdesk_id;
  END IF;

  DELETE FROM auth.identities WHERE user_id = frontdesk_id;
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    frontdesk_id,
    jsonb_build_object(
      'sub', frontdesk_id::text,
      'email', 'frontdesk@circleoflifealf.com',
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    frontdesk_id::text,
    ts,
    ts,
    ts
  );

  INSERT INTO user_profiles (id, organization_id, email, full_name, phone, app_role) VALUES (
    frontdesk_id,
    org,
    'frontdesk@circleoflifealf.com',
    'Jessica Lawson',
    '386-339-1651',
    'admin_assistant'
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    app_role = EXCLUDED.app_role,
    is_active = true,
    deleted_at = NULL;

  UPDATE user_facility_access
  SET organization_id = org, is_primary = true, revoked_at = NULL, revoked_by = NULL
  WHERE user_id = frontdesk_id AND facility_id = fac;

  IF NOT FOUND THEN
    INSERT INTO user_facility_access (id, user_id, facility_id, organization_id, is_primary)
    VALUES (gen_random_uuid(), frontdesk_id, fac, org, true);
  END IF;

  SELECT id INTO coordinator_id
  FROM auth.users
  WHERE lower(email) = 'coordinator@circleoflifealf.com'
  LIMIT 1;

  IF coordinator_id IS NULL THEN
    coordinator_id := 'a0000000-0000-0000-0000-000000000014';
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role,
      created_at, updated_at,
      confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current,
      email_change_confirm_status, phone_change, phone_change_token,
      reauthentication_token
    ) VALUES (
      coordinator_id, inst,
      'coordinator@circleoflifealf.com', pw, ts,
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'app_role', 'coordinator',
        'organization_id', org::text
      ),
      jsonb_build_object(
        'full_name', 'Natalie Foster',
        'email_verified', true
      ),
      'authenticated', 'authenticated',
      ts, ts,
      '', '', '', '', '', 0, '', '', ''
    );
  ELSE
    UPDATE auth.users
    SET
      email = 'coordinator@circleoflifealf.com',
      encrypted_password = pw,
      email_confirmed_at = COALESCE(email_confirmed_at, ts),
      raw_app_meta_data = jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'app_role', 'coordinator',
        'organization_id', org::text
      ),
      raw_user_meta_data = jsonb_build_object(
        'full_name', 'Natalie Foster',
        'email_verified', true
      ),
      recovery_token = '',
      email_change_token_new = '',
      email_change = '',
      email_change_token_current = '',
      email_change_confirm_status = 0,
      phone_change = '',
      phone_change_token = '',
      reauthentication_token = '',
      updated_at = ts
    WHERE id = coordinator_id;
  END IF;

  DELETE FROM auth.identities WHERE user_id = coordinator_id;
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    coordinator_id,
    jsonb_build_object(
      'sub', coordinator_id::text,
      'email', 'coordinator@circleoflifealf.com',
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    coordinator_id::text,
    ts,
    ts,
    ts
  );

  INSERT INTO user_profiles (id, organization_id, email, full_name, phone, app_role) VALUES (
    coordinator_id,
    org,
    'coordinator@circleoflifealf.com',
    'Natalie Foster',
    '386-339-1652',
    'coordinator'
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    app_role = EXCLUDED.app_role,
    is_active = true,
    deleted_at = NULL;

  UPDATE user_facility_access
  SET organization_id = org, is_primary = true, revoked_at = NULL, revoked_by = NULL
  WHERE user_id = coordinator_id AND facility_id = fac;

  IF NOT FOUND THEN
    INSERT INTO user_facility_access (id, user_id, facility_id, organization_id, is_primary)
    VALUES (gen_random_uuid(), coordinator_id, fac, org, true);
  END IF;

  SELECT id INTO housekeeper_id
  FROM auth.users
  WHERE lower(email) = 'housekeeper@circleoflifealf.com'
  LIMIT 1;

  IF housekeeper_id IS NULL THEN
    housekeeper_id := 'a0000000-0000-0000-0000-000000000015';
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role,
      created_at, updated_at,
      confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current,
      email_change_confirm_status, phone_change, phone_change_token,
      reauthentication_token
    ) VALUES (
      housekeeper_id, inst,
      'housekeeper@circleoflifealf.com', pw, ts,
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'app_role', 'housekeeper',
        'organization_id', org::text
      ),
      jsonb_build_object(
        'full_name', 'Rosa Alvarez',
        'email_verified', true
      ),
      'authenticated', 'authenticated',
      ts, ts,
      '', '', '', '', '', 0, '', '', ''
    );
  ELSE
    UPDATE auth.users
    SET
      email = 'housekeeper@circleoflifealf.com',
      encrypted_password = pw,
      email_confirmed_at = COALESCE(email_confirmed_at, ts),
      raw_app_meta_data = jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'app_role', 'housekeeper',
        'organization_id', org::text
      ),
      raw_user_meta_data = jsonb_build_object(
        'full_name', 'Rosa Alvarez',
        'email_verified', true
      ),
      recovery_token = '',
      email_change_token_new = '',
      email_change = '',
      email_change_token_current = '',
      email_change_confirm_status = 0,
      phone_change = '',
      phone_change_token = '',
      reauthentication_token = '',
      updated_at = ts
    WHERE id = housekeeper_id;
  END IF;

  DELETE FROM auth.identities WHERE user_id = housekeeper_id;
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    housekeeper_id,
    jsonb_build_object(
      'sub', housekeeper_id::text,
      'email', 'housekeeper@circleoflifealf.com',
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    housekeeper_id::text,
    ts,
    ts,
    ts
  );

  INSERT INTO user_profiles (id, organization_id, email, full_name, phone, app_role) VALUES (
    housekeeper_id,
    org,
    'housekeeper@circleoflifealf.com',
    'Rosa Alvarez',
    '386-339-1653',
    'housekeeper'
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    app_role = EXCLUDED.app_role,
    is_active = true,
    deleted_at = NULL;

  UPDATE user_facility_access
  SET organization_id = org, is_primary = true, revoked_at = NULL, revoked_by = NULL
  WHERE user_id = housekeeper_id AND facility_id = fac;

  IF NOT FOUND THEN
    INSERT INTO user_facility_access (id, user_id, facility_id, organization_id, is_primary)
    VALUES (gen_random_uuid(), housekeeper_id, fac, org, true);
  END IF;
END $$;
