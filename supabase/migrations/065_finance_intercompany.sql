-- Phase 3.5-E: finance-intercompany (Module 17)

ALTER TABLE journal_entry_lines
  ADD COLUMN intercompany_counterparty_entity_id uuid REFERENCES entities (id);

ALTER TABLE journal_entry_lines
  ADD COLUMN intercompany_marker text;

COMMENT ON COLUMN journal_entry_lines.intercompany_marker IS 'Tag for inter-entity elimination reporting (pairs with counterparty_entity_id).';

CREATE INDEX idx_journal_lines_intercompany ON journal_entry_lines (organization_id, intercompany_marker)
WHERE
  deleted_at IS NULL
  AND intercompany_marker IS NOT NULL;

ALTER TABLE entity_gl_settings
  ADD COLUMN accounts_payable_gl_account_id uuid REFERENCES gl_accounts (id);

COMMENT ON COLUMN entity_gl_settings.accounts_payable_gl_account_id IS 'Default AP account for vendor invoice posting.';
