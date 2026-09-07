-- SYS-002 + FL-015: preserve history while returning one caller-authorized result.
BEGIN;
ALTER POLICY quality_measure_results_select ON public.quality_measure_results
USING (
 organization_id = haven.organization_id() AND deleted_at IS NULL
 AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
 AND facility_id IN (SELECT haven.accessible_facility_ids())
);
GRANT SELECT ON public.quality_measure_results TO authenticated;
CREATE OR REPLACE VIEW public.quality_latest_facility_measures
WITH (security_invoker = true) AS
SELECT DISTINCT ON (r.organization_id,r.facility_id,r.quality_measure_id) r.*
FROM public.quality_measure_results r
WHERE r.deleted_at IS NULL
ORDER BY r.organization_id,r.facility_id,r.quality_measure_id,
 r.period_end DESC,r.created_at DESC,r.id DESC;
COMMENT ON VIEW public.quality_latest_facility_measures IS
'Caller RLS; latest period_end, then most recently created nondeleted correction, then UUID descending for equal creation times. All prior values remain in quality_measure_results and audit_log.';
-- Support facility/measure latest reads without sorting all historical results.
CREATE INDEX idx_quality_results_latest_correction ON public.quality_measure_results
 (organization_id,facility_id,quality_measure_id,period_end DESC,created_at DESC,id DESC)
 WHERE deleted_at IS NULL;
COMMIT;
-- Rollback must be a separately reviewed forward migration. Do not restore the
-- definer view or broad SELECT policy. If correction ordering is changed, replace
-- the invoker view in a forward migration and drop this index if no longer used.
