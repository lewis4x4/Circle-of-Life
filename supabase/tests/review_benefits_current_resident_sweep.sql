-- Rollback-only synthetic proof for COL-765 (current-resident Medicaid sweep). No actual resident data.
BEGIN;
CREATE TEMP TABLE wf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site,gen_random_uuid() other_site;
CREATE TEMP TABLE wr AS SELECT label,gen_random_uuid() id,st FROM (VALUES ('one','active'),('two','hospital_hold'),('three','loa'),('gone','discharged'),('lead','inquiry')) v(label,st);
CREATE TEMP TABLE wa AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner','manager']) role;
GRANT ALL ON wf,wr,wa TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL765 synthetic' FROM wf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL765 synthetic' FROM wf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL765 synthetic','Test','Test','00000',6,'America/New_York' FROM wf UNION ALL SELECT other_site,org,entity,'COL765 other','Test','Test','00000',2,'America/New_York' FROM wf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col765.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM wa,wf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL765 '||role,id||'@col765.invalid',role::public.app_role,true FROM wa,wf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM wa;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM wa,wf;
INSERT INTO public.staff(user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date) SELECT id,site,org,'COL765',role,'cna','active',current_date FROM wa,wf WHERE role<>'owner';
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT wr.id,org,site,'COL765',label,DATE '1940-01-01','female'::public.gender,st::public.resident_status FROM wr,wf;
CREATE FUNCTION pg_temp.wlogin(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT wa.*,p.auth_claim_version INTO a FROM wa JOIN public.user_profiles p USING(id) WHERE wa.role=p_role; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.wassert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL765 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.werror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
CREATE FUNCTION pg_temp.wsite() RETURNS jsonb LANGUAGE sql AS $$ SELECT f FROM jsonb_array_elements(public.benefits_sweep_status((SELECT site FROM wf))->'facilities') f $$;

SELECT pg_temp.wassert(NOT has_table_privilege('authenticated','public.benefits_sweeps','SELECT,INSERT'),'direct sweep grants');
SELECT pg_temp.wassert(NOT has_function_privilege('anon','public.benefits_sweep_start(uuid,text,uuid)','EXECUTE'),'anonymous start');

SELECT pg_temp.wlogin('owner'); SET LOCAL ROLE authenticated;
SELECT public.benefits_access_set(jsonb_build_object('facility_id',site,'user_id',(SELECT id FROM wa WHERE role='manager'),'can_write',true,'can_review',false,'expires_at',now()+interval '1 day','reason','Synthetic grant')) FROM wf;
-- Only current residents count; discharged and inquiry do not.
SELECT pg_temp.wassert((pg_temp.wsite()->>'total')::int=3 AND (pg_temp.wsite()->>'answered')::int=0,'current residents miscounted');
SELECT pg_temp.wassert(pg_temp.wsite()->>'started_at' IS NULL,'sweep started by itself');
SELECT pg_temp.wassert(jsonb_array_length(pg_temp.wsite()->'remaining')=3,'remaining list');

-- A facility administrator cannot start it; an owner can, and starting twice is harmless.
RESET ROLE; SELECT pg_temp.wlogin('manager'); SET LOCAL ROLE authenticated;
SELECT pg_temp.werror($q$SELECT public.benefits_sweep_start((SELECT site FROM wf),NULL,gen_random_uuid())$q$,'42501');
RESET ROLE; SELECT pg_temp.wlogin('owner'); SET LOCAL ROLE authenticated;
SELECT pg_temp.wassert((public.benefits_sweep_start((SELECT site FROM wf),'Records cleaned up',gen_random_uuid())->>'already_started')::boolean=false,'first start');
SELECT pg_temp.wassert((public.benefits_sweep_start((SELECT site FROM wf),NULL,gen_random_uuid())->>'already_started')::boolean=true,'second start not idempotent');

-- Answering moves progress; the answered resident leaves the remaining list.
RESET ROLE; SELECT pg_temp.wlogin('manager'); SET LOCAL ROLE authenticated;
SELECT public.benefits_screening_record(jsonb_build_object('resident_id',(SELECT id FROM wr WHERE label='one'),'source','manual','coverage','smmc_ltc_enrolled',
 'q_property_non_primary','unknown','q_income_over_limit','unknown','q_life_insurance','unknown','q_burial_contract','unknown','q_assets','unknown','q_power_of_attorney','unknown'),gen_random_uuid());
SELECT pg_temp.wassert((pg_temp.wsite()->>'answered')::int=1,'progress did not move');
SELECT pg_temp.wassert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.wsite()->'remaining') x WHERE x->>'resident_id'=(SELECT id::text FROM wr WHERE label='one')),'answered resident still listed');
SELECT pg_temp.werror($q$SELECT public.benefits_sweep_status((SELECT other_site FROM wf))$q$,'42501');
RESET ROLE;
SELECT pg_temp.werror($q$UPDATE public.benefits_sweeps SET note='rewritten'$q$,'55000');
ROLLBACK;
