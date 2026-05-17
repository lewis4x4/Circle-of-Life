-- KB-NEXT-11: gaps loop + coverage dashboard + freshness
--
-- Goal: close the trust loop so misses become work items, not lost signal.
--   1. Every empty-evidence answer (router or knowledge-agent) and every
--      thumbs-down on a chat / Haven Insight answer increments a single
--      `knowledge_gaps` row keyed on (workspace, question_normalized, signal).
--      The frequency column is the priority signal for the coverage UI.
--   2. A freshness view (`vw_kb_freshness`) classifies documents fresh /
--      stale / expired so owners see which policies need a refresh pass.
--   3. A rollup view (`vw_kb_coverage_dashboard`) joins the existing
--      `vw_kb_seed_target_coverage` numbers with open-gap count and stale-doc
--      count so the new admin coverage page renders from one SELECT.
--
-- Idempotency: all DDL is IF NOT EXISTS / OR REPLACE. Re-running this
-- migration is safe.

-- ---------------------------------------------------------------------------
-- 0. Pre-existing column reconciliation
--
-- (a) `chat_messages.feedback` is present in production (it's referenced
--     from useKBHealth / database.ts) but has no migration in-tree. Mirror
--     it here so a fresh-database install matches prod and lets the
--     trigger below compile.
-- (b) `exec_nlq_sessions` already has the standard
--     `tr_exec_nlq_sessions_set_updated_at` trigger that calls
--     `haven_set_updated_at()`, but the table is missing the `updated_by`
--     column the function tries to set. That makes every UPDATE fail —
--     including the new KB-NEXT-10 thumbs feedback. Add the column here
--     so the existing trigger compiles and the thumbs path actually
--     persists.
-- ---------------------------------------------------------------------------

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS feedback text
    CHECK (feedback IS NULL OR feedback IN ('positive','negative')),
  ADD COLUMN IF NOT EXISTS feedback_at timestamptz;

ALTER TABLE public.exec_nlq_sessions
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 1. Extend knowledge_gaps with the columns the gap loop needs
-- ---------------------------------------------------------------------------

ALTER TABLE public.knowledge_gaps
  ADD COLUMN IF NOT EXISTS signal text NOT NULL DEFAULT 'kb_empty',
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'knowledge_agent',
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS facility_id uuid REFERENCES public.facilities(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.knowledge_gaps'::regclass
      AND conname = 'knowledge_gaps_signal_check'
  ) THEN
    ALTER TABLE public.knowledge_gaps
      ADD CONSTRAINT knowledge_gaps_signal_check
      CHECK (signal IN ('kb_empty','thumbs_down','low_confidence','router_no_grounded_source'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.knowledge_gaps'::regclass
      AND conname = 'knowledge_gaps_surface_check'
  ) THEN
    ALTER TABLE public.knowledge_gaps
      ADD CONSTRAINT knowledge_gaps_surface_check
      CHECK (surface IN ('knowledge_agent','haven_insight','router','other'));
  END IF;
END $$;

-- Partial unique index lets the upsert pattern below merge unresolved gaps by
-- (workspace, normalized question, signal). Resolved gaps are excluded so a
-- newly recurring miss after resolution creates a fresh row.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_knowledge_gaps_open
  ON public.knowledge_gaps (workspace_id, question_normalized, signal)
  WHERE resolved = false;

CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_org_signal_freq
  ON public.knowledge_gaps (workspace_id, signal, frequency DESC)
  WHERE resolved = false;

-- ---------------------------------------------------------------------------
-- 2. _kb_record_gap: idempotent gap recorder
--
-- SECURITY DEFINER so service-role Edge functions can call it without
-- worrying about RLS, and an authenticated owner_role can also call it from
-- the browser when needed (the function re-validates organization_id from
-- haven.organization_id() when no service role is in play).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._kb_record_gap(
  p_workspace_id uuid,
  p_user_id uuid,
  p_question text,
  p_signal text DEFAULT 'kb_empty',
  p_surface text DEFAULT 'knowledge_agent',
  p_intent text DEFAULT NULL,
  p_facility_id uuid DEFAULT NULL,
  p_trace_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text;
  v_gap_id uuid;
BEGIN
  IF p_workspace_id IS NULL OR p_question IS NULL OR length(trim(p_question)) = 0 THEN
    RETURN NULL;
  END IF;

  v_normalized := lower(regexp_replace(trim(p_question), '\s+', ' ', 'g'));
  v_normalized := left(v_normalized, 2000);

  INSERT INTO public.knowledge_gaps (
    workspace_id, user_id, question, question_normalized, trace_id,
    signal, surface, intent, facility_id,
    frequency, last_asked_at
  ) VALUES (
    p_workspace_id, p_user_id, left(p_question, 2000), v_normalized, p_trace_id,
    p_signal, p_surface, p_intent, p_facility_id,
    1, now()
  )
  ON CONFLICT (workspace_id, question_normalized, signal) WHERE resolved = false
  DO UPDATE SET
    frequency = public.knowledge_gaps.frequency + 1,
    last_asked_at = now(),
    intent = COALESCE(EXCLUDED.intent, public.knowledge_gaps.intent),
    facility_id = COALESCE(EXCLUDED.facility_id, public.knowledge_gaps.facility_id),
    surface = EXCLUDED.surface,
    updated_at = now()
  RETURNING id INTO v_gap_id;

  RETURN v_gap_id;
END;
$$;

REVOKE ALL ON FUNCTION public._kb_record_gap(uuid, uuid, text, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._kb_record_gap(uuid, uuid, text, text, text, text, uuid, uuid) TO service_role;
-- Authenticated users do NOT get EXECUTE here; the only browser-side path
-- (thumbs-down) goes through a SECURITY DEFINER trigger on chat_messages.

COMMENT ON FUNCTION public._kb_record_gap(uuid, uuid, text, text, text, text, uuid, uuid) IS
  'KB-NEXT-11: idempotent gap recorder. Upserts knowledge_gaps by (workspace, normalized question, signal), bumping frequency.';

-- ---------------------------------------------------------------------------
-- 3. Thumbs-down trigger on chat_messages
--
-- When chat_messages.feedback transitions to 'negative' we log a thumbs_down
-- gap. We look up the associated user prompt (the previous user-role message
-- in the same conversation) so the gap reflects the question, not the
-- assistant's answer.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._kb_chat_thumbs_down_to_gap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_question text;
BEGIN
  IF NEW.feedback IS DISTINCT FROM 'negative' THEN
    RETURN NEW;
  END IF;
  IF OLD IS NOT NULL AND OLD.feedback = 'negative' THEN
    RETURN NEW;
  END IF;

  SELECT content INTO v_question
  FROM public.chat_messages
  WHERE conversation_id = NEW.conversation_id
    AND role = 'user'
    AND created_at <= NEW.created_at
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_question IS NULL OR length(trim(v_question)) = 0 THEN
    RETURN NEW;
  END IF;

  PERFORM public._kb_record_gap(
    NEW.workspace_id,
    NEW.user_id,
    v_question,
    'thumbs_down',
    'knowledge_agent',
    NULL,
    NULL,
    NEW.trace_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_msg_thumbs_down_gap ON public.chat_messages;
CREATE TRIGGER trg_chat_msg_thumbs_down_gap
  AFTER INSERT OR UPDATE OF feedback ON public.chat_messages
  FOR EACH ROW
  WHEN (NEW.feedback = 'negative')
  EXECUTE FUNCTION public._kb_chat_thumbs_down_to_gap();

-- ---------------------------------------------------------------------------
-- 4. Thumbs-down trigger on exec_nlq_sessions (Haven Insight)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._kb_exec_nlq_thumbs_down_to_gap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.feedback IS DISTINCT FROM 'negative' THEN
    RETURN NEW;
  END IF;
  IF OLD IS NOT NULL AND OLD.feedback = 'negative' THEN
    RETURN NEW;
  END IF;

  -- title here is the original NL question (set by haven-ai-router /
  -- exec-nlq-executor when the session is created).
  IF NEW.title IS NULL OR length(trim(NEW.title)) = 0 THEN
    RETURN NEW;
  END IF;

  PERFORM public._kb_record_gap(
    NEW.organization_id,
    NEW.user_id,
    NEW.title,
    'thumbs_down',
    'haven_insight',
    NULLIF(NEW.intent_json->>'intent', ''),
    NULL,
    NULL
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exec_nlq_thumbs_down_gap ON public.exec_nlq_sessions;
CREATE TRIGGER trg_exec_nlq_thumbs_down_gap
  AFTER INSERT OR UPDATE OF feedback ON public.exec_nlq_sessions
  FOR EACH ROW
  WHEN (NEW.feedback = 'negative')
  EXECUTE FUNCTION public._kb_exec_nlq_thumbs_down_to_gap();

-- ---------------------------------------------------------------------------
-- 5. Freshness view
--
-- We use updated_at as the "last touched" signal (documents are updated when
-- raw_text is re-ingested or status flips). approved_at is preferred when the
-- doc has been formally re-approved.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_kb_freshness
WITH (security_invoker = true)
AS
SELECT
  d.id              AS document_id,
  d.workspace_id,
  d.title,
  d.status,
  (d.metadata->>'compliance_category')             AS compliance_category,
  (d.metadata->>'regulation_citation')             AS regulation_citation,
  d.audience,
  d.review_due_at,
  COALESCE(d.approved_at, d.updated_at, d.created_at) AS last_refreshed_at,
  GREATEST(
    0,
    EXTRACT(EPOCH FROM (now() - COALESCE(d.approved_at, d.updated_at, d.created_at))) / 86400
  )::int                                            AS days_since_refresh,
  CASE
    WHEN COALESCE(d.approved_at, d.updated_at, d.created_at) IS NULL THEN 'unknown'
    WHEN COALESCE(d.approved_at, d.updated_at, d.created_at) < now() - interval '180 days' THEN 'expired'
    WHEN COALESCE(d.approved_at, d.updated_at, d.created_at) < now() - interval '90 days'  THEN 'stale'
    ELSE 'fresh'
  END                                               AS freshness_status,
  CASE
    WHEN d.review_due_at IS NOT NULL AND d.review_due_at < now() THEN true
    ELSE false
  END                                               AS review_overdue
FROM public.documents d
WHERE d.deleted_at IS NULL
  AND d.workspace_id = haven.organization_id();

GRANT SELECT ON public.vw_kb_freshness TO authenticated;

COMMENT ON VIEW public.vw_kb_freshness IS
  'KB-NEXT-11: per-document freshness (fresh <90d, stale 90-180d, expired >180d). RLS via security_invoker over documents.';

-- ---------------------------------------------------------------------------
-- 6. Coverage dashboard rollup
--
-- One row per workspace; combines:
--   • seed-target coverage (from vw_kb_seed_target_coverage)
--   • open-gap counts split by signal
--   • freshness counts (fresh / stale / expired / review_overdue)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_kb_coverage_dashboard
WITH (security_invoker = true)
AS
WITH
seed AS (
  SELECT
    workspace_id,
    total_targets,
    covered_count,
    wip_count,
    uncovered_count,
    retired_count,
    covered_pct
  FROM public.vw_kb_seed_target_coverage
),
gaps AS (
  SELECT
    haven.organization_id() AS workspace_id,
    COUNT(*) FILTER (WHERE resolved = false)                                            AS open_gaps,
    COUNT(*) FILTER (WHERE resolved = false AND signal = 'kb_empty')                    AS open_gaps_kb_empty,
    COUNT(*) FILTER (WHERE resolved = false AND signal = 'thumbs_down')                 AS open_gaps_thumbs_down,
    COUNT(*) FILTER (WHERE resolved = false AND signal = 'low_confidence')              AS open_gaps_low_confidence,
    COUNT(*) FILTER (WHERE resolved = false AND signal = 'router_no_grounded_source')   AS open_gaps_router_no_source,
    COUNT(*) FILTER (WHERE resolved = true  AND resolved_at >= now() - interval '30 days') AS resolved_last_30d
  FROM public.knowledge_gaps
  WHERE workspace_id = haven.organization_id()
),
freshness AS (
  SELECT
    haven.organization_id() AS workspace_id,
    COUNT(*)                                                          AS total_documents,
    COUNT(*) FILTER (WHERE freshness_status = 'fresh')                AS fresh_documents,
    COUNT(*) FILTER (WHERE freshness_status = 'stale')                AS stale_documents,
    COUNT(*) FILTER (WHERE freshness_status = 'expired')              AS expired_documents,
    COUNT(*) FILTER (WHERE freshness_status = 'unknown')              AS unknown_freshness,
    COUNT(*) FILTER (WHERE review_overdue)                            AS review_overdue_count
  FROM public.vw_kb_freshness
)
SELECT
  COALESCE(seed.workspace_id, gaps.workspace_id, freshness.workspace_id) AS workspace_id,
  COALESCE(seed.total_targets, 0)         AS total_targets,
  COALESCE(seed.covered_count, 0)         AS covered_targets,
  COALESCE(seed.wip_count, 0)             AS wip_targets,
  COALESCE(seed.uncovered_count, 0)       AS uncovered_targets,
  COALESCE(seed.retired_count, 0)         AS retired_targets,
  COALESCE(seed.covered_pct, 0)           AS coverage_pct,
  COALESCE(gaps.open_gaps, 0)             AS open_gaps,
  COALESCE(gaps.open_gaps_kb_empty, 0)    AS open_gaps_kb_empty,
  COALESCE(gaps.open_gaps_thumbs_down, 0) AS open_gaps_thumbs_down,
  COALESCE(gaps.open_gaps_low_confidence, 0) AS open_gaps_low_confidence,
  COALESCE(gaps.open_gaps_router_no_source, 0) AS open_gaps_router_no_source,
  COALESCE(gaps.resolved_last_30d, 0)     AS resolved_last_30d,
  COALESCE(freshness.total_documents, 0)  AS total_documents,
  COALESCE(freshness.fresh_documents, 0)  AS fresh_documents,
  COALESCE(freshness.stale_documents, 0)  AS stale_documents,
  COALESCE(freshness.expired_documents, 0) AS expired_documents,
  COALESCE(freshness.unknown_freshness, 0) AS unknown_freshness,
  COALESCE(freshness.review_overdue_count, 0) AS review_overdue_count
FROM seed
FULL OUTER JOIN gaps      ON gaps.workspace_id      = seed.workspace_id
FULL OUTER JOIN freshness ON freshness.workspace_id = COALESCE(seed.workspace_id, gaps.workspace_id);

GRANT SELECT ON public.vw_kb_coverage_dashboard TO authenticated;

COMMENT ON VIEW public.vw_kb_coverage_dashboard IS
  'KB-NEXT-11: one-row rollup for the coverage dashboard (seed-target progress + open gaps + freshness).';
