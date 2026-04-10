-- Migration 121: User Management — enum expansion + column additions
-- Adds 4 new app_role values (manager, admin_assistant, coordinator, housekeeper)
-- and 2 new columns on user_profiles (job_title, manager_user_id).
-- Purely additive — zero downtime, no data changes.

-- ── New enum values ──────────────────────────────────────────────

ALTER TYPE app_role ADD VALUE 'manager'         BEFORE 'nurse';
ALTER TYPE app_role ADD VALUE 'admin_assistant' BEFORE 'nurse';
ALTER TYPE app_role ADD VALUE 'coordinator'     BEFORE 'nurse';
ALTER TYPE app_role ADD VALUE 'housekeeper'     BEFORE 'family';

-- ── New columns on user_profiles ─────────────────────────────────

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES user_profiles(id);

COMMENT ON COLUMN user_profiles.job_title IS
  'Display title (e.g. "Lead Cook", "Medication Manager") that may differ from app_role';
COMMENT ON COLUMN user_profiles.manager_user_id IS
  'Direct manager for hierarchical user management workflows';

-- ── Indexes ──────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_user_profiles_manager
  ON user_profiles (manager_user_id)
  WHERE deleted_at IS NULL;

-- idx_user_profiles_role already exists from migration 003; add a
-- complementary index on app_role without the partial filter for
-- admin lookups that intentionally include soft-deleted rows.
CREATE INDEX IF NOT EXISTS idx_user_profiles_app_role
  ON user_profiles (app_role);
