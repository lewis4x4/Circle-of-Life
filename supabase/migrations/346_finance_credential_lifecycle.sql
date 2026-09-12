-- F03 sandbox credential lifecycle only. No production starts or dispatch.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='haven_finance_worker') THEN
  CREATE ROLE haven_finance_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='haven_finance_worker' AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='haven_finance_worker'::regrole) THEN RAISE EXCEPTION 'Finance worker role is not isolated'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN GRANT haven_finance_worker TO authenticator; END IF;
END $$;
GRANT USAGE ON SCHEMA public,haven TO haven_finance_worker;

CREATE TABLE public.finance_credential_lineages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 provider text NOT NULL CHECK(provider='qbo'), environment text NOT NULL CHECK(environment IN('sandbox','production')),
 company_reference text NOT NULL CHECK(company_reference ~ '^[1-9][0-9]{0,19}$'),
 client_identity_sha256 text NOT NULL CHECK(client_identity_sha256 ~ '^[0-9a-f]{64}$'),
 app_config_sha256 text NOT NULL CHECK(app_config_sha256 ~ '^[0-9a-f]{64}$'),
 connection_epoch bigint NOT NULL DEFAULT 1, fence_epoch bigint NOT NULL DEFAULT 1,
 credential_revision bigint NOT NULL DEFAULT 0, current_candidate_id uuid, active_attempt_id uuid,
 stopped boolean NOT NULL DEFAULT true,
 state text NOT NULL DEFAULT 'no_credential' CHECK(state IN('no_credential','ready','claimed','started','refresh_outcome_unknown','candidate_pending','reauthorization_required')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(provider,environment,company_reference,client_identity_sha256)
);
CREATE TABLE public.finance_connection_generations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id), entity_id uuid NOT NULL REFERENCES public.entities(id),
 lineage_id uuid NOT NULL REFERENCES public.finance_credential_lineages(id), provider text NOT NULL, environment text NOT NULL,
 company_reference text NOT NULL, client_identity_sha256 text NOT NULL, app_config_sha256 text NOT NULL,
 connection_epoch bigint NOT NULL, previous_id uuid REFERENCES public.finance_connection_generations(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), binding_status text NOT NULL DEFAULT 'declared_unverified' CHECK(binding_status='declared_unverified')
);
CREATE TABLE public.finance_connection_bindings (
 entity_id uuid PRIMARY KEY REFERENCES public.entities(id), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 connection_id uuid NOT NULL UNIQUE REFERENCES public.finance_connection_generations(id), lineage_id uuid NOT NULL REFERENCES public.finance_credential_lineages(id)
);
CREATE TABLE public.finance_credential_workers (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id), epoch bigint NOT NULL CHECK(epoch>0),
 active boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.finance_credential_assignments (
 worker_id uuid NOT NULL REFERENCES public.finance_credential_workers(id), lineage_id uuid NOT NULL REFERENCES public.finance_credential_lineages(id),
 PRIMARY KEY(worker_id,lineage_id)
);
CREATE TABLE public.finance_refresh_attempts (
 id uuid PRIMARY KEY, lineage_id uuid NOT NULL REFERENCES public.finance_credential_lineages(id),
 worker_id uuid NOT NULL REFERENCES public.finance_credential_workers(id), worker_epoch bigint NOT NULL,
 connection_epoch bigint NOT NULL, fence_epoch bigint NOT NULL, input_revision bigint NOT NULL, context_sha256 text NOT NULL,
 state text NOT NULL CHECK(state IN('claimed','expired_unstarted','started','refresh_outcome_unknown','captured','installed')),
 lease_until timestamptz NOT NULL, started_at timestamptz, completion_proof_sha256 text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.finance_credential_candidates (
 id uuid PRIMARY KEY, lineage_id uuid NOT NULL REFERENCES public.finance_credential_lineages(id),
 attempt_id uuid UNIQUE REFERENCES public.finance_refresh_attempts(id), vault_secret_id uuid NOT NULL UNIQUE,
 connection_epoch bigint NOT NULL, fence_epoch bigint NOT NULL, input_revision bigint NOT NULL,
 context_sha256 text NOT NULL, origin text NOT NULL CHECK(origin IN('sandbox_seed','worker_response','trusted_late_response')),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.finance_credential_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lineage_id uuid NOT NULL REFERENCES public.finance_credential_lineages(id), revision bigint NOT NULL,
 candidate_id uuid NOT NULL UNIQUE REFERENCES public.finance_credential_candidates(id), connection_epoch bigint NOT NULL,
 access_expires_at timestamptz NOT NULL, refresh_expires_at timestamptz NOT NULL, hard_expires_at timestamptz,
 installed_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(lineage_id,revision)
);
CREATE TABLE public.finance_credential_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 lineage_id uuid REFERENCES public.finance_credential_lineages(id), event text NOT NULL,
 actor_id uuid, caller_role text NOT NULL, request jsonb NOT NULL DEFAULT '{}', result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.finance_credential_lineages ADD CONSTRAINT finance_lineage_current_candidate FOREIGN KEY(current_candidate_id) REFERENCES public.finance_credential_candidates(id),
 ADD CONSTRAINT finance_lineage_active_attempt FOREIGN KEY(active_attempt_id) REFERENCES public.finance_refresh_attempts(id);
CREATE INDEX finance_connections_lineage ON public.finance_connection_bindings(lineage_id,entity_id);
CREATE INDEX finance_candidates_lineage ON public.finance_credential_candidates(lineage_id,captured_at,id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['finance_credential_lineages','finance_connection_generations','finance_connection_bindings','finance_credential_workers','finance_credential_assignments','finance_refresh_attempts','finance_credential_candidates','finance_credential_revisions','finance_credential_receipts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role,haven_finance_worker',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['finance_connection_generations','finance_credential_candidates','finance_credential_revisions','finance_credential_receipts'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_finance_credential_evidence BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION haven.reject_finance_evidence_mutation()',t);
 END LOOP;
END $$;

-- Candidate identity is a worker observation, not provider/business acceptance.
CREATE TABLE public.finance_credential_identity_observations (
 id uuid PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES public.finance_credential_candidates(id),
 worker_id uuid NOT NULL REFERENCES public.finance_credential_workers(id), worker_epoch bigint NOT NULL,
 company_reference text NOT NULL, client_identity_sha256 text NOT NULL,
 accounting_host text NOT NULL CHECK(accounting_host='https://sandbox-quickbooks.api.intuit.com'),
 response_evidence_sha256 text NOT NULL CHECK(response_evidence_sha256 ~ '^[0-9a-f]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(), status text NOT NULL DEFAULT 'worker_observed_unverified' CHECK(status='worker_observed_unverified')
);
ALTER TABLE public.finance_credential_identity_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_credential_identity_observations FROM PUBLIC,anon,authenticated,service_role,haven_finance_worker;
CREATE TRIGGER immutable_finance_identity_observation BEFORE UPDATE OR DELETE ON public.finance_credential_identity_observations FOR EACH ROW EXECUTE FUNCTION haven.reject_finance_evidence_mutation();

CREATE TABLE public.finance_identity_read_leases (
 id uuid PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES public.finance_credential_candidates(id),
 worker_id uuid NOT NULL REFERENCES public.finance_credential_workers(id), worker_epoch bigint NOT NULL,
 connection_epoch bigint NOT NULL, lease_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.finance_identity_read_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_identity_read_leases FROM PUBLIC,anon,authenticated,service_role,haven_finance_worker;
CREATE TRIGGER immutable_finance_identity_lease BEFORE UPDATE OR DELETE ON public.finance_identity_read_leases FOR EACH ROW EXECUTE FUNCTION haven.reject_finance_evidence_mutation();

CREATE FUNCTION haven.finance_worker_actor(p_purpose text,p_lineage uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb:=auth.jwt(); w public.finance_credential_workers%ROWTYPE; sub uuid; org uuid; epoch bigint; expiry bigint; issued bigint;
BEGIN
 IF current_setting('role',true)<>'haven_finance_worker' OR c->>'role' IS DISTINCT FROM 'haven_finance_worker'
 OR c ?| ARRAY['organization_id','app_role','facility_ids','auth_claim_version','app_metadata','user_metadata']
 OR c->>'iss' IS DISTINCT FROM 'urn:haven:finance-worker:v1' OR c->>'aud' IS DISTINCT FROM 'haven-finance-credentials'
 OR c->>'purpose' IS DISTINCT FROM p_purpose
 OR jsonb_typeof(c->'sub') IS DISTINCT FROM 'string' OR c->>'sub' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 OR jsonb_typeof(c->'hfa_org') IS DISTINCT FROM 'string' OR c->>'hfa_org' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 OR jsonb_typeof(c->'worker_epoch') IS DISTINCT FROM 'number' OR c->>'worker_epoch' !~ '^[1-9][0-9]{0,17}$'
 OR jsonb_typeof(c->'exp') IS DISTINCT FROM 'number' OR c->>'exp' !~ '^[0-9]{1,10}$'
 OR jsonb_typeof(c->'iat') IS DISTINCT FROM 'number' OR c->>'iat' !~ '^[0-9]{1,10}$' THEN
  RAISE EXCEPTION 'Finance worker authority required' USING ERRCODE='42501'; END IF;
 sub:=(c->>'sub')::uuid; org:=(c->>'hfa_org')::uuid; epoch:=(c->>'worker_epoch')::bigint; expiry:=(c->>'exp')::bigint; issued:=(c->>'iat')::bigint;
 IF expiry<=extract(epoch FROM clock_timestamp()) OR expiry>issued+300 OR issued>extract(epoch FROM clock_timestamp())+30
 OR EXISTS(SELECT 1 FROM public.user_profiles WHERE id=sub) OR EXISTS(SELECT 1 FROM auth.users WHERE id=sub) THEN RAISE EXCEPTION 'Finance worker authority required' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM public.finance_credential_workers WHERE id=sub;
 IF NOT FOUND OR NOT w.active OR w.organization_id<>org OR w.epoch<>epoch
 OR (p_lineage IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.finance_credential_assignments a JOIN public.finance_credential_lineages l ON l.id=a.lineage_id WHERE a.worker_id=sub AND l.id=p_lineage AND l.organization_id=org)) THEN
  RAISE EXCEPTION 'Finance worker authority required' USING ERRCODE='42501'; END IF;
 RETURN sub;
END $$;
CREATE FUNCTION haven.finance_credential_authority(p_mode text,p_entity uuid,p_lineage uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; c jsonb:=auth.jwt();
BEGIN
 IF p_mode='human' THEN
  IF current_setting('role',true)<>'authenticated' THEN RAISE EXCEPTION 'Current credential manager required' USING ERRCODE='42501'; END IF;
  SELECT actor_id INTO actor FROM haven.assert_finance_batch_actor(p_entity,NULL,true);
  IF p_lineage IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.finance_credential_lineages WHERE id=p_lineage AND organization_id=haven.organization_id()) THEN RAISE EXCEPTION 'Credential lineage unavailable' USING ERRCODE='42501'; END IF;
  RETURN actor;
 ELSIF p_mode='trusted_capture' THEN
  IF current_setting('role',true)<>'service_role' OR c->>'role' IS DISTINCT FROM 'service_role'
  OR jsonb_typeof(c->'exp') IS DISTINCT FROM 'number' OR c->>'exp' !~ '^[0-9]{1,10}$' THEN RAISE EXCEPTION 'Trusted completion authority required' USING ERRCODE='42501'; END IF;
  IF (c->>'exp')::bigint<=extract(epoch FROM clock_timestamp()) THEN RAISE EXCEPTION 'Trusted completion authority required' USING ERRCODE='42501'; END IF;
  RETURN NULL;
 END IF;
 RETURN haven.finance_worker_actor(p_mode,p_lineage);
END $$;

-- One lock hierarchy for registry changes and refresh. Workers never update
-- controls: these locks stabilize their input authority, including all sharers.
CREATE FUNCTION haven.lock_finance_credentials(p_org uuid,p_entity uuid,p_lineage uuid,p_mode text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-credential-org:'||p_org,0));
 PERFORM haven.finance_credential_authority(p_mode,p_entity,p_lineage);
 FOR r IN SELECT entity_id FROM public.finance_staging_controls WHERE organization_id=p_org ORDER BY entity_id FOR UPDATE LOOP
  PERFORM haven.finance_credential_authority(p_mode,p_entity,p_lineage);
 END LOOP;
 FOR r IN SELECT id FROM public.finance_credential_lineages WHERE organization_id=p_org ORDER BY id FOR UPDATE LOOP
  PERFORM haven.finance_credential_authority(p_mode,p_entity,p_lineage);
 END LOOP;
END $$;
CREATE FUNCTION haven.finance_credential_context(p_lineage uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT haven.batch_sha(coalesce(jsonb_agg(jsonb_build_object('entity',b.entity_id,'connection',b.connection_id,'controlGeneration',c.staging_generation::text,'controlBinding',c.connection_generation_ref,'stopped',c.stopped) ORDER BY b.entity_id),'[]'))
 FROM public.finance_connection_bindings b JOIN public.finance_staging_controls c ON c.entity_id=b.entity_id WHERE b.lineage_id=p_lineage
$$;
CREATE FUNCTION haven.finance_credential_connection_live(p_lineage uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.finance_credential_lineages l WHERE l.id=p_lineage AND l.environment='sandbox' AND NOT l.stopped
 AND EXISTS(SELECT 1 FROM public.finance_connection_bindings WHERE lineage_id=l.id)
 AND NOT EXISTS(SELECT 1 FROM public.finance_connection_bindings b LEFT JOIN public.finance_staging_controls c ON c.entity_id=b.entity_id LEFT JOIN public.entities e ON e.id=b.entity_id
  WHERE b.lineage_id=l.id AND (c.entity_id IS NULL OR c.stopped OR c.connection_generation_ref IS DISTINCT FROM b.connection_id OR e.id IS NULL OR e.deleted_at IS NOT NULL OR e.organization_id IS DISTINCT FROM l.organization_id)))
$$;
CREATE FUNCTION haven.finance_credential_usable(p_lineage uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT haven.finance_credential_connection_live(p_lineage) AND EXISTS(SELECT 1 FROM public.finance_credential_lineages l JOIN public.finance_credential_revisions r ON r.lineage_id=l.id AND r.revision=l.credential_revision
 WHERE l.id=p_lineage AND r.connection_epoch=l.connection_epoch AND r.refresh_expires_at>clock_timestamp() AND (r.hard_expires_at IS NULL OR r.hard_expires_at>clock_timestamp()))
$$;
CREATE FUNCTION haven.require_finance_vault() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='supabase_vault') OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
  RAISE EXCEPTION 'Verified Vault runtime unavailable' USING ERRCODE='55000'; END IF;
END $$;
CREATE FUNCTION haven.finance_vault_read(p_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE body text;
BEGIN
 PERFORM haven.require_finance_vault();
 BEGIN EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=$1' INTO body USING p_id;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Credential vault read unavailable' USING ERRCODE='55000',DETAIL='',HINT=''; END;
 IF body IS NULL THEN RAISE EXCEPTION 'Credential requires protected-store reconciliation' USING ERRCODE='55000'; END IF;
 RETURN body;
END $$;
CREATE FUNCTION haven.finance_vault_create(p_id uuid,p_body text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE secret uuid;
BEGIN
 PERFORM haven.require_finance_vault();
 BEGIN EXECUTE 'SELECT vault.create_secret($1,$2,$3,NULL)' INTO secret USING p_body,'haven-finance-candidate-'||p_id,'Immutable finance credential candidate';
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Credential vault persistence failed' USING ERRCODE='55000',DETAIL='',HINT=''; END;
 IF secret IS NULL THEN RAISE EXCEPTION 'Credential vault persistence failed' USING ERRCODE='55000'; END IF;
 RETURN secret;
END $$;
CREATE FUNCTION haven.finance_credential_event(p_org uuid,p_lineage uuid,p_event text,p_request jsonb,p_result jsonb,p_id uuid DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.finance_credential_receipts(id,organization_id,lineage_id,event,actor_id,caller_role,request,result)
 VALUES(coalesce(p_id,gen_random_uuid()),p_org,p_lineage,p_event,CASE WHEN auth.jwt()->>'role'='authenticated' THEN haven.authorized_user_id() WHEN auth.jwt()->>'role'='haven_finance_worker' THEN (auth.jwt()->>'sub')::uuid ELSE NULL END,current_setting('role',true),p_request,p_result)
$$;

CREATE FUNCTION haven.finance_credential_admin(p_request_id uuid,p_entity uuid,p_action text,p_data jsonb,p_secret text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; org uuid; l public.finance_credential_lineages%ROWTYPE; old public.finance_connection_bindings%ROWTYPE;
 prior public.finance_credential_receipts%ROWTYPE; c record; lineage uuid; connection uuid; expected uuid; result jsonb; worker uuid; epoch bigint; active boolean; pending public.finance_refresh_attempts%ROWTYPE;
BEGIN
 actor:=haven.finance_credential_authority('human',p_entity,NULL); org:=haven.organization_id();
 IF p_request_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR p_action NOT IN('bind','stop','reconnect','worker') OR p_action IS NULL OR p_secret IS NOT NULL THEN RAISE EXCEPTION 'Valid metadata-only credential control required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-credential-org:'||org,0));
 actor:=haven.finance_credential_authority('human',p_entity,NULL);
 -- New control row insertion can wait; revalidate immediately afterward.
 INSERT INTO public.finance_staging_controls(entity_id,organization_id,updated_by) VALUES(p_entity,org,actor) ON CONFLICT(entity_id) DO NOTHING;
 actor:=haven.finance_credential_authority('human',p_entity,NULL);
 PERFORM haven.lock_finance_credentials(org,p_entity,NULL,'human');
 SELECT * INTO prior FROM public.finance_credential_receipts WHERE id=p_request_id;
 IF FOUND THEN
  IF prior.organization_id<>org OR prior.event<>p_action OR prior.actor_id<>actor OR prior.request IS DISTINCT FROM jsonb_build_object('entity',p_entity,'data',p_data) THEN RAISE EXCEPTION 'Credential control identity conflict' USING ERRCODE='23505'; END IF;
  RETURN prior.result;
 END IF;
 IF p_action='bind' THEN
  IF p_data-ARRAY['provider','environment','company_reference','client_identity_sha256','app_config_sha256','expected_connection_id']<>'{}' OR NOT(p_data ?& ARRAY['provider','environment','company_reference','client_identity_sha256','app_config_sha256','expected_connection_id'])
  OR p_data->>'provider' IS DISTINCT FROM 'qbo' OR p_data->>'environment' NOT IN('sandbox','production') OR p_data->>'environment' IS NULL
  OR jsonb_typeof(p_data->'company_reference') IS DISTINCT FROM 'string' OR p_data->>'company_reference' !~ '^[1-9][0-9]{0,19}$'
  OR jsonb_typeof(p_data->'client_identity_sha256') IS DISTINCT FROM 'string' OR p_data->>'client_identity_sha256' !~ '^[0-9a-f]{64}$'
  OR jsonb_typeof(p_data->'app_config_sha256') IS DISTINCT FROM 'string' OR p_data->>'app_config_sha256' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Connection declaration invalid'; END IF;
  BEGIN expected:=(p_data->>'expected_connection_id')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Connection declaration invalid'; END;
  SELECT * INTO old FROM public.finance_connection_bindings WHERE entity_id=p_entity;
  IF old.connection_id IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Connection generation changed' USING ERRCODE='40001'; END IF;
  INSERT INTO public.finance_credential_lineages(organization_id,provider,environment,company_reference,client_identity_sha256,app_config_sha256)
  VALUES(org,'qbo',p_data->>'environment',p_data->>'company_reference',p_data->>'client_identity_sha256',p_data->>'app_config_sha256') ON CONFLICT(provider,environment,company_reference,client_identity_sha256) DO NOTHING;
  actor:=haven.finance_credential_authority('human',p_entity,NULL);
  SELECT * INTO l FROM public.finance_credential_lineages WHERE organization_id=org AND provider='qbo' AND environment=p_data->>'environment' AND company_reference=p_data->>'company_reference' AND client_identity_sha256=p_data->>'client_identity_sha256' FOR UPDATE;
  actor:=haven.finance_credential_authority('human',p_entity,NULL);
  IF l.id IS NULL THEN RAISE EXCEPTION 'Credential grant unavailable' USING ERRCODE='42501'; END IF;
  IF l.app_config_sha256<>p_data->>'app_config_sha256' THEN RAISE EXCEPTION 'Explicit shared reconnect required for app configuration change'; END IF;
  connection:=p_request_id; lineage:=l.id;
  INSERT INTO public.finance_connection_generations(id,organization_id,entity_id,lineage_id,provider,environment,company_reference,client_identity_sha256,app_config_sha256,connection_epoch,previous_id)
  VALUES(connection,org,p_entity,l.id,l.provider,l.environment,l.company_reference,l.client_identity_sha256,l.app_config_sha256,l.connection_epoch,old.connection_id);
  actor:=haven.finance_credential_authority('human',p_entity,NULL);
  INSERT INTO public.finance_connection_bindings(entity_id,organization_id,connection_id,lineage_id) VALUES(p_entity,org,connection,l.id)
  ON CONFLICT(entity_id) DO UPDATE SET connection_id=excluded.connection_id,lineage_id=excluded.lineage_id;
  actor:=haven.finance_credential_authority('human',p_entity,NULL);
  UPDATE public.finance_credential_lineages SET fence_epoch=fence_epoch+1,stopped=true,state=CASE WHEN active_attempt_id IS NOT NULL THEN 'refresh_outcome_unknown' ELSE state END WHERE id IN(l.id,old.lineage_id);
 ELSIF p_action IN('stop','reconnect') THEN
  IF p_data-ARRAY['lineage_id','expected_fence_epoch','stopped','app_config_sha256']<>'{}' OR NOT(p_data ?& ARRAY['lineage_id','expected_fence_epoch']) THEN RAISE EXCEPTION 'Credential control invalid'; END IF;
  BEGIN lineage:=(p_data->>'lineage_id')::uuid; epoch:=(p_data->>'expected_fence_epoch')::bigint; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Credential control invalid'; END;
  SELECT * INTO l FROM public.finance_credential_lineages WHERE id=lineage AND organization_id=org;
  IF NOT FOUND OR l.fence_epoch IS DISTINCT FROM epoch OR NOT EXISTS(SELECT 1 FROM public.finance_connection_bindings WHERE lineage_id=lineage AND entity_id=p_entity) THEN RAISE EXCEPTION 'Credential control generation unavailable' USING ERRCODE='40001'; END IF;
  IF p_action='stop' THEN
   IF jsonb_typeof(p_data->'stopped') IS DISTINCT FROM 'boolean' OR p_data ? 'app_config_sha256' THEN RAISE EXCEPTION 'Explicit stop state required'; END IF;
   active:=NOT (p_data->>'stopped')::boolean;
   IF active AND l.environment<>'sandbox' THEN RAISE EXCEPTION 'Production credential activation disabled' USING ERRCODE='42501'; END IF;
   UPDATE public.finance_credential_lineages SET stopped=NOT active,fence_epoch=fence_epoch+1,state=CASE WHEN active_attempt_id IS NOT NULL THEN 'refresh_outcome_unknown' ELSE state END WHERE id=lineage;
  ELSE
   IF jsonb_typeof(p_data->'app_config_sha256') IS DISTINCT FROM 'string' OR p_data->>'app_config_sha256' !~ '^[0-9a-f]{64}$' OR p_data ? 'stopped' THEN RAISE EXCEPTION 'Reconnect configuration required'; END IF;
   UPDATE public.finance_credential_lineages SET app_config_sha256=p_data->>'app_config_sha256',connection_epoch=connection_epoch+1,fence_epoch=fence_epoch+1,stopped=true,state='reauthorization_required' WHERE id=lineage RETURNING * INTO l;
   FOR c IN SELECT * FROM public.finance_connection_bindings WHERE lineage_id=lineage ORDER BY entity_id LOOP
    connection:=gen_random_uuid();
    INSERT INTO public.finance_connection_generations(id,organization_id,entity_id,lineage_id,provider,environment,company_reference,client_identity_sha256,app_config_sha256,connection_epoch,previous_id)
    VALUES(connection,org,c.entity_id,lineage,l.provider,l.environment,l.company_reference,l.client_identity_sha256,l.app_config_sha256,l.connection_epoch,c.connection_id);
    actor:=haven.finance_credential_authority('human',p_entity,NULL);
    UPDATE public.finance_connection_bindings SET connection_id=connection WHERE entity_id=c.entity_id;
    actor:=haven.finance_credential_authority('human',p_entity,NULL);
   END LOOP;
  END IF;
 ELSE
  IF p_data-ARRAY['lineage_id','worker_id','expected_epoch','active']<>'{}' OR NOT(p_data ?& ARRAY['lineage_id','worker_id','expected_epoch','active']) OR jsonb_typeof(p_data->'active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Worker declaration invalid'; END IF;
  BEGIN lineage:=(p_data->>'lineage_id')::uuid; worker:=(p_data->>'worker_id')::uuid; epoch:=(p_data->>'expected_epoch')::bigint; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Worker declaration invalid'; END;
  IF worker IS NULL OR epoch IS NULL OR epoch<0 OR NOT EXISTS(SELECT 1 FROM public.finance_connection_bindings WHERE lineage_id=lineage AND entity_id=p_entity AND organization_id=org) OR EXISTS(SELECT 1 FROM public.user_profiles WHERE id=worker) OR EXISTS(SELECT 1 FROM auth.users WHERE id=worker) THEN RAISE EXCEPTION 'Worker declaration invalid'; END IF;
  IF coalesce((SELECT w.epoch FROM public.finance_credential_workers w WHERE w.id=worker AND w.organization_id=org),0)<>epoch THEN RAISE EXCEPTION 'Worker epoch changed' USING ERRCODE='40001'; END IF;
  INSERT INTO public.finance_credential_workers(id,organization_id,epoch,active) VALUES(worker,org,epoch+1,(p_data->>'active')::boolean)
  ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,active=excluded.active WHERE finance_credential_workers.organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker scope unavailable' USING ERRCODE='42501'; END IF;
  actor:=haven.finance_credential_authority('human',p_entity,NULL);
  INSERT INTO public.finance_credential_assignments(worker_id,lineage_id) VALUES(worker,lineage) ON CONFLICT DO NOTHING;
  actor:=haven.finance_credential_authority('human',p_entity,NULL);
  UPDATE public.finance_credential_lineages SET fence_epoch=fence_epoch+1,stopped=true,state=CASE WHEN active_attempt_id IS NOT NULL THEN 'refresh_outcome_unknown' ELSE state END WHERE id IN(SELECT lineage_id FROM public.finance_credential_assignments WHERE worker_id=worker);
 END IF;
 -- A never-started claim has disclosed no refresh credential. Fence it
 -- explicitly so reconnect cannot strand a grant behind an old input revision.
 FOR c IN SELECT cl.id,cl.active_attempt_id FROM public.finance_credential_lineages cl
  WHERE cl.organization_id=org AND cl.active_attempt_id IS NOT NULL AND
  (cl.id=lineage OR (p_action='bind' AND cl.id=old.lineage_id) OR (p_action='worker' AND cl.id IN(SELECT a.lineage_id FROM public.finance_credential_assignments a WHERE a.worker_id=worker))) ORDER BY cl.id LOOP
  SELECT * INTO pending FROM public.finance_refresh_attempts WHERE id=c.active_attempt_id FOR UPDATE;
  actor:=haven.finance_credential_authority('human',p_entity,NULL);
  IF pending.started_at IS NULL THEN
   UPDATE public.finance_refresh_attempts SET state='expired_unstarted' WHERE id=pending.id;
   UPDATE public.finance_credential_lineages cl SET active_attempt_id=NULL,state=CASE WHEN cl.credential_revision=0 THEN 'no_credential'
    WHEN EXISTS(SELECT 1 FROM public.finance_credential_revisions r WHERE r.lineage_id=cl.id AND r.revision=cl.credential_revision AND r.connection_epoch=cl.connection_epoch) THEN 'ready' ELSE 'reauthorization_required' END WHERE cl.id=c.id;
   actor:=haven.finance_credential_authority('human',p_entity,NULL);
   PERFORM haven.finance_credential_event(org,c.id,'claim_fenced_unstarted',jsonb_build_object('attempt_id',pending.id),jsonb_build_object('status','expired_unstarted'));
   actor:=haven.finance_credential_authority('human',p_entity,NULL);
  END IF;
 END LOOP;
 -- Only human registry/control operations touch staging and its approval hooks.
 FOR c IN SELECT b.*,sc.staging_generation,gl.stopped FROM public.finance_connection_bindings b JOIN public.finance_staging_controls sc ON sc.entity_id=b.entity_id JOIN public.finance_credential_lineages gl ON gl.id=b.lineage_id
  WHERE b.organization_id=org AND (b.lineage_id=lineage OR (p_action='bind' AND b.lineage_id=old.lineage_id) OR (p_action='worker' AND b.lineage_id IN(SELECT a.lineage_id FROM public.finance_credential_assignments a WHERE a.worker_id=worker))) ORDER BY b.entity_id LOOP
  PERFORM public.set_finance_staging_control(gen_random_uuid(),c.entity_id,c.staging_generation,c.stopped,c.connection_id,NULL,NULL);
  PERFORM haven.finance_credential_authority('human',p_entity,lineage);
 END LOOP;
 SELECT * INTO l FROM public.finance_credential_lineages WHERE id=lineage;
 result:=jsonb_build_object('lineage_id',lineage,'connection_id',connection,'connection_epoch',l.connection_epoch::text,'fence_epoch',l.fence_epoch::text,'worker_epoch',CASE WHEN worker IS NULL THEN NULL ELSE (SELECT w.epoch::text FROM public.finance_credential_workers w WHERE w.id=worker) END,'status',l.state,'stopped',l.stopped,'binding_verified',false,'financial_dispatch_enabled',false,'production_credential_starts_enabled',false);
 PERFORM haven.finance_credential_event(org,lineage,p_action,jsonb_build_object('entity',p_entity,'data',p_data),result,p_request_id);
 PERFORM haven.finance_credential_authority('human',p_entity,lineage);
 RETURN result;
END $$;

CREATE FUNCTION haven.finance_identity_current(p_candidate uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.finance_credential_identity_observations o
 JOIN public.finance_credential_candidates c ON c.id=o.candidate_id
 JOIN public.finance_credential_lineages l ON l.id=c.lineage_id
 JOIN public.finance_credential_workers w ON w.id=o.worker_id
 JOIN public.finance_credential_assignments a ON a.worker_id=w.id AND a.lineage_id=l.id
 WHERE c.id=p_candidate AND l.environment='sandbox' AND c.connection_epoch=l.connection_epoch
 AND o.company_reference=l.company_reference AND o.client_identity_sha256=l.client_identity_sha256
 AND w.active AND w.organization_id=l.organization_id AND w.epoch=o.worker_epoch
 AND NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=w.id) AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=w.id))
$$;

CREATE FUNCTION haven.capture_finance_candidate(p_id uuid,p_lineage uuid,p_attempt uuid,p_response text,p_mode text,p_entity uuid,p_proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.finance_credential_lineages%ROWTYPE; a public.finance_refresh_attempts%ROWTYPE; prior public.finance_credential_candidates%ROWTYPE; secret uuid; result jsonb;
BEGIN
 IF p_id IS NULL OR p_response IS NULL OR octet_length(p_response) NOT BETWEEN 1 AND 65536 THEN RAISE EXCEPTION 'Bounded credential response and identity required' USING ERRCODE='22023'; END IF;
 SELECT * INTO l FROM public.finance_credential_lineages WHERE id=p_lineage;
 IF NOT FOUND OR l.environment<>'sandbox' THEN RAISE EXCEPTION 'Sandbox credential lineage required' USING ERRCODE='42501'; END IF;
 PERFORM haven.finance_credential_authority(p_mode,p_entity,p_lineage);
 PERFORM haven.lock_finance_credentials(l.organization_id,p_entity,p_lineage,p_mode);
 SELECT * INTO l FROM public.finance_credential_lineages WHERE id=p_lineage;
 IF p_attempt IS NOT NULL THEN
  SELECT * INTO a FROM public.finance_refresh_attempts WHERE id=p_attempt AND lineage_id=p_lineage FOR UPDATE;
  PERFORM haven.finance_credential_authority(p_mode,p_entity,p_lineage);
  IF NOT FOUND OR a.started_at IS NULL OR p_proof IS NULL OR length(p_proof)>100 OR a.completion_proof_sha256 IS DISTINCT FROM encode(sha256(convert_to(p_proof,'UTF8')),'hex') THEN RAISE EXCEPTION 'Started attempt completion proof required' USING ERRCODE='42501'; END IF;
  IF p_mode<>'trusted_capture' AND (a.worker_id IS DISTINCT FROM (auth.jwt()->>'sub')::uuid OR a.worker_epoch IS DISTINCT FROM (auth.jwt()->>'worker_epoch')::bigint) THEN RAISE EXCEPTION 'Original current worker required' USING ERRCODE='42501'; END IF;
 ELSE
  IF p_mode<>'human' OR l.active_attempt_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.finance_connection_bindings WHERE entity_id=p_entity AND lineage_id=p_lineage) THEN RAISE EXCEPTION 'Initial candidate requires current manager and no unresolved attempt' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO prior FROM public.finance_credential_candidates WHERE id=p_id;
 IF FOUND THEN
  IF prior.lineage_id<>p_lineage OR prior.attempt_id IS DISTINCT FROM p_attempt THEN RAISE EXCEPTION 'Candidate identity content conflict' USING ERRCODE='23505'; END IF;
  IF haven.finance_vault_read(prior.vault_secret_id) IS DISTINCT FROM p_response THEN RAISE EXCEPTION 'Candidate identity content conflict' USING ERRCODE='23505'; END IF;
  PERFORM haven.finance_credential_authority(p_mode,p_entity,p_lineage);
  RETURN jsonb_build_object('candidate_id',p_id,'status','protected_candidate_retained','provider_verified',false);
 END IF;
 IF p_attempt IS NOT NULL AND EXISTS(SELECT 1 FROM public.finance_credential_candidates WHERE attempt_id=p_attempt) THEN RAISE EXCEPTION 'Attempt already has a different immutable candidate' USING ERRCODE='23505'; END IF;
 secret:=haven.finance_vault_create(p_id,p_response);
 PERFORM haven.finance_credential_authority(p_mode,p_entity,p_lineage);
 INSERT INTO public.finance_credential_candidates(id,lineage_id,attempt_id,vault_secret_id,connection_epoch,fence_epoch,input_revision,context_sha256,origin)
 VALUES(p_id,p_lineage,p_attempt,secret,coalesce(a.connection_epoch,l.connection_epoch),coalesce(a.fence_epoch,l.fence_epoch),coalesce(a.input_revision,l.credential_revision),coalesce(a.context_sha256,haven.finance_credential_context(p_lineage)),CASE WHEN p_mode='human' THEN 'sandbox_seed' WHEN p_mode='trusted_capture' THEN 'trusted_late_response' ELSE 'worker_response' END);
 PERFORM haven.finance_credential_authority(p_mode,p_entity,p_lineage);
 IF p_attempt IS NOT NULL THEN
  UPDATE public.finance_refresh_attempts SET state='captured' WHERE id=p_attempt;
  IF l.active_attempt_id=p_attempt THEN UPDATE public.finance_credential_lineages SET state=CASE WHEN a.state='started' AND l.state='started' AND a.lease_until>clock_timestamp() AND a.connection_epoch=l.connection_epoch AND a.fence_epoch=l.fence_epoch AND a.context_sha256=haven.finance_credential_context(p_lineage) AND p_mode<>'trusted_capture' THEN 'candidate_pending' ELSE 'refresh_outcome_unknown' END WHERE id=p_lineage; END IF;
 END IF;
 result:=jsonb_build_object('candidate_id',p_id,'status','captured_quarantined','provider_verified',false);
 PERFORM haven.finance_credential_event(l.organization_id,p_lineage,'candidate_captured',jsonb_build_object('attempt_id',p_attempt,'candidate_id',p_id),result);
 PERFORM haven.finance_credential_authority(p_mode,p_entity,p_lineage);
 RETURN result;
END $$;

CREATE FUNCTION haven.seed_finance_credential(p_id uuid,p_entity uuid,p_lineage uuid,p_connection_epoch bigint,p_input_revision bigint,p_response text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.finance_credential_lineages%ROWTYPE;
BEGIN
 PERFORM haven.finance_credential_authority('human',p_entity,p_lineage);
 SELECT * INTO l FROM public.finance_credential_lineages WHERE id=p_lineage;
 PERFORM haven.lock_finance_credentials(l.organization_id,p_entity,p_lineage,'human');
 SELECT * INTO l FROM public.finance_credential_lineages WHERE id=p_lineage;
 IF NOT haven.finance_credential_connection_live(l.id) THEN RAISE EXCEPTION 'Explicit sandbox resume required before credential seed' USING ERRCODE='42501'; END IF;
 IF l.credential_revision>0 AND (l.state<>'reauthorization_required' OR NOT EXISTS(SELECT 1 FROM public.finance_credential_revisions r WHERE r.lineage_id=l.id AND r.revision=l.credential_revision AND r.connection_epoch<l.connection_epoch)) THEN RAISE EXCEPTION 'Explicit reconnect required before credential replacement' USING ERRCODE='42501'; END IF;
 IF l.connection_epoch IS DISTINCT FROM p_connection_epoch OR l.credential_revision IS DISTINCT FROM p_input_revision THEN RAISE EXCEPTION 'Credential input revision changed' USING ERRCODE='40001'; END IF;
 RETURN haven.capture_finance_candidate(p_id,p_lineage,NULL,p_response,'human',p_entity,NULL);
END $$;

-- This repeatable lease permits ONLY an access-token GET identity check. It
-- never discloses a refresh token and cannot establish provider truth itself.
CREATE FUNCTION haven.read_finance_identity(p_id uuid,p_candidate uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.finance_credential_candidates%ROWTYPE; l public.finance_credential_lineages%ROWTYPE;
 r public.finance_identity_read_leases%ROWTYPE; worker uuid; body jsonb; protected_body text; expires_at timestamptz; issued_at timestamptz;
BEGIN
 SELECT * INTO c FROM public.finance_credential_candidates WHERE id=p_candidate;
 IF c.id IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'Identity candidate unavailable' USING ERRCODE='42501'; END IF;
 worker:=haven.finance_worker_actor('finance_identity',c.lineage_id);
 SELECT * INTO l FROM public.finance_credential_lineages WHERE id=c.lineage_id;
 PERFORM haven.lock_finance_credentials(l.organization_id,NULL,l.id,'finance_identity');
 SELECT * INTO l FROM public.finance_credential_lineages WHERE id=c.lineage_id;
 IF NOT haven.finance_credential_connection_live(l.id) OR c.connection_epoch<>l.connection_epoch OR c.fence_epoch<>l.fence_epoch OR c.context_sha256<>haven.finance_credential_context(l.id) OR c.origin='trusted_late_response' THEN RAISE EXCEPTION 'Identity verification is fenced' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.finance_identity_read_leases WHERE id=p_id;
 IF r.id IS NOT NULL AND (r.candidate_id<>p_candidate OR r.worker_id<>worker OR r.worker_epoch<>(auth.jwt()->>'worker_epoch')::bigint OR r.connection_epoch<>l.connection_epoch) THEN RAISE EXCEPTION 'Identity lease content conflict' USING ERRCODE='23505'; END IF;
 IF r.id IS NOT NULL AND r.lease_until<=clock_timestamp() THEN RETURN jsonb_build_object('status','identity_lease_expired','credential_returned',false); END IF;
 protected_body:=haven.finance_vault_read(c.vault_secret_id);
 PERFORM haven.finance_worker_actor('finance_identity',l.id);
 BEGIN
  body:=protected_body::jsonb;
  IF jsonb_typeof(body->'access_token') IS DISTINCT FROM 'string' OR length(body->>'access_token') NOT BETWEEN 1 AND 16384
   OR jsonb_typeof(body->'expires_in') IS DISTINCT FROM 'number' OR body->>'expires_in' !~ '^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'Invalid candidate'; END IF;
  SELECT started_at INTO issued_at FROM public.finance_refresh_attempts WHERE id=c.attempt_id;
  expires_at:=coalesce(issued_at,c.captured_at)+make_interval(secs=>(body->>'expires_in')::integer);
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('status','reconnect_required_invalid_candidate','credential_returned',false); END;
 PERFORM haven.finance_worker_actor('finance_identity',l.id);
 IF expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status','reconnect_required_access_expired','credential_returned',false); END IF;
 IF r.id IS NULL THEN
  INSERT INTO public.finance_identity_read_leases(id,candidate_id,worker_id,worker_epoch,connection_epoch,lease_until)
  VALUES(p_id,p_candidate,worker,(auth.jwt()->>'worker_epoch')::bigint,l.connection_epoch,least(clock_timestamp()+interval '60 seconds',expires_at)) RETURNING * INTO r;
 END IF;
 PERFORM haven.finance_worker_actor('finance_identity',l.id);
 IF r.lease_until<=clock_timestamp() OR NOT haven.finance_credential_connection_live(l.id) OR c.fence_epoch<>(SELECT fence_epoch FROM public.finance_credential_lineages WHERE id=l.id) OR c.context_sha256<>haven.finance_credential_context(l.id) THEN RAISE EXCEPTION 'Identity lease expired or connection stopped' USING ERRCODE='42501'; END IF;
 PERFORM set_config('response.headers','[{"Cache-Control":"no-store"},{"Pragma":"no-cache"}]',true);
 RETURN jsonb_build_object('lease_id',r.id,'candidate_id',c.id,'lease_until',r.lease_until,'status','identity_read_only','access_token',body->>'access_token',
  'expected_method','GET','expected_accounting_host','https://sandbox-quickbooks.api.intuit.com','expected_company_reference',l.company_reference,'expected_client_identity_sha256',l.client_identity_sha256,
  'provider_verified',false,'financial_dispatch_enabled',false);
END $$;

CREATE FUNCTION haven.observe_finance_credential(p_id uuid,p_candidate uuid,p_company text,p_client_sha256 text,p_host text,p_evidence_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.finance_credential_candidates%ROWTYPE; l public.finance_credential_lineages%ROWTYPE; worker uuid; prior public.finance_credential_identity_observations%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public.finance_credential_candidates WHERE id=p_candidate;
 IF NOT FOUND THEN RAISE EXCEPTION 'Candidate unavailable' USING ERRCODE='42501'; END IF;
 worker:=haven.finance_worker_actor('finance_identity',c.lineage_id);
 SELECT * INTO l FROM public.finance_credential_lineages WHERE id=c.lineage_id;
 PERFORM haven.lock_finance_credentials(l.organization_id,NULL,l.id,'finance_identity');
 SELECT * INTO l FROM public.finance_credential_lineages WHERE id=c.lineage_id;
 IF p_id IS NULL OR NOT haven.finance_credential_connection_live(l.id) OR p_company IS DISTINCT FROM l.company_reference OR p_client_sha256 IS DISTINCT FROM l.client_identity_sha256 OR p_host IS DISTINCT FROM 'https://sandbox-quickbooks.api.intuit.com'
 OR c.connection_epoch<>l.connection_epoch OR c.fence_epoch<>l.fence_epoch OR c.context_sha256<>haven.finance_credential_context(l.id) OR p_evidence_sha256 IS NULL OR p_evidence_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Expected sandbox company and client observation required' USING ERRCODE='42501'; END IF;
 IF NOT haven.finance_credential_connection_live(l.id) OR NOT EXISTS(SELECT 1 FROM public.finance_identity_read_leases r WHERE r.candidate_id=p_candidate AND r.worker_id=worker AND r.worker_epoch=(auth.jwt()->>'worker_epoch')::bigint AND r.connection_epoch=l.connection_epoch AND r.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'Current identity verification lease required' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM public.finance_credential_identity_observations WHERE id=p_id;
 IF FOUND THEN
  IF (prior.candidate_id,prior.worker_id,prior.worker_epoch,prior.company_reference,prior.client_identity_sha256,prior.accounting_host,prior.response_evidence_sha256) IS DISTINCT FROM (p_candidate,worker,(auth.jwt()->>'worker_epoch')::bigint,p_company,p_client_sha256,p_host,p_evidence_sha256) THEN RAISE EXCEPTION 'Observation identity content conflict' USING ERRCODE='23505'; END IF;
 ELSE
  INSERT INTO public.finance_credential_identity_observations(id,candidate_id,worker_id,worker_epoch,company_reference,client_identity_sha256,accounting_host,response_evidence_sha256)
  VALUES(p_id,p_candidate,worker,(auth.jwt()->>'worker_epoch')::bigint,p_company,p_client_sha256,p_host,p_evidence_sha256);
 END IF;
 PERFORM haven.finance_worker_actor('finance_identity',l.id);
 IF NOT haven.finance_credential_connection_live(l.id) OR NOT EXISTS(SELECT 1 FROM public.finance_identity_read_leases r WHERE r.candidate_id=p_candidate AND r.worker_id=worker AND r.worker_epoch=(auth.jwt()->>'worker_epoch')::bigint AND r.connection_epoch=l.connection_epoch AND r.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'Identity lease expired before observation' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('observation_id',p_id,'status','worker_observed_unverified','provider_verified',false);
END $$;

CREATE FUNCTION haven.finance_refresh_command(p_action text,p_id uuid,p_lineage uuid,p_candidate uuid,p_proof text,p_response text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.finance_credential_lineages%ROWTYPE; a public.finance_refresh_attempts%ROWTYPE; c public.finance_credential_candidates%ROWTYPE;
 worker uuid; result jsonb; key text; body jsonb; protected_body text; mode text; prior public.finance_credential_revisions%ROWTYPE; access_seconds bigint; refresh_seconds bigint; hard_seconds bigint; hard_at timestamptz; prior_hard_at timestamptz;
BEGIN
 mode:=CASE p_action WHEN 'capture' THEN 'finance_capture' WHEN 'preserve' THEN 'trusted_capture' WHEN 'install' THEN 'finance_install' ELSE 'finance_refresh' END;
 IF p_action NOT IN('claim','start','capture','preserve','install') OR p_action IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'Refresh action identity required'; END IF;
 IF p_action='claim' THEN
  SELECT * INTO l FROM public.finance_credential_lineages WHERE id=p_lineage;
 ELSIF p_action='install' THEN
  SELECT * INTO c FROM public.finance_credential_candidates WHERE id=p_id;
  SELECT * INTO l FROM public.finance_credential_lineages WHERE id=c.lineage_id;
 ELSE
  SELECT * INTO a FROM public.finance_refresh_attempts WHERE id=p_id;
  SELECT * INTO l FROM public.finance_credential_lineages WHERE id=a.lineage_id;
 END IF;
 IF l.id IS NULL THEN RAISE EXCEPTION 'Credential scope unavailable' USING ERRCODE='42501'; END IF;
 worker:=haven.finance_credential_authority(mode,NULL,l.id);
 IF p_action IN('capture','preserve') THEN RETURN haven.capture_finance_candidate(p_candidate,l.id,p_id,p_response,mode,NULL,p_proof); END IF;
 PERFORM haven.lock_finance_credentials(l.organization_id,NULL,l.id,mode);
 SELECT * INTO l FROM public.finance_credential_lineages WHERE id=l.id;
 worker:=haven.finance_credential_authority(mode,NULL,l.id);
 IF l.environment<>'sandbox' THEN RAISE EXCEPTION 'Production credential starts and activation disabled' USING ERRCODE='42501'; END IF;
 IF p_action='claim' THEN
  SELECT * INTO a FROM public.finance_refresh_attempts WHERE id=p_id;
  IF FOUND THEN
   IF a.lineage_id<>l.id OR a.worker_id<>worker OR a.worker_epoch<>(auth.jwt()->>'worker_epoch')::bigint THEN RAISE EXCEPTION 'Refresh identity conflict' USING ERRCODE='23505'; END IF;
   RETURN jsonb_build_object('attempt_id',p_id,'status',a.state,'lease_until',a.lease_until,'credential_returned',false);
  END IF;
  IF l.active_attempt_id IS NOT NULL THEN
   SELECT * INTO a FROM public.finance_refresh_attempts WHERE id=l.active_attempt_id FOR UPDATE;
   PERFORM haven.finance_credential_authority(mode,NULL,l.id);
   IF a.state='claimed' AND a.lease_until<=clock_timestamp() THEN
    UPDATE public.finance_refresh_attempts SET state='expired_unstarted' WHERE id=a.id;
    UPDATE public.finance_credential_lineages SET active_attempt_id=NULL,state='ready' WHERE id=l.id;
    l.active_attempt_id:=NULL; l.state:='ready';
    PERFORM haven.finance_credential_event(l.organization_id,l.id,'claim_expired_unstarted',jsonb_build_object('attempt_id',a.id),jsonb_build_object('status','expired_unstarted'));
   ELSE
    IF a.started_at IS NOT NULL AND a.lease_until<=clock_timestamp() THEN
     UPDATE public.finance_refresh_attempts SET state='refresh_outcome_unknown' WHERE id=a.id;
     UPDATE public.finance_credential_lineages SET state='refresh_outcome_unknown' WHERE id=l.id;
    END IF;
    RETURN jsonb_build_object('status','blocked_existing_attempt','attempt_id',a.id,'credential_returned',false);
   END IF;
  END IF;
  IF NOT haven.finance_credential_usable(l.id) OR NOT haven.finance_identity_current(l.current_candidate_id) OR l.state IN('refresh_outcome_unknown','reauthorization_required') THEN RAISE EXCEPTION 'Credential start prerequisites are blocked' USING ERRCODE='42501'; END IF;
  INSERT INTO public.finance_refresh_attempts(id,lineage_id,worker_id,worker_epoch,connection_epoch,fence_epoch,input_revision,context_sha256,state,lease_until)
  VALUES(p_id,l.id,worker,(auth.jwt()->>'worker_epoch')::bigint,l.connection_epoch,l.fence_epoch,l.credential_revision,haven.finance_credential_context(l.id),'claimed',clock_timestamp()+interval '60 seconds');
  PERFORM haven.finance_credential_authority(mode,NULL,l.id);
  UPDATE public.finance_credential_lineages SET active_attempt_id=p_id,state='claimed' WHERE id=l.id;
  result:=jsonb_build_object('attempt_id',p_id,'status','claimed','lease_until',(SELECT lease_until FROM public.finance_refresh_attempts WHERE id=p_id),'input_revision',l.credential_revision::text,'connection_epoch',l.connection_epoch::text,'credential_returned',false);
 ELSIF p_action='start' THEN
  SELECT * INTO a FROM public.finance_refresh_attempts WHERE id=p_id FOR UPDATE;
  PERFORM haven.finance_credential_authority(mode,NULL,l.id);
  IF a.worker_id<>worker OR a.worker_epoch<>(auth.jwt()->>'worker_epoch')::bigint THEN RAISE EXCEPTION 'Original worker required' USING ERRCODE='42501'; END IF;
  IF a.started_at IS NOT NULL THEN
   IF a.state='installed' THEN RETURN jsonb_build_object('attempt_id',p_id,'status','installed_receipt','credential_returned',false); END IF;
   IF l.active_attempt_id=a.id THEN UPDATE public.finance_credential_lineages SET state='refresh_outcome_unknown' WHERE id=l.id; END IF;
   IF a.state<>'installed' THEN UPDATE public.finance_refresh_attempts SET state='refresh_outcome_unknown' WHERE id=a.id; END IF;
   RETURN jsonb_build_object('attempt_id',p_id,'status','refresh_outcome_unknown','credential_returned',false);
  END IF;
  IF a.state<>'claimed' OR a.lease_until<=clock_timestamp() OR l.active_attempt_id IS DISTINCT FROM p_id OR a.connection_epoch<>l.connection_epoch OR a.fence_epoch<>l.fence_epoch OR a.input_revision<>l.credential_revision OR a.context_sha256<>haven.finance_credential_context(l.id)
   OR NOT haven.finance_credential_usable(l.id) OR NOT haven.finance_identity_current(l.current_candidate_id) THEN RAISE EXCEPTION 'Refresh claim is no longer startable' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.finance_credential_candidates WHERE id=l.current_candidate_id;
  BEGIN body:=haven.finance_vault_read(c.vault_secret_id)::jsonb;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Current credential unavailable' USING ERRCODE='55000',DETAIL='',HINT=''; END;
  PERFORM haven.finance_credential_authority(mode,NULL,l.id);
  IF NOT haven.finance_identity_current(l.current_candidate_id) OR a.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Refresh authority expired while reading credential' USING ERRCODE='42501'; END IF;
  key:=gen_random_uuid()::text;
  UPDATE public.finance_refresh_attempts SET state='started',started_at=clock_timestamp(),completion_proof_sha256=encode(sha256(convert_to(key,'UTF8')),'hex') WHERE id=p_id;
  UPDATE public.finance_credential_lineages SET state='started' WHERE id=l.id;
  PERFORM haven.finance_credential_event(l.organization_id,l.id,'refresh_started',jsonb_build_object('attempt_id',p_id),jsonb_build_object('status','started','credential_returned_once',true));
  PERFORM haven.finance_credential_authority(mode,NULL,l.id);
  IF a.lease_until<=clock_timestamp() OR NOT haven.finance_credential_usable(l.id) OR NOT haven.finance_identity_current(l.current_candidate_id) THEN RAISE EXCEPTION 'Refresh authority expired before delivery' USING ERRCODE='42501'; END IF;
  PERFORM set_config('response.headers','[{"Cache-Control":"no-store"},{"Pragma":"no-cache"}]',true);
  RETURN jsonb_build_object('attempt_id',p_id,'lineage_id',l.id,'environment',l.environment,'company_reference',l.company_reference,'client_identity_sha256',l.client_identity_sha256,'app_config_sha256',l.app_config_sha256,'connection_epoch',l.connection_epoch::text,'input_revision',a.input_revision::text,'status','started','completion_proof',key,'credential',jsonb_build_object('access_token',body->>'access_token','refresh_token',body->>'refresh_token'),'provider_verified',false,'financial_dispatch_enabled',false);
 ELSE
  SELECT * INTO c FROM public.finance_credential_candidates WHERE id=p_id;
  SELECT * INTO prior FROM public.finance_credential_revisions WHERE candidate_id=p_id;
  IF FOUND THEN RETURN jsonb_build_object('candidate_id',p_id,'status','installed_receipt','revision',prior.revision::text,'credential_returned',false); END IF;
  IF c.attempt_id IS NOT NULL THEN SELECT * INTO a FROM public.finance_refresh_attempts WHERE id=c.attempt_id FOR UPDATE; END IF;
  PERFORM haven.finance_credential_authority(mode,NULL,l.id);
  IF NOT haven.finance_credential_connection_live(l.id) OR c.connection_epoch<>l.connection_epoch OR c.fence_epoch<>l.fence_epoch OR c.input_revision<>l.credential_revision OR c.context_sha256<>haven.finance_credential_context(l.id)
   OR (c.attempt_id IS NULL AND l.active_attempt_id IS NOT NULL)
   OR (c.attempt_id IS NOT NULL AND (l.state<>'candidate_pending' OR a.state<>'captured' OR a.lease_until<=clock_timestamp() OR l.active_attempt_id IS DISTINCT FROM c.attempt_id OR a.worker_id<>worker OR a.worker_epoch<>(auth.jwt()->>'worker_epoch')::bigint))
   OR c.origin='trusted_late_response' OR NOT haven.finance_identity_current(c.id) THEN
   RETURN jsonb_build_object('candidate_id',p_id,'status','quarantined_stale_or_unverified','credential_returned',false);
  END IF;
  protected_body:=haven.finance_vault_read(c.vault_secret_id);
  PERFORM haven.finance_credential_authority(mode,NULL,l.id);
  BEGIN
   body:=protected_body::jsonb;
   IF jsonb_typeof(body) IS DISTINCT FROM 'object' OR jsonb_typeof(body->'access_token') IS DISTINCT FROM 'string' OR length(body->>'access_token') NOT BETWEEN 1 AND 16384
    OR jsonb_typeof(body->'refresh_token') IS DISTINCT FROM 'string' OR length(body->>'refresh_token') NOT BETWEEN 1 AND 16384 OR lower(body->>'token_type') IS DISTINCT FROM 'bearer'
    OR jsonb_typeof(body->'expires_in') IS DISTINCT FROM 'number' OR body->>'expires_in' !~ '^[1-9][0-9]{0,8}$'
    OR jsonb_typeof(body->'x_refresh_token_expires_in') IS DISTINCT FROM 'number' OR body->>'x_refresh_token_expires_in' !~ '^[1-9][0-9]{0,8}$'
    OR (body ? 'x_refresh_token_hard_expires_in' AND (jsonb_typeof(body->'x_refresh_token_hard_expires_in') IS DISTINCT FROM 'number' OR body->>'x_refresh_token_hard_expires_in' !~ '^[1-9][0-9]{0,8}$')) THEN RAISE EXCEPTION 'Invalid'; END IF;
   access_seconds:=(body->>'expires_in')::bigint; refresh_seconds:=(body->>'x_refresh_token_expires_in')::bigint; hard_seconds:=(body->>'x_refresh_token_hard_expires_in')::bigint;
  EXCEPTION WHEN OTHERS THEN
   PERFORM haven.finance_credential_authority(mode,NULL,l.id);
   PERFORM haven.finance_credential_event(l.organization_id,l.id,'candidate_invalid',jsonb_build_object('candidate_id',p_id),jsonb_build_object('status','quarantined_invalid_response'));
   RETURN jsonb_build_object('candidate_id',p_id,'status','quarantined_invalid_response','credential_returned',false);
  END;
  PERFORM haven.finance_credential_authority(mode,NULL,l.id);
  SELECT min(r.hard_expires_at) INTO prior_hard_at FROM public.finance_credential_revisions r WHERE r.lineage_id=l.id AND r.connection_epoch=l.connection_epoch;
  hard_at:=least(prior_hard_at,CASE WHEN hard_seconds IS NULL THEN NULL ELSE coalesce(a.started_at,c.captured_at)+make_interval(secs=>hard_seconds::double precision) END);
  IF NOT haven.finance_identity_current(c.id) OR (hard_at IS NOT NULL AND hard_at<=clock_timestamp()) OR coalesce(a.started_at,c.captured_at)+make_interval(secs=>access_seconds::double precision)<=clock_timestamp()
   OR (a.id IS NOT NULL AND a.lease_until<=clock_timestamp()) THEN RETURN jsonb_build_object('candidate_id',p_id,'status','quarantined_expired','credential_returned',false); END IF;
  INSERT INTO public.finance_credential_revisions(lineage_id,revision,candidate_id,connection_epoch,access_expires_at,refresh_expires_at,hard_expires_at)
  VALUES(l.id,l.credential_revision+1,c.id,l.connection_epoch,coalesce(a.started_at,c.captured_at)+make_interval(secs=>access_seconds::double precision),coalesce(a.started_at,c.captured_at)+make_interval(secs=>refresh_seconds::double precision),hard_at);
  PERFORM haven.finance_credential_authority(mode,NULL,l.id);
  IF NOT haven.finance_identity_current(c.id) OR (hard_at IS NOT NULL AND hard_at<=clock_timestamp()) OR coalesce(a.started_at,c.captured_at)+make_interval(secs=>least(access_seconds,refresh_seconds)::double precision)<=clock_timestamp() OR (a.id IS NOT NULL AND a.lease_until<=clock_timestamp()) THEN RAISE EXCEPTION 'Credential identity or lifetime authority changed' USING ERRCODE='42501'; END IF;
  UPDATE public.finance_credential_lineages SET credential_revision=credential_revision+1,current_candidate_id=c.id,active_attempt_id=NULL,state='ready' WHERE id=l.id AND credential_revision=c.input_revision AND connection_epoch=c.connection_epoch AND fence_epoch=c.fence_epoch;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credential install compare-and-swap lost' USING ERRCODE='40001'; END IF;
  IF c.attempt_id IS NOT NULL THEN UPDATE public.finance_refresh_attempts SET state='installed' WHERE id=c.attempt_id; END IF;
  result:=jsonb_build_object('candidate_id',p_id,'status','installed_sandbox','revision',(l.credential_revision+1)::text,'provider_verified',false,'credential_returned',false);
 END IF;
 PERFORM haven.finance_credential_event(l.organization_id,l.id,'refresh_'||p_action,jsonb_build_object('attempt_id',CASE WHEN p_action='install' THEN c.attempt_id ELSE p_id END,'candidate_id',CASE WHEN p_action='install' THEN p_id ELSE NULL END),result);
 PERFORM haven.finance_credential_authority(mode,NULL,l.id);
 IF p_action='install' AND (NOT haven.finance_credential_connection_live(l.id) OR NOT haven.finance_identity_current(c.id) OR (hard_at IS NOT NULL AND hard_at<=clock_timestamp()) OR coalesce(a.started_at,c.captured_at)+make_interval(secs=>least(access_seconds,refresh_seconds)::double precision)<=clock_timestamp() OR (a.id IS NOT NULL AND a.lease_until<=clock_timestamp())) THEN RAISE EXCEPTION 'Credential lifetime expired before activation' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION haven.finance_credential_status(p_entity uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.finance_connection_bindings%ROWTYPE; l public.finance_credential_lineages%ROWTYPE;
BEGIN
 PERFORM haven.finance_credential_authority('human',p_entity,NULL);
 SELECT * INTO b FROM public.finance_connection_bindings WHERE entity_id=p_entity;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_configured','financial_dispatch_enabled',false,'production_credential_starts_enabled',false); END IF;
 SELECT * INTO l FROM public.finance_credential_lineages WHERE id=b.lineage_id;
 RETURN jsonb_build_object('entity_id',p_entity,'lineage_id',l.id,'connection_id',b.connection_id,'provider',l.provider,'environment',l.environment,'company_reference',l.company_reference,'client_identity_sha256',l.client_identity_sha256,'app_config_sha256',l.app_config_sha256,
  'connection_epoch',l.connection_epoch::text,'fence_epoch',l.fence_epoch::text,'credential_revision',l.credential_revision::text,'stopped',l.stopped,'status',l.state,
  'active_attempt',(SELECT jsonb_build_object('id',id,'state',CASE WHEN started_at IS NOT NULL AND lease_until<=clock_timestamp() AND state<>'installed' THEN 'refresh_outcome_unknown' ELSE state END,'lease_until',lease_until) FROM public.finance_refresh_attempts WHERE id=l.active_attempt_id),
  'candidates',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'origin',c.origin,'status',CASE WHEN r.revision IS NULL THEN 'quarantined' ELSE 'installed_revision' END,'revision',r.revision::text) ORDER BY c.captured_at,c.id),'[]') FROM public.finance_credential_candidates c LEFT JOIN public.finance_credential_revisions r ON r.candidate_id=c.id WHERE c.lineage_id=l.id),
  'binding_verified',false,'vault_encryption_acceptance',false,'issuer_gateway_verified',false,'restore_reconciliation_verified',false,'financial_dispatch_enabled',false,'production_credential_starts_enabled',false);
END $$;

CREATE FUNCTION public.finance_credential_control(p_request_id uuid,p_entity uuid,p_action text,p_data jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.finance_credential_admin(p_request_id,p_entity,p_action,p_data,NULL) $$;
CREATE FUNCTION public.seed_finance_credential_candidate(p_id uuid,p_entity uuid,p_lineage uuid,p_connection_epoch bigint,p_input_revision bigint,p_response text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.seed_finance_credential(p_id,p_entity,p_lineage,p_connection_epoch,p_input_revision,p_response) $$;
CREATE FUNCTION public.finance_credential_status(p_entity uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.finance_credential_status(p_entity) $$;
CREATE FUNCTION public.claim_finance_refresh(p_id uuid,p_lineage uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.finance_refresh_command('claim',p_id,p_lineage,NULL,NULL,NULL) $$;
CREATE FUNCTION public.start_finance_refresh(p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.finance_refresh_command('start',p_id,NULL,NULL,NULL,NULL) $$;
CREATE FUNCTION public.capture_finance_refresh_candidate(p_id uuid,p_candidate uuid,p_proof text,p_response text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.finance_refresh_command('capture',p_id,NULL,p_candidate,p_proof,p_response) $$;
CREATE FUNCTION public.preserve_finance_refresh_candidate(p_id uuid,p_candidate uuid,p_proof text,p_response text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.finance_refresh_command('preserve',p_id,NULL,p_candidate,p_proof,p_response) $$;
CREATE FUNCTION public.install_finance_credential_candidate(p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.finance_refresh_command('install',p_id,NULL,NULL,NULL,NULL) $$;
CREATE FUNCTION public.read_finance_credential_identity(p_id uuid,p_candidate uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.read_finance_identity(p_id,p_candidate) $$;
CREATE FUNCTION public.observe_finance_credential_identity(p_id uuid,p_candidate uuid,p_company text,p_client_sha256 text,p_host text,p_evidence_sha256 text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.observe_finance_credential(p_id,p_candidate,p_company,p_client_sha256,p_host,p_evidence_sha256) $$;

DO $$ DECLARE fn regprocedure; BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
 (n.nspname='haven' AND p.proname IN('finance_worker_actor','finance_credential_authority','lock_finance_credentials','finance_credential_context','finance_credential_connection_live','finance_credential_usable','require_finance_vault','finance_vault_read','finance_vault_create','finance_credential_event','finance_credential_admin','finance_identity_current','capture_finance_candidate','seed_finance_credential','observe_finance_credential','read_finance_identity','finance_refresh_command','finance_credential_status'))
 OR (n.nspname='public' AND p.proname IN('finance_credential_control','seed_finance_credential_candidate','finance_credential_status','claim_finance_refresh','start_finance_refresh','capture_finance_refresh_candidate','preserve_finance_refresh_candidate','install_finance_credential_candidate','observe_finance_credential_identity','read_finance_credential_identity')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,haven_finance_worker',fn);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.finance_credential_control(uuid,uuid,text,jsonb),public.seed_finance_credential_candidate(uuid,uuid,uuid,bigint,bigint,text),public.finance_credential_status(uuid),
 haven.finance_credential_admin(uuid,uuid,text,jsonb,text),haven.seed_finance_credential(uuid,uuid,uuid,bigint,bigint,text),haven.finance_credential_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_finance_refresh(uuid,uuid),public.start_finance_refresh(uuid),public.capture_finance_refresh_candidate(uuid,uuid,text,text),public.install_finance_credential_candidate(uuid),public.observe_finance_credential_identity(uuid,uuid,text,text,text,text),
 public.read_finance_credential_identity(uuid,uuid),haven.read_finance_identity(uuid,uuid),haven.finance_refresh_command(text,uuid,uuid,uuid,text,text),haven.observe_finance_credential(uuid,uuid,text,text,text,text) TO haven_finance_worker;
GRANT EXECUTE ON FUNCTION public.preserve_finance_refresh_candidate(uuid,uuid,text,text),haven.finance_refresh_command(text,uuid,uuid,uuid,text,text) TO service_role;

-- Preserve329 human/anonymous/service behavior; special worker scope is limited
-- to these exact POST endpoints. Gateway signature verification is external.
CREATE OR REPLACE FUNCTION public.haven_assert_authorized_request() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb:=auth.jwt(); purpose text;
BEGIN
 IF c->>'role'='haven_finance_worker' OR current_setting('role',true)='haven_finance_worker' THEN
  IF current_setting('request.method',true) IS DISTINCT FROM 'POST' THEN RAISE EXCEPTION 'Finance worker endpoint denied' USING ERRCODE='42501'; END IF;
  purpose:=CASE current_setting('request.path',true)
   WHEN '/rpc/claim_finance_refresh' THEN 'finance_refresh'
   WHEN '/rpc/start_finance_refresh' THEN 'finance_refresh'
   WHEN '/rpc/capture_finance_refresh_candidate' THEN 'finance_capture'
   WHEN '/rpc/install_finance_credential_candidate' THEN 'finance_install'
   WHEN '/rpc/read_finance_credential_identity' THEN 'finance_identity'
   WHEN '/rpc/observe_finance_credential_identity' THEN 'finance_identity' END;
  IF purpose IS NULL THEN RAISE EXCEPTION 'Finance worker endpoint denied' USING ERRCODE='42501'; END IF;
  PERFORM haven.finance_worker_actor(purpose);
  RETURN;
 END IF;
 IF c->>'role' IS DISTINCT FROM 'authenticated' THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM haven.current_authorized_actor()) THEN
  RAISE SQLSTATE 'PGRST' USING MESSAGE=json_build_object('code','HAVEN_AUTHORIZATION_STALE','message','Sign in again to continue.','details','The Haven account, session, or authorization state is no longer current.','hint',NULL)::text,
   DETAIL=json_build_object('status',401,'status_text','Unauthorized','headers',json_build_object())::text;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.haven_assert_authorized_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.haven_assert_authorized_request() TO anon,authenticated,service_role,haven_finance_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
