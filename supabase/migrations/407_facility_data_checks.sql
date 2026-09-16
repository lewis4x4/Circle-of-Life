-- COL-361: prove the roster matches the board, and prove the staff list is the staff.
--
-- A facility's physical census board is the source of truth for who sleeps in
-- which bed. Haven is not. Homewood reads 36 licensed, 25 census and 11 ready to
-- assign after COL-367; the September 7 Stand Up reported 34. The correction is
-- human work through the admit, discharge, room-move, bed-hold and offboard
-- flows that already exist. What did not exist was a way to prove it happened.
--
-- These tables record a walk, not a state. Every bed in the facility gets one
-- result per session; whether that result still needs work is computed live from
-- residents and beds every time the state function runs, never stored and never
-- ticked. A session closes only when the database agrees that nothing is left.
--
-- Nothing here is facility specific.
BEGIN;

-- ---------------------------------------------------------------------------
-- Board Check
-- ---------------------------------------------------------------------------

CREATE TABLE public.board_check_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  started_by uuid NOT NULL REFERENCES public.user_profiles (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES public.user_profiles (id),
  closed_at timestamptz
);

COMMENT ON TABLE public.board_check_sessions IS
'One facility walk comparing the physical census board against Haven. Closed only by close_board_check_session(). COL-361.';

CREATE INDEX idx_board_check_sessions_facility
  ON public.board_check_sessions (facility_id, started_at DESC);

-- One walk at a time. Two open sessions would let two people mark the same bed
-- into different sessions and both close.
CREATE UNIQUE INDEX idx_board_check_sessions_one_open
  ON public.board_check_sessions (facility_id)
  WHERE closed_at IS NULL;

CREATE TABLE public.board_check_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The total order of marks. now() is the transaction timestamp, so two marks
  -- recorded in one transaction share it and "the newest row wins" would fall
  -- back to comparing random uuids. This is what "newest" actually means.
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  session_id uuid NOT NULL REFERENCES public.board_check_sessions (id),
  bed_id uuid NOT NULL REFERENCES public.beds (id),
  result text NOT NULL CHECK (result IN (
    'match',
    'board_empty_haven_occupied',
    'board_occupied_haven_empty',
    'different_occupant',
    'bed_not_on_board')),
  -- What Haven said at the moment the bed was marked. 'different_occupant' is
  -- resolved by comparing the bed's resident now against this snapshot, so a
  -- swap to a third person still counts as resolved.
  haven_resident_id_at_mark uuid,
  haven_resident_status_at_mark text,
  recorded_by uuid NOT NULL REFERENCES public.user_profiles (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.board_check_results IS
'Append-only marks from a board walk. The newest row per (session, bed) is the current result; older rows are history, not corrections. COL-361.';

CREATE INDEX idx_board_check_results_latest
  ON public.board_check_results (session_id, bed_id, sequence DESC);

CREATE INDEX idx_board_check_results_org
  ON public.board_check_results (organization_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Staff Check
-- ---------------------------------------------------------------------------

CREATE TABLE public.staff_check_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  started_by uuid NOT NULL REFERENCES public.user_profiles (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES public.user_profiles (id),
  closed_at timestamptz
);

COMMENT ON TABLE public.staff_check_sessions IS
'One pass over every identity with live access to a facility. Closed only by close_staff_check_session(). COL-361.';

CREATE INDEX idx_staff_check_sessions_facility
  ON public.staff_check_sessions (facility_id, started_at DESC);

CREATE UNIQUE INDEX idx_staff_check_sessions_one_open
  ON public.staff_check_sessions (facility_id)
  WHERE closed_at IS NULL;

CREATE TABLE public.staff_check_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  session_id uuid NOT NULL REFERENCES public.staff_check_sessions (id),
  subject_user_profile_id uuid REFERENCES public.user_profiles (id),
  subject_staff_id uuid REFERENCES public.staff (id),
  result text NOT NULL CHECK (result IN ('keep', 'deactivate', 'duplicate_of')),
  duplicate_of_user_profile_id uuid REFERENCES public.user_profiles (id),
  duplicate_of_staff_id uuid REFERENCES public.staff (id),
  recorded_by uuid NOT NULL REFERENCES public.user_profiles (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT staff_check_results_subject_present
    CHECK (subject_user_profile_id IS NOT NULL OR subject_staff_id IS NOT NULL),
  -- 'duplicate_of' names a target and the other two results do not. Written as
  -- an equivalence so neither half can drift from the other.
  CONSTRAINT staff_check_results_duplicate_target
    CHECK ((result = 'duplicate_of')
      = (duplicate_of_user_profile_id IS NOT NULL OR duplicate_of_staff_id IS NOT NULL))
);

COMMENT ON TABLE public.staff_check_results IS
'Append-only decisions from a staff check: keep, deactivate, or duplicate of another identity. Naming a duplicate never moves data between identities. COL-361.';

CREATE INDEX idx_staff_check_results_latest
  ON public.staff_check_results (session_id, subject_user_profile_id, subject_staff_id, sequence DESC);

CREATE INDEX idx_staff_check_results_org
  ON public.staff_check_results (organization_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Append only, enforced in the database
-- ---------------------------------------------------------------------------

-- A result is superseded by a newer result, never rewritten. Without this the
-- owner role could quietly edit a mark and the closed session would stop being
-- evidence of anything.
CREATE FUNCTION haven.facility_check_result_immutable ()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $function$
BEGIN
  RAISE EXCEPTION 'Facility check results are append only'
    USING ERRCODE = '42501';
END
$function$;

REVOKE ALL ON FUNCTION haven.facility_check_result_immutable () FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_board_check_results_append_only
  BEFORE UPDATE OR DELETE ON public.board_check_results
  FOR EACH ROW
  EXECUTE FUNCTION haven.facility_check_result_immutable ();

CREATE TRIGGER tr_staff_check_results_append_only
  BEFORE UPDATE OR DELETE ON public.staff_check_results
  FOR EACH ROW
  EXECUTE FUNCTION haven.facility_check_result_immutable ();

CREATE TRIGGER tr_board_check_sessions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.board_check_sessions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_board_check_results_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.board_check_results
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_staff_check_sessions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_check_sessions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_staff_check_results_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_check_results
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

-- ---------------------------------------------------------------------------
-- Who may run a check
-- ---------------------------------------------------------------------------

-- Board Check is reconciliation work for whoever can admit and discharge: the
-- roles on clinical_staff_insert_residents (migration 013).
CREATE FUNCTION haven.can_run_board_check ()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = public
  AS $function$
  SELECT haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')
$function$;

-- Staff Check ends in a deactivation, so it takes the roles canOffboardStaff()
-- allows in src/lib/staff/staff-offboard.ts (COL-349).
CREATE FUNCTION haven.can_run_staff_check ()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = public
  AS $function$
  SELECT haven.app_role () IN ('owner', 'org_admin', 'facility_admin')
$function$;

GRANT EXECUTE ON FUNCTION haven.can_run_board_check () TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION haven.can_run_staff_check () TO authenticated, service_role;

-- The check's read model has to ask the same question migration 388's trigger
-- asks: does this resident's status hold a bed? Restating 'active, hospital_hold,
-- loa' in a second place is precisely the drift 388 was written to end, so the
-- read model calls the one definition instead. 388 revoked it from authenticated
-- along with the trigger function beside it; this grants back only this one.
-- It is IMMUTABLE, reads no table, and maps three enum values to a boolean, so
-- executing it discloses nothing. The trigger and its predicates are untouched.
GRANT EXECUTE ON FUNCTION haven.resident_status_holds_bed (public.resident_status) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS: select and insert only. No update or delete policy exists anywhere.
-- ---------------------------------------------------------------------------

ALTER TABLE public.board_check_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_check_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_check_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_check_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY board_check_roles_see_sessions_in_granted_facilities ON public.board_check_sessions
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND haven.can_run_board_check ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY board_check_roles_start_sessions_in_granted_facilities ON public.board_check_sessions
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.can_run_board_check ()
    AND started_by = auth.uid ()
    AND closed_at IS NULL
    AND closed_by IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY board_check_roles_see_results_in_granted_facilities ON public.board_check_results
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND haven.can_run_board_check ()
    AND EXISTS (
      SELECT
        1
      FROM
        public.board_check_sessions s
      WHERE
        s.id = board_check_results.session_id
        AND s.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())));

CREATE POLICY board_check_roles_record_results_in_open_sessions ON public.board_check_results
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.can_run_board_check ()
    AND recorded_by = auth.uid ()
    AND EXISTS (
      SELECT
        1
      FROM
        public.board_check_sessions s
      WHERE
        s.id = board_check_results.session_id
        AND s.closed_at IS NULL
        AND s.organization_id = board_check_results.organization_id
        AND s.facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
    -- The bed has to be in the session's facility. Otherwise a granted user
    -- could mark another facility's beds into this walk and close it clean.
    AND EXISTS (
      SELECT
        1
      FROM
        public.beds b
        JOIN public.board_check_sessions s ON s.id = board_check_results.session_id
      WHERE
        b.id = board_check_results.bed_id
        AND b.deleted_at IS NULL
        AND b.facility_id = s.facility_id));

CREATE POLICY staff_check_roles_see_sessions_in_granted_facilities ON public.staff_check_sessions
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND haven.can_run_staff_check ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY staff_check_roles_start_sessions_in_granted_facilities ON public.staff_check_sessions
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.can_run_staff_check ()
    AND started_by = auth.uid ()
    AND closed_at IS NULL
    AND closed_by IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY staff_check_roles_see_results_in_granted_facilities ON public.staff_check_results
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND haven.can_run_staff_check ()
    AND EXISTS (
      SELECT
        1
      FROM
        public.staff_check_sessions s
      WHERE
        s.id = staff_check_results.session_id
        AND s.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())));

CREATE POLICY staff_check_roles_record_results_in_open_sessions ON public.staff_check_results
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.can_run_staff_check ()
    AND recorded_by = auth.uid ()
    AND EXISTS (
      SELECT
        1
      FROM
        public.staff_check_sessions s
      WHERE
        s.id = staff_check_results.session_id
        AND s.closed_at IS NULL
        AND s.organization_id = staff_check_results.organization_id
        AND s.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())));

GRANT SELECT, INSERT ON public.board_check_sessions TO authenticated;
GRANT SELECT, INSERT ON public.board_check_results TO authenticated;
GRANT SELECT, INSERT ON public.staff_check_sessions TO authenticated;
GRANT SELECT, INSERT ON public.staff_check_results TO authenticated;

-- ---------------------------------------------------------------------------
-- Identity normalization, for duplicate candidates only
-- ---------------------------------------------------------------------------

-- Lowercase, trimmed, whitespace collapsed, diacritics removed. unaccent is not
-- installed on this project, so the fold is an explicit character map over the
-- Latin-1 and Latin Extended-A letters that appear in Florida staff names.
CREATE FUNCTION haven.normalize_identity_text (p_value text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = ''
  AS $function$
  SELECT nullif(
    btrim(
      regexp_replace(
        lower(
          translate(p_value,
          'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćČčĎďĐđĒēĖėĘęĚěĞğĪīĮįŁłŃńŇňŌōŐőŒœŔŕŘřŚśŞşŠšŢţŤťŪūŮůŰűŲųŸŹźŻżŽž',
            'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcDdDdEeEeEeEeGgIiIiLlNnNnOoOoOEoeRrRrSsSsSsTtTtUuUuUuUuYZzZzZz')),
        '\s+', ' ', 'g')),
    '')
$function$;

REVOKE ALL ON FUNCTION haven.normalize_identity_text (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.normalize_identity_text (text) TO authenticated, service_role;

COMMENT ON FUNCTION haven.normalize_identity_text (text) IS
'Lowercase, trim, collapse whitespace, fold diacritics. Used to suggest duplicate identity candidates. Never used to merge anything. COL-361.';

-- ---------------------------------------------------------------------------
-- Board check read model
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.board_check_state (p_session_id uuid)
  RETURNS TABLE (
    bed_id uuid,
    room_number text,
    bed_label text,
    room_sort_order integer,
    bed_status text,
    haven_resident_id uuid,
    haven_resident_status text,
    latest_result text,
    latest_recorded_at timestamptz,
    latest_recorded_by uuid,
    marked_resident_id uuid,
    unmarked boolean,
    fix_open boolean)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public
  AS $function$
  -- RLS on board_check_sessions decides whether the caller may see this walk at
  -- all; if it filters the session out, every join below yields nothing.
  WITH session AS (
    SELECT
      s.id,
      s.facility_id
    FROM
      public.board_check_sessions s
    WHERE
      s.id = p_session_id
),
facility_beds AS (
  SELECT
    b.id,
    r.room_number,
    b.bed_label,
    r.sort_order AS room_sort_order,
    b.status::text AS bed_status
  FROM
    public.beds b
    JOIN public.rooms r ON r.id = b.room_id
    JOIN session ON session.facility_id = b.facility_id
  WHERE
    b.deleted_at IS NULL
    AND r.deleted_at IS NULL
),
-- Who holds the bed right now. Same predicate migration 388's trigger uses, so
-- the check and the bed status can never disagree about what "occupied" means.
holder AS (
  SELECT
    res.bed_id,
    res.id AS resident_id,
    res.status::text AS resident_status
  FROM
    public.residents res
    JOIN facility_beds fb ON fb.id = res.bed_id
  WHERE
    res.deleted_at IS NULL
    AND haven.resident_status_holds_bed (res.status)
),
latest AS (
  SELECT DISTINCT ON (r.bed_id)
    r.bed_id,
    r.sequence,
    r.result,
    r.recorded_at,
    r.recorded_by,
    r.haven_resident_id_at_mark
  FROM
    public.board_check_results r
  WHERE
    r.session_id = p_session_id
  ORDER BY
    r.bed_id,
    r.sequence DESC
)
SELECT
  fb.id,
  fb.room_number,
  fb.bed_label,
  fb.room_sort_order,
  fb.bed_status,
  holder.resident_id,
  holder.resident_status,
  latest.result,
  latest.recorded_at,
  latest.recorded_by,
  latest.haven_resident_id_at_mark,
  latest.result IS NULL,
  CASE latest.result
  WHEN 'match' THEN
    FALSE
  WHEN 'board_empty_haven_occupied' THEN
    holder.resident_id IS NOT NULL
  WHEN 'board_occupied_haven_empty' THEN
    holder.resident_id IS NULL
  WHEN 'different_occupant' THEN
    holder.resident_id IS NOT DISTINCT FROM latest.haven_resident_id_at_mark
  WHEN 'bed_not_on_board' THEN
    fb.bed_status IN ('available', 'occupied')
  ELSE
    FALSE
  END
FROM
  facility_beds fb
  LEFT JOIN holder ON holder.bed_id = fb.id
  LEFT JOIN latest ON latest.bed_id = fb.id
ORDER BY
  fb.room_sort_order,
  fb.room_number,
  fb.bed_label
$function$;

COMMENT ON FUNCTION public.board_check_state (uuid) IS
'One row per bed in the session facility with its live Haven state, the latest mark, and whether a fix is still open. fix_open is computed here every call and is never stored. COL-361.';

GRANT EXECUTE ON FUNCTION public.board_check_state (uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Staff check read model
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.staff_check_state (p_session_id uuid)
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
-- Live sign-in and profile state, when the subject has a profile at all. A
-- staff row with no user_id cannot sign in and is left null, not false.
subject_state AS (
  SELECT
    sub.profile_id,
    sub.staff_id,
    sub.display_name,
    sub.role_label,
    up.last_login_at,
    -- Active means "can still act": either half being live keeps it true, which
    -- is what makes a half-finished offboard show as an open fix.
    (sub.active
      OR (up.id IS NOT NULL
        AND up.is_active
        AND up.deleted_at IS NULL)) AS is_active,
    (
      SELECT
        count(*)::integer
      FROM
        public.user_facility_access ufa
      WHERE
        ufa.user_id = sub.profile_id
        AND ufa.revoked_at IS NULL) AS facility_grant_count,
    haven.normalize_identity_text (coalesce(up.email, st.email)) AS norm_email,
    haven.normalize_identity_text (sub.display_name) AS norm_name
  FROM
    subjects sub
    LEFT JOIN public.user_profiles up ON up.id = sub.profile_id
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
'One row per identity with live access to the session facility, with duplicate candidates suggested and fix_open computed from whether the subject can still act. COL-361.';

GRANT EXECUTE ON FUNCTION public.staff_check_state (uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Closing a session
-- ---------------------------------------------------------------------------

-- security definer, because the session row has no UPDATE policy and must not
-- get one; the grant checks the policies would have applied are repeated here
-- by hand, since a definer function does not inherit them.
CREATE FUNCTION public.close_board_check_session (p_session_id uuid)
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
  SELECT * INTO v_session FROM public.board_check_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Board check session not found' USING ERRCODE = '42704';
  END IF;

  IF v_session.organization_id <> haven.organization_id ()
    OR NOT haven.can_run_board_check ()
    OR v_session.facility_id NOT IN (SELECT haven.accessible_facility_ids ()) THEN
    RAISE EXCEPTION 'Not permitted to close this board check' USING ERRCODE = '42501';
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

CREATE FUNCTION public.close_staff_check_session (p_session_id uuid)
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
  SELECT * INTO v_session FROM public.staff_check_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff check session not found' USING ERRCODE = '42704';
  END IF;

  IF v_session.organization_id <> haven.organization_id ()
    OR NOT haven.can_run_staff_check ()
    OR v_session.facility_id NOT IN (SELECT haven.accessible_facility_ids ()) THEN
    RAISE EXCEPTION 'Not permitted to close this staff check' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.close_board_check_session (uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_staff_check_session (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_board_check_session (uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_staff_check_session (uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.close_board_check_session (uuid) IS
'Closes a board check only when board_check_state reports zero unmarked beds and zero open fixes. Raises with both counts otherwise. COL-361. COL-37 ruling: definer required -- board_check_sessions deliberately has no UPDATE policy, so closing a walk cannot be reachable as the caller; this is the only write path to closed_at. The body restates the three checks the SELECT policy applies (organization, haven.can_run_board_check(), facility grant) before it writes, so it reaches no session the caller could not already read.';

COMMENT ON FUNCTION public.close_staff_check_session (uuid) IS
'Closes a staff check only when staff_check_state reports zero unresolved identities and zero open fixes. Raises with both counts otherwise. COL-361. COL-37 ruling: definer required -- staff_check_sessions deliberately has no UPDATE policy, so closing a check cannot be reachable as the caller; this is the only write path to closed_at. The body restates the three checks the SELECT policy applies (organization, haven.can_run_staff_check(), facility grant) before it writes, so it reaches no session the caller could not already read.';

-- ---------------------------------------------------------------------------
-- Data Health
-- ---------------------------------------------------------------------------

-- The three identity counts are about people RLS deliberately hides: a profile
-- with no facility grant is invisible to a facility_admin by definition, and a
-- finished offboard revokes the grant that made a staff member visible at all.
-- An invoker function would therefore report 0 for exactly the anomalies this
-- panel exists to surface. This reader crosses that line and nothing else: it
-- re-checks the caller's organization and facility grant, and returns three
-- integers. No name, no email, no id ever leaves it.
CREATE FUNCTION haven.facility_identity_health (p_facility_id uuid)
  RETURNS TABLE (
    staff_inactive_can_still_sign_in integer,
    active_profiles_with_no_grant integer,
    duplicate_identity_candidates integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $function$
  WITH facility AS (
    SELECT
      f.id,
      f.organization_id
    FROM
      public.facilities f
    WHERE
      f.id = p_facility_id
      AND f.deleted_at IS NULL
      AND f.organization_id = haven.organization_id ()
      AND haven.has_facility_access (p_facility_id)
),
identities AS (
  SELECT
    up.id,
    haven.normalize_identity_text (up.email) AS norm_email,
    haven.normalize_identity_text (up.full_name) AS norm_name
  FROM
    public.user_profiles up
    JOIN facility ON facility.organization_id = up.organization_id
  WHERE
    up.deleted_at IS NULL
),
duplicates AS (
  SELECT
    i.id
  FROM
    identities i
  WHERE
    EXISTS (
      SELECT
        1
      FROM
        identities j
      WHERE
        j.id <> i.id
        AND ((i.norm_email IS NOT NULL
            AND i.norm_email = j.norm_email)
          OR (i.norm_name IS NOT NULL
            AND i.norm_name = j.norm_name)))
  UNION
  SELECT
    st.user_id
  FROM
    public.staff st
    JOIN facility ON facility.organization_id = st.organization_id
  WHERE
    st.deleted_at IS NULL
    AND st.user_id IS NOT NULL
    AND EXISTS (
      SELECT
        1
      FROM
        public.staff other
      WHERE
        other.id <> st.id
        AND other.deleted_at IS NULL
        AND other.organization_id = st.organization_id
        AND other.user_id = st.user_id)
)
SELECT
  (
    SELECT
      count(*)::integer
    FROM
      public.staff st
      JOIN facility ON facility.id = st.facility_id
      JOIN public.user_profiles up ON up.id = st.user_id
    WHERE
      st.deleted_at IS NULL
      AND st.employment_status::text IN ('terminated', 'suspended')
      AND up.is_active
      AND up.deleted_at IS NULL),
  (
    SELECT
      count(*)::integer
    FROM
      public.user_profiles up
      JOIN facility ON facility.organization_id = up.organization_id
    WHERE
      up.deleted_at IS NULL
      AND up.is_active
      AND up.app_role NOT IN ('owner', 'org_admin', 'family', 'broker')
      AND NOT EXISTS (
        SELECT
          1
        FROM
          public.user_facility_access ufa
        WHERE
          ufa.user_id = up.id
          AND ufa.revoked_at IS NULL)),
  (
    SELECT
      count(*)::integer
    FROM
      duplicates)
$function$;

REVOKE ALL ON FUNCTION haven.facility_identity_health (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.facility_identity_health (uuid) TO authenticated, service_role;

COMMENT ON FUNCTION haven.facility_identity_health (uuid) IS
'Three identity anomaly counts for one granted facility. COL-361. COL-37 ruling: definer required -- every count here is about an identity that user_profiles RLS hides from a facility-scoped caller (no live grant, or a grant revoked by the offboard being audited), so an invoker reader would return 0 for precisely the anomalies the panel exists to surface. The body re-checks haven.organization_id() and haven.has_facility_access(), and returns three integers and nothing else.';


-- stand_up_reports is REVOKEd from authenticated (migration 336), so an invoker
-- function cannot read the census that the roster has to be compared against.
-- This definer reader exists only to cross that line, and it re-checks the
-- caller's organization and facility grant itself rather than inheriting one.
-- It returns two numbers and a week, never a report body.
CREATE FUNCTION haven.facility_stand_up_census (p_facility_id uuid)
  RETURNS TABLE (
    census integer,
    week_start date)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $function$
  SELECT
    (sr."values" ->> 'current_total_census')::integer,
    sr.week_start
  FROM
    public.stand_up_reports sr
    JOIN public.facilities f ON f.id = sr.facility_id
  WHERE
    sr.facility_id = p_facility_id
    AND f.organization_id = haven.organization_id ()
    AND haven.has_facility_access (p_facility_id)
    AND sr."values" ->> 'current_total_census' IS NOT NULL
  ORDER BY
    sr.week_start DESC
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION haven.facility_stand_up_census (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.facility_stand_up_census (uuid) TO authenticated, service_role;

COMMENT ON FUNCTION haven.facility_stand_up_census (uuid) IS
'The most recent Stand Up current_total_census for one granted facility, and its week. COL-361. COL-37 ruling: definer required -- migration 336 revokes stand_up_reports from authenticated outright, so no caller authority can reach the census that the roster must be compared against. The body re-checks haven.organization_id() and haven.has_facility_access() itself, returns two scalars rather than a report body, and is limited to one row.';

CREATE FUNCTION public.facility_data_health (p_facility_id uuid)
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
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public
  AS $function$
  WITH facility AS (
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
  (
    SELECT
      staff_inactive_can_still_sign_in
    FROM
      identity_health),
  (
    SELECT
      active_profiles_with_no_grant
    FROM
      identity_health),
  (
    SELECT
      duplicate_identity_candidates
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
      s.closed_at IS NOT NULL)
$function$;

COMMENT ON FUNCTION public.facility_data_health (uuid) IS
'Live anomaly counts for one facility. Roster census and Stand Up census are reported side by side without judgement: they measure different moments and neither is authoritative over the other. COL-361.';

GRANT EXECUTE ON FUNCTION public.facility_data_health (uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
