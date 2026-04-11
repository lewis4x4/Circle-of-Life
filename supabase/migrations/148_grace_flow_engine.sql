-- Grace conversational flow engine schema + seed definitions.

CREATE TABLE IF NOT EXISTS public.flow_workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT haven.organization_id() REFERENCES public.organizations(id),
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  surface text NOT NULL DEFAULT 'grace',
  roles_allowed text[] NOT NULL DEFAULT '{}'::text[],
  enabled boolean NOT NULL DEFAULT true,
  feature_flag text,
  grace_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  undo_handler text,
  undo_semantic_rule text,
  high_value_threshold_cents integer,
  dry_run boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  CONSTRAINT flow_workflow_definitions_org_slug_unique UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_flow_workflow_definitions_org_surface
  ON public.flow_workflow_definitions (organization_id, surface)
  WHERE deleted_at IS NULL;

ALTER TABLE public.flow_workflow_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flow_workflow_definitions_org_read ON public.flow_workflow_definitions;
CREATE POLICY flow_workflow_definitions_org_read ON public.flow_workflow_definitions
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND organization_id = haven.organization_id()
  );

DROP POLICY IF EXISTS flow_workflow_definitions_org_admin_write ON public.flow_workflow_definitions;
CREATE POLICY flow_workflow_definitions_org_admin_insert ON public.flow_workflow_definitions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS flow_workflow_definitions_org_admin_update ON public.flow_workflow_definitions;
CREATE POLICY flow_workflow_definitions_org_admin_update ON public.flow_workflow_definitions
  FOR UPDATE
  TO authenticated
  USING (
    deleted_at IS NULL
    AND organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP TRIGGER IF EXISTS tr_flow_workflow_definitions_set_updated_at ON public.flow_workflow_definitions;
CREATE TRIGGER tr_flow_workflow_definitions_set_updated_at
  BEFORE UPDATE ON public.flow_workflow_definitions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TABLE IF NOT EXISTS public.flow_workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT haven.organization_id() REFERENCES public.organizations(id),
  flow_definition_id uuid NOT NULL REFERENCES public.flow_workflow_definitions(id),
  conversation_id uuid REFERENCES public.grace_conversations(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  surface text NOT NULL DEFAULT 'grace',
  status text NOT NULL DEFAULT 'pending',
  slot_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text text,
  undo_handler text,
  undo_deadline timestamptz,
  idempotency_key uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  CONSTRAINT flow_workflow_runs_org_user_idempotency_unique UNIQUE (organization_id, user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_flow_workflow_runs_org_created
  ON public.flow_workflow_runs (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_flow_workflow_runs_user_created
  ON public.flow_workflow_runs (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.flow_workflow_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flow_workflow_runs_own_read ON public.flow_workflow_runs;
CREATE POLICY flow_workflow_runs_own_read ON public.flow_workflow_runs
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND organization_id = haven.organization_id()
    AND (
      user_id = auth.uid()
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
    )
  );

DROP POLICY IF EXISTS flow_workflow_runs_own_write ON public.flow_workflow_runs;
CREATE POLICY flow_workflow_runs_own_write ON public.flow_workflow_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = haven.organization_id()
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS flow_workflow_runs_own_update ON public.flow_workflow_runs;
CREATE POLICY flow_workflow_runs_own_update ON public.flow_workflow_runs
  FOR UPDATE
  TO authenticated
  USING (
    deleted_at IS NULL
    AND organization_id = haven.organization_id()
    AND (
      user_id = auth.uid()
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
    )
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (
      user_id = auth.uid()
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
    )
  );

DROP TRIGGER IF EXISTS tr_flow_workflow_runs_set_updated_at ON public.flow_workflow_runs;
CREATE TRIGGER tr_flow_workflow_runs_set_updated_at
  BEFORE UPDATE ON public.flow_workflow_runs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TABLE IF NOT EXISTS public.flow_workflow_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT haven.organization_id() REFERENCES public.organizations(id),
  run_id uuid NOT NULL REFERENCES public.flow_workflow_runs(id) ON DELETE CASCADE,
  step_index integer NOT NULL,
  step_type text NOT NULL DEFAULT 'action',
  action_key text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flow_workflow_run_steps_run_idx
  ON public.flow_workflow_run_steps (run_id, step_index);

ALTER TABLE public.flow_workflow_run_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flow_workflow_run_steps_read ON public.flow_workflow_run_steps;
CREATE POLICY flow_workflow_run_steps_read ON public.flow_workflow_run_steps
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND EXISTS (
      SELECT 1
      FROM public.flow_workflow_runs r
      WHERE r.id = run_id
        AND r.deleted_at IS NULL
        AND (
          r.user_id = auth.uid()
          OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_workflow_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_workflow_runs TO authenticated;
GRANT SELECT ON public.flow_workflow_run_steps TO authenticated;

WITH orgs AS (
  SELECT id FROM public.organizations
)
INSERT INTO public.flow_workflow_definitions (
  organization_id,
  slug,
  name,
  description,
  surface,
  roles_allowed,
  grace_metadata,
  action_chain,
  undo_handler
)
SELECT
  orgs.id,
  seed.slug,
  seed.name,
  seed.description,
  'grace',
  seed.roles_allowed,
  seed.grace_metadata,
  seed.action_chain,
  seed.undo_handler
FROM orgs
CROSS JOIN (
  VALUES
    (
      'log_daily_note',
      'Log a daily note',
      'Record observations, behaviors, or care activities for a resident.',
      ARRAY['caregiver','nurse','admin_assistant','coordinator','manager','facility_admin','org_admin','owner']::text[],
      jsonb_build_object(
        'short_label', 'Daily note',
        'slot_schema', jsonb_build_array(
          jsonb_build_object('id', 'resident_id', 'label', 'Resident', 'type', 'entity_picker', 'entity_table', 'residents', 'required', true),
          jsonb_build_object('id', 'shift', 'label', 'Shift', 'type', 'choice', 'required', true, 'choices', jsonb_build_array(
            jsonb_build_object('value', 'day', 'label', 'Day'),
            jsonb_build_object('value', 'evening', 'label', 'Evening'),
            jsonb_build_object('value', 'night', 'label', 'Night')
          )),
          jsonb_build_object('id', 'log_date', 'label', 'Log date', 'type', 'text', 'required', true, 'placeholder', 'YYYY-MM-DD'),
          jsonb_build_object('id', 'general_notes', 'label', 'General notes', 'type', 'longtext', 'required', true),
          jsonb_build_object('id', 'mood', 'label', 'Mood', 'type', 'text'),
          jsonb_build_object('id', 'behavior_notes', 'label', 'Behavior notes', 'type', 'longtext')
        )
      ),
      jsonb_build_array(jsonb_build_object('action_key', 'create_daily_log', 'params', jsonb_build_object())),
      'delete_daily_log'
    ),
    (
      'report_incident',
      'Report an incident',
      'Create a resident or facility incident report with follow-up visibility.',
      ARRAY['caregiver','nurse','admin_assistant','coordinator','manager','facility_admin','org_admin','owner']::text[],
      jsonb_build_object(
        'short_label', 'Incident',
        'slot_schema', jsonb_build_array(
          jsonb_build_object('id', 'resident_id', 'label', 'Resident', 'type', 'entity_picker', 'entity_table', 'residents'),
          jsonb_build_object('id', 'occurred_at', 'label', 'Occurred at', 'type', 'text', 'required', true, 'placeholder', 'ISO timestamp'),
          jsonb_build_object('id', 'shift', 'label', 'Shift', 'type', 'choice', 'required', true, 'choices', jsonb_build_array(
            jsonb_build_object('value', 'day', 'label', 'Day'),
            jsonb_build_object('value', 'evening', 'label', 'Evening'),
            jsonb_build_object('value', 'night', 'label', 'Night')
          )),
          jsonb_build_object('id', 'category', 'label', 'Category', 'type', 'text', 'required', true),
          jsonb_build_object('id', 'severity', 'label', 'Severity', 'type', 'text', 'required', true),
          jsonb_build_object('id', 'location_description', 'label', 'Location', 'type', 'text', 'required', true),
          jsonb_build_object('id', 'description', 'label', 'Description', 'type', 'longtext', 'required', true),
          jsonb_build_object('id', 'immediate_actions', 'label', 'Immediate actions', 'type', 'longtext', 'required', true)
        )
      ),
      jsonb_build_array(jsonb_build_object('action_key', 'create_incident', 'params', jsonb_build_object())),
      'delete_incident'
    ),
    (
      'schedule_assessment',
      'Schedule an assessment',
      'Create a resident assessment record or follow-up evaluation.',
      ARRAY['nurse','manager','facility_admin','org_admin','owner']::text[],
      jsonb_build_object(
        'short_label', 'Assessment',
        'slot_schema', jsonb_build_array(
          jsonb_build_object('id', 'resident_id', 'label', 'Resident', 'type', 'entity_picker', 'entity_table', 'residents', 'required', true),
          jsonb_build_object('id', 'assessment_type', 'label', 'Assessment type', 'type', 'text', 'required', true),
          jsonb_build_object('id', 'assessment_date', 'label', 'Assessment date', 'type', 'text', 'required', true, 'placeholder', 'YYYY-MM-DD'),
          jsonb_build_object('id', 'next_due_date', 'label', 'Next due date', 'type', 'text'),
          jsonb_build_object('id', 'notes', 'label', 'Notes', 'type', 'longtext')
        )
      ),
      jsonb_build_array(jsonb_build_object('action_key', 'create_assessment', 'params', jsonb_build_object())),
      'delete_assessment'
    )
) AS seed(slug, name, description, roles_allowed, grace_metadata, action_chain, undo_handler)
ON CONFLICT (organization_id, slug) DO NOTHING;

COMMENT ON TABLE public.flow_workflow_definitions IS 'Grace conversational flow definitions and slot schemas.';
COMMENT ON TABLE public.flow_workflow_runs IS 'Per-run execution records for Grace-initiated flows.';
COMMENT ON TABLE public.flow_workflow_run_steps IS 'Step-by-step execution logs for Grace flow runs.';
