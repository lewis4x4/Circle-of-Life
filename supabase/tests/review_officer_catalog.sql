-- Officer capability catalog (migration 339) probes. Native scratch-only; fixtures roll back.
-- Runs after all migrations via scripts/pg-verify-migrations.mjs (review_*.sql filter).
-- Tripwire for the 308 sweep: the doors must stay service_role-only.
BEGIN;

-- ---------------------------------------------------------------------------
-- Posture: RLS on every officer table, no client privilege anywhere, doors to
-- service_role only, registry empty, stand_up_command grants untouched.
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
  IF (SELECT count(*) FROM officer.capabilities WHERE enabled) <> 7 OR EXISTS (SELECT 1 FROM officer.capabilities WHERE phi_class <> 'none') THEN
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
  BEGIN PERFORM public.officer_execute('front_office_v1',gen_random_uuid(),'x@example.invalid','cfo','session',gen_random_uuid(),now(),'occupied_beds',1,'{}'::jsonb,repeat('0',64),NULL);
    RAISE EXCEPTION 'authenticated executed officer_execute';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.officer_execute('front_office_v1',gen_random_uuid(),'x@example.invalid','cfo','session',gen_random_uuid(),now(),'occupied_beds',1,'{}'::jsonb,repeat('0',64),NULL);
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
-- Fixture: a fresh organization with two facilities, three registry rows.
-- Synthetic data only; rolled back.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE oc AS SELECT
  gen_random_uuid() org, gen_random_uuid() entity, gen_random_uuid() fac_a, gen_random_uuid() fac_b,
  gen_random_uuid() cfo, gen_random_uuid() coo, gen_random_uuid() ceo, gen_random_uuid() stranger,
  gen_random_uuid() reporter, repeat('a',64) chash;
INSERT INTO public.organizations(id,name) SELECT org,'Probe Org' FROM oc;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'Probe Entity' FROM oc;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT fac_a,entity,org,'Probe Facility A','1 Probe St','Lake City','32025',10 FROM oc
  UNION ALL SELECT fac_b,entity,org,'Probe Facility B','2 Probe St','Lake City','32025',20 FROM oc;
INSERT INTO officer.facility_coverage(facility_id,coverage,note) SELECT fac_a,'live','probe' FROM oc UNION ALL SELECT fac_b,'demo','probe' FROM oc;
INSERT INTO officer.federated_officers(front_office_profile_id,officer_role,email,organization_id,is_active,created_by)
  SELECT cfo,'cfo','cfo@probe.invalid',org,true,'review probe' FROM oc
  UNION ALL SELECT ceo,'ceo','ceo@probe.invalid',org,true,'review probe' FROM oc;
INSERT INTO officer.federated_officers(front_office_profile_id,officer_role,email,organization_id,is_active,valid_until,created_by)
  SELECT coo,'coo','coo@probe.invalid',org,false,NULL,'review probe' FROM oc;

CREATE FUNCTION pg_temp.run(p_officer uuid,p_email text,p_role text,p_assurance text,p_cap text,p_version int,p_args jsonb,p_intent jsonb DEFAULT NULL,p_nonce uuid DEFAULT NULL,p_sent timestamptz DEFAULT NULL,p_key text DEFAULT 'front_office_v1')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.officer_execute(p_key,p_officer,p_email,p_role,p_assurance,COALESCE(p_nonce,gen_random_uuid()),COALESCE(p_sent,now()),p_cap,p_version,p_args,(SELECT chash FROM oc),p_intent)
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

-- Disabled key refuses before anything else, catalog and execute alike.
SELECT pg_temp.expect('disabled key','42501','key_disabled',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}');
UPDATE officer.gateway_keys SET enabled=true WHERE key_id='front_office_v1';

-- Catalog shape.
DO $$ DECLARE c jsonb; ping jsonb; BEGIN
  c := public.officer_catalog('front_office_v1');
  IF c->>'target'<>'haven' OR c->>'contract'<>'front-office-capability-v1' OR jsonb_array_length(c->'capabilities')<>7 THEN RAISE EXCEPTION 'catalog header wrong'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(c->'capabilities') e WHERE e->>'phi_class'<>'none' OR jsonb_array_length(e->'synonyms')=0 OR e->>'assurance'<>'session') THEN RAISE EXCEPTION 'catalog entry wrong'; END IF;
  SELECT e INTO ping FROM jsonb_array_elements(c->'capabilities') e WHERE e->>'name'='command_ping';
  IF ping->>'kind'<>'command' OR (ping->>'requires_confirmation')::boolean IS DISTINCT FROM true OR jsonb_array_length(ping->'effects')<>1 OR ping->>'verb_phrase'<>'record the test note in Circle of Life' THEN RAISE EXCEPTION 'ping catalog entry wrong'; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.all_keys(c) k WHERE k ~ '(^|_)(name|first|last|dob|ssn|email|phone|address|mrn|resident_id|employee_id|person_id)$' AND k<>'name') THEN RAISE EXCEPTION 'forbidden key in catalog'; END IF;
  -- The key's allowlist filters the catalog.
  UPDATE officer.gateway_keys SET allowed_capabilities=ARRAY['occupied_beds'] WHERE key_id='front_office_v1';
  IF jsonb_array_length(public.officer_catalog('front_office_v1')->'capabilities')<>1 THEN RAISE EXCEPTION 'catalog ignores allowlist'; END IF;
  UPDATE officer.gateway_keys SET allowed_capabilities=ARRAY['occupied_beds','licensed_capacity','open_ar_balance','billed_revenue_mtd','incidents_last_30_days','staff_certifications_expiring_30_days','command_ping'] WHERE key_id='front_office_v1';
  IF (SELECT e->>'meaning' FROM jsonb_array_elements(c->'capabilities') e WHERE e->>'name'='open_ar_balance') NOT ILIKE '%not draft, void, written off or paid%' THEN RAISE EXCEPTION 'AR meaning must name the predicate'; END IF;
END $$;

-- Refusals in contract order.
SELECT pg_temp.expect('unknown officer','42501','principal_unknown',(SELECT stranger FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}');
SELECT pg_temp.expect('email mismatch','42501','principal_unknown',(SELECT cfo FROM oc),'other@probe.invalid','cfo','session','occupied_beds',1,'{}');
SELECT pg_temp.expect('role mismatch','42501','principal_unknown',(SELECT cfo FROM oc),'cfo@probe.invalid','ceo','session','occupied_beds',1,'{}');
SELECT pg_temp.expect('inactive officer','42501','principal_inactive',(SELECT coo FROM oc),'coo@probe.invalid','coo','session','occupied_beds',1,'{}');
UPDATE officer.federated_officers SET is_active=true, valid_until=now()-interval '1 minute' WHERE front_office_profile_id=(SELECT coo FROM oc);
SELECT pg_temp.expect('expired window','42501','principal_inactive',(SELECT coo FROM oc),'coo@probe.invalid','coo','session','occupied_beds',1,'{}');
SELECT pg_temp.expect('outside allowlist','42501','capability_denied',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','probe_not_allowed',1,'{}');
SELECT pg_temp.expect('unknown key','42501','key_disabled',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}',NULL,NULL,NULL,'nobody');
SELECT pg_temp.expect('stale version','P0409','version_conflict',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',2,'{}');
SELECT pg_temp.expect('extra arg','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{"p_caller_role":"owner"}');
SELECT pg_temp.expect('args not object','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'[]');
SELECT pg_temp.expect('intent on a read','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}',jsonb_build_object('intent_id',gen_random_uuid()));
SELECT pg_temp.expect('bad assurance','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','aal9','occupied_beds',1,'{}');
SELECT pg_temp.expect('old timestamp','P0401','expired_request',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}',NULL,NULL,now()-interval '90 seconds');
SELECT pg_temp.expect('future timestamp','P0401','expired_request',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}',NULL,NULL,now()+interval '90 seconds');
-- mfa capability under session assurance; role outside the allowed list.
INSERT INTO officer.capabilities(name,version,kind,title,description,synonyms,meaning,params,unit,allowed_officer_roles,assurance,phi_class,requires_confirmation)
  VALUES ('probe_mfa_read',1,'read','Probe','Probe.',ARRAY['probe'],'Probe.','[]','beds',ARRAY['cfo'],'mfa','none',false);
UPDATE officer.gateway_keys SET allowed_capabilities=allowed_capabilities||'probe_mfa_read'::text WHERE key_id='front_office_v1';
SELECT pg_temp.expect('mfa under session','42501','assurance_required',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','probe_mfa_read',1,'{}');
SELECT pg_temp.expect('role not allowed','42501','capability_denied',(SELECT ceo FROM oc),'ceo@probe.invalid','ceo','mfa','probe_mfa_read',1,'{}');
-- Replayed nonce.
DO $$ DECLARE n uuid := gen_random_uuid(); BEGIN
  PERFORM pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}',NULL,n);
  PERFORM pg_temp.expect('replayed nonce','23505','replayed_request',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}',NULL,n);
END $$;
-- Refused calls leave no accepted audit rows and no nonce behind.
DO $$ BEGIN
  IF (SELECT count(*) FROM officer.audit_events WHERE key_id='front_office_v1') <> 1 THEN RAISE EXCEPTION 'refusals wrote audit rows inside the rolled-back call'; END IF;
  IF (SELECT count(*) FROM officer.request_nonces WHERE key_id='front_office_v1') <> 1 THEN RAISE EXCEPTION 'nonce count wrong'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Reads: shape, scope, no forbidden keys, no_data for money with no rows.
-- ---------------------------------------------------------------------------
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status,deleted_at)
  SELECT gen_random_uuid(),fac_a,org,'Probe','One','1940-01-01'::date,'female'::public.gender,'active'::public.resident_status,NULL::timestamptz FROM oc
  UNION ALL SELECT gen_random_uuid(),fac_a,org,'Probe','Two','1940-01-01','male','hospital_hold',NULL FROM oc
  UNION ALL SELECT gen_random_uuid(),fac_b,org,'Probe','Three','1940-01-01','female','loa',NULL FROM oc
  UNION ALL SELECT gen_random_uuid(),fac_b,org,'Probe','Four','1940-01-01','female','discharged',NULL FROM oc
  UNION ALL SELECT gen_random_uuid(),fac_b,org,'Probe','Five','1940-01-01','female','active',now() FROM oc;
-- A resident in another organization must never be counted.
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status)
  SELECT gen_random_uuid(),f.id,f.organization_id,'Other','Org','1940-01-01','female','active' FROM public.facilities f WHERE f.organization_id<>(SELECT org FROM oc) AND f.deleted_at IS NULL LIMIT 1;

DO $$ DECLARE r jsonb; expected text[] := ARRAY['ok','kind','capability','version','generated_at','as_of','freshness','validity','value','unit','qualifiers','data','missing','audit_id']; keys text[]; BEGIN
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}');
  SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(r) k;
  IF keys <> (SELECT array_agg(k ORDER BY k) FROM unnest(expected) k) THEN RAISE EXCEPTION 'read envelope keys: %', keys; END IF;
  IF r->>'validity'<>'valid' OR (r->>'value')::int<>3 OR r->>'unit'<>'beds' OR r->'freshness'->>'state'<>'current' OR r->>'kind'<>'read' OR (r->'missing'->>'count')::int<>0 THEN RAISE EXCEPTION 'occupied_beds wrong: %', r; END IF;
  IF (r->'data'->>'facilities_covered')::int<>2 OR jsonb_array_length(r->'data'->'by_facility')<>2 THEN RAISE EXCEPTION 'occupied_beds facility breakdown wrong: %', r->'data'; END IF;
  IF (SELECT (e->>'value')::int FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility A')<>2
     OR (SELECT (e->>'value')::int FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility B')<>1 THEN RAISE EXCEPTION 'per-facility counts wrong: %', r->'data'; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.all_keys(r) k WHERE k ~ '(^|_)(name|first|last|dob|ssn|email|phone|address|mrn|resident_id|employee_id|person_id)$') THEN RAISE EXCEPTION 'forbidden key in read envelope'; END IF;
  -- Coverage labels and the demo qualifier (facility B is a demo facility in this fixture).
  IF (SELECT e->>'coverage' FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility A')<>'live'
     OR (SELECT e->>'coverage' FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility B')<>'demo' THEN RAISE EXCEPTION 'coverage labels wrong: %', r->'data'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q=officer.demo_qualifier()) THEN RAISE EXCEPTION 'demo qualifier missing'; END IF;
  UPDATE officer.facility_coverage SET coverage='live' WHERE facility_id=(SELECT fac_b FROM oc);
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q=officer.demo_qualifier()) THEN RAISE EXCEPTION 'demo qualifier present without a demo facility'; END IF;
  UPDATE officer.facility_coverage SET coverage='demo' WHERE facility_id=(SELECT fac_b FROM oc);
  IF r::text ~ '(Probe One|Probe Two|Other Org|1940)' THEN RAISE EXCEPTION 'person data leaked into envelope'; END IF;
  IF NOT EXISTS (SELECT 1 FROM officer.audit_events a WHERE a.id=(r->>'audit_id')::uuid AND a.outcome='ok' AND a.capability='occupied_beds' AND a.officer_role='cfo' AND a.args_sha256 IS NOT NULL) THEN RAISE EXCEPTION 'audit row missing'; END IF;
  -- The ceo reads the same figure through the same organization scope.
  r := pg_temp.run((SELECT ceo FROM oc),'ceo@probe.invalid','ceo','session','occupied_beds',1,'{}');
  IF (r->>'value')::int<>3 THEN RAISE EXCEPTION 'organization scope differs by officer'; END IF;
  -- PostgREST hands a JSON null through as jsonb null; a read must treat it as absent.
  r := pg_temp.run((SELECT ceo FROM oc),'ceo@probe.invalid','ceo','session','occupied_beds',1,'{}','null'::jsonb);
  IF (r->>'value')::int<>3 THEN RAISE EXCEPTION 'jsonb null intent refused a read'; END IF;

  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','licensed_capacity',1,'{}');
  IF r->>'validity'<>'valid' OR (r->>'value')::int<>30 OR (r->'data'->>'occupancy_percent')::numeric<>10.0 OR (r->'data'->>'occupied_beds')::int<>3 OR jsonb_array_length(r->'data'->'by_facility')<>2 THEN RAISE EXCEPTION 'licensed_capacity wrong: %', r; END IF;

  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','open_ar_balance',1,'{}');
  IF r->>'validity'<>'no_data' OR jsonb_typeof(r->'value')<>'null' OR r->>'unit'<>'cents' OR (r->'data'->>'invoice_count')::int<>0 THEN RAISE EXCEPTION 'open_ar_balance without invoices must be no_data: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q ILIKE '%deleted_at IS NULL AND voided_at IS NULL AND balance_due > 0 AND status NOT IN (draft, void, written_off, paid)%' AND q ILIKE '%due date%')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q ILIKE '%billing AR aging%' AND q ILIKE '%executive KPI%' AND q ILIKE '%will not agree%') THEN RAISE EXCEPTION 'AR qualifiers must state the exact predicate and that the three figures disagree'; END IF;
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','billed_revenue_mtd',1,'{}');
  IF r->>'validity'<>'no_data' OR jsonb_typeof(r->'value')<>'null' OR r->>'unit'<>'cents' OR r->'data'->>'period_start'<>to_char(date_trunc('month',officer.utc_today()),'YYYY-MM-DD') OR r->'data'->>'period_end'<>to_char(officer.utc_today(),'YYYY-MM-DD') THEN RAISE EXCEPTION 'billed_revenue_mtd without invoices must be no_data: %', r; END IF;

  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','incidents_last_30_days',1,'{}');
  IF r->>'validity'<>'valid' OR (r->>'value')::int<>0 OR jsonb_array_length(r->'data'->'by_facility')<>2 THEN RAISE EXCEPTION 'incidents zero must be a valid zero: %', r; END IF;
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','staff_certifications_expiring_30_days',1,'{}');
  IF r->>'validity'<>'valid' OR (r->>'value')::int<>0 OR jsonb_array_length(r->'data'->'by_facility')<>2 THEN RAISE EXCEPTION 'certifications zero must be a valid zero: %', r; END IF;
END $$;

-- AR with rows: a draft carrying a balance must NOT count; nor voided, paid or
-- written-off rows. Sent, overdue and partial do, aged by due date. Invoice dates
-- sit in the current UTC month so the same rows prove billed_revenue_mtd.
INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,total,balance_due,voided_at)
  SELECT gen_random_uuid(),r.id,r.facility_id,r.organization_id,o.entity,'PROBE-AR-'||x.n,officer.utc_today(),x.d,officer.utc_today()-x.n,officer.utc_today(),x.s::public.invoice_status,x.t,x.t,x.bal,x.v
  FROM oc o JOIN public.residents r ON r.organization_id=o.org AND r.last_name='One'
  CROSS JOIN (VALUES
    (1,'sent',10000,10000,officer.utc_today()-45,NULL::timestamptz),
    (2,'draft',2345,2345,officer.utc_today()-45,NULL),
    (3,'sent',500,500,officer.utc_today()-45,now()),
    (4,'paid',9000,0,officer.utc_today()-45,NULL),
    (5,'overdue',700,700,officer.utc_today()-10,NULL),
    (6,'partial',300,300,officer.utc_today()+5,NULL),
    (7,'written_off',400,400,officer.utc_today()-200,NULL)
  ) AS x(n,s,t,bal,d,v);
INSERT INTO auth.users(id,email) SELECT reporter,reporter||'@probe.invalid' FROM oc;
INSERT INTO public.incidents(id,facility_id,organization_id,incident_number,category,severity,occurred_at,shift,location_description,description,immediate_actions,reported_by)
  SELECT gen_random_uuid(),fac_a,org,'PROBE-INC-'||n,'fall_without_injury'::public.incident_category,'level_1'::public.incident_severity,now()-(n||' days')::interval,'day'::public.shift_type,'Probe','Probe','Probe',reporter FROM oc CROSS JOIN generate_series(1,2) n
  UNION ALL SELECT gen_random_uuid(),fac_a,org,'PROBE-INC-OLD','fall_without_injury','level_1',now()-interval '45 days','day','Probe','Probe','Probe',reporter FROM oc;
INSERT INTO public.staff(id,facility_id,organization_id,first_name,last_name,staff_role,hire_date) SELECT reporter,fac_b,org,'Probe','Staff','cna',current_date FROM oc;
INSERT INTO public.staff_certifications(staff_id,facility_id,organization_id,certification_type,certification_name,issue_date,expiration_date,status)
  SELECT reporter,fac_b,org,'probe','Probe',current_date,current_date+10,'active'::public.certification_status FROM oc
  UNION ALL SELECT reporter,fac_b,org,'probe','Probe',current_date,current_date+40,'active' FROM oc
  UNION ALL SELECT reporter,fac_b,org,'probe','Probe',current_date,current_date+5,'expired' FROM oc;
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','open_ar_balance',1,'{}');
  -- 10000 (sent) + 700 (overdue) + 300 (partial); the 2345 draft, the voided 500, the paid 0 and the written-off 400 are excluded.
  IF r->>'validity'<>'valid' OR (r->>'value')::bigint<>11000 OR (r->'data'->>'invoice_count')::int<>3 THEN RAISE EXCEPTION 'open_ar_balance wrong (a draft or excluded status was counted): %', r; END IF;
  IF (r->'data'->>'aging_current_cents')::bigint<>300 OR (r->'data'->>'aging_1_30_cents')::bigint<>700 OR (r->'data'->>'aging_31_60_cents')::bigint<>10000
     OR (r->'data'->>'aging_61_90_cents')::bigint<>0 OR (r->'data'->>'aging_90_plus_cents')::bigint<>0 OR (r->'data'->>'oldest_past_due_days')::int<>45 THEN RAISE EXCEPTION 'AR aging buckets wrong: %', r->'data'; END IF;
  IF (SELECT (e->>'value')::bigint FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility A')<>11000
     OR (SELECT (e->>'invoice_count')::int FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility A')<>3 THEN RAISE EXCEPTION 'AR facility breakdown wrong: %', r->'data'; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.all_keys(r) k WHERE k ~ '(^|_)(name|first|last|dob|ssn|email|phone|address|mrn|resident_id|employee_id|person_id)$') THEN RAISE EXCEPTION 'forbidden key in AR envelope'; END IF;
  -- Billed revenue month to date over the same rows: sent 10000 + paid 9000 + overdue 700 + partial 300; draft, voided and written-off excluded.
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','billed_revenue_mtd',1,'{}');
  IF r->>'validity'<>'valid' OR (r->>'value')::bigint<>20000 OR (r->'data'->>'invoice_count')::int<>4
     OR (SELECT (e->>'value')::bigint FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility A')<>20000 THEN RAISE EXCEPTION 'billed_revenue_mtd wrong: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q ILIKE '%sent, paid, partial or overdue%' AND q ILIKE '%Drafts are not counted%') THEN RAISE EXCEPTION 'revenue qualifier wrong: %', r; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.all_keys(r) k WHERE k ~ '(^|_)(name|first|last|dob|ssn|email|phone|address|mrn|resident_id|employee_id|person_id)$') THEN RAISE EXCEPTION 'forbidden key in revenue envelope'; END IF;
  -- Invoices on file but nothing open: a valid zero, not no_data.
  UPDATE public.invoices SET status='paid', balance_due=0 WHERE organization_id=(SELECT org FROM oc) AND invoice_number LIKE 'PROBE-AR-%';
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','open_ar_balance',1,'{}');
  IF r->>'validity'<>'valid' OR (r->>'value')::bigint<>0 OR (r->'data'->>'invoice_count')::int<>0 THEN RAISE EXCEPTION 'AR with invoices and no balance must be a valid zero: %', r; END IF;
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','incidents_last_30_days',1,'{}');
  IF (r->>'value')::int<>2 OR (SELECT (e->>'value')::int FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility A')<>2 THEN RAISE EXCEPTION 'incident window wrong: %', r; END IF;
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','staff_certifications_expiring_30_days',1,'{}');
  IF (r->>'value')::int<>1 OR (SELECT (e->>'value')::int FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility B')<>1 THEN RAISE EXCEPTION 'certification window wrong: %', r; END IF;
  IF r::text ~ 'Probe Staff' THEN RAISE EXCEPTION 'staff identity leaked'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Reconciliation (P1-1) and unknown coverage (P1-2): the two ways a figure can
-- look authoritative and be wrong. Facility C is soft-deleted and carries a
-- resident, an open invoice billed this month, an incident and a certification.
-- Facility D exists, carries the same, and has NO officer.facility_coverage row
-- -- the default state of every facility onboarded from now on.
-- Invariant asserted for every read: headline == sum(by_facility).
-- Runs on its own key and its own seat so it does not spend the rate-limit
-- budgets the windows below depend on.
-- ---------------------------------------------------------------------------
INSERT INTO officer.gateway_keys(key_id,secret_env,enabled,allowed_capabilities)
  VALUES ('probe_recon','OFFICER_GATEWAY_HMAC_PROBE_RECON',true,
    ARRAY['occupied_beds','licensed_capacity','open_ar_balance','billed_revenue_mtd','incidents_last_30_days','staff_certifications_expiring_30_days']);
DO $$
DECLARE
  v_org uuid := (SELECT org FROM oc); v_ent uuid := (SELECT entity FROM oc);
  v_rep uuid := (SELECT reporter FROM oc);
  v_seat uuid := gen_random_uuid();
  fac_c uuid := gen_random_uuid(); fac_d uuid := gen_random_uuid();
  res_c uuid := gen_random_uuid(); res_d uuid := gen_random_uuid();
  r jsonb; cap text; sum_by numeric; head numeric;
BEGIN
  INSERT INTO officer.federated_officers(front_office_profile_id,officer_role,email,organization_id,is_active,created_by)
    VALUES (v_seat,'owner','recon@probe.invalid',v_org,true,'review probe');
  INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,deleted_at)
  VALUES (fac_c,v_ent,v_org,'Probe Facility C Deleted','3 Probe St','Lake City','32025',40,now()),
         (fac_d,v_ent,v_org,'Probe Facility D Unclassified','4 Probe St','Lake City','32025',5,NULL);
  -- C is classified live: deletion, not coverage, is what takes it out of scope.
  -- D is deliberately left unclassified.
  INSERT INTO officer.facility_coverage(facility_id,coverage,note) VALUES (fac_c,'live','probe deleted facility');

  INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status)
  VALUES (res_c,fac_c,v_org,'Probe','Cee','1940-01-01','female','active'),
         (res_d,fac_d,v_org,'Probe','Dee','1940-01-01','female','active');
  INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,total,balance_due)
  VALUES (gen_random_uuid(),res_c,fac_c,v_org,v_ent,'PROBE-DEL-1',officer.utc_today(),officer.utc_today()-5,officer.utc_today()-5,officer.utc_today(),'sent',777,777,777),
         (gen_random_uuid(),res_d,fac_d,v_org,v_ent,'PROBE-UNK-1',officer.utc_today(),officer.utc_today()-5,officer.utc_today()-5,officer.utc_today(),'sent',111,111,111);
  INSERT INTO public.incidents(id,facility_id,organization_id,incident_number,category,severity,occurred_at,shift,location_description,description,immediate_actions,reported_by)
  VALUES (gen_random_uuid(),fac_c,v_org,'PROBE-INC-DEL','fall_without_injury','level_1',now()-interval '1 day','day','Probe','Probe','Probe',v_rep),
         (gen_random_uuid(),fac_d,v_org,'PROBE-INC-UNK','fall_without_injury','level_1',now()-interval '1 day','day','Probe','Probe','Probe',v_rep);
  INSERT INTO public.staff_certifications(staff_id,facility_id,organization_id,certification_type,certification_name,issue_date,expiration_date,status)
  VALUES (v_rep,fac_c,v_org,'probe','Probe',current_date,current_date+7,'active'),
         (v_rep,fac_d,v_org,'probe','Probe',current_date,current_date+7,'active');

  FOREACH cap IN ARRAY ARRAY['occupied_beds','licensed_capacity','open_ar_balance','billed_revenue_mtd','incidents_last_30_days','staff_certifications_expiring_30_days'] LOOP
    r := pg_temp.run(v_seat,'recon@probe.invalid','owner','session',cap,1,'{}',NULL,NULL,NULL,'probe_recon');
    -- The soft-deleted facility never appears; the unclassified one always does.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility C Deleted') THEN
      RAISE EXCEPTION '%: a soft-deleted facility appeared in the breakdown', cap; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility D Unclassified') THEN
      RAISE EXCEPTION '%: the unclassified facility vanished from the breakdown', cap; END IF;

    -- P1-2: every row keeps its coverage key, and unclassified reads as unknown.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE NOT (e ? 'coverage')) THEN
      RAISE EXCEPTION '%: a by_facility row lost its coverage key: %', cap, r->'data'->'by_facility'; END IF;
    IF (SELECT e->>'coverage' FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility D Unclassified') <> 'unknown' THEN
      RAISE EXCEPTION '%: unclassified coverage must read unknown, not %', cap, r->'data'->'by_facility'; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q=officer.unknown_coverage_qualifier()) THEN
      RAISE EXCEPTION '%: unknown-coverage qualifier missing', cap; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q=officer.scope_qualifier()) THEN
      RAISE EXCEPTION '%: scope qualifier missing', cap; END IF;

    -- P1-1: the headline IS the sum of the breakdown. licensed_capacity's
    -- breakdown is capacity per facility, so the identity holds there too.
    SELECT COALESCE(sum((e->>'value')::numeric),0) INTO sum_by FROM jsonb_array_elements(r->'data'->'by_facility') e;
    head := (r->>'value')::numeric;
    IF head IS DISTINCT FROM sum_by THEN
      RAISE EXCEPTION '%: headline % does not equal the sum of its breakdown % -- %', cap, head, sum_by, r->'data'->'by_facility'; END IF;

    -- What was left out is stated, not dropped.
    IF (r->'missing'->>'count')::int <> 1 THEN
      RAISE EXCEPTION '%: rows on the deleted facility were dropped without being counted as missing: %', cap, r->'missing'; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q ILIKE '%does not cover%' AND q ILIKE '%deleted%') THEN
      RAISE EXCEPTION '%: nothing in the qualifiers names the excluded rows: %', cap, r->'qualifiers'; END IF;
  END LOOP;

  -- Named figures, so a regression cannot pass by moving both sides together.
  r := pg_temp.run(v_seat,'recon@probe.invalid','owner','session','occupied_beds',1,'{}',NULL,NULL,NULL,'probe_recon');
  IF (r->>'value')::int<>4 THEN RAISE EXCEPTION 'occupied_beds with a deleted facility: %', r; END IF;
  -- 10 + 20 + 5 = 35 covered beds; the deleted facility's 40 are out, and
  -- occupancy divides 4 into 35 -- the same population on both sides. Mixing an
  -- organization-wide census into a covered-facility capacity gave 5/35 = 14.3.
  r := pg_temp.run(v_seat,'recon@probe.invalid','owner','session','licensed_capacity',1,'{}',NULL,NULL,NULL,'probe_recon');
  IF (r->>'value')::int<>35 OR (r->'data'->>'occupied_beds')::int<>4 OR (r->'data'->>'occupancy_percent')::numeric<>11.4 THEN
    RAISE EXCEPTION 'licensed_capacity with a deleted facility: %', r; END IF;
  -- Every earlier invoice is paid with a zero balance by now, so the only open
  -- money is 111 cents inside scope and 777 cents outside it.
  r := pg_temp.run(v_seat,'recon@probe.invalid','owner','session','open_ar_balance',1,'{}',NULL,NULL,NULL,'probe_recon');
  IF (r->>'value')::bigint<>111
     OR (SELECT (e->>'value')::bigint FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility D Unclassified')<>111
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q ILIKE '%excluded balance is 777 cents%') THEN
    RAISE EXCEPTION 'open_ar_balance with a deleted facility: %', r; END IF;
  r := pg_temp.run(v_seat,'recon@probe.invalid','owner','session','billed_revenue_mtd',1,'{}',NULL,NULL,NULL,'probe_recon');
  IF (SELECT (e->>'value')::bigint FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility D Unclassified')<>111
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q ILIKE '%excluded billed total is 777 cents%') THEN
    RAISE EXCEPTION 'billed_revenue_mtd with a deleted facility: %', r; END IF;

  -- Classify D and the unknown qualifier goes away. coverage none still counts.
  INSERT INTO officer.facility_coverage(facility_id,coverage,note) VALUES (fac_d,'none','probe classified');
  r := pg_temp.run(v_seat,'recon@probe.invalid','owner','session','occupied_beds',1,'{}',NULL,NULL,NULL,'probe_recon');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q=officer.unknown_coverage_qualifier()) THEN
    RAISE EXCEPTION 'unknown-coverage qualifier survived classification'; END IF;
  IF (SELECT e->>'coverage' FROM jsonb_array_elements(r->'data'->'by_facility') e WHERE e->>'facility'='Probe Facility D Unclassified')<>'none' THEN
    RAISE EXCEPTION 'classified coverage not reflected: %', r->'data'; END IF;
  IF (r->>'value')::int<>4 THEN RAISE EXCEPTION 'a coverage=none facility must still be counted: %', r; END IF;

  -- Undeleting C restores its records to BOTH figures at once.
  UPDATE public.facilities SET deleted_at=NULL WHERE id=fac_c;
  r := pg_temp.run(v_seat,'recon@probe.invalid','owner','session','occupied_beds',1,'{}',NULL,NULL,NULL,'probe_recon');
  SELECT COALESCE(sum((e->>'value')::numeric),0) INTO sum_by FROM jsonb_array_elements(r->'data'->'by_facility') e;
  IF (r->>'value')::int<>5 OR sum_by<>5 OR (r->'missing'->>'count')::int<>0 THEN
    RAISE EXCEPTION 'undeleting a facility must restore headline and breakdown together: %', r; END IF;

  -- Return the fixture to what the blocks below expect.
  UPDATE public.staff_certifications SET deleted_at=now() WHERE facility_id IN (fac_c,fac_d);
  UPDATE public.incidents SET deleted_at=now() WHERE facility_id IN (fac_c,fac_d);
  UPDATE public.invoices SET deleted_at=now() WHERE facility_id IN (fac_c,fac_d);
  UPDATE public.residents SET deleted_at=now() WHERE id IN (res_c,res_d);
  UPDATE public.facilities SET deleted_at=now() WHERE id IN (fac_c,fac_d);
  UPDATE officer.federated_officers SET is_active=false WHERE front_office_profile_id=v_seat;
  UPDATE officer.gateway_keys SET enabled=false WHERE key_id='probe_recon';
END $$;

-- ---------------------------------------------------------------------------
-- Command: ping writes one receipt and one audit row; replay and reuse rules.
-- ---------------------------------------------------------------------------
DO $$ DECLARE intent uuid := gen_random_uuid(); r jsonb; again jsonb; before_audit int; BEGIN
  PERFORM pg_temp.expect('command without intent','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','command_ping',1,'{}');
  PERFORM pg_temp.expect('command with bad intent id','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','command_ping',1,'{}','{"intent_id":"not-a-uuid"}');
  SELECT count(*) INTO before_audit FROM officer.audit_events WHERE key_id='front_office_v1';
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','command_ping',1,'{}',jsonb_build_object('intent_id',intent,'expected_version',NULL));
  IF r->>'kind'<>'command' OR (r->'result'->>'pong')::boolean IS DISTINCT FROM true OR (r->'receipt'->>'replayed')::boolean IS DISTINCT FROM false OR (r->'receipt'->>'intent_id')::uuid<>intent OR r->'result'->>'server_time' IS NULL THEN RAISE EXCEPTION 'ping envelope wrong: %', r; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k) <> ARRAY['capability','kind','ok','receipt','result','version'] THEN RAISE EXCEPTION 'command envelope keys wrong: %', r; END IF;
  IF (SELECT count(*) FROM officer.command_receipts WHERE key_id='front_office_v1' AND intent_id=intent)<>1 THEN RAISE EXCEPTION 'ping must write exactly one receipt'; END IF;
  IF (SELECT count(*) FROM officer.audit_events WHERE key_id='front_office_v1')<>before_audit+1 OR NOT EXISTS (SELECT 1 FROM officer.audit_events WHERE intent_id=intent AND outcome='ok' AND capability='command_ping') THEN RAISE EXCEPTION 'ping must write exactly one audit row'; END IF;
  -- Same intent, same request: prior result, replayed:true, still one receipt.
  again := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','command_ping',1,'{}',jsonb_build_object('intent_id',intent));
  IF (again->'receipt'->>'replayed')::boolean IS DISTINCT FROM true OR again->'result'<>r->'result' OR again->'receipt'->>'audit_id'<>r->'receipt'->>'audit_id' THEN RAISE EXCEPTION 'ping replay wrong: %', again; END IF;
  IF (SELECT count(*) FROM officer.command_receipts WHERE key_id='front_office_v1' AND intent_id=intent)<>1 THEN RAISE EXCEPTION 'replay wrote a second receipt'; END IF;
  IF NOT EXISTS (SELECT 1 FROM officer.audit_events WHERE intent_id=intent AND outcome='replayed') THEN RAISE EXCEPTION 'replay must audit as replayed'; END IF;
  -- Same intent, different request hash (another officer): refused.
  PERFORM pg_temp.expect('intent reused by another request','22023','idempotency_key_reused',(SELECT ceo FROM oc),'ceo@probe.invalid','ceo','session','command_ping',1,'{}',jsonb_build_object('intent_id',intent));
  -- Same intent, different args: refused with 22023 (args are fixed for ping).
  PERFORM pg_temp.expect('intent with different args','22023','invalid_args',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','command_ping',1,'{"note":"x"}',jsonb_build_object('intent_id',intent));
  IF (SELECT count(*) FROM officer.command_receipts WHERE key_id='front_office_v1')<>1 THEN RAISE EXCEPTION 'refused commands wrote receipts'; END IF;
  -- Ping touched no domain table: audit_log has no officer-schema rows.
  IF EXISTS (SELECT 1 FROM public.audit_log WHERE table_name LIKE 'officer%' OR table_name IN ('command_receipts','audit_events')) THEN RAISE EXCEPTION 'ping reached the domain audit log'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Audit immutability, refusal recording, rate limit.
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
  IF EXISTS (SELECT 1 FROM officer.audit_events WHERE error_code NOT IN ('principal_unknown')) THEN RAISE EXCEPTION 'unpublished code recorded'; END IF;
  -- An unregistered key id cannot leave a refusal row, whatever the Edge Function does.
  PERFORM public.officer_record_refusal('no_such_key',(SELECT cfo FROM oc),'occupied_beds',1,gen_random_uuid(),'principal_unknown');
  IF EXISTS (SELECT 1 FROM officer.audit_events WHERE key_id='no_such_key') THEN RAISE EXCEPTION 'unregistered key wrote a refusal row'; END IF;
END $$;
-- Zero licensed beds: the percent is stated as unknown (JSON null + qualifier), never silently absent.
UPDATE public.facilities SET total_licensed_beds=0 WHERE organization_id=(SELECT org FROM oc);
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','licensed_capacity',1,'{}');
  IF r->>'validity'<>'valid' OR (r->>'value')::int<>0 OR NOT (r->'data' ? 'occupancy_percent') OR jsonb_typeof(r->'data'->'occupancy_percent')<>'null'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'qualifiers') q WHERE q ILIKE '%cannot be computed%') THEN RAISE EXCEPTION 'zero licensed beds must report an unknown percent: %', r; END IF;
END $$;
UPDATE public.facilities SET total_licensed_beds=10 WHERE id=(SELECT fac_a FROM oc);
UPDATE public.facilities SET total_licensed_beds=20 WHERE id=(SELECT fac_b FROM oc);
-- Rate limits: three independent windows.
-- (1) 60 recorded refusals must NOT starve legitimate work on the key.
INSERT INTO officer.audit_events(key_id,officer_ref,outcome,error_code) SELECT 'front_office_v1',(SELECT stranger FROM oc),'refused','principal_unknown' FROM generate_series(1,60);
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}');
  IF r->>'validity'<>'valid' THEN RAISE EXCEPTION 'recorded refusals starved legitimate work'; END IF;
END $$;
-- (2) 120 refusals in a minute close the refusal window for that key, and only that key.
INSERT INTO officer.audit_events(key_id,officer_ref,outcome,error_code) SELECT 'front_office_v1',(SELECT stranger FROM oc),'refused','principal_unknown' FROM generate_series(1,60);
SELECT pg_temp.expect('refusal window','P0429','rate_limited',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}');
INSERT INTO officer.gateway_keys(key_id,secret_env,enabled,allowed_capabilities) VALUES ('probe_second','OFFICER_GATEWAY_HMAC_PROBE_SECOND',true,ARRAY['occupied_beds']),('probe_third','OFFICER_GATEWAY_HMAC_PROBE_THIRD',true,ARRAY['occupied_beds']);
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.run((SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}',NULL,NULL,NULL,'probe_second');
  IF r->>'validity'<>'valid' THEN RAISE EXCEPTION 'second key blocked by first key window'; END IF;
END $$;
-- (3) 60 successes in a minute close the success window for that key.
INSERT INTO officer.audit_events(key_id,officer_ref,outcome) SELECT 'probe_third',(SELECT stranger FROM oc),'ok' FROM generate_series(1,60);
SELECT pg_temp.expect('success window','P0429','rate_limited',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}',NULL,NULL,NULL,'probe_third');
-- (4) Per officer, successes and refusals are separate windows too. 59 refusals
--     aimed at the ceo do not block the ceo's real work; 30 successes do; the
--     cfo keeps working on the same key throughout.
INSERT INTO officer.audit_events(key_id,officer_ref,outcome,error_code) SELECT 'probe_second',(SELECT ceo FROM oc),'refused','invalid_args' FROM generate_series(1,59);
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.run((SELECT ceo FROM oc),'ceo@probe.invalid','ceo','session','occupied_beds',1,'{}',NULL,NULL,NULL,'probe_second');
  IF r->>'validity'<>'valid' THEN RAISE EXCEPTION 'refusals aimed at a seat locked it out of real work'; END IF;
END $$;
INSERT INTO officer.audit_events(key_id,officer_ref,outcome,error_code) SELECT 'probe_second',(SELECT ceo FROM oc),'refused','invalid_args' FROM generate_series(1,1);
SELECT pg_temp.expect('officer refusal window','P0429','rate_limited',(SELECT ceo FROM oc),'ceo@probe.invalid','ceo','session','occupied_beds',1,'{}',NULL,NULL,NULL,'probe_second');
INSERT INTO officer.audit_events(key_id,officer_ref,outcome) SELECT 'probe_second',(SELECT cfo FROM oc),'ok' FROM generate_series(1,30);
SELECT pg_temp.expect('officer success window','P0429','rate_limited',(SELECT cfo FROM oc),'cfo@probe.invalid','cfo','session','occupied_beds',1,'{}',NULL,NULL,NULL,'probe_second');
UPDATE officer.federated_officers SET is_active=true, valid_until=NULL WHERE front_office_profile_id=(SELECT coo FROM oc);
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.run((SELECT coo FROM oc),'coo@probe.invalid','coo','session','occupied_beds',1,'{}',NULL,NULL,NULL,'probe_second');
  IF r->>'validity'<>'valid' THEN RAISE EXCEPTION 'one seat starved another'; END IF;
END $$;
-- (5) rate_limited is recorded, deduplicated to one row per key per minute: a flood leaves one row, not none and not one per request.
DO $$ DECLARE n int; BEGIN
  FOR n IN 1..25 LOOP PERFORM public.officer_record_refusal('probe_third',(SELECT cfo FROM oc),'occupied_beds',1,gen_random_uuid(),'rate_limited'); END LOOP;
  IF (SELECT count(*) FROM officer.audit_events WHERE key_id='probe_third' AND error_code='rate_limited') <> 1 THEN RAISE EXCEPTION 'rate_limited rows not deduplicated per key per minute'; END IF;
  PERFORM public.officer_record_refusal('probe_second',(SELECT cfo FROM oc),'occupied_beds',1,gen_random_uuid(),'rate_limited');
  IF (SELECT count(*) FROM officer.audit_events WHERE error_code='rate_limited') <> 2 THEN RAISE EXCEPTION 'rate_limited dedup must be per key'; END IF;
  -- Other refusal codes are not deduplicated.
  PERFORM public.officer_record_refusal('probe_third',(SELECT cfo FROM oc),'occupied_beds',1,gen_random_uuid(),'invalid_args');
  PERFORM public.officer_record_refusal('probe_third',(SELECT cfo FROM oc),'occupied_beds',1,gen_random_uuid(),'invalid_args');
  IF (SELECT count(*) FROM officer.audit_events WHERE key_id='probe_third' AND error_code='invalid_args') <> 2 THEN RAISE EXCEPTION 'ordinary refusals must all be recorded'; END IF;
END $$;
-- Nonces older than 15 minutes are pruned on the next call.
UPDATE officer.request_nonces SET seen_at=now()-interval '16 minutes' WHERE key_id='front_office_v1';
DO $$ BEGIN PERFORM pg_temp.run((SELECT coo FROM oc),'coo@probe.invalid','coo','session','occupied_beds',1,'{}',NULL,NULL,NULL,'probe_second'); END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM officer.request_nonces WHERE key_id='front_office_v1') THEN RAISE EXCEPTION 'stale nonces not pruned'; END IF; END $$;

ROLLBACK;
