CREATE OR REPLACE FUNCTION public.persist_monthly_invoices_from_preview(
  p_facility_id uuid,
  p_billing_year integer,
  p_billing_month integer,
  p_preview jsonb,
  p_period_start date,
  p_period_end date,
  p_due_date date
)
RETURNS TABLE(created_count integer, skipped_duplicates integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_entity_id uuid;
  v_org_id uuid;
  v_facility_org_id uuid;
  v_invoice_id uuid;
  v_resident_id uuid;
  v_facility_code text;
  v_invoice_number text;
  v_ym text;
  v_month_label text;
  v_expected_period_start date;
  v_expected_period_end date;
  v_expected_due_date date;
  v_constraint_name text;
  v_base_rate integer;
  v_care_surcharge integer;
  v_total integer;
  v_payer_type text;
  v_payer_name text;
  v_acuity text;
  v_prorated boolean;
BEGIN
  IF jsonb_typeof(p_preview) <> 'array' THEN
    RAISE EXCEPTION 'p_preview must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT f.entity_id, f.organization_id
  INTO v_entity_id, v_facility_org_id
  FROM public.facilities f
  WHERE f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_entity_id IS NULL THEN
    RAISE EXCEPTION 'Facility not found' USING ERRCODE = 'P0001';
  END IF;

  v_expected_period_start := make_date(p_billing_year, p_billing_month, 1);
  v_expected_period_end := (v_expected_period_start + INTERVAL '1 month - 1 day')::date;
  v_expected_due_date := make_date(p_billing_year, p_billing_month, 15);

  IF p_period_start <> v_expected_period_start
    OR p_period_end <> v_expected_period_end
    OR p_due_date <> v_expected_due_date THEN
    RAISE EXCEPTION 'Billing period parameters do not match billing year/month' USING ERRCODE = '22023';
  END IF;

  created_count := 0;
  skipped_duplicates := 0;

  v_facility_code := upper(substr(replace(p_facility_id::text, '-', ''), 1, 8));
  v_ym := p_billing_year::text || '-' || lpad(p_billing_month::text, 2, '0');
  v_month_label := trim(to_char(v_expected_period_start, 'FMMonth YYYY'));

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_preview)
  LOOP
    v_resident_id := NULLIF(v_row->>'residentId', '')::uuid;
    IF v_resident_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT r.organization_id
    INTO v_org_id
    FROM public.residents r
    WHERE r.id = v_resident_id
      AND r.facility_id = p_facility_id
      AND r.organization_id = v_facility_org_id
      AND r.deleted_at IS NULL;

    IF v_org_id IS NULL THEN
      CONTINUE;
    END IF;

    v_base_rate := COALESCE((v_row->>'baseRate')::integer, 0);
    v_care_surcharge := COALESCE((v_row->>'careSurcharge')::integer, 0);
    v_total := COALESCE((v_row->>'total')::integer, 0);
    v_payer_type := COALESCE(NULLIF(v_row->>'payerType', ''), 'private_pay');
    v_payer_name := COALESCE(NULLIF(v_row->>'payerName', ''), 'Responsible party');
    v_acuity := COALESCE(NULLIF(v_row->>'acuity', ''), 'Unknown');
    v_prorated := COALESCE((v_row->>'prorated')::boolean, false);

    IF v_base_rate < 0 OR v_care_surcharge < 0 OR v_total < 0 THEN
      RAISE EXCEPTION 'Invoice preview amounts must be non-negative' USING ERRCODE = '22023';
    END IF;

    IF v_total <> v_base_rate + v_care_surcharge THEN
      RAISE EXCEPTION 'Invoice preview total does not match line item totals' USING ERRCODE = '22023';
    END IF;

    v_invoice_number := v_facility_code || '-' || v_ym || '-' || v_resident_id::text;

    BEGIN
      INSERT INTO public.invoices (
        resident_id,
        facility_id,
        organization_id,
        entity_id,
        invoice_number,
        invoice_date,
        due_date,
        period_start,
        period_end,
        status,
        subtotal,
        adjustments,
        tax,
        total,
        amount_paid,
        balance_due,
        payer_type,
        payer_name
      ) VALUES (
        v_resident_id,
        p_facility_id,
        v_org_id,
        v_entity_id,
        v_invoice_number,
        p_period_start,
        p_due_date,
        p_period_start,
        p_period_end,
        'draft',
        v_total,
        0,
        0,
        v_total,
        0,
        v_total,
        v_payer_type::public.payer_type,
        v_payer_name
      )
      RETURNING id INTO v_invoice_id;

      INSERT INTO public.invoice_line_items (
        invoice_id,
        organization_id,
        line_type,
        description,
        quantity,
        unit_price,
        total,
        sort_order
      ) VALUES (
        v_invoice_id,
        v_org_id,
        'room_and_board',
        CASE
          WHEN v_prorated THEN 'Private Room — Prorated (' || v_month_label || ')'
          ELSE 'Private Room — Monthly Rate'
        END,
        1,
        v_base_rate,
        v_base_rate,
        1
      );

      IF v_care_surcharge > 0 THEN
        INSERT INTO public.invoice_line_items (
          invoice_id,
          organization_id,
          line_type,
          description,
          quantity,
          unit_price,
          total,
          sort_order
        ) VALUES (
          v_invoice_id,
          v_org_id,
          'care_surcharge',
          v_acuity || ' Care Surcharge',
          1,
          v_care_surcharge,
          v_care_surcharge,
          2
        );
      END IF;

      created_count := created_count + 1;
    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name IN ('uq_invoices_facility_resident_period_open', 'idx_invoices_number') THEN
          skipped_duplicates := skipped_duplicates + 1;
        ELSE
          RAISE;
        END IF;
    END;
  END LOOP;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_monthly_invoices_from_preview(uuid, integer, integer, jsonb, date, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.persist_monthly_invoices_from_preview(uuid, integer, integer, jsonb, date, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.persist_monthly_invoices_from_preview(uuid, integer, integer, jsonb, date, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_monthly_invoices_from_preview(uuid, integer, integer, jsonb, date, date, date) TO service_role;
