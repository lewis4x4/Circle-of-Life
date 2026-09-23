-- Disposable replay only. All fixtures and auth overrides roll back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE schedule_fixture AS
SELECT f.id facility,f.organization_id org,
 (SELECT id FROM public.facilities WHERE organization_id=f.organization_id AND id<>f.id AND deleted_at IS NULL LIMIT 1) other_facility,
 gen_random_uuid() staff,gen_random_uuid() colleague,gen_random_uuid() week,gen_random_uuid() next_week,gen_random_uuid() empty_week,
 gen_random_uuid() definition,gen_random_uuid() overlap_definition,gen_random_uuid() swap,gen_random_uuid() other_staff,gen_random_uuid() other_week
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
GRANT SELECT ON public.facility_shift_definitions,public.staff,public.staff_certifications,public.facilities,public.family_resident_links,public.residents TO authenticated;

SELECT pg_temp.schedule_actor('manager');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; version timestamptz; cells jsonb; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id=f.staff) THEN RAISE EXCEPTION 'Manager cannot read schedule staff'; END IF;
 SELECT updated_at INTO version FROM public.schedules WHERE id=f.week;
 cells:=jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-01','shift_definition_id',f.definition),jsonb_build_object('staff_id',f.colleague,'shift_date','2091-01-02','shift_definition_id',f.definition));
 PERFORM public.schedule_bulk_upsert(f.week,version,cells);
 IF (SELECT updated_at FROM public.schedules WHERE id=f.week)<=version THEN RAISE EXCEPTION 'Schedule version did not advance'; END IF;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,cells),'Schedule changed');
 IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.week AND deleted_at IS NULL)<>2 THEN RAISE EXCEPTION 'Bulk save lost a cell'; END IF;
 IF EXISTS (SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.week AND (shift_type<>'night' OR custom_start_time<>'18:00' OR custom_end_time<>'06:00' OR shift_definition_id IS DISTINCT FROM f.definition)) THEN RAISE EXCEPTION 'Definition and time snapshot did not persist'; END IF;
 SELECT updated_at INTO version FROM public.schedules WHERE id=f.week;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version-interval '1 second',cells),'Schedule changed');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2090-12-31','shift_definition_id',f.definition))),'inside this schedule week');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,cells||cells),'Duplicate employee/date');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,version,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-02','shift_definition_id',f.overlap_definition))),'overlapping shifts');
 IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.week AND deleted_at IS NULL)<>2 THEN RAISE EXCEPTION 'Rejected overlap left a partial assignment'; END IF;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_copy_week(%L,%L)',f.week,version),'requires an empty draft');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_publish(%L,(SELECT updated_at FROM public.schedules WHERE id=%L))',f.empty_week,f.empty_week),'at least one shift');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.schedules SET status=''published'',published_by=auth.uid(),published_at=now() WHERE id=%L',f.empty_week),'at least one shift');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.edit_draft_schedule(%L,''add'',gen_random_uuid(),%L,''2091-01-02'',''05:00'',''17:00'')',f.week,f.staff),'overlapping shifts');
 PERFORM pg_temp.schedule_expect_error(format('INSERT INTO public.shift_assignments(schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type,custom_start_time,custom_end_time) VALUES(%L,%L,%L,%L,''2091-01-02'',''day'',''05:00'',''17:00'')',f.week,f.staff,f.facility,f.org),'overlapping shifts');
 PERFORM pg_temp.schedule_expect_error(format('INSERT INTO public.shift_assignments(schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type) VALUES(%L,%L,%L,%L,''2091-01-01'',''day'')',f.other_week,f.other_staff,f.facility,f.org),'Assignment schedule unavailable');
 PERFORM pg_temp.schedule_expect_error(format('INSERT INTO public.shift_assignments(schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type) VALUES(%L,%L,%L,%L,''2091-01-01'',''day'')',f.week,f.other_staff,f.facility,f.org),'employee must belong');
 PERFORM pg_temp.schedule_expect_error(format('INSERT INTO public.shift_assignments(schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type) VALUES(%L,%L,%L,%L,''2090-12-31'',''day'')',f.week,f.staff,f.facility,f.org),'inside this schedule week');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_assignments SET staff_id=%L WHERE schedule_id=%L',f.other_staff,f.week),'employee must belong');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.schedules SET facility_id=%L WHERE id=%L',f.other_facility,f.week),'identity, facility and week are immutable');
 INSERT INTO public.shift_assignments(schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type) VALUES(f.empty_week,f.staff,f.facility,f.org,'2091-01-15','day');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.schedules SET status=''published'' WHERE id=%L',f.empty_week),'recorded times');
 DELETE FROM public.shift_assignments WHERE schedule_id=f.empty_week;

END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.schedule_suppress_parent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
CREATE TRIGGER aa_schedule_review_parent BEFORE UPDATE ON public.schedules FOR EACH ROW EXECUTE FUNCTION pg_temp.schedule_suppress_parent();
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.edit_draft_schedule(%L,''add'',gen_random_uuid(),%L,''2091-01-03'',''08:00'',''12:00'')',f.week,f.staff),'Schedule update was not applied');
END $$;
RESET ROLE;
DROP TRIGGER aa_schedule_review_parent ON public.schedules;
SELECT pg_temp.schedule_actor('med_tech');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 IF EXISTS (SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.week) OR EXISTS (SELECT 1 FROM public.schedules WHERE id=f.week) THEN RAISE EXCEPTION 'Draft leaked to staff'; END IF;
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_publish(%L,now())',f.week),'Schedule manager access');
 PERFORM pg_temp.schedule_expect_error(format('INSERT INTO public.schedules(facility_id,organization_id,week_start_date) VALUES(%L,%L,''2092-01-01'')',f.facility,f.org),'row-level security');
END $$;
RESET ROLE;
SELECT pg_temp.schedule_actor('manager');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 PERFORM public.schedule_copy_week(f.next_week,(SELECT updated_at FROM public.schedules WHERE id=f.next_week));
 IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.next_week AND deleted_at IS NULL AND shift_date IN ('2091-01-08','2091-01-09'))<>2 THEN RAISE EXCEPTION 'Copy did not shift dates by seven days'; END IF;
 PERFORM public.schedule_publish(f.week,(SELECT updated_at FROM public.schedules WHERE id=f.week));
 IF NOT EXISTS (SELECT 1 FROM public.schedules WHERE id=f.week AND status='published' AND published_by=auth.uid() AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'Publish stamp absent'; END IF;
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_assignments SET custom_end_time=''07:00'' WHERE schedule_id=%L',f.week),'assignment plans are immutable');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_assignments SET staff_id=%L WHERE schedule_id=%L AND staff_id=%L',f.colleague,f.week,f.staff),'assignment plans are immutable');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_assignments SET deleted_at=now() WHERE schedule_id=%L',f.week),'assignment plans are immutable');
 PERFORM pg_temp.schedule_expect_error(format('DELETE FROM public.shift_assignments WHERE schedule_id=%L',f.week),'assignments cannot be deleted');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.schedules SET status=''draft'' WHERE id=%L',f.week),'cannot return to draft');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.schedules SET published_by=gen_random_uuid() WHERE id=%L',f.week),'Publication evidence is immutable');

 PERFORM pg_temp.schedule_expect_error(format('SELECT public.schedule_bulk_upsert(%L,(SELECT updated_at FROM public.schedules WHERE id=%L),''[]''::jsonb)',f.week,f.week),'Editable draft schedule unavailable');
 PERFORM pg_temp.schedule_expect_error(format('INSERT INTO public.schedules(facility_id,organization_id,week_start_date) VALUES(%L,%L,''2092-01-01'')',f.other_facility,f.org),'Schedule facility and organization must match');
END $$;
RESET ROLE;
SELECT pg_temp.schedule_actor('med_tech');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.week)<>1 THEN RAISE EXCEPTION 'Staff must see only their own published shift'; END IF;
 IF EXISTS (SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.next_week) THEN RAISE EXCEPTION 'Copied draft leaked'; END IF;
 UPDATE public.shift_assignments SET status='confirmed' WHERE schedule_id=f.week;
 IF FOUND THEN RAISE EXCEPTION 'Staff acquired schedule mutation authority'; END IF;
END $$;
RESET ROLE;

-- A completed approval must actually move both assignments. A zero-row UPDATE is failure.
SELECT pg_temp.schedule_actor('facility_admin');
UPDATE public.staff SET user_id=(SELECT id FROM schedule_actors WHERE role='facility_admin') WHERE id=(SELECT colleague FROM schedule_fixture);
INSERT INTO public.staff_certifications(staff_id,organization_id,facility_id,certification_type,certification_name,issue_date,expiration_date)
SELECT colleague,org,facility,'review','Replay-only certificate','2090-01-01','2092-01-01' FROM schedule_fixture;
INSERT INTO public.shift_swap_requests(id,requesting_staff_id,covering_staff_id,requesting_assignment_id,covering_assignment_id,facility_id,organization_id,swap_type)
SELECT f.swap,f.staff,f.colleague,
 (SELECT id FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.staff AND deleted_at IS NULL),
 (SELECT id FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.colleague AND deleted_at IS NULL),
 f.facility,f.org,'swap' FROM schedule_fixture f;
GRANT SELECT,UPDATE ON public.shift_swap_requests TO authenticated;
SELECT pg_temp.schedule_actor('med_tech');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_swap_requests SET status=''approved'' WHERE id=%L',f.swap),'Scheduling manager approval required');
 PERFORM public.confirm_shift_swap(f.swap);
END $$;
RESET ROLE;
SELECT pg_temp.schedule_actor('facility_admin');
SET LOCAL ROLE authenticated;
SELECT public.confirm_shift_swap(swap) FROM schedule_fixture;
RESET ROLE;
CREATE FUNCTION pg_temp.schedule_suppress_assignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
CREATE TRIGGER aa_schedule_review_suppress BEFORE UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION pg_temp.schedule_suppress_assignment();
SELECT pg_temp.schedule_actor('manager');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_swap_requests SET status=''approved'',eligibility_reviewed_by=auth.uid(),eligibility_reviewed_at=now() WHERE id=%L',f.swap),'Requesting assignment update was not applied');
 IF EXISTS (SELECT 1 FROM public.shift_swap_requests WHERE id=f.swap AND (status='approved' OR approved_at IS NOT NULL OR approved_by IS NOT NULL)) THEN RAISE EXCEPTION 'Swap falsely stamped approved'; END IF;
END $$;
RESET ROLE;
DROP TRIGGER aa_schedule_review_suppress ON public.shift_assignments;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; swap_row record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 UPDATE public.shift_swap_requests SET status='approved',eligibility_reviewed_by=auth.uid(),eligibility_reviewed_at=now() WHERE id=f.swap;
 IF NOT FOUND THEN RAISE EXCEPTION 'Manager could not approve reviewed swap'; END IF;
 SELECT * INTO swap_row FROM public.shift_swap_requests WHERE id=f.swap;
 IF swap_row.status<>'approved' OR (SELECT staff_id FROM public.shift_assignments WHERE id=swap_row.requesting_assignment_id)<>f.colleague
 OR (SELECT staff_id FROM public.shift_assignments WHERE id=swap_row.covering_assignment_id)<>f.staff THEN RAISE EXCEPTION 'Approved swap did not exchange assignments'; END IF;
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_swap_requests SET status=''denied'' WHERE id=%L',f.swap),'Approved coverage is immutable');
END $$;

DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 UPDATE public.schedules SET status='published',published_by=(SELECT id FROM schedule_actors WHERE role='med_tech'),published_at='2001-01-01' WHERE id=f.next_week;
 IF NOT EXISTS (SELECT 1 FROM public.schedules WHERE id=f.next_week AND published_by=auth.uid() AND published_at>'2020-01-01') THEN RAISE EXCEPTION 'Direct publish did not stamp authenticated evidence'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
