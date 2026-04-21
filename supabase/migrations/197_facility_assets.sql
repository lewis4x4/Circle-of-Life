-- Migration 197: Facility Assets
-- Part of Module 27 — Operations Cadence Engine (OCE)
-- Physical plant assets with service lifecycles
--
-- This migration creates the facility_assets table to track
-- generators, AEDs, fire extinguishers, sprinkler systems,
-- hood suppression, AC units, elevators, and other equipment
-- with service schedules and replacement planning.

-- ============================================================================
-- Table: facility_assets
-- ============================================================================

CREATE TABLE IF NOT EXISTS facility_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),

  -- Asset identification
  asset_type TEXT NOT NULL CHECK (asset_type IN (
    'generator', 'aed', 'fire_extinguisher', 'sprinkler_system',
    'hood_suppression', 'ac_unit', 'elevator', 'kitchen_equipment',
    'laundry_equipment', 'furniture', 'vehicle', 'other'
  )),
  asset_tag TEXT, -- Physical label/barcode on equipment
  serial_number TEXT,

  -- Description
  name TEXT NOT NULL,
  description TEXT,
  manufacturer TEXT,
  model TEXT,
  year_manufactured INTEGER CHECK (year_manufactured BETWEEN 1900 AND 2100),

  -- Installation and warranty
  install_date DATE,
  install_location TEXT, -- Where in the building?
  warranty_end_date DATE,

  -- Service lifecycle
  service_interval_days INTEGER CHECK (service_interval_days >= 0),
  last_service_at DATE,
  last_service_vendor_id UUID, -- FK added in migration 200
  next_service_due_at DATE,
  service_notes TEXT,

  -- Replacement planning
  lifecycle_replace_by DATE,
  replacement_cost_estimate_cents INTEGER CHECK (replacement_cost_estimate_cents >= 0),
  replacement_justification TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'in_maintenance', 'out_of_service', 'retired', 'replacement_planned'
  )),
  retirement_date DATE,
  retirement_reason TEXT,

  -- Document linkage
  manual_id UUID REFERENCES facility_documents(id),
  inspection_report_id UUID REFERENCES facility_documents(id),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_fa_facility_type
  ON facility_assets(facility_id, asset_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fa_due_service
  ON facility_assets(next_service_due_at)
  WHERE deleted_at IS NULL AND status IN ('active', 'in_maintenance');

CREATE INDEX IF NOT EXISTS idx_fa_replace_on
  ON facility_assets(lifecycle_replace_by)
  WHERE deleted_at IS NULL AND lifecycle_replace_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fa_tag
  ON facility_assets(asset_tag)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE facility_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY fa_select ON facility_assets
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY fa_manage ON facility_assets
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'coo', 'facility_administrator')
  );

-- ============================================================================
-- Audit Trigger
-- ============================================================================

CREATE TRIGGER fa_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON facility_assets
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE facility_assets IS
  'Physical plant assets with service lifecycles. Tracks generators, AEDs,
   fire extinguishers, sprinkler systems, hoods, AC units, elevators.
   Drives maintenance scheduling and capital planning.';

COMMENT ON COLUMN facility_assets.service_interval_days IS
  'Number of days between required service. Used to calculate next_service_due_at.';

COMMENT ON COLUMN facility_assets.lifecycle_replace_by IS
  'Planned replacement date. Feeds into 3-year capital plan for Module 28.';
