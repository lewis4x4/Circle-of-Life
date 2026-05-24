-- Threads P0: persistent Haven Insight conversation threads.
--
-- The original exec_nlq_sessions table was a per-question log. Threads need a
-- relational message table for O(1) appends, per-message feedback/search, and
-- RLS-scoped history fetches without rewriting a JSON blob on every turn.
--
-- This migration adds sidebar/thread metadata to exec_nlq_sessions, creates
-- exec_nlq_messages with turn-order/search indexes, tightens session RLS to
-- private-by-default ownership, and keeps denormalized session counters in sync.

ALTER TABLE public.exec_nlq_sessions
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS message_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS title_auto boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS title_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_intent text,
  ADD COLUMN IF NOT EXISTS rolling_summary_text text,
  ADD COLUMN IF NOT EXISTS rolling_summary_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS shared_with_org boolean NOT NULL DEFAULT false;

CREATE TABLE public.exec_nlq_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.exec_nlq_sessions (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL CHECK (length(content) <= 50000),
  ordinal int NOT NULL CHECK (ordinal > 0),
  ai_invocation_id uuid REFERENCES public.ai_invocations (id) ON DELETE SET NULL,
  citations jsonb,
  follow_ups jsonb,
  chart_spec jsonb,
  intent text,
  intent_confidence numeric(4,3),
  tools_used jsonb,
  fallback_used boolean NOT NULL DEFAULT false,
  tokens_used int,
  tokens_in int,
  tokens_out int,
  model_used text,
  streamed boolean NOT NULL DEFAULT false,
  feedback text CHECK (feedback IS NULL OR feedback IN ('positive', 'negative')),
  feedback_at timestamptz,
  feedback_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE public.exec_nlq_messages IS
  'Persistent Haven Insight thread messages. Rows are private-by-default through the owning exec_nlq_sessions row and support per-message feedback/search.';

-- Thread fetch in turn order (the hottest read path).
-- Partial keeps the index small and supports index-only ORDER BY.
CREATE UNIQUE INDEX idx_exec_nlq_messages_session_ordinal
  ON public.exec_nlq_messages (session_id, ordinal)
  WHERE deleted_at IS NULL;

-- Org-scoped recency for telemetry / gaps-loop pooling.
CREATE INDEX idx_exec_nlq_messages_org_created
  ON public.exec_nlq_messages (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Negative-feedback pool (gaps loop) — partial keeps it tiny.
CREATE INDEX idx_exec_nlq_messages_negative_feedback
  ON public.exec_nlq_messages (organization_id, created_at DESC)
  WHERE feedback = 'negative' AND deleted_at IS NULL;

-- Search-within-thread (Phase 4).
CREATE INDEX idx_exec_nlq_messages_content_fts
  ON public.exec_nlq_messages USING gin (to_tsvector('english', content))
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS public.idx_exec_nlq_sessions_user;

-- Sidebar query: pinned-first, then most-recent-active.
CREATE INDEX idx_exec_nlq_sessions_sidebar
  ON public.exec_nlq_sessions (
    organization_id,
    user_id,
    pinned_at DESC NULLS LAST,
    last_message_at DESC NULLS LAST
  )
  WHERE deleted_at IS NULL AND archived_at IS NULL;

-- Archived view (rare; tiny index).
CREATE INDEX idx_exec_nlq_sessions_archived
  ON public.exec_nlq_sessions (organization_id, user_id, archived_at DESC)
  WHERE deleted_at IS NULL AND archived_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.haven_exec_nlq_messages_touch_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.exec_nlq_sessions
       SET last_message_at = NEW.created_at,
           message_count = message_count + 1,
           last_intent = COALESCE(NEW.intent, last_intent),
           updated_at = now()
     WHERE id = NEW.session_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Soft-delete via UPDATE; only hard DELETE decrements (used by retention ops).
    UPDATE public.exec_nlq_sessions
       SET message_count = GREATEST(message_count - 1, 0),
           updated_at = now()
     WHERE id = OLD.session_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER tr_exec_nlq_messages_touch_session
  AFTER INSERT OR DELETE ON public.exec_nlq_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_exec_nlq_messages_touch_session();

-- Reuse the canonical helper from 006_audit_triggers.sql / 085_executive_intelligence_v2.sql.
CREATE TRIGGER tr_exec_nlq_messages_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exec_nlq_messages
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

-- Drop the old session SELECT/UPDATE policies and re-create scoped to the user.
DROP POLICY IF EXISTS exec_nlq_sessions_select ON public.exec_nlq_sessions;
DROP POLICY IF EXISTS exec_nlq_sessions_update ON public.exec_nlq_sessions;

CREATE POLICY exec_nlq_sessions_select ON public.exec_nlq_sessions
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
    AND (
      user_id = auth.uid()
      OR shared_with_org = true
    )
  );

CREATE POLICY exec_nlq_sessions_update ON public.exec_nlq_sessions
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
    AND user_id = auth.uid()
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
    AND user_id = auth.uid()
  );

ALTER TABLE public.exec_nlq_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.exec_nlq_messages TO authenticated;

CREATE POLICY exec_nlq_messages_select ON public.exec_nlq_messages
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT 1
      FROM public.exec_nlq_sessions s
      WHERE s.id = exec_nlq_messages.session_id
        AND s.organization_id = haven.organization_id()
        AND (s.user_id = auth.uid() OR s.shared_with_org = true)
        AND s.deleted_at IS NULL
    )
  );

-- INSERT/UPDATE/DELETE only via SECURITY DEFINER RPCs in migration 275;
-- no direct FE writes. The router writes via service-role key, bypassing RLS.
