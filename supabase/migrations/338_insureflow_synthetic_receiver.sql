-- Isolated synthetic summary receiver. No rows enter the policy/claims/finance
-- stores and no live integration mode, endpoint, credentials, or token is stored.
CREATE FUNCTION haven.insureflow_empty_state() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"version":1,"cursor":"0","replay_cursor":"0","recovery_active":false,"authorization_checked_at":null,"source_as_of":null,"manifest":[],"receipts":{},"recovery":{},"health":"never_synced"}'::jsonb;
$$;
CREATE TABLE public.insureflow_receiver_connections(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 provider_instance text NOT NULL CHECK(provider_instance~'^synthetic:[a-z0-9][a-z0-9_-]{0,63}$'),
 source_integration_id uuid NOT NULL,mode text NOT NULL DEFAULT 'synthetic' CHECK(mode='synthetic'),
 enabled boolean NOT NULL DEFAULT false,ttl_seconds integer NOT NULL CHECK(ttl_seconds BETWEEN 1 AND 86400),
 mappings jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(mappings)='array'),
 state jsonb NOT NULL DEFAULT haven.insureflow_empty_state() CHECK(jsonb_typeof(state)='object' AND octet_length(state::text)<=8388608),
 receipt_received_at jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(receipt_received_at)='object'),
 config_generation bigint NOT NULL DEFAULT 1 CHECK(config_generation BETWEEN 1 AND 9007199254740991),revision bigint NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),
 lease_token uuid,lease_expires_at timestamptz,last_error_code text,
 created_by uuid NOT NULL REFERENCES auth.users(id),updated_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,provider_instance,source_integration_id),
 CHECK((lease_token IS NULL)=(lease_expires_at IS NULL))
);
ALTER TABLE public.insureflow_receiver_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.insureflow_receiver_connections FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX ON public.insureflow_receiver_connections(organization_id,id);
-- Audits intentionally contain operational metadata only. Raw bodies never
-- enter the generic audit, search, documents, AI, export, or insurance history.
CREATE TABLE public.insureflow_receiver_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),
 connection_id uuid NOT NULL REFERENCES public.insureflow_receiver_connections(id),action text NOT NULL,
 revision bigint NOT NULL,config_generation bigint NOT NULL,actor_id uuid REFERENCES auth.users(id),
 configuration jsonb CHECK(configuration IS NULL OR jsonb_typeof(configuration)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.insureflow_receiver_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.insureflow_receiver_audit FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX ON public.insureflow_receiver_audit(connection_id,created_at);
CREATE TRIGGER insureflow_receiver_audit_immutable BEFORE UPDATE OR DELETE ON public.insureflow_receiver_audit FOR EACH ROW EXECUTE FUNCTION haven.insurance_immutable_version();
CREATE FUNCTION haven.insureflow_decimal(p text,p_zero boolean DEFAULT true) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 RETURN p IS NOT NULL AND p~'^(0|[1-9][0-9]{0,18})$' AND p::numeric<=9223372036854775807 AND (p_zero OR p::numeric>0);
EXCEPTION WHEN OTHERS THEN RETURN false;END $$;
CREATE FUNCTION haven.insureflow_snapshot_valid(p jsonb,p_policy uuid) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;d date;v uuid;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>11 OR p->'schema_version' IS DISTINCT FROM '1'::jsonb THEN RETURN false;END IF;
 IF NOT p ?& ARRAY['schema_version','policy_id','account_id','policy_number','carrier','line_of_business','named_insured','effective_date','expiration_date','premium','status'] THEN RETURN false;END IF;
 IF jsonb_typeof(p->'policy_id') IS DISTINCT FROM 'string' OR (p->>'policy_id')::uuid IS DISTINCT FROM p_policy OR jsonb_typeof(p->'account_id') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 v:=(p->>'account_id')::uuid;
 IF jsonb_typeof(p->'policy_number') IS DISTINCT FROM 'string' OR length(p->>'policy_number')>4096 THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['carrier','line_of_business','named_insured','status'] LOOP
 IF p->k<>'null'::jsonb AND (jsonb_typeof(p->k)<>'string' OR length(p->>k)>4096) THEN RETURN false;END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['effective_date','expiration_date'] LOOP
 IF p->k<>'null'::jsonb THEN
 IF jsonb_typeof(p->k)<>'string' OR (p->>k)!~'^\d{4}-\d{2}-\d{2}$' THEN RETURN false;END IF;d:=(p->>k)::date;
 END IF;
 END LOOP;
 IF p->'premium'<>'null'::jsonb AND (jsonb_typeof(p->'premium')<>'number' OR abs((p->>'premium')::numeric)>1.7976931348623157e308::numeric) THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION haven.insureflow_validate_state(p jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE k text;x jsonb;r jsonb;v uuid;t timestamptz;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>8388608 OR (SELECT count(*) FROM jsonb_object_keys(p))<>10 OR NOT p ?& ARRAY['version','cursor','replay_cursor','recovery_active','authorization_checked_at','source_as_of','manifest','receipts','recovery','health'] OR p->'version' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'Invalid receiver state envelope or size' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(p->'cursor') IS DISTINCT FROM 'string' OR NOT haven.insureflow_decimal(p->>'cursor') OR jsonb_typeof(p->'replay_cursor') IS DISTINCT FROM 'string' OR NOT haven.insureflow_decimal(p->>'replay_cursor') OR jsonb_typeof(p->'recovery_active') IS DISTINCT FROM 'boolean' OR p->>'health' NOT IN('never_synced','healthy','degraded','credential_rejected') OR p->>'health' IS NULL THEN RAISE EXCEPTION 'Invalid receiver cursor or health' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['authorization_checked_at','source_as_of'] LOOP IF p->k<>'null'::jsonb THEN IF jsonb_typeof(p->k)<>'string' OR length(p->>k)>64 THEN RAISE EXCEPTION 'Invalid receiver timestamp' USING ERRCODE='22023';END IF;t:=(p->>k)::timestamptz;IF NOT isfinite(t) THEN RAISE EXCEPTION 'Invalid receiver timestamp' USING ERRCODE='22023';END IF;END IF;END LOOP;
 IF jsonb_typeof(p->'manifest') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'manifest')>10000 OR jsonb_typeof(p->'receipts') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p->'receipts'))>10000 OR jsonb_typeof(p->'recovery') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p->'recovery'))>10000 THEN RAISE EXCEPTION 'Receiver collection bound exceeded' USING ERRCODE='22023';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p->'manifest') LOOP
 IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(x))<>3 OR NOT x ?& ARRAY['policy_id','release_id','sequence'] OR jsonb_typeof(x->'sequence') IS DISTINCT FROM 'string' OR NOT haven.insureflow_decimal(x->>'sequence',false) THEN RAISE EXCEPTION 'Invalid receiver manifest entry' USING ERRCODE='22023';END IF;
 v:=(x->>'policy_id')::uuid;IF v IS NULL THEN RAISE EXCEPTION 'Manifest policy required' USING ERRCODE='22023';END IF;
 v:=(x->>'release_id')::uuid;IF v IS NULL THEN RAISE EXCEPTION 'Manifest release required' USING ERRCODE='22023';END IF;
 END LOOP;
 IF EXISTS(SELECT (value->>'policy_id')::uuid FROM jsonb_array_elements(p->'manifest') GROUP BY (value->>'policy_id')::uuid HAVING count(*)>1) OR EXISTS(SELECT (value->>'release_id')::uuid FROM jsonb_array_elements(p->'manifest') GROUP BY (value->>'release_id')::uuid HAVING count(*)>1) OR EXISTS(SELECT value->>'sequence' FROM jsonb_array_elements(p->'manifest') GROUP BY value->>'sequence' HAVING count(*)>1) THEN RAISE EXCEPTION 'Conflicting receiver manifest' USING ERRCODE='22023';END IF;
 FOR k,r IN SELECT key,value FROM jsonb_each(p->'receipts') LOOP
 v:=k::uuid;
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r))<>9 OR r->'validator_version' IS DISTINCT FROM '1'::jsonb OR NOT r ?& ARRAY['validator_version','policy_id','sequence','created_at','hash','snapshot','conflict','quarantine','needs_confirmation'] OR jsonb_typeof(r->'sequence') IS DISTINCT FROM 'string' OR NOT haven.insureflow_decimal(r->>'sequence',false) OR jsonb_typeof(r->'conflict') IS DISTINCT FROM 'boolean' OR jsonb_typeof(r->'needs_confirmation') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid receiver receipt' USING ERRCODE='22023';END IF;
 v:=(r->>'policy_id')::uuid;IF v IS NULL THEN RAISE EXCEPTION 'Receipt policy required' USING ERRCODE='22023';END IF;
 t:=(r->>'created_at')::timestamptz;IF t IS NULL OR NOT isfinite(t) OR jsonb_typeof(r->'created_at') IS DISTINCT FROM 'string' OR length(r->>'created_at')>64 THEN RAISE EXCEPTION 'Invalid receipt timestamp' USING ERRCODE='22023';END IF;
 IF r->'hash'<>'null'::jsonb AND (jsonb_typeof(r->'hash')<>'string' OR (r->>'hash')!~'^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'Invalid receipt hash' USING ERRCODE='22023';END IF;
 IF r->'quarantine'<>'null'::jsonb AND (jsonb_typeof(r->'quarantine')<>'string' OR length(r->>'quarantine')>160 OR (r->>'quarantine')!~'^[a-zA-Z0-9_.:-]+$') THEN RAISE EXCEPTION 'Safe quarantine code required' USING ERRCODE='22023';END IF;
 IF r->'snapshot'<>'null'::jsonb AND (r->'hash'='null'::jsonb OR NOT haven.insureflow_snapshot_valid(r->'snapshot',v)) THEN RAISE EXCEPTION 'Only validated summary bodies may be retained' USING ERRCODE='22023';END IF;
 END LOOP;
 IF EXISTS(SELECT key::uuid FROM jsonb_each(p->'receipts') GROUP BY key::uuid HAVING count(*)>1) OR EXISTS(SELECT value->>'sequence' FROM jsonb_each(p->'receipts') GROUP BY value->>'sequence' HAVING count(*)>1) THEN RAISE EXCEPTION 'Conflicting receipt identity or sequence' USING ERRCODE='22023';END IF;
 FOR k,r IN SELECT key,value FROM jsonb_each(p->'recovery') LOOP
 v:=k::uuid;
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r))<>4 OR NOT r ?& ARRAY['policy_id','reason','attempts','status'] OR r->>'status' NOT IN('pending','awaiting_confirmation','resolved','exhausted') OR r->>'status' IS NULL OR jsonb_typeof(r->'attempts') IS DISTINCT FROM 'number' OR (r->>'attempts')!~'^(0|[1-9][0-9]?)$' OR jsonb_typeof(r->'reason') IS DISTINCT FROM 'string' OR length(r->>'reason')>160 OR (r->>'reason')!~'^[a-zA-Z0-9_.:-]+$' THEN RAISE EXCEPTION 'Invalid bounded recovery metadata' USING ERRCODE='22023';END IF;
 v:=(r->>'policy_id')::uuid;IF v IS NULL THEN RAISE EXCEPTION 'Recovery policy required' USING ERRCODE='22023';END IF;
 END LOOP;
END $$;
CREATE FUNCTION haven.insureflow_validate_mappings(p jsonb,p_org uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x jsonb;v uuid;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'array' OR jsonb_array_length(p)>1000 THEN RAISE EXCEPTION 'Explicit bounded account mapping required' USING ERRCODE='22023';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p) LOOP
 IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(x))<>3 OR NOT x ?& ARRAY['account_id','entity_id','approved'] OR jsonb_typeof(x->'approved') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid account mapping' USING ERRCODE='22023';END IF;
 v:=(x->>'account_id')::uuid;IF v IS NULL THEN RAISE EXCEPTION 'Source account required' USING ERRCODE='22023';END IF;
 v:=(x->>'entity_id')::uuid;
 PERFORM 1 FROM public.entities WHERE id=v AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mapping entity must be current in this organization' USING ERRCODE='22023';END IF;
 END LOOP;
 IF EXISTS(SELECT (value->>'account_id')::uuid FROM jsonb_array_elements(p) GROUP BY (value->>'account_id')::uuid HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate source account mapping' USING ERRCODE='22023';END IF;
END $$;
CREATE FUNCTION haven.insureflow_receiver_service_impl(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.insureflow_receiver_connections;org uuid;actor uuid;id_value uuid;s jsonb;k text;r jsonb;old_r jsonb;x jsonb;received jsonb;token uuid;seconds integer;changed boolean;stamp timestamptz;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Receiver payload object required' USING ERRCODE='22023';END IF;
 org:=(p_payload->>'organization_id')::uuid;
 id_value:=coalesce((p_payload->>'connection_id')::uuid,(p_payload->>'id')::uuid);
 IF org IS NULL OR id_value IS NULL THEN RAISE EXCEPTION 'Connection and organization identity required' USING ERRCODE='22023';END IF;
 IF p_action='create' THEN
 actor:=(p_payload->>'actor_id')::uuid;
 IF p_payload->>'mode' IS NOT NULL AND p_payload->>'mode'<>'synthetic' THEN RAISE EXCEPTION 'Only synthetic receiver mode exists' USING ERRCODE='22023';END IF;
 IF coalesce(p_payload->'enabled','false'::jsonb)<>'false'::jsonb THEN RAISE EXCEPTION 'Create disabled; configure synthetic reading explicitly' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(p_payload->'ttl_seconds') IS DISTINCT FROM 'number' OR (p_payload->>'ttl_seconds')!~'^[1-9][0-9]*$' OR (p_payload->>'ttl_seconds')::numeric>86400 THEN RAISE EXCEPTION 'Explicit freshness TTL 1..86400 required' USING ERRCODE='22023';END IF;
 PERFORM haven.insureflow_validate_mappings(p_payload->'mappings',org);
 PERFORM pg_advisory_xact_lock(hashtextextended(id_value::text,338));
 PERFORM haven.insurance_lock_processing_actor(actor,org);
 INSERT INTO public.insureflow_receiver_connections(id,organization_id,name,provider_instance,source_integration_id,ttl_seconds,mappings,created_by,updated_by)
 VALUES(id_value,org,p_payload->>'name',p_payload->>'provider_instance',(p_payload->>'source_integration_id')::uuid,(p_payload->>'ttl_seconds')::integer,p_payload->'mappings',actor,actor);
 SELECT * INTO c FROM public.insureflow_receiver_connections WHERE id=id_value;
 ELSIF p_action IN('configure','claim','commit','fail') THEN
 SELECT * INTO c FROM public.insureflow_receiver_connections WHERE id=id_value AND organization_id=org FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Receiver connection not found' USING ERRCODE='P0002';END IF;
 IF p_action='configure' THEN
 actor:=(p_payload->>'actor_id')::uuid;
 IF (p_payload->>'expected_revision')::bigint IS DISTINCT FROM c.revision THEN RAISE EXCEPTION 'Stale receiver configuration revision' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_payload->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_payload->'ttl_seconds') IS DISTINCT FROM 'number' OR (p_payload->>'ttl_seconds')!~'^[1-9][0-9]*$' OR (p_payload->>'ttl_seconds')::numeric>86400 OR (p_payload?'mode' AND p_payload->>'mode'<>'synthetic') OR p_payload?'source_integration_id' OR p_payload?'provider_instance' THEN RAISE EXCEPTION 'Invalid synthetic configuration or identity change' USING ERRCODE='22023';END IF;
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
 IF NOT c.enabled OR c.mode<>'synthetic' OR c.state->>'health'='credential_rejected' THEN RAISE EXCEPTION 'Receiver disabled or credential configuration required' USING ERRCODE='40001';END IF;
 token:=(p_payload->>'lease_token')::uuid;
 IF token IS NULL OR jsonb_typeof(p_payload->'lease_seconds') IS DISTINCT FROM 'number' OR (p_payload->>'lease_seconds')!~'^[1-9][0-9]*$' OR (p_payload->>'lease_seconds')::numeric>120 THEN RAISE EXCEPTION 'Lease token and bounded 1..120 second lease required' USING ERRCODE='22023';END IF;
 seconds:=(p_payload->>'lease_seconds')::integer;
 IF c.lease_token IS NOT NULL AND c.lease_expires_at>clock_timestamp() THEN
 IF c.lease_token=token THEN RETURN to_jsonb(c);END IF;
 RAISE EXCEPTION 'Receiver connection already leased' USING ERRCODE='40001';END IF;
 UPDATE public.insureflow_receiver_connections SET lease_token=token,lease_expires_at=clock_timestamp()+make_interval(secs=>seconds),revision=revision+1,updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
 ELSE
 token:=(p_payload->>'lease_token')::uuid;
 IF NOT c.enabled OR c.mode<>'synthetic' OR token IS NULL OR c.lease_token IS DISTINCT FROM token OR (p_payload->>'config_generation')::bigint IS DISTINCT FROM c.config_generation OR (p_payload->>'expected_revision')::bigint IS DISTINCT FROM c.revision OR c.lease_expires_at IS NULL OR c.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Stale, replaced, disabled or expired receiver lease' USING ERRCODE='40001';END IF;
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
CREATE FUNCTION public.insureflow_receiver_service(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT haven.insureflow_receiver_service_impl(p_action,p_payload)$$;
REVOKE ALL ON FUNCTION public.insureflow_receiver_service(text,jsonb),haven.insureflow_receiver_service_impl(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.insureflow_receiver_service(text,jsonb),haven.insureflow_receiver_service_impl(text,jsonb) TO service_role;
CREATE FUNCTION haven.insureflow_receiver_read_impl(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record;c public.insureflow_receiver_connections;connections jsonb:='[]';summaries jsonb;entry jsonb;r jsonb;body jsonb;map jsonb;ent record;fresh boolean;eligible boolean;checked timestamptz;expires timestamptz;status text;missing integer;requested uuid;entity_filter uuid;stamp timestamptz;
BEGIN
 SELECT * INTO a FROM haven.current_authorized_actor();
 IF a.actor_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000';END IF;
 IF a.actor_role_text NOT IN('owner','org_admin') THEN RAISE EXCEPTION 'Synthetic summaries require insurance manager access' USING ERRCODE='42501';END IF;
 IF p_action IS DISTINCT FROM 'list' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('connection_id','entity_id')) THEN RAISE EXCEPTION 'Invalid receiver read command' USING ERRCODE='22023';END IF;
 requested:=(p_payload->>'connection_id')::uuid;entity_filter:=(p_payload->>'entity_id')::uuid;
 IF entity_filter IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.entities WHERE id=entity_filter AND organization_id=a.actor_organization_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Entity unavailable' USING ERRCODE='42501';END IF;
 FOR c IN SELECT * FROM public.insureflow_receiver_connections WHERE organization_id=a.actor_organization_id AND (requested IS NULL OR id=requested) ORDER BY name,id FOR SHARE LOOP
 summaries:='[]';missing:=0;stamp:=clock_timestamp();checked:=(c.state->>'authorization_checked_at')::timestamptz;expires:=checked+make_interval(secs=>c.ttl_seconds);
 fresh:=c.enabled AND c.mode='synthetic' AND c.state->>'health' IN('healthy','degraded') AND checked IS NOT NULL AND checked<=stamp AND expires>stamp;
 FOR entry IN SELECT value FROM jsonb_array_elements(c.state->'manifest') LOOP
 r:=c.state->'receipts'->(entry->>'release_id');body:=r->'snapshot';eligible:=false;
 IF fresh AND r IS NOT NULL AND r->>'policy_id'=entry->>'policy_id' AND r->>'sequence'=entry->>'sequence' AND r->'validator_version'='1'::jsonb AND r->'conflict'='false'::jsonb AND r->'quarantine'='null'::jsonb AND r->'needs_confirmation'='false'::jsonb AND r->'hash'<>'null'::jsonb AND haven.insureflow_snapshot_valid(body,(entry->>'policy_id')::uuid) AND (NOT c.state->'recovery' ? (entry->>'release_id') OR c.state->'recovery'->(entry->>'release_id')->>'status'='resolved') THEN
 SELECT value INTO map FROM jsonb_array_elements(c.mappings) WHERE (value->>'account_id')::uuid=(body->>'account_id')::uuid AND value->'approved'='true'::jsonb LIMIT 1;
 IF map IS NOT NULL THEN
 SELECT id,name INTO ent FROM public.entities WHERE id=(map->>'entity_id')::uuid AND organization_id=c.organization_id AND deleted_at IS NULL FOR SHARE;
 IF FOUND THEN
 eligible:=true;
 IF entity_filter IS NULL OR ent.id=entity_filter THEN
 summaries:=summaries||jsonb_build_array(jsonb_build_object('source_policy_id',entry->>'policy_id','release_id',entry->>'release_id','source_sequence',entry->>'sequence','source_released_at',r->>'created_at','received_at',c.receipt_received_at->>(entry->>'release_id'),'mapped_entity_id',ent.id,'mapped_entity_name',ent.name,'summary',body-ARRAY['schema_version','policy_id','account_id']));
 END IF;
 END IF;
 END IF;
 END IF;
 IF NOT eligible THEN missing:=missing+1;END IF;
 END LOOP;
 status:=CASE WHEN NOT c.enabled THEN 'disabled' WHEN NOT fresh THEN 'unavailable' WHEN missing>0 OR c.state->>'health'='degraded' OR c.last_error_code IS NOT NULL THEN 'degraded' ELSE 'healthy' END;
 connections:=connections||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'provider_instance',c.provider_instance,'source_integration_id',c.source_integration_id,'mode','synthetic','enabled',c.enabled,'state',status,'revision',c.revision,'last_authorization_check_at',checked,'authorization_valid_until',expires,'incomplete_summary_count',missing,'summaries',summaries));
 END LOOP;
 -- Authority is checked after any connection/entity wait. The clock is checked
 -- again so a read delayed by locks cannot return expired cached material.
 PERFORM haven.insurance_lock_actor(a.actor_user_id,a.actor_organization_id,ARRAY['owner','org_admin']);
 SELECT coalesce(jsonb_agg(CASE WHEN v->>'state'<>'disabled' AND ((v->>'authorization_valid_until')::timestamptz IS NULL OR (v->>'authorization_valid_until')::timestamptz<=clock_timestamp()) THEN v||jsonb_build_object('state','unavailable','summaries','[]'::jsonb) ELSE v END),'[]') INTO connections FROM jsonb_array_elements(connections) v;
 RETURN jsonb_build_object('live_connection_enabled',false,'connections',connections);
END $$;
CREATE FUNCTION public.insureflow_receiver_read(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT haven.insureflow_receiver_read_impl(p_action,p_payload)$$;
REVOKE ALL ON FUNCTION public.insureflow_receiver_read(text,jsonb),haven.insureflow_receiver_read_impl(text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.insureflow_receiver_read(text,jsonb),haven.insureflow_receiver_read_impl(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION haven.insureflow_empty_state(),haven.insureflow_decimal(text,boolean),haven.insureflow_snapshot_valid(jsonb,uuid),haven.insureflow_validate_state(jsonb),haven.insureflow_validate_mappings(jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION haven.insureflow_receiver_service_impl(text,jsonb) OWNER TO postgres;
ALTER FUNCTION haven.insureflow_receiver_read_impl(text,jsonb) OWNER TO postgres;
