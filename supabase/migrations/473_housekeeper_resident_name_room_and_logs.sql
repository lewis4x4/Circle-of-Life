-- COL-627 (Brian, 2026-09-23): "housekeepers - only resident name and room and logs",
-- with "logs" meaning all resident logs: daily notes, ADL logs, condition changes,
-- behaviour logs and incidents (including care events and incident follow-ups).
--
-- Housekeepers could already do nothing clinical, but they could READ residents,
-- medications, care plans and most of the resident record through policies that
-- admit every staff role with facility access. This migration narrows reads without
-- rewriting those policies: one RESTRICTIVE SELECT policy per table denies the housekeeper
-- role outright, and every other role is unaffected (restrictive policies only ever
-- remove access).
--
--   * denied: the residents table itself and every table carrying a resident_id,
--     except the resident logs and housekeeping's own operations work;
--   * name and room come from public.resident_directory(), which returns exactly
--     id, display name, room/bed label, status and facility for residents in the
--     caller's accessible facilities;
--   * the table list is static (taken from production's catalog when this was
--     written). review_housekeeper_access.sql fails the replay if a later migration
--     adds a resident table without deciding whether housekeepers may read it.
BEGIN;

-- Every resident-bearing table that is not a log or housekeeping's own work.
CREATE POLICY "Housekeepers see resident name and room only" ON public.residents
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.activity_attendance
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.adl_assessments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.admission_cases
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.advance_directive_documents
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.assessments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.benefits_cases
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.care_plan_acknowledgements
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.care_plan_change_tasks
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.care_plan_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.care_plan_review_alerts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.care_plan_tasks
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.care_plans
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.collection_activities
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.daily_vital_observations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.diet_orders
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.discharge_med_reconciliation
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.emar_records
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.family_call_log_entries
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.family_care_conference_sessions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.family_consent_records
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.family_message_triage_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.family_portal_messages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.family_resident_links
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.form_1823_records
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.fortification_recommendations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.generated_letters
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.infection_surveillance
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.invoices
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.lab_observations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.meal_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.meal_refusals
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.med_passes
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.med_tech_shift_residents
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.medication_errors
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.mileage_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.observation_escalation_dispatches
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.package_log_entries
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.payments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.petty_cash_transactions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.pre_pass_holds
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.prn_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_authority_instruments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_contacts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_contract_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_contract_send_claims
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_contract_signers
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_contracts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_document_versions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_documents
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_ledger_entries
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_medications
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_monitoring_order_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_monitoring_orders
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_observation_assignments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_observation_escalations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_observation_exceptions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_observation_integrity_flags
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_observation_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_observation_plan_rules
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_observation_plans
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_observation_tasks
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_payers
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_pharmacy_benefits
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_photos
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_profile_facts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_provider_referrals
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_rate_agreements
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_record_field_edits
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_record_intakes
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_safety_insights
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_safety_scores
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_screening_records
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_status_history
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_transport_requests
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_trust_accounts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_trust_transactions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_watch_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.resident_watch_instances
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.shift_handoff_notes
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.shift_tape_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.tray_tickets
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.trust_account_entries
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.verbal_orders
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.visitor_log_entries
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.vital_sign_alert_thresholds
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.vital_sign_alerts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.watchlist_signal_dispositions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.watchlist_signal_instances
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');
CREATE POLICY "Housekeepers see resident name and room only" ON public.workflow_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (haven.app_role() IS DISTINCT FROM 'housekeeper');

CREATE FUNCTION public.resident_directory(p_facility_id uuid DEFAULT NULL)
RETURNS TABLE (resident_id uuid, facility_id uuid, display_name text, room_label text, status public.resident_status)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT r.id, r.facility_id,
    btrim(coalesce(nullif(btrim(r.preferred_name), ''), r.first_name) || ' ' || coalesce(r.last_name, '')),
    CASE WHEN rm.room_number IS NULL THEN NULL
         WHEN b.bed_label IS NULL OR b.bed_label = rm.room_number OR b.bed_label LIKE rm.room_number || '%' THEN coalesce(b.bed_label, rm.room_number)
         ELSE rm.room_number || '-' || b.bed_label END,
    r.status
  FROM public.residents r
  LEFT JOIN public.beds b ON b.id = r.bed_id AND b.deleted_at IS NULL
  LEFT JOIN public.rooms rm ON rm.id = b.room_id AND rm.deleted_at IS NULL
  WHERE r.deleted_at IS NULL
    AND r.status IN ('active','hospital_hold','loa')
    AND r.organization_id = haven.organization_id()
    AND r.facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IS NOT NULL
    AND haven.app_role() <> 'family'
    AND (p_facility_id IS NULL OR r.facility_id = p_facility_id)
  ORDER BY 3
$function$;
REVOKE ALL ON FUNCTION public.resident_directory(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resident_directory(uuid) TO authenticated;
COMMENT ON FUNCTION public.resident_directory(uuid) IS
'COL-627. COL-37 ruling: definer required so roles that may not read the residents table (housekeeper, by restrictive policy) can still see who lives in which room. Returns only id, display name, room/bed label, status and facility; current in-census residents only; org match and haven.accessible_facility_ids(); family excluded; actor from the server-derived session.';

NOTIFY pgrst, 'reload schema';
COMMIT;
