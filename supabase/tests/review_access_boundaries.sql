-- Disposable local replay only. Everything (including auth stub adaptation) rolls back.
BEGIN;
-- The vanilla replay stub omits Supabase auth schema visibility.
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT UPDATE ON public.user_profiles TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;

DO $$ BEGIN
  IF has_table_privilege('authenticated','public.user_facility_access','INSERT')
     OR has_table_privilege('authenticated','public.user_facility_access','UPDATE')
     OR has_table_privilege('authenticated','public.user_facility_access','DELETE') THEN RAISE EXCEPTION 'Direct facility grant write remains exposed'; END IF;
  IF has_table_privilege('authenticated','public.witness_signatures','INSERT')
     OR has_table_privilege('authenticated','public.flow_workflow_runs','UPDATE')
     OR has_function_privilege('authenticated','public.undo_grace_action(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.complete_verified_controlled_counts(uuid[],uuid,uuid,uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Privileged receipt command exposed'; END IF;
END $$;

CREATE TEMP TABLE access_fixture AS
SELECT gen_random_uuid() actor, gen_random_uuid() manager, gen_random_uuid() run_id, gen_random_uuid() resident,
  f.id facility, f.organization_id org, gen_random_uuid() definition FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM access_fixture) THEN RAISE EXCEPTION 'Local replay seed facility required'; END IF; END $$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','caregiver'),jsonb_build_object('full_name','Review actor') FROM access_fixture
UNION ALL SELECT manager,manager||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','manager'),jsonb_build_object('full_name','Review manager') FROM access_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
SELECT actor,actor||'@review.invalid','Review actor','caregiver'::public.app_role,org,true FROM access_fixture
UNION ALL SELECT manager,manager||'@review.invalid','Review manager','manager'::public.app_role,org,true FROM access_fixture
ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM access_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','app_role','caregiver','organization_id',org,
  'app_metadata',jsonb_build_object('app_role','caregiver','organization_id',org))::text,true) FROM access_fixture;
GRANT SELECT ON access_fixture TO authenticated;
SET LOCAL ROLE authenticated;
UPDATE public.user_profiles SET full_name='Safe profile edit' WHERE id=(SELECT actor FROM access_fixture);
DO $$ BEGIN
  BEGIN
    UPDATE public.user_profiles SET app_role='owner' WHERE id=(SELECT actor FROM access_fixture);
    RAISE EXCEPTION 'Profile escalation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN IF (SELECT full_name FROM public.user_profiles WHERE id=(SELECT actor FROM access_fixture)) <> 'Safe profile edit' THEN RAISE EXCEPTION 'Safe self edit failed'; END IF; END $$;

-- Exercise the real signature trigger using a constraint-free temp copy to isolate its boundary.
CREATE TEMP TABLE signature_probe (LIKE public.controlled_substance_counts INCLUDING DEFAULTS);
CREATE TRIGGER signature_probe_guard BEFORE INSERT OR UPDATE ON signature_probe FOR EACH ROW EXECUTE FUNCTION haven.guard_controlled_count_signatures();
GRANT SELECT,INSERT,UPDATE ON signature_probe TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM access_fixture;
  BEGIN
    INSERT INTO signature_probe(resident_medication_id,facility_id,organization_id,count_date,shift,expected_count,actual_count,outgoing_staff_id,incoming_staff_id,incoming_signed_at)
      VALUES(gen_random_uuid(),f.facility,f.org,current_date,'day',2,2,f.actor,f.manager,now());
    RAISE EXCEPTION 'Forged witness accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO signature_probe(resident_medication_id,facility_id,organization_id,count_date,shift,expected_count,actual_count,outgoing_staff_id)
    VALUES(gen_random_uuid(),f.facility,f.org,current_date,'day',2,2,f.actor);
  BEGIN
    UPDATE signature_probe SET incoming_staff_id=f.manager,incoming_signed_at=now();
    RAISE EXCEPTION 'Direct witness update accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender)
  SELECT resident,facility,org,'Review','Fixture','1940-01-01','female' FROM access_fixture;
INSERT INTO public.flow_workflow_definitions(id,organization_id,slug,name) SELECT definition,org,'review_test','Review test' FROM access_fixture;
INSERT INTO public.flow_workflow_runs(id,organization_id,flow_definition_id,user_id,idempotency_key,status,metadata)
 SELECT run_id,org,definition,actor,gen_random_uuid(),'running','{"flow_slug":"log_daily_note","receipt_version":1}' FROM access_fixture;
CREATE FUNCTION pg_temp.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$;
CREATE TRIGGER review_fail_receipt BEFORE INSERT ON public.flow_workflow_run_steps FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_receipt();
DO $$ DECLARE f record; payload jsonb; BEGIN
 SELECT * INTO f FROM access_fixture;
 payload := jsonb_build_object('resident_id',f.resident,'facility_id',f.facility,'organization_id',f.org,'log_date',current_date,'shift','day','logged_by',f.actor,'created_by',f.actor);
 BEGIN
   PERFORM public.commit_grace_action(f.run_id,'daily_logs',payload);
   RAISE EXCEPTION 'Receipt fault did not fail';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'injected receipt failure' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.daily_logs WHERE resident_id=f.resident) THEN RAISE EXCEPTION 'Domain insert survived receipt rollback'; END IF;
END $$;
DROP TRIGGER review_fail_receipt ON public.flow_workflow_run_steps;
DO $$ DECLARE f record; payload jsonb; receipt jsonb; repeated jsonb; BEGIN
 SELECT * INTO f FROM access_fixture;
 payload := jsonb_build_object('resident_id',f.resident,'facility_id',f.facility,'organization_id',f.org,'log_date',current_date,'shift','day','logged_by',f.actor,'created_by',f.actor);
 receipt := public.commit_grace_action(f.run_id,'daily_logs',payload);
 repeated := public.commit_grace_action(f.run_id,'daily_logs',payload);
 IF receipt <> repeated OR (SELECT count(*) FROM public.daily_logs WHERE resident_id=f.resident) <> 1 THEN RAISE EXCEPTION 'Grace replay duplicated action'; END IF;
 BEGIN
   PERFORM public.undo_grace_action(f.run_id,f.manager);
   RAISE EXCEPTION 'Cross-facility manager undo accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Forbidden facility' THEN RAISE; END IF; END;
 -- Version check must prevent overwriting a human edit.
 UPDATE public.flow_workflow_runs SET result_payload=jsonb_set(result_payload,'{record_updated_at}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=f.run_id;
 BEGIN
   PERFORM public.undo_grace_action(f.run_id,f.actor);
   RAISE EXCEPTION 'Changed record undo accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Target changed; manual review required' THEN RAISE; END IF; END;
 UPDATE public.flow_workflow_runs SET result_payload=receipt->'result' WHERE id=f.run_id;
 PERFORM public.undo_grace_action(f.run_id,f.actor);
 IF (SELECT status FROM public.flow_workflow_runs WHERE id=f.run_id) <> 'undone'
   OR EXISTS(SELECT 1 FROM public.daily_logs WHERE resident_id=f.resident AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Undo did not commit'; END IF;
END $$;
-- Verified count batches must sign and audit all rows, or none.
DO $$ DECLARE f record; witness uuid:=gen_random_uuid(); med uuid; first_count uuid:=gen_random_uuid(); second_count uuid:=gen_random_uuid(); BEGIN
 SELECT * INTO f FROM access_fixture;
 SELECT id INTO med FROM public.resident_medications WHERE facility_id=f.facility AND organization_id=f.org AND deleted_at IS NULL LIMIT 1;
 IF med IS NULL THEN RAISE EXCEPTION 'Local seed medication required'; END IF;
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES(witness,witness||'@review.invalid',jsonb_build_object('organization_id',f.org,'app_role','nurse'),jsonb_build_object('full_name','Review witness'));
 INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) VALUES(witness,witness||'@review.invalid','Review witness','nurse',f.org,true)
   ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
 INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) VALUES(witness,f.facility,f.org);
 INSERT INTO public.controlled_substance_counts(id,resident_medication_id,facility_id,organization_id,count_date,shift,expected_count,actual_count,outgoing_staff_id)
   VALUES(first_count,med,f.facility,f.org,current_date,'day',2,2,f.actor),(second_count,med,f.facility,f.org,current_date,'day',2,2,f.actor);
 UPDATE public.controlled_substance_counts SET incoming_staff_id=witness,incoming_signed_at=now() WHERE id=second_count;
 BEGIN
   PERFORM public.complete_verified_controlled_counts(ARRAY[first_count,second_count],f.actor,witness,f.facility,f.org);
   RAISE EXCEPTION 'Partially unavailable batch accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Count is no longer available for signing' THEN RAISE; END IF; END;
 IF (SELECT incoming_staff_id FROM public.controlled_substance_counts WHERE id=first_count) IS NOT NULL THEN RAISE EXCEPTION 'Batch partially signed'; END IF;
 UPDATE public.controlled_substance_counts SET incoming_staff_id=NULL,incoming_signed_at=NULL WHERE id=second_count;
 PERFORM public.complete_verified_controlled_counts(ARRAY[first_count,second_count],f.actor,witness,f.facility,f.org);
 IF (SELECT count(*) FROM public.controlled_substance_counts WHERE id IN(first_count,second_count) AND incoming_staff_id=witness AND incoming_signed_at IS NOT NULL) <> 2 THEN RAISE EXCEPTION 'Batch signature not saved'; END IF;
 IF (SELECT count(*) FROM public.audit_log WHERE record_id IN(first_count,second_count) AND new_data->>'event'='incoming_co_sign_verified') <> 2 THEN RAISE EXCEPTION 'Verified witness audit not saved'; END IF;
END $$;
ROLLBACK;
