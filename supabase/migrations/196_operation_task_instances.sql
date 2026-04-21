-- Migration 196: Operation Task Instances
-- Part of Module 27 — Operations Cadence Engine (OCE)
-- The actual tasks created from templates on schedules/events
--
-- This migration creates the task instance table that tracks
-- the lifecycle of each operational task (assigned, started, completed, missed).

-- ============================================================================
-- Table: operation_task_instances
-- ============================================================================

CREATE TABLE IF NOT EXISTS operation_task_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),

  -- Template linkage
  template_id UUID REFERENCES operation_task_templates(id),
  template_name TEXT NOT NULL,
  template_category TEXT NOT NULL,
  template_cadence_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal', 'low')),
  license_threatening BOOLEAN NOT NULL DEFAULT false,
  estimated_minutes INTEGER CHECK (estimated_minutes >= 0),

  -- Shift assignment
  assigned_shift_date DATE NOT NULL, -- The date this task is for
  assigned_shift TEXT CHECK (assigned_shift IN ('day', 'evening', 'night')),

  -- Assignment
  assigned_to UUID REFERENCES auth.users(id),
  assigned_role TEXT, -- Cached from template at creation time
  assigned_by UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ,

  -- Execution tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'completed', 'missed', 'deferred', 'cancelled'
  )),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  missed_at TIMESTAMPTZ,
  deferred_until TIMESTAMPTZ,
  cancellation_reason TEXT,

  -- Completion evidence
  completion_notes TEXT,
  completion_evidence_paths TEXT[], -- Array of Supabase Storage paths
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,

  -- Escalation tracking
  current_escalation_level INTEGER DEFAULT 0,
  escalation_triggered_at TIMESTAMPTZ,
  escalation_history JSONB DEFAULT '[]'::jsonb,

  -- Dual-sign requirement for compliance tasks
  requires_dual_sign BOOLEAN NOT NULL DEFAULT false,
  signed_by UUID REFERENCES auth.users(id),
  signed_at TIMESTAMPTZ,
  second_sign_by UUID REFERENCES auth.users(id),
  second_signed_at TIMESTAMPTZ,

  -- SLA tracking
  due_at TIMESTAMPTZ, -- Calculated from template escalation_ladder
  sla_met BOOLEAN, -- Set on completion
  sla_miss_reason TEXT,

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

CREATE INDEX IF NOT EXISTS idx_oti_facility_date
  ON operation_task_instances(facility_id, assigned_shift_date, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oti_assigned_to
  ON operation_task_instances(assigned_to, status)
  WHERE deleted_at IS NULL AND status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_oti_status
  ON operation_task_instances(status, due_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oti_template
  ON operation_task_instances(template_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oti_missed
  ON operation_task_instances(status, missed_at)
  WHERE deleted_at IS NULL AND status = 'missed';

CREATE INDEX IF NOT EXISTS idx_oti_shift_date
  ON operation_task_instances(assigned_shift_date, facility_id)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE operation_task_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY oti_select ON operation_task_instances
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY oti_assign ON operation_task_instances
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY oti_update ON operation_task_instances
  FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND (
      -- Can update if assigned to them
      assigned_to = auth.uid()
      -- Operations admins can update all in accessible facilities
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'admin_assistant', 'nurse', 'dietary', 'maintenance_role')
      -- Facility admins can update in their facility
      OR (
        haven.app_role() = 'facility_admin'
        AND facility_id IN (SELECT haven.accessible_facility_ids())
      )
    )
  );

CREATE POLICY oti_delete ON operation_task_instances
  FOR DELETE USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- ============================================================================
-- Audit Trigger
-- ============================================================================

CREATE TRIGGER oti_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON operation_task_instances
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE operation_task_instances IS
  'The actual task instances created from templates. Tracks lifecycle:
   pending → in_progress → completed/missed. Supports escalation,
   dual-sign for compliance tasks, and SLA tracking.';

COMMENT ON COLUMN operation_task_instances.escalation_history IS
  'JSONB array of escalation events: [{role, escalated_at, reason}]';

COMMENT ON COLUMN operation_task_instances.completion_evidence_paths IS
  'Array of Supabase Storage paths for evidence (photos, PDFs, documents).';
