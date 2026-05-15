-- 233_audit_hardening_view_function_index.sql
--
-- Post-build audit hardening. All changes are idempotent and reversible.
--
-- 1. P0 SECURITY: convert two SECURITY DEFINER views to SECURITY INVOKER so
--    they enforce caller RLS (caught by Supabase database linter,
--    rule 0010_security_definer_view, ERROR level).
-- 2. P1 SECURITY: pin search_path on 9 functions with mutable search_path
--    (rule 0011_function_search_path_mutable) to prevent search-path
--    privilege-escalation.
-- 3. P1 SECURITY: revoke broad public.api access on the
--    ar_aging_facility_daily materialized view (rule 0014).
-- 4. P1 SECURITY: tighten the equipment-photos SELECT policy. The previous
--    policy allowed any caller to list every object in a public bucket;
--    public-URL reads do not need a SELECT policy, only authenticated
--    listing does. Replace with an authenticated-only listing policy.
-- 5. P1 PERF: drop 4 confirmed duplicate indexes (rule duplicate_index).

BEGIN;

-- =========================================================================
-- 1. SECURITY DEFINER views → SECURITY INVOKER
-- =========================================================================
DROP VIEW IF EXISTS public.quality_latest_facility_measures;
CREATE VIEW public.quality_latest_facility_measures
  WITH (security_invoker = true)
AS
SELECT
  r.id,
  r.organization_id,
  r.facility_id,
  r.quality_measure_id,
  r.period_start,
  r.period_end,
  r.value_numeric,
  r.value_text,
  r.source,
  r.notes,
  r.created_at,
  r.updated_at,
  r.created_by,
  r.updated_by,
  r.deleted_at
FROM quality_measure_results r
JOIN (
  SELECT
    facility_id,
    quality_measure_id,
    MAX(period_end) AS max_period_end
  FROM quality_measure_results
  WHERE deleted_at IS NULL
  GROUP BY facility_id, quality_measure_id
) latest
  ON latest.facility_id = r.facility_id
 AND latest.quality_measure_id = r.quality_measure_id
 AND latest.max_period_end = r.period_end
WHERE r.deleted_at IS NULL;

COMMENT ON VIEW public.quality_latest_facility_measures IS
  'Latest non-deleted quality measure result per (facility, measure). '
  'Created with security_invoker=true so callers see only rows allowed by '
  'quality_measure_results RLS.';

DROP VIEW IF EXISTS public.resident_billable_status;
CREATE VIEW public.resident_billable_status
  WITH (security_invoker = true)
AS
SELECT
  id AS resident_id,
  organization_id,
  facility_id,
  status,
  CASE
    WHEN status = ANY (ARRAY[
      'active'::resident_status,
      'hospital_hold'::resident_status,
      'loa'::resident_status
    ]) THEN true
    WHEN status = ANY (ARRAY[
      'inquiry'::resident_status,
      'pending_admission'::resident_status,
      'discharged'::resident_status,
      'deceased'::resident_status
    ]) THEN false
    ELSE false
  END AS is_billable
FROM residents
WHERE deleted_at IS NULL;

COMMENT ON VIEW public.resident_billable_status IS
  'Per-resident billable flag derived from residents.status. '
  'Created with security_invoker=true so callers see only residents '
  'allowed by residents RLS.';

-- =========================================================================
-- 2. Pin search_path on functions with mutable search_path
-- =========================================================================
ALTER FUNCTION public.haven_csc_discrepancy_defaults()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.increment_usage(uuid, uuid, bigint, bigint)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.increment_usage(uuid, text, bigint, bigint)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.document_role_can_view_audience(text, text)
  SET search_path = public, pg_catalog;
ALTER FUNCTION haven.role_tier(app_role)
  SET search_path = public, haven, pg_catalog;
ALTER FUNCTION haven.can_manage_user(uuid)
  SET search_path = public, haven, pg_catalog;
ALTER FUNCTION public.auto_trigger_watch_protocol()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.seed_admission_case_form_1823()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.normalize_alias_term(text)
  SET search_path = public, pg_catalog;
ALTER FUNCTION haven.facility_audit_trigger()
  SET search_path = public, haven, pg_catalog;

-- =========================================================================
-- 3. Revoke API access on ar_aging_facility_daily materialized view
-- =========================================================================
REVOKE ALL ON public.ar_aging_facility_daily FROM anon;
REVOKE ALL ON public.ar_aging_facility_daily FROM authenticated;

COMMENT ON MATERIALIZED VIEW public.ar_aging_facility_daily IS
  'Daily AR aging snapshot per facility. Service-role + scheduled-jobs '
  'only; anon/authenticated access revoked to prevent unbounded reads.';

-- =========================================================================
-- 4. equipment-photos bucket — tighten broad SELECT policy
--     Public bucket: URL fetches don't need a SELECT policy. Listing/SDK
--     reads should be limited to authenticated users, and SHOULD NOT
--     expose folders owned by other users.
-- =========================================================================
DROP POLICY IF EXISTS equipment_photos_select ON storage.objects;

CREATE POLICY equipment_photos_select_authenticated
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'equipment-photos'
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR auth.role() = 'service_role'
    )
  );

-- =========================================================================
-- 5. Drop duplicate indexes
-- =========================================================================
-- chat_messages: keep idx_kb_chat_messages_conv (newer prefix), drop legacy
DROP INDEX IF EXISTS public.idx_chat_msg_conv;
-- chunks: keep idx_kb_chunks_workspace, drop legacy
DROP INDEX IF EXISTS public.idx_chunks_workspace;
-- document_audit_events: keep idx_document_audit_doc, drop legacy idx_audit_doc
DROP INDEX IF EXISTS public.idx_audit_doc;
-- documents: keep idx_kb_documents_status, drop legacy
DROP INDEX IF EXISTS public.idx_docs_workspace_status;

COMMIT;
