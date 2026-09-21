-- COL-361: a check session is only evidence if the database refuses to close it early.
--
-- Disposable local replay only. Every fixture, and the auth stub adaptation,
-- rolls back. Names are synthetic on purpose: no real resident or staff name
-- belongs in a repository file.
--
-- The shape of every bed test is the same, and it is the point of the whole
-- feature: mark the bed, assert the fix is open, then make the change through
-- the ordinary residents write path the real flows use, and assert the fix
-- closed by itself. Nothing in this file ever ticks an item closed.
BEGIN;

-- The vanilla replay stub omits Supabase auth visibility.
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid () RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;

-- No UPDATE, DELETE or TRUNCATE reaches these tables from any Supabase role, by
-- grant, before RLS is even consulted.
--
-- COL-440: the earlier version of this assertion named `authenticated` only and
-- was true on this replay for the wrong reason -- vanilla Postgres has none of
-- Supabase's default privileges, and hosted grants ALL on every new public
-- table to anon, authenticated and service_role. Migration 407's
-- GRANT SELECT, INSERT neither narrowed nor revoked that, so the claim was
-- false on production. The explicit REVOKE in migration 409 is what makes this
-- true in both places, and `service_role` is the role that matters: it bypasses
-- RLS, so the grant layer is the only layer it is subject to.
DO $$ DECLARE writable text; BEGIN
  SELECT string_agg(format('%s can %s %s', r.role_name, p.priv, t.tbl), ', ' ORDER BY r.role_name, t.tbl, p.priv)
    INTO writable
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r (role_name)
    CROSS JOIN (VALUES
      ('public.board_check_sessions'), ('public.board_check_results'),
      ('public.staff_check_sessions'), ('public.staff_check_results')) AS t (tbl)
    CROSS JOIN (VALUES ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p (priv)
    WHERE has_table_privilege(r.role_name, t.tbl, p.priv);
  IF writable IS NOT NULL THEN
    RAISE EXCEPTION 'facility check tables are writable after insert: %', writable;
  END IF;
END $$;

CREATE TEMP TABLE fx AS
SELECT
  gen_random_uuid() org, gen_random_uuid() org_other,
  gen_random_uuid() ent, gen_random_uuid() ent_other,
  gen_random_uuid() fac, gen_random_uuid() fac_other,
  gen_random_uuid() room, gen_random_uuid() room_other,
  gen_random_uuid() bed_match, gen_random_uuid() bed_empty_occupied,
  gen_random_uuid() bed_occupied_empty, gen_random_uuid() bed_different,
  gen_random_uuid() bed_not_on_board, gen_random_uuid() bed_late, gen_random_uuid() bed_other,
  gen_random_uuid() res_a, gen_random_uuid() res_b,
  gen_random_uuid() admin_user, gen_random_uuid() admin_session,
  gen_random_uuid() other_user, gen_random_uuid() other_session,
  gen_random_uuid() dup_email_user, gen_random_uuid() dup_name_user,
  gen_random_uuid() shared_auth_user,
  gen_random_uuid() staff_a, gen_random_uuid() staff_shared_1, gen_random_uuid() staff_shared_2,
  gen_random_uuid() session_board, gen_random_uuid() session_staff, gen_random_uuid() session_other;
GRANT SELECT ON fx TO authenticated;

INSERT INTO organizations (id, name)
  SELECT org, 'Facility data checks review' FROM fx
  UNION ALL SELECT org_other, 'Facility data checks other org' FROM fx;
INSERT INTO entities (id, organization_id, name)
  SELECT ent, org, 'Review Entity' FROM fx
  UNION ALL SELECT ent_other, org_other, 'Other Entity' FROM fx;
INSERT INTO facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds)
  SELECT fac, ent, org, 'Review Facility', '1 Way', 'Town', '00000', 6 FROM fx
  UNION ALL SELECT fac_other, ent_other, org_other, 'Other Facility', '2 Way', 'Town', '00000', 1 FROM fx;
INSERT INTO rooms (id, facility_id, organization_id, room_number, sort_order)
  SELECT room, fac, org, '101', 1 FROM fx
  UNION ALL SELECT room_other, fac_other, org_other, '201', 1 FROM fx;
INSERT INTO beds (id, room_id, facility_id, organization_id, bed_label, status)
  SELECT bed_match, room, fac, org, 'A', 'available'::bed_status FROM fx
  UNION ALL SELECT bed_empty_occupied, room, fac, org, 'B', 'available'::bed_status FROM fx
  UNION ALL SELECT bed_occupied_empty, room, fac, org, 'C', 'available'::bed_status FROM fx
  UNION ALL SELECT bed_different, room, fac, org, 'D', 'available'::bed_status FROM fx
  UNION ALL SELECT bed_not_on_board, room, fac, org, 'E', 'available'::bed_status FROM fx
  UNION ALL SELECT bed_other, room_other, fac_other, org_other, 'A', 'available'::bed_status FROM fx;

INSERT INTO auth.users (id, email)
  SELECT admin_user, 'review.admin@example.invalid' FROM fx
  UNION ALL SELECT other_user, 'review.other@example.invalid' FROM fx
  UNION ALL SELECT dup_email_user, 'review.dup@example.invalid' FROM fx
  UNION ALL SELECT dup_name_user, 'review.name@example.invalid' FROM fx
  UNION ALL SELECT shared_auth_user, 'review.shared@example.invalid' FROM fx;
INSERT INTO auth.sessions (id, user_id)
  SELECT admin_session, admin_user FROM fx
  UNION ALL SELECT other_session, other_user FROM fx;

INSERT INTO user_profiles (id, organization_id, email, full_name, app_role, is_active)
  SELECT admin_user, org, 'review.admin@example.invalid', 'Test Admin A', 'facility_admin'::app_role, TRUE FROM fx
  UNION ALL SELECT other_user, org_other, 'review.other@example.invalid', 'Test Admin B', 'facility_admin'::app_role, TRUE FROM fx
  -- Same email with different case and padding. The unique index on email does
  -- not catch this; the normalizer does.
  UNION ALL SELECT dup_email_user, org, '  Review.Admin@Example.INVALID ', 'Test Admin A Duplicate', 'facility_admin'::app_role, TRUE FROM fx
  -- Same name with a diacritic and doubled whitespace.
  UNION ALL SELECT dup_name_user, org, 'review.name@example.invalid', 'Tést   Admin  A', 'facility_admin'::app_role, TRUE FROM fx
  UNION ALL SELECT shared_auth_user, org, 'review.shared@example.invalid', 'Test Staff Shared', 'caregiver'::app_role, TRUE FROM fx;

INSERT INTO user_facility_access (user_id, facility_id, organization_id)
  SELECT admin_user, fac, org FROM fx
  UNION ALL SELECT dup_email_user, fac, org FROM fx
  UNION ALL SELECT dup_name_user, fac, org FROM fx
  UNION ALL SELECT shared_auth_user, fac, org FROM fx
  UNION ALL SELECT other_user, fac_other, org_other FROM fx;

INSERT INTO staff (id, user_id, facility_id, organization_id, first_name, last_name, staff_role, employment_status, hire_date)
  SELECT staff_a, NULL, fac, org, 'Test', 'Staff A', 'cna'::staff_role, 'active'::employment_status, '2026-01-01'::date FROM fx
  -- Two staff rows on one auth user id: the duplicate rule user_profiles cannot
  -- express, because its primary key is the auth user id.
  UNION ALL SELECT staff_shared_1, shared_auth_user, fac, org, 'Test', 'Staff Shared', 'cna'::staff_role, 'active'::employment_status, '2026-01-01'::date FROM fx
  UNION ALL SELECT staff_shared_2, shared_auth_user, fac, org, 'Test', 'Staff Shared', 'lpn'::staff_role, 'active'::employment_status, '2026-02-01'::date FROM fx;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', f.admin_user, 'session_id', f.admin_session, 'role', 'authenticated',
  'app_role', 'facility_admin', 'organization_id', f.org,
  'auth_claim_version', p.auth_claim_version,
  'iat', extract(epoch FROM clock_timestamp())::bigint)::text, TRUE)
FROM fx f JOIN user_profiles p ON p.id = f.admin_user;

-- ===========================================================================
-- Board Check: five results, each opening and closing on live state
-- ===========================================================================

SET LOCAL ROLE authenticated;
INSERT INTO board_check_sessions (id, organization_id, facility_id, started_by)
  SELECT session_board, org, fac, admin_user FROM fx;

-- 'match' on an empty bed is never open.
INSERT INTO board_check_results (organization_id, session_id, bed_id, result, recorded_by)
  SELECT org, session_board, bed_match, 'match', admin_user FROM fx;
DO $$ BEGIN
  IF (SELECT fix_open FROM board_check_state((SELECT session_board FROM fx)) WHERE bed_id=(SELECT bed_match FROM fx)) THEN
    RAISE EXCEPTION 'match opened a fix'; END IF;
END $$;
RESET ROLE;

-- 'board_empty_haven_occupied': Haven has someone in a bed the board calls empty.
INSERT INTO residents (id, facility_id, organization_id, first_name, last_name, gender, status, bed_id)
  SELECT res_a, fac, org, 'Test', 'Resident A', 'prefer_not_to_say'::gender, 'active'::resident_status, bed_empty_occupied FROM fx;
SET LOCAL ROLE authenticated;
INSERT INTO board_check_results (organization_id, session_id, bed_id, result, haven_resident_id_at_mark, haven_resident_status_at_mark, recorded_by)
  SELECT org, session_board, bed_empty_occupied, 'board_empty_haven_occupied', res_a, 'active', admin_user FROM fx;
DO $$ BEGIN
  IF NOT (SELECT fix_open FROM board_check_state((SELECT session_board FROM fx)) WHERE bed_id=(SELECT bed_empty_occupied FROM fx)) THEN
    RAISE EXCEPTION 'board_empty_haven_occupied did not open a fix'; END IF;
END $$;
RESET ROLE;
-- A bed hold must NOT close it. The resident is coming back to that bed.
UPDATE residents SET status='hospital_hold'::resident_status WHERE id=(SELECT res_a FROM fx);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT (SELECT fix_open FROM board_check_state((SELECT session_board FROM fx)) WHERE bed_id=(SELECT bed_empty_occupied FROM fx)) THEN
    RAISE EXCEPTION 'a bed hold was mistaken for an empty bed'; END IF;
END $$;
RESET ROLE;
-- The real discharge write path: release the bed and record a released status.
UPDATE residents SET status='discharged'::resident_status, bed_id=NULL WHERE id=(SELECT res_a FROM fx);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT fix_open FROM board_check_state((SELECT session_board FROM fx)) WHERE bed_id=(SELECT bed_empty_occupied FROM fx)) THEN
    RAISE EXCEPTION 'discharging the resident did not close the fix'; END IF;
END $$;

-- 'board_occupied_haven_empty': the board has somebody Haven does not.
INSERT INTO board_check_results (organization_id, session_id, bed_id, result, recorded_by)
  SELECT org, session_board, bed_occupied_empty, 'board_occupied_haven_empty', admin_user FROM fx;
DO $$ BEGIN
  IF NOT (SELECT fix_open FROM board_check_state((SELECT session_board FROM fx)) WHERE bed_id=(SELECT bed_occupied_empty FROM fx)) THEN
    RAISE EXCEPTION 'board_occupied_haven_empty did not open a fix'; END IF;
END $$;
RESET ROLE;
INSERT INTO residents (id, facility_id, organization_id, first_name, last_name, gender, status, bed_id)
  SELECT res_b, fac, org, 'Test', 'Resident B', 'prefer_not_to_say'::gender, 'active'::resident_status, bed_occupied_empty FROM fx;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT fix_open FROM board_check_state((SELECT session_board FROM fx)) WHERE bed_id=(SELECT bed_occupied_empty FROM fx)) THEN
    RAISE EXCEPTION 'admitting a resident did not close the fix'; END IF;
END $$;
RESET ROLE;

-- 'different_occupant': Haven names the wrong person. A room move resolves it.
UPDATE residents SET bed_id=(SELECT bed_different FROM fx), status='active'::resident_status WHERE id=(SELECT res_a FROM fx);
SET LOCAL ROLE authenticated;
INSERT INTO board_check_results (organization_id, session_id, bed_id, result, haven_resident_id_at_mark, haven_resident_status_at_mark, recorded_by)
  SELECT org, session_board, bed_different, 'different_occupant', res_a, 'active', admin_user FROM fx;
DO $$ BEGIN
  IF NOT (SELECT fix_open FROM board_check_state((SELECT session_board FROM fx)) WHERE bed_id=(SELECT bed_different FROM fx)) THEN
    RAISE EXCEPTION 'different_occupant did not open a fix'; END IF;
END $$;
RESET ROLE;
UPDATE residents SET bed_id=(SELECT bed_match FROM fx) WHERE id=(SELECT res_a FROM fx);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT fix_open FROM board_check_state((SELECT session_board FROM fx)) WHERE bed_id=(SELECT bed_different FROM fx)) THEN
    RAISE EXCEPTION 'moving the resident did not close the different_occupant fix'; END IF;
END $$;

-- 'bed_not_on_board': Haven has a bed the board does not.
INSERT INTO board_check_results (organization_id, session_id, bed_id, result, recorded_by)
  SELECT org, session_board, bed_not_on_board, 'bed_not_on_board', admin_user FROM fx;
DO $$ BEGIN
  IF NOT (SELECT fix_open FROM board_check_state((SELECT session_board FROM fx)) WHERE bed_id=(SELECT bed_not_on_board FROM fx)) THEN
    RAISE EXCEPTION 'bed_not_on_board did not open a fix'; END IF;
END $$;
RESET ROLE;
UPDATE beds SET status='offline'::bed_status WHERE id=(SELECT bed_not_on_board FROM fx);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT fix_open FROM board_check_state((SELECT session_board FROM fx)) WHERE bed_id=(SELECT bed_not_on_board FROM fx)) THEN
    RAISE EXCEPTION 'taking the bed offline did not close the fix'; END IF;
END $$;

-- ===========================================================================
-- Close gating
-- ===========================================================================

-- A newer result supersedes an older one rather than editing it. This one
-- re-opens a fix, so the close must be refused.
INSERT INTO board_check_results (organization_id, session_id, bed_id, result, recorded_by)
  SELECT org, session_board, bed_not_on_board, 'board_occupied_haven_empty', admin_user FROM fx;
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN PERFORM close_board_check_session((SELECT session_board FROM fx));
  EXCEPTION WHEN sqlstate 'P0001' THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'close succeeded with an open fix'; END IF;
END $$;
-- Resolve it the honest way: the board was wrong, so record what is true now.
INSERT INTO board_check_results (organization_id, session_id, bed_id, result, recorded_by)
  SELECT org, session_board, bed_not_on_board, 'bed_not_on_board', admin_user FROM fx;
RESET ROLE;

-- A sixth bed appears mid-walk. Close is refused while it is unmarked.
INSERT INTO beds (id, room_id, facility_id, organization_id, bed_label, status)
  SELECT bed_late, room, fac, org, 'F', 'available'::bed_status FROM fx;
SET LOCAL ROLE authenticated;
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN PERFORM close_board_check_session((SELECT session_board FROM fx));
  EXCEPTION WHEN sqlstate 'P0001' THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'close succeeded with an unmarked bed'; END IF;
END $$;
INSERT INTO board_check_results (organization_id, session_id, bed_id, result, recorded_by)
  SELECT org, session_board, bed_late, 'match', admin_user FROM fx;

-- At zero unmarked and zero open, the close succeeds.
DO $$ BEGIN
  PERFORM close_board_check_session((SELECT session_board FROM fx));
  IF (SELECT closed_at FROM board_check_sessions WHERE id=(SELECT session_board FROM fx)) IS NULL THEN
    RAISE EXCEPTION 'close at zero did not set closed_at'; END IF;
END $$;

-- ===========================================================================
-- Append only, and one open session per facility
-- ===========================================================================

DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN UPDATE board_check_results SET result='match' WHERE session_id=(SELECT session_board FROM fx);
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'a signed-in session could update a board check result'; END IF;
END $$;
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN DELETE FROM board_check_results WHERE session_id=(SELECT session_board FROM fx);
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'a signed-in session could delete a board check result'; END IF;
END $$;
RESET ROLE;
-- The table owner cannot edit one either: the trigger, not only the grant.
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN UPDATE board_check_results SET result='match' WHERE session_id=(SELECT session_board FROM fx);
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'the table owner could update a board check result'; END IF;
END $$;
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN DELETE FROM board_check_results WHERE session_id=(SELECT session_board FROM fx);
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'the table owner could delete a board check result'; END IF;
END $$;

-- COL-439. The sessions tables cannot take a flat refusal, because closing a
-- walk is an UPDATE. What the trigger refuses is everything that is not a
-- close: no delete, no reopen, no re-stamp, no rewrite of any other column.
-- These run on the owner path, which is where service_role would otherwise
-- reach past RLS with the grants hosted Supabase hands out by default.
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN DELETE FROM board_check_sessions WHERE id=(SELECT session_board FROM fx);
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'the table owner could delete a closed board check session'; END IF;
END $$;
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN UPDATE board_check_sessions SET closed_at=NULL, closed_by=NULL WHERE id=(SELECT session_board FROM fx);
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'the table owner could reopen a closed board check session'; END IF;
END $$;
DO $$ DECLARE refused boolean := FALSE; BEGIN
  -- now() is the transaction timestamp and the close above used it, so move the
  -- stamp to make this a real rewrite rather than a no-op.
  BEGIN UPDATE board_check_sessions SET closed_at=now() - interval '1 day' WHERE id=(SELECT session_board FROM fx);
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'the table owner could re-stamp a closed board check session'; END IF;
END $$;
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN UPDATE board_check_sessions SET started_at=now() - interval '1 day' WHERE id=(SELECT session_board FROM fx);
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'the table owner could rewrite a board check session started_at'; END IF;
END $$;

-- A closed walk does not block the next one, but two open walks are rejected.
SET LOCAL ROLE authenticated;
INSERT INTO board_check_sessions (organization_id, facility_id, started_by)
  SELECT org, fac, admin_user FROM fx;
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN
    INSERT INTO board_check_sessions (organization_id, facility_id, started_by)
      SELECT org, fac, admin_user FROM fx;
  EXCEPTION WHEN unique_violation THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'a second open board check session was allowed'; END IF;
END $$;
RESET ROLE;

-- COL-439, the other half: the close precondition belongs to the table, not
-- only to close_board_check_session(). The walk just opened has six unmarked
-- beds, so stamping closed_at on it from the owner path would manufacture
-- evidence of a reconciliation that never happened.
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN
    UPDATE board_check_sessions SET closed_at=now(), closed_by=(SELECT admin_user FROM fx)
      WHERE facility_id=(SELECT fac FROM fx) AND closed_at IS NULL;
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'the table owner closed a board check that still had unmarked beds'; END IF;
END $$;
SET LOCAL ROLE authenticated;

-- ===========================================================================
-- Staff Check
-- ===========================================================================

INSERT INTO staff_check_sessions (id, organization_id, facility_id, started_by)
  SELECT session_staff, org, fac, admin_user FROM fx;

-- Duplicate candidates: normalized email, normalized name, shared auth user id.
DO $$ DECLARE by_email integer; by_name integer; by_auth integer; BEGIN
  SELECT duplicate_candidate_count INTO by_email FROM staff_check_state((SELECT session_staff FROM fx))
    WHERE subject_user_profile_id=(SELECT dup_email_user FROM fx) AND subject_staff_id IS NULL;
  IF coalesce(by_email,0)=0 THEN RAISE EXCEPTION 'a case-and-whitespace email duplicate was not suggested'; END IF;

  SELECT duplicate_candidate_count INTO by_name FROM staff_check_state((SELECT session_staff FROM fx))
    WHERE subject_user_profile_id=(SELECT dup_name_user FROM fx) AND subject_staff_id IS NULL;
  IF coalesce(by_name,0)=0 THEN RAISE EXCEPTION 'a diacritic name duplicate was not suggested'; END IF;

  SELECT duplicate_candidate_count INTO by_auth FROM staff_check_state((SELECT session_staff FROM fx))
    WHERE subject_staff_id=(SELECT staff_shared_1 FROM fx);
  IF coalesce(by_auth,0)=0 THEN RAISE EXCEPTION 'two staff rows on one auth user id were not suggested'; END IF;
END $$;

-- A duplicate_of result has to name the identity it duplicates.
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN
    INSERT INTO staff_check_results (organization_id, session_id, subject_user_profile_id, subject_staff_id, result, recorded_by)
      SELECT org, session_staff, shared_auth_user, staff_shared_2, 'duplicate_of', admin_user FROM fx;
  EXCEPTION WHEN check_violation THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'duplicate_of was accepted with no target'; END IF;
END $$;

-- 'keep' is never open.
INSERT INTO staff_check_results (organization_id, session_id, subject_staff_id, result, recorded_by)
  SELECT org, session_staff, staff_a, 'keep', admin_user FROM fx;
DO $$ BEGIN
  IF (SELECT fix_open FROM staff_check_state((SELECT session_staff FROM fx)) WHERE subject_staff_id=(SELECT staff_a FROM fx)) THEN
    RAISE EXCEPTION 'keep opened a fix'; END IF;
END $$;

-- 'duplicate_of' stays open while the duplicate can still act.
INSERT INTO staff_check_results (organization_id, session_id, subject_user_profile_id, subject_staff_id, result, duplicate_of_staff_id, recorded_by)
  SELECT org, session_staff, shared_auth_user, staff_shared_2, 'duplicate_of', staff_shared_1, admin_user FROM fx;
INSERT INTO staff_check_results (organization_id, session_id, subject_user_profile_id, subject_staff_id, result, recorded_by)
  SELECT org, session_staff, shared_auth_user, staff_shared_1, 'deactivate', admin_user FROM fx;
DO $$ BEGIN
  IF NOT (SELECT bool_and(fix_open) FROM staff_check_state((SELECT session_staff FROM fx))
      WHERE subject_staff_id IN (SELECT staff_shared_1 FROM fx UNION ALL SELECT staff_shared_2 FROM fx)) THEN
    RAISE EXCEPTION 'deactivate or duplicate_of did not open a fix while the subject was active'; END IF;
END $$;
RESET ROLE;

-- The COL-349 offboard has two halves. Ending employment alone is not enough
-- while the linked profile can still sign in.
UPDATE staff SET employment_status='terminated'::employment_status, termination_date='2026-09-16'
  WHERE id IN (SELECT staff_shared_1 FROM fx UNION ALL SELECT staff_shared_2 FROM fx);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT (SELECT bool_and(fix_open) FROM staff_check_state((SELECT session_staff FROM fx))
      WHERE subject_staff_id IN (SELECT staff_shared_1 FROM fx UNION ALL SELECT staff_shared_2 FROM fx)) THEN
    RAISE EXCEPTION 'a half-finished offboard closed the fix'; END IF;
END $$;
RESET ROLE;

-- COL-437. Revoking the facility grant is the first thing an offboard does, and
-- it takes the profile out of a facility_admin's RLS reach while the login is
-- still live. That is exactly the state a staff check exists to find, so the
-- read model has to survive it: the screen and the definer close function must
-- agree that the fix is still open. Before migration 409 the profile dropped
-- out of the read model here, the screen reported the identity resolved and
-- enabled Close, and the close function then refused against a screen with
-- nothing open -- an unclosable session with no way to diagnose it.
UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT shared_auth_user FROM fx);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT (SELECT bool_and(fix_open) FROM staff_check_state((SELECT session_staff FROM fx))
      WHERE subject_staff_id IN (SELECT staff_shared_1 FROM fx UNION ALL SELECT staff_shared_2 FROM fx)) THEN
    RAISE EXCEPTION 'a revoked facility grant hid the half-finished offboard from the staff check'; END IF;
  -- And the screen agrees with the recount the close function will do.
  IF (SELECT count(*) FILTER (WHERE fix_open) FROM staff_check_state((SELECT session_staff FROM fx))) = 0 THEN
    RAISE EXCEPTION 'staff_check_state reported nothing open while the close function still sees a fix'; END IF;
END $$;
RESET ROLE;
-- Now the other half, exactly what restrict_user_access_review does.
UPDATE user_profiles SET is_active=FALSE WHERE id=(SELECT shared_auth_user FROM fx);
UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT shared_auth_user FROM fx);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT bool_or(fix_open) FROM staff_check_state((SELECT session_staff FROM fx))
      WHERE subject_staff_id IN (SELECT staff_shared_1 FROM fx UNION ALL SELECT staff_shared_2 FROM fx)) THEN
    RAISE EXCEPTION 'a finished offboard left the fix open'; END IF;
END $$;

-- Close is refused while identities are unresolved.
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN PERFORM close_staff_check_session((SELECT session_staff FROM fx));
  EXCEPTION WHEN sqlstate 'P0001' THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'staff close succeeded with unresolved identities'; END IF;
END $$;
INSERT INTO staff_check_results (organization_id, session_id, subject_user_profile_id, result, recorded_by)
  SELECT (SELECT org FROM fx), (SELECT session_staff FROM fx), s.subject_user_profile_id, 'keep', (SELECT admin_user FROM fx)
  FROM staff_check_state((SELECT session_staff FROM fx)) s
  WHERE s.unmarked AND s.subject_staff_id IS NULL;
DO $$ BEGIN
  PERFORM close_staff_check_session((SELECT session_staff FROM fx));
  IF (SELECT closed_at FROM staff_check_sessions WHERE id=(SELECT session_staff FROM fx)) IS NULL THEN
    RAISE EXCEPTION 'staff close at zero did not set closed_at'; END IF;
END $$;

-- ===========================================================================
-- A user without the facility grant sees nothing and cannot close
-- ===========================================================================

RESET ROLE;
INSERT INTO board_check_sessions (id, organization_id, facility_id, started_by)
  SELECT session_other, org_other, fac_other, other_user FROM fx;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', f.other_user, 'session_id', f.other_session, 'role', 'authenticated',
  'app_role', 'facility_admin', 'organization_id', f.org_other,
  'auth_claim_version', p.auth_claim_version,
  'iat', extract(epoch FROM clock_timestamp())::bigint)::text, TRUE)
FROM fx f JOIN user_profiles p ON p.id = f.other_user;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM board_check_state((SELECT session_board FROM fx))) THEN
    RAISE EXCEPTION 'a user without the facility grant read another facility board check'; END IF;
  -- And their own session reads only their own facility's beds.
  IF (SELECT count(*) FROM board_check_state((SELECT session_other FROM fx))) <> 1 THEN
    RAISE EXCEPTION 'a board check session did not scope to its own facility'; END IF;
END $$;
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN PERFORM close_board_check_session((SELECT session_board FROM fx));
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE;
           WHEN sqlstate '42704' THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'a user without the facility grant closed another facility check'; END IF;
END $$;
-- COL-442. Data Health refuses rather than answering with a row of zeros. An
-- all-clear panel for a facility the caller was never scoped to is the failure
-- mode that would hide the next COL-406.
DO $$ DECLARE refused boolean := FALSE; BEGIN
  BEGIN PERFORM * FROM facility_data_health((SELECT fac FROM fx));
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE; END;
  IF NOT refused THEN RAISE EXCEPTION 'facility_data_health answered a caller with no grant to the facility'; END IF;
END $$;
RESET ROLE;

-- ===========================================================================
-- Data Health
-- ===========================================================================

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', f.admin_user, 'session_id', f.admin_session, 'role', 'authenticated',
  'app_role', 'facility_admin', 'organization_id', f.org,
  'auth_claim_version', p.auth_claim_version,
  'iat', extract(epoch FROM clock_timestamp())::bigint)::text, TRUE)
FROM fx f JOIN user_profiles p ON p.id = f.admin_user;
SET LOCAL ROLE authenticated;
DO $$ DECLARE h record; BEGIN
  SELECT * INTO h FROM facility_data_health((SELECT fac FROM fx));
  -- Migration 388 keeps beds.status in step with who holds the bed, so this
  -- count cannot rise through the residents write path. Assert the invariant.
  IF h.beds_occupied_with_no_resident <> 0 THEN
    RAISE EXCEPTION 'beds occupied with no resident: expected 0, got %', h.beds_occupied_with_no_resident; END IF;
  IF h.roster_census <> 2 THEN
    RAISE EXCEPTION 'roster census: expected 2, got %', h.roster_census; END IF;
  IF h.duplicate_identity_candidates <> 4 THEN
    RAISE EXCEPTION 'duplicate identity candidates: expected 4, got %', h.duplicate_identity_candidates; END IF;
  IF h.staff_inactive_can_still_sign_in <> 0 THEN
    RAISE EXCEPTION 'inactive staff still able to sign in: expected 0, got %', h.staff_inactive_can_still_sign_in; END IF;
  IF h.last_board_check_closed_at IS NULL OR h.last_staff_check_closed_at IS NULL THEN
    RAISE EXCEPTION 'a closed check was not reported'; END IF;
  IF h.stand_up_census IS NOT NULL THEN
    RAISE EXCEPTION 'a stand up census appeared with no report filed'; END IF;
END $$;
RESET ROLE;

-- A half-undone offboard: employment ended, sign-in restored.
UPDATE user_profiles SET is_active=TRUE WHERE id=(SELECT shared_auth_user FROM fx);
-- A resident holding no bed, then a conflicting assignment attempt.
UPDATE residents SET bed_id=NULL WHERE id=(SELECT res_b FROM fx);
SET LOCAL ROLE authenticated;
DO $$ DECLARE h record; BEGIN
  SELECT * INTO h FROM facility_data_health((SELECT fac FROM fx));
  IF h.residents_holding_no_bed <> 1 THEN
    RAISE EXCEPTION 'residents holding no bed: expected 1, got %', h.residents_holding_no_bed; END IF;
  IF h.staff_inactive_can_still_sign_in <> 2 THEN
    RAISE EXCEPTION 'inactive staff still able to sign in: expected 2, got %', h.staff_inactive_can_still_sign_in; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  BEGIN
    UPDATE residents SET bed_id=(SELECT bed_match FROM fx) WHERE id=(SELECT res_b FROM fx);
    RAISE EXCEPTION 'two live residents were assigned to one bed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE h record; BEGIN
  SELECT * INTO h FROM facility_data_health((SELECT fac FROM fx));
  IF h.beds_with_two_residents <> 0 OR h.residents_holding_no_bed <> 1 THEN
    RAISE EXCEPTION 'rejected duplicate assignment changed Data Health: duplicate %, unassigned %', h.beds_with_two_residents,h.residents_holding_no_bed; END IF;
END $$;
RESET ROLE;

-- Roster census beside the Stand Up census, with its week. Two numbers, no verdict.
INSERT INTO stand_up_reports (organization_id, facility_id, week_start, "values", status)
  SELECT org, fac, '2026-09-07'::date, '{"current_total_census": 34}'::jsonb, 'ready' FROM fx;
SET LOCAL ROLE authenticated;
DO $$ DECLARE h record; BEGIN
  SELECT * INTO h FROM facility_data_health((SELECT fac FROM fx));
  IF h.stand_up_census <> 34 OR h.stand_up_week_start <> '2026-09-07'::date THEN
    RAISE EXCEPTION 'stand up census not reported beside the roster: % / %', h.stand_up_census, h.stand_up_week_start; END IF;
  IF h.roster_census = h.stand_up_census THEN
    RAISE EXCEPTION 'the fixture no longer exercises a roster and stand up disagreement'; END IF;
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'review_facility_data_checks: PASS'; END $$;

ROLLBACK;
