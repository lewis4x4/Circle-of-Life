-- ============================================================
-- Compliance Engine Enhanced Tier: Emergency Preparedness Checklist
-- Spec: 08-compliance-engine.md § Enhanced Tier (Emergency Preparedness)
-- ============================================================

-- ============================================================
-- EMERGENCY CHECKLIST ITEMS
-- ============================================================
CREATE TABLE emergency_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Item definition
  checklist_type text NOT NULL CHECK (checklist_type IN (
    'generator_test',
    'fire_drill',
    'evacuation_drill',
    'other'
  )),
  title text NOT NULL,
  description text,
  frequency_days integer NOT NULL, -- How often it should be done

  -- Last completion
  last_completed_at timestamptz,
  last_completed_by uuid REFERENCES auth.users(id),
  last_participants text[], -- Staff who participated
  last_notes text,

  -- Next due
  next_due_date date NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_emergency_items_facility ON emergency_checklist_items(facility_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_emergency_items_due ON emergency_checklist_items(facility_id, next_due_date)
  WHERE deleted_at IS NULL AND next_due_date < CURRENT_DATE;

-- ============================================================
-- EMERGENCY CHECKLIST COMPLETIONS (history)
-- ============================================================
CREATE TABLE emergency_checklist_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_item_id uuid NOT NULL REFERENCES emergency_checklist_items(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  completed_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid NOT NULL REFERENCES auth.users(id),
  participants text[] NOT NULL,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_emergency_completions_item ON emergency_checklist_completions(checklist_item_id, completed_at DESC);

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- emergency_checklist_items
ALTER TABLE emergency_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_manage_emergency_checklist ON emergency_checklist_items
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

CREATE POLICY staff_see_emergency_checklist ON emergency_checklist_items
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('nurse', 'caregiver', 'dietary', 'maintenance_role')
  );

-- emergency_checklist_completions
ALTER TABLE emergency_checklist_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_emergency_completions ON emergency_checklist_completions
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

CREATE POLICY staff_see_emergency_completions ON emergency_checklist_completions
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('nurse', 'caregiver', 'dietary', 'maintenance_role')
  );

-- ============================================================
-- AUDIT TRIGGERS
-- ============================================================

CREATE TRIGGER tr_emergency_items_set_updated_at
  BEFORE UPDATE ON emergency_checklist_items
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER tr_emergency_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON emergency_checklist_items
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();

CREATE TRIGGER tr_emergency_completions_audit
  AFTER INSERT ON emergency_checklist_completions
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();

-- ============================================================
-- SEED DATA: Default preparedness items per facility
-- ============================================================

-- Generator test (monthly - 30 days)
INSERT INTO emergency_checklist_items (
  facility_id,
  organization_id,
  checklist_type,
  title,
  description,
  frequency_days,
  next_due_date
)
SELECT
  f.id,
  f.organization_id,
  'generator_test',
  'Generator Test',
  'Monthly generator test to ensure backup power availability. Verify start time, runtime, load capacity, and automatic transfer to backup power.',
  30,
  CURRENT_DATE + INTERVAL '7 days'
FROM facilities f;

-- Fire drill (quarterly - 90 days)
INSERT INTO emergency_checklist_items (
  facility_id,
  organization_id,
  checklist_type,
  title,
  description,
  frequency_days,
  next_due_date
)
SELECT
  f.id,
  f.organization_id,
  'fire_drill',
  'Fire Drill',
  'Quarterly fire drill for staff and resident evacuation practice. Document alarm response time, evacuation time, and any issues encountered.',
  90,
  CURRENT_DATE + INTERVAL '30 days'
FROM facilities f;

-- Evacuation drill (annual - 365 days)
INSERT INTO emergency_checklist_items (
  facility_id,
  organization_id,
  checklist_type,
  title,
  description,
  frequency_days,
  next_due_date
)
SELECT
  f.id,
  f.organization_id,
  'evacuation_drill',
  'Evacuation Drill',
  'Annual full facility evacuation drill. Simulate various emergency scenarios and evaluate staff response effectiveness.',
  365,
  CURRENT_DATE + INTERVAL '90 days'
FROM facilities f;
