-- ============================================================
-- 149 — Search Tool Dashboard: policies + audit log
-- Adds RBAC-configurable tool access matrix and real-time
-- search audit logging for the admin dashboard.
-- ============================================================

-- ── Search tool tier enum ────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.search_tool_tier AS ENUM (
    'kb_documents',
    'clinical',
    'operational',
    'financial',
    'payroll'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── search_tool_policies ─────────────────────────────────────
-- One row per tool × role. Admins toggle `enabled` in the UI.
CREATE TABLE IF NOT EXISTS public.search_tool_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tool_name     text NOT NULL,
  tool_tier     public.search_tool_tier NOT NULL,
  app_role      text NOT NULL,
  enabled       boolean NOT NULL DEFAULT false,
  updated_by    uuid REFERENCES auth.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, tool_name, app_role)
);

COMMENT ON TABLE public.search_tool_policies IS
  'RBAC matrix — which roles can invoke which search tools. Toggled by Owner/Facility Admin in admin settings.';

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_stp_org ON public.search_tool_policies(organization_id);
CREATE INDEX IF NOT EXISTS idx_stp_tool ON public.search_tool_policies(tool_name);
CREATE INDEX IF NOT EXISTS idx_stp_role ON public.search_tool_policies(app_role);

-- RLS
ALTER TABLE public.search_tool_policies ENABLE ROW LEVEL SECURITY;

-- Owners & org_admins can do anything; facility_admins can view
DROP POLICY IF EXISTS stp_select ON public.search_tool_policies;
CREATE POLICY stp_select ON public.search_tool_policies FOR SELECT TO authenticated
  USING (organization_id = haven.organization_id());

DROP POLICY IF EXISTS stp_manage ON public.search_tool_policies;
CREATE POLICY stp_manage ON public.search_tool_policies FOR ALL TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- ── search_audit_log ─────────────────────────────────────────
-- Immutable append-only log of every search tool invocation.
CREATE TABLE IF NOT EXISTS public.search_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  facility_id   uuid REFERENCES public.facilities(id) ON DELETE SET NULL,
  user_id       uuid NOT NULL REFERENCES auth.users(id),
  user_email    text,
  app_role      text NOT NULL,
  tool_name     text NOT NULL,
  tool_tier     public.search_tool_tier NOT NULL,
  query_text    text,
  results_count integer DEFAULT 0,
  duration_ms   integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.search_audit_log IS
  'Immutable audit trail of search tool invocations — powers the real-time activity feed in admin dashboard.';

-- Indexes for live feed + analytics
CREATE INDEX IF NOT EXISTS idx_sal_org_created ON public.search_audit_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sal_user ON public.search_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_sal_tool ON public.search_audit_log(tool_name);

-- RLS
ALTER TABLE public.search_audit_log ENABLE ROW LEVEL SECURITY;

-- Owner/org_admin/facility_admin can read; all authenticated users can insert (their own)
DROP POLICY IF EXISTS sal_select ON public.search_audit_log;
CREATE POLICY sal_select ON public.search_audit_log FOR SELECT TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

REVOKE INSERT, UPDATE, DELETE ON public.search_audit_log FROM authenticated;
GRANT SELECT ON public.search_audit_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_tool_policies TO authenticated;

-- ── Enable Realtime on search_audit_log ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'search_audit_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.search_audit_log;
  END IF;
END $$;

-- ── Seed default policies (Circle of Life defaults) ──────────
-- This uses a DO block so it's idempotent and org-independent.
-- Actual seeding happens at app level via the admin UI or
-- an Edge Function on org creation. This is the reference matrix.

-- For documentation, the default policy matrix is:
-- tool_name              | tier          | caregiver | nurse | facility_admin | owner
-- semantic_kb_search     | kb_documents  | yes       | yes   | yes            | yes
-- resident_lookup        | clinical      | yes       | yes   | yes            | yes
-- daily_ops_search       | clinical      | yes       | yes   | yes            | yes
-- medication_search      | clinical      | yes       | yes   | yes            | yes
-- incident_search        | clinical      | yes       | yes   | yes            | yes
-- census_snapshot        | clinical      | yes       | yes   | yes            | yes
-- staff_directory        | operational   | no        | yes   | yes            | yes
-- compliance_search      | operational   | no        | yes   | yes            | yes
-- billing_search         | financial     | no        | no    | yes            | yes
-- payroll_search         | payroll       | no        | no    | yes            | yes
