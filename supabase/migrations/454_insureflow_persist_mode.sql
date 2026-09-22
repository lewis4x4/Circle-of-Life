-- COL-546 follow-up: make the mode a caller can ask for actually stick.
--
-- 453 opened the mode CHECK to {synthetic, live}, opened the provider_instance
-- pattern, and taught every guard to accept both. It validated a `mode` key on
-- create. What it did not do is PERSIST it: the INSERT inherited from 448 never
-- listed the mode column, so the column default won and every connection came
-- back synthetic no matter what was asked for.
--
-- Found by doing the activation rather than by reading the diff. Creating the
-- production connection with 'mode','live' returned "mode": "synthetic", which
-- is exactly the kind of thing that looks fine in review and is inert in fact.
--
-- Mode is set at create and never after. It is part of a connection's identity
-- in the same way provider_instance and source_integration_id are, both of which
-- configure already refuses to change — switching a live connection to synthetic
-- mid-life would silently strand its cursor against a different provider.

BEGIN;

CREATE OR REPLACE FUNCTION haven.insureflow_receiver_service_impl(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.insureflow_receiver_connections;org uuid;actor uuid;id_value uuid;s jsonb;k text;r jsonb;old_r jsonb;x jsonb;received jsonb;token uuid;seconds integer;changed boolean;stamp timestamptz;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Receiver payload object required' USING ERRCODE='22023';END IF;
 org:=(p_payload->>'organization_id')::uuid;
 id_value:=coalesce((p_payload->>'connection_id')::uuid,(p_payload->>'id')::uuid);
 IF org IS NULL OR id_value IS NULL THEN RAISE EXCEPTION 'Connection and organization identity required' USING ERRCODE='22023';END IF;
 IF p_action='create' THEN
 actor:=(p_payload->>'actor_id')::uuid;
 IF p_payload->>'mode' IS NOT NULL AND p_payload->>'mode' NOT IN('synthetic','live') THEN RAISE EXCEPTION 'Receiver mode must be synthetic or live' USING ERRCODE='22023';END IF;
 IF coalesce(p_payload->'enabled','false'::jsonb)<>'false'::jsonb THEN RAISE EXCEPTION 'Create disabled; configure synthetic reading explicitly' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(p_payload->'ttl_seconds') IS DISTINCT FROM 'number' OR (p_payload->>'ttl_seconds')!~'^[1-9][0-9]*$' OR (p_payload->>'ttl_seconds')::numeric>86400 THEN RAISE EXCEPTION 'Explicit freshness TTL 1..86400 required' USING ERRCODE='22023';END IF;
 PERFORM haven.insureflow_validate_mappings(p_payload->'mappings',org);
 PERFORM pg_advisory_xact_lock(hashtextextended(id_value::text,338));
 PERFORM haven.insurance_lock_processing_actor(actor,org);
 INSERT INTO public.insureflow_receiver_connections(id,organization_id,name,provider_instance,source_integration_id,mode,ttl_seconds,mappings,created_by,updated_by)
 VALUES(id_value,org,p_payload->>'name',p_payload->>'provider_instance',(p_payload->>'source_integration_id')::uuid,coalesce(p_payload->>'mode','synthetic'),(p_payload->>'ttl_seconds')::integer,p_payload->'mappings',actor,actor);
 SELECT * INTO c FROM public.insureflow_receiver_connections WHERE id=id_value;
 ELSIF p_action IN('configure','claim','commit','fail') THEN
 SELECT * INTO c FROM public.insureflow_receiver_connections WHERE id=id_value AND organization_id=org FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Receiver connection not found' USING ERRCODE='P0002';END IF;
 IF p_action='configure' THEN
 actor:=(p_payload->>'actor_id')::uuid;
 IF (p_payload->>'expected_revision')::bigint IS DISTINCT FROM c.revision THEN RAISE EXCEPTION 'Stale receiver configuration revision' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_payload->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_payload->'ttl_seconds') IS DISTINCT FROM 'number' OR (p_payload->>'ttl_seconds')!~'^[1-9][0-9]*$' OR (p_payload->>'ttl_seconds')::numeric>86400 OR (p_payload?'mode' AND p_payload->>'mode' NOT IN('synthetic','live')) OR p_payload?'source_integration_id' OR p_payload?'provider_instance' THEN RAISE EXCEPTION 'Invalid synthetic configuration or identity change' USING ERRCODE='22023';END IF;
 PERFORM haven.insureflow_validate_mappings(p_payload->'mappings',org);
 PERFORM haven.insurance_lock_processing_actor(actor,org);
 s:=c.state;changed:=c.mappings IS DISTINCT FROM p_payload->'mappings';
 s:=jsonb_set(jsonb_set(s,'{authorization_checked_at}','null'),'{health}','"never_synced"');
 IF changed THEN
 s:=jsonb_set(s,'{receipts}',coalesce((SELECT jsonb_object_agg(key,value||'{"snapshot":null,"needs_confirmation":true}'::jsonb) FROM jsonb_each(s->'receipts')),'{}'));
 s:=jsonb_set(s,'{recovery}',coalesce((SELECT jsonb_object_agg(value->>'release_id',jsonb_build_object('policy_id',value->>'policy_id','reason','mapping_changed','attempts',0,'status','pending')) FROM jsonb_array_elements(s->'manifest')),'{}'));
 s:=jsonb_set(jsonb_set(s,'{replay_cursor}','"0"'),'{recovery_active}',to_jsonb(jsonb_array_length(s->'manifest')>0));
 END IF;
 UPDATE public.insureflow_receiver_connections SET enabled=(p_payload->>'enabled')::boolean,ttl_seconds=(p_payload->>'ttl_seconds')::integer,mappings=p_payload->'mappings',state=s,config_generation=config_generation+1,revision=revision+1,lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_by=actor,updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
 ELSIF p_action='claim' THEN
 IF NOT c.enabled OR c.mode NOT IN('synthetic','live') OR c.state->>'health'='credential_rejected' THEN RAISE EXCEPTION 'Receiver disabled or credential configuration required' USING ERRCODE='40001';END IF;
 token:=(p_payload->>'lease_token')::uuid;
 IF token IS NULL OR jsonb_typeof(p_payload->'lease_seconds') IS DISTINCT FROM 'number' OR (p_payload->>'lease_seconds')!~'^[1-9][0-9]*$' OR (p_payload->>'lease_seconds')::numeric>120 THEN RAISE EXCEPTION 'Lease token and bounded 1..120 second lease required' USING ERRCODE='22023';END IF;
 seconds:=(p_payload->>'lease_seconds')::integer;
 IF c.lease_token IS NOT NULL AND c.lease_expires_at>clock_timestamp() THEN
 IF c.lease_token=token THEN RETURN to_jsonb(c);END IF;
 RAISE EXCEPTION 'Receiver connection already leased' USING ERRCODE='40001';END IF;
 UPDATE public.insureflow_receiver_connections SET lease_token=token,lease_expires_at=clock_timestamp()+make_interval(secs=>seconds),revision=revision+1,updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
 ELSE
 token:=(p_payload->>'lease_token')::uuid;
 IF NOT c.enabled OR c.mode NOT IN('synthetic','live') OR token IS NULL OR c.lease_token IS DISTINCT FROM token OR (p_payload->>'config_generation')::bigint IS DISTINCT FROM c.config_generation OR (p_payload->>'expected_revision')::bigint IS DISTINCT FROM c.revision OR c.lease_expires_at IS NULL OR c.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Stale, replaced, disabled or expired receiver lease' USING ERRCODE='40001';END IF;
 s:=p_payload->'state';PERFORM haven.insureflow_validate_state(s);
 IF p_action='fail' THEN
 IF p_payload->>'error_code' IS NULL OR length(p_payload->>'error_code')>80 OR (p_payload->>'error_code')!~'^[a-z0-9_]+$' THEN RAISE EXCEPTION 'Safe failure code required' USING ERRCODE='22023';END IF;
 IF p_payload->>'error_code' IN('http_401','credential_rejected') THEN
 IF s IS DISTINCT FROM (c.state||'{"health":"credential_rejected","authorization_checked_at":null}'::jsonb) THEN RAISE EXCEPTION 'Credential failure may only revoke health and freshness' USING ERRCODE='22023';END IF;
 ELSE
 IF s IS DISTINCT FROM c.state THEN RAISE EXCEPTION 'Failed transport must preserve state and cursor' USING ERRCODE='22023';END IF;
 END IF;
 ELSE
 IF (s->>'cursor')::numeric<(c.state->>'cursor')::numeric THEN RAISE EXCEPTION 'Normal receiver cursor cannot regress' USING ERRCODE='22023';END IF;
 IF s->>'health' NOT IN('healthy','degraded') OR s->'source_as_of'='null'::jsonb THEN RAISE EXCEPTION 'Commit requires accepted complete page controls' USING ERRCODE='22023';END IF;
 FOR k,old_r IN SELECT key,value FROM jsonb_each(c.state->'receipts') LOOP
 r:=s->'receipts'->k;
 IF r IS NULL OR r->>'policy_id' IS DISTINCT FROM old_r->>'policy_id' OR r->>'sequence' IS DISTINCT FROM old_r->>'sequence' OR r->>'created_at' IS DISTINCT FROM old_r->>'created_at' OR (old_r->'hash'<>'null'::jsonb AND r->'hash' IS DISTINCT FROM old_r->'hash') OR (old_r->'conflict'='true'::jsonb AND r->'conflict'<>'true'::jsonb) THEN RAISE EXCEPTION 'Immutable first receipt identity, hash or conflict changed' USING ERRCODE='22023';END IF;
 IF old_r->'snapshot'<>'null'::jsonb AND r->'snapshot'<>'null'::jsonb AND old_r->'snapshot' IS DISTINCT FROM r->'snapshot' THEN RAISE EXCEPTION 'Immutable released summary body changed' USING ERRCODE='22023';END IF;
 END LOOP;
 stamp:=clock_timestamp();s:=jsonb_set(s,'{authorization_checked_at}',to_jsonb(stamp));
 END IF;
 received:=c.receipt_received_at;
 IF p_action='commit' THEN
 FOR k,r IN SELECT key,value FROM jsonb_each(s->'receipts') LOOP
 IF r->'snapshot'<>'null'::jsonb AND NOT received?k THEN received:=received||jsonb_build_object(k,clock_timestamp());END IF;
 END LOOP;
 END IF;
 IF c.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Expired receiver lease after validation' USING ERRCODE='40001';END IF;
 UPDATE public.insureflow_receiver_connections SET state=s,receipt_received_at=received,revision=revision+1,lease_token=NULL,lease_expires_at=NULL,last_error_code=CASE WHEN p_action='fail' THEN p_payload->>'error_code' ELSE NULL END,updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
 END IF;
 ELSE RAISE EXCEPTION 'Unknown receiver service command' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.insureflow_receiver_audit(organization_id,connection_id,action,revision,config_generation,actor_id,configuration) VALUES(c.organization_id,c.id,p_action,c.revision,c.config_generation,actor,CASE WHEN p_action IN('create','configure') THEN jsonb_build_object('provider_instance',c.provider_instance,'source_integration_id',c.source_integration_id,'mappings',c.mappings,'ttl_seconds',c.ttl_seconds,'enabled',c.enabled) ELSE NULL END);
 RETURN to_jsonb(c);
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
