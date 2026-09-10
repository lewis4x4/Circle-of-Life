-- Post-migration assertions: anon must not execute high-harm RPCs; staff paths remain.
-- Run after all migrations via scripts/pg-verify-migrations.mjs.

DO $$
BEGIN
  IF has_function_privilege('service_role', 'haven.assert_edge_service_actor(uuid,uuid,integer,uuid,uuid,text[],boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'haven.assert_edge_service_actor(uuid,uuid,integer,uuid,uuid,text[],boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: internal edge actor verifier is executable';
  END IF;
  IF has_table_privilege('authenticated','public.ingest_authorization_runs','SELECT')
     OR has_table_privilege('service_role','public.ingest_authorization_runs','INSERT') THEN
    RAISE EXCEPTION 'rpc_grant_posture: ingest authorization receipt table exposed directly';
  END IF;

  IF has_function_privilege('anon', 'public.haven_current_edge_actor()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.haven_current_edge_actor()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.haven_current_edge_actor()', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: haven_current_edge_actor grants incorrect';
  END IF;
  IF has_function_privilege('anon', 'public.haven_current_shell_actor()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.haven_current_shell_actor()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.haven_current_shell_actor()', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: haven_current_shell_actor grants incorrect';
  END IF;
  IF has_function_privilege('authenticated','public.restrict_user_access_review(uuid,uuid,uuid,integer,uuid,text,text,public.app_role,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.restrict_user_access_review(uuid,uuid,uuid,integer,uuid,text,text,public.app_role,uuid,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.prepare_user_access_expansion_review(uuid,uuid,uuid,integer,uuid,text,text,public.app_role,uuid[],uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.prepare_user_access_expansion_review(uuid,uuid,uuid,integer,uuid,text,text,public.app_role,uuid[],uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: lifecycle command grants incorrect';
  END IF;

  IF has_function_privilege('anon', 'public.create_kb_ingest_authorization_run(uuid,uuid,uuid,uuid,integer,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_kb_ingest_authorization_run(uuid,uuid,uuid,uuid,integer,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.create_kb_ingest_authorization_run(uuid,uuid,uuid,uuid,integer,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.start_kb_ingest_authorization_mutation(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.start_kb_ingest_authorization_mutation(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.start_kb_ingest_authorization_mutation(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.complete_kb_ingest_authorization_run(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.complete_kb_ingest_authorization_run(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.complete_kb_ingest_authorization_run(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fail_kb_ingest_authority_change(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fail_kb_ingest_authority_change(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fail_kb_ingest_authority_change(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: fail_kb_ingest_authority_change grants incorrect';
  END IF;

  IF has_function_privilege('anon', 'public.review_facility_launch_fact(uuid,text,text,uuid,uuid,integer,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.review_facility_launch_fact(uuid,text,text,uuid,uuid,integer,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.review_facility_launch_fact(uuid,text,text,uuid,uuid,integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: review_facility_launch_fact grants incorrect';
  END IF;

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

  IF has_function_privilege('anon', 'public.defer_operation_task_review(uuid, uuid, text, timestamptz, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.defer_operation_task_review(uuid, uuid, text, timestamptz, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: defer must allow only authenticated current-actor wrapper';
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

  IF has_function_privilege('service_role', 'public.bulk_complete_operation_tasks(uuid[], uuid, text, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: bulk must stay disabled before scoped receipts';
  END IF;

  IF has_function_privilege('authenticated', 'public.bulk_complete_operation_tasks(uuid[], uuid, text, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: authenticated should not execute bulk_complete_operation_tasks';
  END IF;

  IF has_function_privilege('service_role', 'public.defer_operation_task_review(uuid, uuid, text, timestamptz, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_grant_posture: service_role may not impersonate defer actor';
  END IF;
END;
$$;
