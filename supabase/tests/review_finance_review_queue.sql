-- Independent341 rollback-only discovery verification.
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

-- Independent discovery assertions. Fixture mutation above/below is confined
-- to this rollback transaction; native Auth adaptation is not hosted proof.
RESET ROLE;
CREATE FUNCTION pg_temp.queue_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'QUEUE assertion failed: %',label; END IF;
 PERFORM nextval('pg_temp.batch_assertions'); RAISE NOTICE 'QUEUE PASS: %',label;
END $$;
INSERT INTO bi(label) VALUES('queue_broad'),('queue_scoped'),('queue_successor'),('queue_approval'),('queue_gap'),('queue_empty_entity');
INSERT INTO public.entities(id,organization_id,name) SELECT (SELECT id FROM bi WHERE label='queue_empty_entity'),org,'Empty queue fixture' FROM bf;
CREATE TEMP TABLE queue_expected(id uuid PRIMARY KEY,created_at timestamptz NOT NULL);
CREATE TEMP TABLE queue_seen(id uuid PRIMARY KEY,ordinal integer UNIQUE NOT NULL,created_at timestamptz NOT NULL);
CREATE TEMP TABLE queue_bulk(i integer PRIMARY KEY,id uuid NOT NULL UNIQUE);
INSERT INTO queue_bulk SELECT i,md5('finance-queue-independent-'||(SELECT org FROM bf)||':'||i)::uuid FROM generate_series(1,2505) i;
GRANT ALL ON queue_expected,queue_seen,queue_bulk TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.queue_assert((SELECT bool_and(provolatile='s') FROM pg_proc WHERE oid IN('public.finance_review_queue(uuid,uuid,text,timestamptz,uuid,integer)'::regprocedure,'haven.finance_review_queue(uuid,uuid,text,timestamptz,uuid,integer)'::regprocedure)),'both layers use stable statement snapshots');
SELECT pg_temp.queue_assert(NOT has_function_privilege('anon','public.finance_review_queue(uuid,uuid,text,timestamptz,uuid,integer)','EXECUTE') AND NOT has_function_privilege('service_role','public.finance_review_queue(uuid,uuid,text,timestamptz,uuid,integer)','EXECUTE'),'anonymous and service discovery execution denied');
DO $$ DECLARE f record; k text; result jsonb; BEGIN
 SELECT * INTO f FROM bf;
 FOREACH k IN ARRAY ARRAY['events','batches','rules'] LOOP
  result:=public.finance_review_queue((SELECT id FROM bi WHERE label='queue_empty_entity'),NULL,k);
  PERFORM pg_temp.queue_assert(result->'items'='[]' AND result->>'total_count'='0' AND result->>'returned_count'='0' AND result->>'has_more'='false' AND result->'next_cursor'='null','empty authorized '||k||' returns an explicit empty page');
 END LOOP;
 PERFORM pg_temp.queue_assert(result->>'consistency'='live_page' AND result->>'business_release_eligible'='false' AND result->>'dispatch_enabled'='false' AND result->>'staging_stopped'='true','empty is live unready data, not dispatch or export acceptance');
END $$;
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(gen_random_uuid(),NULL,'events')$q$,'42501','unavailable entity is an error, not empty');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'unknown') FROM bf$q$,'22023','unknown queue kind denied');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,NULL) FROM bf$q$,'22023','explicit null kind denied');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'events',NULL,NULL,0) FROM bf$q$,'22023','zero page size denied');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'events',NULL,NULL,101) FROM bf$q$,'22023','oversized page denied');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'events',NULL,NULL,NULL) FROM bf$q$,'22023','explicit null page size denied');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'events',clock_timestamp(),NULL,10) FROM bf$q$,'22023','timestamp-only cursor denied');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'events',NULL,gen_random_uuid(),10) FROM bf$q$,'22023','id-only cursor denied');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'events','not-a-date'::timestamptz,gen_random_uuid(),10) FROM bf$q$,'22007','malformed timestamp rejected');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'events','infinity'::timestamptz,gen_random_uuid(),10) FROM bf$q$,'22023','infinite timestamp cursor denied');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'events','-infinity'::timestamptz,gen_random_uuid(),10) FROM bf$q$,'22023','negative infinite timestamp cursor denied');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'events',clock_timestamp(),'not-a-uuid'::uuid,10) FROM bf$q$,'22P02','malformed cursor UUID rejected');

-- Shared entity rules may be discovered from an authorized facility, but no
-- actor/session columns are exposed; current-generation binding is explicit.
SELECT public.register_finance_batch_rules((SELECT id FROM bi WHERE label='rules2'),entity,pg_temp.batch_mapping()||'{"companyReference":"456"}',repeat('c',64),1) FROM bf;
SELECT public.prepare_finance_batch((SELECT id FROM bi WHERE label='queue_broad'),entity,NULL,current_date,(SELECT id FROM bi WHERE label='rules2'),pg_temp.batch_members(ARRAY['p1','pb'])) FROM bf;
SELECT pg_temp.batch_login('preparer');
SELECT public.prepare_finance_batch((SELECT id FROM bi WHERE label='queue_scoped'),entity,a,current_date,(SELECT id FROM bi WHERE label='rules2'),pg_temp.batch_members(ARRAY['p2','p3'])) FROM bf;
SELECT pg_temp.batch_login('approver');
SELECT public.decide_finance_batch((SELECT id FROM bi WHERE label='queue_approval'),(SELECT id FROM bi WHERE label='queue_scoped'),'approve',public.finance_batch_snapshot((SELECT id FROM bi WHERE label='queue_scoped'))#>>'{batch,binding_sha256}');
SELECT pg_temp.batch_login('preparer');
DO $$ DECLARE f record; page jsonb; item jsonb; event_id uuid; BEGIN
 SELECT * INTO f FROM bf;
 page:=public.finance_review_queue(f.entity,f.a,'events');
 PERFORM pg_temp.queue_assert(page->>'organization_id'=f.org::text AND page->>'entity_id'=f.entity::text AND page->>'facility_id'=f.a::text AND page->>'kind'='events','returned scope exactly matches current authorized facility');
 PERFORM pg_temp.queue_assert((SELECT bool_and(value->>'facility_id'=f.a::text AND value-ARRAY['id','created_at','facility_id','operation','source_type','source_id','source_version','amount_basis','control_total_cents','claimed','claimed_batch_id']='{}') FROM jsonb_array_elements(page->'items')),'event projection has only authorized summary keys');
 SELECT value INTO item FROM jsonb_array_elements(page->'items') WHERE value->>'source_id'=(SELECT id::text FROM bi WHERE label='p1');
 PERFORM pg_temp.queue_assert(item->>'claimed'='true' AND item->'claimed_batch_id'='null','broader claimed batch identity hidden from restricted preparer');
 PERFORM pg_temp.queue_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(page->'items') WHERE value->>'source_id'=(SELECT id::text FROM bi WHERE label='pb')),'facility B event excluded from A discovery');
 page:=public.finance_review_queue(f.entity,f.a,'batches');
 PERFORM pg_temp.queue_assert(jsonb_array_length(page->'items')=1 AND page#>>'{items,0,id}'=(SELECT id::text FROM bi WHERE label='queue_scoped') AND page#>>'{items,0,status}'='locally_approved_dispatch_disabled','restricted batch discovery excludes broader entity batch');
 PERFORM pg_temp.queue_assert((SELECT bool_and(value-ARRAY['id','created_at','facility_id','accounting_date','status','invalid_reason','source_controls','binding_sha256','accounting_classification','business_release_eligible','dispatch_enabled']='{}' AND value->>'accounting_classification'='unverified' AND value->>'business_release_eligible'='false' AND value->>'dispatch_enabled'='false') FROM jsonb_array_elements(page->'items')),'batch summary excludes payload members and sessions and preserves blockers');
 page:=public.finance_review_queue(f.entity,f.a,'rules');
 PERFORM pg_temp.queue_assert(jsonb_array_length(page->'items')=2 AND (SELECT count(*) FROM jsonb_array_elements(page->'items') WHERE value->>'is_current'='true')=1 AND (SELECT value->>'id' FROM jsonb_array_elements(page->'items') WHERE value->>'is_current'='true')=(SELECT id::text FROM bi WHERE label='rules2'),'same-entity rule history has one explicit current version');
 PERFORM pg_temp.queue_assert((SELECT bool_and(value-ARRAY['id','created_at','mapping','content_sha256','policy_reference_sha256','status','is_current','current_generation']='{}' AND value->>'current_generation'='2' AND value->>'status'='declared_draft') FROM jsonb_array_elements(page->'items')),'rules expose declared references, not creator or session data');
END $$;
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,b,'events') FROM bf$q$,'42501','restricted other-facility discovery denied');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,NULL,'events') FROM bf$q$,'42501','restricted null-facility broad discovery denied');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(other_entity,c,'rules') FROM bf$q$,'42501','other organization rules denied');
SELECT pg_temp.batch_login('outsider');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'batches') FROM bf$q$,'42501','outsider cannot discover known batch scope');
SELECT pg_temp.queue_assert(public.finance_review_queue(other_entity,c,'events')->>'total_count'='1','outsider sees only its own authorized fixture') FROM bf;
SELECT pg_temp.batch_login('owner');
SELECT pg_temp.queue_assert(public.finance_review_queue(entity,NULL,'batches')->>'total_count'='2','owner can discover broader entity batches') FROM bf;
DO $$ DECLARE f record; page jsonb; item jsonb; first_page jsonb; second_page jsonb; kind text; BEGIN
 SELECT * INTO f FROM bf;
 page:=public.finance_review_queue(f.entity,f.a,'events');
 SELECT value INTO item FROM jsonb_array_elements(page->'items') WHERE value->>'source_id'=(SELECT id::text FROM bi WHERE label='p1');
 PERFORM pg_temp.queue_assert(item->>'claimed'='true' AND item->'claimed_batch_id'='null','owner facility page does not link to a broader batch detail');
 page:=public.finance_review_queue(f.entity,NULL,'events');
 SELECT value INTO item FROM jsonb_array_elements(page->'items') WHERE value->>'source_id'=(SELECT id::text FROM bi WHERE label='p1');
 PERFORM pg_temp.queue_assert(item->>'claimed_batch_id'=(SELECT id::text FROM bi WHERE label='queue_broad'),'owner entity scope may resolve broader claimed batch');
 FOREACH kind IN ARRAY ARRAY['batches','rules'] LOOP
  first_page:=public.finance_review_queue(f.entity,NULL,kind,NULL,NULL,1);
  second_page:=public.finance_review_queue(f.entity,NULL,kind,(first_page#>>'{next_cursor,created_at}')::timestamptz,(first_page#>>'{next_cursor,id}')::uuid,1);
  PERFORM pg_temp.queue_assert(first_page->>'total_count'='2' AND first_page->>'has_more'='true' AND second_page->>'has_more'='false' AND first_page#>>'{items,0,id}' IS DISTINCT FROM second_page#>>'{items,0,id}' AND jsonb_array_length(second_page->'items')=1,kind||' keyset visits distinct first and last rows');
 END LOOP;
END $$;

SAVEPOINT queue_revocation;
RESET ROLE;
DELETE FROM auth.sessions WHERE id=(SELECT session_id FROM ba WHERE label='preparer');
SET LOCAL ROLE authenticated;
SELECT pg_temp.queue_assert((SELECT value->>'status'='invalidated' AND value->>'invalid_reason'='preparer_authority_changed' FROM jsonb_array_elements(public.finance_review_queue(entity,a,'batches')->'items') WHERE value->>'id'=(SELECT id::text FROM bi WHERE label='queue_scoped')),'queue derives revoked-preparer invalidity instead of stale stored approval') FROM bf;
RESET ROLE;
SELECT pg_temp.queue_assert((SELECT status='locally_approved_dispatch_disabled' FROM public.finance_batches WHERE id=(SELECT id FROM bi WHERE label='queue_scoped')),'discovery does not rewrite historical stored approval');
SET LOCAL ROLE authenticated;
SELECT pg_temp.batch_login('preparer');
SELECT pg_temp.batch_error($q$SELECT public.finance_review_queue(entity,a,'events') FROM bf$q$,'42501','revoked caller cannot read queue');
ROLLBACK TO queue_revocation;
RELEASE queue_revocation;
SELECT pg_temp.batch_login('owner');
SELECT public.prepare_finance_batch((SELECT id FROM bi WHERE label='queue_successor'),entity,a,current_date,(SELECT id FROM bi WHERE label='rules2'),pg_temp.batch_members(ARRAY['p3']),(SELECT id FROM bi WHERE label='queue_scoped')) FROM bf;
DO $$ DECLARE page jsonb; released jsonb; retained jsonb; BEGIN
 SELECT public.finance_review_queue(entity,a,'events') INTO page FROM bf;
 SELECT value INTO released FROM jsonb_array_elements(page->'items') WHERE value->>'source_id'=(SELECT id::text FROM bi WHERE label='p2');
 SELECT value INTO retained FROM jsonb_array_elements(page->'items') WHERE value->>'source_id'=(SELECT id::text FROM bi WHERE label='p3');
 PERFORM pg_temp.queue_assert(released->>'claimed'='false' AND released->'claimed_batch_id'='null','dropped predecessor member becomes discoverably unclaimed');
 PERFORM pg_temp.queue_assert(retained->>'claimed'='true' AND retained->>'claimed_batch_id'=(SELECT id::text FROM bi WHERE label='queue_successor'),'retained member points only to successor claim');
END $$;

-- Construct one real payment/receipt without the post339 trigger, simulating
-- retained history predating event capture. This setup bypass is local only.
RESET ROLE;
ALTER TABLE public.finance_command_receipts DISABLE TRIGGER finance_receipt_stage;
SET LOCAL ROLE authenticated;
SELECT public.record_finance_payment((SELECT id FROM bi WHERE label='queue_gap'),resident_a,NULL,current_date,7,'check') FROM bf;
RESET ROLE;
ALTER TABLE public.finance_command_receipts ENABLE TRIGGER finance_receipt_stage;
SET LOCAL ROLE authenticated;
SELECT pg_temp.queue_assert(public.finance_review_queue(entity,a,'events')->>'unrepresented_eligible_receipts'='1' AND public.finance_review_queue(entity,a,'events')->>'coverage_scope'='finance_command_receipts_336_only','historical eligible receipt gap is explicit') FROM bf;
SELECT pg_temp.queue_assert(public.finance_review_queue(entity,b,'events')->>'unrepresented_eligible_receipts'='0','coverage gap does not bleed into another facility') FROM bf;

-- Seed2505 additional genuine source commands with exactly equal event times.
-- Paging a fixed synthetic fixture proves keyset completeness beyond common
-- REST caps; this is not an executed PostgREST or cross-request MVCC export.
RESET ROLE;
CREATE FUNCTION pg_temp.queue_equal_event_time() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_temp.queue_bulk WHERE id=NEW.receipt_id) THEN NEW.created_at:='2098-01-01 12:00:00.123456+00'::timestamptz; END IF; RETURN NEW;
END $$;
CREATE TRIGGER queue_test_event_time BEFORE INSERT ON public.finance_source_events FOR EACH ROW EXECUTE FUNCTION pg_temp.queue_equal_event_time();
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; payment uuid; BEGIN
 SELECT * INTO f FROM bf;
 FOR payment IN SELECT id FROM queue_bulk ORDER BY i LOOP
  PERFORM public.record_finance_payment(payment,f.resident_a,NULL,current_date,1,'check');
 END LOOP;
END $$;
RESET ROLE;
DROP TRIGGER queue_test_event_time ON public.finance_source_events;
INSERT INTO queue_expected SELECT e.id,e.created_at FROM public.finance_source_events e CROSS JOIN bf f
 WHERE e.organization_id=f.org AND e.entity_id=f.entity AND e.facility_id=f.a;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; page jsonb; cursor_time timestamptz:=NULL; cursor_id uuid:=NULL; item jsonb; ordinal integer:=0; pages integer:=0; expected integer; BEGIN
 SELECT * INTO f FROM bf; SELECT count(*) INTO expected FROM queue_expected;
 PERFORM pg_temp.queue_assert(expected=2509,'independent source oracle contains2509 scoped events');
 LOOP
  pages:=pages+1;
  IF pages>30 THEN RAISE EXCEPTION 'Cursor failed to terminate'; END IF;
  page:=public.finance_review_queue(f.entity,f.a,'events',cursor_time,cursor_id,100);
  PERFORM pg_temp.queue_assert(page->>'consistency'='live_page' AND (page->>'returned_count')::integer=jsonb_array_length(page->'items') AND jsonb_array_length(page->'items') BETWEEN 1 AND 100 AND (page->>'total_count')::integer=expected,'bounded coherent live page '||pages);
  FOR item IN SELECT value FROM jsonb_array_elements(page->'items') LOOP
   ordinal:=ordinal+1;
   INSERT INTO queue_seen VALUES((item->>'id')::uuid,ordinal,(item->>'created_at')::timestamptz);
  END LOOP;
  IF page->>'has_more'='false' THEN
   PERFORM pg_temp.queue_assert(page->'next_cursor'='null','last page has no continuation'); EXIT;
  END IF;
  PERFORM pg_temp.queue_assert(page->'next_cursor'->>'id'=(page->'items'-> -1)->>'id' AND (page->'next_cursor'->>'created_at')::timestamptz=((page->'items'-> -1)->>'created_at')::timestamptz,'cursor equals final full-precision tuple on page '||pages);
  cursor_time:=(page->'next_cursor'->>'created_at')::timestamptz; cursor_id:=(page->'next_cursor'->>'id')::uuid;
 END LOOP;
 PERFORM pg_temp.queue_assert(ordinal=expected AND pages=26,'all2509 events traversed without duplicate IDs');
 PERFORM pg_temp.queue_assert((SELECT array_agg(s.id ORDER BY s.ordinal) FROM queue_seen s)=(SELECT array_agg(e.id ORDER BY e.created_at DESC,e.id DESC) FROM queue_expected e),'page sequence exactly matches independent timestamp UUID order');
 PERFORM pg_temp.queue_assert((SELECT count(*) FROM queue_seen WHERE created_at='2098-01-01 12:00:00.123456+00')=2505,'equal microsecond timestamps traverse every UUID tie');
 page:=public.finance_review_queue(f.entity,f.a,'events',date '1900-01-01',gen_random_uuid(),10);
 PERFORM pg_temp.queue_assert(page->'items'='[]' AND page->>'total_count'=expected::text AND page->>'has_more'='false' AND page->'next_cursor'='null','exhausted cursor is empty without losing scope count');
END $$;
RESET ROLE;
SELECT jsonb_build_object('suite','finance-review-queue','status','PASS','assertions',(SELECT last_value FROM batch_assertions),'skips',0,'consistency','live_page','layer','native-PostgreSQL-with-Auth-stubs');
ROLLBACK;
