-- Shared insurance guard functions required by the InsureFlow synthetic receiver
-- (448_insureflow_synthetic_receiver.sql).
--
-- These three functions were authored in 336_insurance_verified_workspace.sql on
-- branch codex/haven-insureflow-receiver. That branch also carried an insurance
-- workspace, servicing, document-intake and extraction build whose page refactor
-- predates main's React Query migration, its organisation-gap card and COL-465's
-- HUD 232 triage — merging it would have reverted shipped work. Only the receiver
-- was carried across (COL-514), so its three function dependencies come with it.
--
-- The bodies are verbatim from 336 so behaviour is identical. They are written as
-- CREATE OR REPLACE rather than CREATE so replay is idempotent. IF THE WORKSPACE
-- BUILD IS EVER REVIVED, these three definitions must be removed from 336 or
-- changed to CREATE OR REPLACE, or that migration will fail on "already exists".
--
-- Dependencies: auth.users, auth.sessions, public.user_profiles,
-- haven.current_authorized_actor() — all present on main.

CREATE OR REPLACE FUNCTION haven.insurance_immutable_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Approved insurance history is immutable' USING ERRCODE='42501'; END $$;

CREATE OR REPLACE FUNCTION haven.insurance_lock_actor(p_actor uuid,p_org uuid,p_roles text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR SHARE;
 PERFORM 1 FROM auth.sessions WHERE id=nullif(auth.jwt()->>'session_id','')::uuid AND user_id=p_actor FOR SHARE;
 PERFORM 1 FROM public.user_profiles WHERE id=p_actor FOR SHARE;
 SELECT * INTO a FROM haven.current_authorized_actor();
 IF a.actor_user_id IS DISTINCT FROM p_actor OR a.actor_organization_id IS DISTINCT FROM p_org OR NOT coalesce(a.actor_role_text=ANY(p_roles),false) THEN RAISE EXCEPTION 'Authentication required after waiting; sign in again' USING ERRCODE='28000'; END IF;
END $$;

CREATE OR REPLACE FUNCTION haven.insurance_lock_processing_actor(p_actor uuid,p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR SHARE;
 PERFORM 1 FROM public.user_profiles WHERE id=p_actor FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=p_actor AND p.organization_id=p_org AND p.app_role IN('owner','org_admin') AND p.is_active AND p.deleted_at IS NULL AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN RAISE EXCEPTION 'Current insurance manager required after waiting' USING ERRCODE='42501'; END IF;
END $$;
