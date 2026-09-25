-- Created with supabase migration new; repository claim 526. COL-772 (Medicaid Amendment A, build 7).
-- Retires the admission page's separate Medicaid stage selector: admission screens show the Medicaid
-- status the benefits workflow already knows (the active case's next board step, or the latest answers),
-- so the same fact is never entered twice. admission_cases.medicaid_pipeline_stage stays (default
-- 'prospect') with no writers; drop it after a release with no readers.
BEGIN;
CREATE OR REPLACE FUNCTION haven.benefits_medicaid_status_internal(p_resident_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); BEGIN
 IF p_resident_ids IS NULL OR cardinality(p_resident_ids)>500 THEN RAISE EXCEPTION 'Up to 500 residents at a time' USING ERRCODE='22023'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
  SELECT r.id resident_id,c.id case_id,
   CASE WHEN c.id IS NOT NULL THEN 'case' WHEN s.result IS NOT NULL THEN 'screening' ELSE 'none' END kind,
   CASE
    WHEN c.id IS NOT NULL AND c.agency_score IS NOT NULL AND c.agency_score<5 AND c.reapply_on IS NOT NULL THEN 'Score '||c.agency_score||': reapply '||to_char(c.reapply_on,'Mon FMDD')
    WHEN c.id IS NOT NULL AND nx.label IS NOT NULL THEN 'Next: '||nx.label
    WHEN c.id IS NOT NULL THEN 'All steps recorded'
    WHEN s.result='candidate' THEN 'Candidate'
    WHEN s.result='not_qualified_now' THEN 'Does not qualify now'
    WHEN s.result='needs_answers' THEN 'Needs answers'
    WHEN s.result='already_enrolled' THEN 'Enrolled in long-term-care Medicaid'
    ELSE 'Not asked' END label
  FROM public.residents r
  LEFT JOIN public.benefits_cases c ON c.resident_id=r.id AND c.program='smmc_ltc' AND c.status<>'closed'
  LEFT JOIN LATERAL (SELECT b.label FROM haven.benefits_board_steps() b WHERE c.id IS NOT NULL AND NOT (haven.benefits_board_step_dates(c.id) ? b.step) ORDER BY b.ord LIMIT 1) nx ON true
  LEFT JOIN LATERAL (SELECT coalesce(o.result,x.result) result FROM public.benefits_admission_screenings x
    LEFT JOIN LATERAL (SELECT o.result FROM public.benefits_screening_overrides o WHERE o.screening_id=x.id ORDER BY o.created_at DESC LIMIT 1) o ON true
    WHERE x.resident_id=r.id ORDER BY x.answered_at DESC,x.created_at DESC LIMIT 1) s ON true
  WHERE r.id=ANY(p_resident_ids) AND r.organization_id=(a->>'org')::uuid AND r.deleted_at IS NULL AND haven.benefits_permission(r.facility_id,'read')) q),'[]');
END $$;
REVOKE ALL ON FUNCTION haven.benefits_medicaid_status_internal(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.benefits_medicaid_status(p_resident_ids uuid[]) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_medicaid_status_internal(p_resident_ids); $$;
REVOKE ALL ON FUNCTION public.benefits_medicaid_status(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_medicaid_status(uuid[]),haven.benefits_medicaid_status_internal(uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
