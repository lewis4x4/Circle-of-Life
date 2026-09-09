-- Synthetic receiver projection, atomicity and fencing. All fixtures roll back.
BEGIN;
\ir ../../scripts/insurance/fixtures/insureflow-receiver.sql
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE TEMP TABLE receiver_probe AS SELECT f.*,gen_random_uuid() connection_id,gen_random_uuid() other_organization_id,gen_random_uuid() other_entity_id,gen_random_uuid() second_entity_id,gen_random_uuid() facility_actor,gen_random_uuid() facility_session,'10000000-0000-4000-8000-000000000001'::uuid integration_id,'20000000-0000-4000-8000-000000000001'::uuid account_id,'30000000-0000-4000-8000-000000000001'::uuid policy_id,'40000000-0000-4000-8000-000000000001'::uuid release_id FROM haven.insureflow_receiver_fixture f;
INSERT INTO public.organizations(id,name) SELECT other_organization_id,'Other receiver scope' FROM receiver_probe;
INSERT INTO public.entities(id,organization_id,name) SELECT other_entity_id,other_organization_id,'Foreign mapped entity' FROM receiver_probe UNION ALL SELECT second_entity_id,organization_id,'Second explicit synthetic entity' FROM receiver_probe;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT facility_actor,facility_actor||'@review.invalid',jsonb_build_object('organization_id',organization_id,'app_role','facility_admin'),'{"full_name":"Synthetic facility reader"}'::jsonb FROM receiver_probe;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT facility_actor,facility_actor||'@review.invalid','Synthetic facility reader','facility_admin',organization_id,true FROM receiver_probe ON CONFLICT(id) DO UPDATE SET app_role='facility_admin',organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT facility_session,facility_actor FROM receiver_probe;
CREATE TEMP TABLE receiver_values(name text PRIMARY KEY,value jsonb);
GRANT SELECT ON receiver_probe TO authenticated,service_role;
GRANT ALL ON receiver_values TO authenticated,service_role;
CREATE FUNCTION pg_temp.receiver_expect(q text,msg text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE q;EXCEPTION WHEN OTHERS THEN IF position(msg IN SQLERRM)>0 THEN RETURN;END IF;RAISE;END;RAISE EXCEPTION 'Expected rejection: %',msg;END$$;
CREATE FUNCTION pg_temp.receiver_actor(p_facility boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$DECLARE f record;uid uuid;sid uuid;BEGIN SELECT * INTO f FROM receiver_probe;uid:=CASE WHEN p_facility THEN f.facility_actor ELSE f.actor_id END;sid:=CASE WHEN p_facility THEN f.facility_session ELSE f.session_id END;PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',uid,'session_id',sid,'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=uid))::text,true);END$$;
CREATE FUNCTION pg_temp.receiver_mapping(p_approved boolean DEFAULT true,p_other boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_array(jsonb_build_object('account_id',account_id,'entity_id',CASE WHEN p_other THEN second_entity_id ELSE entity_id END,'approved',p_approved)) FROM receiver_probe$$;
CREATE FUNCTION pg_temp.receiver_state(p_sequence text DEFAULT '9007199254740993') RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('version',1,'cursor',p_sequence,'replay_cursor','0','recovery_active',false,'authorization_checked_at','2999-01-01T00:00:00Z','source_as_of','2026-10-01T00:01:00Z','manifest',jsonb_build_array(jsonb_build_object('policy_id',policy_id,'release_id',release_id,'sequence',p_sequence)),'receipts',jsonb_build_object(release_id::text,jsonb_build_object('validator_version',1,'policy_id',policy_id,'sequence',p_sequence,'created_at','2026-10-01T00:00:00Z','hash',repeat('a',64),'snapshot',jsonb_build_object('schema_version',1,'policy_id',policy_id,'account_id',account_id,'policy_number','SYNTHETIC-GL','carrier','Synthetic carrier','line_of_business','CGL','named_insured','Synthetic insured','effective_date','2026-10-01','expiration_date','2027-10-01','premium',12500.25,'status','active'),'conflict',false,'quarantine',NULL,'needs_confirmation',false)),'recovery','{}'::jsonb,'health','healthy') FROM receiver_probe$$;
CREATE FUNCTION pg_temp.receiver_claim() RETURNS jsonb LANGUAGE sql AS $$SELECT public.insureflow_receiver_service('claim',jsonb_build_object('connection_id',connection_id,'organization_id',organization_id,'lease_token',gen_random_uuid(),'lease_seconds',60)) FROM receiver_probe$$;
CREATE FUNCTION pg_temp.receiver_fence(c jsonb,s jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('connection_id',c->>'id','organization_id',c->>'organization_id','lease_token',c->>'lease_token','config_generation',c->'config_generation','expected_revision',c->'revision','state',s)$$;
CREATE FUNCTION pg_temp.receiver_config(c jsonb,p_enabled boolean,m jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT public.insureflow_receiver_service('configure',jsonb_build_object('connection_id',c->>'id','organization_id',c->>'organization_id','actor_id',actor_id,'expected_revision',c->'revision','enabled',p_enabled,'ttl_seconds',60,'mappings',m)) FROM receiver_probe$$;
SELECT pg_temp.receiver_actor();
SET LOCAL ROLE service_role;
INSERT INTO receiver_values SELECT 'create_input',jsonb_build_object('id',connection_id,'organization_id',organization_id,'actor_id',actor_id,'name','Synthetic agency feed','provider_instance','synthetic:local','source_integration_id',integration_id,'ttl_seconds',60,'enabled',false,'mappings',pg_temp.receiver_mapping()) FROM receiver_probe;
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''create'',%L)',(SELECT value||'{"mode":"live"}'::jsonb FROM receiver_values WHERE name='create_input')),'Only synthetic');
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''create'',%L)',(SELECT value||jsonb_build_object('mappings',jsonb_build_array(jsonb_build_object('account_id',account_id,'entity_id',other_entity_id,'approved',true))) FROM receiver_values CROSS JOIN receiver_probe WHERE name='create_input')),'Mapping entity must be current');
INSERT INTO receiver_values SELECT 'connection',public.insureflow_receiver_service('create',value) FROM receiver_values WHERE name='create_input';
SELECT pg_temp.receiver_expect('SELECT pg_temp.receiver_claim()','disabled');
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''create'',%L)',(SELECT value||jsonb_build_object('id',gen_random_uuid()) FROM receiver_values WHERE name='create_input')),'duplicate key');
-- Same integration UUID in another explicit synthetic provider namespace is isolated.
INSERT INTO receiver_values SELECT 'other_instance',public.insureflow_receiver_service('create',value||jsonb_build_object('id',gen_random_uuid(),'provider_instance','synthetic:other')) FROM receiver_values WHERE name='create_input';
UPDATE receiver_values SET value=pg_temp.receiver_config(value,true,pg_temp.receiver_mapping()) WHERE name='connection';
UPDATE receiver_values SET value=pg_temp.receiver_claim() WHERE name='connection';
INSERT INTO receiver_values SELECT 'first_lease',value FROM receiver_values WHERE name='connection';
DO $$DECLARE c jsonb;r jsonb;BEGIN SELECT value INTO c FROM receiver_values WHERE name='connection';SELECT public.insureflow_receiver_service('claim',jsonb_build_object('connection_id',c->>'id','organization_id',c->>'organization_id','lease_token',c->>'lease_token','lease_seconds',120)) INTO r;IF r->'revision'<>c->'revision' OR r->'lease_expires_at'<>c->'lease_expires_at' THEN RAISE EXCEPTION 'Idempotent claim extended lease';END IF;END$$;
SELECT pg_temp.receiver_expect('SELECT pg_temp.receiver_claim()','already leased');
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''commit'',%L)',(SELECT pg_temp.receiver_fence(value,pg_temp.receiver_state())||jsonb_build_object('lease_token',gen_random_uuid()) FROM receiver_values WHERE name='connection')),'Stale');
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''commit'',%L)',(SELECT pg_temp.receiver_fence(value,pg_temp.receiver_state())||jsonb_build_object('expected_revision',(value->>'revision')::bigint-1) FROM receiver_values WHERE name='connection')),'Stale');
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''commit'',%L)',(SELECT pg_temp.receiver_fence(value,pg_temp.receiver_state())||jsonb_build_object('config_generation',(value->>'config_generation')::bigint-1) FROM receiver_values WHERE name='connection')),'Stale');
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''commit'',%L)',(SELECT pg_temp.receiver_fence(value,jsonb_set(pg_temp.receiver_state(),'{cursor}','9007199254740993')) FROM receiver_values WHERE name='connection')),'Invalid receiver cursor');
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''commit'',%L)',(SELECT pg_temp.receiver_fence(value,pg_temp.receiver_state()||jsonb_build_object('raw_secret',repeat('x',100))) FROM receiver_values WHERE name='connection')),'Invalid receiver state envelope');
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''commit'',%L)',(SELECT pg_temp.receiver_fence(value,pg_temp.receiver_state()||jsonb_build_object('raw_secret',repeat('x',8388609))) FROM receiver_values WHERE name='connection')),'Invalid receiver state envelope');
-- A simulated transaction failure rolls back state and cursor together.
DO $$DECLARE c jsonb;before jsonb;candidate jsonb;restored jsonb;rid text;BEGIN
 SELECT value INTO c FROM receiver_values WHERE name='connection';before:=c;SELECT release_id::text INTO rid FROM receiver_probe;
 candidate:=jsonb_set(jsonb_set(pg_temp.receiver_state(),ARRAY['receipts',rid,'snapshot'],'null'),ARRAY['receipts',rid,'quarantine'],'"synthetic_bad_body"')||jsonb_build_object('health','degraded','recovery',jsonb_build_object(rid,jsonb_build_object('policy_id',(SELECT policy_id FROM receiver_probe),'reason','synthetic_bad_body','attempts',0,'status','pending')));
 BEGIN PERFORM public.insureflow_receiver_service('commit',pg_temp.receiver_fence(c,candidate));RAISE EXCEPTION 'Synthetic rollback';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Synthetic rollback' THEN RAISE;END IF;END;
 restored:=public.insureflow_receiver_service('claim',jsonb_build_object('connection_id',c->>'id','organization_id',c->>'organization_id','lease_token',c->>'lease_token','lease_seconds',60));
 IF restored IS DISTINCT FROM before THEN RAISE EXCEPTION 'Rollback changed cursor, membership, quarantine, recovery or lease';END IF;
 c:=public.insureflow_receiver_service('commit',pg_temp.receiver_fence(restored,candidate));
 IF c->'state'->>'cursor'<>candidate->>'cursor' OR c->'state'->'manifest'<>candidate->'manifest' OR c->'state'->'receipts'<>candidate->'receipts' OR c->'state'->'recovery'<>candidate->'recovery' THEN RAISE EXCEPTION 'Retry did not commit complete quarantine transaction';END IF;
 c:=pg_temp.receiver_claim();c:=public.insureflow_receiver_service('commit',pg_temp.receiver_fence(c,candidate));
 IF (SELECT count(*) FROM jsonb_object_keys(c->'state'->'receipts'))<>1 OR (SELECT count(*) FROM jsonb_object_keys(c->'state'->'recovery'))<>1 THEN RAISE EXCEPTION 'Duplicate delivery duplicated receipt or recovery';END IF;
 UPDATE receiver_values SET value=c WHERE name='connection';
END$$;
UPDATE receiver_values SET value=pg_temp.receiver_claim() WHERE name='connection';
UPDATE receiver_values SET value=public.insureflow_receiver_service('commit',pg_temp.receiver_fence(value,pg_temp.receiver_state())) WHERE name='connection';
DO $$DECLARE c jsonb;BEGIN SELECT value INTO c FROM receiver_values WHERE name='connection';IF c->'state'->>'cursor'<>'9007199254740993' OR (c->'state'->>'authorization_checked_at')::timestamptz>clock_timestamp() THEN RAISE EXCEPTION 'Cursor lost precision or future worker time trusted';END IF;IF c->>'lease_token' IS NOT NULL THEN RAISE EXCEPTION 'Commit retained lease';END IF;END$$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.receiver_expect('SELECT public.insureflow_receiver_service(''claim'',''{}'')','permission denied');
DO $$DECLARE view jsonb;summary jsonb;BEGIN
 IF EXISTS(SELECT 1 FROM public.insureflow_receiver_connections) OR EXISTS(SELECT 1 FROM public.insureflow_receiver_audit) THEN RAISE EXCEPTION 'Raw receiver state/audit exposed';END IF;
 view:=public.insureflow_receiver_read('list',jsonb_build_object('connection_id',(SELECT connection_id FROM receiver_probe)));
 summary:=view->'connections'->0->'summaries'->0;
 IF view->'live_connection_enabled'<>'false'::jsonb OR jsonb_array_length(view->'connections'->0->'summaries')<>1 OR summary->>'source_sequence'<>'9007199254740993' OR summary->'summary'->>'premium'<>'12500.25' OR summary->'summary'?'account_id' OR summary?'hash' OR summary?'snapshot' THEN RAISE EXCEPTION 'Safe summary projection invalid';END IF;
END$$;
SELECT pg_temp.receiver_expect('SELECT public.insureflow_receiver_read(''list'',''{"organization_id":"00000000-0000-4000-8000-000000000000"}'')','Invalid receiver read command');
SELECT pg_temp.receiver_actor(true);
SELECT pg_temp.receiver_expect('SELECT public.insureflow_receiver_read(''list'',''{}'')','manager access');
SELECT pg_temp.receiver_actor();
RESET ROLE;
-- Read-time TTL hides data without requiring another poll or browser timer.
UPDATE public.insureflow_receiver_connections SET state=jsonb_set(state,'{authorization_checked_at}',to_jsonb(clock_timestamp()-interval '61 seconds')) WHERE id=(SELECT connection_id FROM receiver_probe);
SET LOCAL ROLE authenticated;
DO $$DECLARE v jsonb;BEGIN v:=public.insureflow_receiver_read('list',jsonb_build_object('connection_id',(SELECT connection_id FROM receiver_probe)));IF v->'connections'->0->>'state'<>'unavailable' OR v->'connections'->0->'summaries'<>'[]'::jsonb THEN RAISE EXCEPTION 'TTL failed closed';END IF;END$$;
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE receiver_values SET value=pg_temp.receiver_claim() WHERE name='connection';
UPDATE receiver_values SET value=public.insureflow_receiver_service('commit',pg_temp.receiver_fence(value,pg_temp.receiver_state())) WHERE name='connection';
-- Failed transport cannot advance cursor or replace authorization membership.
UPDATE receiver_values SET value=pg_temp.receiver_claim() WHERE name='connection';
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''fail'',%L)',(SELECT pg_temp.receiver_fence(value,jsonb_set(value->'state','{cursor}','"9007199254740994"'))||'{"error_code":"transport_error"}'::jsonb FROM receiver_values WHERE name='connection')),'Failed transport must preserve');
UPDATE receiver_values SET value=public.insureflow_receiver_service('fail',pg_temp.receiver_fence(value,value->'state')||'{"error_code":"transport_error"}'::jsonb) WHERE name='connection';
-- Mapping/config changes fence delayed successes and delayed credential failures.
UPDATE receiver_values SET value=pg_temp.receiver_claim() WHERE name='connection';
INSERT INTO receiver_values SELECT 'old_mapping_lease',value FROM receiver_values WHERE name='connection';
UPDATE receiver_values SET value=pg_temp.receiver_config(value,true,pg_temp.receiver_mapping(true,true)) WHERE name='connection';
DO $$DECLARE c jsonb;BEGIN SELECT value INTO c FROM receiver_values WHERE name='connection';IF c->'state'->'authorization_checked_at'<>'null'::jsonb OR EXISTS(SELECT 1 FROM jsonb_each(c->'state'->'receipts') r WHERE r.value->'snapshot'<>'null'::jsonb) THEN RAISE EXCEPTION 'Remapping reused cached summary';END IF;END$$;
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''fail'',%L)',(SELECT pg_temp.receiver_fence(value,value->'state'||'{"health":"credential_rejected","authorization_checked_at":null}'::jsonb)||'{"error_code":"http_401"}'::jsonb FROM receiver_values WHERE name='old_mapping_lease')),'Stale');
-- Replayed valid body stays hidden until a fresh normal confirmation is committed.
UPDATE receiver_values SET value=pg_temp.receiver_claim() WHERE name='connection';
UPDATE receiver_values SET value=public.insureflow_receiver_service('commit',pg_temp.receiver_fence(value,jsonb_set(pg_temp.receiver_state(),ARRAY['receipts',(SELECT release_id::text FROM receiver_probe),'needs_confirmation'],'true')||jsonb_build_object('recovery',jsonb_build_object((SELECT release_id::text FROM receiver_probe),jsonb_build_object('policy_id',(SELECT policy_id FROM receiver_probe),'reason','mapping_changed','attempts',1,'status','awaiting_confirmation'))))) WHERE name='connection';
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$DECLARE v jsonb;BEGIN v:=public.insureflow_receiver_read('list',jsonb_build_object('connection_id',(SELECT connection_id FROM receiver_probe)));IF v->'connections'->0->'summaries'<>'[]'::jsonb THEN RAISE EXCEPTION 'Recovery body published before fresh confirmation';END IF;END$$;
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE receiver_values SET value=pg_temp.receiver_claim() WHERE name='connection';
UPDATE receiver_values SET value=public.insureflow_receiver_service('commit',pg_temp.receiver_fence(value,pg_temp.receiver_state())) WHERE name='connection';
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$DECLARE v jsonb;BEGIN v:=public.insureflow_receiver_read('list',jsonb_build_object('connection_id',(SELECT connection_id FROM receiver_probe)));IF v->'connections'->0->'summaries'->0->>'mapped_entity_id'<>(SELECT second_entity_id::text FROM receiver_probe) THEN RAISE EXCEPTION 'Fresh summary did not use explicit new mapping';END IF;END$$;
RESET ROLE;
UPDATE public.entities SET deleted_at=now() WHERE id=(SELECT second_entity_id FROM receiver_probe);
SET LOCAL ROLE authenticated;
DO $$DECLARE v jsonb;BEGIN v:=public.insureflow_receiver_read('list',jsonb_build_object('connection_id',(SELECT connection_id FROM receiver_probe)));IF v->'connections'->0->'summaries'<>'[]'::jsonb THEN RAISE EXCEPTION 'Deleted mapped entity remained eligible';END IF;END$$;
RESET ROLE;
UPDATE public.entities SET deleted_at=NULL WHERE id=(SELECT second_entity_id FROM receiver_probe);
SET LOCAL ROLE service_role;
UPDATE receiver_values SET value=pg_temp.receiver_claim() WHERE name='connection';
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''commit'',%L)',(SELECT pg_temp.receiver_fence(value,jsonb_set(pg_temp.receiver_state(),ARRAY['receipts',(SELECT release_id::text FROM receiver_probe),'hash'],to_jsonb(repeat('b',64)))) FROM receiver_values WHERE name='connection')),'Immutable first receipt');
-- Withdrawal/redaction clears body without changing first hash, and commits atomically.
UPDATE receiver_values SET value=public.insureflow_receiver_service('commit',pg_temp.receiver_fence(value,jsonb_set(pg_temp.receiver_state(),ARRAY['receipts',(SELECT release_id::text FROM receiver_probe),'snapshot'],'null')||'{"manifest":[]}'::jsonb)) WHERE name='connection';
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$DECLARE v jsonb;BEGIN v:=public.insureflow_receiver_read('list',jsonb_build_object('connection_id',(SELECT connection_id FROM receiver_probe)));IF v->'connections'->0->'summaries'<>'[]'::jsonb THEN RAISE EXCEPTION 'Withdrawn body displayed';END IF;END$$;
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE receiver_values SET value=pg_temp.receiver_claim() WHERE name='connection';
RESET ROLE;
UPDATE public.insureflow_receiver_connections SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=(SELECT connection_id FROM receiver_probe);
SET LOCAL ROLE service_role;
SELECT pg_temp.receiver_expect(format('SELECT public.insureflow_receiver_service(''commit'',%L)',(SELECT pg_temp.receiver_fence(value,pg_temp.receiver_state()) FROM receiver_values WHERE name='connection')),'expired receiver lease');
UPDATE receiver_values SET value=pg_temp.receiver_claim() WHERE name='connection';
UPDATE receiver_values SET value=public.insureflow_receiver_service('fail',pg_temp.receiver_fence(value,value->'state'||'{"health":"credential_rejected","authorization_checked_at":null}'::jsonb)||'{"error_code":"http_401"}'::jsonb) WHERE name='connection';
SELECT pg_temp.receiver_expect('SELECT pg_temp.receiver_claim()','credential configuration required');
UPDATE receiver_values SET value=pg_temp.receiver_config(value,true,pg_temp.receiver_mapping()) WHERE name='connection';
DO $$BEGIN IF (SELECT value->'state'->>'health' FROM receiver_values WHERE name='connection')<>'never_synced' THEN RAISE EXCEPTION 'Credential resolution did not reset health';END IF;END$$;
RESET ROLE;
-- Explicit mapping approvals remain reconstructable after later configuration.
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.insureflow_receiver_audit WHERE connection_id=(SELECT connection_id FROM receiver_probe) AND action='create' AND configuration->'mappings'->0->>'entity_id'=(SELECT entity_id::text FROM receiver_probe)) OR NOT EXISTS(SELECT 1 FROM public.insureflow_receiver_audit WHERE connection_id=(SELECT connection_id FROM receiver_probe) AND action='configure' AND configuration->'mappings'->0->>'entity_id'=(SELECT second_entity_id::text FROM receiver_probe)) THEN RAISE EXCEPTION 'Mapping approval history was overwritten or omitted';END IF;
 IF EXISTS(SELECT 1 FROM public.insureflow_receiver_audit WHERE configuration?'state' OR configuration?'receipts' OR (action NOT IN('create','configure') AND configuration IS NOT NULL)) THEN RAISE EXCEPTION 'Raw payload crossed safe configuration audit';END IF;
END$$;
SELECT pg_temp.receiver_expect('UPDATE public.insureflow_receiver_audit SET configuration=''{}'' WHERE action=''create''','Approved insurance history is immutable');
-- Entire receiver remains isolated from operational insurance and generic audit.
DO $$DECLARE org uuid;BEGIN SELECT organization_id INTO org FROM receiver_probe;IF EXISTS(SELECT 1 FROM public.insurance_policies WHERE organization_id=org) OR EXISTS(SELECT 1 FROM public.insurance_claims WHERE organization_id=org) OR EXISTS(SELECT 1 FROM public.insurance_documents WHERE organization_id=org) OR EXISTS(SELECT 1 FROM public.audit_log WHERE table_name LIKE 'insureflow_receiver%') THEN RAISE EXCEPTION 'Receiver crossed core or raw audit boundary';END IF;END$$;
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT actor_id FROM receiver_probe);
SET LOCAL ROLE authenticated;
SELECT pg_temp.receiver_expect('SELECT public.insureflow_receiver_read(''list'',''{}'')','Authentication required');
RESET ROLE;
ROLLBACK;
