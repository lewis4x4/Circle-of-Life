-- COL-291: every site-scoped table the operations routes read through the
-- session is governed by the operations authority at the database, not only by
-- the route gate.
--
-- The rule this enforces (docs/specs/27-facility-operations-authority.md,
-- "Ruling — COL-291"): an operations route calls the gate before it builds a
-- query, but the gate is code and code can be skipped — a server component, a
-- future list surface, a direct query. Row-level security is what a session
-- read cannot skip. So each table below either carries a RESTRICTIVE policy
-- that calls the operations gate, or every permissive read policy on it does.
-- A table an operations route reads that is governed by domain authority
-- instead must be named in EXCEPTIONS with its reason; the vitest
-- src/lib/operations/reader-authority.test.ts scans the routes and refuses any
-- table that is in neither list, so a new reader cannot inherit the laxer
-- authority by accident. The two lists are the single source for both files.
--
-- Rolls back; reads catalog state only.
BEGIN;
CREATE FUNCTION pg_temp.c_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-291 %',msg; END IF; END $$;

-- GOVERNED-BEGIN
-- Site-scoped records the operations routes read; each must be gate-governed.
CREATE TEMP TABLE governed(tbl text PRIMARY KEY);
INSERT INTO governed VALUES
 ('asset_observations'),
 ('dietary_records'),
 ('drill_log'),
 ('facility_assets'),
 ('facility_service_records'),
 ('operation_activities'),
 ('operation_activity_bindings'),
 ('operation_command_drafts'),
 ('operation_escalation_deliveries'),
 ('operation_evidence'),
 ('operation_execution_receipts'),
 ('operation_facility_requirements'),
 ('operation_help_handover_events'),
 ('operation_issue_events'),
 ('operation_issues'),
 ('operation_source_events'),
 ('operation_task_instances'),
 ('operation_task_templates');
-- GOVERNED-END

-- EXCEPTIONS-BEGIN
-- Read by an operations route but governed by domain authority, with the reason.
-- Every route that reads one of these must have called the gate first.
CREATE TEMP TABLE exceptions(tbl text PRIMARY KEY, reason text NOT NULL CHECK (length(reason) > 20));
INSERT INTO exceptions VALUES
 ('entities', 'organisation-level reference row without facility_id; org scope is the authority'),
 ('facilities', 'the site row itself; the gate resolves against it and it carries no site-scoped operations content'),
 ('facility_documents', 'document vault shared by compliance, onboarding and family surfaces; operations reads only names of linked documents after the gate'),
 ('operation_activity_source_items', 'organisation-level catalogue row without facility_id'),
 ('operation_activity_source_mappings', 'organisation-level catalogue row without facility_id'),
 ('operation_issue_backlog', 'security_invoker view over operation_issues; the base table policies govern every row it returns'),
 ('operation_requirement_versions', 'organisation-level requirement text without facility_id'),
 ('user_facility_access', 'the grant table the gate reads; its own policies scope rows to the caller or to grant administrators'),
 ('user_profiles', 'identity directory shared by every surface; operations reads display names after the gate'),
 ('vendor_facilities', 'vendor coverage is a directory fact shared with finance and compliance; operations lists it after the gate'),
 ('vendors', 'organisation-level vendor directory without facility_id');
-- EXCEPTIONS-END

SELECT pg_temp.c_assert((SELECT count(*)=0 FROM governed g JOIN exceptions e USING (tbl)),'a table is both governed and excepted');

-- 1. Every governed table exists, is site-scoped, and has row-level security on.
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM governed g WHERE NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=g.tbl AND c.relkind='r')),
 'a governed table does not exist as a public table: '||(SELECT string_agg(tbl,', ') FROM governed g WHERE NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=g.tbl AND c.relkind='r')));
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM governed g WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=g.tbl AND column_name='facility_id')),
 'a governed table has no facility_id column — it is not site-scoped, so move it to EXCEPTIONS with a reason');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM governed g JOIN pg_class c ON c.relname=g.tbl JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
  WHERE NOT c.relrowsecurity),'a governed table has row-level security off');

-- 2. Each governed table is gate-governed: a RESTRICTIVE policy that calls the
--    operations authority, or every permissive policy that admits a SELECT for
--    authenticated does. A permissive gate policy beside a permissive lax
--    policy is not governance — permissive policies OR together.
CREATE TEMP TABLE gate_functions(fn text);
INSERT INTO gate_functions VALUES
 ('operation_facility_access'),('operation_task_readable'),('operation_task_mutable'),('operation_accessible_facility_ids'),
 ('operation_domain_access'),('operation_subject_accessible'),('operation_source_event_readable'),('operation_activity_is_facility');
-- Every listed gate function must exist in the haven schema and resolve
-- through the site gate — directly, or through another listed gate function
-- (operation_task_readable reaches it through operation_domain_access). A
-- listed name that reaches neither is a loophole. prosrc, not
-- pg_get_functiondef: the latter raises on aggregate rows the planner may
-- visit before the name filter.
CREATE TEMP TABLE gate_bodies AS
 SELECT f.fn, p.prosrc FROM gate_functions f
 LEFT JOIN (pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='haven') ON p.proname=f.fn AND p.prokind='f';
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM gate_bodies WHERE prosrc IS NULL),
 'a listed gate function does not exist in schema haven: '||(SELECT string_agg(fn,', ') FROM gate_bodies WHERE prosrc IS NULL));
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM gate_bodies b WHERE b.fn<>'operation_facility_access' AND NOT EXISTS (
  SELECT 1 FROM gate_functions g WHERE g.fn<>b.fn AND b.prosrc LIKE '%'||g.fn||'%')),
 'a listed gate function reaches no other gate function, so it cannot resolve through haven.operation_facility_access: '||
 (SELECT string_agg(fn,', ') FROM gate_bodies b WHERE b.fn<>'operation_facility_access' AND NOT EXISTS (
  SELECT 1 FROM gate_functions g WHERE g.fn<>b.fn AND b.prosrc LIKE '%'||g.fn||'%')));

CREATE TEMP TABLE verdict AS
SELECT g.tbl,
 EXISTS (SELECT 1 FROM pg_policies p JOIN gate_functions f ON p.qual LIKE '%'||f.fn||'%'
   WHERE p.schemaname='public' AND p.tablename=g.tbl AND p.permissive='RESTRICTIVE' AND p.cmd IN ('ALL','SELECT')
   AND ('authenticated'=ANY(p.roles) OR 'public'=ANY(p.roles))) AS restrictive_gate,
 (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=g.tbl AND p.permissive='PERMISSIVE' AND p.cmd IN ('ALL','SELECT')
   AND ('authenticated'=ANY(p.roles) OR 'public'=ANY(p.roles))) AS permissive_reads,
 (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=g.tbl AND p.permissive='PERMISSIVE' AND p.cmd IN ('ALL','SELECT')
   AND ('authenticated'=ANY(p.roles) OR 'public'=ANY(p.roles))
   AND EXISTS (SELECT 1 FROM gate_functions f WHERE p.qual LIKE '%'||f.fn||'%')) AS permissive_gated_reads
FROM governed g;

SELECT pg_temp.c_assert((SELECT count(*)=0 FROM verdict WHERE permissive_reads=0),
 'a governed table has no read policy for authenticated at all, so nothing reads it and this list is stale: '||(SELECT string_agg(tbl,', ') FROM verdict WHERE permissive_reads=0));
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM verdict WHERE NOT restrictive_gate AND permissive_gated_reads<permissive_reads),
 'a site-scoped table the operations routes read is governed by the laxer domain authority (COL-291 class): '||
 (SELECT string_agg(tbl,', ') FROM verdict WHERE NOT restrictive_gate AND permissive_gated_reads<permissive_reads));

-- 3. Exceptions are real relations, and the site-scoped ones really are shared
--    beyond operations (they must not carry a gate policy, or they belong in
--    GOVERNED).
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM exceptions e WHERE NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=e.tbl AND c.relkind IN ('r','v'))),
 'an excepted relation does not exist: '||(SELECT string_agg(tbl,', ') FROM exceptions e WHERE NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=e.tbl AND c.relkind IN ('r','v'))));
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM exceptions e JOIN pg_policies p ON p.schemaname='public' AND p.tablename=e.tbl
  JOIN gate_functions f ON p.qual LIKE '%'||f.fn||'%' WHERE p.permissive='RESTRICTIVE'),
 'an excepted table carries a RESTRICTIVE operations-gate policy, so it is governed — move it to GOVERNED');
-- The one view must read through its base table, not around it.
SELECT pg_temp.c_assert((SELECT coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name='security_invoker'),'false')='true'
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='operation_issue_backlog' AND c.relkind='v'),
 'operation_issue_backlog is not a security_invoker view, so it reads around the operation_issues policies');

SELECT 'COL-291 operations reader authority PASS' result;
ROLLBACK;
