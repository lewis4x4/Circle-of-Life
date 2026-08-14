-- Post-migration assertions: anon must not execute high-harm RPCs; staff paths remain.
-- Run after all migrations via scripts/pg-verify-migrations.mjs.

DO $$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.haven_create_invoice_with_line_items(uuid, uuid, text, date, date, date, date, integer, integer, integer, integer, integer, integer, text, text, text, jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'rpc_grant_posture: anon can execute haven_create_invoice_with_line_items';
  END IF;

  IF has_function_privilege('anon', 'public.allocate_incident_number(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: anon can execute allocate_incident_number';
  END IF;

  IF has_function_privilege('anon', 'public.bulk_complete_operation_tasks(uuid[], uuid, text, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: anon can execute bulk_complete_operation_tasks';
  END IF;

  IF has_function_privilege('anon', 'public._kb_record_gap(text, uuid, text, text, text, text, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: anon can execute _kb_record_gap';
  END IF;

  IF has_function_privilege('anon', 'public.apply_invoice_payment(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: anon can execute apply_invoice_payment';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.haven_create_invoice_with_line_items(uuid, uuid, text, date, date, date, date, integer, integer, integer, integer, integer, integer, text, text, text, jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'rpc_grant_posture: authenticated lost haven_create_invoice_with_line_items';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.allocate_incident_number(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: authenticated lost allocate_incident_number';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.bulk_complete_operation_tasks(uuid[], uuid, text, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: service_role lost bulk_complete_operation_tasks';
  END IF;

  IF has_function_privilege('authenticated', 'public.bulk_complete_operation_tasks(uuid[], uuid, text, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: authenticated should not execute bulk_complete_operation_tasks';
  END IF;
END;
$$;
