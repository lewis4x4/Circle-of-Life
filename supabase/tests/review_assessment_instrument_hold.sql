-- COL-430: a held instrument is only held if the database refuses the insert
-- for every role, including the ones RLS would otherwise let write.
--
-- Disposable local replay only. Every fixture rolls back. Names are synthetic
-- on purpose: no real resident or staff name belongs in a repository file.
--
-- The shape of every test is the same: sign in as a role the insert policy
-- allows, attempt the write through the ordinary path the browser uses, and
-- assert on the message the client will key off. The last section drops the
-- trigger and asserts the PHQ-9 test would have caught its absence.
BEGIN;

-- The vanilla replay stub omits Supabase auth visibility and the table grants
-- a hosted project gives `authenticated`. Granting INSERT here is the faithful
-- shape: on Supabase the grant exists and RLS does the real gating, which is
-- why a hold that only lived in RLS would still leave owner-level paths open.
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT ON public.assessments TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid () RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;

CREATE TEMP TABLE fx AS
SELECT
  gen_random_uuid() org,
  gen_random_uuid() ent,
  gen_random_uuid() fac,
  gen_random_uuid() res,
  gen_random_uuid() owner_user,    gen_random_uuid() owner_session,
  gen_random_uuid() orgadmin_user, gen_random_uuid() orgadmin_session,
  gen_random_uuid() nurse_user,    gen_random_uuid() nurse_session,
  gen_random_uuid() caregiver_user,gen_random_uuid() caregiver_session,
  gen_random_uuid() legacy_phq9;
GRANT SELECT ON fx TO authenticated;

INSERT INTO organizations (id, name) SELECT org, 'Instrument hold review' FROM fx;
INSERT INTO entities (id, organization_id, name) SELECT ent, org, 'Review Entity' FROM fx;
INSERT INTO facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds)
  SELECT fac, ent, org, 'Review Facility', '1 Way', 'Town', '00000', 4 FROM fx;
INSERT INTO residents (id, facility_id, organization_id, first_name, last_name, gender, status)
  SELECT res, fac, org, 'Test', 'Resident Hold', 'prefer_not_to_say'::gender, 'active'::resident_status FROM fx;

INSERT INTO auth.users (id, email)
  SELECT owner_user, 'review.owner@example.invalid' FROM fx
  UNION ALL SELECT orgadmin_user, 'review.orgadmin@example.invalid' FROM fx
  UNION ALL SELECT nurse_user, 'review.nurse@example.invalid' FROM fx
  UNION ALL SELECT caregiver_user, 'review.caregiver@example.invalid' FROM fx;
INSERT INTO auth.sessions (id, user_id)
  SELECT owner_session, owner_user FROM fx
  UNION ALL SELECT orgadmin_session, orgadmin_user FROM fx
  UNION ALL SELECT nurse_session, nurse_user FROM fx
  UNION ALL SELECT caregiver_session, caregiver_user FROM fx;
INSERT INTO user_profiles (id, organization_id, email, full_name, app_role, is_active)
  SELECT owner_user, org, 'review.owner@example.invalid', 'Test Owner', 'owner'::app_role, TRUE FROM fx
  UNION ALL SELECT orgadmin_user, org, 'review.orgadmin@example.invalid', 'Test OrgAdmin', 'org_admin'::app_role, TRUE FROM fx
  UNION ALL SELECT nurse_user, org, 'review.nurse@example.invalid', 'Test Nurse', 'med_tech'::app_role, TRUE FROM fx
  UNION ALL SELECT caregiver_user, org, 'review.caregiver@example.invalid', 'Test Caregiver', 'caregiver'::app_role, TRUE FROM fx;
INSERT INTO user_facility_access (user_id, facility_id, organization_id, granted_by)
  SELECT nurse_user, fac, org, nurse_user FROM fx
  UNION ALL SELECT caregiver_user, fac, org, caregiver_user FROM fx;

-- The hold itself is seeded by the migration, not by this file. Assert that
-- before anything here touches held_reason, so the check is about migration
-- 410 and not about this file's own bookkeeping.
DO $$ BEGIN
  IF (SELECT held_reason FROM assessment_templates WHERE assessment_type='phq9')
     IS DISTINCT FROM 'PHQ-9 on hold until safety follow-up is added' THEN
    RAISE EXCEPTION 'migration 410 did not seed the PHQ-9 hold'; END IF;
  IF EXISTS (SELECT 1 FROM assessment_templates WHERE assessment_type<>'phq9' AND held_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'the hold reached an instrument other than PHQ-9'; END IF;
END $$;

-- A PHQ-9 recorded before the hold existed. Production has rows like this, so
-- seed it the way production got one: the row predates the hold. The trigger
-- refuses this insert even as the replay's owner role -- which is the point of
-- putting the hold in a trigger rather than in RLS -- so lift the hold, write
-- the historical row, and put the hold straight back.
UPDATE assessment_templates SET held_reason=NULL WHERE assessment_type='phq9';
INSERT INTO assessments (id, resident_id, facility_id, organization_id, assessment_type,
                         assessment_date, total_score, risk_level, scores, assessed_by)
  SELECT legacy_phq9, res, fac, org, 'phq9', '2026-09-01'::date, 12, 'moderate',
         '{"interest":2}'::jsonb, nurse_user FROM fx;
UPDATE assessment_templates
  SET held_reason='PHQ-9 on hold until safety follow-up is added' WHERE assessment_type='phq9';

-- Sign in as a given role for the rest of the current statement block.
CREATE OR REPLACE FUNCTION pg_temp.sign_in(p_user uuid, p_session uuid, p_role text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'session_id', p_session, 'role', 'authenticated',
    'app_role', p_role, 'organization_id', (SELECT org FROM fx),
    'auth_claim_version', (SELECT auth_claim_version FROM user_profiles WHERE id=p_user),
    'iat', extract(epoch FROM clock_timestamp())::bigint)::text, TRUE);
$$;

-- ===========================================================================
-- PHQ-9 is refused for every role the insert policy allows
-- ===========================================================================
DO $$
DECLARE
  r record;
  v_sqlstate text;
  v_message text;
  v_detail text;
  v_blocked int := 0;
  v_recorded boolean;
BEGIN
  FOR r IN
    SELECT 'owner' role, owner_user u, owner_session s FROM fx
    UNION ALL SELECT 'org_admin', orgadmin_user, orgadmin_session FROM fx
    UNION ALL SELECT 'med_tech', nurse_user, nurse_session FROM fx
    UNION ALL SELECT 'caregiver', caregiver_user, caregiver_session FROM fx
  LOOP
    PERFORM pg_temp.sign_in(r.u, r.s, r.role);
    v_recorded := FALSE;
    BEGIN
      SET LOCAL ROLE authenticated;
      INSERT INTO assessments (resident_id, facility_id, organization_id, assessment_type,
                               assessment_date, total_score, risk_level, scores, assessed_by)
        SELECT res, fac, org, 'phq9', '2026-09-16'::date, 12, 'moderate',
               '{"interest":2}'::jsonb, r.u FROM fx;
      RESET ROLE;
      v_recorded := TRUE;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE,
                              v_message  = MESSAGE_TEXT,
                              v_detail   = PG_EXCEPTION_DETAIL;
      RESET ROLE;
      IF v_message <> 'assessment_instrument_held' THEN
        RAISE EXCEPTION 'role % blocked by the wrong error: % / %', r.role, v_sqlstate, v_message;
      END IF;
      IF v_sqlstate <> 'P0001' THEN
        RAISE EXCEPTION 'role % got sqlstate % not P0001', r.role, v_sqlstate; END IF;
      IF v_detail <> 'PHQ-9 on hold until safety follow-up is added' THEN
        RAISE EXCEPTION 'role % got no usable detail: %', r.role, v_detail; END IF;
      v_blocked := v_blocked + 1;
    END;
    IF v_recorded THEN RAISE EXCEPTION 'PHQ-9 was recorded by role %', r.role; END IF;
  END LOOP;
  IF v_blocked <> 4 THEN RAISE EXCEPTION 'expected 4 roles blocked, got %', v_blocked; END IF;
END $$;

-- ===========================================================================
-- Every unheld instrument still records
-- ===========================================================================
DO $$
DECLARE
  t text;
  v_recorded int := 0;
BEGIN
  PERFORM pg_temp.sign_in((SELECT nurse_user FROM fx), (SELECT nurse_session FROM fx), 'med_tech');
  FOREACH t IN ARRAY ARRAY['braden','morse_fall','katz_adl'] LOOP
    SET LOCAL ROLE authenticated;
    INSERT INTO assessments (resident_id, facility_id, organization_id, assessment_type,
                             assessment_date, total_score, risk_level, scores, assessed_by)
      SELECT res, fac, org, t, '2026-09-16'::date, 14, 'moderate', '{}'::jsonb, nurse_user FROM fx;
    RESET ROLE;
    v_recorded := v_recorded + 1;
  END LOOP;
  IF v_recorded <> 3 THEN RAISE EXCEPTION 'expected 3 instruments recorded, got %', v_recorded; END IF;
END $$;

-- ===========================================================================
-- The PHQ-9 already on record is untouched and still readable
-- ===========================================================================
DO $$ DECLARE v_total numeric; v_seen int; BEGIN
  PERFORM pg_temp.sign_in((SELECT nurse_user FROM fx), (SELECT nurse_session FROM fx), 'med_tech');
  SET LOCAL ROLE authenticated;
  SELECT count(*), max(total_score) INTO v_seen, v_total
    FROM assessments WHERE id=(SELECT legacy_phq9 FROM fx);
  RESET ROLE;
  IF v_seen <> 1 THEN RAISE EXCEPTION 'the PHQ-9 already on record stopped being readable'; END IF;
  IF v_total <> 12 THEN RAISE EXCEPTION 'the PHQ-9 already on record changed: %', v_total; END IF;
END $$;

-- ===========================================================================
-- Releasing the hold restores the instrument -- the documented rollback
-- ===========================================================================
DO $$ DECLARE v_ok boolean := FALSE; BEGIN
  UPDATE assessment_templates SET held_reason=NULL WHERE assessment_type='phq9';
  PERFORM pg_temp.sign_in((SELECT nurse_user FROM fx), (SELECT nurse_session FROM fx), 'med_tech');
  SET LOCAL ROLE authenticated;
  INSERT INTO assessments (resident_id, facility_id, organization_id, assessment_type,
                           assessment_date, total_score, risk_level, scores, assessed_by)
    SELECT res, fac, org, 'phq9', '2026-09-17'::date, 3, 'minimal', '{}'::jsonb, nurse_user FROM fx;
  RESET ROLE;
  v_ok := TRUE;
  UPDATE assessment_templates
    SET held_reason='PHQ-9 on hold until safety follow-up is added' WHERE assessment_type='phq9';
  IF NOT v_ok THEN RAISE EXCEPTION 'clearing held_reason did not restore the instrument'; END IF;
END $$;

-- ===========================================================================
-- Mutation check: without the trigger this file would pass a broken hold
-- ===========================================================================
DO $$ DECLARE v_inserted_without_trigger boolean := FALSE; BEGIN
  DROP TRIGGER tr_assessments_reject_held_instrument ON assessments;
  PERFORM pg_temp.sign_in((SELECT nurse_user FROM fx), (SELECT nurse_session FROM fx), 'med_tech');
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO assessments (resident_id, facility_id, organization_id, assessment_type,
                             assessment_date, total_score, risk_level, scores, assessed_by)
      SELECT res, fac, org, 'phq9', '2026-09-18'::date, 9, 'mild', '{}'::jsonb, nurse_user FROM fx;
    RESET ROLE;
    v_inserted_without_trigger := TRUE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
  END;

  -- Restore before asserting, so a failure here cannot leave the hold off.
  CREATE TRIGGER tr_assessments_reject_held_instrument
    BEFORE INSERT ON assessments
    FOR EACH ROW EXECUTE FUNCTION haven.reject_held_assessment_instrument();

  IF NOT v_inserted_without_trigger THEN
    RAISE EXCEPTION 'PHQ-9 was refused with the trigger dropped: this file is not testing the trigger';
  END IF;
END $$;

-- ...and refused again now that it is restored.
DO $$ DECLARE v_message text; BEGIN
  PERFORM pg_temp.sign_in((SELECT nurse_user FROM fx), (SELECT nurse_session FROM fx), 'med_tech');
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO assessments (resident_id, facility_id, organization_id, assessment_type,
                             assessment_date, total_score, risk_level, scores, assessed_by)
      SELECT res, fac, org, 'phq9', '2026-09-19'::date, 9, 'mild', '{}'::jsonb, nurse_user FROM fx;
    RESET ROLE;
    RAISE EXCEPTION 'the restored trigger did not hold PHQ-9';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RESET ROLE;
    IF v_message <> 'assessment_instrument_held' THEN
      RAISE EXCEPTION 'restored trigger raised the wrong error: %', v_message; END IF;
  END;
END $$;

DO $$ BEGIN RAISE NOTICE 'review_assessment_instrument_hold: PASS'; END $$;

ROLLBACK;
