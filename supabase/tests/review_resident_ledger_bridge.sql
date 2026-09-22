-- COL-556 [HFO-21c.1] resident ledger bridge: native scratch-only probe;
-- fixtures and auth adaptation roll back. Synthetic resident only ("Bridge
-- Probe"). No real names, balances or account numbers.
--
-- What this protects: that resident money stops living in three places. Each
-- assertion names the way it could quietly come back -- a write that skips the
-- ledger, a settlement column written on its own authority, a backfill that
-- posts twice, a balance that ties only because nobody compared it.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;

-- The probe owns its own entity and facility. The backfill and the tie-out are
-- whole-entity by design, so sharing a seeded entity would measure the seed's
-- money instead of this probe's.
CREATE TEMP TABLE rb_fixture AS
SELECT gen_random_uuid() owner_actor, gen_random_uuid() owner_session,
       gen_random_uuid() fa_actor, gen_random_uuid() fa_session,
       gen_random_uuid() entity, gen_random_uuid() facility, o.id org,
       gen_random_uuid() resident,
       gen_random_uuid() ar_account, gen_random_uuid() cash_account,
       gen_random_uuid() revenue_account, gen_random_uuid() trust_account,
       gen_random_uuid() writeoff_account,
       gen_random_uuid() live_invoice, gen_random_uuid() legacy_invoice,
       gen_random_uuid() payment, gen_random_uuid() backfill,
       gen_random_uuid() trust_acct, gen_random_uuid() trust_tx
FROM public.organizations o WHERE o.deleted_at IS NULL ORDER BY o.id LIMIT 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM rb_fixture) THEN
    RAISE EXCEPTION 'COL-556 probe needs one seeded organization; it proves nothing without one';
  END IF;
END $$;

INSERT INTO public.entities(id,organization_id,name,entity_type,status)
  SELECT entity, org, 'Bridge Probe Entity LLC', 'llc', 'active'::public.entity_status FROM rb_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT facility, entity, org, 'Bridge Probe House', '1 Probe Way', 'Probeville', '00000', 10 FROM rb_fixture;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT owner_actor, owner_actor||'@review.invalid', jsonb_build_object('organization_id',org,'app_role','owner'), '{"full_name":"Bridge owner probe"}'::jsonb FROM rb_fixture
  UNION ALL
  SELECT fa_actor, fa_actor||'@review.invalid', jsonb_build_object('organization_id',org,'app_role','facility_admin'), '{"full_name":"Bridge facility admin probe"}'::jsonb FROM rb_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT owner_actor, owner_actor||'@review.invalid','Bridge owner probe','owner'::public.app_role,org,true FROM rb_fixture
  UNION ALL
  SELECT fa_actor, fa_actor||'@review.invalid','Bridge facility admin probe','facility_admin'::public.app_role,org,true FROM rb_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session, owner_actor FROM rb_fixture UNION ALL SELECT fa_session, fa_actor FROM rb_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
  SELECT owner_actor, facility, org FROM rb_fixture
  UNION ALL SELECT fa_actor, facility, org FROM rb_fixture;

INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status,admission_date)
  SELECT resident, facility, org, 'Bridge', 'Probe', date '1938-02-02', 'female'::public.gender, 'active'::public.resident_status, current_date - 400 FROM rb_fixture;

INSERT INTO public.gl_accounts(id,organization_id,entity_id,code,name,account_type)
  SELECT ar_account, org, entity, 'BRIDGE-1200', 'Resident receivable (probe)', 'asset'::public.gl_account_type FROM rb_fixture
  UNION ALL SELECT cash_account, org, entity, 'BRIDGE-1010', 'Cash clearing (probe)', 'asset'::public.gl_account_type FROM rb_fixture
  UNION ALL SELECT revenue_account, org, entity, 'BRIDGE-4000', 'Resident revenue (probe)', 'revenue'::public.gl_account_type FROM rb_fixture
  UNION ALL SELECT trust_account, org, entity, 'BRIDGE-2100', 'Resident trust liability (probe)', 'liability'::public.gl_account_type FROM rb_fixture
  UNION ALL SELECT writeoff_account, org, entity, 'BRIDGE-6500', 'Write-off (probe)', 'expense'::public.gl_account_type FROM rb_fixture;

CREATE FUNCTION pg_temp.rb_actor(p_which text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
  IF p_which = 'owner' THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',f.owner_actor,'session_id',f.owner_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)
      FROM rb_fixture f JOIN public.user_profiles p ON p.id = f.owner_actor;
  ELSE
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',f.fa_actor,'session_id',f.fa_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)
      FROM rb_fixture f JOIN public.user_profiles p ON p.id = f.fa_actor;
  END IF;
END $$;
CREATE FUNCTION pg_temp.rb_fail(sql text, expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM) > 0 THEN RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'Expected failure: %', expected;
END $$;
CREATE TEMP TABLE rb_results(name text PRIMARY KEY, value jsonb);
GRANT ALL ON rb_results TO authenticated, service_role;
GRANT SELECT ON rb_fixture TO authenticated, service_role;

-- Hosted Supabase grants request roles SELECT on public tables by default; the
-- local replay does not, so restore that baseline before any role switch. RLS,
-- not the grant, is what this probe is testing.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- 1. Grant posture. The bridge added definer surface; none of it may be
--    reachable by anon or the service role, and the cores stay private so the
--    only authenticated way in is still an asserting wrapper.
DO $$ BEGIN
  IF has_function_privilege('anon','public.backfill_resident_ledger_openings(uuid,uuid,date,text)','EXECUTE')
     OR has_function_privilege('service_role','public.backfill_resident_ledger_openings(uuid,uuid,date,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.backfill_resident_ledger_openings(uuid,uuid,date,text)','EXECUTE')
     OR has_function_privilege('anon','public.resident_ledger_backfill_plan(uuid,date)','EXECUTE')
     OR has_function_privilege('anon','public.resident_ledger_tie_out(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','haven.post_resident_ledger_entry_core(uuid,uuid,text,integer,date,text,uuid,text,text,uuid,uuid)','EXECUTE')
     OR has_function_privilege('service_role','haven.post_resident_ledger_entry_core(uuid,uuid,text,integer,date,text,uuid,text,text,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','haven.reverse_resident_ledger_entry_core(uuid,uuid,date,text)','EXECUTE')
     OR has_function_privilege('authenticated','haven.resident_invoice_settled_cents(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','haven.resident_ledger_active(uuid,date)','EXECUTE')
     OR has_table_privilege('anon','public.resident_ledger_backfills','SELECT')
  THEN RAISE EXCEPTION 'COL-556: resident ledger bridge grant boundary failed'; END IF;
END $$;

-- 2. A backfill run is evidence, not a row anyone edits later.
DO $$ DECLARE v_cmds text; BEGIN
  SELECT string_agg(DISTINCT cmd, ',' ORDER BY cmd) INTO v_cmds
  FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='resident_ledger_backfills';
  IF v_cmds IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'COL-556: resident_ledger_backfills carries % policies; a backfill is written by its command and never edited', COALESCE(v_cmds,'<none>');
  END IF;
END $$;

-- 3. Nothing bridges until finance has activated the entity. An invoice issued
--    into an entity with no resident_ledger_from writes no ledger entry and --
--    this is the part that matters -- does not fail.
INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,adjustments,tax,total,amount_paid,balance_due)
  SELECT legacy_invoice, resident, facility, org, entity, 'PROBE-LEGACY-556', current_date - 40, current_date - 25,
         (date_trunc('month', current_date - 40))::date, (date_trunc('month', current_date - 40) + interval '1 month - 1 day')::date,
         'sent'::public.invoice_status, 300000, 0, 0, 300000, 0, 300000
  FROM rb_fixture;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.resident_ledger_entries e JOIN rb_fixture f ON f.legacy_invoice = e.source_id) THEN
    RAISE EXCEPTION 'COL-556: an unactivated entity bridged an invoice; activation is configuration, not a default';
  END IF;
END $$;

-- The settlement history production actually carries: money the invoice claims
-- with no payment row behind it. Only a non-request role can write it, which is
-- how it got there.
UPDATE public.invoices SET amount_paid = 120000, balance_due = 180000, status = 'partial'::public.invoice_status
 WHERE id = (SELECT legacy_invoice FROM rb_fixture);

-- 4. Activation without account mapping refuses by name. Haven never picks an
--    account, so a half-configured entity is a refusal, not a guess.
UPDATE public.entity_gl_settings s SET resident_ledger_from = current_date - 10, resident_ledger_activated_at = now()
  FROM rb_fixture f WHERE s.entity_id = f.entity;
INSERT INTO public.entity_gl_settings(organization_id,entity_id,accounts_receivable_id,cash_id,revenue_id,trust_liability_id,cash_clearing_id,write_off_id,resident_ledger_from,resident_ledger_activated_at)
  SELECT org, entity, ar_account, cash_account, revenue_account, trust_account, cash_account, writeoff_account, current_date - 10, now() FROM rb_fixture
  ON CONFLICT (entity_id) DO UPDATE SET
    accounts_receivable_id = EXCLUDED.accounts_receivable_id,
    trust_liability_id = EXCLUDED.trust_liability_id,
    cash_clearing_id = EXCLUDED.cash_clearing_id,
    write_off_id = EXCLUDED.write_off_id,
    resident_ledger_from = EXCLUDED.resident_ledger_from,
    resident_ledger_activated_at = EXCLUDED.resident_ledger_activated_at;

SELECT pg_temp.rb_fail(
  format('INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,adjustments,tax,total,amount_paid,balance_due) SELECT %L,resident,facility,org,entity,''PROBE-NORULE-556'',current_date,current_date+75,(date_trunc(''month'',current_date)+interval ''2 month'')::date,(date_trunc(''month'',current_date)+interval ''3 month - 1 day'')::date,''sent''::public.invoice_status,1000,0,0,1000,0,1000 FROM rb_fixture', gen_random_uuid()),
  'No active posting rule');

INSERT INTO public.gl_posting_rules(organization_id,entity_id,event_type,debit_gl_account_id,credit_gl_account_id)
  SELECT org, entity, 'resident_charge', ar_account, revenue_account FROM rb_fixture
  UNION ALL SELECT org, entity, 'resident_payment', cash_account, ar_account FROM rb_fixture
  UNION ALL SELECT org, entity, 'trust_deposit', cash_account, trust_account FROM rb_fixture
  UNION ALL SELECT org, entity, 'trust_withdrawal', trust_account, cash_account FROM rb_fixture;

-- 5. The forward path. An issued invoice posts its charge without anyone
--    calling an RPC -- the write itself is what produces the entry.
INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,adjustments,tax,total,amount_paid,balance_due)
  SELECT live_invoice, resident, facility, org, entity, 'PROBE-LIVE-556', current_date, current_date + 15,
         (date_trunc('month', current_date))::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
         'sent'::public.invoice_status, 250000, 0, 0, 250000, 0, 250000
  FROM rb_fixture;
DO $$ DECLARE v_cents integer; BEGIN
  SELECT e.amount_cents INTO v_cents FROM public.resident_ledger_entries e JOIN rb_fixture f ON f.live_invoice = e.source_id
   WHERE e.entry_type = 'resident_charge';
  IF v_cents IS DISTINCT FROM 250000 THEN
    RAISE EXCEPTION 'COL-556: issuing an invoice did not post a resident charge (got %)', v_cents;
  END IF;
END $$;

-- A draft is not a receivable, on either ledger.
DO $$ DECLARE v_draft uuid := gen_random_uuid(); BEGIN
  INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,adjustments,tax,total,amount_paid,balance_due)
    SELECT v_draft, resident, facility, org, entity, 'PROBE-DRAFT-556', current_date, current_date + 45,
           (date_trunc('month', current_date) + interval '1 month')::date, (date_trunc('month', current_date) + interval '2 month - 1 day')::date,
           'draft'::public.invoice_status, 9900, 0, 0, 9900, 0, 9900
    FROM rb_fixture;
  IF EXISTS (SELECT 1 FROM public.resident_ledger_entries WHERE source_id = v_draft) THEN
    RAISE EXCEPTION 'COL-556: a draft invoice posted a receivable';
  END IF;
END $$;

-- 6. Recording a payment posts its entry and the invoice settlement is read
--    back from the ledger instead of being incremented on its own authority.
SELECT pg_temp.rb_actor('owner');
SET LOCAL ROLE authenticated;
INSERT INTO rb_results
  SELECT 'payment', public.record_finance_payment(payment, resident, live_invoice, current_date, 100000, 'check', 'PROBE-1', 'Probe payer', NULL)
  FROM rb_fixture;
RESET ROLE;

DO $$ DECLARE v_paid integer; v_balance integer; v_status text; v_entry integer; BEGIN
  SELECT i.amount_paid, i.balance_due, i.status::text INTO v_paid, v_balance, v_status
    FROM public.invoices i JOIN rb_fixture f ON f.live_invoice = i.id;
  SELECT e.amount_cents INTO v_entry FROM public.resident_ledger_entries e JOIN rb_fixture f ON f.payment = e.source_id
   WHERE e.entry_type = 'resident_payment';
  IF v_entry IS DISTINCT FROM 100000 THEN
    RAISE EXCEPTION 'COL-556: recording a payment did not post a ledger entry (got %)', v_entry;
  END IF;
  IF v_paid <> 100000 OR v_balance <> 150000 OR v_status <> 'partial' THEN
    RAISE EXCEPTION 'COL-556: invoice settlement is % paid / % due / %, expected 100000 / 150000 / partial derived from the ledger', v_paid, v_balance, v_status;
  END IF;
  IF haven.resident_invoice_settled_cents((SELECT live_invoice FROM rb_fixture)) <> v_paid THEN
    RAISE EXCEPTION 'COL-556: invoices.amount_paid and the ledger disagree about what settled this invoice';
  END IF;
END $$;

-- 7. A trust deposit is bridged too, and never nets against rent.
INSERT INTO public.resident_trust_accounts(id,organization_id,facility_id,resident_id,balance_cents)
  SELECT trust_acct, org, facility, resident, 0 FROM rb_fixture;
INSERT INTO public.resident_trust_transactions(id,organization_id,facility_id,account_id,resident_id,direction,amount_cents,balance_after_cents,category,description,occurred_at)
  SELECT trust_tx, org, facility, trust_acct, resident, 'deposit', 7500, 7500, 'benefit_deposit', 'Probe benefit deposit', now() FROM rb_fixture;
UPDATE public.resident_trust_accounts SET balance_cents = 7500 WHERE id = (SELECT trust_acct FROM rb_fixture);
DO $$ DECLARE v_kind text; v_cents integer; BEGIN
  SELECT e.account_kind, e.amount_cents INTO v_kind, v_cents
    FROM public.resident_ledger_entries e JOIN rb_fixture f ON f.trust_tx = e.source_id;
  IF v_kind IS DISTINCT FROM 'trust' OR v_cents IS DISTINCT FROM 7500 THEN
    RAISE EXCEPTION 'COL-556: a trust deposit was not bridged to the trust side (% / %)', v_kind, v_cents;
  END IF;
END $$;

-- 8. Before the backfill, the tie-out reports the pre-activation invoice as a
--    variance. A probe that cannot see the gap cannot prove it closed.
SELECT pg_temp.rb_actor('owner');
SET LOCAL ROLE authenticated;
INSERT INTO rb_results SELECT 'tie_out_before', public.resident_ledger_tie_out(org, facility) FROM rb_fixture;
INSERT INTO rb_results SELECT 'plan', public.resident_ledger_backfill_plan(entity, current_date) FROM rb_fixture;
RESET ROLE;
DO $$ DECLARE v jsonb; BEGIN
  SELECT value INTO v FROM rb_results WHERE name = 'tie_out_before';
  IF (v->>'residents_in_variance')::int = 0 THEN
    RAISE EXCEPTION 'COL-556: the tie-out saw no variance while a 180000-cent receivable was off the ledger: %', v;
  END IF;
  SELECT value INTO v FROM rb_results WHERE name = 'plan';
  IF (v->>'unexplained_settlement_cents')::bigint <> 120000 THEN
    RAISE EXCEPTION 'COL-556: the plan did not name the 120000 cents of settlement no payment row explains: %', v;
  END IF;
  IF (v->>'missing_posting_rules') <> '[]' THEN
    RAISE EXCEPTION 'COL-556: the plan reports missing posting rules after all four were configured: %', v;
  END IF;
END $$;

-- 9. The backfill: opening entries at their original effective dates, with a
--    source reference back to the row and the run that posted them.
SELECT pg_temp.rb_actor('owner');
SET LOCAL ROLE authenticated;
INSERT INTO rb_results
  SELECT 'backfill', public.backfill_resident_ledger_openings(backfill, entity, current_date, 'COL-556 probe run') FROM rb_fixture;
RESET ROLE;
DO $$ DECLARE v jsonb; v_charge public.resident_ledger_entries%ROWTYPE; v_opening public.resident_ledger_entries%ROWTYPE; BEGIN
  SELECT value INTO v FROM rb_results WHERE name = 'backfill';
  IF (v->>'opening_settlements_posted')::int <> 1 OR (v->>'opening_settlement_cents')::bigint <> 120000 THEN
    RAISE EXCEPTION 'COL-556: the backfill did not carry the unexplained settlement: %', v;
  END IF;
  SELECT * INTO v_charge FROM public.resident_ledger_entries e JOIN rb_fixture f ON f.legacy_invoice = e.source_id
   WHERE e.entry_type = 'resident_charge';
  IF v_charge.effective_date <> current_date - 40 THEN
    RAISE EXCEPTION 'COL-556: an opening charge landed on % instead of the date it was economically true (%)', v_charge.effective_date, current_date - 40;
  END IF;
  IF v_charge.opening_backfill_id IS NULL OR v_charge.source_type <> 'invoice' THEN
    RAISE EXCEPTION 'COL-556: an opening entry does not name its run or the row it came from';
  END IF;
  SELECT * INTO v_opening FROM public.resident_ledger_entries e JOIN rb_fixture f ON f.legacy_invoice = e.source_id
   WHERE e.entry_type = 'resident_payment';
  IF v_opening.amount_cents <> 120000 THEN
    RAISE EXCEPTION 'COL-556: the opening settlement is % cents, expected 120000', v_opening.amount_cents;
  END IF;
END $$;

-- 10. Idempotent: the same run replays its summary, and a second run with a new
--     id posts nothing, because every request id is derived from the source row.
SELECT pg_temp.rb_actor('owner');
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_before bigint; v_after bigint; v_replay jsonb; v_second jsonb; BEGIN
  SELECT count(*) INTO v_before FROM public.resident_ledger_entries;
  SELECT public.backfill_resident_ledger_openings(backfill, entity, current_date, 'COL-556 probe run') INTO v_replay FROM rb_fixture;
  SELECT public.backfill_resident_ledger_openings(gen_random_uuid(), entity, current_date, 'COL-556 second pass') INTO v_second FROM rb_fixture;
  SELECT count(*) INTO v_after FROM public.resident_ledger_entries;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'COL-556: re-running the backfill posted % new entries', v_after - v_before;
  END IF;
  IF v_replay IS DISTINCT FROM (SELECT value FROM rb_results WHERE name = 'backfill') THEN
    RAISE EXCEPTION 'COL-556: replaying a backfill id returned a different summary';
  END IF;
END $$;
RESET ROLE;

-- 11. The whole point: after the backfill the ledger and the old tables agree,
--     resident by resident.
SELECT pg_temp.rb_actor('owner');
SET LOCAL ROLE authenticated;
INSERT INTO rb_results SELECT 'tie_out_after', public.resident_ledger_tie_out(org, facility) FROM rb_fixture;
RESET ROLE;
DO $$ DECLARE v jsonb; BEGIN
  SELECT value INTO v FROM rb_results WHERE name = 'tie_out_after';
  IF (v->>'receivable_variance_cents')::bigint <> 0 OR (v->>'trust_variance_cents')::bigint <> 0
     OR (v->>'residents_in_variance')::int <> 0 THEN
    RAISE EXCEPTION 'COL-556: the ledger does not equal the balance the old tables report: %', v;
  END IF;
END $$;

-- 12. Voiding an invoice reverses its charge rather than leaving a receivable
--     on the ledger that the invoice no longer claims.
UPDATE public.invoices SET voided_at = now(), voided_reason = 'Probe void'
 WHERE id = (SELECT live_invoice FROM rb_fixture);
DO $$ DECLARE v_reversal public.resident_ledger_entries%ROWTYPE; v_charge public.resident_ledger_entries%ROWTYPE; BEGIN
  SELECT * INTO v_charge FROM public.resident_ledger_entries e JOIN rb_fixture f ON f.live_invoice = e.source_id
   WHERE e.entry_type = 'resident_charge' AND e.reversal_of_id IS NULL;
  SELECT * INTO v_reversal FROM public.resident_ledger_entries WHERE reversal_of_id = v_charge.id;
  IF v_reversal.id IS NULL THEN
    RAISE EXCEPTION 'COL-556: voiding an invoice left its charge standing on the resident ledger';
  END IF;
  IF v_reversal.debit_gl_account_id <> v_charge.credit_gl_account_id
     OR v_reversal.credit_gl_account_id <> v_charge.debit_gl_account_id THEN
    RAISE EXCEPTION 'COL-556: the void reversal did not mirror the charge it reverses';
  END IF;
END $$;

-- 13. The period a resident posting materializes is bookkeeping, not a close.
--     Before COL-556 the first resident posting of a month by a facility_admin
--     -- the role that records payments -- failed on 340's period guard and
--     never reached the ledger.
DO $$ BEGIN
  DELETE FROM public.resident_ledger_entries
   WHERE gl_period_close_id IN (
     SELECT id FROM public.gl_period_closes
      WHERE entity_id = (SELECT entity FROM rb_fixture)
        AND (period_year, period_month) = (extract(YEAR FROM current_date + 60)::int, extract(MONTH FROM current_date + 60)::int));
EXCEPTION WHEN check_violation THEN NULL; END $$;

SELECT pg_temp.rb_actor('facility_admin');
SET LOCAL ROLE authenticated;
INSERT INTO rb_results
  SELECT 'future_month', public.post_resident_ledger_entry(
    gen_random_uuid(), resident, 'resident_charge', 4200, (current_date + 60)) FROM rb_fixture;
RESET ROLE;
DO $$ DECLARE v jsonb; BEGIN
  SELECT value INTO v FROM rb_results WHERE name = 'future_month';
  IF v->>'gl_period_close_id' IS NULL THEN
    RAISE EXCEPTION 'COL-556: a facility_admin could not materialize the period its own posting needs';
  END IF;
END $$;

-- 14. Closing a period is still a finance decision a facility_admin does not
--     make. Widening the materialization must not have widened the close.
--     Hosted grants authenticated INSERT/UPDATE on this table and the policy and
--     the guard are what refuse; the replay has no such grant, so state it or
--     both assertions pass for the wrong reason.
GRANT INSERT, UPDATE ON public.gl_period_closes TO authenticated;
SELECT pg_temp.rb_actor('facility_admin');
SET LOCAL ROLE authenticated;
-- The row policy admits owner/org_admin only, so this changes nothing rather
-- than raising. Silence is the refusal; the period must still be open.
UPDATE public.gl_period_closes SET status = 'closed'
 WHERE entity_id = (SELECT entity FROM rb_fixture)
   AND period_year = extract(YEAR FROM current_date + 60)::int
   AND period_month = extract(MONTH FROM current_date + 60)::int;
-- An insert passes the policy's WITH CHECK, so the guard is the only thing
-- standing between a facility_admin and a period that arrives already closed.
SELECT pg_temp.rb_fail(
  format('INSERT INTO public.gl_period_closes(organization_id,entity_id,period_year,period_month,status) SELECT org,entity,%s,%s,''closed'' FROM rb_fixture',
         extract(YEAR FROM current_date + 120)::int, extract(MONTH FROM current_date + 120)::int),
  'Current finance authority required');
RESET ROLE;
DO $$ DECLARE v_status text; BEGIN
  SELECT status INTO v_status FROM public.gl_period_closes
   WHERE entity_id = (SELECT entity FROM rb_fixture)
     AND period_year = extract(YEAR FROM current_date + 60)::int
     AND period_month = extract(MONTH FROM current_date + 60)::int;
  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'COL-556: a facility_admin closed an accounting period (status is now %)', v_status;
  END IF;
END $$;

ROLLBACK;
