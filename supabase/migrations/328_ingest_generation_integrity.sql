-- Fence all ingest mutation and cleanup by the current document generation.
-- Replacement chunks, summary and semantic completion receipt commit together.
ALTER TABLE public.documents ADD COLUMN current_ingest_run_id uuid REFERENCES public.ingest_authorization_runs(id);
-- Lookup follows documents PK and runs PK; no additional index is required.
CREATE OR REPLACE FUNCTION haven.lock_ingest_service_actor(
  p_actor_id uuid,
  p_session_id uuid,
  p_claim_version integer,
  p_organization_id uuid,
  p_facility_id uuid,
  p_allowed_roles text[],
  p_allow_organization_wide boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
BEGIN
  SELECT profile.app_role::text INTO v_role
  FROM public.user_profiles AS profile
  JOIN auth.users AS auth_user ON auth_user.id = profile.id
  JOIN auth.sessions AS session
    ON session.id = p_session_id AND session.user_id = profile.id
  WHERE profile.id = p_actor_id
    AND profile.organization_id = p_organization_id
    AND profile.auth_claim_version = p_claim_version
    AND profile.is_active
    AND profile.deleted_at IS NULL
    AND auth_user.deleted_at IS NULL
    AND (auth_user.banned_until IS NULL OR auth_user.banned_until <= pg_catalog.now())
  FOR SHARE OF profile,auth_user,session;
  IF v_role IS NULL OR NOT (v_role = ANY(p_allowed_roles)) THEN
    RAISE EXCEPTION 'Edge actor is no longer authorized' USING ERRCODE = '42501';
  END IF;

  IF p_facility_id IS NOT NULL THEN
    PERFORM 1 FROM public.facilities WHERE id=p_facility_id AND organization_id=p_organization_id AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ingest facility unavailable' USING ERRCODE='42501'; END IF;
    IF v_role NOT IN ('owner','org_admin') THEN
      PERFORM 1 FROM public.user_facility_access WHERE user_id=p_actor_id AND facility_id=p_facility_id
        AND organization_id=p_organization_id AND revoked_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Ingest grant unavailable' USING ERRCODE='42501'; END IF;
    END IF;
  END IF;
  IF p_facility_id IS NULL THEN
    IF NOT p_allow_organization_wide THEN
      RAISE EXCEPTION 'Edge actor facility is no longer authorized' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.facilities AS facility
    WHERE facility.id = p_facility_id
      AND facility.organization_id = p_organization_id
      AND facility.deleted_at IS NULL
      AND (
        v_role IN ('owner', 'org_admin')
        OR EXISTS (
          SELECT 1 FROM public.user_facility_access AS access
          WHERE access.user_id = p_actor_id
            AND access.organization_id = p_organization_id
            AND access.facility_id = facility.id
            AND access.revoked_at IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'Edge actor facility is no longer authorized' USING ERRCODE = '42501';
  END IF;
  RETURN v_role;
END;
$function$;
REVOKE ALL ON FUNCTION haven.lock_ingest_service_actor(uuid,uuid,integer,uuid,uuid,text[],boolean) FROM PUBLIC,anon,authenticated,service_role;

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
    WHERE document.id=p_document_id AND document.workspace_id=p_organization_id
      AND document.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ingest document not found' USING ERRCODE='P0002'; END IF;
  PERFORM haven.lock_ingest_service_actor(
    p_actor_id,p_session_id,p_claim_version,p_organization_id,p_facility_id,
    ARRAY['owner','org_admin','facility_admin'],true
  );


  v_existing:=EXISTS(SELECT 1 FROM public.ingest_authorization_runs WHERE id=p_run_id);

  INSERT INTO public.ingest_authorization_runs(
    id,organization_id,facility_id,document_id,actor_user_id,session_id,claim_version
  ) VALUES (
    p_run_id,p_organization_id,p_facility_id,p_document_id,p_actor_id,p_session_id,p_claim_version
  ) ON CONFLICT (id) DO NOTHING;

  SELECT * INTO STRICT v_run FROM public.ingest_authorization_runs WHERE id=p_run_id;
  IF v_run.organization_id<>p_organization_id OR v_run.document_id<>p_document_id
     OR v_run.actor_user_id<>p_actor_id OR v_run.session_id<>p_session_id
     OR v_run.claim_version<>p_claim_version
     OR v_run.facility_id IS DISTINCT FROM p_facility_id THEN
    RAISE EXCEPTION 'Ingest authorization replay mismatch' USING ERRCODE='23505';
  END IF;
  IF v_existing AND (SELECT current_ingest_run_id FROM public.documents WHERE id=p_document_id) IS DISTINCT FROM p_run_id THEN
    RAISE EXCEPTION 'Ingest run superseded' USING ERRCODE='40001';
  END IF;
  IF v_run.status='processing' THEN
    UPDATE public.documents SET current_ingest_run_id=v_run.id WHERE id=p_document_id;
  END IF;
  RETURN v_run.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_kb_ingest_authorization_mutation(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.ingest_authorization_runs;
BEGIN
  SELECT * INTO STRICT v_run FROM public.ingest_authorization_runs WHERE id=p_run_id;
  PERFORM 1 FROM public.documents WHERE id=v_run.document_id AND current_ingest_run_id=p_run_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ingest run superseded' USING ERRCODE='40001'; END IF;
  SELECT * INTO STRICT v_run FROM public.ingest_authorization_runs WHERE id=p_run_id FOR UPDATE;
  IF v_run.status<>'processing' THEN
    RAISE EXCEPTION 'Ingest authorization run is not active' USING ERRCODE='55000';
  END IF;
  PERFORM haven.lock_ingest_service_actor(
    v_run.actor_user_id,v_run.session_id,v_run.claim_version,v_run.organization_id,v_run.facility_id,
    ARRAY['owner','org_admin','facility_admin'],true
  );
  UPDATE public.ingest_authorization_runs SET mutation_started=true WHERE id=v_run.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_kb_ingest_authorization_run(
  p_run_id uuid,
  p_status text DEFAULT 'completed'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.ingest_authorization_runs;
BEGIN
  IF p_status NOT IN ('completed','failed') THEN
    RAISE EXCEPTION 'Invalid ingest authorization terminal status' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT v_run FROM public.ingest_authorization_runs WHERE id=p_run_id;
  PERFORM 1 FROM public.documents WHERE id=v_run.document_id AND current_ingest_run_id=p_run_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ingest run superseded' USING ERRCODE='40001'; END IF;
  SELECT * INTO STRICT v_run FROM public.ingest_authorization_runs WHERE id=p_run_id FOR UPDATE;
  PERFORM 1 FROM public.ingest_authorization_runs WHERE id=p_run_id FOR UPDATE;
  IF v_run.status=p_status THEN RETURN; END IF;
  IF v_run.status<>'processing' THEN
    RAISE EXCEPTION 'Ingest authorization run is not completable' USING ERRCODE='55000';
  END IF;
  PERFORM haven.lock_ingest_service_actor(
    v_run.actor_user_id,v_run.session_id,v_run.claim_version,v_run.organization_id,v_run.facility_id,
    ARRAY['owner','org_admin','facility_admin'],true
  );
  UPDATE public.ingest_authorization_runs
  SET status=p_status,finished_at=pg_catalog.now() WHERE id=v_run.id;
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
  FROM public.ingest_authorization_runs WHERE id=p_run_id;
  IF v_run.status='authorization_changed' THEN RETURN; END IF;
  IF v_run.status='completed' THEN RETURN; END IF;

  SELECT * INTO STRICT v_document
  FROM public.documents AS document
  WHERE document.id = v_run.document_id
    AND document.workspace_id = v_run.organization_id
    AND document.deleted_at IS NULL
  FOR UPDATE;

  SELECT * INTO STRICT v_run FROM public.ingest_authorization_runs WHERE id=p_run_id FOR UPDATE;
  IF v_run.status='completed' THEN RETURN; END IF;
  IF v_document.current_ingest_run_id IS DISTINCT FROM p_run_id THEN
    UPDATE public.ingest_authorization_runs SET status='authorization_changed',finished_at=now(),
      metadata=metadata||'{"reason":"superseded"}'::jsonb WHERE id=p_run_id;
    RETURN;
  END IF;

  IF v_run.mutation_started THEN
    DELETE FROM public.chunks AS chunk
    WHERE chunk.document_id = v_document.id
      AND chunk.workspace_id = v_run.organization_id;
  END IF;

  UPDATE public.documents AS document
  SET status = 'ingest_failed',
      ingest_attempt_count = CASE
        WHEN document.status = 'ingest_failed'
         AND document.ingest_last_error = 'authorization_changed'
          THEN COALESCE(document.ingest_attempt_count, 0)
        ELSE COALESCE(document.ingest_attempt_count, 0) + 1
      END,
      ingest_last_error = 'authorization_changed',
      ingest_retry_at = NULL,
      updated_at = pg_catalog.now()
  WHERE document.id = v_document.id;
  UPDATE public.ingest_authorization_runs
  SET status='authorization_changed',finished_at=pg_catalog.now(),
      metadata=metadata||'{"reason":"authorization_changed"}'::jsonb
  WHERE id=v_run.id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.commit_kb_ingest_generation(
  p_run_id uuid, p_chunks jsonb, p_summary text, p_word_count integer,
  p_markdown jsonb DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_run public.ingest_authorization_runs; v_document public.documents; v_count integer;
BEGIN
  SELECT * INTO STRICT v_run FROM public.ingest_authorization_runs WHERE id=p_run_id;
  SELECT * INTO STRICT v_document FROM public.documents WHERE id=v_run.document_id
    AND workspace_id=v_run.organization_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO STRICT v_run FROM public.ingest_authorization_runs WHERE id=p_run_id FOR UPDATE;
  IF v_document.current_ingest_run_id IS DISTINCT FROM p_run_id THEN
    RAISE EXCEPTION 'Ingest run superseded' USING ERRCODE='40001';
  END IF;
  PERFORM haven.lock_ingest_service_actor(v_run.actor_user_id,v_run.session_id,v_run.claim_version,
    v_run.organization_id,v_run.facility_id,ARRAY['owner','org_admin','facility_admin'],true);
  IF v_run.status='completed' THEN
    RETURN (v_run.metadata->>'chunk_count')::integer;
  END IF;
  IF v_run.status<>'processing' OR jsonb_typeof(p_chunks) IS DISTINCT FROM 'array'
    OR p_word_count IS NULL OR p_word_count<0 THEN
    RAISE EXCEPTION 'Invalid ingest completion' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_chunks) AS c
    WHERE c->>'document_id' IS DISTINCT FROM v_document.id::text
      OR c->>'workspace_id' IS DISTINCT FROM v_run.organization_id::text) THEN
    RAISE EXCEPTION 'Invalid ingest chunk scope' USING ERRCODE='42501';
  END IF;
  -- Every child parent must belong to this same replacement payload.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_chunks) AS c
    WHERE c->>'parent_chunk_id' IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_chunks) AS parent
      WHERE parent->>'id'=c->>'parent_chunk_id')) THEN
    RAISE EXCEPTION 'Invalid ingest parent' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.chunks WHERE document_id=v_document.id AND workspace_id=v_run.organization_id;
  INSERT INTO public.chunks(id,document_id,workspace_id,chunk_index,content,content_stripped,
    token_count,chunk_type,section_title,parent_chunk_id,embedding,redacted_at,redaction_patterns_hit)
  SELECT c.id,c.document_id,c.workspace_id,c.chunk_index,c.content,c.content_stripped,
    c.token_count,c.chunk_type,c.section_title,c.parent_chunk_id,c.embedding,c.redacted_at,c.redaction_patterns_hit
  FROM jsonb_populate_recordset(NULL::public.chunks,p_chunks) AS c;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE public.documents SET summary=p_summary,word_count=p_word_count,
    markdown_text=CASE WHEN p_markdown IS NULL THEN markdown_text ELSE p_markdown->>'markdown_text' END,
    raw_text=CASE WHEN p_markdown IS NULL THEN raw_text ELSE p_markdown->>'raw_text' END,
    conversion_method=CASE WHEN p_markdown IS NULL THEN conversion_method ELSE p_markdown->>'conversion_method' END,
    updated_at=now() WHERE id=v_document.id;
  INSERT INTO public.document_audit_events(actor_user_id,document_id,document_title_snapshot,event_type,metadata)
    VALUES(v_run.actor_user_id,v_document.id,v_document.title,'ingest_completed',
      jsonb_build_object('authorization_run_id',p_run_id,'chunk_count',v_count));
  UPDATE public.ingest_authorization_runs SET status='completed',mutation_started=true,finished_at=now(),
    metadata=metadata||jsonb_build_object('chunk_count',v_count) WHERE id=p_run_id;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.commit_kb_ingest_generation(uuid,jsonb,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_kb_ingest_generation(uuid,jsonb,text,integer,jsonb) TO service_role;

-- Rollback: restore matched application first. Retain generation receipts and column
-- for audit; never revert cleanup to document-wide deletion of another run's output.
-- Emergency rollback can revoke execution of commit_kb_ingest_generation to pause ingestion.

CREATE OR REPLACE FUNCTION public.fail_kb_ingest_generation(p_run_id uuid,p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_run public.ingest_authorization_runs; v_doc public.documents; v_attempt integer;
BEGIN
  SELECT * INTO STRICT v_run FROM public.ingest_authorization_runs WHERE id=p_run_id;
  SELECT * INTO STRICT v_doc FROM public.documents WHERE id=v_run.document_id FOR UPDATE;
  SELECT * INTO STRICT v_run FROM public.ingest_authorization_runs WHERE id=p_run_id FOR UPDATE;
  IF v_run.status IN ('completed','failed','authorization_changed') THEN RETURN; END IF;
  IF v_doc.current_ingest_run_id IS DISTINCT FROM p_run_id THEN
    UPDATE public.ingest_authorization_runs SET status='failed',finished_at=now(),metadata=metadata||'{"reason":"superseded"}'::jsonb WHERE id=p_run_id;
    RETURN;
  END IF;
  PERFORM haven.lock_ingest_service_actor(v_run.actor_user_id,v_run.session_id,v_run.claim_version,
    v_run.organization_id,v_run.facility_id,ARRAY['owner','org_admin','facility_admin'],true);
  v_attempt:=coalesce(v_doc.ingest_attempt_count,0)+1;
  UPDATE public.documents SET status='ingest_failed',ingest_attempt_count=v_attempt,
    ingest_last_error=left(coalesce(p_error,'ingest_processing_failed'),200),
    ingest_retry_at=NULL,updated_at=now() WHERE id=v_doc.id;
  IF v_attempt<coalesce(v_doc.ingest_max_attempts,3) THEN
    PERFORM public._kb_ingest_request_retry(v_doc.id,v_run.organization_id);
  END IF;
  INSERT INTO public.document_audit_events(actor_user_id,document_id,document_title_snapshot,event_type,metadata)
    VALUES(v_run.actor_user_id,v_doc.id,v_doc.title,'ingest_failed',jsonb_build_object('authorization_run_id',p_run_id,'attempt',v_attempt));
  UPDATE public.ingest_authorization_runs SET status='failed',finished_at=now() WHERE id=p_run_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.fail_kb_ingest_generation(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_kb_ingest_generation(uuid,text) TO service_role;

CREATE FUNCTION haven.guard_document_ingest_generation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF current_user IN ('anon','authenticated') AND NEW.current_ingest_run_id IS DISTINCT FROM OLD.current_ingest_run_id THEN
    RAISE EXCEPTION 'Ingest ownership is service-managed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_document_ingest_generation BEFORE UPDATE OF current_ingest_run_id ON public.documents
  FOR EACH ROW EXECUTE FUNCTION haven.guard_document_ingest_generation();
REVOKE ALL ON FUNCTION haven.guard_document_ingest_generation() FROM PUBLIC,anon,authenticated;
