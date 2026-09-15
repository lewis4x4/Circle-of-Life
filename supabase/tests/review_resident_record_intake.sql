-- RRI-01 rollback-only proof: private bytes, manual zero-provider path,
-- current authority, review separation, stale refusal, and immutable receipts.
BEGIN;

GRANT USAGE ON SCHEMA auth,storage,haven TO authenticated,service_role;
GRANT SELECT ON public.residents,public.resident_documents,public.emar_records,public.family_resident_links TO authenticated;
GRANT UPDATE ON public.residents TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'role','')
$$;

CREATE TEMP TABLE rri_fixture AS
SELECT f.organization_id organization_id,f.id facility_id,other.id other_facility_id,
  gen_random_uuid() owner_id,gen_random_uuid() owner_session,
  gen_random_uuid() nurse_id,gen_random_uuid() nurse_session,
  gen_random_uuid() caregiver_id,gen_random_uuid() caregiver_session,
  gen_random_uuid() other_nurse_id,gen_random_uuid() other_nurse_session,
  NULL::uuid intake_id,NULL::uuid source_id,NULL::uuid resident_id,NULL::uuid fact_id
FROM public.facilities f
JOIN public.facilities other ON other.organization_id=f.organization_id AND other.id<>f.id
WHERE f.deleted_at IS NULL AND other.deleted_at IS NULL
ORDER BY f.id,other.id LIMIT 1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM rri_fixture) THEN RAISE EXCEPTION 'RRI test requires two seeded facilities'; END IF; END $$;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT owner_id,owner_id||'@rri.invalid','{}'::jsonb,'{}'::jsonb FROM rri_fixture UNION ALL
SELECT nurse_id,nurse_id||'@rri.invalid','{}'::jsonb,'{}'::jsonb FROM rri_fixture UNION ALL
SELECT caregiver_id,caregiver_id||'@rri.invalid','{}'::jsonb,'{}'::jsonb FROM rri_fixture UNION ALL
SELECT other_nurse_id,other_nurse_id||'@rri.invalid','{}'::jsonb,'{}'::jsonb FROM rri_fixture;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
SELECT owner_id,organization_id,owner_id||'@rri.invalid','RRI owner','owner'::public.app_role,true FROM rri_fixture UNION ALL
SELECT nurse_id,organization_id,nurse_id||'@rri.invalid','RRI nurse','nurse'::public.app_role,true FROM rri_fixture UNION ALL
SELECT caregiver_id,organization_id,caregiver_id||'@rri.invalid','RRI caregiver','caregiver'::public.app_role,true FROM rri_fixture UNION ALL
SELECT other_nurse_id,organization_id,other_nurse_id||'@rri.invalid','RRI other nurse','nurse'::public.app_role,true FROM rri_fixture;
INSERT INTO auth.sessions(id,user_id)
SELECT owner_session,owner_id FROM rri_fixture UNION ALL SELECT nurse_session,nurse_id FROM rri_fixture UNION ALL
SELECT caregiver_session,caregiver_id FROM rri_fixture UNION ALL SELECT other_nurse_session,other_nurse_id FROM rri_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
SELECT owner_id,facility_id,organization_id FROM rri_fixture UNION ALL
SELECT nurse_id,facility_id,organization_id FROM rri_fixture UNION ALL
SELECT caregiver_id,facility_id,organization_id FROM rri_fixture UNION ALL
SELECT other_nurse_id,other_facility_id,organization_id FROM rri_fixture;

GRANT ALL ON rri_fixture TO authenticated,service_role;
CREATE FUNCTION pg_temp.rri_login(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE f rri_fixture; actor uuid; session_id uuid; claim_version integer;
BEGIN
 SELECT * INTO STRICT f FROM rri_fixture;
 actor:=CASE p_role WHEN 'owner' THEN f.owner_id WHEN 'nurse' THEN f.nurse_id
   WHEN 'caregiver' THEN f.caregiver_id ELSE f.other_nurse_id END;
 session_id:=CASE p_role WHEN 'owner' THEN f.owner_session WHEN 'nurse' THEN f.nurse_session
   WHEN 'caregiver' THEN f.caregiver_session ELSE f.other_nurse_session END;
 SELECT auth_claim_version INTO claim_version FROM public.user_profiles WHERE id=actor;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',session_id,
   'role','authenticated','auth_claim_version',claim_version)::text,true);
END $$;
CREATE FUNCTION pg_temp.rri_assert(p_ok boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'RRI assertion: %',p_message; END IF; END $$;
CREATE FUNCTION pg_temp.rri_error(p_sql text,p_fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
   IF position(p_fragment IN SQLERRM)>0 THEN RETURN; END IF; RAISE;
 END;
 RAISE EXCEPTION 'Expected RRI denial containing %',p_fragment;
END $$;

SELECT pg_temp.rri_login('owner'); SET LOCAL ROLE authenticated;
DO $$ DECLARE f rri_fixture; reply jsonb;
BEGIN
 SELECT * INTO STRICT f FROM rri_fixture;
 reply:=public.prepare_resident_record_intake('rri-intake-0001',f.facility_id,'Synthetic packet');
 UPDATE rri_fixture SET intake_id=(reply#>>'{intake,id}')::uuid;
 IF NOT (public.prepare_resident_record_intake('rri-intake-0001',f.facility_id,'Synthetic packet')->>'replayed')::boolean THEN
   RAISE EXCEPTION 'Prepare replay was not identified'; END IF;
 PERFORM pg_temp.rri_error(format($q$SELECT public.prepare_resident_record_intake('rri-intake-0001','%s','Changed packet')$q$,f.facility_id),'content conflict');
END $$;

DO $$ DECLARE f rri_fixture; reply jsonb;
BEGIN
 SELECT * INTO STRICT f FROM rri_fixture;
 reply:=public.prepare_resident_record_intake_source(f.intake_id,'rri-source-0001',jsonb_build_object(
   'title','Synthetic face sheet','original_filename','face.jpg','declared_mime','image/jpeg',
   'declared_size_bytes',12,'declared_sha256',repeat('a',64),
   'expected_intake_revision',(SELECT revision FROM public.resident_record_intakes WHERE id=f.intake_id)));
 UPDATE rri_fixture SET source_id=(reply#>>'{source,id}')::uuid;
 IF EXISTS(SELECT 1 FROM public.resident_documents d WHERE d.resident_record_intake_id=f.intake_id) THEN
   RAISE EXCEPTION 'Prepare created a canonical resident document'; END IF;
END $$;
RESET ROLE;

INSERT INTO storage.objects(bucket_id,name,owner,version,metadata)
SELECT 'resident-intake-sources',s.storage_path,s.uploaded_by,'rri-v1',
  jsonb_build_object('size',12,'mimetype','image/jpeg','eTag',repeat('b',32))
FROM public.resident_record_intake_sources s JOIN rri_fixture f ON f.source_id=s.id;
CREATE TEMP TABLE rri_byte_args AS
SELECT s.id source_id,o.id object_id,o.version object_version,s.uploaded_by
FROM public.resident_record_intake_sources s JOIN storage.objects o ON o.name=s.storage_path
JOIN rri_fixture f ON f.source_id=s.id;
GRANT SELECT ON rri_byte_args TO service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true); SET LOCAL ROLE service_role;
SELECT public.attest_resident_record_intake_bytes(source_id,object_id,object_version,repeat('b',32),12,
  'image/jpeg',repeat('a',64),repeat('b',32),uploaded_by) FROM rri_byte_args;
RESET ROLE; SELECT pg_temp.rri_login('owner'); SET LOCAL ROLE authenticated;

DO $$ DECLARE f rri_fixture; reply jsonb; revision uuid;
BEGIN
 SELECT * INTO STRICT f FROM rri_fixture;
 SELECT s.revision INTO revision FROM public.resident_record_intake_sources s WHERE s.id=f.source_id;
 reply:=public.finalize_resident_record_intake_source(f.intake_id,f.source_id,'rri-finalize-0001',revision);
 IF reply#>>'{source,state}'<>'finalized' THEN RAISE EXCEPTION 'Source did not finalize'; END IF;
 IF NOT (public.finalize_resident_record_intake_source(f.intake_id,f.source_id,'rri-finalize-0001',revision)->>'replayed')::boolean THEN
   RAISE EXCEPTION 'Finalize replay failed'; END IF;
 revision:=(reply#>>'{source,revision}')::uuid;
 PERFORM public.resident_record_intake_command(f.intake_id,'rri-classify-0001','manual_classify_source',jsonb_build_object(
   'source_id',f.source_id,'expected_revision',revision,'source_class','resident',
   'document_type','demographics_face_sheet','reason','Reviewer inspected the synthetic image','page_count',1));
 reply:=public.resident_record_intake_command(f.intake_id,'rri-provisional-0001','create_provisional_resident',jsonb_build_object(
   'first_name','Mara','last_name','Example','duplicate_disposition','no_match','reason','No candidate selected after explicit review'));
 UPDATE rri_fixture SET resident_id=(reply#>>'{result,resident_id}')::uuid;
END $$;

SELECT pg_temp.rri_assert((SELECT r.status='inquiry' AND r.code_status IS NULL AND r.ambulatory IS NULL
  AND r.primary_payer IS NULL AND r.bed_id IS NULL FROM public.residents r JOIN rri_fixture f ON f.resident_id=r.id),
  'provisional resident received favorable clinical/payer/occupancy defaults');
SELECT pg_temp.rri_error($q$UPDATE public.residents SET status='active' WHERE id=(SELECT resident_id FROM rri_fixture)$q$,
  'Clinical and payer fields require review');

DO $$ DECLARE f rri_fixture; reply jsonb; fact uuid; revision uuid;
BEGIN
 SELECT * INTO STRICT f FROM rri_fixture;
 reply:=public.resident_record_intake_command(f.intake_id,'rri-propose-0001','propose_manual_fact',jsonb_build_object(
   'source_id',f.source_id,'field_code','resident.preferred_name','domain','demographics',
   'structured_value',jsonb_build_object('value','Mari'),'display_value','Mari','page_start',1,'page_end',1,
   'reason','Operator transcribed the reviewed source'));
 fact:=(reply#>>'{result,fact_id}')::uuid; UPDATE rri_fixture SET fact_id=fact;
 SELECT x.revision INTO revision FROM public.resident_record_extracted_facts x WHERE x.id=fact;
 reply:=public.resident_record_intake_command(f.intake_id,'rri-approve-0001','approve_fact',jsonb_build_object(
   'fact_id',fact,'expected_revision',revision,'reason','Matches reviewed image'));
 SELECT x.revision INTO revision FROM public.resident_record_extracted_facts x WHERE x.id=fact;
 reply:=public.resident_record_intake_command(f.intake_id,'rri-apply-0001','apply_fact',jsonb_build_object(
   'fact_id',fact,'expected_revision',revision,'promotion_mode','add'));
 IF reply#>>'{receipt,result}'<>'applied' THEN RAISE EXCEPTION 'Manual fact did not apply'; END IF;
 IF public.resident_record_intake_command(f.intake_id,'rri-apply-0001','apply_fact',jsonb_build_object(
   'fact_id',fact,'expected_revision',revision,'promotion_mode','add'))#>>'{receipt,result}'<>'applied' THEN
   RAISE EXCEPTION 'Apply replay lost receipt'; END IF;
END $$;

SELECT pg_temp.rri_assert((SELECT r.preferred_name='Mari' FROM public.residents r JOIN rri_fixture f ON f.resident_id=r.id),
  'approved demographic fact did not reach resident');
SELECT pg_temp.rri_assert((SELECT x->'current_value'='"Mari"'::jsonb
  FROM rri_fixture f,jsonb_array_elements(public.resident_record_intake_snapshot(f.intake_id)->'facts') x
  WHERE x->>'id'=f.fact_id::text),'snapshot omitted current canonical value');
SELECT pg_temp.rri_assert((SELECT count(*)=1 FROM public.resident_documents d JOIN rri_fixture f ON d.resident_record_intake_id=f.intake_id),
  'manual source promotion duplicated or omitted canonical document');
SELECT pg_temp.rri_assert((SELECT count(*)=1 FROM public.resident_record_application_receipts a JOIN rri_fixture f ON a.fact_id=f.fact_id),
  'apply replay duplicated receipt');

-- Current role and facility authority are checked for every snapshot/command.
RESET ROLE; SELECT pg_temp.rri_login('caregiver'); SET LOCAL ROLE authenticated;
SELECT pg_temp.rri_error($q$SELECT public.resident_record_intake_snapshot((SELECT intake_id FROM rri_fixture))$q$,'scope unavailable');
RESET ROLE; SELECT pg_temp.rri_login('other_nurse'); SET LOCAL ROLE authenticated;
SELECT pg_temp.rri_error($q$SELECT public.resident_record_intake_snapshot((SELECT intake_id FROM rri_fixture))$q$,'scope unavailable');

-- Admin/owner cannot substitute for a nurse on a clinical fact.
RESET ROLE; SELECT pg_temp.rri_login('owner'); SET LOCAL ROLE authenticated;
DO $$ DECLARE f rri_fixture; reply jsonb; clinical_fact uuid; revision uuid;
BEGIN
 SELECT * INTO STRICT f FROM rri_fixture;
 reply:=public.resident_record_intake_command(f.intake_id,'rri-clinical-propose','propose_manual_fact',jsonb_build_object(
   'source_id',f.source_id,'field_code','resident.code_status','domain','clinical',
   'structured_value',jsonb_build_object('value','full_code'),'display_value','Full code','page_start',1,'page_end',1,
   'reason','Synthetic clinical proposal'));
 clinical_fact:=(reply#>>'{result,fact_id}')::uuid;
 SELECT x.revision INTO revision FROM public.resident_record_extracted_facts x WHERE x.id=clinical_fact;
 PERFORM pg_temp.rri_error(format($q$SELECT public.resident_record_intake_command('%s','rri-owner-clinical','approve_fact',
   '{"fact_id":"%s","expected_revision":"%s","reason":"Owner attempted clinical review"}')$q$,
   f.intake_id,clinical_fact,revision),'authorized reviewer');
END $$;

SELECT pg_temp.rri_error($q$DELETE FROM public.resident_record_fact_events WHERE intake_id=(SELECT intake_id FROM rri_fixture)$q$,'permission denied');
SELECT pg_temp.rri_assert(NOT has_function_privilege('authenticated',
  'public.stage_resident_record_parse_result(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,text,jsonb)','EXECUTE'),
  'browser retained provider staging authority');
SELECT pg_temp.rri_assert(NOT has_function_privilege('authenticated',
  'public.attest_resident_record_intake_bytes(uuid,uuid,text,text,integer,text,text,text,uuid)','EXECUTE'),
  'browser retained byte attestation authority');
SELECT pg_temp.rri_assert((SELECT count(*)=0 FROM public.emar_records e JOIN rri_fixture f ON e.resident_id=f.resident_id),
  'packet intake created eMAR history');

SELECT 'RRI resident record intake PASS' result;
ROLLBACK;
