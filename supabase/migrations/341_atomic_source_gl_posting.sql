-- BUS-003: source posting is one transaction; historical drafts are never rewritten.
-- These existing updated-at triggers assign updated_by; provide the omitted
-- actor columns so ordinary period reopen and posting-rule edits remain usable.
ALTER TABLE public.gl_period_closes ADD COLUMN updated_by uuid REFERENCES auth.users(id);
ALTER TABLE public.gl_posting_rules ADD COLUMN updated_by uuid REFERENCES auth.users(id);
CREATE FUNCTION haven.lock_gl_month(p_entity uuid,p_date date) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gl_month:'||p_entity::text||':'||to_char(p_date,'YYYY-MM'),0));
END $$;
REVOKE ALL ON FUNCTION haven.lock_gl_month(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.lock_gl_month(uuid,date) TO authenticated;

CREATE FUNCTION public.haven_lock_gl_period_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k record;
BEGIN
 -- Both keys in deterministic order also cover moving a period and absent months.
 FOR k IN SELECT DISTINCT entity_id,period_year,period_month FROM (
  SELECT OLD.entity_id,OLD.period_year,OLD.period_month WHERE TG_OP<>'INSERT'
  UNION ALL SELECT NEW.entity_id,NEW.period_year,NEW.period_month WHERE TG_OP<>'DELETE'
 ) keys ORDER BY entity_id,period_year,period_month LOOP
  PERFORM haven.lock_gl_month(k.entity_id,make_date(k.period_year,k.period_month,1));
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER gl_period_write_lock BEFORE INSERT OR UPDATE OR DELETE ON public.gl_period_closes
 FOR EACH ROW EXECUTE FUNCTION public.haven_lock_gl_period_write();

CREATE OR REPLACE FUNCTION public.haven_journal_lines_parent_must_be_draft() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.journal_entries%ROWTYPE; target uuid; old_target uuid;
BEGIN
 IF TG_OP<>'DELETE' THEN target:=NEW.journal_entry_id; END IF;
 IF TG_OP<>'INSERT' THEN old_target:=OLD.journal_entry_id; END IF;
 -- Protect BOTH parents when reparenting, including the old posted journal.
 FOR parent IN SELECT * FROM public.journal_entries WHERE id IN(target,old_target) ORDER BY id FOR UPDATE LOOP
  IF parent.status<>'draft' THEN RAISE EXCEPTION 'Cannot change lines unless both journal parents are draft'; END IF;
 END LOOP;
 IF target IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.journal_entries WHERE id=target) THEN RAISE EXCEPTION 'Journal entry not found'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.haven_validate_journal_entry_balanced() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d bigint; c bigint; account_row record;
BEGIN
 IF NEW.status<>'posted' OR (TG_OP='UPDATE' AND OLD.status='posted') THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR OLD.status<>'draft' THEN RAISE EXCEPTION 'Only an existing draft can be posted'; END IF;
 IF auth.uid() IS NULL OR haven.organization_id() IS DISTINCT FROM NEW.organization_id
   OR haven.app_role() IS NULL OR haven.app_role() NOT IN ('owner','org_admin') THEN
  RAISE EXCEPTION 'Journal posting is not authorized' USING ERRCODE='42501';
 END IF;
 IF NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Deleted journal cannot be posted'; END IF;
 PERFORM 1 FROM public.entities WHERE id=NEW.entity_id AND organization_id=NEW.organization_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Journal entity unavailable'; END IF;
 IF NEW.facility_id IS NOT NULL THEN
  PERFORM 1 FROM public.facilities WHERE id=NEW.facility_id AND entity_id=NEW.entity_id AND organization_id=NEW.organization_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal facility does not belong to entity'; END IF;
 END IF;
 PERFORM haven.lock_gl_month(NEW.entity_id,NEW.entry_date);
 IF EXISTS(SELECT 1 FROM public.gl_period_closes WHERE entity_id=NEW.entity_id
   AND period_year=extract(year FROM NEW.entry_date) AND period_month=extract(month FROM NEW.entry_date)
   AND deleted_at IS NULL AND status='closed') THEN RAISE EXCEPTION 'Accounting period is closed'; END IF;
 SELECT id INTO NEW.gl_period_close_id FROM public.gl_period_closes WHERE organization_id=NEW.organization_id AND entity_id=NEW.entity_id
  AND period_year=extract(year FROM NEW.entry_date) AND period_month=extract(month FROM NEW.entry_date) AND deleted_at IS NULL;
 FOR account_row IN SELECT a.id FROM public.gl_accounts a WHERE a.id IN(
   SELECT gl_account_id FROM public.journal_entry_lines WHERE journal_entry_id=NEW.id AND deleted_at IS NULL)
   ORDER BY a.id FOR SHARE LOOP NULL; END LOOP;
 IF EXISTS(SELECT 1 FROM public.journal_entry_lines l LEFT JOIN public.gl_accounts a ON a.id=l.gl_account_id
  WHERE l.journal_entry_id=NEW.id AND l.deleted_at IS NULL AND
  (l.organization_id IS DISTINCT FROM NEW.organization_id OR a.organization_id IS DISTINCT FROM NEW.organization_id
   OR a.entity_id IS DISTINCT FROM NEW.entity_id OR a.deleted_at IS NOT NULL OR a.is_active IS DISTINCT FROM true)) THEN
  RAISE EXCEPTION 'Posting requires active accounts in the journal entity';
 END IF;
 SELECT coalesce(sum(debit_cents),0),coalesce(sum(credit_cents),0) INTO d,c
  FROM public.journal_entry_lines WHERE journal_entry_id=NEW.id AND deleted_at IS NULL;
 IF d<>c OR d=0 THEN RAISE EXCEPTION 'Journal entry must have balanced non-zero debits and credits to post'; END IF;
 -- Fresh SPI statement after lock waits, before mutation attribution.
 IF haven.organization_id() IS DISTINCT FROM NEW.organization_id OR haven.app_role() IS NULL
   OR haven.app_role() NOT IN ('owner','org_admin') THEN RAISE EXCEPTION 'Journal posting is no longer authorized' USING ERRCODE='42501'; END IF;
 NEW.posted_by:=auth.uid(); NEW.posted_at:=clock_timestamp();
 RETURN NEW;
END $$;
DROP TRIGGER tr_journal_entries_validate_balance ON public.journal_entries;
CREATE TRIGGER tr_journal_entries_validate_balance BEFORE INSERT OR UPDATE ON public.journal_entries
 FOR EACH ROW EXECUTE FUNCTION public.haven_validate_journal_entry_balanced();

-- Narrow privileged inspection is required because SELECT RLS hides deleted line
-- history. It returns only validation facts for an authorized live source journal.
CREATE FUNCTION haven.source_gl_line_state(p_id uuid,p_amount integer,p_debit uuid,p_credit uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.journal_entries%ROWTYPE; result jsonb; account_row record;
BEGIN
 SELECT * INTO j FROM public.journal_entries WHERE id=p_id AND deleted_at IS NULL;
 IF NOT FOUND OR auth.uid() IS NULL OR haven.organization_id() IS DISTINCT FROM j.organization_id
  OR haven.app_role() IS NULL OR haven.app_role() NOT IN ('owner','org_admin')
  OR j.source_type IS NULL OR j.source_type NOT IN ('invoice','payment') THEN RAISE EXCEPTION 'Source journal is not authorized' USING ERRCODE='42501'; END IF;
 FOR account_row IN SELECT a.id FROM public.gl_accounts a WHERE a.id IN(SELECT gl_account_id FROM public.journal_entry_lines WHERE journal_entry_id=p_id) ORDER BY a.id FOR SHARE LOOP NULL; END LOOP;
 SELECT jsonb_build_object('history_count',count(*),'active_count',count(*) FILTER(WHERE l.deleted_at IS NULL),
  'valid',count(*) FILTER(WHERE l.deleted_at IS NULL)=2 AND
   count(*) FILTER(WHERE l.deleted_at IS NULL AND l.line_number=1 AND l.debit_cents=p_amount AND l.credit_cents=0 AND (p_debit IS NULL OR l.gl_account_id=p_debit))=1 AND
   count(*) FILTER(WHERE l.deleted_at IS NULL AND l.line_number=2 AND l.credit_cents=p_amount AND l.debit_cents=0 AND (p_credit IS NULL OR l.gl_account_id=p_credit))=1 AND
   coalesce(bool_and(l.organization_id=j.organization_id AND a.organization_id=j.organization_id AND a.entity_id=j.entity_id) FILTER(WHERE l.deleted_at IS NULL),false))
 INTO result FROM public.journal_entry_lines l JOIN public.gl_accounts a ON a.id=l.gl_account_id WHERE l.journal_entry_id=j.id;
 -- This helper is directly executable too; the caller's later check cannot
 -- protect a direct invocation that waited on an account lock.
 IF auth.uid() IS NULL OR j.organization_id IS DISTINCT FROM haven.organization_id()
  OR haven.app_role() IS NULL OR haven.app_role() NOT IN ('owner','org_admin') THEN
  RAISE EXCEPTION 'Source journal is no longer authorized' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.source_gl_line_state(uuid,integer,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.source_gl_line_state(uuid,integer,uuid,uuid) TO authenticated;

-- UPDATE RLS intentionally excludes posted headers, so an invoker SELECT FOR
-- UPDATE cannot lock/read a posted retry. This narrow helper preserves that RLS
-- policy while allowing authorized owner/admin recovery to lock its own header.
CREATE FUNCTION haven.lock_source_gl_journal(p_type text,p_source uuid) RETURNS SETOF public.journal_entries
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.journal_entries%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR haven.organization_id() IS NULL OR haven.app_role() IS NULL OR haven.app_role() NOT IN ('owner','org_admin')
  OR p_type IS NULL OR p_type NOT IN ('invoice','payment') THEN RAISE EXCEPTION 'Source journal is not authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM public.journal_entries WHERE source_type=p_type AND source_id=p_source
  AND organization_id=haven.organization_id() AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF j.organization_id IS DISTINCT FROM haven.organization_id() OR haven.app_role() IS NULL OR haven.app_role() NOT IN ('owner','org_admin') THEN
  RAISE EXCEPTION 'Source journal is no longer authorized' USING ERRCODE='42501'; END IF;
 RETURN NEXT j;
END $$;
REVOKE ALL ON FUNCTION haven.lock_source_gl_journal(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.lock_source_gl_journal(text,uuid) TO authenticated;

CREATE FUNCTION public.post_source_to_gl(p_source_type text,p_source_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE source_row record; j public.journal_entries%ROWTYPE; debit_id uuid; credit_id uuid;
 state jsonb; was_posted boolean:=false; period_id uuid; account_row record;
BEGIN
 IF auth.uid() IS NULL OR haven.organization_id() IS NULL OR haven.app_role() IS NULL
  OR haven.app_role() NOT IN ('owner','org_admin') THEN RAISE EXCEPTION 'GL posting is not authorized' USING ERRCODE='42501'; END IF;
 IF p_source_type='invoice' THEN
  SELECT id,organization_id,entity_id,facility_id,invoice_date entry_date,total amount,'Invoice '||invoice_number memo
   INTO source_row FROM public.invoices WHERE id=p_source_id AND deleted_at IS NULL FOR UPDATE;
 ELSIF p_source_type='payment' THEN
  SELECT id,organization_id,entity_id,facility_id,payment_date entry_date,amount,
   'Payment'||coalesce(' from '||payer_name,'')||coalesce(' ref '||reference_number,'') memo
   INTO source_row FROM public.payments WHERE id=p_source_id AND deleted_at IS NULL FOR UPDATE;
 ELSE RAISE EXCEPTION 'Unsupported GL source'; END IF;
 IF source_row.id IS NULL THEN RAISE EXCEPTION 'Billing source unavailable'; END IF;
 IF source_row.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Billing source is not authorized' USING ERRCODE='42501'; END IF;
 IF source_row.amount<=0 THEN RAISE EXCEPTION 'Source amount must be positive'; END IF;
 PERFORM 1 FROM public.entities WHERE id=source_row.entity_id AND organization_id=source_row.organization_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Source entity unavailable'; END IF;
 PERFORM 1 FROM public.facilities WHERE id=source_row.facility_id AND entity_id=source_row.entity_id AND organization_id=source_row.organization_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Source facility does not belong to entity'; END IF;
 SELECT * INTO j FROM haven.lock_source_gl_journal(p_source_type,p_source_id);
 IF FOUND THEN
  IF j.organization_id IS DISTINCT FROM source_row.organization_id OR j.entity_id IS DISTINCT FROM source_row.entity_id
   OR j.facility_id IS DISTINCT FROM source_row.facility_id OR j.entry_date IS DISTINCT FROM source_row.entry_date THEN
   RAISE EXCEPTION 'Source details differ from journal %. Review the journal before posting',j.id;
  END IF;
  IF j.status='posted' THEN
   state:=haven.source_gl_line_state(j.id,source_row.amount,NULL,NULL);
   IF NOT (state->>'valid')::boolean OR j.posted_at IS NULL OR j.posted_by IS NULL THEN
    RAISE EXCEPTION 'Posted journal % differs from source or has invalid posting evidence. Review the journal',j.id;
   END IF;
   was_posted:=true;
  ELSIF j.status<>'draft' THEN RAISE EXCEPTION 'Journal % is not an editable draft. Review the journal',j.id;
  END IF;
 END IF;
 IF NOT was_posted THEN
  -- One statement selects a complete account pair from a single configuration
  -- snapshot. Later rule edits apply to later calls, not halfway through this pair.
  SELECT coalesce(r.debit_gl_account_id,CASE p_source_type WHEN 'invoice' THEN s.accounts_receivable_id ELSE s.cash_id END),
         coalesce(r.credit_gl_account_id,CASE p_source_type WHEN 'invoice' THEN s.revenue_id ELSE s.accounts_receivable_id END)
   INTO debit_id,credit_id FROM (SELECT 1) seed
   LEFT JOIN public.entity_gl_settings s ON s.entity_id=source_row.entity_id AND s.organization_id=source_row.organization_id
   LEFT JOIN LATERAL (SELECT debit_gl_account_id,credit_gl_account_id FROM public.gl_posting_rules
    WHERE entity_id=source_row.entity_id AND organization_id=source_row.organization_id AND event_type=p_source_type AND is_active AND deleted_at IS NULL
    ORDER BY created_at DESC,id DESC LIMIT 1) r ON true;
  IF debit_id IS NULL OR credit_id IS NULL THEN RAISE EXCEPTION 'GL posting not configured: add an active posting rule or configure GL Settings'; END IF;
  PERFORM haven.lock_gl_month(source_row.entity_id,source_row.entry_date);
  SELECT id INTO period_id FROM public.gl_period_closes WHERE entity_id=source_row.entity_id AND organization_id=source_row.organization_id
   AND period_year=extract(year FROM source_row.entry_date) AND period_month=extract(month FROM source_row.entry_date) AND deleted_at IS NULL;
  FOR account_row IN SELECT id FROM public.gl_accounts WHERE id IN(debit_id,credit_id) ORDER BY id FOR SHARE LOOP NULL; END LOOP;
  IF (SELECT count(*) FROM public.gl_accounts WHERE id IN(debit_id,credit_id) AND organization_id=source_row.organization_id
   AND entity_id=source_row.entity_id AND is_active AND deleted_at IS NULL)<>(CASE WHEN debit_id=credit_id THEN 1 ELSE 2 END) THEN
   RAISE EXCEPTION 'Posting requires active accounts in the source entity'; END IF;
  IF haven.organization_id() IS DISTINCT FROM source_row.organization_id OR haven.app_role() IS NULL OR haven.app_role() NOT IN ('owner','org_admin') THEN
   RAISE EXCEPTION 'GL posting is no longer authorized' USING ERRCODE='42501'; END IF;
  IF j.id IS NULL THEN
   INSERT INTO public.journal_entries(organization_id,entity_id,facility_id,entry_date,memo,source_type,source_id,gl_period_close_id,created_by,updated_by)
    VALUES(source_row.organization_id,source_row.entity_id,source_row.facility_id,source_row.entry_date,source_row.memo,p_source_type,p_source_id,period_id,auth.uid(),auth.uid()) RETURNING * INTO j;
  END IF;
  state:=haven.source_gl_line_state(j.id,source_row.amount,debit_id,credit_id);
  IF (state->>'history_count')::integer=0 THEN
   INSERT INTO public.journal_entry_lines(journal_entry_id,organization_id,gl_account_id,line_number,description,debit_cents,credit_cents,updated_by)
    VALUES(j.id,j.organization_id,debit_id,1,'Debit — '||source_row.memo,source_row.amount,0,auth.uid()),
          (j.id,j.organization_id,credit_id,2,'Credit — '||source_row.memo,0,source_row.amount,auth.uid());
  ELSIF NOT (state->>'valid')::boolean OR (state->>'history_count')::integer<>2 THEN
   RAISE EXCEPTION 'Draft journal % has existing accounting history that does not exactly match this posting. Review the journal',j.id;
  END IF;
  UPDATE public.journal_entries SET status='posted',gl_period_close_id=period_id,updated_by=auth.uid()
   WHERE id=j.id AND status='draft' AND deleted_at IS NULL RETURNING * INTO j;
  IF NOT FOUND OR j.status<>'posted' THEN RAISE EXCEPTION 'Journal posting did not complete'; END IF;
 END IF;
 IF haven.organization_id() IS DISTINCT FROM source_row.organization_id OR haven.app_role() IS NULL OR haven.app_role() NOT IN ('owner','org_admin') THEN
  RAISE EXCEPTION 'GL posting receipt is no longer authorized' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('journal_entry_id',j.id,'already_posted',was_posted);
END $$;
REVOKE ALL ON FUNCTION public.post_source_to_gl(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_source_to_gl(text,uuid) TO authenticated;
