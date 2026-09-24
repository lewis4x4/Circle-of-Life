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

SELECT pg_temp.schedule_actor('manager'); SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; w uuid:=gen_random_uuid(); fall_week uuid:=gen_random_uuid(); v timestamptz; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 INSERT INTO public.schedules(id,organization_id,facility_id,week_start_date) VALUES(w,f.org,f.facility,'2027-03-08'),(fall_week,f.org,f.facility,'2027-11-01');
 SELECT updated_at INTO v FROM public.schedules WHERE id=w;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',w,v,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2027-03-14','custom_start_time','02:30','custom_end_time','04:00'))),'Shift time does not exist');
 SELECT updated_at INTO v FROM public.schedules WHERE id=fall_week;
 PERFORM public.schedule_bulk_upsert(fall_week,v,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2027-11-07','custom_start_time','01:30','custom_end_time','02:30')));
 IF NOT EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=fall_week AND schedule_starts_at='2027-11-07T06:30Z' AND schedule_ends_at='2027-11-07T07:30Z') THEN RAISE EXCEPTION 'Ambiguous start must select later standard-time occurrence'; END IF;
END $$; RESET ROLE; ROLLBACK;
