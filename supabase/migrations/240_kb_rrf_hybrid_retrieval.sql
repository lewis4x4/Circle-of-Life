-- KB-NEXT-04: Reciprocal Rank Fusion hybrid retrieval.
--
-- The original retrieve_evidence does sequential fallback (semantic first,
-- keyword only if semantic returned zero rows). That loses any keyword wins
-- when semantic returns weak-but-nonzero results, and never blends the two.
--
-- retrieve_evidence_hybrid runs BOTH rankings independently and fuses them
-- using RRF (Cormack/Clarke/Buettcher 2009): score = sum(1 / (k + rank_i)).
-- k = 60 by default, matching the canonical reference and the value most
-- evaluation pipelines (BEIR, Vespa, Weaviate, etc.) use.
--
-- We pull a wider top-K (match_count * 4) from each subsystem so the fusion
-- has enough overlap to do meaningful re-ranking. The FTS GIN index
-- (idx_kb_chunks_fts in 126_knowledge_base.sql) already exists, so keyword
-- ranking remains O(log n) per chunk.
--
-- Tenancy + role gating mirrors retrieve_evidence: NULL workspace = empty
-- return; document_role_can_view_audience() gates audience; pending_review
-- visible only to admin tier.
--
-- Confidence column is RRF score normalized to [0,1] using the maximum
-- achievable per-chunk score (= 2 / (k + 1) when a doc ranks #1 in both
-- subsystems). This lets the UI keep the existing confidence threshold UX
-- without re-tuning copy.

CREATE OR REPLACE FUNCTION public.retrieve_evidence_hybrid (
  query_embedding text,
  keyword_query text,
  user_role text,
  match_count integer DEFAULT 8,
  semantic_threshold float DEFAULT 0.3,
  rrf_k integer DEFAULT 60,
  p_workspace_id uuid DEFAULT NULL
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
    kw_rank integer
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
      (1::float - (c.embedding <=> qvec))::float AS sem_score,
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
      ts_rank_cd(
        to_tsvector('english', coalesce(c.content_stripped, c.content)),
        plainto_tsquery('english', trim(keyword_query))
      )::float AS kw_score,
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
    LIMIT fetch_n
  ),
  fused AS (
    SELECT
      COALESCE(s.cid, k.cid) AS cid,
      COALESCE(s.did, k.did) AS did,
      COALESCE(s.stitle, k.stitle) AS stitle,
      COALESCE(s.ex, k.ex) AS ex,
      COALESCE(s.sect, k.sect) AS sect,
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
    fused.k_rank
  FROM
    fused
  ORDER BY
    fused.rrf DESC,
    fused.s_rank NULLS LAST,
    fused.k_rank NULLS LAST
  LIMIT match_count;
END;
$func$;

COMMENT ON FUNCTION public.retrieve_evidence_hybrid (text, text, text, integer, float, integer, uuid) IS
  'KB-NEXT-04: Reciprocal Rank Fusion (k=60) over semantic + keyword. EXECUTE reserved for service_role — call only from Edge Functions after JWT + user_profiles org check.';

REVOKE ALL ON FUNCTION public.retrieve_evidence_hybrid (text, text, text, integer, float, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retrieve_evidence_hybrid (text, text, text, integer, float, integer, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.retrieve_evidence_hybrid (text, text, text, integer, float, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.retrieve_evidence_hybrid (text, text, text, integer, float, integer, uuid) TO service_role;
