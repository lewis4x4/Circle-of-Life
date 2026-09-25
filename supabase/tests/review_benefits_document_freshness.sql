-- Rollback-only synthetic proof for COL-768 (document good-for periods, reopen to gather, family path, board badge).
BEGIN;
SET LOCAL TIME ZONE 'America/New_York';
CREATE TEMP TABLE ff AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site;
CREATE TEMP TABLE fr AS SELECT label,gen_random_uuid() id FROM unnest(ARRAY['fam','nofam']) label;
CREATE TEMP TABLE fa AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner','manager','family']) role;
CREATE TEMP TABLE fq(label text PRIMARY KEY,id uuid);
GRANT ALL ON ff,fr,fa,fq TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL768 synthetic' FROM ff;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL768 synthetic' FROM ff;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL768 synthetic','Test','Test','00000',4,'America/New_York' FROM ff;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col768.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM fa,ff;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL768 '||role,id||'@col768.invalid',role::public.app_role,true FROM fa,ff ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM fa;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM fa,ff WHERE role<>'family';
INSERT INTO public.staff(user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date) SELECT id,site,org,'COL768',role,'cna','active',current_date FROM fa,ff WHERE role='manager';
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT fr.id,org,site,'COL768',label,DATE '1940-01-01','female'::public.gender,'active'::public.resident_status FROM fr,ff;
INSERT INTO public.family_resident_links(user_id,resident_id,organization_id,relationship,can_view_financial,can_make_decisions) SELECT fa.id,fr.id,org,'child',true,false FROM fa,fr,ff WHERE fa.role='family' AND fr.label='fam';
CREATE FUNCTION pg_temp.flogin(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT fa.*,p.auth_claim_version INTO a FROM fa JOIN public.user_profiles p USING(id) WHERE fa.role=p_role; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.fassert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL768 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.ferror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
CREATE FUNCTION pg_temp.fcase(p_label text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT c.id FROM public.benefits_cases c JOIN fr ON fr.id=c.resident_id WHERE fr.label=p_label $$;
CREATE FUNCTION pg_temp.fitem(p_label text) RETURNS jsonb LANGUAGE sql AS $$ SELECT x FROM jsonb_array_elements(public.benefits_document_freshness(pg_temp.fcase('fam'))->'items') x WHERE x->>'requirement_id'=(SELECT id::text FROM fq WHERE label=p_label) $$;
CREATE FUNCTION pg_temp.freopen(p_label text) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.benefits_freshness_reopen(pg_temp.fcase('fam'),(SELECT id FROM fq WHERE label=p_label),(public.benefits_document_freshness(pg_temp.fcase('fam'))->>'revision')::integer,gen_random_uuid()) $$;

SELECT pg_temp.fassert(NOT has_function_privilege('anon','public.benefits_document_freshness(uuid)','EXECUTE'),'anonymous freshness');
SELECT pg_temp.flogin('owner'); SET LOCAL ROLE authenticated;
SELECT public.benefits_case_create(id,NULL,'smmc_ltc',gen_random_uuid()) FROM fr;
SELECT public.benefits_access_set(jsonb_build_object('facility_id',site,'user_id',(SELECT id FROM fa WHERE role='manager'),'can_write',true,'can_review',false,'expires_at',now()+interval '1 day','reason','Synthetic write grant')) FROM ff;
SELECT pg_temp.ferror($q$SELECT public.benefits_rule_set(jsonb_build_object('rule_key','document.valid_days','value','[{"match":"x","days":0}]'::jsonb,'effective_from',current_date+1,'reason','bad'))$q$,'22023');
RESET ROLE;
-- Accepted evidence fixtures (document rows are not the subject here).
INSERT INTO fq VALUES('old',gen_random_uuid()),('near',gen_random_uuid()),('recent',gen_random_uuid()),('forever',gen_random_uuid()),('open',gen_random_uuid());
SET LOCAL session_replication_role=replica;
INSERT INTO public.benefits_documents(id,case_id,filename,mime_type,size_bytes,sha256,storage_path,status,document_type,created_by)
SELECT fq.id,pg_temp.fcase('fam'),'synthetic.pdf','application/pdf',12,repeat('a',64),'col768/'||fq.id,'ready','bank_statement',(SELECT id FROM fa WHERE role='owner') FROM fq;
INSERT INTO public.benefits_requirements(id,case_id,title,stage,status,document_id,signature_status,reviewed_by,reviewed_at)
SELECT fq.id,pg_temp.fcase('fam'),t.title,'application',t.status,fq.id,'not_required',CASE WHEN t.status='accepted' THEN (SELECT id FROM fa WHERE role='owner') END,CASE WHEN t.status='accepted' THEN now()-(t.age||' days')::interval END
FROM fq JOIN (VALUES('old','Bank statements (3 months)','accepted',100),('near','Bank statement - checking','accepted',80),('recent','Bank Statement savings','accepted',10),('forever','Birth certificate','accepted',400),('open','Bank statement - other','requested',0)) t(label,title,status,age) USING(label);
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.fassert(pg_temp.fitem('old')->>'freshness'='expired' AND (pg_temp.fitem('old')->>'valid_days')::int=90,'100-day-old statement expired');
SELECT pg_temp.fassert(pg_temp.fitem('near')->>'freshness'='expiring' AND (pg_temp.fitem('near')->>'days_left')::int=10,'80-day-old statement expiring');
SELECT pg_temp.fassert(pg_temp.fitem('recent')->>'freshness'='fresh','10-day-old statement fresh');
SELECT pg_temp.fassert(pg_temp.fitem('forever') IS NULL AND pg_temp.fitem('open') IS NULL,'no period or not accepted must not be listed');
SELECT pg_temp.fassert((public.benefits_document_freshness(pg_temp.fcase('fam'))->>'family_can_collect')::boolean,'family with financial access');
SELECT pg_temp.fassert(NOT (public.benefits_document_freshness(pg_temp.fcase('nofam'))->>'family_can_collect')::boolean,'no linked family');
SELECT pg_temp.fassert((SELECT (x->>'documents_expiring')::int FROM jsonb_array_elements(public.benefits_board((SELECT site FROM ff))->'rows') x WHERE x->>'case_id'=pg_temp.fcase('fam')::text)=2,'board badge count');
SELECT pg_temp.fassert((SELECT (x->>'documents_expiring')::int FROM jsonb_array_elements(public.benefits_board((SELECT site FROM ff))->'rows') x WHERE x->>'case_id'=pg_temp.fcase('nofam')::text)=0,'no badge without periods');
RESET ROLE;
-- The period is the one in force on the day a document was accepted: a 30-day rule from 85 days ago governs the
-- statements accepted after it, not the one accepted before it.
INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason) SELECT org,'document.valid_days','[{"match":"bank statement","days":30}]'::jsonb,current_date-85,'Synthetic earlier rule' FROM ff;
SET LOCAL ROLE authenticated;
SELECT pg_temp.fassert((pg_temp.fitem('old')->>'valid_days')::int=90 AND pg_temp.fitem('near')->>'freshness'='expired' AND (pg_temp.fitem('recent')->>'days_left')::int=20,'rule effective date');
RESET ROLE;
-- Reopen: only expiring/expired; a write-only grantee may do it; the family can then be asked.
SELECT pg_temp.flogin('manager'); SET LOCAL ROLE authenticated;
SELECT pg_temp.ferror($q$SELECT pg_temp.freopen('recent')$q$,'22023');
SELECT pg_temp.freopen('near');
RESET ROLE;
SELECT pg_temp.fassert((SELECT status='requested' AND reviewed_at IS NULL AND notes LIKE 'The accepted copy expired on %Facility administrator to gather a current copy.' FROM public.benefits_requirements WHERE id=(SELECT id FROM fq WHERE label='near')),'reopened for the facility administrator');
SELECT pg_temp.fassert(EXISTS(SELECT 1 FROM public.benefits_history WHERE case_id=pg_temp.fcase('fam') AND action='freshness_reopen' AND payload->>'requirement_id'=(SELECT id::text FROM fq WHERE label='near')),'reopen history');
SELECT pg_temp.flogin('owner'); SET LOCAL ROLE authenticated;
SELECT pg_temp.fassert(pg_temp.fitem('near') IS NULL,'reopened item still listed as accepted');
SELECT public.benefits_collection_command(pg_temp.fcase('fam'),'assign',jsonb_build_object('requirement_id',(SELECT id FROM fq WHERE label='near'),'family_user_id',(SELECT id FROM fa WHERE role='family'),'expires_at',now()+interval '7 days'),(public.benefits_document_freshness(pg_temp.fcase('fam'))->>'revision')::integer,gen_random_uuid());
RESET ROLE;
ROLLBACK;
