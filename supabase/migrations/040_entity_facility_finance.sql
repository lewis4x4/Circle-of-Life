-- Module 17 — Entity & Facility Finance (spec 17-entity-facility-finance.md)
-- RLS helpers: haven.organization_id(), haven.accessible_facility_ids(), haven.app_role()
-- Triggers: public.haven_set_updated_at, public.haven_capture_audit_log

CREATE TYPE gl_account_type AS ENUM (
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense'
);

CREATE TYPE journal_entry_status AS ENUM (
  'draft',
  'posted',
  'voided'
);

-- ============================================================
-- CHART OF ACCOUNTS
-- ============================================================
CREATE TABLE gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  code text NOT NULL,
  name text NOT NULL,
  account_type gl_account_type NOT NULL,
  parent_account_id uuid REFERENCES gl_accounts (id),
  is_active boolean NOT NULL DEFAULT TRUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_gl_accounts_code_unique ON gl_accounts (entity_id, code)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_gl_accounts_org_entity ON gl_accounts (organization_id, entity_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_gl_accounts_entity ON gl_accounts (entity_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- JOURNAL ENTRIES
-- ============================================================
CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  facility_id uuid REFERENCES facilities (id),
  entry_date date NOT NULL,
  memo text,
  status journal_entry_status NOT NULL DEFAULT 'draft',
  posted_at timestamptz,
  posted_by uuid REFERENCES auth.users (id),
  source_type text,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_journal_entries_org ON journal_entries (organization_id, entry_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_journal_entries_entity ON journal_entries (entity_id, entry_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_journal_entries_facility ON journal_entries (facility_id, entry_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_journal_entries_status ON journal_entries (organization_id, status)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- JOURNAL ENTRY LINES
-- ============================================================
CREATE TABLE journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  gl_account_id uuid NOT NULL REFERENCES gl_accounts (id),
  line_number integer NOT NULL,
  description text,
  debit_cents integer NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents integer NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  CHECK (
    (debit_cents > 0 AND credit_cents = 0)
    OR (credit_cents > 0 AND debit_cents = 0)
    OR (debit_cents = 0 AND credit_cents = 0)
  ),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_journal_lines_entry ON journal_entry_lines (journal_entry_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_journal_lines_account ON journal_entry_lines (gl_account_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- Balance validation when posting
-- ============================================================
CREATE OR REPLACE FUNCTION public.haven_validate_journal_entry_balanced ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
DECLARE
  d bigint;
  c bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'posted'::journal_entry_status AND OLD.status = 'draft'::journal_entry_status THEN
    SELECT
      COALESCE(SUM(debit_cents), 0),
      COALESCE(SUM(credit_cents), 0) INTO d,
      c
    FROM
      journal_entry_lines
    WHERE
      journal_entry_id = NEW.id
      AND deleted_at IS NULL;
    IF d != c OR d = 0 THEN
      RAISE EXCEPTION 'Journal entry must have balanced non-zero debits and credits to post';
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

CREATE TRIGGER tr_journal_entries_validate_balance
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_validate_journal_entry_balanced ();

CREATE OR REPLACE FUNCTION public.haven_journal_lines_parent_must_be_draft ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
DECLARE
  st journal_entry_status;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    SELECT
      status INTO st
    FROM
      journal_entries
    WHERE
      id = NEW.journal_entry_id;
    IF st IS NULL THEN
      RAISE EXCEPTION 'Journal entry not found';
    END IF;
    IF st != 'draft'::journal_entry_status THEN
      RAISE EXCEPTION 'Cannot change lines unless journal entry is draft';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT
      status INTO st
    FROM
      journal_entries
    WHERE
      id = OLD.journal_entry_id;
    IF st IS NOT NULL AND st != 'draft'::journal_entry_status THEN
      RAISE EXCEPTION 'Cannot delete lines unless journal entry is draft';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$func$;

CREATE TRIGGER tr_journal_lines_parent_draft
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_journal_lines_parent_must_be_draft ();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;

-- gl_accounts: read for owner/org_admin/facility_admin (scoped); write owner/org_admin only
CREATE POLICY gl_accounts_select ON gl_accounts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND entity_id IN (
          SELECT
            f.entity_id
          FROM
            facilities f
          WHERE
            f.id IN (
              SELECT
                haven.accessible_facility_ids ())
              AND f.deleted_at IS NULL))));

CREATE POLICY gl_accounts_insert ON gl_accounts
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY gl_accounts_update ON gl_accounts
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY gl_accounts_delete ON gl_accounts
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- journal_entries
CREATE POLICY journal_entries_select ON journal_entries
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND entity_id IN (
          SELECT
            f.entity_id
          FROM
            facilities f
          WHERE
            f.id IN (
              SELECT
                haven.accessible_facility_ids ())
              AND f.deleted_at IS NULL)
          AND (
            facility_id IS NULL
            OR facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY journal_entries_insert ON journal_entries
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

-- Draft rows: edit memo, facility, lines (status stays draft)
CREATE POLICY journal_entries_update_draft ON journal_entries
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND status = 'draft'::journal_entry_status)
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND status = 'draft'::journal_entry_status);

CREATE POLICY journal_entries_post_draft ON journal_entries
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND status = 'draft'::journal_entry_status)
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND status = 'posted'::journal_entry_status);

CREATE POLICY journal_entries_delete_draft ON journal_entries
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND status = 'draft'::journal_entry_status);

-- journal_entry_lines
CREATE POLICY journal_lines_select ON journal_entry_lines
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        journal_entries j
      WHERE
        j.id = journal_entry_lines.journal_entry_id
        AND j.organization_id = haven.organization_id ()
        AND j.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND j.entity_id IN (
              SELECT
                f.entity_id
              FROM
                facilities f
              WHERE
                f.id IN (
                  SELECT
                    haven.accessible_facility_ids ())
                  AND f.deleted_at IS NULL)
              AND (
                j.facility_id IS NULL
                OR j.facility_id IN (
                  SELECT
                    haven.accessible_facility_ids ()))))));

CREATE POLICY journal_lines_insert ON journal_entry_lines
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        journal_entries j
      WHERE
        j.id = journal_entry_lines.journal_entry_id
        AND j.organization_id = haven.organization_id ()
        AND j.status = 'draft'::journal_entry_status
        AND j.deleted_at IS NULL));

CREATE POLICY journal_lines_update ON journal_entry_lines
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        journal_entries j
      WHERE
        j.id = journal_entry_lines.journal_entry_id
        AND j.status = 'draft'::journal_entry_status
        AND j.deleted_at IS NULL))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY journal_lines_delete ON journal_entry_lines
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        journal_entries j
      WHERE
        j.id = journal_entry_lines.journal_entry_id
        AND j.status = 'draft'::journal_entry_status
        AND j.deleted_at IS NULL));

-- ============================================================
-- Audit + updated_at
-- ============================================================
CREATE TRIGGER tr_gl_accounts_set_updated_at
  BEFORE UPDATE ON gl_accounts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_gl_accounts_audit
  AFTER INSERT OR UPDATE OR DELETE ON gl_accounts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_journal_entries_set_updated_at
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_journal_entries_audit
  AFTER INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_journal_entry_lines_set_updated_at
  BEFORE UPDATE ON journal_entry_lines
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_journal_entry_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
