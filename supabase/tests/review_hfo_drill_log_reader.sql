-- COL-282: what actually governs a session-scoped read of public.drill_log,
-- the table the COL-241 reader GET /api/admin/operations/drill-logs selects
-- from. The route's own test mocks requireOperationsActor and
-- actorCanAccessFacility, so its "second-site denial" case is the application
-- gate returning 404 before the query is built; it would pass against a
-- database with no row-level security at all. This probe asserts the database.
--
-- Proves: a second site's facility_admin reads none of the first site's drill
-- logs and cannot write one; a revoked grant reads nothing; an unheld site and
-- a nonexistent one are indistinguishable through the route's gate, which is
-- the 404 contract the route states; and, named rather than assumed, the two
-- authorities do NOT agree — public.haven_operation_facility_access (the route
-- gate, migration 348) additionally honours user_facility_access
-- .operation_expires_at, while the drill_log policy's
-- haven.accessible_facility_ids() (migration 220's policy, function redefined
-- by 326) does not. An expired operations grant is therefore refused by the
-- route and still passes row-level security, so any session read of drill_log
-- that does not call the gate first is wider than the route. Rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
-- Hosted Supabase grants authenticated the default table privileges the legacy page relies on for drill_log; the replay stub has none, so they are modelled here (RLS is the real control).
GRANT SELECT,INSERT,UPDATE,DELETE ON public.drill_log TO authenticated,service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.c_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-282 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.c_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-282 expected authority denial: %',stmt;
END $$;

-- FIXTURES-BEGIN
-- Two sites in one organisation. admin_a holds site A, admin_b holds site B,
-- revoked_admin held site A and no longer does, expired_admin holds site A on a
-- grant whose operations window has closed.
CREATE TEMP TABLE lf AS SELECT gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,
 gen_random_uuid() revoked_admin,gen_random_uuid() revoked_session,
 gen_random_uuid() expired_admin,gen_random_uuid() expired_session,
 gen_random_uuid() site_b,gen_random_uuid() absent_facility,
 gen_random_uuid() log_a,gen_random_uuid() log_b,
 date_trunc('minute',clock_timestamp()-interval '2 days') back,
 f.id site_a,f.organization_id org,f.entity_id entity
 FROM public.facilities f WHERE f.id='00000000-0000-0000-0002-000000000003' AND f.deleted_at IS NULL;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM lf),'the seeded Homewood facility is missing');

INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT site_b,org,entity,'Drill Log Site B','Test','Test','00000',1 FROM lf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT admin_a,admin_a||'@drilllog.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM lf
 UNION ALL SELECT admin_b,admin_b||'@drilllog.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM lf
 UNION ALL SELECT revoked_admin,revoked_admin||'@drilllog.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Revoked admin"}'::jsonb FROM lf
 UNION ALL SELECT expired_admin,expired_admin||'@drilllog.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Expired admin"}'::jsonb FROM lf;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT admin_a,admin_a||'@drilllog.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM lf
 UNION ALL SELECT admin_b,admin_b||'@drilllog.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM lf
 UNION ALL SELECT revoked_admin,revoked_admin||'@drilllog.invalid','Revoked admin','facility_admin'::public.app_role,org,true FROM lf
 UNION ALL SELECT expired_admin,expired_admin||'@drilllog.invalid','Expired admin','facility_admin'::public.app_role,org,true FROM lf;
INSERT INTO auth.sessions(id,user_id) SELECT admin_a_session,admin_a FROM lf UNION ALL SELECT admin_b_session,admin_b FROM lf
 UNION ALL SELECT revoked_session,revoked_admin FROM lf UNION ALL SELECT expired_session,expired_admin FROM lf;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT admin_a,site_a,org FROM lf
 UNION ALL SELECT admin_b,site_b,org FROM lf;
-- Held and then taken away: the grant row survives with revoked_at set.
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,revoked_at) SELECT revoked_admin,site_a,org,clock_timestamp()-interval '1 day' FROM lf;
-- Held, never revoked, but its operations window closed. This is the row the
-- two authorities disagree about.
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,operation_expires_at) SELECT expired_admin,site_a,org,clock_timestamp()-interval '1 hour' FROM lf;

-- One drill log at each site, written as service_role so the fixture does not
-- depend on the policy under test.
INSERT INTO public.drill_log(id,organization_id,facility_id,drill_type,drill_date,drill_time)
 SELECT log_a,org,site_a,'fire',(back)::date,(back)::time FROM lf
 UNION ALL SELECT log_b,org,site_b,'fire',(back)::date,(back)::time FROM lf;
CREATE FUNCTION pg_temp.c_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f lf; u uuid; sess uuid; BEGIN
 SELECT * INTO f FROM lf;
 IF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session;
 ELSIF p_kind='admin_b' THEN u:=f.admin_b; sess:=f.admin_b_session;
 ELSIF p_kind='revoked' THEN u:=f.revoked_admin; sess:=f.revoked_session;
 ELSE u:=f.expired_admin; sess:=f.expired_session; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role','facility_admin','organization_id',f.org)::text,true);
END $$;
GRANT SELECT ON lf TO authenticated,service_role;
GRANT ALL ON FUNCTION pg_temp.c_assert(boolean,text),pg_temp.c_denied(text),pg_temp.c_login(text) TO authenticated,service_role;
-- FIXTURES-END

-- 1. The site that holds the log reads it. Without this the denials below
--    would pass against a policy that simply denies everyone.
SELECT pg_temp.c_login('admin_a');
SET ROLE authenticated;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.drill_log WHERE id=(SELECT log_a FROM lf)),'site A admin cannot read its own drill log');
SELECT pg_temp.c_assert((SELECT public.haven_operation_facility_access((SELECT site_a FROM lf))),'the route gate refuses site A to its own admin');
RESET ROLE;

-- 2. Second-site denial, as a database fact rather than a mocked gate. The
--    other site's admin is a real authenticated session with a real current
--    grant — at the wrong facility.
SELECT pg_temp.c_login('admin_b');
SET ROLE authenticated;
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.drill_log WHERE facility_id=(SELECT site_a FROM lf)),'site B admin reads site A drill logs');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.drill_log WHERE id=(SELECT log_a FROM lf)),'site B admin reads the site A drill log by id');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.drill_log WHERE id=(SELECT log_b FROM lf)),'site B admin cannot read its own drill log');
-- Denial is absence, not an error: the reader returns no rows rather than
-- raising, so a row count can never leak from the other site.
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.drill_log),'site B admin sees a row count from outside its own site');
-- The write side of the same policy, so a denied reader is not a permitted writer.
SELECT pg_temp.c_denied($q$INSERT INTO public.drill_log(organization_id,facility_id,drill_type,drill_date,drill_time) SELECT org,site_a,'fire',(back)::date,(back)::time FROM lf$q$);
SELECT pg_temp.c_assert(NOT public.haven_operation_facility_access((SELECT site_a FROM lf)),'the route gate admits site A to the site B admin');
-- 3. An unheld site and a site that does not exist are the same answer. This
--    is the route's stated contract: "An unheld site is not distinguishable
--    from a missing one," both 404.
SELECT pg_temp.c_assert(public.haven_operation_facility_access((SELECT absent_facility FROM lf)) IS NOT DISTINCT FROM public.haven_operation_facility_access((SELECT site_a FROM lf)),
 'an unheld site answers differently from a nonexistent one');
RESET ROLE;

-- 4. A revoked grant is nothing. Both authorities agree here.
SELECT pg_temp.c_login('revoked');
SET ROLE authenticated;
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.drill_log),'a revoked grant still reads drill logs');
SELECT pg_temp.c_assert(NOT public.haven_operation_facility_access((SELECT site_a FROM lf)),'the route gate admits a revoked grant');
RESET ROLE;

-- 5. The divergence, asserted rather than assumed. The route gate honours
--    operation_expires_at (348); haven.accessible_facility_ids(), which the
--    220 drill_log policy calls, checks only revoked_at (326). An expired
--    operations grant is therefore refused by the route and admitted by
--    row-level security.
--
--    This is not reachable through GET /api/admin/operations/drill-logs, which
--    calls the gate before it builds the query. It means the reader's own
--    claim that reading "through the session" makes current site authority
--    govern every row is wider than it sounds: the session alone is the laxer
--    of the two authorities, and any future server component, list surface or
--    direct query that skips the gate inherits the laxer one. Tracked as
--    COL-291. If that issue closes by tightening the RLS path, the two
--    assertions below are the ones that must flip, and this comment with them.
SELECT pg_temp.c_login('expired');
SET ROLE authenticated;
SELECT pg_temp.c_assert(NOT public.haven_operation_facility_access((SELECT site_a FROM lf)),'the route gate ignores operation_expires_at');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.drill_log WHERE id=(SELECT log_a FROM lf)),
 'row-level security now honours operation_expires_at — the reader and the gate have converged, so update COL-291 and this probe together');
SELECT pg_temp.c_assert((SELECT site_a FROM lf) IN (SELECT haven.accessible_facility_ids()),'accessible_facility_ids no longer admits an expired operations grant');
SELECT pg_temp.c_assert((SELECT site_a FROM lf) NOT IN (SELECT public.haven_operation_accessible_facility_ids()),'the operations accessible list admits an expired grant');
RESET ROLE;

-- 6. The two authorities are two different functions, and the drill_log policy
--    calls the laxer one. Stated as schema fact so a future rewrite of either
--    cannot quietly make this probe vacuous.
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM pg_policies WHERE schemaname='public' AND tablename='drill_log' AND policyname='drill_log_access'),'the drill_log policy is not the 220 policy');
SELECT pg_temp.c_assert((SELECT qual LIKE '%accessible_facility_ids%' FROM pg_policies WHERE schemaname='public' AND tablename='drill_log' AND policyname='drill_log_access'),
 'the drill_log policy no longer reads through accessible_facility_ids — re-derive which authority governs this table');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM pg_policies WHERE schemaname='public' AND tablename='drill_log' AND qual LIKE '%operation_facility_access%'),
 'a policy on drill_log now calls the operations gate — the divergence in section 5 may be closed');

SELECT 'COL-282 drill log reader authority PASS' result;
ROLLBACK;
