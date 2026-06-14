-- ============================================================================
-- 295_office_cash_trust_ledgers.sql
-- Module 35 (Office Suite) — F4-3 Petty cash + resident trust ledger
--
-- Per-facility petty cash account + log, and per-resident trust account
-- (Representative Payee / SSA-787 context) + ledger. Money in CENTS (integer);
-- never numeric/float/money. Financial records → audit-logged, soft deletes,
-- no UPDATE/DELETE on posted ledger entries (immutable). Receipt photo URL is
-- a Storage object path (capture UI deferred — see spec).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- petty_cash_accounts (one active per facility; supports multiple drawers)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS petty_cash_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  name text NOT NULL DEFAULT 'Front office petty cash',
  -- Denormalized running balance in cents (maintained by app on each post)
  balance_cents integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_petty_cash_accounts_facility
  ON petty_cash_accounts(facility_id)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- petty_cash_transactions (immutable ledger)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS petty_cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  account_id uuid NOT NULL REFERENCES petty_cash_accounts(id),
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  -- Signed balance after this post, for an auditable running total
  balance_after_cents integer NOT NULL,
  category text NOT NULL DEFAULT 'other' CHECK (category IN (
    'replenishment', 'resident_expense', 'office_supply', 'food', 'reimbursement', 'other'
  )),
  description text NOT NULL,
  resident_id uuid REFERENCES residents(id),
  receipt_path text,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_petty_cash_tx_account_occurred
  ON petty_cash_transactions(account_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- resident_trust_accounts (one per resident; Rep Payee / SSA-787 context)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS resident_trust_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  resident_id uuid NOT NULL REFERENCES residents(id),
  balance_cents integer NOT NULL DEFAULT 0,
  -- Facility acts as Representative Payee for this resident's benefits
  is_rep_payee boolean NOT NULL DEFAULT false,
  ssa_787_on_file boolean NOT NULL DEFAULT false,
  notes text,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,

  CONSTRAINT resident_trust_accounts_one_per_resident UNIQUE (resident_id)
);

CREATE INDEX IF NOT EXISTS idx_resident_trust_accounts_facility
  ON resident_trust_accounts(facility_id)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- resident_trust_transactions (immutable ledger)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS resident_trust_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  account_id uuid NOT NULL REFERENCES resident_trust_accounts(id),
  resident_id uuid NOT NULL REFERENCES residents(id),
  direction text NOT NULL CHECK (direction IN ('deposit', 'withdrawal')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  balance_after_cents integer NOT NULL,
  category text NOT NULL DEFAULT 'other' CHECK (category IN (
    'benefit_deposit', 'personal_needs', 'purchase', 'refund', 'transfer', 'other'
  )),
  description text NOT NULL,
  receipt_path text,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_resident_trust_tx_account_occurred
  ON resident_trust_transactions(account_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resident_trust_tx_resident
  ON resident_trust_transactions(resident_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- updated_at triggers (accounts only; ledgers are insert-only)
-- ----------------------------------------------------------------------------

CREATE TRIGGER petty_cash_accounts_set_updated_at
  BEFORE UPDATE ON petty_cash_accounts
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER resident_trust_accounts_set_updated_at
  BEFORE UPDATE ON resident_trust_accounts
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS (enabled before any data lands) — financial data: admin/office + finance
-- ----------------------------------------------------------------------------

ALTER TABLE petty_cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resident_trust_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE resident_trust_transactions ENABLE ROW LEVEL SECURITY;

-- petty_cash_accounts
CREATE POLICY "Finance roles see petty cash accounts"
  ON petty_cash_accounts FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Finance roles create petty cash accounts"
  ON petty_cash_accounts FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Finance roles update petty cash accounts"
  ON petty_cash_accounts FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

-- petty_cash_transactions (insert-only; no UPDATE/DELETE policies — immutable)
CREATE POLICY "Finance roles see petty cash transactions"
  ON petty_cash_transactions FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Finance roles post petty cash transactions"
  ON petty_cash_transactions FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

-- resident_trust_accounts
CREATE POLICY "Finance roles see resident trust accounts"
  ON resident_trust_accounts FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Finance roles create resident trust accounts"
  ON resident_trust_accounts FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Finance roles update resident trust accounts"
  ON resident_trust_accounts FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

-- resident_trust_transactions (insert-only; no UPDATE/DELETE policies — immutable)
CREATE POLICY "Finance roles see resident trust transactions"
  ON resident_trust_transactions FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Finance roles post resident trust transactions"
  ON resident_trust_transactions FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

-- ----------------------------------------------------------------------------
-- Audit triggers (all four — financial)
-- ----------------------------------------------------------------------------

CREATE TRIGGER petty_cash_accounts_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON petty_cash_accounts
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER petty_cash_transactions_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON petty_cash_transactions
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER resident_trust_accounts_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON resident_trust_accounts
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER resident_trust_transactions_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON resident_trust_transactions
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE petty_cash_accounts IS
  'Per-facility petty cash drawer with denormalized cents balance. Module 35 F4-3.';
COMMENT ON TABLE petty_cash_transactions IS
  'Immutable petty cash ledger (credit/debit, cents, running balance). Module 35 F4-3.';
COMMENT ON TABLE resident_trust_accounts IS
  'Per-resident trust account (Rep Payee / SSA-787 context), cents balance. Module 35 F4-3.';
COMMENT ON TABLE resident_trust_transactions IS
  'Immutable resident trust ledger (deposit/withdrawal, cents, running balance). Module 35 F4-3.';
