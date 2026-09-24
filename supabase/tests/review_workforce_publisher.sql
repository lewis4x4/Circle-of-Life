-- Synthetic source-only extraction, denial, lease fencing and exact-byte queue proof.
BEGIN;
CREATE FUNCTION pg_temp.workforce_assert(test boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF test IS DISTINCT FROM true THEN RAISE EXCEPTION 'workforce probe: %',message; END IF;
END $$;
CREATE FUNCTION pg_temp.workforce_denied(sql text,expected_code text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE=expected_code THEN RETURN; END IF; RAISE EXCEPTION 'unexpected workforce probe SQLSTATE %',SQLSTATE; END;
 RAISE EXCEPTION 'expected workforce probe denial';
END $$;
CREATE FUNCTION pg_temp.workforce_hash(body text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex') $$;
CREATE TEMP TABLE workforce_probe_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON workforce_probe_results TO service_role;
INSERT INTO public.organizations(id,name) VALUES('72100000-0000-4000-8000-000000000001','Synthetic Workforce Organization'),('72100000-0000-4000-8000-000000000002','Synthetic Other Organization');
INSERT INTO public.entities(id,organization_id,name,entity_type) VALUES('72100000-0000-4000-8000-000000000003','72100000-0000-4000-8000-000000000001','Synthetic Entity','private unrestricted free text');
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) VALUES
 ('72100000-0000-4000-8000-000000000004','72100000-0000-4000-8000-000000000001','72100000-0000-4000-8000-000000000003','Synthetic Home','Synthetic','Synthetic','00000',1),
 ('72100000-0000-4000-8000-000000000005','72100000-0000-4000-8000-000000000001','72100000-0000-4000-8000-000000000003','Synthetic Additional','Synthetic','Synthetic','00000',1),
 ('72100000-0000-4000-8000-000000000006','72100000-0000-4000-8000-000000000001','72100000-0000-4000-8000-000000000003','Synthetic Unmapped Executive','Synthetic','Synthetic','00000',1);
INSERT INTO auth.users(id,email) VALUES('72100000-0000-4000-8000-000000000007','workforce-synthetic-1@example.invalid'),('72100000-0000-4000-8000-000000000008','workforce-synthetic-2@example.invalid');
INSERT INTO public.staff(id,organization_id,facility_id,user_id,first_name,last_name,staff_role,hire_date,employment_status,termination_date,hourly_rate,email,date_of_birth,notes) VALUES
 ('72100000-0000-4000-8000-000000000011','72100000-0000-4000-8000-000000000001','72100000-0000-4000-8000-000000000004','72100000-0000-4000-8000-000000000007','Synthetic','Same Name','other','2026-01-01','active',NULL,2300,'private@example.invalid','1980-01-01','must not export'),
 ('72100000-0000-4000-8000-000000000012','72100000-0000-4000-8000-000000000001','72100000-0000-4000-8000-000000000005',NULL,'Synthetic','Same Name','other','2026-01-01','terminated','2026-09-01',NULL,NULL,NULL,NULL);
INSERT INTO public.staff_facility_assignments(id,organization_id,staff_id,facility_id,role_at_facility,is_primary,start_date,end_date,notes) VALUES
 ('72100000-0000-4000-8000-000000000013','72100000-0000-4000-8000-000000000001','72100000-0000-4000-8000-000000000011','72100000-0000-4000-8000-000000000005','other',true,'2026-03-01','2026-10-01','must not export');
INSERT INTO public.facility_executives(id,organization_id,facility_id,user_id,effective_from) VALUES
 ('72100000-0000-4000-8000-000000000014','72100000-0000-4000-8000-000000000001','72100000-0000-4000-8000-000000000004','72100000-0000-4000-8000-000000000007','2026-01-01'),
 ('72100000-0000-4000-8000-000000000015','72100000-0000-4000-8000-000000000001','72100000-0000-4000-8000-000000000006','72100000-0000-4000-8000-000000000008','2026-01-01');
SELECT pg_temp.workforce_assert(NOT has_function_privilege('anon','public.workforce_publisher_acquire(uuid,integer)','EXECUTE'),'anonymous cannot acquire');
SELECT pg_temp.workforce_assert(NOT has_function_privilege('authenticated','public.workforce_publisher_export(uuid,uuid,bigint)','EXECUTE'),'member cannot export');
SELECT pg_temp.workforce_assert(NOT has_table_privilege('service_role','haven.workforce_publisher_state','SELECT'),'service role cannot directly read pending roster');
SELECT pg_temp.workforce_assert(NOT has_table_privilege('authenticated','haven.workforce_publisher_receipts','SELECT'),'member cannot read publisher receipts');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
INSERT INTO workforce_probe_results VALUES('unconfigured',public.workforce_publisher_acquire('72100000-0000-4000-8000-000000000021',120));
RESET ROLE;
SELECT pg_temp.workforce_assert((SELECT value->>'reason'='unconfigured' FROM workforce_probe_results WHERE name='unconfigured'),'bootstrap is unconfigured');
UPDATE haven.workforce_publisher_state SET organization_id='72100000-0000-4000-8000-000000000001',key_id='synthetic-workforce';
SET LOCAL ROLE service_role;
INSERT INTO workforce_probe_results VALUES('disabled',public.workforce_publisher_acquire('72100000-0000-4000-8000-000000000021',120));
RESET ROLE;
SELECT pg_temp.workforce_assert((SELECT value->>'reason'='disabled' FROM workforce_probe_results WHERE name='disabled'),'configured feed remains disabled');
UPDATE haven.workforce_publisher_state SET enabled=true;
SET LOCAL ROLE service_role;
INSERT INTO workforce_probe_results VALUES('lease',public.workforce_publisher_acquire('72100000-0000-4000-8000-000000000021',120));
INSERT INTO workforce_probe_results VALUES('busy',public.workforce_publisher_acquire('72100000-0000-4000-8000-000000000022',120));
INSERT INTO workforce_probe_results SELECT 'export',public.workforce_publisher_export('72100000-0000-4000-8000-000000000021',(value->>'lease_token')::uuid,(value->>'generation')::bigint) FROM workforce_probe_results WHERE name='lease';
RESET ROLE;
SELECT pg_temp.workforce_assert((SELECT value->>'reason'='busy' FROM workforce_probe_results WHERE name='busy'),'concurrent publisher fenced');
SELECT pg_temp.workforce_assert((SELECT jsonb_array_length(value#>'{records,people}')=2 AND jsonb_array_length(value#>'{records,assignments}')=3 FROM workforce_probe_results WHERE name='export'),'home plus additional preserves exactly two staff identities');
SELECT pg_temp.workforce_assert((SELECT value#>>'{records,people,0,pay_basis}' IS NULL AND value#>>'{records,people,0,employer_ref}' IS NULL AND value#>>'{records,people,1,effective_employment_end}' IS NULL AND value#>>'{records,people,1,source_termination_date}'='2026-09-01' FROM workforce_probe_results WHERE name='export'),'rate and raw termination dates do not invent pay/employer/end facts');
SELECT pg_temp.workforce_assert((SELECT value#>>'{records,assignments,2,assignment_kind}'='additional' AND value#>>'{records,assignments,2,source_is_primary}'='true' AND value#>>'{records,assignments,2,source_end_inclusive}'='true' FROM workforce_probe_results WHERE name='export'),'additional is_primary never replaces home; native end date inclusive');
SELECT pg_temp.workforce_assert((SELECT value#>>'{records,roles,0,holder_resolution}'='resolved' AND value#>>'{records,roles,1,holder_resolution}'='unresolved' AND jsonb_array_length(value#>'{records,reporting}')=0 FROM workforce_probe_results WHERE name='export'),'executive source role resolution is explicit without guessed manager graph');
SELECT pg_temp.workforce_assert((SELECT value::text !~ 'private@example|1980-01-01|2300|must not export|private unrestricted' FROM workforce_probe_results WHERE name='export'),'source contact amounts notes and unknown entity types absent');
-- A second staff employment using one user turns the executive into unresolved, never an arbitrary first match.
INSERT INTO public.staff(id,organization_id,facility_id,user_id,first_name,last_name,staff_role,hire_date) VALUES('72100000-0000-4000-8000-000000000016','72100000-0000-4000-8000-000000000001','72100000-0000-4000-8000-000000000004','72100000-0000-4000-8000-000000000007','Synthetic','Second Employment','other','2026-02-01');
SET LOCAL ROLE service_role;
INSERT INTO workforce_probe_results SELECT 'ambiguous',public.workforce_publisher_export('72100000-0000-4000-8000-000000000021',(value->>'lease_token')::uuid,(value->>'generation')::bigint) FROM workforce_probe_results WHERE name='lease';
RESET ROLE;
SELECT pg_temp.workforce_assert((SELECT value#>>'{records,roles,0,holder_resolution}'='unresolved' AND value#>>'{records,roles,0,holder_ref,record_type}'='user' FROM workforce_probe_results WHERE name='ambiguous'),'ambiguous user to staff mapping remains unresolved');
-- Explicit soft deletion remains a tombstone, never a manufactured employment-end date.
UPDATE public.staff SET deleted_at=clock_timestamp() WHERE id='72100000-0000-4000-8000-000000000012';
SET LOCAL ROLE service_role;
INSERT INTO workforce_probe_results SELECT 'deleted',public.workforce_publisher_export('72100000-0000-4000-8000-000000000021',(value->>'lease_token')::uuid,(value->>'generation')::bigint) FROM workforce_probe_results WHERE name='lease';
SELECT pg_temp.workforce_denied(format('SELECT public.workforce_publisher_store_pending(%L,%L,%s,%L,%L)','72100000-0000-4000-8000-000000000021',value->>'lease_token',value->>'generation',repeat('x',2097153),repeat('a',64)),'22023') FROM workforce_probe_results WHERE name='lease';
RESET ROLE;
SELECT pg_temp.workforce_assert((SELECT value#>>'{records,people,1,record_state}'='deleted' AND value#>>'{records,people,1,effective_employment_end}' IS NULL FROM workforce_probe_results WHERE name='deleted'),'soft deletion is explicit with no employment termination inference');
-- Persist the complete serialized envelope before any HTTP attempt.
INSERT INTO workforce_probe_results SELECT 'body',to_jsonb(jsonb_build_object('source_system','haven','source_tenant_id','72100000-0000-4000-8000-000000000001','dataset','workforce_roster','contract_version',1,'batch_id','72100000-0000-4000-8000-000000000023','sequence',1,'source_as_of',value->'source_as_of','mode','full','complete',true,'counts',jsonb_build_object('units',5,'people',2,'assignments',3,'roles',2,'reporting',0),'payload_sha256',repeat('a',64),'records',value->'records')::text) FROM workforce_probe_results WHERE name='export';
SET LOCAL ROLE service_role;
INSERT INTO workforce_probe_results SELECT 'pending',public.workforce_publisher_store_pending('72100000-0000-4000-8000-000000000021',(l.value->>'lease_token')::uuid,(l.value->>'generation')::bigint,b.value#>>'{}',pg_temp.workforce_hash(b.value#>>'{}')) FROM workforce_probe_results l,workforce_probe_results b WHERE l.name='lease' AND b.name='body';
-- Same pending body replays exactly; changed bytes under the same sequence cannot replace it.
SELECT public.workforce_publisher_store_pending('72100000-0000-4000-8000-000000000021',(l.value->>'lease_token')::uuid,(l.value->>'generation')::bigint,b.value#>>'{}',pg_temp.workforce_hash(b.value#>>'{}')) FROM workforce_probe_results l,workforce_probe_results b WHERE l.name='lease' AND b.name='body';
SELECT pg_temp.workforce_denied(format('SELECT public.workforce_publisher_store_pending(%L,%L,%s,%L,%L)','72100000-0000-4000-8000-000000000021',l.value->>'lease_token',l.value->>'generation',(b.value#>>'{}')||' ',pg_temp.workforce_hash((b.value#>>'{}')||' ')),'23505') FROM workforce_probe_results l,workforce_probe_results b WHERE l.name='lease' AND b.name='body';
SELECT public.workforce_publisher_release('72100000-0000-4000-8000-000000000021',(value->>'lease_token')::uuid,(value->>'generation')::bigint,'outcome_unknown','destination_unavailable') FROM workforce_probe_results WHERE name='lease';
INSERT INTO workforce_probe_results VALUES('retry',public.workforce_publisher_acquire('72100000-0000-4000-8000-000000000024',120));
RESET ROLE;
SELECT pg_temp.workforce_assert((SELECT r.value#>>'{pending,body}'=b.value#>>'{}' FROM workforce_probe_results r,workforce_probe_results b WHERE r.name='retry' AND b.name='body'),'uncertain failure retains exact pending bytes');
SET LOCAL ROLE service_role;
SELECT public.workforce_publisher_complete('72100000-0000-4000-8000-000000000024',(r.value->>'lease_token')::uuid,(r.value->>'generation')::bigint,'72100000-0000-4000-8000-000000000025',clock_timestamp(),true,r.value#>>'{pending,body_sha256}') FROM workforce_probe_results r WHERE r.name='retry';
RESET ROLE;
SELECT pg_temp.workforce_assert((SELECT sequence=1 AND pending_body IS NULL AND lease_token IS NULL FROM haven.workforce_publisher_state),'receipt advances sequence and clears queue+lease atomically');
SELECT pg_temp.workforce_assert((SELECT count(*)=1 FROM haven.workforce_publisher_receipts),'one durable receipt');
SET LOCAL ROLE service_role;
INSERT INTO workforce_probe_results VALUES('fenced',public.workforce_publisher_acquire('72100000-0000-4000-8000-000000000026',120));
RESET ROLE;
INSERT INTO workforce_probe_results SELECT 'stale_body',to_jsonb(jsonb_set(jsonb_set((value#>>'{}')::jsonb,'{sequence}','2'),'{source_as_of}','"2025-01-01T00:00:00.000Z"')::text) FROM workforce_probe_results WHERE name='body';
SET LOCAL ROLE service_role;
SELECT pg_temp.workforce_denied(format('SELECT public.workforce_publisher_store_pending(%L,%L,%s,%L,%L)','72100000-0000-4000-8000-000000000026',l.value->>'lease_token',l.value->>'generation',b.value#>>'{}',pg_temp.workforce_hash(b.value#>>'{}')),'22023') FROM workforce_probe_results l,workforce_probe_results b WHERE l.name='fenced' AND b.name='stale_body';
RESET ROLE;
SELECT pg_temp.workforce_assert((SELECT pending_body IS NULL AND sequence=1 FROM haven.workforce_publisher_state),'stale observation refuses before persisting an unrecoverable pending batch');
UPDATE haven.workforce_publisher_state SET enabled=false;
UPDATE haven.workforce_publisher_state SET enabled=true;
SET LOCAL ROLE service_role;
SELECT pg_temp.workforce_denied(format('SELECT public.workforce_publisher_export(%L,%L,%s)','72100000-0000-4000-8000-000000000026',value->>'lease_token',value->>'generation'),'55000') FROM workforce_probe_results WHERE name='fenced';
RESET ROLE;
SELECT pg_temp.workforce_denied($q$UPDATE haven.workforce_publisher_state SET organization_id='72100000-0000-4000-8000-000000000002'$q$,'55000');
-- Scope corruption refuses the whole batch, rather than silently losing an assignment.
UPDATE public.staff_facility_assignments SET organization_id='72100000-0000-4000-8000-000000000002' WHERE id='72100000-0000-4000-8000-000000000013';
SET LOCAL ROLE service_role;
INSERT INTO workforce_probe_results VALUES('broken_scope',public.workforce_publisher_acquire('72100000-0000-4000-8000-000000000027',120));
SELECT pg_temp.workforce_denied(format('SELECT public.workforce_publisher_export(%L,%L,%s)','72100000-0000-4000-8000-000000000027',value->>'lease_token',value->>'generation'),'22023') FROM workforce_probe_results WHERE name='broken_scope';
RESET ROLE;
UPDATE haven.workforce_publisher_state SET enabled=false;
SELECT pg_temp.workforce_assert(haven.workforce_publisher_tick() IS NULL,'disabled daily tick sends nothing');
ROLLBACK;
