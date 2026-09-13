-- Integration probe: F01 snapshot export must contain exactly the audit rows the
-- requesting actor can read under live RLS (COL-133 restrictions included), and
-- every export step must require the COL-133 current site grant. Disposable
-- replay only; Supabase Auth functions are adapted for the stub.
BEGIN;
GRANT USAGE ON SCHEMA auth,haven TO authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.x_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'F01/COL-133 assertion failed: %',label; END IF;
 RAISE NOTICE 'F01/COL-133 PASS: %',label;
END $$;
CREATE FUNCTION pg_temp.x_denied(stmt text,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.x_assert(true,label); RETURN; END;
 RAISE EXCEPTION 'F01/COL-133 expected authorization denial: %',label;
END $$;
CREATE FUNCTION pg_temp.csv_ids(csv text) RETURNS uuid[] LANGUAGE sql AS $$
 SELECT coalesce(array_agg(trim(both '"' from split_part(line,',',1))::uuid ORDER BY ordinal),'{}')
 FROM string_to_table(csv,E'\r\n') WITH ORDINALITY AS c(line,ordinal) WHERE ordinal>1 AND line<>''
$$;
CREATE TEMP TABLE x AS SELECT gen_random_uuid() admin,gen_random_uuid() admin_session,gen_random_uuid() owner_id,gen_random_uuid() owner_session,
 gen_random_uuid() site_b,gen_random_uuid() subject_a,gen_random_uuid() task_safe,gen_random_uuid() task_evidence,gen_random_uuid() task_unknown,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
CREATE TEMP TABLE x_jobs(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE x_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON x TO authenticated; GRANT ALL ON x_jobs,x_results TO authenticated;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Export Site B','Synthetic','Synthetic','00000',1 FROM x;
INSERT INTO auth.users(id,email) SELECT admin,admin||'@export.invalid' FROM x UNION ALL SELECT owner_id,owner_id||'@export.invalid' FROM x;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
 SELECT admin,org,admin||'@export.invalid','Site admin','facility_admin'::public.app_role,true FROM x
 UNION ALL SELECT owner_id,org,owner_id||'@export.invalid','Corporate owner','owner'::public.app_role,true FROM x;
INSERT INTO auth.sessions(id,user_id) SELECT admin_session,admin FROM x UNION ALL SELECT owner_session,owner_id FROM x;
-- Both actors hold a current COL-133 site grant for site A only.
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT admin,site_a,org FROM x UNION ALL SELECT owner_id,site_a,org FROM x;
-- Operation tasks: a readable facility task, one carrying raw legacy evidence, one unclassified.
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind) SELECT subject_a,org,site_a,'facility' FROM x;
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date)
 SELECT task_safe,org,site_a,subject_a,'facility','Safe duty','safety','on_demand',current_date FROM x
 UNION ALL SELECT task_evidence,org,site_a,subject_a,'facility','Legacy evidence duty','safety','on_demand',current_date FROM x
 UNION ALL SELECT task_unknown,org,site_a,NULL,'unclassified','Unclassified duty','safety','on_demand',current_date FROM x;
ALTER TABLE public.operation_task_instances DISABLE TRIGGER zz_operation_current_authority;
UPDATE public.operation_task_instances SET completion_evidence_paths=ARRAY['employee-medical/private.pdf'] WHERE id=(SELECT task_evidence FROM x);
ALTER TABLE public.operation_task_instances ENABLE TRIGGER zz_operation_current_authority;
-- Synthetic audit history in a far-future window so no other fixture rows interfere.
INSERT INTO public.audit_log(table_name,record_id,action,new_data,organization_id,facility_id,created_at)
 SELECT 'X-plain-A',gen_random_uuid(),'INSERT','{"value":"plain-a"}'::jsonb,org,site_a,'2098-06-01 12:00:00+00'::timestamptz FROM x
 UNION ALL SELECT 'X-plain-B',gen_random_uuid(),'INSERT','{"value":"plain-b"}'::jsonb,org,site_b,'2098-06-01 12:00:00+00'::timestamptz FROM x
 UNION ALL SELECT 'operation_task_instances',task_safe,'UPDATE',jsonb_build_object('authority_class','facility','template_name','X-task-safe'),org,site_a,'2098-06-01 12:00:00+00'::timestamptz FROM x
 UNION ALL SELECT 'operation_task_instances',task_evidence,'UPDATE',jsonb_build_object('authority_class','facility','template_name','X-task-evidence','completion_evidence_paths',jsonb_build_array('employee-medical/private.pdf')),org,site_a,'2098-06-01 12:00:00+00'::timestamptz FROM x
 UNION ALL SELECT 'operation_task_instances',task_unknown,'UPDATE',jsonb_build_object('authority_class','unclassified','template_name','X-task-unknown'),org,site_a,'2098-06-01 12:00:00+00'::timestamptz FROM x
 UNION ALL SELECT 'operation_audit_log',gen_random_uuid(),'INSERT','{"event_notes":"X-operation-audit-secret"}'::jsonb,org,site_a,'2098-06-01 12:00:00+00'::timestamptz FROM x
 UNION ALL SELECT 'workspace_cards',gen_random_uuid(),'INSERT','{"title":"X-card-secret"}'::jsonb,org,site_a,'2098-06-01 12:00:00+00'::timestamptz FROM x
 UNION ALL SELECT 'staffing_adequacy_snapshots',gen_random_uuid(),'INSERT','{"summary":"X-staffing-secret"}'::jsonb,org,site_a,'2098-06-01 12:00:00+00'::timestamptz FROM x
 UNION ALL SELECT 'facility_assets',gen_random_uuid(),'INSERT','{"name":"X-asset-A"}'::jsonb,org,site_a,'2098-06-01 12:00:00+00'::timestamptz FROM x
 UNION ALL SELECT 'facility_assets',gen_random_uuid(),'INSERT','{"name":"X-asset-B-secret"}'::jsonb,org,site_b,'2098-06-01 12:00:00+00'::timestamptz FROM x;

-- Site admin: facility-scoped export.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',admin,'session_id',admin_session,'role','authenticated','iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=admin))::text,true) FROM x;
SET LOCAL ROLE authenticated;
SELECT pg_temp.x_assert(haven.app_role()='facility_admin' AND haven.has_facility_access(site_a) AND public.haven_operation_facility_access(site_a),'admin-current-site-a') FROM x;
CREATE TEMP TABLE x_visible_admin AS SELECT id FROM public.audit_log WHERE organization_id=(SELECT org FROM x) AND facility_id=(SELECT site_a FROM x) AND created_at>='2098-06-01' AND created_at<'2098-06-02';
SELECT pg_temp.x_assert((SELECT count(*) FROM x_visible_admin)=3,'rls-admin-sees-plain-safe-task-and-asset-only');
WITH added AS(INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id,date_from,date_to) SELECT org,admin,site_a,'2098-06-01','2098-06-01' FROM x RETURNING id) INSERT INTO x_jobs SELECT 'admin-a',id FROM added;
SELECT public.materialize_audit_export(id) FROM x_jobs WHERE label='admin-a';
INSERT INTO x_results SELECT 'admin-a',public.retrieve_audit_export(id) FROM x_jobs WHERE label='admin-a';
SELECT pg_temp.x_assert((result->>'row_count')::int=3
 AND result->>'csv_content' LIKE '%plain-a%' AND result->>'csv_content' LIKE '%X-task-safe%' AND result->>'csv_content' LIKE '%X-asset-A%'
 AND result->>'csv_content' NOT LIKE '%X-task-evidence%' AND result->>'csv_content' NOT LIKE '%private.pdf%'
 AND result->>'csv_content' NOT LIKE '%X-task-unknown%' AND result->>'csv_content' NOT LIKE '%X-operation-audit-secret%'
 AND result->>'csv_content' NOT LIKE '%X-card-secret%' AND result->>'csv_content' NOT LIKE '%X-staffing-secret%'
 AND result->>'csv_content' NOT LIKE '%plain-b%','admin-snapshot-excludes-col133-restricted-rows') FROM x_results WHERE label='admin-a';
SELECT pg_temp.x_assert((SELECT pg_temp.csv_ids(result->>'csv_content') FROM x_results WHERE label='admin-a') <@ (SELECT array_agg(id) FROM x_visible_admin)
 AND (SELECT array_agg(id) FROM x_visible_admin) <@ (SELECT pg_temp.csv_ids(result->>'csv_content') FROM x_results WHERE label='admin-a'),'admin-snapshot-equals-rls-visible-set');
SELECT pg_temp.x_assert(result->>'sha256_checksum'=encode(sha256(convert_to(result->>'csv_content','UTF8')),'hex'),'admin-snapshot-checksum') FROM x_results WHERE label='admin-a';
-- Superseded COL-133 completion command is no longer callable.
WITH added AS(INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id,date_from,date_to) SELECT org,admin,site_a,'2098-06-01','2098-06-01' FROM x RETURNING id) INSERT INTO x_jobs SELECT 'admin-pending',id FROM added;
SELECT pg_temp.x_denied($q$SELECT public.haven_complete_audit_export_job(id) FROM x_jobs WHERE label='admin-pending'$q$,'edge-side-completion-superseded');
SELECT pg_temp.x_assert((SELECT status FROM public.audit_log_export_jobs WHERE id=(SELECT id FROM x_jobs WHERE label='admin-pending'))='pending','pending-job-unchanged');

-- COL-133 site grant expiry denies materialization and retrieval even though
-- the legacy F01 site access still holds.
SAVEPOINT grant_case;
RESET ROLE;
UPDATE public.user_facility_access SET operation_expires_at=clock_timestamp()-interval '1 second' WHERE user_id=(SELECT admin FROM x);
SET LOCAL ROLE authenticated;
SELECT pg_temp.x_assert(haven.has_facility_access(site_a) AND NOT public.haven_operation_facility_access(site_a),'legacy-access-holds-current-grant-expired') FROM x;
SELECT pg_temp.x_denied($q$SELECT public.retrieve_audit_export(id) FROM x_jobs WHERE label='admin-a'$q$,'expired-current-grant-retrieval-denied');
SELECT pg_temp.x_denied($q$SELECT public.materialize_audit_export(id) FROM x_jobs WHERE label='admin-pending'$q$,'expired-current-grant-materialization-denied');
RESET ROLE;
SELECT pg_temp.x_assert((SELECT count(*) FROM haven.audit_export_snapshots WHERE job_id=(SELECT id FROM x_jobs WHERE label='admin-pending'))=0,'no-snapshot-after-denial');
ROLLBACK TO grant_case;
RELEASE grant_case;
RESET ROLE;

-- Corporate owner: organization-wide export sees both sites' plain rows but
-- not site B's asset row, matching the COL-133 restrictive policy under RLS.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'session_id',owner_session,'role','authenticated','iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=owner_id))::text,true) FROM x;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE x_visible_owner AS SELECT id FROM public.audit_log WHERE organization_id=(SELECT org FROM x) AND created_at>='2098-06-01' AND created_at<'2098-06-02';
WITH added AS(INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,date_from,date_to) SELECT org,owner_id,'2098-06-01','2098-06-01' FROM x RETURNING id) INSERT INTO x_jobs SELECT 'owner-org',id FROM added;
SELECT public.materialize_audit_export(id) FROM x_jobs WHERE label='owner-org';
INSERT INTO x_results SELECT 'owner-org',public.retrieve_audit_export(id) FROM x_jobs WHERE label='owner-org';
SELECT pg_temp.x_assert(result->>'csv_content' LIKE '%plain-a%' AND result->>'csv_content' LIKE '%plain-b%' AND result->>'csv_content' LIKE '%X-asset-A%'
 AND result->>'csv_content' NOT LIKE '%X-asset-B-secret%' AND result->>'csv_content' NOT LIKE '%private.pdf%' AND result->>'csv_content' NOT LIKE '%X-card-secret%','owner-snapshot-respects-col133-site-and-row-limits') FROM x_results WHERE label='owner-org';
SELECT pg_temp.x_assert((SELECT pg_temp.csv_ids(result->>'csv_content') FROM x_results WHERE label='owner-org') <@ (SELECT array_agg(id) FROM x_visible_owner)
 AND (SELECT array_agg(id) FROM x_visible_owner) <@ (SELECT pg_temp.csv_ids(result->>'csv_content') FROM x_results WHERE label='owner-org')
 AND (SELECT (result->>'row_count')::int FROM x_results WHERE label='owner-org')=(SELECT count(*) FROM x_visible_owner),'owner-snapshot-equals-rls-visible-set');
-- A site B export by the owner needs a current site B grant, not only the owner role.
SELECT pg_temp.x_denied($q$INSERT INTO public.audit_log_export_jobs(organization_id,requested_by,facility_id) SELECT org,owner_id,site_b FROM x$q$,'owner-site-b-without-current-grant-denied');
RESET ROLE;
SELECT jsonb_build_object('suite','F01-COL133-audit-export-reconcile','status','PASS');
ROLLBACK;
