-- Migration 562 (COL-871): visits on the resident Timeline and in the family portal.
-- Rollback-only synthetic organization: one facility, residents A and B, a staff
-- administrator, and four family logins (clinical link, non-clinical link, revoked
-- link, no link).
BEGIN;
CREATE TEMP TABLE rv AS SELECT gen_random_uuid() org, gen_random_uuid() entity, gen_random_uuid() site,
  gen_random_uuid() res_a, gen_random_uuid() res_b,
  gen_random_uuid() v_family, gen_random_uuid() v_provider, gen_random_uuid() v_voided, gen_random_uuid() v_other_resident;
CREATE TEMP TABLE rva AS SELECT label, CASE WHEN label = 'admin' THEN 'facility_admin' ELSE 'family' END role, gen_random_uuid() id, gen_random_uuid() session
  FROM unnest(ARRAY['admin', 'clinical', 'non_clinical', 'revoked', 'stranger']) label;
GRANT ALL ON rv, rva TO authenticated;

INSERT INTO public.organizations(id, name) SELECT org, 'COL871 visits synthetic' FROM rv;
INSERT INTO public.entities(id, organization_id, name) SELECT entity, org, 'Synthetic' FROM rv;
INSERT INTO public.facilities(id, organization_id, entity_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
  SELECT site, org, entity, 'Synthetic', 'Test', 'Test', '00000', 4, 'America/New_York' FROM rv;
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
  SELECT id, id || '@col871.invalid', jsonb_build_object('organization_id', org, 'app_role', role), '{}'::jsonb FROM rva, rv;
INSERT INTO public.user_profiles(id, organization_id, full_name, email, app_role, is_active)
  SELECT id, org, 'Synthetic ' || label, id || '@col871.invalid', role::public.app_role, true FROM rva, rv
  ON CONFLICT (id) DO UPDATE SET organization_id = excluded.organization_id, app_role = excluded.app_role, is_active = true;
INSERT INTO auth.sessions(id, user_id) SELECT session, id FROM rva;
INSERT INTO public.user_facility_access(user_id, facility_id, organization_id) SELECT id, site, org FROM rva, rv WHERE label = 'admin';
INSERT INTO public.residents(id, organization_id, facility_id, first_name, last_name, date_of_birth, gender)
  SELECT res_a, org, site, 'Ada', 'Synthetic', DATE '1940-01-01', 'female'::public.gender FROM rv
  UNION ALL SELECT res_b, org, site, 'Bea', 'Synthetic', DATE '1941-01-01', 'female'::public.gender FROM rv;
INSERT INTO public.family_resident_links(user_id, resident_id, organization_id, relationship, can_view_clinical, revoked_at)
  SELECT id, res_a, org, 'child', label = 'clinical', CASE WHEN label = 'revoked' THEN now() END FROM rva, rv
  WHERE label IN ('clinical', 'non_clinical', 'revoked');

-- A family visit (signed out), a provider visit still open with symptoms, a voided
-- entry, and a visit to resident B.
INSERT INTO public.visitor_log_entries(id, organization_id, facility_id, visitor_name, visitor_type, visitor_company, visiting_type, resident_id,
    purpose, checked_in_at, checked_out_at, symptoms_reported, voided_at, voided_by, void_reason)
  SELECT v_family, org, site, 'Jordan Pierce', 'family_friend', NULL::text, 'resident', res_a, 'Lunch', now() - interval '3 hours', now() - interval '2 hours', false, NULL::timestamptz, NULL::uuid, NULL::text FROM rv
  UNION ALL SELECT v_provider, org, site, 'Dana Reyes', 'healthcare_provider', 'Sunshine Hospice', 'resident', res_a, NULL, now() - interval '1 hour', NULL, true, NULL, NULL, NULL FROM rv
  UNION ALL SELECT v_voided, org, site, 'Wrong Entry', 'family_friend', NULL, 'resident', res_a, NULL, now() - interval '30 minutes', NULL, false, now(), (SELECT id FROM rva WHERE label = 'admin'), 'entered_in_error' FROM rv
  UNION ALL SELECT v_other_resident, org, site, 'Casey Other', 'family_friend', NULL, 'resident', res_b, NULL, now() - interval '20 minutes', NULL, false, NULL, NULL, NULL FROM rv;

-- The replay has no Supabase default privileges; hosted, every public table is granted to
-- authenticated and RLS alone decides (policies also read other tables). Mirror that here;
-- the grant rolls back with everything else.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

CREATE FUNCTION pg_temp.rv_login(p_label text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE a record;
BEGIN
  SELECT rva.*, p.auth_claim_version INTO a FROM rva JOIN public.user_profiles p USING (id) WHERE rva.label = p_label;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a.id, 'session_id', a.session, 'role', 'authenticated',
    'auth_claim_version', a.auth_claim_version, 'iat', extract(epoch FROM clock_timestamp())::bigint)::text, true);
END $$;
CREATE FUNCTION pg_temp.rv_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL871 visits: %', msg; END IF; END $$;
CREATE FUNCTION pg_temp.rv_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
  RAISE EXCEPTION 'COL871 visits: expected 42501 from %', stmt;
END $$;

SELECT pg_temp.rv_assert(NOT has_function_privilege('anon', 'public.family_resident_visits(uuid,integer)', 'EXECUTE'), 'anon can call the family read');
SELECT pg_temp.rv_assert(has_function_privilege('authenticated', 'public.family_resident_visits(uuid,integer)', 'EXECUTE'), 'authenticated cannot call the family read');
SELECT pg_temp.rv_assert(obj_description('public.family_resident_visits(uuid,integer)'::regprocedure, 'pg_proc') LIKE '%COL-37 ruling:%', 'no COL-37 ruling');

-- Staff: the timeline carries A's two unvoided visits, words and all, and nothing of B's.
SELECT pg_temp.rv_login('admin'); SET LOCAL ROLE authenticated;
DO $$
DECLARE x rv; fam record; prov record;
BEGIN
  SELECT * INTO x FROM rv;
  SELECT * INTO fam FROM public.v_resident_timeline t WHERE t.source = 'visit' AND t.source_id = x.v_family;
  SELECT * INTO prov FROM public.v_resident_timeline t WHERE t.source = 'visit' AND t.source_id = x.v_provider;
  PERFORM pg_temp.rv_assert(fam.resident_id = x.res_a AND fam.kind = 'family_friend' AND fam.title = 'Visit from family or a friend'
    AND fam.status = 'signed_out' AND fam.level IS NULL, format('family visit row wrong: %s / %s / %s', fam.kind, fam.title, fam.status));
  PERFORM pg_temp.rv_assert(fam.detail LIKE 'Jordan Pierce. Purpose: Lunch. Left %M.', format('family visit detail wrong: %s', fam.detail));
  PERFORM pg_temp.rv_assert(prov.title = 'Healthcare provider visit' AND prov.status = 'open'
    AND prov.detail = 'Dana Reyes · Sunshine Hospice. Not signed out. Reported symptoms at sign-in.', format('provider visit detail wrong: %s', prov.detail));
  PERFORM pg_temp.rv_assert((SELECT count(*) FROM public.v_resident_timeline t WHERE t.resident_id = x.res_a AND t.source = 'visit') = 2,
    'resident A should show exactly its two unvoided visits');
  PERFORM pg_temp.rv_assert((SELECT count(*) FROM public.v_resident_timeline t WHERE t.resident_id = x.res_b AND t.source = 'visit') = 1,
    'resident B should show its own visit');
  -- Staff are not family: the family read refuses them.
  PERFORM pg_temp.rv_denied(format('SELECT public.family_resident_visits(%L::uuid)', x.res_a));
END $$;
RESET ROLE;

-- Family never reads the building log, through the view or the table.
SELECT pg_temp.rv_login('clinical'); SET LOCAL ROLE authenticated;
SELECT pg_temp.rv_assert((SELECT count(*) FROM public.v_resident_timeline t WHERE t.source = 'visit') = 0, 'family reads visits through the timeline view');
SELECT pg_temp.rv_assert((SELECT count(*) FROM public.visitor_log_entries) = 0, 'family reads the visitor log table');

-- Clinical link, default sharing: both of A's visits, newest first, short names, nothing else.
DO $$
DECLARE x rv; r jsonb;
BEGIN
  SELECT * INTO x FROM rv;
  r := public.family_resident_visits(x.res_a);
  PERFORM pg_temp.rv_assert(r->>'sharing' = 'with_visitor_name', format('default sharing is %s', r->>'sharing'));
  PERFORM pg_temp.rv_assert(jsonb_array_length(r->'visits') = 2, format('clinical link sees %s visits', jsonb_array_length(r->'visits')));
  PERFORM pg_temp.rv_assert(r#>>'{visits,0,id}' = x.v_provider::text AND r#>>'{visits,0,visitor_name}' = 'Dana R.'
    AND r#>>'{visits,1,visitor_name}' = 'Jordan P.' AND r#>>'{visits,0,left_at}' IS NULL AND r#>>'{visits,1,left_at}' IS NOT NULL,
    format('clinical visits wrong: %s', r->'visits'));
  PERFORM pg_temp.rv_assert(NOT (r#>'{visits,0}') ?| ARRAY['visitor_phone', 'visitor_company', 'purpose', 'symptoms_reported', 'resident_id'],
    'family visit carries building-log fields');
  PERFORM pg_temp.rv_denied(format('SELECT public.family_resident_visits(%L::uuid)', x.res_b));
END $$;
RESET ROLE;

-- Non-clinical link: the provider visit is withheld.
SELECT pg_temp.rv_login('non_clinical'); SET LOCAL ROLE authenticated;
SELECT pg_temp.rv_assert(jsonb_array_length(public.family_resident_visits(res_a)->'visits') = 1
  AND public.family_resident_visits(res_a)#>>'{visits,0,id}' = v_family::text, 'non-clinical link sees the provider visit') FROM rv;
RESET ROLE;

-- Revoked link and no link: refused.
SELECT pg_temp.rv_login('revoked'); SET LOCAL ROLE authenticated;
SELECT pg_temp.rv_denied(format('SELECT public.family_resident_visits(%L::uuid)', res_a)) FROM rv;
RESET ROLE;
SELECT pg_temp.rv_login('stranger'); SET LOCAL ROLE authenticated;
SELECT pg_temp.rv_denied(format('SELECT public.family_resident_visits(%L::uuid)', res_a)) FROM rv;
RESET ROLE;

-- The facility setting shapes the read: times only drops names; off returns nothing.
UPDATE public.facility_communication_settings SET family_visit_history = 'times_only' WHERE facility_id = (SELECT site FROM rv);
SELECT pg_temp.rv_login('clinical'); SET LOCAL ROLE authenticated;
SELECT pg_temp.rv_assert(public.family_resident_visits(res_a)->>'sharing' = 'times_only'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.family_resident_visits(res_a)->'visits') v WHERE v->>'visitor_name' IS NOT NULL),
  'times_only still shows visitor names') FROM rv;
RESET ROLE;
UPDATE public.facility_communication_settings SET family_visit_history = 'off' WHERE facility_id = (SELECT site FROM rv);
SELECT pg_temp.rv_login('clinical'); SET LOCAL ROLE authenticated;
SELECT pg_temp.rv_assert(public.family_resident_visits(res_a) = '{"sharing": "off", "visits": []}'::jsonb, 'off still returns visits') FROM rv;
RESET ROLE;
ROLLBACK;
