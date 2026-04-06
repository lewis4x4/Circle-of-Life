-- Hosted Supabase Auth rejects .demo addresses for signup validation.
-- Normalize the Oakridge pilot identities onto a valid company-style domain.

DO $$
BEGIN
  UPDATE auth.users
  SET
    email = CASE id
      WHEN 'a0000000-0000-0000-0000-000000000001' THEN 'milton@circleoflifealf.com'
      WHEN 'a0000000-0000-0000-0000-000000000002' THEN 'jessica@circleoflifealf.com'
      WHEN 'a0000000-0000-0000-0000-000000000003' THEN 'sarah.williams@circleoflifealf.com'
      WHEN 'a0000000-0000-0000-0000-000000000004' THEN 'maria.garcia@circleoflifealf.com'
      WHEN 'a0000000-0000-0000-0000-000000000005' THEN 'james.thompson@circleoflifealf.com'
      WHEN 'a0000000-0000-0000-0000-000000000006' THEN 'robert.sullivan@circleoflifealf.com'
      WHEN 'a0000000-0000-0000-0000-000000000007' THEN 'linda.chen@circleoflifealf.com'
      ELSE email
    END,
    updated_at = now()
  WHERE
    id IN (
      'a0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000002',
      'a0000000-0000-0000-0000-000000000003',
      'a0000000-0000-0000-0000-000000000004',
      'a0000000-0000-0000-0000-000000000005',
      'a0000000-0000-0000-0000-000000000006',
      'a0000000-0000-0000-0000-000000000007'
    );

  UPDATE auth.identities
  SET
    identity_data = CASE user_id
      WHEN 'a0000000-0000-0000-0000-000000000001' THEN jsonb_set(identity_data, '{email}', to_jsonb('milton@circleoflifealf.com'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000002' THEN jsonb_set(identity_data, '{email}', to_jsonb('jessica@circleoflifealf.com'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000003' THEN jsonb_set(identity_data, '{email}', to_jsonb('sarah.williams@circleoflifealf.com'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000004' THEN jsonb_set(identity_data, '{email}', to_jsonb('maria.garcia@circleoflifealf.com'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000005' THEN jsonb_set(identity_data, '{email}', to_jsonb('james.thompson@circleoflifealf.com'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000006' THEN jsonb_set(identity_data, '{email}', to_jsonb('robert.sullivan@circleoflifealf.com'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000007' THEN jsonb_set(identity_data, '{email}', to_jsonb('linda.chen@circleoflifealf.com'::text), true)
      ELSE identity_data
    END,
    updated_at = now()
  WHERE
    provider = 'email'
    AND user_id IN (
      'a0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000002',
      'a0000000-0000-0000-0000-000000000003',
      'a0000000-0000-0000-0000-000000000004',
      'a0000000-0000-0000-0000-000000000005',
      'a0000000-0000-0000-0000-000000000006',
      'a0000000-0000-0000-0000-000000000007'
    );

END $$;
