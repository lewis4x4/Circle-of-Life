-- ============================================================================
-- 289_office_meetings.sql
-- Module 35 (Office Suite) — F1-3 Meeting hub
--
-- Recurring meeting templates (standup, QA, safety committee), meeting
-- instances with agendas + in-app minutes, and action items that become
-- OCE task instances (escalation-chased). Replaces the standup call log
-- spreadsheet. Minutes are survey evidence → audit-logged, soft deletes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- meeting_templates
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meeting_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  name text NOT NULL,
  description text,
  cadence text NOT NULL DEFAULT 'weekly' CHECK (cadence IN (
    'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'ad_hoc'
  )),
  -- Array of agenda item strings copied onto meetings created from this template
  default_agenda jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_meeting_templates_facility
  ON meeting_templates(facility_id)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- meetings
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  template_id uuid REFERENCES meeting_templates(id),
  title text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'in_progress', 'completed', 'cancelled'
  )),

  -- Array of agenda item strings (copied from template default_agenda or typed)
  agenda jsonb NOT NULL DEFAULT '[]'::jsonb,
  minutes text,
  -- Array of attendee display-name strings (free text: staff, vendors, family reps)
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  chaired_by uuid REFERENCES auth.users(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_meetings_facility_scheduled_at
  ON meetings(facility_id, scheduled_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_meetings_template_id
  ON meetings(template_id)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- meeting_action_items
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meeting_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  meeting_id uuid NOT NULL REFERENCES meetings(id),
  description text NOT NULL,
  assigned_to uuid REFERENCES auth.users(id),
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'completed', 'cancelled'
  )),
  -- Set when the action item is materialized as an OCE task instance
  -- so escalation chasing applies (reuse mandate — no parallel task system).
  oce_task_instance_id uuid REFERENCES operation_task_instances(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_meeting_action_items_meeting_id
  ON meeting_action_items(meeting_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_meeting_action_items_facility_status
  ON meeting_action_items(facility_id, status)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER meeting_templates_set_updated_at
  BEFORE UPDATE ON meeting_templates
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER meetings_set_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER meeting_action_items_set_updated_at
  BEFORE UPDATE ON meeting_action_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS (enabled before any data lands)
-- ----------------------------------------------------------------------------

ALTER TABLE meeting_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_action_items ENABLE ROW LEVEL SECURITY;

-- meeting_templates

CREATE POLICY "Staff see meeting templates in accessible facilities"
  ON meeting_templates FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Admins create meeting templates in accessible facilities"
  ON meeting_templates FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'nurse')
  );

CREATE POLICY "Admins update meeting templates in accessible facilities"
  ON meeting_templates FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'nurse')
  );

-- meetings

CREATE POLICY "Staff see meetings in accessible facilities"
  ON meetings FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Admins create meetings in accessible facilities"
  ON meetings FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'nurse')
  );

CREATE POLICY "Admins update meetings in accessible facilities"
  ON meetings FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'nurse')
  );

-- meeting_action_items

CREATE POLICY "Staff see meeting action items in accessible facilities"
  ON meeting_action_items FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Admins create meeting action items in accessible facilities"
  ON meeting_action_items FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'nurse')
  );

CREATE POLICY "Admins or assignees update meeting action items"
  ON meeting_action_items FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (
      assigned_to = auth.uid()
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'nurse')
    )
  );

-- No DELETE policies: soft deletes only (deleted_at via UPDATE).

-- ----------------------------------------------------------------------------
-- Audit triggers (minutes + action items are survey evidence)
-- ----------------------------------------------------------------------------

CREATE TRIGGER meeting_templates_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON meeting_templates
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER meetings_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON meetings
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER meeting_action_items_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON meeting_action_items
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE meeting_templates IS
  'Recurring meeting definitions (standup, QA, safety committee) with default agendas. Module 35 F1-3.';

COMMENT ON TABLE meetings IS
  'Meeting instances: agenda, in-app minutes, attendees. Replaces the standup call log spreadsheet. Module 35 F1-3.';

COMMENT ON TABLE meeting_action_items IS
  'Action items captured in meetings; materialized as operation_task_instances (oce_task_instance_id) so OCE escalation chases them. Module 35 F1-3.';
