-- Knowledge Base (KB) Phase 1 — schema + RPCs for Edge Functions (ingest, knowledge-agent, document-admin).
-- workspace_id maps to organizations.id. Service-role Edge Functions bypass RLS.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Core tables (names match Edge Function PostgREST targets)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  workspace_id uuid NOT NULL REFERENCES organizations (id),
  title text NOT NULL,
  source text NOT NULL DEFAULT 'manual_upload',
  mime_type text,
  raw_text text,
  audience text NOT NULL DEFAULT 'company_wide',
  status text NOT NULL DEFAULT 'published',
  uploaded_by uuid REFERENCES auth.users (id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  word_count integer,
  classification_updated_by uuid REFERENCES auth.users (id),
  classification_updated_at timestamptz,
  review_owner uuid REFERENCES auth.users (id),
  review_due_at timestamptz,
  approved_by uuid REFERENCES auth.users (id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_kb_documents_workspace ON public.documents (workspace_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_kb_documents_status ON public.documents (workspace_id, status)
WHERE
  deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  document_id uuid NOT NULL REFERENCES public.documents (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES organizations (id),
  chunk_index integer NOT NULL,
  content text NOT NULL,
  content_stripped text,
  token_count integer,
  chunk_type text NOT NULL,
  section_title text,
  parent_chunk_id uuid REFERENCES public.chunks (id) ON DELETE SET NULL,
  embedding vector (1536)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_chunks_doc_index ON public.chunks (document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_workspace ON public.chunks (workspace_id);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON public.chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_fts ON public.chunks USING gin (to_tsvector('english', coalesce(content_stripped, content)));

CREATE TABLE IF NOT EXISTS public.knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  workspace_id uuid NOT NULL REFERENCES organizations (id),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  question text NOT NULL,
  trace_id uuid,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_workspace ON public.knowledge_gaps (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  workspace_id uuid NOT NULL REFERENCES organizations (id),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  title text,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX IF NOT EXISTS idx_kb_chat_conv_user ON public.chat_conversations (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES organizations (id),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  role text NOT NULL,
  content text NOT NULL,
  sources jsonb,
  classifier_output jsonb,
  tokens_in integer,
  tokens_out integer,
  model text,
  trace_id uuid,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX IF NOT EXISTS idx_kb_chat_messages_conv ON public.chat_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS public.document_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  actor_user_id uuid NOT NULL REFERENCES auth.users (id),
  document_id uuid NOT NULL REFERENCES public.documents (id),
  document_title_snapshot text,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX IF NOT EXISTS idx_document_audit_doc ON public.document_audit_events (document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.usage_counters (
  user_id uuid NOT NULL REFERENCES auth.users (id),
  workspace_id uuid NOT NULL REFERENCES organizations (id),
  tokens_in bigint NOT NULL DEFAULT 0,
  tokens_out bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now (),
  PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS public.kb_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  workspace_id uuid REFERENCES organizations (id),
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now (),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.kb_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  workspace_id uuid NOT NULL REFERENCES organizations (id),
  event_type text NOT NULL,
  user_id uuid REFERENCES auth.users (id),
  document_id uuid REFERENCES public.documents (id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX IF NOT EXISTS idx_kb_analytics_workspace ON public.kb_analytics_events (workspace_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.document_role_can_view_audience (
  p_audience text,
  p_user_role text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  AS $func$
  SELECT
    CASE WHEN p_audience IS NULL OR p_audience = 'company_wide' THEN
      TRUE
    WHEN p_audience = 'facility_scoped' THEN
      p_user_role IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver', 'dietary', 'maintenance_role')
    ELSE
      TRUE
    END;

$func$;

CREATE OR REPLACE FUNCTION public.retrieve_evidence (
  query_embedding text,
  keyword_query text,
  user_role text,
  match_count integer DEFAULT 8,
  semantic_threshold float DEFAULT 0.45,
  p_workspace_id uuid DEFAULT NULL
)
  RETURNS TABLE (
    source_title text,
    excerpt text,
    confidence float,
    section_title text,
    chunk_id uuid,
    document_id uuid
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
DECLARE
  qvec vector (1536);
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN;
  END IF;
  IF query_embedding IS NOT NULL AND length(trim(query_embedding)) > 0 THEN
    BEGIN
      qvec := trim(query_embedding)::vector;
    EXCEPTION
      WHEN OTHERS THEN
        qvec := NULL;
    END;
  END IF;
  IF qvec IS NOT NULL THEN
    RETURN QUERY
    SELECT
      d.title::text,
      left(c.content, 800)::text,
      (1::float - (c.embedding <=> qvec))::float,
      c.section_title::text,
      c.id,
      d.id
    FROM
      public.chunks c
      INNER JOIN public.documents d ON d.id = c.document_id
        AND d.deleted_at IS NULL
        AND d.workspace_id = p_workspace_id
    WHERE
      public.document_role_can_view_audience (d.audience, user_role)
      AND (d.status = 'published'
        OR (d.status = 'pending_review'
          AND user_role IN ('owner', 'org_admin', 'facility_admin')))
      AND (1::float - (c.embedding <=> qvec)) >= semantic_threshold
    ORDER BY
      c.embedding <=> qvec
    LIMIT match_count;
    RETURN;
  END IF;
  IF keyword_query IS NOT NULL AND length(trim(keyword_query)) > 0 THEN
    RETURN QUERY
    SELECT
      d.title::text,
      left(c.content, 800)::text,
      0.55::float,
      c.section_title::text,
      c.id,
      d.id
    FROM
      public.chunks c
      INNER JOIN public.documents d ON d.id = c.document_id
        AND d.deleted_at IS NULL
        AND d.workspace_id = p_workspace_id
    WHERE
      public.document_role_can_view_audience (d.audience, user_role)
      AND (d.status = 'published'
        OR (d.status = 'pending_review'
          AND user_role IN ('owner', 'org_admin', 'facility_admin')))
      AND to_tsvector('english', coalesce(c.content_stripped, c.content)) @@ plainto_tsquery('english', trim(keyword_query))
    ORDER BY
      c.chunk_index
    LIMIT match_count;
  END IF;
END;
$func$;

CREATE OR REPLACE FUNCTION public.log_knowledge_gap (
  p_workspace_id uuid,
  p_user_id uuid,
  p_question text,
  p_trace_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
BEGIN
  INSERT INTO public.knowledge_gaps (workspace_id, user_id, question, trace_id)
    VALUES (p_workspace_id, p_user_id, p_question, p_trace_id);
END;
$func$;

CREATE OR REPLACE FUNCTION public.increment_usage (
  p_user_id uuid,
  p_workspace_id uuid,
  p_tokens_in bigint,
  p_tokens_out bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
BEGIN
  INSERT INTO public.usage_counters (user_id, workspace_id, tokens_in, tokens_out, updated_at)
    VALUES (p_user_id, p_workspace_id, coalesce(p_tokens_in, 0), coalesce(p_tokens_out, 0), now())
  ON CONFLICT (user_id, workspace_id)
    DO UPDATE SET
      tokens_in = public.usage_counters.tokens_in + coalesce(p_tokens_in, 0),
      tokens_out = public.usage_counters.tokens_out + coalesce(p_tokens_out, 0),
      updated_at = now();
END;
$func$;

GRANT EXECUTE ON FUNCTION public.retrieve_evidence (text, text, text, integer, float, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.retrieve_evidence (text, text, text, integer, float, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.log_knowledge_gap (uuid, uuid, text, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.log_knowledge_gap (uuid, uuid, text, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.increment_usage (uuid, uuid, bigint, bigint) TO service_role;

GRANT EXECUTE ON FUNCTION public.increment_usage (uuid, uuid, bigint, bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.document_role_can_view_audience (text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.document_role_can_view_audience (text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.knowledge_gaps ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.document_audit_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kb_job_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kb_analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kb_documents_org_rw ON public.documents;

CREATE POLICY kb_documents_org_rw ON public.documents
  FOR ALL
  TO authenticated
  USING (workspace_id = haven.organization_id ())
  WITH CHECK (workspace_id = haven.organization_id ());

DROP POLICY IF EXISTS kb_chunks_org_rw ON public.chunks;

CREATE POLICY kb_chunks_org_rw ON public.chunks
  FOR ALL
  TO authenticated
  USING (workspace_id = haven.organization_id ())
  WITH CHECK (workspace_id = haven.organization_id ());

DROP POLICY IF EXISTS knowledge_gaps_org_rw ON public.knowledge_gaps;

CREATE POLICY knowledge_gaps_org_rw ON public.knowledge_gaps
  FOR ALL
  TO authenticated
  USING (workspace_id = haven.organization_id ())
  WITH CHECK (workspace_id = haven.organization_id ());

DROP POLICY IF EXISTS kb_chat_conv_org_rw ON public.chat_conversations;

CREATE POLICY kb_chat_conv_org_rw ON public.chat_conversations
  FOR ALL
  TO authenticated
  USING (workspace_id = haven.organization_id ()
    AND user_id = auth.uid ())
  WITH CHECK (workspace_id = haven.organization_id ()
    AND user_id = auth.uid ());

DROP POLICY IF EXISTS kb_chat_msg_org_rw ON public.chat_messages;

CREATE POLICY kb_chat_msg_org_rw ON public.chat_messages
  FOR ALL
  TO authenticated
  USING (workspace_id = haven.organization_id ()
    AND user_id = auth.uid ())
  WITH CHECK (workspace_id = haven.organization_id ()
    AND user_id = auth.uid ());

DROP POLICY IF EXISTS document_audit_events_org_rw ON public.document_audit_events;

CREATE POLICY document_audit_events_org_rw ON public.document_audit_events
  FOR ALL
  TO authenticated
  USING (EXISTS (
      SELECT
        1
      FROM
        public.documents d
      WHERE
        d.id = document_audit_events.document_id
        AND d.workspace_id = haven.organization_id ()))
  WITH CHECK (EXISTS (
      SELECT
        1
      FROM
        public.documents d
      WHERE
        d.id = document_audit_events.document_id
        AND d.workspace_id = haven.organization_id ()));

DROP POLICY IF EXISTS usage_counters_self_org ON public.usage_counters;

CREATE POLICY usage_counters_self_org ON public.usage_counters
  FOR ALL
  TO authenticated
  USING (workspace_id = haven.organization_id ()
    AND user_id = auth.uid ())
  WITH CHECK (workspace_id = haven.organization_id ()
    AND user_id = auth.uid ());

DROP POLICY IF EXISTS kb_job_runs_org_rw ON public.kb_job_runs;

CREATE POLICY kb_job_runs_org_rw ON public.kb_job_runs
  FOR ALL
  TO authenticated
  USING (workspace_id IS NULL
    OR workspace_id = haven.organization_id ())
  WITH CHECK (workspace_id IS NULL
    OR workspace_id = haven.organization_id ());

DROP POLICY IF EXISTS kb_analytics_org_rw ON public.kb_analytics_events;

CREATE POLICY kb_analytics_org_rw ON public.kb_analytics_events
  FOR ALL
  TO authenticated
  USING (workspace_id = haven.organization_id ())
  WITH CHECK (workspace_id = haven.organization_id ());

-- ---------------------------------------------------------------------------
-- Storage: bucket `documents` for KB uploads (path: kb/{org_id}/...)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
  VALUES ('documents', 'documents', FALSE)
ON CONFLICT (id)
  DO UPDATE SET
    public = EXCLUDED.public;

DROP POLICY IF EXISTS kb_documents_storage_read ON storage.objects;

CREATE POLICY kb_documents_storage_read ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND split_part(name, '/', 1) = 'kb'
    AND split_part(name, '/', 2) = haven.organization_id ()::text);

DROP POLICY IF EXISTS kb_documents_storage_write ON storage.objects;

CREATE POLICY kb_documents_storage_write ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND split_part(name, '/', 1) = 'kb'
    AND split_part(name, '/', 2) = haven.organization_id ()::text
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

DROP POLICY IF EXISTS kb_documents_storage_update ON storage.objects;

CREATE POLICY kb_documents_storage_update ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND split_part(name, '/', 1) = 'kb'
    AND split_part(name, '/', 2) = haven.organization_id ()::text)
  WITH CHECK (
    bucket_id = 'documents'
    AND split_part(name, '/', 1) = 'kb'
    AND split_part(name, '/', 2) = haven.organization_id ()::text);

DROP POLICY IF EXISTS kb_documents_storage_delete ON storage.objects;

CREATE POLICY kb_documents_storage_delete ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND split_part(name, '/', 1) = 'kb'
    AND split_part(name, '/', 2) = haven.organization_id ()::text
    AND haven.app_role () IN ('owner', 'org_admin'));

COMMENT ON TABLE public.documents IS 'Knowledge base documents; workspace_id = organization_id.';
