-- F01 rollback-only: real authenticated SQL role and current Haven helpers.
-- Supabase Auth functions are adapted only for the disposable replay stub.
BEGIN;
GRANT USAGE ON SCHEMA auth,haven TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE audit_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() session_id,
 gen_random_uuid() owner_id,gen_random_uuid() owner_session,gen_random_uuid() org,gen_random_uuid() other_org,
 gen_random_uuid() entity,gen_random_uuid() other_entity,gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() c;
CREATE TEMP TABLE audit_jobs(label text PRIMARY KEY,id uuid);
CREATE TEMP SEQUENCE audit_assertion_count;
GRANT USAGE,SELECT ON SEQUENCE audit_assertion_count TO authenticated;
CREATE TEMP TABLE audit_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON audit_fixture TO authenticated;
GRANT ALL ON audit_jobs,audit_results TO authenticated;
CREATE FUNCTION pg_temp.audit_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'F01 assertion failed: %',label; END IF;
 PERFORM nextval('pg_temp.audit_assertion_count');
 RAISE NOTICE 'F01 PASS: %',label;
 INSERT INTO audit_results VALUES(label,jsonb_build_object('passed',true));
END $$;
CREATE FUNCTION pg_temp.audit_denied(stmt text,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN
  PERFORM pg_temp.audit_assert(true,label); RETURN; END;
 RAISE EXCEPTION 'F01 expected authorization denial: %',label;
END $$;
INSERT INTO public.organizations(id,name) SELECT org,'Synthetic audit org' FROM audit_fixture UNION ALL SELECT other_org,'Synthetic other org' FROM audit_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'Synthetic entity' FROM audit_fixture UNION ALL SELECT other_entity,other_org,'Other entity' FROM audit_fixture;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT a,org,entity,'Audit A','Synthetic','Synthetic','00000',1 FROM audit_fixture
 UNION ALL SELECT b,org,entity,'Audit B','Synthetic','Synthetic','00000',1 FROM audit_fixture
 UNION ALL SELECT c,other_org,other_entity,'Audit C','Synthetic','Synthetic','00000',1 FROM audit_fixture;
INSERT INTO auth.users(id,email) SELECT actor,actor||'@audit.invalid' FROM audit_fixture UNION ALL SELECT owner_id,owner_id||'@audit.invalid' FROM audit_fixture;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
 SELECT actor,org,actor||'@audit.invalid','Restricted audit actor','facility_admin'::public.app_role,true FROM audit_fixture
 UNION ALL SELECT owner_id,org,owner_id||'@audit.invalid','Owner audit actor','owner'::public.app_role,true FROM audit_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT session_id,actor FROM audit_fixture UNION ALL SELECT owner_session,owner_id FROM audit_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,a,org FROM audit_fixture;
INSERT INTO public.audit_log(id,table_name,record_id,action,old_data,new_data,changed_fields,organization_id,facility_id,created_at,user_agent)
 SELECT md5('F01-source-'||i)::uuid,'F01-source',md5('F01-record-'||i)::uuid,'UPDATE',jsonb_build_object('value','before-'||i),jsonb_build_object('value','after-'||i),ARRAY['value'],org,a,'2099-01-01 12:00:00+00'::timestamptz,' =FORMULA()'
 FROM audit_fixture CROSS JOIN generate_series(1,2505) i;
INSERT INTO public.audit_log(table_name,record_id,action,organization_id,facility_id,created_at)
 SELECT 'F01-excluded-B',gen_random_uuid(),'INSERT',org,b,'2099-01-01 12:00:00+00'::timestamptz FROM audit_fixture
 UNION ALL SELECT 'F01-excluded-null',gen_random_uuid(),'INSERT',org,NULL,'2099-01-01 12:00:00+00'::timestamptz FROM audit_fixture
 UNION ALL SELECT 'F01-excluded-C',gen_random_uuid(),'INSERT',other_org,c,'2099-01-01 12:00:00+00'::timestamptz FROM audit_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',session_id,'role','authenticated','auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=actor))::text,true) FROM audit_fixture;
SET LOCAL ROLE authenticated;
SELECT pg_temp.audit_assert(haven.app_role()='facility_admin' AND haven.has_facility_access(a) AND NOT haven.has_facility_access(b),'current-restricted-authority') FROM audit_fixture;
SELECT pg_temp.audit_assert((SELECT count(*) FROM public.audit_log WHERE table_name LIKE 'F01-%')=2505,'direct-audit-A-only');
WITH added AS(INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id,date_from,date_to)
 SELECT org,actor,a,'2099-01-01','2099-01-01' FROM audit_fixture RETURNING id) INSERT INTO audit_jobs SELECT 'A',id FROM added;
SELECT pg_temp.audit_denied($q$INSERT INTO public.audit_log_export_jobs(organization_id,requested_by) SELECT org,actor FROM audit_fixture$q$,'null-scope-denied');
SELECT pg_temp.audit_denied($q$INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id) SELECT org,actor,b FROM audit_fixture$q$,'B-scope-denied');
SELECT pg_temp.audit_denied($q$INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id) SELECT org,actor,c FROM audit_fixture$q$,'cross-org-facility-denied');
SELECT pg_temp.audit_denied($q$INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id) SELECT org,owner_id,a FROM audit_fixture$q$,'spoofed-requester-denied');
SELECT pg_temp.audit_denied($q$INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id,status) SELECT org,actor,a,'completed' FROM audit_fixture$q$,'forged-completion-denied');
SELECT pg_temp.audit_denied($q$INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id,sha256_checksum) SELECT org,actor,a,repeat('a',64) FROM audit_fixture$q$,'forged-checksum-denied');
SELECT pg_temp.audit_denied($q$INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id,storage_path,row_count) SELECT org,actor,a,'forged',99 FROM audit_fixture$q$,'forged-artifact-denied');
SELECT pg_temp.audit_denied($q$INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id,date_from,date_to) SELECT org,actor,a,'2099-01-02','2099-01-01' FROM audit_fixture$q$,'reversed-dates-denied');
SELECT pg_temp.audit_denied($q$UPDATE public.audit_log_export_jobs SET facility_id=(SELECT b FROM audit_fixture) WHERE id=(SELECT id FROM audit_jobs WHERE label='A')$q$,'scope-update-denied');
SELECT public.materialize_audit_export(id) FROM audit_jobs WHERE label='A';
INSERT INTO audit_results SELECT 'snapshot-first',public.retrieve_audit_export(id) FROM audit_jobs WHERE label='A';
SELECT pg_temp.audit_assert((result->>'row_count')::integer=2505 AND result->>'csv_content' LIKE '%before-2505%' AND result->>'csv_content' LIKE '%after-2505%' AND result->>'csv_content' LIKE '%changed_fields%' AND result->>'csv_content' NOT LIKE '%F01-excluded-%','snapshot-complete-2505-before-after') FROM audit_results WHERE label='snapshot-first';
SELECT pg_temp.audit_assert(
 (SELECT array_agg(split_part(line,',',1) ORDER BY ordinal) FROM string_to_table(result->>'csv_content',E'\r\n') WITH ORDINALITY AS csv(line,ordinal) WHERE ordinal>1 AND line<>'')
 =(SELECT array_agg('"'||md5('F01-source-'||i)::uuid::text||'"' ORDER BY md5('F01-source-'||i)::uuid) FROM generate_series(1,2505) i),'exact-source-membership-and-tie-order') FROM audit_results WHERE label='snapshot-first';
SELECT pg_temp.audit_assert(result->>'sha256_checksum'=encode(sha256(convert_to(result->>'csv_content','UTF8')),'hex'),'snapshot-checksum') FROM audit_results WHERE label='snapshot-first';
SELECT pg_temp.audit_assert(result->>'csv_content' LIKE '%"'' =FORMULA()"%','formula-neutralized') FROM audit_results WHERE label='snapshot-first';
SELECT pg_temp.audit_denied($q$SELECT * FROM haven.audit_export_snapshots$q$,'direct-snapshot-read-denied');
SELECT pg_temp.audit_denied($q$SELECT * FROM haven.audit_export_events$q$,'direct-event-read-denied');
RESET ROLE;
INSERT INTO public.audit_log(table_name,record_id,action,organization_id,facility_id,created_at) SELECT 'F01-later-insert',gen_random_uuid(),'INSERT',org,a,'2099-01-01 12:00:00+00'::timestamptz FROM audit_fixture;
SET LOCAL ROLE authenticated;
SELECT public.materialize_audit_export(id) FROM audit_jobs WHERE label='A';
INSERT INTO audit_results SELECT 'snapshot-again',public.retrieve_audit_export(id) FROM audit_jobs WHERE label='A';
SELECT pg_temp.audit_assert((SELECT result FROM audit_results WHERE label='snapshot-first')=(SELECT result FROM audit_results WHERE label='snapshot-again'),'retry-preserves-exact-snapshot');
RESET ROLE;
SELECT pg_temp.audit_assert((SELECT count(*) FROM haven.audit_export_events WHERE job_id=(SELECT id FROM audit_jobs WHERE label='A') AND event_type='requested')=1 AND (SELECT count(*) FROM haven.audit_export_events WHERE job_id=(SELECT id FROM audit_jobs WHERE label='A') AND event_type='materialized')=1 AND (SELECT count(*) FROM haven.audit_export_events WHERE job_id=(SELECT id FROM audit_jobs WHERE label='A') AND event_type='retrieved')=2,'durable-request-materialization-retrieval-events');
SELECT pg_temp.audit_denied($q$UPDATE haven.audit_export_snapshots SET row_count=0 WHERE job_id=(SELECT id FROM audit_jobs WHERE label='A')$q$,'snapshot-mutation-rejected-even-owner');
SELECT pg_temp.audit_denied($q$DELETE FROM haven.audit_export_events WHERE job_id=(SELECT id FROM audit_jobs WHERE label='A')$q$,'event-deletion-rejected-even-owner');
SET LOCAL ROLE authenticated;

WITH added AS(INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id,date_from,date_to) SELECT org,actor,a,'2099-01-01','2099-01-01' FROM audit_fixture RETURNING id) INSERT INTO audit_jobs SELECT 'pending',id FROM added;

-- Each state change retains the earlier JWT. Rejected attempts must not leak
-- already materialized bytes; savepoints restore authoritative fixture state.
SAVEPOINT authority_case;
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id=(SELECT actor FROM audit_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.audit_denied($q$SELECT public.retrieve_audit_export(id) FROM audit_jobs WHERE label='A'$q$,'revoked-grant-retrieval-denied');
SELECT pg_temp.audit_denied($q$SELECT public.materialize_audit_export(id) FROM audit_jobs WHERE label='A'$q$,'revoked-grant-processing-denied');
SELECT pg_temp.audit_denied($q$SELECT public.materialize_audit_export(id) FROM audit_jobs WHERE label='pending'$q$,'revoked-before-materialization-denied');
SELECT pg_temp.audit_denied($q$INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id) SELECT org,actor,a FROM audit_fixture$q$,'revoked-new-request-denied');
SELECT pg_temp.audit_assert((SELECT count(*) FROM public.audit_log_export_jobs)=0,'revoked-job-list-hidden');
ROLLBACK TO authority_case;
RESET ROLE;
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT actor FROM audit_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.audit_denied($q$SELECT public.retrieve_audit_export(id) FROM audit_jobs WHERE label='A'$q$,'inactive-actor-denied');
ROLLBACK TO authority_case;
RESET ROLE;
UPDATE public.user_profiles SET deleted_at=now() WHERE id=(SELECT actor FROM audit_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.audit_denied($q$SELECT public.retrieve_audit_export(id) FROM audit_jobs WHERE label='A'$q$,'deleted-profile-denied');
ROLLBACK TO authority_case;
RESET ROLE;
UPDATE auth.users SET deleted_at=now() WHERE id=(SELECT actor FROM audit_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.audit_denied($q$SELECT public.retrieve_audit_export(id) FROM audit_jobs WHERE label='A'$q$,'deleted-auth-user-denied');
ROLLBACK TO authority_case;
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=(SELECT actor FROM audit_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.audit_denied($q$SELECT public.retrieve_audit_export(id) FROM audit_jobs WHERE label='A'$q$,'banned-actor-denied');
ROLLBACK TO authority_case;
RESET ROLE;
DELETE FROM auth.sessions WHERE id=(SELECT session_id FROM audit_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.audit_denied($q$SELECT public.retrieve_audit_export(id) FROM audit_jobs WHERE label='A'$q$,'revoked-session-denied');
ROLLBACK TO authority_case;
RESET ROLE;
UPDATE public.user_profiles SET auth_claim_version=auth_claim_version+1 WHERE id=(SELECT actor FROM audit_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.audit_denied($q$SELECT public.retrieve_audit_export(id) FROM audit_jobs WHERE label='A'$q$,'stale-claim-denied');
ROLLBACK TO authority_case;
RESET ROLE;
UPDATE public.user_profiles SET app_role='caregiver' WHERE id=(SELECT actor FROM audit_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',session_id,'role','authenticated','auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=actor))::text,true) FROM audit_fixture;
SET LOCAL ROLE authenticated;
SELECT pg_temp.audit_denied($q$SELECT public.retrieve_audit_export(id) FROM audit_jobs WHERE label='A'$q$,'downgraded-role-even-fresh-claim-denied');
ROLLBACK TO authority_case;
RELEASE authority_case;
RESET ROLE;

SELECT set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_session,'role','authenticated','auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=owner_id))::text,true) FROM audit_fixture;
SET LOCAL ROLE authenticated;
WITH added AS(INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,date_from,date_to) SELECT org,owner_id,'2099-01-01','2099-01-01' FROM audit_fixture RETURNING id) INSERT INTO audit_jobs SELECT 'owner-null',id FROM added;
WITH added AS(INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id,date_from,date_to) SELECT org,owner_id,b,'2099-01-01','2099-01-01' FROM audit_fixture RETURNING id) INSERT INTO audit_jobs SELECT 'owner-B',id FROM added;
SELECT pg_temp.audit_denied($q$INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id) SELECT org,owner_id,c FROM audit_fixture$q$,'owner-cross-org-facility-denied');
SELECT pg_temp.audit_denied($q$SELECT public.retrieve_audit_export(id) FROM audit_jobs WHERE label='A'$q$,'different-requester-retrieval-denied');
SELECT public.materialize_audit_export(id) FROM audit_jobs WHERE label LIKE 'owner-%';
INSERT INTO audit_results SELECT label,public.retrieve_audit_export(id) FROM audit_jobs WHERE label LIKE 'owner-%';
SELECT pg_temp.audit_assert((result->>'row_count')::integer=2508,'owner-null-complete-current-org') FROM audit_results WHERE label='owner-null';
SELECT pg_temp.audit_assert((result->>'row_count')::integer=1 AND result->>'csv_content' NOT LIKE '%F01-excluded-null%','owner-B-excludes-null-history') FROM audit_results WHERE label='owner-B';
RESET ROLE;
-- Test mutation guards independently from grants, within this rollback only.
GRANT UPDATE ON public.audit_log_export_jobs TO authenticated;
CREATE POLICY audit_test_update ON public.audit_log_export_jobs FOR UPDATE TO authenticated USING(true) WITH CHECK(true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.audit_denied($q$UPDATE public.audit_log_export_jobs SET row_count=0 WHERE id=(SELECT id FROM audit_jobs WHERE label='owner-null')$q$,'accidental-grant-does-not-forge-completion');
RESET ROLE;
SELECT jsonb_build_object('suite','F01-audit-export','sourceRows',2505,'status','PASS','assertionCount',(SELECT last_value FROM audit_assertion_count),'skips',0);
ROLLBACK;
