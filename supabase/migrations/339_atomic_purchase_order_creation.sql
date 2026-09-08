-- BUS-002: preserve the original creation request without freezing later PO edits.
-- The existing line updated_at trigger also assigns updated_by; supply its
-- missing attribution column so legitimate receiving/draft updates keep working.
ALTER TABLE public.po_line_items ADD COLUMN updated_by uuid REFERENCES auth.users(id);
CREATE TABLE public.purchase_order_creation_receipts (
 caller_id uuid NOT NULL REFERENCES auth.users(id),
 request_id uuid NOT NULL,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 vendor_id uuid NOT NULL REFERENCES public.vendors(id),
 payload jsonb NOT NULL,
 receipt jsonb NOT NULL,
 PRIMARY KEY(caller_id,request_id)
);
ALTER TABLE public.purchase_order_creation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_order_creation_receipts FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.create_purchase_order(p_request_id uuid,p_expected_caller uuid,
 p_facility_id uuid,p_vendor_id uuid,p_order_date date,p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor uuid:=auth.uid(); org uuid:=haven.organization_id(); role_name public.app_role:=haven.app_role();
 previous purchase_order_creation_receipts%ROWTYPE; item jsonb; q numeric; cents numeric; extended numeric;
 total bigint:=0; line_no integer:=0; po_id uuid; po_number_value text; result jsonb;
 payload jsonb:=jsonb_build_object('facility_id',p_facility_id,'vendor_id',p_vendor_id,'order_date',p_order_date,'lines',p_lines);
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_caller OR org IS NULL OR role_name IS NULL
    OR role_name NOT IN ('owner','org_admin','facility_admin') THEN
  RAISE EXCEPTION 'Purchase order creation is not authorized' USING ERRCODE='42501';
 END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Purchase order request identity is required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('purchase_order:'||actor::text||p_request_id::text,0));
 SELECT * INTO previous FROM purchase_order_creation_receipts WHERE caller_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF previous.organization_id IS DISTINCT FROM org THEN RAISE EXCEPTION 'Purchase order receipt is not authorized' USING ERRCODE='42501'; END IF;
  IF previous.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Purchase order request identity was already used with different details'; END IF;
 END IF;
 -- Current authority applies to receipt retrieval too. Lock referenced live rows
 -- against deletion/relink while creating. Owner/org_admin retain org-wide access.
 PERFORM 1 FROM facilities WHERE id=p_facility_id AND organization_id=org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR (role_name='facility_admin' AND p_facility_id NOT IN (SELECT haven.accessible_facility_ids())) THEN
  RAISE EXCEPTION 'Purchase order facility is not accessible' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM vendors WHERE id=p_vendor_id AND organization_id=org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order vendor is not accessible' USING ERRCODE='42501'; END IF;
 -- Preserve the existing creation form's link requirement for every role.
 -- Receipt visibility mirrors purchase_orders_select: facility_admin needs the
 -- original PO facility link, even when another accessible facility links the vendor.
 IF previous.caller_id IS NULL OR role_name='facility_admin' THEN
  PERFORM 1 FROM vendor_facilities WHERE organization_id=org AND facility_id=p_facility_id
   AND vendor_id=p_vendor_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link this vendor to the selected facility first (vendor profile).' USING ERRCODE='42501'; END IF;
 END IF;
 IF previous.caller_id IS NOT NULL THEN RETURN previous.receipt; END IF;
 IF p_order_date IS NULL OR NOT isfinite(p_order_date) OR p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' THEN
  RAISE EXCEPTION 'An order date and initial line items are required';
 END IF;
 IF jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'At least one initial line item is required'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'description') IS DISTINCT FROM 'string'
     OR btrim(item->>'description')='' OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number'
     OR jsonb_typeof(item->'unit_cost_cents') IS DISTINCT FROM 'number' THEN
   RAISE EXCEPTION 'Each line requires a description, positive quantity and whole-cent unit cost';
  END IF;
  q:=(item->>'quantity')::numeric; cents:=(item->>'unit_cost_cents')::numeric;
  IF q<=0 OR q>=100000000 OR q<>round(q,4) OR cents<0 OR cents>2147483647 OR cents<>trunc(cents) THEN
   RAISE EXCEPTION 'Quantity must be positive with at most four decimal places; unit cost must be nonnegative integer cents';
  END IF;
  extended:=round(q*cents);
  IF extended>2147483647 THEN RAISE EXCEPTION 'Line total exceeds supported integer cents'; END IF;
  total:=total+extended::bigint;
 END LOOP;
 po_number_value:=public.allocate_vendor_po_number(org);
 INSERT INTO purchase_orders(organization_id,vendor_id,facility_id,po_number,status,order_date,total_cents,created_by,updated_by)
 VALUES(org,p_vendor_id,p_facility_id,po_number_value,'draft',p_order_date,total,actor,actor) RETURNING id INTO po_id;
 FOR item IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  line_no:=line_no+1;
  INSERT INTO po_line_items(organization_id,purchase_order_id,line_number,description,quantity,unit_cost_cents,line_total_cents,updated_by)
  VALUES(org,po_id,line_no,btrim(item->>'description'),(item->>'quantity')::numeric,
   (item->>'unit_cost_cents')::numeric::integer,round((item->>'quantity')::numeric*(item->>'unit_cost_cents')::numeric)::integer,actor);
 END LOOP;
 result:=jsonb_build_object('request_id',p_request_id,'purchase_order_id',po_id,'po_number',po_number_value,
  'facility_id',p_facility_id,'vendor_id',p_vendor_id,'total_cents',total,'line_count',line_no);
 INSERT INTO purchase_order_creation_receipts VALUES(actor,p_request_id,org,p_facility_id,p_vendor_id,payload,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_purchase_order(uuid,uuid,uuid,uuid,date,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid,uuid,uuid,uuid,date,jsonb) TO authenticated;
-- Initial header creation has one atomic entry; later legitimate draft/receipt
-- editing, approval guards, soft deletion and audit history remain unchanged.
REVOKE INSERT ON public.purchase_orders FROM authenticated,anon;
CREATE FUNCTION public.protect_purchase_order_creation_receipt()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Purchase order creation receipts are immutable' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.protect_purchase_order_creation_receipt() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER purchase_order_creation_receipts_immutable BEFORE UPDATE OR DELETE ON public.purchase_order_creation_receipts
 FOR EACH ROW EXECUTE FUNCTION public.protect_purchase_order_creation_receipt();
