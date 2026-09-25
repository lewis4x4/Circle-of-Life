-- COL-749 ruling 3 (migration 542): Thursday's census is flagged against a
-- bridge from Monday, never a raw difference:
--   Monday submitted + arrivals - departures (- hospital/rehab out + returns)
--     = expected Thursday, within the tolerance (a setting, default 0).
-- Movements are status changes by effective date between Monday's figures and
-- Thursday's. Fails before migration 542 (no bridge; the Monday check was off
-- and compared Monday plus the live roster's change). Native scratch-only
-- probe; every fixture rolls back. Synthetic data only.
BEGIN;
SET LOCAL client_min_messages=warning;
CREATE TEMP TABLE br AS SELECT gen_random_uuid() org,gen_random_uuid() ent,gen_random_uuid() fac,gen_random_uuid() actor,
 now() AS t;
INSERT INTO public.organizations(id,name) SELECT org,'Census bridge probe' FROM br;
INSERT INTO public.entities(id,organization_id,name) SELECT ent,org,'Bridge entity' FROM br;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT fac,ent,org,'Bridge facility','1 Way','Town','00000',40 FROM br;
INSERT INTO public.stand_up_meeting_schedule(organization_id,meeting_day,weekday,entry_due_local,call_local,time_zone)
 SELECT org,d,w,time '08:45',time '09:15','America/New_York' FROM br,(VALUES ('monday',1::smallint),('thursday',4::smallint)) v(d,w);
CREATE TEMP TABLE br_week AS SELECT haven.stand_up_meeting_open_week(org,fac,'thursday',clock_timestamp()) w FROM br;

-- The timeline, relative to t: Monday's figures at t-3 days, Thursday's at t-12 hours.
--   r01..r10 but r04 in census at Monday, 9 (r02 at hospital since t-10d); r04 left at t-4d, before Monday.
--   r01 out to hospital t-2d, moved to rehab t-1d (the same trip)
--   r02 back from hospital t-2d          r05 out to hospital t-1d
--   r03 discharged t-1d                  r11 arrived t-2d (no earlier state)
--   r12 arrived t-1d from pending admission (since t-20d)
--   r13 arrived t-6h, after Thursday's figures: not on this bridge
SET LOCAL session_replication_role=replica;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,gender,status)
 SELECT md5('br'||n)::uuid,fac,org,'Bridge Resident',lpad(n::text,2,'0'),'prefer_not_to_say'::gender,
  (CASE n WHEN 1 THEN 'hospital_hold' WHEN 5 THEN 'hospital_hold' WHEN 3 THEN 'discharged' WHEN 4 THEN 'discharged' ELSE 'active' END)::resident_status
 FROM br, generate_series(1,13) n;
CREATE FUNCTION pg_temp.br_h(p_n integer,p_status text,p_from interval,p_to interval) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.resident_status_history(organization_id,facility_id,resident_id,status,effective_from,effective_to,effective_basis)
 SELECT b.org,b.fac,md5('br'||p_n)::uuid,p_status::resident_status,b.t-p_from,CASE WHEN p_to IS NULL THEN NULL ELSE b.t-p_to END,'entered' FROM br b
$$;
SELECT pg_temp.br_h(1,'active','60 days','2 days'), pg_temp.br_h(1,'hospital_hold','2 days','1 day'), pg_temp.br_h(1,'hospital_hold','1 day',NULL);
SELECT pg_temp.br_h(2,'active','60 days','10 days'), pg_temp.br_h(2,'hospital_hold','10 days','2 days'), pg_temp.br_h(2,'active','2 days',NULL);
SELECT pg_temp.br_h(3,'active','60 days','1 day'), pg_temp.br_h(3,'discharged','1 day',NULL);
SELECT pg_temp.br_h(4,'active','60 days','4 days'), pg_temp.br_h(4,'discharged','4 days',NULL);
SELECT pg_temp.br_h(5,'active','60 days','1 day'), pg_temp.br_h(5,'hospital_hold','1 day',NULL);
SELECT pg_temp.br_h(n,'active','60 days',NULL) FROM generate_series(6,10) n;
SELECT pg_temp.br_h(11,'active','2 days',NULL);
SELECT pg_temp.br_h(12,'pending_admission','20 days','1 day'), pg_temp.br_h(12,'active','1 day',NULL);
SELECT pg_temp.br_h(13,'active','6 hours',NULL);
UPDATE public.residents SET bed_hold_stay_type='rehab' WHERE id=md5('br1')::uuid;

-- Monday submitted 9 census, 1 at hospital; Thursday gives its figures at t-12h.
CREATE FUNCTION pg_temp.br_monday(census integer,hospital integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rid uuid := gen_random_uuid(); vid uuid := gen_random_uuid(); BEGIN
 DELETE FROM public.stand_up_revisions WHERE report_id IN (SELECT id FROM public.stand_up_reports WHERE facility_id=(SELECT fac FROM br));
 DELETE FROM public.stand_up_reports WHERE facility_id=(SELECT fac FROM br);
 INSERT INTO public.stand_up_reports(id,organization_id,facility_id,week_start,version,values,status,source_as_of)
  SELECT rid,org,fac,(SELECT w FROM br_week),1,jsonb_build_object('current_total_census',census,'hospital_and_rehab_total',hospital),'ready',t-interval '3 days' FROM br;
 INSERT INTO public.stand_up_revisions(id,report_id,version,values,status,actor_id,source_as_of,created_at)
  SELECT vid,rid,1,jsonb_build_object('current_total_census',census,'hospital_and_rehab_total',hospital),'ready',actor,t-interval '3 days',t-interval '3 days' FROM br;
 UPDATE public.stand_up_reports SET revision_id=vid WHERE id=rid;
END $$;
CREATE FUNCTION pg_temp.br_thursday(census integer,hospital integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rid uuid := gen_random_uuid(); vid uuid := gen_random_uuid(); BEGIN
 DELETE FROM public.stand_up_meeting_roster_confirmations WHERE facility_id=(SELECT fac FROM br);
 UPDATE public.stand_up_meeting_reports SET revision_id=NULL WHERE facility_id=(SELECT fac FROM br);
 DELETE FROM public.stand_up_meeting_revisions WHERE report_id IN (SELECT id FROM public.stand_up_meeting_reports WHERE facility_id=(SELECT fac FROM br));
 DELETE FROM public.stand_up_meeting_reports WHERE facility_id=(SELECT fac FROM br);
 IF census IS NULL THEN RETURN; END IF;
 INSERT INTO public.stand_up_meeting_reports(id,organization_id,facility_id,week_start,meeting_day,version,values,status,source_as_of)
  SELECT rid,org,fac,(SELECT w FROM br_week),'thursday',1,jsonb_build_object('current_total_census',census,'hospital_and_rehab_total',hospital),'draft',t-interval '12 hours' FROM br;
 INSERT INTO public.stand_up_meeting_revisions(id,report_id,version,values,status,actor_id,source_as_of,created_at)
  SELECT vid,rid,1,jsonb_build_object('current_total_census',census,'hospital_and_rehab_total',hospital),'draft',actor,t-interval '12 hours',t-interval '12 hours' FROM br;
 UPDATE public.stand_up_meeting_reports SET revision_id=vid WHERE id=rid;
END $$;
SELECT pg_temp.br_monday(9,1), pg_temp.br_thursday(10,2);
SET LOCAL session_replication_role=origin;

CREATE FUNCTION pg_temp.br_bridge() RETURNS jsonb LANGUAGE sql AS $$
 SELECT haven.stand_up_census_bridge(org,fac,(SELECT w FROM br_week),clock_timestamp()) FROM br
$$;
CREATE FUNCTION pg_temp.br_monday_figure(k text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT x FROM br, jsonb_array_elements(haven.stand_up_census_disagreement(org,fac,'thursday',clock_timestamp())->'figures') x
 WHERE x->>'key'=k AND x->>'against'='monday'
$$;

-- Grant posture: the bridge is internal.
DO $$ BEGIN
 IF has_function_privilege('authenticated','haven.stand_up_census_bridge(uuid,uuid,date,timestamptz)','EXECUTE')
 OR has_function_privilege('anon','haven.stand_up_census_bridge(uuid,uuid,date,timestamptz)','EXECUTE') THEN
  RAISE EXCEPTION 'The census bridge must not be callable directly'; END IF;
END $$;

-- 1. The defaults: tolerance 0, hospital stays in census, and the Monday check on.
DO $$ BEGIN
 IF (SELECT value FROM public.haven_operating_rule((SELECT org FROM br),(SELECT fac FROM br),'stand_up.thursday_bridge_tolerance',current_date))<>'0'::jsonb
 OR (SELECT value FROM public.haven_operating_rule((SELECT org FROM br),(SELECT fac FROM br),'stand_up.census_bridge_hospital_in_census',current_date))<>'true'::jsonb
 OR (SELECT value FROM public.haven_operating_rule((SELECT org FROM br),(SELECT fac FROM br),'stand_up.thursday_census_vs_monday',current_date))<>'true'::jsonb
 THEN RAISE EXCEPTION 'A bridge default is wrong'; END IF;
END $$;
DO $$ BEGIN
 BEGIN
  INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'stand_up.thursday_bridge_tolerance','21'::jsonb,current_date,'Probe' FROM br;
  RAISE EXCEPTION 'A tolerance of 21 must be refused';
 EXCEPTION WHEN OTHERS THEN IF position('census bridge tolerance' IN SQLERRM)=0 THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason) SELECT org,fac,'stand_up.census_bridge_hospital_in_census','"yes"'::jsonb,current_date,'Probe' FROM br;
  RAISE EXCEPTION 'A non-boolean switch must be refused';
 EXCEPTION WHEN OTHERS THEN IF position('on (true) or off' IN SQLERRM)=0 THEN RAISE; END IF; END;
END $$;

-- 2. The bridge: 9 + 2 arrivals - 1 departure = 10 expected; Thursday 10: matches.
-- The hospital trips (2 out, 1 back) are shown but stay in the census; the
-- rehab move, the pre-Monday discharge and the after-Thursday arrival are not movements.
DO $$ DECLARE b jsonb := pg_temp.br_bridge(); BEGIN
 IF b->>'state'<>'matches' OR (b->>'monday_census')::int<>9 OR (b->>'arrivals')::int<>2 OR (b->>'departures')::int<>1
  OR (b->>'hospital_out')::int<>2 OR (b->>'returns')::int<>1 OR (b->>'expected')::int<>10 OR (b->>'actual')::int<>10 OR (b->>'gap')::int<>0
  OR (b->>'hospital_in_census')::boolean IS NOT TRUE OR (b->>'tolerance')::int<>0 THEN
  RAISE EXCEPTION 'Bridge wrong: %',b; END IF;
 -- It balances with the roster by effective date.
 IF (b->>'roster_at_thursday')::int-(b->>'roster_at_monday')::int<>(b->>'arrivals')::int-(b->>'departures')::int
  OR (b->>'roster_at_monday')::int<>9 OR (b->>'roster_at_thursday')::int<>10 THEN RAISE EXCEPTION 'Bridge does not balance with the roster: %',b; END IF;
 IF b->'hospital'->>'state'<>'matches' OR (b->'hospital'->>'expected')::int<>2 THEN RAISE EXCEPTION 'Hospital bridge wrong: %',b->'hospital'; END IF;
 IF b::text ~* 'Bridge Resident' THEN RAISE EXCEPTION 'The bridge must carry counts only'; END IF;
END $$;

-- 3. The flag uses the bridge, never the raw difference: Thursday 10 against
-- Monday 9 is a legitimate change and agrees.
DO $$ DECLARE f jsonb := pg_temp.br_monday_figure('current_total_census'); BEGIN
 IF f IS NULL OR f->>'state'<>'agrees' OR (f->>'roster')::int<>10 OR (f->>'monday')::int<>9 OR (f->'bridge'->>'arrivals')::int<>2 OR (f->'bridge'->>'departures')::int<>1 THEN
  RAISE EXCEPTION 'The Monday check must use the bridge: %',f; END IF;
 IF pg_temp.br_monday_figure('hospital_and_rehab_total')->>'state'<>'agrees' THEN RAISE EXCEPTION 'Hospital against Monday must agree: %',pg_temp.br_monday_figure('hospital_and_rehab_total'); END IF;
END $$;

-- 4. Thursday 11: one more than the bridge expects. Red with the gap, and the
-- same disagreement opens (Reconcile), even though the live roster (11, with the
-- later arrival) agrees with 11.
SET LOCAL session_replication_role=replica;
SELECT pg_temp.br_thursday(11,2);
SET LOCAL session_replication_role=origin;
DO $$ DECLARE b jsonb := pg_temp.br_bridge(); d jsonb; BEGIN
 IF b->>'state'<>'differs' OR (b->>'gap')::int<>1 OR (b->>'expected')::int<>10 THEN RAISE EXCEPTION 'A gap must read differs with its number: %',b; END IF;
 d:=haven.stand_up_census_disagreement((SELECT org FROM br),(SELECT fac FROM br),'thursday',clock_timestamp());
 IF d->>'state'<>'open' OR pg_temp.br_monday_figure('current_total_census')->>'state'<>'open' THEN RAISE EXCEPTION 'A bridge gap must open the disagreement: %',d; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'figures') x WHERE x->>'against'='roster' AND x->>'key'='current_total_census' AND x->>'state'='agrees') THEN
  RAISE EXCEPTION 'Setup: the live roster must agree with 11: %',d; END IF;
END $$;

-- 5. The tolerance is a setting: 1 lets a gap of 1 match.
INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
 SELECT org,fac,'stand_up.thursday_bridge_tolerance','1'::jsonb,current_date-30,'Probe: one resident either way' FROM br;
DO $$ BEGIN
 IF pg_temp.br_bridge()->>'state'<>'matches' OR pg_temp.br_monday_figure('current_total_census')->>'state'<>'agrees' THEN
  RAISE EXCEPTION 'A gap within the tolerance must match: %',pg_temp.br_bridge(); END IF;
END $$;
DELETE FROM public.operating_rules WHERE facility_id=(SELECT fac FROM br) AND rule_key='stand_up.thursday_bridge_tolerance';

-- 6. A census that leaves hospital stays out: the stays move it, exactly as
-- Brian wrote the bridge: 9 + 2 - 1 - 2 + 1 = 9.
INSERT INTO public.operating_rules(organization_id,facility_id,rule_key,value,effective_from,change_reason)
 SELECT org,fac,'stand_up.census_bridge_hospital_in_census','false'::jsonb,current_date-30,'Probe: census without hospital stays' FROM br;
DO $$ DECLARE b jsonb := pg_temp.br_bridge(); BEGIN
 IF (b->>'expected')::int<>9 OR (b->>'hospital_in_census')::boolean THEN RAISE EXCEPTION 'Hospital stays must move a census that leaves them out: %',b; END IF;
END $$;
DELETE FROM public.operating_rules WHERE facility_id=(SELECT fac FROM br) AND rule_key='stand_up.census_bridge_hospital_in_census';

-- 7. Nothing to bridge from, or nothing entered yet: said so, never a gap.
SET LOCAL session_replication_role=replica;
SELECT pg_temp.br_thursday(NULL,NULL);
SET LOCAL session_replication_role=origin;
DO $$ DECLARE b jsonb := pg_temp.br_bridge(); BEGIN
 -- Before Thursday's figures the bridge runs to now, so the later arrival counts.
 IF b->>'state'<>'not_entered' OR b->'gap'<>'null'::jsonb OR (b->>'arrivals')::int<>3 OR (b->>'expected')::int<>11 THEN RAISE EXCEPTION 'Thursday not entered: %',b; END IF;
END $$;
SET LOCAL session_replication_role=replica;
DELETE FROM public.stand_up_revisions WHERE report_id IN (SELECT id FROM public.stand_up_reports WHERE facility_id=(SELECT fac FROM br));
DELETE FROM public.stand_up_reports WHERE facility_id=(SELECT fac FROM br);
SET LOCAL session_replication_role=origin;
DO $$ DECLARE b jsonb := pg_temp.br_bridge(); BEGIN
 IF b->>'state'<>'no_monday' OR b->'expected'<>'null'::jsonb THEN RAISE EXCEPTION 'No Monday submission: %',b; END IF;
END $$;
ROLLBACK;
