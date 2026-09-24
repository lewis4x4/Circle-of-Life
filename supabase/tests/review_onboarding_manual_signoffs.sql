-- COL-740: new hires sign the P&P manuals their job role requires; staff hired
-- before a rule are never asked; sign-offs are permanent and gate duty
-- readiness. Disposable local replay only; everything rolls back.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
-- The replay has no Supabase default privileges; hosted grants SELECT already.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT ON public.onboarding_manual_requirements TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;

CREATE TEMP TABLE manual_fixture AS
SELECT gen_random_uuid() owner_user, gen_random_uuid() owner_session,
       gen_random_uuid() hire_user, gen_random_uuid() hire_session,
       gen_random_uuid() new_hire, gen_random_uuid() veteran, gen_random_uuid() other_role,
       gen_random_uuid() manual, gen_random_uuid() draft_doc, gen_random_uuid() owner_staff,
       f.id facility, f.organization_id org
FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM manual_fixture) THEN RAISE EXCEPTION 'Local replay seed facility required'; END IF; END $$;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT owner_user,owner_user||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Manual owner"}'::jsonb FROM manual_fixture
UNION ALL SELECT hire_user,hire_user||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','med_tech'),'{"full_name":"New hire"}'::jsonb FROM manual_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
SELECT owner_user,owner_user||'@review.invalid','Manual owner','owner'::public.app_role,org,true FROM manual_fixture
UNION ALL SELECT hire_user,hire_user||'@review.invalid','New hire','med_tech'::public.app_role,org,true FROM manual_fixture
ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
SELECT owner_user,facility,org FROM manual_fixture UNION ALL SELECT hire_user,facility,org FROM manual_fixture;
INSERT INTO auth.sessions(id,user_id)
SELECT owner_session,owner_user FROM manual_fixture UNION ALL SELECT hire_session,hire_user FROM manual_fixture;

-- A published manual and an unpublished draft in the knowledge base.
INSERT INTO public.documents(id,workspace_id,title,status,markdown_text)
SELECT manual,org,'Resident Rights P&P','published','# Resident rights\nEvery resident ...' FROM manual_fixture
UNION ALL SELECT draft_doc,org,'Draft manual','draft','Not yet approved' FROM manual_fixture;

-- A new hire starting tomorrow, a veteran hired years ago in the same role,
-- and a new hire in a role nobody configured.
INSERT INTO public.staff(id,organization_id,facility_id,user_id,first_name,last_name,staff_role,hire_date)
SELECT new_hire,org,facility,hire_user,'New','Hire','medication_tech'::public.staff_role,(now() AT TIME ZONE 'America/New_York')::date+1 FROM manual_fixture
UNION ALL SELECT veteran,org,facility,NULL,'Long','Serving','medication_tech'::public.staff_role,DATE '2019-03-01' FROM manual_fixture
UNION ALL SELECT other_role,org,facility,NULL,'Other','Role','housekeeping'::public.staff_role,(now() AT TIME ZONE 'America/New_York')::date+1 FROM manual_fixture
UNION ALL SELECT owner_staff,org,facility,owner_user,'Manual','Owner','administrator'::public.staff_role,DATE '2019-03-01' FROM manual_fixture;

CREATE FUNCTION pg_temp.act_as(p_owner boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE f record; v_id uuid; v_session uuid; v_version integer; v_role text;
BEGIN
  SELECT * INTO f FROM manual_fixture;
  v_id := CASE WHEN p_owner THEN f.owner_user ELSE f.hire_user END;
  v_session := CASE WHEN p_owner THEN f.owner_session ELSE f.hire_session END;
  SELECT auth_claim_version,app_role::text INTO v_version,v_role FROM public.user_profiles WHERE id=v_id;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_id,'session_id',v_session,'role','authenticated',
    'auth_claim_version',v_version,'app_role',v_role,'organization_id',f.org,
    'app_metadata',jsonb_build_object('app_role',v_role,'organization_id',f.org),
    'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true);
END $$;
CREATE FUNCTION pg_temp.expect_error(p_sql text,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN IF position(p_message IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'Expected rejection: %',p_message;
END $$;
GRANT SELECT ON manual_fixture TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(text,text) TO authenticated;

SELECT pg_temp.act_as(true);
SET LOCAL ROLE authenticated;

-- Nothing configured: nobody owes anything.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.haven_onboarding_manual_status((SELECT new_hire FROM manual_fixture))) THEN
    RAISE EXCEPTION 'A manual was required before any rule existed';
  END IF;
END $$;

-- Guardrails on the configuration.
SELECT pg_temp.expect_error(format(
  $q$INSERT INTO public.onboarding_manual_requirements(organization_id,staff_role,document_id,required,effective_from,change_reason,created_by)
     VALUES (%L,'medication_tech',%L,true,now(),'draft is not a manual',%L)$q$,
  (SELECT org FROM manual_fixture),(SELECT draft_doc FROM manual_fixture),(SELECT owner_user FROM manual_fixture)),
  'published knowledge-base policy document');
SELECT pg_temp.expect_error(format(
  $q$INSERT INTO public.onboarding_manual_requirements(organization_id,staff_role,document_id,required,effective_from,change_reason,created_by)
     VALUES (%L,'medication_tech',%L,true,now()-interval '2 days','backdated',%L)$q$,
  (SELECT org FROM manual_fixture),(SELECT manual FROM manual_fixture),(SELECT owner_user FROM manual_fixture)),
  'row-level security');

-- The owner requires the manual for med-techs, from now.
INSERT INTO public.onboarding_manual_requirements(organization_id,staff_role,document_id,required,effective_from,change_reason,created_by)
SELECT org,'medication_tech',manual,true,now(),'Onboarding sign-off (COL-740)',owner_user FROM manual_fixture;

DO $$
DECLARE f record; v_readiness jsonb;
BEGIN
  SELECT * INTO f FROM manual_fixture;
  IF (SELECT count(*) FROM public.haven_onboarding_manual_status(f.new_hire) WHERE signoff_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'The new hire should owe exactly one unsigned manual';
  END IF;
  IF EXISTS (SELECT 1 FROM public.haven_onboarding_manual_status(f.veteran)) THEN
    RAISE EXCEPTION 'Existing staff must never be flagged for a manual';
  END IF;
  IF EXISTS (SELECT 1 FROM public.haven_onboarding_manual_status(f.other_role)) THEN
    RAISE EXCEPTION 'A role with no rule must owe nothing';
  END IF;
  IF (SELECT count(*) FROM public.haven_onboarding_manual_overview(f.facility)) <> 1 THEN
    RAISE EXCEPTION 'The overview lists only staff who owe a manual';
  END IF;
END $$;

-- An owner cannot sign in the employee's name; in person needs a real manager
-- witness, which the owner is.
SELECT pg_temp.expect_error(format(
  $q$SELECT public.haven_sign_onboarding_manual(%L,%L,'New Hire','self','I have read and understand this manual.')$q$,
  (SELECT new_hire FROM manual_fixture),(SELECT manual FROM manual_fixture)),
  'Only the employee can sign');

-- The new hire signs in their own login.
RESET ROLE;
SELECT pg_temp.act_as(false);
SET LOCAL ROLE authenticated;
SELECT public.haven_sign_onboarding_manual((SELECT new_hire FROM manual_fixture),(SELECT manual FROM manual_fixture),
  'New Hire','self','I have read and understand this manual.');
SELECT pg_temp.expect_error(format(
  $q$SELECT public.haven_sign_onboarding_manual(%L,%L,'New Hire','self','Again')$q$,
  (SELECT new_hire FROM manual_fixture),(SELECT manual FROM manual_fixture)),
  'already signed');
SELECT pg_temp.expect_error(format(
  $q$SELECT public.haven_sign_onboarding_manual(%L,%L,'New Hire','self','Not mine')$q$,
  (SELECT veteran FROM manual_fixture),(SELECT manual FROM manual_fixture)),
  'Only the employee can sign');

DO $$
DECLARE f record; r record;
BEGIN
  SELECT * INTO f FROM manual_fixture;
  SELECT * INTO r FROM public.haven_onboarding_manual_status(f.new_hire);
  IF r.signoff_id IS NULL OR r.signed_content_sha256 IS DISTINCT FROM r.current_content_sha256 OR r.method <> 'self' THEN
    RAISE EXCEPTION 'The sign-off must record the manual version it covered';
  END IF;
END $$;

-- Permanent: no edits, no deletes, not even for the owner.
RESET ROLE;
SELECT pg_temp.act_as(true);
SELECT pg_temp.expect_error('UPDATE public.onboarding_manual_signoffs SET signature_name = ''Changed''', 'permanent');
SELECT pg_temp.expect_error('DELETE FROM public.onboarding_manual_signoffs', 'permanent');

-- Readiness: a required manual unsigned counts as missing.
DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM manual_fixture;
  INSERT INTO public.staff(organization_id,facility_id,first_name,last_name,staff_role,hire_date)
  VALUES (f.org,f.facility,'Second','Hire','medication_tech',(now() AT TIME ZONE 'America/New_York')::date+1);
END $$;
DO $$
DECLARE v jsonb; v_staff uuid;
BEGIN
  SELECT id INTO v_staff FROM public.staff WHERE first_name='Second' AND last_name='Hire' LIMIT 1;
  v := haven.employee_duty_readiness_snapshot(v_staff,'resident_interaction');
  -- No employee-file requirement is configured in the replay (1 unconfigured
  -- duty) plus the unsigned manual.
  IF (v->>'missing_count')::integer <> 2 OR (v->>'status') = 'ready' THEN
    RAISE EXCEPTION 'Duty readiness must count the unsigned manual: %', v;
  END IF;
END $$;

ROLLBACK;
