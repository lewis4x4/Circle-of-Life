DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staff_attendance_event_type') THEN
    CREATE TYPE staff_attendance_event_type AS ENUM ('callout', 'late_callout', 'no_show', 'left_early', 'attendance_note');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS staff_attendance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_type staff_attendance_event_type NOT NULL,
  occurred_at timestamptz NOT NULL,
  shift_assignment_id uuid REFERENCES shift_assignments(id),
  reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_events_facility_time
  ON staff_attendance_events (facility_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_attendance_events_staff
  ON staff_attendance_events (staff_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE staff_attendance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_attendance_events_select ON staff_attendance_events;
CREATE POLICY staff_attendance_events_select ON staff_attendance_events
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
  );

DROP POLICY IF EXISTS staff_attendance_events_manage ON staff_attendance_events;
CREATE POLICY staff_attendance_events_manage ON staff_attendance_events
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

DROP TRIGGER IF EXISTS tr_staff_attendance_events_set_updated_at ON staff_attendance_events;
CREATE TRIGGER tr_staff_attendance_events_set_updated_at
  BEFORE UPDATE ON staff_attendance_events
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_staff_attendance_events_audit ON staff_attendance_events;
CREATE TRIGGER tr_staff_attendance_events_audit
  AFTER INSERT OR UPDATE OR DELETE ON staff_attendance_events
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();
