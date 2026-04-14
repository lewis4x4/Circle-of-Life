-- Promote the seeded admin demo account to owner and grant explicit access
-- to every COL facility so management can review the full seeded experience.

DO $$
DECLARE
  v_org_id uuid := '00000000-0000-0000-0000-000000000001';
  v_user_id uuid := 'a0000000-0000-0000-0000-000000000008';
  v_primary_facility uuid := '00000000-0000-0000-0002-000000000001';
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'app_role', 'owner',
      'organization_id', v_org_id::text
    )
  WHERE id = v_user_id;

  UPDATE public.user_profiles
  SET app_role = 'owner',
      is_active = true,
      deleted_at = NULL,
      updated_at = now()
  WHERE id = v_user_id
    AND organization_id = v_org_id;

  UPDATE public.user_facility_access
  SET revoked_at = NULL,
      revoked_by = NULL,
      organization_id = v_org_id,
      is_primary = (facility_id = v_primary_facility)
  WHERE user_id = v_user_id
    AND facility_id IN (
      '00000000-0000-0000-0002-000000000001',
      '00000000-0000-0000-0002-000000000002',
      '00000000-0000-0000-0002-000000000003',
      '00000000-0000-0000-0002-000000000004',
      '00000000-0000-0000-0002-000000000005'
    );

  INSERT INTO public.user_facility_access (
    user_id,
    facility_id,
    organization_id,
    is_primary
  )
  VALUES
    (v_user_id, '00000000-0000-0000-0002-000000000001', v_org_id, true),
    (v_user_id, '00000000-0000-0000-0002-000000000002', v_org_id, false),
    (v_user_id, '00000000-0000-0000-0002-000000000003', v_org_id, false),
    (v_user_id, '00000000-0000-0000-0002-000000000004', v_org_id, false),
    (v_user_id, '00000000-0000-0000-0002-000000000005', v_org_id, false)
  ON CONFLICT (user_id, facility_id) WHERE revoked_at IS NULL
  DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    is_primary = EXCLUDED.is_primary;
END $$;
