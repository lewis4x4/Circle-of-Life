-- COL-678: a Medicaid resident's own share becomes its own monthly invoice.
--
-- Brian's rulings (2026-09-23, recorded on COL-678):
--   1. The resident share (resident_payers.medicaid_patient_responsibility) is
--      billed as a SEPARATE monthly invoice to the resident or responsible
--      party. The Medicaid invoice stays as it is.
--   2. Clean A/R from 2026-10-01; prior months are not back-filled.
--   3. At Homewood the 57 unsent Aug/Sep drafts are voided (never sent, so
--      nobody was billed) and the 10 sent May invoices are kept.
--
-- Whether the share is invoiced is a business rule, so it is a column on
-- billing_rate_rules (migration 477), effective-dated: existing rows keep
-- false (history: the share was not invoiced), and a new organization row
-- effective 2026-10-01 turns it on. The generator reads it for the period it
-- bills, so September and earlier never grow a share invoice.
--
-- A resident can now hold two invoices for one period (Medicaid + resident
-- share), so the one-invoice-per-period index gains payer_type. The index keeps
-- its name: persist_monthly_invoices_from_preview (266) and the generator treat
-- a violation of it as "already invoiced".
--
-- Haven had no void path for invoices. haven_void_draft_invoices voids an
-- explicit, bounded list of unsent drafts with a recorded reason; posted or
-- sent invoices are refused. Status, voided_at/by/reason are the only changes,
-- and the invoices audit trigger (029) records each one.
BEGIN;

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_rate_rules
  ADD COLUMN medicaid_resident_share_invoice boolean NOT NULL DEFAULT false;
ALTER TABLE public.billing_rate_rules
  ALTER COLUMN medicaid_resident_share_invoice DROP DEFAULT;

INSERT INTO public.billing_rate_rules (
  organization_id, facility_id, effective_from, rate_overlap_rule, payer_split_is_concession,
  medicaid_resident_share_invoice, ruled_by, note)
SELECT b.organization_id, NULL, DATE '2026-10-01', b.rate_overlap_rule, b.payer_split_is_concession,
  true, 'Brian Lewis',
  'COL-678 ruling, 2026-09-23: a Medicaid resident''s own share (patient responsibility) is billed as a separate monthly invoice to the resident or responsible party, from 2026-10-01 (clean A/R; no back-fill).'
FROM public.billing_rate_rules b
WHERE b.facility_id IS NULL
  AND b.effective_from = DATE '2026-01-01'
  AND NOT EXISTS (
    SELECT 1 FROM public.billing_rate_rules x
    WHERE x.organization_id = b.organization_id AND x.facility_id IS NULL AND x.effective_from = DATE '2026-10-01'
  );

DROP FUNCTION public.haven_billing_rate_rule(uuid, uuid, date);
CREATE FUNCTION public.haven_billing_rate_rule(p_organization_id uuid, p_facility_id uuid, p_as_of date)
RETURNS TABLE (
  rate_overlap_rule text,
  payer_split_is_concession boolean,
  rule_id uuid,
  medicaid_resident_share_invoice boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(r.rate_overlap_rule, 'single_in_force'), coalesce(r.payer_split_is_concession, false), r.id,
    coalesce(r.medicaid_resident_share_invoice, false)
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (
    SELECT b.rate_overlap_rule, b.payer_split_is_concession, b.id, b.medicaid_resident_share_invoice
    FROM public.billing_rate_rules b
    WHERE b.organization_id = p_organization_id
      AND (b.facility_id = p_facility_id OR b.facility_id IS NULL)
      AND b.effective_from <= p_as_of
    ORDER BY (b.facility_id IS NOT NULL) DESC, b.effective_from DESC, b.created_at DESC
    LIMIT 1
  ) r ON true
$$;

REVOKE ALL ON FUNCTION public.haven_billing_rate_rule(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.haven_billing_rate_rule(uuid, uuid, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One invoice per resident, period and payer
-- ---------------------------------------------------------------------------
DROP INDEX public.uq_invoices_facility_resident_period_open;
CREATE UNIQUE INDEX uq_invoices_facility_resident_period_open
  ON public.invoices (facility_id, resident_id, period_start, payer_type) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;
COMMENT ON INDEX public.uq_invoices_facility_resident_period_open IS
  'One invoice per facility, resident, billing period and payer type (COL-678: a Medicaid invoice and a resident-share invoice can share a period). generate-monthly-invoices treats a violation as already invoiced.';

-- ---------------------------------------------------------------------------
-- Voiding unsent drafts
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.haven_void_draft_invoices(p_invoice_ids uuid[], p_reason text)
RETURNS TABLE (voided_count integer, refused_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ids uuid[];
  v_voided integer;
BEGIN
  IF length(v_reason) < 20 THEN
    RAISE EXCEPTION 'A void reason of at least 20 characters is required.' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(coalesce(p_invoice_ids, ARRAY[]::uuid[])) AS x WHERE x IS NOT NULL;
  IF v_ids IS NULL OR cardinality(v_ids) = 0 OR cardinality(v_ids) > 500 THEN
    RAISE EXCEPTION 'Pass between 1 and 500 invoice ids.' USING ERRCODE = '22023';
  END IF;

  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'signed-in user required.' USING ERRCODE = '42501';
    END IF;
    IF haven.app_role() NOT IN ('owner', 'org_admin') THEN
      RAISE EXCEPTION 'Only an owner or organization administrator can void invoices.' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = ANY (v_ids)
        AND (i.organization_id IS DISTINCT FROM haven.organization_id()
          OR NOT (i.facility_id IN (SELECT haven.accessible_facility_ids())))
    ) THEN
      RAISE EXCEPTION 'An invoice is outside the current user access scope.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Only unsent, unposted drafts: anything else was billed and needs a correction, not a void.
  UPDATE public.invoices i
  SET status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      voided_reason = v_reason,
      updated_by = v_actor
  WHERE i.id = ANY (v_ids)
    AND i.deleted_at IS NULL
    AND i.status = 'draft'
    AND i.amount_paid = 0
    AND NOT EXISTS (
      SELECT 1 FROM public.journal_entries j
      WHERE j.source_type = 'invoice' AND j.source_id = i.id AND j.status = 'posted'
    );
  GET DIAGNOSTICS v_voided = ROW_COUNT;

  voided_count := v_voided;
  refused_count := cardinality(v_ids) - v_voided;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.haven_void_draft_invoices(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.haven_void_draft_invoices(uuid[], text) TO authenticated, service_role;
COMMENT ON FUNCTION public.haven_void_draft_invoices(uuid[], text) IS
  'COL-678: voids an explicit list (max 500) of unsent, unpaid, unposted draft invoices with a recorded reason; anything else is refused and counted. COL-37 ruling: definer required -- invoices carry no UPDATE policy for billing staff, and status changes go through finance commands; the body checks auth.uid(), owner/org_admin, the organization and haven.accessible_facility_ids() before writing.';

NOTIFY pgrst, 'reload schema';

COMMIT;
