-- Disposable replay only. All fixtures and auth overrides roll back.
-- COL-795: one grid cell carries the cook split as two custom blocks.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE split_fixture AS
SELECT f.id facility,f.organization_id org,gen_random_uuid() cook,gen_random_uuid() aide,gen_random_uuid() week,gen_random_uuid() next_week,gen_random_uuid() definition,gen_random_uuid() unit
FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM split_fixture) THEN RAISE EXCEPTION 'Replay facility required'; END IF; END $$;
CREATE TEMP TABLE split_actor AS SELECT gen_random_uuid() id,gen_random_uuid() session_id;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT a.id,a.id||'@split-review.invalid',jsonb_build_object('organization_id',f.org,'app_role','manager'),'{}'::jsonb FROM split_actor a CROSS JOIN split_fixture f;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
SELECT a.id,a.id||'@split-review.invalid','Split review','manager',f.org,true FROM split_actor a CROSS JOIN split_fixture f
ON CONFLICT (id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session_id,id FROM split_actor;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT a.id,f.facility,f.org FROM split_actor a CROSS JOIN split_fixture f;
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date)
SELECT cook,org,facility,'Demo','Cook','cook'::public.staff_role,current_date FROM split_fixture
UNION ALL SELECT aide,org,facility,'Demo','Aide','resident_aide'::public.staff_role,current_date FROM split_fixture;
INSERT INTO public.schedules(id,facility_id,organization_id,week_start_date)
SELECT week,facility,org,'2092-01-01'::date FROM split_fixture UNION ALL SELECT next_week,facility,org,'2092-01-08'::date FROM split_fixture;
INSERT INTO public.facility_shift_definitions(id,organization_id,facility_id,shift_key,roster_shift_type,label,starts_at_local,ends_at_local)
SELECT definition,org,facility,'split_review_day','day','Split review day','06:00','18:00' FROM split_fixture;
INSERT INTO public.units(id,facility_id,organization_id,name) SELECT unit,facility,org,'Split review kitchen' FROM split_fixture;
CREATE FUNCTION pg_temp.split_expect_error(p_sql text,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
   IF position(p_message in SQLERRM)=0 THEN RAISE EXCEPTION 'Expected %, received %',p_message,SQLERRM; END IF;
   RETURN;
 END;
 RAISE EXCEPTION 'Expected failure: %',p_sql;
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session_id,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated','app_role','manager','organization_id',p.organization_id,'app_metadata',jsonb_build_object('app_role','manager','organization_id',p.organization_id))::text,true)
FROM split_actor a JOIN public.user_profiles p ON p.id=a.id;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON split_fixture TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.schedules,public.shift_assignments TO authenticated;
GRANT SELECT ON public.facility_shift_definitions,public.staff,public.staff_certifications,public.facilities,public.family_resident_links,public.residents TO authenticated;
SET LOCAL ROLE authenticated;

DO $$ DECLARE f record; split jsonb; first_id uuid; second_id uuid; v timestamptz; BEGIN
 SELECT * INTO f FROM split_fixture;
 split:=jsonb_build_object('staff_id',f.cook,'shift_date','2092-01-01','shift_definition_id',NULL,
   'custom_blocks',jsonb_build_array(jsonb_build_object('start_time','16:00','end_time','18:00'),jsonb_build_object('start_time','06:00','end_time','13:00')));
 -- Invalid splits fail before anything changes.
 SELECT updated_at INTO v FROM public.schedules WHERE id=f.week;
 PERFORM pg_temp.split_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,v,jsonb_build_array(split||jsonb_build_object('custom_blocks',jsonb_build_array(jsonb_build_object('start_time','06:00','end_time','13:00'))))),'exactly two time blocks');
 PERFORM pg_temp.split_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,v,jsonb_build_array(split||jsonb_build_object('custom_blocks','{"start_time":"06:00"}'::jsonb))),'exactly two time blocks');
 PERFORM pg_temp.split_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,v,jsonb_build_array(split||jsonb_build_object('custom_blocks',jsonb_build_array(jsonb_build_object('start_time','06:00','end_time','13:00'),jsonb_build_object('start_time','4pm','end_time','18:00'))))),'valid start and finish');
 PERFORM pg_temp.split_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,v,jsonb_build_array(split||jsonb_build_object('custom_blocks',jsonb_build_array(jsonb_build_object('start_time','06:00','end_time','13:00'),jsonb_build_object('start_time','22:00','end_time','02:00'))))),'same day');
 PERFORM pg_temp.split_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,v,jsonb_build_array(split||jsonb_build_object('shift_definition_id',f.definition))),'not more than one');
 PERFORM pg_temp.split_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,v,jsonb_build_array(split||jsonb_build_object('custom_start_time','06:00','custom_end_time','13:00'))),'not more than one');
 PERFORM pg_temp.split_expect_error(format('SELECT public.schedule_bulk_upsert(%L,%L,%L)',f.week,v,jsonb_build_array(split||jsonb_build_object('custom_blocks',jsonb_build_array(jsonb_build_object('start_time','06:00','end_time','13:00'),jsonb_build_object('start_time','12:00','end_time','18:00'))))),'overlapping shifts');
 IF EXISTS (SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.week AND deleted_at IS NULL) OR (SELECT updated_at FROM public.schedules WHERE id=f.week) IS DISTINCT FROM v THEN RAISE EXCEPTION 'Invalid split left a change'; END IF;

 -- One cell saves both blocks as plain custom assignments.
 PERFORM public.schedule_bulk_upsert(f.week,v,jsonb_build_array(split));
 IF (SELECT array_agg(custom_start_time::text||'-'||custom_end_time::text ORDER BY custom_start_time) FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.cook AND deleted_at IS NULL AND shift_type='custom' AND shift_definition_id IS NULL)
   IS DISTINCT FROM ARRAY['06:00:00-13:00:00','16:00:00-18:00:00'] THEN RAISE EXCEPTION 'Cook split was not saved as two blocks'; END IF;
 SELECT id INTO first_id FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.cook AND deleted_at IS NULL AND custom_start_time='06:00';
 SELECT id INTO second_id FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.cook AND deleted_at IS NULL AND custom_start_time='16:00';
 UPDATE public.shift_assignments SET unit_id=f.unit,notes='Breakfast and lunch' WHERE id=first_id;
 UPDATE public.shift_assignments SET notes='Supper' WHERE id=second_id;

 -- Saving the split again keeps both rows' identity and details.
 PERFORM public.schedule_bulk_upsert(f.week,(SELECT updated_at FROM public.schedules WHERE id=f.week),jsonb_build_array(split));
 IF NOT EXISTS (SELECT 1 FROM public.shift_assignments WHERE id=first_id AND deleted_at IS NULL AND custom_start_time='06:00' AND unit_id=f.unit AND notes='Breakfast and lunch')
   OR NOT EXISTS (SELECT 1 FROM public.shift_assignments WHERE id=second_id AND deleted_at IS NULL AND custom_start_time='16:00' AND notes='Supper') THEN RAISE EXCEPTION 'Re-saving the split lost identity'; END IF;

 -- A split copies to the next week as a split, each block with its own details.
 PERFORM public.schedule_copy_week(f.next_week,(SELECT updated_at FROM public.schedules WHERE id=f.next_week));
 IF NOT EXISTS (SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.next_week AND staff_id=f.cook AND shift_date='2092-01-08' AND custom_start_time='06:00' AND custom_end_time='13:00' AND unit_id=f.unit AND notes='Breakfast and lunch' AND deleted_at IS NULL)
   OR NOT EXISTS (SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.next_week AND staff_id=f.cook AND shift_date='2092-01-08' AND custom_start_time='16:00' AND custom_end_time='18:00' AND notes='Supper' AND deleted_at IS NULL)
   OR (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.next_week AND deleted_at IS NULL)<>2 THEN RAISE EXCEPTION 'Copy did not carry the split'; END IF;

 -- Split to a facility shift keeps the first row and soft deletes the second.
 PERFORM public.schedule_bulk_upsert(f.week,(SELECT updated_at FROM public.schedules WHERE id=f.week),jsonb_build_array(jsonb_build_object('staff_id',f.cook,'shift_date','2092-01-01','shift_definition_id',f.definition)));
 IF NOT EXISTS (SELECT 1 FROM public.shift_assignments WHERE id=first_id AND deleted_at IS NULL AND shift_type='day' AND shift_definition_id=f.definition AND custom_start_time='06:00' AND custom_end_time='18:00' AND notes='Breakfast and lunch')
   OR NOT EXISTS (SELECT 1 FROM public.shift_assignments WHERE id=second_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Split to day shift did not reuse the first block'; END IF;

 -- A single shift back to the split reuses it and adds the second block.
 PERFORM public.schedule_bulk_upsert(f.week,(SELECT updated_at FROM public.schedules WHERE id=f.week),jsonb_build_array(split));
 IF NOT EXISTS (SELECT 1 FROM public.shift_assignments WHERE id=first_id AND deleted_at IS NULL AND shift_type='custom' AND shift_definition_id IS NULL AND custom_start_time='06:00' AND custom_end_time='13:00')
   OR (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.cook AND deleted_at IS NULL)<>2 THEN RAISE EXCEPTION 'Day shift back to split failed'; END IF;

 -- Off clears both blocks.
 PERFORM public.schedule_bulk_upsert(f.week,(SELECT updated_at FROM public.schedules WHERE id=f.week),jsonb_build_array(jsonb_build_object('staff_id',f.cook,'shift_date','2092-01-01','shift_definition_id',NULL)));
 IF EXISTS (SELECT 1 FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.cook AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Off left a split block'; END IF;

 -- Cells with several non-split assignments stay blocked.
 PERFORM public.edit_draft_schedule(f.week,'add',gen_random_uuid(),f.aide,'2092-01-02','06:00','10:00');
 PERFORM public.edit_draft_schedule(f.week,'add',gen_random_uuid(),f.aide,'2092-01-02','11:00','12:00');
 PERFORM public.edit_draft_schedule(f.week,'add',gen_random_uuid(),f.aide,'2092-01-02','13:00','14:00');
 PERFORM pg_temp.split_expect_error(format('SELECT public.schedule_bulk_upsert(%L,(SELECT updated_at FROM public.schedules WHERE id=%L),%L)',f.week,f.week,jsonb_build_array(jsonb_build_object('staff_id',f.aide,'shift_date','2092-01-02','shift_definition_id',NULL))),'Multiple assignments in this cell');
END $$;
RESET ROLE;
ROLLBACK;
