-- ============================================================================
-- 297_workspace_files.sql
-- Module 36 (Employee Workspace) — F3-2 Private file drive
--
-- Per-employee private file storage. Reuses the F0-1 break-glass grant table
-- from migration 296 (resource_type 'workspace_file'). Storage object path is
-- `{owner_user_id}/{file_id}/{filename}` so storage RLS can enforce both
-- owner-only access AND typed-reason break-glass by matching the file_id folder
-- against a live grant. F0-2 audit + soft deletes from this first migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- workspace_files (metadata)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspace_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid REFERENCES facilities(id),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),

  name text NOT NULL,
  original_filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  folder text NOT NULL DEFAULT 'General',
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team', 'org')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workspace_files_owner
  ON workspace_files(owner_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER workspace_files_set_updated_at
  BEFORE UPDATE ON workspace_files
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS (enabled before any data lands)
-- ----------------------------------------------------------------------------

ALTER TABLE workspace_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners see their own workspace files"
  ON workspace_files FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "Break-glass read of workspace files"
  ON workspace_files FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT 1 FROM workspace_breakglass_grants g
      WHERE g.resource_type = 'workspace_file'
        AND g.resource_id = workspace_files.id
        AND g.accessor_user_id = auth.uid()
        AND g.expires_at > now()
    )
  );

CREATE POLICY "Owners create their own workspace files"
  ON workspace_files FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "Owners update their own workspace files"
  ON workspace_files FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND owner_user_id = auth.uid()
  );

-- F0-3 offboarding transfer: owner/org_admin may reassign ownership.
CREATE POLICY "Admins transfer workspace file ownership"
  ON workspace_files FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- No DELETE policy: soft deletes only (deleted_at via UPDATE).

CREATE TRIGGER workspace_files_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON workspace_files
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ----------------------------------------------------------------------------
-- Storage bucket + RLS (private; owner-only + break-glass)
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-files',
  'workspace-files',
  false,
  52428800, -- 50MB
  ARRAY[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'text/plain', 'text/csv',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
) ON CONFLICT (id) DO NOTHING;

-- Object path = {owner_user_id}/{file_id}/{filename}
-- foldername[1] = owner, foldername[2] = file_id

CREATE POLICY storage_wf_owner_select ON storage.objects FOR SELECT USING (
  bucket_id = 'workspace-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY storage_wf_breakglass_select ON storage.objects FOR SELECT USING (
  bucket_id = 'workspace-files'
  AND haven.app_role() IN ('owner', 'org_admin')
  AND EXISTS (
    SELECT 1 FROM workspace_breakglass_grants g
    WHERE g.resource_type = 'workspace_file'
      AND g.resource_id::text = (storage.foldername(name))[2]
      AND g.accessor_user_id = auth.uid()
      AND g.expires_at > now()
  )
);

CREATE POLICY storage_wf_owner_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'workspace-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY storage_wf_owner_update ON storage.objects FOR UPDATE USING (
  bucket_id = 'workspace-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY storage_wf_owner_delete ON storage.objects FOR DELETE USING (
  bucket_id = 'workspace-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE workspace_files IS
  'Private-by-default employee file drive metadata; objects in the workspace-files Storage bucket. Owner-only + F0-1 break-glass. Module 36 F3-2.';
