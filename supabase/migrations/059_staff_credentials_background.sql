-- Phase 3.5-C: staff-credentials-background (Module 11)

CREATE TYPE background_check_result AS ENUM (
  'pending',
  'clear',
  'review',
  'adverse',
  'expired'
);

CREATE TABLE staff_background_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  staff_id uuid NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  clearinghouse_id text,
  result background_check_result NOT NULL DEFAULT 'pending',
  checked_at timestamptz,
  expires_at date,
  document_storage_path text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_staff_bg_staff ON staff_background_checks (staff_id)
WHERE
  deleted_at IS NULL;

ALTER TABLE staff
  ADD COLUMN excluded_from_care boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN staff.excluded_from_care IS 'If true, must not be assigned to direct care shifts (enforced by trigger).';

ALTER TABLE staff_background_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_bg_admin ON staff_background_checks
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE TRIGGER tr_staff_bg_set_updated_at
  BEFORE UPDATE ON staff_background_checks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_staff_bg_audit
  AFTER INSERT OR UPDATE OR DELETE ON staff_background_checks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE OR REPLACE FUNCTION public.haven_shift_assignment_staff_eligible ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
DECLARE
  _excluded boolean;
BEGIN
  SELECT
    excluded_from_care INTO _excluded
  FROM
    staff
  WHERE
    id = NEW.staff_id;
  IF _excluded = TRUE THEN
    RAISE EXCEPTION 'Staff member is excluded from care assignments';
  END IF;
  RETURN NEW;
END;
$func$;

CREATE TRIGGER tr_shift_assignments_staff_eligible
  BEFORE INSERT OR UPDATE OF staff_id ON shift_assignments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_shift_assignment_staff_eligible ();
