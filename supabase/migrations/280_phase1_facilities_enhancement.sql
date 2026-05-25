-- Phase 1 Foundation Item 1: Facilities Table Enhancement
-- Source: Section 2 of COL Technical Handoff
--
-- This migration adds:
-- - facility_overrides JSONB column for Homewood dementia protocol
-- - pharmacy_vendor column (BAYA_PHARMACY, NORTH_FLORIDA_PHARMACY, NULL for Plantation)
-- - occupancy_pct column
-- - ahca_license_number (NULL pending Brian's retrieval)
-- - ahca_license_expiration (NULL pending Brian's retrieval)
--
-- Updates all 5 facilities with handoff seed data

-- ============================================================
-- ADD NEW COLUMNS
-- ============================================================

-- Add facility_overrides column for Homewood dementia protocol and other facility-specific overrides
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS facility_overrides jsonb NOT NULL DEFAULT '{}';

-- Add pharmacy_vendor column (NULL for Plantation — TBD from client)
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS pharmacy_vendor text;

-- Add occupancy_pct column
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS occupancy_pct numeric(5,2);

-- Add ahca_license_number (NULL pending Brian's retrieval)
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS ahca_license_number text;

-- Add ahca_license_expiration (NULL pending Brian's retrieval)
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS ahca_license_expiration timestamptz;

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON COLUMN facilities.ahca_license_number IS 'AHCA Assisted Living Facility license number. PENDING — Brian obtaining from client.';
COMMENT ON COLUMN facilities.ahca_license_expiration IS 'AHCA license expiration date. PENDING — Brian obtaining from client.';
COMMENT ON COLUMN facilities.pharmacy_vendor IS 'Primary pharmacy vendor for this facility. BAYA_PHARMACY, NORTH_FLORIDA_PHARMACY, or NULL for Plantation (TBD).';
COMMENT ON COLUMN facilities.facility_overrides IS 'Facility-specific configuration overrides. Homewood dementia protocol: {"homewood_dementia_protocol": true}. DO NOT label Homewood as "Memory Care" in compliance outputs.';
COMMENT ON COLUMN facilities.occupancy_pct IS 'Current occupancy percentage (0.00 to 1.00). From COL handoff Section 2.';

-- ============================================================
-- SEED DATA UPDATES
-- ============================================================

-- Update facilities with handoff data
-- Using exact values from Section 2 of handoff

-- Oakridge ALF
-- From handoff: '297 SW County Road 300', 'BAYA_PHARMACY', 0.94
UPDATE facilities SET
  address_line_1 = '297 SW County Road 300',
  occupancy_pct = 0.94,
  pharmacy_vendor = 'BAYA_PHARMACY'
WHERE name = 'Oakridge ALF';

-- Homewood Lodge ALF
-- From handoff: 'BAYA_PHARMACY', 0.94
UPDATE facilities SET
  pharmacy_vendor = 'BAYA_PHARMACY',
  occupancy_pct = 0.94
WHERE name = 'Homewood Lodge ALF';

-- Rising Oaks ALF
-- From handoff: 'BAYA_PHARMACY', 0.94
UPDATE facilities SET
  pharmacy_vendor = 'BAYA_PHARMACY',
  occupancy_pct = 0.94
WHERE name = 'Rising Oaks ALF';

-- Plantation ALF
-- From handoff: pharmacy_vendor UNKNOWN, phone NOT CONFIRMED, 0.98
UPDATE facilities SET
  pharmacy_vendor = NULL, -- UNKNOWN — collect from client
  phone = NULL, -- NOT CONFIRMED — collect from client
  occupancy_pct = 0.98
WHERE name = 'Plantation ALF';

-- Grande Cypress ALF
-- From handoff: 'NORTH_FLORIDA_PHARMACY', phone NOT CONFIRMED, 0.80
UPDATE facilities SET
  pharmacy_vendor = 'NORTH_FLORIDA_PHARMACY',
  phone = NULL, -- NOT CONFIRMED — collect from client
  occupancy_pct = 0.80
WHERE name = 'Grande Cypress ALF';

-- ============================================================
-- HOMEROOD DEMENTIA PROTOCOL OVERRIDE
-- ============================================================

-- Set Homewood dementia protocol override in facility_overrides
-- From handoff Section 7: "Homewood Dementia Protocol (facility-specific override)"
-- CRITICAL: DO NOT label it "Memory Care" in any compliance-facing output
UPDATE facilities
SET facility_overrides = jsonb_set(
  COALESCE(facility_overrides, '{}'::jsonb),
  '{homewood_dementia_protocol}',
  'true'::jsonb
)
WHERE name = 'Homewood Lodge ALF';

-- ============================================================
-- TRIGGER UPDATE
-- ============================================================

-- The trigger tr_facilities_set_updated_at already exists in 006_audit_triggers.sql
-- No additional trigger creation needed
