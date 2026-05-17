-- KB-NEXT-05: Metadata-filtered hybrid retrieval.
--
-- Adds retrieve_evidence_hybrid_v2 — same RRF fusion logic as 236 but with
-- additional optional filter parameters:
--
--   * p_audience              text[]  match against documents.audience (any-of)
--   * p_compliance_categories text[]  match against documents.compliance_category
--   * p_document_ids          uuid[]  narrow to specific doc set (e.g. a saved
--                                     citation cluster)
--   * p_min_effective_date    date    only docs whose regulation_effective_date
--                                     is null OR >= the floor
--
-- All filter params are nullable; NULL means "no filter applied for that
-- dimension". Same tenancy + role gating as v1.
--
-- v1 is preserved unchanged for callers that don't need filters.

CREATE OR REPLACE FUNCTION public.retrieve_evidence_hybrid_v2 (
  query_embedding text,
  keyword_query text,
  user_role text,
  match_count integer DEFAULT 8,
  semantic_threshold float DEFAULT 0.3,
  rrf_k integer DEFAULT 60,
  p_workspace_id uuid DEFAULT NULL,
  p_audience text[] DEFAULT NULL,
  p_compliance_categories text[] DEFAULT NULL,
  p_document_ids uuid[] DEFAULT NULL,
  p_min_effective_date date DEFAULT NULL
)
  RETURNS TABLE (
    source_title text,
    excerpt text,
    confidence float,
    section_title text,
    chunk_id uuid,
    document_id uuid,
    rrf_score float,
    sem_rank integer,
    kw_rank integer,
    compliance_category text,
    regulation_citation text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
DECLARE
  qvec vector (1536);
  effective_k integer := GREATEST(rrf_k, 1);
  fetch_n integer := GREATEST(match_count * 4, match_count);
  max_score float := 2.0::float / (effective_k + 1);
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

  RETURN QUERY
  WITH semantic AS (
    SELECT
      c.id AS cid,
      d.id AS did,
      d.title AS stitle,
      left(c.content, 800) AS ex,
      c.section_title AS sect,
      d.compliance_category AS comp_cat,
      d.regulation_citation AS reg_cite,
      ROW_NUMBER() OVER (ORDER BY c.embedding <=> qvec)::int AS s_rank
    FROM
      public.chunks c
      INNER JOIN public.documents d ON d.id = c.document_id
        AND d.deleted_at IS NULL
        AND d.workspace_id::uuid = p_workspace_id
    WHERE
      qvec IS NOT NULL
      AND public.document_role_can_view_audience (d.audience, user_role)
      AND (d.status = 'published'
        OR (d.status = 'pending_review'
          AND user_role IN ('owner', 'org_admin', 'facility_admin')))
      AND (1::float - (c.embedding <=> qvec)) >= semantic_threshold
      AND (p_audience IS NULL OR d.audience = ANY(p_audience))
      AND (p_compliance_categories IS NULL OR d.compliance_category = ANY(p_compliance_categories))
      AND (p_document_ids IS NULL OR d.id = ANY(p_document_ids))
      AND (
        p_min_effective_date IS NULL
        OR d.regulation_effective_date IS NULL
        OR d.regulation_effective_date >= p_min_effective_date
      )
    ORDER BY
      c.embedding <=> qvec
    LIMIT fetch_n
  ),
  keyword AS (
    SELECT
      c.id AS cid,
      d.id AS did,
      d.title AS stitle,
      left(c.content, 800) AS ex,
      c.section_title AS sect,
      d.compliance_category AS comp_cat,
      d.regulation_citation AS reg_cite,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(
          to_tsvector('english', coalesce(c.content_stripped, c.content)),
          plainto_tsquery('english', trim(keyword_query))
        ) DESC,
        c.chunk_index
      )::int AS k_rank
    FROM
      public.chunks c
      INNER JOIN public.documents d ON d.id = c.document_id
        AND d.deleted_at IS NULL
        AND d.workspace_id::uuid = p_workspace_id
    WHERE
      keyword_query IS NOT NULL
      AND length(trim(keyword_query)) > 0
      AND public.document_role_can_view_audience (d.audience, user_role)
      AND (d.status = 'published'
        OR (d.status = 'pending_review'
          AND user_role IN ('owner', 'org_admin', 'facility_admin')))
      AND to_tsvector('english', coalesce(c.content_stripped, c.content)) @@ plainto_tsquery('english', trim(keyword_query))
      AND (p_audience IS NULL OR d.audience = ANY(p_audience))
      AND (p_compliance_categories IS NULL OR d.compliance_category = ANY(p_compliance_categories))
      AND (p_document_ids IS NULL OR d.id = ANY(p_document_ids))
      AND (
        p_min_effective_date IS NULL
        OR d.regulation_effective_date IS NULL
        OR d.regulation_effective_date >= p_min_effective_date
      )
    LIMIT fetch_n
  ),
  fused AS (
    SELECT
      COALESCE(s.cid, k.cid) AS cid,
      COALESCE(s.did, k.did) AS did,
      COALESCE(s.stitle, k.stitle) AS stitle,
      COALESCE(s.ex, k.ex) AS ex,
      COALESCE(s.sect, k.sect) AS sect,
      COALESCE(s.comp_cat, k.comp_cat) AS comp_cat,
      COALESCE(s.reg_cite, k.reg_cite) AS reg_cite,
      s.s_rank,
      k.k_rank,
      (
        COALESCE(1.0::float / (effective_k + s.s_rank), 0.0::float)
        + COALESCE(1.0::float / (effective_k + k.k_rank), 0.0::float)
      ) AS rrf
    FROM
      semantic s
      FULL OUTER JOIN keyword k ON s.cid = k.cid
  )
  SELECT
    fused.stitle::text,
    fused.ex::text,
    LEAST(1.0::float, fused.rrf / NULLIF(max_score, 0.0))::float AS conf,
    fused.sect::text,
    fused.cid,
    fused.did,
    fused.rrf::float,
    fused.s_rank,
    fused.k_rank,
    fused.comp_cat::text,
    fused.reg_cite::text
  FROM
    fused
  ORDER BY
    fused.rrf DESC,
    fused.s_rank NULLS LAST,
    fused.k_rank NULLS LAST
  LIMIT match_count;
END;
$func$;

COMMENT ON FUNCTION public.retrieve_evidence_hybrid_v2 (text, text, text, integer, float, integer, uuid, text[], text[], uuid[], date) IS
  'KB-NEXT-05: RRF retrieval with optional audience/compliance_category/document_id/effective_date filters and compliance category + regulation_citation passthrough for the Cohere reranker. service_role only.';

REVOKE ALL ON FUNCTION public.retrieve_evidence_hybrid_v2 (text, text, text, integer, float, integer, uuid, text[], text[], uuid[], date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retrieve_evidence_hybrid_v2 (text, text, text, integer, float, integer, uuid, text[], text[], uuid[], date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.retrieve_evidence_hybrid_v2 (text, text, text, integer, float, integer, uuid, text[], text[], uuid[], date) FROM anon;
GRANT EXECUTE ON FUNCTION public.retrieve_evidence_hybrid_v2 (text, text, text, integer, float, integer, uuid, text[], text[], uuid[], date) TO service_role;
