-- Rollback-only synthetic proof for COL-775 (owner Medicaid summary per facility). Aggregates only.
BEGIN;
SET LOCAL TIME ZONE 'America/New_York';
CREATE TEMP TABLE sf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site,gen_random_uuid() other_site;
CREATE TEMP TABLE sr AS SELECT label,gen_random_uuid() id,CASE WHEN label='elsewhere' THEN 'other' ELSE 'site' END place FROM unnest(ARRAY['medicaid','applying','approved','elsewhere']) label;
CREATE TEMP TABLE sa AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner','facility_admin','manager']) role;
GRANT ALL ON sf,sr,sa TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL775 synthetic' FROM sf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL775 synthetic' FROM sf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL775 A synthetic','Test','Test','00000',10,'America/New_York' FROM sf UNION ALL SELECT other_site,org,entity,'COL775 B other','Test','Test','00000',6,'America/New_York' FROM sf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col775.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM sa,sf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL775 '||role,id||'@col775.invalid',role::public.app_role,true FROM sa,sf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM sa;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM sa,sf UNION ALL SELECT id,other_site,org FROM sa,sf WHERE role='owner';
INSERT INTO public.staff(user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date) SELECT id,site,org,'COL775',role,'cna','active',current_date FROM sa,sf WHERE role<>'owner';
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT sr.id,org,CASE WHEN place='other' THEN other_site ELSE site END,'COL775',label,DATE '1940-01-01','female'::public.gender,CASE WHEN label='applying' THEN 'hospital_hold' ELSE 'active' END::public.resident_status FROM sr,sf;
INSERT INTO public.resident_payers(resident_id,facility_id,organization_id,payer_type,effective_date) SELECT sr.id,site,org,'medicaid_oss',current_date-30 FROM sr,sf WHERE label='medicaid';
CREATE FUNCTION pg_temp.slogin(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT sa.*,p.auth_claim_version INTO a FROM sa JOIN public.user_profiles p USING(id) WHERE sa.role=p_role; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.sassert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL775 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.serror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
CREATE FUNCTION pg_temp.scard(p_place text) RETURNS jsonb LANGUAGE sql AS $$ SELECT x FROM jsonb_array_elements(public.benefits_summary()->'facilities') x WHERE x->>'facility_id'=(SELECT CASE WHEN p_place='other' THEN other_site ELSE site END::text FROM sf) $$;
CREATE FUNCTION pg_temp.scase(p_label text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT c.id FROM public.benefits_cases c JOIN sr ON sr.id=c.resident_id WHERE sr.label=p_label $$;
CREATE FUNCTION pg_temp.srev(p_label text) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT c.revision FROM public.benefits_cases c JOIN sr ON sr.id=c.resident_id WHERE sr.label=p_label $$;
CREATE FUNCTION pg_temp.sstep(p_label text,p_payload jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.benefits_board_command(pg_temp.scase(p_label),'record_step',p_payload,pg_temp.srev(p_label),gen_random_uuid()) $$;

SELECT pg_temp.sassert(NOT has_function_privilege('anon','public.benefits_summary()','EXECUTE'),'anonymous summary');
SELECT pg_temp.slogin('owner'); SET LOCAL ROLE authenticated;
SELECT public.benefits_case_create(id,NULL,'smmc_ltc',gen_random_uuid()) FROM sr WHERE label IN ('applying','approved');
SELECT pg_temp.sstep('approved',jsonb_build_object('step','dcf_decision','outcome','Approved'));
SELECT pg_temp.sstep('approved',jsonb_build_object('step','plan_enrolled','plan','UHC'));
SELECT pg_temp.sstep('approved',jsonb_build_object('step','plan_authorized','coverage_start',current_date::text));
-- Census counts holds as occupied; one resident on a Medicaid payer.
SELECT pg_temp.sassert((pg_temp.scard('site')->>'census')::int=3 AND (pg_temp.scard('site')->>'licensed_beds')::int=10 AND (pg_temp.scard('site')->>'medicaid_residents')::int=1,'census and Medicaid residents');
SELECT pg_temp.sassert((pg_temp.scard('site')->>'open_cases')::int=2 AND (pg_temp.scard('site')->'by_step'->>'intake_requested')::int=1 AND (pg_temp.scard('site')->>'awaiting_first_payment')::int=1,'cases by step and awaiting payment');
SELECT pg_temp.sassert((pg_temp.scard('site')->>'approved_this_month')::int=1,'approved this month');
-- Unknown stays unknown: no rate for the applying case, no ledger activity at all.
SELECT pg_temp.sassert((pg_temp.scard('site')->>'cases_without_rate')::int=2 AND pg_temp.scard('site')->>'revenue_not_collected_cents' IS NULL AND pg_temp.scard('site')->>'medicaid_payments_this_month_cents' IS NULL,'unknown shown as zero');
SELECT pg_temp.sassert(pg_temp.scard('site')->>'goal_medicaid_residents' IS NULL AND (public.benefits_summary()->>'can_set_goals')::boolean,'goal before it is set');
SELECT public.benefits_rule_set(jsonb_build_object('rule_key','summary.goals','value',jsonb_build_array(jsonb_build_object('facility_id',(SELECT site FROM sf),'medicaid_residents',8)),'effective_from',current_date,'reason','Synthetic goal'));
SELECT pg_temp.sassert((pg_temp.scard('site')->>'goal_medicaid_residents')::int=8,'goal not shown');
SELECT pg_temp.serror($q$SELECT public.benefits_rule_set(jsonb_build_object('rule_key','summary.goals','value','[{"facility_id":"x","medicaid_residents":-1}]'::jsonb,'effective_from',current_date+1,'reason','bad'))$q$,'22023');
RESET ROLE;
-- Medicaid payment posted this month (fixture posts directly; the ledger commands are not the subject).
SET LOCAL session_replication_role=replica;
INSERT INTO public.payments(id,resident_id,facility_id,organization_id,entity_id,payment_date,amount,payment_method,payer_name,payer_type)
SELECT gen_random_uuid(),sr.id,site,org,entity,current_date,160000,'medicaid_payment','UHC','medicaid_oss' FROM sr,sf WHERE label='medicaid';
INSERT INTO public.resident_ledger_entries(organization_id,entity_id,facility_id,resident_id,account_kind,entry_type,amount_cents,debit_gl_account_id,credit_gl_account_id,effective_date,gl_period_close_id,entry_group_id,request_id,source_type,source_id)
SELECT p.organization_id,p.entity_id,p.facility_id,p.resident_id,'receivable','resident_payment',p.amount,gen_random_uuid(),gen_random_uuid(),p.payment_date,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'payment',p.id FROM public.payments p JOIN sr ON sr.id=p.resident_id WHERE sr.label='medicaid';
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.sassert((pg_temp.scard('site')->>'medicaid_payments_this_month_cents')::int=160000,'Medicaid payments this month');
SELECT pg_temp.sassert(pg_temp.scard('other') IS NOT NULL AND (pg_temp.scard('other')->>'open_cases')::int=0,'owner sees every facility');
RESET ROLE;
-- A facility administrator sees only their facilities and cannot set goals; other roles are refused.
SELECT pg_temp.slogin('facility_admin'); SET LOCAL ROLE authenticated;
SELECT pg_temp.sassert(pg_temp.scard('other') IS NULL AND pg_temp.scard('site') IS NOT NULL AND NOT (public.benefits_summary()->>'can_set_goals')::boolean,'facility executive scope');
RESET ROLE;
SELECT pg_temp.slogin('manager'); SET LOCAL ROLE authenticated;
SELECT pg_temp.serror($q$SELECT public.benefits_summary()$q$,'42501');
RESET ROLE;
ROLLBACK;
