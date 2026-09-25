-- Rollback-only synthetic proof for COL-769 (over-income trust prompt behind a setting; property look-back reminder).
BEGIN;
SET LOCAL TIME ZONE 'America/New_York';
CREATE TEMP TABLE tf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site;
CREATE TEMP TABLE tr AS SELECT label,gen_random_uuid() id FROM unnest(ARRAY['over','under','sold','stillowns']) label;
CREATE TEMP TABLE ta AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner']) role;
GRANT ALL ON tf,tr,ta TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL769 synthetic' FROM tf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL769 synthetic' FROM tf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL769 synthetic','Test','Test','00000',6,'America/New_York' FROM tf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col769.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM ta,tf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL769 '||role,id||'@col769.invalid',role::public.app_role,true FROM ta,tf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM ta;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM ta,tf;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT tr.id,org,site,'COL769',label,DATE '1940-01-01','female'::public.gender,'active'::public.resident_status FROM tr,tf;
CREATE FUNCTION pg_temp.tlogin() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT ta.*,p.auth_claim_version INTO a FROM ta JOIN public.user_profiles p USING(id); PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.tassert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL769 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.terror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
CREATE FUNCTION pg_temp.tscreen(p_label text,p_property text,p_income text,p_at timestamptz) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.benefits_screening_record(jsonb_build_object('resident_id',(SELECT id FROM tr WHERE label=p_label),'source','manual','coverage','none','answered_at',p_at,
  'q_property_non_primary',p_property,'q_income_over_limit',p_income,'q_life_insurance','no','q_burial_contract','no','q_assets','no','q_power_of_attorney','no'),gen_random_uuid()) $$;
CREATE FUNCTION pg_temp.tlist(p_kind text) RETURNS text[] LANGUAGE sql AS $$ SELECT coalesce(array_agg(tr.label ORDER BY tr.label),'{}') FROM jsonb_array_elements(public.benefits_prompts()->p_kind) x JOIN tr ON tr.id::text=x->>'resident_id' $$;

SELECT pg_temp.tlogin(); SET LOCAL ROLE authenticated;
SELECT pg_temp.tscreen('over','no','yes',now()-interval '1 day');
SELECT pg_temp.tscreen('under','no','no',now()-interval '1 day');
SELECT pg_temp.tscreen('sold','yes','no',now()-interval '100 days');
SELECT pg_temp.tscreen('sold','no','no',now()-interval '1 day');
SELECT pg_temp.tscreen('stillowns','yes','no',now()-interval '100 days');
SELECT pg_temp.tscreen('stillowns','yes','no',now()-interval '1 day');
-- Setting off (the default for a new organization): no trust prompt. The look-back reminder is always on.
SELECT pg_temp.tassert(pg_temp.tlist('over_income')='{}','trust prompt while off');
SELECT pg_temp.tassert(pg_temp.tlist('property_lookback')='{sold}','look-back only on a yes-to-no change');
SELECT public.benefits_rule_set(jsonb_build_object('rule_key','prompt.over_income','value',true,'effective_from',current_date,'reason','Synthetic: trust prompt on'));
SELECT pg_temp.terror($q$SELECT public.benefits_rule_set(jsonb_build_object('rule_key','prompt.over_income','value','yes','effective_from',current_date+1,'reason','bad'))$q$,'22023');
SELECT pg_temp.tassert(pg_temp.tlist('over_income')='{over}','trust prompt when on');
-- Informational only: the classification is unchanged.
RESET ROLE;
SELECT pg_temp.tassert((SELECT result FROM public.benefits_admission_screenings WHERE resident_id=(SELECT id FROM tr WHERE label='over'))='not_qualified_now','classification changed');
SELECT pg_temp.tassert(NOT EXISTS(SELECT 1 FROM public.benefits_cases WHERE resident_id=(SELECT id FROM tr WHERE label='over')),'a prompt opened a case');
SET LOCAL ROLE authenticated;
-- Set aside without a reason (recorded); the runway prompt still needs one.
SELECT public.benefits_prompt_dismiss((SELECT id FROM tr WHERE label='over'),'over_income',90,NULL,gen_random_uuid());
SELECT public.benefits_prompt_dismiss((SELECT id FROM tr WHERE label='sold'),'property_lookback',30,'Checked with the family',gen_random_uuid());
SELECT pg_temp.terror($q$SELECT public.benefits_prompt_dismiss((SELECT id FROM tr WHERE label='under'),'runway',30,'',gen_random_uuid())$q$,'22023');
SELECT pg_temp.tassert(pg_temp.tlist('over_income')='{}' AND pg_temp.tlist('property_lookback')='{}','dismissed prompts still shown');
RESET ROLE;
SELECT pg_temp.tassert((SELECT count(*) FROM public.benefits_prompt_dismissals WHERE organization_id=(SELECT org FROM tf) AND kind IN ('over_income','property_lookback'))=2,'dismissals recorded');
ROLLBACK;
