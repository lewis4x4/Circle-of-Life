-- TEMPLATE. Operator statement for the Front Office officer registry in Haven.
-- Copy, fill the placeholders from a reviewed source, run once against the
-- linked project, keep the filled copy out of git. Placeholders only here.
--
-- FRONT_OFFICE_PROFILE_ID_*  = Front Office public.user_profiles.id (one row per seat)
-- <email>                    = the officer's Front Office session email (must match exactly, case-insensitive)
-- COL_ORGANIZATION_ID        = 00000000-0000-0000-0000-000000000001 (008_seed_col_organization.sql); confirm first:
--   select id, name from public.organizations where deleted_at is null;
-- target_user_id             = optional Haven public.user_profiles.id when the officer also has a Haven account
BEGIN;

INSERT INTO officer.federated_officers
  (front_office_profile_id, officer_role, email, organization_id, target_user_id, is_active, created_by)
VALUES
  ('<FRONT_OFFICE_PROFILE_ID_OWNER>', 'owner', '<owner email>', '<COL_ORGANIZATION_ID>', NULL, false, '<operator name, date, ticket>'),
  ('<FRONT_OFFICE_PROFILE_ID_CEO>',   'ceo',   '<ceo email>',   '<COL_ORGANIZATION_ID>', NULL, false, '<operator name, date, ticket>'),
  ('<FRONT_OFFICE_PROFILE_ID_CFO>',   'cfo',   '<cfo email>',   '<COL_ORGANIZATION_ID>', NULL, false, '<operator name, date, ticket>'),
  ('<FRONT_OFFICE_PROFILE_ID_COO>',   'coo',   '<coo email>',   '<COL_ORGANIZATION_ID>', NULL, false, '<operator name, date, ticket>'),
  ('<FRONT_OFFICE_PROFILE_ID_CTDO>',  'ctdo',  '<ctdo email>',  '<COL_ORGANIZATION_ID>', NULL, false, '<operator name, date, ticket>');

-- The key row already exists from migration 339, disabled. It is shown here so
-- the operator can see the whole posture in one statement; DO NOTHING keeps it.
INSERT INTO officer.gateway_keys (key_id, secret_env, enabled, allowed_capabilities)
VALUES ('front_office_v1', 'OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V1', false,
        ARRAY['occupied_beds','licensed_capacity','open_ar_balance','billed_revenue_mtd','incidents_last_30_days','staff_certifications_expiring_30_days','command_ping'])
ON CONFLICT (key_id) DO NOTHING;

COMMIT;

-- Activate one seat at a time when the owner of Haven says so:
-- UPDATE officer.federated_officers SET is_active = true WHERE front_office_profile_id = '<FRONT_OFFICE_PROFILE_ID_CFO>';
-- Revoke a seat (never delete; audit rows join to it):
-- UPDATE officer.federated_officers SET is_active = false, valid_until = now() WHERE front_office_profile_id = '<id>';
-- Enable the key last, after the Edge secret is set and the function is deployed:
-- UPDATE officer.gateway_keys SET enabled = true WHERE key_id = 'front_office_v1';
