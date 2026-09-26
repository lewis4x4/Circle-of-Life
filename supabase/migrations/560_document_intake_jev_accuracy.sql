-- COL-771 (DI-10): Jev accuracy. Two read-only views over filed documents and
-- a Wilson lower bound helper, for the accuracy page at
-- /admin/document-intake/accuracy. Both views are security_invoker, so a
-- viewer sees exactly the filings, proposals and runs their Document Intake
-- RLS (545) already lets them see. No names, no document text.
--
-- document_intake_jev_check_outcomes reads reviewer_changes.checks, which
-- document_intake_prepare_filing writes from migration 559 on. Before that the
-- verdict column is simply null; there is no DDL dependency.
--
-- Grants match how 545 grants the base tables: SELECT to authenticated (and
-- service_role), nothing to anon.

BEGIN;

-- Jev accuracy (COL-771, DI-10). Security invoker: each viewer sees only the
-- items their document_intake_* RLS already lets them see. No names, no text.

CREATE OR REPLACE FUNCTION haven.wilson_lower(k integer, n integer, z numeric DEFAULT 1.96)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT CASE WHEN n IS NULL OR n <= 0 THEN NULL ELSE
    round(((k::numeric / n) + (z * z) / (2 * n)
      - z * sqrt(((k::numeric / n) * (1 - k::numeric / n) + (z * z) / (4 * n)) / n))
      / (1 + (z * z) / n), 4) END
$$;

-- One row per filed document whose proposal came from a run. Truth is the
-- live filing (state = 'filed'); a corrected filing is superseded by the
-- re-filing, and an item corrected but never re-filed has no truth yet.
CREATE OR REPLACE VIEW public.document_intake_jev_outcomes WITH (security_invoker = true) AS
SELECT
  f.id AS filing_id,
  f.organization_id,
  f.facility_id,
  f.item_id,
  f.approved_at,
  p.id AS proposal_id,
  p.catalog_code AS proposed_code,
  f.catalog_code AS filed_code,
  (p.catalog_code IS NOT DISTINCT FROM f.catalog_code) AS type_correct,
  coalesce(p.stage_status -> 'jev' ->> 'state', 'none') AS jev_state,
  p.jev ->> 'questions_version' AS questions_version,
  d.choice AS jev_choice,
  d.top_p AS jev_top_p,
  d.runner_up_p AS jev_runner_up_p,
  round(d.top_p - d.runner_up_p, 4) AS jev_margin,
  coalesce((r.policy_snapshot -> 'routing' -> 'jev_margin_by_type' ->> f.catalog_code)::numeric,
           (r.policy_snapshot -> 'routing' ->> 'jev_margin')::numeric, 0.2) AS margin_at_run,
  -- Jev's own top pick, right or wrong, whether or not it cleared the margin.
  CASE
    WHEN d.choice IS NULL OR p.catalog_code IS DISTINCT FROM f.catalog_code THEN NULL
    WHEN d.choice ~ '^c[0-9]+$' THEN (p.candidates -> substr(d.choice, 2)::integer ->> 'subject_id')::uuid IS NOT DISTINCT FROM f.subject_id
    WHEN d.choice = 'none' THEN NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p.candidates) c WHERE c ->> 'kind' <> 'none' AND (c ->> 'subject_id')::uuid = f.subject_id)
  END AS jev_top_correct,
  (p.proposed_candidate IS NOT NULL) AS pre_selected,
  CASE WHEN p.proposed_candidate IS NULL THEN NULL
    ELSE (p.candidates -> p.proposed_candidate ->> 'subject_id')::uuid IS NOT DISTINCT FROM f.subject_id END AS pre_selected_correct
FROM public.document_intake_filings f
JOIN public.document_intake_proposals p ON p.id = f.proposal_id
LEFT JOIN public.document_intake_runs r ON r.id = p.run_id
LEFT JOIN LATERAL (
  SELECT a ->> 'choice' AS choice,
         coalesce((a -> 'probabilities' ->> (a ->> 'choice'))::numeric, 0) AS top_p,
         coalesce((SELECT max(e.value::numeric) FROM jsonb_each_text(a -> 'probabilities') e WHERE e.key <> a ->> 'choice'), 0) AS runner_up_p
  FROM (SELECT p.jev -> 'answers' -> 'destination' AS a) s
  WHERE s.a ? 'choice'
) d ON true
WHERE f.state = 'filed';

-- One row per Jev check on a filed document, with the reviewer's verdict
-- (reviewer_changes.checks, written by prepare_filing from migration 554).
CREATE OR REPLACE VIEW public.document_intake_jev_check_outcomes WITH (security_invoker = true) AS
SELECT
  f.id AS filing_id,
  f.organization_id,
  f.facility_id,
  f.item_id,
  f.approved_at,
  f.catalog_code AS filed_code,
  p.jev ->> 'questions_version' AS questions_version,
  c ->> 'code' AS check_code,
  c ->> 'label' AS check_label,
  c ->> 'result' AS jev_result,
  (p.jev -> 'answers' -> substr(c ->> 'code', 5) ->> 'noul')::numeric AS noul_p,
  f.reviewer_changes -> 'checks' ->> (c ->> 'code') AS verdict
FROM public.document_intake_filings f
JOIN public.document_intake_proposals p ON p.id = f.proposal_id
CROSS JOIN LATERAL jsonb_array_elements(p.checks) c
WHERE f.state = 'filed' AND c ->> 'source' = 'jev';

COMMENT ON VIEW public.document_intake_jev_outcomes IS 'COL-771 DI-10. Jev destination accuracy per filed document; security_invoker so document_intake RLS applies.';
COMMENT ON VIEW public.document_intake_jev_check_outcomes IS 'COL-771 DI-10. Jev check answers against reviewer verdicts per filed document; security_invoker.';

REVOKE ALL ON public.document_intake_jev_outcomes, public.document_intake_jev_check_outcomes FROM PUBLIC, anon;
GRANT SELECT ON public.document_intake_jev_outcomes, public.document_intake_jev_check_outcomes TO authenticated, service_role;

REVOKE ALL ON FUNCTION haven.wilson_lower(integer, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.wilson_lower(integer, integer, numeric) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
