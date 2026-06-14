-- ============================================================================
-- 294_office_front_desk_kit.sql
-- Module 35 (Office Suite) — F4-2 Front desk kit
--
-- Three front-desk logs:
--   1. visitor_log_entries     — sign-in/out + health screening (infection
--                                control surveillance input; screening fields
--                                captured here, surfaced to IC later)
--   2. package_log_entries     — package / mail custody log
--   3. family_call_log_entries — family phone-call log attached to a resident
-- Operational records, audit-logged, soft deletes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- visitor_log_entries
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS visitor_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  visitor_name text NOT NULL,
  visitor_type text NOT NULL DEFAULT 'family' CHECK (visitor_type IN (
    'family', 'vendor', 'contractor', 'medical', 'official', 'other'
  )),
  -- Optional resident being visited
  resident_id uuid REFERENCES residents(id),
  purpose text,

  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_out_at timestamptz,

  -- Infection-control screening (surveillance input)
  screening_passed boolean,
  temperature_f numeric(4, 1),
  symptoms_reported boolean NOT NULL DEFAULT false,
  screening_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_visitor_log_facility_checked_in
  ON visitor_log_entries(facility_id, checked_in_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_visitor_log_resident
  ON visitor_log_entries(resident_id)
  WHERE deleted_at IS NULL AND resident_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- package_log_entries
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS package_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  -- Who it is for: a resident when known, else free text (staff, facility)
  resident_id uuid REFERENCES residents(id),
  recipient_name text NOT NULL,
  carrier text,
  package_type text NOT NULL DEFAULT 'package' CHECK (package_type IN (
    'package', 'mail', 'perishable', 'medication', 'other'
  )),
  description text,

  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid REFERENCES auth.users(id),
  delivered_at timestamptz,
  delivered_to_name text,
  delivered_by uuid REFERENCES auth.users(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_package_log_facility_received
  ON package_log_entries(facility_id, received_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_package_log_resident
  ON package_log_entries(resident_id)
  WHERE deleted_at IS NULL AND resident_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- family_call_log_entries (attached to a resident)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS family_call_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  resident_id uuid NOT NULL REFERENCES residents(id),
  caller_name text NOT NULL,
  relationship text,
  direction text NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  call_at timestamptz NOT NULL DEFAULT now(),
  summary text NOT NULL,
  follow_up_needed boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_family_call_log_facility_call_at
  ON family_call_log_entries(facility_id, call_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_family_call_log_resident
  ON family_call_log_entries(resident_id, call_at DESC)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER visitor_log_entries_set_updated_at
  BEFORE UPDATE ON visitor_log_entries
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER package_log_entries_set_updated_at
  BEFORE UPDATE ON package_log_entries
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER family_call_log_entries_set_updated_at
  BEFORE UPDATE ON family_call_log_entries
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS (enabled before any data lands)
-- ----------------------------------------------------------------------------

ALTER TABLE visitor_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_call_log_entries ENABLE ROW LEVEL SECURITY;

-- Front-desk logs: any facility staff record and read entries in accessible
-- facilities; office/admin roles can update/correct.

-- visitor_log_entries
CREATE POLICY "Staff see visitor log in accessible facilities"
  ON visitor_log_entries FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Staff record visitor log in accessible facilities"
  ON visitor_log_entries FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Staff update visitor log in accessible facilities"
  ON visitor_log_entries FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- package_log_entries
CREATE POLICY "Staff see package log in accessible facilities"
  ON package_log_entries FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Staff record package log in accessible facilities"
  ON package_log_entries FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Staff update package log in accessible facilities"
  ON package_log_entries FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- family_call_log_entries
CREATE POLICY "Staff see family call log in accessible facilities"
  ON family_call_log_entries FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Staff record family call log in accessible facilities"
  ON family_call_log_entries FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Staff update family call log in accessible facilities"
  ON family_call_log_entries FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- No DELETE policies: soft deletes only (deleted_at via UPDATE).

-- ----------------------------------------------------------------------------
-- Audit triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER visitor_log_entries_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON visitor_log_entries
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER package_log_entries_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON package_log_entries
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER family_call_log_entries_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON family_call_log_entries
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE visitor_log_entries IS
  'Front-desk visitor sign-in/out with infection-control health screening. Module 35 F4-2.';

COMMENT ON TABLE package_log_entries IS
  'Front-desk package / mail custody log. Module 35 F4-2.';

COMMENT ON TABLE family_call_log_entries IS
  'Family phone-call log attached to a resident. Module 35 F4-2.';
