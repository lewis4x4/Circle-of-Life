-- Migration 195: Operation Task Templates
-- Part of Module 27 — Operations Cadence Engine (OCE)
-- Defines every operational task across all cadences
--
-- This migration creates the core template table that defines
-- all operational tasks (daily/weekly/monthly/quarterly/yearly rounds,
-- audits, collections, employee file, mental health support).

-- ============================================================================
-- Table: operation_task_templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS operation_task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID REFERENCES facilities(id), -- NULL = org-wide template

  -- Core identification
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'daily_rounds', 'weekly_rounds', 'monthly_rounds',
    'quarterly_rounds', 'yearly_rounds', 'audits',
    'collections', 'employee_file', 'mental_health_support',
    'safety', 'maintenance', 'compliance', 'financial',
    'staffing', 'vendor_management', 'document_review'
  )),

  -- Cadence configuration
  cadence_type TEXT NOT NULL CHECK (cadence_type IN (
    'daily', 'weekly', 'monthly', 'quarterly', 'yearly',
    'on_demand', 'event_driven'
  )),

  -- For daily: which shifts? For others: N/A or 'all'
  shift_scope TEXT CHECK (shift_scope IN ('all', 'day', 'evening', 'night')),
  day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Monday, 7=Sunday
  day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  month_of_year INTEGER CHECK (month_of_year BETWEEN 1 AND 12),

  -- Assignment rules
  assignee_role TEXT CHECK (assignee_role IN (
    'coo', 'facility_administrator', 'don', 'lpn_supervisor',
    'medication_aide', 'cna', 'dietary_manager', 'activities_director',
    'maintenance', 'housekeeping', 'staffing_coordinator',
    'compliance_officer', 'finance_manager', 'collections_manager',
    'hr_manager'
  )),
  required_role_fallback TEXT, -- If assignee_role absent/unavailable, who takes over?

  -- Escalation ladder: [{role, sla_minutes, channel, enabled}]
  -- Example: [{role: 'lpn_supervisor', sla_minutes: 15, channel: 'in_app', enabled: true},
  --          {role: 'don', sla_minutes: 30, channel: 'in_app', enabled: true},
  --          {role: 'administrator', sla_minutes: 60, channel: 'sms', enabled: true}]
  escalation_ladder JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Asset/vendor linkage
  asset_ref UUID, -- Links to facility_assets when applicable
  vendor_booking_ref UUID, -- Links to vendors when this is a booking confirmation task
  linked_document_id UUID REFERENCES facility_documents(id),

  -- Priority and risk flags
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal', 'low')),
  license_threatening BOOLEAN NOT NULL DEFAULT false,
  -- If true: missed task triggers owner_alert with legal-review path

  -- Compliance mapping
  compliance_requirement TEXT, -- Reference to AHCA rule or internal policy
  survey_readiness_impact BOOLEAN NOT NULL DEFAULT false,
  requires_dual_sign BOOLEAN NOT NULL DEFAULT false,

  -- Time tracking
  estimated_minutes INTEGER CHECK (estimated_minutes >= 0),
  auto_complete_after_hours INTEGER, -- For low-risk tasks, auto-complete if not actioned

  -- Versioning for templates
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  previous_version_id UUID REFERENCES operation_task_templates(id),

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

CREATE INDEX IF NOT EXISTS idx_ott_org_facility
  ON operation_task_templates(organization_id, facility_id)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_ott_cadence
  ON operation_task_templates(cadence_type, shift_scope)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_ott_assignee_role
  ON operation_task_templates(assignee_role)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_ott_category
  ON operation_task_templates(category)
  WHERE deleted_at IS NULL AND is_active = true;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE operation_task_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY ott_select ON operation_task_templates
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

CREATE POLICY ott_manage ON operation_task_templates
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE POLICY ott_facility_read ON operation_task_templates
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('facility_admin', 'manager', 'coordinator', 'nurse')
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- ============================================================================
-- Audit Trigger
-- ============================================================================

CREATE TRIGGER ott_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON operation_task_templates
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE operation_task_templates IS
  'Defines every operational task template across all cadences (daily/weekly/monthly/quarterly/yearly).
   Each template includes escalation ladders, assignment rules, and compliance references.
   Seeded from COL''s 9 admin logs but extendable by operators.';

COMMENT ON COLUMN operation_task_templates.escalation_ladder IS
  'JSONB array of escalation steps: [{role, sla_minutes, channel, enabled}].
   Example: [{"role":"lpn_supervisor","sla_minutes":15,"channel":"in_app","enabled":true},
              {"role":"don","sla_minutes":30,"channel":"in_app","enabled":true},
              {"role":"owner","sla_minutes":60,"channel":"sms","enabled":true}]';

COMMENT ON COLUMN operation_task_templates.license_threatening IS
  'If true: missed task triggers owner_alert with legal-review path. Used for AHCA compliance tasks.';
