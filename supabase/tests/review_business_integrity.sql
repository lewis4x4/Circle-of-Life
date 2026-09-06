-- Disposable PostgreSQL replay only. Fixture records and auth adaptation roll back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE business_fixture AS SELECT gen_random_uuid() actor, gen_random_uuid() account, gen_random_uuid() deposit,
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
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','app_role','owner','organization_id',org,'app_metadata',jsonb_build_object('app_role','owner','organization_id',org))::text,true) FROM business_fixture;
INSERT INTO public.gl_accounts(id,organization_id,entity_id,code,name,account_type)
 SELECT debit_account,org,entity,'review-'||debit_account,'Review debit','asset'::public.gl_account_type FROM business_fixture
 UNION ALL SELECT credit_account,org,entity,'review-'||credit_account,'Review credit','asset'::public.gl_account_type FROM business_fixture;
INSERT INTO public.petty_cash_accounts(id,organization_id,facility_id) SELECT account,org,facility FROM business_fixture;
INSERT INTO public.staff(id,organization_id,facility_id,user_id,first_name,last_name,staff_role,hire_date)
 SELECT employee,org,facility,actor,'Review','Employee','resident_aide',current_date FROM business_fixture;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender)
 SELECT resident,facility,org,'Review','Resident','1940-01-01','female' FROM business_fixture;

DO $$ DECLARE f record; receipt jsonb; stamp timestamptz; original_lines jsonb; BEGIN
 SELECT * INTO f FROM business_fixture;
 receipt:=public.post_cash_transaction('petty',f.deposit,f.account,'credit',10000,'replenishment','Review funds');
 PERFORM public.post_cash_transaction('petty',f.withdrawal,f.account,'debit',8000,'other','Review withdrawal');
 PERFORM public.post_cash_transaction('petty',f.withdrawal,f.account,'debit',8000,'other','Review withdrawal');
 IF (SELECT balance_cents FROM public.petty_cash_accounts WHERE id=f.account)<>2000 OR (SELECT count(*) FROM public.petty_cash_transactions WHERE account_id=f.account)<>2 THEN RAISE EXCEPTION 'Cash retry duplicated money'; END IF;
 BEGIN
   PERFORM public.post_cash_transaction('petty',gen_random_uuid(),f.account,'debit',8000,'other','Second withdrawal');
   RAISE EXCEPTION 'Overdraw accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Withdrawal exceeds available balance' THEN RAISE; END IF; END;
 BEGIN UPDATE public.petty_cash_accounts SET balance_cents=3000 WHERE id=f.account; RAISE EXCEPTION 'Direct balance edit accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Account balances change only through ledger transactions' THEN RAISE; END IF; END;
 original_lines:=jsonb_build_array(jsonb_build_object('line_number',1,'gl_account_id',f.debit_account,'debit_cents',100,'credit_cents',0),jsonb_build_object('line_number',2,'gl_account_id',f.credit_account,'debit_cents',0,'credit_cents',100));
 PERFORM public.save_journal_draft(f.journal,f.entity,f.facility,current_date,'Original',original_lines);
 SELECT updated_at INTO stamp FROM public.journal_entries WHERE id=f.journal;
 BEGIN
   PERFORM public.save_journal_draft(f.journal,f.entity,f.facility,current_date,'Failed replacement',jsonb_set(original_lines,'{1,gl_account_id}',to_jsonb(gen_random_uuid())),stamp);
   RAISE EXCEPTION 'Invalid account accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Account does not belong to journal entity' THEN RAISE; END IF; END;
 IF (SELECT memo FROM public.journal_entries WHERE id=f.journal)<>'Original' OR (SELECT count(*) FROM public.journal_entry_lines WHERE journal_entry_id=f.journal AND deleted_at IS NULL)<>2 THEN RAISE EXCEPTION 'Failed draft save destroyed prior journal'; END IF;
 PERFORM public.save_journal_draft(f.journal,f.entity,f.facility,current_date,'Updated',original_lines,stamp);
 IF (SELECT count(*) FROM public.journal_entry_lines WHERE journal_entry_id=f.journal)<>4 THEN RAISE EXCEPTION 'Journal history was not retained'; END IF;
 INSERT INTO public.time_records(id,staff_id,facility_id,organization_id,clock_in,clock_out,clock_in_method,break_minutes) VALUES(f.punch,f.employee,f.facility,f.org,'2026-09-01 11:00Z','2026-09-01 19:00Z','manual',30);
 IF (SELECT actual_hours FROM public.time_records WHERE id=f.punch)<>7.5 THEN RAISE EXCEPTION 'Timestamp punch hours not calculated'; END IF;
 UPDATE public.time_records SET approved=true,approved_at=now(),approved_by=f.actor WHERE id=f.punch;
 UPDATE public.time_records SET clock_out='2026-09-01 20:00Z' WHERE id=f.punch;
 IF (SELECT approved FROM public.time_records WHERE id=f.punch) OR (SELECT actual_hours FROM public.time_records WHERE id=f.punch)<>8.5 THEN RAISE EXCEPTION 'Changed punch retained approval or stale hours'; END IF;
END $$;

-- A failure after ledger insertion rolls its balance update back as well.
CREATE FUNCTION pg_temp.business_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected cash receipt failure'; END $$;
CREATE TRIGGER business_fail_receipt AFTER INSERT ON public.petty_cash_transactions FOR EACH ROW EXECUTE FUNCTION pg_temp.business_fail_receipt();
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM business_fixture;
 BEGIN PERFORM public.post_cash_transaction('petty',gen_random_uuid(),f.account,'credit',100,'other','Failure injection'); RAISE EXCEPTION 'Expected injected failure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected cash receipt failure' THEN RAISE; END IF; END;
 IF (SELECT balance_cents FROM public.petty_cash_accounts WHERE id=f.account)<>2000 THEN RAISE EXCEPTION 'Failed ledger insert left changed balance'; END IF;
END $$;
DROP TRIGGER business_fail_receipt ON public.petty_cash_transactions;

-- Bad attendee rolls back the session, including earlier attendance rows.
DO $$ DECLARE f record; session_id uuid:=gen_random_uuid(); BEGIN SELECT * INTO f FROM business_fixture;
 BEGIN PERFORM public.save_inservice_session(session_id,jsonb_build_object('facility_id',f.facility,'topic','Review','trainer_name','Trainer','session_date',current_date,'hours',1),ARRAY[f.employee,gen_random_uuid()]); RAISE EXCEPTION 'Missing attendee accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Attendee unavailable in session facility' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.inservice_log_sessions WHERE id=session_id) THEN RAISE EXCEPTION 'Training partial save survived'; END IF;
END $$;

-- Legacy aliases cannot drift on new orders. No current clinical data is changed.
DO $$ DECLARE f record; order_id uuid:=gen_random_uuid(); BEGIN SELECT * INTO f FROM business_fixture;
 INSERT INTO public.diet_orders(id,organization_id,facility_id,resident_id,diet_type,status,iddsi_food_level,iddsi_fluid_level,allergy_constraints)
 VALUES(order_id,f.org,f.facility,f.resident,'regular','draft',4,'level_2_mildly_thick',ARRAY['peanut']);
 IF (SELECT active FROM public.diet_orders WHERE id=order_id) OR (SELECT iddsi_liquid_level FROM public.diet_orders WHERE id=order_id)<>2 OR (SELECT allergies FROM public.diet_orders WHERE id=order_id)<>ARRAY['peanut'] THEN RAISE EXCEPTION 'Diet contract drift'; END IF;
END $$;
ROLLBACK;
