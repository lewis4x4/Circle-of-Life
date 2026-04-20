DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staff_requisition_status') THEN
    CREATE TYPE staff_requisition_status AS ENUM ('draft', 'open', 'interviewing', 'offered', 'filled', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS staff_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  role_title text NOT NULL,
  staff_role_target staff_role,
  department text,
  status staff_requisition_status NOT NULL DEFAULT 'draft',
  target_hire_date date,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_staff_requisitions_facility_status
  ON staff_requisitions (facility_id, status)
  WHERE deleted_at IS NULL;

ALTER TABLE staff_requisitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_requisitions_select ON staff_requisitions;
CREATE POLICY staff_requisitions_select ON staff_requisitions
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  );

DROP POLICY IF EXISTS staff_requisitions_manage ON staff_requisitions;
CREATE POLICY staff_requisitions_manage ON staff_requisitions
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  );

DROP TRIGGER IF EXISTS tr_staff_requisitions_set_updated_at ON staff_requisitions;
CREATE TRIGGER tr_staff_requisitions_set_updated_at
  BEFORE UPDATE ON staff_requisitions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_staff_requisitions_audit ON staff_requisitions;
CREATE TRIGGER tr_staff_requisitions_audit
  AFTER INSERT OR UPDATE OR DELETE ON staff_requisitions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();
