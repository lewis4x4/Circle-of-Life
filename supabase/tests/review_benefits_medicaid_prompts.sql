-- Rollback-only synthetic proof for COL-766 (runway and late-payment prompts). No actual resident data.
BEGIN;
CREATE TEMP TABLE pf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site;
CREATE TEMP TABLE pr AS SELECT label,gen_random_uuid() id FROM unnest(ARRAY['soon','later','late','paid']) label;
CREATE TEMP TABLE pa AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner']) role;
CREATE TEMP TABLE px(label text PRIMARY KEY,reply jsonb);
GRANT ALL ON pf,pr,pa,px TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL766 synthetic' FROM pf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL766 synthetic' FROM pf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL766 synthetic','Test','Test','00000',6,'America/New_York' FROM pf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col766.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM pa,pf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL766 '||role,id||'@col766.invalid',role::public.app_role,true FROM pa,pf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM pa;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM pa,pf;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT pr.id,org,site,'COL766',label,DATE '1940-01-01','female'::public.gender,'active'::public.resident_status FROM pr,pf;
CREATE FUNCTION pg_temp.plogin() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT pa.*,p.auth_claim_version INTO a FROM pa JOIN public.user_profiles p USING(id); PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.passert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL766 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.perror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
CREATE FUNCTION pg_temp.pin(p_list text,p_label text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(public.benefits_prompts()->p_list) x WHERE x->>'resident_id'=(SELECT id::text FROM pr WHERE label=p_label)) $$;

SELECT pg_temp.passert(NOT has_function_privilege('anon','public.benefits_prompts(uuid)','EXECUTE'),'anonymous prompts');
SELECT pg_temp.plogin(); SET LOCAL ROLE authenticated;
-- 'soon' can private pay 2 months (inside the 75-day lead), 'later' 12 months. Both answered as not qualifying now (property).
SELECT public.benefits_screening_record(jsonb_build_object('resident_id',(SELECT id FROM pr WHERE label=l),'source','manual','coverage','private_pay','private_pay_months',m,
 'q_property_non_primary','yes','q_income_over_limit','no','q_life_insurance','no','q_burial_contract','no','q_assets','no','q_power_of_attorney','no'),gen_random_uuid())
FROM (VALUES ('soon',2),('later',12)) v(l,m);
SELECT pg_temp.passert(pg_temp.pin('runway','soon'),'runway inside lead time not prompted');
SELECT pg_temp.passert(NOT pg_temp.pin('runway','later'),'runway far out prompted');

-- Late signal stays off while Haven has no payments for the facility, even with unpaid invoices.
RESET ROLE;
-- 'late' has two unpaid past-due invoices; 'paid' has only one (one late month is not a pattern).
INSERT INTO public.invoices(resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,subtotal,total,balance_due,status,payer_type)
SELECT pr.id,site,org,entity,'COL766-'||pr.label||'-'||n,current_date-30*n-5,current_date-30*n,current_date-30*n-35,current_date-30*n-5,300000,300000,300000,'sent','private_pay'
FROM pr,pf,generate_series(1,2) n WHERE pr.label='late' OR (pr.label='paid' AND n=1);
SELECT pg_temp.plogin(); SET LOCAL ROLE authenticated;
SELECT pg_temp.passert(NOT pg_temp.pin('late_payments','late'),'late signal ran without payments in Haven');
SELECT pg_temp.passert((public.benefits_prompts()->'late_signal'->0->>'live')::boolean=false,'late signal reported live');
RESET ROLE;
INSERT INTO public.payments(resident_id,facility_id,organization_id,entity_id,payment_date,amount,payment_method) SELECT (SELECT id FROM pr WHERE label='paid'),site,org,entity,current_date-10,300000,'check' FROM pf;
SELECT pg_temp.plogin(); SET LOCAL ROLE authenticated;
SELECT pg_temp.passert((public.benefits_prompts()->'late_signal'->0->>'live')::boolean,'late signal not live with payments');
SELECT pg_temp.passert(pg_temp.pin('late_payments','late'),'two unpaid past-due invoices not prompted');
SELECT pg_temp.passert(NOT pg_temp.pin('late_payments','paid'),'a single late month prompted');

-- Setting aside needs a reason and hides the prompt; starting a case removes it and labels the case.
SELECT pg_temp.perror($q$SELECT public.benefits_prompt_dismiss((SELECT id FROM pr WHERE label='late'),'late_payments',30,' ',gen_random_uuid())$q$,'22023');
SELECT public.benefits_prompt_dismiss((SELECT id FROM pr WHERE label='late'),'late_payments',30,'Family paying this week',gen_random_uuid());
SELECT pg_temp.passert(NOT pg_temp.pin('late_payments','late'),'dismissed prompt still shown');
INSERT INTO px SELECT 'start',public.benefits_prompt_start_case((SELECT id FROM pr WHERE label='soon'),'runway',gen_random_uuid());
SELECT pg_temp.passert(NOT pg_temp.pin('runway','soon'),'prompt shown after case opened');
SELECT pg_temp.passert((public.benefits_case_detail((SELECT (reply->>'case_id')::uuid FROM px WHERE label='start'))#>>'{case,next_action}') LIKE 'Intake requested: private pay expected to end%','case not labelled');
SELECT pg_temp.passert((public.benefits_prompt_start_case((SELECT id FROM pr WHERE label='soon'),'runway',gen_random_uuid())->>'already_open')::boolean,'second start opened another case');
SELECT pg_temp.passert((SELECT count(*) FROM jsonb_array_elements(public.benefits_rules_list()->'rules') x WHERE x->>'rule_key'='runway.lead_days')=1,'lead-days rule not listed');
RESET ROLE;
ROLLBACK;
