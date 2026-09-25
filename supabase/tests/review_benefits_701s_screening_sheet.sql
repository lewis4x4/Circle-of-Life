-- Rollback-only synthetic proof for COL-770 (701S sheet facts come only from this resident's record; viewing is recorded).
BEGIN;
SET LOCAL TIME ZONE 'America/New_York';
CREATE TEMP TABLE xf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site,gen_random_uuid() resident,gen_random_uuid() other;
CREATE TEMP TABLE xa AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner','caregiver']) role;
CREATE TEMP TABLE xc(case_id uuid);
GRANT ALL ON xf,xa,xc TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL770 synthetic' FROM xf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL770 synthetic' FROM xf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL770 House','1 Probe Way','Probeville','00000',4,'America/New_York' FROM xf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col770.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM xa,xf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL770 '||role,id||'@col770.invalid',role::public.app_role,true FROM xa,xf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM xa;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM xa,xf;
INSERT INTO public.staff(user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date) SELECT id,site,org,'COL770',role,'cna','active',current_date FROM xa,xf WHERE role<>'owner';
INSERT INTO public.residents(id,organization_id,facility_id,first_name,middle_name,last_name,date_of_birth,gender,status,primary_phone)
 SELECT resident,org,site,'Synthetic','Q','Probe',DATE '1940-02-03','female'::public.gender,'active'::public.resident_status,'555-0100' FROM xf
 UNION ALL SELECT other,org,site,'Other','','Resident',DATE '1941-01-01','male'::public.gender,'active'::public.resident_status,NULL FROM xf;
INSERT INTO public.resident_payers(resident_id,facility_id,organization_id,payer_type,effective_date,medicaid_recipient_id) SELECT resident,site,org,'medicaid_oss',current_date-60,'SYNTH-0001' FROM xf;
INSERT INTO public.form_1823_records(organization_id,facility_id,resident_id,exam_date,status,is_current,medical_history,adl_bathing,adl_toileting,medication_assistance)
 SELECT org,site,resident,DATE '2025-06-01','received'::public.form_1823_status,false,'{"diagnoses":["Synthetic diagnosis A"]}'::jsonb,'supervision',NULL,NULL FROM xf
 UNION ALL SELECT org,site,resident,DATE '2026-06-01','received'::public.form_1823_status,true,'{"diagnoses":["Synthetic diagnosis B"]}'::jsonb,'assistance','independent','administered_by_licensed_staff' FROM xf
 UNION ALL SELECT org,site,other,DATE '2026-05-01','received'::public.form_1823_status,true,'{"diagnoses":["Someone else''s diagnosis"]}'::jsonb,'dependent',NULL,NULL FROM xf;
INSERT INTO public.resident_medications(resident_id,facility_id,organization_id,medication_name,route,frequency,start_date,order_date,status)
 SELECT resident,site,org,'Synthetic med '||n,'oral','daily',current_date-30,current_date-30,CASE WHEN n=4 THEN 'discontinued' ELSE 'active' END::public.medication_status FROM xf,generate_series(1,4) n;
CREATE FUNCTION pg_temp.xlogin(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT xa.*,p.auth_claim_version INTO a FROM xa JOIN public.user_profiles p USING(id) WHERE xa.role=p_role; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.xassert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL770 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.xerror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;

SELECT pg_temp.xassert(NOT has_function_privilege('anon','public.benefits_screening_sheet(uuid)','EXECUTE'),'anonymous sheet');
SELECT pg_temp.xlogin('owner'); SET LOCAL ROLE authenticated;
INSERT INTO xc SELECT (public.benefits_case_create(resident,NULL,'smmc_ltc',gen_random_uuid())->>'case_id')::uuid FROM xf;
-- Before any screening: income and assets stay absent (never defaulted).
SELECT pg_temp.xassert(public.benefits_screening_sheet((SELECT case_id FROM xc))->'screening'='null'::jsonb,'screening invented');
SELECT public.benefits_screening_record(jsonb_build_object('resident_id',(SELECT resident FROM xf),'source','manual','coverage','none','monthly_income_cents',150000,'assets_cents',180000,
 'q_property_non_primary','no','q_income_over_limit','no','q_life_insurance','no','q_burial_contract','no','q_assets','no','q_power_of_attorney','no'),gen_random_uuid());
CREATE TEMP TABLE xs AS SELECT public.benefits_screening_sheet((SELECT case_id FROM xc)) s;
RESET ROLE;
SELECT pg_temp.xassert((SELECT s#>>'{resident,first_name}'='Synthetic' AND s#>>'{resident,middle_name}'='Q' AND s#>>'{resident,date_of_birth}'='1940-02-03' AND s#>>'{resident,gender}'='female' FROM xs),'demographics');
SELECT pg_temp.xassert((SELECT s#>>'{facility,name}'='COL770 House' AND s->>'medicaid_number'='SYNTH-0001' FROM xs),'facility and Medicaid number');
SELECT pg_temp.xassert((SELECT (s#>>'{screening,monthly_income_cents}')::int=150000 AND (s#>>'{screening,assets_cents}')::int=180000 FROM xs),'screening income and assets');
SELECT pg_temp.xassert((SELECT jsonb_array_length(s->'forms_1823')=2 AND s#>>'{forms_1823,0,diagnoses,0}'='Synthetic diagnosis B' AND s#>>'{forms_1823,1,diagnoses,0}'='Synthetic diagnosis A'
 AND s#>>'{forms_1823,0,adl_bathing}'='assistance' AND s#>'{forms_1823,0,adl_dressing}'='null'::jsonb FROM xs),'every 1823, newest first, only this resident');
SELECT pg_temp.xassert((SELECT (s->>'active_medication_count')::int=3 FROM xs),'active medication count');
SELECT pg_temp.xassert((SELECT count(*) FROM public.benefits_history WHERE case_id=(SELECT case_id FROM xc) AND action='screening_sheet_view')=2,'viewing not recorded');
-- Staff without Medicaid access cannot open it.
SELECT pg_temp.xlogin('caregiver'); SET LOCAL ROLE authenticated;
SELECT pg_temp.xerror($q$SELECT public.benefits_screening_sheet((SELECT case_id FROM xc))$q$,'42501');
RESET ROLE;
ROLLBACK;
