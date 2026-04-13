-- Migration 175: Seed demo data for the Dietary Command Deck
--
-- Creates:
--   - Marcus Bell (dietary Lead Cook) auth user + profile + facility access
--   - Diet orders for 7 existing Oakridge residents
--   - Today's lunch meal service (3 venues)
--   - Tray tickets for each resident
--   - HACCP logs (5 recent temperature records)
--   - 2 fortification recommendations (weight-loss trigger)
--   - 1 meal refusal (pattern refusal)
--
-- Password for dietary@circleoflifealf.com: Sp33dy22

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  crypto_schema text;
  pw            text;
  inst          uuid := '00000000-0000-0000-0000-000000000000';
  org           uuid := '00000000-0000-0000-0000-000000000001';
  fac           uuid := '00000000-0000-0000-0002-000000000001';
  cook_id       uuid := 'a0000000-0000-0000-0000-000000000013'; -- Marcus Bell
  nurse_id      uuid := 'a0000000-0000-0000-0000-000000000003'; -- Sarah Williams
  ts            timestamptz := now();
  today         date := CURRENT_DATE;

  -- Resident IDs (Oakridge demo residents)
  r1 uuid := 'c0000000-0000-0000-0000-000000000001'; -- Margaret Sullivan
  r2 uuid := 'c0000000-0000-0000-0000-000000000002'; -- Harold Chen
  r3 uuid := 'c0000000-0000-0000-0000-000000000003'; -- Dorothy Williams
  r4 uuid := 'c0000000-0000-0000-0000-000000000004'; -- Arthur Pennington
  r5 uuid := 'c0000000-0000-0000-0000-000000000005'; -- Ruth Anderson
  r6 uuid := 'c0000000-0000-0000-0000-000000000006'; -- Frank Martinez
  r7 uuid := 'c0000000-0000-0000-0000-000000000007'; -- Virginia Taylor

  -- Fixed UUIDs for idempotency
  ms_main uuid := 'f1000000-d000-0000-0000-000000000001'; -- lunch / main_dining
  ms_mc   uuid := 'f1000000-d000-0000-0000-000000000002'; -- lunch / memory_care
  ms_tray uuid := 'f1000000-d000-0000-0000-000000000003'; -- lunch / room_trays
BEGIN

  -- ============================================================
  -- 1. DETERMINE CRYPTO SCHEMA
  -- ============================================================
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

  -- ============================================================
  -- 2. AUTH USER — Marcus Bell, Lead Cook
  -- ============================================================
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    email_change_confirm_status, phone_change, phone_change_token,
    reauthentication_token
  ) VALUES (
    cook_id, inst,
    'dietary@circleoflifealf.com', pw, ts,
    '{"provider":"email","providers":["email"],"app_role":"dietary"}',
    '{"full_name":"Marcus Bell","email_verified":true}',
    'authenticated', 'authenticated',
    ts, ts, '', '', '', '', '', 0, '', '', ''
  )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password          = EXCLUDED.encrypted_password,
    email                       = EXCLUDED.email,
    raw_app_meta_data           = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data          = EXCLUDED.raw_user_meta_data,
    recovery_token              = '',
    email_change_token_new      = '',
    email_change                = '',
    email_change_token_current  = '',
    email_change_confirm_status = 0,
    phone_change                = '',
    phone_change_token          = '',
    reauthentication_token      = '',
    updated_at                  = EXCLUDED.updated_at;

  DELETE FROM auth.identities WHERE user_id = cook_id;

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (
    'b0000000-0000-0000-0000-000000000013',
    cook_id,
    '{"sub":"a0000000-0000-0000-0000-000000000013","email":"dietary@circleoflifealf.com","email_verified":true,"phone_verified":false}',
    'email', cook_id, ts, ts, ts
  );

  -- ============================================================
  -- 3. USER PROFILE + FACILITY ACCESS
  -- ============================================================
  INSERT INTO user_profiles (id, organization_id, email, full_name, phone, app_role) VALUES
    (cook_id, org, 'dietary@circleoflifealf.com', 'Marcus Bell', '386-339-1660', 'dietary')
  ON CONFLICT (id) DO UPDATE SET
    app_role   = EXCLUDED.app_role,
    email      = EXCLUDED.email,
    full_name  = EXCLUDED.full_name;

  INSERT INTO user_facility_access (id, user_id, facility_id, organization_id, is_primary) VALUES
    ('f0000000-fa00-0000-0000-000000000013', cook_id, fac, org, true)
  ON CONFLICT DO NOTHING;

  -- ============================================================
  -- 4. DIET ORDERS — one per resident
  -- ============================================================
  INSERT INTO diet_orders (id, organization_id, facility_id, resident_id, diet_type, iddsi_food_level, iddsi_liquid_level, allergies, active, ordered_by)
  VALUES
    -- Margaret Sullivan: Renal, normal texture
    ('d0000000-0000-0000-0000-000000000001', org, fac, r1, 'renal',          7, 0, '{"shellfish"}', true, nurse_id),
    -- Harold Chen: NCS (carb-controlled), normal texture
    ('d0000000-0000-0000-0000-000000000002', org, fac, r2, 'ncs',            7, 0, '{}',            true, nurse_id),
    -- Dorothy Williams: Regular + fortification flag
    ('d0000000-0000-0000-0000-000000000003', org, fac, r3, 'regular',        7, 0, '{}',            true, nurse_id),
    -- Arthur Pennington: Mechanical Soft (IDDSI L5) + nut allergy
    ('d0000000-0000-0000-0000-000000000004', org, fac, r4, 'mechanical_soft',5, 0, '{"nuts"}',       true, nurse_id),
    -- Ruth Anderson: Puree (IDDSI L4) + MCT fortification
    ('d0000000-0000-0000-0000-000000000005', org, fac, r5, 'puree',          4, 0, '{}',            true, nurse_id),
    -- Frank Martinez: Vegetarian
    ('d0000000-0000-0000-0000-000000000006', org, fac, r6, 'vegetarian',     7, 0, '{}',            true, nurse_id),
    -- Virginia Taylor: Mechanical Soft + NCS + dairy allergy
    ('d0000000-0000-0000-0000-000000000007', org, fac, r7, 'mechanical_soft',5, 0, '{"dairy"}',     true, nurse_id)
  ON CONFLICT (resident_id) WHERE active = true DO UPDATE SET
    diet_type          = EXCLUDED.diet_type,
    iddsi_food_level   = EXCLUDED.iddsi_food_level,
    iddsi_liquid_level = EXCLUDED.iddsi_liquid_level,
    allergies          = EXCLUDED.allergies,
    updated_at         = now();

  -- ============================================================
  -- 5. MEAL SERVICES — Today's Lunch (3 venues)
  -- ============================================================
  INSERT INTO meal_services (id, organization_id, facility_id, service_date, meal_period, venue, scheduled_start, scheduled_end, status, expected_count)
  VALUES
    (ms_main, org, fac, today, 'lunch', 'main_dining',
     (today + '11:30'::time) AT TIME ZONE 'America/New_York',
     (today + '13:00'::time) AT TIME ZONE 'America/New_York',
     'plating', 4),
    (ms_mc,   org, fac, today, 'lunch', 'memory_care',
     (today + '11:30'::time) AT TIME ZONE 'America/New_York',
     (today + '13:00'::time) AT TIME ZONE 'America/New_York',
     'plating', 2),
    (ms_tray, org, fac, today, 'lunch', 'room_trays',
     (today + '11:30'::time) AT TIME ZONE 'America/New_York',
     (today + '13:00'::time) AT TIME ZONE 'America/New_York',
     'prep', 1)
  ON CONFLICT (facility_id, service_date, meal_period, venue) DO UPDATE SET
    status         = EXCLUDED.status,
    expected_count = EXCLUDED.expected_count,
    updated_at     = now();

  -- ============================================================
  -- 6. TRAY TICKETS — one per resident, assigned to venue
  -- ============================================================
  INSERT INTO tray_tickets (id, organization_id, facility_id, meal_service_id, resident_id, diet_order_snapshot, menu_items, status, iddsi_confirmed_food, allergen_check_passed, carb_count_g, sodium_mg, calorie_count)
  VALUES
    -- Margaret Sullivan (Renal) → main dining → queued
    ('t0000000-0000-0000-0000-000000000001', org, fac, ms_main, r1,
     '{"diet_type":"renal","iddsi_food_level":7,"allergies":["shellfish"]}',
     '["Roasted chicken","Mashed potato (no salt)","Green beans"]',
     'queued', false, false, 45, 480, 520),

    -- Harold Chen (NCS) → main dining → prepping
    ('t0000000-0000-0000-0000-000000000002', org, fac, ms_main, r2,
     '{"diet_type":"ncs","iddsi_food_level":7,"allergies":[]}',
     '["Roasted chicken","Brown rice","Side salad"]',
     'prepping', false, true, 52, 620, 580),

    -- Dorothy Williams (Regular + fortify) → main dining → prepping
    ('t0000000-0000-0000-0000-000000000003', org, fac, ms_main, r3,
     '{"diet_type":"regular","iddsi_food_level":7,"allergies":[]}',
     '["Roasted chicken","Mashed potato","Green beans"]',
     'prepping', false, true, 68, 720, 640),

    -- Arthur Pennington (Mech Soft L5) → memory care → plating
    ('t0000000-0000-0000-0000-000000000004', org, fac, ms_mc, r4,
     '{"diet_type":"mechanical_soft","iddsi_food_level":5,"allergies":["nuts"]}',
     '["Pulled chicken","Mashed potato","Soft carrots"]',
     'plating', false, true, 50, 510, 530),

    -- Ruth Anderson (Puree L4 + fortify) → memory care → plating
    ('t0000000-0000-0000-0000-000000000005', org, fac, ms_mc, r5,
     '{"diet_type":"puree","iddsi_food_level":4,"allergies":[]}',
     '["Pureed chicken","Pureed potato","Pureed carrots"]',
     'plating', false, true, 38, 420, 480),

    -- Frank Martinez (Vegetarian) → room trays → passed
    ('t0000000-0000-0000-0000-000000000006', org, fac, ms_tray, r6,
     '{"diet_type":"vegetarian","iddsi_food_level":7,"allergies":[]}',
     '["Lentil curry","Jasmine rice","Naan"]',
     'passed', true, true, 72, 580, 620),

    -- Virginia Taylor (Mech Soft + dairy allergy) → main dining → plated
    ('t0000000-0000-0000-0000-000000000007', org, fac, ms_main, r7,
     '{"diet_type":"mechanical_soft","iddsi_food_level":5,"allergies":["dairy"]}',
     '["Pulled chicken","Sweet potato","Soft greens"]',
     'plated', true, true, 48, 530, 510)
  ON CONFLICT (id) DO UPDATE SET
    status         = EXCLUDED.status,
    updated_at     = now();

  -- ============================================================
  -- 7. HACCP LOGS — 5 recent temperature entries
  -- ============================================================
  INSERT INTO haccp_logs (id, organization_id, facility_id, log_type, item, temperature_f, in_safe_range, threshold_min_f, threshold_max_f, logged_by, meal_service_id, logged_at)
  VALUES
    ('h0000000-0000-0000-0000-000000000001', org, fac, 'hot_hold',     'Beef stew',         158.0, true,  140.0, null, cook_id, ms_main, (today + '10:42'::time) AT TIME ZONE 'America/New_York'),
    ('h0000000-0000-0000-0000-000000000002', org, fac, 'cold_hold',    'Salad bar',          39.0, true,  null,  41.0, cook_id, ms_main, (today + '10:35'::time) AT TIME ZONE 'America/New_York'),
    ('h0000000-0000-0000-0000-000000000003', org, fac, 'fridge_temp',  'Walk-in fridge',     38.0, true,  null,  41.0, cook_id, null,    (today + '10:28'::time) AT TIME ZONE 'America/New_York'),
    ('h0000000-0000-0000-0000-000000000004', org, fac, 'dishmachine',  'Dish sanitizer ppm', 200.0, true, 150.0, null, cook_id, null,    (today + '10:15'::time) AT TIME ZONE 'America/New_York'),
    ('h0000000-0000-0000-0000-000000000005', org, fac, 'reheating',    'Reheated soup',      168.0, true,  165.0, null, cook_id, ms_main, (today + '09:58'::time) AT TIME ZONE 'America/New_York')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- 8. FORTIFICATION RECOMMENDATIONS — 2 weight-loss triggers
  -- ============================================================
  INSERT INTO fortification_recommendations (id, organization_id, facility_id, resident_id, triggered_by, trigger_evidence, recommended_items, estimated_added_calories, status)
  VALUES
    ('fr000000-0000-0000-0000-000000000001', org, fac, r3, 'weight_loss',
     '{"weight_loss_pct_30d":6.2,"current_weight_lbs":108.4}',
     '[{"item":"Boost Plus","calories":360},{"item":"butter pat","calories":35}]',
     340, 'pending'),
    ('fr000000-0000-0000-0000-000000000002', org, fac, r5, 'low_intake',
     '{"avg_intake_pct_7d":32}',
     '[{"item":"MCT oil 1 tbsp","calories":115},{"item":"protein powder scoop","calories":120}]',
     280, 'pending')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- 9. MEAL REFUSAL — pattern refusal for Frank Martinez
  -- ============================================================
  INSERT INTO meal_refusals (id, organization_id, facility_id, resident_id, refused_items, reason, reported_by, intake_estimate_pct, substitution_offered, refused_at)
  VALUES
    ('rf000000-0000-0000-0000-000000000001', org, fac, r6,
     '{"Eggs"}', 'Dislikes eggs — consistent 7-day pattern',
     cook_id, 0, true,
     (today - 1 + '08:14'::time) AT TIME ZONE 'America/New_York')
  ON CONFLICT (id) DO NOTHING;

END $$;
