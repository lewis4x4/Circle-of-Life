-- Phase 3.5-F: ai-invocation-framework (compliance chokepoint for PHI-class prompts)
-- Application must reject phi_class = phi when BAA / env not satisfied.

CREATE TYPE ai_phi_class AS ENUM (
  'none',
  'limited',
  'phi'
);

CREATE TABLE ai_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  model text NOT NULL,
  phi_class ai_phi_class NOT NULL DEFAULT 'none',
  prompt_hash text NOT NULL,
  response_hash text,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  tokens_used integer CHECK (tokens_used IS NULL OR tokens_used >= 0),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_ai_invocations_org_created ON ai_invocations (organization_id, created_at DESC);

CREATE TABLE ai_invocation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id) UNIQUE,
  default_provider text NOT NULL DEFAULT 'anthropic',
  allow_phi boolean NOT NULL DEFAULT false,
  routing_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE ai_invocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_invocations_select_own_org ON ai_invocations
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY ai_invocations_insert_own_org ON ai_invocations
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND created_by = auth.uid ());

ALTER TABLE ai_invocation_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_invocation_policies_rw ON ai_invocation_policies
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE TRIGGER tr_ai_invocation_policies_set_updated_at
  BEFORE UPDATE ON ai_invocation_policies
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

COMMENT ON TABLE ai_invocations IS 'Audit trail for AI calls; Edge Functions enforce BAA/phi_class before insert.';
