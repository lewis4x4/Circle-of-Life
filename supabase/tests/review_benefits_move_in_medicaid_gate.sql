-- Rollback-only synthetic proof for COL-575 (move-in needs a "likely to qualify" Medicaid review or an executive override).
BEGIN;
CREATE TEMP TABLE tf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site;
CREATE TEMP TABLE tr AS SELECT label,gen_random_uuid() id,gen_random_uuid() admission FROM unnest(ARRAY['likely','stopped','unasked','mma','enrolled','private','reviewed','overridden']) label;
CREATE TEMP TABLE ta AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner']) role;
GRANT ALL ON tf,tr,ta TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL575 synthetic' FROM tf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL575 synthetic' FROM tf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL575 synthetic','Test','Test','00000',8,'America/New_York' FROM tf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col575.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM ta,tf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL575 '||role,id||'@col575.invalid',role::public.app_role,true FROM ta,tf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM ta;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM ta,tf;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT tr.id,org,site,'COL575',label,DATE '1940-01-01','female'::public.gender,'active'::public.resident_status FROM tr,tf;
INSERT INTO public.admission_cases(id,organization_id,facility_id,resident_id,anticipated_payer_source)
 SELECT admission,org,site,tr.id,CASE WHEN label IN ('private') THEN 'private_pay' ELSE 'medicaid_pending' END::public.anticipated_payer_source FROM tr,tf;
CREATE FUNCTION pg_temp.tlogin(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT ta.*,p.auth_claim_version INTO a FROM ta JOIN public.user_profiles p USING(id) WHERE ta.role=p_role; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.tassert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL575 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.tscreen(p_label text,p_coverage text,p_property text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.benefits_screening_record(jsonb_build_object('resident_id',(SELECT id FROM tr WHERE label=p_label),'admission_case_id',(SELECT admission FROM tr WHERE label=p_label),'source','admission','coverage',p_coverage,
  'q_property_non_primary',p_property,'q_income_over_limit','no','q_life_insurance','no','q_burial_contract','no','q_assets','no','q_power_of_attorney','no'),gen_random_uuid()) $$;
SELECT pg_temp.tassert(NOT has_function_privilege('authenticated','public.benefits_move_in_gate(uuid,text)','EXECUTE'),'staff can call the service gate');
SELECT pg_temp.tassert(NOT has_function_privilege('anon','public.benefits_move_in_gate(uuid,text)','EXECUTE'),'anonymous gate');
SELECT pg_temp.tlogin('owner'); SET LOCAL ROLE authenticated;
SELECT pg_temp.tscreen('likely','none','no');
SELECT pg_temp.tscreen('stopped','none','yes');
SELECT pg_temp.tscreen('mma','medicaid_mma','yes');
SELECT pg_temp.tscreen('enrolled','smmc_ltc_enrolled','no');
SELECT pg_temp.tscreen('reviewed','none','yes');
SELECT pg_temp.tscreen('overridden','none','yes');
RESET ROLE;
CREATE TEMP TABLE ts AS SELECT s.id FROM public.benefits_admission_screenings s JOIN tr ON tr.id=s.resident_id WHERE tr.label='reviewed';
GRANT ALL ON ts TO authenticated;
SET LOCAL ROLE authenticated;
SELECT public.benefits_screening_override((SELECT id FROM ts),'candidate','Property sold at closing; deed on file',gen_random_uuid());
RESET ROLE;
CREATE FUNCTION pg_temp.tgate(p_label text,p_payer text DEFAULT 'medicaid_pending') RETURNS jsonb LANGUAGE sql AS $$ SELECT public.benefits_move_in_gate((SELECT admission FROM tr WHERE label=p_label),p_payer) $$;
SET LOCAL ROLE service_role;
SELECT pg_temp.tassert((pg_temp.tgate('likely')->>'satisfied')::boolean AND (pg_temp.tgate('likely')->>'applies')::boolean,'likely to qualify passes');
SELECT pg_temp.tassert(NOT (pg_temp.tgate('stopped')->>'satisfied')::boolean AND pg_temp.tgate('stopped')->>'reason' LIKE 'Medicaid preliminary review%does not qualify now%','does-not-qualify blocks');
SELECT pg_temp.tassert(NOT (pg_temp.tgate('unasked')->>'satisfied')::boolean AND pg_temp.tgate('unasked')->>'reason' LIKE '%not been answered%','unanswered blocks');
SELECT pg_temp.tassert((pg_temp.tgate('unasked',NULL)->>'satisfied')::boolean AND NOT (pg_temp.tgate('unasked',NULL)->>'applies')::boolean,'not relying on Medicaid is not gated');
SELECT pg_temp.tassert(NOT (pg_temp.tgate('mma',NULL)->>'satisfied')::boolean,'MMA coverage applies the gate even without a Medicaid payer');
SELECT pg_temp.tassert((pg_temp.tgate('enrolled')->>'satisfied')::boolean AND NOT (pg_temp.tgate('enrolled')->>'applies')::boolean,'already enrolled is not gated');
SELECT pg_temp.tassert((pg_temp.tgate('private','private_pay')->>'satisfied')::boolean,'private pay passes');
SELECT pg_temp.tassert((pg_temp.tgate('reviewed')->>'satisfied')::boolean AND pg_temp.tgate('reviewed')->>'result'='candidate','reviewer override to likely passes');
RESET ROLE;
-- Executive override on the case: must be complete (reason, who, when), then satisfies the gate.
DO $$ BEGIN
 BEGIN UPDATE public.admission_cases SET medicaid_gate_override_reason='Only a reason' WHERE id=(SELECT admission FROM tr WHERE label='overridden'); RAISE EXCEPTION 'COL575 partial override accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE public.admission_cases SET medicaid_gate_override_reason='Family paying privately until the application is decided',medicaid_gate_override_by=(SELECT id FROM ta),medicaid_gate_override_at=now() WHERE id=(SELECT admission FROM tr WHERE label='overridden');
SET LOCAL ROLE service_role;
SELECT pg_temp.tassert((pg_temp.tgate('overridden')->>'satisfied')::boolean AND (pg_temp.tgate('overridden')->>'overridden')::boolean,'executive override passes');
DO $$ BEGIN PERFORM public.benefits_move_in_gate(gen_random_uuid(),'medicaid_pending'); RAISE EXCEPTION 'COL575 unknown admission answered'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
RESET ROLE;
ROLLBACK;
