-- COL-696: evaluate the no-argument RLS helpers once per statement, everywhere.
--
-- 971 policies on 422 tables (production, 2026-09-23) called haven.organization_id(),
-- haven.app_role() and five other no-argument helpers bare. A bare call in a policy
-- is evaluated for every row the policy looks at, and each one re-runs
-- haven.current_authorized_actor() (plpgsql joining user_profiles, auth.users and
-- auth.sessions): about 2.75M auth.sessions index lookups in 39.5 hours, ~12 per
-- signed-in statement. Wrapped as (SELECT haven.x()) the call becomes an InitPlan,
-- evaluated once per statement. COL-664 (474) proved the pattern on the
-- observation tables.
--
-- Same rows, by construction: every helper rewritten here is STABLE (checked on
-- production), so its value cannot change within a statement, and the rewrite
-- touches nothing else in the expression. Group B helpers that take a row value
-- (has_facility_access(facility_id), can_manage_observation_facility(...), ...)
-- cannot be hoisted this way and are left alone.
--
-- Mechanics. haven.wrap_rls_initplans(table) rewrites one table's policies from
-- their own catalog text, so the result is the policy that is actually installed
-- (replay or hosted), not a copy of it. It is idempotent: an already wrapped call
-- is preceded by "SELECT " and does not match. Each table is altered in its own
-- short transaction with a lock timeout, so production never holds ACCESS
-- EXCLUSIVE on hundreds of tables at once; if a lock times out the file stops
-- and can simply be run again. The closing sweep catches any table the list
-- does not name (a no-op on production, where the list came from).
--
-- storage.objects is owned by supabase_storage_admin and is not altered here.
-- supabase/tests/review_rls_initplans.sql fails the replay if a bare call returns.

BEGIN;
CREATE OR REPLACE FUNCTION haven.wrap_rls_initplans(p_table text)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  bare constant text := '(?<!SELECT )haven\.(organization_id|app_role|authorized_user_id|can_run_board_check|can_run_staff_check|can_disposition_watchlist_signal|employee_manager)\(\)';
  v_rel regclass := pg_catalog.to_regclass(p_table);
  r record;
  v_sql text;
  v_count integer := 0;
BEGIN
  IF v_rel IS NULL THEN
    RETURN 0;
  END IF;
  FOR r IN
    SELECT pol.polname,
           pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
           pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
    FROM pg_catalog.pg_policy pol
    WHERE pol.polrelid = v_rel
  LOOP
    IF coalesce(r.using_expr, '') !~ bare AND coalesce(r.check_expr, '') !~ bare THEN
      CONTINUE;
    END IF;
    v_sql := pg_catalog.format('ALTER POLICY %I ON %s', r.polname, v_rel);
    IF r.using_expr IS NOT NULL THEN
      v_sql := v_sql || pg_catalog.format(' USING (%s)', pg_catalog.regexp_replace(r.using_expr, bare, '(SELECT haven.\1())', 'g'));
    END IF;
    IF r.check_expr IS NOT NULL THEN
      v_sql := v_sql || pg_catalog.format(' WITH CHECK (%s)', pg_catalog.regexp_replace(r.check_expr, bare, '(SELECT haven.\1())', 'g'));
    END IF;
    EXECUTE v_sql;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END
$fn$;
REVOKE ALL ON FUNCTION haven.wrap_rls_initplans(text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION haven.wrap_rls_initplans(text) IS
  'COL-696 migration tool: rewrites bare no-argument haven.* helper calls in one table''s policies as (SELECT ...) InitPlans. Idempotent. Not granted to any API role.';
COMMIT;

BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.beds'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.care_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.care_plans'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.emar_records'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.incidents'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.invoices'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.med_passes'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.payments'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.rooms'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.units'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.user_facility_access'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.user_profiles'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('haven.employee_source_requests'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('haven.employee_source_transitions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('haven.finance_source_requests'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('haven.finance_source_transitions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('haven.provider_contact_requests'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('haven.provider_document_finalizations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('haven.provider_report_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('haven.provider_report_expectations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('haven.resident_review_checks'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('haven.resident_review_references'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('haven.resident_review_requests'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.activities'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.activity_attendance'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.activity_sessions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.adl_assessments'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.adl_logs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.admission_case_rate_terms'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.admission_cases'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.admission_document_checklist_items'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.advance_directive_documents'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.ai_invocation_policies'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.ai_invocations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.ai_token_budgets'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.alert_audit_log'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.assessments'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.asset_observations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.audit_log'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.audit_log_export_jobs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.background_screenings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.behavioral_logs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.benchmark_cohorts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.billing_rate_rules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.board_check_results'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.board_check_sessions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.cadence_template_versions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.cadence_template_windows'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.cadence_templates'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.care_event_deliveries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.care_event_escalation_policies'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.care_plan_acknowledgements'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.care_plan_change_tasks'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.care_plan_items'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.care_plan_review_alerts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.care_plan_tasks'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.census_daily_log'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.certificates_of_insurance'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.chat_conversations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.chat_messages'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.chunks'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.claim_activities'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.collection_activities'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.competency_demonstrations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.compliance_doc_triage'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.compliance_knowledge_repository'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.compliance_reminders'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.compliance_rules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.compliance_scan_results'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.compliance_scans'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.compliance_survey_visit_notes'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.compliance_survey_visits'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.condition_changes'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.contract_alerts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.contract_terms'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.contracts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.controlled_substance_count_variance_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.controlled_substance_counts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.cross_operator_benchmark_settings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.diet_orders'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.dietary_records'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.discharge_med_reconciliation'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.document_acknowledgment_requirements'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.document_acknowledgments'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.document_aliases'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.document_audit_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.document_extracted_facts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.document_parser_jobs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.document_planning_hints'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.document_relationships'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.documents'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.drill_log'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.drive_cutover_attestations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.drive_import_batches'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.drive_import_files'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.driver_credentials'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.emar_administration_witnesses'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.emergency_checklist_completions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.emergency_checklist_items'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.employee_duty_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.employee_file_audit_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.employee_medical_access'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.entities'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.entity_gl_settings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.entity_insurance_allocation_settings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.escalation_template_rungs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.escalation_template_versions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.escalation_templates'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_actions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_alert_rules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_alert_user_state'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_alerts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_dashboard_configs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_kpi_snapshots'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_metric_definitions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_metric_snapshots'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_nlq_messages'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_nlq_sessions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_saved_reports'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_scenarios'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_standup_forecast_entries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_standup_import_jobs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_standup_manual_entries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_standup_metric_definitions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_standup_snapshot_metrics'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.exec_standup_snapshots'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_admissions_config'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_assets'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_audit_log'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_billing_config'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_building_profiles'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_cadence_versions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_cadence_windows'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_census_confirmations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_communication_settings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_config_template_bindings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_contacts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_dining_config'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_document_versions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_documents'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_emergency_contacts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_escalation_rung_shift_overrides'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_escalation_rungs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_escalation_versions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_executives'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_incident_config'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_kpi_definitions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_launch_module_values'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_launch_promotion_run_items'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_launch_promotion_run_links'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_launch_promotion_runs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_launch_scoreboard_config'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_maintenance_config'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_medicaid_providers'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_medication_config'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_metric_targets'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_observation_thresholds'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_operational_thresholds'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_service_records'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_shift_definitions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_survey_history'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_timeline_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_vendor_config'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.facility_vendors'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.family_call_log_entries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.family_care_conference_sessions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.family_consent_records'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.family_message_triage_items'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.family_portal_messages'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.family_portal_resident_rights_entries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.family_resident_links'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.finance_command_receipts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.fl_statute_module_links'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.fl_statutes'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.fleet_vehicles'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.flow_workflow_definitions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.flow_workflow_run_steps'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.flow_workflow_runs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.form_1823_records'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.fortification_recommendations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.generated_letters'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.gl_accounts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.gl_budget_lines'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.gl_period_closes'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.gl_posting_rules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.grace_conversations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.grace_memory'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.grace_messages'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.grace_usage_counters'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.haccp_logs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.home_module_releases'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.home_notes'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.home_rent_settings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.incident_followup_protocols'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.incident_followups'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.incident_photos'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.incident_rca'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.incident_root_causes'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.incident_sequences'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.incident_workflow_templates'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.infection_outbreaks'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.infection_surveillance'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.infection_threshold_profiles'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.inservice_log_attendees'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.inservice_log_sessions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.insurance_claims'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.insurance_policies'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.insurance_renewals'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.integration_inbound_queue'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.internal_form_submissions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.internal_form_templates'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.invoice_generation_profiles'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.invoice_line_items'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.invoice_match_rules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.invoice_sequences'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.journal_entries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.journal_entry_lines'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.kb_analytics_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.kb_job_runs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.kb_seed_targets'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.knowledge_contradictions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.knowledge_gaps'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.lab_observations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.legal_entities'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.letter_templates'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.loss_runs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.maintenance_task_completions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.maintenance_tickets'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.meal_logs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.meal_refusals'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.meal_services'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.med_tech_shift_residents'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.med_tech_shift_rules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.med_tech_shifts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.medication_errors'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.meeting_action_items'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.meeting_templates'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.meetings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.memory_compiler_runs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.mileage_logs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.notification_routes'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.notification_subscriptions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.observation_configuration_baselines'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.observation_escalation_deliveries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.observation_escalation_dispatches'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.observation_vocab'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.on_call_schedules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.on_call_shifts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_activities'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_activity_bindings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_activity_source_items'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_activity_source_mappings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_audit_log'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_command_drafts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_escalation_deliveries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_evidence'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_evidence_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_execution_receipts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_facility_requirements'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_help_handover_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_issue_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_issues'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_occurrence_associations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_requirement_versions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_source_adapters'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_source_record_requests'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_source_rules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_subject_access'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_task_instances'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.operation_task_templates'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.organization_operational_threshold_defaults'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.organization_transport_settings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.organizations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.outbreak_actions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.package_log_entries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.payment_allocations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.payment_evidence'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.payroll_export_batches'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.payroll_export_lines'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.pbj_export_batches'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.petty_cash_accounts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.petty_cash_transactions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.pilot_feedback_submissions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.plans_of_correction'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.po_line_items'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.policy_acknowledgments'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.policy_documents'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.pre_pass_holds'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.premium_allocations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.prn_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.purchase_orders'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.quality_measure_results'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.quality_measures'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.rate_schedule_versions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.rate_schedules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.ratio_rule_sets'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.referral_hl7_inbound'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.referral_outreach_activities'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.regulatory_reporting_obligations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.renewal_data_packages'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.report_benchmarks'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.report_exports'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.report_nlq_mappings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.report_pack_items'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.report_packs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.report_permissions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.report_saved_views'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.report_schedule_recipients'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.report_schedules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.report_template_versions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.report_templates'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.reputation_accounts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.reputation_replies'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_contacts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_contract_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_contract_signers'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_contracts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_document_versions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_documents'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_ledger_backfills'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_ledger_entries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_ledger_reasons'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_medications'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_monitoring_order_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_monitoring_order_notifications'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_monitoring_orders'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_observation_assignments'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_observation_escalations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_observation_exceptions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_observation_integrity_flags'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_observation_logs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_observation_plan_rules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_observation_plans'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_observation_tasks'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_observation_templates'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_payers'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_pharmacy_benefits'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_photos'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_rate_agreement_lines'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_rate_agreements'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_record_field_edits'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_safety_insights'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_safety_scores'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_status_history'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_transport_requests'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_trust_accounts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_trust_transactions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_watch_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_watch_instances'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.resident_watch_protocols'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.risk_owner_alert_deliveries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.risk_score_snapshots'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.schedules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.search_audit_log'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.search_tool_policies'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.shift_assignments'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.shift_handoff_notes'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.shift_handoffs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.shift_swap_requests'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.shift_tape_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.snack_logs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff_attendance_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff_attestations'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff_background_checks'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff_certifications'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff_check_results'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff_check_sessions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff_discipline_records'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff_facility_assignments'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff_illness_records'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff_requisitions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staff_training_completions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staffing_adequacy_snapshots'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.staffing_ratio_snapshots'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.stand_up_facility_settings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.survey_binder_items'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.survey_deficiencies'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.survey_visit_log_entries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.survey_visit_sessions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.team_space_members'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.team_spaces'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.time_punch_corrections'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.time_punches'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.time_records'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.timeclock_facility_settings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.timeclock_organization_settings'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.timeclock_sync_rejections'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.training_programs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.tray_tickets'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.trust_account_entries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.usage_counters'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.user_management_audit_log'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vehicle_inspection_logs'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vendor_facilities'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vendor_insurance'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vendor_invoice_lines'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vendor_invoices'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vendor_payment_applications'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vendor_payments'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vendor_scorecard_signals'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vendor_scorecards'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vendors'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.verbal_orders'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.visitor_log_entries'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vital_sign_alert_thresholds'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.vital_sign_alerts'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.watchlist_band_rules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.watchlist_signal_dispositions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.watchlist_signal_instances'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.watchlist_signal_notifications'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.watchlist_signal_rules'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.witness_signatures'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.workers_comp_claims'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.workflow_events'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.workspace_breakglass_grants'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.workspace_cards'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.workspace_comments'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.workspace_files'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.workspace_page_versions'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.workspace_pages'); COMMIT;
BEGIN; SET LOCAL lock_timeout = '5s'; SELECT haven.wrap_rls_initplans('public.workspace_publish_requests'); COMMIT;

-- Anything the production list did not name (replay-only tables, or tables added
-- since the list was taken). One transaction; on production it alters nothing.
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT haven.wrap_rls_initplans(format('%I.%I', schemaname, tablename))
FROM (SELECT DISTINCT schemaname, tablename FROM pg_catalog.pg_policies WHERE schemaname IN ('public', 'haven')) t;
COMMIT;

NOTIFY pgrst, 'reload schema';

