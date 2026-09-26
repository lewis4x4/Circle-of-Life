-- COL-753: Monday arrives prefilled from Haven and the administrator verifies.
-- Fails before migration 522 (no prefill command, nothing recorded per figure).
-- Native scratch-only probe; every fixture rolls back. Synthetic data only.
BEGIN;
SET LOCAL client_min_messages=warning;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON public.residents,public.resident_status_history,public.family_resident_links TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE pf AS SELECT gen_random_uuid() actor,gen_random_uuid() session,gen_random_uuid() org,gen_random_uuid() ent,
 gen_random_uuid() fac,gen_random_uuid() fac_empty,gen_random_uuid() fac_other,gen_random_uuid() room,gen_random_uuid() resident,
 gen_random_uuid() staff_id,haven.stand_up_open_week(NULL) week;
INSERT INTO public.organizations(id,name) SELECT org,'Prefill probe' FROM pf;
INSERT INTO public.entities(id,organization_id,name) SELECT ent,org,'Prefill entity' FROM pf;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT fac,ent,org,'Prefill facility','1 Way','Town','00000',12 FROM pf
 UNION ALL SELECT fac_empty,ent,org,'Prefill empty facility','2 Way','Town','00000',12 FROM pf
 UNION ALL SELECT fac_other,ent,org,'Prefill other facility','3 Way','Town','00000',12 FROM pf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','org_admin'),'{"full_name":"Prefill probe"}' FROM pf;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT actor,actor||'@review.invalid','Prefill probe','org_admin',org,true FROM pf;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM pf;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,fac,org FROM pf UNION ALL SELECT actor,fac_empty,org FROM pf;

-- The facility: two residents (one at hospital), three beds, invoices, a callout and a planned admission.
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,gender,status,discharge_target_date)
 SELECT resident,fac,org,'Test Resident','A','prefer_not_to_say'::gender,'active'::resident_status,week+2 FROM pf
 UNION ALL SELECT gen_random_uuid(),fac,org,'Test Resident','B','prefer_not_to_say','hospital_hold',NULL FROM pf;
INSERT INTO public.rooms(id,facility_id,organization_id,room_number,room_type) SELECT room,fac,org,'101','semi_private' FROM pf;
INSERT INTO public.beds(room_id,facility_id,organization_id,bed_label,status,standup_availability_class)
 SELECT room,fac,org,l,'available',c::standup_bed_availability_class FROM pf, (VALUES ('A','private'),('B','sp_female'),('C','sp_female')) v(l,c);
INSERT INTO public.invoices(resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,total,balance_due)
 SELECT resident,fac,org,ent,n,current_date,current_date,current_date-30*m,current_date-30*m+29,'draft',t,t,t FROM pf,
  (VALUES ('P-1',1000000,0),('P-2',500000,1),('P-3',300000,2),('P-4',700000,3),('P-5',400000,4)) v(n,t,m);
-- Settle them as a payer would: sent, paid in full, voided, partly paid.
UPDATE public.invoices SET status=v.s::invoice_status,amount_paid=v.paid,balance_due=total-v.paid
 FROM (VALUES ('P-2','sent',0),('P-3','paid',300000),('P-4','void',0),('P-5','partial',250000)) v(n,s,paid)
 WHERE invoice_number=v.n AND facility_id=(SELECT fac FROM pf);
INSERT INTO public.staff(id,facility_id,organization_id,first_name,last_name,staff_role,hire_date,termination_date)
 SELECT staff_id,fac,org,'Test','Staff','cna',current_date-400,week-3 FROM pf;
INSERT INTO public.staff_attendance_events(staff_id,facility_id,organization_id,event_type,occurred_at)
 SELECT staff_id,fac,org,e::staff_attendance_event_type,(week-3)::timestamp AT TIME ZONE 'America/New_York' FROM pf, (VALUES ('callout'),('no_show'),('left_early')) v(e);
INSERT INTO public.admission_cases(resident_id,organization_id,facility_id,status,target_move_in_date)
 SELECT resident,org,fac,'pending_clearance',week+3 FROM pf;

CREATE FUNCTION pg_temp.pf_actor() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true) FROM pf f JOIN public.user_profiles p ON p.id=f.actor;
END $$;
CREATE TEMP TABLE pf_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON pf_results TO authenticated;
GRANT SELECT ON pf TO authenticated;
CREATE FUNCTION pg_temp.pf_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;

-- Grant posture: the prefill and its record are reachable only through the command.
DO $$ BEGIN
 IF has_function_privilege('authenticated','haven.stand_up_monday_prefill(uuid,uuid,date)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_prefill_for(jsonb)','EXECUTE')
 OR has_table_privilege('authenticated','public.stand_up_prefill_confirmations','SELECT')
 OR has_table_privilege('service_role','public.stand_up_prefill_confirmations','INSERT')
 THEN RAISE EXCEPTION 'Prefill grant boundary failed'; END IF;
END $$;

SELECT pg_temp.pf_actor();
SET LOCAL ROLE authenticated;
INSERT INTO pf_results SELECT 'prefill',public.stand_up_command('prefill',jsonb_build_object('facility_id',fac)) FROM pf;
INSERT INTO pf_results SELECT 'prefill_empty',public.stand_up_command('prefill',jsonb_build_object('facility_id',fac_empty)) FROM pf;
RESET ROLE;

-- Every computable figure with its source; what Haven cannot compute says so, never 0.
DO $$ DECLARE p jsonb; e jsonb; BEGIN
 SELECT value INTO p FROM pf_results WHERE name='prefill';
 IF p->>'week_start'<>(SELECT week::text FROM pf) OR p->>'computed_at' IS NULL THEN RAISE EXCEPTION 'Prefill identity wrong: %',p; END IF;
 -- Draft 10,000 + sent 5,000 + partial 1,500; paid and void are not owed.
 IF (p->'fields'->'monthly_rent_roll_cents'->>'value')::bigint<>1650000 OR p->'fields'->'monthly_rent_roll_cents'->>'source' IS NULL THEN RAISE EXCEPTION 'Current AR wrong: %',p->'fields'->'monthly_rent_roll_cents'; END IF;
 IF (p->'fields'->'current_total_census'->>'value')::int<>2 OR (p->'fields'->'hospital_and_rehab_total'->>'value')::int<>1 THEN RAISE EXCEPTION 'Roster figures wrong: %',p; END IF;
 IF (p->'fields'->'private_beds_open'->>'value')::int<>0 OR (p->'fields'->'sp_female_beds_open'->>'value')::int<>0 OR (p->'fields'->'sp_flexible_beds_open'->>'value')::int<>3 OR (p->'fields'->'sp_male_beds_open'->>'value')::int<>0 THEN RAISE EXCEPTION 'Beds wrong: %',p; END IF;
 IF (p->'fields'->'admissions_expected'->>'value')::int<>1 OR (p->'fields'->'expected_discharges'->>'value')::int<>1 THEN RAISE EXCEPTION 'Forecasts wrong: %',p; END IF;
 IF (p->'fields'->'callouts_last_week'->>'value')::int<>2 OR (p->'fields'->'terminations_last_week'->>'value')::int<>1 THEN RAISE EXCEPTION 'Last week wrong: %',p; END IF;
 IF p->'fields'->'current_open_positions'->'value'<>'null'::jsonb OR p->'fields'->'overtime_reported'->'value'<>'null'::jsonb
  OR p->'fields'->'current_open_positions'->>'note' IS NULL OR p->'fields'->'overtime_reported'->>'note' IS NULL THEN RAISE EXCEPTION 'Unchecked figures must say why they are blank: %',p; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p->'fields'))<>cardinality(haven.stand_up_keys()) THEN RAISE EXCEPTION 'Prefill must answer every Monday figure'; END IF;
 SELECT value INTO e FROM pf_results WHERE name='prefill_empty';
 IF e->'fields'->'monthly_rent_roll_cents'->'value'<>'null'::jsonb OR e->'fields'->'current_total_census'->'value'<>'null'::jsonb
  OR e->'fields'->'private_beds_open'->'value'<>'null'::jsonb OR e->'fields'->'callouts_last_week'->'value'<>'null'::jsonb
  OR e->'fields'->'terminations_last_week'->'value'<>'null'::jsonb OR e->'fields'->'monthly_rent_roll_cents'->>'note' IS NULL THEN
  RAISE EXCEPTION 'A facility with nothing in Haven must get blanks with reasons, not zeros: %',e; END IF;
END $$;

-- An empty room stays flexible regardless of stale stored Stand Up class.
INSERT INTO public.beds(room_id,facility_id,organization_id,bed_label,status) SELECT room,fac,org,'D','available' FROM pf;
DO $$ BEGIN
 IF haven.stand_up_monday_prefill((SELECT org FROM pf),(SELECT fac FROM pf),(SELECT week FROM pf))->'fields'->'sp_flexible_beds_open'->'value'<>'4'::jsonb THEN
  RAISE EXCEPTION 'An empty room must derive four flexible beds'; END IF;
END $$;
DELETE FROM public.beds WHERE bed_label='D' AND facility_id=(SELECT fac FROM pf);

-- Saving Haven's figures unchanged records them as Haven-confirmed.
CREATE FUNCTION pg_temp.pf_values(p_over jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_object_agg(k,coalesce(p_over->k,(SELECT value->'fields'->k->'value' FROM pf_results WHERE name='prefill'),'null'::jsonb)) FROM unnest(haven.stand_up_keys()) k
$$;
GRANT EXECUTE ON FUNCTION pg_temp.pf_values(jsonb) TO authenticated;
SELECT pg_temp.pf_actor();
SET LOCAL ROLE authenticated;
INSERT INTO pf_results SELECT 'base_payload',jsonb_build_object('facility_id',fac,'week_start',week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft','values',pg_temp.pf_values()) FROM pf;
INSERT INTO pf_results SELECT 'confirmed',public.stand_up_command('save',value) FROM pf_results WHERE name='base_payload';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM pf_results WHERE name='confirmed';
 IF r->'prefill_confirmations'->'monthly_rent_roll_cents'->>'source'<>'haven_confirmed' OR (r->'prefill_confirmations'->'monthly_rent_roll_cents'->>'haven_value')::bigint<>1650000
  OR r->'prefill_confirmations'->'callouts_last_week'->>'source'<>'haven_confirmed' OR r->'roster_confirmations'->'private_beds_open'->>'source'<>'roster_confirmed'
  OR r->'prefill_confirmations' ? 'current_total_census' OR r->'prefill_confirmations' ? 'current_open_positions'
  OR r->'roster_confirmations'->'current_total_census'->>'source'<>'roster_confirmed' THEN RAISE EXCEPTION 'Unchanged save not recorded as Haven-confirmed: %',r; END IF;
END $$;
-- A figure Haven cannot compute is recorded as entered with no source.
INSERT INTO pf_results SELECT 'entered',public.stand_up_command('save',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',1,'values',pg_temp.pf_values('{"current_open_positions":2,"overtime_reported":1.3}'))) FROM pf_results WHERE name='base_payload';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM pf_results WHERE name='entered';
 IF r->'prefill_confirmations'->'current_open_positions'->>'source'<>'entered_no_source' OR r->'prefill_confirmations'->'current_open_positions'->'haven_value'<>'null'::jsonb THEN RAISE EXCEPTION 'Entered figure not recorded: %',r; END IF;
END $$;
-- A draft may keep a different figure without a reason; it is recorded as overridden with none.
INSERT INTO pf_results SELECT 'draft_override',public.stand_up_command('save',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',2,'values',pg_temp.pf_values('{"current_open_positions":2,"overtime_reported":1.3,"callouts_last_week":5}'))) FROM pf_results WHERE name='base_payload';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM pf_results WHERE name='draft_override';
 IF r->'prefill_confirmations'->'callouts_last_week'->>'source'<>'overridden' OR r->'prefill_confirmations'->'callouts_last_week'->'override_reason'<>'null'::jsonb THEN RAISE EXCEPTION 'Draft override not recorded: %',r; END IF;
END $$;
-- An unknown reason is refused.
SELECT pg_temp.pf_fail(format('SELECT public.stand_up_command(''save'',%L::jsonb)',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',3,'values',pg_temp.pf_values('{"current_open_positions":2,"overtime_reported":1.3,"callouts_last_week":5}'),'prefill',jsonb_build_object('callouts_last_week',jsonb_build_object('override_reason','because')))),'Invalid override reason') FROM pf_results WHERE name='base_payload';
RESET ROLE;
-- Submitting a differing figure needs its reason. Checked on the recording step
-- itself, so the probe does not depend on the payroll week having closed today.
SELECT pg_temp.pf_fail(format('SELECT haven.stand_up_roster_confirm(%L::jsonb,%L,%L,%L,%L,%L)',
  jsonb_build_object('roster','{}'::jsonb,'status','ready','values',(SELECT jsonb_object_agg(k,CASE WHEN k='callouts_last_week' THEN to_jsonb(5) ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k)),
  f.org,f.fac,f.actor,r.id,gen_random_uuid()),'Callouts last week differs from Haven (2)')
 FROM pf f JOIN public.stand_up_reports r ON r.facility_id=f.fac AND r.week_start=f.week;
SELECT pg_temp.pf_actor();
SET LOCAL ROLE authenticated;
INSERT INTO pf_results SELECT 'reasoned',public.stand_up_command('save',value||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',3,'values',pg_temp.pf_values('{"current_open_positions":2,"overtime_reported":1.3,"callouts_last_week":5}'),
 'prefill',jsonb_build_object('callouts_last_week',jsonb_build_object('override_reason','haven_not_current'),'terminations_last_week',jsonb_build_object('override_reason','other')))) FROM pf_results WHERE name='base_payload';
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM pf_results WHERE name='reasoned';
 IF r->'prefill_confirmations'->'callouts_last_week'->>'override_reason'<>'haven_not_current' OR (r->'prefill_confirmations'->'callouts_last_week'->>'confirmed')::numeric<>5 THEN RAISE EXCEPTION 'Reasoned override not recorded: %',r; END IF;
 -- A reason sent with a matching figure is dropped: the server decides the source.
 IF r->'prefill_confirmations'->'terminations_last_week'->>'source'<>'haven_confirmed' OR r->'prefill_confirmations'->'terminations_last_week'->'override_reason'<>'null'::jsonb THEN RAISE EXCEPTION 'Server must own the source: %',r; END IF;
END $$;
-- The workspace carries the recorded confirmations of the latest revision.
INSERT INTO pf_results VALUES('workspace',public.stand_up_command('workspace','{}'));
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM jsonb_array_elements((SELECT value->'reports' FROM pf_results WHERE name='workspace')) WHERE value->>'facility_id'=(SELECT fac::text FROM pf);
 IF r->'prefill_confirmations'->'callouts_last_week'->>'override_reason'<>'haven_not_current' OR r->>'version'<>'4' THEN RAISE EXCEPTION 'Workspace lost the recorded prefill: %',r; END IF;
END $$;
RESET ROLE;
-- Append only, and a historical correction records nothing.
SELECT pg_temp.pf_fail('UPDATE public.stand_up_prefill_confirmations SET confirmed_value=99 WHERE facility_id='''||(SELECT fac FROM pf)||'''','immutable');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.stand_up_prefill_confirmations c JOIN public.stand_up_revisions v ON v.id=c.revision_id WHERE c.facility_id=(SELECT fac FROM pf) AND v.version=4)<>10 THEN
  RAISE EXCEPTION 'Revision 4 must record the 10 non-roster figures it carried'; END IF;
END $$;

-- Monday's publishers and exports are unchanged: none reads the new record.
DO $$ DECLARE fn text; BEGIN
 FOR fn IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','haven') AND p.proname IN ('stand_up_export_history','stand_up_export_aggregate','stand_up_google_export_bridge','stand_up_google_bridge') LOOP
  IF pg_get_functiondef(fn::regprocedure) ~ 'prefill' THEN RAISE EXCEPTION 'A Monday publisher reads the prefill: %',fn; END IF;
 END LOOP;
END $$;
-- One version of Monday's numbers: the latest submission per facility, which the
-- Executive pack reads. Last week was submitted; this week's drafts are not a submission.
DO $$ DECLARE f record; rid uuid; vid uuid; BEGIN
 SELECT * INTO f FROM pf;
 INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status) VALUES(f.org,f.fac,f.week-7,pg_temp.pf_values('{"monthly_rent_roll_cents":4242}'),'ready') RETURNING id INTO rid;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,reason) VALUES(rid,1,pg_temp.pf_values('{"monthly_rent_roll_cents":4242}'),'ready',f.actor,'Probe history') RETURNING id INTO vid;
 UPDATE public.stand_up_reports SET version=1,revision_id=vid WHERE id=rid;
END $$;
SELECT pg_temp.pf_actor();
SET LOCAL ROLE authenticated;
INSERT INTO pf_results VALUES('submitted',public.stand_up_command('submitted_latest','{}'));
RESET ROLE;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM pf_results WHERE name='submitted';
 IF jsonb_array_length(r)<>1 OR r->0->>'facility_id'<>(SELECT fac::text FROM pf) OR r->0->>'week_start'<>(SELECT (week-7)::text FROM pf)
  OR (r->0->'values'->>'monthly_rent_roll_cents')::int<>4242 OR r->0->>'submitted_at' IS NULL THEN RAISE EXCEPTION 'Latest submission wrong: %',r; END IF;
END $$;

-- A facility administrator without the facility grant is refused the prefill.
UPDATE public.user_profiles SET app_role='facility_admin' WHERE id=(SELECT actor FROM pf);
SELECT pg_temp.pf_actor();
SET LOCAL ROLE authenticated;
SELECT pg_temp.pf_fail(format('SELECT public.stand_up_command(''prefill'',%L::jsonb)',jsonb_build_object('facility_id',fac_other)),'access denied') FROM pf;
RESET ROLE;
ROLLBACK;
