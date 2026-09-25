-- Created with supabase migration new; repository claim 528. COL-575 (Brian/Michelle 2026-09-22, DEC-2026-09-22-08).
-- Before move-in, anyone expected to rely on Medicaid needs a completed preliminary review showing they are
-- likely to qualify. The review is the admission Medicaid questions (COL-763): "likely to qualify" is a
-- 'candidate' result (or a reviewer's override to candidate). Otherwise move-in is blocked unless a Facility
-- Executive (owner, org admin, facility administrator) records an override with a reason, kept on the case.
BEGIN;
ALTER TABLE public.admission_cases
 ADD COLUMN medicaid_gate_override_reason text CHECK(length(medicaid_gate_override_reason)<=2000),
 ADD COLUMN medicaid_gate_override_by uuid REFERENCES public.user_profiles(id),
 ADD COLUMN medicaid_gate_override_at timestamptz,
 ADD CONSTRAINT admission_cases_medicaid_gate_override_complete CHECK(
  (medicaid_gate_override_reason IS NULL AND medicaid_gate_override_by IS NULL AND medicaid_gate_override_at IS NULL)
  OR (length(btrim(medicaid_gate_override_reason))>0 AND medicaid_gate_override_by IS NOT NULL AND medicaid_gate_override_at IS NOT NULL));

-- Service-only: the admissions route evaluates the gate with the service key (it has no benefits grant), passing
-- the payer the case will have after the requested change (the same PATCH may set it).
CREATE OR REPLACE FUNCTION haven.benefits_move_in_gate_internal(p_admission_case_id uuid,p_anticipated_payer_source text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ac public.admission_cases; s record; result text; applies boolean; BEGIN
 SELECT * INTO ac FROM public.admission_cases WHERE id=p_admission_case_id AND deleted_at IS NULL;
 IF ac.id IS NULL THEN RAISE EXCEPTION 'Admission unavailable' USING ERRCODE='22023'; END IF;
 SELECT x.coverage,coalesce((SELECT o.result FROM public.benefits_screening_overrides o WHERE o.screening_id=x.id ORDER BY o.created_at DESC LIMIT 1),x.result) result INTO s
 FROM public.benefits_admission_screenings x WHERE x.resident_id=ac.resident_id ORDER BY x.answered_at DESC,x.created_at DESC LIMIT 1;
 result:=s.result;
 applies:=coalesce(s.coverage,'') NOT IN ('smmc_ltc_enrolled','private_pay')
  AND (coalesce(p_anticipated_payer_source='medicaid_pending',false) OR coalesce(s.coverage IN ('medicaid_mma','application_pending'),false));
 RETURN jsonb_build_object('applies',applies,'result',result,'overridden',ac.medicaid_gate_override_reason IS NOT NULL,
  'satisfied',NOT applies OR coalesce(result='candidate',false) OR ac.medicaid_gate_override_reason IS NOT NULL,
  'reason',CASE WHEN NOT applies THEN NULL WHEN result IS NULL THEN 'Medicaid preliminary review (the Medicaid questions have not been answered)'
   WHEN result='not_qualified_now' THEN 'Medicaid preliminary review (answers show: does not qualify now)'
   WHEN result='needs_answers' THEN 'Medicaid preliminary review (answers are incomplete)' ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION haven.benefits_move_in_gate_internal(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.benefits_move_in_gate(p_admission_case_id uuid,p_anticipated_payer_source text) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_move_in_gate_internal(p_admission_case_id,p_anticipated_payer_source); $$;
REVOKE ALL ON FUNCTION public.benefits_move_in_gate(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_move_in_gate(uuid,text),haven.benefits_move_in_gate_internal(uuid,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
