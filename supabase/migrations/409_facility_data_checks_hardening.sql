-- COL-437, COL-439, COL-440, COL-441, COL-442: make the facility data checks
-- mean what migration 407 said they meant.
--
-- Four corrections, all found by an independent review of PR #568. None of the
-- four tables has ever held a row on staging or production, so nothing here has
-- to preserve an existing artefact.
--
-- 1. COL-437. staff_check_state read the profile half of every identity through
--    RLS. A facility_admin can only see a profile that still holds an unrevoked
--    grant to a facility they can reach -- so the instant an offboard revokes
--    the grant and leaves the login alive, the profile vanished from the read
--    model and the screen reported the identity as resolved. The definer close
--    function recounted RLS-free, saw the fix open, and refused. The walk could
--    never be closed and the screen could not say why.
--
-- 2. COL-439. The append-only trigger was on the two results tables only. The
--    sessions tables carried the audit trigger and nothing else, and hosted
--    Supabase grants UPDATE and DELETE on every new public table to anon,
--    authenticated and service_role by default privilege. service_role also
--    bypasses RLS. A closed walk is the evidence artefact this feature exists
--    to produce; it was editable outside its close function.
--
-- 3. COL-441. Both close functions read the session row before checking the
--    caller's grant, so "exists but not yours" and "does not exist" were
--    distinguishable.
--
-- 4. COL-442. facility_data_health answered a caller with no grant with one row
--    of zeros. "You cannot see this facility" rendered as "this facility is
--    clean".
--
-- COL-438 (two identity counts are organization-wide on a per-facility panel)
-- is deliberately NOT addressed here. It is a product decision about what the
-- panel is counting, and it is waiting on a ruling.
BEGIN;

-- ---------------------------------------------------------------------------
-- COL-437: the profile half of a staff check subject, read without RLS
-- ---------------------------------------------------------------------------

-- The same line haven.facility_identity_health already crosses, drawn as
-- narrowly as the read model allows: only the identities this one session is
-- about, and only the four profile columns the check reasons over.
CREATE FUNCTION haven.staff_check_subject_profiles (p_session_id uuid)
  RETURNS TABLE (
    profile_id uuid,
    profile_email text,
    profile_is_active boolean,
    profile_deleted_at timestamptz,
    profile_last_login_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $function$
  -- The session has to be one the caller could have read for themselves. This
  -- restates the three checks staff_check_sessions' SELECT policy applies,
  -- because a definer function does not inherit them.
  WITH session AS (
    SELECT
      s.id,
      s.organization_id,
      s.facility_id
    FROM
      public.staff_check_sessions s
    WHERE
      s.id = p_session_id
      AND s.organization_id = haven.organization_id ()
      AND haven.can_run_staff_check ()
      AND haven.has_facility_access (s.facility_id)
)
SELECT
  up.id,
  up.email,
  up.is_active,
  up.deleted_at,
  up.last_login_at
FROM
  public.user_profiles up
  JOIN session ON session.organization_id = up.organization_id
WHERE
  -- Exactly the subject set staff_check_state builds: a staff record at the
  -- session's facility, or a profile still granted access to it. A profile
  -- with neither is not part of this check and is not returned.
  EXISTS (
    SELECT
      1
    FROM
      public.staff st
    WHERE
      st.user_id = up.id
      AND st.facility_id = session.facility_id
      AND st.deleted_at IS NULL)
  OR EXISTS (
    SELECT
      1
    FROM
      public.user_facility_access ufa
    WHERE
      ufa.user_id = up.id
      AND ufa.facility_id = session.facility_id
      AND ufa.revoked_at IS NULL)
$function$;

REVOKE ALL ON FUNCTION haven.staff_check_subject_profiles (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.staff_check_subject_profiles (uuid) TO authenticated, service_role;

COMMENT ON FUNCTION haven.staff_check_subject_profiles (uuid) IS
'The profile half of every identity in one staff check session: is_active, deleted_at, last_login_at and email. COL-437. COL-37 ruling: definer required -- user_profiles RLS hides a profile whose facility grant has been revoked, which is precisely the half-finished offboard a staff check exists to find, so an invoker read reports the identity as resolved while the definer close function refuses to close the walk. The body restates the three checks staff_check_sessions'' SELECT policy applies (organization, haven.can_run_staff_check(), facility grant), and returns rows only for identities already in this session''s subject set -- a staff record at the session facility, or a live grant to it.';

-- staff_check_state, with the RLS-blind LEFT JOIN on user_profiles replaced by
-- the definer reader above. Nothing else about the function changes: the
-- subject set, the duplicate rules, the fix_open matrix and the ordering are
-- all migration 407's.
CREATE OR REPLACE FUNCTION public.staff_check_state (p_session_id uuid)
  RETURNS TABLE (
    subject_user_profile_id uuid,
    subject_staff_id uuid,
    display_name text,
    role_label text,
    facility_grant_count integer,
    last_sign_in_at timestamptz,
    is_active boolean,
    duplicate_candidate_user_profile_ids uuid[],
    duplicate_candidate_staff_ids uuid[],
    duplicate_candidate_count integer,
    latest_result text,
    duplicate_of_user_profile_id uuid,
    duplicate_of_staff_id uuid,
    unmarked boolean,
    fix_open boolean)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public
  AS $function$
  WITH session AS (
    SELECT
      s.id,
      s.organization_id,
      s.facility_id
    FROM
      public.staff_check_sessions s
    WHERE
      s.id = p_session_id
),
-- Every staff record at the facility, plus every profile still granted access
-- to it. A person with both appears once, keyed on the staff.user_id link.
staff_subjects AS (
  SELECT
    st.user_id AS profile_id,
    st.id AS staff_id,
    btrim(st.first_name || ' ' || st.last_name) AS display_name,
    st.staff_role::text AS role_label,
    (st.employment_status::text NOT IN ('terminated', 'suspended')
      AND st.deleted_at IS NULL) AS active
  FROM
    public.staff st
    JOIN session ON session.facility_id = st.facility_id
  WHERE
    st.deleted_at IS NULL
),
profile_subjects AS (
  SELECT
    up.id AS profile_id,
    NULL::uuid AS staff_id,
    up.full_name AS display_name,
    up.app_role::text AS role_label,
    (up.is_active
      AND up.deleted_at IS NULL) AS active
  FROM
    public.user_profiles up
    JOIN session ON session.organization_id = up.organization_id
  WHERE
    up.deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        public.user_facility_access ufa
      WHERE
        ufa.user_id = up.id
        AND ufa.facility_id = (
          SELECT
            facility_id
          FROM
            session)
        AND ufa.revoked_at IS NULL)
    AND NOT EXISTS (
      SELECT
        1
      FROM
        staff_subjects ss
      WHERE
        ss.profile_id = up.id)
),
subjects AS (
  SELECT
    *
  FROM
    staff_subjects
  UNION ALL
  SELECT
    *
  FROM
    profile_subjects
),
-- COL-437. Read through the definer helper, not through user_profiles: an
-- offboard that revokes the facility grant while leaving the login alive puts
-- the profile out of this caller's reach, and that is the exact state a staff
-- check has to report.
subject_profiles AS (
  SELECT
    *
  FROM
    haven.staff_check_subject_profiles (p_session_id)
),
-- Live sign-in and profile state, when the subject has a profile at all. A
-- staff row with no user_id cannot sign in and is left null, not false.
subject_state AS (
  SELECT
    sub.profile_id,
    sub.staff_id,
    sub.display_name,
    sub.role_label,
    up.profile_last_login_at AS last_login_at,
    -- Active means "can still act": either half being live keeps it true, which
    -- is what makes a half-finished offboard show as an open fix.
    (sub.active
      OR (up.profile_id IS NOT NULL
        AND up.profile_is_active
        AND up.profile_deleted_at IS NULL)) AS is_active,
    (
      SELECT
        count(*)::integer
      FROM
        public.user_facility_access ufa
      WHERE
        ufa.user_id = sub.profile_id
        AND ufa.revoked_at IS NULL) AS facility_grant_count,
    haven.normalize_identity_text (coalesce(up.profile_email, st.email)) AS norm_email,
    haven.normalize_identity_text (sub.display_name) AS norm_name
  FROM
    subjects sub
    LEFT JOIN subject_profiles up ON up.profile_id = sub.profile_id
    LEFT JOIN public.staff st ON st.id = sub.staff_id
),
-- Suggested, never resolved. Three rules: the same normalized email, the same
-- auth user id on more than one staff row, or the same normalized name inside
-- one organization. Each one is a reason to look, not a reason to act.
candidates AS (
  SELECT
    a.profile_id,
    a.staff_id,
    -- The shared-auth-id rule matches on a.profile_id = b.profile_id, so without
    -- this filter an identity would list itself as its own candidate.
    array_remove(array_agg(DISTINCT b.profile_id)
      FILTER (WHERE b.profile_id IS DISTINCT FROM a.profile_id), NULL) AS candidate_profile_ids,
    array_remove(array_agg(DISTINCT b.staff_id)
      FILTER (WHERE b.staff_id IS DISTINCT FROM a.staff_id), NULL) AS candidate_staff_ids
  FROM
    subject_state a
    JOIN subject_state b ON (a.profile_id IS DISTINCT FROM b.profile_id
      OR a.staff_id IS DISTINCT FROM b.staff_id)
  WHERE (a.norm_email IS NOT NULL
    AND a.norm_email = b.norm_email)
  OR (a.profile_id IS NOT NULL
    AND a.profile_id = b.profile_id)
  OR (a.norm_name IS NOT NULL
    AND a.norm_name = b.norm_name)
GROUP BY
  a.profile_id,
  a.staff_id
),
latest AS (
  SELECT DISTINCT ON (r.subject_user_profile_id, r.subject_staff_id)
    r.subject_user_profile_id,
    r.subject_staff_id,
    r.sequence,
    r.result,
    r.duplicate_of_user_profile_id,
    r.duplicate_of_staff_id
  FROM
    public.staff_check_results r
  WHERE
    r.session_id = p_session_id
  ORDER BY
    r.subject_user_profile_id,
    r.subject_staff_id,
    r.sequence DESC
)
SELECT
  ss.profile_id,
  ss.staff_id,
  ss.display_name,
  ss.role_label,
  ss.facility_grant_count,
  ss.last_login_at,
  ss.is_active,
  coalesce(c.candidate_profile_ids, '{}'::uuid[]),
  coalesce(c.candidate_staff_ids, '{}'::uuid[]),
  (coalesce(array_length(c.candidate_profile_ids, 1), 0)
    + coalesce(array_length(c.candidate_staff_ids, 1), 0))::integer,
  latest.result,
  latest.duplicate_of_user_profile_id,
  latest.duplicate_of_staff_id,
  latest.result IS NULL,
  CASE latest.result
  WHEN 'keep' THEN
    FALSE
  WHEN 'deactivate' THEN
    ss.is_active
  WHEN 'duplicate_of' THEN
    ss.is_active
  ELSE
    FALSE
  END
FROM
  subject_state ss
  LEFT JOIN candidates c ON c.profile_id IS NOT DISTINCT FROM ss.profile_id
    AND c.staff_id IS NOT DISTINCT FROM ss.staff_id
  LEFT JOIN latest ON latest.subject_user_profile_id IS NOT DISTINCT FROM ss.profile_id
    AND latest.subject_staff_id IS NOT DISTINCT FROM ss.staff_id
ORDER BY
  ss.display_name,
  ss.staff_id
$function$;

COMMENT ON FUNCTION public.staff_check_state (uuid) IS
'One row per identity with live access to the session facility, with duplicate candidates suggested and fix_open computed from whether the subject can still act. The profile half is read through haven.staff_check_subject_profiles() so a revoked grant cannot hide the half-finished offboard from the screen while the close function still sees it. COL-361, COL-437.';

-- ---------------------------------------------------------------------------
-- COL-439: a session closes once, forward, and only at zero open items
-- ---------------------------------------------------------------------------

-- The results tables get a flat refusal (migration 407). The sessions tables
-- cannot: closing one is an UPDATE. So this states, as a table rule rather than
-- as a property of one function, what closing is allowed to mean.
--
-- The close precondition is repeated here on purpose. Without it any path
-- holding UPDATE -- on hosted Supabase that is service_role, which also
-- bypasses RLS -- could stamp closed_at on a walk with unmarked beds and
-- manufacture evidence of a reconciliation that never happened. The close
-- functions check first and raise P0001 with the counts, so a caller who came
-- through the front door never reaches this message.
CREATE FUNCTION haven.facility_check_session_close_only ()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $function$
DECLARE
  v_unmarked integer;
  v_open integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Facility check sessions cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
    OR NEW.started_by IS DISTINCT FROM OLD.started_by
    OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'Only closed_at and closed_by may change on a facility check session'
      USING ERRCODE = '42501';
  END IF;

  -- Closing is a one-way door. Reopening a closed walk, or re-stamping who
  -- closed it and when, would leave the artefact meaning nothing.
  IF OLD.closed_at IS NOT NULL THEN
    IF NEW.closed_at IS DISTINCT FROM OLD.closed_at
      OR NEW.closed_by IS DISTINCT FROM OLD.closed_by THEN
      RAISE EXCEPTION 'A closed facility check session cannot be reopened or re-stamped'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.closed_at IS NULL THEN
    IF NEW.closed_by IS DISTINCT FROM OLD.closed_by THEN
      RAISE EXCEPTION 'closed_by cannot be set while a facility check session is open'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'board_check_sessions' THEN
    SELECT count(*) FILTER (WHERE unmarked), count(*) FILTER (WHERE fix_open)
      INTO v_unmarked, v_open
      FROM public.board_check_state (NEW.id);
  ELSE
    SELECT count(*) FILTER (WHERE unmarked), count(*) FILTER (WHERE fix_open)
      INTO v_unmarked, v_open
      FROM public.staff_check_state (NEW.id);
  END IF;

  IF v_unmarked > 0 OR v_open > 0 THEN
    RAISE EXCEPTION 'A facility check session closes only at zero open items (% unmarked, % open)', v_unmarked, v_open
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION haven.facility_check_session_close_only () FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION haven.facility_check_session_close_only () IS
'Refuses DELETE on a facility check session, allows UPDATE only for the closed_at/closed_by NULL to non-NULL transition with every other column unchanged, and re-checks the zero-open-items precondition so the close rule belongs to the table rather than only to close_board_check_session()/close_staff_check_session(). COL-439.';

CREATE TRIGGER tr_board_check_sessions_close_only
  BEFORE UPDATE OR DELETE ON public.board_check_sessions
  FOR EACH ROW
  EXECUTE FUNCTION haven.facility_check_session_close_only ();

CREATE TRIGGER tr_staff_check_sessions_close_only
  BEFORE UPDATE OR DELETE ON public.staff_check_sessions
  FOR EACH ROW
  EXECUTE FUNCTION haven.facility_check_session_close_only ();

-- Supabase bootstraps `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON
-- TABLES TO anon, authenticated, service_role`, so migration 407's
-- GRANT SELECT, INSERT added nothing and removed nothing: on production all
-- four tables carry UPDATE and DELETE for all three roles. The grant layer is
-- the only layer service_role is subject to, so say it explicitly. TRUNCATE is
-- in the list because it would empty a table without firing a row trigger.
REVOKE UPDATE, DELETE, TRUNCATE ON public.board_check_sessions FROM anon, authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.board_check_results FROM anon, authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.staff_check_sessions FROM anon, authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.staff_check_results FROM anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- COL-441: one answer for "not yours" and "not there"
-- ---------------------------------------------------------------------------

-- Both close functions read the session row first and raised 42704 before ever
-- testing the caller's grant, so the two outcomes were distinguishable. The
-- grant test now sits in the lookup and both paths converge on 42501. Nothing
-- else about either function changes; the already-closed and P0001 messages
-- are reachable only after authorization has passed and the screen needs them.
CREATE OR REPLACE FUNCTION public.close_board_check_session (p_session_id uuid)
  RETURNS public.board_check_sessions
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $function$
DECLARE
  v_session public.board_check_sessions;
  v_unmarked integer;
  v_open integer;
BEGIN
  SELECT * INTO v_session
    FROM public.board_check_sessions
    WHERE id = p_session_id
      AND organization_id = haven.organization_id ()
      AND facility_id IN (SELECT haven.accessible_facility_ids ());
  IF NOT FOUND OR NOT haven.can_run_board_check () THEN
    RAISE EXCEPTION 'Board check session not found or not permitted' USING ERRCODE = '42501';
  END IF;

  IF v_session.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Board check is already closed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) FILTER (WHERE unmarked), count(*) FILTER (WHERE fix_open)
    INTO v_unmarked, v_open
    FROM public.board_check_state (p_session_id);

  IF v_unmarked > 0 OR v_open > 0 THEN
    RAISE EXCEPTION 'Board check has % unmarked bed(s) and % open fix(es)', v_unmarked, v_open
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.board_check_sessions
  SET closed_at = now(), closed_by = auth.uid ()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END
$function$;

CREATE OR REPLACE FUNCTION public.close_staff_check_session (p_session_id uuid)
  RETURNS public.staff_check_sessions
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $function$
DECLARE
  v_session public.staff_check_sessions;
  v_unmarked integer;
  v_open integer;
BEGIN
  SELECT * INTO v_session
    FROM public.staff_check_sessions
    WHERE id = p_session_id
      AND organization_id = haven.organization_id ()
      AND facility_id IN (SELECT haven.accessible_facility_ids ());
  IF NOT FOUND OR NOT haven.can_run_staff_check () THEN
    RAISE EXCEPTION 'Staff check session not found or not permitted' USING ERRCODE = '42501';
  END IF;

  IF v_session.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Staff check is already closed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) FILTER (WHERE unmarked), count(*) FILTER (WHERE fix_open)
    INTO v_unmarked, v_open
    FROM public.staff_check_state (p_session_id);

  IF v_unmarked > 0 OR v_open > 0 THEN
    RAISE EXCEPTION 'Staff check has % unresolved identity(ies) and % open fix(es)', v_unmarked, v_open
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.staff_check_sessions
  SET closed_at = now(), closed_by = auth.uid ()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END
$function$;

COMMENT ON FUNCTION public.close_board_check_session (uuid) IS
'Closes a board check only when board_check_state reports zero unmarked beds and zero open fixes. Raises with both counts otherwise. COL-361, COL-441. COL-37 ruling: definer required -- board_check_sessions deliberately has no UPDATE policy, so closing a walk cannot be reachable as the caller; this is the only write path to closed_at. The lookup itself carries the three checks the SELECT policy applies (organization, haven.can_run_board_check(), facility grant), so the function never reads a session the caller could not already read, and an unreachable session is indistinguishable from one that does not exist.';

COMMENT ON FUNCTION public.close_staff_check_session (uuid) IS
'Closes a staff check only when staff_check_state reports zero unresolved identities and zero open fixes. Raises with both counts otherwise. COL-361, COL-441. COL-37 ruling: definer required -- staff_check_sessions deliberately has no UPDATE policy, so closing a check cannot be reachable as the caller; this is the only write path to closed_at. The lookup itself carries the three checks the SELECT policy applies (organization, haven.can_run_staff_check(), facility grant), so the function never reads a session the caller could not already read, and an unreachable session is indistinguishable from one that does not exist.';

-- ---------------------------------------------------------------------------
-- COL-442: "you cannot see this" must not render as "this facility is clean"
-- ---------------------------------------------------------------------------

-- Every count in this function is gated by a facility CTE, and every one of
-- them collapsed to 0 for a caller with no grant -- but the outer statement is
-- a list of scalar subqueries with no FROM, so it still returned one row. Eight
-- reassuring zeros for a facility the caller was never scoped to. Haven has
-- already shipped one scope-drift bug (COL-406); this is the failure mode that
-- would have hidden the next one.
--
-- plpgsql only so the guard can raise. The query below is migration 407's,
-- unchanged.
CREATE OR REPLACE FUNCTION public.facility_data_health (p_facility_id uuid)
  RETURNS TABLE (
    beds_occupied_with_no_resident integer,
    residents_holding_no_bed integer,
    beds_with_two_residents integer,
    roster_census integer,
    stand_up_census integer,
    stand_up_week_start date,
    staff_inactive_can_still_sign_in integer,
    active_profiles_with_no_grant integer,
    duplicate_identity_candidates integer,
    last_board_check_closed_at timestamptz,
    last_staff_check_closed_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path = public
  AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.facilities f
    WHERE
      f.id = p_facility_id
      AND f.deleted_at IS NULL
      AND f.organization_id = haven.organization_id ()
      AND haven.has_facility_access (p_facility_id)) THEN
    RAISE EXCEPTION 'Data health is not available for this facility'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY WITH facility AS (
    SELECT
      f.id,
      f.organization_id
    FROM
      public.facilities f
    WHERE
      f.id = p_facility_id
      AND f.deleted_at IS NULL
),
  held AS (
    SELECT
      res.bed_id,
      count(*)::integer AS holders
    FROM
      public.residents res
      JOIN public.beds b ON b.id = res.bed_id
      JOIN facility ON facility.id = b.facility_id
    WHERE
      res.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND haven.resident_status_holds_bed (res.status)
    GROUP BY
      res.bed_id
),
  identity_health AS (
    SELECT
      *
    FROM
      haven.facility_identity_health (p_facility_id)
),
  stand_up AS (
    SELECT
      c.census,
      c.week_start
    FROM
      haven.facility_stand_up_census (p_facility_id) c
)
  SELECT
    (
      SELECT
        count(*)::integer
      FROM
        public.beds b
        JOIN facility ON facility.id = b.facility_id
      WHERE
        b.deleted_at IS NULL
        AND b.status = 'occupied'
        AND NOT EXISTS (
          SELECT
            1
          FROM
            held
          WHERE
            held.bed_id = b.id)),
    (
      SELECT
        count(*)::integer
      FROM
        public.residents res
        JOIN facility ON facility.id = res.facility_id
      WHERE
        res.deleted_at IS NULL
        AND haven.resident_status_holds_bed (res.status)
        AND res.bed_id IS NULL),
    (
      SELECT
        count(*)::integer
      FROM
        held
      WHERE
        held.holders > 1),
    (
      SELECT
        count(*)::integer
      FROM
        public.residents res
        JOIN facility ON facility.id = res.facility_id
      WHERE
        res.deleted_at IS NULL
        AND haven.resident_status_holds_bed (res.status)),
    (
      SELECT
        census
      FROM
        stand_up),
    (
      SELECT
        week_start
      FROM
        stand_up),
    -- Qualified: these three CTE columns share their names with this
    -- function's OUT parameters, which plpgsql resolves as variables.
    (
      SELECT
        identity_health.staff_inactive_can_still_sign_in
      FROM
        identity_health),
    (
      SELECT
        identity_health.active_profiles_with_no_grant
      FROM
        identity_health),
    (
      SELECT
        identity_health.duplicate_identity_candidates
      FROM
        identity_health),
    (
      SELECT
        max(s.closed_at)
      FROM
        public.board_check_sessions s
        JOIN facility ON facility.id = s.facility_id
      WHERE
        s.closed_at IS NOT NULL),
    (
      SELECT
        max(s.closed_at)
      FROM
        public.staff_check_sessions s
        JOIN facility ON facility.id = s.facility_id
      WHERE
        s.closed_at IS NOT NULL);
END
$function$;

COMMENT ON FUNCTION public.facility_data_health (uuid) IS
'Live anomaly counts for one facility. Roster census and Stand Up census are reported side by side without judgement: they measure different moments and neither is authoritative over the other. Raises 42501 rather than answering a caller with no grant to the facility, because a row of zeros would read as "this facility is clean". COL-361, COL-442.';

NOTIFY pgrst, 'reload schema';

COMMIT;
