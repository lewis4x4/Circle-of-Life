-- Replace hard DELETE on draft journal_entries with soft delete (deleted_at) per repo financial-data rules.
-- Cascade soft-delete to journal_entry_lines when the parent draft is soft-deleted.

DROP POLICY IF EXISTS journal_entries_delete_draft ON journal_entries;

-- When a draft journal entry is soft-deleted, mark its lines so audit/RLS stay consistent.
CREATE OR REPLACE FUNCTION public.haven_cascade_journal_entry_lines_soft_delete ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.deleted_at IS NOT NULL
    AND (OLD.deleted_at IS NULL)
    AND NEW.status = 'draft'::journal_entry_status THEN
    UPDATE
      journal_entry_lines
    SET
      deleted_at = NEW.deleted_at
    WHERE
      journal_entry_id = NEW.id
      AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS tr_journal_entries_cascade_soft_delete_lines ON journal_entries;

CREATE TRIGGER tr_journal_entries_cascade_soft_delete_lines
  AFTER UPDATE OF deleted_at ON journal_entries
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_cascade_journal_entry_lines_soft_delete ();
