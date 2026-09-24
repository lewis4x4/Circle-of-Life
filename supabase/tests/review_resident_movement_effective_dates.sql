-- COL-750: resident movement carries the date it happened, not the date it was
-- saved. Every assertion here fails on the code before migration 504, where the
-- capture trigger stamped now() on every change.
-- Local disposable replay only: every fixture rolls back. Synthetic residents only.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;

CREATE TEMP TABLE mv AS SELECT
  gen_random_uuid() org, gen_random_uuid() ent, gen_random_uuid() fac, gen_random_uuid() fac2,
  gen_random_uuid() owner_id, gen_random_uuid() owner_session,
  gen_random_uuid() admin_id, gen_random_uuid() admin_session,
  gen_random_uuid() res, gen_random_uuid() late, gen_random_uuid() pending, gen_random_uuid() night,
  (now() AT TIME ZONE 'America/New_York')::date AS today;

INSERT INTO organizations(id,name) SELECT org,'Movement review' FROM mv;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Movement Entity' FROM mv;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone)
  SELECT fac,ent,org,'Movement Facility','1 Way','Town','00000',10,'America/New_York' FROM mv
  UNION ALL SELECT fac2,ent,org,'Night Facility','2 Way','Town','00000',10,'America/New_York' FROM mv;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT owner_id,owner_id||'@movement.invalid','{}'::jsonb,'{}'::jsonb FROM mv
  UNION ALL SELECT admin_id,admin_id||'@movement.invalid','{}'::jsonb,'{}'::jsonb FROM mv;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
  SELECT owner_id,org,owner_id||'@movement.invalid','Movement owner','owner'::app_role,true FROM mv
  UNION ALL SELECT admin_id,org,admin_id||'@movement.invalid','Movement administrator','facility_admin'::app_role,true FROM mv
ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_id FROM mv UNION ALL SELECT admin_session,admin_id FROM mv;
INSERT INTO public.user_facility_access(user_id,organization_id,facility_id)
  SELECT admin_id,org,fac FROM mv UNION ALL SELECT admin_id,org,fac2 FROM mv;

-- Admitted 30 days ago, 60 days ago, not yet admitted, and one in the second facility.
INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,gender,date_of_birth,status,admission_date)
  SELECT res,org,fac,'Synthetic','Mover','prefer_not_to_say'::gender,'1940-01-01'::date,'active'::resident_status,today-30 FROM mv
  UNION ALL SELECT late,org,fac,'Synthetic','Late','prefer_not_to_say','1940-01-01','active',today-60 FROM mv
  UNION ALL SELECT night,org,fac2,'Synthetic','Night','prefer_not_to_say','1940-01-01','active',today-30 FROM mv;
INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,gender,date_of_birth,status)
  SELECT pending,org,fac,'Synthetic','Pending','prefer_not_to_say','1940-01-01','pending_admission' FROM mv;

CREATE FUNCTION pg_temp.mv_login(who uuid, sess uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE version integer;
BEGIN
 SELECT auth_claim_version INTO version FROM user_profiles WHERE id=who;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',who,'session_id',sess,
   'role','authenticated','auth_claim_version',version,'iat',extract(epoch FROM clock_timestamp())::bigint,
   'exp',extract(epoch FROM now()+interval '1 hour')::bigint)::text,true);
END $$;
CREATE FUNCTION pg_temp.mv_logout() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM set_config('request.jwt.claims','{}',true); END $$;
-- Runs a statement that must be refused with this SQLSTATE and message fragment.
CREATE FUNCTION pg_temp.mv_refused(stmt text, state text, fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  EXECUTE stmt;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>state OR position(fragment IN SQLERRM)=0 THEN
   RAISE EXCEPTION 'expected % "%", got % "%"', state, fragment, SQLSTATE, SQLERRM;
  END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'expected refusal % "%" but the statement succeeded: %', state, fragment, stmt;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Hospital out on Sunday entered Monday, back on Tuesday entered Wednesday
--    (relative: out two days ago, back yesterday; both saved now).
-- ---------------------------------------------------------------------------
SELECT pg_temp.mv_login(admin_id,admin_session) FROM mv;
UPDATE residents SET status='hospital_hold', status_effective_at=now()-interval '2 days', updated_by=(SELECT admin_id FROM mv)
 WHERE id=(SELECT res FROM mv);
UPDATE residents SET status='active', status_effective_at=now()-interval '1 day', updated_by=(SELECT admin_id FROM mv)
 WHERE id=(SELECT res FROM mv);
SELECT pg_temp.mv_logout();

DO $$ DECLARE f record; h record; r record; BEGIN
  SELECT * INTO f FROM mv;
  SELECT * INTO h FROM public.resident_status_history
   WHERE resident_id=f.res AND deleted_at IS NULL AND status='hospital_hold';
  IF h.effective_from IS DISTINCT FROM now()-interval '2 days' OR h.effective_to IS DISTINCT FROM now()-interval '1 day' THEN
    RAISE EXCEPTION 'hospital stay was stored % to %, want the entered times', h.effective_from, h.effective_to; END IF;
  IF h.created_at <> now() OR h.effective_basis <> 'entered' THEN
    RAISE EXCEPTION 'recorded-at must stay the save time and the basis must say entered: % %', h.created_at, h.effective_basis; END IF;
  SELECT * INTO r FROM public.admission_discharge_register(f.org,f.fac,now()-interval '7 days',now()+interval '1 minute',true)
   WHERE resident_id=f.res AND event_type='hospital_return';
  IF r.event_at IS DISTINCT FROM now()-interval '1 day' THEN
    RAISE EXCEPTION 'register dated the hospital return %, want when it happened', r.event_at; END IF;
  IF r.recorded_at <> now() OR r.effective_basis <> 'entered' THEN
    RAISE EXCEPTION 'register lost the recorded-at or basis: % %', r.recorded_at, r.effective_basis; END IF;
  IF (SELECT status_effective_at FROM residents WHERE id=f.res) <> now()-interval '1 day' THEN
    RAISE EXCEPTION 'the resident does not say when the current status began'; END IF;
END $$;

-- The Stand Up roster at a past instant reads effective dates.
DO $$ DECLARE f record; c record; BEGIN
  SELECT * INTO f FROM mv;
  SELECT * INTO c FROM public.stand_up_roster_census_as_of(f.org,f.fac,now()-interval '36 hours');
  IF c.hospital_hold_count <> 1 THEN
    RAISE EXCEPTION 'roster 36 hours ago shows % at hospital, want 1', c.hospital_hold_count; END IF;
  SELECT * INTO c FROM public.stand_up_roster_census_as_of(f.org,f.fac,now()-interval '12 hours');
  IF c.hospital_hold_count <> 0 OR c.in_house_count <> 2 THEN
    RAISE EXCEPTION 'roster 12 hours ago shows % in house, % at hospital; want 2 and 0', c.in_house_count, c.hospital_hold_count; END IF;
  IF c.roster_as_of <> now()-interval '1 day' THEN
    RAISE EXCEPTION 'roster as-of is %, want the effective time of the last change', c.roster_as_of; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Refusals
-- ---------------------------------------------------------------------------
-- A back-dated discharge that would overlap the return is refused, clearly.
SELECT pg_temp.mv_refused(format(
  'UPDATE residents SET status=%L, discharge_date=%L, discharge_reason=%L, bed_id=NULL, status_effective_at=%L, updated_by=%L WHERE id=%L',
  'discharged', ((now()-interval '3 days') AT TIME ZONE 'America/New_York')::date, 'home', now()-interval '3 days', f.admin_id, f.res),
  '23P01', 'would overlap the resident''s last recorded change (in house on') FROM mv f;
-- The future is refused.
SELECT pg_temp.mv_refused(format('UPDATE residents SET status=%L, status_effective_at=%L, updated_by=%L WHERE id=%L',
  'loa', now()+interval '1 hour', f.admin_id, f.res), '22023', 'cannot be dated in the future') FROM mv f;
-- A discharge's time falls on its discharge date.
SELECT pg_temp.mv_refused(format(
  'UPDATE residents SET status=%L, discharge_date=%L, discharge_reason=%L, status_effective_at=%L, updated_by=%L WHERE id=%L',
  'discharged', f.today-5, 'home', now()-interval '1 hour', f.admin_id, f.res),
  '22023', 'must fall on the discharge date') FROM mv f;
-- The time a status began moves only with the status.
SELECT pg_temp.mv_refused(format('UPDATE residents SET status_effective_at=%L WHERE id=%L', now()-interval '3 hours', f.res),
  '22023', 'recorded with the status change itself') FROM mv f;

-- Beyond the window (3 days, seeded default): an administrator is refused...
SELECT pg_temp.mv_login(admin_id,admin_session) FROM mv;
SELECT pg_temp.mv_refused(format('UPDATE residents SET status=%L, status_effective_at=%L, status_effective_reason=%L, updated_by=%L WHERE id=%L',
  'loa', now()-interval '10 days', 'Paper log found late', f.admin_id, f.late), '42501', 'Only an owner or org admin') FROM mv f;
SELECT pg_temp.mv_logout();
-- ...an owner without a reason is refused (service path: the server names its actor)...
SELECT set_config('haven.movement_actor', owner_id::text, true) FROM mv;
SELECT pg_temp.mv_refused(format('UPDATE residents SET status=%L, status_effective_at=%L, updated_by=%L WHERE id=%L',
  'loa', now()-interval '10 days', f.owner_id, f.late), '22023', 'Say why') FROM mv f;
-- ...and an owner with a reason is recorded, reason kept.
UPDATE residents SET status='loa', status_effective_at=now()-interval '10 days', status_effective_reason='Paper log found late',
  updated_by=(SELECT owner_id FROM mv) WHERE id=(SELECT late FROM mv);
SELECT set_config('haven.movement_actor', '', true);
DO $$ DECLARE f record; h record; BEGIN
  SELECT * INTO f FROM mv;
  SELECT * INTO h FROM public.resident_status_history WHERE resident_id=f.late AND effective_to IS NULL AND deleted_at IS NULL;
  IF h.status <> 'loa' OR h.effective_from <> now()-interval '10 days' OR h.late_entry_reason <> 'Paper log found late' THEN
    RAISE EXCEPTION 'late owner entry stored as % from % reason %', h.status, h.effective_from, h.late_entry_reason; END IF;
END $$;

-- The window is an operating rule: widen it and the administrator may enter it.
INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
  SELECT org,fac,'resident_movement.backdate_window_days','20'::jsonb,today,'probe' FROM mv;
SELECT pg_temp.mv_login(admin_id,admin_session) FROM mv;
UPDATE residents SET status='active', status_effective_at=now()-interval '9 days', updated_by=(SELECT admin_id FROM mv)
 WHERE id=(SELECT late FROM mv);
SELECT pg_temp.mv_logout();
SELECT pg_temp.mv_refused(format('INSERT INTO public.operating_rules(organization_id,rule_key,value,effective_from,change_reason) VALUES (%L,%L,%L::jsonb,%L,%L)',
  f.org, 'resident_movement.backdate_window_days', '-1', f.today, 'probe'), '22023', 'back-date window') FROM mv f;

-- No effective time given: the save time, exactly as before.
UPDATE residents SET status='hospital_hold', updated_by=(SELECT admin_id FROM mv) WHERE id=(SELECT late FROM mv);
DO $$ DECLARE f record; h record; BEGIN
  SELECT * INTO f FROM mv;
  SELECT * INTO h FROM public.resident_status_history WHERE resident_id=f.late AND effective_to IS NULL AND deleted_at IS NULL;
  IF h.effective_from <> now() OR h.effective_basis <> 'save_time' THEN
    RAISE EXCEPTION 'an undated change was stored at % (%), want the save time', h.effective_from, h.effective_basis; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Arrival dated before the record existed: the pre-admission interval gives
--    way (collapses) rather than overlapping, and is not a register event.
-- ---------------------------------------------------------------------------
UPDATE residents SET status='active', admission_date=((now()-interval '2 days') AT TIME ZONE 'America/New_York')::date,
  status_effective_at=now()-interval '2 days', updated_by=(SELECT admin_id FROM mv) WHERE id=(SELECT pending FROM mv);
DO $$ DECLARE f record; n int; BEGIN
  SELECT * INTO f FROM mv;
  IF (SELECT effective_from FROM public.resident_status_history WHERE resident_id=f.pending AND effective_to IS NULL) <> now()-interval '2 days' THEN
    RAISE EXCEPTION 'arrival not dated when it happened'; END IF;
  SELECT count(*) INTO n FROM public.admission_discharge_register(f.org,f.fac,now()-interval '7 days',now()+interval '1 minute',true)
   WHERE resident_id=f.pending;
  IF n <> 1 THEN RAISE EXCEPTION 'arrival produced % register rows, want the one admission', n; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Overlapping intervals are refused whoever writes the history table.
-- ---------------------------------------------------------------------------
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM mv;
  -- Everything written above must already be free of overlaps.
  SET CONSTRAINTS tr_resident_status_history_no_overlap IMMEDIATE;
  BEGIN
    INSERT INTO public.resident_status_history(organization_id,facility_id,resident_id,status,effective_from,effective_to)
      VALUES(f.org,f.fac,f.res,'loa',now()-interval '40 hours',now()-interval '30 hours');
    RAISE EXCEPTION 'an overlapping history interval was accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
  SET CONSTRAINTS tr_resident_status_history_no_overlap DEFERRED;
END $$;

-- ---------------------------------------------------------------------------
-- 5. The daily census counts who was in census when the day began.
--    Night went home at 11 p.m. yesterday, entered this morning.
-- ---------------------------------------------------------------------------
UPDATE residents SET status='discharged', discharge_date=(SELECT today-1 FROM mv), discharge_reason='home', bed_id=NULL,
  status_effective_at=((SELECT today FROM mv)::timestamp AT TIME ZONE 'America/New_York') - interval '1 hour',
  updated_by=(SELECT admin_id FROM mv) WHERE id=(SELECT night FROM mv);
DO $$ DECLARE f record; n int; BEGIN
  SELECT * INTO f FROM mv;
  PERFORM public.record_census_daily_log(f.org, f.today-1);
  PERFORM public.record_census_daily_log(f.org, f.today);
  SELECT occupied_beds INTO n FROM public.census_daily_log WHERE facility_id=f.fac2 AND log_date=f.today-1;
  IF n <> 1 THEN RAISE EXCEPTION 'yesterday''s midnight census counted % in Night Facility, want 1 (still in census then)', n; END IF;
  SELECT occupied_beds INTO n FROM public.census_daily_log WHERE facility_id=f.fac2 AND log_date=f.today;
  IF n <> 0 THEN RAISE EXCEPTION 'today''s midnight census counted % in Night Facility, want 0 (discharged before midnight)', n; END IF;
END $$;

ROLLBACK;
