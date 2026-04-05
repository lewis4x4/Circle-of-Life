-- Module 17 Enhanced — GL posting settings, facility_admin draft policies, idempotent source index
-- Depends on: 040_entity_facility_finance.sql, 041_journal_draft_soft_delete.sql

-- ============================================================
-- ENTITY GL SETTINGS (default account mappings for billing → GL)
-- ============================================================
CREATE TABLE entity_gl_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),

  accounts_receivable_id uuid REFERENCES gl_accounts (id),
  cash_id uuid REFERENCES gl_accounts (id),
  revenue_id uuid REFERENCES gl_accounts (id),

  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id)
);

CREATE UNIQUE INDEX idx_entity_gl_settings_entity ON entity_gl_settings (entity_id);

CREATE INDEX idx_entity_gl_settings_org ON entity_gl_settings (organization_id);

-- ============================================================
-- Idempotency: one posted journal per (source_type, source_id)
-- ============================================================
CREATE UNIQUE INDEX idx_journal_entries_source_unique ON journal_entries (source_type, source_id)
WHERE
  source_type IS NOT NULL
  AND source_id IS NOT NULL
  AND deleted_at IS NULL;

-- ============================================================
-- RLS for entity_gl_settings
-- ============================================================
ALTER TABLE entity_gl_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY entity_gl_settings_select ON entity_gl_settings
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY entity_gl_settings_insert ON entity_gl_settings
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY entity_gl_settings_update ON entity_gl_settings
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- Audit + updated_at for entity_gl_settings
-- ============================================================
CREATE TRIGGER tr_entity_gl_settings_set_updated_at
  BEFORE UPDATE ON entity_gl_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_entity_gl_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON entity_gl_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

-- ============================================================
-- facility_admin: draft-only journal entry creation (scoped to facility)
-- ============================================================
CREATE POLICY journal_entries_facility_admin_insert ON journal_entries
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () = 'facility_admin'
    AND status = 'draft'::journal_entry_status
    AND facility_id IS NOT NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY journal_entries_facility_admin_update_draft ON journal_entries
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () = 'facility_admin'
    AND status = 'draft'::journal_entry_status
    AND deleted_at IS NULL
    AND facility_id IS NOT NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () = 'facility_admin'
    AND status = 'draft'::journal_entry_status
    AND facility_id IS NOT NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY journal_lines_facility_admin_insert ON journal_entry_lines
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () = 'facility_admin'
    AND EXISTS (
      SELECT
        1
      FROM
        journal_entries j
      WHERE
        j.id = journal_entry_lines.journal_entry_id
        AND j.organization_id = haven.organization_id ()
        AND j.status = 'draft'::journal_entry_status
        AND j.deleted_at IS NULL
        AND j.facility_id IS NOT NULL
        AND j.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())));

CREATE POLICY journal_lines_facility_admin_update ON journal_entry_lines
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () = 'facility_admin'
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        journal_entries j
      WHERE
        j.id = journal_entry_lines.journal_entry_id
        AND j.status = 'draft'::journal_entry_status
        AND j.deleted_at IS NULL
        AND j.facility_id IS NOT NULL
        AND j.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () = 'facility_admin');
