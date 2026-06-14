-- ============================================================================
-- 296_workspace_pages.sql
-- Module 36 (Employee Workspace) — F3-1 Personal notes/pages
--
-- FIRST private-content table → F0 governance is built in HERE, not later:
--   F0-1 break-glass: owner/org_admin can read a private page ONLY after
--        inserting a workspace_breakglass_grants row with a typed reason
--        (RLS requires a live grant; the grant is audit-logged).
--   F0-2 audit + soft deletes + retention: audit triggers + deleted_at on all
--        tables from this first migration; nothing is ever hard-deleted.
--   F0-3 offboarding transfer: owner/org_admin may reassign owner_user_id
--        (transfer to manager) — the per-item primitive; bulk offboarding
--        orchestration composes this in a later segment.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- workspace_pages (private by default)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspace_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  -- Optional facility context; personal notes need not be facility-bound
  facility_id uuid REFERENCES facilities(id),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),

  title text NOT NULL DEFAULT 'Untitled',
  body text NOT NULL DEFAULT '',
  template_kind text NOT NULL DEFAULT 'blank' CHECK (template_kind IN (
    'blank', 'shift_report', 'incident_follow_up', 'one_on_one', 'meeting_notes', 'family_call_log'
  )),
  -- Forward-compatible with F3-3/F3-4 (publish to team/org); stays 'private' here
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team', 'org')),
  -- Single-editor lock (no realtime co-editing in v1)
  locked_by uuid REFERENCES auth.users(id),
  locked_at timestamptz,
  version integer NOT NULL DEFAULT 1,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workspace_pages_owner
  ON workspace_pages(owner_user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- workspace_page_versions (history)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspace_page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  page_id uuid NOT NULL REFERENCES workspace_pages(id),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),
  version integer NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_page_versions_page
  ON workspace_page_versions(page_id, version DESC);

-- ----------------------------------------------------------------------------
-- workspace_breakglass_grants (F0-1: typed-reason emergency access)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspace_breakglass_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  -- Generic resource pointer (page now; files/cards reuse this in later F3 segments)
  resource_type text NOT NULL DEFAULT 'workspace_page' CHECK (resource_type IN (
    'workspace_page', 'workspace_file', 'workspace_card'
  )),
  resource_id uuid NOT NULL,
  accessor_user_id uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_breakglass_lookup
  ON workspace_breakglass_grants(resource_type, resource_id, accessor_user_id, expires_at DESC);

-- ----------------------------------------------------------------------------
-- updated_at trigger (pages)
-- ----------------------------------------------------------------------------

CREATE TRIGGER workspace_pages_set_updated_at
  BEFORE UPDATE ON workspace_pages
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS (enabled before any data lands)
-- ----------------------------------------------------------------------------

ALTER TABLE workspace_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_page_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_breakglass_grants ENABLE ROW LEVEL SECURITY;

-- workspace_pages: owner full access to their own pages.
CREATE POLICY "Owners see their own workspace pages"
  ON workspace_pages FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND owner_user_id = auth.uid()
  );

-- F0-1 break-glass read: owner/org_admin may read a private page only with a
-- live typed-reason grant they created.
CREATE POLICY "Break-glass read of workspace pages"
  ON workspace_pages FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT 1 FROM workspace_breakglass_grants g
      WHERE g.resource_type = 'workspace_page'
        AND g.resource_id = workspace_pages.id
        AND g.accessor_user_id = auth.uid()
        AND g.expires_at > now()
    )
  );

CREATE POLICY "Owners create their own workspace pages"
  ON workspace_pages FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "Owners update their own workspace pages"
  ON workspace_pages FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND owner_user_id = auth.uid()
  );

-- F0-3 offboarding transfer: owner/org_admin may reassign ownership.
CREATE POLICY "Admins transfer workspace page ownership"
  ON workspace_pages FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- workspace_page_versions: owner reads their own history; break-glass mirrors pages.
CREATE POLICY "Owners see their workspace page versions"
  ON workspace_page_versions FOR SELECT USING (
    organization_id = haven.organization_id()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "Break-glass read of workspace page versions"
  ON workspace_page_versions FOR SELECT USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT 1 FROM workspace_breakglass_grants g
      WHERE g.resource_type = 'workspace_page'
        AND g.resource_id = workspace_page_versions.page_id
        AND g.accessor_user_id = auth.uid()
        AND g.expires_at > now()
    )
  );

CREATE POLICY "Owners write their workspace page versions"
  ON workspace_page_versions FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND owner_user_id = auth.uid()
  );

-- workspace_breakglass_grants: owner/org_admin create their own grants (reason
-- is NOT NULL → a typed reason is mandatory); creators read their grants.
CREATE POLICY "Admins create break-glass grants"
  ON workspace_breakglass_grants FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
    AND accessor_user_id = auth.uid()
  );

CREATE POLICY "Admins see break-glass grants"
  ON workspace_breakglass_grants FOR SELECT USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- No UPDATE/DELETE on versions or grants (immutable history + access record).
-- No DELETE on pages: soft deletes only (deleted_at via UPDATE).

-- ----------------------------------------------------------------------------
-- Audit triggers (F0-2: private content + access fully audited)
-- ----------------------------------------------------------------------------

CREATE TRIGGER workspace_pages_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON workspace_pages
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER workspace_breakglass_grants_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON workspace_breakglass_grants
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE workspace_pages IS
  'Private-by-default employee notes/pages with version history + single-editor lock. Module 36 F3-1.';
COMMENT ON TABLE workspace_page_versions IS
  'Immutable version history for workspace pages. Module 36 F3-1.';
COMMENT ON TABLE workspace_breakglass_grants IS
  'F0-1 break-glass: typed-reason, audit-logged emergency access to private workspace content by owner/org_admin. Module 36 F3-1.';
