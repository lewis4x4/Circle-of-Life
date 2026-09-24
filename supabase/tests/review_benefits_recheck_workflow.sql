-- Rollback-only synthetic proof for COL-764 (quarterly Medicaid recheck). No actual resident data.
BEGIN;
CREATE TEMP TABLE kf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site,gen_random_uuid() other_site;
CREATE TEMP TABLE kr AS SELECT label,gen_random_uuid() id FROM unnest(ARRAY['steady','changes','leaves']) label;
CREATE TEMP TABLE ka AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner','manager','caregiver']) role;
CREATE TEMP TABLE kx(label text PRIMARY KEY,reply jsonb);
GRANT ALL ON kf,kr,ka,kx TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL764 synthetic' FROM kf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL764 synthetic' FROM kf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL764 synthetic','Test','Test','00000',4,'America/New_York' FROM kf UNION ALL SELECT other_site,org,entity,'COL764 other','Test','Test','00000',2,'America/New_York' FROM kf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col764.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM ka,kf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL764 '||role,id||'@col764.invalid',role::public.app_role,true FROM ka,kf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM ka;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM ka,kf;
INSERT INTO public.staff(user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date) SELECT id,site,org,'COL764',role,'cna','active',current_date FROM ka,kf WHERE role<>'owner';
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender) SELECT kr.id,org,site,'COL764',label,DATE '1940-01-01','female'::public.gender FROM kr,kf;
CREATE FUNCTION pg_temp.klogin(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT ka.*,p.auth_claim_version INTO a FROM ka JOIN public.user_profiles p USING(id) WHERE ka.role=p_role; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.kassert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL764 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.kerror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
CREATE FUNCTION pg_temp.kanswers(p_resident text,p_over jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('resident_id',(SELECT id FROM kr WHERE label=p_resident),'source','admission','coverage','private_pay',
  'q_property_non_primary','yes','q_income_over_limit','no','q_life_insurance','no','q_burial_contract','no','q_assets','no','q_power_of_attorney','no')||p_over; $$;
CREATE FUNCTION pg_temp.krecheck(p_resident text) RETURNS uuid LANGUAGE sql AS $$
 SELECT (r->>'id')::uuid FROM jsonb_array_elements(public.benefits_recheck_list(NULL,400)->'rechecks') r WHERE r->>'resident_id'=(SELECT id::text FROM kr WHERE label=p_resident); $$;

SELECT pg_temp.kassert(NOT has_function_privilege('anon','public.benefits_recheck_complete(uuid,text,text,uuid)','EXECUTE'),'anonymous complete');
SELECT pg_temp.kassert(NOT has_function_privilege('service_role','public.benefits_recheck_list(uuid,integer)','EXECUTE'),'service list');

-- Three residents who do not qualify now (property), answered by the owner.
SELECT pg_temp.klogin('owner'); SET LOCAL ROLE authenticated;
SELECT public.benefits_screening_record(pg_temp.kanswers(label),gen_random_uuid()) FROM kr;
SELECT public.benefits_access_set(jsonb_build_object('facility_id',site,'user_id',(SELECT id FROM ka WHERE role='manager'),'can_write',true,'can_review',false,'expires_at',now()+interval '1 day','reason','Synthetic grant')) FROM kf;
SELECT pg_temp.kassert(jsonb_array_length(public.benefits_recheck_list(NULL,14)->'rechecks')=0,'rechecks due in 90 days listed as due soon');
SELECT pg_temp.kassert(jsonb_array_length(public.benefits_recheck_list(NULL,400)->'rechecks')=3,'open rechecks not listed');

-- A caregiver cannot see or work rechecks.
RESET ROLE; SELECT pg_temp.klogin('caregiver'); SET LOCAL ROLE authenticated;
SELECT pg_temp.kerror($q$SELECT public.benefits_recheck_list()$q$,'42501');

-- The granted manager (facility administrator stand-in) works them.
RESET ROLE; SELECT pg_temp.klogin('manager'); SET LOCAL ROLE authenticated;
INSERT INTO kx VALUES('steady_req',jsonb_build_object('id',gen_random_uuid()));
INSERT INTO kx SELECT 'steady',public.benefits_recheck_complete(pg_temp.krecheck('steady'),'no_change','Asked; nothing changed',(SELECT (reply->>'id')::uuid FROM kx WHERE label='steady_req'));
SELECT pg_temp.kassert((SELECT (reply->>'next_due_on')::date FROM kx WHERE label='steady')=(now() AT TIME ZONE 'America/New_York')::date+90,'next recheck not 90 days from confirmation');
SELECT pg_temp.kassert(public.benefits_recheck_complete((SELECT (reply->>'recheck_id')::uuid FROM kx WHERE label='steady'),'no_change','Asked; nothing changed',(SELECT (reply->>'id')::uuid FROM kx WHERE label='steady_req'))=(SELECT reply FROM kx WHERE label='steady'),'replay changed result');
SELECT pg_temp.kerror($q$SELECT public.benefits_recheck_complete((SELECT (reply->>'recheck_id')::uuid FROM kx WHERE label='steady'),'resident_left',NULL,(SELECT (reply->>'id')::uuid FROM kx WHERE label='steady_req'))$q$,'23505');
SELECT pg_temp.kerror($q$SELECT public.benefits_recheck_complete((SELECT (reply->>'recheck_id')::uuid FROM kx WHERE label='steady'),'no_change',NULL,gen_random_uuid())$q$,'22023');
SELECT pg_temp.kerror($q$SELECT public.benefits_recheck_complete(pg_temp.krecheck('leaves'),'changed',NULL,gen_random_uuid())$q$,'22023');

SELECT public.benefits_recheck_complete(pg_temp.krecheck('leaves'),'resident_left','Discharged home',gen_random_uuid());
SELECT pg_temp.kassert(pg_temp.krecheck('leaves') IS NULL,'resident who left still has an open recheck');

-- Answers changed at the recheck: the resident becomes a candidate and the case says resubmit.
INSERT INTO kx SELECT 'changed',public.benefits_screening_record(pg_temp.kanswers('changes','{"source":"recheck","q_property_non_primary":"no"}'),gen_random_uuid());
SELECT pg_temp.kassert((SELECT reply->>'result' FROM kx WHERE label='changed')='candidate','changed answers not a candidate');
SELECT pg_temp.kassert(pg_temp.krecheck('changes') IS NULL,'changed recheck still open');
SELECT pg_temp.kassert((public.benefits_case_detail((SELECT (reply->>'case_id')::uuid FROM kx WHERE label='changed'))#>>'{case,next_action}') LIKE 'Resubmit — answers changed%','case not marked resubmit');
RESET ROLE;
SELECT pg_temp.kassert((SELECT outcome FROM public.benefits_rechecks x JOIN kr ON kr.id=x.resident_id WHERE kr.label='changes' AND x.status='closed')='changed','recheck outcome not changed');

-- Scope: a manager without the other facility's access sees none of it.
UPDATE public.residents SET facility_id=(SELECT other_site FROM kf) WHERE id=(SELECT id FROM kr WHERE label='steady');
UPDATE public.benefits_rechecks SET facility_id=(SELECT other_site FROM kf) WHERE resident_id=(SELECT id FROM kr WHERE label='steady') AND status='open';
SELECT pg_temp.klogin('manager'); SET LOCAL ROLE authenticated;
SELECT pg_temp.kassert(pg_temp.krecheck('steady') IS NULL,'other facility recheck visible');
SELECT pg_temp.kerror($q$SELECT public.benefits_recheck_list((SELECT other_site FROM kf),14)$q$,'42501');
RESET ROLE;
ROLLBACK;
