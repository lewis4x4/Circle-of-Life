-- Synthetic, rollback-only SYS-002 / FL-015 executable regression.
BEGIN;
GRANT USAGE ON SCHEMA auth,haven TO authenticated;
GRANT SELECT ON public.quality_measure_results TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE qf AS SELECT gen_random_uuid() actor,gen_random_uuid() session,gen_random_uuid() measure,
 gen_random_uuid() foreign_org,gen_random_uuid() foreign_measure,
 id facility,organization_id organization FROM facilities WHERE deleted_at IS NULL LIMIT 1;
ALTER TABLE qf ADD COLUMN other_facility uuid;
UPDATE qf SET other_facility=(SELECT id FROM facilities WHERE organization_id=qf.organization AND id<>qf.facility AND deleted_at IS NULL LIMIT 1);
INSERT INTO organizations(id,name) SELECT foreign_org,'Section 2 synthetic foreign org' FROM qf;
INSERT INTO quality_measures(id,organization_id,measure_key,name)
 SELECT measure,organization,'section2','Section 2' FROM qf UNION ALL SELECT foreign_measure,foreign_org,'section2','Foreign' FROM qf;
INSERT INTO quality_measure_results(organization_id,facility_id,quality_measure_id,period_start,period_end,value_numeric,created_at)
 SELECT organization,facility,measure,DATE '2026-01-01',DATE '2026-01-31',5,TIMESTAMPTZ '2026-02-01' FROM qf
 UNION ALL SELECT organization,facility,measure,DATE '2026-01-01',DATE '2026-01-31',8,TIMESTAMPTZ '2026-02-02' FROM qf
 UNION ALL SELECT organization,facility,measure,DATE '2025-12-01',DATE '2025-12-31',3,TIMESTAMPTZ '2026-03-01' FROM qf
 UNION ALL SELECT organization,other_facility,measure,DATE '2026-01-01',DATE '2026-01-31',9,TIMESTAMPTZ '2026-02-01' FROM qf
 UNION ALL SELECT foreign_org,facility,foreign_measure,DATE '2026-01-01',DATE '2026-01-31',99,TIMESTAMPTZ '2026-02-01' FROM qf;
GRANT SELECT ON qf TO authenticated;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
SELECT 'SYS-002 no-profile leaked rows' probe,count(*) FROM quality_latest_facility_measures WHERE quality_measure_id IN (SELECT measure FROM qf UNION ALL SELECT foreign_measure FROM qf);
RESET ROLE;
SELECT 'FL-015 conflicting current rows' probe,count(*) FROM quality_latest_facility_measures WHERE quality_measure_id=(SELECT measure FROM qf) AND facility_id=(SELECT facility FROM qf);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM quality_latest_facility_measures) THEN RAISE EXCEPTION 'SYS-002: no-profile quality view disclosure'; END IF;
END $$;
RESET ROLE;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@section2.invalid','{}','{}' FROM qf;
INSERT INTO user_profiles(id,organization_id,email,full_name,app_role,is_active) SELECT actor,organization,actor||'@section2.invalid','Section 2','nurse',true FROM qf;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM qf;
INSERT INTO user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,organization FROM qf;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','session_id',session,'auth_claim_version',(SELECT auth_claim_version FROM user_profiles WHERE id=qf.actor))::text,true) FROM qf;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM quality_latest_facility_measures WHERE quality_measure_id=(SELECT measure FROM qf))<>1 THEN RAISE EXCEPTION 'nurse facility boundary or unique correction'; END IF;
 IF (SELECT value_numeric FROM quality_latest_facility_measures WHERE quality_measure_id=(SELECT measure FROM qf))<>8 THEN RAISE EXCEPTION 'wrong correction'; END IF;
 IF EXISTS(SELECT 1 FROM quality_latest_facility_measures WHERE organization_id=(SELECT foreign_org FROM qf)) THEN RAISE EXCEPTION 'foreign tenant disclosed'; END IF;
 IF (SELECT count(*) FROM quality_measure_results WHERE quality_measure_id=(SELECT measure FROM qf))<>3 THEN RAISE EXCEPTION 'history was lost'; END IF;
END $$;
RESET ROLE;
-- Equal creation times have a stable UUID tie-break; a soft-deleted correction is ignored.
INSERT INTO quality_measure_results(id,organization_id,facility_id,quality_measure_id,period_start,period_end,value_numeric,created_at)
 SELECT 'ffffffff-ffff-ffff-ffff-ffffffffffff',organization,facility,measure,DATE '2026-01-01',DATE '2026-01-31',10,TIMESTAMPTZ '2026-02-02' FROM qf;
DO $$ BEGIN IF (SELECT value_numeric FROM quality_latest_facility_measures WHERE facility_id=(SELECT facility FROM qf) AND quality_measure_id=(SELECT measure FROM qf))<>10 THEN RAISE EXCEPTION 'unstable equal-time correction'; END IF; END $$;
UPDATE quality_measure_results SET deleted_at=now() WHERE id='ffffffff-ffff-ffff-ffff-ffffffffffff';
DO $$ BEGIN IF (SELECT value_numeric FROM quality_latest_facility_measures WHERE facility_id=(SELECT facility FROM qf) AND quality_measure_id=(SELECT measure FROM qf))<>8 THEN RAISE EXCEPTION 'deleted correction selected'; END IF; END $$;
DO $$ DECLARE r text; n integer; BEGIN
 FOREACH r IN ARRAY ARRAY['owner','org_admin','facility_admin','nurse','caregiver','family'] LOOP
  UPDATE user_profiles SET app_role=r::app_role WHERE id=(SELECT actor FROM qf);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'role','authenticated','session_id',f.session,'auth_claim_version',p.auth_claim_version)::text,true) FROM qf f JOIN user_profiles p ON p.id=f.actor;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM quality_latest_facility_measures WHERE quality_measure_id=(SELECT measure FROM qf);
  IF n<>(CASE WHEN r IN ('owner','org_admin') THEN 2 WHEN r IN ('facility_admin','nurse') THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'role % returned %',r,n; END IF;
  IF r IN ('caregiver','family') AND EXISTS(SELECT 1 FROM quality_measure_results WHERE quality_measure_id=(SELECT measure FROM qf)) THEN RAISE EXCEPTION 'base role bypass'; END IF;
  RESET ROLE;
 END LOOP;
END $$;
UPDATE user_profiles SET app_role='nurse' WHERE id=(SELECT actor FROM qf);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'role','authenticated','session_id',f.session,'auth_claim_version',p.auth_claim_version)::text,true) FROM qf f JOIN user_profiles p ON p.id=f.actor;
UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT actor FROM qf);
-- Use a fresh version too: grant denial must not depend only on stale-token rejection.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'role','authenticated','session_id',f.session,'auth_claim_version',p.auth_claim_version)::text,true) FROM qf f JOIN user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM quality_latest_facility_measures WHERE quality_measure_id=(SELECT measure FROM qf)) THEN RAISE EXCEPTION 'revoked grant disclosure'; END IF; END $$;
RESET ROLE;
UPDATE user_profiles SET is_active=false WHERE id=(SELECT actor FROM qf);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM quality_latest_facility_measures) THEN RAISE EXCEPTION 'disabled actor disclosure'; END IF; END $$;
RESET ROLE;
SELECT 'PASS Section 2 quality: no-profile, tenant, facility, six roles, revocation, disable, latest period, correction, ties, deletion, preserved history' result;
ROLLBACK;
