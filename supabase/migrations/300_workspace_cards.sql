-- ============================================================================
-- 300_workspace_cards.sql
-- Module 36 (Employee Workspace) — F3-5 Personal kanban
--
-- Private per-employee kanban cards (todo / in_progress / done). The board also
-- surfaces the user's live OCE task instances read-only (OCE remains the system
-- of record); a card may optionally reference an OCE instance for context.
-- Audit-logged, soft deletes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid REFERENCES facilities(id),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),

  title text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  position integer NOT NULL DEFAULT 0,
  due_date date,
  -- Optional link to an OCE task instance for context (no FK ownership change)
  source_oce_instance_id uuid REFERENCES operation_task_instances(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workspace_cards_owner_status
  ON workspace_cards(owner_user_id, status, position)
  WHERE deleted_at IS NULL;

CREATE TRIGGER workspace_cards_set_updated_at
  BEFORE UPDATE ON workspace_cards
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — owner-private
-- ----------------------------------------------------------------------------

ALTER TABLE workspace_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners see their own workspace cards"
  ON workspace_cards FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "Owners create their own workspace cards"
  ON workspace_cards FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "Owners update their own workspace cards"
  ON workspace_cards FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND owner_user_id = auth.uid()
  );

-- No DELETE policy: soft deletes only.

CREATE TRIGGER workspace_cards_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON workspace_cards
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

COMMENT ON TABLE workspace_cards IS
  'Private personal kanban cards (todo/in_progress/done). Board also surfaces the user''s OCE tasks read-only. Module 36 F3-5.';
