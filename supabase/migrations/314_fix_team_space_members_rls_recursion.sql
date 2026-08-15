-- Fix recursive RLS evaluation for employee Team Spaces.
--
-- Migration 299 queried team_space_members from policies attached to that same
-- table. PostgreSQL correctly rejects those queries with SQLSTATE 42P17
-- (infinite recursion detected in policy). Keep membership checks behind small,
-- caller-bound SECURITY DEFINER helpers so policies can evaluate membership
-- without recursively re-entering team_space_members RLS.

CREATE OR REPLACE FUNCTION haven.is_team_space_member(p_team_space_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, haven, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_space_members AS member
    WHERE member.team_space_id = p_team_space_id
      AND member.organization_id = haven.organization_id()
      AND member.user_id = auth.uid()
      AND member.deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION haven.is_team_space_lead(p_team_space_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, haven, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_space_members AS member
    WHERE member.team_space_id = p_team_space_id
      AND member.organization_id = haven.organization_id()
      AND member.user_id = auth.uid()
      AND member.space_role = 'lead'
      AND member.deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION haven.is_team_space_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION haven.is_team_space_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION haven.is_team_space_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION haven.is_team_space_lead(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION haven.is_team_space_lead(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION haven.is_team_space_lead(uuid) TO authenticated;

DROP POLICY IF EXISTS "Members and admins see team spaces" ON public.team_spaces;
CREATE POLICY "Members and admins see team spaces"
  ON public.team_spaces FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR created_by = auth.uid()
      OR haven.is_team_space_member(id)
    )
  );

DROP POLICY IF EXISTS "Leads and admins update team spaces" ON public.team_spaces;
CREATE POLICY "Leads and admins update team spaces"
  ON public.team_spaces FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR created_by = auth.uid()
      OR haven.is_team_space_lead(id)
    )
  );

DROP POLICY IF EXISTS "Members and admins see space members" ON public.team_space_members;
CREATE POLICY "Members and admins see space members"
  ON public.team_space_members FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR user_id = auth.uid()
      OR haven.is_team_space_member(team_space_id)
    )
  );

DROP POLICY IF EXISTS "Leads and admins add space members" ON public.team_space_members;
CREATE POLICY "Leads and admins add space members"
  ON public.team_space_members FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR EXISTS (
        SELECT 1
        FROM public.team_spaces AS space
        WHERE space.id = team_space_members.team_space_id
          AND space.created_by = auth.uid()
      )
      OR haven.is_team_space_lead(team_space_id)
    )
  );

DROP POLICY IF EXISTS "Leads and admins update space members" ON public.team_space_members;
CREATE POLICY "Leads and admins update space members"
  ON public.team_space_members FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR EXISTS (
        SELECT 1
        FROM public.team_spaces AS space
        WHERE space.id = team_space_members.team_space_id
          AND space.created_by = auth.uid()
      )
      OR haven.is_team_space_lead(team_space_id)
    )
  );

DROP POLICY IF EXISTS "Team members read shared workspace pages" ON public.workspace_pages;
CREATE POLICY "Team members read shared workspace pages"
  ON public.workspace_pages FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND visibility = 'team'
    AND team_space_id IS NOT NULL
    AND haven.is_team_space_member(team_space_id)
  );

COMMENT ON FUNCTION haven.is_team_space_member(uuid) IS
  'Caller-bound RLS helper: true when auth.uid() is an active member of the org-scoped team space.';

COMMENT ON FUNCTION haven.is_team_space_lead(uuid) IS
  'Caller-bound RLS helper: true when auth.uid() is an active lead of the org-scoped team space.';
