-- ============================================================================
-- 303_survey_binder_items.sql
-- Module 36 (Office Suite) — F4-4 Survey-readiness binder
--
-- A curated, facility-scoped readiness checklist that sits on top of live
-- evidence (facility documents, in-services, drills, survey history). Admin /
-- office roles mark each binder line ready / in_progress / missing with a note
-- and an internal link. Audit-logged, soft deletes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS survey_binder_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  category text NOT NULL DEFAULT 'other' CHECK (category IN (
    'admin_records', 'staff_records', 'resident_records', 'medication',
    'food_service', 'physical_plant', 'emergency_preparedness', 'policies', 'other'
  )),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN (
    'ready', 'in_progress', 'missing', 'not_applicable'
  )),
  note text,
  source_url text,
  sort_order integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_survey_binder_items_facility_category
  ON survey_binder_items(facility_id, category, sort_order)
  WHERE deleted_at IS NULL;

CREATE TRIGGER survey_binder_items_set_updated_at
  BEFORE UPDATE ON survey_binder_items
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — admin/office roles in accessible facilities
-- ----------------------------------------------------------------------------

ALTER TABLE survey_binder_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins see survey binder items in accessible facilities"
  ON survey_binder_items FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Admins create survey binder items in accessible facilities"
  ON survey_binder_items FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Admins update survey binder items in accessible facilities"
  ON survey_binder_items FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

-- No DELETE policy: soft deletes only.

CREATE TRIGGER survey_binder_items_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON survey_binder_items
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

COMMENT ON TABLE survey_binder_items IS
  'Curated AHCA survey-readiness checklist per facility, layered over live evidence. Module 36 F4-4.';
