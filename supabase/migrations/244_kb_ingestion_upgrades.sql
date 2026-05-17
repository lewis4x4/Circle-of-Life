-- KB-NEXT-08: ingestion upgrades — retry tracking + redaction audit.
--
-- A. Retry tracking on documents
--    - ingest_attempt_count: how many ingest tries this doc has survived.
--    - ingest_last_error: last error message (truncated) for owner UI.
--    - ingest_retry_at: scheduled next try (NULL = no auto-retry pending).
--    - ingest_max_attempts: per-row override; defaults to 3 via column default.
--
-- B. Redaction audit on chunks
--    - redacted_at: timestamp when redaction ran on this chunk.
--    - redaction_patterns_hit: jsonb counter of which PHI patterns fired
--      (SSN, DEA, NPI, DOB, MRN, dosage). Lets ops/legal sample what we're
--      catching without ever seeing the raw values.
--
-- All ALTER statements use IF NOT EXISTS so reruns are safe.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ingest_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ingest_last_error text,
  ADD COLUMN IF NOT EXISTS ingest_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS ingest_max_attempts integer NOT NULL DEFAULT 3;

ALTER TABLE public.chunks
  ADD COLUMN IF NOT EXISTS redacted_at timestamptz,
  ADD COLUMN IF NOT EXISTS redaction_patterns_hit jsonb;

-- Partial index for the retry sweep so we can pull "next-due" docs cheaply.
CREATE INDEX IF NOT EXISTS idx_documents_ingest_retry_due
  ON public.documents (ingest_retry_at)
  WHERE status = 'ingest_failed' AND ingest_retry_at IS NOT NULL;

COMMENT ON COLUMN public.documents.ingest_attempt_count IS
  'KB-NEXT-08: count of ingest pipeline attempts. Bumped on each retry; gated by ingest_max_attempts to prevent infinite loops.';
COMMENT ON COLUMN public.documents.ingest_retry_at IS
  'KB-NEXT-08: next eligible auto-retry time, set with exponential backoff (1m, 5m, 30m). NULL once exhausted or successful.';
COMMENT ON COLUMN public.chunks.redacted_at IS
  'KB-NEXT-08: when redact-pii ran over this chunk. NULL = either pre-KB-NEXT-08 chunk or redaction skipped (no patterns matched).';
COMMENT ON COLUMN public.chunks.redaction_patterns_hit IS
  'KB-NEXT-08: jsonb of {pattern: count} for SSN/DEA/NPI/DOB/MRN/dosage matches found during redaction. Diagnostic only — never contains raw PHI.';

-- ---------------------------------------------------------------------------
-- _kb_ingest_request_retry RPC: SECURITY DEFINER caller-context helper that
-- schedules a failed doc for re-ingest. Service role only — Edge Function
-- wraps it after re-asserting tenancy. Caps at ingest_max_attempts.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._kb_ingest_request_retry (
  p_document_id uuid,
  p_caller_organization_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
DECLARE
  doc_row record;
  next_attempt integer;
  delay_seconds integer;
BEGIN
  IF p_caller_organization_id IS NULL OR p_document_id IS NULL THEN
    RAISE EXCEPTION 'caller_context_required';
  END IF;
  SELECT id, workspace_id, status, ingest_attempt_count, ingest_max_attempts
    INTO doc_row
    FROM public.documents
   WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_found';
  END IF;
  IF doc_row.workspace_id::uuid <> p_caller_organization_id THEN
    RAISE EXCEPTION 'cross_tenant_denied';
  END IF;
  IF doc_row.status <> 'ingest_failed' THEN
    RETURN jsonb_build_object(
      'requeued', false,
      'reason', 'not_in_failed_state',
      'current_status', doc_row.status
    );
  END IF;
  next_attempt := COALESCE(doc_row.ingest_attempt_count, 0) + 1;
  IF next_attempt > COALESCE(doc_row.ingest_max_attempts, 3) THEN
    RETURN jsonb_build_object(
      'requeued', false,
      'reason', 'max_attempts_exceeded',
      'attempts', doc_row.ingest_attempt_count,
      'max_attempts', doc_row.ingest_max_attempts
    );
  END IF;
  -- 60s, 5min, 30min exponential-ish backoff (capped).
  delay_seconds := CASE next_attempt
    WHEN 1 THEN 60
    WHEN 2 THEN 300
    WHEN 3 THEN 1800
    ELSE 3600
  END;
  UPDATE public.documents
     SET ingest_retry_at = now() + (delay_seconds || ' seconds')::interval,
         status = 'pending_ingest'
   WHERE id = p_document_id;
  RETURN jsonb_build_object(
    'requeued', true,
    'next_attempt', next_attempt,
    'retry_at', (now() + (delay_seconds || ' seconds')::interval),
    'delay_seconds', delay_seconds
  );
END;
$func$;

COMMENT ON FUNCTION public._kb_ingest_request_retry (uuid, uuid) IS
  'KB-NEXT-08: schedule a failed ingest for re-run with exponential backoff (60s/5m/30m). service_role only — Edge Function re-asserts caller org before invoking.';

REVOKE ALL ON FUNCTION public._kb_ingest_request_retry (uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._kb_ingest_request_retry (uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._kb_ingest_request_retry (uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._kb_ingest_request_retry (uuid, uuid) TO service_role;
