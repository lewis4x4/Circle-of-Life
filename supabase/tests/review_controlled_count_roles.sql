BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT ON public.controlled_substance_counts TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE count_role_fixture AS SELECT f.id facility,f.organization_id org,gen_random_uuid() med,m.id source_med
 FROM public.facilities f JOIN public.resident_medications m ON m.facility_id=f.id AND m.organization_id=f.organization_id
 WHERE f.deleted_at IS NULL AND m.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM count_role_fixture) THEN RAISE EXCEPTION 'Local seed medication required'; END IF; END $$;
INSERT INTO public.resident_medications(id,resident_id,facility_id,organization_id,medication_name,route,frequency,start_date,order_date,status,controlled_schedule)
 SELECT f.med,m.resident_id,f.facility,f.org,'Role test controlled medication',m.route,m.frequency,current_date,current_date,'active','ii' FROM count_role_fixture f JOIN public.resident_medications m ON m.id=f.source_med;
CREATE TEMP TABLE count_test_actors AS SELECT gen_random_uuid() id,role FROM unnest(ARRAY['med_tech','nurse','caregiver','owner','manager','family']) role;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT a.id,a.id||'@count-review.invalid',jsonb_build_object('organization_id',f.org,'app_role',a.role),jsonb_build_object('full_name','Count role test') FROM count_test_actors a CROSS JOIN count_role_fixture f;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active) SELECT a.id,f.org,a.id||'@count-review.invalid','Count role test',a.role::public.app_role,true FROM count_test_actors a CROSS JOIN count_role_fixture f
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT a.id,f.facility,f.org FROM count_test_actors a CROSS JOIN count_role_fixture f;
GRANT SELECT ON count_test_actors,count_role_fixture TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE a record; f record; BEGIN
 SELECT * INTO f FROM count_role_fixture;
 FOR a IN SELECT * FROM count_test_actors LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'role','authenticated','app_role',a.role,'organization_id',f.org,'app_metadata',jsonb_build_object('app_role',a.role,'organization_id',f.org))::text,true);
  IF a.role IN('med_tech','nurse','caregiver') THEN
   INSERT INTO public.controlled_substance_counts(resident_medication_id,facility_id,organization_id,count_date,shift,expected_count,actual_count,outgoing_staff_id)
    VALUES(f.med,f.facility,f.org,current_date,'day',2,2,a.id);
   IF NOT EXISTS(SELECT 1 FROM public.controlled_substance_counts WHERE outgoing_staff_id=a.id) THEN RAISE EXCEPTION 'Permitted actor cannot recover pending count'; END IF;
  ELSE
   BEGIN
    INSERT INTO public.controlled_substance_counts(resident_medication_id,facility_id,organization_id,count_date,shift,expected_count,actual_count,outgoing_staff_id)
     VALUES(f.med,f.facility,f.org,current_date,'day',2,2,a.id);
    RAISE EXCEPTION 'Ineligible role originated count: %',a.role;
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END IF;
 END LOOP;
END $$;
RESET ROLE;
DO $$ DECLARE f record; tech uuid; nurse uuid; caregiver uuid; manager uuid; count_id uuid; BEGIN
 SELECT * INTO f FROM count_role_fixture;
 SELECT id INTO tech FROM count_test_actors WHERE role='med_tech';
 SELECT id INTO nurse FROM count_test_actors WHERE role='nurse';
 SELECT id INTO caregiver FROM count_test_actors WHERE role='caregiver';
 SELECT id INTO manager FROM count_test_actors WHERE role='manager';
 SELECT id INTO count_id FROM public.controlled_substance_counts WHERE outgoing_staff_id=nurse;
 BEGIN
  PERFORM public.complete_verified_controlled_counts(ARRAY[count_id],nurse,tech,f.facility,f.org);
  RAISE EXCEPTION 'Med-tech incoming witness was improperly authorized';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invalid witness' THEN RAISE; END IF; END;
 PERFORM public.complete_verified_controlled_counts(ARRAY[count_id],nurse,caregiver,f.facility,f.org);
 SELECT id INTO count_id FROM public.controlled_substance_counts WHERE outgoing_staff_id=tech;
 PERFORM public.complete_verified_controlled_counts(ARRAY[count_id],tech,nurse,f.facility,f.org);
 IF NOT EXISTS(SELECT 1 FROM public.controlled_substance_counts WHERE id=count_id AND incoming_staff_id=nurse AND incoming_signed_at IS NOT NULL) THEN RAISE EXCEPTION 'Med-tech count could not be completed'; END IF;
 INSERT INTO public.controlled_substance_counts(resident_medication_id,facility_id,organization_id,count_date,shift,expected_count,actual_count,outgoing_staff_id)
  VALUES(f.med,f.facility,f.org,current_date,'day',2,2,manager) RETURNING id INTO count_id;
 BEGIN
  PERFORM public.complete_verified_controlled_counts(ARRAY[count_id],manager,nurse,f.facility,f.org);
  RAISE EXCEPTION 'Manager-origin count was improperly authorized';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invalid outgoing count role' THEN RAISE; END IF; END;
END $$;
-- Medication-pass owners and incoming witnesses have distinct eligibility.
DO $$ DECLARE f record; a record; tech uuid; nurse uuid; shift_id uuid; pass_id uuid; resident uuid; signature uuid; BEGIN
 SELECT * INTO f FROM count_role_fixture;
 SELECT id INTO tech FROM count_test_actors WHERE role='med_tech';
 SELECT id INTO nurse FROM count_test_actors WHERE role='nurse';
 SELECT resident_id INTO resident FROM public.resident_medications WHERE id=f.med;
 FOR a IN SELECT * FROM count_test_actors WHERE role IN('med_tech','nurse') LOOP
  shift_id:=gen_random_uuid();pass_id:=gen_random_uuid();
  INSERT INTO public.med_tech_shifts(id,organization_id,facility_id,user_id,shift_start,shift_end,status)
    VALUES(shift_id,f.org,f.facility,a.id,now(),now()+interval '8 hours','active');
  INSERT INTO public.med_passes(id,organization_id,facility_id,shift_id,resident_id,resident_medication_id,administered_by,status,witness_required)
    VALUES(pass_id,f.org,f.facility,shift_id,resident,f.med,a.id,'pending',true);
  IF a.role='nurse' THEN
    BEGIN
      PERFORM public.record_verified_med_pass_witness(pass_id,nurse,tech);
      RAISE EXCEPTION 'Med-tech incoming pass witness was improperly authorized';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Both staff must have clinical facility access' THEN RAISE; END IF; END;
  ELSE
    signature:=public.record_verified_med_pass_witness(pass_id,tech,nurse);
    IF NOT EXISTS(SELECT 1 FROM public.witness_signatures WHERE id=signature AND med_pass_id=pass_id AND witness_user_id=nurse) THEN RAISE EXCEPTION 'Med-tech-owned pass did not save nurse witness'; END IF;
  END IF;
 END LOOP;
END $$;
ROLLBACK;
