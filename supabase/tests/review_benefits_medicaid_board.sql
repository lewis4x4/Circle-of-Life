-- Rollback-only synthetic proof for COL-767 (facility Medicaid board). No actual resident data.
BEGIN;
-- Rules compare against the session date; pin it to Eastern so the probe also passes 8 p.m.–midnight ET (UTC is already tomorrow).
SET LOCAL TIME ZONE 'America/New_York';
CREATE TEMP TABLE bdf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site,gen_random_uuid() other_site;
CREATE TEMP TABLE bdr AS SELECT label,gen_random_uuid() id FROM unnest(ARRAY['one','two']) label;
CREATE TEMP TABLE bda AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner','manager','caregiver']) role;
CREATE TEMP TABLE bdx(label text PRIMARY KEY,reply jsonb);
GRANT ALL ON bdf,bdr,bda,bdx TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL767 synthetic' FROM bdf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL767 synthetic' FROM bdf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL767 synthetic','Test','Test','00000',4,'America/New_York' FROM bdf UNION ALL SELECT other_site,org,entity,'COL767 other','Test','Test','00000',2,'America/New_York' FROM bdf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col767.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM bda,bdf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL767 '||role,id||'@col767.invalid',role::public.app_role,true FROM bda,bdf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM bda;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM bda,bdf;
INSERT INTO public.staff(user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date) SELECT id,site,org,'COL767',role,'cna','active',current_date FROM bda,bdf WHERE role<>'owner';
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT bdr.id,org,site,'COL767',label,DATE '1940-01-01','female'::public.gender,'active'::public.resident_status FROM bdr,bdf;
CREATE FUNCTION pg_temp.dlogin(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT bda.*,p.auth_claim_version INTO a FROM bda JOIN public.user_profiles p USING(id) WHERE bda.role=p_role; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.dassert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL767 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.derror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
CREATE FUNCTION pg_temp.drow(p_label text) RETURNS jsonb LANGUAGE sql AS $$ SELECT x FROM jsonb_array_elements(public.benefits_board((SELECT site FROM bdf))->'rows') x WHERE x->>'resident_id'=(SELECT id::text FROM bdr WHERE label=p_label) $$;
CREATE FUNCTION pg_temp.dcmd(p_label text,p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.benefits_board_command((pg_temp.drow(p_label)->>'case_id')::uuid,p_action,p_payload,(pg_temp.drow(p_label)->>'revision')::integer,gen_random_uuid()) $$;

SELECT pg_temp.dassert(NOT has_table_privilege('authenticated','public.benefits_contacts','SELECT,INSERT'),'direct contact grants');
SELECT pg_temp.dassert(NOT has_function_privilege('anon','public.benefits_board(uuid)','EXECUTE'),'anonymous board');
SELECT pg_temp.dlogin('owner'); SET LOCAL ROLE authenticated;
SELECT public.benefits_case_create(id,NULL,'smmc_ltc',gen_random_uuid()) FROM bdr;
SELECT pg_temp.dassert(jsonb_array_length(public.benefits_board((SELECT site FROM bdf))->'rows')=2,'board rows');
SELECT pg_temp.dassert(jsonb_array_length(public.benefits_board((SELECT site FROM bdf))->'steps')=13,'board steps');
SELECT pg_temp.dassert(pg_temp.drow('one')->>'next_step'='intake_requested','first next step');
-- Seeded UHC rate gives dollars not yet collected; an unknown plan gives none (never zero).
SELECT pg_temp.dassert(pg_temp.drow('one')->>'plan_rate_cents' IS NULL AND pg_temp.drow('one')->>'revenue_not_collected_cents' IS NULL,'no rate must stay unknown, never zero');
SELECT public.benefits_rule_set(jsonb_build_object('rule_key','plan.rates','value',jsonb_build_array(jsonb_build_object('plan','UHC','monthly_cents',160000)),'effective_from',(now() AT TIME ZONE 'America/New_York')::date,'reason','Synthetic rate'));
SELECT pg_temp.derror($q$SELECT public.benefits_rule_set(jsonb_build_object('rule_key','plan.rates','value','[{"plan":"UHC","monthly_cents":-1}]'::jsonb,'effective_from',(now() AT TIME ZONE 'America/New_York')::date+1,'reason','bad'))$q$,'22023');
SELECT pg_temp.dassert((pg_temp.drow('one')->>'plan_rate_cents')::int=160000,'plan rate from rule');
SELECT pg_temp.dcmd('one','record_step',jsonb_build_object('step','intake_requested','occurred_on',(now() AT TIME ZONE 'America/New_York')::date-30));
SELECT pg_temp.dassert((pg_temp.drow('one')->>'revenue_not_collected_cents')::bigint=160000,'30 days at $1,600 a month');
SELECT pg_temp.dassert(pg_temp.drow('one')->'step_dates'->>'intake_requested'=((now() AT TIME ZONE 'America/New_York')::date-30)::text,'step date not recorded');
SELECT pg_temp.dassert((pg_temp.drow('one')->>'stalled')::boolean,'30-day-old step not stalled');
SELECT pg_temp.derror($q$SELECT pg_temp.dcmd('one','record_step',jsonb_build_object('step','intake_emailed','occurred_on',(now() AT TIME ZONE 'America/New_York')::date+1))$q$,'22023');
SELECT pg_temp.derror($q$SELECT pg_temp.dcmd('one','record_step','{"step":"made_up"}')$q$,'22023');
SELECT pg_temp.derror($q$SELECT pg_temp.dcmd('one','record_step','{"step":"dcf_decision","outcome":"Maybe"}')$q$,'22023');
-- Score below 5 waits and sets the reapply date; 5 moves forward.
SELECT pg_temp.dcmd('two','record_score','{"score":4}');
SELECT pg_temp.dassert((pg_temp.drow('two')->>'reapply_on')::date=(now() AT TIME ZONE 'America/New_York')::date+30,'reapply not 30 days out');
SELECT pg_temp.dassert(pg_temp.drow('two')->>'status'='waiting','score 4 not waiting');
SELECT pg_temp.derror($q$SELECT pg_temp.dcmd('two','record_score','{"score":6}')$q$,'22023');
SELECT pg_temp.dcmd('two','record_score','{"score":5}');
SELECT pg_temp.dassert(pg_temp.drow('two')->>'reapply_on' IS NULL AND (pg_temp.drow('two')->>'agency_score')::int=5,'score 5 did not move forward');
SELECT pg_temp.dassert(pg_temp.drow('two')->>'next_action' LIKE 'Score 5%','score 5 next action');
-- Caseworker from the contacts list.
INSERT INTO bdx SELECT 'contact',public.benefits_contact_save('{"name":"Synthetic Caseworker","agency":"dcf","phone":"000-000-0000"}');
SELECT pg_temp.dcmd('one','set_caseworker',jsonb_build_object('contact_id',(SELECT reply->>'id' FROM bdx WHERE label='contact')));
SELECT pg_temp.dassert(pg_temp.drow('one')->>'caseworker_name'='Synthetic Caseworker','caseworker not set');
-- Board events show in the case history without breaking it.
SELECT pg_temp.dassert(jsonb_array_length(public.benefits_case_detail((pg_temp.drow('one')->>'case_id')::uuid)->'events')>=1,'board event missing from case');
-- Stale revision and replay discipline.
SELECT pg_temp.derror($q$SELECT public.benefits_board_command((pg_temp.drow('one')->>'case_id')::uuid,'record_step','{"step":"intake_emailed"}',1,gen_random_uuid())$q$,'P0409');
RESET ROLE; SELECT pg_temp.dlogin('caregiver'); SET LOCAL ROLE authenticated;
SELECT pg_temp.derror($q$SELECT public.benefits_board((SELECT site FROM bdf))$q$,'42501');
RESET ROLE; SELECT pg_temp.dlogin('manager'); SET LOCAL ROLE authenticated;
SELECT pg_temp.derror($q$SELECT public.benefits_board((SELECT other_site FROM bdf))$q$,'42501');
SELECT pg_temp.derror($q$SELECT public.benefits_contact_save('{"name":"Nope","agency":"dcf"}')$q$,'42501');
RESET ROLE;
ROLLBACK;
