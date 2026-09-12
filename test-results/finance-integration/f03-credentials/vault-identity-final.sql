-- Rollback-only, synthetic native PostgreSQL replay. Never target production.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS not_after timestamptz;
CREATE TEMP TABLE bf AS SELECT gen_random_uuid() org,gen_random_uuid() other_org,gen_random_uuid() entity,gen_random_uuid() other_entity,
 gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() c,gen_random_uuid() resident_a,gen_random_uuid() resident_b,gen_random_uuid() resident_c;
CREATE TEMP TABLE ba(label text PRIMARY KEY,id uuid NOT NULL DEFAULT gen_random_uuid(),session_id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO ba(label) VALUES('owner'),('approver'),('preparer'),('outsider');
CREATE TEMP TABLE bi(label text PRIMARY KEY,id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO bi(label) VALUES('rules'),('rules2'),('rules3'),('control'),('connection'),('p1'),('p2'),('p3'),('p4'),('pb'),('pc'),('main'),('small'),('approval'),('successor'),('free'),('loss'),('loss_approval'),('loss_new'),('manual'),('reversal'),('gross_batch');
CREATE TEMP TABLE bd(label text PRIMARY KEY,document jsonb);
CREATE TEMP SEQUENCE batch_assertions;
GRANT SELECT ON bf,ba TO authenticated;
-- Native stubs do not provision existing Supabase application table grants.
GRANT SELECT,INSERT,UPDATE ON public.gl_period_closes TO authenticated;
GRANT ALL ON bi,bd TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE batch_assertions TO authenticated;
CREATE FUNCTION pg_temp.batch_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'BATCH assertion failed: %',label; END IF;
 PERFORM nextval('pg_temp.batch_assertions'); RAISE NOTICE 'BATCH PASS: %',label;
END $$;
CREATE FUNCTION pg_temp.batch_error(statement text,code text,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>code THEN RAISE EXCEPTION 'BATCH unexpected %: % (wanted %)',SQLSTATE,SQLERRM,code; END IF;
  PERFORM pg_temp.batch_assert(true,label); RETURN;
 END; RAISE EXCEPTION 'BATCH expected rejection: %',label;
END $$;
CREATE FUNCTION pg_temp.batch_login(label text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN
 SELECT actor.id,actor.session_id,p.auth_claim_version INTO a FROM ba actor JOIN public.user_profiles p ON p.id=actor.id WHERE actor.label=batch_login.label;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',a.id,'session_id',a.session_id,'auth_claim_version',a.auth_claim_version)::text,true);
END $$;
CREATE FUNCTION pg_temp.batch_mapping() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('companyReference','123','accountReferences',jsonb_build_array('100','200'),'accountingBasis','accrual','effectiveFrom','2000-01-01','effectiveTo','2199-12-31') $$;
CREATE FUNCTION pg_temp.batch_members(labels text[]) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_agg(jsonb_build_object('eventId',e.id,'lines',jsonb_build_array(
  jsonb_build_object('accountReference','100','side','debit','amountCents',e.control_total_cents::text),
  jsonb_build_object('accountReference','200','side','credit','amountCents',e.control_total_cents::text))) ORDER BY e.id)
 FROM bi i JOIN public.finance_source_events e ON e.receipt_id=i.id WHERE i.label=ANY(labels)
$$;
INSERT INTO public.organizations(id,name) SELECT org,'Synthetic batch organization' FROM bf UNION ALL SELECT other_org,'Synthetic other batch organization' FROM bf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'Synthetic batch entity' FROM bf UNION ALL SELECT other_entity,other_org,'Synthetic other batch entity' FROM bf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT a,org,entity,'Batch A','Synthetic','Synthetic','00000',1 FROM bf UNION ALL SELECT b,org,entity,'Batch B','Synthetic','Synthetic','00000',1 FROM bf UNION ALL SELECT c,other_org,other_entity,'Batch C','Synthetic','Synthetic','00000',1 FROM bf;
INSERT INTO auth.users(id,email) SELECT id,id||'@batch.invalid' FROM ba;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
 SELECT ba.id,CASE WHEN label='outsider' THEN bf.other_org ELSE bf.org END,ba.id||'@batch.invalid','Synthetic batch actor',CASE WHEN label='preparer' THEN 'facility_admin' ELSE 'owner' END::public.app_role,true FROM ba CROSS JOIN bf;
INSERT INTO auth.sessions(id,user_id) SELECT session_id,id FROM ba;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT ba.id,bf.a,bf.org FROM ba CROSS JOIN bf WHERE label='preparer';
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender)
 SELECT resident_a,org,a,'Synthetic','A',date '1940-01-01','female'::public.gender FROM bf UNION ALL SELECT resident_b,org,b,'Synthetic','B',date '1940-01-01','female'::public.gender FROM bf UNION ALL SELECT resident_c,other_org,c,'Synthetic','C',date '1940-01-01','female'::public.gender FROM bf;
SELECT pg_temp.batch_login('owner');
SET LOCAL ROLE authenticated;
SELECT public.record_finance_payment(i.id,f.resident_a,NULL,current_date,CASE WHEN i.label IN('p1','p2') THEN 2000000000 ELSE 100 END,'check') FROM bi i CROSS JOIN bf f WHERE i.label IN('p1','p2','p3','p4');
SELECT public.record_finance_payment(i.id,f.resident_b,NULL,current_date,100,'check') FROM bi i CROSS JOIN bf f WHERE i.label='pb';
SELECT public.set_finance_staging_control((SELECT id FROM bi WHERE label='control'),entity,0,false,(SELECT id FROM bi WHERE label='connection'),repeat('a',64),NULL) FROM bf;
SELECT public.register_finance_batch_rules((SELECT id FROM bi WHERE label='rules'),entity,pg_temp.batch_mapping(),repeat('b',64),0) FROM bf;
SELECT pg_temp.batch_login('outsider');
SELECT public.record_finance_payment(i.id,f.resident_c,NULL,current_date,100,'check') FROM bi i CROSS JOIN bf f WHERE i.label='pc';
SELECT pg_temp.batch_login('owner');
RESET ROLE;
CREATE TEMP TABLE cf AS SELECT gen_random_uuid() second_entity,gen_random_uuid() app_entity,gen_random_uuid() worker,gen_random_uuid() seed,gen_random_uuid() lease,gen_random_uuid() attempt,gen_random_uuid() response,gen_random_uuid() observer;
INSERT INTO public.entities(id,organization_id,name) SELECT second_entity,org,'Synthetic shared grant entity' FROM cf CROSS JOIN bf UNION ALL SELECT app_entity,org,'Synthetic distinct app entity' FROM cf CROSS JOIN bf;
GRANT ALL ON cf TO authenticated,haven_finance_worker,service_role;
GRANT ALL ON bd,bi TO haven_finance_worker,service_role;
GRANT SELECT ON bf,ba TO haven_finance_worker,service_role;
GRANT USAGE,SELECT ON SEQUENCE batch_assertions TO haven_finance_worker,service_role;
CREATE FUNCTION pg_temp.worker_login(purpose text,epoch integer DEFAULT 1) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','haven_finance_worker','sub',(SELECT worker FROM cf),'hfa_org',(SELECT org FROM bf),'iss','urn:haven:finance-worker:v1','aud','haven-finance-credentials','purpose',purpose,'worker_epoch',epoch,'iat',floor(extract(epoch FROM clock_timestamp())),'exp',floor(extract(epoch FROM clock_timestamp()))+240)::text,true);
END $$;
CREATE FUNCTION pg_temp.declaration(client text DEFAULT 'a',environment text DEFAULT 'sandbox') RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('provider','qbo','environment',environment,'company_reference','123','client_identity_sha256',repeat(client,64),'app_config_sha256',repeat('b',64),'expected_connection_id',NULL) $$;
CREATE FUNCTION pg_temp.candidate_body() RETURNS text LANGUAGE sql AS $$ SELECT '{"access_token":"SYNTHETIC_ACCESS_CANARY_342","refresh_token":"SYNTHETIC_REFRESH_CANARY_342","token_type":"bearer","expires_in":3600,"x_refresh_token_expires_in":86400}'::text $$;
CREATE FUNCTION pg_temp.stage_stop(p_entity uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.set_finance_staging_control(gen_random_uuid(),entity_id,staging_generation,true,connection_generation_ref,capability_reference_sha256,worker_id) FROM public.finance_staging_controls WHERE entity_id=p_entity $$;
CREATE FUNCTION pg_temp.inject_observer_loss(p_candidate uuid,p_event text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO public.finance_credential_workers(id,organization_id,epoch,active) SELECT observer,org,1,true FROM cf CROSS JOIN bf;
 INSERT INTO public.finance_credential_assignments(worker_id,lineage_id) SELECT observer,lineage_id FROM cf CROSS JOIN public.finance_credential_candidates WHERE id=p_candidate;
 ALTER TABLE public.finance_credential_identity_observations DISABLE TRIGGER immutable_finance_identity_observation;
 UPDATE public.finance_credential_identity_observations SET worker_id=(SELECT observer FROM cf) WHERE candidate_id=p_candidate;
 ALTER TABLE public.finance_credential_identity_observations ENABLE TRIGGER immutable_finance_identity_observation;
 PERFORM set_config('hfa.test_loss_event',p_event,true);
END $$;
CREATE FUNCTION pg_temp.loss_at_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 IF NEW.event=current_setting('hfa.test_loss_event',true) THEN UPDATE public.finance_credential_workers SET active=false WHERE id=(SELECT observer FROM cf); END IF; RETURN NEW;
END $$;
SELECT pg_temp.batch_login('owner'); SET LOCAL ROLE authenticated;
INSERT INTO bd SELECT 'binding',public.finance_credential_control(gen_random_uuid(),entity,'bind',pg_temp.declaration()) FROM bf;
INSERT INTO bd SELECT 'binding2',public.finance_credential_control(gen_random_uuid(),second_entity,'bind',pg_temp.declaration()) FROM cf;
INSERT INTO bd SELECT 'binding3',public.finance_credential_control(gen_random_uuid(),app_entity,'bind',pg_temp.declaration('c')) FROM cf;
SELECT pg_temp.batch_login('outsider');
SELECT pg_temp.batch_error($q$SELECT public.finance_credential_control(gen_random_uuid(),other_entity,'bind',pg_temp.declaration()) FROM bf$q$,'42501','physical-grant-cannot-have-second-organization-owner');
SELECT pg_temp.batch_login('owner');
INSERT INTO bd SELECT 'status',public.finance_credential_status(entity) FROM bf;
SELECT pg_temp.batch_assert((SELECT document->>'lineage_id' FROM bd WHERE label='binding')=(SELECT document->>'lineage_id' FROM bd WHERE label='binding2'),'same-client-shared-lineage');
SELECT pg_temp.batch_assert((SELECT document->>'lineage_id' FROM bd WHERE label='binding')<>(SELECT document->>'lineage_id' FROM bd WHERE label='binding3'),'distinct-client-distinct-lineage');
SELECT public.finance_credential_control(gen_random_uuid(),entity,'worker',jsonb_build_object('lineage_id',(SELECT document->>'lineage_id' FROM bd WHERE label='binding'),'worker_id',worker,'expected_epoch',0,'active',true)) FROM cf CROSS JOIN bf;
SELECT pg_temp.batch_error($q$SELECT public.seed_finance_credential_candidate(seed,entity,(SELECT (document->>'lineage_id')::uuid FROM bd WHERE label='binding'),1,0,pg_temp.candidate_body()) FROM cf CROSS JOIN bf$q$,'42501','fresh-seed-while-stopped-denied');
SELECT public.finance_credential_control(gen_random_uuid(),entity,'stop',jsonb_build_object('lineage_id',(public.finance_credential_status(entity)->>'lineage_id'),'expected_fence_epoch',(public.finance_credential_status(entity)->>'fence_epoch')::bigint,'stopped',false)) FROM bf;
SELECT pg_temp.batch_error($q$SELECT public.seed_finance_credential_candidate(seed,entity,(SELECT (document->>'lineage_id')::uuid FROM bd WHERE label='binding'),1,0,pg_temp.candidate_body()) FROM cf CROSS JOIN bf$q$,'55000','missing-vault-fails-closed');
RESET ROLE;
DO $$ BEGIN
 IF current_database() !~ '^(hfa_credentials_342_[a-z0-9_]+|haven_verify_[0-9_]+)$' OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='vault') OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='supabase_vault') THEN RAISE EXCEPTION 'Refuse Vault stub outside owned native database or over real Vault'; END IF;
END $$;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),secret text NOT NULL,name text UNIQUE,description text);
CREATE VIEW vault.decrypted_secrets AS SELECT id,secret AS decrypted_secret FROM vault.secrets;
CREATE FUNCTION vault.create_secret(text,text DEFAULT NULL,text DEFAULT '',uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE result uuid; BEGIN INSERT INTO vault.secrets(secret,name,description) VALUES($1,$2,$3) RETURNING id INTO result; RETURN result; END $$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC,anon,authenticated,service_role,haven_finance_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC,anon,authenticated,service_role,haven_finance_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vault FROM PUBLIC,anon,authenticated,service_role,haven_finance_worker;
CREATE OR REPLACE FUNCTION haven.require_finance_vault() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF current_database() !~ '^(hfa_credentials_342_[a-z0-9_]+|haven_verify_[0-9_]+)$' OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='supabase_vault') THEN RAISE EXCEPTION 'Native-only rollback stub'; END IF; END $$;
SELECT pg_temp.batch_login('owner'); SET LOCAL ROLE authenticated;
INSERT INTO bd SELECT 'seed',public.seed_finance_credential_candidate(seed,entity,(SELECT (document->>'lineage_id')::uuid FROM bd WHERE label='binding'),1,0,(pg_temp.candidate_body()::jsonb||'{"x_refresh_token_hard_expires_in":7200}')::text) FROM cf CROSS JOIN bf;
RESET ROLE; SELECT pg_temp.worker_login('finance_install'); SET LOCAL ROLE haven_finance_worker;
SELECT pg_temp.batch_assert((public.install_finance_credential_candidate(seed)->>'status')='quarantined_stale_or_unverified','unobserved-candidate-cannot-install') FROM cf;
RESET ROLE; SELECT pg_temp.worker_login('finance_identity'); SET LOCAL ROLE haven_finance_worker;

RESET ROLE; CREATE OR REPLACE FUNCTION haven.finance_vault_read(p_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Synthetic protected store temporarily unavailable' USING ERRCODE='55000'; END $$; SET LOCAL ROLE haven_finance_worker;

SELECT pg_temp.batch_error($q$SELECT public.read_finance_credential_identity(lease,seed) FROM cf$q$,'55000','independent-vault-outage-not-invalid-identity');
RESET ROLE; SELECT pg_temp.batch_assert(NOT EXISTS(SELECT 1 FROM public.finance_credential_receipts WHERE event='candidate_invalid'),'independent-vault-outage-no-false-identity-receipt');
ROLLBACK;
