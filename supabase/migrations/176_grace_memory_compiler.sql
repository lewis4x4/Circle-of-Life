-- Grace Memory Compiler schema
-- Extends the existing KB substrate so Obsidian-authored memory compiles into
-- Haven's governed retrieval runtime rather than a parallel note system.

-- ---------------------------------------------------------------------------
-- documents extensions
-- ---------------------------------------------------------------------------

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS doc_type text,
  ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'manual_upload',
  ADD COLUMN IF NOT EXISTS source_path text,
  ADD COLUMN IF NOT EXISTS canonical_slug text,
  ADD COLUMN IF NOT EXISTS lifecycle_status text,
  ADD COLUMN IF NOT EXISTS facility_scope text,
  ADD COLUMN IF NOT EXISTS facility_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS entity_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS role_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS topic_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS alias_terms text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS grace_priority text,
  ADD COLUMN IF NOT EXISTS grace_answerable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trust_rank integer,
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS review_date date,
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS compiled_at timestamptz,
  ADD COLUMN IF NOT EXISTS compiler_version text;

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_grace_priority_check,
  DROP CONSTRAINT IF EXISTS documents_trust_rank_check,
  DROP CONSTRAINT IF EXISTS documents_lifecycle_status_check;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_grace_priority_check
    CHECK (grace_priority IS NULL OR grace_priority IN ('low', 'medium', 'high', 'critical')),
  ADD CONSTRAINT documents_trust_rank_check
    CHECK (trust_rank IS NULL OR trust_rank BETWEEN 1 AND 5),
  ADD CONSTRAINT documents_lifecycle_status_check
    CHECK (lifecycle_status IS NULL OR lifecycle_status IN ('draft', 'review_pending', 'active', 'archived', 'superseded'));

UPDATE public.documents
SET lifecycle_status = CASE
  WHEN status = 'published' THEN 'active'
  WHEN status = 'pending_review' THEN 'review_pending'
  ELSE lifecycle_status
END
WHERE lifecycle_status IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_canonical_slug
  ON public.documents (workspace_id, canonical_slug)
  WHERE canonical_slug IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_doc_type
  ON public.documents (workspace_id, doc_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_lifecycle_status
  ON public.documents (workspace_id, lifecycle_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_facility_tags
  ON public.documents USING gin (facility_tags);

CREATE INDEX IF NOT EXISTS idx_documents_entity_tags
  ON public.documents USING gin (entity_tags);

CREATE INDEX IF NOT EXISTS idx_documents_role_tags
  ON public.documents USING gin (role_tags);

CREATE INDEX IF NOT EXISTS idx_documents_topic_tags
  ON public.documents USING gin (topic_tags);

CREATE INDEX IF NOT EXISTS idx_documents_alias_terms
  ON public.documents USING gin (alias_terms);

COMMENT ON COLUMN public.documents.doc_type IS 'Canonical memory note class such as policy, grace_pack, ontology_term, facility_override.';
COMMENT ON COLUMN public.documents.source_system IS 'How the document entered Haven: manual_upload, obsidian, api, imported_pdf.';
COMMENT ON COLUMN public.documents.source_path IS 'Vault-relative or source-relative path for compiler-traceable memory docs.';
COMMENT ON COLUMN public.documents.canonical_slug IS 'Stable compiler key used to upsert and reconcile memory notes.';
COMMENT ON COLUMN public.documents.lifecycle_status IS 'Memory governance lifecycle separate from upload publication status.';
COMMENT ON COLUMN public.documents.facility_scope IS 'single, multi, all, org, or entity.';
COMMENT ON COLUMN public.documents.grace_priority IS 'Grace retrieval priority: low, medium, high, critical.';
COMMENT ON COLUMN public.documents.grace_answerable IS 'Whether this document is retrieval-primary for Grace.';
COMMENT ON COLUMN public.documents.trust_rank IS '1-5 trust precedence where 1 is highest.';

-- ---------------------------------------------------------------------------
-- helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_alias_term(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(trim(regexp_replace(lower(coalesce(p_value, '')), '\s+', ' ', 'g')), '');
$$;

COMMENT ON FUNCTION public.normalize_alias_term(text) IS 'Normalizes alias values for compiled knowledge memory.';

-- ---------------------------------------------------------------------------
-- document_aliases
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.document_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES organizations (id),
  document_id uuid NOT NULL REFERENCES public.documents (id) ON DELETE CASCADE,
  alias text NOT NULL,
  alias_normalized text GENERATED ALWAYS AS (public.normalize_alias_term(alias)) STORED,
  alias_kind text NOT NULL DEFAULT 'frontmatter',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_aliases_unique
  ON public.document_aliases (document_id, alias_normalized);

CREATE INDEX IF NOT EXISTS idx_document_aliases_workspace
  ON public.document_aliases (workspace_id, alias_normalized);

ALTER TABLE public.document_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_aliases_select_visible ON public.document_aliases;
CREATE POLICY document_aliases_select_visible ON public.document_aliases
  FOR SELECT
  TO authenticated
  USING (
    workspace_id::text = haven.organization_id()::text
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.id = document_id
        AND d.workspace_id::text = haven.organization_id()::text
        AND d.deleted_at IS NULL
        AND public.document_role_can_view_audience(d.audience, haven.app_role()::text)
    )
  );

DROP POLICY IF EXISTS document_aliases_service_role_rw ON public.document_aliases;
CREATE POLICY document_aliases_service_role_rw ON public.document_aliases
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.document_aliases IS 'Normalized aliases compiled from Obsidian memory and runtime knowledge docs.';

-- ---------------------------------------------------------------------------
-- document_relationships
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.document_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES organizations (id),
  from_document_id uuid NOT NULL REFERENCES public.documents (id) ON DELETE CASCADE,
  to_document_id uuid NOT NULL REFERENCES public.documents (id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_relationships_from
  ON public.document_relationships (from_document_id, relationship_type);

CREATE INDEX IF NOT EXISTS idx_document_relationships_to
  ON public.document_relationships (to_document_id, relationship_type);

CREATE INDEX IF NOT EXISTS idx_document_relationships_workspace
  ON public.document_relationships (workspace_id, relationship_type);

ALTER TABLE public.document_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_relationships_select_visible ON public.document_relationships;
CREATE POLICY document_relationships_select_visible ON public.document_relationships
  FOR SELECT
  TO authenticated
  USING (
    workspace_id::text = haven.organization_id()::text
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.id = from_document_id
        AND d.workspace_id::text = haven.organization_id()::text
        AND d.deleted_at IS NULL
        AND public.document_role_can_view_audience(d.audience, haven.app_role()::text)
    )
  );

DROP POLICY IF EXISTS document_relationships_service_role_rw ON public.document_relationships;
CREATE POLICY document_relationships_service_role_rw ON public.document_relationships
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.document_relationships IS 'Knowledge graph edges between compiled memory documents.';

-- ---------------------------------------------------------------------------
-- document_planning_hints
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.document_planning_hints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES organizations (id),
  document_id uuid NOT NULL REFERENCES public.documents (id) ON DELETE CASCADE,
  route_bias text,
  clarification_prompt text,
  forbidden_substitutions text[] NOT NULL DEFAULT '{}'::text[],
  preferred_answer_shape text,
  preferred_live_tables text[] NOT NULL DEFAULT '{}'::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_planning_hints_document
  ON public.document_planning_hints (document_id);

CREATE INDEX IF NOT EXISTS idx_document_planning_hints_workspace
  ON public.document_planning_hints (workspace_id, route_bias);

ALTER TABLE public.document_planning_hints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_planning_hints_select_visible ON public.document_planning_hints;
CREATE POLICY document_planning_hints_select_visible ON public.document_planning_hints
  FOR SELECT
  TO authenticated
  USING (
    workspace_id::text = haven.organization_id()::text
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.id = document_id
        AND d.workspace_id::text = haven.organization_id()::text
        AND d.deleted_at IS NULL
        AND public.document_role_can_view_audience(d.audience, haven.app_role()::text)
    )
  );

DROP POLICY IF EXISTS document_planning_hints_service_role_rw ON public.document_planning_hints;
CREATE POLICY document_planning_hints_service_role_rw ON public.document_planning_hints
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.document_planning_hints IS 'Structured planner hints compiled from Grace Packs and related control-plane notes.';

-- ---------------------------------------------------------------------------
-- knowledge_contradictions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.knowledge_contradictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES organizations (id),
  left_document_id uuid REFERENCES public.documents (id) ON DELETE CASCADE,
  right_document_id uuid REFERENCES public.documents (id) ON DELETE CASCADE,
  severity text NOT NULL,
  contradiction_type text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users (id)
);

ALTER TABLE public.knowledge_contradictions
  DROP CONSTRAINT IF EXISTS knowledge_contradictions_severity_check,
  DROP CONSTRAINT IF EXISTS knowledge_contradictions_status_check;

ALTER TABLE public.knowledge_contradictions
  ADD CONSTRAINT knowledge_contradictions_severity_check
    CHECK (severity IN ('p0', 'p1', 'p2')),
  ADD CONSTRAINT knowledge_contradictions_status_check
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'suppressed'));

CREATE INDEX IF NOT EXISTS idx_knowledge_contradictions_workspace
  ON public.knowledge_contradictions (workspace_id, status, severity);

CREATE INDEX IF NOT EXISTS idx_knowledge_contradictions_left
  ON public.knowledge_contradictions (left_document_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_contradictions_right
  ON public.knowledge_contradictions (right_document_id);

ALTER TABLE public.knowledge_contradictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_contradictions_select_admin ON public.knowledge_contradictions;
CREATE POLICY knowledge_contradictions_select_admin ON public.knowledge_contradictions
  FOR SELECT
  TO authenticated
  USING (
    workspace_id::text = haven.organization_id()::text
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS knowledge_contradictions_update_admin ON public.knowledge_contradictions;
CREATE POLICY knowledge_contradictions_update_admin ON public.knowledge_contradictions
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id::text = haven.organization_id()::text
    AND haven.app_role() IN ('owner', 'org_admin')
  )
  WITH CHECK (
    workspace_id::text = haven.organization_id()::text
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS knowledge_contradictions_service_role_rw ON public.knowledge_contradictions;
CREATE POLICY knowledge_contradictions_service_role_rw ON public.knowledge_contradictions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.knowledge_contradictions IS 'Compiler-detected contradictions, alias collisions, and stale-memory conflicts.';

-- ---------------------------------------------------------------------------
-- memory_compiler_runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.memory_compiler_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES organizations (id),
  source_system text NOT NULL DEFAULT 'obsidian',
  vault_path text,
  status text NOT NULL DEFAULT 'pending',
  compiler_version text,
  documents_seen integer NOT NULL DEFAULT 0,
  documents_compiled integer NOT NULL DEFAULT 0,
  contradictions_found integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.memory_compiler_runs
  DROP CONSTRAINT IF EXISTS memory_compiler_runs_status_check;

ALTER TABLE public.memory_compiler_runs
  ADD CONSTRAINT memory_compiler_runs_status_check
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'partial'));

CREATE INDEX IF NOT EXISTS idx_memory_compiler_runs_workspace
  ON public.memory_compiler_runs (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_compiler_runs_status
  ON public.memory_compiler_runs (status, started_at DESC);

ALTER TABLE public.memory_compiler_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_compiler_runs_select_admin ON public.memory_compiler_runs;
CREATE POLICY memory_compiler_runs_select_admin ON public.memory_compiler_runs
  FOR SELECT
  TO authenticated
  USING (
    workspace_id::text = haven.organization_id()::text
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS memory_compiler_runs_service_role_rw ON public.memory_compiler_runs;
CREATE POLICY memory_compiler_runs_service_role_rw ON public.memory_compiler_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.memory_compiler_runs IS 'Explicit lineage for Obsidian memory compiler runs and publish attempts.';
