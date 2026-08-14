-- Revoke unauthenticated PostgREST access to public SECURITY DEFINER RPCs.
--
-- Root cause: CREATE OR REPLACE FUNCTION resets default EXECUTE grants to PUBLIC.
-- Prior per-function REVOKE/GRANT blocks are wiped whenever a function body is
-- replaced without re-applying grants, leaving anon able to call money/clinical
-- RPCs via /rest/v1/rpc/* with only the anon API key.
--
-- Posture after this migration:
--   * Trigger/event-trigger functions: not callable via Data API (no EXECUTE for
--     PUBLIC, anon, or authenticated).
--   * Edge/service-role internals: EXECUTE for service_role only.
--   * Staff/product RPCs: EXECUTE for authenticated (+ service_role where the
--     repo already granted it), never anon.
--
-- Re-run safe: idempotent REVOKE + GRANT sweep.

DO $$
DECLARE
  fn RECORD;
  svc_only BOOLEAN;
  auth_only BOOLEAN;
BEGIN
  FOR fn IN
    SELECT
      p.oid,
      p.oid::regprocedure AS sig,
      p.proname,
      p.prorettype = 'trigger'::regtype AS is_trigger,
      p.prorettype = 'event_trigger'::regtype AS is_event_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);

    IF fn.is_trigger OR fn.is_event_trigger THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
      CONTINUE;
    END IF;

    svc_only := (
      fn.proname LIKE '\_%'
      OR fn.proname LIKE 'ai\_tool\_%'
      OR fn.proname IN (
        'bulk_complete_operation_tasks',
        'grace_increment_usage',
        'persist_monthly_invoices_from_preview',
        'replace_exec_kpi_snapshot_run',
        'upsert_facility_operational_thresholds',
        'get_nlq_conversation_context',
        'reserve_nlq_ordinals',
        'haven_sync_resident_rate_cache',
        'increment_usage',
        'log_knowledge_gap',
        'retrieve_evidence',
        'retrieve_evidence_hybrid',
        'retrieve_evidence_hybrid_v2'
      )
      OR fn.proname LIKE 'promote\_facility\_launch\_%'
    );

    auth_only := fn.proname IN (
      'haven_replace_active_resident_rate_agreement',
      'set_nlq_message_feedback'
    );

    IF svc_only THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
    ELSIF auth_only THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
    END IF;
  END LOOP;
END;
$$;

-- Money mutation RPC (SECURITY INVOKER) — same PUBLIC grant leak class.
REVOKE ALL ON FUNCTION public.apply_invoice_payment(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_invoice_payment(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_invoice_payment(uuid, integer) TO authenticated;

-- Belt-and-suspenders for billing/rates RPCs added in 306 without REVOKE FROM PUBLIC.
REVOKE ALL ON FUNCTION public.haven_create_invoice_with_line_items(
  uuid, uuid, text, date, date, date, date,
  integer, integer, integer, integer, integer, integer,
  text, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.haven_create_invoice_with_line_items(
  uuid, uuid, text, date, date, date, date,
  integer, integer, integer, integer, integer, integer,
  text, text, text, jsonb
) FROM anon;
GRANT EXECUTE ON FUNCTION public.haven_create_invoice_with_line_items(
  uuid, uuid, text, date, date, date, date,
  integer, integer, integer, integer, integer, integer,
  text, text, text, jsonb
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.haven_publish_rate_schedule(
  uuid, uuid, text, date,
  integer, integer, integer, integer, integer, integer,
  text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.haven_publish_rate_schedule(
  uuid, uuid, text, date,
  integer, integer, integer, integer, integer, integer,
  text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.haven_publish_rate_schedule(
  uuid, uuid, text, date,
  integer, integer, integer, integer, integer, integer,
  text
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.haven_replace_active_resident_rate_agreement(
  uuid, uuid, uuid, date, uuid, rate_room_class,
  integer, integer, integer, integer, care_charge_mode,
  integer, integer, integer, numeric, concession_reason,
  text, date, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.haven_replace_active_resident_rate_agreement(
  uuid, uuid, uuid, date, uuid, rate_room_class,
  integer, integer, integer, integer, care_charge_mode,
  integer, integer, integer, numeric, concession_reason,
  text, date, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.haven_replace_active_resident_rate_agreement(
  uuid, uuid, uuid, date, uuid, rate_room_class,
  integer, integer, integer, integer, care_charge_mode,
  integer, integer, integer, numeric, concession_reason,
  text, date, text
) TO authenticated;
