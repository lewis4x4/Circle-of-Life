-- COL-771 (migration 560): the Jev accuracy views stay caller-rights and
-- closed to anon, and the Wilson lower bound matches the page's library
-- (src/lib/document-intake/jev-accuracy.ts, wilsonLower(30, 30) = 0.8865).
-- Local disposable replay only: everything rolls back. No fixtures.
BEGIN;

-- 1. Both views run on the caller's authority, so Document Intake RLS applies.
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(v.name, ', ' ORDER BY v.name)
    INTO v_missing
  FROM (VALUES ('document_intake_jev_outcomes'), ('document_intake_jev_check_outcomes')) v(name)
  WHERE COALESCE((
    SELECT o.option_value
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
    LATERAL pg_catalog.pg_options_to_table(c.reloptions) o
    WHERE n.nspname = 'public' AND c.relname = v.name AND c.relkind = 'v'
      AND o.option_name = 'security_invoker'
  ), 'false') <> 'true';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'COL-771: % no longer security_invoker; the accuracy page would read past Document Intake RLS', v_missing;
  END IF;
END $$;

-- 2. anon holds nothing on either view; authenticated may read both.
DO $$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['public.document_intake_jev_outcomes', 'public.document_intake_jev_check_outcomes'] LOOP
    IF has_table_privilege('anon', v_name, 'SELECT') THEN
      RAISE EXCEPTION 'COL-771: anon can read %', v_name;
    END IF;
    IF NOT has_table_privilege('authenticated', v_name, 'SELECT') THEN
      RAISE EXCEPTION 'COL-771: authenticated cannot read %', v_name;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'haven.wilson_lower(integer, integer, numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'haven.wilson_lower(integer, integer, numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'COL-771: haven.wilson_lower grants incorrect';
  END IF;
END $$;

-- 3. Same bound as the TypeScript library, and null when nothing was evaluated.
DO $$
BEGIN
  IF haven.wilson_lower(30, 30) IS DISTINCT FROM 0.8865 THEN
    RAISE EXCEPTION 'COL-771: wilson_lower(30, 30) = %, expected 0.8865', haven.wilson_lower(30, 30);
  END IF;
  IF haven.wilson_lower(0, 0) IS NOT NULL THEN
    RAISE EXCEPTION 'COL-771: wilson_lower(0, 0) should be null';
  END IF;
END $$;

-- 4. Both views plan and read, as the owner and as a signed-in person.
SELECT count(*) FROM public.document_intake_jev_outcomes;
SELECT count(*) FROM public.document_intake_jev_check_outcomes;
SET LOCAL ROLE authenticated;
SELECT count(*) FROM public.document_intake_jev_outcomes;
SELECT count(*) FROM public.document_intake_jev_check_outcomes;
RESET ROLE;

ROLLBACK;
