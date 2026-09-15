-- Local rollback-only probe: allow_phi cannot be true without a recorded BAA (migration 389).
BEGIN;
CREATE TEMP TABLE baa_org AS SELECT gen_random_uuid() org, gen_random_uuid() verifier;
INSERT INTO public.organizations(id, name) SELECT org, 'Synthetic BAA organization' FROM baa_org;
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data) SELECT verifier, verifier||'@example.invalid', jsonb_build_object('organization_id', org, 'app_role', 'owner'), '{}' FROM baa_org;
INSERT INTO public.user_profiles(id, organization_id, full_name, email, app_role, is_active) SELECT verifier, org, 'Synthetic BAA verifier', verifier||'@example.invalid', 'owner', true FROM baa_org;
CREATE FUNCTION pg_temp.baa_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%', msg; END IF; END $$;
CREATE FUNCTION pg_temp.baa_error(stmt text, code text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE = code THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected SQLSTATE %', code; END $$;

-- A policy that allows PHI with no BAA on record is refused at the table.
SELECT pg_temp.baa_error(format($q$INSERT INTO public.ai_invocation_policies(organization_id, allow_phi) VALUES (%L, true)$q$, org), '23514') FROM baa_org;
-- A blank reference is not a reference.
SELECT pg_temp.baa_error(format($q$INSERT INTO public.ai_invocation_policies(organization_id, allow_phi, baa_reference, baa_verified_at, baa_verified_by) VALUES (%L, true, '   ', now(), %L)$q$, org, verifier), '23514') FROM baa_org;
-- Verified-at without a verifier is not enough either.
SELECT pg_temp.baa_error(format($q$INSERT INTO public.ai_invocation_policies(organization_id, allow_phi, baa_reference, baa_verified_at) VALUES (%L, true, 'BAA-2026-001', now())$q$, org), '23514') FROM baa_org;

-- The manual-path posture is always allowed.
INSERT INTO public.ai_invocation_policies(organization_id, allow_phi) SELECT org, false FROM baa_org;
-- Turning PHI on later requires the BAA in the same statement.
SELECT pg_temp.baa_error(format($q$UPDATE public.ai_invocation_policies SET allow_phi = true WHERE organization_id = %L$q$, org), '23514') FROM baa_org;
UPDATE public.ai_invocation_policies p SET allow_phi = true, baa_reference = 'BAA-2026-001', baa_verified_at = now(), baa_verified_by = b.verifier FROM baa_org b WHERE p.organization_id = b.org;
SELECT pg_temp.baa_assert((SELECT allow_phi FROM public.ai_invocation_policies p JOIN baa_org b ON p.organization_id = b.org), 'PHI allowed once the BAA is recorded');
-- Removing the BAA record while PHI stays on is refused.
SELECT pg_temp.baa_error(format($q$UPDATE public.ai_invocation_policies SET baa_verified_at = NULL WHERE organization_id = %L$q$, org), '23514') FROM baa_org;
ROLLBACK;
