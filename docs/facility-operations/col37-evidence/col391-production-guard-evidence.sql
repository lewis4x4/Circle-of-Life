-- COL-391 production evidence. Fill in session_id from a live auth.sessions row
-- for the owner before running; it is deliberately not committed.
--
-- COL-391 production evidence: the six NLQ RPCs now reach their guard instead of
-- raising 22P02. No row is created, updated or deleted: every call targets an id
-- that does not exist, so each UPDATE matches nothing. Rolled back regardless.
BEGIN;
DO $$
DECLARE
  v_missing uuid := '00000000-0000-0000-0000-0000000000ff';
  v_state text := '';
  v_sqlstate text;
  v_row public.exec_nlq_sessions%ROWTYPE;
  v_hits int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"role":"authenticated","sub":"a0000000-0000-0000-0000-000000000001","session_id":"<a live auth.sessions.id for that user>","auth_claim_version":"1"}',
    true);
  SET LOCAL ROLE authenticated;

  IF haven.app_role() IS DISTINCT FROM 'owner'::app_role THEN
    RAISE EXCEPTION 'COL-391 prod evidence: claims did not resolve to an owner actor';
  END IF;

  BEGIN v_row := public.rename_nlq_thread(v_missing, 'x');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE; v_state := v_state || 'rename=' || v_sqlstate || ' '; END;

  BEGIN v_row := public.set_nlq_thread_pinned(v_missing, true);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE; v_state := v_state || 'pin=' || v_sqlstate || ' '; END;

  BEGIN v_row := public.set_nlq_thread_archived(v_missing, true);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE; v_state := v_state || 'archive=' || v_sqlstate || ' '; END;

  BEGIN v_row := public.delete_nlq_thread(v_missing);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE; v_state := v_state || 'delete=' || v_sqlstate || ' '; END;

  BEGIN
    SELECT count(*) INTO v_hits FROM public.search_nlq_threads('census occupancy', 5);
    v_state := v_state || 'search=ok(' || v_hits || ' rows) ';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE; v_state := v_state || 'search=' || v_sqlstate || ' '; END;

  BEGIN
    PERFORM public.set_nlq_message_feedback(v_missing, 'positive');
    v_state := v_state || 'feedback=ok(no row matched)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE; v_state := v_state || 'feedback=' || v_sqlstate; END;

  RESET ROLE;
  RAISE EXCEPTION 'COL-391 prod evidence || %', v_state;
END $$;
ROLLBACK;
