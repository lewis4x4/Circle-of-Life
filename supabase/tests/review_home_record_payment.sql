-- COL-594 (Home W2 slice 1): Record payment on Home, shipped dark.
-- Native scratch-only probe; every fixture rolls back. Synthetic resident only.
--
-- What this protects:
--   * building is not releasing: the command refuses until an owner/org admin
--     switches the module on for that facility, and refuses again once it is
--     switched off;
--   * a facility administrator cannot release a module;
--   * no photo, no payment; a photo filed under another payment does not count;
--   * an amount that is not the full open balance needs a reason, and the
--     reason is kept with the photo;
--   * the payment lands on the oldest open invoice, through the one finance
--     write path, and a retry replays instead of paying twice.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;

CREATE TEMP TABLE hp AS
SELECT gen_random_uuid() owner_actor, gen_random_uuid() owner_session,
       gen_random_uuid() fa_actor, gen_random_uuid() fa_session,
       gen_random_uuid() entity, gen_random_uuid() facility, o.id org,
       gen_random_uuid() resident,
       gen_random_uuid() old_invoice, gen_random_uuid() new_invoice,
       gen_random_uuid() pay_1, gen_random_uuid() pay_2, gen_random_uuid() pay_3
FROM public.organizations o WHERE o.deleted_at IS NULL ORDER BY o.id LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM hp) THEN RAISE EXCEPTION 'COL-594 probe needs one seeded organization'; END IF; END $$;

INSERT INTO public.entities(id,organization_id,name,entity_type,status)
  SELECT entity, org, 'Home Payment Probe LLC', 'llc', 'active'::public.entity_status FROM hp;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT facility, entity, org, 'Home Payment Probe House', '1 Probe Way', 'Probeville', '00000', 10 FROM hp;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT owner_actor, owner_actor||'@review.invalid', jsonb_build_object('organization_id',org,'app_role','owner'), '{}'::jsonb FROM hp
  UNION ALL SELECT fa_actor, fa_actor||'@review.invalid', jsonb_build_object('organization_id',org,'app_role','facility_admin'), '{}'::jsonb FROM hp;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT owner_actor, owner_actor||'@review.invalid','Owner probe','owner'::public.app_role,org,true FROM hp
  UNION ALL SELECT fa_actor, fa_actor||'@review.invalid','Administrator probe','facility_admin'::public.app_role,org,true FROM hp;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session, owner_actor FROM hp UNION ALL SELECT fa_session, fa_actor FROM hp;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
  SELECT owner_actor, facility, org FROM hp UNION ALL SELECT fa_actor, facility, org FROM hp;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status,admission_date)
  SELECT resident, facility, org, 'Payment', 'Probe', date '1940-03-03', 'female'::public.gender, 'active'::public.resident_status, current_date - 200 FROM hp;
-- Two open invoices: the older one must take the payment first.
INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,adjustments,tax,total,amount_paid,balance_due)
  SELECT old_invoice, resident, facility, org, entity, 'PROBE-594-OLD', current_date - 45, current_date - 40,
         (date_trunc('month', current_date - 45))::date, (date_trunc('month', current_date - 45) + interval '1 month - 1 day')::date,
         'sent'::public.invoice_status, 100000, 0, 0, 100000, 0, 100000 FROM hp
  UNION ALL
  SELECT new_invoice, resident, facility, org, entity, 'PROBE-594-NEW', current_date - 15, current_date - 10,
         (date_trunc('month', current_date - 15))::date, (date_trunc('month', current_date - 15) + interval '1 month - 1 day')::date,
         'sent'::public.invoice_status, 150000, 0, 0, 150000, 0, 150000 FROM hp;
-- Photos as the browser upload would leave them.
INSERT INTO storage.objects(bucket_id,name)
  SELECT 'payment-evidence', facility||'/'||pay_1||'/check.jpg' FROM hp
  UNION ALL SELECT 'payment-evidence', facility||'/'||pay_2||'/check.jpg' FROM hp;

CREATE FUNCTION pg_temp.hp_actor(p_which text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', CASE WHEN p_which='owner' THEN f.owner_actor ELSE f.fa_actor END,
      'session_id', CASE WHEN p_which='owner' THEN f.owner_session ELSE f.fa_session END,
      'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,
      'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)
  FROM hp f JOIN public.user_profiles p ON p.id = CASE WHEN p_which='owner' THEN f.owner_actor ELSE f.fa_actor END;
END $$;
CREATE FUNCTION pg_temp.hp_fail(sql text, expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM) > 0 THEN RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'COL-594 expected failure: %', expected;
END $$;
-- Hosted Supabase grants request roles SELECT on public tables by default; the
-- local replay does not. RLS, not the grant, is what this probe tests.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE TEMP TABLE hp_out(name text PRIMARY KEY, value jsonb);
GRANT ALL ON hp_out TO authenticated;
GRANT SELECT ON hp TO authenticated;

CREATE FUNCTION pg_temp.hp_pay(p uuid, cents integer, path_payment uuid, reason text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.home_record_payment(%L,%L,current_date,%s,''check'',%L,''1042'',NULL,%L,NULL)',
                p, resident, cents, facility||'/'||path_payment||'/check.jpg', reason) FROM hp
$$;

SET LOCAL ROLE authenticated;

-- 1. Dark by default.
SELECT pg_temp.hp_actor('fa');
SELECT pg_temp.hp_fail(pg_temp.hp_pay(pay_1, 100000, pay_1, 'partial'), 'not switched on') FROM hp;
DO $$ BEGIN
  IF cardinality(public.home_released_modules((SELECT facility FROM hp))) <> 0 THEN
    RAISE EXCEPTION 'COL-594: a module is released that nobody switched on';
  END IF;
END $$;

-- 2. An administrator cannot release; an owner can, with a reason.
SELECT pg_temp.hp_fail(format('SELECT public.home_set_module_release(%L,''record_payment'',true,''go'')', facility), 'Only an owner or org admin') FROM hp;
SELECT pg_temp.hp_actor('owner');
SELECT pg_temp.hp_fail(format('SELECT public.home_set_module_release(%L,''record_payment'',true,''  '')', facility), 'Say why') FROM hp;
INSERT INTO hp_out SELECT 'release', public.home_set_module_release(facility, 'record_payment', true, 'Brian: release W2 to Homewood') FROM hp;
DO $$ BEGIN
  IF (SELECT value->>'changed' FROM hp_out WHERE name='release') <> 'true'
     OR NOT ('record_payment' = ANY (public.home_released_modules((SELECT facility FROM hp)))) THEN
    RAISE EXCEPTION 'COL-594: releasing did not switch the module on';
  END IF;
END $$;

-- 3. No photo, or a photo filed under another payment, is refused.
SELECT pg_temp.hp_actor('fa');
SELECT pg_temp.hp_fail(pg_temp.hp_pay(pay_3, 100000, pay_3, 'partial'), 'Attach the check') FROM hp;
SELECT pg_temp.hp_fail(pg_temp.hp_pay(pay_3, 100000, pay_1, 'partial'), 'Attach the check') FROM hp;

-- 4. Not the full open balance (250000) without a reason is refused.
SELECT pg_temp.hp_fail(pg_temp.hp_pay(pay_1, 100000, pay_1, NULL), 'not the full amount due') FROM hp;

-- 5. With a reason: lands on the oldest invoice, keeps photo and reason.
INSERT INTO hp_out SELECT 'pay_1', public.home_record_payment(pay_1, resident, current_date, 100000, 'check',
  facility||'/'||pay_1||'/check.jpg', '1042', NULL, 'Family pays the rest on the 15th', NULL) FROM hp;
RESET ROLE;
DO $$ DECLARE v jsonb; f hp; BEGIN
  SELECT * INTO f FROM hp;
  SELECT value INTO v FROM hp_out WHERE name='pay_1';
  IF (v->>'invoice_id')::uuid <> f.old_invoice OR (v->>'allocated_cents')::int <> 100000 THEN
    RAISE EXCEPTION 'COL-594: payment did not land on the oldest invoice: %', v;
  END IF;
  IF (SELECT status::text FROM public.invoices WHERE id=f.old_invoice) <> 'paid'
     OR (SELECT balance_due FROM public.invoices WHERE id=f.new_invoice) <> 150000 THEN
    RAISE EXCEPTION 'COL-594: invoice settlement is wrong after the first payment';
  END IF;
  IF (SELECT mismatch_reason FROM public.payment_evidence WHERE payment_id=f.pay_1) IS DISTINCT FROM 'Family pays the rest on the 15th'
     OR (SELECT object_path FROM public.payment_evidence WHERE payment_id=f.pay_1) <> f.facility||'/'||f.pay_1||'/check.jpg' THEN
    RAISE EXCEPTION 'COL-594: photo or reason not kept with the payment';
  END IF;
  IF (SELECT notes FROM public.payments WHERE id=f.pay_1) NOT LIKE '%Family pays the rest on the 15th%' THEN
    RAISE EXCEPTION 'COL-594: the reason is missing from the payment record';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.finance_command_receipts WHERE command_type='payment' AND id=f.pay_1) THEN
    RAISE EXCEPTION 'COL-594: the payment skipped the finance command receipt';
  END IF;
END $$;
SET LOCAL ROLE authenticated;

-- 6. A retry replays; nothing is paid twice.
SELECT pg_temp.hp_actor('fa');
INSERT INTO hp_out SELECT 'replay', public.home_record_payment(pay_1, resident, current_date, 100000, 'check',
  facility||'/'||pay_1||'/check.jpg', '1042', NULL, 'Family pays the rest on the 15th', NULL) FROM hp;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT value->>'replayed' FROM hp_out WHERE name='replay') <> 'true'
     OR (SELECT count(*) FROM public.payments WHERE id=(SELECT pay_1 FROM hp)) <> 1 THEN
    RAISE EXCEPTION 'COL-594: a retry was not a replay';
  END IF;
END $$;
SET LOCAL ROLE authenticated;

-- 7. The exact open balance needs no reason and goes to the next-oldest invoice.
SELECT pg_temp.hp_actor('fa');
INSERT INTO hp_out SELECT 'pay_2', public.home_record_payment(pay_2, resident, current_date, 150000, 'check',
  facility||'/'||pay_2||'/check.jpg', '1043', NULL, NULL, NULL) FROM hp;
RESET ROLE;
DO $$ DECLARE f hp; BEGIN
  SELECT * INTO f FROM hp;
  IF (SELECT (value->>'invoice_id')::uuid FROM hp_out WHERE name='pay_2') <> f.new_invoice
     OR (SELECT status::text FROM public.invoices WHERE id=f.new_invoice) <> 'paid'
     OR (SELECT mismatch_reason FROM public.payment_evidence WHERE payment_id=f.pay_2) IS NOT NULL THEN
    RAISE EXCEPTION 'COL-594: an exact payment was mishandled';
  END IF;
END $$;
SET LOCAL ROLE authenticated;

-- 8. Switched off: refused again, and the history stays.
SELECT pg_temp.hp_actor('owner');
SELECT public.home_set_module_release(facility, 'record_payment', false, 'Brian: hold for the holiday') FROM hp;
SELECT pg_temp.hp_actor('fa');
SELECT pg_temp.hp_fail(pg_temp.hp_pay(pay_3, 5000, pay_3, 'x'), 'not switched on') FROM hp;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.home_module_releases WHERE facility_id=(SELECT facility FROM hp) AND released_until IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'COL-594: switching off lost the release history';
  END IF;
END $$;

-- 9. Past due: not configured is said, not read as "nobody owes".
CREATE TEMP TABLE hp2 AS SELECT gen_random_uuid() late_resident, gen_random_uuid() late_invoice,
  gen_random_uuid() day18_resident, gen_random_uuid() day18_invoice;
GRANT SELECT ON hp2 TO authenticated;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status,admission_date,rent_due_day)
  SELECT late_resident, facility, org, 'Late', 'Probe', date '1941-04-04', 'male'::public.gender, 'active'::public.resident_status, current_date - 300, NULL FROM hp, hp2
  UNION ALL SELECT day18_resident, facility, org, 'Eighteen', 'Probe', date '1942-05-05', 'female'::public.gender, 'active'::public.resident_status, current_date - 300, 18 FROM hp, hp2;
-- Both invoices cover the month two months back; both are long past any due day.
INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,status,subtotal,adjustments,tax,total,amount_paid,balance_due)
  SELECT late_invoice, late_resident, facility, org, entity, 'PROBE-594-LATE', (date_trunc('month', current_date) - interval '2 month')::date, (date_trunc('month', current_date) - interval '2 month')::date + 4,
         (date_trunc('month', current_date) - interval '2 month')::date, (date_trunc('month', current_date) - interval '1 month - 0 day')::date - 1,
         'sent'::public.invoice_status, 300000, 0, 0, 300000, 0, 300000 FROM hp, hp2
  UNION ALL
  SELECT day18_invoice, day18_resident, facility, org, entity, 'PROBE-594-D18', (date_trunc('month', current_date) - interval '2 month')::date, (date_trunc('month', current_date) - interval '2 month')::date + 4,
         (date_trunc('month', current_date) - interval '2 month')::date, (date_trunc('month', current_date) - interval '1 month')::date - 1,
         'sent'::public.invoice_status, 200000, 0, 0, 200000, 0, 200000 FROM hp, hp2;
SET LOCAL ROLE authenticated;
SELECT pg_temp.hp_actor('fa');
DO $$ DECLARE v jsonb; BEGIN
  v := public.home_past_due((SELECT facility FROM hp));
  IF v->>'configured' <> 'false' OR jsonb_array_length(v->'residents') <> 0 THEN
    RAISE EXCEPTION 'COL-594: an unconfigured facility must say so, got %', v;
  END IF;
END $$;
SELECT pg_temp.hp_fail(format('SELECT public.home_set_rent_settings(%L,5,5,current_date - 400,''x'')', facility), 'Only an owner or org admin') FROM hp;
SELECT pg_temp.hp_actor('owner');
SELECT public.home_set_rent_settings(facility, 5, 5, current_date - 400, 'DEC-2026-09-22-03: due the 5th, past due after 5 days') FROM hp;
SELECT pg_temp.hp_actor('fa');
DO $$ DECLARE v jsonb; r jsonb; f hp2; BEGIN
  SELECT * INTO f FROM hp2;
  v := public.home_past_due((SELECT facility FROM hp));
  IF v->>'configured' <> 'true' OR (v->>'graceDays')::int <> 5 THEN RAISE EXCEPTION 'COL-594: settings not applied: %', v; END IF;
  IF jsonb_array_length(v->'residents') <> 2 THEN RAISE EXCEPTION 'COL-594: expected the two late residents, got %', v->'residents'; END IF;
  -- Oldest due first: the 5th resident before the 18th resident.
  IF (v->'residents'->0->>'residentId')::uuid <> f.late_resident OR (v->'residents'->1->>'residentId')::uuid <> f.day18_resident THEN
    RAISE EXCEPTION 'COL-594: past due not ordered oldest first: %', v->'residents';
  END IF;
  IF extract(day FROM (v->'residents'->1->>'oldestDueDate')::date) <> 18 THEN
    RAISE EXCEPTION 'COL-594: a per-resident due day was ignored: %', v->'residents'->1;
  END IF;
  IF (v->'residents'->0->>'openCents')::bigint <> 300000 THEN RAISE EXCEPTION 'COL-594: open cents wrong: %', v->'residents'->0; END IF;
  -- The two residents paid in full above are not past due.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v->'residents') e WHERE (e->>'residentId')::uuid = (SELECT resident FROM hp)) THEN
    RAISE EXCEPTION 'COL-594: a paid-up resident reads as past due';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
