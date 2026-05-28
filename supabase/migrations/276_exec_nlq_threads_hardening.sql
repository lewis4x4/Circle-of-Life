-- Threads hardening: atomic ordinal reservation, safer RPC validation/search,
-- soft-delete counter maintenance, and organization cascade cleanup.

ALTER TABLE public.exec_nlq_sessions
  ADD COLUMN IF NOT EXISTS next_message_ordinal int NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.exec_nlq_sessions.next_message_ordinal IS
  'Next reserved exec_nlq_messages ordinal. Separate from message_count so soft deletes can decrement visible count without reusing ordinals.';

UPDATE public.exec_nlq_sessions s
   SET next_message_ordinal = GREATEST(
     s.next_message_ordinal,
     COALESCE((
       SELECT max(m.ordinal) + 1
       FROM public.exec_nlq_messages m
       WHERE m.session_id = s.id
     ), 1)
   );

CREATE OR REPLACE FUNCTION public.reserve_nlq_ordinals(
  p_session_id uuid,
  p_count int DEFAULT 2
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_first int;
BEGIN
  v_count := COALESCE(p_count, 2);
  IF v_count <= 0 THEN
    RAISE EXCEPTION 'invalid_count' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.exec_nlq_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT GREATEST(
           s.next_message_ordinal,
           COALESCE((
             SELECT max(m.ordinal) + 1
             FROM public.exec_nlq_messages m
             WHERE m.session_id = s.id
           ), 1)
         )
    INTO v_first
    FROM public.exec_nlq_sessions s
   WHERE s.id = p_session_id
     AND s.deleted_at IS NULL;

  IF v_first IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.exec_nlq_sessions
     SET next_message_ordinal = v_first + v_count,
         updated_at = now()
   WHERE id = p_session_id;

  RETURN v_first;
END;
$$;

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
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title_required' USING ERRCODE = '22023';
  END IF;

  IF length(p_title) > 200 THEN
    RAISE EXCEPTION 'title_too_long' USING ERRCODE = '22001';
  END IF;

  IF COALESCE(haven.app_role(), '') NOT IN ('owner', 'org_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.exec_nlq_sessions
     SET title = trim(p_title),
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
  WITH matching_messages AS (
    SELECT
      m.session_id,
      max(ts_rank(to_tsvector('english', m.content), v_query)) AS match_rank
    FROM public.exec_nlq_messages m
    WHERE m.organization_id = haven.organization_id()
      AND m.deleted_at IS NULL
      AND to_tsvector('english', m.content) @@ v_query
    GROUP BY m.session_id
  )
  SELECT s.id
  FROM matching_messages mm
  JOIN public.exec_nlq_sessions s
    ON s.id = mm.session_id
   AND s.organization_id = haven.organization_id()
  WHERE s.deleted_at IS NULL
    AND (s.user_id = auth.uid() OR s.shared_with_org = true)
  ORDER BY mm.match_rank DESC,
           s.last_message_at DESC NULLS LAST
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.haven_exec_nlq_messages_touch_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      UPDATE public.exec_nlq_sessions
         SET last_message_at = NEW.created_at,
             message_count = message_count + 1,
             last_intent = COALESCE(NEW.intent, last_intent),
             updated_at = now()
       WHERE id = NEW.session_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      UPDATE public.exec_nlq_sessions
         SET message_count = GREATEST(message_count - 1, 0),
             updated_at = now()
       WHERE id = OLD.session_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.deleted_at IS NULL THEN
      UPDATE public.exec_nlq_sessions
         SET message_count = GREATEST(message_count - 1, 0),
             updated_at = now()
       WHERE id = OLD.session_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_exec_nlq_messages_touch_session ON public.exec_nlq_messages;
CREATE TRIGGER tr_exec_nlq_messages_touch_session
  AFTER INSERT OR UPDATE OR DELETE ON public.exec_nlq_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_exec_nlq_messages_touch_session();

ALTER TABLE public.exec_nlq_messages
  DROP CONSTRAINT IF EXISTS exec_nlq_messages_organization_id_fkey,
  ADD CONSTRAINT exec_nlq_messages_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations (id) ON DELETE CASCADE;

REVOKE ALL ON FUNCTION public.reserve_nlq_ordinals(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_nlq_ordinals(uuid, int) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_nlq_ordinals(uuid, int) FROM authenticated;
REVOKE ALL ON FUNCTION public.rename_nlq_thread(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_nlq_threads(text, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reserve_nlq_ordinals(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.rename_nlq_thread(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_nlq_threads(text, int) TO authenticated;
