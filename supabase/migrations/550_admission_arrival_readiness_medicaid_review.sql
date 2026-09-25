-- Created with supabase migration new; repository claim 550. COL-575, reworked for COL-333's arrival approval.
-- Move-in is now the confirmed arrival, after an administrator approves the arrival readiness (538). The
-- pre-move-in Medicaid review therefore belongs in that readiness: anyone expected to rely on Medicaid is
-- "not ready for arrival" until the admission Medicaid questions show likely to qualify, or a Facility
-- Executive records an override with a reason (528's medicaid_gate_override_* columns). The review's result
-- and the override are part of the readiness fingerprint when the gate applies, so a later change to either
-- voids an approval already given. Cases the gate does not apply to keep the same fingerprint.
BEGIN;

CREATE OR REPLACE FUNCTION haven.admission_arrival_readiness(p_case uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.admission_cases; r public.residents; tz text; today date; blocked text[] := ARRAY[]::text[];
  form jsonb; evidence jsonb; terms jsonb; snapshot jsonb; form_ok boolean; medicaid jsonb;
BEGIN
  SELECT * INTO c FROM public.admission_cases WHERE id = p_case AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(f.timezone, 'America/New_York') INTO tz FROM public.facilities f WHERE f.id = c.facility_id;
  today := (clock_timestamp() AT TIME ZONE coalesce(tz, 'America/New_York'))::date;
  SELECT * INTO r FROM public.residents WHERE id = c.resident_id AND deleted_at IS NULL;

  SELECT to_jsonb(x) INTO form FROM (
    SELECT fr.id, fr.status, fr.exam_date, fr.expiration_date, nullif(btrim(fr.physician_name), '') AS physician_name, fr.updated_at
    FROM public.form_1823_records fr
    WHERE fr.resident_id = c.resident_id AND fr.deleted_at IS NULL
    ORDER BY CASE WHEN fr.admission_case_id = c.id THEN 1 ELSE 0 END DESC, fr.updated_at DESC, fr.id DESC LIMIT 1) x;
  SELECT to_jsonb(x) INTO evidence FROM (
    SELECT d.id, d.received_at, md5(coalesce(d.notes, '')) AS notes_hash, nullif(btrim(d.notes), '') IS NOT NULL AS has_notes
    FROM public.admission_document_checklist_items d
    WHERE d.admission_case_id = c.id AND d.document_type = 'form_1823' AND d.deleted_at IS NULL LIMIT 1) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'accommodation_type', t.accommodation_type, 'base', t.quoted_base_rate_cents,
    'care', t.quoted_care_surcharge_cents, 'effective_date', t.effective_date, 'schedule', t.rate_schedule_id) ORDER BY t.id), '[]'::jsonb)
    INTO terms FROM public.admission_case_rate_terms t WHERE t.admission_case_id = c.id;
  form_ok := form IS NOT NULL AND evidence IS NOT NULL AND form ->> 'status' = 'received'
    AND (form ->> 'exam_date')::date <= today AND (form ->> 'expiration_date')::date >= today AND form ->> 'physician_name' IS NOT NULL
    AND evidence ->> 'received_at' IS NOT NULL AND (evidence ->> 'has_notes')::boolean;

  IF c.status::text IN ('cancelled', 'closed') THEN blocked := array_append(blocked, 'the admission is cancelled or closed'::text); END IF;
  IF c.actual_arrival_at IS NOT NULL THEN blocked := array_append(blocked, 'the arrival is already recorded'::text); END IF;
  IF c.financial_clearance_at IS NULL THEN blocked := array_append(blocked, 'financial clearance'::text); END IF;
  IF c.physician_orders_received_at IS NULL THEN blocked := array_append(blocked, 'physician orders'::text); END IF;
  IF c.bed_id IS NULL THEN blocked := array_append(blocked, 'bed assignment'::text); END IF;
  IF jsonb_array_length(terms) = 0 THEN blocked := array_append(blocked, 'quoted rate terms'::text); END IF;
  IF NOT form_ok THEN blocked := array_append(blocked, 'a current Form 1823 with verified evidence'::text); END IF;
  IF r.id IS NULL OR r.date_of_birth IS NULL OR r.gender IS NULL THEN blocked := array_append(blocked, 'resident date of birth and gender'::text); END IF;
  -- COL-575: anyone expected to rely on Medicaid needs a likely-to-qualify review or a Facility Executive override.
  medicaid := haven.benefits_move_in_gate_internal(c.id, c.anticipated_payer_source::text);
  IF NOT (medicaid ->> 'satisfied')::boolean THEN
    blocked := array_append(blocked, coalesce(medicaid ->> 'reason', 'Medicaid preliminary review')::text);
  END IF;

  snapshot := jsonb_build_object(
    'case', jsonb_build_object('resident_id', c.resident_id, 'bed_id', c.bed_id, 'target_move_in_date', c.target_move_in_date,
      'financial_clearance_at', c.financial_clearance_at, 'physician_orders_received_at', c.physician_orders_received_at,
      'anticipated_payer_source', c.anticipated_payer_source, 'anticipated_payer_other', c.anticipated_payer_other,
      'intake_program_type', c.intake_program_type),
    'resident', jsonb_build_object('first_name', r.first_name, 'last_name', r.last_name, 'date_of_birth', r.date_of_birth, 'gender', r.gender),
    'rate_terms', terms, 'form_1823', form, 'form_1823_evidence', evidence);
  -- Only when the gate applies, so fingerprints (and approvals) of cases it does not touch are unchanged.
  IF (medicaid ->> 'applies')::boolean THEN
    snapshot := snapshot || jsonb_build_object('medicaid_review', jsonb_build_object('result', medicaid -> 'result', 'overridden', medicaid -> 'overridden',
      'override_at', c.medicaid_gate_override_at));
  END IF;
  RETURN jsonb_build_object('admission_case_id', c.id, 'ready', cardinality(blocked) = 0, 'blocked_by', to_jsonb(blocked),
    'fingerprint', md5(snapshot::text), 'snapshot', snapshot);
END $$;
REVOKE ALL ON FUNCTION haven.admission_arrival_readiness(uuid) FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
