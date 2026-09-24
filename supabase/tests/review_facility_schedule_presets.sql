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

CREATE TEMP TABLE option_values(k text PRIMARY KEY,v jsonb);
GRANT ALL ON option_values TO authenticated,service_role;
UPDATE public.staff SET staff_role='cook' WHERE id=(SELECT colleague FROM schedule_fixture);
SELECT pg_temp.schedule_actor('manager');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; split_option jsonb; late_option jsonb; office_option jsonb; ver timestamptz; before_ids uuid[]; after_ids uuid[]; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 split_option:=public.schedule_preset_save(f.facility,NULL,0,'Split work','#ab23cd',1,'[{"start":"06:00","end":"13:00"},{"start":"16:00","end":"18:00"}]',ARRAY['resident_aide','cook']::public.staff_role[],true,false,true);
 late_option:=public.schedule_preset_save(f.facility,NULL,0,'Late work','#112233',2,'[{"start":"18:00","end":"06:00"}]',ARRAY['resident_aide']::public.staff_role[],true,false);
 office_option:=public.schedule_preset_save(f.facility,NULL,0,'Office','#000000',3,'[{"start":"09:00","end":"17:00"}]',ARRAY['administrator']::public.staff_role[],true,false);
 INSERT INTO option_values VALUES('split',split_option),('late',late_option),('office',office_option);
 IF split_option->>'color'<>'#AB23CD' OR split_option->>'roster_shift_type'<>'custom' THEN RAISE EXCEPTION 'Preset stored color/classification wrong'; END IF;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_preset_save(%L,NULL,0,%L,%L,0,%L,%L,true,false)',f.other_facility,'Forbidden','#000000','[{"start":"09:00","end":"10:00"}]',ARRAY['resident_aide']::public.staff_role[]),'Schedule manager access');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_preset_save(%L,%L,0,%L,%L,0,%L,%L,true,false)',f.facility,split_option->>'id','Stale','#000000','[{"start":"09:00","end":"10:00"}]',ARRAY['resident_aide']::public.staff_role[]),'Shift option changed');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_preset_save(%L,NULL,0,%L,%L,0,%L,%L,true,false)',f.facility,'Bad blocks','#000000','[{"start":"18:00","end":"06:00"},{"start":"20:00","end":"22:00"}]',ARRAY['resident_aide']::public.staff_role[]),'check constraint');
 SELECT updated_at INTO ver FROM public.schedules WHERE id=f.week;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-01','preset_id',office_option->>'id','expected_preset_version',1))),'not available for this employee role');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-01','preset_id',split_option->>'id','expected_preset_version',0))),'Shift option changed');
 PERFORM public.schedule_bulk_upsert(f.week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-01','preset_id',split_option->>'id','expected_preset_version',1),jsonb_build_object('staff_id',f.colleague,'shift_date','2091-01-01','preset_id',split_option->>'id','expected_preset_version',1)));
 IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.week AND deleted_at IS NULL)<>4 THEN RAISE EXCEPTION 'Two split groups not saved'; END IF;
 IF (SELECT sum(extract(epoch FROM schedule_ends_at-schedule_starts_at))/3600 FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.colleague AND deleted_at IS NULL)<>9 THEN RAISE EXCEPTION 'Cook split must total nine hours without gap'; END IF;
 SELECT array_agg(id ORDER BY schedule_block_index) INTO before_ids FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.staff AND deleted_at IS NULL;
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_assignments SET schedule_time_zone=%L WHERE id=%L','UTC',before_ids[1]),'snapshot fields are derived');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_assignments SET schedule_preset_name=%L WHERE id=%L','Forged',before_ids[1]),'snapshot fields are derived');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_assignments SET schedule_role_snapshot=%L WHERE id=%L','administrator',before_ids[1]),'snapshot fields are derived');
 UPDATE public.shift_assignments SET notes='Second block note' WHERE schedule_id=f.week AND staff_id=f.staff AND schedule_block_index=1;
 SELECT updated_at INTO ver FROM public.schedules WHERE id=f.week;
 PERFORM public.schedule_bulk_upsert(f.week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-01','preset_id',split_option->>'id','expected_preset_version',1)));
 SELECT array_agg(id ORDER BY schedule_block_index) INTO after_ids FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.staff AND deleted_at IS NULL;
 IF before_ids IS DISTINCT FROM after_ids OR NOT EXISTS(SELECT 1 FROM public.shift_assignments WHERE id=after_ids[2] AND notes='Second block note') THEN RAISE EXCEPTION 'Existing block identities/metadata lost'; END IF;
 PERFORM public.schedule_preset_save(f.facility,(split_option->>'id')::uuid,1,'Changed future hours','#00FF00',1,'[{"start":"05:00","end":"12:00"},{"start":"15:00","end":"17:00"}]',ARRAY['resident_aide','cook']::public.staff_role[],false,false);
 IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.week AND deleted_at IS NULL AND (schedule_preset_name<>'Split work' OR schedule_preset_color<>'#AB23CD')) THEN RAISE EXCEPTION 'Preset edit rewrote saved assignment'; END IF;
 SELECT updated_at INTO ver FROM public.schedules WHERE id=f.next_week;
 PERFORM public.schedule_copy_week(f.next_week,ver);
 IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.next_week AND deleted_at IS NULL AND schedule_preset_name='Split work')<>4 OR NOT EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.next_week AND staff_id=f.staff AND schedule_block_index=1 AND notes='Second block note' AND custom_start_time='16:00') THEN RAISE EXCEPTION 'Copy must retain saved blocks and per-block metadata after deactivation'; END IF;
 IF EXISTS(SELECT 1 FROM public.shift_assignments a JOIN public.shift_assignments b ON b.schedule_group_id=a.schedule_group_id WHERE a.schedule_id=f.week AND b.schedule_id=f.next_week) THEN RAISE EXCEPTION 'Copy reused original group identity'; END IF;
 -- Direct row deletion cannot publish an incomplete managed group.
 UPDATE public.shift_assignments SET deleted_at=now() WHERE schedule_id=f.next_week AND staff_id=f.staff AND schedule_block_index=1;
 SELECT updated_at INTO ver FROM public.schedules WHERE id=f.next_week;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_publish(%L,%L)',f.next_week,ver),'Review assignments');
 UPDATE public.shift_assignments SET deleted_at=NULL WHERE schedule_id=f.next_week AND staff_id=f.staff AND schedule_block_index=1;
 -- One-off split groups and empty array rejection.
 SELECT updated_at INTO ver FROM public.schedules WHERE id=f.empty_week;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.empty_week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-15','custom_blocks','[]'::jsonb))),'Custom blocks require');
 PERFORM public.schedule_bulk_upsert(f.empty_week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-15','custom_blocks','[{"start":"06:00","end":"10:00"},{"start":"15:00","end":"19:00"}]'::jsonb)));
 IF NOT haven.schedule_cell_intact(f.empty_week,f.staff,'2091-01-15') THEN RAISE EXCEPTION 'Custom split group is not intact'; END IF;
 UPDATE public.schedules SET status='published' WHERE id=f.week;
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_assignments SET schedule_preset_color=%L WHERE id=%L','#FFFFFF',before_ids[1]),'Published assignment snapshots are immutable');
 INSERT INTO option_values VALUES('staff_first',to_jsonb(before_ids[1]));
END $$;
RESET ROLE;
SELECT pg_temp.schedule_actor('med_tech');SET LOCAL ROLE authenticated;
SELECT pg_temp.schedule_expect_error(format('SELECT public.schedule_preset_save(%L,NULL,0,%L,%L,0,%L,%L,true,false)',facility,'Forbidden','#000000','[{"start":"09:00","end":"10:00"}]',ARRAY['resident_aide']::public.staff_role[]),'Schedule manager access') FROM schedule_fixture;
DO $$ DECLARE f record; n integer; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 SELECT count(*) INTO n FROM public.schedule_assignment_intervals(f.facility,'2091-01-01T11:00Z','2091-01-01T23:00Z',f.staff);
 IF n<>2 THEN RAISE EXCEPTION 'Own two published intervals should be visible'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_assignment_intervals(NULL,'2091-01-01T00:00Z','2091-01-03T00:00Z',NULL)) THEN RAISE EXCEPTION 'Unscoped interval query must return no rows'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_assignment_intervals(f.facility,'2091-01-01T19:00Z','2091-01-01T20:00Z',f.staff)) THEN RAISE EXCEPTION 'Split break must not be planned work'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_assignment_intervals(f.other_facility,'2091-01-01T00:00Z','2091-01-03T00:00Z',NULL)) THEN RAISE EXCEPTION 'Crossfacility rows leaked'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE f record; o record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 SELECT * INTO o FROM haven.resolve_observation_instant(f.facility,'2091-01-01T17:00Z',ARRAY[f.resident],'2091-01-01T17:00Z');
 IF o.staff_id IS DISTINCT FROM f.staff THEN RAISE EXCEPTION 'Eligible published custom role must own noon task'; END IF;
 SELECT * INTO o FROM haven.resolve_observation_instant(f.facility,'2091-01-01T19:00Z',ARRAY[f.resident],'2091-01-01T19:00Z');
 IF o.staff_id IS NOT NULL THEN RAISE EXCEPTION 'Nobody may own tasks through split break'; END IF;
 SELECT * INTO o FROM haven.resolve_observation_instant(f.facility,'2091-01-01T22:00Z',ARRAY[f.resident],'2091-01-01T22:00Z');
 IF o.staff_id IS DISTINCT FROM f.staff THEN RAISE EXCEPTION 'Eligible published custom role must own evening block task'; END IF;
 UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT id FROM schedule_actors WHERE role='med_tech');
 SELECT * INTO o FROM haven.resolve_observation_instant(f.facility,'2091-01-01T22:00Z',ARRAY[f.resident],'2091-01-01T22:00Z');
 IF o.staff_id IS NOT NULL THEN RAISE EXCEPTION 'Preset may not restore inactive clinical authority'; END IF;
END $$;
ROLLBACK;
