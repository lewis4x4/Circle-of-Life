-- P2 cleanup wave 1: NLQ RLS parity, message feedback, and router context RPC.
--
-- ROAD-03 NOTE: haven-ai-router's ALLOWED_ROLES constant lists
--   ('owner','org_admin','clinical_admin','administrator','clinical','caregiver','family')
-- but 'clinical_admin', 'administrator', and 'clinical' do NOT exist in the
-- public.app_role enum (see 001_enum_types.sql). The roles facility_admin,
-- nurse, med_tech, dietary, maintenance_role, broker, dietary_aide DO exist
-- in the enum but are intentionally excluded from Haven AI access by design.
-- We mirror only the intersection of ALLOWED_ROLES ∩ real enum here.

DROP POLICY IF EXISTS exec_nlq_messages_select ON public.exec_nlq_messages;

CREATE POLICY exec_nlq_messages_select ON public.exec_nlq_messages
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN (
      'owner',
      'org_admin',
      'caregiver',
      'family'
    )
    AND EXISTS (
      SELECT 1
      FROM public.exec_nlq_sessions s
      WHERE s.id = exec_nlq_messages.session_id
        AND s.organization_id = haven.organization_id()
        AND (s.user_id = auth.uid() OR s.shared_with_org = true)
        AND s.deleted_at IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.set_nlq_message_feedback(
  p_message_id uuid,
  p_feedback text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_feedback IS NOT NULL AND p_feedback NOT IN ('positive', 'negative') THEN
    RAISE EXCEPTION 'invalid_feedback' USING ERRCODE = '22023';
  END IF;

  -- See ROAD-03 note above re: enum reachability.
  IF COALESCE(haven.app_role(), '') NOT IN (
    'owner',
    'org_admin',
    'caregiver',
    'family'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.exec_nlq_messages m
     SET feedback = p_feedback,
         feedback_at = now()
    FROM public.exec_nlq_sessions s
   WHERE m.id = p_message_id
     AND m.session_id = s.id
     AND m.organization_id = haven.organization_id()
     AND m.deleted_at IS NULL
     AND m.role = 'assistant'
     AND s.organization_id = haven.organization_id()
     AND s.user_id = auth.uid()
     AND s.deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_nlq_conversation_context(
  p_session_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_limit int DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_msgs jsonb;
  v_limit int;
BEGIN
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 12), 0), 50);

  SELECT message_count, rolling_summary_text
    INTO v_session
    FROM public.exec_nlq_sessions
   WHERE id = p_session_id
     AND organization_id = p_org_id
     AND (user_id = p_user_id OR shared_with_org = true)
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(to_jsonb(m) ORDER BY m.ordinal)
    INTO v_msgs
    FROM (
      SELECT role, content, ordinal
        FROM public.exec_nlq_messages
       WHERE session_id = p_session_id
         AND organization_id = p_org_id
         AND deleted_at IS NULL
         AND role != 'system'
       ORDER BY ordinal DESC
       LIMIT v_limit
    ) m;

  RETURN jsonb_build_object(
    'message_count', COALESCE(v_session.message_count, 0),
    'rolling_summary_text', v_session.rolling_summary_text,
    'messages', COALESCE(v_msgs, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_nlq_message_feedback(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_nlq_message_feedback(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_nlq_conversation_context(uuid, uuid, uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_nlq_conversation_context(uuid, uuid, uuid, int) FROM anon;
REVOKE ALL ON FUNCTION public.get_nlq_conversation_context(uuid, uuid, uuid, int) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.set_nlq_message_feedback(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_nlq_conversation_context(uuid, uuid, uuid, int) TO service_role;
