-- ============================================================================
-- 299_workspace_team_spaces.sql
-- Module 36 (Employee Workspace) — F3-4 Team spaces
--
-- Shared collaboration spaces. Members can read pages shared into their space
-- (visibility='team'); the page owner still edits (single-editor model from
-- F3-1). Audit-logged, soft deletes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- team_spaces
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid REFERENCES facilities(id),

  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_team_spaces_org
  ON team_spaces(organization_id)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- team_space_members
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_space_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  team_space_id uuid NOT NULL REFERENCES team_spaces(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  space_role text NOT NULL DEFAULT 'member' CHECK (space_role IN ('member', 'lead')),

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,

  CONSTRAINT team_space_members_unique UNIQUE (team_space_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_space_members_user
  ON team_space_members(user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_team_space_members_space
  ON team_space_members(team_space_id)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- workspace_pages: link a page to a team space when shared
-- ----------------------------------------------------------------------------

ALTER TABLE workspace_pages
  ADD COLUMN IF NOT EXISTS team_space_id uuid REFERENCES team_spaces(id);

CREATE INDEX IF NOT EXISTS idx_workspace_pages_team_space
  ON workspace_pages(team_space_id)
  WHERE deleted_at IS NULL AND team_space_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------

CREATE TRIGGER team_spaces_set_updated_at
  BEFORE UPDATE ON team_spaces
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

ALTER TABLE team_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_space_members ENABLE ROW LEVEL SECURITY;

-- team_spaces: members see their spaces; admins see all; any staff create.
CREATE POLICY "Members and admins see team spaces"
  ON team_spaces FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR EXISTS (
        SELECT 1 FROM team_space_members m
        WHERE m.team_space_id = team_spaces.id
          AND m.user_id = auth.uid()
          AND m.deleted_at IS NULL
      )
    )
  );

CREATE POLICY "Staff create team spaces"
  ON team_spaces FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND created_by = auth.uid()
  );

-- Leads/creator/admins update a space.
CREATE POLICY "Leads and admins update team spaces"
  ON team_spaces FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM team_space_members m
        WHERE m.team_space_id = team_spaces.id
          AND m.user_id = auth.uid()
          AND m.space_role = 'lead'
          AND m.deleted_at IS NULL
      )
    )
  );

-- team_space_members: members see their space's roster; admins all.
CREATE POLICY "Members and admins see space members"
  ON team_space_members FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM team_space_members m2
        WHERE m2.team_space_id = team_space_members.team_space_id
          AND m2.user_id = auth.uid()
          AND m2.deleted_at IS NULL
      )
    )
  );

-- Space creator/lead/admins add members.
CREATE POLICY "Leads and admins add space members"
  ON team_space_members FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR EXISTS (
        SELECT 1 FROM team_spaces s
        WHERE s.id = team_space_members.team_space_id
          AND s.created_by = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM team_space_members m
        WHERE m.team_space_id = team_space_members.team_space_id
          AND m.user_id = auth.uid()
          AND m.space_role = 'lead'
          AND m.deleted_at IS NULL
      )
    )
  );

-- Leads/admins remove members (soft delete via UPDATE).
CREATE POLICY "Leads and admins update space members"
  ON team_space_members FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR EXISTS (
        SELECT 1 FROM team_spaces s
        WHERE s.id = team_space_members.team_space_id
          AND s.created_by = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM team_space_members m
        WHERE m.team_space_id = team_space_members.team_space_id
          AND m.user_id = auth.uid()
          AND m.space_role = 'lead'
          AND m.deleted_at IS NULL
      )
    )
  );

-- workspace_pages: team members can read pages shared into their space.
CREATE POLICY "Team members read shared workspace pages"
  ON workspace_pages FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND visibility = 'team'
    AND team_space_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM team_space_members m
      WHERE m.team_space_id = workspace_pages.team_space_id
        AND m.user_id = auth.uid()
        AND m.deleted_at IS NULL
    )
  );

-- ----------------------------------------------------------------------------
-- Audit triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER team_spaces_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON team_spaces
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER team_space_members_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON team_space_members
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE team_spaces IS
  'Shared employee collaboration spaces. Members read team-shared workspace pages. Module 36 F3-4.';
COMMENT ON TABLE team_space_members IS
  'Membership + role (member/lead) for team_spaces. Module 36 F3-4.';
