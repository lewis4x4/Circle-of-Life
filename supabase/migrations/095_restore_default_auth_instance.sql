-- Hosted auth token issuance can fail when auth.users.instance_id points at the
-- default all-zero instance but auth.instances is empty.
-- Restore the default instance row used by the Oakridge seed accounts.

DO $$
BEGIN
  IF EXISTS (
    SELECT
      1
    FROM
      information_schema.tables
    WHERE
      table_schema = 'auth'
      AND table_name = 'instances') THEN
    INSERT INTO auth.instances (
      id,
      uuid,
      raw_base_config,
      created_at,
      updated_at
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000',
      '{}'::text,
      now(),
      now()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      uuid = EXCLUDED.uuid,
      raw_base_config = COALESCE(auth.instances.raw_base_config, EXCLUDED.raw_base_config),
      updated_at = now();
  END IF;
END $$;
