-- COL-540 [HFO-21c] resident ledger spine: native scratch-only probe; fixtures
-- and auth adaptation roll back. Synthetic resident only ("Ledger Probe"). No
-- real names, balances or account numbers.
--
-- Each assertion names what it protects. The ledger is the only record of a
-- resident's money once QuickBooks receives summary journals, so a later
-- migration that quietly reopens a write path has to fail here first.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;

CREATE TEMP TABLE rl_fixture AS
SELECT gen_random_uuid() owner_actor, gen_random_uuid() owner_session,
       gen_random_uuid() aide_actor, gen_random_uuid() aide_session,
       f.id facility, f.organization_id org, f.entity_id entity,
       gen_random_uuid() resident,
       gen_random_uuid() ar_account, gen_random_uuid() cash_account,
       gen_random_uuid() revenue_account, gen_random_uuid() trust_account,
       gen_random_uuid() writeoff_account
FROM public.facilities f WHERE f.deleted_at IS NULL AND f.entity_id IS NOT NULL
ORDER BY f.name LIMIT 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM rl_fixture) THEN
    RAISE EXCEPTION 'COL-540 probe needs one seeded facility with a legal entity; it proves nothing without one';
  END IF;
END $$;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT owner_actor, owner_actor||'@review.invalid', jsonb_build_object('organization_id',org,'app_role','owner'), '{"full_name":"Ledger owner probe"}'::jsonb FROM rl_fixture
  UNION ALL
  SELECT aide_actor, aide_actor||'@review.invalid', jsonb_build_object('organization_id',org,'app_role','caregiver'), '{"full_name":"Ledger aide probe"}'::jsonb FROM rl_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT owner_actor, owner_actor||'@review.invalid','Ledger owner probe','owner'::public.app_role,org,true FROM rl_fixture
  UNION ALL
  SELECT aide_actor, aide_actor||'@review.invalid','Ledger aide probe','caregiver'::public.app_role,org,true FROM rl_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session, owner_actor FROM rl_fixture UNION ALL SELECT aide_session, aide_actor FROM rl_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
  SELECT owner_actor, facility, org FROM rl_fixture
  UNION ALL SELECT aide_actor, facility, org FROM rl_fixture;

INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status,admission_date)
  SELECT resident, facility, org, 'Ledger', 'Probe', date '1940-01-01', 'female'::public.gender, 'active'::public.resident_status, current_date - 30 FROM rl_fixture;

INSERT INTO public.gl_accounts(id,organization_id,entity_id,code,name,account_type)
  SELECT ar_account, org, entity, 'PROBE-1200', 'Resident receivable (probe)', 'asset'::public.gl_account_type FROM rl_fixture
  UNION ALL SELECT cash_account, org, entity, 'PROBE-1010', 'Cash clearing (probe)', 'asset'::public.gl_account_type FROM rl_fixture
  UNION ALL SELECT revenue_account, org, entity, 'PROBE-4000', 'Resident revenue (probe)', 'revenue'::public.gl_account_type FROM rl_fixture
  UNION ALL SELECT trust_account, org, entity, 'PROBE-2100', 'Resident trust liability (probe)', 'liability'::public.gl_account_type FROM rl_fixture
  UNION ALL SELECT writeoff_account, org, entity, 'PROBE-6500', 'Write-off (probe)', 'expense'::public.gl_account_type FROM rl_fixture;

INSERT INTO public.entity_gl_settings(organization_id,entity_id,accounts_receivable_id,cash_id,revenue_id,trust_liability_id,cash_clearing_id,write_off_id)
  SELECT org, entity, ar_account, cash_account, revenue_account, trust_account, cash_account, writeoff_account FROM rl_fixture
  ON CONFLICT (entity_id) DO UPDATE SET
    accounts_receivable_id = EXCLUDED.accounts_receivable_id,
    trust_liability_id = EXCLUDED.trust_liability_id,
    cash_clearing_id = EXCLUDED.cash_clearing_id,
    write_off_id = EXCLUDED.write_off_id;

CREATE FUNCTION pg_temp.rl_actor(p_which text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
  IF p_which = 'owner' THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',f.owner_actor,'session_id',f.owner_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)
      FROM rl_fixture f JOIN public.user_profiles p ON p.id = f.owner_actor;
  ELSE
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',f.aide_actor,'session_id',f.aide_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)
      FROM rl_fixture f JOIN public.user_profiles p ON p.id = f.aide_actor;
  END IF;
END $$;
CREATE FUNCTION pg_temp.rl_fail(sql text, expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM) > 0 THEN RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'Expected failure: %', expected;
END $$;
CREATE TEMP TABLE rl_results(name text PRIMARY KEY, value jsonb);
GRANT ALL ON rl_results TO authenticated, service_role;
GRANT SELECT ON rl_fixture TO authenticated, service_role;

-- 1. Grant posture, before any role switch. The entries table has no write
--    policy at all; the private helpers are unreachable as functions.
DO $$ BEGIN
  IF has_table_privilege('anon','public.resident_ledger_entries','SELECT')
     OR has_table_privilege('anon','public.resident_ledger_reasons','SELECT')
     OR has_table_privilege('anon','public.resident_ledger_balances','SELECT')
  THEN RAISE EXCEPTION 'COL-540: anon can read the resident ledger'; END IF;
  IF has_function_privilege('anon','public.post_resident_ledger_entry(uuid,uuid,text,integer,date,text,uuid,text,text,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.post_resident_ledger_entry(uuid,uuid,text,integer,date,text,uuid,text,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.post_resident_ledger_entry(uuid,uuid,text,integer,date,text,uuid,text,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.reverse_resident_ledger_entry(uuid,uuid,date,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.reverse_resident_ledger_entry(uuid,uuid,date,text)','EXECUTE')
     OR has_function_privilege('authenticated','haven.resident_ledger_period(uuid,date)','EXECUTE')
     OR has_function_privilege('service_role','haven.resident_ledger_period(uuid,date)','EXECUTE')
     OR has_function_privilege('authenticated','haven.assert_resident_ledger_authority(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','haven.refuse_resident_ledger_mutation()','EXECUTE')
     OR has_function_privilege('authenticated','haven.guard_finance_journal()','EXECUTE')
  THEN RAISE EXCEPTION 'COL-540: resident ledger function grant boundary failed'; END IF;
END $$;

-- 2. No RLS write policy exists on the entries. A policy added later without a
--    ruling is how the append-only guarantee gets lost quietly.
DO $$ DECLARE v_cmds text; BEGIN
  SELECT string_agg(DISTINCT cmd, ',' ORDER BY cmd) INTO v_cmds
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'resident_ledger_entries';
  IF v_cmds IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'COL-540: resident_ledger_entries carries % policies; the only way in is the posting command', COALESCE(v_cmds,'<none>');
  END IF;
END $$;

-- Hosted Supabase grants request roles SELECT on public tables by default; the
-- local replay does not, so state the reads the RLS policies depend on.
GRANT SELECT ON public.facilities, public.user_facility_access, public.residents,
  public.gl_accounts, public.gl_posting_rules, public.gl_period_closes,
  public.entity_gl_settings, public.resident_ledger_entries,
  public.resident_ledger_reasons, public.resident_ledger_balances TO authenticated;

-- 3. Haven does not choose accounts. With no posting rule configured, a charge
--    is refused by name rather than landing somewhere plausible.
SELECT pg_temp.rl_actor('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rl_fail(
  format('SELECT public.post_resident_ledger_entry(%L,%L,''resident_charge'',250000,current_date)', gen_random_uuid(), resident),
  'No active posting rule') FROM rl_fixture;
RESET ROLE;

INSERT INTO public.gl_posting_rules(organization_id,entity_id,event_type,debit_gl_account_id,credit_gl_account_id)
  SELECT org, entity, 'resident_charge', ar_account, revenue_account FROM rl_fixture
  UNION ALL SELECT org, entity, 'resident_payment', cash_account, ar_account FROM rl_fixture
  UNION ALL SELECT org, entity, 'resident_write_off', writeoff_account, ar_account FROM rl_fixture
  UNION ALL SELECT org, entity, 'trust_deposit', cash_account, trust_account FROM rl_fixture;

-- 4. A caregiver has no ledger authority, whatever the surface offers them.
SELECT pg_temp.rl_actor('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rl_fail(
  format('SELECT public.post_resident_ledger_entry(%L,%L,''resident_charge'',250000,current_date)', gen_random_uuid(), resident),
  'Current resident ledger authority required') FROM rl_fixture;
RESET ROLE;

-- 5. A charge posts, balances, and lands in a period that materialized itself.
SELECT pg_temp.rl_actor('owner');
SET LOCAL ROLE authenticated;
INSERT INTO rl_results
  SELECT 'charge', public.post_resident_ledger_entry(
    '11111111-1111-4111-8111-111111111111', resident, 'resident_charge', 250000, current_date,
    'probe', NULL, NULL, 'Monthly room and care') FROM rl_fixture;
INSERT INTO rl_results
  SELECT 'payment', public.post_resident_ledger_entry(
    '22222222-2222-4222-8222-222222222222', resident, 'resident_payment', 100000, current_date,
    'probe', NULL, NULL, NULL) FROM rl_fixture;
INSERT INTO rl_results
  SELECT 'trust', public.post_resident_ledger_entry(
    '33333333-3333-4333-8333-333333333333', resident, 'trust_deposit', 5000, current_date,
    'probe', NULL, NULL, NULL) FROM rl_fixture;

DO $$ DECLARE v jsonb; BEGIN
  SELECT value INTO v FROM rl_results WHERE name = 'charge';
  IF v->>'account_kind' <> 'receivable' OR (v->>'amount_cents')::int <> 250000
     OR v->>'debit_gl_account_id' = v->>'credit_gl_account_id'
     OR v->>'gl_period_close_id' IS NULL OR v->>'effective_date' IS NULL
     OR v->>'recorded_at' IS NULL OR v->>'entry_group_id' IS NULL THEN
    RAISE EXCEPTION 'COL-540: a charge posted without two accounts, a period, both dates and a group: %', v;
  END IF;
  SELECT value INTO v FROM rl_results WHERE name = 'trust';
  IF v->>'account_kind' <> 'trust' THEN
    RAISE EXCEPTION 'COL-540: a trust deposit was filed against the receivable';
  END IF;
END $$;

-- 6. Balances are derived, and the two sides do not mix.
DO $$ DECLARE v_ar bigint; v_trust bigint; BEGIN
  SELECT receivable_balance_cents, trust_balance_cents INTO v_ar, v_trust
  FROM public.resident_ledger_balances b JOIN rl_fixture f ON f.resident = b.resident_id;
  IF v_ar <> 150000 THEN
    RAISE EXCEPTION 'COL-540: receivable balance is % cents, expected 150000 (250000 charged less 100000 paid)', v_ar;
  END IF;
  IF v_trust <> 5000 THEN
    RAISE EXCEPTION 'COL-540: trust balance is % cents, expected 5000; trust must never net against rent', v_trust;
  END IF;
END $$;

-- 7. Idempotency: the same request id replays its receipt; the same id with a
--    different payload is a different request wearing a used identity.
DO $$ DECLARE v_first uuid; v_replay uuid; BEGIN
  SELECT (value->>'id')::uuid INTO v_first FROM rl_results WHERE name = 'charge';
  SELECT (public.post_resident_ledger_entry(
    '11111111-1111-4111-8111-111111111111', resident, 'resident_charge', 250000, current_date,
    'probe', NULL, NULL, 'Monthly room and care')->>'id')::uuid INTO v_replay FROM rl_fixture;
  IF v_replay <> v_first THEN
    RAISE EXCEPTION 'COL-540: replaying a request id posted a second entry (% then %)', v_first, v_replay;
  END IF;
END $$;
SELECT pg_temp.rl_fail(
  format('SELECT public.post_resident_ledger_entry(''11111111-1111-4111-8111-111111111111'',%L,''resident_charge'',999999,current_date,''probe'')', resident),
  'already used for a different entry') FROM rl_fixture;

-- 8. An adjustment cannot post until COL has named its reasons (COL-226).
SELECT pg_temp.rl_fail(
  format('SELECT public.post_resident_ledger_entry(%L,%L,''resident_write_off'',1000,current_date)', gen_random_uuid(), resident),
  'needs a reason from the approved catalog') FROM rl_fixture;
SELECT pg_temp.rl_fail(
  format('SELECT public.post_resident_ledger_entry(%L,%L,''resident_write_off'',1000,current_date,NULL,NULL,''uncollectible'')', gen_random_uuid(), resident),
  'is in effect on') FROM rl_fixture;
RESET ROLE;

INSERT INTO public.resident_ledger_reasons(organization_id,entity_id,code,label,applies_to,effective_from,approved_by_name,approved_on)
  SELECT org, entity, 'uncollectible', 'Uncollectible balance (probe)', 'write_off', current_date - 1, 'Probe fixture', current_date - 1 FROM rl_fixture;

SELECT pg_temp.rl_actor('owner');
SET LOCAL ROLE authenticated;
INSERT INTO rl_results
  SELECT 'write_off', public.post_resident_ledger_entry(
    '44444444-4444-4444-8444-444444444444', resident, 'resident_write_off', 1000, current_date,
    NULL, NULL, 'uncollectible', 'Probe write-off') FROM rl_fixture;
DO $$ DECLARE v jsonb; BEGIN
  SELECT value INTO v FROM rl_results WHERE name = 'write_off';
  IF v->>'reason_id' IS NULL THEN
    RAISE EXCEPTION 'COL-540: a write-off posted without recording which approved reason it used';
  END IF;
END $$;
-- A reason whose window has not opened on the effective date is not in effect,
-- even though the row exists today.
SELECT pg_temp.rl_fail(
  format('SELECT public.post_resident_ledger_entry(%L,%L,''resident_write_off'',1000,current_date - 30,NULL,NULL,''uncollectible'')', gen_random_uuid(), resident),
  'is in effect on') FROM rl_fixture;
RESET ROLE;

-- 9. Append-only against every writer, including the owner of the table.
DO $$ DECLARE v_id uuid; BEGIN
  SELECT (value->>'id')::uuid INTO v_id FROM rl_results WHERE name = 'charge';
  BEGIN
    UPDATE public.resident_ledger_entries SET amount_cents = 1 WHERE id = v_id;
    RAISE EXCEPTION 'COL-540: a ledger entry was updated in place';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    DELETE FROM public.resident_ledger_entries WHERE id = v_id;
    RAISE EXCEPTION 'COL-540: a ledger entry was deleted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 10. The only correction is a reversal: legs swap, the original is named, and
--     an entry is reversed once.
SELECT pg_temp.rl_actor('owner');
SET LOCAL ROLE authenticated;
INSERT INTO rl_results
  SELECT 'reversal', public.reverse_resident_ledger_entry(
    '55555555-5555-4555-8555-555555555555', (r.value->>'id')::uuid, current_date, 'Charged in error')
  FROM rl_results r WHERE r.name = 'charge';
DO $$ DECLARE v jsonb; o jsonb; BEGIN
  SELECT value INTO v FROM rl_results WHERE name = 'reversal';
  SELECT value INTO o FROM rl_results WHERE name = 'charge';
  IF v->>'reversal_of_id' IS DISTINCT FROM (o->>'id')
     OR v->>'debit_gl_account_id' IS DISTINCT FROM (o->>'credit_gl_account_id')
     OR v->>'credit_gl_account_id' IS DISTINCT FROM (o->>'debit_gl_account_id')
     OR v->>'entry_group_id' IS DISTINCT FROM (o->>'entry_group_id') THEN
    RAISE EXCEPTION 'COL-540: a reversal did not mirror the entry it reverses: %', v;
  END IF;
END $$;
SELECT pg_temp.rl_fail(
  format('SELECT public.reverse_resident_ledger_entry(%L,%L,current_date)', gen_random_uuid(), (value->>'id')::uuid),
  'already reversed') FROM rl_results WHERE name = 'charge';
DO $$ DECLARE v_ar bigint; BEGIN
  SELECT receivable_balance_cents INTO v_ar
  FROM public.resident_ledger_balances b JOIN rl_fixture f ON f.resident = b.resident_id;
  IF v_ar <> -101000 THEN
    RAISE EXCEPTION 'COL-540: after reversing the charge the receivable is % cents, expected -101000', v_ar;
  END IF;
END $$;
RESET ROLE;

-- 11. A closed period refuses a resident posting in the database. The general
--     ledger already refused one (340); resident money never consulted a period
--     at all, which is what COL-540 fixes.
--     A balanced draft is staged first, so the only thing left to refuse the
--     journal post is the period itself.
INSERT INTO rl_results SELECT 'journal', jsonb_build_object('id', gen_random_uuid());
INSERT INTO public.journal_entries(id,organization_id,entity_id,facility_id,entry_date,memo,status)
  SELECT (r.value->>'id')::uuid, f.org, f.entity, f.facility, current_date, 'Probe draft in a locked month', 'draft'::public.journal_entry_status
  FROM rl_fixture f, rl_results r WHERE r.name = 'journal';
INSERT INTO public.journal_entry_lines(journal_entry_id,organization_id,gl_account_id,line_number,debit_cents,credit_cents)
  SELECT (r.value->>'id')::uuid, f.org, f.ar_account, 1, 5000, 0 FROM rl_fixture f, rl_results r WHERE r.name = 'journal'
  UNION ALL
  SELECT (r.value->>'id')::uuid, f.org, f.revenue_account, 2, 0, 5000 FROM rl_fixture f, rl_results r WHERE r.name = 'journal';

UPDATE public.gl_period_closes SET status = 'closed', closed_at = now()
 WHERE entity_id = (SELECT entity FROM rl_fixture)
   AND period_year = extract(YEAR FROM current_date)::int
   AND period_month = extract(MONTH FROM current_date)::int;

SELECT pg_temp.rl_actor('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rl_fail(
  format('SELECT public.post_resident_ledger_entry(%L,%L,''resident_charge'',5000,current_date)', gen_random_uuid(), resident),
  'is closed for this entity') FROM rl_fixture;
RESET ROLE;

SELECT pg_temp.rl_fail(
  format('UPDATE public.journal_entries SET status = ''posted''::public.journal_entry_status WHERE id = %L', (value->>'id')::uuid),
  'Accounting period is closed') FROM rl_results WHERE name = 'journal';

-- 12. Closing is not open either. A period being reconciled has already struck
--     its totals, so a late posting on either ledger would move them.
UPDATE public.gl_period_closes SET status = 'closing', closed_at = NULL
 WHERE entity_id = (SELECT entity FROM rl_fixture)
   AND period_year = extract(YEAR FROM current_date)::int
   AND period_month = extract(MONTH FROM current_date)::int;

SELECT pg_temp.rl_fail(
  format('UPDATE public.journal_entries SET status = ''posted''::public.journal_entry_status WHERE id = %L', (value->>'id')::uuid),
  'Accounting period is closing') FROM rl_results WHERE name = 'journal';

SELECT pg_temp.rl_actor('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rl_fail(
  format('SELECT public.post_resident_ledger_entry(%L,%L,''resident_charge'',5000,current_date)', gen_random_uuid(), resident),
  'is closing for this entity') FROM rl_fixture;
INSERT INTO rl_results
  SELECT 'next_period', public.post_resident_ledger_entry(
    '66666666-6666-4666-8666-666666666666', resident, 'resident_charge', 5000,
    (date_trunc('month', current_date) + interval '1 month')::date) FROM rl_fixture;
DO $$ DECLARE v jsonb; BEGIN
  SELECT value INTO v FROM rl_results WHERE name = 'next_period';
  IF v->>'gl_period_close_id' IS NULL THEN
    RAISE EXCEPTION 'COL-540: the open month did not materialize a period for the correction';
  END IF;
END $$;
RESET ROLE;

-- COL-567: a balance is either correct or refused, never a silent zero.
-- (a) A resident rule that misses the mapped account is refused, naming both.
SELECT pg_temp.rl_fail(
  format('INSERT INTO public.gl_posting_rules(organization_id,entity_id,event_type,debit_gl_account_id,credit_gl_account_id) VALUES (%L,%L,''resident_refund'',%L,%L)',
         org, entity, cash_account, revenue_account),
  'entity_gl_settings.accounts_receivable_id is') FROM rl_fixture;
SELECT pg_temp.rl_fail(
  format('INSERT INTO public.gl_posting_rules(organization_id,entity_id,event_type,debit_gl_account_id,credit_gl_account_id) VALUES (%L,%L,''trust_withdrawal'',%L,%L)',
         org, entity, cash_account, ar_account),
  'entity_gl_settings.trust_liability_id is') FROM rl_fixture;
-- A non-resident event type is not this guard's business.
INSERT INTO public.gl_posting_rules(organization_id,entity_id,event_type,debit_gl_account_id,credit_gl_account_id)
  SELECT org, entity, 'vendor_bill', writeoff_account, cash_account FROM rl_fixture;
-- (b) An entry written around the posting command with unmapped legs is refused.
SELECT pg_temp.rl_fail(
  format('INSERT INTO public.resident_ledger_entries(organization_id,entity_id,facility_id,resident_id,account_kind,entry_type,amount_cents,debit_gl_account_id,credit_gl_account_id,effective_date,gl_period_close_id,recorded_by,entry_group_id,request_id) SELECT organization_id,entity_id,facility_id,resident_id,''receivable'',''resident_charge'',100,%L,%L,effective_date,gl_period_close_id,recorded_by,gen_random_uuid(),gen_random_uuid() FROM public.resident_ledger_entries WHERE resident_id=%L LIMIT 1',
         revenue_account, cash_account, resident),
  'Exactly one leg must be that account') FROM rl_fixture;
-- (c) With entries on the books, the mapping cannot be re-pointed, and an
--     active rule cannot be left disagreeing with it.
SELECT pg_temp.rl_fail(
  format('UPDATE public.entity_gl_settings SET accounts_receivable_id=%L WHERE entity_id=%L', revenue_account, entity),
  'accounts_receivable_id cannot change') FROM rl_fixture;
SELECT pg_temp.rl_fail(
  format('UPDATE public.entity_gl_settings SET trust_liability_id=%L WHERE entity_id=%L', writeoff_account, entity),
  'trust_liability_id cannot change') FROM rl_fixture;
SELECT pg_temp.rl_fail(
  format('DELETE FROM public.entity_gl_settings WHERE entity_id=%L', entity),
  'cannot be deleted') FROM rl_fixture;
-- (d) The view names what it could not count; every entry here is mapped.
DO $$ DECLARE v_unmapped bigint; BEGIN
  SELECT sum(unmapped_entry_count) INTO v_unmapped
  FROM public.resident_ledger_balances b JOIN rl_fixture f ON f.resident = b.resident_id;
  IF v_unmapped IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'COL-567: % entries read as unmapped on a correctly mapped entity', v_unmapped;
  END IF;
END $$;

ROLLBACK;
