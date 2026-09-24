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

CREATE TEMP TABLE visitor_options(k text PRIMARY KEY,v jsonb);
GRANT ALL ON visitor_options TO authenticated;
INSERT INTO public.staff_facility_assignments(organization_id,staff_id,facility_id,role_at_facility,start_date,end_date) SELECT org,other_staff,facility,'cook','2091-01-01','2091-01-01' FROM schedule_fixture;
INSERT INTO public.shift_assignments(schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type,custom_start_time,custom_end_time) SELECT other_week,other_staff,other_facility,org,'2091-01-01','custom','20:00','22:00' FROM schedule_fixture;
DO $$ DECLARE org uuid:=gen_random_uuid();entity uuid:=gen_random_uuid();facility uuid:=gen_random_uuid();employee uuid:=gen_random_uuid();target uuid; BEGIN
 SELECT schedule_fixture.facility INTO target FROM schedule_fixture;
 INSERT INTO public.organizations(id,name) VALUES(org,'Foreign synthetic organization');
 INSERT INTO public.entities(id,organization_id,name) VALUES(entity,org,'Foreign synthetic entity');
 INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds) VALUES(facility,entity,org,'Foreign synthetic facility','Test','Test','00000',1);
 INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date) VALUES(employee,org,facility,'Foreign','Employee','resident_aide',current_date);
 IF haven.schedule_staff_role(employee,target,'2091-01-01','2091-01-01') IS NOT NULL THEN RAISE EXCEPTION 'Other-organization employee became eligible'; END IF;
 IF EXISTS(SELECT 1 FROM public.facility_schedule_presets p WHERE p.facility_id=facility) THEN RAISE EXCEPTION 'New facility received invented work hours'; END IF;
END $$;
SELECT pg_temp.schedule_actor('manager');SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; option jsonb; ver timestamptz; roster jsonb; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 SELECT to_jsonb(r) INTO roster FROM public.schedule_people_for_week(f.week) r WHERE r.id=f.other_staff;
 IF roster IS NULL OR roster ?| ARRAY['hourly_rate','overtime_rate','ssn_last_four','email','phone'] OR roster->'role_assignments'->0->>'role_at_facility'<>'cook' THEN RAISE EXCEPTION 'Narrow visiting roster/role projection wrong'; END IF;
 option:=public.schedule_preset_save(f.facility,NULL,0,'Cook block','#008800',0,'[{"start":"06:00","end":"13:00"}]',ARRAY['cook']::public.staff_role[],true,false,false);
 INSERT INTO visitor_options VALUES('cook',option);
 SELECT updated_at INTO ver FROM public.schedules WHERE id=f.week;
 PERFORM public.schedule_bulk_upsert(f.week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.other_staff,'shift_date','2091-01-01','preset_id',option->>'id','expected_preset_version',1)));
 IF NOT EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.other_staff AND schedule_role_snapshot='cook' AND schedule_rounding_coverage=false) THEN RAISE EXCEPTION 'Dated visiting role was not stamped'; END IF;
 SELECT updated_at INTO ver FROM public.schedules WHERE id=f.week;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.other_staff,'shift_date','2091-01-02','custom_start_time','06:00','custom_end_time','13:00'))),'Active employee');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.other_staff,'shift_date','2091-01-01','custom_start_time','22:00','custom_end_time','06:00'))),'entire work block');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.other_staff,'shift_date','2091-01-01','custom_start_time','20:30','custom_end_time','21:30'))),'overlapping shifts');
 PERFORM public.schedule_publish(f.week,ver);
 IF NOT EXISTS(SELECT 1 FROM public.schedule_assignment_intervals(f.facility,'2091-01-01T12:00Z','2091-01-01T13:00Z',f.other_staff)) THEN RAISE EXCEPTION 'Published visiting work invisible to authorized manager'; END IF;
END $$;RESET ROLE;
-- Conflicting typed membership roles must be visible refusal, not arbitrary precedence.
INSERT INTO public.staff_facility_assignments(organization_id,staff_id,facility_id,role_at_facility,start_date,end_date) SELECT org,other_staff,facility,'resident_aide','2091-01-01','2091-01-01' FROM schedule_fixture;
SELECT pg_temp.schedule_actor('manager');SET LOCAL ROLE authenticated;
SELECT pg_temp.schedule_expect_error(format('SELECT haven.schedule_staff_role(%L,%L,%L,%L)',other_staff,facility,'2091-01-01','2091-01-01'),'Conflicting facility role') FROM schedule_fixture;
RESET ROLE;
-- Visiting clinical worker: dated membership and explicit rounding coverage do
-- not replace the app capability, active user, or facility grant.
UPDATE public.staff SET facility_id=(SELECT other_facility FROM schedule_fixture) WHERE id=(SELECT staff FROM schedule_fixture);
INSERT INTO public.staff_facility_assignments(organization_id,staff_id,facility_id,role_at_facility,start_date,end_date) SELECT org,staff,facility,'resident_aide','2091-01-08','2091-01-08' FROM schedule_fixture;
SELECT pg_temp.schedule_actor('manager');SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; ver timestamptz; BEGIN
 SELECT * INTO f FROM schedule_fixture;SELECT updated_at INTO ver FROM public.schedules WHERE id=f.next_week;
 PERFORM public.schedule_bulk_upsert(f.next_week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-08','custom_blocks','[{"start":"06:00","end":"13:00"},{"start":"16:00","end":"18:00"}]'::jsonb,'custom_rounding_coverage',true)));
 SELECT updated_at INTO ver FROM public.schedules WHERE id=f.next_week;PERFORM public.schedule_publish(f.next_week,ver);
END $$;RESET ROLE;
DO $$ DECLARE f record; owner_row record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 SELECT * INTO owner_row FROM haven.resolve_observation_instant(f.facility,'2091-01-08T12:00Z',ARRAY[f.resident],'2091-01-08T12:00Z');
 IF owner_row.staff_id IS DISTINCT FROM f.staff THEN RAISE EXCEPTION 'Verified visiting clinical member lost eligible task'; END IF;
 UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id=(SELECT id FROM schedule_actors WHERE role='med_tech') AND facility_id=f.facility;
 SELECT * INTO owner_row FROM haven.resolve_observation_instant(f.facility,'2091-01-08T12:00Z',ARRAY[f.resident],'2091-01-08T12:00Z');
 IF owner_row.staff_id IS NOT NULL THEN RAISE EXCEPTION 'Work option granted clinical access after grant revoked'; END IF;
END $$;
-- An explicit non-rounding work option cannot re-enter through clock fallback.
UPDATE public.user_facility_access SET revoked_at=NULL WHERE user_id=(SELECT id FROM schedule_actors WHERE role='med_tech');
INSERT INTO public.staff_facility_assignments(organization_id,staff_id,facility_id,role_at_facility,start_date,end_date) SELECT org,staff,facility,'resident_aide','2091-01-15','2091-01-15' FROM schedule_fixture;
INSERT INTO public.timeclock_facility_settings(organization_id,facility_id,timeclock_enabled) SELECT org,facility,true FROM schedule_fixture ON CONFLICT(organization_id,facility_id) DO UPDATE SET timeclock_enabled=true;
SELECT pg_temp.schedule_actor('manager');SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; ver timestamptz; BEGIN
 SELECT * INTO f FROM schedule_fixture;SELECT updated_at INTO ver FROM public.schedules WHERE id=f.empty_week;
 PERFORM public.schedule_bulk_upsert(f.empty_week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-15','custom_blocks','[{"start":"06:00","end":"18:00"}]'::jsonb)));
 SELECT updated_at INTO ver FROM public.schedules WHERE id=f.empty_week;PERFORM public.schedule_publish(f.empty_week,ver);
END $$;RESET ROLE;
INSERT INTO public.time_punches(organization_id,facility_id,staff_id,punch_type,punched_at,client_punch_id) SELECT org,facility,staff,'in','2091-01-15T11:00Z',gen_random_uuid() FROM schedule_fixture;
DO $$ DECLARE f record; owner_row record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 SELECT * INTO owner_row FROM haven.resolve_observation_instant(f.facility,'2091-01-15T12:00Z',ARRAY[f.resident],'2091-01-15T12:00Z');
 IF owner_row.staff_id IS NOT NULL THEN RAISE EXCEPTION 'Non-rounding work re-entered through on-clock fallback'; END IF;
END $$;
ROLLBACK;
