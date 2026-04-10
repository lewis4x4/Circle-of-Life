-- KB remediation: PostgREST callers cannot invoke SECURITY DEFINER KB RPCs with forged tenant args.
-- Only service_role (Edge Functions after JWT verification) retains EXECUTE.
-- Optional column alignment for greenfield 126 vs richer production; non-destructive.

-- ---------------------------------------------------------------------------
-- Optional columns (IF NOT EXISTS)
-- ---------------------------------------------------------------------------

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS source_url text;

ALTER TABLE public.chunks
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now (),
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS page_number integer;

-- Richer knowledge_gaps workflow (matches generated types where missing)
ALTER TABLE public.knowledge_gaps
  ADD COLUMN IF NOT EXISTS frequency integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_asked_at timestamptz NOT NULL DEFAULT now (),
  ADD COLUMN IF NOT EXISTS question_normalized text,
  ADD COLUMN IF NOT EXISTS resolution_document_id uuid REFERENCES public.documents (id),
  ADD COLUMN IF NOT EXISTS resolved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users (id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now ();

-- ---------------------------------------------------------------------------
-- retrieve_evidence: if semantic search returns zero rows, fall back to keyword (same params)
-- ---------------------------------------------------------------------------

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
    WITH sem AS (
      SELECT
        d.title::text AS stitle,
        left(c.content, 800)::text AS ex,
        (1::float - (c.embedding <=> qvec))::float AS conf,
        c.section_title::text AS sect,
        c.id AS cid,
        d.id AS did
      FROM
        public.chunks c
        INNER JOIN public.documents d ON d.id = c.document_id
          AND d.deleted_at IS NULL
          AND d.workspace_id::uuid = p_workspace_id
      WHERE
        public.document_role_can_view_audience (d.audience, user_role)
        AND (d.status = 'published'
          OR (d.status = 'pending_review'
            AND user_role IN ('owner', 'org_admin', 'facility_admin')))
        AND (1::float - (c.embedding <=> qvec)) >= semantic_threshold
      ORDER BY
        c.embedding <=> qvec
      LIMIT match_count
    ),
    kw AS (
      SELECT
        d.title::text AS stitle,
        left(c.content, 800)::text AS ex,
        0.55::float AS conf,
        c.section_title::text AS sect,
        c.id AS cid,
        d.id AS did
      FROM
        public.chunks c
        INNER JOIN public.documents d ON d.id = c.document_id
          AND d.deleted_at IS NULL
          AND d.workspace_id::uuid = p_workspace_id
      WHERE
        public.document_role_can_view_audience (d.audience, user_role)
        AND (d.status = 'published'
          OR (d.status = 'pending_review'
            AND user_role IN ('owner', 'org_admin', 'facility_admin')))
        AND keyword_query IS NOT NULL
        AND length(trim(keyword_query)) > 0
        AND to_tsvector('english', coalesce(c.content_stripped, c.content)) @@ plainto_tsquery('english', trim(keyword_query))
      ORDER BY
        c.chunk_index
      LIMIT match_count
    )
    SELECT
      sem.stitle,
      sem.ex,
      sem.conf,
      sem.sect,
      sem.cid,
      sem.did
    FROM
      sem
    UNION ALL
    SELECT
      kw.stitle,
      kw.ex,
      kw.conf,
      kw.sect,
      kw.cid,
      kw.did
    FROM
      kw
    WHERE
      NOT EXISTS (
        SELECT
          1
        FROM
          sem)
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
        AND d.workspace_id::uuid = p_workspace_id
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

-- ---------------------------------------------------------------------------
-- Grants: KB RPCs callable only via service_role (Edge Functions), not direct PostgREST
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.retrieve_evidence (text, text, text, integer, float, uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.retrieve_evidence (text, text, text, integer, float, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.retrieve_evidence (text, text, text, integer, float, uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.retrieve_evidence (text, text, text, integer, float, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.log_knowledge_gap (uuid, uuid, text, uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.log_knowledge_gap (uuid, uuid, text, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.log_knowledge_gap (uuid, uuid, text, uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.log_knowledge_gap (uuid, uuid, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.increment_usage (uuid, uuid, bigint, bigint) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.increment_usage (uuid, uuid, bigint, bigint) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_usage (uuid, uuid, bigint, bigint) FROM anon;

GRANT EXECUTE ON FUNCTION public.increment_usage (uuid, uuid, bigint, bigint) TO service_role;

REVOKE ALL ON FUNCTION public.document_role_can_view_audience (text, text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.document_role_can_view_audience (text, text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.document_role_can_view_audience (text, text) FROM anon;

GRANT EXECUTE ON FUNCTION public.document_role_can_view_audience (text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Tighten kb_job_runs: disallow NULL workspace_id for authenticated clients
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS kb_job_runs_org_rw ON public.kb_job_runs;

CREATE POLICY kb_job_runs_org_rw ON public.kb_job_runs
  FOR ALL
  TO authenticated
  USING (
    workspace_id::uuid = haven.organization_id ()
    AND workspace_id IS NOT NULL)
  WITH CHECK (
    workspace_id::uuid = haven.organization_id ()
    AND workspace_id IS NOT NULL);

COMMENT ON FUNCTION public.retrieve_evidence (text, text, text, integer, float, uuid) IS 'KB search; EXECUTE reserved for service_role — call only from Edge Functions after JWT + user_profiles org check.';
