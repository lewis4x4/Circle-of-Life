-- Synthetic fixtures only. This file is loaded into a uniquely owned scratch DB
-- by verify-authority-races.mjs after the complete migration chain.
BEGIN;
CREATE SCHEMA insurance_race_probe;
CREATE TABLE insurance_race_probe.fixture AS SELECT
 gen_random_uuid() organization_id,gen_random_uuid() entity_id,
 gen_random_uuid() facility_id,gen_random_uuid() actor_id,
 gen_random_uuid() assignee_id,gen_random_uuid() actor_session_id,
 gen_random_uuid() document_id;
INSERT INTO public.organizations(id,name)
 SELECT organization_id,'Synthetic insurance authority regression' FROM insurance_race_probe.fixture;
INSERT INTO public.entities(id,organization_id,name)
 SELECT entity_id,organization_id,'Synthetic race insured entity' FROM insurance_race_probe.fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT facility_id,entity_id,organization_id,'Synthetic race facility','Test fixture','Test','00000',1 FROM insurance_race_probe.fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor_id,actor_id||'@review.invalid',jsonb_build_object('organization_id',organization_id,'app_role','owner'),'{"full_name":"Synthetic actor"}'::jsonb FROM insurance_race_probe.fixture
 UNION ALL SELECT assignee_id,assignee_id||'@review.invalid',jsonb_build_object('organization_id',organization_id,'app_role','org_admin'),'{"full_name":"Synthetic assignee"}'::jsonb FROM insurance_race_probe.fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor_id,actor_id||'@review.invalid','Synthetic actor','owner'::public.app_role,organization_id,true FROM insurance_race_probe.fixture
 UNION ALL SELECT assignee_id,assignee_id||'@review.invalid','Synthetic assignee','org_admin'::public.app_role,organization_id,true FROM insurance_race_probe.fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id)
 SELECT actor_session_id,actor_id FROM insurance_race_probe.fixture;
INSERT INTO public.insurance_documents(id,organization_id,filename,sha256,mime_type,byte_size,family,storage_path,status,scan_status,created_by)
 SELECT document_id,organization_id,'synthetic-authority-source.txt',repeat('0',64),'text/plain',1,'policy',organization_id::text||'/'||document_id::text,'ready','clean',actor_id FROM insurance_race_probe.fixture;
-- The ready source state is seeded to isolate processing authorization. These
-- probes do not attest to actual upload/scanning or provider extraction.
COMMIT;
