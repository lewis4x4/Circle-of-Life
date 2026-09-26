-- COL-374: Stand Up bed figures from Haven rooms, beds and who is in them now.
-- Native scratch-only probe; every fixture and auth adaptation rolls back.
-- Synthetic residents only ("Test Resident"); no real data. The fixture is the
-- one in src/lib/stand-up/bed-classification.test.ts, room for room.
BEGIN;
SET LOCAL client_min_messages=warning;
GRANT USAGE ON SCHEMA auth TO authenticated;
-- Replay adaptation: the hosted project grants authenticated these tables by default; the scratch cluster does not.
GRANT SELECT ON public.residents,public.resident_status_history,public.family_resident_links,public.beds,public.rooms TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE rb_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() session,gen_random_uuid() org,gen_random_uuid() ent,
 gen_random_uuid() fac,gen_random_uuid() fac_empty,gen_random_uuid() fac_other,haven.stand_up_week() week;
INSERT INTO public.organizations(id,name) SELECT org,'Roster beds probe' FROM rb_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT ent,org,'Roster beds entity' FROM rb_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT fac,ent,org,'Roster beds facility','1 Way','Town','00000',20 FROM rb_fixture
 UNION ALL SELECT fac_empty,ent,org,'Roster beds empty facility','2 Way','Town','00000',12 FROM rb_fixture
 UNION ALL SELECT fac_other,ent,org,'Roster beds inaccessible facility','3 Way','Town','00000',12 FROM rb_fixture;
INSERT INTO public.stand_up_meeting_schedule(organization_id,meeting_day,weekday,entry_due_local,call_local,time_zone)
 SELECT org,d,w,time '08:45',time '09:15','America/New_York' FROM rb_fixture,(VALUES ('monday',1::smallint),('thursday',4::smallint)) v(d,w);
-- Use the editable facility period, separate from the workbook calendar week.
UPDATE rb_fixture SET week=haven.stand_up_open_week(fac);
-- Future timing releases separate the editable period from the workbook week.
-- Use that helper when present; the legacy calendar period remains valid before it.
DO $$ BEGIN
 IF to_regprocedure('haven.stand_up_open_week(uuid)') IS NOT NULL THEN
  EXECUTE 'UPDATE rb_fixture SET week=haven.stand_up_open_week(fac)';
 END IF;
END $$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Beds probe"}' FROM rb_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT actor,actor||'@review.invalid','Beds probe','facility_admin',org,true FROM rb_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM rb_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,fac,org FROM rb_fixture UNION ALL SELECT actor,fac_empty,org FROM rb_fixture;
-- Rooms: P1..P3 private, S1..S8 semi-private.
CREATE TEMP TABLE rb_rooms AS SELECT n AS code,gen_random_uuid() id,CASE WHEN n LIKE 'P%' THEN 'private' ELSE 'semi_private' END AS kind
 FROM unnest(ARRAY['P1','P2','P3','S1','S2','S3','S4','S5','S6','S7','S8']) n;
INSERT INTO public.rooms(id,facility_id,organization_id,room_number,room_type,max_occupancy)
 SELECT r.id,f.fac,f.org,r.code,r.kind::room_type,CASE WHEN r.kind='private' THEN 1 ELSE 2 END FROM rb_rooms r CROSS JOIN rb_fixture f;
CREATE TEMP TABLE rb_beds AS SELECT b.code,gen_random_uuid() id,(SELECT id FROM rb_rooms WHERE code=b.room) room_id,b.status FROM (VALUES
 ('P1','P1','available'),('P2','P2','maintenance'),('P3','P3','available'),
 ('S1A','S1','available'),('S1B','S1','available'),('S2A','S2','available'),('S2B','S2','available'),
 ('S3A','S3','available'),('S3B','S3','available'),('S4A','S4','hold'),('S4B','S4','available'),
 ('S5A','S5','available'),('S5B','S5','available'),('S6A','S6','available'),('S6B','S6','available'),
 ('S7A','S7','available'),('S7B','S7','available'),('S8A','S8','offline'),('S8B','S8','available')) b(code,room,status);
INSERT INTO public.beds(id,room_id,facility_id,organization_id,bed_label,status)
 SELECT b.id,b.room_id,f.fac,f.org,b.code,b.status::bed_status FROM rb_beds b CROSS JOIN rb_fixture f;
-- A visible organization can still contain a facility the administrator cannot access.
INSERT INTO public.rooms(facility_id,organization_id,room_number,room_type,max_occupancy)
 SELECT fac_other,org,'Other','private',1 FROM rb_fixture;
INSERT INTO public.beds(room_id,facility_id,organization_id,bed_label,status)
 SELECT r.id,f.fac_other,f.org,'Other','available' FROM public.rooms r JOIN rb_fixture f ON r.facility_id=f.fac_other;
-- Residents: a woman in P3 and S2A, a man at hospital from S3A, a woman reserved for S5A,
-- someone in S6A whose sex is recorded as prefer not to say, and a man discharged from S7 (bed released).
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,gender,status,bed_id)
 SELECT gen_random_uuid(),f.fac,f.org,'Test Resident',x.last,x.gender::gender,x.status::resident_status,(SELECT id FROM rb_beds WHERE code=x.bed)
 FROM rb_fixture f CROSS JOIN (VALUES ('P3','female','active','P3'),('S2','female','active','S2A'),('S3','male','hospital_hold','S3A'),
  ('S5','female','pending_admission','S5A'),('S6','prefer_not_to_say','active','S6A'),('S7','male','discharged',NULL)) x(last,gender,status,bed);
-- Preserve Current AR: a draft balance counts, a paid invoice does not.
INSERT INTO public.invoices(resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,total,balance_due)
 SELECT r.id,f.fac,f.org,f.ent,n,current_date,current_date,current_date-30*m,current_date-30*m+29,'draft',t,t,t
 FROM rb_fixture f JOIN public.residents r ON r.facility_id=f.fac AND r.last_name='P3',
 (VALUES ('RB-1',10000,0),('RB-2',70000,1)) v(n,t,m);
UPDATE public.invoices SET status='paid',amount_paid=total,balance_due=0
 WHERE facility_id=(SELECT fac FROM rb_fixture) AND invoice_number='RB-2';
CREATE FUNCTION pg_temp.rb_actor() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true) FROM rb_fixture f JOIN public.user_profiles p ON p.id=f.actor;
END $$;
SELECT pg_temp.rb_actor();
CREATE TEMP TABLE rb_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON rb_results TO authenticated;
GRANT SELECT ON rb_fixture TO authenticated;
CREATE FUNCTION pg_temp.rb_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;
-- Bed figures plus two unchanged-source figures; every other figure blank.
CREATE FUNCTION pg_temp.rb_values(female integer,male integer,flexible integer,private integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_object_agg(k,CASE k WHEN 'sp_female_beds_open' THEN to_jsonb(female) WHEN 'sp_male_beds_open' THEN to_jsonb(male)
  WHEN 'sp_flexible_beds_open' THEN to_jsonb(flexible) WHEN 'private_beds_open' THEN to_jsonb(private) WHEN 'monthly_rent_roll_cents' THEN '10000'::jsonb WHEN 'admissions_expected' THEN '0'::jsonb ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k
$$;
CREATE FUNCTION pg_temp.rb_thursday_week() RETURNS date LANGUAGE sql SECURITY DEFINER AS $$
 SELECT haven.stand_up_meeting_open_week(org,fac,'thursday',clock_timestamp()) FROM rb_fixture
$$;
-- Grant posture.
DO $$ BEGIN
 IF has_function_privilege('anon','public.stand_up_roster_beds(uuid,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.stand_up_roster_beds(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_roster_label(text)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_roster_confirm(jsonb,uuid,uuid,uuid,uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_meeting_roster_confirm(jsonb,uuid,uuid,uuid,uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_monday_prefill(uuid,uuid,date)','EXECUTE')
 THEN RAISE EXCEPTION 'Roster beds grant boundary failed'; END IF;
 IF haven.stand_up_roster_keys()<>ARRAY['current_total_census','hospital_and_rehab_total','sp_female_beds_open','sp_male_beds_open','sp_flexible_beds_open','private_beds_open']::text[]
 THEN RAISE EXCEPTION 'Roster keys must list census, hospital and the four bed figures'; END IF;
END $$;
-- The shared fixture's counts: private 2, flexible 6, female 2, male 1, unclassified 2, out of service 2, reserved 2, 19 beds.
DO $$ DECLARE c record; BEGIN
 SELECT * INTO c FROM public.stand_up_roster_beds((SELECT org FROM rb_fixture),(SELECT fac FROM rb_fixture));
 IF c.private_open<>2 OR c.sp_flexible_open<>6 OR c.sp_female_open<>2 OR c.sp_male_open<>1 OR c.unclassified_open<>2
  OR c.out_of_service_open<>2 OR c.reserved_count<>2 OR c.bed_count_in_haven<>19 OR c.beds_as_of IS NULL
 THEN RAISE EXCEPTION 'Bed counts wrong: %',to_jsonb(c); END IF;
 SELECT * INTO c FROM public.stand_up_roster_beds((SELECT org FROM rb_fixture),(SELECT fac_empty FROM rb_fixture));
 IF c.bed_count_in_haven<>0 OR c.beds_as_of IS NOT NULL OR c.sp_flexible_open<>0 THEN RAISE EXCEPTION 'Empty facility must report no beds: %',to_jsonb(c); END IF;
END $$;
-- Ambiguous assignments are a separate fixture and roll back to the baseline.
SAVEPOINT rb_ambiguity;
INSERT INTO public.residents(facility_id,organization_id,first_name,last_name,gender,status,bed_id)
 SELECT fac,org,'Test Resident','Duplicate reservation','male','pending_admission',(SELECT id FROM rb_beds WHERE code='S5A') FROM rb_fixture;
DO $$ DECLARE c record; BEGIN
 SELECT * INTO c FROM public.stand_up_roster_beds((SELECT org FROM rb_fixture),(SELECT fac FROM rb_fixture));
 IF c.sp_female_open IS DISTINCT FROM 1 OR c.unclassified_open IS DISTINCT FROM 3 OR c.reserved_count IS DISTINCT FROM 2
 THEN RAISE EXCEPTION 'Mixed reservations must not choose one sex or count the bed twice: %',to_jsonb(c); END IF;
END $$;
UPDATE public.residents SET gender='prefer_not_to_say'
 WHERE facility_id=(SELECT fac FROM rb_fixture) AND last_name='Duplicate reservation';
DO $$ DECLARE c record; BEGIN
 SELECT * INTO c FROM public.stand_up_roster_beds((SELECT org FROM rb_fixture),(SELECT fac FROM rb_fixture));
 IF c.sp_female_open IS DISTINCT FROM 1 OR c.unclassified_open IS DISTINCT FROM 3
 THEN RAISE EXCEPTION 'An unknown reservation must remain unclassified beside a known woman: %',to_jsonb(c); END IF;
END $$;
UPDATE public.residents SET gender='female'
 WHERE facility_id=(SELECT fac FROM rb_fixture) AND last_name='Duplicate reservation';
DO $$ DECLARE c record; BEGIN
 SELECT * INTO c FROM public.stand_up_roster_beds((SELECT org FROM rb_fixture),(SELECT fac FROM rb_fixture));
 IF c.sp_female_open IS DISTINCT FROM 2 OR c.unclassified_open IS DISTINCT FROM 2
 THEN RAISE EXCEPTION 'Matching reservations should retain the agreed category: %',to_jsonb(c); END IF;
END $$;
-- A visible discharged pointer is ignored even when the bed still points at it.
UPDATE public.beds SET current_resident_id=(SELECT id FROM public.residents WHERE facility_id=(SELECT fac FROM rb_fixture) AND last_name='S7')
 WHERE id=(SELECT id FROM rb_beds WHERE code='S7A');
DO $$ DECLARE c record; BEGIN
 SELECT * INTO c FROM public.stand_up_roster_beds((SELECT org FROM rb_fixture),(SELECT fac FROM rb_fixture));
 IF c.sp_flexible_open IS DISTINCT FROM 6 OR c.bed_count_in_haven IS DISTINCT FROM 19
 THEN RAISE EXCEPTION 'Stale discharged pointer must not hold or sex-classify the room: %',to_jsonb(c); END IF;
END $$;
-- An unseen pointer remains unknown even alongside a visible female holder.
INSERT INTO public.residents(facility_id,organization_id,first_name,last_name,gender,status,deleted_at)
 SELECT fac,org,'Test Resident','Unseen pointer','female','active',clock_timestamp() FROM rb_fixture;
UPDATE public.beds SET current_resident_id=(SELECT id FROM public.residents WHERE facility_id=(SELECT fac FROM rb_fixture) AND last_name='Unseen pointer')
 WHERE id=(SELECT id FROM rb_beds WHERE code='S2A');
DO $$ DECLARE c record; BEGIN
 SELECT * INTO c FROM public.stand_up_roster_beds((SELECT org FROM rb_fixture),(SELECT fac FROM rb_fixture));
 IF c.sp_female_open IS DISTINCT FROM 1 OR c.unclassified_open IS DISTINCT FROM 3
 THEN RAISE EXCEPTION 'Unseen holder pointer must override visible gender with unknown: %',to_jsonb(c); END IF;
END $$;
ROLLBACK TO SAVEPOINT rb_ambiguity;
RELEASE SAVEPOINT rb_ambiguity;
SET LOCAL ROLE authenticated;
SELECT pg_temp.rb_fail($q$SELECT public.stand_up_command('roster',jsonb_build_object('facility_id',fac_other)) FROM rb_fixture$q$,'Stand Up access denied');
SELECT pg_temp.rb_fail($q$SELECT public.stand_up_command('prefill',jsonb_build_object('facility_id',fac_other)) FROM rb_fixture$q$,'Stand Up access denied');
DO $$ DECLARE c record; BEGIN
 SELECT * INTO c FROM public.stand_up_roster_beds((SELECT org FROM rb_fixture),(SELECT fac_other FROM rb_fixture));
 IF c.bed_count_in_haven IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Invoker bed RPC escaped facility scope: %',to_jsonb(c); END IF;
 SELECT * INTO c FROM public.stand_up_roster_beds(gen_random_uuid(),(SELECT fac FROM rb_fixture));
 IF c.bed_count_in_haven IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Bed RPC escaped organization scope'; END IF;
END $$;
INSERT INTO rb_results SELECT 'prefill',public.stand_up_command('prefill',jsonb_build_object('facility_id',fac)) FROM rb_fixture;
DO $$ DECLARE p jsonb; BEGIN
 SELECT value->'fields' INTO p FROM rb_results WHERE name='prefill';
 IF p->'sp_female_beds_open'->>'value' IS DISTINCT FROM '2' OR p->'sp_male_beds_open'->>'value' IS DISTINCT FROM '1'
  OR p->'sp_flexible_beds_open'->>'value' IS DISTINCT FROM '6' OR p->'private_beds_open'->>'value' IS DISTINCT FROM '2'
 THEN RAISE EXCEPTION 'Monday prefill must use derived beds, including separate unclassified beds: %',p; END IF;
 IF p->'monthly_rent_roll_cents'->>'value' IS DISTINCT FROM '10000' OR p->'admissions_expected'->>'value' IS DISTINCT FROM '0'
  OR p->'current_open_positions'->'value' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'Current AR or other Monday prefill changed: %',p; END IF;
END $$;
INSERT INTO rb_results SELECT 'roster',public.stand_up_command('roster',jsonb_build_object('facility_id',fac)) FROM rb_fixture;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM rb_results WHERE name='roster';
 IF r->>'sp_female_open'<>'2' OR r->>'sp_male_open'<>'1' OR r->>'sp_flexible_open'<>'6' OR r->>'private_open'<>'2' OR r->>'unclassified_open'<>'2'
  OR r->>'out_of_service_open'<>'2' OR r->>'reserved_count'<>'2' OR r->>'bed_count_in_haven'<>'19' OR r->>'beds_as_of' IS NULL
 THEN RAISE EXCEPTION 'Roster suggestion lacks the bed counts: %',r; END IF;
 IF r->>'hospital_count' IS DISTINCT FROM '0' OR r->>'rehab_count' IS DISTINCT FROM '0' OR r->>'bed_hold_type_not_recorded_count' IS DISTINCT FROM '1'
 THEN RAISE EXCEPTION 'Roster hospital/rehab split lost: %',r; END IF;
 IF r::text ~* 'first_name|last_name|resident_id|Test Resident|room_number|bed_label|S2A' THEN RAISE EXCEPTION 'Roster suggestion carries identifiers'; END IF;
END $$;
-- Use Haven's counts: all four recorded roster_confirmed with the suggestion.
INSERT INTO rb_results SELECT 'payload',jsonb_build_object('facility_id',fac,'week_start',week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft',
 'values',pg_temp.rb_values(2,1,6,2),'roster','{}'::jsonb) FROM rb_fixture;
INSERT INTO rb_results SELECT 'confirmed',public.stand_up_command('save',value) FROM rb_results WHERE name='payload';
DO $$ DECLARE r jsonb; k text; BEGIN
 SELECT value->'roster_confirmations' INTO r FROM rb_results WHERE name='confirmed';
 FOREACH k IN ARRAY ARRAY['sp_female_beds_open','sp_male_beds_open','sp_flexible_beds_open','private_beds_open'] LOOP
  IF r->k->>'source'<>'roster_confirmed' OR r->k->>'roster_as_of' IS NULL THEN RAISE EXCEPTION 'Bed figure % not roster_confirmed: %',k,r; END IF;
 END LOOP;
 IF r->'sp_flexible_beds_open'->>'suggested'<>'6' OR r->'sp_female_beds_open'->>'suggested'<>'2' THEN RAISE EXCEPTION 'Suggested bed values wrong: %',r; END IF;
 IF r ? 'current_total_census' THEN RAISE EXCEPTION 'A blank census must confirm nothing: %',r; END IF;
END $$;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value->'prefill_confirmations' INTO r FROM rb_results WHERE name='confirmed';
 IF r->'monthly_rent_roll_cents'->>'source' IS DISTINCT FROM 'haven_confirmed' OR r->'admissions_expected'->>'source' IS DISTINCT FROM 'haven_confirmed'
  OR r ? 'sp_female_beds_open' THEN RAISE EXCEPTION 'Non-bed prefill evidence lost or bed evidence duplicated: %',r; END IF;
END $$;
-- Bed overrides use the current facility reason list and retain its dated label.
INSERT INTO rb_results SELECT 'rule',public.operating_rule_record('stand_up.census_reason_options',fac,
 '[{"key":"room_assignment_pending","label":"Room assignment is pending"},{"key":"other","label":"Other"}]'::jsonb,
 (clock_timestamp() AT TIME ZONE 'America/New_York')::date,'Probe: configured bed reasons') FROM rb_fixture;
-- A differing bed figure is refused by name until a reason is given, then recorded as overridden.
SELECT pg_temp.rb_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'values',pg_temp.rb_values(3,1,6,2))),'Semi-private female beds open differs from the Haven roster (2)') FROM rb_results WHERE name='payload';
-- COL-553 still holds for beds: leaving the roster block out does not skip the comparison.
SELECT pg_temp.rb_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',(value-'roster')||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'values',pg_temp.rb_values(2,1,6,3))),'Private beds open differs from the Haven roster (2)') FROM rb_results WHERE name='payload';
SELECT pg_temp.rb_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'values',pg_temp.rb_values(3,1,6,2),
 'roster',jsonb_build_object('sp_female_beds_open',jsonb_build_object('override_reason','roster_not_current')))),'Invalid override reason') FROM rb_results WHERE name='payload';
INSERT INTO rb_results SELECT 'overridden',public.stand_up_command('save',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'values',pg_temp.rb_values(3,1,6,2),
 'roster',jsonb_build_object('sp_female_beds_open',jsonb_build_object('override_reason','room_assignment_pending')))) FROM rb_results WHERE name='payload';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value->'roster_confirmations' INTO r FROM rb_results WHERE name='overridden';
 IF r->'sp_female_beds_open'->>'source'<>'overridden' OR r->'sp_female_beds_open'->>'override_reason'<>'room_assignment_pending' OR r->'sp_female_beds_open'->>'override_reason_label' IS DISTINCT FROM 'Room assignment is pending' OR r->'sp_female_beds_open'->>'confirmed'<>'3'
  OR r->'sp_male_beds_open'->>'source'<>'roster_confirmed' THEN RAISE EXCEPTION 'Bed override not recorded: %',r; END IF;
END $$;
-- A facility with no beds in Haven records entered_no_roster for the bed figures.
INSERT INTO rb_results SELECT 'no_beds',public.stand_up_command('save',jsonb_build_object('facility_id',fac_empty,'week_start',week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft',
 'values',pg_temp.rb_values(0,0,3,1),'roster','{}'::jsonb)) FROM rb_fixture;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value->'roster_confirmations' INTO r FROM rb_results WHERE name='no_beds';
 IF r->'sp_flexible_beds_open'->>'source'<>'entered_no_roster' OR r->'sp_flexible_beds_open'->'suggested'<>'null'::jsonb THEN RAISE EXCEPTION 'No-bed save not recorded: %',r; END IF;
END $$;
RESET ROLE;
-- The shared six-key helper also serves Thursday. Its public form still has
-- census/hospital only; direct internal calls prove a bed never takes the hospital suggestion.
SET LOCAL ROLE authenticated;
INSERT INTO rb_results SELECT 'thursday_draft',public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',fac,
 'week_start',pg_temp.rb_thursday_week(),'expected_version',0,'request_id',gen_random_uuid(),'status','draft',
 'values',jsonb_build_object('current_ar_cents',null,'current_total_census',5,'departures_since_monday',null,'hospital_and_rehab_total',1,'hospital_total',0,'rehab_total',0))) FROM rb_fixture;
INSERT INTO rb_results SELECT 'thursday_confirmed',public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',fac,
 'week_start',pg_temp.rb_thursday_week(),'expected_version',1,'request_id',gen_random_uuid(),'status','draft',
 'values',jsonb_build_object('current_ar_cents',null,'current_total_census',4,'departures_since_monday',null,'hospital_and_rehab_total',1,'hospital_total',0,'rehab_total',0))) FROM rb_fixture;
RESET ROLE;
DO $$ DECLARE r jsonb; c jsonb; BEGIN
 SELECT value INTO r FROM rb_results WHERE name='thursday_draft';
 IF r->'roster_confirmations'->'current_total_census'->>'source' IS DISTINCT FROM 'differs_unexplained'
 THEN RAISE EXCEPTION 'Thursday draft reason behavior lost: %',r; END IF;
 PERFORM haven.stand_up_meeting_roster_confirm('{"status":"draft","values":{"sp_flexible_beds_open":7}}',f.org,f.fac,f.actor,(r->>'id')::uuid,(r->>'revision_id')::uuid) FROM rb_fixture f;
 c:=haven.stand_up_meeting_roster_confirmations((r->>'revision_id')::uuid);
 IF c->'sp_flexible_beds_open'->>'source' IS DISTINCT FROM 'differs_unexplained' OR c->'sp_flexible_beds_open'->>'suggested' IS DISTINCT FROM '6'
 THEN RAISE EXCEPTION 'Thursday bed suggestion must use bed RPC, not hospital count: %',c; END IF;
 SELECT value INTO r FROM rb_results WHERE name='thursday_confirmed';
 BEGIN
  PERFORM haven.stand_up_meeting_roster_confirm('{"status":"ready","values":{"sp_flexible_beds_open":7}}',f.org,f.fac,f.actor,(r->>'id')::uuid,(r->>'revision_id')::uuid) FROM rb_fixture f;
  RAISE EXCEPTION 'Thursday ready accepted missing bed reason';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF position('Semi-private flexible beds open differs from the Haven roster (6)' IN SQLERRM)=0 THEN RAISE; END IF;
 END;
 PERFORM haven.stand_up_meeting_roster_confirm('{"status":"ready","values":{"sp_flexible_beds_open":7},"roster":{"sp_flexible_beds_open":{"override_reason":"room_assignment_pending"}}}',f.org,f.fac,f.actor,(r->>'id')::uuid,(r->>'revision_id')::uuid) FROM rb_fixture f;
 c:=haven.stand_up_meeting_roster_confirmations((r->>'revision_id')::uuid);
 IF c->'sp_flexible_beds_open'->>'source' IS DISTINCT FROM 'overridden' OR c->'sp_flexible_beds_open'->>'override_reason_label' IS DISTINCT FROM 'Room assignment is pending'
  OR c->'current_total_census'->>'source' IS DISTINCT FROM 'roster_confirmed'
 THEN RAISE EXCEPTION 'Thursday configured reason or census confirmation lost: %',c; END IF;
END $$;
-- The woman in S2A leaves: S2 is no longer a female room. The next suggestion follows; the recorded one does not.
UPDATE public.residents SET status='discharged',bed_id=NULL WHERE last_name='S2' AND facility_id=(SELECT fac FROM rb_fixture);
DO $$ DECLARE c record; r jsonb; BEGIN
 SELECT * INTO c FROM public.stand_up_roster_beds((SELECT org FROM rb_fixture),(SELECT fac FROM rb_fixture));
 IF c.sp_female_open<>1 OR c.sp_flexible_open<>8 THEN RAISE EXCEPTION 'Last occupant must not keep a room female: %',to_jsonb(c); END IF;
 SELECT haven.stand_up_roster_confirmations(v.id) INTO r FROM public.stand_up_revisions v JOIN public.stand_up_reports p ON p.id=v.report_id
  WHERE p.facility_id=(SELECT fac FROM rb_fixture) AND p.week_start=(SELECT week FROM rb_fixture) AND v.version=1;
 IF r->'sp_female_beds_open'->>'suggested'<>'2' THEN RAISE EXCEPTION 'Recorded bed confirmation was recomputed: %',r; END IF;
END $$;
-- The guard behind the guard (457) now covers bed figures: a write around stand_up_save fails at commit.
DO $$ DECLARE rep uuid; BEGIN
 SELECT id INTO rep FROM public.stand_up_reports WHERE facility_id=(SELECT fac FROM rb_fixture) AND week_start=(SELECT week FROM rb_fixture);
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,provenance) VALUES(rep,99,pg_temp.rb_values(1,1,1,1),'draft',(SELECT actor FROM rb_fixture),'{}');
END $$;
SELECT pg_temp.rb_fail('SET CONSTRAINTS ALL IMMEDIATE','has no roster confirmation');
ROLLBACK;
