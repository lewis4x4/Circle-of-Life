-- F01: source money, allocation and immutable local receipts commit together.
-- Public invoker APIs delegate to private commands because application roles
-- must not write authoritative balances or receipts directly.
BEGIN;

CREATE TABLE public.finance_command_receipts (
 command_type text NOT NULL,
 id uuid NOT NULL,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 entity_id uuid NOT NULL REFERENCES public.entities(id),
 facility_id uuid REFERENCES public.facilities(id),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 actor_session_id uuid NOT NULL,
 actor_claim_version integer NOT NULL,
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(command_type,id)
);
CREATE TABLE public.payment_allocations (
 payment_id uuid PRIMARY KEY REFERENCES public.payments(id),
 invoice_id uuid NOT NULL REFERENCES public.invoices(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 amount_cents integer NOT NULL CHECK(amount_cents > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_command_receipts,public.payment_allocations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.finance_command_receipts,public.payment_allocations TO authenticated;
CREATE POLICY finance_receipts_read ON public.finance_command_receipts FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id() AND haven.app_role() IN('owner','org_admin','facility_admin')
 AND (facility_id IN(SELECT haven.accessible_facility_ids()) OR (facility_id IS NULL AND haven.app_role() IN('owner','org_admin'))));
CREATE POLICY payment_allocations_read ON public.payment_allocations FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id() AND haven.app_role() IN('owner','org_admin','facility_admin')
 AND facility_id IN(SELECT haven.accessible_facility_ids()));
CREATE FUNCTION haven.reject_finance_evidence_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Financial evidence is immutable; use a correction command' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION haven.reject_finance_evidence_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_receipts_immutable BEFORE UPDATE OR DELETE ON public.finance_command_receipts FOR EACH ROW EXECUTE FUNCTION haven.reject_finance_evidence_mutation();
CREATE TRIGGER payment_allocations_immutable BEFORE UPDATE OR DELETE ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION haven.reject_finance_evidence_mutation();
CREATE TRIGGER finance_receipt_audit AFTER INSERT ON public.finance_command_receipts FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- Historical sources remain unclassified until a reviewed cutover assigns them.
ALTER TABLE public.invoices ADD COLUMN finance_origin text NOT NULL DEFAULT 'unclassified' CHECK(finance_origin IN('unclassified','operating','opening_balance'));
ALTER TABLE public.invoices ALTER COLUMN finance_origin SET DEFAULT 'operating';
ALTER TABLE public.gl_period_closes ADD COLUMN updated_by uuid REFERENCES auth.users(id);
ALTER TABLE public.journal_entries ADD COLUMN reversal_of_id uuid REFERENCES public.journal_entries(id);
CREATE UNIQUE INDEX journal_one_reversal ON public.journal_entries(reversal_of_id) WHERE reversal_of_id IS NOT NULL;

CREATE FUNCTION haven.assert_finance_scope(p_entity uuid,p_facility uuid,p_post boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record;
BEGIN
 SELECT * INTO a FROM haven.current_authorized_actor();
 IF a.actor_user_id IS NULL OR a.actor_role_text NOT IN('owner','org_admin','facility_admin')
 OR (p_post AND a.actor_role_text NOT IN('owner','org_admin')) THEN
  RAISE EXCEPTION 'Current finance authority required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.entities WHERE id=p_entity AND organization_id=a.actor_organization_id AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Finance entity unavailable' USING ERRCODE='42501';
 END IF;
 IF p_facility IS NULL THEN
  IF a.actor_role_text NOT IN('owner','org_admin') THEN RAISE EXCEPTION 'Facility scope required' USING ERRCODE='42501'; END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=p_facility AND entity_id=p_entity AND organization_id=a.actor_organization_id AND deleted_at IS NULL)
 OR p_facility NOT IN(SELECT haven.accessible_facility_ids()) THEN
  RAISE EXCEPTION 'Finance facility unavailable' USING ERRCODE='42501';
 END IF;
 RETURN a.actor_user_id;
END $$;
REVOKE ALL ON FUNCTION haven.assert_finance_scope(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Keep the proven draft algorithm; the private wrapper supplies current scope
-- while allowing its history soft-deletes without weakening read RLS.
ALTER FUNCTION public.save_journal_draft(uuid,uuid,uuid,date,text,jsonb,timestamptz) SET SCHEMA haven;
ALTER FUNCTION haven.save_journal_draft(uuid,uuid,uuid,date,text,jsonb,timestamptz) RENAME TO save_journal_draft_core;
REVOKE ALL ON FUNCTION haven.save_journal_draft_core(uuid,uuid,uuid,date,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION haven.save_finance_journal_draft(p_id uuid,p_entity_id uuid,p_facility_id uuid,p_entry_date date,p_memo text,p_lines jsonb,p_expected_updated_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing public.journal_entries%ROWTYPE; saved_id uuid;
BEGIN
 PERFORM haven.assert_finance_scope(p_entity_id,p_facility_id);
 SELECT * INTO existing FROM public.journal_entries WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  PERFORM haven.assert_finance_scope(existing.entity_id,existing.facility_id);
  IF existing.organization_id IS DISTINCT FROM haven.organization_id() OR existing.source_type IS DISTINCT FROM 'manual' THEN RAISE EXCEPTION 'Only manual drafts may be edited'; END IF;
 END IF;
 saved_id:=haven.save_journal_draft_core(p_id,p_entity_id,p_facility_id,p_entry_date,p_memo,p_lines,p_expected_updated_at);
 PERFORM haven.assert_finance_scope(p_entity_id,p_facility_id);
 RETURN saved_id;
END $$;
REVOKE ALL ON FUNCTION haven.save_finance_journal_draft(uuid,uuid,uuid,date,text,jsonb,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.save_finance_journal_draft(uuid,uuid,uuid,date,text,jsonb,timestamptz) TO authenticated;
CREATE FUNCTION public.save_journal_draft(p_id uuid,p_entity_id uuid,p_facility_id uuid,p_entry_date date,p_memo text,p_lines jsonb,p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.save_finance_journal_draft(p_id,p_entity_id,p_facility_id,p_entry_date,p_memo,p_lines,p_expected_updated_at) $$;
REVOKE ALL ON FUNCTION public.save_journal_draft(uuid,uuid,uuid,date,text,jsonb,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_journal_draft(uuid,uuid,uuid,date,text,jsonb,timestamptz) TO authenticated;

CREATE FUNCTION haven.create_finance_opening_balance(p_facility_id uuid,p_resident_id uuid,p_invoice_number text,p_invoice_date date,p_due_date date,p_period_start date,p_period_end date,p_amount_cents integer,p_payer_type text,p_payer_name text,p_notes text)
RETURNS TABLE(invoice_id uuid,inserted boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entity uuid; result record;
BEGIN
 SELECT entity_id INTO entity FROM public.facilities WHERE id=p_facility_id;
 PERFORM haven.assert_finance_scope(entity,p_facility_id);
 IF p_amount_cents IS NULL OR p_amount_cents<=0 THEN RAISE EXCEPTION 'Positive opening balance required'; END IF;
 SELECT * INTO result FROM public.haven_create_invoice_with_line_items(p_facility_id,p_resident_id,p_invoice_number,p_invoice_date,p_due_date,p_period_start,p_period_end,p_amount_cents,0,0,p_amount_cents,0,p_amount_cents,p_payer_type,p_payer_name,p_notes,
  jsonb_build_array(jsonb_build_object('line_type','opening_balance','description','Opening balance','quantity',1,'unit_price',p_amount_cents,'total',p_amount_cents,'sort_order',1)));
 IF result.inserted THEN UPDATE public.invoices SET finance_origin='opening_balance' WHERE id=result.invoice_id; END IF;
 PERFORM haven.assert_finance_scope(entity,p_facility_id);
 RETURN QUERY SELECT result.invoice_id,result.inserted;
END $$;
REVOKE ALL ON FUNCTION haven.create_finance_opening_balance(uuid,uuid,text,date,date,date,date,integer,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.create_finance_opening_balance(uuid,uuid,text,date,date,date,date,integer,text,text,text) TO authenticated;
CREATE FUNCTION public.create_finance_opening_balance(p_facility_id uuid,p_resident_id uuid,p_invoice_number text,p_invoice_date date,p_due_date date,p_period_start date,p_period_end date,p_amount_cents integer,p_payer_type text,p_payer_name text,p_notes text)
RETURNS TABLE(invoice_id uuid,inserted boolean) LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM haven.create_finance_opening_balance(p_facility_id,p_resident_id,p_invoice_number,p_invoice_date,p_due_date,p_period_start,p_period_end,p_amount_cents,p_payer_type,p_payer_name,p_notes) $$;
REVOKE ALL ON FUNCTION public.create_finance_opening_balance(uuid,uuid,text,date,date,date,date,integer,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_finance_opening_balance(uuid,uuid,text,date,date,date,date,integer,text,text,text) TO authenticated;

CREATE FUNCTION haven.lock_finance_period(p_entity uuid,p_date date) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF p_entity IS NULL OR p_date IS NULL THEN RAISE EXCEPTION 'Entity and date required'; END IF;
 -- Covers implicit open periods too: row locks alone cannot lock an absent row.
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-period:'||p_entity||':'||to_char(p_date,'YYYY-MM'),0));
END $$;
REVOKE ALL ON FUNCTION haven.lock_finance_period(uuid,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.guard_finance_period() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid;
BEGIN
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
REVOKE ALL ON FUNCTION haven.guard_finance_period() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_period_guard BEFORE INSERT OR UPDATE OR DELETE ON public.gl_period_closes FOR EACH ROW EXECUTE FUNCTION haven.guard_finance_period();

CREATE FUNCTION haven.guard_finance_source_write() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='payments' THEN
  IF current_user IN('anon','authenticated','service_role') THEN RAISE EXCEPTION 'Use record_finance_payment' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Payments require an explicit correction command' USING ERRCODE='42501'; END IF;
 ELSE
  IF TG_OP<>'DELETE' THEN
   IF NEW.total IS DISTINCT FROM NEW.subtotal+NEW.adjustments+NEW.tax OR NEW.balance_due IS DISTINCT FROM NEW.total-NEW.amount_paid OR NEW.total<0 OR NEW.amount_paid<0 OR NEW.amount_paid>NEW.total THEN RAISE EXCEPTION 'Invoice totals and settlement must reconcile'; END IF;
   IF (NEW.status='paid' AND (NEW.balance_due<>0 OR NEW.amount_paid<>NEW.total)) OR (NEW.status='partial' AND (NEW.amount_paid<=0 OR NEW.balance_due<=0)) THEN RAISE EXCEPTION 'Invoice status must match settlement'; END IF;
  END IF;
  IF TG_OP='INSERT' THEN
   IF NEW.amount_paid<>0 OR NEW.balance_due<>NEW.total THEN RAISE EXCEPTION 'New invoice settlement must start at its total'; END IF;
  END IF;
  IF TG_OP='UPDATE' AND current_user IN('anon','authenticated','service_role') AND NEW.finance_origin IS DISTINCT FROM OLD.finance_origin THEN RAISE EXCEPTION 'Finance origin requires reviewed classification' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND current_user IN('anon','authenticated','service_role') AND
   (NEW.amount_paid,NEW.balance_due) IS DISTINCT FROM (OLD.amount_paid,OLD.balance_due)
   AND NOT(OLD.status='draft' AND NEW.status='draft' AND OLD.amount_paid=0 AND NEW.amount_paid=0 AND NEW.balance_due=NEW.total) THEN
   RAISE EXCEPTION 'Invoice settlement changes only through financial commands' USING ERRCODE='42501';
  END IF;
  IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM public.journal_entries WHERE source_type='invoice' AND source_id=OLD.id AND status='posted') THEN
   IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['updated_at','updated_by','amount_paid','balance_due','status'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','updated_by','amount_paid','balance_due','status'])
    OR (TG_OP='UPDATE' AND NEW.status::text IN('draft','void','voided','written_off')) THEN
    RAISE EXCEPTION 'Posted invoice requires an explicit correction command' USING ERRCODE='42501';
   END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_finance_source_write() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_payment_write BEFORE INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION haven.guard_finance_source_write();
CREATE TRIGGER finance_invoice_write BEFORE INSERT OR UPDATE OR DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION haven.guard_finance_source_write();

CREATE FUNCTION haven.guard_posted_invoice_lines() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent_id uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN RAISE EXCEPTION 'Invoice lines cannot move between invoices'; END IF;
 parent_id:=CASE WHEN TG_OP='DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
 PERFORM 1 FROM public.invoices WHERE id=parent_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.journal_entries WHERE source_type='invoice' AND source_id=parent_id AND status='posted') THEN RAISE EXCEPTION 'Posted invoice lines require a correction command' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_posted_invoice_lines() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_invoice_line_write BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_line_items FOR EACH ROW EXECUTE FUNCTION haven.guard_posted_invoice_lines();

CREATE OR REPLACE FUNCTION public.apply_invoice_payment(p_invoice_id uuid,p_amount_cents integer) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Amount-only application retired; use record_finance_payment' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION public.apply_invoice_payment(uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.apply_invoice_payment(uuid,integer) TO authenticated;

CREATE FUNCTION haven.record_finance_payment(p_id uuid,p_resident_id uuid,p_invoice_id uuid,p_payment_date date,p_amount_cents integer,p_method text,p_reference text,p_payer_name text,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; inv public.invoices%ROWTYPE; actor uuid; payload jsonb; prior public.finance_command_receipts%ROWTYPE; applied integer:=0; result jsonb;
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
  UPDATE public.invoices SET amount_paid=amount_paid+applied,balance_due=balance_due-applied,status=CASE WHEN balance_due=applied THEN 'paid'::public.invoice_status ELSE 'partial'::public.invoice_status END,updated_by=actor WHERE id=p_invoice_id;
 END IF;
 result:=jsonb_build_object('payment_id',p_id,'allocated_cents',applied,'unapplied_cents',p_amount_cents-applied);
 INSERT INTO public.finance_command_receipts(command_type,id,organization_id,entity_id,facility_id,actor_id,actor_session_id,actor_claim_version,payload,result)
 SELECT 'payment',p_id,r.organization_id,r.entity_id,r.facility_id,actor,(auth.jwt()->>'session_id')::uuid,a.actor_claim_version,payload,result FROM haven.current_authorized_actor() a;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current finance authority required for receipt' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.record_finance_payment(uuid,uuid,uuid,date,integer,text,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.record_finance_payment(uuid,uuid,uuid,date,integer,text,text,text,text) TO authenticated;
CREATE FUNCTION public.record_finance_payment(p_id uuid,p_resident_id uuid,p_invoice_id uuid,p_payment_date date,p_amount_cents integer,p_method text,p_reference text DEFAULT NULL,p_payer_name text DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.record_finance_payment(p_id,p_resident_id,p_invoice_id,p_payment_date,p_amount_cents,p_method,p_reference,p_payer_name,p_notes) $$;
REVOKE ALL ON FUNCTION public.record_finance_payment(uuid,uuid,uuid,date,integer,text,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_finance_payment(uuid,uuid,uuid,date,integer,text,text,text,text) TO authenticated;

-- Outcome resolution serializes with the original request. A tombstone makes
-- cancellation safe even if an earlier network request reaches the lock later.
CREATE FUNCTION haven.resolve_finance_payment(p_id uuid,p_resident_id uuid,p_invoice_id uuid,p_payment_date date,p_amount_cents integer,p_method text,p_reference text,p_payer_name text,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; actor uuid; payload jsonb; prior public.finance_command_receipts%ROWTYPE; result jsonb;
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
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM payload OR prior.organization_id<>r.organization_id THEN RAISE EXCEPTION 'Command identity already used for different content' USING ERRCODE='23505'; END IF;
  RETURN prior.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.payments WHERE id=p_id) THEN RAISE EXCEPTION 'Payment exists without a receipt; finance reconciliation required'; END IF;
 result:=jsonb_build_object('status','cancelled','payment_id',p_id);
 INSERT INTO public.finance_command_receipts(command_type,id,organization_id,entity_id,facility_id,actor_id,actor_session_id,actor_claim_version,payload,result)
 SELECT 'payment_cancelled',p_id,r.organization_id,r.entity_id,r.facility_id,actor,(auth.jwt()->>'session_id')::uuid,a.actor_claim_version,payload,result FROM haven.current_authorized_actor() a;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current finance authority required for receipt' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.resolve_finance_payment(uuid,uuid,uuid,date,integer,text,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resolve_finance_payment(uuid,uuid,uuid,date,integer,text,text,text,text) TO authenticated;
CREATE FUNCTION public.resolve_finance_payment(p_id uuid,p_resident_id uuid,p_invoice_id uuid,p_payment_date date,p_amount_cents integer,p_method text,p_reference text DEFAULT NULL,p_payer_name text DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.resolve_finance_payment(p_id,p_resident_id,p_invoice_id,p_payment_date,p_amount_cents,p_method,p_reference,p_payer_name,p_notes) $$;
REVOKE ALL ON FUNCTION public.resolve_finance_payment(uuid,uuid,uuid,date,integer,text,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_finance_payment(uuid,uuid,uuid,date,integer,text,text,text,text) TO authenticated;

-- All line writers serialize with posting. Reparenting loses provenance and is
-- prohibited, including when the destination happens to be an editable draft.
REVOKE INSERT,UPDATE,DELETE ON public.journal_entry_lines FROM anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.haven_journal_lines_parent_must_be_draft() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE st public.journal_entry_status; parent_id uuid;
BEGIN
 IF current_user IN('anon','authenticated','service_role') THEN RAISE EXCEPTION 'Use save_journal_draft for journal lines' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id THEN RAISE EXCEPTION 'Journal lines cannot move between entries'; END IF;
 parent_id:=CASE WHEN TG_OP='DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;
 SELECT status INTO st FROM public.journal_entries WHERE id=parent_id FOR UPDATE;
 IF st IS DISTINCT FROM 'draft'::public.journal_entry_status THEN RAISE EXCEPTION 'Cannot change lines unless journal entry is draft'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION haven.guard_finance_journal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid; d bigint; c bigint;
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
  IF EXISTS(SELECT 1 FROM public.gl_period_closes WHERE entity_id=NEW.entity_id AND period_year=extract(year FROM NEW.entry_date) AND period_month=extract(month FROM NEW.entry_date) AND status='closed' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Accounting period is closed'; END IF;
  IF NEW.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Journal organization mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.journal_entry_lines l LEFT JOIN public.gl_accounts a ON a.id=l.gl_account_id WHERE l.journal_entry_id=NEW.id AND l.deleted_at IS NULL AND (a.entity_id IS DISTINCT FROM NEW.entity_id OR a.organization_id IS DISTINCT FROM NEW.organization_id OR NOT a.is_active OR a.deleted_at IS NOT NULL)) THEN RAISE EXCEPTION 'Journal account unavailable in entity'; END IF;
  SELECT coalesce(sum(debit_cents),0),coalesce(sum(credit_cents),0) INTO d,c FROM public.journal_entry_lines WHERE journal_entry_id=NEW.id AND deleted_at IS NULL;
  IF d=0 OR d<>c THEN RAISE EXCEPTION 'Journal entry must have balanced non-zero debits and credits to post'; END IF;
  NEW.posted_at:=now(); NEW.posted_by:=actor;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_finance_journal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_journal_guard BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION haven.guard_finance_journal();

CREATE FUNCTION haven.post_finance_journal(p_id uuid,p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.journal_entries%ROWTYPE; actor uuid; result jsonb; prior public.finance_command_receipts%ROWTYPE; payload jsonb;
BEGIN
 SELECT * INTO j FROM public.journal_entries WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Journal unavailable'; END IF;
 actor:=haven.assert_finance_scope(j.entity_id,j.facility_id,true);
 IF j.source_type IS DISTINCT FROM 'manual' THEN RAISE EXCEPTION 'Use the source posting command'; END IF;
 payload:=jsonb_build_object('journal_id',p_id,'expected_updated_at',p_expected_updated_at);
 SELECT * INTO prior FROM public.finance_command_receipts WHERE command_type='manual_post' AND id=p_id;
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Command identity already used for different content' USING ERRCODE='23505'; END IF;
  RETURN prior.result;
 END IF;
 IF j.status<>'draft' OR j.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Journal changed. Reload before posting'; END IF;
 UPDATE public.journal_entries SET status='posted' WHERE id=p_id;
 result:=jsonb_build_object('journal_entry_id',p_id);
 INSERT INTO public.finance_command_receipts(command_type,id,organization_id,entity_id,facility_id,actor_id,actor_session_id,actor_claim_version,payload,result)
 SELECT 'manual_post',p_id,j.organization_id,j.entity_id,j.facility_id,actor,(auth.jwt()->>'session_id')::uuid,a.actor_claim_version,payload,result FROM haven.current_authorized_actor() a;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current finance authority required for receipt' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.post_finance_journal(uuid,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.post_finance_journal(uuid,timestamptz) TO authenticated;
CREATE FUNCTION public.post_finance_journal(p_id uuid,p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.post_finance_journal(p_id,p_expected_updated_at) $$;
REVOKE ALL ON FUNCTION public.post_finance_journal(uuid,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.post_finance_journal(uuid,timestamptz) TO authenticated;

CREATE FUNCTION haven.post_finance_source(p_source_type text,p_source_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source record; actor uuid; prior public.finance_command_receipts%ROWTYPE; payload jsonb; result jsonb; j public.journal_entries%ROWTYPE; debit uuid; credit uuid; jid uuid; kind text;
BEGIN
 IF p_source_type NOT IN('invoice','payment') OR p_source_type IS NULL OR p_source_id IS NULL THEN RAISE EXCEPTION 'Invoice or payment source required'; END IF;
 kind:=p_source_type||'_post';
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-source:'||p_source_type||':'||p_source_id,0));
 IF p_source_type='invoice' THEN
  SELECT id,organization_id,entity_id,facility_id,invoice_date entry_date,total amount,status::text source_status,finance_origin,amount_paid,balance_due,subtotal,adjustments,tax FROM public.invoices WHERE id=p_source_id AND deleted_at IS NULL FOR UPDATE INTO source;
 ELSE
  SELECT id,organization_id,entity_id,facility_id,payment_date entry_date,amount,refunded FROM public.payments WHERE id=p_source_id AND deleted_at IS NULL FOR UPDATE INTO source;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Source unavailable'; END IF;
 actor:=haven.assert_finance_scope(source.entity_id,source.facility_id,true);
 payload:=jsonb_build_object('source_type',p_source_type,'source_id',p_source_id,'amount',source.amount,'entry_date',source.entry_date,'entity_id',source.entity_id,'facility_id',source.facility_id);
 SELECT * INTO prior FROM public.finance_command_receipts WHERE command_type=kind AND id=p_source_id;
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Posted source changed; correction required' USING ERRCODE='23505'; END IF;
  RETURN prior.result;
 END IF;
 IF source.amount<=0 THEN RAISE EXCEPTION 'Positive source amount required'; END IF;
 IF p_source_type='invoice' THEN
  IF source.amount IS DISTINCT FROM source.subtotal+source.adjustments+source.tax OR source.balance_due IS DISTINCT FROM source.amount-source.amount_paid OR source.amount_paid<0 OR source.balance_due<0 OR (source.source_status='paid' AND source.balance_due<>0) OR (source.source_status='partial' AND (source.amount_paid<=0 OR source.balance_due<=0)) THEN RAISE EXCEPTION 'Invoice totals and settlement must reconcile before posting'; END IF;
  IF source.finance_origin<>'operating' OR EXISTS(SELECT 1 FROM public.invoice_line_items WHERE invoice_id=p_source_id AND description ILIKE 'Opening balance%') THEN RAISE EXCEPTION 'Opening or historical balance requires approved accounting classification'; END IF;
  IF source.source_status NOT IN('sent','partial','paid','overdue') THEN RAISE EXCEPTION 'Issue the invoice before posting'; END IF;
 ELSE
  IF source.refunded OR NOT EXISTS(SELECT 1 FROM public.payment_allocations WHERE payment_id=p_source_id AND amount_cents=source.amount) THEN RAISE EXCEPTION 'Reconcile unapplied or historical payment before GL posting'; END IF;
 END IF;
 SELECT debit_gl_account_id,credit_gl_account_id INTO debit,credit FROM public.gl_posting_rules WHERE entity_id=source.entity_id AND organization_id=source.organization_id AND event_type=p_source_type AND is_active AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN
  SELECT CASE WHEN p_source_type='invoice' THEN accounts_receivable_id ELSE cash_id END,CASE WHEN p_source_type='invoice' THEN revenue_id ELSE accounts_receivable_id END INTO debit,credit FROM public.entity_gl_settings WHERE entity_id=source.entity_id AND organization_id=source.organization_id;
 END IF;
 IF debit IS NULL OR credit IS NULL OR debit=credit THEN RAISE EXCEPTION 'Configure distinct source posting accounts'; END IF;
 SELECT * INTO j FROM public.journal_entries WHERE source_type=p_source_type AND source_id=p_source_id AND deleted_at IS NULL FOR UPDATE;
 IF FOUND THEN
  IF j.status<>'draft' OR j.entity_id<>source.entity_id OR j.organization_id<>source.organization_id THEN RAISE EXCEPTION 'Legacy source journal requires reconciliation'; END IF;
  jid:=j.id;
  UPDATE public.journal_entry_lines SET deleted_at=now() WHERE journal_entry_id=jid AND deleted_at IS NULL;
  UPDATE public.journal_entries SET facility_id=source.facility_id,entry_date=source.entry_date,memo='Source '||p_source_type,updated_by=actor WHERE id=jid;
 ELSE
  INSERT INTO public.journal_entries(organization_id,entity_id,facility_id,entry_date,memo,source_type,source_id,created_by,updated_by)
  VALUES(source.organization_id,source.entity_id,source.facility_id,source.entry_date,'Source '||p_source_type,p_source_type,p_source_id,actor,actor) RETURNING id INTO jid;
 END IF;
 INSERT INTO public.journal_entry_lines(journal_entry_id,organization_id,gl_account_id,line_number,debit_cents,credit_cents)
 VALUES(jid,source.organization_id,debit,1,source.amount,0),(jid,source.organization_id,credit,2,0,source.amount);
 UPDATE public.journal_entries SET status='posted' WHERE id=jid;
 result:=jsonb_build_object('journal_entry_id',jid);
 INSERT INTO public.finance_command_receipts(command_type,id,organization_id,entity_id,facility_id,actor_id,actor_session_id,actor_claim_version,payload,result)
 SELECT kind,p_source_id,source.organization_id,source.entity_id,source.facility_id,actor,(auth.jwt()->>'session_id')::uuid,a.actor_claim_version,payload,result FROM haven.current_authorized_actor() a;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current finance authority required for receipt' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.post_finance_source(text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.post_finance_source(text,uuid) TO authenticated;
CREATE FUNCTION public.post_finance_source(p_source_type text,p_source_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.post_finance_source(p_source_type,p_source_id) $$;
REVOKE ALL ON FUNCTION public.post_finance_source(text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.post_finance_source(text,uuid) TO authenticated;

CREATE FUNCTION haven.reverse_finance_journal(p_id uuid,p_journal_id uuid,p_entry_date date,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.journal_entries%ROWTYPE; prior public.finance_command_receipts%ROWTYPE; actor uuid; payload jsonb; result jsonb;
BEGIN
 IF p_id IS NULL OR p_entry_date IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reversal identity, date and reason required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-reversal:'||p_id,0));
 SELECT * INTO j FROM public.journal_entries WHERE id=p_journal_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR j.status<>'posted' OR j.reversal_of_id IS NOT NULL THEN RAISE EXCEPTION 'Posted original journal required'; END IF;
 actor:=haven.assert_finance_scope(j.entity_id,j.facility_id,true);
 payload:=jsonb_build_object('journal_id',p_journal_id,'entry_date',p_entry_date,'reason',btrim(p_reason));
 SELECT * INTO prior FROM public.finance_command_receipts WHERE command_type='reversal' AND id=p_id;
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Command identity already used for different content' USING ERRCODE='23505'; END IF;
  RETURN prior.result;
 END IF;
 INSERT INTO public.journal_entries(id,organization_id,entity_id,facility_id,entry_date,memo,source_type,source_id,reversal_of_id,created_by,updated_by)
 VALUES(p_id,j.organization_id,j.entity_id,j.facility_id,p_entry_date,btrim(p_reason),'reversal',p_journal_id,p_journal_id,actor,actor);
 INSERT INTO public.journal_entry_lines(journal_entry_id,organization_id,gl_account_id,line_number,description,debit_cents,credit_cents)
 SELECT p_id,organization_id,gl_account_id,line_number,description,credit_cents,debit_cents FROM public.journal_entry_lines WHERE journal_entry_id=p_journal_id AND deleted_at IS NULL;
 UPDATE public.journal_entries SET status='posted' WHERE id=p_id;
 result:=jsonb_build_object('journal_entry_id',p_id,'reversal_of_id',p_journal_id);
 INSERT INTO public.finance_command_receipts(command_type,id,organization_id,entity_id,facility_id,actor_id,actor_session_id,actor_claim_version,payload,result)
 SELECT 'reversal',p_id,j.organization_id,j.entity_id,j.facility_id,actor,(auth.jwt()->>'session_id')::uuid,a.actor_claim_version,payload,result FROM haven.current_authorized_actor() a;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current finance authority required for receipt' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.reverse_finance_journal(uuid,uuid,date,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.reverse_finance_journal(uuid,uuid,date,text) TO authenticated;
CREATE FUNCTION public.reverse_finance_journal(p_id uuid,p_journal_id uuid,p_entry_date date,p_reason text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.reverse_finance_journal(p_id,p_journal_id,p_entry_date,p_reason) $$;
REVOKE ALL ON FUNCTION public.reverse_finance_journal(uuid,uuid,date,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.reverse_finance_journal(uuid,uuid,date,text) TO authenticated;
COMMIT;
