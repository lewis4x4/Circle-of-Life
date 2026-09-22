-- COL-556 [HFO-21c.1]: bridge the existing invoices, payments and trust
-- transactions onto the resident ledger.
--
-- 456 built the subledger beside the tables that already hold resident money and
-- moved nothing onto it. Until this migration there were three places a
-- resident's balance lived -- invoices/payments, resident_trust_transactions,
-- and resident_ledger_entries -- which is the exact failure the build contract
-- names: "reconciles them to this model rather than creating a second ledger".
--
-- What this migration does, in the order the reader needs it:
--
--   1. Activation is configuration, per entity, effective-dated. Until finance
--      names the accounts and sets entity_gl_settings.resident_ledger_from,
--      nothing bridges and nothing breaks. After it, every write that moves
--      resident money in that entity posts a ledger entry or refuses by name.
--      Nothing is activated by this migration: production today has no
--      entity_gl_settings row and no gl_posting_rules row at all, so a bridge
--      that posted unconditionally would stop billing rather than start a
--      ledger.
--   2. The forward path. Triggers on invoices, payments and
--      resident_trust_transactions, so "every write" means every write --
--      including a seed, a migration and a service-role repair, not only the
--      surfaces that happen to call an RPC today.
--   3. The invoice settlement columns stop being written independently. Once an
--      invoice is on the ledger, amount_paid / balance_due / status are computed
--      from the ledger entries and the allocation that links them, so the
--      document cannot claim a settlement no entry explains. (Production holds
--      90 invoices carrying $77,137.78 of amount_paid and zero payment rows.
--      That is the defect, and the backfill is where it becomes visible.)
--   4. The backfill. One attributable run per entity with a stated as-of, which
--      posts the pre-existing rows as opening entries against their original
--      effective dates with a source reference back to the row. Idempotent
--      because every request id is derived from the source row id -- re-running
--      it posts nothing.
--   5. The tie-out probe. Ledger balance against the balance the old tables
--      report, per resident, as a function anyone can call -- not a spreadsheet.
--
-- Deliberately not here:
--   * trust_account_entries (060). It is a dead second trust ledger with no
--     reader and no writer; COL-563 decides whether it is retired or migrated,
--     and guessing that here would post entries nobody asked for.
--   * Written-off invoices. A write-off needs a reason from the approved
--     catalog and COL has not named its reasons yet (COL-226), so the bridge
--     refuses to invent one. The tie-out names them as a variance instead.
--   * The consent-gated trust -> receivable transfer (COL-557) and the three
--     control tie-outs at close (COL-558).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Activation. Effective-dated configuration; never a hard-coded date and
--    never a business decision Haven made for COL.
-- ---------------------------------------------------------------------------

ALTER TABLE public.entity_gl_settings
  ADD COLUMN IF NOT EXISTS resident_ledger_from date,
  ADD COLUMN IF NOT EXISTS resident_ledger_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS resident_ledger_activated_by uuid REFERENCES auth.users (id);

COMMENT ON COLUMN public.entity_gl_settings.resident_ledger_from IS
  'COL-556: the date from which this entity''s resident money is carried on resident_ledger_entries. NULL means the subledger is not the record for this entity yet and nothing bridges. Rows dated before it belong to the backfill, not to the forward triggers.';
COMMENT ON COLUMN public.entity_gl_settings.resident_ledger_activated_at IS
  'COL-556: when resident_ledger_from was set, so activation is attributable rather than inferred from a date that could have been typed at any time.';

-- ---------------------------------------------------------------------------
-- 2. Deterministic request ids. The idempotency key of a bridged entry is a
--    function of the source row, so a replay of the backfill -- or a trigger
--    firing again on an unrelated update -- returns the receipt instead of
--    posting a second entry.
-- ---------------------------------------------------------------------------

CREATE FUNCTION haven.resident_ledger_request_id(p_kind text, p_source_id uuid)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
  SELECT pg_catalog.md5('col556:' || p_kind || ':' || p_source_id::text)::uuid
$function$;
REVOKE ALL ON FUNCTION haven.resident_ledger_request_id(text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The backfill run, and the entries that belong to one.
-- ---------------------------------------------------------------------------

CREATE TABLE public.resident_ledger_backfills (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  entity_id uuid NOT NULL REFERENCES public.entities (id),
  as_of date NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  ran_by uuid REFERENCES auth.users (id),
  summary jsonb NOT NULL,
  notes text
);

CREATE INDEX idx_resident_ledger_backfills_entity
  ON public.resident_ledger_backfills (entity_id, as_of DESC);

ALTER TABLE public.resident_ledger_backfills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.resident_ledger_backfills FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.resident_ledger_backfills TO authenticated;

CREATE POLICY "Finance roles read resident ledger backfills"
  ON public.resident_ledger_backfills FOR SELECT TO authenticated USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- A backfill is evidence. 340 already has the refusal these tables share.
CREATE TRIGGER resident_ledger_backfills_immutable
  BEFORE UPDATE OR DELETE ON public.resident_ledger_backfills
  FOR EACH ROW EXECUTE FUNCTION haven.reject_finance_evidence_mutation();

CREATE TRIGGER resident_ledger_backfills_audit
  AFTER INSERT ON public.resident_ledger_backfills
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- Deferred, because the run's summary is only true once its entries are posted
-- and the entries table is append-only: there is no second pass to fill it in.
-- The run row and the entries it explains still commit together or not at all.
ALTER TABLE public.resident_ledger_entries
  ADD COLUMN opening_backfill_id uuid
    REFERENCES public.resident_ledger_backfills (id) DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN public.resident_ledger_entries.opening_backfill_id IS
  'COL-556: set on entries posted by a backfill of rows that pre-date the subledger. An opening entry is not a correction and not an operating event; naming the run is how a reader tells them apart at year end.';

CREATE INDEX idx_resident_ledger_entries_backfill
  ON public.resident_ledger_entries (opening_backfill_id)
  WHERE opening_backfill_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Split posting into a core and an asserting wrapper.
--
--    A bridged write has already been authorized by its own command -- the
--    payment guard, the invoice guard, the backfill's finance-scope assert --
--    and the row is being written inside that transaction. Re-deriving a
--    resident-ledger authority from auth.uid() there would refuse a legitimate
--    service-role or migration write and pass a request that was never checked.
--    The core keeps every other guarantee: the period lock, the posting-rule
--    account lookup, the reason catalog and the idempotency key. It is
--    reachable only from definer functions in haven; no request role can
--    execute it.
-- ---------------------------------------------------------------------------

CREATE FUNCTION haven.post_resident_ledger_entry_core(
  p_request_id uuid,
  p_resident_id uuid,
  p_entry_type text,
  p_amount_cents integer,
  p_effective_date date,
  p_source_type text DEFAULT NULL,
  p_source_id uuid DEFAULT NULL,
  p_reason_code text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_entry_group_id uuid DEFAULT NULL,
  p_opening_backfill_id uuid DEFAULT NULL
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

  SELECT entity_id INTO v_entity FROM public.facilities
   WHERE id = v_resident.facility_id AND deleted_at IS NULL;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'The resident facility has no legal entity; finance cannot post to it' USING ERRCODE='23514';
  END IF;

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
    source_type, source_id, reason_id, entry_group_id, request_id, notes,
    opening_backfill_id
  ) VALUES (
    v_resident.organization_id, v_entity, v_resident.facility_id, p_resident_id,
    v_kind, p_entry_type, p_amount_cents,
    v_rule.debit_gl_account_id, v_rule.credit_gl_account_id,
    p_effective_date, v_period, auth.uid(),
    p_source_type, p_source_id, v_reason.id,
    COALESCE(p_entry_group_id, pg_catalog.gen_random_uuid()), p_request_id,
    NULLIF(pg_catalog.btrim(p_notes), ''),
    p_opening_backfill_id
  ) RETURNING * INTO v_entry;

  RETURN pg_catalog.to_jsonb(v_entry);
END $function$;
REVOKE ALL ON FUNCTION haven.post_resident_ledger_entry_core(uuid, uuid, text, integer, date, text, uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.post_resident_ledger_entry(
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
DECLARE v_resident public.residents%ROWTYPE;
BEGIN
  SELECT * INTO v_resident FROM public.residents
   WHERE id = p_resident_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
  PERFORM haven.assert_resident_ledger_authority(v_resident.organization_id, v_resident.facility_id);
  RETURN haven.post_resident_ledger_entry_core(
    p_request_id, p_resident_id, p_entry_type, p_amount_cents, p_effective_date,
    p_source_type, p_source_id, p_reason_code, p_notes, p_entry_group_id, NULL);
END $function$;

CREATE FUNCTION haven.reverse_resident_ledger_entry_core(
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
    entry_group_id, request_id, notes, opening_backfill_id
  ) VALUES (
    v_original.organization_id, v_original.entity_id, v_original.facility_id, v_original.resident_id,
    v_original.account_kind, v_original.entry_type, v_original.amount_cents,
    v_original.credit_gl_account_id, v_original.debit_gl_account_id,
    p_effective_date, v_period, auth.uid(),
    v_original.source_type, v_original.source_id, v_original.reason_id, v_original.id,
    v_original.entry_group_id, p_request_id,
    NULLIF(pg_catalog.btrim(p_notes), ''), v_original.opening_backfill_id
  ) RETURNING * INTO v_entry;

  RETURN pg_catalog.to_jsonb(v_entry);
END $function$;
REVOKE ALL ON FUNCTION haven.reverse_resident_ledger_entry_core(uuid, uuid, date, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reverse_resident_ledger_entry(
  p_request_id uuid,
  p_entry_id uuid,
  p_effective_date date,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_original public.resident_ledger_entries%ROWTYPE;
BEGIN
  IF p_entry_id IS NULL THEN
    RAISE EXCEPTION 'A reversal needs a request id, the entry it reverses and an effective date' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_original FROM public.resident_ledger_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger entry unavailable' USING ERRCODE='42501'; END IF;
  PERFORM haven.assert_resident_ledger_authority(v_original.organization_id, v_original.facility_id);
  RETURN haven.reverse_resident_ledger_entry_core(p_request_id, p_entry_id, p_effective_date, p_notes);
END $function$;

-- ---------------------------------------------------------------------------
-- 5. Materializing an open period is bookkeeping, not a finance decision.
--
--    456 resolves the entity month by inserting an open gl_period_closes row
--    the first time something posts into it. 340's period guard demanded
--    owner/org_admin *posting* authority for that insert, so the first resident
--    posting of a month by a facility_admin -- the role that records payments --
--    failed with 'Current finance authority required' and never reached the
--    ledger. An open period row says exactly what an absent row says, so
--    creating one asks for the authority that already reads and writes resident
--    money. Closing one, reopening one, or striking control totals still needs
--    post authority. Everything after this branch is 340's body unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION haven.guard_finance_period() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; v_role text;
BEGIN
 IF TG_OP='INSERT' AND NEW.status='open' AND NEW.closed_at IS NULL AND NEW.closed_by IS NULL
    AND NEW.control_totals IS NULL AND NEW.deleted_at IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.entities WHERE id=NEW.entity_id AND organization_id=NEW.organization_id AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'Finance entity unavailable' USING ERRCODE='42501';
  END IF;
  -- A request role needs authority over resident money; a database-level writer
  -- (a migration, a seed, a repair run by finance) is already past every policy
  -- in this schema and must not be the one thing that cannot record a month.
  IF current_user IN('anon','authenticated','service_role') THEN
   SELECT a.actor_role_text INTO v_role FROM haven.current_authorized_actor() a;
   IF v_role IS NULL OR v_role NOT IN('owner','org_admin','facility_admin','manager','admin_assistant')
    OR NEW.organization_id IS DISTINCT FROM haven.organization_id() THEN
    RAISE EXCEPTION 'Current finance authority required' USING ERRCODE='42501';
   END IF;
  END IF;
  PERFORM haven.lock_finance_period(NEW.entity_id,make_date(NEW.period_year,NEW.period_month,1));
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Accounting periods retain their history' USING ERRCODE='42501'; END IF;
 actor:=haven.assert_finance_scope(NEW.entity_id,NULL,true);
 IF NEW.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Period organization mismatch' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND (NEW.entity_id,NEW.organization_id,NEW.period_year,NEW.period_month,NEW.deleted_at)
  IS DISTINCT FROM (OLD.entity_id,OLD.organization_id,OLD.period_year,OLD.period_month,OLD.deleted_at) THEN
  RAISE EXCEPTION 'Accounting period identity is immutable';
 END IF;
 IF NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Accounting periods cannot be deleted'; END IF;
 PERFORM haven.lock_finance_period(NEW.entity_id,make_date(NEW.period_year,NEW.period_month,1));
 IF NEW.status='closed' THEN NEW.closed_at:=now(); NEW.closed_by:=actor; END IF;
 RETURN NEW;
END $$;

-- 344 invalidates staged finance batches when a period closes, and asserted
-- batch-approval authority on every gl_period_closes row including a plain open
-- insert -- so it refused the same posting for the same reason, one trigger
-- later. Its siblings in 344 already scope their assert (finance_batch_control_
-- changed only asserts for a request role); this one did not. Materializing an
-- open period invalidates no batch, so there is nothing for it to guard there.
CREATE OR REPLACE FUNCTION haven.finance_batch_period_closed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF TG_OP='INSERT' AND NEW.status='open' THEN RETURN NEW; END IF;
 PERFORM haven.assert_finance_batch_actor(NEW.entity_id,NULL,true);
 IF NEW.status='closed' THEN PERFORM haven.invalidate_finance_batches(NEW.entity_id,'period','period_closed',make_date(NEW.period_year,NEW.period_month,1)); END IF;
 PERFORM haven.assert_finance_batch_actor(NEW.entity_id,NULL,true); RETURN NEW;
END $$;

COMMENT ON FUNCTION haven.finance_batch_period_closed() IS
  'Finance batch invalidation from 344; COL-556 stopped it asserting batch-approval authority on the open period row that 456 materializes the first time something posts into a month. Every close and reopen still asserts. Private definer trigger; no request-role grant.';

-- A correction lands where the books can still take it. The void of an invoice
-- whose month has already closed reverses in the open month, which is what the
-- build contract requires and what a closed period would otherwise refuse.
CREATE FUNCTION haven.resident_ledger_correction_date(p_entity_id uuid, p_preferred date)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT CASE
    WHEN p_preferred IS NULL THEN CURRENT_DATE
    WHEN EXISTS (
      SELECT 1 FROM public.gl_period_closes c
       WHERE c.entity_id = p_entity_id
         AND c.period_year = extract(YEAR FROM p_preferred)::integer
         AND c.period_month = extract(MONTH FROM p_preferred)::integer
         AND c.deleted_at IS NULL
         AND c.status <> 'open'
    ) THEN CURRENT_DATE
    ELSE p_preferred
  END
$function$;
REVOKE ALL ON FUNCTION haven.resident_ledger_correction_date(uuid, date) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Is this entity, on this date, carried on the subledger?
-- ---------------------------------------------------------------------------

CREATE FUNCTION haven.resident_ledger_active(p_entity_id uuid, p_effective_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.entity_gl_settings s
     WHERE s.entity_id = p_entity_id
       AND s.resident_ledger_from IS NOT NULL
       AND p_effective_date IS NOT NULL
       AND s.resident_ledger_from <= p_effective_date
  )
$function$;
REVOKE ALL ON FUNCTION haven.resident_ledger_active(uuid, date) FROM PUBLIC, anon, authenticated, service_role;

-- An invoice is on the ledger when its charge entry exists, whether a trigger
-- posted it or the backfill did. That, not a date, is what makes its settlement
-- safe to derive: derive from an empty ledger and a carried balance disappears.
CREATE FUNCTION haven.resident_invoice_on_ledger(p_invoice_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.resident_ledger_entries e
     WHERE e.source_type = 'invoice' AND e.source_id = p_invoice_id
       AND e.entry_type = 'resident_charge' AND e.reversal_of_id IS NULL
  )
$function$;
REVOKE ALL ON FUNCTION haven.resident_invoice_on_ledger(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- What the ledger says has settled this invoice: the allocated part of every
-- payment that reached the ledger, plus any opening settlement the backfill
-- posted for money the old tables recorded without a payment row. A reversed
-- entry settles nothing.
CREATE FUNCTION haven.resident_invoice_settled_cents(p_invoice_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT (
    COALESCE((
      SELECT sum(a.amount_cents)
        FROM public.payment_allocations a
        JOIN public.resident_ledger_entries e
          ON e.source_type = 'payment' AND e.source_id = a.payment_id
         AND e.entry_type = 'resident_payment' AND e.reversal_of_id IS NULL
       WHERE a.invoice_id = p_invoice_id
         AND NOT EXISTS (SELECT 1 FROM public.resident_ledger_entries r WHERE r.reversal_of_id = e.id)
    ), 0)
    + COALESCE((
      SELECT sum(CASE WHEN e.reversal_of_id IS NULL THEN e.amount_cents ELSE -e.amount_cents END)
        FROM public.resident_ledger_entries e
       WHERE e.source_type = 'invoice' AND e.source_id = p_invoice_id
         AND e.entry_type IN ('resident_payment', 'resident_write_off')
    ), 0)
  )::integer
$function$;
REVOKE ALL ON FUNCTION haven.resident_invoice_settled_cents(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION haven.resident_invoice_settled_cents(uuid) IS
  'COL-556: invoices.amount_paid derived from the ledger for any invoice that is on it. Private definer; no request-role grant.';

-- ---------------------------------------------------------------------------
-- 7. The forward path. Triggers, not RPC call sites, because the contract says
--    every write that moves resident money -- and a seed, a repair script and a
--    future migration are writes too.
-- ---------------------------------------------------------------------------

CREATE FUNCTION haven.bridge_invoice_to_resident_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_entity uuid; v_charge public.resident_ledger_entries%ROWTYPE; v_retired boolean;
BEGIN
  SELECT entity_id INTO v_entity FROM public.facilities
   WHERE id = NEW.facility_id AND deleted_at IS NULL;
  IF v_entity IS NULL THEN RETURN NULL; END IF;

  -- A resident whose facility has moved to another entity would post this
  -- charge into the wrong books. Refuse rather than land it somewhere plausible.
  IF NEW.entity_id IS DISTINCT FROM v_entity THEN
    IF haven.resident_ledger_active(v_entity, NEW.invoice_date)
       OR haven.resident_ledger_active(NEW.entity_id, NEW.invoice_date) THEN
      RAISE EXCEPTION 'Invoice % names entity % but its facility belongs to %; the resident subledger will not guess which entity owns this receivable',
        NEW.invoice_number, NEW.entity_id, v_entity USING ERRCODE='23514';
    END IF;
    RETURN NULL;
  END IF;

  v_retired := NEW.deleted_at IS NOT NULL OR NEW.voided_at IS NOT NULL OR NEW.status = 'void';

  SELECT * INTO v_charge FROM public.resident_ledger_entries
   WHERE source_type = 'invoice' AND source_id = NEW.id
     AND entry_type = 'resident_charge' AND reversal_of_id IS NULL;

  IF v_retired THEN
    -- Voiding an invoice that never reached the ledger is simply a void.
    IF v_charge.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.resident_ledger_entries WHERE reversal_of_id = v_charge.id) THEN
      PERFORM haven.reverse_resident_ledger_entry_core(
        haven.resident_ledger_request_id('invoice_charge_void', NEW.id),
        v_charge.id,
        haven.resident_ledger_correction_date(v_entity, COALESCE(NEW.voided_at::date, NEW.deleted_at::date)),
        'Invoice ' || NEW.invoice_number || ' voided');
    END IF;
    RETURN NULL;
  END IF;

  -- A draft is not a receivable. 340 already refuses to post a draft to the
  -- general ledger ("Issue the invoice before posting"); the subledger keeps the
  -- same line rather than inventing a second definition of issued.
  IF NEW.status = 'draft' THEN RETURN NULL; END IF;

  -- A written-off invoice is an expense decision that needs a reason from the
  -- approved catalog, and COL has not named its reasons (COL-226). It stays off
  -- the ledger and the tie-out reports it by name.
  IF NEW.status = 'written_off' THEN RETURN NULL; END IF;

  IF NOT haven.resident_ledger_active(v_entity, NEW.invoice_date) THEN RETURN NULL; END IF;

  -- Replaying the derived request id with a changed total raises rather than
  -- posting twice: a receivable already on the ledger is corrected by a
  -- reversing entry, never by rewriting the charge.
  PERFORM haven.post_resident_ledger_entry_core(
    haven.resident_ledger_request_id('invoice_charge', NEW.id),
    NEW.resident_id, 'resident_charge', NEW.total, NEW.invoice_date,
    'invoice', NEW.id, NULL, 'Invoice ' || NEW.invoice_number, NULL, NULL);
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION haven.bridge_invoice_to_resident_ledger() FROM PUBLIC, anon, authenticated, service_role;

-- Two triggers because a WHEN clause cannot see TG_OP and an INSERT has no OLD.
-- The update side is narrowed to the columns that can change what the resident
-- owes, so an updated_at touch does not re-enter the posting path.
CREATE TRIGGER resident_ledger_bridge_invoice_insert
  AFTER INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION haven.bridge_invoice_to_resident_ledger();

CREATE TRIGGER resident_ledger_bridge_invoice_update
  AFTER UPDATE ON public.invoices
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.total IS DISTINCT FROM NEW.total
    OR OLD.voided_at IS DISTINCT FROM NEW.voided_at
    OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
  )
  EXECUTE FUNCTION haven.bridge_invoice_to_resident_ledger();

CREATE FUNCTION haven.bridge_payment_to_resident_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_entity uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.amount <= 0 THEN RETURN NULL; END IF;
  SELECT entity_id INTO v_entity FROM public.facilities
   WHERE id = NEW.facility_id AND deleted_at IS NULL;
  IF v_entity IS NULL THEN RETURN NULL; END IF;
  IF NEW.entity_id IS DISTINCT FROM v_entity THEN
    IF haven.resident_ledger_active(v_entity, NEW.payment_date)
       OR haven.resident_ledger_active(NEW.entity_id, NEW.payment_date) THEN
      RAISE EXCEPTION 'Payment names entity % but its facility belongs to %; the resident subledger will not guess which entity received this money',
        NEW.entity_id, v_entity USING ERRCODE='23514';
    END IF;
    RETURN NULL;
  END IF;
  IF NOT haven.resident_ledger_active(v_entity, NEW.payment_date) THEN RETURN NULL; END IF;

  -- The source is the payment row. What it settled is the allocation, which is
  -- a separate immutable fact (340) -- an unapplied payment still reduces what
  -- the resident owes and must not be filed against an invoice it never paid.
  PERFORM haven.post_resident_ledger_entry_core(
    haven.resident_ledger_request_id('payment', NEW.id),
    NEW.resident_id, 'resident_payment', NEW.amount, NEW.payment_date,
    'payment', NEW.id, NULL, NULLIF(pg_catalog.btrim(NEW.reference_number), ''), NULL, NULL);
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION haven.bridge_payment_to_resident_ledger() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER resident_ledger_bridge_payment
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION haven.bridge_payment_to_resident_ledger();

CREATE FUNCTION haven.bridge_trust_transaction_to_resident_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_entity uuid; v_zone text; v_effective date;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.amount_cents <= 0 THEN RETURN NULL; END IF;
  SELECT f.entity_id, COALESCE(f.timezone, 'America/New_York') INTO v_entity, v_zone
    FROM public.facilities f WHERE f.id = NEW.facility_id AND f.deleted_at IS NULL;
  IF v_entity IS NULL THEN RETURN NULL; END IF;

  -- occurred_at is UTC. The effective date is the facility's calendar day, so a
  -- late-evening deposit does not land in tomorrow's month.
  v_effective := (NEW.occurred_at AT TIME ZONE v_zone)::date;
  IF NOT haven.resident_ledger_active(v_entity, v_effective) THEN RETURN NULL; END IF;

  PERFORM haven.post_resident_ledger_entry_core(
    haven.resident_ledger_request_id('trust_transaction', NEW.id),
    NEW.resident_id,
    CASE NEW.direction WHEN 'deposit' THEN 'trust_deposit' ELSE 'trust_withdrawal' END,
    NEW.amount_cents, v_effective,
    'resident_trust_transaction', NEW.id, NULL, NEW.description, NULL, NULL);
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION haven.bridge_trust_transaction_to_resident_ledger() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER resident_ledger_bridge_trust_transaction
  AFTER INSERT ON public.resident_trust_transactions
  FOR EACH ROW EXECUTE FUNCTION haven.bridge_trust_transaction_to_resident_ledger();

-- ---------------------------------------------------------------------------
-- 8. The invoice stops carrying its own settlement. Everything else in
--    haven.record_finance_payment is 340's body unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION haven.record_finance_payment(p_id uuid,p_resident_id uuid,p_invoice_id uuid,p_payment_date date,p_amount_cents integer,p_method text,p_reference text,p_payer_name text,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; inv public.invoices%ROWTYPE; actor uuid; payload jsonb; prior public.finance_command_receipts%ROWTYPE; applied integer:=0; settled integer; result jsonb;
BEGIN
 IF p_id IS NULL OR p_payment_date IS NULL OR p_amount_cents IS NULL OR p_amount_cents<=0 THEN RAISE EXCEPTION 'Payment identity, date and positive amount required'; END IF;
 SELECT r0.*,f.entity_id INTO r FROM public.residents r0 JOIN public.facilities f ON f.id=r0.facility_id WHERE r0.id=p_resident_id AND r0.deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.assert_finance_scope(r.entity_id,r.facility_id);
 IF r.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Resident organization does not match facility' USING ERRCODE='42501'; END IF;
 payload:=jsonb_build_object('resident_id',p_resident_id,'invoice_id',p_invoice_id,'payment_date',p_payment_date,'amount_cents',p_amount_cents,'method',p_method,
  'reference',nullif(btrim(p_reference),''),'payer_name',nullif(btrim(p_payer_name),''),'notes',nullif(btrim(p_notes),''));
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-payment:'||p_id,0));
 actor:=haven.assert_finance_scope(r.entity_id,r.facility_id);
 SELECT * INTO prior FROM public.finance_command_receipts WHERE command_type='payment' AND id=p_id;
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM payload OR prior.organization_id<>r.organization_id THEN RAISE EXCEPTION 'Command identity already used for different content' USING ERRCODE='23505'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO prior FROM public.finance_command_receipts WHERE command_type='payment_cancelled' AND id=p_id;
 IF FOUND THEN RAISE EXCEPTION 'Payment request was cancelled; start a new request' USING ERRCODE='23505'; END IF;
 IF p_invoice_id IS NOT NULL THEN
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR (inv.resident_id,inv.facility_id,inv.organization_id,inv.entity_id) IS DISTINCT FROM (p_resident_id,r.facility_id,r.organization_id,r.entity_id)
   OR inv.status NOT IN('sent','partial','overdue') OR inv.balance_due<=0 OR inv.balance_due IS DISTINCT FROM inv.total-inv.amount_paid OR inv.amount_paid<0 THEN RAISE EXCEPTION 'Open invoice unavailable in resident scope'; END IF;
  applied:=least(p_amount_cents,inv.balance_due);
 END IF;
 INSERT INTO public.payments(id,resident_id,facility_id,organization_id,entity_id,invoice_id,payment_date,amount,payment_method,reference_number,payer_name,notes,created_by,updated_by)
 VALUES(p_id,p_resident_id,r.facility_id,r.organization_id,r.entity_id,p_invoice_id,p_payment_date,p_amount_cents,p_method::public.payment_method,payload->>'reference',payload->>'payer_name',payload->>'notes',actor,actor);
 IF applied>0 THEN
  INSERT INTO public.payment_allocations(payment_id,invoice_id,organization_id,facility_id,amount_cents) VALUES(p_id,p_invoice_id,r.organization_id,r.facility_id,applied);
  -- COL-556: the allocation and the ledger entry are both written by now (the
  -- payment insert fired the bridge), so the settlement columns are read back
  -- from the ledger instead of being incremented on their own authority. An
  -- invoice that is not on the ledger keeps 340's arithmetic -- deriving from an
  -- empty ledger would erase a balance the backfill has not carried over yet.
  IF haven.resident_invoice_on_ledger(p_invoice_id) THEN
   settled:=haven.resident_invoice_settled_cents(p_invoice_id);
   IF settled<inv.amount_paid OR settled>inv.total THEN
    RAISE EXCEPTION 'Invoice % settles to % cents on the ledger but carries %; reconcile the subledger before recording payment', p_invoice_id, settled, inv.amount_paid USING ERRCODE='23514';
   END IF;
  ELSE
   settled:=inv.amount_paid+applied;
  END IF;
  UPDATE public.invoices SET amount_paid=settled,balance_due=total-settled,status=CASE WHEN total-settled<=0 THEN 'paid'::public.invoice_status ELSE 'partial'::public.invoice_status END,updated_by=actor WHERE id=p_invoice_id;
 END IF;
 result:=jsonb_build_object('payment_id',p_id,'allocated_cents',applied,'unapplied_cents',p_amount_cents-applied);
 INSERT INTO public.finance_command_receipts(command_type,id,organization_id,entity_id,facility_id,actor_id,actor_session_id,actor_claim_version,payload,result)
 SELECT 'payment',p_id,r.organization_id,r.entity_id,r.facility_id,actor,(auth.jwt()->>'session_id')::uuid,a.actor_claim_version,payload,result FROM haven.current_authorized_actor() a;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current finance authority required for receipt' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- 9. The plan: what a backfill would post and what it would refuse, read-only.
--    Refusing by name before anything is written is how an entity with no
--    account mapping stays refused by design instead of half-migrated.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.resident_ledger_backfill_plan(p_entity_id uuid, p_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_org uuid; v_as_of date; v_missing text[]; v_result jsonb;
BEGIN
  PERFORM haven.assert_finance_scope(p_entity_id, NULL, true);
  SELECT organization_id INTO v_org FROM public.entities WHERE id = p_entity_id AND deleted_at IS NULL;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Finance entity unavailable' USING ERRCODE='42501'; END IF;
  v_as_of := COALESCE(p_as_of, CURRENT_DATE);

  SELECT array_agg(needed ORDER BY needed) INTO v_missing
    FROM unnest(ARRAY['resident_charge','resident_payment','trust_deposit','trust_withdrawal']) AS needed
   WHERE NOT EXISTS (
     SELECT 1 FROM public.gl_posting_rules g
      WHERE g.entity_id = p_entity_id AND g.event_type = needed AND g.is_active AND g.deleted_at IS NULL);

  SELECT jsonb_build_object(
    'entity_id', p_entity_id,
    'as_of', v_as_of,
    'planned_at', statement_timestamp(),
    'resident_ledger_from', (SELECT s.resident_ledger_from FROM public.entity_gl_settings s WHERE s.entity_id = p_entity_id),
    'accounts_receivable_mapped', EXISTS (SELECT 1 FROM public.entity_gl_settings s WHERE s.entity_id = p_entity_id AND s.accounts_receivable_id IS NOT NULL),
    'trust_liability_mapped', EXISTS (SELECT 1 FROM public.entity_gl_settings s WHERE s.entity_id = p_entity_id AND s.trust_liability_id IS NOT NULL),
    'missing_posting_rules', COALESCE(pg_catalog.to_jsonb(v_missing), '[]'::jsonb),
    'invoices_to_post', (SELECT count(*) FROM public.invoices i WHERE i.entity_id = p_entity_id AND i.deleted_at IS NULL AND i.voided_at IS NULL AND i.status IN ('sent','partial','overdue','paid') AND i.invoice_date <= v_as_of),
    'invoice_charge_cents', (SELECT COALESCE(sum(i.total),0)::text FROM public.invoices i WHERE i.entity_id = p_entity_id AND i.deleted_at IS NULL AND i.voided_at IS NULL AND i.status IN ('sent','partial','overdue','paid') AND i.invoice_date <= v_as_of),
    'invoices_excluded_draft', (SELECT count(*) FROM public.invoices i WHERE i.entity_id = p_entity_id AND i.deleted_at IS NULL AND i.voided_at IS NULL AND i.status = 'draft'),
    'invoices_excluded_written_off', (SELECT count(*) FROM public.invoices i WHERE i.entity_id = p_entity_id AND i.deleted_at IS NULL AND i.voided_at IS NULL AND i.status = 'written_off'),
    'payments_to_post', (SELECT count(*) FROM public.payments p WHERE p.entity_id = p_entity_id AND p.deleted_at IS NULL AND p.amount > 0 AND p.payment_date <= v_as_of),
    'payment_cents', (SELECT COALESCE(sum(p.amount),0)::text FROM public.payments p WHERE p.entity_id = p_entity_id AND p.deleted_at IS NULL AND p.amount > 0 AND p.payment_date <= v_as_of),
    -- Settlement the invoices claim that no payment row explains. Every cent of
    -- this is a balance the ledger can only carry as an opening entry.
    'unexplained_settlement_cents', (
      SELECT COALESCE(sum(GREATEST(0, i.amount_paid - COALESCE(alloc.cents, 0))), 0)::text
        FROM public.invoices i
        LEFT JOIN LATERAL (SELECT sum(a.amount_cents) cents FROM public.payment_allocations a WHERE a.invoice_id = i.id) alloc ON true
       WHERE i.entity_id = p_entity_id AND i.deleted_at IS NULL AND i.voided_at IS NULL
         AND i.status IN ('sent','partial','overdue','paid') AND i.invoice_date <= v_as_of),
    'trust_transactions_to_post', (
      SELECT count(*) FROM public.resident_trust_transactions t
        JOIN public.facilities f ON f.id = t.facility_id
       WHERE f.entity_id = p_entity_id AND t.deleted_at IS NULL AND t.occurred_at::date <= v_as_of),
    -- A source row whose facility has moved entities cannot be posted without
    -- guessing which books own it.
    'residents_outside_entity', (
      SELECT count(DISTINCT i.resident_id) FROM public.invoices i
        JOIN public.residents res ON res.id = i.resident_id AND res.deleted_at IS NULL
        JOIN public.facilities f ON f.id = res.facility_id
       WHERE i.entity_id = p_entity_id AND i.deleted_at IS NULL AND f.entity_id IS DISTINCT FROM p_entity_id),
    'already_posted', (SELECT count(*) FROM public.resident_ledger_entries e WHERE e.entity_id = p_entity_id),
    'previous_backfills', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'as_of', b.as_of, 'ran_at', b.ran_at) ORDER BY b.ran_at DESC), '[]'::jsonb)
                             FROM public.resident_ledger_backfills b WHERE b.entity_id = p_entity_id)
  ) INTO v_result;
  RETURN v_result;
END $function$;
REVOKE ALL ON FUNCTION public.resident_ledger_backfill_plan(uuid, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resident_ledger_backfill_plan(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. The backfill itself. One run, one as-of, one attributable actor, and a
--     request id per source row so replaying it posts nothing new.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.backfill_resident_ledger_openings(
  p_backfill_id uuid,
  p_entity_id uuid,
  p_as_of date,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_org uuid; v_actor uuid; v_prior public.resident_ledger_backfills%ROWTYPE;
  v_row record; v_gap integer; v_summary jsonb;
  v_charges integer := 0; v_payments integer := 0; v_openings integer := 0; v_trust integer := 0;
  v_charge_cents bigint := 0; v_payment_cents bigint := 0; v_opening_cents bigint := 0; v_trust_cents bigint := 0;
BEGIN
  IF p_backfill_id IS NULL OR p_entity_id IS NULL OR p_as_of IS NULL THEN
    RAISE EXCEPTION 'A backfill needs its own id, an entity and a stated as-of date' USING ERRCODE='23514';
  END IF;
  v_actor := haven.assert_finance_scope(p_entity_id, NULL, true);
  SELECT organization_id INTO v_org FROM public.entities WHERE id = p_entity_id AND deleted_at IS NULL;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Finance entity unavailable' USING ERRCODE='42501'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('resident-ledger-backfill:' || p_entity_id::text, 0));

  SELECT * INTO v_prior FROM public.resident_ledger_backfills WHERE id = p_backfill_id;
  IF FOUND THEN
    IF v_prior.entity_id <> p_entity_id OR v_prior.as_of <> p_as_of THEN
      RAISE EXCEPTION 'Backfill identity already used for a different entity or as-of' USING ERRCODE='23505';
    END IF;
    RETURN v_prior.summary;
  END IF;

  -- Order matters. Payments reach the ledger before the invoice settlements are
  -- reconciled against them, so an opening entry is only ever posted for money
  -- no payment row explains.
  FOR v_row IN
    SELECT p.id, p.resident_id, p.amount, p.payment_date, p.reference_number
      FROM public.payments p
     WHERE p.entity_id = p_entity_id AND p.deleted_at IS NULL AND p.amount > 0
       AND p.payment_date <= p_as_of
     ORDER BY p.payment_date, p.id
  LOOP
    PERFORM haven.post_resident_ledger_entry_core(
      haven.resident_ledger_request_id('payment', v_row.id),
      v_row.resident_id, 'resident_payment', v_row.amount, v_row.payment_date,
      'payment', v_row.id, NULL, NULLIF(pg_catalog.btrim(v_row.reference_number), ''), NULL, p_backfill_id);
    v_payments := v_payments + 1;
    v_payment_cents := v_payment_cents + v_row.amount;
  END LOOP;

  FOR v_row IN
    SELECT i.id, i.resident_id, i.total, i.invoice_date, i.invoice_number, i.amount_paid,
           COALESCE((SELECT sum(a.amount_cents) FROM public.payment_allocations a WHERE a.invoice_id = i.id), 0)::integer AS allocated
      FROM public.invoices i
     WHERE i.entity_id = p_entity_id AND i.deleted_at IS NULL AND i.voided_at IS NULL
       AND i.status IN ('sent','partial','overdue','paid')
       AND i.invoice_date <= p_as_of
     ORDER BY i.invoice_date, i.id
  LOOP
    PERFORM haven.post_resident_ledger_entry_core(
      haven.resident_ledger_request_id('invoice_charge', v_row.id),
      v_row.resident_id, 'resident_charge', v_row.total, v_row.invoice_date,
      'invoice', v_row.id, NULL, 'Invoice ' || v_row.invoice_number, NULL, p_backfill_id);
    v_charges := v_charges + 1;
    v_charge_cents := v_charge_cents + v_row.total;

    v_gap := GREATEST(0, v_row.amount_paid - v_row.allocated);
    IF v_gap > 0 THEN
      -- Settlement the invoice document carries that no payment row explains.
      -- It is real money the resident no longer owes, so the ledger carries it
      -- as an opening entry against the invoice rather than pretending the
      -- balance is higher than the facility has been collecting on.
      PERFORM haven.post_resident_ledger_entry_core(
        haven.resident_ledger_request_id('invoice_opening_settlement', v_row.id),
        v_row.resident_id, 'resident_payment', v_gap, v_row.invoice_date,
        'invoice', v_row.id, NULL,
        'Opening settlement carried from invoice ' || v_row.invoice_number || ' (no payment record)',
        NULL, p_backfill_id);
      v_openings := v_openings + 1;
      v_opening_cents := v_opening_cents + v_gap;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT t.id, t.resident_id, t.direction, t.amount_cents, t.description,
           (t.occurred_at AT TIME ZONE COALESCE(f.timezone, 'America/New_York'))::date AS effective_date
      FROM public.resident_trust_transactions t
      JOIN public.facilities f ON f.id = t.facility_id
     WHERE f.entity_id = p_entity_id AND t.deleted_at IS NULL AND t.amount_cents > 0
       AND (t.occurred_at AT TIME ZONE COALESCE(f.timezone, 'America/New_York'))::date <= p_as_of
     ORDER BY t.occurred_at, t.id
  LOOP
    PERFORM haven.post_resident_ledger_entry_core(
      haven.resident_ledger_request_id('trust_transaction', v_row.id),
      v_row.resident_id,
      CASE v_row.direction WHEN 'deposit' THEN 'trust_deposit' ELSE 'trust_withdrawal' END,
      v_row.amount_cents, v_row.effective_date,
      'resident_trust_transaction', v_row.id, NULL, v_row.description, NULL, p_backfill_id);
    v_trust := v_trust + 1;
    v_trust_cents := v_trust_cents + v_row.amount_cents;
  END LOOP;

  v_summary := jsonb_build_object(
    'entity_id', p_entity_id, 'as_of', p_as_of,
    'charges_posted', v_charges, 'charge_cents', v_charge_cents::text,
    'payments_posted', v_payments, 'payment_cents', v_payment_cents::text,
    'opening_settlements_posted', v_openings, 'opening_settlement_cents', v_opening_cents::text,
    'trust_entries_posted', v_trust, 'trust_cents', v_trust_cents::text);

  INSERT INTO public.resident_ledger_backfills (id, organization_id, entity_id, as_of, ran_by, summary, notes)
  VALUES (p_backfill_id, v_org, p_entity_id, p_as_of, v_actor, v_summary, NULLIF(pg_catalog.btrim(p_notes), ''));

  RETURN v_summary;
END $function$;
REVOKE ALL ON FUNCTION public.backfill_resident_ledger_openings(uuid, uuid, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_resident_ledger_openings(uuid, uuid, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. The tie-out. Per resident, what the ledger says against what the old
--     tables say -- a probe anyone can call, with the variances named.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.resident_ledger_tie_out(p_organization_id uuid, p_facility_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF haven.authorized_user_id() IS NULL
     OR p_organization_id IS DISTINCT FROM haven.organization_id()
     OR haven.app_role() NOT IN ('owner','org_admin','facility_admin')
     OR (p_facility_id IS NOT NULL AND NOT haven.has_facility_access(p_facility_id)) THEN
    RAISE EXCEPTION 'Resident ledger tie-out scope not authorized' USING ERRCODE='42501';
  END IF;

  WITH scoped_residents AS (
    SELECT r.id, r.facility_id
      FROM public.residents r
     WHERE r.organization_id = p_organization_id AND r.deleted_at IS NULL
       AND (p_facility_id IS NULL OR r.facility_id = p_facility_id)
       AND r.facility_id IN (SELECT haven.accessible_facility_ids())
  ), ledger AS (
    -- One row per resident. A resident who moved facilities has entries under
    -- both, and the balance is still one balance.
    SELECT b.resident_id,
           sum(b.receivable_balance_cents)::bigint AS receivable_cents,
           sum(b.trust_balance_cents)::bigint AS trust_cents,
           sum(b.entry_count)::bigint AS entry_count
      FROM public.resident_ledger_balances b
      JOIN scoped_residents s ON s.id = b.resident_id
     GROUP BY b.resident_id
  ), source_receivable AS (
    SELECT i.resident_id, sum(i.balance_due)::bigint AS cents, count(*) AS invoices
      FROM public.invoices i
      JOIN scoped_residents s ON s.id = i.resident_id
     WHERE i.deleted_at IS NULL AND i.voided_at IS NULL
       AND i.status IN ('sent','partial','overdue','paid')
     GROUP BY i.resident_id
  ), unapplied_payments AS (
    -- Cash the resident has handed over that no invoice has absorbed yet. The
    -- ledger nets it against the receivable the moment it is captured; the
    -- invoice documents cannot, so the comparison has to name it or every
    -- unapplied payment reads as a variance forever.
    SELECT p.resident_id, sum(p.amount - COALESCE(a.cents, 0))::bigint AS cents
      FROM public.payments p
      JOIN scoped_residents s ON s.id = p.resident_id
      LEFT JOIN LATERAL (
        SELECT sum(pa.amount_cents) AS cents FROM public.payment_allocations pa WHERE pa.payment_id = p.id
      ) a ON true
     WHERE p.deleted_at IS NULL AND p.refunded = false
     GROUP BY p.resident_id
  ), source_written_off AS (
    SELECT i.resident_id, sum(i.balance_due)::bigint AS cents
      FROM public.invoices i
      JOIN scoped_residents s ON s.id = i.resident_id
     WHERE i.deleted_at IS NULL AND i.voided_at IS NULL AND i.status = 'written_off'
     GROUP BY i.resident_id
  ), source_draft AS (
    SELECT i.resident_id, sum(i.balance_due)::bigint AS cents
      FROM public.invoices i
      JOIN scoped_residents s ON s.id = i.resident_id
     WHERE i.deleted_at IS NULL AND i.voided_at IS NULL AND i.status = 'draft'
     GROUP BY i.resident_id
  ), source_trust AS (
    SELECT t.resident_id, t.balance_cents::bigint AS cents
      FROM public.resident_trust_accounts t
      JOIN scoped_residents s ON s.id = t.resident_id
     WHERE t.deleted_at IS NULL
  ), compared AS (
    SELECT s.id AS resident_id, s.facility_id,
           COALESCE(b.receivable_cents, 0) AS ledger_receivable_cents,
           COALESCE(b.trust_cents, 0) AS ledger_trust_cents,
           COALESCE(b.entry_count, 0) AS ledger_entry_count,
           COALESCE(sr.cents, 0) - COALESCE(up.cents, 0) AS source_receivable_cents,
           COALESCE(sr.invoices, 0) AS source_invoice_count,
           COALESCE(up.cents, 0) AS unapplied_payment_cents,
           COALESCE(st.cents, 0) AS source_trust_cents,
           COALESCE(sw.cents, 0) AS written_off_cents,
           COALESCE(sd.cents, 0) AS draft_cents
      FROM scoped_residents s
      LEFT JOIN ledger b ON b.resident_id = s.id
      LEFT JOIN source_receivable sr ON sr.resident_id = s.id
      LEFT JOIN unapplied_payments up ON up.resident_id = s.id
      LEFT JOIN source_trust st ON st.resident_id = s.id
      LEFT JOIN source_written_off sw ON sw.resident_id = s.id
      LEFT JOIN source_draft sd ON sd.resident_id = s.id
     WHERE COALESCE(b.entry_count, 0) > 0 OR COALESCE(sr.cents, 0) <> 0 OR COALESCE(up.cents, 0) <> 0
        OR COALESCE(st.cents, 0) <> 0 OR COALESCE(sw.cents, 0) <> 0 OR COALESCE(sd.cents, 0) <> 0
  )
  SELECT jsonb_build_object(
    'as_of', statement_timestamp(),
    'organization_id', p_organization_id,
    'facility_id', p_facility_id,
    'residents_compared', count(*),
    'receivable_variance_cents', sum(ledger_receivable_cents - source_receivable_cents)::text,
    'trust_variance_cents', sum(ledger_trust_cents - source_trust_cents)::text,
    'residents_in_variance', count(*) FILTER (
      WHERE ledger_receivable_cents <> source_receivable_cents OR ledger_trust_cents <> source_trust_cents),
    'draft_receivable_excluded_cents', sum(draft_cents)::text,
    'written_off_excluded_cents', sum(written_off_cents)::text,
    'unapplied_payment_cents', sum(unapplied_payment_cents)::text,
    'variances', COALESCE(jsonb_agg(jsonb_build_object(
        'resident_id', resident_id, 'facility_id', facility_id,
        'ledger_receivable_cents', ledger_receivable_cents::text,
        'source_receivable_cents', source_receivable_cents::text,
        'ledger_trust_cents', ledger_trust_cents::text,
        'source_trust_cents', source_trust_cents::text,
        'ledger_entry_count', ledger_entry_count,
        'source_invoice_count', source_invoice_count,
        'reason', CASE
          WHEN ledger_entry_count = 0 THEN 'not_on_ledger'
          WHEN ledger_receivable_cents = 0 AND source_receivable_cents <> 0 THEN 'account_mapping_mismatch'
          ELSE 'amounts_differ' END
      ) ORDER BY resident_id) FILTER (
      WHERE ledger_receivable_cents <> source_receivable_cents OR ledger_trust_cents <> source_trust_cents), '[]'::jsonb)
  ) INTO v_result FROM compared;
  RETURN COALESCE(v_result, jsonb_build_object('as_of', statement_timestamp(), 'residents_compared', 0, 'variances', '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.resident_ledger_tie_out(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resident_ledger_tie_out(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. resident_money_snapshot (342) now reports the ledger as canonical, and
--     stops demanding a legacy review for a resident whose money it carries.
--     The legacy table (trust_account_entries, 060) is still not migrated --
--     COL-563 decides its fate -- so a resident with legacy rows and nothing on
--     the ledger still reads as needing review, which is the truth.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resident_money_snapshot(p_organization_id uuid,p_facility_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF haven.authorized_user_id() IS NULL OR p_organization_id IS DISTINCT FROM haven.organization_id()
 OR haven.app_role() NOT IN('owner','org_admin','facility_admin')
 OR (p_facility_id IS NOT NULL AND NOT haven.has_facility_access(p_facility_id)) THEN
  RAISE EXCEPTION 'Resident money scope not authorized' USING ERRCODE='42501';
 END IF;
 -- All source reads share this statement snapshot and caller RLS. Missing
 -- canonical accounts remain null, never a fabricated zero or legacy sum.
 WITH accounts AS (
  SELECT * FROM public.resident_trust_accounts
  WHERE organization_id=p_organization_id AND deleted_at IS NULL
   AND (p_facility_id IS NULL OR facility_id=p_facility_id)
 ), legacy AS (
  SELECT DISTINCT ON(resident_id) resident_id,facility_id,balance_after_cents,entry_date,
   count(*) OVER(PARTITION BY resident_id) AS entry_count
  FROM public.trust_account_entries
  WHERE organization_id=p_organization_id AND deleted_at IS NULL
   AND (p_facility_id IS NULL OR facility_id=p_facility_id)
  ORDER BY resident_id,entry_date DESC,created_at DESC,id DESC
 ), ledger AS (
  -- One row per resident; a resident who moved facilities has entries under
  -- both and still has one trust balance.
  SELECT resident_id,(array_agg(facility_id ORDER BY last_recorded_at DESC NULLS LAST))[1] AS facility_id,
   sum(trust_balance_cents)::bigint AS trust_balance_cents,
   sum(entry_count)::bigint AS ledger_entry_count,max(last_recorded_at) AS last_recorded_at
  FROM public.resident_ledger_balances
  WHERE organization_id=p_organization_id
   AND (p_facility_id IS NULL OR facility_id=p_facility_id)
  GROUP BY resident_id
 ), scope AS (
  SELECT resident_id FROM accounts UNION SELECT resident_id FROM legacy UNION SELECT resident_id FROM ledger
 ), movements AS (
  SELECT t.account_id,count(*) AS entry_count,
   sum(CASE WHEN t.direction='deposit' THEN t.amount_cents::bigint ELSE -t.amount_cents::bigint END) AS movement_cents,
   max(t.occurred_at) AS last_entry_at
  FROM public.resident_trust_transactions t JOIN accounts a ON a.id=t.account_id
  WHERE t.organization_id=p_organization_id AND t.deleted_at IS NULL
  GROUP BY t.account_id
 ) SELECT jsonb_build_object('as_of',statement_timestamp(),'canonical_ledger','resident_ledger_entries',
  'external_reconciliation','NOT_VERIFIED','rows',coalesce(jsonb_agg(jsonb_build_object(
   'resident_id',s.resident_id,'facility_id',coalesce(a.facility_id,g.facility_id,l.facility_id),'account_id',a.id,
   'balance_cents',a.balance_cents,'ledger_movement_cents',coalesce(m.movement_cents,0)::text,
   'legacy_balance_cents',l.balance_after_cents,'legacy_entry_count',coalesce(l.entry_count,0),
   'ledger_entry_count',coalesce(m.entry_count,0),'last_entry_at',m.last_entry_at,
   -- COL-556: a legacy balance needs review while the ledger of record says
   -- nothing about this resident. Once it carries them, the legacy rows are
   -- superseded rather than outstanding.
   'legacy_review_required',l.resident_id IS NOT NULL AND coalesce(g.ledger_entry_count,0)=0,
   'ledger_matches_balance',a.id IS NOT NULL AND a.balance_cents=coalesce(m.movement_cents,0),
   'record_of_trust_balance_cents',coalesce(g.trust_balance_cents,0)::text,
   'record_of_entry_count',coalesce(g.ledger_entry_count,0),
   'record_of_matches_account',a.id IS NOT NULL AND a.balance_cents=coalesce(g.trust_balance_cents,0)
  ) ORDER BY coalesce(a.facility_id,g.facility_id,l.facility_id),s.resident_id),'[]')) INTO result
 FROM scope s LEFT JOIN accounts a USING(resident_id) LEFT JOIN legacy l USING(resident_id)
  LEFT JOIN ledger g USING(resident_id) LEFT JOIN movements m ON m.account_id=a.id;
 RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- 13. Comments, including the COL-37 rulings the new definer surface needs.
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.resident_ledger_backfills IS
  'COL-556: one attributable run that carried pre-existing invoices, payments and trust transactions onto the resident ledger as opening entries, with the as-of it was struck against. Immutable; a second pass is a second run.';

COMMENT ON FUNCTION public.post_resident_ledger_entry(uuid, uuid, text, integer, date, text, uuid, text, text, uuid) IS
  'COL-540, split in COL-556. COL-37 ruling: definer required. The entries table has no INSERT policy on purpose -- the period lock, the posting-rule account lookup and the idempotency key are the only way in, and an invoker insert would bypass all three. Current server-derived owner/org_admin/facility_admin/manager/admin_assistant authority and facility access are asserted against auth.uid() before haven.post_resident_ledger_entry_core writes anything. Returns the entry receipt; replaying a request id returns the same row.';
COMMENT ON FUNCTION public.reverse_resident_ledger_entry(uuid, uuid, date, text) IS
  'COL-540, split in COL-556. COL-37 ruling: definer required for the same reason as post_resident_ledger_entry -- the append-only table has no write policy, and a reversal must read the original row under one authority and write its mirror in the open period. Authority is asserted against the original entry scope; one reversal per entry.';
COMMENT ON FUNCTION haven.post_resident_ledger_entry_core(uuid, uuid, text, integer, date, text, uuid, text, text, uuid, uuid) IS
  'COL-556: the posting body without the authority assert, for writes that were already authorized by the command or trigger that produced them. Keeps the period, posting-rule and idempotency guarantees. Private definer; no request-role grant, so the only callers are definer functions in haven.';
COMMENT ON FUNCTION haven.reverse_resident_ledger_entry_core(uuid, uuid, date, text) IS
  'COL-556: the reversal body without the authority assert, for corrections a bridged write produces (an invoice void). Private definer; no request-role grant.';
COMMENT ON FUNCTION haven.guard_finance_period() IS
  'Period guard from 340; COL-556 lets the roles that already move resident money materialize an open period, because an open period row says what an absent row says and 456 creates one the first time something posts into a month. Closing, reopening and control totals still need post authority. Private definer trigger; no request-role grant.';
COMMENT ON FUNCTION haven.bridge_invoice_to_resident_ledger() IS
  'COL-556: an issued invoice posts its receivable charge to the resident subledger; a voided one reverses it in a period that can still take it. Drafts and write-offs are excluded by name. Private definer trigger; no request-role grant.';
COMMENT ON FUNCTION haven.bridge_payment_to_resident_ledger() IS
  'COL-556: a recorded payment posts to the resident subledger against the payment row, not the invoice -- an unapplied payment still reduces what the resident owes. Private definer trigger; no request-role grant.';
COMMENT ON FUNCTION haven.bridge_trust_transaction_to_resident_ledger() IS
  'COL-556: a trust deposit or withdrawal posts to the resident subledger on the facility''s calendar day. Private definer trigger; no request-role grant.';
COMMENT ON FUNCTION public.backfill_resident_ledger_openings(uuid, uuid, date, text) IS
  'COL-556. COL-37 ruling: definer required. The resident ledger has no write policy and a backfill must post entries with their original effective dates across every resident in an entity, which no invoker grant can do without opening the table. Owner/org_admin finance scope for the entity is asserted first via haven.assert_finance_scope(entity, NULL, true), the run is serialized per entity, and every request id is derived from the source row so re-running posts nothing. Refuses by name when the entity has no posting rule -- Haven does not choose accounts.';
COMMENT ON FUNCTION public.resident_ledger_backfill_plan(uuid, date) IS
  'COL-556. COL-37 ruling: definer required. Reads invoices, payments, trust transactions and posting rules across a whole entity to say what a backfill would post and what it would refuse; an invoker read would silently under-report whatever the caller''s facility scope hides, which is the one thing a migration plan must not do. Owner/org_admin finance scope for the entity is asserted first. Read-only.';
COMMENT ON FUNCTION public.resident_ledger_tie_out(uuid, uuid) IS
  'COL-556: per-resident comparison of the resident ledger against the balance the invoices and trust accounts report, with the variances named. Security invoker -- the caller''s RLS is the scope, and a finance role is asserted before anything is read.';
COMMENT ON FUNCTION public.resident_money_snapshot(uuid, uuid) IS
  'COL-556: resident trust read alignment. The canonical ledger is resident_ledger_entries; the trust account balance and the legacy table are reported beside it, never summed into it.';

NOTIFY pgrst, 'reload schema';
COMMIT;
