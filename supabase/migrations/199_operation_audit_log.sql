-- Migration 199: Operation Audit Log
-- Part of Module 27 — Operations Cadence Engine (OCE)
-- Tracks every task state change for compliance
--
-- This migration creates the operation audit log table that records
-- every state change in operation_task_instances for full compliance
-- trail and dispute resolution.

-- ============================================================================
-- Table: operation_audit_log
-- ============================================================================

CREATE TABLE IF NOT EXISTS operation_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID REFERENCES facilities(id),
  task_instance_id UUID REFERENCES operation_task_instances(id),

  -- Change details
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'assigned', 'started', 'completed', 'missed', 'deferred',
    'cancelled', 'escalated', 'verified', 'signed', 'updated'
  )),
  from_status TEXT,
  to_status TEXT,

  -- Actor
  actor_id UUID REFERENCES auth.users(id),
  actor_role TEXT,

  -- Context
  event_notes TEXT,
  event_data JSONB,

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_oal_task
  ON operation_audit_log(task_instance_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oal_facility_date
  ON operation_audit_log(facility_id, created_at DESC)
  WHERE created_at >= CURRENT_DATE - INTERVAL '90 days';

CREATE INDEX IF NOT EXISTS idx_oal_event_type
  ON operation_audit_log(event_type, created_at DESC)
  WHERE created_at >= CURRENT_DATE - INTERVAL '90 days';

CREATE INDEX IF NOT EXISTS idx_oal_actor
  ON operation_audit_log(actor_id, created_at DESC)
  WHERE created_at >= CURRENT_DATE - INTERVAL '90 days';

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE operation_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY oal_select ON operation_audit_log
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND (
      facility_id IS NULL
      OR facility_id IN (SELECT haven.accessible_facility_ids())
    )
  );

CREATE POLICY oal_insert ON operation_audit_log
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
  );

-- Audit log is append-only. No UPDATE or DELETE policies.
-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE operation_audit_log IS
  'Audit trail for all operational task state changes.
   Records created, assigned, started, completed, missed, deferred,
   cancelled, escalated, verified, signed events.
   Append-only — no UPDATE or DELETE policies.';

COMMENT ON COLUMN operation_audit_log.event_data IS
  'JSONB for additional event context: escalation details,
   signature info, verification notes, etc.';
