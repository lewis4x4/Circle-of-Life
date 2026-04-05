-- Module 17 Enhanced (stretch) — GL budget lines for budget vs actual variance
-- Depends on: 042_enhanced_finance_gl_settings.sql

CREATE TABLE gl_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  gl_account_id uuid NOT NULL REFERENCES gl_accounts (id),

  period_start date NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_gl_budget_lines_account_period ON gl_budget_lines (entity_id, gl_account_id, period_start)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_gl_budget_lines_entity ON gl_budget_lines (entity_id, period_start)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_gl_budget_lines_org ON gl_budget_lines (organization_id)
WHERE
  deleted_at IS NULL;

ALTER TABLE gl_budget_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY gl_budget_lines_select ON gl_budget_lines
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY gl_budget_lines_insert ON gl_budget_lines
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY gl_budget_lines_update ON gl_budget_lines
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY gl_budget_lines_delete ON gl_budget_lines
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE TRIGGER tr_gl_budget_lines_set_updated_at
  BEFORE UPDATE ON gl_budget_lines
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_gl_budget_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON gl_budget_lines
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
