-- Restore transport vendor seed (originally intended for migration 103 phase1_vendor_seed)
--
-- The original 103_phase1_vendor_seed migration never landed on production. This
-- migration restores the 7 transport vendors and their facility assignments from
-- Section 21 of the COL Technical Handoff.
--
-- Differences from the original 103:
--   1. Idempotent: every INSERT is guarded by a NOT EXISTS check so this migration
--      can be re-run without producing duplicates or unique-violation errors.
--   2. created_by is NULL: the original 103 used the COL organization UUID
--      ('00000000-0000-0000-0000-000000000001') as created_by, but vendors.created_by
--      is a FK to auth.users(id) and the COL organization UUID is not an auth user.
--      The column is nullable, so we leave it NULL to indicate a system seed.
--   3. vendor_facilities inserts are also guarded by NOT EXISTS on the
--      (vendor_id, facility_id) pair so repeat runs are safe.
--
-- RLS, audit triggers, and existing schema remain unchanged.

-- ============================================================
-- VENDOR SEED DATA (idempotent)
-- ============================================================

DO $$
DECLARE
  v_org_id uuid := '00000000-0000-0000-0000-000000000001';
  v_vendor_id uuid;
BEGIN
  -- ------------------------------------------------------------
  -- 1. Alternative Transport — all 5 facilities
  -- ------------------------------------------------------------
  SELECT id INTO v_vendor_id
  FROM vendors
  WHERE organization_id = v_org_id
    AND lower(name) = lower('Alternative Transport')
    AND deleted_at IS NULL;

  IF v_vendor_id IS NULL THEN
    INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, primary_contact_phone, created_by)
    VALUES (v_org_id, 'Alternative Transport', 'other', 'active', 'Kathy', NULL, NULL)
    RETURNING id INTO v_vendor_id;
  END IF;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id)
  SELECT v_org_id, v_vendor_id, f.id
  FROM facilities f
  WHERE f.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM vendor_facilities vf
      WHERE vf.vendor_id = v_vendor_id
        AND vf.facility_id = f.id
        AND vf.deleted_at IS NULL
    );

  -- ------------------------------------------------------------
  -- 2. Jackson Transport — all 5 facilities
  -- ------------------------------------------------------------
  SELECT id INTO v_vendor_id
  FROM vendors
  WHERE organization_id = v_org_id
    AND lower(name) = lower('Jackson Transport')
    AND deleted_at IS NULL;

  IF v_vendor_id IS NULL THEN
    INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, primary_contact_phone, created_by)
    VALUES (v_org_id, 'Jackson Transport', 'other', 'active', 'John', NULL, NULL)
    RETURNING id INTO v_vendor_id;
  END IF;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id)
  SELECT v_org_id, v_vendor_id, f.id
  FROM facilities f
  WHERE f.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM vendor_facilities vf
      WHERE vf.vendor_id = v_vendor_id
        AND vf.facility_id = f.id
        AND vf.deleted_at IS NULL
    );

  -- ------------------------------------------------------------
  -- 3. Parrish Medivan — all 5 facilities
  -- ------------------------------------------------------------
  SELECT id INTO v_vendor_id
  FROM vendors
  WHERE organization_id = v_org_id
    AND lower(name) = lower('Parrish Medivan')
    AND deleted_at IS NULL;

  IF v_vendor_id IS NULL THEN
    INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, primary_contact_phone, created_by)
    VALUES (v_org_id, 'Parrish Medivan', 'other', 'active', 'Hanah', NULL, NULL)
    RETURNING id INTO v_vendor_id;
  END IF;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id)
  SELECT v_org_id, v_vendor_id, f.id
  FROM facilities f
  WHERE f.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM vendor_facilities vf
      WHERE vf.vendor_id = v_vendor_id
        AND vf.facility_id = f.id
        AND vf.deleted_at IS NULL
    );

  -- ------------------------------------------------------------
  -- 4. Peeler Transport — all 5 facilities
  -- ------------------------------------------------------------
  SELECT id INTO v_vendor_id
  FROM vendors
  WHERE organization_id = v_org_id
    AND lower(name) = lower('Peeler Transport')
    AND deleted_at IS NULL;

  IF v_vendor_id IS NULL THEN
    INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, primary_contact_phone, created_by)
    VALUES (v_org_id, 'Peeler Transport', 'other', 'active', 'Carlene', NULL, NULL)
    RETURNING id INTO v_vendor_id;
  END IF;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id)
  SELECT v_org_id, v_vendor_id, f.id
  FROM facilities f
  WHERE f.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM vendor_facilities vf
      WHERE vf.vendor_id = v_vendor_id
        AND vf.facility_id = f.id
        AND vf.deleted_at IS NULL
    );

  -- ------------------------------------------------------------
  -- 5. D's Transport — all 5 facilities (note escaped single quote)
  -- ------------------------------------------------------------
  SELECT id INTO v_vendor_id
  FROM vendors
  WHERE organization_id = v_org_id
    AND lower(name) = lower('D''s Transport')
    AND deleted_at IS NULL;

  IF v_vendor_id IS NULL THEN
    INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, primary_contact_phone, created_by)
    VALUES (v_org_id, 'D''s Transport', 'other', 'active', 'Lavern', NULL, NULL)
    RETURNING id INTO v_vendor_id;
  END IF;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id)
  SELECT v_org_id, v_vendor_id, f.id
  FROM facilities f
  WHERE f.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM vendor_facilities vf
      WHERE vf.vendor_id = v_vendor_id
        AND vf.facility_id = f.id
        AND vf.deleted_at IS NULL
    );

  -- ------------------------------------------------------------
  -- 6. Lafayette County — Oakridge ALF + Homewood Lodge ALF only
  -- ------------------------------------------------------------
  SELECT id INTO v_vendor_id
  FROM vendors
  WHERE organization_id = v_org_id
    AND lower(name) = lower('Lafayette County')
    AND deleted_at IS NULL;

  IF v_vendor_id IS NULL THEN
    INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, primary_contact_phone, created_by)
    VALUES (v_org_id, 'Lafayette County', 'other', 'active', 'Robbie Edwards', NULL, NULL)
    RETURNING id INTO v_vendor_id;
  END IF;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id)
  SELECT v_org_id, v_vendor_id, f.id
  FROM facilities f
  WHERE f.deleted_at IS NULL
    AND f.name IN ('Oakridge ALF', 'Homewood Lodge ALF')
    AND NOT EXISTS (
      SELECT 1 FROM vendor_facilities vf
      WHERE vf.vendor_id = v_vendor_id
        AND vf.facility_id = f.id
        AND vf.deleted_at IS NULL
    );

  -- ------------------------------------------------------------
  -- 7. Suwannee River Economic Council — Oakridge + Homewood + Rising Oaks
  -- ------------------------------------------------------------
  SELECT id INTO v_vendor_id
  FROM vendors
  WHERE organization_id = v_org_id
    AND lower(name) = lower('Suwannee River Economic Council')
    AND deleted_at IS NULL;

  IF v_vendor_id IS NULL THEN
    INSERT INTO vendors (organization_id, name, category, status, created_by)
    VALUES (v_org_id, 'Suwannee River Economic Council', 'other', 'active', NULL)
    RETURNING id INTO v_vendor_id;
  END IF;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id)
  SELECT v_org_id, v_vendor_id, f.id
  FROM facilities f
  WHERE f.deleted_at IS NULL
    AND f.name IN ('Oakridge ALF', 'Homewood Lodge ALF', 'Rising Oaks ALF')
    AND NOT EXISTS (
      SELECT 1 FROM vendor_facilities vf
      WHERE vf.vendor_id = v_vendor_id
        AND vf.facility_id = f.id
        AND vf.deleted_at IS NULL
    );

  -- ------------------------------------------------------------
  -- Verification
  -- ------------------------------------------------------------
  RAISE NOTICE 'Restored transport vendor seed: % transport vendors active in COL org',
    (SELECT COUNT(*) FROM vendors
       WHERE organization_id = v_org_id
         AND category = 'other'
         AND status = 'active'
         AND deleted_at IS NULL);
  RAISE NOTICE 'Restored transport vendor seed: % vendor_facility links active in COL org',
    (SELECT COUNT(*) FROM vendor_facilities
       WHERE organization_id = v_org_id
         AND deleted_at IS NULL);
END $$;
