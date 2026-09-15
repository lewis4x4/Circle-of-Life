-- COL-391 (child of COL-37): rule on the first two families of the 53
-- signed-in-callable SECURITY DEFINER functions -- the NLQ thread RPCs and the
-- two sequence allocators. Eight functions, one ruling each, recorded as a
-- COMMENT so the next advisor sweep reads the reasoning instead of guessing.
--
-- Ruling on them turned up a defect first. All six NLQ RPCs open with
--
--   IF COALESCE(haven.app_role(), '') NOT IN ('owner', 'org_admin') THEN
--
-- and haven.app_role() has returned the public.app_role enum since 004, never
-- text. COALESCE resolves the empty string to that enum, and Postgres folds the
-- coercion at plan time, so the statement raises
--
--   22P02 invalid input value for enum app_role: ""
--
-- every time the function is called -- before the guard decides anything, for
-- every caller, at every role, in every environment. Measured on Haven HFO
-- Staging 2026-09-15 with a fully resolved owner actor: the same guard written
-- as haven.app_role() NOT IN ('owner'::app_role, 'org_admin'::app_role) returns
-- "guard passed" while the COALESCE form raises 22P02. These six have therefore
-- never worked: renaming, pinning, archiving, deleting, searching and rating a
-- Haven Insight thread have all been failing since 275/276/277 shipped. The
-- production advisor scan finds this shape in exactly these six functions and
-- nowhere else.
--
-- Fixed here by casting to text before the COALESCE, which is the smallest
-- change that keeps each guard's intent. Section 9 of
-- supabase/tests/review_col37_security_advisor.sql refuses the pattern from now
-- on -- a role guard that raises instead of deciding is worse than no guard,
-- because it reads like protection.
--
-- The ruling marker is the literal string 'COL-37 ruling:'. Section 7 of the
-- same probe fails on any definer function that authenticated can execute
-- without one, so the 44 still-unruled functions are named in that probe's
-- pending list rather than left silent.
--
-- Four of the eight turned out to be incidental definers: the body's own checks
-- are a line-for-line restatement of the row-level security policy on the table
-- it touches, so the caller's own authority reaches exactly the same rows. Those
-- are recreated as SECURITY INVOKER. The other four are doing work RLS cannot
-- and keep their definer rights, with the reason on the function.
--
-- The new section 7 also caught the five care-plan alert trigger functions that
-- 394 merged and applied to production while this was being written. They are
-- revoked here, which is the third ruling category and the same fix 389 made for
-- the payroll guards.

BEGIN;

-- ---------------------------------------------------------------------------
-- Incidental definers -> SECURITY INVOKER
-- ---------------------------------------------------------------------------
-- exec_nlq_sessions carries these policies (275, 276):
--
--   exec_nlq_sessions_update  USING and WITH CHECK
--     organization_id = haven.organization_id()
--     AND deleted_at IS NULL
--     AND haven.app_role() IN ('owner','org_admin')
--     AND user_id = auth.uid()
--
--   exec_nlq_sessions_select  USING
--     organization_id = haven.organization_id()
--     AND deleted_at IS NULL
--     AND haven.app_role() IN ('owner','org_admin','caregiver','family')
--     AND (user_id = auth.uid() OR shared_with_org = true)
--
-- rename/pin/archive each assert owner-or-org_admin, then update WHERE
-- organization_id = haven.organization_id() AND user_id = auth.uid() AND
-- deleted_at IS NULL -- the update policy, restated. None of them writes
-- deleted_at, so the WITH CHECK holds. The RETURNING clause is covered by the
-- select policy, which is wider. 275's header gave the reason for the definer as
-- "server-side ownership checks and atomic updates"; the ownership checks are
-- the policy, and nothing here is less atomic as an invoker.

CREATE OR REPLACE FUNCTION public.rename_nlq_thread(p_session_id uuid, p_title text)
RETURNS public.exec_nlq_sessions
LANGUAGE plpgsql
SECURITY INVOKER
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

  IF COALESCE(haven.app_role()::text, '') NOT IN ('owner', 'org_admin') THEN
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

CREATE OR REPLACE FUNCTION public.set_nlq_thread_pinned(p_session_id uuid, p_pinned boolean)
RETURNS public.exec_nlq_sessions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.exec_nlq_sessions%ROWTYPE;
BEGIN
  IF COALESCE(haven.app_role()::text, '') NOT IN ('owner', 'org_admin') THEN
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

CREATE OR REPLACE FUNCTION public.set_nlq_thread_archived(p_session_id uuid, p_archived boolean)
RETURNS public.exec_nlq_sessions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.exec_nlq_sessions%ROWTYPE;
BEGIN
  IF COALESCE(haven.app_role()::text, '') NOT IN ('owner', 'org_admin') THEN
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

CREATE OR REPLACE FUNCTION public.search_nlq_threads(p_query text, p_limit integer DEFAULT 20)
RETURNS TABLE(session_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_query tsquery;
  v_limit int;
BEGIN
  IF COALESCE(haven.app_role()::text, '') NOT IN ('owner', 'org_admin') THEN
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

COMMENT ON FUNCTION public.rename_nlq_thread(uuid, text) IS
  'Renames a Haven Insight thread the caller owns. COL-37 ruling: incidental definer, switched to SECURITY INVOKER in 397 -- the body''s checks (owner/org_admin, organization_id, user_id = auth.uid(), deleted_at IS NULL) restate the exec_nlq_sessions_update policy, so caller authority reaches the same row. Keep it invoker.';

COMMENT ON FUNCTION public.set_nlq_thread_pinned(uuid, boolean) IS
  'Pins or unpins a Haven Insight thread the caller owns. COL-37 ruling: incidental definer, switched to SECURITY INVOKER in 397 -- pinned_at is not deleted_at, so the exec_nlq_sessions_update policy admits exactly the rows the body already filtered to. Keep it invoker.';

COMMENT ON FUNCTION public.set_nlq_thread_archived(uuid, boolean) IS
  'Archives or unarchives a Haven Insight thread the caller owns. COL-37 ruling: incidental definer, switched to SECURITY INVOKER in 397 -- same shape as set_nlq_thread_pinned against the exec_nlq_sessions_update policy. No caller in src/ today; the sidebar filters archived_at directly. Keep it invoker.';

COMMENT ON FUNCTION public.search_nlq_threads(text, integer) IS
  'Full-text search across the caller''s readable Haven Insight messages, returning session ids. COL-37 ruling: incidental definer, switched to SECURITY INVOKER in 397 -- exec_nlq_messages_select and exec_nlq_sessions_select already scope reads to the caller''s organization and to sessions they own or that are shared_with_org, which is what the body''s join asserts by hand. Keep it invoker.';

-- ---------------------------------------------------------------------------
-- Definers that are doing authorization work RLS cannot
-- ---------------------------------------------------------------------------
-- The soft delete writes deleted_at = now(), and exec_nlq_sessions_update's
-- WITH CHECK requires deleted_at IS NULL. As an invoker this function would be
-- refused by the policy protecting the row it is allowed to retire. The body
-- still checks owner/org_admin, organization and user_id = auth.uid() first.

CREATE OR REPLACE FUNCTION public.delete_nlq_thread(p_session_id uuid)
RETURNS public.exec_nlq_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.exec_nlq_sessions%ROWTYPE;
BEGIN
  IF COALESCE(haven.app_role()::text, '') NOT IN ('owner', 'org_admin') THEN
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

COMMENT ON FUNCTION public.delete_nlq_thread(uuid) IS
  'Soft-deletes a Haven Insight thread the caller owns. COL-37 ruling: definer required -- the update sets deleted_at, and the exec_nlq_sessions_update policy''s WITH CHECK requires deleted_at IS NULL, so an invoker would be refused by row-level security. Ownership (organization_id, user_id = auth.uid()) and owner/org_admin are checked in the body before the write.';

-- exec_nlq_messages has a SELECT policy and no UPDATE policy at all, so an
-- invoker write matches zero rows and loses the feedback silently. The AFTER
-- trigger tr_exec_nlq_messages_touch_session runs a SECURITY INVOKER function
-- that updates exec_nlq_sessions, which caregiver and family -- both allowed to
-- leave feedback here -- cannot update under exec_nlq_sessions_update.

CREATE OR REPLACE FUNCTION public.set_nlq_message_feedback(p_message_id uuid, p_feedback text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_feedback IS NOT NULL AND p_feedback NOT IN ('positive', 'negative') THEN
    RAISE EXCEPTION 'invalid_feedback' USING ERRCODE = '22023';
  END IF;

  -- See ROAD-03 note in 277 re: enum reachability.
  IF COALESCE(haven.app_role()::text, '') NOT IN (
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

COMMENT ON FUNCTION public.set_nlq_message_feedback(uuid, text) IS
  'Records thumbs up/down on an assistant message in a thread the caller owns. COL-37 ruling: definer required -- public.exec_nlq_messages carries a SELECT policy and no UPDATE policy, so an invoker write would silently match zero rows, and the AFTER trigger haven_exec_nlq_messages_touch_session is SECURITY INVOKER and updates exec_nlq_sessions, which the caregiver and family roles allowed here cannot update. Ownership is checked in the body.';

-- public.incident_sequences policies admit owner, org_admin, facility_admin and
-- nurse. allocate_incident_number deliberately admits caregiver as well,
-- because /incident-draft is the caregiver surface that files an incident, and a
-- caregiver must be able to draw a number without holding write on the counter
-- table. It also reads public.incidents to recover the highest number already
-- issued, which under caller RLS would be the caller's visible subset and would
-- hand out a duplicate. Its own guard is already enum-typed, so it is unaffected
-- by the defect above.
COMMENT ON FUNCTION public.allocate_incident_number(uuid) IS
  'Draws the next facility incident number. COL-37 ruling: definer required -- public.incident_sequences admits only owner/org_admin/facility_admin/nurse under RLS, while caregivers file incidents from /incident-draft, and the max-so-far scan over public.incidents must see every incident or it reissues a number. The body checks auth.uid(), haven.app_role(), the organization and haven.accessible_facility_ids() before writing. Do not switch to invoker without first giving caregivers a policy on incident_sequences.';

-- public.vendor_po_sequences has RLS enabled and no policies whatsoever, so no
-- request role can read or write it by any path. This function is the counter's
-- only door, and it checks the caller before opening it.
COMMENT ON FUNCTION public.allocate_vendor_po_number(uuid) IS
  'Draws the next organization purchase-order number. COL-37 ruling: definer required -- public.vendor_po_sequences has RLS enabled and no policies at all, so no request role can advance the counter directly and this function is its only door. The body checks auth.uid(), the organization and owner/org_admin/facility_admin before writing.';

-- ---------------------------------------------------------------------------
-- Nothing signed in should be able to call these at all
-- ---------------------------------------------------------------------------
-- 394 added five BEFORE/AFTER trigger functions for care-plan review alerts and
-- kept the default EXECUTE grant to PUBLIC, anon, authenticated and
-- service_role. PL/pgSQL refuses a trigger function called as an ordinary
-- function, so this is not an open write path into care_plan_review_alerts; it
-- is the same oversight 389 found in the payroll guards -- definer surface
-- granted to request roles that no request role has any use for, which is what
-- the advisor counts. Caught here within minutes of 394 reaching production,
-- because section 7 of the probe now fails on an unruled definer. Triggers fire
-- on the table owner's
-- authority and do not re-check EXECUTE (proven in section 4 of the probe), so
-- the care-plan alert path loses nothing. Same treatment as haven.guard_* in
-- 349, 353, 354, 359-361, 368, 369, 374, 386 and 389.
REVOKE ALL ON FUNCTION
  public.care_plan_alert_on_condition_change(),
  public.care_plan_alert_on_form_1823(),
  public.care_plan_alert_on_incident(),
  public.care_plan_alert_on_resident_change(),
  public.care_plan_alerts_resolve_on_activation()
  FROM PUBLIC, anon, authenticated, service_role;

-- Already ruled in 389; restated here so it carries the same marker the probe
-- looks for and does not read as unruled.
COMMENT ON FUNCTION public.haven_assert_authorized_request() IS
  'PostgREST pgrst.db_pre_request hook (326/329). COL-37 ruling: definer required and the anon grant must stay -- PostgREST runs this as the request role before every request, anonymous ones included, so a revoke refuses the whole API. Returns void, discloses nothing when called directly. Advisor exception -- do not revoke.';

-- Six functions were replaced and four changed security mode, so PostgREST's
-- cached view of the API is stale.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback must be a separately reviewed forward migration. Restoring SECURITY
-- DEFINER on the four invoker functions would also need a reason recorded in
-- their comments, and section 8 of the COL-37 probe fails until it is. Do not
-- restore the COALESCE(haven.app_role(), '') guard in any form -- section 9
-- refuses it.
