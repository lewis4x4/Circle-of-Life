-- COL-710: knowledge-base coverage is computed from linked, published documents.
--
-- /admin/knowledge/coverage read "0/12 topics covered" beside 23 published
-- documents. Two reasons, both structural:
--   1. The 12 topics are global defaults (kb_seed_targets.workspace_id IS NULL)
--      and 243's RLS only lets an org update its own rows, so no organization
--      could ever mark a global topic covered.
--   2. `covered_document_id` was never written by the app; "covered" was a
--      hand-set status with no document behind it, and it stayed "covered"
--      after the document was archived or deleted.
--
-- kb_seed_target_links records "this published document answers this topic"
-- per organization, for global and org topics alike. A topic is covered for an
-- organization while at least one of its linked documents is published and
-- not deleted; unpublish or delete the document and the topic is uncovered
-- again, with nobody editing the topic. The hand-set 'covered' status no
-- longer counts; 'wip' and 'retired' on org topics still do.
--
-- Production had no org topics and no covered_document_id (2026-09-23); any
-- environment that does gets a link backfilled from it.
--
-- documents.workspace_id is text on production and uuid on staging (schema
-- drift predating this file), so comparisons with it are made as text.

BEGIN;

CREATE TABLE IF NOT EXISTS public.kb_seed_target_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  seed_target_id uuid NOT NULL REFERENCES public.kb_seed_targets(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  linked_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  linked_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_seed_target_links_active
  ON public.kb_seed_target_links (workspace_id, seed_target_id, document_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_kb_seed_target_links_document
  ON public.kb_seed_target_links (document_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.kb_seed_target_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read their knowledge topic links" ON public.kb_seed_target_links;
CREATE POLICY "Org members read their knowledge topic links" ON public.kb_seed_target_links
  FOR SELECT TO authenticated
  USING (workspace_id = (SELECT haven.organization_id()));

-- The document must belong to the organization and the topic must be a global
-- default or the organization's own.
DROP POLICY IF EXISTS "Owners link their documents to knowledge topics" ON public.kb_seed_target_links;
CREATE POLICY "Owners link their documents to knowledge topics" ON public.kb_seed_target_links
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = (SELECT haven.organization_id())
    AND (SELECT haven.app_role()) IN ('owner', 'org_admin')
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = kb_seed_target_links.document_id
        AND d.workspace_id::text = kb_seed_target_links.workspace_id::text
        AND d.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.kb_seed_targets t
      WHERE t.id = kb_seed_target_links.seed_target_id
        AND (t.workspace_id IS NULL OR t.workspace_id = kb_seed_target_links.workspace_id)
    )
  );

-- Unlinking is a soft delete.
DROP POLICY IF EXISTS "Owners unlink their knowledge topic links" ON public.kb_seed_target_links;
CREATE POLICY "Owners unlink their knowledge topic links" ON public.kb_seed_target_links
  FOR UPDATE TO authenticated
  USING (
    workspace_id = (SELECT haven.organization_id())
    AND (SELECT haven.app_role()) IN ('owner', 'org_admin')
  )
  WITH CHECK (
    workspace_id = (SELECT haven.organization_id())
    AND (SELECT haven.app_role()) IN ('owner', 'org_admin')
  );

-- Only the soft-delete columns may change after insert.
CREATE OR REPLACE FUNCTION public._kb_seed_target_links_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.seed_target_id IS DISTINCT FROM OLD.seed_target_id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.linked_by IS DISTINCT FROM OLD.linked_by
     OR NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
    RAISE EXCEPTION 'A knowledge topic link cannot be repointed; unlink it and link again'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This knowledge topic link was already removed' USING ERRCODE = '42501';
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kb_seed_target_links_guard ON public.kb_seed_target_links;
CREATE TRIGGER trg_kb_seed_target_links_guard
  BEFORE UPDATE ON public.kb_seed_target_links
  FOR EACH ROW EXECUTE FUNCTION public._kb_seed_target_links_guard();

REVOKE ALL ON public.kb_seed_target_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.kb_seed_target_links TO authenticated;
GRANT UPDATE (deleted_at) ON public.kb_seed_target_links TO authenticated;
GRANT ALL ON public.kb_seed_target_links TO service_role;

-- Backfill from the old column where anything used it.
INSERT INTO public.kb_seed_target_links (workspace_id, seed_target_id, document_id, linked_by, linked_at)
SELECT d.workspace_id::uuid, t.id, t.covered_document_id, NULL, t.updated_at
FROM public.kb_seed_targets t
JOIN public.documents d ON d.id = t.covered_document_id
WHERE t.covered_document_id IS NOT NULL
  AND (t.workspace_id IS NULL OR t.workspace_id::text = d.workspace_id::text)
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN public.kb_seed_targets.covered_document_id IS
  'Superseded by kb_seed_target_links (COL-710); not read for coverage.';
COMMENT ON TABLE public.kb_seed_target_links IS
  'COL-710: which published knowledge-base documents answer which seed topic, per organization. Coverage is computed from these links.';

-- Per-topic effective status for the caller's organization.
CREATE OR REPLACE VIEW public.vw_kb_seed_target_status
WITH (security_invoker = true)
AS
SELECT
  t.id AS seed_target_id,
  (SELECT haven.organization_id()) AS workspace_id,
  CASE
    WHEN t.workspace_id IS NOT NULL AND t.status = 'retired' THEN 'retired'
    WHEN COALESCE(l.published_documents, 0) > 0 THEN 'covered'
    WHEN t.workspace_id IS NOT NULL AND t.status = 'wip' THEN 'wip'
    ELSE 'uncovered'
  END AS effective_status,
  COALESCE(l.published_documents, 0)::integer AS published_documents
FROM public.kb_seed_targets t
LEFT JOIN LATERAL (
  SELECT count(*) AS published_documents
  FROM public.kb_seed_target_links k
  JOIN public.documents d ON d.id = k.document_id
  WHERE k.seed_target_id = t.id
    AND k.workspace_id = (SELECT haven.organization_id())
    AND k.deleted_at IS NULL
    AND d.deleted_at IS NULL
    AND d.status = 'published'
) l ON true
WHERE t.workspace_id IS NULL OR t.workspace_id = (SELECT haven.organization_id());

REVOKE ALL ON public.vw_kb_seed_target_status FROM PUBLIC, anon;
GRANT SELECT ON public.vw_kb_seed_target_status TO authenticated;

COMMENT ON VIEW public.vw_kb_seed_target_status IS
  'COL-710: per-topic coverage for the caller''s organization. covered = at least one linked document is published and not deleted.';

-- Same columns as 243's rollup, now counted from the effective status.
CREATE OR REPLACE VIEW public.vw_kb_seed_target_coverage
WITH (security_invoker = true)
AS
SELECT
  (SELECT haven.organization_id()) AS workspace_id,
  COUNT(*) FILTER (WHERE s.effective_status = 'covered') AS covered_count,
  COUNT(*) FILTER (WHERE s.effective_status = 'wip') AS wip_count,
  COUNT(*) FILTER (WHERE s.effective_status = 'uncovered') AS uncovered_count,
  COUNT(*) FILTER (WHERE s.effective_status = 'retired') AS retired_count,
  COUNT(*) AS total_targets,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE s.effective_status = 'covered') /
      NULLIF(COUNT(*) FILTER (WHERE s.effective_status IN ('covered', 'wip', 'uncovered')), 0),
    1
  ) AS covered_pct
FROM public.vw_kb_seed_target_status s
HAVING (SELECT haven.organization_id()) IS NOT NULL;

GRANT SELECT ON public.vw_kb_seed_target_coverage TO authenticated;

COMMENT ON VIEW public.vw_kb_seed_target_coverage IS
  'KB-NEXT-07 rollup; since COL-710 counted from vw_kb_seed_target_status (linked published documents), not the hand-set status.';

COMMIT;

NOTIFY pgrst, 'reload schema';
