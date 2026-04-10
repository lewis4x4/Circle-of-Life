-- Phase 1 Foundation Item 3: Vendors Table Seed Data
-- Source: Section 21 of COL Technical Handoff
--
-- This migration seeds 7 transport vendors with facility assignments
-- using the vendor_facilities junction table.
--
-- Existing RLS policies and audit triggers remain unchanged.

-- ============================================================
-- VENDOR SEED DATA
-- ============================================================

-- Organization ID from seed migration 008_seed_col_organization.sql
DO $$
DECLARE
  v_org_id uuid := '00000000-0000-0000-0000-000000000001';
  v_vendor_id uuid;
BEGIN
  -- Alternative Transport
  -- Source: Section 21 "Transport vendor routing"
  INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, primary_contact_phone, created_by)
  VALUES (v_org_id, 'Alternative Transport', 'other', 'active', 'Kathy', NULL, '00000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_vendor_id;

  -- Assign to ALL facilities
  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id, created_by)
  SELECT v_org_id, v_vendor_id, id, '00000000-0000-0000-0000-000000000001'
  FROM facilities WHERE deleted_at IS NULL;

  -- Jackson Transport
  INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, created_by)
  VALUES (v_org_id, 'Jackson Transport', 'other', 'active', 'John', NULL, '00000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_vendor_id;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id, created_by)
  SELECT v_org_id, v_vendor_id, id, '00000000-0000-0000-0000-000000000001'
  FROM facilities WHERE deleted_at IS NULL;

  -- Parrish Medivan
  INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, created_by)
  VALUES (v_org_id, 'Parrish Medivan', 'other', 'active', 'Hanah', NULL, '00000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_vendor_id;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id, created_by)
  SELECT v_org_id, v_vendor_id, id, '00000000-0000-0000-0000-000000000001'
  FROM facilities WHERE deleted_at IS NULL;

  -- Peeler Transport
  INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, created_by)
  VALUES (v_org_id, 'Peeler Transport', 'other', 'active', 'Carlene', NULL, '00000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_vendor_id;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id, created_by)
  SELECT v_org_id, v_vendor_id, id, '00000000-0000-0000-0000-000000000001'
  FROM facilities WHERE deleted_at IS NULL;

  -- D's Transport
  -- Note: The name uses a single quote for "D's" which must be escaped
  INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, created_by)
  VALUES (v_org_id, 'D''s Transport', 'other', 'active', 'Lavern', NULL, '00000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_vendor_id;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id, created_by)
  SELECT v_org_id, v_vendor_id, id, '00000000-0000-0000-0000-000000000001'
  FROM facilities WHERE deleted_at IS NULL;

  -- Lafayette County
  -- Source: Section 21 "Lafayette County" — specific to Homewood and Oakridge
  INSERT INTO vendors (organization_id, name, category, status, primary_contact_name, primary_contact_phone, created_by)
  VALUES (v_org_id, 'Lafayette County', 'other', 'active', 'Robbie Edwards', NULL, '00000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_vendor_id;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id, created_by)
  SELECT v_org_id, v_vendor_id, id, '00000000-0000-0000-0000-000000000001'
  FROM facilities WHERE name IN ('Oakridge ALF', 'Homewood Lodge ALF');

  -- Suwannee River Economic Council
  -- Source: Section 21 "Suwannee River Economic Council" — specific to Homewood, Oakridge, Rising Oaks
  INSERT INTO vendors (organization_id, name, category, status, created_by)
  VALUES (v_org_id, 'Suwannee River Economic Council', 'other', 'active', '00000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_vendor_id;

  INSERT INTO vendor_facilities (organization_id, vendor_id, facility_id, created_by)
  SELECT v_org_id, v_vendor_id, id, '00000000-0000-0000-0000-000000000001'
  FROM facilities WHERE name IN ('Oakridge ALF', 'Homewood Lodge ALF', 'Rising Oaks ALF');

  -- Verify insertion
  RAISE NOTICE 'Phase 1 Foundation: % vendors seeded', (SELECT COUNT(*) FROM vendors WHERE deleted_at IS NULL);
  RAISE NOTICE 'Phase 1 Foundation: % vendor_facility links created', (SELECT COUNT(*) FROM vendor_facilities WHERE deleted_at IS NULL);
END $$;

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE vendors IS 'Vendors from COL Technical Handoff Section 21. Initial seed contains 7 transport vendors.';
COMMENT ON TABLE vendor_facilities IS 'Junction table linking vendors to facilities. "ALL" vendors serve all 5 facilities; specific vendors serve 2-3 facilities.';

-- ============================================================
-- TRIGGER UPDATES
-- ============================================================

-- The triggers for vendors table already exist in 046_vendor_contract_management.sql
-- No additional trigger creation needed
