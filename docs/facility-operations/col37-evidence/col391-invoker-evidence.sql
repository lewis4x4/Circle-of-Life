-- COL-391 evidence: the four NLQ thread RPCs that 393 switched to SECURITY
-- INVOKER still reach the caller's own rows, and still refuse someone else's.
-- Everything here is a fixture and the whole run rolls back.

BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('a0000391-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'col391-owner@probe.invalid', now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('a0000391-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'col391-other@probe.invalid', now(), now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.user_profiles (id, email, full_name, app_role, organization_id, is_active, auth_claim_version)
VALUES
  ('a0000391-0000-4000-8000-000000000001', 'col391-owner@probe.invalid', 'COL-391 Owner', 'owner', '00000000-0000-0000-0000-000000000001', true, 1),
  ('a0000391-0000-4000-8000-000000000002', 'col391-other@probe.invalid', 'COL-391 Other', 'owner', '00000000-0000-0000-0000-000000000001', true, 1);

INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES ('b0000391-0000-4000-8000-000000000001', 'a0000391-0000-4000-8000-000000000001', now(), now());

INSERT INTO public.exec_nlq_sessions (id, organization_id, user_id, created_by, title)
VALUES
  ('c0000391-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'a0000391-0000-4000-8000-000000000001', 'a0000391-0000-4000-8000-000000000001', 'Probe thread'),
  ('c0000391-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'a0000391-0000-4000-8000-000000000002', 'a0000391-0000-4000-8000-000000000002', 'Someone else thread');

INSERT INTO public.exec_nlq_messages (id, session_id, organization_id, role, content, ordinal)
VALUES ('d0000391-0000-4000-8000-000000000001', 'c0000391-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'assistant', 'occupancy census for the probe facility', 1);

DO $$
DECLARE
  v_row public.exec_nlq_sessions%ROWTYPE;
  v_found uuid;
  v_feedback text;
  v_sqlstate text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"role":"authenticated","sub":"a0000391-0000-4000-8000-000000000001","session_id":"b0000391-0000-4000-8000-000000000001","auth_claim_version":"1"}',
    true);
  SET LOCAL ROLE authenticated;

  IF haven.app_role() IS DISTINCT FROM 'owner'::app_role THEN
    RAISE EXCEPTION 'COL-391 evidence: the fixture session is not resolving to an owner actor (app_role = %); the rest of this run would prove nothing', COALESCE(haven.app_role()::text, '<null>');
  END IF;

  -- 1. rename, as an invoker, through exec_nlq_sessions_update.
  v_row := public.rename_nlq_thread('c0000391-0000-4000-8000-000000000001', 'Renamed by the probe');
  IF v_row.title <> 'Renamed by the probe' OR v_row.title_auto THEN
    RAISE EXCEPTION 'COL-391 evidence: rename_nlq_thread did not take as an invoker (title=%, title_auto=%)', v_row.title, v_row.title_auto;
  END IF;

  -- 2. pin.
  v_row := public.set_nlq_thread_pinned('c0000391-0000-4000-8000-000000000001', true);
  IF v_row.pinned_at IS NULL THEN
    RAISE EXCEPTION 'COL-391 evidence: set_nlq_thread_pinned did not set pinned_at as an invoker';
  END IF;

  -- 3. archive, then unarchive.
  v_row := public.set_nlq_thread_archived('c0000391-0000-4000-8000-000000000001', true);
  IF v_row.archived_at IS NULL THEN
    RAISE EXCEPTION 'COL-391 evidence: set_nlq_thread_archived did not set archived_at as an invoker';
  END IF;
  v_row := public.set_nlq_thread_archived('c0000391-0000-4000-8000-000000000001', false);
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'COL-391 evidence: set_nlq_thread_archived did not clear archived_at as an invoker';
  END IF;

  -- 4. search still crosses from messages to sessions under the select policies.
  SELECT session_id INTO v_found FROM public.search_nlq_threads('occupancy census', 20);
  IF v_found IS DISTINCT FROM 'c0000391-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'COL-391 evidence: search_nlq_threads returned % as an invoker, expected the probe thread', COALESCE(v_found::text, '<no rows>');
  END IF;

  -- 5. Someone else's thread is still out of reach -- refused as not_found,
  --    the same answer the definer gave, now by row-level security.
  BEGIN
    v_row := public.rename_nlq_thread('c0000391-0000-4000-8000-000000000002', 'Should not happen');
    RAISE EXCEPTION 'COL-391 evidence: rename_nlq_thread reached another user''s thread as an invoker';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    NULL;
  END;

  -- 6. The two that kept SECURITY DEFINER still work.
  PERFORM public.set_nlq_message_feedback('d0000391-0000-4000-8000-000000000001', 'positive');
  SET LOCAL ROLE postgres;
  SELECT feedback INTO v_feedback FROM public.exec_nlq_messages WHERE id = 'd0000391-0000-4000-8000-000000000001';
  IF v_feedback IS DISTINCT FROM 'positive' THEN
    RAISE EXCEPTION 'COL-391 evidence: set_nlq_message_feedback did not record feedback (%)', COALESCE(v_feedback, '<null>');
  END IF;
  SET LOCAL ROLE authenticated;

  v_row := public.delete_nlq_thread('c0000391-0000-4000-8000-000000000001');
  IF v_row.deleted_at IS NULL THEN
    RAISE EXCEPTION 'COL-391 evidence: delete_nlq_thread did not set deleted_at';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'COL-391 evidence: all six assertions passed';
END $$;

ROLLBACK;
