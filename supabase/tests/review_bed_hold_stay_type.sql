-- COL-755: hospital and rehab are counted separately. Fails before migration 521
-- (no stay type, one hospital count). Census and billing are unchanged.
-- Local disposable replay only: every fixture rolls back. Synthetic residents only.
BEGIN;
SET LOCAL client_min_messages=warning;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;

CREATE TEMP TABLE bh AS SELECT
  gen_random_uuid() org, gen_random_uuid() ent, gen_random_uuid() fac,
  gen_random_uuid() admin_id, gen_random_uuid() admin_session,
  gen_random_uuid() res, gen_random_uuid() old_hold, gen_random_uuid() stay_home,
  (now() AT TIME ZONE 'America/New_York')::date AS today;
INSERT INTO organizations(id,name) SELECT org,'Bed hold review' FROM bh;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Bed Hold Entity' FROM bh;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone)
  SELECT fac,ent,org,'Bed Hold Facility','1 Way','Town','00000',10,'America/New_York' FROM bh;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT admin_id,admin_id||'@bedhold.invalid','{}'::jsonb,'{}'::jsonb FROM bh;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
  SELECT admin_id,org,admin_id||'@bedhold.invalid','Bed hold administrator','facility_admin'::app_role,true FROM bh
ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT admin_session,admin_id FROM bh;
INSERT INTO public.user_facility_access(user_id,organization_id,facility_id) SELECT admin_id,org,fac FROM bh;

INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,gender,date_of_birth,status,admission_date)
  SELECT res,org,fac,'Synthetic','Mover','prefer_not_to_say'::gender,'1940-01-01'::date,'active'::resident_status,today-30 FROM bh
  UNION ALL SELECT stay_home,org,fac,'Synthetic','Home','prefer_not_to_say','1940-01-01','active',today-30 FROM bh;
-- A stay recorded before COL-755: its type was never asked.
INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,gender,date_of_birth,status,admission_date)
  SELECT old_hold,org,fac,'Synthetic','Earlier','prefer_not_to_say','1940-01-01','hospital_hold',today-40 FROM bh;

CREATE FUNCTION pg_temp.bh_login() RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; version integer;
BEGIN
 SELECT * INTO f FROM bh;
 SELECT auth_claim_version INTO version FROM user_profiles WHERE id=f.admin_id;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.admin_id,'session_id',f.admin_session,
   'role','authenticated','auth_claim_version',version,'iat',extract(epoch FROM clock_timestamp())::bigint,
   'exp',extract(epoch FROM now()+interval '1 hour')::bigint)::text,true);
END $$;
CREATE FUNCTION pg_temp.bh_refused(stmt text, fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE stmt;
 EXCEPTION WHEN OTHERS THEN
  IF position(fragment IN SQLERRM)=0 THEN RAISE EXCEPTION 'expected "%", got % "%"', fragment, SQLSTATE, SQLERRM; END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'expected refusal "%" but the statement succeeded: %', fragment, stmt;
END $$;
CREATE FUNCTION pg_temp.bh_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'Bed hold stay type: %',msg; END IF; END $$;

-- 1. Out to rehab two days ago, moved to hospital yesterday, both saved now.
SELECT pg_temp.bh_login();
UPDATE residents SET status='hospital_hold', bed_hold_stay_type='rehab', status_effective_at=now()-interval '2 days', updated_by=(SELECT admin_id FROM bh)
 WHERE id=(SELECT res FROM bh);
UPDATE residents SET bed_hold_stay_type='hospital', status_effective_at=now()-interval '1 day', updated_by=(SELECT admin_id FROM bh)
 WHERE id=(SELECT res FROM bh);
-- The home resident goes to rehab now, with no time given.
UPDATE residents SET status='hospital_hold', bed_hold_stay_type='rehab', updated_by=(SELECT admin_id FROM bh)
 WHERE id=(SELECT stay_home FROM bh);
SELECT set_config('request.jwt.claims','{}',true);

DO $$ DECLARE f record; n integer; BEGIN
  SELECT * INTO f FROM bh;
  SELECT count(*) INTO n FROM resident_status_history WHERE resident_id=f.res AND deleted_at IS NULL AND status='hospital_hold';
  IF n<>2 THEN RAISE EXCEPTION 'rehab then hospital should be two intervals, found %', n; END IF;
  PERFORM pg_temp.bh_assert((SELECT bed_hold_stay_type='rehab' AND effective_from=now()-interval '2 days' AND effective_to=now()-interval '1 day'
    FROM resident_status_history WHERE resident_id=f.res AND status='hospital_hold' AND effective_to IS NOT NULL),'the rehab interval is wrong');
  PERFORM pg_temp.bh_assert((SELECT bed_hold_stay_type='hospital' AND effective_from=now()-interval '1 day' AND effective_basis='entered'
    FROM resident_status_history WHERE resident_id=f.res AND status='hospital_hold' AND effective_to IS NULL),'the hospital interval is wrong');
END $$;

-- 2. Counted apart, now and as of a past instant; the total is unchanged.
DO $$ DECLARE f record; s record; c record; BEGIN
  SELECT * INTO f FROM bh;
  SELECT * INTO s FROM stand_up_bed_hold_split(f.org,f.fac);
  IF s.hospital_count<>1 OR s.rehab_count<>1 OR s.type_not_recorded_count<>1 THEN
    RAISE EXCEPTION 'live split %/%/%, want 1 hospital, 1 rehab, 1 not recorded', s.hospital_count, s.rehab_count, s.type_not_recorded_count; END IF;
  SELECT * INTO c FROM stand_up_roster_census(f.org,f.fac);
  IF c.hospital_hold_count<>3 OR c.roster_census_count<>3 THEN
    RAISE EXCEPTION 'census changed: % at hospital or rehab, % in census; want 3 and 3', c.hospital_hold_count, c.roster_census_count; END IF;
  SELECT * INTO s FROM stand_up_bed_hold_split(f.org,f.fac,now()-interval '36 hours');
  IF s.rehab_count<>1 OR s.hospital_count<>0 THEN
    RAISE EXCEPTION '36 hours ago the resident was in rehab: split %/%', s.hospital_count, s.rehab_count; END IF;
  -- Rehab stays billable and in census exactly as hospital does.
  IF (SELECT status FROM residents WHERE id=f.stay_home)<>'hospital_hold' THEN RAISE EXCEPTION 'rehab changed the resident status'; END IF;
END $$;

-- 3. Refusals: a recorded type cannot go back to not recorded; a type change
--    obeys the movement guard; the type exists only on a bed-hold stay.
SELECT pg_temp.bh_login();
SELECT pg_temp.bh_refused(format('UPDATE residents SET bed_hold_stay_type=NULL, updated_by=%L WHERE id=%L', f.admin_id, f.res),
  'cannot be changed back to not recorded') FROM bh f;
SELECT pg_temp.bh_refused(format('UPDATE residents SET bed_hold_stay_type=%L, status_effective_at=%L, updated_by=%L WHERE id=%L',
  'rehab', now()+interval '1 hour', f.admin_id, f.res), 'cannot be dated in the future') FROM bh f;
SELECT pg_temp.bh_refused(format('UPDATE residents SET bed_hold_stay_type=%L, status_effective_at=%L, updated_by=%L WHERE id=%L',
  'rehab', now()-interval '3 days', f.admin_id, f.res), 'would overlap') FROM bh f;
SELECT set_config('request.jwt.claims','{}',true);

-- 4. The earlier stay is "type not recorded" until someone records it, which
--    corrects the stay in force without a new movement.
SELECT pg_temp.bh_login();
UPDATE residents SET bed_hold_stay_type='hospital', updated_by=(SELECT admin_id FROM bh) WHERE id=(SELECT old_hold FROM bh);
SELECT set_config('request.jwt.claims','{}',true);
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM bh;
  PERFORM pg_temp.bh_assert((SELECT count(*)=1 FROM resident_status_history WHERE resident_id=f.old_hold AND deleted_at IS NULL),
    'recording the type of an existing stay opened a new interval');
  PERFORM pg_temp.bh_assert((SELECT bed_hold_stay_type='hospital' FROM resident_status_history WHERE resident_id=f.old_hold AND effective_to IS NULL),
    'recording the type did not reach the interval in force');
END $$;

-- 5. Coming home clears the type.
SELECT pg_temp.bh_login();
UPDATE residents SET status='active', updated_by=(SELECT admin_id FROM bh) WHERE id=(SELECT stay_home FROM bh);
SELECT set_config('request.jwt.claims','{}',true);
SELECT pg_temp.bh_assert((SELECT bed_hold_stay_type IS NULL FROM residents WHERE id=(SELECT stay_home FROM bh)),'returning home kept the stay type');
SELECT pg_temp.bh_refused(format('INSERT INTO resident_status_history(organization_id,facility_id,resident_id,status,bed_hold_stay_type,effective_from,effective_to) VALUES (%L,%L,%L,%L,%L,%L,%L)',
  f.org, f.fac, f.stay_home, 'active', 'rehab', now()-interval '200 days', now()-interval '199 days'), 'only_on_hold') FROM bh f;

-- 6. The Monday form's roster suggestion carries the split; Thursday keeps hospital and rehab apart.
SELECT pg_temp.bh_login();
DO $$ DECLARE f record; j jsonb; BEGIN
  SELECT * INTO f FROM bh;
  j:=haven.stand_up_roster_suggestion(jsonb_build_object('facility_id',f.fac));
  IF (j->>'hospital_hold_count')::int<>2 OR (j->>'hospital_count')::int<>2 OR (j->>'rehab_count')::int<>0 OR (j->>'bed_hold_type_not_recorded_count')::int<>0 THEN
    RAISE EXCEPTION 'roster suggestion split wrong: %', j; END IF;
END $$;
SELECT set_config('request.jwt.claims','{}',true);
SELECT pg_temp.bh_assert(haven.stand_up_meeting_keys('thursday') @> ARRAY['hospital_total','rehab_total','hospital_and_rehab_total'],'Thursday has no hospital and rehab figures');
SELECT pg_temp.bh_refused($q$SELECT haven.stand_up_meeting_validate('thursday','{"current_ar_cents":1,"current_total_census":3,"departures_since_monday":0,"hospital_and_rehab_total":2,"hospital_total":2,"rehab_total":1}'::jsonb)$q$,
  'cannot be more than');
SELECT haven.stand_up_meeting_validate('thursday','{"current_ar_cents":1,"current_total_census":3,"departures_since_monday":0,"hospital_and_rehab_total":3,"hospital_total":1,"rehab_total":1}'::jsonb);

ROLLBACK;
