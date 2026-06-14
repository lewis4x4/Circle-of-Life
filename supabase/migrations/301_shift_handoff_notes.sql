-- ============================================================================
-- 301_shift_handoff_notes.sql
-- Module 36 (Employee Workspace) — F3-6 Shift handoff board
--
-- Facility-shared shift-to-shift handoff. Outgoing shift posts notes; incoming
-- shift acknowledges. Operational (not private) — all facility staff read/post.
-- Resident-linkable → audit-logged, soft deletes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS shift_handoff_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  shift_date date NOT NULL,
  shift text NOT NULL CHECK (shift IN ('day', 'evening', 'night')),
  category text NOT NULL DEFAULT 'other' CHECK (category IN (
    'resident', 'staffing', 'facility', 'follow_up', 'other'
  )),
  resident_id uuid REFERENCES residents(id),
  note text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'critical')),

  acknowledged_by uuid REFERENCES auth.users(id),
  acknowledged_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_shift_handoff_facility_shift
  ON shift_handoff_notes(facility_id, shift_date DESC, shift)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shift_handoff_resident
  ON shift_handoff_notes(resident_id)
  WHERE deleted_at IS NULL AND resident_id IS NOT NULL;

CREATE TRIGGER shift_handoff_notes_set_updated_at
  BEFORE UPDATE ON shift_handoff_notes
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — facility staff read/post; acknowledge via update
-- ----------------------------------------------------------------------------

ALTER TABLE shift_handoff_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff see handoff notes in accessible facilities"
  ON shift_handoff_notes FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Staff post handoff notes in accessible facilities"
  ON shift_handoff_notes FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Staff update handoff notes in accessible facilities"
  ON shift_handoff_notes FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- No DELETE policy: soft deletes only.

CREATE TRIGGER shift_handoff_notes_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON shift_handoff_notes
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

COMMENT ON TABLE shift_handoff_notes IS
  'Facility shift-to-shift handoff board; outgoing posts, incoming acknowledges. Module 36 F3-6.';
