-- Rollback-only synthetic proof for COL-771 (forwarded agency letters). No actual resident data or mail.
BEGIN;
CREATE TEMP TABLE mf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site,gen_random_uuid() other_site;
CREATE TEMP TABLE mr AS SELECT label,gen_random_uuid() id,fn,ln FROM (VALUES ('ann','Zelda','Quartermaine'),('bob','Yorick','Pemberton')) v(label,fn,ln);
CREATE TEMP TABLE ma AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner','caregiver']) role;
CREATE TEMP TABLE mx(label text PRIMARY KEY,reply jsonb);
GRANT ALL ON mf,mr,ma,mx TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL771 synthetic' FROM mf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL771 synthetic' FROM mf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL771 synthetic','Test','Test','00000',4,'America/New_York' FROM mf UNION ALL SELECT other_site,org,entity,'COL771 other','Test','Test','00000',2,'America/New_York' FROM mf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col771.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM ma,mf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL771 '||role,id||'@col771.invalid',role::public.app_role,true FROM ma,mf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM ma;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM ma,mf;
INSERT INTO public.staff(user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date) SELECT id,site,org,'COL771',role,'cna','active',current_date FROM ma,mf WHERE role<>'owner';
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT mr.id,org,site,fn,ln,DATE '1940-01-01','female'::public.gender,'active'::public.resident_status FROM mr,mf;
CREATE FUNCTION pg_temp.mlogin(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT ma.*,p.auth_claim_version INTO a FROM ma JOIN public.user_profiles p USING(id) WHERE ma.role=p_role; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.massert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL771 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.merror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
CREATE FUNCTION pg_temp.mitem(p_subject text) RETURNS jsonb LANGUAGE sql AS $$ SELECT x FROM jsonb_array_elements(public.benefits_mail_list((SELECT site FROM mf))->'items') x WHERE x->>'subject'=p_subject $$;

-- Pure extraction.
SELECT pg_temp.massert(haven.inbound_mail_parse_date('Notice date: 09/12/2026')=DATE '2026-09-12','numeric date');
SELECT pg_temp.massert(haven.inbound_mail_parse_date('dated September 3, 2026')=DATE '2026-09-03','long date');
SELECT pg_temp.massert(haven.inbound_mail_parse_date('13/45/2026') IS NULL,'impossible date parsed');
SELECT pg_temp.massert((haven.inbound_mail_extract('Pending verification','Department of Children and Families. Notice date: 09/12/2026. Please return the requested items by 10/02/2026.')->>'due_on')::date=DATE '2026-10-02','deadline');
SELECT pg_temp.massert(haven.inbound_mail_extract('x','Department of Children and Families')->>'agency'='dcf','agency');

-- Posture: staff cannot record mail; only the service webhook can.
SELECT pg_temp.massert(NOT has_function_privilege('authenticated','public.inbound_mail_record(jsonb)','EXECUTE'),'staff can record mail');
SELECT pg_temp.massert(has_function_privilege('service_role','public.inbound_mail_record(jsonb)','EXECUTE'),'service cannot record mail');
SELECT pg_temp.massert(NOT has_table_privilege('authenticated','public.inbound_mail_messages','SELECT'),'direct mail read');

-- Owner registers the facility inbox and opens two cases.
SELECT pg_temp.mlogin('owner'); SET LOCAL ROLE authenticated;
SELECT public.inbound_mail_inbox_register(jsonb_build_object('facility_id',site,'purpose','medicaid_agency','provider_inbox_id','synthetic-inbox-1','email','synthetic-medicaid@example.invalid')) FROM mf;
INSERT INTO mx SELECT 'case_'||label,public.benefits_case_create(id,NULL,'smmc_ltc',gen_random_uuid()) FROM mr;
RESET ROLE;

-- Webhook deliveries (service role).
SET LOCAL ROLE service_role;
SELECT pg_temp.massert(public.inbound_mail_record('{"provider_inbox_id":"not-ours","provider_message_id":"m0"}')->>'reason'='unknown_inbox','unknown inbox recorded');
INSERT INTO mx SELECT 'by_name',public.inbound_mail_record(jsonb_build_object('provider_inbox_id','synthetic-inbox-1','provider_message_id','m1','from','dcf@example.invalid','to',jsonb_build_array('synthetic-medicaid@example.invalid'),
 'subject','Pending verification','text','Re: Zelda Quartermaine. Department of Children and Families. Notice date: 09/12/2026. Return the items by 10/02/2026.',
 'attachments',jsonb_build_array(jsonb_build_object('filename','letter.pdf','content_type','application/pdf','size_bytes',10,'sha256',repeat('a',64),'storage_path','synthetic/m1/letter.pdf','status','stored')))) FROM mf;
SELECT pg_temp.massert((SELECT (reply->>'matched')::boolean FROM mx WHERE label='by_name'),'name match failed');
SELECT pg_temp.massert(public.inbound_mail_record('{"provider_inbox_id":"synthetic-inbox-1","provider_message_id":"m1"}')->>'reason'='duplicate','duplicate delivery recorded twice');
SELECT public.inbound_mail_record(jsonb_build_object('provider_inbox_id','synthetic-inbox-1','provider_message_id','m2','to',jsonb_build_array('synthetic-medicaid+'||left((SELECT reply->>'case_id' FROM mx WHERE label='case_bob'),8)||'@example.invalid'),'subject','CARES appointment','text','CARES will visit.'));
SELECT public.inbound_mail_record(jsonb_build_object('provider_inbox_id','synthetic-inbox-1','provider_message_id','m3','subject','Unknown letter','text','No names here.'));
RESET ROLE;

SELECT pg_temp.mlogin('owner'); SET LOCAL ROLE authenticated;
SELECT pg_temp.massert(pg_temp.mitem('Pending verification')->>'status'='proposed' AND pg_temp.mitem('Pending verification')->>'match_basis'='resident_name','name proposal');
SELECT pg_temp.massert((pg_temp.mitem('Pending verification')->>'proposed_due_on')::date=DATE '2026-10-02' AND pg_temp.mitem('Pending verification')->>'proposed_agency'='dcf','extracted proposal');
SELECT pg_temp.massert(pg_temp.mitem('CARES appointment')->>'match_basis'='case_address','plus-address match');
SELECT pg_temp.massert(pg_temp.mitem('Unknown letter')->>'status'='unmatched','unmatched tray');
SELECT pg_temp.massert(jsonb_array_length(pg_temp.mitem('Pending verification')->'attachments')=1,'attachment listed');
-- Nothing is recorded on the case until confirmed.
SELECT pg_temp.massert(jsonb_array_length(public.benefits_case_detail((SELECT (reply->>'case_id')::uuid FROM mx WHERE label='case_ann'))->'events')=0,'mail recorded before confirmation');
SELECT pg_temp.merror($q$SELECT public.benefits_mail_confirm((pg_temp.mitem('Pending verification')->>'id')::uuid,jsonb_build_object('case_id',(SELECT reply->>'case_id' FROM mx WHERE label='case_ann'),'agency','dcf','event_type','correspondence','outcome','Pending verification','letter_date',current_date+5),gen_random_uuid())$q$,'22023');
INSERT INTO mx SELECT 'confirm',public.benefits_mail_confirm((pg_temp.mitem('Pending verification')->>'id')::uuid,jsonb_build_object('case_id',(SELECT reply->>'case_id' FROM mx WHERE label='case_ann'),'agency','dcf','event_type','correspondence','outcome','Pending verification','letter_date','2026-09-12','due_on','2026-10-02'),gen_random_uuid());
SELECT pg_temp.massert((public.benefits_case_detail((SELECT (reply->>'case_id')::uuid FROM mx WHERE label='case_ann'))#>>'{case,due_date}')='2026-10-02','deadline not on case');
SELECT pg_temp.massert((public.benefits_case_detail((SELECT (reply->>'case_id')::uuid FROM mx WHERE label='case_ann'))#>>'{case,next_action}') LIKE 'Respond to the DCF letter by 2026-10-02%','next action');
SELECT pg_temp.massert(pg_temp.mitem('Pending verification') IS NULL,'confirmed item still open');
SELECT pg_temp.merror($q$SELECT public.benefits_mail_dismiss((pg_temp.mitem('Unknown letter')->>'id')::uuid,'  ',gen_random_uuid())$q$,'22023');
SELECT public.benefits_mail_dismiss((pg_temp.mitem('Unknown letter')->>'id')::uuid,'Advertisement',gen_random_uuid());
SELECT pg_temp.massert(pg_temp.mitem('Unknown letter') IS NULL,'dismissed item still open');
RESET ROLE; SELECT pg_temp.mlogin('caregiver'); SET LOCAL ROLE authenticated;
SELECT pg_temp.merror($q$SELECT public.benefits_mail_list((SELECT site FROM mf))$q$,'42501');
SELECT pg_temp.merror($q$SELECT public.inbound_mail_inbox_register('{"purpose":"medicaid_agency","provider_inbox_id":"x","email":"a@b.c"}')$q$,'42501');
RESET ROLE;
SELECT pg_temp.merror($q$UPDATE public.inbound_mail_messages SET subject='rewritten'$q$,'55000');
ROLLBACK;
