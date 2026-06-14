-- ============================================================================
-- 302_workspace_comments.sql
-- Module 36 (Employee Workspace) — F3-7 Comments + @mentions
--
-- Generic threaded comments attachable to a workspace subject (page, card,
-- handoff note, team space). Visibility INHERITS the subject: a comment is
-- readable only if the reader can SELECT the subject row (RLS subqueries are
-- themselves RLS-filtered), or is the author, or is @mentioned. Audit-logged,
-- soft deletes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  subject_type text NOT NULL CHECK (subject_type IN (
    'workspace_page', 'workspace_card', 'shift_handoff_note', 'team_space'
  )),
  subject_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES auth.users(id),
  body text NOT NULL,
  -- Denormalized for fast "my mentions" queries + notification fan-out
  mentioned_user_ids uuid[] NOT NULL DEFAULT '{}',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workspace_comments_subject
  ON workspace_comments(subject_type, subject_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_comments_mentions
  ON workspace_comments USING gin (mentioned_user_ids)
  WHERE deleted_at IS NULL;

CREATE TRIGGER workspace_comments_set_updated_at
  BEFORE UPDATE ON workspace_comments
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — inherits subject visibility
-- ----------------------------------------------------------------------------

ALTER TABLE workspace_comments ENABLE ROW LEVEL SECURITY;

-- Helper predicate (inlined): can the current user see the subject row?
-- Subqueries below are RLS-filtered for auth.uid(), so EXISTS is true only when
-- the subject is visible to the reader under its own policies.

CREATE POLICY "Read comments when subject visible or mentioned"
  ON workspace_comments FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      author_user_id = auth.uid()
      OR auth.uid() = ANY (mentioned_user_ids)
      OR (subject_type = 'workspace_page'
          AND EXISTS (SELECT 1 FROM workspace_pages p WHERE p.id = workspace_comments.subject_id))
      OR (subject_type = 'workspace_card'
          AND EXISTS (SELECT 1 FROM workspace_cards c WHERE c.id = workspace_comments.subject_id))
      OR (subject_type = 'shift_handoff_note'
          AND EXISTS (SELECT 1 FROM shift_handoff_notes h WHERE h.id = workspace_comments.subject_id))
      OR (subject_type = 'team_space'
          AND EXISTS (SELECT 1 FROM team_spaces s WHERE s.id = workspace_comments.subject_id))
    )
  );

-- Author may comment only on a subject they can see.
CREATE POLICY "Comment on visible subjects"
  ON workspace_comments FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND author_user_id = auth.uid()
    AND (
      (subject_type = 'workspace_page'
        AND EXISTS (SELECT 1 FROM workspace_pages p WHERE p.id = workspace_comments.subject_id))
      OR (subject_type = 'workspace_card'
        AND EXISTS (SELECT 1 FROM workspace_cards c WHERE c.id = workspace_comments.subject_id))
      OR (subject_type = 'shift_handoff_note'
        AND EXISTS (SELECT 1 FROM shift_handoff_notes h WHERE h.id = workspace_comments.subject_id))
      OR (subject_type = 'team_space'
        AND EXISTS (SELECT 1 FROM team_spaces s WHERE s.id = workspace_comments.subject_id))
    )
  );

-- Author edits/soft-deletes their own comment.
CREATE POLICY "Authors update their own comments"
  ON workspace_comments FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND author_user_id = auth.uid()
  );

CREATE TRIGGER workspace_comments_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON workspace_comments
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

COMMENT ON TABLE workspace_comments IS
  'Threaded comments + @mentions on workspace subjects; RLS inherits subject visibility. Module 36 F3-7.';
