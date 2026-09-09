-- F03 rollback-only staging assertions. Native/Supabase test database only.
-- Disposable PostgreSQL replay only. Fixture records and auth adaptation roll back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE business_fixture AS SELECT gen_random_uuid() actor, gen_random_uuid() actor_session, gen_random_uuid() account, gen_random_uuid() deposit,
 gen_random_uuid() withdrawal,gen_random_uuid() journal,gen_random_uuid() debit_account,gen_random_uuid() credit_account,
 gen_random_uuid() employee,gen_random_uuid() punch,gen_random_uuid() resident,f.id facility,f.entity_id entity,f.organization_id org
 FROM public.facilities f WHERE f.deleted_at IS NULL AND f.entity_id IS NOT NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM business_fixture) THEN RAISE EXCEPTION 'Replay seed facility required'; END IF; END $$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),jsonb_build_object('full_name','Review finance') FROM business_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor,actor||'@review.invalid','Review finance','owner',org,true FROM business_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM business_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM business_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,
  'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
  'role','authenticated','app_role','owner','organization_id',f.org,
  'app_metadata',jsonb_build_object('app_role','owner','organization_id',f.org))::text,true)
FROM business_fixture f JOIN public.user_profiles p ON p.id=f.actor;
INSERT INTO public.gl_accounts(id,organization_id,entity_id,code,name,account_type)
 SELECT debit_account,org,entity,'review-'||debit_account,'Review debit','asset'::public.gl_account_type FROM business_fixture
 UNION ALL SELECT credit_account,org,entity,'review-'||credit_account,'Review credit','asset'::public.gl_account_type FROM business_fixture;
INSERT INTO public.petty_cash_accounts(id,organization_id,facility_id) SELECT account,org,facility FROM business_fixture;
INSERT INTO public.staff(id,organization_id,facility_id,user_id,first_name,last_name,staff_role,hire_date)
 SELECT employee,org,facility,actor,'Review','Employee','resident_aide',current_date FROM business_fixture;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender)
 SELECT resident,facility,org,'Review','Resident','1940-01-01','female' FROM business_fixture;


ALTER TABLE business_fixture ADD COLUMN invoice uuid DEFAULT gen_random_uuid(), ADD COLUMN payment uuid DEFAULT gen_random_uuid(), ADD COLUMN reversal uuid DEFAULT gen_random_uuid();
INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,total,subtotal,balance_due,status)
 SELECT invoice,resident,facility,org,entity,'finance-'||invoice,current_date,current_date,current_date,current_date,10000,10000,10000,'sent' FROM business_fixture;
INSERT INTO public.entity_gl_settings(organization_id,entity_id,accounts_receivable_id,cash_id,revenue_id)
 SELECT org,entity,debit_account,credit_account,credit_account FROM business_fixture
 ON CONFLICT(entity_id) DO UPDATE SET accounts_receivable_id=excluded.accounts_receivable_id,cash_id=excluded.cash_id,revenue_id=excluded.revenue_id;
-- Local replay stubs do not provision Supabase's normal table/schema grants.
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON business_fixture TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.invoices,public.payments,public.journal_entries,public.journal_entry_lines,public.gl_period_closes TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.invoice_line_items TO authenticated;
CREATE FUNCTION pg_temp.finance_expect_error(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE expected THEN RAISE EXCEPTION 'Unexpected error: % (wanted %)',SQLERRM,expected; END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'Expected rejection: %',statement;
END $$;
CREATE TEMP SEQUENCE f03_assertions;
GRANT USAGE,SELECT ON SEQUENCE f03_assertions TO authenticated,service_role;
CREATE TEMP TABLE f03_ids(label text PRIMARY KEY,id uuid NOT NULL DEFAULT gen_random_uuid(),key uuid);
INSERT INTO f03_ids(label) VALUES('control'),('command'),('attempt'),('retry'),('worker'),('connection'),('failure'),('stopped_payment'),('manual'),('manual_null'),('cancel');
GRANT ALL ON f03_ids TO authenticated;
GRANT SELECT ON f03_ids,business_fixture TO service_role;
CREATE FUNCTION pg_temp.f03_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'F03 assertion failed: %',label; END IF;
 PERFORM nextval('pg_temp.f03_assertions'); RAISE NOTICE 'F03 PASS: %',label;
END $$;
CREATE FUNCTION pg_temp.f03_error(stmt text,code text,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>code THEN RAISE EXCEPTION 'F03 unexpected error %: % (expected %)',SQLSTATE,SQLERRM,code; END IF;
  PERFORM pg_temp.f03_assert(true,label); RETURN;
 END;
 RAISE EXCEPTION 'F03 expected rejection: %',label;
END $$;
SELECT pg_temp.f03_assert((SELECT count(*)=1 AND bool_and(a.atttypid='uuid'::regtype) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.contype='p' AND c.conrelid='public.finance_source_events'::regclass),'event-primary-key-is-uuid');
SELECT pg_temp.f03_assert((SELECT count(*)=1 AND bool_and(a.atttypid='uuid'::regtype) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.contype='p' AND c.conrelid='public.finance_outbound_intents'::regclass),'intent-primary-key-is-uuid');
SELECT pg_temp.f03_assert((SELECT bool_and(provolatile='s') FROM pg_proc WHERE oid IN('haven.finance_staging_summary(uuid,uuid)'::regprocedure,'public.finance_staging_summary(uuid,uuid)'::regprocedure)),'summary-uses-one-stable-read-snapshot');
SET LOCAL ROLE authenticated;
SELECT public.record_finance_payment(payment,resident,invoice,current_date,2500,'check') FROM business_fixture;
UPDATE f03_ids SET key=(SELECT i.id FROM public.finance_outbound_intents i JOIN public.finance_source_events e ON e.id=i.event_id WHERE e.receipt_id=(SELECT payment FROM business_fixture)) WHERE label='command';
SELECT pg_temp.f03_assert((SELECT count(*) FROM public.finance_source_events WHERE receipt_id=f.payment AND operation='payment_received' AND control_total_cents=2500)=1
 AND (SELECT count(*) FROM public.finance_outbound_intents WHERE id=(SELECT key FROM f03_ids WHERE label='command'))=1,'source-receipt-event-intent-commit-together') FROM business_fixture f;
SELECT pg_temp.f03_assert((SELECT i.identity_sha256=encode(sha256(convert_to('haven-outbound-stage-v1:'||e.identity_sha256,'UTF8')),'hex')
 AND e.identity_sha256=encode(sha256(convert_to(concat_ws(':','haven-finance-event-v1',e.organization_id,e.entity_id,e.source_type,e.source_id,e.source_version,e.operation),'UTF8')),'hex')
 FROM public.finance_outbound_intents i JOIN public.finance_source_events e ON e.id=i.event_id WHERE e.receipt_id=(SELECT payment FROM business_fixture)),'uuid-keys-preserve-deterministic-source-intent-hashes');
SELECT pg_temp.f03_assert((SELECT stopped AND NOT dispatch_enabled AND staging_generation=0 FROM public.finance_staging_controls WHERE entity_id=entity),'new-entity-starts-stopped-dispatch-disabled') FROM business_fixture;
SELECT pg_temp.f03_assert(NOT EXISTS(SELECT 1 FROM public.finance_outbound_intents WHERE external_payload IS NOT NULL OR dispatch_enabled),'no-external-payload-or-enabled-dispatch');
SELECT public.record_finance_payment(payment,resident,invoice,current_date,2500,'check') FROM business_fixture;
SELECT pg_temp.f03_assert((SELECT count(*) FROM public.finance_source_events WHERE receipt_id=payment)=1,'same-source-replay-one-event') FROM business_fixture;
SELECT pg_temp.f03_error($q$SELECT public.record_finance_payment(payment,resident,invoice,current_date,2600,'check') FROM business_fixture$q$,'23505','same-source-identity-changed-content-conflict');
SELECT public.post_finance_source('invoice',invoice),public.post_finance_source('payment',payment) FROM business_fixture;
SELECT pg_temp.f03_assert((SELECT count(*) FROM public.finance_source_events WHERE receipt_id=payment)=1
 AND NOT EXISTS(SELECT 1 FROM public.finance_source_events WHERE receipt_type='payment_post'),'payment-and-native-gl-never-two-economic-events') FROM business_fixture;
SELECT pg_temp.f03_assert((SELECT count(*) FROM public.finance_source_events WHERE receipt_id=invoice AND operation='invoice_posted')=1,'invoice-post-has-one-explicit-origin') FROM business_fixture;
DO $$ DECLARE f record; j uuid; stamp timestamptz; BEGIN
 SELECT * INTO f FROM business_fixture; SELECT id INTO j FROM f03_ids WHERE label='manual';
 PERFORM public.save_journal_draft(j,f.entity,f.facility,current_date,'Synthetic four-billion-cent journal',jsonb_build_array(
 jsonb_build_object('line_number',1,'gl_account_id',f.debit_account,'debit_cents',2000000000,'credit_cents',0),
 jsonb_build_object('line_number',2,'gl_account_id',f.debit_account,'debit_cents',2000000000,'credit_cents',0),
 jsonb_build_object('line_number',3,'gl_account_id',f.credit_account,'debit_cents',0,'credit_cents',2000000000),
 jsonb_build_object('line_number',4,'gl_account_id',f.credit_account,'debit_cents',0,'credit_cents',2000000000)));
 SELECT updated_at INTO stamp FROM public.journal_entries WHERE id=j;
 PERFORM public.post_finance_journal(j,stamp);
 PERFORM public.reverse_finance_journal(f.reversal,j,current_date,'Synthetic reversal');
 PERFORM pg_temp.f03_assert((SELECT control_total_cents FROM public.finance_source_events WHERE receipt_id=j)=4000000000,'single-journal-control-total-above-int32');
 PERFORM pg_temp.f03_assert(public.finance_staging_summary(f.entity,f.facility)->'control_totals_by_basis'->>'journal_debit_total'='8000000000','aggregation-above-int32-as-exact-decimal-string');
END $$;
SELECT public.resolve_finance_payment((SELECT id FROM f03_ids WHERE label='cancel'),resident,invoice,current_date,100,'check') FROM business_fixture;
SELECT pg_temp.f03_assert(NOT EXISTS(SELECT 1 FROM public.finance_source_events WHERE receipt_id=(SELECT id FROM f03_ids WHERE label='cancel')),'no-money-cancellation-has-no-outbound-intent');

RESET ROLE;
CREATE FUNCTION pg_temp.f03_fail_stage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected F03 stage failure'; END $$;
CREATE TRIGGER f03_fail_event BEFORE INSERT ON public.finance_source_events FOR EACH ROW EXECUTE FUNCTION pg_temp.f03_fail_stage();
SET LOCAL ROLE authenticated;
SELECT pg_temp.f03_error($q$SELECT public.record_finance_payment((SELECT id FROM f03_ids WHERE label='failure'),resident,invoice,current_date,100,'check') FROM business_fixture$q$,'P0001','event-insert-failure-rejects-source-transaction');
SELECT pg_temp.f03_assert(NOT EXISTS(SELECT 1 FROM public.payments WHERE id=(SELECT id FROM f03_ids WHERE label='failure'))
 AND NOT EXISTS(SELECT 1 FROM public.finance_command_receipts WHERE id=(SELECT id FROM f03_ids WHERE label='failure'))
 AND (SELECT amount_paid FROM public.invoices WHERE id=(SELECT invoice FROM business_fixture))=2500,'event-failure-leaves-no-payment-receipt-or-balance-change');
RESET ROLE;
DROP TRIGGER f03_fail_event ON public.finance_source_events;
CREATE TRIGGER f03_fail_intent BEFORE INSERT ON public.finance_outbound_intents FOR EACH ROW EXECUTE FUNCTION pg_temp.f03_fail_stage();
SET LOCAL ROLE authenticated;
SELECT pg_temp.f03_error($q$SELECT public.record_finance_payment((SELECT id FROM f03_ids WHERE label='failure'),resident,invoice,current_date,100,'check') FROM business_fixture$q$,'P0001','intent-insert-failure-rejects-source-transaction');
SELECT pg_temp.f03_assert(NOT EXISTS(SELECT 1 FROM public.payments WHERE id=(SELECT id FROM f03_ids WHERE label='failure'))
 AND NOT EXISTS(SELECT 1 FROM public.finance_source_events WHERE receipt_id=(SELECT id FROM f03_ids WHERE label='failure'))
 AND NOT EXISTS(SELECT 1 FROM public.payment_allocations WHERE payment_id=(SELECT id FROM f03_ids WHERE label='failure'))
 AND (SELECT amount_paid FROM public.invoices WHERE id=(SELECT invoice FROM business_fixture))=2500,'intent-failure-rolls-back-event-payment-allocation');
RESET ROLE;
DROP TRIGGER f03_fail_intent ON public.finance_outbound_intents;
SET LOCAL ROLE authenticated;
SELECT pg_temp.f03_error($q$SELECT public.queue_finance_outbound(id,key) FROM f03_ids WHERE label='command'$q$,'42501','stopped-entity-cannot-queue');
SELECT public.set_finance_staging_control((SELECT id FROM f03_ids WHERE label='control'),entity,0,false,(SELECT id FROM f03_ids WHERE label='connection'),repeat('a',64),(SELECT id FROM f03_ids WHERE label='worker')) FROM business_fixture;
SELECT public.set_finance_staging_control((SELECT id FROM f03_ids WHERE label='control'),entity,0,false,(SELECT id FROM f03_ids WHERE label='connection'),repeat('a',64),(SELECT id FROM f03_ids WHERE label='worker')) FROM business_fixture;
SELECT pg_temp.f03_assert((SELECT staging_generation FROM public.finance_staging_controls WHERE entity_id=entity)=1,'control-replay-does-not-increment-generation') FROM business_fixture;
SELECT pg_temp.f03_error($q$SELECT public.set_finance_staging_control((SELECT id FROM f03_ids WHERE label='control'),entity,0,true,NULL,NULL,NULL) FROM business_fixture$q$,'23505','control-identity-content-conflict');
SELECT public.queue_finance_outbound(id,key) FROM f03_ids WHERE label='command';
SELECT public.queue_finance_outbound(id,key) FROM f03_ids WHERE label='command';
SELECT pg_temp.f03_assert((SELECT count(*) FROM public.finance_staging_commands WHERE intent_id=(SELECT key FROM f03_ids WHERE label='command'))=1,'queue-replay-one-immutable-command');
SELECT pg_temp.f03_error($q$SELECT public.queue_finance_outbound(gen_random_uuid(),key) FROM f03_ids WHERE label='command'$q$,'23505','different-request-cannot-duplicate-root-command');
SAVEPOINT unattempted_rebind;
SELECT public.set_finance_staging_control(gen_random_uuid(),entity,1,false,gen_random_uuid(),repeat('c',64),(SELECT id FROM f03_ids WHERE label='worker')) FROM business_fixture;
SELECT pg_temp.f03_error($q$SELECT public.queue_finance_outbound(id,key) FROM f03_ids WHERE label='command'$q$,'40001','rebind-before-first-attempt-fences-old-command');
SELECT public.queue_finance_outbound((SELECT id FROM f03_ids WHERE label='retry'),(SELECT key FROM f03_ids WHERE label='command'),(SELECT id FROM f03_ids WHERE label='command'));
SELECT pg_temp.f03_assert((SELECT operation='supersede' AND staging_generation=2 AND retry_of=(SELECT id FROM f03_ids WHERE label='command') FROM public.finance_staging_commands WHERE id=(SELECT id FROM f03_ids WHERE label='retry')),'stale-unattempted-command-can-be-superseded');
SELECT pg_temp.f03_error($q$SELECT public.queue_finance_outbound(gen_random_uuid(),(SELECT key FROM f03_ids WHERE label='command'),(SELECT id FROM f03_ids WHERE label='command'))$q$,'23505','supersede-chain-cannot-fork');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.f03_assert(public.record_finance_staging_attempt(gen_random_uuid(),(SELECT id FROM f03_ids WHERE label='retry'),(SELECT id FROM f03_ids WHERE label='worker'))->>'outcome'='blocked_dispatch_disabled','superseded-command-reaches-current-worker-without-dispatch');
ROLLBACK TO unattempted_rebind;
RELEASE unattempted_rebind;
SELECT pg_temp.f03_error($q$SELECT public.record_finance_staging_attempt((SELECT id FROM f03_ids WHERE label='attempt'),(SELECT id FROM f03_ids WHERE label='command'),(SELECT id FROM f03_ids WHERE label='worker'))$q$,'42501','human-cannot-impersonate-worker');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.record_finance_staging_attempt((SELECT id FROM f03_ids WHERE label='attempt'),(SELECT id FROM f03_ids WHERE label='command'),(SELECT id FROM f03_ids WHERE label='worker'));
SELECT public.record_finance_staging_attempt((SELECT id FROM f03_ids WHERE label='attempt'),(SELECT id FROM f03_ids WHERE label='command'),(SELECT id FROM f03_ids WHERE label='worker'));
SELECT pg_temp.f03_error($q$SELECT public.record_finance_staging_attempt(gen_random_uuid(),(SELECT id FROM f03_ids WHERE label='command'),gen_random_uuid())$q$,'42501','unregistered-worker-denied');
SELECT pg_temp.f03_error($q$SELECT * FROM public.finance_source_events$q$,'42501','worker-cannot-read-unbounded-source-events');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.f03_assert((SELECT count(*) FROM public.finance_staging_attempts WHERE command_id=(SELECT id FROM f03_ids WHERE label='command'))=1
 AND NOT EXISTS(SELECT 1 FROM public.finance_staging_attempts WHERE outcome<>'blocked_dispatch_disabled'),'worker-attempt-is-idempotent-blocked-evidence-only');
SELECT public.set_finance_staging_control(gen_random_uuid(),entity,1,true,(SELECT id FROM f03_ids WHERE label='connection'),repeat('a',64),(SELECT id FROM f03_ids WHERE label='worker')) FROM business_fixture;
SELECT public.record_finance_payment((SELECT id FROM f03_ids WHERE label='stopped_payment'),resident,invoice,current_date,100,'check') FROM business_fixture;
SELECT pg_temp.f03_assert((SELECT count(*) FROM public.finance_source_events WHERE receipt_id=(SELECT id FROM f03_ids WHERE label='stopped_payment'))=1
 AND (SELECT count(*) FROM public.finance_staging_attempts)=1,'stop-preserves-new-inbound-events-and-existing-evidence');
SELECT pg_temp.f03_error($q$SELECT public.queue_finance_outbound(id,key) FROM f03_ids WHERE label='command'$q$,'42501','stopped-command-replay-denied');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.f03_error($q$SELECT public.record_finance_staging_attempt((SELECT id FROM f03_ids WHERE label='attempt'),(SELECT id FROM f03_ids WHERE label='command'),(SELECT id FROM f03_ids WHERE label='worker'))$q$,'42501','stop-revokes-worker-even-on-replay');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT public.set_finance_staging_control(gen_random_uuid(),entity,2,false,gen_random_uuid(),repeat('b',64),(SELECT id FROM f03_ids WHERE label='worker')) FROM business_fixture;
SELECT pg_temp.f03_error($q$SELECT public.queue_finance_outbound(id,key) FROM f03_ids WHERE label='command'$q$,'40001','rebind-fences-old-queue-generation');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.f03_error($q$SELECT public.record_finance_staging_attempt(gen_random_uuid(),(SELECT id FROM f03_ids WHERE label='command'),(SELECT id FROM f03_ids WHERE label='worker'))$q$,'40001','rebind-fences-old-worker-command');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT public.queue_finance_outbound((SELECT id FROM f03_ids WHERE label='retry'),(SELECT key FROM f03_ids WHERE label='command'),(SELECT id FROM f03_ids WHERE label='command'));
SELECT pg_temp.f03_assert((SELECT staging_generation=3 AND capability_reference_sha256=repeat('b',64) AND retry_of=(SELECT id FROM f03_ids WHERE label='command') FROM public.finance_staging_commands WHERE id=(SELECT id FROM f03_ids WHERE label='retry')),'retry-freezes-new-generation-with-original-intent');
SELECT pg_temp.f03_error($q$SELECT public.queue_finance_outbound(gen_random_uuid(),(SELECT key FROM f03_ids WHERE label='command'),(SELECT id FROM f03_ids WHERE label='command'))$q$,'23505','retry-chain-cannot-fork');
SELECT pg_temp.f03_error($q$UPDATE public.finance_outbound_intents SET external_payload='{}'::jsonb$q$,'42501','application-cannot-add-external-payload');
RESET ROLE;
SELECT pg_temp.f03_error($q$UPDATE public.finance_source_events SET control_total_cents=1$q$,'42501','source-events-immutable-even-owner');
SELECT pg_temp.f03_error($q$DELETE FROM public.finance_staging_attempts$q$,'42501','attempt-evidence-cannot-be-erased');

-- Current authority must be rechecked on reads and all operator actions.
SAVEPOINT authority_case;
DELETE FROM auth.sessions WHERE id=(SELECT actor_session FROM business_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.f03_error($q$SELECT public.finance_staging_summary(entity,facility) FROM business_fixture$q$,'42501','revoked-session-summary-denied');
SELECT pg_temp.f03_error($q$SELECT public.queue_finance_outbound(id,key) FROM f03_ids WHERE label='command'$q$,'42501','revoked-session-queue-denied');
SELECT pg_temp.f03_error($q$SELECT public.set_finance_staging_control(gen_random_uuid(),entity,3,true,NULL,NULL,NULL) FROM business_fixture$q$,'42501','revoked-session-controls-denied');
SELECT pg_temp.f03_assert((SELECT count(*) FROM public.finance_source_events)=0,'revoked-session-rls-hides-evidence');
ROLLBACK TO authority_case;
UPDATE public.user_profiles SET auth_claim_version=auth_claim_version+1 WHERE id=(SELECT actor FROM business_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.f03_error($q$SELECT public.finance_staging_summary(entity,facility) FROM business_fixture$q$,'42501','stale-claim-summary-denied');
ROLLBACK TO authority_case;
RELEASE authority_case;

-- Different entities are denied even to an owner outside their organization.
ALTER TABLE business_fixture ADD COLUMN other_org uuid DEFAULT gen_random_uuid(),ADD COLUMN other_entity uuid DEFAULT gen_random_uuid(),ADD COLUMN other_facility uuid DEFAULT gen_random_uuid();
INSERT INTO public.organizations(id,name) SELECT other_org,'Synthetic other staging organization' FROM business_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT other_entity,other_org,'Synthetic other staging entity' FROM business_fixture;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT other_facility,other_org,other_entity,'Synthetic other facility','Synthetic','Synthetic','00000',1 FROM business_fixture;
SET LOCAL ROLE authenticated;
SELECT pg_temp.f03_error($q$SELECT public.finance_staging_summary(other_entity,NULL) FROM business_fixture$q$,'42501','owner-other-organization-summary-denied');
SELECT pg_temp.f03_error($q$SELECT public.set_finance_staging_control(gen_random_uuid(),other_entity,0,false,NULL,NULL,NULL) FROM business_fixture$q$,'42501','owner-other-organization-controls-denied');
RESET ROLE;
ALTER TABLE business_fixture ADD COLUMN facility_b uuid DEFAULT gen_random_uuid(),ADD COLUMN resident_b uuid DEFAULT gen_random_uuid(),ADD COLUMN payment_b uuid DEFAULT gen_random_uuid(),
 ADD COLUMN other_actor uuid DEFAULT gen_random_uuid(),ADD COLUMN other_session uuid DEFAULT gen_random_uuid(),ADD COLUMN other_resident uuid DEFAULT gen_random_uuid(),ADD COLUMN other_payment uuid DEFAULT gen_random_uuid();
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT facility_b,org,entity,'Synthetic staging facility B','Synthetic','Synthetic','00000',1 FROM business_fixture;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender)
 SELECT resident_b,org,facility_b,'Synthetic','B','1940-01-01'::date,'female'::gender FROM business_fixture
 UNION ALL SELECT other_resident,other_org,other_facility,'Synthetic','Other','1940-01-01'::date,'female'::gender FROM business_fixture;
SET LOCAL ROLE authenticated;
SELECT public.record_finance_payment(payment_b,resident_b,NULL,current_date,100,'check') FROM business_fixture;
DO $$ DECLARE f record; j uuid; stamp timestamptz; BEGIN
 SELECT * INTO f FROM business_fixture; SELECT id INTO j FROM f03_ids WHERE label='manual_null';
 PERFORM public.save_journal_draft(j,f.entity,NULL,current_date,'Synthetic organization-wide journal',jsonb_build_array(
 jsonb_build_object('line_number',1,'gl_account_id',f.debit_account,'debit_cents',100,'credit_cents',0),
 jsonb_build_object('line_number',2,'gl_account_id',f.credit_account,'debit_cents',0,'credit_cents',100)));
 SELECT updated_at INTO stamp FROM public.journal_entries WHERE id=j;
 PERFORM public.post_finance_journal(j,stamp);
END $$;
RESET ROLE;
INSERT INTO auth.users(id,email) SELECT other_actor,other_actor||'@outbox.invalid' FROM business_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT other_actor,other_actor||'@outbox.invalid','Synthetic other owner','owner',other_org,true FROM business_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT other_session,other_actor FROM business_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',other_actor,'session_id',other_session,'role','authenticated','auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=other_actor))::text,true) FROM business_fixture;
SET LOCAL ROLE authenticated;
SELECT public.record_finance_payment(other_payment,other_resident,NULL,current_date,100,'check') FROM business_fixture;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor_session,'role','authenticated','auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=actor))::text,true) FROM business_fixture;
SET LOCAL ROLE authenticated;
SELECT pg_temp.f03_assert(NOT EXISTS(SELECT 1 FROM public.finance_source_events WHERE receipt_id=(SELECT other_payment FROM business_fixture)),'owner-rls-hides-other-organization-events');
RESET ROLE;
SAVEPOINT historical_gap;
-- Simulate a receipt predating installation, without inventing retrospective authority.
ALTER TABLE public.finance_command_receipts DISABLE TRIGGER finance_receipt_stage;
SET LOCAL ROLE authenticated;
SELECT public.record_finance_payment(gen_random_uuid(),resident,invoice,current_date,50,'check') FROM business_fixture;
RESET ROLE;
ALTER TABLE public.finance_command_receipts ENABLE TRIGGER finance_receipt_stage;
SET LOCAL ROLE authenticated;
SELECT pg_temp.f03_assert(public.finance_staging_summary(entity,facility)->>'unrepresented_eligible_receipts'='1','historical-receipt-gap-is-visible-not-auto-approved') FROM business_fixture;
ROLLBACK TO historical_gap;
RELEASE historical_gap;
SAVEPOINT archived_facility;
UPDATE public.facilities SET deleted_at=now() WHERE id=(SELECT facility FROM business_fixture);
SET LOCAL ROLE service_role;
SELECT pg_temp.f03_error($q$SELECT public.record_finance_staging_attempt(gen_random_uuid(),(SELECT id FROM f03_ids WHERE label='retry'),(SELECT id FROM f03_ids WHERE label='worker'))$q$,'42501','worker-scope-rechecks-archived-facility');
ROLLBACK TO archived_facility;
RELEASE archived_facility;
UPDATE public.user_profiles SET app_role='facility_admin' WHERE id=(SELECT actor FROM business_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'role','authenticated','auth_claim_version',p.auth_claim_version)::text,true) FROM business_fixture f JOIN public.user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
SELECT pg_temp.f03_assert(public.finance_staging_summary(entity,facility)->>'dispatch_enabled'='false','current-facility-admin-can-read-own-staging') FROM business_fixture;
SELECT pg_temp.f03_error($q$SELECT public.finance_staging_summary(entity,NULL) FROM business_fixture$q$,'42501','facility-admin-org-wide-summary-denied');
SELECT pg_temp.f03_error($q$SELECT public.queue_finance_outbound(id,key) FROM f03_ids WHERE label='command'$q$,'42501','facility-admin-cannot-queue');
SELECT pg_temp.f03_assert((SELECT count(*) FROM public.finance_staging_controls)=0,'facility-admin-cannot-read-entity-controls');
SELECT pg_temp.f03_assert((SELECT count(*) FROM public.finance_source_events)=5
 AND NOT EXISTS(SELECT 1 FROM public.finance_source_events WHERE receipt_id IN((SELECT payment_b FROM business_fixture),(SELECT other_payment FROM business_fixture),(SELECT id FROM f03_ids WHERE label='manual_null'))),'facility-admin-rls-excludes-B-null-and-other-org-events');
RESET ROLE;
SELECT jsonb_build_object('suite','F03-durable-staging','status','PASS','assertions',(SELECT last_value FROM f03_assertions),'skips',0,'dispatch_enabled',false);
ROLLBACK;
