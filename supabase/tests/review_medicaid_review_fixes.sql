-- Rollback-only synthetic proof for the #919 review fixes (migration 558). No actual resident data.
BEGIN;
SET LOCAL TIME ZONE 'America/New_York';
CREATE TEMP TABLE vf AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site;
CREATE TEMP TABLE vr AS SELECT label,gen_random_uuid() id,gen_random_uuid() admission FROM unnest(ARRAY['spend','forged','imported']) label;
CREATE TEMP TABLE va AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner','facility_admin','med_tech']) role;
CREATE TEMP TABLE vq(label text PRIMARY KEY,id uuid);
GRANT ALL ON vf,vr,va,vq TO authenticated,service_role;
-- Hosted Supabase grants table privileges to authenticated (RLS decides rows); mirror that so the probe tests the real path.
GRANT SELECT,UPDATE ON public.admission_cases TO authenticated;
INSERT INTO public.organizations(id,name) SELECT org,'Review fixes synthetic' FROM vf;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'Review fixes synthetic' FROM vf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'Review fixes synthetic','Test','Test','00000',4,'America/New_York' FROM vf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@fixes.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM va,vf;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'Fixes '||role,id||'@fixes.invalid',role::public.app_role,true FROM va,vf ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM va;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM va,vf;
INSERT INTO public.staff(user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date) SELECT id,site,org,'Fixes',role,'cna','active',current_date FROM va,vf WHERE role<>'owner';
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT vr.id,org,site,'Fixes',label,DATE '1940-01-01','female'::public.gender,'active'::public.resident_status FROM vr,vf;
INSERT INTO public.admission_cases(id,organization_id,facility_id,resident_id,anticipated_payer_source) SELECT admission,org,site,vr.id,'medicaid_pending'::public.anticipated_payer_source FROM vr,vf;
CREATE FUNCTION pg_temp.vlogin(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record; BEGIN SELECT va.*,p.auth_claim_version INTO a FROM va JOIN public.user_profiles p USING(id) WHERE va.role=p_role; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true); END $$;
CREATE FUNCTION pg_temp.vassert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FIXES %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.verror(stmt text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected denial %: %',expected,stmt; END $$;
CREATE FUNCTION pg_temp.vgate(p_label text) RETURNS jsonb LANGUAGE sql AS $$ SELECT haven.benefits_move_in_gate_internal((SELECT admission FROM vr WHERE label=p_label),'medicaid_pending') $$;

-- 2. Spend-down: private pay today, expected Medicaid payer, answers that do not show likely to qualify: gated.
SELECT pg_temp.vlogin('owner'); SET LOCAL ROLE authenticated;
SELECT public.benefits_screening_record(jsonb_build_object('resident_id',id,'source','admission','coverage','private_pay','q_property_non_primary','yes','q_income_over_limit','no',
 'q_life_insurance','no','q_burial_contract','no','q_assets','no','q_power_of_attorney','no'),gen_random_uuid()) FROM vr WHERE label IN ('spend','forged');
RESET ROLE;
SELECT pg_temp.vassert((pg_temp.vgate('spend')->>'applies')::boolean AND NOT (pg_temp.vgate('spend')->>'satisfied')::boolean,'spend-down resident not gated');

-- 1. A med_tech cannot forge the override through the table, not even naming an executive.
SELECT pg_temp.vlogin('med_tech'); SET LOCAL ROLE authenticated;
SELECT pg_temp.verror($q$UPDATE public.admission_cases SET medicaid_gate_override_reason='Forged',medicaid_gate_override_by=(SELECT id FROM va WHERE role='owner'),medicaid_gate_override_at=now() WHERE id=(SELECT admission FROM vr WHERE label='forged')$q$,'42501');
RESET ROLE;
-- An executive signed in can record only their own override, and the time is the database's.
SELECT pg_temp.vlogin('facility_admin'); SET LOCAL ROLE authenticated;
SELECT pg_temp.verror($q$UPDATE public.admission_cases SET medicaid_gate_override_reason='Naming someone else',medicaid_gate_override_by=(SELECT id FROM va WHERE role='owner'),medicaid_gate_override_at=now() WHERE id=(SELECT admission FROM vr WHERE label='forged')$q$,'42501');
UPDATE public.admission_cases SET medicaid_gate_override_reason='Paying privately until decided',medicaid_gate_override_by=(SELECT id FROM va WHERE role='facility_admin'),medicaid_gate_override_at=TIMESTAMPTZ '2020-01-01' WHERE id=(SELECT admission FROM vr WHERE label='forged');
RESET ROLE;
SELECT pg_temp.vassert((SELECT medicaid_gate_override_at>now()-interval '1 minute' FROM public.admission_cases WHERE id=(SELECT admission FROM vr WHERE label='forged')),'override time taken from the writer');
SELECT pg_temp.vassert((pg_temp.vgate('forged')->>'satisfied')::boolean,'executive override does not clear the gate');
-- A service-key writer must still name a current executive.
SELECT pg_temp.verror($q$UPDATE public.admission_cases SET medicaid_gate_override_reason='Service write',medicaid_gate_override_by=(SELECT id FROM va WHERE role='med_tech'),medicaid_gate_override_at=now() WHERE id=(SELECT admission FROM vr WHERE label='spend')$q$,'42501');
-- 3. The override stops counting when its author loses the authority.
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT id FROM va WHERE role='facility_admin');
SELECT pg_temp.vassert(NOT (pg_temp.vgate('forged')->>'satisfied')::boolean AND NOT (pg_temp.vgate('forged')->>'overridden')::boolean,'override outlived its author');
UPDATE public.user_profiles SET is_active=true WHERE id=(SELECT id FROM va WHERE role='facility_admin');

-- 4. Reopening an expiring signed document sends the signature back to pending.
SELECT pg_temp.vlogin('owner'); SET LOCAL ROLE authenticated;
INSERT INTO vq SELECT 'case',(public.benefits_case_create((SELECT id FROM vr WHERE label='imported'),NULL,'smmc_ltc',gen_random_uuid())->>'case_id')::uuid;
RESET ROLE;
INSERT INTO vq VALUES('req',gen_random_uuid());
SET LOCAL session_replication_role=replica;
INSERT INTO public.benefits_documents(id,case_id,filename,mime_type,size_bytes,sha256,storage_path,status,document_type,created_by)
SELECT (SELECT id FROM vq WHERE label='req'),(SELECT id FROM vq WHERE label='case'),'synthetic.pdf','application/pdf',12,repeat('a',64),'fixes/'||gen_random_uuid(),'ready','bank_statement',(SELECT id FROM va WHERE role='owner');
INSERT INTO public.benefits_requirements(id,case_id,title,stage,status,document_id,signature_status,signed_on,reviewed_by,reviewed_at)
SELECT (SELECT id FROM vq WHERE label='req'),(SELECT id FROM vq WHERE label='case'),'Signed bank statement authorization','application','accepted',(SELECT id FROM vq WHERE label='req'),'verified',current_date-85,(SELECT id FROM va WHERE role='owner'),now()-interval '85 days';
SET LOCAL session_replication_role=origin;
SELECT pg_temp.vlogin('owner'); SET LOCAL ROLE authenticated;
SELECT public.benefits_freshness_reopen((SELECT id FROM vq WHERE label='case'),(SELECT id FROM vq WHERE label='req'),(public.benefits_document_freshness((SELECT id FROM vq WHERE label='case'))->>'revision')::integer,gen_random_uuid());
RESET ROLE;
SELECT pg_temp.vassert((SELECT status='requested' AND signature_status='pending' AND signed_on IS NULL FROM public.benefits_requirements WHERE id=(SELECT id FROM vq WHERE label='req')),'reopened copy kept a verified signature');

-- 5. The importer skips a bad date, and a re-run that adds nothing leaves the case alone.
CREATE TEMP TABLE vi AS SELECT jsonb_build_object('import_key','medicaid-log:fixes:row','organization_id',org,'resident_id',(SELECT id FROM vr WHERE label='imported'),
 'actor_id',(SELECT id FROM va WHERE role='owner'),'steps',jsonb_build_object('intake_requested','2026-07-27','intake_emailed','2026-13-45')) payload FROM vf;
SELECT pg_temp.vassert((public.benefits_log_import_row((SELECT payload FROM vi))->>'records_added')::int=1,'bad date aborted the row');
CREATE TEMP TABLE vrev AS SELECT revision FROM public.benefits_cases WHERE id=(SELECT id FROM vq WHERE label='case');
SELECT pg_temp.vassert((public.benefits_log_import_row((SELECT payload FROM vi))->>'records_added')::int=0,'re-run added records');
SELECT pg_temp.vassert((SELECT revision FROM public.benefits_cases WHERE id=(SELECT id FROM vq WHERE label='case'))=(SELECT revision FROM vrev),'empty re-run moved the revision');
ROLLBACK;
