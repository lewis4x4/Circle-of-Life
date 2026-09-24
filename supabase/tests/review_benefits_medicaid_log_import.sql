-- Rollback-only synthetic proof for COL-773 (Medicaid Log import). Synthetic names only.
BEGIN;
CREATE TEMP TABLE lf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site,gen_random_uuid() actor,gen_random_uuid() session;
CREATE TEMP TABLE lr AS SELECT label,gen_random_uuid() id FROM unnest(ARRAY['waiting','funded']) label;
GRANT ALL ON lf,lr TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL773 synthetic' FROM lf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL773 synthetic' FROM lf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL773 synthetic','Test','Test','00000',4,'America/New_York' FROM lf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@col773.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{}'::jsonb FROM lf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT actor,org,'COL773 importer',actor||'@col773.invalid','owner'::public.app_role,true FROM lf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM lf;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT lr.id,org,site,'COL773',label,DATE '1940-01-01','female'::public.gender,'active'::public.resident_status FROM lr,lf;
CREATE FUNCTION pg_temp.lassert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL773 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.lerror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
CREATE FUNCTION pg_temp.lrow(p_label text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('import_key','synthetic:'||p_label,'organization_id',org,'resident_id',(SELECT id FROM lr WHERE label=p_label),'actor_id',actor) FROM lf $$;

SELECT pg_temp.lassert(NOT has_function_privilege('authenticated','public.benefits_log_import_row(jsonb)','EXECUTE'),'staff can import');
SET LOCAL ROLE service_role;
CREATE TEMP TABLE lx AS SELECT public.benefits_log_import_row(pg_temp.lrow('waiting')||'{"steps":{"intake_requested":"2026-07-27","intake_emailed":"2026-07-30","form_3008_requested":"2026-08-12","form_3008_returned":"2026-08-13"},"score":4,"reapply_on":"2026-10-30","caseworker_name":"Synthetic Worker","notes":"POA paperwork"}') reply;
SELECT pg_temp.lassert((SELECT (reply->>'records_added')::int FROM lx)=6,'records added (4 steps + score + note)');
SELECT pg_temp.lassert((SELECT (public.benefits_log_import_row(pg_temp.lrow('waiting')||'{"steps":{"intake_requested":"2026-07-27","intake_emailed":"2026-07-30","form_3008_requested":"2026-08-12","form_3008_returned":"2026-08-13"},"score":4,"reapply_on":"2026-10-30","caseworker_name":"Synthetic Worker","notes":"POA paperwork"}')->>'records_added')::int)=0,'re-run added records');
SELECT public.benefits_log_import_row(pg_temp.lrow('funded')||'{"steps":{"plan_enrolled":"2024-11-13"},"plan":"UHC","monthly_cents":160000,"coverage_start":"2024-11-13"}');
SELECT pg_temp.lerror($q$SELECT public.benefits_log_import_row(pg_temp.lrow('waiting')||'{"import_key":"x"}')$q$,'22023');
SELECT pg_temp.lerror($q$SELECT public.benefits_log_import_row(pg_temp.lrow('waiting')||jsonb_build_object('actor_id',gen_random_uuid()))$q$,'22023');
RESET ROLE;
-- The imported case reads correctly on the board.
CREATE FUNCTION pg_temp.llogin() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT lf.actor id,lf.session,p.auth_claim_version INTO a FROM lf JOIN public.user_profiles p ON p.id=lf.actor; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
SELECT pg_temp.llogin(); SET LOCAL ROLE authenticated;
CREATE TEMP TABLE lb AS SELECT x FROM jsonb_array_elements(public.benefits_board((SELECT site FROM lf))->'rows') x;
SELECT pg_temp.lassert((SELECT x->'step_dates'->>'form_3008_returned' FROM lb WHERE x->>'resident_id'=(SELECT id::text FROM lr WHERE label='waiting'))='2026-08-13','log date not on board');
SELECT pg_temp.lassert((SELECT (x->>'agency_score')::int FROM lb WHERE x->>'resident_id'=(SELECT id::text FROM lr WHERE label='waiting'))=4,'score not imported');
SELECT pg_temp.lassert((SELECT x->>'reapply_on' FROM lb WHERE x->>'resident_id'=(SELECT id::text FROM lr WHERE label='waiting'))='2026-10-30','reapply not imported');
SELECT pg_temp.lassert((SELECT x->>'caseworker_name' FROM lb WHERE x->>'resident_id'=(SELECT id::text FROM lr WHERE label='waiting'))='Synthetic Worker','caseworker not imported');
SELECT pg_temp.lassert((SELECT x->'step_dates'->>'plan_enrolled' FROM lb WHERE x->>'resident_id'=(SELECT id::text FROM lr WHERE label='funded'))='2024-11-13','funded plan date');
RESET ROLE;
ROLLBACK;
