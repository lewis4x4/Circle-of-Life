-- Keep KB ingest generation commands compatible with both known workspace
-- column shapes. Greenfield/staging use uuid; the live Haven KB uses text with
-- canonical UUID strings. Casting both operands to text preserves exact tenant
-- equality without assuming either physical type.

CREATE OR REPLACE FUNCTION public.create_kb_ingest_authorization_run(
  p_run_id uuid,
  p_document_id uuid,
  p_actor_id uuid,
  p_session_id uuid,
  p_claim_version integer,
  p_organization_id uuid,
  p_facility_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.ingest_authorization_runs;
  v_existing boolean;
BEGIN
  PERFORM 1 FROM public.documents AS document
  WHERE document.id = p_document_id
    AND document.workspace_id::text = p_organization_id::text
    AND document.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingest document not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM haven.lock_ingest_service_actor(
    p_actor_id, p_session_id, p_claim_version, p_organization_id, p_facility_id,
    ARRAY['owner','org_admin','facility_admin'], true
  );

  v_existing := EXISTS (
    SELECT 1 FROM public.ingest_authorization_runs WHERE id = p_run_id
  );

  INSERT INTO public.ingest_authorization_runs(
    id, organization_id, facility_id, document_id, actor_user_id, session_id, claim_version
  ) VALUES (
    p_run_id, p_organization_id, p_facility_id, p_document_id, p_actor_id, p_session_id, p_claim_version
  ) ON CONFLICT (id) DO NOTHING;

  SELECT * INTO STRICT v_run
  FROM public.ingest_authorization_runs
  WHERE id = p_run_id;

  IF v_run.organization_id <> p_organization_id OR v_run.document_id <> p_document_id
     OR v_run.actor_user_id <> p_actor_id OR v_run.session_id <> p_session_id
     OR v_run.claim_version <> p_claim_version
     OR v_run.facility_id IS DISTINCT FROM p_facility_id THEN
    RAISE EXCEPTION 'Ingest authorization replay mismatch' USING ERRCODE = '23505';
  END IF;
  IF v_existing AND (
    SELECT current_ingest_run_id FROM public.documents WHERE id = p_document_id
  ) IS DISTINCT FROM p_run_id THEN
    RAISE EXCEPTION 'Ingest run superseded' USING ERRCODE = '40001';
  END IF;
  IF v_run.status = 'processing' THEN
    UPDATE public.documents SET current_ingest_run_id = v_run.id WHERE id = p_document_id;
  END IF;
  RETURN v_run.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_kb_ingest_preflight(
  p_document_id uuid,
  p_actor_id uuid,
  p_session_id uuid,
  p_claim_version integer,
  p_organization_id uuid,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_document public.documents;
  v_error text := pg_catalog.left(
    pg_catalog.coalesce(pg_catalog.nullif(p_error, ''), 'authorization_receipt_failed'),
    200
  );
BEGIN
  SELECT * INTO STRICT v_document
  FROM public.documents AS document
  WHERE document.id = p_document_id
    AND document.workspace_id::text = p_organization_id::text
    AND document.deleted_at IS NULL
  FOR UPDATE;

  PERFORM haven.lock_ingest_service_actor(
    p_actor_id, p_session_id, p_claim_version, p_organization_id, NULL,
    ARRAY['owner','org_admin','facility_admin'], true
  );

  IF v_document.uploaded_by IS DISTINCT FROM p_actor_id
     OR v_document.current_ingest_run_id IS NOT NULL
     OR NOT (v_document.metadata ? 'ingest_target_status') THEN
    RAISE EXCEPTION 'Ingest preflight failure scope mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_document.status = 'ingest_failed' AND v_document.ingest_last_error = v_error THEN
    RETURN;
  END IF;

  UPDATE public.documents
  SET status = 'ingest_failed',
      ingest_attempt_count = pg_catalog.coalesce(ingest_attempt_count, 0) + 1,
      ingest_last_error = v_error,
      ingest_retry_at = NULL,
      updated_at = pg_catalog.now()
  WHERE id = v_document.id;

  INSERT INTO public.document_audit_events(
    actor_user_id, document_id, document_title_snapshot, event_type, metadata
  ) VALUES (
    p_actor_id, v_document.id, v_document.title, 'ingest_failed',
    pg_catalog.jsonb_build_object('phase', 'preflight', 'error_code', v_error)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_kb_ingest_authority_change(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.ingest_authorization_runs;
  v_document public.documents;
BEGIN
  SELECT * INTO STRICT v_run
  FROM public.ingest_authorization_runs WHERE id = p_run_id;
  IF v_run.status = 'authorization_changed' OR v_run.status = 'completed' THEN
    RETURN;
  END IF;

  SELECT * INTO STRICT v_document
  FROM public.documents AS document
  WHERE document.id = v_run.document_id
    AND document.workspace_id::text = v_run.organization_id::text
    AND document.deleted_at IS NULL
  FOR UPDATE;

  SELECT * INTO STRICT v_run
  FROM public.ingest_authorization_runs WHERE id = p_run_id FOR UPDATE;
  IF v_run.status = 'completed' THEN RETURN; END IF;
  IF v_document.current_ingest_run_id IS DISTINCT FROM p_run_id THEN
    UPDATE public.ingest_authorization_runs
    SET status = 'authorization_changed', finished_at = pg_catalog.now(),
        metadata = metadata || '{"reason":"superseded"}'::jsonb
    WHERE id = p_run_id;
    RETURN;
  END IF;

  IF v_run.mutation_started THEN
    DELETE FROM public.chunks AS chunk
    WHERE chunk.document_id = v_document.id
      AND chunk.workspace_id::text = v_run.organization_id::text;
  END IF;

  UPDATE public.documents AS document
  SET status = 'ingest_failed',
      metadata = CASE
        WHEN document.metadata ? 'ingest_target_status'
          OR document.status NOT IN ('draft','pending_review','published')
          THEN document.metadata
        ELSE document.metadata || pg_catalog.jsonb_build_object('ingest_target_status', document.status)
      END,
      ingest_attempt_count = CASE
        WHEN document.status = 'ingest_failed'
         AND document.ingest_last_error = 'authorization_changed'
          THEN pg_catalog.coalesce(document.ingest_attempt_count, 0)
        ELSE pg_catalog.coalesce(document.ingest_attempt_count, 0) + 1
      END,
      ingest_last_error = 'authorization_changed',
      ingest_retry_at = NULL,
      updated_at = pg_catalog.now()
  WHERE document.id = v_document.id;

  UPDATE public.ingest_authorization_runs
  SET status = 'authorization_changed', finished_at = pg_catalog.now(),
      metadata = metadata || '{"reason":"authorization_changed"}'::jsonb
  WHERE id = v_run.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_kb_ingest_generation(
  p_run_id uuid,
  p_chunks jsonb,
  p_summary text,
  p_word_count integer,
  p_markdown jsonb DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.ingest_authorization_runs;
  v_document public.documents;
  v_count integer;
  v_target_status text;
BEGIN
  SELECT * INTO STRICT v_run
  FROM public.ingest_authorization_runs WHERE id = p_run_id;
  SELECT * INTO STRICT v_document
  FROM public.documents
  WHERE id = v_run.document_id
    AND workspace_id::text = v_run.organization_id::text
    AND deleted_at IS NULL
  FOR UPDATE;
  SELECT * INTO STRICT v_run
  FROM public.ingest_authorization_runs WHERE id = p_run_id FOR UPDATE;

  IF v_document.current_ingest_run_id IS DISTINCT FROM p_run_id THEN
    RAISE EXCEPTION 'Ingest run superseded' USING ERRCODE = '40001';
  END IF;
  PERFORM haven.lock_ingest_service_actor(
    v_run.actor_user_id, v_run.session_id, v_run.claim_version,
    v_run.organization_id, v_run.facility_id,
    ARRAY['owner','org_admin','facility_admin'], true
  );
  IF v_run.status = 'completed' THEN
    RETURN (v_run.metadata->>'chunk_count')::integer;
  END IF;
  IF v_run.status <> 'processing' OR pg_catalog.jsonb_typeof(p_chunks) IS DISTINCT FROM 'array'
     OR p_word_count IS NULL OR p_word_count < 0 THEN
    RAISE EXCEPTION 'Invalid ingest completion' USING ERRCODE = '22023';
  END IF;

  v_target_status := v_document.metadata->>'ingest_target_status';
  IF v_target_status IS NOT NULL
     AND v_target_status NOT IN ('draft','pending_review','published') THEN
    RAISE EXCEPTION 'Invalid ingest target status' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_chunks) AS c
    WHERE c->>'document_id' IS DISTINCT FROM v_document.id::text
       OR c->>'workspace_id' IS DISTINCT FROM v_run.organization_id::text
  ) THEN
    RAISE EXCEPTION 'Invalid ingest chunk scope' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_chunks) AS c
    WHERE c->>'parent_chunk_id' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_chunks) AS parent
        WHERE parent->>'id' = c->>'parent_chunk_id'
      )
  ) THEN
    RAISE EXCEPTION 'Invalid ingest parent' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.chunks
  WHERE document_id = v_document.id
    AND workspace_id::text = v_run.organization_id::text;

  INSERT INTO public.chunks(
    id, document_id, workspace_id, chunk_index, content, content_stripped,
    token_count, chunk_type, section_title, parent_chunk_id, embedding,
    redacted_at, redaction_patterns_hit
  )
  SELECT
    c.id, c.document_id, c.workspace_id, c.chunk_index, c.content, c.content_stripped,
    c.token_count, c.chunk_type, c.section_title, c.parent_chunk_id, c.embedding,
    c.redacted_at, c.redaction_patterns_hit
  FROM pg_catalog.jsonb_populate_recordset(NULL::public.chunks, p_chunks) AS c;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.documents AS document
  SET summary = p_summary,
      word_count = p_word_count,
      markdown_text = CASE WHEN p_markdown IS NULL THEN document.markdown_text ELSE p_markdown->>'markdown_text' END,
      raw_text = CASE WHEN p_markdown IS NULL THEN document.raw_text ELSE p_markdown->>'raw_text' END,
      conversion_method = CASE WHEN p_markdown IS NULL THEN document.conversion_method ELSE p_markdown->>'conversion_method' END,
      status = pg_catalog.coalesce(v_target_status, document.status),
      metadata = document.metadata - 'ingest_target_status',
      ingest_last_error = NULL,
      ingest_retry_at = NULL,
      updated_at = pg_catalog.now()
  WHERE id = v_document.id;

  INSERT INTO public.document_audit_events(
    actor_user_id, document_id, document_title_snapshot, event_type, metadata
  ) VALUES (
    v_run.actor_user_id, v_document.id, v_document.title, 'ingest_completed',
    pg_catalog.jsonb_build_object(
      'authorization_run_id', p_run_id,
      'chunk_count', v_count,
      'published_status', pg_catalog.coalesce(v_target_status, v_document.status)
    )
  );
  UPDATE public.ingest_authorization_runs
  SET status = 'completed', mutation_started = true, finished_at = pg_catalog.now(),
      metadata = metadata || pg_catalog.jsonb_build_object('chunk_count', v_count)
  WHERE id = p_run_id;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_kb_ingest_generation(p_run_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.ingest_authorization_runs;
  v_doc public.documents;
  v_attempt integer;
BEGIN
  SELECT * INTO STRICT v_run
  FROM public.ingest_authorization_runs WHERE id = p_run_id;
  SELECT * INTO STRICT v_doc
  FROM public.documents
  WHERE id = v_run.document_id
    AND workspace_id::text = v_run.organization_id::text
  FOR UPDATE;
  SELECT * INTO STRICT v_run
  FROM public.ingest_authorization_runs WHERE id = p_run_id FOR UPDATE;

  IF v_run.status IN ('completed','failed','authorization_changed') THEN RETURN; END IF;
  IF v_doc.current_ingest_run_id IS DISTINCT FROM p_run_id THEN
    UPDATE public.ingest_authorization_runs
    SET status = 'failed', finished_at = pg_catalog.now(),
        metadata = metadata || '{"reason":"superseded"}'::jsonb
    WHERE id = p_run_id;
    RETURN;
  END IF;

  PERFORM haven.lock_ingest_service_actor(
    v_run.actor_user_id, v_run.session_id, v_run.claim_version,
    v_run.organization_id, v_run.facility_id,
    ARRAY['owner','org_admin','facility_admin'], true
  );
  v_attempt := pg_catalog.coalesce(v_doc.ingest_attempt_count, 0) + 1;

  UPDATE public.documents AS document
  SET status = 'ingest_failed',
      metadata = CASE
        WHEN document.metadata ? 'ingest_target_status'
          OR document.status NOT IN ('draft','pending_review','published')
          THEN document.metadata
        ELSE document.metadata || pg_catalog.jsonb_build_object('ingest_target_status', document.status)
      END,
      ingest_attempt_count = v_attempt,
      ingest_last_error = pg_catalog.left(pg_catalog.coalesce(p_error, 'ingest_processing_failed'), 200),
      ingest_retry_at = NULL,
      updated_at = pg_catalog.now()
  WHERE id = v_doc.id;

  IF v_attempt < pg_catalog.coalesce(v_doc.ingest_max_attempts, 3) THEN
    PERFORM public._kb_ingest_request_retry(v_doc.id, v_run.organization_id);
  END IF;
  INSERT INTO public.document_audit_events(
    actor_user_id, document_id, document_title_snapshot, event_type, metadata
  ) VALUES (
    v_run.actor_user_id, v_doc.id, v_doc.title, 'ingest_failed',
    pg_catalog.jsonb_build_object('authorization_run_id', p_run_id, 'attempt', v_attempt)
  );
  UPDATE public.ingest_authorization_runs
  SET status = 'failed', finished_at = pg_catalog.now()
  WHERE id = p_run_id;
END;
$function$;

CREATE OR REPLACE FUNCTION haven.guard_document_ingest_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status = 'published' AND NEW.metadata ? 'ingest_target_status' THEN
    RAISE EXCEPTION 'Document indexing is not complete' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_document_ingest_publication ON public.documents;
CREATE TRIGGER guard_document_ingest_publication
BEFORE INSERT OR UPDATE OF status, metadata ON public.documents
FOR EACH ROW EXECUTE FUNCTION haven.guard_document_ingest_publication();

REVOKE ALL ON FUNCTION public.create_kb_ingest_authorization_run(uuid,uuid,uuid,uuid,integer,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_kb_ingest_authorization_run(uuid,uuid,uuid,uuid,integer,uuid,uuid)
  TO service_role;
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
REVOKE ALL ON FUNCTION haven.guard_document_ingest_publication()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.fail_kb_ingest_preflight(uuid,uuid,uuid,integer,uuid,text) IS
  'Marks a newly stored, non-live KB document failed when its authorization run could not be created.';
COMMENT ON FUNCTION haven.guard_document_ingest_publication() IS
  'Prevents a document with an outstanding ingest target from becoming live before its atomic generation commit.';

-- Rollback: deploy the prior Edge Function first, then restore the migration 328
-- function definitions and drop guard_document_ingest_publication. Retain failure
-- audit rows and originals; never delete a document or storage object to roll back.
