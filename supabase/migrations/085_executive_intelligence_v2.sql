-- Phase 5: Executive Intelligence v2 (spec 24-executive-v2) — NLQ sessions + scenarios

CREATE TYPE exec_nlq_session_status AS ENUM (
  'draft',
  'submitted',
  'completed',
  'failed'
);

CREATE TABLE exec_nlq_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  title text NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 500),
  status exec_nlq_session_status NOT NULL DEFAULT 'draft',
  ai_invocation_id uuid REFERENCES ai_invocations (id) ON DELETE SET NULL,
  result_summary text,
  intent_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_exec_nlq_sessions_org_created ON exec_nlq_sessions (organization_id, created_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_exec_nlq_sessions_user ON exec_nlq_sessions (user_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE exec_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid REFERENCES facilities (id),
  name text NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 200),
  description text,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_exec_scenarios_org ON exec_scenarios (organization_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_exec_scenarios_facility ON exec_scenarios (facility_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE exec_nlq_sessions IS 'NLQ session log; optional FK to ai_invocations; RLS owner/org_admin.';

COMMENT ON TABLE exec_scenarios IS 'What-if assumption bundles; RLS owner/org_admin.';

-- RLS (owner / org_admin — consistent with ai_invocations listing)
ALTER TABLE exec_nlq_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_nlq_sessions_select ON exec_nlq_sessions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY exec_nlq_sessions_insert ON exec_nlq_sessions
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND created_by = auth.uid ()
    AND user_id = auth.uid ());

CREATE POLICY exec_nlq_sessions_update ON exec_nlq_sessions
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

ALTER TABLE exec_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_scenarios_select ON exec_scenarios
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY exec_scenarios_insert ON exec_scenarios
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND created_by = auth.uid ());

CREATE POLICY exec_scenarios_update ON exec_scenarios
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE TRIGGER tr_exec_nlq_sessions_set_updated_at
  BEFORE UPDATE ON exec_nlq_sessions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_exec_nlq_sessions_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_nlq_sessions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_exec_scenarios_set_updated_at
  BEFORE UPDATE ON exec_scenarios
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_exec_scenarios_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_scenarios
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
