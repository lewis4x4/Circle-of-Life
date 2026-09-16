-- COL-391 pass 2 evidence: the two referral functions 399 switched to SECURITY
-- INVOKER still work for an authorized caller and still refuse an unauthorized
-- one, and the definer-required neighbours are unaffected. Fixtures only; the
-- whole run rolls back.

BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('a0000399-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'col391-referral@probe.invalid', now(), now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.user_profiles (id, email, full_name, app_role, organization_id, is_active, auth_claim_version)
VALUES ('a0000399-0000-4000-8000-000000000001', 'col391-referral@probe.invalid', 'COL-391 Referral Probe', 'owner', '00000000-0000-0000-0000-000000000001', true, 1);

INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES ('b0000399-0000-4000-8000-000000000001', 'a0000399-0000-4000-8000-000000000001', now(), now());

DO $$
DECLARE
  v_facility uuid := '00000000-0000-0000-0002-000000000001';
  v_source_id uuid;
  v_org uuid;
  v_created_by uuid;
  v_export_rows int;
  v_triage_id uuid;
  v_triage_rows int;
  v_sqlstate text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"role":"authenticated","sub":"a0000399-0000-4000-8000-000000000001","session_id":"b0000399-0000-4000-8000-000000000001","auth_claim_version":"1"}',
    true);
  SET LOCAL ROLE authenticated;

  IF haven.app_role() IS DISTINCT FROM 'owner'::app_role
     OR NOT haven.referral_capability('source_manage') THEN
    RAISE EXCEPTION 'COL-391 evidence: the fixture actor is not resolving to an owner with source_manage; the rest would prove nothing';
  END IF;

  -- 1. referral_source_create as an invoker: the RLS insert policy and the
  --    BEFORE trigger both admit what the function admits.
  v_source_id := public.referral_source_create(v_facility, 'COL-391 probe source', 'hospital', false);
  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'COL-391 evidence: referral_source_create returned no id as an invoker';
  END IF;

  SET LOCAL ROLE postgres;
  SELECT organization_id, created_by INTO v_org, v_created_by
  FROM public.referral_sources WHERE id = v_source_id;
  IF v_org IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
     OR v_created_by IS DISTINCT FROM 'a0000399-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'COL-391 evidence: the source row landed with organization_id=% created_by=%, so the guard trigger did not stamp it', v_org, v_created_by;
  END IF;
  SET LOCAL ROLE authenticated;

  -- 2. Facility-scoped create still works, and the row keeps its facility.
  PERFORM public.referral_source_create(v_facility, 'COL-391 probe facility source', 'hospital', true);

  -- 3. referral_leads_authorized_export as an invoker.
  SELECT count(*) INTO v_export_rows
  FROM public.referral_leads_authorized_export(v_facility, NULL, 10, 0);
  IF v_export_rows IS NULL THEN
    RAISE EXCEPTION 'COL-391 evidence: referral_leads_authorized_export did not return as an invoker';
  END IF;

  -- 4. Its bounds check still refuses, rather than the RLS layer swallowing it.
  BEGIN
    PERFORM count(*) FROM public.referral_leads_authorized_export(v_facility, NULL, 5000, 0);
    RAISE EXCEPTION 'COL-391 evidence: referral_leads_authorized_export accepted a 5000-row page';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  -- 5. The definer-required neighbours are unaffected by the pass.
  SELECT count(*) INTO v_triage_rows FROM public.referral_triage_authorized_read(10, 0);
  v_triage_id := public.referral_triage_submit('COL-391 probe enquiry', 'phone', NULL, NULL, NULL, NULL);
  IF v_triage_id IS NULL THEN
    RAISE EXCEPTION 'COL-391 evidence: referral_triage_submit returned no id';
  END IF;
  PERFORM public.referral_episode_initial_revision();

  -- 6. Drop the capability and the same two invoker functions refuse. caregiver
  --    holds neither source_manage nor lead_export.
  SET LOCAL ROLE postgres;
  UPDATE public.user_profiles SET app_role = 'caregiver'
  WHERE id = 'a0000399-0000-4000-8000-000000000001';
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.referral_source_create(v_facility, 'COL-391 must not exist', 'hospital', false);
    RAISE EXCEPTION 'COL-391 evidence: referral_source_create admitted a caregiver as an invoker';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;

  BEGIN
    PERFORM count(*) FROM public.referral_leads_authorized_export(v_facility, NULL, 10, 0);
    RAISE EXCEPTION 'COL-391 evidence: referral_leads_authorized_export admitted a caregiver as an invoker';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;

  RESET ROLE;
  RAISE NOTICE 'COL-391 pass 2 evidence: all assertions passed (export rows %, triage rows %)', v_export_rows, v_triage_rows;
END $$;

ROLLBACK;
