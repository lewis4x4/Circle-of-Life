-- Track E — E9: Staff discipline records (progressive discipline + policy snapshots)

CREATE TYPE discipline_action AS ENUM (
  'none',
  'verbal_warning',
  'written_warning',
  'final_written_warning',
  'termination'
);

CREATE TABLE staff_discipline_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  staff_id uuid NOT NULL REFERENCES staff (id),
  action discipline_action NOT NULL,
  absence_count_at_action integer NOT NULL DEFAULT 0 CHECK (absence_count_at_action >= 0),
  tardy_count_at_action integer NOT NULL DEFAULT 0 CHECK (tardy_count_at_action >= 0),
  notes text,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  good_citizen_reset_after date,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_staff_discipline_staff ON staff_discipline_records (staff_id, effective_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_staff_discipline_facility ON staff_discipline_records (facility_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE staff_discipline_records IS 'Progressive discipline log; pairs with src/lib/staff/discipline.ts employment rules.';

ALTER TABLE staff_discipline_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_discipline_select ON staff_discipline_records
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY staff_discipline_insert ON staff_discipline_records
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY staff_discipline_update ON staff_discipline_records
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE TRIGGER tr_staff_discipline_set_updated_at
  BEFORE UPDATE ON staff_discipline_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_staff_discipline_audit
  AFTER INSERT OR UPDATE OR DELETE ON staff_discipline_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
