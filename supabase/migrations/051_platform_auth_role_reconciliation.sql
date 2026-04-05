-- Phase 3.5-A: platform-auth-role-reconciliation
-- Middleware should reject JWT when profile updated_at > token iat (application contract).

ALTER TABLE user_profiles
  ADD COLUMN auth_claim_version integer NOT NULL DEFAULT 1 CHECK (auth_claim_version >= 1);

ALTER TABLE user_profiles
  ADD COLUMN mfa_enforced_at timestamptz;

COMMENT ON COLUMN user_profiles.auth_claim_version IS 'Increment when role/org changes; client compares to JWT custom claims.';
COMMENT ON COLUMN user_profiles.mfa_enforced_at IS 'When MFA became mandatory for this user (org policy).';
