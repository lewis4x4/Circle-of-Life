-- Disposable replay only. All fixtures and auth overrides roll back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE schedule_fixture AS
SELECT f.id facility,f.organization_id org,
 (SELECT id FROM public.facilities WHERE organization_id=f.organization_id AND id<>f.id AND deleted_at IS NULL LIMIT 1) other_facility,
 gen_random_uuid() staff,gen_random_uuid() colleague,gen_random_uuid() week,gen_random_uuid() next_week,gen_random_uuid() empty_week,
 gen_random_uuid() definition,gen_random_uuid() overlap_definition,gen_random_uuid() swap,gen_random_uuid() other_staff,gen_random_uuid() other_week,gen_random_uuid() unit,gen_random_uuid() resident
FROM public.facilities f WHERE f.deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.facilities b WHERE b.organization_id=f.organization_id AND b.id<>f.id AND b.deleted_at IS NULL) LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM schedule_fixture) THEN RAISE EXCEPTION 'Two replay facilities required'; END IF; END $$;
CREATE TEMP TABLE schedule_actors AS SELECT role,gen_random_uuid() id,gen_random_uuid() session_id FROM unnest(ARRAY['med_tech','manager','facility_admin']) role;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT a.id,a.id||'@schedule-review.invalid',jsonb_build_object('organization_id',f.org,'app_role',a.role),'{}'::jsonb FROM schedule_actors a CROSS JOIN schedule_fixture f;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
SELECT a.id,a.id||'@schedule-review.invalid','Schedule review',a.role::public.app_role,f.org,true FROM schedule_actors a CROSS JOIN schedule_fixture f
ON CONFLICT (id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session_id,id FROM schedule_actors;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT a.id,f.facility,f.org FROM schedule_actors a CROSS JOIN schedule_fixture f;
INSERT INTO public.staff(id,user_id,organization_id,facility_id,first_name,last_name,staff_role,hire_date)
SELECT f.staff,a.id,f.org,f.facility,'Own','Schedule','resident_aide',current_date FROM schedule_fixture f CROSS JOIN schedule_actors a WHERE a.role='med_tech';
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date)
SELECT colleague,org,facility,'Other','Schedule','resident_aide',current_date FROM schedule_fixture;
INSERT INTO public.schedules(id,facility_id,organization_id,week_start_date)
SELECT week,facility,org,'2091-01-01'::date FROM schedule_fixture
UNION ALL SELECT next_week,facility,org,'2091-01-08'::date FROM schedule_fixture
UNION ALL SELECT empty_week,facility,org,'2091-01-15'::date FROM schedule_fixture;
INSERT INTO public.facility_shift_definitions(id,organization_id,facility_id,shift_key,roster_shift_type,label,starts_at_local,ends_at_local)
SELECT definition,org,facility,'schedule_review','night','Review night','18:00','06:00' FROM schedule_fixture;
INSERT INTO public.facility_shift_definitions(id,organization_id,facility_id,shift_key,roster_shift_type,label,starts_at_local,ends_at_local)
SELECT overlap_definition,org,facility,'schedule_overlap_review','day','Review day','05:00','17:00' FROM schedule_fixture;
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date) SELECT other_staff,org,other_facility,'Inaccessible','Employee','resident_aide',current_date FROM schedule_fixture;
INSERT INTO public.schedules(id,facility_id,organization_id,week_start_date) SELECT other_week,other_facility,org,'2091-01-01' FROM schedule_fixture;
INSERT INTO public.units(id,facility_id,organization_id,name) SELECT unit,facility,org,'Grid preservation unit' FROM schedule_fixture;
CREATE FUNCTION pg_temp.schedule_actor(p_role text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a record;
BEGIN
 SELECT t.id,t.session_id,p.auth_claim_version,p.organization_id INTO STRICT a FROM schedule_actors t JOIN public.user_profiles p ON p.id=t.id WHERE t.role=p_role;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session_id,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',a.auth_claim_version,'role','authenticated','app_role',p_role,'organization_id',a.organization_id,'app_metadata',jsonb_build_object('app_role',p_role,'organization_id',a.organization_id))::text,true);
END $$;
CREATE FUNCTION pg_temp.schedule_expect_error(p_sql text,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
   IF position(p_message in SQLERRM)=0 THEN RAISE EXCEPTION 'Expected %, received %',p_message,SQLERRM; END IF;
   RETURN;
 END;
 RAISE EXCEPTION 'Expected failure: %',p_sql;
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON schedule_fixture,schedule_actors TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.schedules,public.shift_assignments TO authenticated;
GRANT UPDATE(employment_status) ON public.staff TO authenticated;
GRANT SELECT ON public.facility_shift_definitions,public.staff,public.staff_certifications,public.facilities,public.family_resident_links,public.residents TO authenticated;

-- Custom hours share the same manager, draft, version and facility boundaries.
SELECT pg_temp.schedule_actor('manager');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; version timestamptz; original_id uuid; cells jsonb; bad jsonb; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 SELECT updated_at INTO version FROM public.schedules WHERE id=f.week;
 cells:=jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-01','shift_definition_id',NULL,'custom_start_time','09:15','custom_end_time','15:45'),
   jsonb_build_object('staff_id',f.colleague,'shift_date','2091-01-01','shift_definition_id',NULL,'custom_start_time','22:00','custom_end_time','04:30'));
 PERFORM public.schedule_bulk_upsert(f.week,version,cells);
 IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.week AND deleted_at IS NULL AND shift_type='custom' AND shift_definition_id IS NULL)<>2 THEN RAISE EXCEPTION 'Custom day and overnight cells were not persisted'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.staff AND custom_start_time='09:15' AND custom_end_time='15:45') THEN RAISE EXCEPTION 'Custom hours changed'; END IF;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,cells),'Schedule changed');
 SELECT id INTO original_id FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.staff AND deleted_at IS NULL;
 UPDATE public.shift_assignments SET unit_id=f.unit,assigned_resident_ids=ARRAY[f.resident],shift_classification='agency',notes='Custom care plan' WHERE id=original_id;
 SELECT updated_at INTO version FROM public.schedules WHERE id=f.week;
 -- Invalid requests fail before any cell or optimistic version changes.
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
   jsonb_build_object('custom_start_time','09:00'),
   jsonb_build_object('custom_end_time','17:00'),
   jsonb_build_object('custom_start_time','24:00','custom_end_time','17:00'),
   jsonb_build_object('custom_start_time','9am','custom_end_time','17:00'),
   jsonb_build_object('custom_start_time','09:00Z','custom_end_time','17:00'),
   jsonb_build_object('custom_start_time','09:60','custom_end_time','17:00'),
   jsonb_build_object('custom_start_time','','custom_end_time','17:00')
 )) LOOP
   PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,jsonb_build_array(cells->1,((cells->0)-'custom_start_time'-'custom_end_time')||bad)),'Custom shifts require valid');
 END LOOP;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,jsonb_build_array((cells->0)||jsonb_build_object('custom_start_time','09:00','custom_end_time','09:00:00'))),'must differ');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,jsonb_build_array((cells->0)||jsonb_build_object('shift_definition_id',f.definition))),'not both');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,jsonb_build_array((cells->0)||jsonb_build_object('staff_id',f.other_staff))),'Active employee in schedule facility');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,jsonb_build_array((cells->0)||jsonb_build_object('shift_date','2091-01-08'))),'inside this schedule week');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,jsonb_build_array(cells->0,cells->0)),'Duplicate employee/date');
 IF (SELECT updated_at FROM public.schedules WHERE id=f.week) IS DISTINCT FROM version THEN RAISE EXCEPTION 'Invalid custom request mutated version'; END IF;
 -- One conflicting next-day custom shift rolls back a valid preceding change too.
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,jsonb_build_array(
   (cells->0)||jsonb_build_object('custom_end_time','16:30'),
   (cells->1)||jsonb_build_object('shift_date','2091-01-02','custom_start_time','04:00','custom_end_time','08:00'))),'overlapping shifts');
 IF (SELECT updated_at FROM public.schedules WHERE id=f.week) IS DISTINCT FROM version OR (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.week AND deleted_at IS NULL)<>2 OR (SELECT custom_end_time FROM public.shift_assignments WHERE id=original_id)<>'15:45' THEN RAISE EXCEPTION 'Overlap left a partial custom save'; END IF;
 -- Configuration/custom changes preserve identity and metadata.
 PERFORM public.schedule_bulk_upsert(f.week,version,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-01','shift_definition_id',f.definition)));
 PERFORM public.schedule_bulk_upsert(f.week,(SELECT updated_at FROM public.schedules WHERE id=f.week),jsonb_build_array(cells->0));
 IF NOT EXISTS(SELECT 1 FROM public.shift_assignments WHERE id=original_id AND deleted_at IS NULL AND shift_type='custom' AND shift_definition_id IS NULL AND custom_start_time='09:15' AND custom_end_time='15:45' AND unit_id=f.unit AND assigned_resident_ids=ARRAY[f.resident] AND shift_classification='agency' AND notes='Custom care plan') THEN RAISE EXCEPTION 'Custom edit lost identity or metadata'; END IF;
 -- Existing custom cells move atomically despite an intermediate overnight overlap.
 BEGIN
   PERFORM public.schedule_bulk_upsert(f.week,(SELECT updated_at FROM public.schedules WHERE id=f.week),jsonb_build_array(
     (cells->0)||jsonb_build_object('shift_date','2091-01-02','custom_start_time','05:00','custom_end_time','17:00')));
   PERFORM public.schedule_bulk_upsert(f.week,(SELECT updated_at FROM public.schedules WHERE id=f.week),jsonb_build_array(
     (cells->0)||jsonb_build_object('custom_start_time','20:00','custom_end_time','06:00'),
     (cells->0)||jsonb_build_object('shift_date','2091-01-02','custom_start_time','20:00','custom_end_time','06:00')));
   IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.staff AND deleted_at IS NULL AND custom_start_time='20:00' AND custom_end_time='06:00')<>2 THEN RAISE EXCEPTION 'Custom multi-cell move was not atomic'; END IF;
   RAISE EXCEPTION USING ERRCODE='P0756',MESSAGE='rollback custom move fixture';
 EXCEPTION WHEN SQLSTATE 'P0756' THEN NULL;
 END;
 -- Explicit custom shifts copy their actual times and metadata to the next week.
 PERFORM public.schedule_copy_week(f.next_week,(SELECT updated_at FROM public.schedules WHERE id=f.next_week));
 IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.next_week AND deleted_at IS NULL AND shift_type='custom' AND shift_definition_id IS NULL)<>2
 OR NOT EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.next_week AND staff_id=f.staff AND shift_date='2091-01-08' AND custom_start_time='09:15' AND custom_end_time='15:45' AND unit_id=f.unit AND assigned_resident_ids=ARRAY[f.resident] AND shift_classification='agency' AND notes='Custom care plan')
 OR NOT EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.next_week AND staff_id=f.colleague AND custom_start_time='22:00' AND custom_end_time='04:30') THEN RAISE EXCEPTION 'Copy lost custom hours or metadata'; END IF;
 -- Unmatched legacy/configuration shifts must still fail instead of becoming custom.
 UPDATE public.shift_assignments SET shift_type='day',schedule_copied_from_assignment_id=NULL WHERE schedule_id=f.next_week AND staff_id=f.staff;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_copy_week(%L,(SELECT updated_at FROM public.schedules WHERE id=%L))',f.empty_week,f.empty_week),'without a matching active definition');
 IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.empty_week AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid legacy copy left a partial week'; END IF;
 UPDATE public.shift_assignments SET shift_type='custom',custom_start_time=NULL WHERE schedule_id=f.next_week AND staff_id=f.staff;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_copy_week(%L,(SELECT updated_at FROM public.schedules WHERE id=%L))',f.empty_week,f.empty_week),'incomplete groups or unrecorded times');
 -- Off soft deletes a custom shift while keeping the saved historical plan.
 PERFORM public.schedule_bulk_upsert(f.week,(SELECT updated_at FROM public.schedules WHERE id=f.week),jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-01','shift_definition_id',NULL)));
 IF NOT EXISTS(SELECT 1 FROM public.shift_assignments WHERE id=original_id AND deleted_at IS NOT NULL AND custom_start_time='09:15' AND notes='Custom care plan') THEN RAISE EXCEPTION 'Off lost custom history'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.schedule_actor('med_tech');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,now(),%L)',f.week,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-01','shift_definition_id',NULL,'custom_start_time','09:00','custom_end_time','17:00'))),'Schedule manager access');
END $$;
RESET ROLE;
ROLLBACK;
