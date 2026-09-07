-- SYS-001 rollback-only authorization, onboarding, Storage, and InitPlan probe.
BEGIN;

GRANT USAGE ON SCHEMA auth, storage, haven TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;

CREATE TEMP TABLE actor_fixture AS
SELECT gen_random_uuid() actor,gen_random_uuid() actor_session,
  gen_random_uuid() family_user,gen_random_uuid() family_session,
  gen_random_uuid() onboarding_user,gen_random_uuid() onboarding_session,
  gen_random_uuid() legacy_user,gen_random_uuid() legacy_session,
  gen_random_uuid() mismatch_user,gen_random_uuid() mismatch_session,
  gen_random_uuid() second_resident,gen_random_uuid() storage_object,gen_random_uuid() storage_object_two,gen_random_uuid() perf_marker,
  f.id facility,f.organization_id organization,r.id resident
FROM public.facilities f JOIN public.residents r
  ON r.facility_id=f.id AND r.organization_id=f.organization_id AND r.deleted_at IS NULL
WHERE f.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM actor_fixture) THEN RAISE EXCEPTION 'SYS-001 seeded facility/resident required'; END IF; END $$;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT actor,actor||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','owner'),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT family_user,family_user||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','family'),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT onboarding_user,onboarding_user||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','onboarding','auth_claim_version',1),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT legacy_user,legacy_user||'@sys001.invalid',jsonb_build_object('organization_id',organization,'app_role','caregiver'),'{}'::jsonb FROM actor_fixture
UNION ALL SELECT mismatch_user,mismatch_user||'@sys001.invalid','{}'::jsonb,'{}'::jsonb FROM actor_fixture;

INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
SELECT actor,organization,actor||'@sys001.invalid','SYS-001 actor','owner'::public.app_role,true FROM actor_fixture
UNION ALL SELECT family_user,organization,family_user||'@sys001.invalid','SYS-001 family','family'::public.app_role,true FROM actor_fixture
UNION ALL SELECT legacy_user,organization,legacy_user||'@sys001.invalid','SYS-001 legacy','caregiver'::public.app_role,true FROM actor_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
SELECT actor,facility,organization FROM actor_fixture;
INSERT INTO auth.sessions(id,user_id)
SELECT actor_session,actor FROM actor_fixture
UNION ALL SELECT family_session,family_user FROM actor_fixture
UNION ALL SELECT onboarding_session,onboarding_user FROM actor_fixture
UNION ALL SELECT legacy_session,legacy_user FROM actor_fixture
UNION ALL SELECT mismatch_session,mismatch_user FROM actor_fixture;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender)
SELECT second_resident,facility,organization,'SYS-001','Unlinked','1940-01-01','female' FROM actor_fixture;
INSERT INTO public.family_resident_links(user_id,resident_id,organization_id,relationship)
SELECT family_user,resident,organization,'family' FROM actor_fixture;
INSERT INTO public.onboarding_questions(id,prompt,department,importance,answer_type)
VALUES('sys001.authorization','SYS-001 authorization probe','Security','critical','long_text');

GRANT SELECT ON actor_fixture TO authenticated, service_role;
CREATE FUNCTION pg_temp.set_claims(p_user uuid,p_session uuid,p_version jsonb,p_claimed_role text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE claims jsonb;
BEGIN
  claims:=jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated',
    'app_role',p_claimed_role,'app_metadata',jsonb_build_object('app_role',p_claimed_role));
  IF p_version IS NOT NULL THEN claims:=jsonb_set(claims,'{auth_claim_version}',p_version,true); END IF;
  PERFORM set_config('request.jwt.claims',claims::text,true);
END $$;
CREATE FUNCTION pg_temp.expect_rejected(p_case text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.haven_assert_authorized_request();
    RAISE EXCEPTION 'SYS-001 unexpectedly accepted: %',p_case;
  EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>'PGRST' THEN RAISE; END IF; END;
END $$;

-- Hook emits real integer authority claims and replaces stale role/org metadata.
DO $$ DECLARE f actor_fixture%ROWTYPE; result jsonb; version integer; BEGIN
  SELECT * INTO STRICT f FROM actor_fixture;
  SELECT auth_claim_version INTO version FROM public.user_profiles WHERE id=f.actor;
  result:=public.haven_custom_access_token_hook(jsonb_build_object('user_id',f.actor,'claims',
    jsonb_build_object('sub',f.actor,'role','authenticated','app_metadata',jsonb_build_object('app_role','caregiver'))));
  IF jsonb_typeof(result#>'{claims,auth_claim_version}')<>'number'
     OR (result#>>'{claims,auth_claim_version}')::integer<>version
     OR result#>>'{claims,app_role}'<>'owner'
     OR result#>>'{claims,app_metadata,app_role}'<>'owner'
     OR (result#>>'{claims,organization_id}')::uuid<>f.organization THEN RAISE EXCEPTION 'Managed hook claims incorrect'; END IF;
  result:=public.haven_custom_access_token_hook(jsonb_build_object('user_id',f.onboarding_user,'claims',jsonb_build_object('role','authenticated')));
  IF jsonb_typeof(result#>'{claims,auth_claim_version}')<>'number'
     OR result#>>'{claims,app_role}'<>'onboarding'
     OR (result#>>'{claims,organization_id}')::uuid<>f.organization THEN RAISE EXCEPTION 'Onboarding hook claims incorrect'; END IF;
  IF has_function_privilege('authenticated','public.haven_custom_access_token_hook(jsonb)','EXECUTE')
     OR NOT has_function_privilege('supabase_auth_admin','public.haven_custom_access_token_hook(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Custom token hook grants incorrect';
  END IF;
END $$;

-- Version-1 compatibility: missing claim passes only before any authority change.
SELECT pg_temp.set_claims(legacy_user,legacy_session,NULL,'owner') FROM actor_fixture;
SELECT public.haven_assert_authorized_request();
UPDATE public.user_profiles SET app_role='manager' WHERE id=(SELECT legacy_user FROM actor_fixture);
SELECT pg_temp.expect_rejected('missing version after authority change');
SELECT pg_temp.set_claims(f.legacy_user,f.legacy_session,to_jsonb(p.auth_claim_version),'owner')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.legacy_user;
SELECT public.haven_assert_authorized_request();
DO $$ BEGIN IF haven.app_role()<>'manager'::public.app_role THEN RAISE EXCEPTION 'Immediate fresh integer version failed'; END IF; END $$;

-- Active owner receives current database authority despite stale caregiver JWT metadata.
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f actor_fixture%ROWTYPE; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  PERFORM public.haven_assert_authorized_request();
  IF haven.app_role()<>'owner'::public.app_role OR haven.organization_id()<>f.organization
     OR NOT haven.has_facility_access(f.facility) OR NOT haven.can_access_resident(f.resident)
     OR NOT EXISTS(SELECT 1 FROM public.residents WHERE id=f.resident) THEN RAISE EXCEPTION 'Current owner authority failed'; END IF;
  PERFORM public.allocate_incident_number(f.facility);
END $$;
RESET ROLE;

-- Workspace Storage owner policies require the current actor, not auth.uid alone.
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects(id,bucket_id,name) SELECT storage_object,'workspace-files',actor||'/'||storage_object||'/one.txt' FROM actor_fixture;
RESET ROLE;
UPDATE public.user_profiles SET app_role='caregiver' WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('stale owner after demotion');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f actor_fixture%ROWTYPE; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  IF EXISTS(SELECT 1 FROM storage.objects WHERE id=f.storage_object) THEN RAISE EXCEPTION 'Stale Storage SELECT authorized'; END IF;
  BEGIN INSERT INTO storage.objects(id,bucket_id,name) VALUES(f.storage_object_two,'workspace-files',f.actor||'/'||f.storage_object_two||'/two.txt');
    RAISE EXCEPTION 'Stale Storage INSERT authorized'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE storage.objects SET metadata='{"stale":true}' WHERE id=f.storage_object;
  DELETE FROM storage.objects WHERE id=f.storage_object;
END $$;
RESET ROLE;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE id=(SELECT storage_object FROM actor_fixture) AND metadata='{}') THEN
  RAISE EXCEPTION 'Stale Storage UPDATE/DELETE changed object'; END IF; END $$;

-- Fresh current caregiver token owns its path, but stale owner metadata cannot authorize question-bank DML.
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'owner')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF haven.app_role()<>'caregiver'::public.app_role OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE id=(SELECT storage_object FROM actor_fixture)) THEN
    RAISE EXCEPTION 'Current-role/stale-metadata check failed'; END IF;
  BEGIN INSERT INTO onboarding_questions(id,prompt,department,importance,answer_type)
    VALUES('sys001.forged-owner','forged','Security','critical','long_text');
    RAISE EXCEPTION 'Stale owner metadata authorized onboarding DML'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE storage.objects SET metadata='{"fresh":true}' WHERE id=(SELECT storage_object FROM actor_fixture);
  DELETE FROM storage.objects WHERE id=(SELECT storage_object FROM actor_fixture);
END $$;
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM storage.objects WHERE id=(SELECT storage_object FROM actor_fixture)) THEN RAISE EXCEPTION 'Fresh owner-path delete failed'; END IF; END $$;

-- Dedicated onboarding identity reads questions and writes only its current organization responses.
SELECT pg_temp.set_claims(onboarding_user,onboarding_session,'1'::jsonb,'owner') FROM actor_fixture;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f actor_fixture%ROWTYPE; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  PERFORM public.haven_assert_authorized_request();
  IF haven.jwt_app_role_text()<>'onboarding' OR haven.effective_onboarding_organization_id()<>f.organization
     OR NOT EXISTS(SELECT 1 FROM onboarding_questions WHERE id='sys001.authorization') THEN RAISE EXCEPTION 'Onboarding read denied'; END IF;
  INSERT INTO onboarding_responses(organization_id,question_id,value,entered_by_user_id)
    VALUES(f.organization,'sys001.authorization','allowed',f.onboarding_user);
  IF NOT EXISTS(SELECT 1 FROM onboarding_responses WHERE question_id='sys001.authorization' AND value='allowed') THEN RAISE EXCEPTION 'Onboarding write denied'; END IF;
END $$;
RESET ROLE;
UPDATE auth.users SET banned_until='infinity' WHERE id=(SELECT onboarding_user FROM actor_fixture);
SELECT pg_temp.expect_rejected('banned onboarding identity');
UPDATE auth.users SET banned_until=NULL WHERE id=(SELECT onboarding_user FROM actor_fixture);
SELECT public.haven_assert_authorized_request();
UPDATE auth.users SET deleted_at=now() WHERE id=(SELECT onboarding_user FROM actor_fixture);
SELECT pg_temp.expect_rejected('deleted onboarding Auth identity');
UPDATE auth.users SET deleted_at=NULL WHERE id=(SELECT onboarding_user FROM actor_fixture);
SELECT public.haven_assert_authorized_request();

-- Family access remains linked-resident-only and reacts immediately to revocation.
SELECT pg_temp.set_claims(family_user,family_session,NULL,'owner') FROM actor_fixture;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f actor_fixture%ROWTYPE; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  IF haven.app_role()<>'family'::public.app_role OR NOT haven.can_access_resident(f.resident)
     OR haven.can_access_resident(f.second_resident)
     OR NOT EXISTS(SELECT 1 FROM residents WHERE id=f.resident)
     OR EXISTS(SELECT 1 FROM residents WHERE id=f.second_resident) THEN RAISE EXCEPTION 'Family linked/unlinked boundary failed'; END IF;
END $$;
RESET ROLE;
UPDATE public.family_resident_links SET revoked_at=now() WHERE user_id=(SELECT family_user FROM actor_fixture);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF haven.can_access_resident((SELECT resident FROM actor_fixture))
  OR EXISTS(SELECT 1 FROM residents WHERE id=(SELECT resident FROM actor_fixture)) THEN RAISE EXCEPTION 'Revoked family link retained access'; END IF; END $$;
RESET ROLE;

-- Inactive/deleted/version/facility/session/Auth-user state each fails closed.
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('inactive');
UPDATE public.user_profiles SET is_active=true WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('reactivated old token');
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
UPDATE public.user_profiles SET deleted_at=now() WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('deleted');
UPDATE public.user_profiles SET deleted_at=NULL WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('restored old token');
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('facility revoked old token');
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
SELECT public.haven_assert_authorized_request();
DO $$ BEGIN IF haven.has_facility_access((SELECT facility FROM actor_fixture)) THEN RAISE EXCEPTION 'Fresh token retained revoked facility'; END IF; END $$;
UPDATE public.user_facility_access SET revoked_at=NULL WHERE user_id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('facility regrant old token');
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
DELETE FROM auth.sessions WHERE id=(SELECT actor_session FROM actor_fixture);
SELECT pg_temp.expect_rejected('missing session');
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM actor_fixture;
SELECT public.haven_assert_authorized_request();
UPDATE auth.users SET banned_until='infinity' WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.expect_rejected('managed auth ban');
UPDATE auth.users SET banned_until=NULL WHERE id=(SELECT actor FROM actor_fixture);
SELECT public.haven_assert_authorized_request();

-- Malformed/overflow identity and version inputs plus session-user mismatch.
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bad","session_id":"bad","auth_claim_version":1}',true);
SELECT pg_temp.expect_rejected('malformed sub/session');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',actor_session,
  'auth_claim_version','999999999999999999999999')::text,true) FROM actor_fixture;
SELECT pg_temp.expect_rejected('overflow version');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',actor_session,
  'auth_claim_version','1.5')::text,true) FROM actor_fixture;
SELECT pg_temp.expect_rejected('malformed version');
SELECT pg_temp.set_claims(f.actor,f.mismatch_session,to_jsonb(p.auth_claim_version),'owner')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
SELECT pg_temp.expect_rejected('session user mismatch');

-- PostgREST assertion bypasses machine identities; a service-only RPC remains callable.
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public, haven TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE f actor_fixture%ROWTYPE; result jsonb; BEGIN SELECT * INTO STRICT f FROM actor_fixture;
  PERFORM public.haven_assert_authorized_request();
  result:=public.ai_tool_facility_directory(f.organization,f.actor,'caregiver',ARRAY[f.facility],f.facility);
  IF result IS NULL THEN RAISE EXCEPTION 'Machine service RPC failed'; END IF;
END $$;
RESET ROLE;

-- Function posture and representative RLS plans prove locked helpers + named InitPlans.
DO $$ BEGIN
  IF has_function_privilege('authenticated','haven.current_authorized_actor()','EXECUTE')
     OR has_function_privilege('service_role','haven.current_authorized_actor()','EXECUTE') THEN RAISE EXCEPTION 'Internal actor resolver exposed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='haven' AND p.proname IN('current_authorized_actor','authorized_user_id','organization_id','app_role',
      'has_facility_access','accessible_facility_ids','can_access_resident','jwt_app_role_text',
      'can_access_onboarding_workspace','effective_onboarding_organization_id','is_onboarding_org_admin_jwt')
      AND (NOT p.prosecdef OR NOT ('search_path=""'=ANY(p.proconfig)))) THEN RAISE EXCEPTION 'Authorization helper posture failed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
    AND policyname LIKE 'storage_wf_owner_%' AND coalesce(qual,with_check) NOT LIKE '%authorized_user_id%') THEN
    RAISE EXCEPTION 'Workspace Storage owner policy lacks current actor'; END IF;
END $$;

-- Scaled operational/reporting fixtures exercise real hot policies. Restore the
-- actor's current owner role so both policy contracts legitimately return rows.
UPDATE public.user_profiles SET app_role='owner' WHERE id=(SELECT actor FROM actor_fixture);
SELECT pg_temp.set_claims(f.actor,f.actor_session,to_jsonb(p.auth_claim_version),'caregiver')
FROM actor_fixture f JOIN public.user_profiles p ON p.id=f.actor;
INSERT INTO public.daily_logs(resident_id,facility_id,organization_id,log_date,shift,logged_by,general_notes)
SELECT f.resident,f.facility,f.organization,current_date-series,'day'::public.shift_type,f.actor,'SYS001-PERF'
FROM actor_fixture f CROSS JOIN generate_series(1,500) AS series;
INSERT INTO public.report_runs(organization_id,source_type,source_id,generated_by_user_id,run_scope_json,status)
SELECT f.organization,'template'::public.report_source_type,f.perf_marker,f.actor,jsonb_build_object('facility_id',f.facility),'running'::public.report_run_status
FROM actor_fixture f CROSS JOIN generate_series(1,500);
ANALYZE public.daily_logs;
ANALYZE public.report_runs;

CREATE TEMP TABLE explain_lines(path text,line_no bigserial,line text);
GRANT INSERT,SELECT ON explain_lines TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE explain_lines_line_no_seq TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE plan_line record; f actor_fixture%ROWTYPE; BEGIN
  SELECT * INTO STRICT f FROM actor_fixture;
  IF (SELECT count(*) FROM public.daily_logs WHERE general_notes='SYS001-PERF')<>500
     OR (SELECT count(*) FROM public.report_runs WHERE source_id=f.perf_marker)<>500 THEN
    RAISE EXCEPTION 'Scaled hot-policy fixtures were not visible';
  END IF;
  FOR plan_line IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, VERBOSE) SELECT id FROM public.residents LIMIT 5' LOOP
    INSERT INTO explain_lines(path,line) VALUES('residents',plan_line."QUERY PLAN");
  END LOOP;
  FOR plan_line IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, VERBOSE) SELECT id FROM public.daily_logs WHERE general_notes=''SYS001-PERF''' LOOP
    INSERT INTO explain_lines(path,line) VALUES('daily_logs',plan_line."QUERY PLAN");
  END LOOP;
  FOR plan_line IN EXECUTE format(
    'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, VERBOSE) SELECT id FROM public.report_runs WHERE source_id=%L::uuid',f.perf_marker
  ) LOOP
    INSERT INTO explain_lines(path,line) VALUES('report_runs',plan_line."QUERY PLAN");
  END LOOP;
END $$;
RESET ROLE;
DO $$ DECLARE path_name text; helper_name text; BEGIN
  FOREACH path_name IN ARRAY ARRAY['residents','daily_logs','report_runs'] LOOP
    FOREACH helper_name IN ARRAY ARRAY['haven.organization_id()','haven.app_role()','haven.accessible_facility_ids()'] LOOP
      IF NOT EXISTS(
        SELECT 1
        FROM explain_lines init_line
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            (SELECT min(next_init.line_no) FROM explain_lines next_init
             WHERE next_init.path=init_line.path AND next_init.line_no>init_line.line_no
               AND next_init.line LIKE '%InitPlan%'),
            (SELECT max(last_line.line_no)+1 FROM explain_lines last_line WHERE last_line.path=init_line.path)
          ) AS next_init_line_no
        ) block_end
        JOIN explain_lines helper_line ON helper_line.path=init_line.path
          AND helper_line.line_no>init_line.line_no AND helper_line.line_no<block_end.next_init_line_no
        JOIN explain_lines execution_line ON execution_line.path=init_line.path
          AND execution_line.line_no>=init_line.line_no AND execution_line.line_no<block_end.next_init_line_no
        WHERE init_line.path=path_name AND init_line.line LIKE '%InitPlan%'
          AND helper_line.line LIKE '%'||helper_name||'%'
          AND execution_line.line LIKE '%loops=1%'
      ) THEN RAISE EXCEPTION '% policy lacks a same-block loops=1 InitPlan for %',path_name,helper_name; END IF;
    END LOOP;
  END LOOP;
END $$;

ROLLBACK;
