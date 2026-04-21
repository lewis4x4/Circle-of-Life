-- S4: Cross-module workflow event history
-- Referral -> admission -> collections -> Form 1823 gate orchestration

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_event_type') THEN
    CREATE TYPE workflow_event_type AS ENUM (
      'referral_admission_started',
      'admission_case_updated',
      'admission_status_changed',
      'admission_move_in_blocked',
      'form_1823_received',
      'referral_converted',
      'collection_activity_logged'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  referral_lead_id uuid REFERENCES referral_leads(id) ON DELETE SET NULL,
  admission_case_id uuid REFERENCES admission_cases(id) ON DELETE SET NULL,
  resident_id uuid REFERENCES residents(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  collection_activity_id uuid REFERENCES collection_activities(id) ON DELETE SET NULL,
  event_type workflow_event_type NOT NULL,
  source_module text NOT NULL,
  event_key text UNIQUE,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_facility_date
  ON workflow_events (facility_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_events_admission_case
  ON workflow_events (admission_case_id, created_at DESC)
  WHERE deleted_at IS NULL
    AND admission_case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_events_referral_lead
  ON workflow_events (referral_lead_id, created_at DESC)
  WHERE deleted_at IS NULL
    AND referral_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_events_resident
  ON workflow_events (resident_id, created_at DESC)
  WHERE deleted_at IS NULL
    AND resident_id IS NOT NULL;

ALTER TABLE workflow_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_events_select ON workflow_events;
CREATE POLICY workflow_events_select ON workflow_events
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant', 'coordinator', 'nurse')
  );

DROP POLICY IF EXISTS workflow_events_insert ON workflow_events;
CREATE POLICY workflow_events_insert ON workflow_events
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant', 'coordinator', 'nurse')
  );

CREATE TRIGGER tr_workflow_events_audit
  AFTER INSERT OR UPDATE OR DELETE ON workflow_events
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();

COMMENT ON TABLE workflow_events IS
  'Cross-module workflow history for referral, admissions, collections, and required admission-document gating.';
