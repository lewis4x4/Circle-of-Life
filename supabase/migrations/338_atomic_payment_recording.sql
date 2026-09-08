-- BUS-001: a caller-bound receipt, payment and invoice update commit together.
-- Overpayments are rejected: no COL allocation/credit policy authorizes a clamp.
CREATE TABLE public.payment_recording_receipts (
  caller_id uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  payload jsonb NOT NULL,
  receipt jsonb NOT NULL,
  PRIMARY KEY(caller_id,request_id)
);
ALTER TABLE public.payment_recording_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_recording_receipts FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.record_payment(p_request_id uuid,p_resident_id uuid,p_invoice_id uuid,
 p_payment_date date,p_amount_cents integer,p_payment_method public.payment_method,
 p_reference_number text DEFAULT NULL,p_payer_name text DEFAULT NULL,p_notes text DEFAULT NULL,p_expected_caller uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor uuid:=auth.uid(); org uuid:=haven.organization_id();
 r residents%ROWTYPE; f facilities%ROWTYPE; i invoices%ROWTYPE;
 previous payment_recording_receipts%ROWTYPE; payment_id uuid; result jsonb;
 payload jsonb:=jsonb_build_object('resident_id',p_resident_id,'invoice_id',p_invoice_id,
 'payment_date',p_payment_date,'amount_cents',p_amount_cents,'payment_method',p_payment_method,
 'reference_number',p_reference_number,'payer_name',p_payer_name,'notes',p_notes);
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_caller OR org IS NULL OR haven.app_role() NOT IN ('owner','org_admin','facility_admin') THEN
  RAISE EXCEPTION 'Payment recording is not authorized' USING ERRCODE='42501';
 END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Payment request identity is required'; END IF;
 -- Serializes a caller's exact request before reading its committed receipt.
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 SELECT * INTO previous FROM payment_recording_receipts WHERE caller_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF previous.organization_id IS DISTINCT FROM org OR previous.facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
   RAISE EXCEPTION 'Payment receipt is not authorized' USING ERRCODE='42501';
  END IF;
  IF previous.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Payment request identity was already used with different details'; END IF;
  RETURN previous.receipt;
 END IF;
 IF p_amount_cents IS NULL OR p_amount_cents<=0 OR p_payment_date IS NULL OR p_payment_method IS NULL THEN
  RAISE EXCEPTION 'A positive whole-cent amount, date and payment method are required';
 END IF;
 SELECT * INTO r FROM residents WHERE id=p_resident_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR r.organization_id IS DISTINCT FROM org OR r.facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
  RAISE EXCEPTION 'Resident is not accessible for payment recording' USING ERRCODE='42501';
 END IF;
 SELECT * INTO f FROM facilities WHERE id=r.facility_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR f.organization_id IS DISTINCT FROM org OR NOT EXISTS(SELECT 1 FROM entities WHERE id=f.entity_id AND organization_id=org AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Resident facility and entity must match the current organization';
 END IF;
 IF p_invoice_id IS NOT NULL THEN
  SELECT * INTO i FROM invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR i.deleted_at IS NOT NULL OR i.resident_id IS DISTINCT FROM r.id OR i.organization_id IS DISTINCT FROM org OR i.facility_id IS DISTINCT FROM f.id OR i.entity_id IS DISTINCT FROM f.entity_id THEN
   RAISE EXCEPTION 'Invoice must match the resident, facility, entity and organization';
  END IF;
  IF i.status NOT IN ('draft','sent','partial','overdue') OR i.balance_due<=0 OR p_amount_cents>i.balance_due THEN
   RAISE EXCEPTION 'Payment must not exceed the current open invoice balance';
  END IF;
 END IF;
 INSERT INTO payments(resident_id,facility_id,organization_id,entity_id,invoice_id,payment_date,amount,payment_method,reference_number,payer_name,notes,created_by,updated_by)
 VALUES(r.id,f.id,org,f.entity_id,p_invoice_id,p_payment_date,p_amount_cents,p_payment_method,p_reference_number,p_payer_name,p_notes,actor,actor)
 RETURNING id INTO payment_id;
 IF p_invoice_id IS NOT NULL THEN
  UPDATE invoices SET amount_paid=amount_paid+p_amount_cents,balance_due=balance_due-p_amount_cents,
   status=CASE WHEN balance_due=p_amount_cents THEN 'paid'::invoice_status ELSE 'partial'::invoice_status END,updated_by=actor
   WHERE id=i.id;
 END IF;
 result:=jsonb_build_object('request_id',p_request_id,'payment_id',payment_id,'resident_id',r.id,
 'invoice_id',p_invoice_id,'amount_cents',p_amount_cents,'applied_cents',CASE WHEN p_invoice_id IS NULL THEN 0 ELSE p_amount_cents END);
 INSERT INTO payment_recording_receipts VALUES(actor,p_request_id,org,f.id,payload,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_payment(uuid,uuid,uuid,date,integer,public.payment_method,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid,uuid,uuid,date,integer,public.payment_method,text,text,text,uuid) TO authenticated;
-- The only application writer now uses the transaction. Preserve historical rows
-- and deposit/refund metadata editing, but remove the former split-write entry.
REVOKE INSERT ON public.payments FROM authenticated,anon;
REVOKE ALL ON FUNCTION public.apply_invoice_payment(uuid,integer) FROM PUBLIC,anon,authenticated;

-- Receipt-owned payment financial identity cannot diverge from its allocation.
-- Legacy rows remain editable; deposit/refund metadata and notes are unchanged.
CREATE INDEX payment_recording_receipts_payment ON public.payment_recording_receipts ((receipt->>'payment_id'));
CREATE FUNCTION public.protect_recorded_payment_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM payment_recording_receipts WHERE receipt->>'payment_id'=OLD.id::text) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recorded payment history cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.resident_id,NEW.facility_id,NEW.organization_id,NEW.entity_id,NEW.invoice_id,
         NEW.amount,NEW.payment_date,NEW.payment_method,NEW.deleted_at,NEW.created_by)
     IS DISTINCT FROM
     ROW(OLD.id,OLD.resident_id,OLD.facility_id,OLD.organization_id,OLD.entity_id,OLD.invoice_id,
         OLD.amount,OLD.payment_date,OLD.payment_method,OLD.deleted_at,OLD.created_by) THEN
   RAISE EXCEPTION 'Recorded payment financial identity cannot be changed; preserve its receipt and allocation';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_recorded_payment_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER protect_recorded_payment_identity BEFORE UPDATE OR DELETE ON public.payments
 FOR EACH ROW EXECUTE FUNCTION public.protect_recorded_payment_identity();

-- Durable idempotency evidence cannot be edited or removed by later grants or
-- ordinary privileged writes; losing it would permit duplicate payment retries.
CREATE FUNCTION public.protect_payment_recording_receipt()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Payment recording receipts are immutable' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.protect_payment_recording_receipt() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER payment_recording_receipts_immutable
 BEFORE UPDATE OR DELETE ON public.payment_recording_receipts
 FOR EACH ROW EXECUTE FUNCTION public.protect_payment_recording_receipt();
