-- PostgreSQL parses COALESCE and NULLIF as expression syntax, not ordinary
-- schema-qualified functions. Repair the staged definitions forward while
-- retaining the first migration as the exact history that was exercised.
DO $repair$
DECLARE
  v_definition text;
  v_signature regprocedure;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.fail_kb_ingest_preflight(uuid,uuid,uuid,integer,uuid,text)'::regprocedure,
    'public.fail_kb_ingest_authority_change(uuid)'::regprocedure,
    'public.commit_kb_ingest_generation(uuid,jsonb,text,integer,jsonb)'::regprocedure,
    'public.fail_kb_ingest_generation(uuid,text)'::regprocedure
  ]
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_signature);
    v_definition := pg_catalog.replace(v_definition, 'pg_catalog.coalesce', 'coalesce');
    v_definition := pg_catalog.replace(v_definition, 'pg_catalog.nullif', 'nullif');
    EXECUTE v_definition;
  END LOOP;
END;
$repair$;

REVOKE ALL ON FUNCTION public.fail_kb_ingest_preflight(uuid,uuid,uuid,integer,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_kb_ingest_preflight(uuid,uuid,uuid,integer,uuid,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.fail_kb_ingest_authority_change(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_kb_ingest_authority_change(uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.commit_kb_ingest_generation(uuid,jsonb,text,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_kb_ingest_generation(uuid,jsonb,text,integer,jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.fail_kb_ingest_generation(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_kb_ingest_generation(uuid,text)
  TO service_role;

-- Rollback: restore the preceding definitions only after deploying the prior
-- Edge Function. No data cleanup is required for this definition-only repair.
