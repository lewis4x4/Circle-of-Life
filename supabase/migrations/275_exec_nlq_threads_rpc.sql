-- Threads P0: SECURITY DEFINER RPCs for Haven Insight thread actions.
--
-- Frontend reads use RLS-scoped direct Supabase queries, but thread mutations and
-- cross-message search need server-side ownership checks and atomic updates. Each
-- function re-asserts role, organization, and ownership before touching rows so
-- SECURITY DEFINER never becomes a cross-user escape hatch.

CREATE OR REPLACE FUNCTION public.rename_nlq_thread(
  p_session_id uuid,
  p_title text
)
RETURNS public.exec_nlq_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.exec_nlq_sessions%ROWTYPE;
BEGIN
  IF COALESCE(haven.app_role(), '') NOT IN ('owner', 'org_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.exec_nlq_sessions
     SET title = p_title,
         title_auto = false,
         updated_at = now()
   WHERE id = p_session_id
     AND organization_id = haven.organization_id()
     AND user_id = auth.uid()
     AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_nlq_thread(p_session_id uuid)
RETURNS public.exec_nlq_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.exec_nlq_sessions%ROWTYPE;
BEGIN
  IF COALESCE(haven.app_role(), '') NOT IN ('owner', 'org_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.exec_nlq_sessions
     SET deleted_at = now(),
         updated_at = now()
   WHERE id = p_session_id
     AND organization_id = haven.organization_id()
     AND user_id = auth.uid()
     AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_nlq_thread_pinned(
  p_session_id uuid,
  p_pinned boolean
)
RETURNS public.exec_nlq_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.exec_nlq_sessions%ROWTYPE;
BEGIN
  IF COALESCE(haven.app_role(), '') NOT IN ('owner', 'org_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.exec_nlq_sessions
     SET pinned_at = CASE WHEN p_pinned THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_session_id
     AND organization_id = haven.organization_id()
     AND user_id = auth.uid()
     AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_nlq_thread_archived(
  p_session_id uuid,
  p_archived boolean
)
RETURNS public.exec_nlq_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.exec_nlq_sessions%ROWTYPE;
BEGIN
  IF COALESCE(haven.app_role(), '') NOT IN ('owner', 'org_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.exec_nlq_sessions
     SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_session_id
     AND organization_id = haven.organization_id()
     AND user_id = auth.uid()
     AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_nlq_threads(
  p_query text,
  p_limit int DEFAULT 20
)
RETURNS TABLE (session_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query tsquery;
  v_limit int;
BEGIN
  IF COALESCE(haven.app_role(), '') NOT IN ('owner', 'org_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_query IS NULL OR length(trim(p_query)) = 0 THEN
    RETURN;
  END IF;

  v_query := websearch_to_tsquery('english', p_query);
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);

  RETURN QUERY
  WITH thread_bodies AS (
    SELECT
      s.id AS thread_id,
      s.last_message_at,
      to_tsvector('english', string_agg(m.content, ' ' ORDER BY m.ordinal)) AS document
    FROM public.exec_nlq_sessions s
    JOIN public.exec_nlq_messages m
      ON m.session_id = s.id
     AND m.organization_id = s.organization_id
     AND m.deleted_at IS NULL
    WHERE s.organization_id = haven.organization_id()
      AND s.deleted_at IS NULL
      AND (s.user_id = auth.uid() OR s.shared_with_org = true)
    GROUP BY s.id, s.last_message_at
  )
  SELECT thread_bodies.thread_id
  FROM thread_bodies
  WHERE thread_bodies.document @@ v_query
  ORDER BY ts_rank(thread_bodies.document, v_query) DESC,
           thread_bodies.last_message_at DESC NULLS LAST
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_nlq_thread(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_nlq_thread(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_nlq_thread_pinned(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_nlq_thread_archived(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_nlq_threads(text, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rename_nlq_thread(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_nlq_thread(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_nlq_thread_pinned(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_nlq_thread_archived(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_nlq_threads(text, int) TO authenticated;
