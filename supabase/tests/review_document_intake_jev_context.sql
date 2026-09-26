-- COL-771 (migration 561, DI-09): the Document Intake worker's subjects RPC
-- carries admission dates, the receiving facility's license context, and the
-- organization's facility names (never another organization's, never a
-- deleted facility), and stays service_role only.
-- Local disposable replay only: every fixture rolls back. Synthetic data only.
BEGIN;

CREATE TEMP TABLE jc AS SELECT
  gen_random_uuid() org, gen_random_uuid() ent, gen_random_uuid() fac, gen_random_uuid() sister,
  gen_random_uuid() gone, gen_random_uuid() other_org, gen_random_uuid() other_ent, gen_random_uuid() other_fac,
  gen_random_uuid() res, gen_random_uuid() item;

INSERT INTO organizations(id,name) SELECT org,'Jev context review' FROM jc
  UNION ALL SELECT other_org,'Jev context other org' FROM jc;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Example Entity' FROM jc
  UNION ALL SELECT other_ent,other_org,'Other Entity' FROM jc;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,legal_name,dba,ahca_license_number,ahca_license_expiration)
  SELECT fac,ent,org,'Example Lodge','1 Way','Exampleton','00000',36,'Example Lodge Holdings LLC','Example Lodge ALF','12345','2027-06-30'::date FROM jc
  UNION ALL SELECT sister,ent,org,'Sister Oaks','2 Way','Othertown','00000',20,'Sister Oaks Holdings LLC',NULL,NULL,NULL FROM jc
  UNION ALL SELECT other_fac,other_ent,other_org,'Elsewhere Manor','3 Way','Far','00000',10,NULL,NULL,NULL,NULL FROM jc;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,deleted_at)
  SELECT gone,ent,org,'Closed Place','4 Way','Gone','00000',5,now() FROM jc;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,admission_date)
  SELECT res,fac,org,'Resident','Example','1940-01-01'::date,'other','2026-09-15'::date FROM jc;
INSERT INTO public.document_intake_items(id,organization_id,facility_id,channel,original_filename,declared_mime,declared_size_bytes,
    declared_sha256,storage_path,created_principal)
  SELECT item,org,fac,'upload','example.pdf','application/pdf',10,repeat('a',64),org||'/'||fac||'/'||item||'/original','person' FROM jc;

DO $$
DECLARE s jsonb; f jsonb; names text[]; c record;
BEGIN
  SELECT * INTO c FROM jc;
  s := public.document_intake_worker_subjects(c.item);

  IF s->'residents'->0->>'admission_date' IS DISTINCT FROM '2026-09-15' THEN
    RAISE EXCEPTION '561: residents do not carry admission_date: %', s->'residents'->0;
  END IF;

  f := s->'facility';
  IF f->>'id' <> c.fac::text OR f->>'name' <> 'Example Lodge' OR f->>'legal_name' <> 'Example Lodge Holdings LLC'
    OR f->>'dba' <> 'Example Lodge ALF' OR f->>'city' <> 'Exampleton' OR f->>'ahca_license_number' <> '12345'
    OR f->>'ahca_license_expiration' <> '2027-06-30' OR (f->>'total_licensed_beds')::int <> 36 THEN
    RAISE EXCEPTION '561: facility context is wrong: %', f;
  END IF;

  IF jsonb_typeof(s->'org_facilities') <> 'array' THEN RAISE EXCEPTION '561: org_facilities missing'; END IF;
  SELECT array_agg(x->>'name' ORDER BY x->>'name') INTO names FROM jsonb_array_elements(s->'org_facilities') x;
  IF names IS DISTINCT FROM ARRAY['Example Lodge','Sister Oaks'] THEN
    RAISE EXCEPTION '561: org_facilities must be exactly this organization''s non-deleted facilities, got %', names;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s->'org_facilities') x
      WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x) k) IS DISTINCT FROM ARRAY['city','dba','id','legal_name','name']) THEN
    RAISE EXCEPTION '561: org_facilities entries carry keys other than id, name, legal_name, dba, city';
  END IF;
END $$;

-- Definer posture unchanged: service_role only, pinned search_path, ruled.
DO $$
DECLARE fn oid := 'public.document_intake_worker_subjects(uuid)'::regprocedure;
BEGIN
  IF pg_catalog.has_function_privilege('authenticated', fn, 'EXECUTE') OR pg_catalog.has_function_privilege('anon', fn, 'EXECUTE') THEN
    RAISE EXCEPTION '561: a person can execute document_intake_worker_subjects';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', fn, 'EXECUTE') THEN
    RAISE EXCEPTION '561: service_role lost document_intake_worker_subjects';
  END IF;
  IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid = fn) THEN
    RAISE EXCEPTION '561: document_intake_worker_subjects must stay SECURITY DEFINER with search_path pinned';
  END IF;
  IF COALESCE(pg_catalog.obj_description(fn, 'pg_proc'), '') NOT LIKE '%COL-37 ruling:%' THEN
    RAISE EXCEPTION '561: document_intake_worker_subjects has no COL-37 ruling comment';
  END IF;
END $$;

ROLLBACK;
