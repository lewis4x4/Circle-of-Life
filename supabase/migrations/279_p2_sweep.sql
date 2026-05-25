-- Round 2 P2 backend sweep: enforce NLQ ordinal reservation ownership.

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

  IF NOT EXISTS (
    SELECT 1
    FROM public.exec_nlq_sessions
    WHERE id = p_session_id
      AND organization_id = haven.organization_id()
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.reserve_nlq_ordinals(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_nlq_ordinals(uuid, int) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_nlq_ordinals(uuid, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_nlq_ordinals(uuid, int) TO service_role;
