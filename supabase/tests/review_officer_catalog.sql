-- Officer capability catalog (migration 339) probes. Native scratch-only; fixtures roll back.
-- Runs after all migrations via scripts/pg-verify-migrations.mjs (review_*.sql filter).
-- Tripwire for the 308 sweep: the doors must stay service_role-only.
BEGIN;

-- ---------------------------------------------------------------------------
-- Posture: RLS on every officer table, no client privilege anywhere, doors to
-- service_role only, registry empty, key disabled, stand_up_command untouched.
-- ---------------------------------------------------------------------------
DO $$ DECLARE r record; BEGIN
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='officer' AND c.relkind='r') <> 7 THEN
    RAISE EXCEPTION 'officer schema must hold exactly seven tables'; END IF;
  FOR r IN SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='officer' AND c.relkind='r' LOOP
    IF NOT r.relrowsecurity THEN RAISE EXCEPTION 'officer.% has no row level security', r.relname; END IF;
    IF has_table_privilege('anon','officer.'||r.relname,'SELECT') OR has_table_privilege('authenticated','officer.'||r.relname,'SELECT')
       OR has_table_privilege('service_role','officer.'||r.relname,'SELECT') OR has_table_privilege('service_role','officer.'||r.relname,'INSERT') THEN
      RAISE EXCEPTION 'officer.% is readable or writable by a client role', r.relname; END IF;
  END LOOP;
  IF has_schema_privilege('anon','officer','USAGE') OR has_schema_privilege('authenticated','officer','USAGE') OR has_schema_privilege('service_role','officer','USAGE') THEN
    RAISE EXCEPTION 'officer schema usage leaked to a client role'; END IF;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='officer' LOOP
    IF has_function_privilege('anon',r.sig,'EXECUTE') OR has_function_privilege('authenticated',r.sig,'EXECUTE') OR has_function_privilege('service_role',r.sig,'EXECUTE') THEN
      RAISE EXCEPTION 'private function % is executable by a client role', r.sig; END IF;
  END LOOP;
  -- 308 tripwire: both doors and both helpers service_role-only.
  IF has_function_privilege('anon','public.officer_execute(text,uuid,text,text,text,uuid,timestamptz,text,integer,jsonb,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.officer_execute(text,uuid,text,text,text,uuid,timestamptz,text,integer,jsonb,text,jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.officer_execute(text,uuid,text,text,text,uuid,timestamptz,text,integer,jsonb,text,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.officer_catalog(text)','EXECUTE')
     OR has_function_privilege('authenticated','public.officer_catalog(text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.officer_catalog(text)','EXECUTE')
     OR has_function_privilege('anon','public.officer_key_secret_env(text)','EXECUTE')
     OR has_function_privilege('authenticated','public.officer_key_secret_env(text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.officer_key_secret_env(text)','EXECUTE')
     OR has_function_privilege('anon','public.officer_record_refusal(text,uuid,text,integer,uuid,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.officer_record_refusal(text,uuid,text,integer,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.officer_record_refusal(text,uuid,text,integer,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'officer door grants incorrect (308 sweep would regrant to authenticated)'; END IF;
  IF (SELECT count(*) FROM officer.federated_officers) <> 0 THEN RAISE EXCEPTION 'registry must ship empty'; END IF;
  IF (SELECT enabled FROM officer.gateway_keys WHERE key_id='front_office_v1') THEN RAISE EXCEPTION 'front_office_v1 must ship disabled'; END IF;
  IF (SELECT count(*) FROM officer.capabilities WHERE enabled) <> 6 OR EXISTS (SELECT 1 FROM officer.capabilities WHERE phi_class <> 'none') THEN
    RAISE EXCEPTION 'catalog seed unexpected'; END IF;
  IF (SELECT coverage FROM officer.facility_coverage WHERE facility_id='00000000-0000-0000-0002-000000000003') <> 'live'
     OR (SELECT count(*) FROM officer.facility_coverage WHERE coverage='demo') <> 4 THEN RAISE EXCEPTION 'facility coverage seed unexpected'; END IF;
  IF NOT has_function_privilege('authenticated','haven.stand_up_command(text,jsonb)','EXECUTE')
     OR has_function_privilege('anon','haven.stand_up_command(text,jsonb)','EXECUTE')
     OR has_function_privilege('service_role','haven.stand_up_command(text,jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.stand_up_command(text,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.stand_up_command(text,jsonb)','EXECUTE')
     OR has_function_privilege('service_role','public.stand_up_command(text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'stand_up_command grants changed'; END IF;
END $$;

-- Client roles cannot reach the tables or the doors at runtime either.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM count(*) FROM officer.audit_events; RAISE EXCEPTION 'authenticated read officer.audit_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.officer_catalog('front_office_v1'); RAISE EXCEPTION 'authenticated executed officer_catalog';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.officer_execute('front_office_v1',gen_random_uuid(),'x@example.invalid','cfo','session',gen_random_uuid(),now(),'occupied_beds',1,'{"facility":"all"}'::jsonb,repeat('0',64),NULL);
    RAISE EXCEPTION 'authenticated executed officer_execute';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.officer_execute('front_office_v1',gen_random_uuid(),'x@example.invalid','cfo','session',gen_random_uuid(),now(),'occupied_beds',1,'{"facility":"all"}'::jsonb,repeat('0',64),NULL);
    RAISE EXCEPTION 'anon executed officer_execute';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- service_role reaches the door but not the tables behind it.
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN PERFORM count(*) FROM officer.gateway_keys; RAISE EXCEPTION 'service_role read officer.gateway_keys directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.officer_catalog('front_office_v1'); RAISE EXCEPTION 'disabled key served a catalog';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'key_disabled' THEN RAISE; END IF; END;
  IF public.officer_key_secret_env('front_office_v1') <> '{"secret_env":"OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V1","enabled":false}'::jsonb THEN
    RAISE EXCEPTION 'key secret env lookup wrong'; END IF;
  IF public.officer_key_secret_env('nobody') IS NOT NULL THEN RAISE EXCEPTION 'unknown key must be null'; END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Fixture: the seeded COL organization and its five facilities (slugs map to
-- fixed UUIDs), four registry rows. Synthetic rows only; rolled back.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE oc AS SELECT
  '00000000-0000-0000-0000-000000000001'::uuid org,
  '00000000-0000-0000-0002-000000000004'::uuid plantation, '00000000-0000-0000-0001-000000000004'::uuid plantation_entity,
  '00000000-0000-0000-0002-000000000005'::uuid grande, '00000000-0000-0000-0002-000000000003'::uuid homewood,
  gen_random_uuid() cfo, gen_random_uuid() coo, gen_random_uuid() ceo, gen_random_uuid() ctdo, gen_random_uuid() stranger,
  gen_random_uuid() reporter, gen_random_uuid() resident_a, repeat('a',64) chash;
DO $$ BEGIN IF (SELECT count(*) FROM public.facilities f, oc WHERE f.organization_id=oc.org AND f.deleted_at IS NULL AND f.id IN (oc.plantation,oc.grande,oc.homewood)) <> 3 THEN RAISE EXCEPTION 'Seeded COL facilities required'; END IF; END $$;
INSERT INTO officer.federated_officers(front_office_profile_id,officer_role,email,organization_id,is_active,created_by)
  SELECT cfo,'cfo','cfo@probe.invalid',org,true,'review probe' FROM oc
  UNION ALL SELECT ceo,'ceo','ceo@probe.invalid',org,true,'review probe' FROM oc
  UNION ALL SELECT ctdo,'ctdo','ctdo@probe.invalid',org,true,'review probe' FROM oc
  UNION ALL SELECT coo,'coo','coo@probe.invalid',org,false,'review probe' FROM oc;

CREATE FUNCTION pg_temp.run(p_officer uuid,p_email text,p_role text,p_assurance text,p_cap text,p_version int,p_args jsonb,p_intent jsonb DEFAULT NULL,p_nonce uuid DEFAULT NULL,p_sent timestamptz DEFAULT NULL,p_key text DEFAULT 'front_office_v1')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.officer_execute(p_key,p_officer,p_email,p_role,p_assurance,COALESCE(p_nonce,gen_random_uuid()),COALESCE(p_sent,now()),p_cap,p_version,p_args,(SELECT chash FROM oc),p_intent)
$$;
-- Shorthand: the active cfo reading a capability.
CREATE FUNCTION pg_temp.cfo(p_cap text,p_args jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session',p_cap,1,p_args)
$$;
CREATE FUNCTION pg_temp.expect(p_label text,p_state text,p_code text,p_officer uuid,p_email text,p_role text,p_assurance text,p_cap text,p_version int,p_args jsonb,p_intent jsonb DEFAULT NULL,p_nonce uuid DEFAULT NULL,p_sent timestamptz DEFAULT NULL,p_key text DEFAULT 'front_office_v1')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.run(p_officer,p_email,p_role,p_assurance,p_cap,p_version,p_args,p_intent,p_nonce,p_sent,p_key);
  RAISE EXCEPTION '%: call was accepted', p_label;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%: call was accepted' THEN RAISE; END IF;
  IF SQLSTATE <> p_state OR SQLERRM <> p_code THEN RAISE EXCEPTION '%: expected % % got % %', p_label, p_state, p_code, SQLSTATE, SQLERRM; END IF;
END $$;
-- Every key in a JSON document, recursively.
CREATE FUNCTION pg_temp.all_keys(p jsonb) RETURNS SETOF text LANGUAGE sql AS $$
  WITH RECURSIVE walk(v) AS (
    SELECT p
    UNION ALL
    SELECT c.v FROM walk w, LATERAL (
      SELECT value AS v FROM jsonb_each(CASE WHEN jsonb_typeof(w.v)='object' THEN w.v ELSE '{}'::jsonb END)
      UNION ALL
      SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.v)='array' THEN w.v ELSE '[]'::jsonb END)
    ) c
  ) SELECT jsonb_object_keys(v) FROM walk WHERE jsonb_typeof(v)='object'
$$;
-- Contract checks every read must satisfy: exact top-level keys, no forbidden identifier key, bounded data.
CREATE FUNCTION pg_temp.check_read(p_label text,r jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE keys text[]; expected text[] := ARRAY['as_of','audit_id','capability','data','freshness','generated_at','kind','missing','ok','qualifiers','unit','validity','value','version']; BEGIN
  SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(r) k;
  IF keys <> expected THEN RAISE EXCEPTION '%: envelope keys %', p_label, keys; END IF;
  IF r->>'kind'<>'read' OR r->'freshness'->>'state'<>'current' OR r->>'validity' NOT IN ('valid','no_data','invalid') THEN RAISE EXCEPTION '%: envelope fields %', p_label, r; END IF;
  IF (r->>'validity'='valid') <> (jsonb_typeof(r->'value')='number') THEN RAISE EXCEPTION '%: value must be a number exactly when valid: %', p_label, r; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.all_keys(r) k WHERE k ~ '(^|_)(name|first|last|dob|ssn|email|phone|address|mrn|resident_id|employee_id|person_id)$') THEN RAISE EXCEPTION '%: forbidden key in envelope', p_label; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(r->'data') d WHERE jsonb_typeof(d.value) NOT IN ('number','boolean','string','array') OR (jsonb_typeof(d.value)='string' AND length(d.value #>> '{}')>80) OR (jsonb_typeof(d.value)='array' AND jsonb_array_length(d.value)>50)) THEN RAISE EXCEPTION '%: data bounds violated', p_label; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE (SELECT count(*) FROM jsonb_object_keys(e))>8 OR EXISTS (SELECT 1 FROM jsonb_each(e) f WHERE jsonb_typeof(f.value) NOT IN ('number','boolean','string'))) THEN RAISE EXCEPTION '%: by_facility row bounds violated', p_label; END IF;
  IF NOT EXISTS (SELECT 1 FROM officer.audit_events a WHERE a.id=(r->>'audit_id')::uuid AND a.outcome='ok' AND a.capability=r->>'capability' AND a.args_sha256 IS NOT NULL) THEN RAISE EXCEPTION '%: audit row missing', p_label; END IF;
END $$;
CREATE FUNCTION pg_temp.fac(r jsonb,p_slug text) RETURNS jsonb LANGUAGE sql AS $$ SELECT e FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'slug'=p_slug $$;

-- Disabled key refuses before anything else.
SELECT pg_temp.expect('disabled key','42501','key_disabled',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"all"}');
UPDATE officer.gateway_keys SET enabled=true WHERE key_id='front_office_v1';

-- Catalog shape.
DO $$ DECLARE c jsonb; ping jsonb; BEGIN
  c := public.officer_catalog('front_office_v1');
  IF c->>'target'<>'haven' OR c->>'contract'<>'front-office-capability-v1' OR jsonb_array_length(c->'capabilities')<>6 OR c->>'catalog_version' IS NULL THEN RAISE EXCEPTION 'catalog header wrong'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(c->'capabilities') e WHERE e->>'phi_class'<>'none' OR jsonb_array_length(e->'synonyms')=0 OR e->>'assurance'<>'session') THEN RAISE EXCEPTION 'catalog entry wrong'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(c->'capabilities') e WHERE e->>'kind'='read' AND NOT (e->'params' @> '[{"name":"facility","required":true}]'::jsonb)) THEN RAISE EXCEPTION 'every read must require facility'; END IF;
  IF (SELECT e->'params'->0->'enum' FROM jsonb_array_elements(c->'capabilities') e WHERE e->>'name'='occupied_beds') <> '["all","homewood","oakridge","rising_oaks","plantation","grande_cypress"]'::jsonb THEN RAISE EXCEPTION 'facility enum wrong'; END IF;
  IF (SELECT e->>'meaning' FROM jsonb_array_elements(c->'capabilities') e WHERE e->>'name'='occupancy_rate') NOT ILIKE '%residents with active, hospital hold or leave status over licensed beds%' THEN RAISE EXCEPTION 'occupancy_rate meaning text wrong'; END IF;
  SELECT e INTO ping FROM jsonb_array_elements(c->'capabilities') e WHERE e->>'name'='ping';
  IF ping->>'kind'<>'command' OR (ping->>'requires_confirmation')::boolean IS DISTINCT FROM true OR jsonb_array_length(ping->'effects')<>1 OR ping->>'verb_phrase'<>'record the test note in Circle of Life' THEN RAISE EXCEPTION 'ping catalog entry wrong'; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.all_keys(c) k WHERE k ~ '(^|_)(name|first|last|dob|ssn|email|phone|address|mrn|resident_id|employee_id|person_id)$' AND k<>'name') THEN RAISE EXCEPTION 'forbidden key in catalog'; END IF;
  UPDATE officer.gateway_keys SET allowed_capabilities=ARRAY['occupied_beds'] WHERE key_id='front_office_v1';
  IF jsonb_array_length(public.officer_catalog('front_office_v1')->'capabilities')<>1 THEN RAISE EXCEPTION 'catalog ignores allowlist'; END IF;
  UPDATE officer.gateway_keys SET allowed_capabilities=ARRAY['occupied_beds','occupancy_rate','ar_open_balance','billed_revenue_mtd','open_incidents','ping'] WHERE key_id='front_office_v1';
END $$;

-- Refusals in contract order.
SELECT pg_temp.expect('unknown officer','42501','principal_unknown',(SELECT stranger FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"all"}');
SELECT pg_temp.expect('email mismatch','42501','principal_unknown',(SELECT cfo FROM oc),'other@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"all"}');
SELECT pg_temp.expect('role mismatch','42501','principal_unknown',(SELECT cfo FROM oc),'cfo@probe.invalid','ceo','session','occupied_beds',1,'{"facility":"all"}');
SELECT pg_temp.expect('inactive officer','42501','principal_inactive',(SELECT coo FROM oc),'coo@probe.invalid','coo','session','occupied_beds',1,'{"facility":"all"}');
UPDATE officer.federated_officers SET is_active=true, valid_until=now()-interval '1 minute' WHERE front_office_profile_id=(SELECT coo FROM oc);
SELECT pg_temp.expect('expired window','42501','principal_inactive',(SELECT coo FROM oc),'coo@probe.invalid','coo','session','occupied_beds',1,'{"facility":"all"}');
SELECT pg_temp.expect('outside allowlist','42501','capability_denied',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','probe_not_allowed',1,'{"facility":"all"}');
SELECT pg_temp.expect('unknown key','42501','key_disabled',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"all"}',NULL,NULL,NULL,'nobody');
SELECT pg_temp.expect('stale version','P0409','version_conflict',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',2,'{"facility":"all"}');
SELECT pg_temp.expect('role not allowed for AR','42501','capability_denied',(SELECT ctdo FROM oc),'ctdo@probe.invalid','ctdo','session','ar_open_balance',1,'{"facility":"all"}');
SELECT pg_temp.expect('missing facility','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}');
SELECT pg_temp.expect('unknown facility slug','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"Homewood Lodge, ALF"}');
SELECT pg_temp.expect('facility by uuid','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"00000000-0000-0000-0002-000000000003"}');
SELECT pg_temp.expect('extra arg','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"all","p_caller_role":"owner"}');
SELECT pg_temp.expect('args not object','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'[]');
SELECT pg_temp.expect('bad month','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','billed_revenue_mtd',1,'{"facility":"all","month":"2026-13-01"}');
SELECT pg_temp.expect('future month','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','billed_revenue_mtd',1,'{"facility":"all","month":"2999-01-01"}');
SELECT pg_temp.expect('intent on a read','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"all"}',jsonb_build_object('intent_id',gen_random_uuid()));
SELECT pg_temp.expect('bad assurance','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','aal9','occupied_beds',1,'{"facility":"all"}');
SELECT pg_temp.expect('old timestamp','P0401','expired_request',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"all"}',NULL,NULL,now()-interval '90 seconds');
SELECT pg_temp.expect('future timestamp','P0401','expired_request',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"all"}',NULL,NULL,now()+interval '90 seconds');
-- mfa capability under session assurance; role outside the allowed list.
INSERT INTO officer.capabilities(name,version,kind,title,description,synonyms,meaning,params,unit,allowed_officer_roles,assurance,phi_class,requires_confirmation)
  VALUES ('probe_mfa_read',1,'read','Probe','Probe.',ARRAY['probe'],'Probe.','[]','beds',ARRAY['cfo'],'mfa','none',false);
UPDATE officer.gateway_keys SET allowed_capabilities=allowed_capabilities||'probe_mfa_read'::text WHERE key_id='front_office_v1';
SELECT pg_temp.expect('mfa under session','42501','assurance_required',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','probe_mfa_read',1,'{}');
SELECT pg_temp.expect('role not allowed','42501','capability_denied',(SELECT ceo FROM oc),'ceo@probe.invalid','ceo','mfa','probe_mfa_read',1,'{}');
-- Replayed nonce.
DO $$ DECLARE n uuid := gen_random_uuid(); BEGIN
  PERFORM pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"all"}',NULL,n);
  PERFORM pg_temp.expect('replayed nonce','23505','replayed_request',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"all"}',NULL,n);
END $$;
DO $$ BEGIN
  IF (SELECT count(*) FROM officer.audit_events WHERE key_id='front_office_v1') <> 1 THEN RAISE EXCEPTION 'refusals wrote audit rows inside the rolled-back call'; END IF;
  IF (SELECT count(*) FROM officer.request_nonces WHERE key_id='front_office_v1') <> 1 THEN RAISE EXCEPTION 'nonce count wrong'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Reads: scope by slug, coverage labels, envelopes, no_data rules.
-- Expectations are deltas against the seeded demo data at The Plantation (004).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE base AS SELECT
  (SELECT count(*) FROM public.residents r, oc WHERE r.facility_id=oc.plantation AND r.organization_id=oc.org AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa')) occ_plantation,
  (SELECT count(*) FROM public.residents r, oc WHERE r.facility_id=oc.grande AND r.organization_id=oc.org AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa')) occ_grande,
  (SELECT count(*) FROM public.residents r, oc JOIN public.facilities f ON f.organization_id=oc.org AND f.deleted_at IS NULL WHERE r.facility_id=f.id AND r.organization_id=oc.org AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa')) occ_all,
  (SELECT total_licensed_beds FROM public.facilities f, oc WHERE f.id=oc.plantation) beds_plantation,
  (SELECT count(*) FROM public.incidents i, oc WHERE i.facility_id=oc.plantation AND i.deleted_at IS NULL AND i.status IN ('open','investigating')) inc_open,
  (SELECT count(*) FROM public.incidents i, oc WHERE i.facility_id=oc.plantation AND i.deleted_at IS NULL AND i.occurred_at >= ((officer.utc_today()-29)::timestamp AT TIME ZONE 'UTC') AND i.occurred_at < ((officer.utc_today()+1)::timestamp AT TIME ZONE 'UTC')) inc_l30,
  (SELECT count(*) FROM public.incidents i, oc WHERE i.facility_id=oc.plantation AND i.deleted_at IS NULL AND i.occurred_at >= ((officer.utc_today()-29)::timestamp AT TIME ZONE 'UTC') AND i.occurred_at < ((officer.utc_today()+1)::timestamp AT TIME ZONE 'UTC') AND i.severity='level_2') inc_l30_l2,
  (SELECT count(*) FROM public.incidents i, oc WHERE i.facility_id=oc.plantation AND i.deleted_at IS NULL AND i.ahca_reportable AND NOT i.ahca_reported) inc_ahca;

INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status,deleted_at)
  SELECT resident_a,plantation,org,'Probe','One','1940-01-01'::date,'female'::public.gender,'active'::public.resident_status,NULL::timestamptz FROM oc
  UNION ALL SELECT gen_random_uuid(),plantation,org,'Probe','Two','1940-01-01','male','hospital_hold',NULL FROM oc
  UNION ALL SELECT gen_random_uuid(),plantation,org,'Probe','Three','1940-01-01','female','discharged',NULL FROM oc
  UNION ALL SELECT gen_random_uuid(),plantation,org,'Probe','Four','1940-01-01','female','active',now() FROM oc;
-- A resident in another organization must never be counted.
INSERT INTO public.organizations(id,name) VALUES ('00000000-0000-0000-0000-00000000dead','Other Org');
INSERT INTO public.entities(id,organization_id,name) VALUES ('00000000-0000-0000-0001-00000000dead','00000000-0000-0000-0000-00000000dead','Other Entity');
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds) VALUES ('00000000-0000-0000-0002-00000000dead','00000000-0000-0000-0001-00000000dead','00000000-0000-0000-0000-00000000dead','Other Facility','1 Other St','Elsewhere','00000',10);
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status) VALUES (gen_random_uuid(),'00000000-0000-0000-0002-00000000dead','00000000-0000-0000-0000-00000000dead','Other','Org','1940-01-01','female','active');

DO $$ DECLARE r jsonb; b record; BEGIN
  SELECT * INTO b FROM base;
  -- Single facility by slug.
  r := pg_temp.cfo('occupied_beds','{"facility":"plantation"}');
  PERFORM pg_temp.check_read('occupied_beds plantation', r);
  IF r->>'validity'<>'valid' OR (r->>'value')::int<>b.occ_plantation+2 OR r->>'unit'<>'beds' OR (r->'data'->>'facilities_covered')::int<>1 OR jsonb_array_length(r->'data'->'by_facility')<>1 THEN RAISE EXCEPTION 'occupied_beds plantation wrong: %', r; END IF;
  IF pg_temp.fac(r,'plantation')->>'coverage'<>'demo' OR (pg_temp.fac(r,'plantation')->>'value')::int<>b.occ_plantation+2 THEN RAISE EXCEPTION 'plantation row wrong: %', r->'data'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q=officer.demo_qualifier()) THEN RAISE EXCEPTION 'demo qualifier missing for a demo facility'; END IF;
  IF r::text ~ '(Probe One|Probe Two|Other Org|1940)' THEN RAISE EXCEPTION 'person data leaked into envelope'; END IF;
  -- Live facility carries no demo qualifier.
  r := pg_temp.cfo('occupied_beds','{"facility":"homewood"}');
  PERFORM pg_temp.check_read('occupied_beds homewood', r);
  IF pg_temp.fac(r,'homewood')->>'coverage'<>'live' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q=officer.demo_qualifier()) THEN RAISE EXCEPTION 'homewood coverage wrong: %', r; END IF;
  -- Portfolio: five rows, sum matches, other organization excluded.
  r := pg_temp.cfo('occupied_beds','{"facility":"all"}');
  PERFORM pg_temp.check_read('occupied_beds all', r);
  IF (r->>'value')::int<>b.occ_all+2 OR (r->'data'->>'facilities_covered')::int<>5 OR jsonb_array_length(r->'data'->'by_facility')<>5 THEN RAISE EXCEPTION 'occupied_beds all wrong: %', r; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'slug' IN ('homewood','oakridge','rising_oaks','plantation','grande_cypress'))<>5 THEN RAISE EXCEPTION 'slugs missing: %', r->'data'; END IF;
  -- The ceo reads the same figure: scope comes from the registry, not the officer.
  r := pg_temp.run((SELECT ceo FROM oc),'ceo@probe.invalid','ceo','session','occupied_beds',1,'{"facility":"all"}');
  IF (r->>'value')::int<>b.occ_all+2 THEN RAISE EXCEPTION 'organization scope differs by officer'; END IF;
  -- PostgREST hands a JSON null through as jsonb null; a read must treat it as absent.
  r := pg_temp.run((SELECT ceo FROM oc),'ceo@probe.invalid','ceo','session','occupied_beds',1,'{"facility":"all"}','null'::jsonb);
  IF (r->>'value')::int<>b.occ_all+2 THEN RAISE EXCEPTION 'jsonb null intent refused a read'; END IF;

  -- occupancy_rate.
  r := pg_temp.cfo('occupancy_rate','{"facility":"plantation"}');
  PERFORM pg_temp.check_read('occupancy_rate plantation', r);
  IF r->>'unit'<>'percent' OR (r->>'value')::numeric<>round((b.occ_plantation+2)::numeric/b.beds_plantation::numeric*100,1) OR (r->'data'->>'licensed_beds')::int<>b.beds_plantation OR (r->'data'->>'occupied_beds')::int<>b.occ_plantation+2 THEN RAISE EXCEPTION 'occupancy_rate wrong: %', r; END IF;
  UPDATE public.facilities SET total_licensed_beds=0 WHERE id=(SELECT grande FROM oc);
  r := pg_temp.cfo('occupancy_rate','{"facility":"grande_cypress"}');
  PERFORM pg_temp.check_read('occupancy_rate zero beds', r);
  IF r->>'validity'<>'invalid' OR jsonb_typeof(r->'value')<>'null' OR (r->'missing'->>'count')::int<>1 THEN RAISE EXCEPTION 'zero licensed beds must be invalid: %', r; END IF;

  -- Coverage none: single read is no_data; portfolio leaves it out.
  UPDATE officer.facility_coverage SET coverage='none' WHERE facility_id=(SELECT grande FROM oc);
  r := pg_temp.cfo('occupied_beds','{"facility":"grande_cypress"}');
  PERFORM pg_temp.check_read('occupied_beds none', r);
  IF r->>'validity'<>'no_data' OR jsonb_typeof(r->'value')<>'null' OR (r->'data'->>'facilities_covered')::int<>0 OR pg_temp.fac(r,'grande_cypress') ? 'value' THEN RAISE EXCEPTION 'none coverage must be no_data: %', r; END IF;
  r := pg_temp.cfo('occupied_beds','{"facility":"all"}');
  IF (r->>'value')::int<>b.occ_all+2-b.occ_grande OR (r->'data'->>'facilities_covered')::int<>4 OR jsonb_array_length(r->'data'->'by_facility')<>5 OR pg_temp.fac(r,'grande_cypress') ? 'value' THEN RAISE EXCEPTION 'none coverage must be excluded from the portfolio: %', r; END IF;
  UPDATE officer.facility_coverage SET coverage='demo' WHERE facility_id=(SELECT grande FROM oc);

  -- open_incidents zero-or-more is valid; check_read on the live facility too.
  r := pg_temp.cfo('open_incidents','{"facility":"homewood"}');
  PERFORM pg_temp.check_read('open_incidents homewood', r);
  IF r->>'validity'<>'valid' THEN RAISE EXCEPTION 'open_incidents must be valid: %', r; END IF;
END $$;

-- AR and billed revenue: a facility with no invoice rows at all is no_data; with
-- invoices and no open balance a valid zero. Drafts, voided and paid excluded.
UPDATE public.invoices SET deleted_at=now() WHERE facility_id=(SELECT plantation FROM oc) AND deleted_at IS NULL;
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.cfo('ar_open_balance','{"facility":"plantation"}');
  PERFORM pg_temp.check_read('ar no invoices', r);
  IF r->>'validity'<>'no_data' OR jsonb_typeof(r->'value')<>'null' OR r->>'unit'<>'cents' OR (pg_temp.fac(r,'plantation')->>'has_invoices')::boolean OR pg_temp.fac(r,'plantation') ? 'value' THEN RAISE EXCEPTION 'AR without invoices must be no_data: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q ILIKE '%not draft, void, written off or paid%' AND q ILIKE '%due date%')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q ILIKE '%billing AR aging view%' AND q ILIKE '%executive KPI%') THEN RAISE EXCEPTION 'AR qualifiers must state the predicate and both other definitions'; END IF;
  r := pg_temp.cfo('billed_revenue_mtd','{"facility":"plantation"}');
  PERFORM pg_temp.check_read('revenue no invoices', r);
  IF r->>'validity'<>'no_data' THEN RAISE EXCEPTION 'revenue without invoices must be no_data: %', r; END IF;
END $$;
INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,total,balance_due,voided_at)
  SELECT gen_random_uuid(),resident_a,plantation,org,plantation_entity,'PROBE-AR-'||n,'2018-01-01'::date,d,'2018-01-01'::date-n,'2018-01-31'::date,s::public.invoice_status,t,t,bal,v
  FROM oc CROSS JOIN (VALUES
    (1,'sent',10000,10000,officer.utc_today()-45,NULL::timestamptz),
    (2,'draft',2345,2345,officer.utc_today()-45,NULL),
    (3,'sent',500,500,officer.utc_today()-45,now()),
    (4,'paid',9000,0,officer.utc_today()-45,NULL),
    (5,'overdue',700,700,officer.utc_today()-10,NULL),
    (6,'partial',300,300,officer.utc_today()+5,NULL),
    (7,'written_off',400,400,officer.utc_today()-200,NULL)
  ) AS x(n,s,t,bal,d,v);
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.cfo('ar_open_balance','{"facility":"plantation"}');
  PERFORM pg_temp.check_read('ar with invoices', r);
  IF r->>'validity'<>'valid' OR (r->>'value')::bigint<>11000 OR (r->'data'->>'invoice_count')::int<>3
     OR (r->'data'->>'aging_not_past_due_cents')::bigint<>300 OR (r->'data'->>'aging_past_due_1_30_cents')::bigint<>700 OR (r->'data'->>'aging_past_due_31_60_cents')::bigint<>10000
     OR (r->'data'->>'aging_past_due_61_90_cents')::bigint<>0 OR (r->'data'->>'aging_past_due_over_90_cents')::bigint<>0 OR (r->'data'->>'oldest_past_due_days')::int<>45 THEN RAISE EXCEPTION 'ar_open_balance wrong: %', r; END IF;
  IF (pg_temp.fac(r,'plantation')->>'value')::bigint<>11000 OR (pg_temp.fac(r,'plantation')->>'invoice_count')::int<>3 THEN RAISE EXCEPTION 'AR facility row wrong: %', r->'data'; END IF;
  -- Invoices exist but nothing open: valid zero.
  UPDATE public.invoices SET status='paid', balance_due=0 WHERE facility_id=(SELECT plantation FROM oc) AND deleted_at IS NULL AND invoice_number LIKE 'PROBE-AR-%';
  r := pg_temp.cfo('ar_open_balance','{"facility":"plantation"}');
  IF r->>'validity'<>'valid' OR (r->>'value')::bigint<>0 THEN RAISE EXCEPTION 'AR with invoices and no balance must be a valid zero: %', r; END IF;
END $$;
INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,total,balance_due)
  SELECT gen_random_uuid(),resident_a,plantation,org,plantation_entity,'PROBE-REV-'||n,d,d,d,d,s::public.invoice_status,t,t,0
  FROM oc CROSS JOIN (VALUES
    (1,'sent',5000,'2019-03-05'::date),
    (2,'draft',999,'2019-03-20'::date),
    (3,'paid',1500,'2019-03-31'::date),
    (4,'sent',777,'2019-04-01'::date)
  ) AS x(n,s,t,d);
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.cfo('billed_revenue_mtd','{"facility":"plantation","month":"2019-03-15"}');
  PERFORM pg_temp.check_read('revenue march 2019', r);
  IF r->>'validity'<>'valid' OR (r->>'value')::bigint<>6500 OR (r->'data'->>'invoice_count')::int<>2 OR r->'data'->>'period_start'<>'2019-03-01' OR r->'data'->>'period_end'<>'2019-03-31' THEN RAISE EXCEPTION 'billed_revenue_mtd wrong: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q ILIKE '%2019-03-01 through 2019-03-31%' AND q ILIKE '%Drafts are not counted%') THEN RAISE EXCEPTION 'revenue qualifier wrong: %', r; END IF;
  -- Current month with invoices on file but none this month: a valid zero, period ends today.
  r := pg_temp.cfo('billed_revenue_mtd','{"facility":"plantation"}');
  IF r->>'validity'<>'valid' OR (r->>'value')::bigint<>0 OR r->'data'->>'period_end'<>to_char(officer.utc_today(),'YYYY-MM-DD') THEN RAISE EXCEPTION 'current month revenue wrong: %', r; END IF;
  -- The ctdo may not read revenue.
  PERFORM pg_temp.expect('ctdo revenue','42501','capability_denied',(SELECT ctdo FROM oc),'ctdo@probe.invalid','ctdo','session','billed_revenue_mtd',1,'{"facility":"all"}');
END $$;

-- Incidents: open/investigating counted, resolved not; window and AHCA deltas.
INSERT INTO auth.users(id,email) SELECT reporter,reporter||'@probe.invalid' FROM oc;
INSERT INTO public.incidents(id,facility_id,organization_id,incident_number,category,severity,status,occurred_at,shift,location_description,description,immediate_actions,reported_by,ahca_reportable,ahca_reported)
  SELECT gen_random_uuid(),plantation,org,'PROBE-INC-1','fall_without_injury'::public.incident_category,'level_2'::public.incident_severity,'open'::public.incident_status,now()-interval '2 days','day'::public.shift_type,'Probe','Probe description','Probe',reporter,true,false FROM oc
  UNION ALL SELECT gen_random_uuid(),plantation,org,'PROBE-INC-2','fall_without_injury','level_1','investigating',now()-interval '5 days','day','Probe','Probe description','Probe',reporter,false,false FROM oc
  UNION ALL SELECT gen_random_uuid(),plantation,org,'PROBE-INC-3','fall_without_injury','level_1','resolved',now()-interval '40 days','day','Probe','Probe description','Probe',reporter,true,true FROM oc;
DO $$ DECLARE r jsonb; b record; BEGIN
  SELECT * INTO b FROM base;
  r := pg_temp.cfo('open_incidents','{"facility":"plantation"}');
  PERFORM pg_temp.check_read('open_incidents plantation', r);
  IF (r->>'value')::int<>b.inc_open+2 OR (r->'data'->>'last_30_days_total')::int<>b.inc_l30+2 OR (r->'data'->>'last_30_days_level_2')::int<>b.inc_l30_l2+1 OR (r->'data'->>'ahca_reportable_unreported')::int<>b.inc_ahca+1 THEN RAISE EXCEPTION 'open_incidents wrong: %', r; END IF;
  IF (pg_temp.fac(r,'plantation')->>'value')::int<>b.inc_open+2 OR (pg_temp.fac(r,'plantation')->>'ahca_reportable_unreported')::int<>b.inc_ahca+1 THEN RAISE EXCEPTION 'incident facility row wrong: %', r->'data'; END IF;
  IF r::text ~ 'PROBE-INC|Probe description' THEN RAISE EXCEPTION 'incident detail leaked'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Command: ping writes one receipt and one audit row; replay and reuse rules.
-- ---------------------------------------------------------------------------
DO $$ DECLARE intent uuid := gen_random_uuid(); r jsonb; again jsonb; before_audit int; BEGIN
  PERFORM pg_temp.expect('command without intent','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','ping',1,'{}');
  PERFORM pg_temp.expect('command with bad intent id','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','ping',1,'{}','{"intent_id":"not-a-uuid"}');
  SELECT count(*) INTO before_audit FROM officer.audit_events WHERE key_id='front_office_v1';
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','ping',1,'{}',jsonb_build_object('intent_id',intent,'expected_version',NULL));
  IF r->>'kind'<>'command' OR r->>'capability'<>'ping' OR (r->'result'->>'pong')::boolean IS DISTINCT FROM true OR (r->'receipt'->>'replayed')::boolean IS DISTINCT FROM false OR (r->'receipt'->>'intent_id')::uuid<>intent OR r->'result'->>'server_time' IS NULL THEN RAISE EXCEPTION 'ping envelope wrong: %', r; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k) <> ARRAY['capability','kind','ok','receipt','result','version'] THEN RAISE EXCEPTION 'command envelope keys wrong: %', r; END IF;
  IF (SELECT count(*) FROM officer.command_receipts WHERE key_id='front_office_v1' AND intent_id=intent)<>1 THEN RAISE EXCEPTION 'ping must write exactly one receipt'; END IF;
  IF (SELECT count(*) FROM officer.audit_events WHERE key_id='front_office_v1')<>before_audit+1 OR NOT EXISTS (SELECT 1 FROM officer.audit_events WHERE intent_id=intent AND outcome='ok' AND capability='ping') THEN RAISE EXCEPTION 'ping must write exactly one audit row'; END IF;
  again := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','ping',1,'{}',jsonb_build_object('intent_id',intent));
  IF (again->'receipt'->>'replayed')::boolean IS DISTINCT FROM true OR again->'result'<>r->'result' OR again->'receipt'->>'audit_id'<>r->'receipt'->>'audit_id' THEN RAISE EXCEPTION 'ping replay wrong: %', again; END IF;
  IF (SELECT count(*) FROM officer.command_receipts WHERE key_id='front_office_v1' AND intent_id=intent)<>1 THEN RAISE EXCEPTION 'replay wrote a second receipt'; END IF;
  IF NOT EXISTS (SELECT 1 FROM officer.audit_events WHERE intent_id=intent AND outcome='replayed') THEN RAISE EXCEPTION 'replay must audit as replayed'; END IF;
  PERFORM pg_temp.expect('intent reused by another request','22023','idempotency_key_reused',(SELECT ceo FROM oc),'ceo@probe.invalid','ceo','session','ping',1,'{}',jsonb_build_object('intent_id',intent));
  PERFORM pg_temp.expect('intent with different args','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','ping',1,'{"note":"x"}',jsonb_build_object('intent_id',intent));
  IF (SELECT count(*) FROM officer.command_receipts WHERE key_id='front_office_v1')<>1 THEN RAISE EXCEPTION 'refused commands wrote receipts'; END IF;
  IF EXISTS (SELECT 1 FROM public.audit_log WHERE table_name LIKE 'officer%' OR table_name IN ('command_receipts','audit_events')) THEN RAISE EXCEPTION 'ping reached the domain audit log'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Audit immutability, refusal recording, rate limit, nonce pruning.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  BEGIN UPDATE officer.audit_events SET outcome='tampered' WHERE key_id='front_office_v1'; RAISE EXCEPTION 'audit update accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM officer.audit_events WHERE key_id='front_office_v1'; RAISE EXCEPTION 'audit delete accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM officer.command_receipts WHERE key_id='front_office_v1'; RAISE EXCEPTION 'receipt delete accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.officer_record_refusal('front_office_v1',(SELECT cfo FROM oc),'occupied_beds',1,gen_random_uuid(),'principal_unknown');
  IF NOT EXISTS (SELECT 1 FROM officer.audit_events WHERE key_id='front_office_v1' AND outcome='refused' AND error_code='principal_unknown') THEN RAISE EXCEPTION 'refusal not recorded'; END IF;
  PERFORM public.officer_record_refusal('front_office_v1',NULL,'occupied_beds',1,NULL,'select * from residents');
  IF EXISTS (SELECT 1 FROM officer.audit_events WHERE error_code IS NOT NULL AND error_code NOT IN ('principal_unknown')) THEN RAISE EXCEPTION 'unpublished code recorded'; END IF;
END $$;
INSERT INTO officer.audit_events(key_id,outcome) SELECT 'front_office_v1','ok' FROM generate_series(1,60);
SELECT pg_temp.expect('rate limited','P0429','rate_limited',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"all"}');
INSERT INTO officer.gateway_keys(key_id,secret_env,enabled,allowed_capabilities) VALUES ('probe_second','OFFICER_GATEWAY_HMAC_PROBE_SECOND',true,ARRAY['occupied_beds']);
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"homewood"}',NULL,NULL,NULL,'probe_second');
  IF r->>'validity'<>'valid' THEN RAISE EXCEPTION 'second key blocked by first key limit'; END IF;
END $$;
UPDATE officer.request_nonces SET seen_at=now()-interval '16 minutes' WHERE key_id='front_office_v1';
DO $$ BEGIN PERFORM pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"facility":"homewood"}',NULL,NULL,NULL,'probe_second'); END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM officer.request_nonces WHERE key_id='front_office_v1') THEN RAISE EXCEPTION 'stale nonces not pruned'; END IF; END $$;

ROLLBACK;
