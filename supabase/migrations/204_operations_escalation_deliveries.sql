-- S6: OCE escalation delivery log

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operation_escalation_channel') THEN
    CREATE TYPE operation_escalation_channel AS ENUM ('in_app', 'sms', 'voice');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operation_escalation_delivery_status') THEN
    CREATE TYPE operation_escalation_delivery_status AS ENUM ('queued', 'sent', 'failed', 'skipped');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS operation_escalation_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  task_instance_id uuid NOT NULL REFERENCES operation_task_instances(id) ON DELETE CASCADE,
  escalation_level integer NOT NULL DEFAULT 1,
  target_role text,
  target_user_id uuid REFERENCES auth.users(id),
  target_phone text,
  channel operation_escalation_channel NOT NULL,
  delivery_status operation_escalation_delivery_status NOT NULL DEFAULT 'queued',
  provider_message_id text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_operation_escalation_deliveries_task
  ON operation_escalation_deliveries(task_instance_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_operation_escalation_deliveries_facility
  ON operation_escalation_deliveries(facility_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE operation_escalation_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_escalation_deliveries_select ON operation_escalation_deliveries;
CREATE POLICY operation_escalation_deliveries_select ON operation_escalation_deliveries
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant', 'coordinator', 'nurse')
  );

DROP POLICY IF EXISTS operation_escalation_deliveries_insert ON operation_escalation_deliveries;
CREATE POLICY operation_escalation_deliveries_insert ON operation_escalation_deliveries
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant', 'coordinator', 'nurse', 'maintenance_role')
  );

CREATE TRIGGER tr_operation_escalation_deliveries_audit
  AFTER INSERT OR UPDATE OR DELETE ON operation_escalation_deliveries
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();
