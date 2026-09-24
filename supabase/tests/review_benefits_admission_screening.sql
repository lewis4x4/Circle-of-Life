-- Rollback-only synthetic proof for COL-763 (Medicaid admission questions). No actual resident data.
BEGIN;
CREATE TEMP TABLE sf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site,gen_random_uuid() other_site;
CREATE TEMP TABLE sr AS SELECT label,gen_random_uuid() id,CASE WHEN label='other' THEN 'other_site' ELSE 'site' END place FROM unnest(ARRAY['main','enrolled','assets','conflict','other']) label;
CREATE TEMP TABLE sa AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner','manager','caregiver']) role;
CREATE TEMP TABLE sx(label text PRIMARY KEY,reply jsonb);
GRANT ALL ON sf,sr,sa,sx TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL763 synthetic' FROM sf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL763 synthetic' FROM sf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL763 synthetic','Test','Test','00000',4,'America/New_York' FROM sf UNION ALL SELECT other_site,org,entity,'COL763 other','Test','Test','00000',2,'America/New_York' FROM sf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col763.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM sa,sf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL763 '||role,id||'@col763.invalid',role::public.app_role,true FROM sa,sf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM sa;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM sa,sf;
INSERT INTO public.staff(user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date) SELECT id,site,org,'COL763',role,'cna','active',current_date FROM sa,sf WHERE role<>'owner';
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender)
SELECT sr.id,org,CASE WHEN place='other_site' THEN other_site ELSE site END,'COL763',label,DATE '1940-01-01','female'::public.gender FROM sr,sf;
CREATE FUNCTION pg_temp.slogin(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT sa.*,p.auth_claim_version INTO a FROM sa JOIN public.user_profiles p USING(id) WHERE sa.role=p_role; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.sassert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL763 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.serror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
-- Answers default to no; each call overrides what the scenario needs.
CREATE FUNCTION pg_temp.sanswers(p_resident text,p_over jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('resident_id',(SELECT id FROM sr WHERE label=p_resident),'source','admission','coverage','private_pay',
  'q_property_non_primary','no','q_income_over_limit','no','q_life_insurance','no','q_burial_contract','no','q_assets','no','q_power_of_attorney','no','answered_by_kind','resident')||p_over; $$;

-- Posture: no direct table access, no anonymous or service impersonation.
SELECT pg_temp.sassert(NOT has_table_privilege('authenticated','public.benefits_admission_screenings','SELECT,INSERT,UPDATE,DELETE'),'direct screening grants');
SELECT pg_temp.sassert(NOT has_table_privilege('authenticated','public.benefits_rechecks','SELECT,INSERT,UPDATE,DELETE'),'direct recheck grants');
SELECT pg_temp.sassert(NOT has_function_privilege('anon','public.benefits_screening_record(jsonb,uuid)','EXECUTE'),'anonymous record');
SELECT pg_temp.sassert(NOT has_function_privilege('service_role','public.benefits_screening_record(jsonb,uuid)','EXECUTE'),'service impersonation');

-- Pure classification against the seeded owner rule.
CREATE TEMP TABLE sg AS SELECT haven.benefits_admission_gate_default() g;
SELECT pg_temp.sassert(haven.benefits_screening_classify('private_pay','{"q_property_non_primary":"no","q_income_over_limit":"no","q_assets":"no"}',NULL,NULL,g)->>'result'='candidate','all no is candidate') FROM sg;
SELECT pg_temp.sassert(haven.benefits_screening_classify('none','{"q_property_non_primary":"yes","q_income_over_limit":"no","q_assets":"no"}',NULL,NULL,g)->>'result'='not_qualified_now','property stops') FROM sg;
SELECT pg_temp.sassert(haven.benefits_screening_classify('none','{"q_property_non_primary":"no","q_income_over_limit":"unknown","q_assets":"no"}',NULL,NULL,g)->>'result'='needs_answers','unknown is not no') FROM sg;
SELECT pg_temp.sassert(haven.benefits_screening_classify('none','{"q_property_non_primary":"no","q_income_over_limit":"unknown","q_assets":"no"}',282901,NULL,g)->>'result'='not_qualified_now','amount over limit answers the income question') FROM sg;
SELECT pg_temp.sassert(haven.benefits_screening_classify('none','{"q_property_non_primary":"no","q_income_over_limit":"unknown","q_assets":"no"}',282900,NULL,g)->>'result'='candidate','amount at the limit is not over') FROM sg;
SELECT pg_temp.sassert(haven.benefits_screening_classify('none','{"q_property_non_primary":"no","q_income_over_limit":"no","q_assets":"no"}',300000,NULL,g)->>'result'='needs_answers','contradiction goes to a person') FROM sg;
SELECT pg_temp.sassert(haven.benefits_screening_classify('none','{"q_property_non_primary":"no","q_income_over_limit":"no","q_assets":"yes"}',NULL,NULL,g)->>'result'='needs_answers','assets without a balance') FROM sg;
SELECT pg_temp.sassert(haven.benefits_screening_classify('none','{"q_property_non_primary":"no","q_income_over_limit":"no","q_assets":"yes"}',NULL,200001,g)->>'result'='not_qualified_now','assets over the limit stop') FROM sg;
SELECT pg_temp.sassert(haven.benefits_screening_classify('none','{"q_property_non_primary":"no","q_income_over_limit":"no","q_assets":"yes"}',NULL,200000,g)->>'result'='candidate','assets at the limit continue') FROM sg;
SELECT pg_temp.sassert(haven.benefits_screening_classify('smmc_ltc_enrolled','{"q_property_non_primary":"yes"}',NULL,NULL,g)->>'result'='already_enrolled','enrolled is tracked, not screened') FROM sg;
SELECT pg_temp.sassert(haven.benefits_screening_classify('medicaid_mma','{"q_property_non_primary":"no","q_income_over_limit":"no","q_assets":"no"}',NULL,NULL,g)->>'result'='candidate','gold card is still a candidate') FROM sg;

-- Authority: a caregiver and an ungranted manager cannot record.
SELECT pg_temp.slogin('caregiver'); SET LOCAL ROLE authenticated;
SELECT pg_temp.serror($q$SELECT public.benefits_screening_record(pg_temp.sanswers('main'),gen_random_uuid())$q$,'42501');
RESET ROLE; SELECT pg_temp.slogin('manager'); SET LOCAL ROLE authenticated;
SELECT pg_temp.serror($q$SELECT public.benefits_screening_record(pg_temp.sanswers('main'),gen_random_uuid())$q$,'42501');
RESET ROLE; SELECT pg_temp.slogin('owner'); SET LOCAL ROLE authenticated;
SELECT public.benefits_access_set(jsonb_build_object('facility_id',site,'user_id',(SELECT id FROM sa WHERE role='manager'),'can_write',true,'can_review',false,'expires_at',now()+interval '1 day','reason','Synthetic grant')) FROM sf;
RESET ROLE; SELECT pg_temp.slogin('manager'); SET LOCAL ROLE authenticated;

-- Candidate: opens the case, marks the evidence the answers say exists, and replays identically.
INSERT INTO sx VALUES('candidate_req',jsonb_build_object('id',gen_random_uuid()));
INSERT INTO sx SELECT 'candidate',public.benefits_screening_record(pg_temp.sanswers('main','{"q_life_insurance":"yes","q_power_of_attorney":"yes","monthly_income_cents":150000}'),(SELECT (reply->>'id')::uuid FROM sx WHERE label='candidate_req'));
SELECT pg_temp.sassert((SELECT reply->>'result' FROM sx WHERE label='candidate')='candidate','candidate result');
SELECT pg_temp.sassert((SELECT reply->>'case_id' FROM sx WHERE label='candidate') IS NOT NULL,'candidate opened no case');
SELECT pg_temp.sassert(public.benefits_screening_record(pg_temp.sanswers('main','{"q_life_insurance":"yes","q_power_of_attorney":"yes","monthly_income_cents":150000}'),(SELECT (reply->>'id')::uuid FROM sx WHERE label='candidate_req'))=(SELECT reply FROM sx WHERE label='candidate'),'replay changed the result');
SELECT pg_temp.serror($q$SELECT public.benefits_screening_record(pg_temp.sanswers('main','{"q_life_insurance":"no"}'),(SELECT (reply->>'id')::uuid FROM sx WHERE label='candidate_req'))$q$,'23505');
SELECT pg_temp.sassert((SELECT count(*) FROM jsonb_array_elements(public.benefits_case_detail((SELECT (reply->>'case_id')::uuid FROM sx WHERE label='candidate'))->'requirements') r WHERE r->>'status'='requested')=2,'yes answers did not mark evidence requested');
SELECT pg_temp.sassert((public.benefits_case_detail((SELECT (reply->>'case_id')::uuid FROM sx WHERE label='candidate'))#>>'{case,screening,income_cents}')='150000','case screening facts not carried');
SELECT pg_temp.sassert((public.benefits_case_detail((SELECT (reply->>'case_id')::uuid FROM sx WHERE label='candidate'))#>>'{case,next_action}') LIKE 'Intake requested%','next action not set');

-- Does not qualify now: recheck 90 days out; a later candidate answer supersedes it and reuses the same case.
INSERT INTO sx SELECT 'stop',public.benefits_screening_record(pg_temp.sanswers('main','{"q_property_non_primary":"yes"}'),gen_random_uuid());
SELECT pg_temp.sassert((SELECT reply->>'result' FROM sx WHERE label='stop')='not_qualified_now','property did not stop');
SELECT pg_temp.sassert((SELECT (reply->>'recheck_due_on')::date FROM sx WHERE label='stop')=(now() AT TIME ZONE 'America/New_York')::date+90,'recheck not 90 days out');
SELECT pg_temp.sassert(public.benefits_screening_list((SELECT id FROM sr WHERE label='main'))->'open_recheck'->>'status'='open','open recheck not listed');
INSERT INTO sx SELECT 'again',public.benefits_screening_record(pg_temp.sanswers('main','{"source":"recheck"}'),gen_random_uuid());
SELECT pg_temp.sassert((SELECT reply->>'case_id' FROM sx WHERE label='again')=(SELECT reply->>'case_id' FROM sx WHERE label='candidate'),'candidate did not reuse the active case');
SELECT pg_temp.sassert(public.benefits_screening_list((SELECT id FROM sr WHERE label='main'))->'open_recheck' IS NULL OR jsonb_typeof(public.benefits_screening_list((SELECT id FROM sr WHERE label='main'))->'open_recheck')='null','changed recheck still open');
SELECT pg_temp.sassert(jsonb_array_length(public.benefits_screening_list((SELECT id FROM sr WHERE label='main'))->'screenings')=3,'history incomplete');

-- Assets over the limit stop; contradictions and unknowns wait for answers; enrolled opens nothing.
SELECT pg_temp.sassert(public.benefits_screening_record(pg_temp.sanswers('assets','{"q_assets":"yes","assets_cents":5000000}'),gen_random_uuid())->>'result'='not_qualified_now','assets did not stop');
SELECT pg_temp.sassert(public.benefits_screening_record(pg_temp.sanswers('conflict','{"monthly_income_cents":400000}'),gen_random_uuid())->>'result'='needs_answers','contradiction not held');
SELECT pg_temp.sassert(public.benefits_screening_record(pg_temp.sanswers('enrolled','{"coverage":"smmc_ltc_enrolled","coverage_plan":"Synthetic plan"}'),gen_random_uuid())->>'case_id' IS NULL,'enrolled resident opened a case');

-- Input discipline and facility scope.
SELECT pg_temp.serror($q$SELECT public.benefits_screening_record(pg_temp.sanswers('main','{"q_assets":"maybe"}'),gen_random_uuid())$q$,'22023');
SELECT pg_temp.serror($q$SELECT public.benefits_screening_record(pg_temp.sanswers('main','{"monthly_income_cents":-5}'),gen_random_uuid())$q$,'22023');
SELECT pg_temp.serror($q$SELECT public.benefits_screening_record(pg_temp.sanswers('main',jsonb_build_object('answered_at',now()+interval '1 day')),gen_random_uuid())$q$,'22023');
SELECT pg_temp.serror($q$SELECT public.benefits_screening_record(pg_temp.sanswers('main','{"extra":"field"}'),gen_random_uuid())$q$,'22023');
SELECT pg_temp.serror($q$SELECT public.benefits_screening_record(pg_temp.sanswers('other'),gen_random_uuid())$q$,'42501');
SELECT pg_temp.serror($q$SELECT public.benefits_screening_list((SELECT id FROM sr WHERE label='other'))$q$,'42501');

-- Overrides need review authority, a reason, and the latest answers.
SELECT pg_temp.serror($q$SELECT public.benefits_screening_override((SELECT (reply->>'screening_id')::uuid FROM sx WHERE label='again'),'not_qualified_now','Synthetic reason',gen_random_uuid())$q$,'42501');
RESET ROLE; SELECT pg_temp.slogin('owner'); SET LOCAL ROLE authenticated;
SELECT pg_temp.serror($q$SELECT public.benefits_screening_override((SELECT (reply->>'screening_id')::uuid FROM sx WHERE label='again'),'not_qualified_now','  ',gen_random_uuid())$q$,'22023');
SELECT pg_temp.serror($q$SELECT public.benefits_screening_override((SELECT (reply->>'screening_id')::uuid FROM sx WHERE label='stop'),'candidate','Synthetic reason',gen_random_uuid())$q$,'22023');
INSERT INTO sx SELECT 'override',public.benefits_screening_override((SELECT (reply->>'screening_id')::uuid FROM sx WHERE label='again'),'not_qualified_now','Synthetic: property sale pending',gen_random_uuid());
SELECT pg_temp.sassert((SELECT reply->>'recheck_due_on' FROM sx WHERE label='override') IS NOT NULL,'override did not schedule a recheck');
SELECT pg_temp.sassert(public.benefits_screening_list((SELECT id FROM sr WHERE label='main'))->'screenings'->0->'override'->>'reason'='Synthetic: property sale pending','override not listed');

-- Effective-dated rule: a stricter limit that starts tomorrow does not change today's answers.
RESET ROLE;
INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT org,'screening.admission_gate',jsonb_build_object('disqualify',jsonb_build_array('q_income_over_limit'),'income_limit_cents',100,'assets_limit_cents',100),current_date+1,'Synthetic future rule' FROM sf;
SELECT pg_temp.slogin('owner'); SET LOCAL ROLE authenticated;
SELECT pg_temp.sassert(public.benefits_screening_record(pg_temp.sanswers('conflict','{"monthly_income_cents":150000,"q_income_over_limit":"unknown"}'),gen_random_uuid())->>'result'='candidate','future rule applied to today');
SELECT pg_temp.serror($q$SELECT public.benefits_rule_set(jsonb_build_object('rule_key','screening.admission_gate','value',jsonb_build_object('disqualify',jsonb_build_array('q_unknown'),'income_limit_cents',1,'assets_limit_cents',1),'effective_from',current_date,'reason','bad'))$q$,'22023');
SELECT pg_temp.sassert((SELECT count(*) FROM jsonb_array_elements(public.benefits_rules_list()->'rules') x WHERE x->>'rule_key' IN ('screening.admission_gate','screening.recheck_days'))=2,'new rules not listed');

-- Answer sets are the record: nobody rewrites them.
RESET ROLE;
SELECT pg_temp.serror($q$UPDATE public.benefits_admission_screenings SET result='candidate'$q$,'55000');
SELECT pg_temp.serror($q$DELETE FROM public.benefits_screening_overrides$q$,'55000');
ROLLBACK;
