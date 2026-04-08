-- Haven pilot: JWT app_metadata.app_role for login routing.
-- The app reads role from auth.users → JWT app_metadata.app_role (see src/lib/auth/app-role.ts).
-- Migrations 093–094 seeded auth identities but did not set app_role on raw_app_meta_data;
-- user_profiles.app_role existed from 033 while emails were normalized in 094 only on auth.users.

UPDATE auth.users u
SET
  raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'app_role',
    CASE u.id
      WHEN 'a0000000-0000-0000-0000-000000000001' THEN 'owner'
      WHEN 'a0000000-0000-0000-0000-000000000002' THEN 'facility_admin'
      WHEN 'a0000000-0000-0000-0000-000000000003' THEN 'nurse'
      WHEN 'a0000000-0000-0000-0000-000000000004' THEN 'caregiver'
      WHEN 'a0000000-0000-0000-0000-000000000005' THEN 'caregiver'
      WHEN 'a0000000-0000-0000-0000-000000000006' THEN 'family'
      WHEN 'a0000000-0000-0000-0000-000000000007' THEN 'family'
    END
  ),
  updated_at = now()
WHERE
  u.id IN (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007'
  );

-- Email sync for user_profiles is in 111 (requires updated_by column — see haven_set_updated_at in 006).
