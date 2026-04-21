-- Migration 198: Staffing Adequacy Snapshots
-- Part of Module 27 — Operations Cadence Engine (OCE)
-- Per-shift, per-facility adequacy computed from ratios + hours + task load
--
-- This migration creates the staffing adequacy snapshot table that
-- computes whether each shift has adequate staffing to complete
-- all scheduled tasks, given resident count and acuity.

-- ============================================================================
-- Table: staffing_adequacy_snapshots
-- ============================================================================

CREATE TABLE IF NOT EXISTS staffing_adequacy_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),

  -- Snapshot identity
  snapshot_date DATE NOT NULL,
  shift_type TEXT NOT NULL CHECK (shift_type IN ('day', 'evening', 'night')),
  snapshot_period_start TIMESTAMPTZ NOT NULL,
  snapshot_period_end TIMESTAMPTZ NOT NULL,

  -- Resident demand
  resident_count INTEGER NOT NULL,
  resident_acuity_weighted_count NUMERIC(8,2), -- level_2=1.5x, level_3=2x

  -- Staff supply
  scheduled_staff_count INTEGER NOT NULL,
  scheduled_hours DECIMAL(5,2) NOT NULL,
  scheduled_staff_by_role JSONB, -- {cna: 8, lpn: 2, don: 1, ...}

  -- Ratio compliance
  required_ratio DECIMAL(4,2) NOT NULL, -- From facility_ratio_rules
  actual_ratio DECIMAL(4,2) NOT NULL,
  is_compliant BOOLEAN NOT NULL,

  -- Task load factor
  pending_task_count INTEGER NOT NULL DEFAULT 0,
  high_priority_task_count INTEGER NOT NULL DEFAULT 0,
  estimated_completion_hours DECIMAL(5,2), -- Sum of template estimated_minutes

  -- Adequacy score
  adequacy_score INTEGER CHECK (adequacy_score BETWEEN 0 AND 100),
  adequacy_rating TEXT CHECK (adequacy_rating IN (
    'well_staffed', 'adequate', 'minimal', 'understaffed', 'critical_shortage'
  )),

  -- Forecast
  cannot_cover_count INTEGER DEFAULT 0, -- Tasks that cannot be completed with current staff
  float_pool_required BOOLEAN NOT NULL DEFAULT false,
  recommended_action TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),

  UNIQUE (facility_id, snapshot_date, shift_type)
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sas_facility_date
  ON staffing_adequacy_snapshots(facility_id, snapshot_date DESC)
  WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days';

CREATE INDEX IF NOT EXISTS idx_sas_adequacy
  ON staffing_adequacy_snapshots(adequacy_score, snapshot_date)
  WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days';

CREATE INDEX IF NOT EXISTS idx_sas_compliance
  ON staffing_adequacy_snapshots(is_compliant, snapshot_date)
  WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days';

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE staffing_adequacy_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY sas_select ON staffing_adequacy_snapshots
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY sas_insert ON staffing_adequacy_snapshots
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE staffing_adequacy_snapshots IS
  'Per-shift staffing adequacy snapshots. Computed from resident count,
   acuity distribution, scheduled staff, required ratios, and task load.
   Answers "Can this shift complete all scheduled tasks?"';

COMMENT ON COLUMN staffing_adequacy_snapshots.adequacy_score IS
  '0–100 score. <70 = critical shortage, 70–84 = understaffed,
   85–94 = minimal, 95–99 = adequate, 100 = well_staffed.';

COMMENT ON COLUMN staffing_adequacy_snapshots.scheduled_staff_by_role IS
  'JSONB: {"cna": 8, "lpn": 2, "don": 1, ...}. Count by role for this shift.';
