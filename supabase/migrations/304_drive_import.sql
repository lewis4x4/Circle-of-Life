-- ============================================================================
-- 304_drive_import.sql
-- Module 36 (Employee Workspace) — F5-1 Google Drive import (migration ledger)
--
-- Durable mapping + tracking ledger for the Google Drive → Haven cutover
-- (F0-5 hard cutoff 2026-07-01). An admin loads a Drive manifest, maps each
-- item to an owner employee / team space / Knowledge Base, and records the
-- import. The live Drive-API byte transfer for binary files runs behind
-- owner-provided OAuth credentials (deferred); text-mappable destinations
-- (KB document, team/private page bookmark) are created in-platform here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS drive_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  name text NOT NULL,
  source text NOT NULL DEFAULT 'google_drive' CHECK (source IN ('google_drive')),
  status text NOT NULL DEFAULT 'mapping' CHECK (status IN (
    'mapping', 'importing', 'complete', 'archived'
  )),
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_drive_import_batches_facility
  ON drive_import_batches(facility_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS drive_import_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  batch_id uuid NOT NULL REFERENCES drive_import_batches(id),

  source_name text NOT NULL,
  source_path text,
  source_drive_id text,
  mime_type text,
  size_bytes bigint,
  web_view_link text,

  destination text NOT NULL DEFAULT 'unassigned' CHECK (destination IN (
    'unassigned', 'private_page', 'team_page', 'knowledge_base', 'skip'
  )),
  owner_user_id uuid REFERENCES auth.users(id),
  team_space_id uuid REFERENCES team_spaces(id),

  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'mapped', 'imported', 'skipped', 'failed'
  )),
  imported_ref_type text CHECK (imported_ref_type IN ('document', 'workspace_page')),
  imported_ref_id uuid,
  error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_drive_import_files_batch
  ON drive_import_files(batch_id, status)
  WHERE deleted_at IS NULL;

CREATE TRIGGER drive_import_batches_set_updated_at
  BEFORE UPDATE ON drive_import_batches
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER drive_import_files_set_updated_at
  BEFORE UPDATE ON drive_import_files
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — admin/office roles in accessible facilities (cutover is an admin task)
-- ----------------------------------------------------------------------------

ALTER TABLE drive_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_import_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins see drive import batches in accessible facilities"
  ON drive_import_batches FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Admins create drive import batches in accessible facilities"
  ON drive_import_batches FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Admins update drive import batches in accessible facilities"
  ON drive_import_batches FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Admins see drive import files in accessible facilities"
  ON drive_import_files FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Admins create drive import files in accessible facilities"
  ON drive_import_files FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Admins update drive import files in accessible facilities"
  ON drive_import_files FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

-- No DELETE policies: soft deletes only.

CREATE TRIGGER drive_import_batches_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON drive_import_batches
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER drive_import_files_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON drive_import_files
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

COMMENT ON TABLE drive_import_batches IS
  'Google Drive cutover batches (F0-5). Module 36 F5-1.';
COMMENT ON TABLE drive_import_files IS
  'Per-file Drive→Haven mapping + import status ledger. Module 36 F5-1.';
