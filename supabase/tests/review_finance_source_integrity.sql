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
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; receipt jsonb; again jsonb; jid uuid; stamp timestamptz; manual_id uuid:=gen_random_uuid(); opening_id uuid:=gen_random_uuid(); manual_lines jsonb; BEGIN
 SELECT * INTO f FROM business_fixture;
 PERFORM pg_temp.finance_expect_error(format('UPDATE public.invoices SET total=20000,subtotal=20000 WHERE id=%L',f.invoice),'Invoice totals and settlement must reconcile');
 PERFORM pg_temp.finance_expect_error(format('UPDATE public.invoices SET status=''paid'' WHERE id=%L',f.invoice),'Invoice status must match settlement');
 PERFORM pg_temp.finance_expect_error(format('SELECT public.apply_invoice_payment(%L,100)',f.invoice),'Amount-only application retired%');
 PERFORM pg_temp.finance_expect_error(format('INSERT INTO public.journal_entries(organization_id,entity_id,facility_id,entry_date,status) VALUES(%L,%L,%L,current_date,''posted'')',f.org,f.entity,f.facility),'Use post_finance_journal%');
 receipt:=public.record_finance_payment(f.payment,f.resident,f.invoice,current_date,2500,'check',' check-1 ',NULL,NULL);
 again:=public.record_finance_payment(f.payment,f.resident,f.invoice,current_date,2500,'check','check-1',NULL,NULL);
 IF receipt IS DISTINCT FROM again OR (SELECT amount_paid FROM public.invoices WHERE id=f.invoice)<>2500 OR (SELECT count(*) FROM public.payments WHERE id=f.payment)<>1 THEN RAISE EXCEPTION 'Payment replay duplicated effects'; END IF;
 IF receipt->>'allocated_cents'<>'2500' OR receipt->>'unapplied_cents'<>'0' THEN RAISE EXCEPTION 'Allocation receipt incorrect'; END IF;
 PERFORM pg_temp.finance_expect_error(format('SELECT public.record_finance_payment(%L,%L,%L,current_date,2600,''check'',''check-1'',NULL,NULL)',f.payment,f.resident,f.invoice),'Command identity already used%');
 PERFORM pg_temp.finance_expect_error(format('UPDATE public.invoices SET amount_paid=4000 WHERE id=%L',f.invoice),'Invoice totals and settlement must reconcile');
 PERFORM pg_temp.finance_expect_error(format('DELETE FROM public.payments WHERE id=%L',f.payment),'Use record_finance_payment');
 PERFORM pg_temp.finance_expect_error(format('SELECT public.record_finance_payment(%L,%L,%L,current_date,100,''check'',NULL,NULL,NULL)',gen_random_uuid(),f.resident,gen_random_uuid()),'Open invoice unavailable%');
 -- Manual posting requires current reviewed draft version and balanced lines.
 manual_lines:=jsonb_build_array(jsonb_build_object('line_number',1,'gl_account_id',f.debit_account,'debit_cents',100,'credit_cents',0),jsonb_build_object('line_number',2,'gl_account_id',f.credit_account,'debit_cents',0,'credit_cents',90));
 PERFORM public.save_journal_draft(manual_id,f.entity,f.facility,current_date,'Manual test',manual_lines);
 SELECT updated_at INTO stamp FROM public.journal_entries WHERE id=manual_id;
 PERFORM pg_temp.finance_expect_error(format('SELECT public.post_finance_journal(%L,%L)',manual_id,stamp),'Journal entry must have balanced%');
 PERFORM public.save_journal_draft(manual_id,f.entity,f.facility,current_date,'Manual test',jsonb_set(manual_lines,'{1,credit_cents}','100'),stamp);
 SELECT updated_at INTO stamp FROM public.journal_entries WHERE id=manual_id;
 receipt:=public.post_finance_journal(manual_id,stamp);
 IF public.post_finance_journal(manual_id,stamp) IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Manual post retry changed receipt'; END IF;
 -- Opening balances carry an explicit origin and can never recognize revenue.
 INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,total,subtotal,balance_due,status,finance_origin)
 VALUES(opening_id,f.resident,f.facility,f.org,f.entity,'test-OB-'||opening_id,current_date,current_date,current_date+1,current_date+1,100,100,100,'sent','opening_balance');
 PERFORM pg_temp.finance_expect_error(format('SELECT public.post_finance_source(''invoice'',%L)',opening_id),'Opening or historical balance requires approved%');
 -- An abandoned source draft is recovered in place and actually posted.
 INSERT INTO public.journal_entries(id,organization_id,entity_id,facility_id,entry_date,source_type,source_id) VALUES(f.journal,f.org,f.entity,f.facility,current_date,'invoice',f.invoice);
 receipt:=public.post_finance_source('invoice',f.invoice); jid:=(receipt->>'journal_entry_id')::uuid;
 IF jid<>f.journal OR (SELECT status FROM public.journal_entries WHERE id=jid)<>'posted' OR (SELECT count(*) FROM public.journal_entry_lines WHERE journal_entry_id=jid AND deleted_at IS NULL)<>2 THEN RAISE EXCEPTION 'Abandoned source draft recovery failed'; END IF;
 IF public.post_finance_source('invoice',f.invoice) IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Source retry receipt changed'; END IF;
 UPDATE public.journal_entry_lines SET debit_cents=1 WHERE journal_entry_id=jid;
 IF EXISTS(SELECT 1 FROM public.journal_entry_lines WHERE journal_entry_id=jid AND debit_cents=1) THEN RAISE EXCEPTION 'Posted line edit survived'; END IF;
 -- RLS may suppress posted header edits; they must never change the stored row.
 UPDATE public.journal_entries SET memo='tampered' WHERE id=jid;
 IF (SELECT memo FROM public.journal_entries WHERE id=jid)='tampered' THEN RAISE EXCEPTION 'Posted edit survived'; END IF;
 receipt:=public.reverse_finance_journal(f.reversal,jid,current_date,'Correct test journal');
 IF public.reverse_finance_journal(f.reversal,jid,current_date,'Correct test journal') IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Reversal replay changed receipt'; END IF;
 IF EXISTS(SELECT gl_account_id FROM public.journal_entry_lines WHERE journal_entry_id IN(jid,f.reversal) AND deleted_at IS NULL GROUP BY gl_account_id HAVING sum(debit_cents)<>sum(credit_cents)) THEN RAISE EXCEPTION 'Reversal did not net to zero'; END IF;
 PERFORM pg_temp.finance_expect_error(format('SELECT public.reverse_finance_journal(%L,%L,current_date,''Changed reason'')',f.reversal,jid),'Command identity already used%');
 -- Closed month is enforced at the database, even when no period row existed.
 INSERT INTO public.gl_period_closes(organization_id,entity_id,period_year,period_month,status) VALUES(f.org,f.entity,extract(year FROM current_date)::integer,extract(month FROM current_date)::integer,'closed');
 PERFORM pg_temp.finance_expect_error(format('SELECT public.post_finance_source(''payment'',%L)',f.payment),'Accounting period is closed');
 IF EXISTS(SELECT 1 FROM public.journal_entries WHERE source_type='payment' AND source_id=f.payment) THEN RAISE EXCEPTION 'Failed source post left a draft'; END IF;
 UPDATE public.gl_period_closes SET status='open' WHERE entity_id=f.entity AND period_year=extract(year FROM current_date) AND period_month=extract(month FROM current_date);
 -- Overpayment is retained as unapplied cash, never silently credited to AR.
 receipt:=public.record_finance_payment(f.deposit,f.resident,f.invoice,current_date,10000,'check',NULL,NULL,NULL);
 IF receipt->>'allocated_cents'<>'7500' OR receipt->>'unapplied_cents'<>'2500' THEN RAISE EXCEPTION 'Overpayment was not retained'; END IF;
 PERFORM pg_temp.finance_expect_error(format('SELECT public.post_finance_source(''payment'',%L)',f.deposit),'Reconcile unapplied%');
END $$;
RESET ROLE;
ALTER TABLE business_fixture ADD COLUMN failure_invoice uuid DEFAULT gen_random_uuid();
INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,total,subtotal,balance_due,status)
SELECT failure_invoice,resident,facility,org,entity,'failure-'||failure_invoice,current_date,current_date,current_date+2,current_date+2,200,200,200,'sent' FROM business_fixture;
-- A required receipt failure must roll back both money and allocation.
CREATE FUNCTION pg_temp.finance_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected financial receipt failure'; END $$;
CREATE TRIGGER finance_fail_receipt BEFORE INSERT ON public.finance_command_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.finance_fail_receipt();
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; failed_payment_id uuid:=gen_random_uuid(); BEGIN
 SELECT * INTO f FROM business_fixture;
 PERFORM pg_temp.finance_expect_error(format('SELECT public.record_finance_payment(%L,%L,%L,current_date,100,''check'',NULL,NULL,NULL)',failed_payment_id,f.resident,f.failure_invoice),'injected financial receipt failure');
 IF EXISTS(SELECT 1 FROM public.payments WHERE payments.id=failed_payment_id) OR EXISTS(SELECT 1 FROM public.payment_allocations WHERE payment_id=failed_payment_id) OR (SELECT balance_due FROM public.invoices WHERE id=f.failure_invoice)<>200 THEN RAISE EXCEPTION 'Failed receipt left payment or allocation'; END IF;
 PERFORM pg_temp.finance_expect_error(format('SELECT public.post_finance_source(''payment'',%L)',f.payment),'injected financial receipt failure');
 IF EXISTS(SELECT 1 FROM public.journal_entries WHERE source_type='payment' AND source_id=f.payment) THEN RAISE EXCEPTION 'Failed posting receipt left journal'; END IF;
END $$;
RESET ROLE;
DROP TRIGGER finance_fail_receipt ON public.finance_command_receipts;
-- Evidence is immutable even for a privileged SQL caller (not just RLS).
SELECT pg_temp.finance_expect_error('UPDATE public.finance_command_receipts SET result=''{}''::jsonb','Financial evidence is immutable%');
SELECT pg_temp.finance_expect_error('DELETE FROM public.payment_allocations','Financial evidence is immutable%');

-- Resolve an ambiguous request without permitting a late original to commit.
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; cancelled_id uuid:=gen_random_uuid(); result jsonb; BEGIN
 SELECT * INTO f FROM business_fixture;
 result:=public.resolve_finance_payment(f.payment,f.resident,f.invoice,current_date,2500,'check','check-1',NULL,NULL);
 IF result->>'allocated_cents'<>'2500' THEN RAISE EXCEPTION 'Resolution lost committed payment'; END IF;
 result:=public.resolve_finance_payment(cancelled_id,f.resident,NULL,current_date,100,'check',NULL,NULL,NULL);
 IF result->>'status'<>'cancelled' THEN RAISE EXCEPTION 'Unrecorded request was not cancelled'; END IF;
 PERFORM pg_temp.finance_expect_error(format('SELECT public.record_finance_payment(%L,%L,NULL,current_date,100,''check'',NULL,NULL,NULL)',cancelled_id,f.resident),'Payment request was cancelled%');
 IF EXISTS(SELECT 1 FROM public.payments WHERE id=cancelled_id) THEN RAISE EXCEPTION 'Late cancelled request created payment'; END IF;
END $$;
RESET ROLE;

-- HFA-011: current authorization, entity/facility and account scopes are distinct.
ALTER TABLE business_fixture ADD COLUMN other_org uuid DEFAULT gen_random_uuid(), ADD COLUMN other_entity uuid DEFAULT gen_random_uuid(),
 ADD COLUMN foreign_entity uuid DEFAULT gen_random_uuid(), ADD COLUMN other_facility uuid DEFAULT gen_random_uuid(),
 ADD COLUMN other_resident uuid DEFAULT gen_random_uuid(), ADD COLUMN other_account uuid DEFAULT gen_random_uuid();
INSERT INTO public.organizations(id,name) SELECT other_org,'Finance isolated organization' FROM business_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT other_entity,org,'Other finance entity' FROM business_fixture UNION ALL SELECT foreign_entity,other_org,'Foreign entity' FROM business_fixture;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT other_facility,org,other_entity,'Other finance facility','Synthetic address','Test','00000',1 FROM business_fixture;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender)
 SELECT other_resident,org,other_facility,'Other','Finance resident','1940-01-01','female' FROM business_fixture;
INSERT INTO public.gl_accounts(id,organization_id,entity_id,code,name,account_type)
 SELECT other_account,org,other_entity,'other-'||other_account,'Other entity account','asset' FROM business_fixture;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; lines jsonb; BEGIN
 SELECT * INTO f FROM business_fixture;
 lines:=jsonb_build_array(jsonb_build_object('line_number',1,'gl_account_id',f.other_account,'debit_cents',100,'credit_cents',0),jsonb_build_object('line_number',2,'gl_account_id',f.credit_account,'debit_cents',0,'credit_cents',100));
 PERFORM pg_temp.finance_expect_error(format('SELECT public.save_journal_draft(%L,%L,%L,current_date,''Wrong account'',%L::jsonb,NULL)',gen_random_uuid(),f.entity,f.facility,lines),'Account does not belong to journal entity');
 PERFORM pg_temp.finance_expect_error(format('SELECT public.save_journal_draft(%L,%L,%L,current_date,''Wrong facility'',%L::jsonb,NULL)',gen_random_uuid(),f.entity,f.other_facility,lines),'Finance facility unavailable');
 PERFORM pg_temp.finance_expect_error(format('SELECT public.save_journal_draft(%L,%L,NULL,current_date,''Wrong organization'',%L::jsonb,NULL)',gen_random_uuid(),f.foreign_entity,lines),'Finance entity unavailable');
END $$;
RESET ROLE;
UPDATE public.user_profiles SET app_role='facility_admin' WHERE id=(SELECT actor FROM business_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,
 'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
 'role','authenticated','app_role','facility_admin','organization_id',f.org,
 'app_metadata',jsonb_build_object('app_role','facility_admin','organization_id',f.org))::text,true)
FROM business_fixture f JOIN public.user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; result jsonb; BEGIN
 SELECT * INTO f FROM business_fixture;
 result:=public.record_finance_payment(gen_random_uuid(),f.resident,NULL,current_date,100,'check',NULL,NULL,NULL);
 IF result->>'unapplied_cents'<>'100' THEN RAISE EXCEPTION 'Authorized facility payment failed'; END IF;
 PERFORM pg_temp.finance_expect_error(format('SELECT public.record_finance_payment(%L,%L,NULL,current_date,100,''check'',NULL,NULL,NULL)',gen_random_uuid(),f.other_resident),'Finance facility unavailable');
 PERFORM pg_temp.finance_expect_error(format('SELECT public.post_finance_source(''invoice'',%L)',f.invoice),'Current finance authority required');
END $$;
RESET ROLE;
-- Current session revocation is checked on replay too.
DELETE FROM auth.sessions WHERE id=(SELECT actor_session FROM business_fixture);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM business_fixture;
 PERFORM pg_temp.finance_expect_error(format('SELECT public.record_finance_payment(%L,%L,%L,current_date,2500,''check'',''check-1'',NULL,NULL)',f.payment,f.resident,f.invoice),'Current finance authority required');
END $$;
RESET ROLE;
ROLLBACK;
