-- ============================================================================
-- 298_workspace_publish_requests.sql
-- Module 36 (Employee Workspace) — F3-3 Publish-to-group workflow (F0-4)
--
-- Governed promotion of a private workspace page into the Knowledge Base:
--   draft (workspace_pages) → submit → facility_admin/DON review →
--   publish into public.documents (KB).
-- The request carries an immutable body snapshot; on publish a KB document row
-- is created and linked. Audit-logged, soft deletes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_publish_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid REFERENCES facilities(id),

  page_id uuid NOT NULL REFERENCES workspace_pages(id),
  requested_by uuid NOT NULL REFERENCES auth.users(id),

  -- Snapshot at submission (immutable record of what was reviewed)
  title text NOT NULL,
  body text NOT NULL,
  target_audience text NOT NULL DEFAULT 'company_wide',
  rationale text,

  status text NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'approved', 'rejected', 'published'
  )),
  reviewer_id uuid REFERENCES auth.users(id),
  review_notes text,
  reviewed_at timestamptz,
  published_document_id uuid REFERENCES public.documents(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workspace_publish_requests_status
  ON workspace_publish_requests(organization_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_publish_requests_requester
  ON workspace_publish_requests(requested_by, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER workspace_publish_requests_set_updated_at
  BEFORE UPDATE ON workspace_publish_requests
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

ALTER TABLE workspace_publish_requests ENABLE ROW LEVEL SECURITY;

-- Requester sees their own; reviewers (facility_admin/DON tier) see the queue.
CREATE POLICY "Requesters and reviewers see publish requests"
  ON workspace_publish_requests FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      requested_by = auth.uid()
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
    )
  );

-- Authors submit a request for a page they own.
CREATE POLICY "Authors submit publish requests"
  ON workspace_publish_requests FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND requested_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_pages p
      WHERE p.id = workspace_publish_requests.page_id
        AND p.owner_user_id = auth.uid()
    )
  );

-- Reviewers transition status (approve/reject/publish).
CREATE POLICY "Reviewers act on publish requests"
  ON workspace_publish_requests FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  );

-- No DELETE policy: soft deletes only.

CREATE TRIGGER workspace_publish_requests_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON workspace_publish_requests
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

COMMENT ON TABLE workspace_publish_requests IS
  'F0-4 governed publish: private workspace page → facility_admin/DON review → KB document. Module 36 F3-3.';
