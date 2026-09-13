-- Hosted Supabase Auth rejects .demo addresses for signup validation.
-- Normalize the Oakridge pilot identities onto a valid company-style domain.

DO $$
BEGIN
  UPDATE auth.users
  SET
    email = CASE id
      WHEN 'a0000000-0000-0000-0000-000000000001' THEN 'synthetic-ba1e868e89@example.invalid'
      WHEN 'a0000000-0000-0000-0000-000000000002' THEN 'synthetic-306f0fbd4f@example.invalid'
      WHEN 'a0000000-0000-0000-0000-000000000003' THEN 'synthetic-2fc22c1aa3@example.invalid'
      WHEN 'a0000000-0000-0000-0000-000000000004' THEN 'synthetic-813214ed80@example.invalid'
      WHEN 'a0000000-0000-0000-0000-000000000005' THEN 'synthetic-ac844d9cd5@example.invalid'
      WHEN 'a0000000-0000-0000-0000-000000000006' THEN 'synthetic-b622b93c3d@example.invalid'
      WHEN 'a0000000-0000-0000-0000-000000000007' THEN 'synthetic-3785ef655c@example.invalid'
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
      WHEN 'a0000000-0000-0000-0000-000000000001' THEN jsonb_set(identity_data, '{email}', to_jsonb('synthetic-ba1e868e89@example.invalid'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000002' THEN jsonb_set(identity_data, '{email}', to_jsonb('synthetic-306f0fbd4f@example.invalid'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000003' THEN jsonb_set(identity_data, '{email}', to_jsonb('synthetic-2fc22c1aa3@example.invalid'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000004' THEN jsonb_set(identity_data, '{email}', to_jsonb('synthetic-813214ed80@example.invalid'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000005' THEN jsonb_set(identity_data, '{email}', to_jsonb('synthetic-ac844d9cd5@example.invalid'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000006' THEN jsonb_set(identity_data, '{email}', to_jsonb('synthetic-b622b93c3d@example.invalid'::text), true)
      WHEN 'a0000000-0000-0000-0000-000000000007' THEN jsonb_set(identity_data, '{email}', to_jsonb('synthetic-3785ef655c@example.invalid'::text), true)
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
