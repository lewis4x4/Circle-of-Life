-- ============================================================================
-- 291_office_internal_forms.sql
-- Module 35 (Office Suite) — F2-2 Internal forms builder
--
-- Admin-built internal forms (maintenance request, supply request, grievance
-- intake, refund request) with a jsonb field schema, and submissions that
-- route to a status-tracked queue per facility. Grievance submissions are
-- survey evidence → audit-logged, soft deletes, values stored verbatim.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- internal_form_templates
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS internal_form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general' CHECK (category IN (
    'maintenance', 'supply', 'grievance', 'refund', 'general'
  )),
  -- Ordered array of field definitions:
  -- [{ "key": "room", "label": "Room / area", "type": "text",
  --    "required": true, "options": [] }, ...]
  -- type IN ('text','textarea','number','date','select')
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_internal_form_templates_facility
  ON internal_form_templates(facility_id)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- internal_form_submissions (the status-tracked queue)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS internal_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  template_id uuid NOT NULL REFERENCES internal_form_templates(id),
  -- Snapshots so queue rows stay legible after template edits
  template_name text NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (category IN (
    'maintenance', 'supply', 'grievance', 'refund', 'general'
  )),
  -- { "<field key>": "<entered value>" } — stored verbatim at submission time
  values jsonb NOT NULL DEFAULT '{}'::jsonb,

  status text NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'in_progress', 'resolved', 'rejected'
  )),
  resolution_notes text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),

  submitted_by uuid NOT NULL REFERENCES auth.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_internal_form_submissions_facility_status
  ON internal_form_submissions(facility_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_internal_form_submissions_template_id
  ON internal_form_submissions(template_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_internal_form_submissions_submitted_by
  ON internal_form_submissions(submitted_by)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER internal_form_templates_set_updated_at
  BEFORE UPDATE ON internal_form_templates
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER internal_form_submissions_set_updated_at
  BEFORE UPDATE ON internal_form_submissions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS (enabled before any data lands)
-- ----------------------------------------------------------------------------

ALTER TABLE internal_form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_form_submissions ENABLE ROW LEVEL SECURITY;

-- internal_form_templates: any facility staff can read active forms to submit;
-- office/admin roles manage them.

CREATE POLICY "Staff see internal form templates in accessible facilities"
  ON internal_form_templates FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Admins create internal form templates in accessible facilities"
  ON internal_form_templates FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
  );

CREATE POLICY "Admins update internal form templates in accessible facilities"
  ON internal_form_templates FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
  );

-- internal_form_submissions: any facility staff can submit and see their own;
-- office/admin roles see and work the whole queue.

CREATE POLICY "Staff submit internal forms in accessible facilities"
  ON internal_form_submissions FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND submitted_by = auth.uid()
  );

CREATE POLICY "Submitters see their own internal form submissions"
  ON internal_form_submissions FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (
      submitted_by = auth.uid()
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
    )
  );

CREATE POLICY "Admins work the internal form queue"
  ON internal_form_submissions FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
  );

-- No DELETE policies: soft deletes only (deleted_at via UPDATE).

-- ----------------------------------------------------------------------------
-- Audit triggers (grievance intake is survey evidence)
-- ----------------------------------------------------------------------------

CREATE TRIGGER internal_form_templates_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON internal_form_templates
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER internal_form_submissions_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON internal_form_submissions
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE internal_form_templates IS
  'Admin-built internal form definitions (maintenance, supply, grievance, refund) with jsonb field schema. Module 35 F2-2.';

COMMENT ON TABLE internal_form_submissions IS
  'Internal form submissions routed to a per-facility status-tracked queue (submitted → in_progress → resolved/rejected). Module 35 F2-2.';
