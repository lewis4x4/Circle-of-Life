-- Module 17 Enhanced — Finance depth (period close, posting rules)
-- Intercompany line markers + AP GL id also in 065 (Phase 3.5); this migration adds core close + rules.

CREATE TABLE gl_period_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  period_year integer NOT NULL CHECK (period_year >= 2000 AND period_year <= 2100),
  period_month integer NOT NULL CHECK (period_month >= 1 AND period_month <= 12),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users (id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz,
  CONSTRAINT gl_period_closes_entity_period_unique UNIQUE (entity_id, period_year, period_month)
);

CREATE INDEX idx_gl_period_closes_entity ON gl_period_closes (entity_id, period_year DESC, period_month DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE gl_posting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  event_type text NOT NULL,
  debit_gl_account_id uuid NOT NULL REFERENCES gl_accounts (id),
  credit_gl_account_id uuid NOT NULL REFERENCES gl_accounts (id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_gl_posting_rules_entity ON gl_posting_rules (entity_id, event_type)
WHERE
  deleted_at IS NULL
  AND is_active = TRUE;

ALTER TABLE journal_entries
  ADD COLUMN gl_period_close_id uuid REFERENCES gl_period_closes (id);

CREATE INDEX idx_journal_entries_period ON journal_entries (gl_period_close_id)
WHERE
  deleted_at IS NULL;

ALTER TABLE gl_period_closes ENABLE ROW LEVEL SECURITY;

CREATE POLICY gl_period_closes_rw ON gl_period_closes
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

ALTER TABLE gl_posting_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY gl_posting_rules_rw ON gl_posting_rules
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE TRIGGER tr_gl_period_closes_set_updated_at
  BEFORE UPDATE ON gl_period_closes
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_gl_period_closes_audit
  AFTER INSERT OR UPDATE OR DELETE ON gl_period_closes
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_gl_posting_rules_set_updated_at
  BEFORE UPDATE ON gl_posting_rules
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_gl_posting_rules_audit
  AFTER INSERT OR UPDATE OR DELETE ON gl_posting_rules
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
