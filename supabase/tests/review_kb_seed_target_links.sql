-- COL-710: knowledge coverage is computed from linked, published documents.
-- Disposable local replay only; everything rolls back.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
-- The replay has no Supabase default privileges; hosted grants SELECT on these tables.
GRANT SELECT ON public.kb_seed_targets, public.documents, public.user_profiles TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
CREATE FUNCTION pg_temp.kb710_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%', msg; END IF; END $$;

CREATE TEMP TABLE kb710 AS
SELECT gen_random_uuid() owner_id, gen_random_uuid() owner_session, gen_random_uuid() tech_id, gen_random_uuid() tech_session,
  gen_random_uuid() doc, gen_random_uuid() other_org, gen_random_uuid() other_doc,
  (SELECT id FROM public.kb_seed_targets WHERE workspace_id IS NULL ORDER BY priority DESC LIMIT 1) target,
  f.organization_id org
FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
SELECT pg_temp.kb710_assert((SELECT org IS NOT NULL AND target IS NOT NULL FROM kb710), 'Replay seed facility and global seed targets required');
GRANT SELECT ON kb710 TO authenticated;

INSERT INTO public.organizations(id, name) SELECT other_org, 'COL-710 other org' FROM kb710;
INSERT INTO public.documents(id, workspace_id, title, status) SELECT doc, org, 'COL-710 medication pass SOP', 'published' FROM kb710
UNION ALL SELECT other_doc, other_org, 'COL-710 other org doc', 'published' FROM kb710;

INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
SELECT owner_id, owner_id||'@review.invalid', jsonb_build_object('organization_id', org, 'app_role', 'owner'), '{}'::jsonb FROM kb710
UNION ALL SELECT tech_id, tech_id||'@review.invalid', jsonb_build_object('organization_id', org, 'app_role', 'med_tech'), '{}'::jsonb FROM kb710;
INSERT INTO public.user_profiles(id, email, full_name, app_role, organization_id, is_active)
SELECT owner_id, owner_id||'@review.invalid', 'Review owner', 'owner'::public.app_role, org, true FROM kb710
UNION ALL SELECT tech_id, tech_id||'@review.invalid', 'Review tech', 'med_tech'::public.app_role, org, true FROM kb710
ON CONFLICT (id) DO UPDATE SET organization_id = excluded.organization_id, app_role = excluded.app_role, is_active = true;
INSERT INTO auth.sessions(id, user_id) SELECT owner_session, owner_id FROM kb710 UNION ALL SELECT tech_session, tech_id FROM kb710;

CREATE FUNCTION pg_temp.kb710_act_as(p_user uuid, p_session uuid, p_role text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'session_id', p_session,
    'iat', extract(epoch FROM clock_timestamp())::bigint, 'auth_claim_version', p.auth_claim_version,
    'role', 'authenticated', 'app_role', p_role, 'organization_id', p.organization_id,
    'app_metadata', jsonb_build_object('app_role', p_role, 'organization_id', p.organization_id))::text, true)
  FROM public.user_profiles p WHERE p.id = p_user
$$;

-- Before any link: the global topic is uncovered even though a published document exists.
SELECT pg_temp.kb710_act_as(owner_id, owner_session, 'owner') FROM kb710;
SET LOCAL ROLE authenticated;
SELECT pg_temp.kb710_assert((SELECT effective_status = 'uncovered' FROM public.vw_kb_seed_target_status WHERE seed_target_id = (SELECT target FROM kb710)), 'Topic covered with no link');

-- An owner can link a published document to a GLOBAL topic (243 made this impossible).
INSERT INTO public.kb_seed_target_links(workspace_id, seed_target_id, document_id) SELECT org, target, doc FROM kb710;
SELECT pg_temp.kb710_assert((SELECT effective_status = 'covered' AND published_documents = 1 FROM public.vw_kb_seed_target_status WHERE seed_target_id = (SELECT target FROM kb710)), 'Linked published document did not cover the topic');
SELECT pg_temp.kb710_assert((SELECT covered_count = 1 FROM public.vw_kb_seed_target_coverage), 'Coverage rollup did not count the linked topic');

-- Another organization's document cannot be linked.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.kb_seed_target_links(workspace_id, seed_target_id, document_id) SELECT org, target, other_doc FROM kb710;
    RAISE EXCEPTION 'Cross-organization document link accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- A link cannot be repointed.
DO $$ BEGIN
  BEGIN
    UPDATE public.kb_seed_target_links SET document_id = document_id WHERE document_id = (SELECT doc FROM kb710);
    RAISE EXCEPTION 'Link repoint accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- A med-tech cannot link.
SELECT pg_temp.kb710_act_as(tech_id, tech_session, 'med_tech') FROM kb710;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.kb_seed_target_links(workspace_id, seed_target_id, document_id)
      SELECT org, (SELECT id FROM public.kb_seed_targets WHERE workspace_id IS NULL ORDER BY priority ASC LIMIT 1), doc FROM kb710;
    RAISE EXCEPTION 'Med-tech link accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Archiving the document uncovers the topic with no edit to the topic.
UPDATE public.documents SET status = 'archived' WHERE id = (SELECT doc FROM kb710);
SELECT pg_temp.kb710_act_as(owner_id, owner_session, 'owner') FROM kb710;
SET LOCAL ROLE authenticated;
SELECT pg_temp.kb710_assert((SELECT effective_status = 'uncovered' FROM public.vw_kb_seed_target_status WHERE seed_target_id = (SELECT target FROM kb710)), 'Archived document still covers the topic');

-- Unlink is a soft delete by the owner.
UPDATE public.kb_seed_target_links SET deleted_at = now() WHERE document_id = (SELECT doc FROM kb710);
SELECT pg_temp.kb710_assert((SELECT count(*) = 1 FROM public.kb_seed_target_links WHERE document_id = (SELECT doc FROM kb710) AND deleted_at IS NOT NULL AND deleted_by = (SELECT owner_id FROM kb710)), 'Unlink did not record who removed it');
RESET ROLE;

SELECT pg_temp.kb710_assert(NOT has_table_privilege('anon', 'public.kb_seed_target_links', 'SELECT'), 'Topic links readable by anon');
SELECT pg_temp.kb710_assert(NOT has_table_privilege('authenticated', 'public.kb_seed_target_links', 'DELETE'), 'Topic links hard-deletable');
SELECT 'COL-710 knowledge topic links PASS' result;
ROLLBACK;
