-- Synthetic local fixtures only. Caller creates/drops its own disposable DB.
-- No transaction wrapper: review probes wrap/rollback; integration callers commit.
CREATE TABLE haven.insureflow_receiver_fixture AS SELECT gen_random_uuid() organization_id,gen_random_uuid() entity_id,gen_random_uuid() actor_id,gen_random_uuid() session_id,NULL::jsonb claims;
INSERT INTO public.organizations(id,name) SELECT organization_id,'Synthetic InsureFlow receiver organization' FROM haven.insureflow_receiver_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT entity_id,organization_id,'Explicitly mapped synthetic insured' FROM haven.insureflow_receiver_fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor_id,actor_id||'@review.invalid',jsonb_build_object('organization_id',organization_id,'app_role','owner'),'{"full_name":"Synthetic receiver owner"}'::jsonb FROM haven.insureflow_receiver_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT actor_id,actor_id||'@review.invalid','Synthetic receiver owner','owner',organization_id,true FROM haven.insureflow_receiver_fixture ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role='owner',is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session_id,actor_id FROM haven.insureflow_receiver_fixture;
UPDATE haven.insureflow_receiver_fixture f SET claims=jsonb_build_object('role','authenticated','sub',f.actor_id,'session_id',f.session_id,'auth_claim_version',p.auth_claim_version) FROM public.user_profiles p WHERE p.id=f.actor_id;
REVOKE ALL ON haven.insureflow_receiver_fixture FROM PUBLIC,anon,authenticated,service_role;
