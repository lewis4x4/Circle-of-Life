-- Diagnostic: dump auth.users column info to find what we're missing.
-- Also compare a working user (001) vs freshly-inserted user (003).

DO $$
DECLARE
  col record;
  working_val text;
  broken_val text;
BEGIN
  RAISE NOTICE '=== auth.users columns ===';
  FOR col IN
    SELECT column_name, data_type, is_nullable, column_default, is_generated, generation_expression
    FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
    ORDER BY ordinal_position
  LOOP
    -- Get value from working user 001
    EXECUTE format('SELECT %I::text FROM auth.users WHERE id = $1', col.column_name)
      INTO working_val USING 'a0000000-0000-0000-0000-000000000001'::uuid;
    -- Get value from broken user 003
    EXECUTE format('SELECT %I::text FROM auth.users WHERE id = $1', col.column_name)
      INTO broken_val USING 'a0000000-0000-0000-0000-000000000003'::uuid;

    -- Only show differences
    IF working_val IS DISTINCT FROM broken_val THEN
      RAISE NOTICE 'DIFF %-30s type=%-20s nullable=%-3s generated=%-5s', col.column_name, col.data_type, col.is_nullable, col.is_generated;
      RAISE NOTICE '  working(001): %', COALESCE(working_val, 'NULL');
      RAISE NOTICE '  broken(003):  %', COALESCE(broken_val, 'NULL');
    END IF;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=== auth.identities columns ===';
  FOR col IN
    SELECT column_name, data_type, is_nullable, is_generated, generation_expression
    FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'identities'
    ORDER BY ordinal_position
  LOOP
    EXECUTE format('SELECT %I::text FROM auth.identities WHERE user_id = $1 LIMIT 1', col.column_name)
      INTO working_val USING 'a0000000-0000-0000-0000-000000000001'::uuid;
    EXECUTE format('SELECT %I::text FROM auth.identities WHERE user_id = $1 LIMIT 1', col.column_name)
      INTO broken_val USING 'a0000000-0000-0000-0000-000000000003'::uuid;

    IF working_val IS DISTINCT FROM broken_val THEN
      RAISE NOTICE 'DIFF %-30s type=%-20s nullable=%-3s generated=%-5s', col.column_name, col.data_type, col.is_nullable, col.is_generated;
      RAISE NOTICE '  working(001): %', COALESCE(working_val, 'NULL');
      RAISE NOTICE '  broken(003):  %', COALESCE(broken_val, 'NULL');
    END IF;
  END LOOP;
END $$;
