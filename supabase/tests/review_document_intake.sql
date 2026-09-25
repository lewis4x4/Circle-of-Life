-- COL-771 (migration 545): Document Intake custody, idempotency, scope, paid-call
-- safety and human-only filing. Test spec items I1, I2, I4, I6, I13, I14, I9.
-- Local disposable replay only: every fixture rolls back. Synthetic data only.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;

CREATE TEMP TABLE di AS SELECT
  gen_random_uuid() org, gen_random_uuid() ent, gen_random_uuid() fac, gen_random_uuid() other_fac,
  gen_random_uuid() admin_u, gen_random_uuid() admin_s,
  gen_random_uuid() other_u, gen_random_uuid() other_s,
  gen_random_uuid() owner_u, gen_random_uuid() owner_s,
  gen_random_uuid() k1, gen_random_uuid() k2, gen_random_uuid() k3, gen_random_uuid() k4,
  gen_random_uuid() k5, gen_random_uuid() k6, gen_random_uuid() k7, gen_random_uuid() k8,
  repeat('a', 64) sha;
CREATE TEMP TABLE di_state (k text PRIMARY KEY, v text);
GRANT SELECT ON di TO authenticated;
GRANT ALL ON di_state TO authenticated;

INSERT INTO organizations(id,name) SELECT org,'Intake review' FROM di;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Intake Entity' FROM di;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT fac,ent,org,'Intake Facility','1 Way','Town','00000',10 FROM di
  UNION ALL SELECT other_fac,ent,org,'Other Facility','2 Way','Town','00000',10 FROM di;
SELECT haven.document_intake_seed_catalog(org) FROM di;
-- Intake is switched on per facility (547): only fac is on.
INSERT INTO public.document_intake_settings(organization_id, enabled_facility_ids) SELECT org, ARRAY[fac] FROM di;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT u, u||'@review.invalid', jsonb_build_object('organization_id',org,'app_role',r), jsonb_build_object('full_name','Intake '||r)
FROM di, LATERAL (VALUES (admin_u,'facility_admin'),(other_u,'facility_admin'),(owner_u,'owner')) v(u,r);
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
SELECT u, u||'@review.invalid','Intake '||r, r::public.app_role, org, true
FROM di, LATERAL (VALUES (admin_u,'facility_admin'),(other_u,'facility_admin'),(owner_u,'owner')) v(u,r)
ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id, app_role=excluded.app_role, is_active=true;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
  SELECT admin_u,fac,org FROM di UNION ALL SELECT other_u,other_fac,org FROM di;
INSERT INTO auth.sessions(id,user_id) SELECT admin_s,admin_u FROM di UNION ALL SELECT other_s,other_u FROM di UNION ALL SELECT owner_s,owner_u FROM di;

CREATE FUNCTION pg_temp.act(p_user uuid, p_session uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub',p.id,'session_id',p_session,
    'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
    'role','authenticated','app_role',p.app_role::text,'organization_id',p.organization_id,
    'app_metadata',jsonb_build_object('app_role',p.app_role::text,'organization_id',p.organization_id))::text, true)
  FROM public.user_profiles p WHERE p.id = p_user;
$$;
CREATE FUNCTION pg_temp.service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('role','service_role')::text, true);
$$;

-- ── I1: upload is idempotent; a reused key with a changed payload is refused ──
SELECT pg_temp.act(admin_u, admin_s) FROM di;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; a jsonb; b jsonb; refused boolean := false; BEGIN
  SELECT * INTO f FROM di;
  a := public.document_intake_prepare_upload(f.k1, jsonb_build_object('facility_id',f.fac,'file_name','scan.pdf',
    'declared_mime','application/pdf','declared_size_bytes',1000,'declared_sha256',f.sha));
  b := public.document_intake_prepare_upload(f.k1, jsonb_build_object('facility_id',f.fac,'file_name','scan.pdf',
    'declared_mime','application/pdf','declared_size_bytes',1000,'declared_sha256',f.sha));
  IF (a->'item'->>'id') IS DISTINCT FROM (b->'item'->>'id') OR coalesce((b->>'replayed')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'I1: a replayed upload created a second item'; END IF;
  IF a->'item' ? 'storage_path' THEN RAISE EXCEPTION 'I4: item JSON exposes the storage path'; END IF;
  BEGIN
    PERFORM public.document_intake_prepare_upload(f.k1, jsonb_build_object('facility_id',f.fac,'file_name','other.pdf',
      'declared_mime','application/pdf','declared_size_bytes',1000,'declared_sha256',f.sha));
  EXCEPTION WHEN invalid_parameter_value THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'I1: a reused request key with a changed payload was accepted'; END IF;
  BEGIN
    PERFORM public.document_intake_prepare_upload(gen_random_uuid(), jsonb_build_object('facility_id',f.other_fac,'file_name','x.pdf',
      'declared_mime','application/pdf','declared_size_bytes',1000,'declared_sha256',f.sha));
    RAISE EXCEPTION 'I4: uploaded to a facility without access';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO di_state VALUES ('item', a->'item'->>'id'), ('path', a->>'path');
END $$;
RESET ROLE;
-- A facility that is not switched on refuses uploads even for the owner.
SELECT pg_temp.act(owner_u, owner_s) FROM di;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM di;
  BEGIN
    PERFORM public.document_intake_prepare_upload(gen_random_uuid(), jsonb_build_object('facility_id',f.other_fac,'file_name','x.pdf',
      'declared_mime','application/pdf','declared_size_bytes',1000,'declared_sha256',f.sha));
    RAISE EXCEPTION '547: uploaded to a facility where intake is not switched on';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF public.document_intake_facility_enabled(f.other_fac) OR NOT public.document_intake_facility_enabled(f.fac) THEN
    RAISE EXCEPTION '547: facility enablement reads wrong'; END IF;
END $$;
RESET ROLE;

-- The server stores and attests the bytes (service role).
INSERT INTO storage.objects(bucket_id,name,metadata)
  SELECT 'document-intake', (SELECT v FROM di_state WHERE k='path'), jsonb_build_object('size',1000);
SELECT pg_temp.service();
DO $$ DECLARE f record; item uuid := (SELECT v::uuid FROM di_state WHERE k='item'); refused boolean := false; BEGIN
  SELECT * INTO f FROM di;
  BEGIN
    PERFORM public.document_intake_attest_source(item, NULL, 1000, 'application/pdf', repeat('b',64), 3);
  EXCEPTION WHEN invalid_parameter_value THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'I2: bytes with a different checksum were attested'; END IF;
  PERFORM public.document_intake_attest_source(item, NULL, 1000, 'application/pdf', f.sha, 3);
  PERFORM public.document_intake_attest_source(item, NULL, 1000, 'application/pdf', f.sha, 3);
END $$;
DO $$ BEGIN
  UPDATE public.document_intake_items SET storage_path = 'elsewhere' WHERE id = (SELECT v::uuid FROM di_state WHERE k='item');
  RAISE EXCEPTION 'I2: an attested original was repointed';
EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END $$;

SELECT pg_temp.act(admin_u, admin_s) FROM di;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; r jsonb; item uuid := (SELECT v::uuid FROM di_state WHERE k='item'); BEGIN
  SELECT * INTO f FROM di;
  r := public.document_intake_finalize_upload(item, f.k2);
  IF r->'item'->>'status' <> 'queued' THEN RAISE EXCEPTION 'finalize left status %', r->'item'->>'status'; END IF;
  IF (SELECT count(*) FROM public.document_intake_runs WHERE item_id = item) <> 1 THEN RAISE EXCEPTION 'finalize did not queue exactly one run'; END IF;
END $$;
RESET ROLE;

-- ── I4: another facility's administrator sees nothing and can do nothing ──
SELECT pg_temp.act(other_u, other_s) FROM di;
SET LOCAL ROLE authenticated;
DO $$ DECLARE item uuid := (SELECT v::uuid FROM di_state WHERE k='item'); BEGIN
  IF (SELECT count(*) FROM public.document_intake_items WHERE id = item) <> 0
     OR (SELECT count(*) FROM public.document_intake_events WHERE item_id = item) <> 0
     OR (SELECT count(*) FROM public.document_intake_runs WHERE item_id = item) <> 0 THEN
    RAISE EXCEPTION 'I4: another facility''s administrator can read the item or its history'; END IF;
  BEGIN
    PERFORM public.document_intake_command(item, gen_random_uuid(), NULL, 'claim', '{}'::jsonb);
    RAISE EXCEPTION 'I4: another facility''s administrator ran a command';
  EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
RESET ROLE;

-- ── Worker publishes a proposal; I14: a lease lost after dispatch is uncertain ──
SELECT pg_temp.service();
DO $$ DECLARE c jsonb; run uuid; fence uuid; item uuid := (SELECT v::uuid FROM di_state WHERE k='item'); i record; BEGIN
  c := public.document_intake_worker_claim('probe-worker', 60);
  run := (c->'run'->>'id')::uuid; fence := (c->'run'->>'fence')::uuid;
  IF (c->'item'->>'id')::uuid <> item THEN RAISE EXCEPTION 'worker claimed the wrong item'; END IF;
  PERFORM public.document_intake_worker_dispatch(run, fence, 'reader', 'anthropic', 'probe-model', '{}'::jsonb);
  PERFORM public.document_intake_worker_returned(run, fence, '{"input_tokens":1}'::jsonb);
  BEGIN
    PERFORM public.document_intake_worker_complete(run, gen_random_uuid(), '{}'::jsonb);
    RAISE EXCEPTION 'I2: a worker without the fence published';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  PERFORM public.document_intake_worker_complete(run, fence, jsonb_build_object(
    'outcome','proposed','suggested_title','AHCA license — 2026-09-01','summary','Facility license renewal.',
    'catalog_code','facility_license','candidates',jsonb_build_array(jsonb_build_object('kind','facility_document','catalog_code','facility_license','subject_id',(SELECT fac FROM di),'label','Intake Facility')),
    'proposed_candidate',0,'stage_status',jsonb_build_object('reader',jsonb_build_object('state','ran'),'jev',jsonb_build_object('state','not_authorized'))));
  SELECT * INTO i FROM public.document_intake_items WHERE id = item;
  IF i.status <> 'pending_review' OR i.current_proposal_id IS NULL OR i.processing_state <> 'succeeded' THEN
    RAISE EXCEPTION 'proposal did not move the item to review: % %', i.status, i.processing_state; END IF;
  BEGIN
    UPDATE public.document_intake_proposals SET summary = 'changed' WHERE item_id = item;
    RAISE EXCEPTION 'a proposal was edited in place';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;

SELECT pg_temp.act(admin_u, admin_s) FROM di;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; item uuid := (SELECT v::uuid FROM di_state WHERE k='item'); BEGIN
  SELECT * INTO f FROM di;
  PERFORM public.document_intake_command(item, f.k3, (SELECT revision FROM public.document_intake_items WHERE id = item), 'reprocess', '{}'::jsonb);
END $$;
RESET ROLE;
SELECT pg_temp.service();
DO $$ DECLARE c jsonb; run uuid; item uuid := (SELECT v::uuid FROM di_state WHERE k='item'); refused boolean := false; BEGIN
  c := public.document_intake_worker_claim('probe-worker', 60);
  run := (c->'run'->>'id')::uuid;
  PERFORM public.document_intake_worker_dispatch(run, (c->'run'->>'fence')::uuid, 'reader', 'anthropic', 'probe-model', '{}'::jsonb);
  -- The worker dies mid-call: its lease runs out while the request is out.
  UPDATE public.document_intake_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = run;
  c := public.document_intake_worker_claim('probe-worker-2', 60);
  IF c IS NOT NULL THEN RAISE EXCEPTION 'I14: an expired dispatched run was handed to another worker'; END IF;
  IF (SELECT state FROM public.document_intake_runs WHERE id = run) <> 'uncertain'
     OR (SELECT processing_state FROM public.document_intake_items WHERE id = item) <> 'uncertain' THEN
    RAISE EXCEPTION 'I14: a lease lost after dispatch was not marked uncertain'; END IF;
END $$;
SELECT pg_temp.act(admin_u, admin_s) FROM di;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; item uuid := (SELECT v::uuid FROM di_state WHERE k='item'); refused boolean := false; BEGIN
  SELECT * INTO f FROM di;
  BEGIN
    PERFORM public.document_intake_command(item, gen_random_uuid(), (SELECT revision FROM public.document_intake_items WHERE id = item), 'reprocess', '{}'::jsonb);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'I14: an uncertain paid call was resent without confirmation'; END IF;
END $$;
RESET ROLE;

-- ── I6 / I13: one live filing, never by the worker, replay-safe completion ──
SELECT pg_temp.act(admin_u, admin_s) FROM di;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; item uuid := (SELECT v::uuid FROM di_state WHERE k='item'); rev uuid; p jsonb; conflict boolean := false; BEGIN
  SELECT * INTO f FROM di;
  rev := (SELECT revision FROM public.document_intake_items WHERE id = item);
  p := public.document_intake_prepare_filing(item, f.k4, rev, jsonb_build_object('catalog_code','facility_license','title','AHCA license'));
  BEGIN
    PERFORM public.document_intake_prepare_filing(item, f.k5, rev, jsonb_build_object('catalog_code','facility_other','title','Other'));
  EXCEPTION WHEN serialization_failure THEN conflict := true; END;
  IF NOT conflict THEN RAISE EXCEPTION 'I6: two filings of one document were prepared at once'; END IF;
  INSERT INTO di_state VALUES ('filing', p->>'filing_id'), ('target', p->>'path');
END $$;
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name,metadata)
  SELECT 'facility-documents', (SELECT v FROM di_state WHERE k='target'), jsonb_build_object('size',1000);
SELECT pg_temp.service();
DO $$ DECLARE f record; filing uuid := (SELECT v::uuid FROM di_state WHERE k='filing'); BEGIN
  SELECT * INTO f FROM di;
  BEGIN
    PERFORM public.document_intake_complete_filing(filing, gen_random_uuid());
    RAISE EXCEPTION 'I13: the service principal completed a filing';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.document_intake_attest_filing_object(filing, NULL, f.sha);
END $$;
SELECT pg_temp.act(admin_u, admin_s) FROM di;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; filing uuid := (SELECT v::uuid FROM di_state WHERE k='filing'); a jsonb; b jsonb; item uuid := (SELECT v::uuid FROM di_state WHERE k='item'); BEGIN
  SELECT * INTO f FROM di;
  a := public.document_intake_complete_filing(filing, f.k6);
  b := public.document_intake_complete_filing(filing, f.k6);
  IF coalesce((b->>'replayed')::boolean,false) IS NOT TRUE OR a->'filing'->>'destination_record_id' IS DISTINCT FROM b->'filing'->>'destination_record_id' THEN
    RAISE EXCEPTION 'I6: a retried approval did not return the same receipt'; END IF;
  IF (SELECT count(*) FROM public.facility_documents WHERE notes LIKE '%' || item || '%') <> 1 THEN
    RAISE EXCEPTION 'I6: approval did not create exactly one facility document'; END IF;
  IF (SELECT status FROM public.document_intake_items WHERE id = item) <> 'filed' THEN RAISE EXCEPTION 'item not filed'; END IF;
  -- I9: correction withdraws the record and keeps both in history.
  PERFORM public.document_intake_correct_filing(filing, f.k7, 'Wrong document type');
  IF (SELECT count(*) FROM public.facility_documents WHERE notes LIKE '%' || item || '%' AND deleted_at IS NULL) <> 0
     OR (SELECT status FROM public.document_intake_items WHERE id = item) <> 'pending_review'
     OR (SELECT count(*) FROM public.document_intake_events WHERE item_id = item AND event IN ('filed','filing_corrected')) <> 2 THEN
    RAISE EXCEPTION 'I9: correction did not withdraw the record and keep its history'; END IF;
END $$;
RESET ROLE;

-- ── Unknown-facility mail stays with the custodian ──
SELECT pg_temp.service();
DO $$ DECLARE f record; mb uuid; m jsonb; it jsonb; BEGIN
  SELECT * INTO f FROM di;
  INSERT INTO public.document_intake_mailboxes(organization_id,address,active) VALUES (f.org,'docs@review.invalid',true) RETURNING id INTO mb;
  INSERT INTO public.document_intake_sender_routes(organization_id,sender_address,facility_id,sender_kind)
    VALUES (f.org,'copier@review.invalid',f.fac,'facility_copier');
  m := public.document_intake_worker_record_message(mb, jsonb_build_object('folder','inbox','provider_message_id','m-1',
    'sender_address','COPIER@review.invalid','sender_authenticated',false));
  it := public.document_intake_worker_create_mail_item((m->>'id')::uuid, jsonb_build_object('file_name','scan.pdf','mime','application/pdf','size_bytes',10,'sha256',repeat('c',64)));
  IF (SELECT facility_id FROM public.document_intake_items WHERE id = (it->>'item_id')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'an unauthenticated sender was routed to a facility'; END IF;
  INSERT INTO di_state VALUES ('mail_item', it->>'item_id');
  -- 548: a facility mailbox routes to its facility even for an unauthenticated sender.
  INSERT INTO public.document_intake_mailboxes(organization_id,address,active,facility_id)
    VALUES (f.org,'facility.docs@review.invalid',true,f.fac) RETURNING id INTO mb;
  m := public.document_intake_worker_record_message(mb, jsonb_build_object('folder','inbox','provider_message_id','m-2',
    'sender_address','someone@review.invalid','sender_authenticated',false));
  it := public.document_intake_worker_create_mail_item((m->>'id')::uuid, jsonb_build_object('file_name','fax.pdf','mime','application/pdf','size_bytes',10,'sha256',repeat('d',64)));
  IF (SELECT facility_id FROM public.document_intake_items WHERE id = (it->>'item_id')::uuid) IS DISTINCT FROM f.fac THEN
    RAISE EXCEPTION '548: mail to a facility mailbox did not land in that facility'; END IF;
END $$;
SELECT pg_temp.act(admin_u, admin_s) FROM di;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.document_intake_items WHERE id = (SELECT v::uuid FROM di_state WHERE k='mail_item')) <> 0 THEN
    RAISE EXCEPTION 'I4: a facility administrator can see unknown-facility mail'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act(owner_u, owner_s) FROM di;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.document_intake_items WHERE id = (SELECT v::uuid FROM di_state WHERE k='mail_item')) <> 1 THEN
    RAISE EXCEPTION 'the custodian cannot see unknown-facility mail'; END IF;
END $$;
RESET ROLE;

-- ── Grants: people never reach worker functions ──
DO $$ BEGIN
  IF has_function_privilege('authenticated', 'public.document_intake_worker_claim(text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.document_intake_attest_source(uuid,uuid,integer,text,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.document_intake_attest_filing_object(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.document_intake_prepare_upload(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'I13: a worker or attestation function is executable by a person';
  END IF;
END $$;

ROLLBACK;
