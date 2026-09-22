-- COL-567: a resident balance is either correct or refused, never a silent zero.
--
-- resident_ledger_balances (456) sums an entry only when one of its legs is the
-- entity's mapped receivable (accounts_receivable_id) or trust liability
-- (trust_liability_id). The legs come from gl_posting_rules; nothing made the
-- two agree. A rule naming any other account posted valid, immutable entries
-- that the balance view summed to 0 -- a plausible number, and wrong.
--
-- What changes:
--
--   1. An active posting rule for a resident event type must carry the mapped
--      account on one leg (receivable events: accounts_receivable_id; trust
--      events: trust_liability_id), and the mapping must exist. Checked when the
--      rule is written and again when a mapping changes.
--   2. Every new ledger entry is checked the same way at insert, so no writer
--      (the posting command, the bridge, a backfill, a later migration) can
--      land an entry the balance view would not count.
--   3. Once an entity has ledger entries of a kind, its mapped account for that
--      kind cannot change: re-pointing it would silently rewrite every
--      historical balance. A deliberate re-mapping is a reviewed migration.
--   4. The view gains unmapped_entry_count: entries whose legs match neither
--      mapped account (only possible for rows written before this migration).
--      Consumers must treat a non-zero count as "balance unavailable".
--
-- Production at authoring time (2026-09-22): zero entries, zero resident
-- posting rules, zero entity_gl_settings rows. The pre-flight below fails the
-- apply rather than grandfathering a bad rule if that is no longer true.
--
-- Mapping values themselves stay configuration: this decides nothing about
-- which account, only that the rule and the mapping name the same one.

BEGIN;

CREATE OR REPLACE FUNCTION haven.resident_ledger_mapped_account(p_entity_id uuid, p_event_type text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_event_type IN ('trust_deposit', 'trust_withdrawal') THEN s.trust_liability_id
              ELSE s.accounts_receivable_id END
  FROM public.entity_gl_settings s
  WHERE s.entity_id = p_entity_id
$$;
REVOKE ALL ON FUNCTION haven.resident_ledger_mapped_account(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.resident_ledger_is_event(p_event_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_event_type IN ('resident_charge', 'resident_payment', 'resident_adjustment', 'resident_write_off',
                          'resident_refund', 'trust_deposit', 'trust_withdrawal')
$$;
REVOKE ALL ON FUNCTION haven.resident_ledger_is_event(text) FROM PUBLIC, anon, authenticated, service_role;

-- Names both sides of the disagreement so finance can fix the right one.
CREATE OR REPLACE FUNCTION haven.assert_resident_ledger_legs(
  p_entity_id uuid, p_event_type text, p_debit uuid, p_credit uuid, p_what text
) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_mapped uuid := haven.resident_ledger_mapped_account(p_entity_id, p_event_type);
  v_field text := CASE WHEN p_event_type IN ('trust_deposit', 'trust_withdrawal') THEN 'trust_liability_id'
                       ELSE 'accounts_receivable_id' END;
BEGIN
  IF v_mapped IS NULL THEN
    RAISE EXCEPTION '% for "%" cannot be used: this entity has no entity_gl_settings.% mapped. Map the account first so the balance can count it.',
      p_what, p_event_type, v_field USING ERRCODE = '23514';
  END IF;
  IF (p_debit = v_mapped) = (p_credit = v_mapped) THEN
    RAISE EXCEPTION '% for "%" posts debit % / credit %, but entity_gl_settings.% is %. Exactly one leg must be that account, or the resident balance would read it as zero.',
      p_what, p_event_type, p_debit, p_credit, v_field, v_mapped USING ERRCODE = '23514';
  END IF;
END $$;
REVOKE ALL ON FUNCTION haven.assert_resident_ledger_legs(uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- 1. Posting rules
CREATE OR REPLACE FUNCTION haven.guard_resident_posting_rule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF haven.resident_ledger_is_event(NEW.event_type) AND NEW.is_active AND NEW.deleted_at IS NULL THEN
    PERFORM haven.assert_resident_ledger_legs(NEW.entity_id, NEW.event_type, NEW.debit_gl_account_id,
                                              NEW.credit_gl_account_id, 'A posting rule');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_resident_posting_rule() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_gl_posting_rules_resident_mapping ON public.gl_posting_rules;
CREATE TRIGGER tr_gl_posting_rules_resident_mapping
  BEFORE INSERT OR UPDATE ON public.gl_posting_rules
  FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_posting_rule();

-- 2. Every entry, whoever writes it
CREATE OR REPLACE FUNCTION haven.guard_resident_ledger_entry_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM haven.assert_resident_ledger_legs(NEW.entity_id, NEW.entry_type, NEW.debit_gl_account_id,
                                            NEW.credit_gl_account_id, 'A ledger entry');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_resident_ledger_entry_mapping() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_resident_ledger_entries_mapping ON public.resident_ledger_entries;
CREATE TRIGGER tr_resident_ledger_entries_mapping
  BEFORE INSERT ON public.resident_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_ledger_entry_mapping();

-- 3. The mapping, once entries or rules depend on it
CREATE OR REPLACE FUNCTION haven.guard_entity_ledger_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.accounts_receivable_id IS DISTINCT FROM OLD.accounts_receivable_id
     AND EXISTS (SELECT 1 FROM public.resident_ledger_entries e
                 WHERE e.entity_id = OLD.entity_id AND e.account_kind = 'receivable') THEN
    RAISE EXCEPTION 'accounts_receivable_id cannot change: this entity already has resident receivable entries, and re-pointing the mapping would rewrite every historical balance. Re-mapping is a reviewed migration.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.trust_liability_id IS DISTINCT FROM OLD.trust_liability_id
     AND EXISTS (SELECT 1 FROM public.resident_ledger_entries e
                 WHERE e.entity_id = OLD.entity_id AND e.account_kind = 'trust') THEN
    RAISE EXCEPTION 'trust_liability_id cannot change: this entity already has resident trust entries, and re-pointing the mapping would rewrite every historical balance. Re-mapping is a reviewed migration.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.entity_id IS DISTINCT FROM OLD.entity_id THEN
    RAISE EXCEPTION 'entity_gl_settings.entity_id is fixed once written' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_entity_ledger_mapping() FROM PUBLIC, anon, authenticated, service_role;

-- After the row changes, every active resident rule must still agree with it.
CREATE OR REPLACE FUNCTION haven.recheck_resident_rules_after_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT g.event_type, g.debit_gl_account_id, g.credit_gl_account_id
           FROM public.gl_posting_rules g
           WHERE g.entity_id = NEW.entity_id AND g.is_active AND g.deleted_at IS NULL
             AND haven.resident_ledger_is_event(g.event_type)
  LOOP
    PERFORM haven.assert_resident_ledger_legs(NEW.entity_id, r.event_type, r.debit_gl_account_id,
                                              r.credit_gl_account_id, 'An active posting rule');
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION haven.recheck_resident_rules_after_mapping() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_entity_gl_settings_ledger_mapping ON public.entity_gl_settings;
CREATE TRIGGER tr_entity_gl_settings_ledger_mapping
  BEFORE UPDATE ON public.entity_gl_settings
  FOR EACH ROW EXECUTE FUNCTION haven.guard_entity_ledger_mapping();

DROP TRIGGER IF EXISTS tr_entity_gl_settings_recheck_rules ON public.entity_gl_settings;
CREATE CONSTRAINT TRIGGER tr_entity_gl_settings_recheck_rules
  AFTER INSERT OR UPDATE ON public.entity_gl_settings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION haven.recheck_resident_rules_after_mapping();

-- A mapping row deleted out from under live rules or entries is the same failure.
CREATE OR REPLACE FUNCTION haven.refuse_entity_ledger_mapping_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.resident_ledger_entries e WHERE e.entity_id = OLD.entity_id)
     OR EXISTS (SELECT 1 FROM public.gl_posting_rules g WHERE g.entity_id = OLD.entity_id AND g.is_active
                AND g.deleted_at IS NULL AND haven.resident_ledger_is_event(g.event_type)) THEN
    RAISE EXCEPTION 'This entity''s GL mapping carries resident ledger entries or active resident posting rules and cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION haven.refuse_entity_ledger_mapping_delete() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_entity_gl_settings_ledger_delete ON public.entity_gl_settings;
CREATE TRIGGER tr_entity_gl_settings_ledger_delete
  BEFORE DELETE ON public.entity_gl_settings
  FOR EACH ROW EXECUTE FUNCTION haven.refuse_entity_ledger_mapping_delete();

-- Pre-flight: fail the apply on any existing rule or entry this would have refused.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT g.entity_id, g.event_type, g.debit_gl_account_id, g.credit_gl_account_id
           FROM public.gl_posting_rules g
           WHERE g.is_active AND g.deleted_at IS NULL AND haven.resident_ledger_is_event(g.event_type)
  LOOP
    PERFORM haven.assert_resident_ledger_legs(r.entity_id, r.event_type, r.debit_gl_account_id,
                                              r.credit_gl_account_id, 'Existing posting rule');
  END LOOP;
END $$;

-- 4. The view says when it cannot answer.
CREATE OR REPLACE VIEW public.resident_ledger_balances
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
  MAX(e.recorded_at) AS last_recorded_at,
  COUNT(*) FILTER (WHERE
    (e.account_kind = 'receivable' AND s.accounts_receivable_id IS DISTINCT FROM e.debit_gl_account_id
                                   AND s.accounts_receivable_id IS DISTINCT FROM e.credit_gl_account_id)
    OR (e.account_kind = 'trust' AND s.trust_liability_id IS DISTINCT FROM e.debit_gl_account_id
                                 AND s.trust_liability_id IS DISTINCT FROM e.credit_gl_account_id)
  ) AS unmapped_entry_count
FROM public.resident_ledger_entries e
LEFT JOIN public.entity_gl_settings s ON s.entity_id = e.entity_id
GROUP BY e.organization_id, e.entity_id, e.facility_id, e.resident_id;

REVOKE ALL ON public.resident_ledger_balances FROM PUBLIC, anon;
GRANT SELECT ON public.resident_ledger_balances TO authenticated;

COMMENT ON VIEW public.resident_ledger_balances IS
  'COL-540/COL-567: resident receivable and trust balances derived from the entries against the entity account mapping. unmapped_entry_count > 0 means some entries match neither mapped account and the balance is unavailable, not zero; triggers refuse new rules, entries and mapping changes that would create one.';

COMMIT;

NOTIFY pgrst, 'reload schema';
