-- COL-678: the resident-share invoice rule is data, a Medicaid invoice and a
-- resident-share invoice can share a period, and only unsent drafts can be voided.
BEGIN;
DO $$
DECLARE
  v_org uuid;
  v_facility uuid;
  v_entity uuid;
  v_resident uuid;
  v_rule record;
  v_draft uuid;
  v_sent uuid;
  v_result record;
BEGIN
  -- Every live organization turns the share on from 2026-10-01 and not before.
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.deleted_at IS NULL
      AND (
        (SELECT r.medicaid_resident_share_invoice FROM public.haven_billing_rate_rule(o.id, NULL, DATE '2026-09-30') r) IS DISTINCT FROM false
        OR (SELECT r.medicaid_resident_share_invoice FROM public.haven_billing_rate_rule(o.id, NULL, DATE '2026-10-01') r) IS DISTINCT FROM true
      )
  ) THEN
    RAISE EXCEPTION 'Resident-share rule does not resolve off before and on from 2026-10-01';
  END IF;

  SELECT r.organization_id, r.facility_id, f.entity_id, r.id INTO v_org, v_facility, v_entity, v_resident
  FROM public.residents r JOIN public.facilities f ON f.id = r.facility_id
  WHERE r.deleted_at IS NULL AND f.deleted_at IS NULL AND f.entity_id IS NOT NULL
  ORDER BY r.id LIMIT 1;
  IF v_resident IS NULL THEN
    RAISE EXCEPTION 'Replay has no resident to probe with';
  END IF;

  -- Two invoices for one period, one per payer type.
  INSERT INTO public.invoices (resident_id, facility_id, organization_id, entity_id, invoice_number, invoice_date, due_date,
    period_start, period_end, status, subtotal, adjustments, tax, total, amount_paid, balance_due, payer_type)
  VALUES
    (v_resident, v_facility, v_org, v_entity, 'probe-1900-01-M', DATE '1900-01-01', DATE '1900-01-05', DATE '1900-01-01', DATE '1900-01-31',
      'draft', 160000, 0, 0, 160000, 0, 160000, 'medicaid_oss');
  INSERT INTO public.invoices (resident_id, facility_id, organization_id, entity_id, invoice_number, invoice_date, due_date,
    period_start, period_end, status, subtotal, adjustments, tax, total, amount_paid, balance_due, payer_type)
  VALUES
    (v_resident, v_facility, v_org, v_entity, 'probe-1900-01-RS', DATE '1900-01-01', DATE '1900-01-05', DATE '1900-01-01', DATE '1900-01-31',
      'draft', 83700, 0, 0, 83700, 0, 83700, 'private_pay')
  RETURNING id INTO v_draft;

  BEGIN
    INSERT INTO public.invoices (resident_id, facility_id, organization_id, entity_id, invoice_number, invoice_date, due_date,
      period_start, period_end, status, subtotal, adjustments, tax, total, amount_paid, balance_due, payer_type)
    VALUES (v_resident, v_facility, v_org, v_entity, 'probe-1900-01-RS2', DATE '1900-01-01', DATE '1900-01-05', DATE '1900-01-01', DATE '1900-01-31',
      'draft', 1, 0, 0, 1, 0, 1, 'private_pay');
    RAISE EXCEPTION 'A second resident-share invoice for the same period was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  INSERT INTO public.invoices (resident_id, facility_id, organization_id, entity_id, invoice_number, invoice_date, due_date,
    period_start, period_end, status, subtotal, adjustments, tax, total, amount_paid, balance_due, payer_type)
  VALUES (v_resident, v_facility, v_org, v_entity, 'probe-1900-02-SENT', DATE '1900-02-01', DATE '1900-02-05', DATE '1900-02-01', DATE '1900-02-28',
    'sent', 5000, 0, 0, 5000, 0, 5000, 'private_pay')
  RETURNING id INTO v_sent;

  -- A short reason is refused.
  BEGIN
    PERFORM public.haven_void_draft_invoices(ARRAY[v_draft], 'too short');
    RAISE EXCEPTION 'A void without a real reason was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT * INTO v_result FROM public.haven_void_draft_invoices(ARRAY[v_draft, v_sent], 'Probe: voiding an unsent draft per the COL-678 ruling');
  IF v_result.voided_count <> 1 OR v_result.refused_count <> 1 THEN
    RAISE EXCEPTION 'Void counts wrong: %', row_to_json(v_result);
  END IF;
  IF (SELECT status::text FROM public.invoices WHERE id = v_draft) <> 'void'
    OR (SELECT voided_reason FROM public.invoices WHERE id = v_draft) IS NULL
    OR (SELECT voided_at FROM public.invoices WHERE id = v_draft) IS NULL THEN
    RAISE EXCEPTION 'Voided draft is missing its status, time or reason';
  END IF;
  IF (SELECT status::text FROM public.invoices WHERE id = v_sent) <> 'sent' THEN
    RAISE EXCEPTION 'A sent invoice was voided';
  END IF;
END $$;
ROLLBACK;
