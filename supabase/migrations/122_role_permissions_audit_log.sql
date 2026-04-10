-- Migration 122: Role permissions table + user management audit log
-- Creates role_permissions (RBAC matrix) and user_management_audit_log
-- (complete audit trail for all user management operations).

-- ── role_permissions ─────────────────────────────────────────────
-- Maps role × feature × permission level for granular access control.

CREATE TABLE role_permissions (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  app_role    TEXT    NOT NULL,
  feature     TEXT    NOT NULL,
  permission_level TEXT NOT NULL,  -- 'view', 'edit', 'delete', 'admin'
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT role_permissions_unique UNIQUE (app_role, feature, permission_level),
  CONSTRAINT role_permissions_valid_permission
    CHECK (permission_level IN ('view', 'edit', 'delete', 'admin'))
);

CREATE INDEX idx_role_permissions_role    ON role_permissions (app_role);
CREATE INDEX idx_role_permissions_feature ON role_permissions (feature);

-- Seed: core RBAC matrix for user_management feature
INSERT INTO role_permissions (app_role, feature, permission_level, description) VALUES
  ('owner',           'user_management', 'admin', 'Full user management across all orgs'),
  ('org_admin',       'user_management', 'admin', 'Full user management at org level'),
  ('facility_admin',  'user_management', 'edit',  'User management at assigned facilities'),
  ('manager',         'user_management', 'edit',  'Limited user management (Plantation)'),
  ('admin_assistant', 'user_management', 'view',  'View-only user data at assigned facility'),
  ('coordinator',     'user_management', 'view',  'View-only user data at assigned facility'),
  ('nurse',           'user_management', 'view',  'View-only user data'),
  ('caregiver',       'user_management', 'view',  'View only own profile'),
  ('dietary',         'user_management', 'view',  'View only own profile'),
  ('housekeeper',     'user_management', 'view',  'View only own profile'),
  ('maintenance_role','user_management', 'view',  'View only own profile'),
  ('family',          'user_management', 'view',  'View limited resident user data'),
  ('broker',          'user_management', 'admin', 'Full access for system administration');

-- ── user_management_audit_log ────────────────────────────────────

CREATE TABLE user_management_audit_log (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID    NOT NULL REFERENCES organizations(id),
  acting_user_id    UUID    NOT NULL REFERENCES auth.users(id),
  target_user_id    UUID    NOT NULL REFERENCES user_profiles(id),
  action            TEXT    NOT NULL,
  resource_type     TEXT    NOT NULL DEFAULT 'user',
  changes           JSONB   NOT NULL DEFAULT '{}',
  reason            TEXT,
  ip_address        INET,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT valid_audit_action CHECK (action IN (
    'create', 'update_profile', 'update_role',
    'grant_access', 'revoke_access',
    'soft_delete', 'reactivate'
  ))
);

CREATE INDEX idx_audit_organization  ON user_management_audit_log (organization_id);
CREATE INDEX idx_audit_acting_user   ON user_management_audit_log (acting_user_id);
CREATE INDEX idx_audit_target_user   ON user_management_audit_log (target_user_id);
CREATE INDEX idx_audit_action        ON user_management_audit_log (action);
CREATE INDEX idx_audit_created_at    ON user_management_audit_log (created_at DESC);

-- ── RLS on role_permissions ──────────────────────────────────────

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_permissions_select ON role_permissions
  FOR SELECT USING (true);  -- Readable by all authenticated users for UI gating

-- ── RLS on user_management_audit_log ─────────────────────────────

ALTER TABLE user_management_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select ON user_management_audit_log
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- Insert only via API / service role — no direct RLS insert
CREATE POLICY audit_log_insert_blocked ON user_management_audit_log
  FOR INSERT WITH CHECK (false);
