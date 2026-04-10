-- Migration 123: User Management — RLS policy updates
-- Updates user_profiles and user_facility_access policies for 13-role model.
-- Adds haven.role_tier() and haven.can_manage_user() helpers.

-- ── Helper: role_tier ────────────────────────────────────────────
-- Numeric hierarchy for role comparison. Higher = more privileged.

CREATE OR REPLACE FUNCTION haven.role_tier(p_role app_role)
  RETURNS int
  LANGUAGE sql IMMUTABLE
AS $func$
  SELECT CASE p_role
    WHEN 'owner'           THEN 100
    WHEN 'org_admin'       THEN 90
    WHEN 'facility_admin'  THEN 80
    WHEN 'manager'         THEN 70
    WHEN 'coordinator'     THEN 60
    WHEN 'admin_assistant' THEN 50
    WHEN 'nurse'           THEN 50
    WHEN 'dietary'         THEN 40
    WHEN 'maintenance_role'THEN 40
    WHEN 'broker'          THEN 30
    WHEN 'housekeeper'     THEN 30
    WHEN 'caregiver'       THEN 20
    WHEN 'family'          THEN 10
    ELSE 0
  END
$func$;

-- ── Helper: can_manage_user ──────────────────────────────────────
-- Returns true when the current (acting) user's role tier is strictly
-- higher than the target user's role tier, AND both are in the same org.
-- Owner can manage anyone. Org_admin can manage anyone except owner.

CREATE OR REPLACE FUNCTION haven.can_manage_user(p_target_user_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
AS $func$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles target
    WHERE target.id = p_target_user_id
      AND target.organization_id = haven.organization_id()
      AND haven.role_tier(haven.app_role()) > haven.role_tier(target.app_role)
  )
$func$;

-- ── user_profiles RLS updates ────────────────────────────────────
-- Drop and recreate policies that need to account for new roles.

-- SELECT: owners/org_admin see all (including soft-deleted).
--         Facility-scoped roles see users at their facilities.
--         Everyone sees their own profile.
DROP POLICY IF EXISTS users_see_profiles_in_their_organization ON user_profiles;
DROP POLICY IF EXISTS users_see_own_profile_row ON user_profiles;

CREATE POLICY users_see_profiles_in_their_organization ON user_profiles
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND (
      -- Owner / org_admin see everyone (including soft-deleted)
      haven.app_role() IN ('owner', 'org_admin')
      -- Facility-scoped roles see users who share a facility
      OR (
        haven.app_role() IN ('facility_admin', 'manager', 'admin_assistant', 'coordinator', 'nurse')
        AND EXISTS (
          SELECT 1 FROM public.user_facility_access ufa
          WHERE ufa.user_id = user_profiles.id
            AND ufa.facility_id IN (SELECT haven.accessible_facility_ids())
            AND ufa.revoked_at IS NULL
        )
        AND (deleted_at IS NULL)
      )
      -- Dietary, maintenance_role, housekeeper, caregiver, broker see own org profiles
      OR (
        haven.app_role() IN ('dietary', 'maintenance_role', 'housekeeper', 'caregiver', 'broker')
        AND deleted_at IS NULL
      )
      -- Everyone sees their own profile (including soft-deleted)
      OR id = auth.uid()
    )
    -- Soft-deleted only visible to owner/org_admin or self (handled above)
    AND (deleted_at IS NULL OR haven.app_role() IN ('owner', 'org_admin') OR id = auth.uid())
  );

-- UPDATE: role hierarchy enforcement
DROP POLICY IF EXISTS owner_org_admin_manage_profiles ON user_profiles;
DROP POLICY IF EXISTS users_update_own_profile ON user_profiles;

CREATE POLICY users_update_profiles_role_gated ON user_profiles
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND (
      -- Owner can edit anyone
      haven.app_role() = 'owner'
      -- Org_admin can edit non-owner users
      OR (
        haven.app_role() = 'org_admin'
        AND app_role != 'owner'
      )
      -- Facility_admin / manager can edit users below their tier at their facilities
      OR (
        haven.app_role() IN ('facility_admin', 'manager')
        AND haven.role_tier(haven.app_role()) > haven.role_tier(app_role)
        AND EXISTS (
          SELECT 1 FROM public.user_facility_access ufa
          WHERE ufa.user_id = user_profiles.id
            AND ufa.facility_id IN (SELECT haven.accessible_facility_ids())
            AND ufa.revoked_at IS NULL
        )
      )
      -- Users can update their own profile (limited fields — API enforces field scope)
      OR id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (
      haven.app_role() = 'owner'
      OR (
        haven.app_role() = 'org_admin'
        AND app_role != 'owner'
      )
      OR (
        haven.app_role() IN ('facility_admin', 'manager')
        AND haven.role_tier(haven.app_role()) > haven.role_tier(app_role)
      )
      OR id = auth.uid()
    )
  );

-- ── user_facility_access RLS updates ─────────────────────────────

DROP POLICY IF EXISTS admins_manage_facility_access_grants ON user_facility_access;

CREATE POLICY admins_manage_facility_access_grants ON user_facility_access
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  );
