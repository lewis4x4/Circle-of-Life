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

CREATE TEMP TABLE fs AS SELECT gen_random_uuid() task,coalesce((SELECT id FROM public.operation_activity_subjects WHERE facility_id=f.facility AND subject_kind='facility'),gen_random_uuid()) subject,
 (clock_timestamp() AT TIME ZONE 'America/New_York')::date-40 start_date,(clock_timestamp() AT TIME ZONE 'America/New_York')::date-39 end_date,gen_random_uuid() census,gen_random_uuid() trust_account,gen_random_uuid() trust_tx FROM business_fixture f;
ALTER TABLE fs ADD COLUMN rules uuid DEFAULT gen_random_uuid(),ADD COLUMN batch uuid DEFAULT gen_random_uuid();
GRANT ALL ON fs TO authenticated;
CREATE TEMP TABLE fs_receipts(name text PRIMARY KEY,value jsonb);GRANT ALL ON fs_receipts TO authenticated;
CREATE FUNCTION pg_temp.fs_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL157 %',msg; END IF; END $$;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record) SELECT org,facility,actor,'financial',actor,'Synthetic finance source context',true FROM business_fixture;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind) SELECT subject,org,facility,'facility' FROM fs,business_fixture ON CONFLICT DO NOTHING;
INSERT INTO public.census_daily_log(id,facility_id,organization_id,log_date,total_licensed_beds,occupied_beds,available_beds,hold_beds,maintenance_beds,occupancy_rate) SELECT census,facility,org,start_date,20,10,10,2,0,0.5 FROM fs,business_fixture;
UPDATE public.invoices SET period_start=(SELECT start_date FROM fs),period_end=(SELECT end_date FROM fs) WHERE id=(SELECT invoice FROM business_fixture);
INSERT INTO public.resident_trust_accounts(id,organization_id,facility_id,resident_id,balance_cents) SELECT trust_account,org,facility,resident,0 FROM fs,business_fixture;
INSERT INTO public.resident_trust_transactions(id,organization_id,facility_id,resident_id,account_id,direction,amount_cents,balance_after_cents,description,occurred_at,created_by) SELECT trust_tx,org,facility,resident,trust_account,'deposit',500,500,'Synthetic native trust',(start_date::timestamp AT TIME ZONE 'America/New_York'),actor FROM fs,business_fixture;
INSERT INTO public.trust_account_entries(id,resident_id,facility_id,organization_id,entry_date,entry_type,amount_cents,balance_after_cents) SELECT trust_account,resident,facility,org,start_date,'adjustment',700,700 FROM fs,business_fixture;
SET LOCAL ROLE authenticated;
INSERT INTO fs_receipts VALUES('rule',public.save_operation_requirement_draft_review((SELECT id FROM public.operation_activities WHERE activity_key='hfo-al-d17-01' AND organization_id=(SELECT org FROM business_fixture)),'{"title":"Census source context","wording":"Review existing native source","allowed_recorder_roles":["owner"],"subject_kind":"facility"}'));
SELECT public.publish_operation_requirement_review((SELECT (value->>'id')::uuid FROM fs_receipts WHERE name='rule'),clock_timestamp()-interval '1 hour');
INSERT INTO fs_receipts VALUES('site',public.save_operation_facility_requirement_draft_review((SELECT id FROM public.operation_activities WHERE activity_key='hfo-al-d17-01' AND organization_id=(SELECT org FROM business_fixture)),(SELECT facility FROM business_fixture),jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT value->>'id' FROM fs_receipts WHERE name='rule'),'schedule_status','needs_confirmation')));
SELECT public.publish_operation_facility_requirement_review((SELECT (value->>'id')::uuid FROM fs_receipts WHERE name='site'),clock_timestamp()-interval '30 minutes');
INSERT INTO fs_receipts VALUES('task',public.create_operation_manual_occurrence_review((SELECT id FROM public.operation_activities WHERE activity_key='hfo-al-d17-01' AND organization_id=(SELECT org FROM business_fixture)),(SELECT facility FROM business_fixture),(SELECT subject FROM fs),'col157-manual-001','{}'));
UPDATE fs SET task=(SELECT (value->>'id')::uuid FROM fs_receipts WHERE name='task');
SELECT public.record_finance_payment(payment,resident,invoice,start_date,2500,'check','Synthetic prior period') FROM business_fixture,fs;
SELECT public.set_finance_staging_control(gen_random_uuid(),entity,0,false,gen_random_uuid(),repeat('a',64),NULL) FROM business_fixture;
SELECT public.register_finance_batch_rules(rules,entity,jsonb_build_object('companyReference','123','accountReferences',jsonb_build_array('100','200'),'accountingBasis','accrual','effectiveFrom','2000-01-01','effectiveTo','2199-12-31'),repeat('b',64),0) FROM fs,business_fixture;
SELECT public.prepare_finance_batch(batch,entity,facility,start_date,rules,jsonb_build_array(jsonb_build_object('eventId',(SELECT id FROM public.finance_source_events WHERE receipt_id=payment),'lines',jsonb_build_array(jsonb_build_object('accountReference','100','side','debit','amountCents','2500'),jsonb_build_object('accountReference','200','side','credit','amountCents','2500'))))) FROM fs,business_fixture;
-- ASSERTIONS_BEGIN: the isolated concurrency harness reuses the setup only.
CREATE TEMP TABLE fs_first AS SELECT public.finance_operation_source_snapshot(task,start_date,end_date,'col157-refresh-001') reply FROM fs;GRANT ALL ON fs_first TO authenticated;
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(reply->'history')=1 FROM fs_first),'first transition missing');
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(reply->'families')=4 FROM fs_first),'family coverage incomplete');
SELECT pg_temp.fs_assert((SELECT reply#>>'{families,1,records,0,economic_date}'=start_date::text FROM fs_first,fs),'late payment moved to recording month');
SELECT pg_temp.fs_assert((SELECT reply#>>'{families,1,records,0,service_period_start}'=start_date::text FROM fs_first,fs),'service period missing');
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(reply#>'{families,0,missing_dates}')=1 FROM fs_first),'missing census date manufactured');
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(public.finance_operation_source_snapshot(task,start_date,end_date,'col157-refresh-002')->'history')=1 FROM fs),'unchanged refresh appended');
SELECT public.record_finance_payment(payment,resident,invoice,start_date,2500,'check','Synthetic prior period') FROM business_fixture,fs;
SELECT pg_temp.fs_assert((SELECT count(*)=1 FROM public.payments WHERE id=(SELECT payment FROM business_fixture)),'duplicate payment');
SELECT pg_temp.finance_expect_error($q$SELECT public.finance_operation_source_snapshot(task,start_date-1,end_date,'col157-refresh-001') FROM fs$q$,'Request key period/scope conflict');
RESET ROLE;
UPDATE public.census_daily_log SET occupied_beds=11,available_beds=9 WHERE id=(SELECT census FROM fs);
SET LOCAL ROLE authenticated;
INSERT INTO haven.finance_source_transitions(task_id,start_date,end_date,sequence) SELECT task,start_date,end_date,9223372036854770000 FROM fs;
SELECT pg_temp.fs_assert((SELECT max(sequence)=2 FROM haven.finance_source_transitions),'caller poisoned transition ordering');
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(public.finance_operation_source_snapshot(task,start_date,end_date,'col157-refresh-003')->'history')=2 FROM fs),'corrected census missing');
RESET ROLE;
UPDATE public.census_daily_log SET occupied_beds=10,available_beds=10 WHERE id=(SELECT census FROM fs);
SET LOCAL ROLE authenticated;
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(public.finance_operation_source_snapshot(task,start_date,end_date,'col157-refresh-004')->'history')=3 FROM fs),'A B A history collapsed');
SELECT pg_temp.finance_expect_error($q$DELETE FROM haven.finance_source_transitions$q$,'permission denied%');
SELECT pg_temp.finance_expect_error($q$SELECT public.finance_operation_source_snapshot(task,start_date-366,end_date,NULL) FROM fs$q$,'Choose a past/current period%');

SELECT pg_temp.fs_assert((SELECT reply#>>'{families,3,records,0,state}'='prepared' AND reply#>>'{families,3,records,0,metrics,external_acknowledgment}'='unavailable' FROM fs_first),'prepared batch became external acknowledgment');
SELECT pg_temp.fs_assert((SELECT count(*)=2 FROM fs_first,jsonb_array_elements(reply#>'{families,2,records}') x WHERE x->>'id'=(SELECT trust_account::text FROM fs)),'cross-table same UUID lost canonical or legacy identity');
SELECT pg_temp.fs_assert((SELECT (reply#>>'{families,2,records,0,metrics,canonical_balance_cents}')='500' FROM fs_first),'current canonical balance mislabeled or summed');
CREATE TEMP TABLE before_invoice AS SELECT public.finance_operation_source_snapshot(task,start_date,end_date) reply FROM fs;GRANT ALL ON before_invoice TO authenticated;
UPDATE public.invoices SET period_end=period_end+1 WHERE id=(SELECT invoice FROM business_fixture);
SELECT pg_temp.fs_assert((SELECT public.finance_operation_source_snapshot(task,start_date,end_date)#>>'{families,1,records,0,version}'<>reply#>>'{families,1,records,0,version}' FROM fs,before_invoice),'linked invoice correction hidden by immutable event version');
SELECT pg_temp.fs_assert((SELECT public.finance_operation_source_snapshot(task,start_date,end_date)#>>'{families,1,records,0,native_version}'=reply#>>'{families,1,records,0,native_version}' FROM fs,before_invoice),'native immutable version changed');
SELECT public.set_finance_staging_control(gen_random_uuid(),entity,1,true,NULL,NULL,NULL) FROM business_fixture;
SELECT pg_temp.fs_assert((SELECT public.finance_operation_source_snapshot(task,start_date,end_date)#>>'{families,3,records,0,state}'='invalidated' FROM fs),'stopped batch remained prepared');
RESET ROLE;
REVOKE SELECT ON public.payments FROM authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.fs_assert((SELECT haven.operation_task_readable(task) FROM fs),'native revocation incorrectly removed HFO task');
SELECT pg_temp.fs_assert((SELECT public.finance_operation_source_snapshot(task,start_date,end_date)#>>'{families,1,availability}'='unavailable' FROM fs),'native-only permission loss appeared empty');
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(public.finance_operation_source_snapshot(task,start_date,end_date)->'history')=0 FROM fs),'stronger history survived native-only permission loss');
RESET ROLE;GRANT SELECT ON public.payments TO authenticated;

-- A manager retains the facility HFO task but does not gain native payment access.
UPDATE public.user_profiles SET app_role='manager' WHERE id=(SELECT actor FROM business_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true) FROM business_fixture f JOIN public.user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
SELECT pg_temp.fs_assert((SELECT haven.operation_task_readable(task) FROM fs),'manager HFO positive control failed');
SELECT pg_temp.fs_assert((SELECT public.finance_operation_source_snapshot(task,start_date,end_date)#>>'{families,1,availability}'='unavailable' FROM fs),'manager received payment data');
SELECT pg_temp.fs_assert((SELECT public.finance_operation_source_snapshot(task,start_date,end_date)#>>'{families,2,reason}' LIKE 'Canonical context only; legacy entries are unavailable%' FROM fs),'manager legacy native boundary silently omitted');
RESET ROLE;
UPDATE public.user_profiles SET app_role='owner' WHERE id=(SELECT actor FROM business_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true) FROM business_fixture f JOIN public.user_profiles p ON p.id=f.actor;
-- DST: local March 8 ends at March 9 04:00Z, not a fixed 24h after its midnight.
INSERT INTO public.resident_trust_transactions(organization_id,facility_id,resident_id,account_id,direction,amount_cents,balance_after_cents,description,occurred_at,created_by)
 SELECT org,facility,resident,trust_account,'deposit',1,0,'Synthetic DST boundary',stamp,actor FROM fs,business_fixture,(VALUES('2026-03-09 03:59:59+00'::timestamptz),('2026-03-09 04:00:00+00'::timestamptz)) d(stamp);
SET LOCAL ROLE authenticated;
SELECT pg_temp.fs_assert((SELECT count(*)=1 FROM fs,jsonb_array_elements(public.finance_operation_source_snapshot(task,'2026-03-08','2026-03-08')->'families'->2->'records') x WHERE x->>'state'='canonical_trust_transaction'),'DST period included following day or lost last instant');
RESET ROLE;
-- Inject a second source change after the transition capture. The full command
-- must roll back rather than return input A together with history B.
CREATE FUNCTION pg_temp.fs_change_after_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN UPDATE public.census_daily_log SET occupied_beds=occupied_beds+1 WHERE id=(SELECT census FROM fs);RETURN NEW;END $$;
CREATE TRIGGER fs_change_after_capture AFTER INSERT ON haven.finance_source_transitions FOR EACH ROW EXECUTE FUNCTION pg_temp.fs_change_after_capture();
UPDATE public.census_daily_log SET occupied_beds=12 WHERE id=(SELECT census FROM fs);
SET LOCAL ROLE authenticated;
SELECT pg_temp.finance_expect_error($q$SELECT public.finance_operation_source_snapshot(task,start_date,end_date,'col157-atomic-fail') FROM fs$q$,'Current source transition required');
RESET ROLE;
DROP TRIGGER fs_change_after_capture ON haven.finance_source_transitions;
SELECT pg_temp.fs_assert((SELECT occupied_beds=12 FROM public.census_daily_log WHERE id=(SELECT census FROM fs)),'failed command left injected native change');
SELECT pg_temp.fs_assert(NOT EXISTS(SELECT 1 FROM haven.finance_source_requests WHERE request_key='col157-atomic-fail'),'failed command left request evidence');


-- More than100 immutable observations are retained, with a bounded truthful page.
-- A fixture-only BEFORE trigger changes the synthetic native row for each
-- direct INSERT; the actual production capture/ordering guard remains active.
CREATE FUNCTION pg_temp.fs_next_history_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN UPDATE public.census_daily_log SET occupied_beds=12+((occupied_beds+1)%2) WHERE id=(SELECT census FROM fs);RETURN NEW;END $$;
CREATE TRIGGER aa_fs_next_history_source BEFORE INSERT ON haven.finance_source_transitions FOR EACH ROW EXECUTE FUNCTION pg_temp.fs_next_history_source();
SET LOCAL ROLE authenticated;
INSERT INTO haven.finance_source_transitions(task_id,start_date,end_date) SELECT task,start_date,end_date FROM fs,generate_series(1,101);
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(public.finance_operation_source_snapshot(task,start_date,end_date)->'history')=100 AND (public.finance_operation_source_snapshot(task,start_date,end_date)->>'history_complete')::boolean=false FROM fs),'history bound silently claimed complete');
RESET ROLE;
DROP TRIGGER aa_fs_next_history_source ON haven.finance_source_transitions;

-- The native handoff reader must exhaust more than one authorized 100-row page.
SET LOCAL ROLE authenticated;
SELECT public.set_finance_staging_control(gen_random_uuid(),entity,2,false,gen_random_uuid(),repeat('c',64),NULL) FROM business_fixture;
DO $$ DECLARE f record; v record; payment_id uuid; event_id uuid; BEGIN SELECT * INTO f FROM business_fixture;SELECT * INTO v FROM fs;
 FOR n IN 1..100 LOOP
  payment_id:=gen_random_uuid();PERFORM public.record_finance_payment(payment_id,f.resident,NULL,v.start_date,1,'check');
  SELECT id INTO event_id FROM public.finance_source_events WHERE receipt_id=payment_id;
  PERFORM public.prepare_finance_batch(gen_random_uuid(),f.entity,f.facility,v.start_date,v.rules,jsonb_build_array(jsonb_build_object('eventId',event_id,'lines',jsonb_build_array(jsonb_build_object('accountReference','100','side','debit','amountCents','1'),jsonb_build_object('accountReference','200','side','credit','amountCents','1')))));
 END LOOP;
END $$;
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(public.finance_operation_source_snapshot(task,start_date,end_date)#>'{families,3,records}')=101 FROM fs),'native handoff pagination silently truncated');
RESET ROLE;

-- Bound failure is visible, never a truncated zero. Extra rows are local native fixtures only.
INSERT INTO public.trust_account_entries(resident_id,facility_id,organization_id,entry_date,entry_type,amount_cents,balance_after_cents) SELECT resident,facility,org,start_date,'adjustment',1,1 FROM fs,business_fixture,generate_series(1,5001);
SET LOCAL ROLE authenticated;
SELECT pg_temp.finance_expect_error($q$SELECT public.finance_operation_source_snapshot(task,start_date,end_date) FROM fs$q$,'Source period exceeds complete reader bound%');
SELECT 'COL157 finance/census source primary PASS' result;
ROLLBACK;
