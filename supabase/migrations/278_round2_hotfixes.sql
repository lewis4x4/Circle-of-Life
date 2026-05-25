-- Round 2 backend hotfixes: NLQ soft-delete/RLS hardening and context indexes.

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
  IF v_count > 100 THEN
    RAISE EXCEPTION 'count_too_large' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.exec_nlq_sessions
  WHERE id = p_session_id
    AND deleted_at IS NULL
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
   WHERE id = p_session_id
     AND deleted_at IS NULL;

  RETURN v_first;
END;
$$;

DROP POLICY IF EXISTS exec_nlq_sessions_select ON public.exec_nlq_sessions;
CREATE POLICY exec_nlq_sessions_select ON public.exec_nlq_sessions
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin', 'caregiver', 'family')
    AND (user_id = auth.uid() OR shared_with_org = true)
  );

ALTER TABLE public.exec_nlq_messages
  DROP CONSTRAINT IF EXISTS exec_nlq_messages_organization_id_fkey,
  ADD CONSTRAINT exec_nlq_messages_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_exec_nlq_messages_org_partial
  ON public.exec_nlq_messages (organization_id, session_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS tr_exec_nlq_messages_touch_session ON public.exec_nlq_messages;
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
             last_message_at = (
               SELECT max(m.created_at)
               FROM public.exec_nlq_messages m
               WHERE m.session_id = OLD.session_id
                 AND m.deleted_at IS NULL
             ),
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

CREATE TRIGGER tr_exec_nlq_messages_touch_session
  AFTER INSERT OR UPDATE OR DELETE ON public.exec_nlq_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_exec_nlq_messages_touch_session();

REVOKE ALL ON FUNCTION public.reserve_nlq_ordinals(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_nlq_ordinals(uuid, int) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_nlq_ordinals(uuid, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_nlq_ordinals(uuid, int) TO service_role;
