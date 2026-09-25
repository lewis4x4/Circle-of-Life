-- Rollback-only synthetic proof for COL-774 (board through plan enrollment, authorization and first payment; renewal return).
BEGIN;
SET LOCAL TIME ZONE 'America/New_York';
CREATE TEMP TABLE pf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site,gen_random_uuid() ar,gen_random_uuid() cash,gen_random_uuid() period,current_date today;
CREATE TEMP TABLE pr AS SELECT label,gen_random_uuid() id FROM unnest(ARRAY['paid','bare']) label;
CREATE TEMP TABLE pa AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner']) role;
GRANT ALL ON pf,pr,pa TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL774 synthetic' FROM pf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL774 synthetic' FROM pf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL774 synthetic','Test','Test','00000',4,'America/New_York' FROM pf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col774.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM pa,pf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL774 '||role,id||'@col774.invalid',role::public.app_role,true FROM pa,pf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM pa;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM pa,pf;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT pr.id,org,site,'COL774',label,DATE '1940-01-01','female'::public.gender,'active'::public.resident_status FROM pr,pf;
CREATE FUNCTION pg_temp.plogin() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT pa.*,p.auth_claim_version INTO a FROM pa JOIN public.user_profiles p USING(id); PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.passert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL774 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.perror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
CREATE FUNCTION pg_temp.prow(p_label text) RETURNS jsonb LANGUAGE sql AS $$ SELECT x FROM jsonb_array_elements(public.benefits_board((SELECT site FROM pf))->'rows') x WHERE x->>'resident_id'=(SELECT id::text FROM pr WHERE label=p_label) $$;
CREATE FUNCTION pg_temp.pcase(p_label text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT c.id FROM public.benefits_cases c JOIN pr ON pr.id=c.resident_id WHERE pr.label=p_label $$;
CREATE FUNCTION pg_temp.prev(p_label text) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT c.revision FROM public.benefits_cases c JOIN pr ON pr.id=c.resident_id WHERE pr.label=p_label $$;
CREATE FUNCTION pg_temp.pstep(p_label text,p_payload jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.benefits_board_command(pg_temp.pcase(p_label),'record_step',p_payload,pg_temp.prev(p_label),gen_random_uuid()) $$;
-- Ledger fixtures post directly (triggers off) because the probe proves the read, not the finance commands.
CREATE FUNCTION pg_temp.ppay(p_label text,p_payer text,p_on date,p_type text DEFAULT 'medicaid_oss') RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE pid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); f pf; r uuid; BEGIN
 SELECT * INTO f FROM pf; SELECT id INTO r FROM pr WHERE label=p_label;
 SET LOCAL session_replication_role=replica;
 INSERT INTO public.payments(id,resident_id,facility_id,organization_id,entity_id,payment_date,amount,payment_method,payer_name,payer_type) VALUES(pid,r,f.site,f.org,f.entity,p_on,150000,'medicaid_payment',p_payer,p_type::public.payer_type);
 INSERT INTO public.resident_ledger_entries(id,organization_id,entity_id,facility_id,resident_id,account_kind,entry_type,amount_cents,debit_gl_account_id,credit_gl_account_id,effective_date,gl_period_close_id,entry_group_id,request_id,source_type,source_id)
 VALUES(eid,f.org,f.entity,f.site,r,'receivable','resident_payment',150000,f.cash,f.ar,p_on,f.period,gen_random_uuid(),gen_random_uuid(),'payment',pid);
 SET LOCAL session_replication_role=origin;
 RETURN eid; END $$;
CREATE FUNCTION pg_temp.preverse(p_entry uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 SET LOCAL session_replication_role=replica;
 INSERT INTO public.resident_ledger_entries(organization_id,entity_id,facility_id,resident_id,account_kind,entry_type,amount_cents,debit_gl_account_id,credit_gl_account_id,effective_date,gl_period_close_id,entry_group_id,request_id,source_type,source_id,reversal_of_id)
 SELECT organization_id,entity_id,facility_id,resident_id,account_kind,entry_type,amount_cents,credit_gl_account_id,debit_gl_account_id,effective_date,gl_period_close_id,gen_random_uuid(),gen_random_uuid(),source_type,source_id,id FROM public.resident_ledger_entries WHERE id=p_entry;
 SET LOCAL session_replication_role=origin; END $$;

SELECT pg_temp.passert(NOT has_function_privilege('authenticated','haven.benefits_first_payment(uuid)','EXECUTE'),'first payment helper exposed');
SELECT pg_temp.plogin(); SET LOCAL ROLE authenticated;
SELECT public.benefits_case_create(id,NULL,'smmc_ltc',gen_random_uuid()) FROM pr;
-- Funding facts only on plan steps, with valid values; enrollment names the plan; authorization records coverage start.
SELECT pg_temp.perror($q$SELECT pg_temp.pstep('bare',jsonb_build_object('step','intake_requested','plan','UHC'))$q$,'22023');
SELECT pg_temp.perror($q$SELECT pg_temp.pstep('bare',jsonb_build_object('step','plan_enrolled'))$q$,'22023');
SELECT pg_temp.perror($q$SELECT pg_temp.pstep('bare',jsonb_build_object('step','plan_enrolled','plan','UHC','coverage_start','2026-13-40'))$q$,'22023');
SELECT pg_temp.perror($q$SELECT pg_temp.pstep('bare',jsonb_build_object('step','plan_enrolled','plan','UHC','resident_contribution_cents',-5))$q$,'22023');
SELECT pg_temp.perror($q$SELECT pg_temp.pstep('bare',jsonb_build_object('step','plan_authorized'))$q$,'22023');
SELECT pg_temp.pstep('paid',jsonb_build_object('step','plan_enrolled','occurred_on',current_date-10,'plan','UHC','reference','ENR-1'));
SELECT pg_temp.pstep('paid',jsonb_build_object('step','plan_authorized','occurred_on',current_date-5,'coverage_start',(current_date-40)::text,'renewal_date',(current_date+30)::text,'resident_contribution_cents',12000));
RESET ROLE;
SELECT pg_temp.passert((SELECT funding->>'plan'='UHC' AND funding->>'reference'='ENR-1' AND funding->>'status'='unverified' AND (funding->>'resident_contribution_cents')::int=12000 FROM public.benefits_cases WHERE id=pg_temp.pcase('paid')),'funding facts not carried');
SET LOCAL ROLE authenticated;
SELECT pg_temp.passert(pg_temp.prow('paid')->>'phase'='awaiting_first_payment' AND (pg_temp.prow('paid')->>'phase_days')::int=5,'authorized case awaits first payment');
SELECT pg_temp.passert(pg_temp.prow('bare')->>'phase'='working','working case');
RESET ROLE;
-- None of these is the plan's first payment: another payer, the plan before coverage, a reversed plan payment, private pay.
SELECT pg_temp.ppay('paid','Sunshine Health',current_date-3);
SELECT pg_temp.ppay('paid','UHC Community Plan',current_date-45);
SELECT pg_temp.preverse(pg_temp.ppay('paid','UHC Community Plan',current_date-2));
SELECT pg_temp.ppay('paid','UHC Community Plan',current_date-2,'private_pay');
SET LOCAL ROLE authenticated;
SELECT pg_temp.passert(pg_temp.prow('paid')->>'phase'='awaiting_first_payment' AND pg_temp.prow('paid')->>'first_payment_on' IS NULL,'wrong payment counted as first payment');
RESET ROLE;
SELECT pg_temp.ppay('paid','UHC Community Plan',current_date-1);
SET LOCAL ROLE authenticated;
-- Paid, renewal within the 60-day warning: back on the board as a renewal row.
SELECT pg_temp.passert(pg_temp.prow('paid')->>'phase'='renewal' AND pg_temp.prow('paid')->>'first_payment_on'=(current_date-1)::text AND (pg_temp.prow('paid')->>'phase_days')::int=30,'renewal row');
SELECT pg_temp.passert(NOT (pg_temp.prow('paid')->>'stalled')::boolean AND pg_temp.prow('paid')->>'revenue_not_collected_cents' IS NULL,'paid row still counts as uncollected');
-- Renewal far away: the paid case leaves the active board.
SELECT pg_temp.pstep('paid',jsonb_build_object('step','plan_authorized','renewal_date',(current_date+200)::text));
SELECT pg_temp.passert(pg_temp.prow('paid') IS NULL,'paid case still on the active board');
SELECT pg_temp.passert(pg_temp.prow('bare') IS NOT NULL,'unpaid case left the board');
RESET ROLE;
-- Reviewed funding cannot be rewritten from the board.
UPDATE public.benefits_cases SET funding=funding||'{"status":"reviewed"}' WHERE id=pg_temp.pcase('bare');
SET LOCAL ROLE authenticated;
SELECT pg_temp.perror($q$SELECT pg_temp.pstep('bare',jsonb_build_object('step','plan_enrolled','plan','Humana'))$q$,'22023');
RESET ROLE;
ROLLBACK;
