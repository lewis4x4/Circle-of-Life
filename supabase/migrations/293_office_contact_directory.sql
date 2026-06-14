-- ============================================================================
-- 293_office_contact_directory.sql
-- Module 35 (Office Suite) — F2-4 Contact directory + on-call
--
-- Per-facility rolodex (pharmacy, hospice, physicians, AHCA field office, MCO
-- case managers, emergency services) and an after-hours on-call schedule.
-- Lighter than Module 19 vendor contracts — a fast operational phone book all
-- staff can read; admin roles manage. Audit-logged, soft deletes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- facility_contacts (rolodex)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS facility_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  name text NOT NULL,
  category text NOT NULL DEFAULT 'other' CHECK (category IN (
    'pharmacy', 'hospice', 'physician', 'hospital', 'ahca', 'mco_case_manager',
    'dcf', 'emergency_service', 'vendor', 'other'
  )),
  organization_name text,
  phone text,
  after_hours_phone text,
  fax text,
  email text,
  address text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_facility_contacts_facility_category
  ON facility_contacts(facility_id, category)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- on_call_shifts (after-hours coverage schedule)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS on_call_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  -- Role being covered (e.g. administrator on-call, nurse on-call, maintenance)
  role_label text NOT NULL,
  -- The covering person: an internal user when known, else a free-text name
  on_call_user_id uuid REFERENCES auth.users(id),
  on_call_name text NOT NULL,
  phone text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,

  CONSTRAINT on_call_shifts_time_order CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_on_call_shifts_facility_window
  ON on_call_shifts(facility_id, starts_at, ends_at)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER facility_contacts_set_updated_at
  BEFORE UPDATE ON facility_contacts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER on_call_shifts_set_updated_at
  BEFORE UPDATE ON on_call_shifts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS (enabled before any data lands)
-- ----------------------------------------------------------------------------

ALTER TABLE facility_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE on_call_shifts ENABLE ROW LEVEL SECURITY;

-- facility_contacts: all facility staff read (operational phone book);
-- admin/office roles manage.

CREATE POLICY "Staff see facility contacts in accessible facilities"
  ON facility_contacts FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Admins create facility contacts in accessible facilities"
  ON facility_contacts FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'admin_assistant')
  );

CREATE POLICY "Admins update facility contacts in accessible facilities"
  ON facility_contacts FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'admin_assistant')
  );

-- on_call_shifts: all facility staff read (they must know who is on call);
-- admin/office roles manage.

CREATE POLICY "Staff see on-call shifts in accessible facilities"
  ON on_call_shifts FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Admins create on-call shifts in accessible facilities"
  ON on_call_shifts FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'admin_assistant')
  );

CREATE POLICY "Admins update on-call shifts in accessible facilities"
  ON on_call_shifts FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'admin_assistant')
  );

-- No DELETE policies: soft deletes only (deleted_at via UPDATE).

-- ----------------------------------------------------------------------------
-- Audit triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER facility_contacts_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON facility_contacts
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER on_call_shifts_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON on_call_shifts
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE facility_contacts IS
  'Per-facility operational rolodex (pharmacy, hospice, physicians, AHCA, MCO case managers). Lighter than Module 19 vendor contracts. Module 35 F2-4.';

COMMENT ON TABLE on_call_shifts IS
  'After-hours on-call coverage schedule per facility. Module 35 F2-4.';
