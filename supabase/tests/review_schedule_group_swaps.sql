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

CREATE TEMP TABLE group_people(side text PRIMARY KEY,id uuid,session_id uuid);
INSERT INTO group_people SELECT role,id,session_id FROM schedule_actors WHERE role IN('med_tech','manager');
INSERT INTO group_people VALUES('cover',gen_random_uuid(),gen_random_uuid());
INSERT INTO auth.users(id,email) SELECT id,id||'@group-review.invalid' FROM group_people WHERE side='cover';
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT id,id||'@group-review.invalid','Cover employee','med_tech',f.org,true FROM group_people CROSS JOIN schedule_fixture f WHERE side='cover';
INSERT INTO auth.sessions(id,user_id) SELECT session_id,id FROM group_people WHERE side='cover';
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,f.facility,f.org FROM group_people CROSS JOIN schedule_fixture f WHERE side='cover';
UPDATE public.staff SET user_id=(SELECT id FROM group_people WHERE side='cover') WHERE id=(SELECT colleague FROM schedule_fixture);
INSERT INTO public.staff_certifications(staff_id,organization_id,facility_id,certification_type,certification_name,issue_date,expiration_date) SELECT id,f.org,f.facility,'review','Synthetic group credential','2090-01-01','2092-01-01' FROM schedule_fixture f CROSS JOIN LATERAL unnest(ARRAY[f.staff,f.colleague]) id;
CREATE FUNCTION pg_temp.group_actor(p_side text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'session_id',g.session_id,'role','authenticated','app_role',p.app_role,'organization_id',p.organization_id,'auth_claim_version',p.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true) FROM group_people g JOIN public.user_profiles p ON p.id=g.id WHERE g.side=p_side;
END $$;
CREATE TEMP TABLE group_values(k text PRIMARY KEY,v jsonb);
GRANT ALL ON group_values TO authenticated;GRANT SELECT ON group_people TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.shift_swap_requests TO authenticated;
SELECT pg_temp.group_actor('manager');SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; ver timestamptz; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 SELECT updated_at INTO ver FROM public.schedules WHERE id=f.week;
 PERFORM public.schedule_bulk_upsert(f.week,ver,jsonb_build_array(jsonb_build_object('staff_id',f.staff,'shift_date','2091-01-01','custom_blocks','[{"start":"06:00","end":"13:00"},{"start":"16:00","end":"18:00"}]'::jsonb,'custom_rounding_coverage',true),jsonb_build_object('staff_id',f.colleague,'shift_date','2091-01-03','custom_blocks','[{"start":"06:00","end":"13:00"},{"start":"16:00","end":"18:00"}]'::jsonb,'custom_rounding_coverage',true)));
 SELECT updated_at INTO ver FROM public.schedules WHERE id=f.week;PERFORM public.schedule_publish(f.week,ver);
 INSERT INTO group_values SELECT 'request_anchor',to_jsonb(id) FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.staff AND schedule_block_index=0;
 INSERT INTO group_values SELECT 'cover_anchor',to_jsonb(id) FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.colleague AND schedule_block_index=0;
END $$;RESET ROLE;
SELECT pg_temp.group_actor('med_tech');SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; candidates jsonb; request public.shift_swap_requests; BEGIN
 SELECT * INTO f FROM schedule_fixture;
 SELECT to_jsonb(c) INTO candidates FROM public.schedule_swap_candidates((SELECT (v#>>'{}')::uuid FROM group_values WHERE k='request_anchor')) c WHERE c.staff_id=f.colleague;
 IF candidates IS NULL OR jsonb_array_length(candidates->'blocks')<>2 OR candidates ?| ARRAY['hourly_rate','phone','email','assigned_resident_ids'] THEN RAISE EXCEPTION 'Candidate projection incomplete or disclosed private fields'; END IF;
 PERFORM pg_temp.schedule_expect_error(format('INSERT INTO public.shift_swap_requests(requesting_staff_id,covering_staff_id,requesting_assignment_id,covering_assignment_id,facility_id,organization_id,swap_type) VALUES(%L,%L,%L,%L,%L,%L,%L)',f.staff,f.colleague,(SELECT v#>>'{}' FROM group_values WHERE k='request_anchor'),(SELECT v#>>'{}' FROM group_values WHERE k='cover_anchor'),f.facility,f.org,'swap'),'whole split group');
 INSERT INTO public.shift_swap_requests(requesting_staff_id,covering_staff_id,requesting_assignment_id,covering_assignment_id,facility_id,organization_id,swap_type,swap_scope,requesting_group_snapshot)
 VALUES(f.staff,f.colleague,(SELECT (v#>>'{}')::uuid FROM group_values WHERE k='request_anchor'),(SELECT (v#>>'{}')::uuid FROM group_values WHERE k='cover_anchor'),f.facility,f.org,'swap','group','[{"forged":true}]') RETURNING * INTO request;
 IF jsonb_array_length(request.requesting_group_snapshot)<>2 OR request.requesting_group_snapshot @> '[{"forged":true}]'::jsonb OR request.requesting_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Group context was not server derived without implied consent'; END IF;
 INSERT INTO group_values VALUES('request',to_jsonb(request));
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.confirm_shift_swap(%L)',request.id),'Review and confirm all work blocks');
 PERFORM pg_temp.schedule_expect_error(format('SELECT public.confirm_shift_swap_group(%L,%L)',request.id,'wrong'),'Group request changed');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_swap_requests SET requesting_confirmed_at=now() WHERE id=%L',request.id),'Review and confirm all requesting work blocks');
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_swap_requests SET swap_scope=%L WHERE id=%L','assignment',request.id),'Swap scope is immutable');
 PERFORM public.confirm_shift_swap_group(request.id,request.group_context_hash);
END $$;RESET ROLE;
SELECT pg_temp.group_actor('manager');SET LOCAL ROLE authenticated;
SELECT pg_temp.schedule_expect_error(format('UPDATE public.shift_swap_requests SET status=%L,eligibility_reviewed_by=auth.uid(),eligibility_reviewed_at=now() WHERE id=%L','approved',(SELECT v->>'id' FROM group_values WHERE k='request')),'Both employees must confirm');
RESET ROLE;
SELECT pg_temp.group_actor('cover');SET LOCAL ROLE authenticated;
SET LOCAL TIME ZONE 'Pacific/Honolulu';
SELECT public.confirm_shift_swap_group((v->>'id')::uuid,v->>'group_context_hash') FROM group_values WHERE k='request';
SET LOCAL TIME ZONE 'UTC';
RESET ROLE;
SELECT pg_temp.group_actor('manager');SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; request_id uuid; BEGIN
 SELECT * INTO f FROM schedule_fixture;SELECT (v->>'id')::uuid INTO request_id FROM group_values WHERE k='request';
 PERFORM pg_temp.schedule_expect_error(format('UPDATE public.shift_swap_requests SET status=%L,eligibility_reviewed_by=auth.uid(),eligibility_reviewed_at=now() WHERE id=%L','approved',request_id),'Manager must review the exact whole group context');
 UPDATE public.shift_swap_requests SET status='approved',reviewed_context_hash=(SELECT v->>'group_context_hash' FROM group_values WHERE k='request'),eligibility_reviewed_by=auth.uid(),eligibility_reviewed_at=now() WHERE id=request_id;
 IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.colleague AND shift_date='2091-01-01')<>2 OR (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.staff AND shift_date='2091-01-03')<>2 THEN RAISE EXCEPTION 'Whole group approval did not move all four blocks'; END IF;
 IF NOT haven.schedule_cell_intact(f.week,f.colleague,'2091-01-01') OR NOT haven.schedule_cell_intact(f.week,f.staff,'2091-01-03') THEN RAISE EXCEPTION 'Whole group swap broke managed cell integrity'; END IF;
 PERFORM public.schedule_copy_week(f.next_week,(SELECT updated_at FROM public.schedules WHERE id=f.next_week));
 IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=f.next_week AND deleted_at IS NULL)<>4 THEN RAISE EXCEPTION 'Post-swap whole groups could not copy'; END IF;
END $$;RESET ROLE;
-- Stale proposals can be closed instead of trapping clients in a reload loop.
SELECT pg_temp.group_actor('med_tech');SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; request public.shift_swap_requests; anchor uuid; BEGIN
 SELECT * INTO f FROM schedule_fixture;SELECT id INTO anchor FROM public.shift_assignments WHERE schedule_id=f.week AND staff_id=f.staff AND schedule_block_index=0;
 INSERT INTO public.shift_swap_requests(requesting_staff_id,covering_staff_id,requesting_assignment_id,facility_id,organization_id,swap_type,swap_scope) VALUES(f.staff,f.colleague,anchor,f.facility,f.org,'cover','group') RETURNING * INTO request;
 INSERT INTO group_values VALUES('stale',to_jsonb(request));
END $$;RESET ROLE;
DO $$ DECLARE request public.shift_swap_requests; expected text; req_user uuid; cov_user uuid; BEGIN
 SELECT * INTO request FROM public.shift_swap_requests WHERE id=(SELECT (v->>'id')::uuid FROM group_values WHERE k='stale');
 SELECT user_id INTO req_user FROM public.staff WHERE id=request.requesting_staff_id;SELECT user_id INTO cov_user FROM public.staff WHERE id=request.covering_staff_id;
 expected:=haven.timeclock_sha256(jsonb_build_object('requestId',request.id,'organizationId',request.organization_id,'facilityId',request.facility_id,'swapScope',request.swap_scope,'swapType',request.swap_type,'requestingStaffId',request.requesting_staff_id,'requestingUserId',req_user,'coveringStaffId',request.covering_staff_id,'coveringUserId',cov_user,'requested',request.requesting_group_snapshot,'offered',request.covering_group_snapshot)::text);
 IF request.covering_group_snapshot<>'[]'::jsonb OR request.group_context_hash IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Cover-only consent hash must bind both identities, facility, scope and type'; END IF;
END $$;
UPDATE public.staff SET first_name='Changed context name' WHERE id=(SELECT staff FROM schedule_fixture);
SELECT pg_temp.group_actor('med_tech');SET LOCAL ROLE authenticated;
SELECT pg_temp.schedule_expect_error(format('SELECT public.confirm_shift_swap_group(%L,%L)',v->>'id',v->>'group_context_hash'),'context changed') FROM group_values WHERE k='stale';
UPDATE public.shift_swap_requests SET status='cancelled' WHERE id=(SELECT (v->>'id')::uuid FROM group_values WHERE k='stale');
SELECT pg_temp.schedule_expect_error(format('UPDATE public.shift_swap_requests SET status=%L WHERE id=%L','pending',(SELECT v->>'id' FROM group_values WHERE k='stale')),'Closed group request cannot reopen');
RESET ROLE;ROLLBACK;
