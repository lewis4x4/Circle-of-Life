-- COL-540 [HFO-21c]: the resident subledger spine.
--
-- Haven becomes the only place a resident's balance exists once QuickBooks
-- receives summary journals instead of resident detail, so the ledger has to
-- answer to a CPA at year end and to a surveyor asking for one resident's
-- history. Three things carry that weight and none of them existed:
--
--   1. Resident money had no period at all. The general ledger has one and
--      enforces it (haven.guard_finance_journal, 340), but nothing on the
--      resident side ever consulted it, so a charge or a payment could be
--      recorded against a month that finance had already closed and reported.
--      src/lib/finance/gl-period-close.ts looked like the enforcement and was
--      not: a TypeScript read of gl_period_closes with no callers left, orphaned
--      when 340 moved the real check into the database. It goes with this
--      migration so the next reader does not trust it.
--   2. Resident money had no entry of record. invoices carries amount_paid,
--      balance_due and status as mutable columns; apply_invoice_payment rewrites
--      them in place; a void is a flag. Nothing records what changed, when it was
--      economically true as distinct from when it was typed, or against which
--      accounts -- so no control total ties to anything.
--   3. Nothing balanced. Money moved without a named account on either side.
--
-- This migration does not create a second ledger. It reuses gl_accounts,
-- gl_posting_rules and gl_period_closes, and adds the resident dimension that
-- the general ledger deliberately does not carry.
--
-- Deliberately absent: deleted_at on resident_ledger_entries. The repo convention
-- is soft deletes; an immutable ledger cannot have one, because a delete path that
-- an audit cannot see is the defect. Corrections are reversing entries.
--
-- Not in this migration (COL-540 has its own children): deposit batches, trust
-- statements and the FS 429.27 cadence, the consent gate on trust -> receivable,
-- approval thresholds and segregation of duties, the three control tie-outs, and
-- the QuickBooks journal (COL-532).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Account mappings the subledger needs and entity_gl_settings did not carry.
--    Configuration, not a business decision: which account, never which rule.
-- ---------------------------------------------------------------------------

ALTER TABLE public.entity_gl_settings
  ADD COLUMN IF NOT EXISTS trust_liability_id uuid REFERENCES public.gl_accounts (id),
  ADD COLUMN IF NOT EXISTS cash_clearing_id uuid REFERENCES public.gl_accounts (id),
  ADD COLUMN IF NOT EXISTS write_off_id uuid REFERENCES public.gl_accounts (id);

COMMENT ON COLUMN public.entity_gl_settings.trust_liability_id IS
  'COL-540: GL account holding resident trust funds as a liability. Sum of resident trust balances ties to this account at close.';
COMMENT ON COLUMN public.entity_gl_settings.cash_clearing_id IS
  'COL-540: GL account facility captures land in before a deposit batch matches the bank feed.';
COMMENT ON COLUMN public.entity_gl_settings.write_off_id IS
  'COL-540: GL account write-offs and credits post to.';

-- ---------------------------------------------------------------------------
-- 2. Periods: open -> closing -> closed, with the control totals taken at close,
--    and a status the database enforces rather than the surface.
-- ---------------------------------------------------------------------------

DO $migration$
DECLARE v_constraint text;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.gl_period_closes'::regclass
    AND contype = 'c'
    AND pg_catalog.pg_get_constraintdef(oid) LIKE '%status%';
  IF v_constraint IS NOT NULL THEN
    EXECUTE pg_catalog.format('ALTER TABLE public.gl_period_closes DROP CONSTRAINT %I', v_constraint);
  END IF;
END $migration$;

ALTER TABLE public.gl_period_closes
  ADD CONSTRAINT gl_period_closes_status_check
    CHECK (status IN ('open', 'closing', 'closed')),
  ADD COLUMN IF NOT EXISTS control_totals jsonb,
  ADD COLUMN IF NOT EXISTS control_totals_at timestamptz;

COMMENT ON COLUMN public.gl_period_closes.status IS
  'COL-540: open accepts postings; closing accepts none and is the reconciliation window; closed is locked. Enforced by haven.resident_ledger_period for the resident subledger and haven.guard_finance_journal for the general ledger, not by the caller.';
COMMENT ON COLUMN public.gl_period_closes.control_totals IS
  'COL-540: receivable, trust and deposit totals snapshotted when the period left open. Null until a close computes them (COL-540 tie-out child).';

-- A period row is created the first time something posts into that month, so
-- every entry can name its period. An absent row still reads as open, which is
-- the convention the TypeScript helper already established.
CREATE FUNCTION haven.resident_ledger_period(p_entity_id uuid, p_effective_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_org uuid; v_year integer; v_month integer; v_id uuid; v_status text;
BEGIN
  v_year := extract(YEAR FROM p_effective_date)::integer;
  v_month := extract(MONTH FROM p_effective_date)::integer;
  SELECT id, status INTO v_id, v_status FROM public.gl_period_closes
   WHERE entity_id = p_entity_id AND period_year = v_year AND period_month = v_month
     AND deleted_at IS NULL;
  IF FOUND THEN
    IF v_status <> 'open' THEN
      RAISE EXCEPTION 'Accounting period %-% is % for this entity. Post the correction in the open period.',
        v_year, pg_catalog.lpad(v_month::text, 2, '0'), v_status USING ERRCODE='23514';
    END IF;
    RETURN v_id;
  END IF;
  SELECT organization_id INTO v_org FROM public.entities WHERE id = p_entity_id AND deleted_at IS NULL;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Entity unavailable' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.gl_period_closes (organization_id, entity_id, period_year, period_month, status)
    VALUES (v_org, p_entity_id, v_year, v_month, 'open')
    ON CONFLICT (entity_id, period_year, period_month) DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id, status INTO v_id, v_status FROM public.gl_period_closes
     WHERE entity_id = p_entity_id AND period_year = v_year AND period_month = v_month;
    IF v_status <> 'open' THEN
      RAISE EXCEPTION 'Accounting period %-% is % for this entity. Post the correction in the open period.',
        v_year, pg_catalog.lpad(v_month::text, 2, '0'), v_status USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION haven.resident_ledger_period(uuid, date) FROM PUBLIC, anon, authenticated, service_role;

-- The journal already refuses a closed period in the database (340). It has
-- never heard of 'closing', which this migration introduces, so widen the one
-- guard rather than adding a second trigger with its own wording. Everything
-- else below is 340's body, unchanged.
CREATE OR REPLACE FUNCTION haven.guard_finance_journal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid; d bigint; c bigint; period_status text;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Posted journals are immutable' USING ERRCODE='42501'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status<>'draft' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Posted journals are immutable' USING ERRCODE='42501'; END IF;
 IF NEW.status='voided' THEN RAISE EXCEPTION 'Use a reversing journal'; END IF;
 IF NEW.status='posted' AND (TG_OP='INSERT' OR OLD.status='draft') THEN
  IF current_user IN('anon','authenticated','service_role') OR TG_OP='INSERT' THEN RAISE EXCEPTION 'Use post_finance_journal or post_finance_source' USING ERRCODE='42501'; END IF;
  actor:=haven.assert_finance_scope(NEW.entity_id,NEW.facility_id,true);
  PERFORM haven.lock_finance_period(NEW.entity_id,NEW.entry_date);
  SELECT status INTO period_status FROM public.gl_period_closes WHERE entity_id=NEW.entity_id AND period_year=extract(year FROM NEW.entry_date) AND period_month=extract(month FROM NEW.entry_date) AND deleted_at IS NULL;
  -- COL-540: a period being closed is already past accepting postings; the
  -- reconciliation window is where the control totals are struck.
  IF period_status IN ('closed','closing') THEN RAISE EXCEPTION 'Accounting period is %', period_status; END IF;
  IF NEW.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Journal organization mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.journal_entry_lines l LEFT JOIN public.gl_accounts a ON a.id=l.gl_account_id WHERE l.journal_entry_id=NEW.id AND l.deleted_at IS NULL AND (a.entity_id IS DISTINCT FROM NEW.entity_id OR a.organization_id IS DISTINCT FROM NEW.organization_id OR NOT a.is_active OR a.deleted_at IS NOT NULL)) THEN RAISE EXCEPTION 'Journal account unavailable in entity'; END IF;
  SELECT coalesce(sum(debit_cents),0),coalesce(sum(credit_cents),0) INTO d,c FROM public.journal_entry_lines WHERE journal_entry_id=NEW.id AND deleted_at IS NULL;
  IF d=0 OR d<>c THEN RAISE EXCEPTION 'Journal entry must have balanced non-zero debits and credits to post'; END IF;
  NEW.posted_at:=now(); NEW.posted_by:=actor;
 END IF;
 RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Reasons: versioned, effective-dated configuration. Nothing is seeded --
--    an adjustment cannot post until COL has named its reasons (COL-226).
-- ---------------------------------------------------------------------------

CREATE TABLE public.resident_ledger_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  entity_id uuid REFERENCES public.entities (id),
  code text NOT NULL,
  label text NOT NULL,
  applies_to text NOT NULL CHECK (applies_to IN ('adjustment', 'write_off', 'refund')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  effective_from date NOT NULL,
  effective_to date,
  requires_second_approver boolean NOT NULL DEFAULT false,
  approval_threshold_cents integer CHECK (approval_threshold_cents IS NULL OR approval_threshold_cents >= 0),
  approved_by_name text,
  approved_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CONSTRAINT resident_ledger_reasons_version_unique UNIQUE (organization_id, entity_id, code, version),
  CONSTRAINT resident_ledger_reasons_window CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX idx_resident_ledger_reasons_lookup
  ON public.resident_ledger_reasons (organization_id, code, effective_from DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. The entries. Two legs by construction, so an unbalanced row cannot exist.
--    Multi-leg events (a payer split) are several entries sharing entry_group_id.
-- ---------------------------------------------------------------------------

CREATE TABLE public.resident_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  entity_id uuid NOT NULL REFERENCES public.entities (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  resident_id uuid NOT NULL REFERENCES public.residents (id),

  account_kind text NOT NULL CHECK (account_kind IN ('receivable', 'trust')),
  entry_type text NOT NULL CHECK (entry_type IN (
    'resident_charge',
    'resident_payment',
    'resident_adjustment',
    'resident_write_off',
    'resident_refund',
    'trust_deposit',
    'trust_withdrawal'
  )),

  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  debit_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts (id),
  credit_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts (id),

  -- Effective is when it was economically true; recorded is when the server saw
  -- it. Never conflated, including for a late or on-behalf entry.
  effective_date date NOT NULL,
  gl_period_close_id uuid NOT NULL REFERENCES public.gl_period_closes (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES auth.users (id),

  source_type text,
  source_id uuid,
  reason_id uuid REFERENCES public.resident_ledger_reasons (id),
  reversal_of_id uuid REFERENCES public.resident_ledger_entries (id),
  entry_group_id uuid NOT NULL,
  request_id uuid NOT NULL,
  notes text,

  CONSTRAINT resident_ledger_entries_two_sided CHECK (debit_gl_account_id <> credit_gl_account_id),
  CONSTRAINT resident_ledger_entries_request_unique UNIQUE (organization_id, request_id)
);

CREATE INDEX idx_resident_ledger_entries_resident
  ON public.resident_ledger_entries (resident_id, effective_date DESC, recorded_at DESC);
CREATE INDEX idx_resident_ledger_entries_facility
  ON public.resident_ledger_entries (organization_id, facility_id, effective_date DESC);
CREATE INDEX idx_resident_ledger_entries_period
  ON public.resident_ledger_entries (gl_period_close_id);
CREATE INDEX idx_resident_ledger_entries_group
  ON public.resident_ledger_entries (entry_group_id);
CREATE UNIQUE INDEX idx_resident_ledger_entries_one_reversal
  ON public.resident_ledger_entries (reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;
CREATE INDEX idx_resident_ledger_entries_source
  ON public.resident_ledger_entries (source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

-- Append-only against every writer, including the service role and a future
-- migration that forgets. A correction is a reversing entry.
CREATE FUNCTION haven.refuse_resident_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  RAISE EXCEPTION 'The resident ledger is append-only. Post a reversing entry instead of changing or deleting %.',
    COALESCE(OLD.id::text, '(row)') USING ERRCODE='23514';
END $function$;
REVOKE ALL ON FUNCTION haven.refuse_resident_ledger_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_resident_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON public.resident_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION haven.refuse_resident_ledger_mutation();

CREATE TRIGGER tr_resident_ledger_entries_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.resident_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE TRIGGER tr_resident_ledger_reasons_set_updated_at
  BEFORE UPDATE ON public.resident_ledger_reasons
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER tr_resident_ledger_reasons_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.resident_ledger_reasons
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ---------------------------------------------------------------------------
-- 5. RLS. Readers are the finance roles that already read resident money.
--    There is no INSERT, UPDATE or DELETE policy on the entries: the only way
--    in is the posting command, which is where the period, the accounts and the
--    idempotency key are enforced.
-- ---------------------------------------------------------------------------

ALTER TABLE public.resident_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_ledger_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles read the resident ledger"
  ON public.resident_ledger_entries FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Finance roles read ledger reasons"
  ON public.resident_ledger_reasons FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Owners maintain ledger reasons"
  ON public.resident_ledger_reasons FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE POLICY "Owners revise ledger reasons"
  ON public.resident_ledger_reasons FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
  ) WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- ---------------------------------------------------------------------------
-- 6. Posting authority. Same roles that can already post resident cash; the
--    approval thresholds and capturer-vs-closer separation are a later slice
--    and are not guessed here.
-- ---------------------------------------------------------------------------

CREATE FUNCTION haven.assert_resident_ledger_authority(p_organization_id uuid, p_facility_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor record; expiry text;
BEGIN
  SELECT * INTO actor FROM haven.current_authorized_actor() WHERE actor_is_managed;
  IF NOT FOUND OR auth.uid() IS NULL
    OR actor.actor_user_id IS DISTINCT FROM auth.uid()
    OR actor.actor_app_role NOT IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
    OR actor.actor_organization_id IS DISTINCT FROM p_organization_id
    OR NOT haven.has_facility_access(p_facility_id) THEN
    RAISE EXCEPTION 'Current resident ledger authority required' USING ERRCODE='42501';
  END IF;
  expiry := auth.jwt()->>'exp';
  IF expiry IS NOT NULL THEN
    IF expiry !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Current resident ledger authority required' USING ERRCODE='42501';
    END IF;
    IF expiry::numeric <= extract(EPOCH FROM clock_timestamp()) THEN
      RAISE EXCEPTION 'Current resident ledger authority required' USING ERRCODE='42501';
    END IF;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION haven.assert_resident_ledger_authority(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The posting command. Accounts come from gl_posting_rules for the entity --
--    Haven never decides which account an event lands in.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.post_resident_ledger_entry(
  p_request_id uuid,
  p_resident_id uuid,
  p_entry_type text,
  p_amount_cents integer,
  p_effective_date date,
  p_source_type text DEFAULT NULL,
  p_source_id uuid DEFAULT NULL,
  p_reason_code text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_entry_group_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_resident public.residents%ROWTYPE;
  v_entity uuid;
  v_rule public.gl_posting_rules%ROWTYPE;
  v_reason public.resident_ledger_reasons%ROWTYPE;
  v_existing public.resident_ledger_entries%ROWTYPE;
  v_entry public.resident_ledger_entries%ROWTYPE;
  v_period uuid;
  v_kind text;
BEGIN
  IF p_request_id IS NULL OR p_resident_id IS NULL OR p_entry_type IS NULL
     OR p_amount_cents IS NULL OR p_effective_date IS NULL THEN
    RAISE EXCEPTION 'A ledger entry needs a request id, resident, type, amount and effective date' USING ERRCODE='23514';
  END IF;
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'A ledger entry amount is always positive; the entry type carries the direction' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_resident FROM public.residents
   WHERE id = p_resident_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
  PERFORM haven.assert_resident_ledger_authority(v_resident.organization_id, v_resident.facility_id);

  SELECT entity_id INTO v_entity FROM public.facilities
   WHERE id = v_resident.facility_id AND deleted_at IS NULL;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'The resident facility has no legal entity; finance cannot post to it' USING ERRCODE='23514';
  END IF;

  -- Replay returns the receipt; the same key with a different payload is a
  -- different request wearing a used identity.
  SELECT * INTO v_existing FROM public.resident_ledger_entries
   WHERE organization_id = v_resident.organization_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.resident_id <> p_resident_id
       OR v_existing.entry_type <> p_entry_type
       OR v_existing.amount_cents <> p_amount_cents
       OR v_existing.effective_date <> p_effective_date
       OR v_existing.source_type IS DISTINCT FROM p_source_type
       OR v_existing.source_id IS DISTINCT FROM p_source_id THEN
      RAISE EXCEPTION 'Ledger request identity already used for a different entry' USING ERRCODE='23505';
    END IF;
    RETURN pg_catalog.to_jsonb(v_existing);
  END IF;

  v_kind := CASE WHEN p_entry_type IN ('trust_deposit', 'trust_withdrawal') THEN 'trust' ELSE 'receivable' END;

  IF p_entry_type IN ('resident_adjustment', 'resident_write_off', 'resident_refund') THEN
    IF p_reason_code IS NULL THEN
      RAISE EXCEPTION 'A % needs a reason from the approved catalog', p_entry_type USING ERRCODE='23514';
    END IF;
    SELECT * INTO v_reason FROM public.resident_ledger_reasons
     WHERE organization_id = v_resident.organization_id
       AND (entity_id IS NULL OR entity_id = v_entity)
       AND code = p_reason_code
       AND deleted_at IS NULL
       AND effective_from <= p_effective_date
       AND (effective_to IS NULL OR effective_to >= p_effective_date)
     ORDER BY entity_id NULLS LAST, version DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No approved reason "%" is in effect on % for this entity. Reasons are configuration; record the decision before posting.',
        p_reason_code, p_effective_date USING ERRCODE='23514';
    END IF;
  ELSIF p_reason_code IS NOT NULL THEN
    RAISE EXCEPTION 'A % does not take an adjustment reason', p_entry_type USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_rule FROM public.gl_posting_rules
   WHERE entity_id = v_entity AND event_type = p_entry_type
     AND is_active AND deleted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active posting rule maps "%" to accounts for this entity. Configure it in Finance -> posting rules; Haven does not choose accounts.',
      p_entry_type USING ERRCODE='23514';
  END IF;

  v_period := haven.resident_ledger_period(v_entity, p_effective_date);

  INSERT INTO public.resident_ledger_entries (
    organization_id, entity_id, facility_id, resident_id,
    account_kind, entry_type, amount_cents,
    debit_gl_account_id, credit_gl_account_id,
    effective_date, gl_period_close_id, recorded_by,
    source_type, source_id, reason_id, entry_group_id, request_id, notes
  ) VALUES (
    v_resident.organization_id, v_entity, v_resident.facility_id, p_resident_id,
    v_kind, p_entry_type, p_amount_cents,
    v_rule.debit_gl_account_id, v_rule.credit_gl_account_id,
    p_effective_date, v_period, auth.uid(),
    p_source_type, p_source_id, v_reason.id,
    COALESCE(p_entry_group_id, pg_catalog.gen_random_uuid()), p_request_id,
    NULLIF(pg_catalog.btrim(p_notes), '')
  ) RETURNING * INTO v_entry;

  RETURN pg_catalog.to_jsonb(v_entry);
END $function$;
REVOKE ALL ON FUNCTION public.post_resident_ledger_entry(uuid, uuid, text, integer, date, text, uuid, text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.post_resident_ledger_entry(uuid, uuid, text, integer, date, text, uuid, text, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. The only correction path: a reversing entry that names what it reverses
--    and lands in whatever period is open now.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.reverse_resident_ledger_entry(
  p_request_id uuid,
  p_entry_id uuid,
  p_effective_date date,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_original public.resident_ledger_entries%ROWTYPE;
  v_existing public.resident_ledger_entries%ROWTYPE;
  v_entry public.resident_ledger_entries%ROWTYPE;
  v_period uuid;
BEGIN
  IF p_request_id IS NULL OR p_entry_id IS NULL OR p_effective_date IS NULL THEN
    RAISE EXCEPTION 'A reversal needs a request id, the entry it reverses and an effective date' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_original FROM public.resident_ledger_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger entry unavailable' USING ERRCODE='42501'; END IF;
  PERFORM haven.assert_resident_ledger_authority(v_original.organization_id, v_original.facility_id);

  SELECT * INTO v_existing FROM public.resident_ledger_entries
   WHERE organization_id = v_original.organization_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.reversal_of_id IS DISTINCT FROM p_entry_id THEN
      RAISE EXCEPTION 'Ledger request identity already used for a different entry' USING ERRCODE='23505';
    END IF;
    RETURN pg_catalog.to_jsonb(v_existing);
  END IF;

  IF v_original.reversal_of_id IS NOT NULL THEN
    RAISE EXCEPTION 'A reversing entry is not itself reversed; post the original again if it was correct' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.resident_ledger_entries WHERE reversal_of_id = p_entry_id) THEN
    RAISE EXCEPTION 'That entry is already reversed' USING ERRCODE='23505';
  END IF;

  v_period := haven.resident_ledger_period(v_original.entity_id, p_effective_date);

  INSERT INTO public.resident_ledger_entries (
    organization_id, entity_id, facility_id, resident_id,
    account_kind, entry_type, amount_cents,
    debit_gl_account_id, credit_gl_account_id,
    effective_date, gl_period_close_id, recorded_by,
    source_type, source_id, reason_id, reversal_of_id,
    entry_group_id, request_id, notes
  ) VALUES (
    v_original.organization_id, v_original.entity_id, v_original.facility_id, v_original.resident_id,
    v_original.account_kind, v_original.entry_type, v_original.amount_cents,
    -- The legs swap. That is what makes it a reversal rather than a second event.
    v_original.credit_gl_account_id, v_original.debit_gl_account_id,
    p_effective_date, v_period, auth.uid(),
    v_original.source_type, v_original.source_id, v_original.reason_id, v_original.id,
    v_original.entry_group_id, p_request_id,
    NULLIF(pg_catalog.btrim(p_notes), '')
  ) RETURNING * INTO v_entry;

  RETURN pg_catalog.to_jsonb(v_entry);
END $function$;
REVOKE ALL ON FUNCTION public.reverse_resident_ledger_entry(uuid, uuid, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_resident_ledger_entry(uuid, uuid, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Balances are derived from the entries, never stored beside them.
-- ---------------------------------------------------------------------------

CREATE VIEW public.resident_ledger_balances
WITH (security_invoker = on) AS
SELECT
  e.organization_id,
  e.entity_id,
  e.facility_id,
  e.resident_id,
  SUM(
    CASE WHEN e.account_kind = 'receivable' AND e.debit_gl_account_id = s.accounts_receivable_id THEN e.amount_cents
         WHEN e.account_kind = 'receivable' AND e.credit_gl_account_id = s.accounts_receivable_id THEN -e.amount_cents
         ELSE 0 END
  )::bigint AS receivable_balance_cents,
  SUM(
    CASE WHEN e.account_kind = 'trust' AND e.credit_gl_account_id = s.trust_liability_id THEN e.amount_cents
         WHEN e.account_kind = 'trust' AND e.debit_gl_account_id = s.trust_liability_id THEN -e.amount_cents
         ELSE 0 END
  )::bigint AS trust_balance_cents,
  COUNT(*) AS entry_count,
  MAX(e.effective_date) AS last_effective_date,
  MAX(e.recorded_at) AS last_recorded_at
FROM public.resident_ledger_entries e
LEFT JOIN public.entity_gl_settings s ON s.entity_id = e.entity_id
GROUP BY e.organization_id, e.entity_id, e.facility_id, e.resident_id;

REVOKE ALL ON public.resident_ledger_balances FROM PUBLIC, anon;
GRANT SELECT ON public.resident_ledger_balances TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Comments, including the COL-37 rulings the definer surface needs.
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.resident_ledger_entries IS
  'COL-540: append-only, two-legged resident subledger. Every row names a debit and a credit account, an effective date and the period it landed in. No deleted_at by design -- a soft delete is a mutation an audit cannot see; corrections are reversing entries.';
COMMENT ON TABLE public.resident_ledger_reasons IS
  'COL-540: versioned, effective-dated adjustment/write-off/refund reasons. Nothing is seeded; an adjustment cannot post until COL records the decision (COL-226).';
COMMENT ON VIEW public.resident_ledger_balances IS
  'COL-540: resident receivable and trust balances derived from the entries against the entity account mapping. Null mapping yields zero movement rather than a fabricated balance.';

COMMENT ON FUNCTION public.post_resident_ledger_entry(uuid, uuid, text, integer, date, text, uuid, text, text, uuid) IS
  'COL-540. COL-37 ruling: definer required. The entries table has no INSERT policy on purpose -- the period lock, the posting-rule account lookup and the idempotency key are the only way in, and an invoker insert would bypass all three. Current server-derived owner/org_admin/facility_admin/manager/admin_assistant authority and facility access are asserted against auth.uid() before anything is written. Returns the entry receipt; replaying a request id returns the same row.';
COMMENT ON FUNCTION public.reverse_resident_ledger_entry(uuid, uuid, date, text) IS
  'COL-540. COL-37 ruling: definer required for the same reason as post_resident_ledger_entry -- the append-only table has no write policy, and a reversal must read the original row under one authority and write its mirror in the open period. Authority is asserted against the original entry scope; one reversal per entry.';
COMMENT ON FUNCTION haven.resident_ledger_period(uuid, date) IS
  'COL-540: resolves the entity month, materializing an open period the first time something posts into it, and refuses a closing or closed period. Private definer; no request-role grant.';
COMMENT ON FUNCTION haven.guard_finance_journal() IS
  'Finance journal guard from 340; COL-540 widened its period check so a posted journal cannot land in a closing month either. Private trigger function; no request-role grant.';
COMMENT ON FUNCTION haven.refuse_resident_ledger_mutation() IS
  'COL-540: the resident ledger is append-only against every writer, service role included. Private definer trigger; no request-role grant.';
COMMENT ON FUNCTION haven.assert_resident_ledger_authority(uuid, uuid) IS
  'COL-540: current managed-actor authority and facility access for resident ledger posting. Approval thresholds and capturer-vs-closer separation are a later COL-540 slice and are not assumed here. Private definer; no request-role grant.';

NOTIFY pgrst, 'reload schema';
COMMIT;
