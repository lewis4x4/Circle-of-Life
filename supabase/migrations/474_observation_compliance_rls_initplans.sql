-- COL-664: observation_compliance_for_range was ~25x slower for a signed-in
-- user than for postgres (7 days at Homewood: 8.3 s as the owner, 0.26 s as
-- postgres), so /api/rounding/compliance had to split every range into one
-- call per day.
--
-- Two causes, both measured on production with EXPLAIN (ANALYZE, BUFFERS):
--
-- 1. RLS helpers evaluated once per row. The SELECT policies on the tables
--    this read touches called haven.organization_id() / haven.app_role() /
--    haven.can_manage_observation_facility(facility_id) bare, so every row
--    re-ran haven.current_authorized_actor() (a plpgsql lookup joining
--    user_profiles, auth.users and auth.sessions). Wrapping the row-independent
--    calls in (SELECT ...) makes each one an InitPlan evaluated once per
--    statement. can_manage_observation_facility(facility_id) is
--    "app_role() in (owner, org_admin, facility_admin, med_tech) AND facility_id
--    in accessible_facility_ids()"; the policy already requires the second half,
--    so only the role test remains. Every policy answers exactly the same rows.
--
-- 2. Window projection per resident-day. facility_observation_windows_for_date
--    and _for_version depend on (facility, date) and (facility, stamped version,
--    date), not on the resident, yet ran once per resident-day inside a LATERAL
--    (291 + 773 calls for one week at Homewood, ~4 s). They are now resolved
--    once per key in materialized CTEs and joined, as is
--    facility_cadence_in_force (formerly called twice per output row).
--
-- The function keeps invoker rights: the caller's RLS still decides which
-- buildings it answers about (no definer switch without a COL-37 ruling).
-- Output is unchanged: row-for-row md5 of the old and new function matched on
-- production (Homewood 7 and 31 days) and on staging (one facility and all
-- facilities, as postgres and as a facility_admin).

BEGIN;

-- Migration 473's restrictive housekeeper policy, on every table it created it
-- on. The bare haven.app_role() ran current_authorized_actor() once per row
-- read from each of these tables, for every role.
ALTER POLICY "Housekeepers see resident name and room only" ON public.residents
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.activity_attendance
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.adl_assessments
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.admission_cases
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.advance_directive_documents
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.assessments
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.benefits_cases
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.care_plan_acknowledgements
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.care_plan_change_tasks
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.care_plan_items
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.care_plan_review_alerts
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.care_plan_tasks
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.care_plans
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.collection_activities
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.daily_vital_observations
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.diet_orders
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.discharge_med_reconciliation
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.emar_records
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.family_call_log_entries
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.family_care_conference_sessions
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.family_consent_records
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.family_message_triage_items
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.family_portal_messages
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.family_resident_links
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.form_1823_records
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.fortification_recommendations
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.generated_letters
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.infection_surveillance
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.invoices
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.lab_observations
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.meal_logs
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.meal_refusals
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.med_passes
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.med_tech_shift_residents
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.medication_errors
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.mileage_logs
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.observation_escalation_dispatches
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.package_log_entries
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.payments
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.petty_cash_transactions
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.pre_pass_holds
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.prn_events
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_authority_instruments
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_contacts
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_contract_events
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_contract_send_claims
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_contract_signers
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_contracts
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_document_versions
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_documents
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_ledger_entries
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_medications
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_monitoring_order_events
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_monitoring_orders
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_observation_assignments
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_observation_escalations
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_observation_exceptions
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_observation_integrity_flags
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_observation_logs
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_observation_plan_rules
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_observation_plans
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_observation_tasks
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_payers
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_pharmacy_benefits
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_photos
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_profile_facts
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_provider_referrals
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_rate_agreements
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_record_field_edits
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_record_intakes
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_safety_insights
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_safety_scores
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_screening_records
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_status_history
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_transport_requests
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_trust_accounts
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_trust_transactions
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_watch_events
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.resident_watch_instances
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.shift_handoff_notes
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.shift_tape_events
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.tray_tickets
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.trust_account_entries
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.verbal_orders
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.visitor_log_entries
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.vital_sign_alert_thresholds
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.vital_sign_alerts
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.watchlist_signal_dispositions
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.watchlist_signal_instances
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
ALTER POLICY "Housekeepers see resident name and room only" ON public.workflow_events
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);

-- can_manage_observation_facility(facility_id) is app_role() IN (owner, org_admin, facility_admin, med_tech)
-- AND facility_id IN accessible_facility_ids(); the second half is already required by this policy,
-- so only the role test remains, and it does not depend on the row.
ALTER POLICY resident_observation_tasks_select ON public.resident_observation_tasks
  USING (
    organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND deleted_at IS NULL
    AND ((SELECT haven.app_role()) = ANY (ARRAY['owner', 'org_admin', 'facility_admin', 'med_tech']::public.app_role[])
      OR haven.can_complete_observation_task(id)));

ALTER POLICY resident_observation_logs_select ON public.resident_observation_logs
  USING (
    organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND deleted_at IS NULL);

ALTER POLICY resident_monitoring_orders_select ON public.resident_monitoring_orders
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids()));

ALTER POLICY resident_status_history_select ON public.resident_status_history
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids()));

ALTER POLICY resident_status_history_manage ON public.resident_status_history
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (SELECT haven.app_role()) = ANY (ARRAY['owner', 'org_admin', 'facility_admin', 'manager', 'med_tech']::public.app_role[]));

ALTER POLICY observation_shift_history_select ON public.facility_observation_shift_history
  USING (
    organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND deleted_at IS NULL);

ALTER POLICY facility_cadence_versions_select ON public.facility_cadence_versions
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids()));

ALTER POLICY facility_cadence_windows_select ON public.facility_cadence_windows
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids()));

ALTER POLICY users_see_facilities_they_have_access_to ON public.facilities
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND id IN (SELECT haven.accessible_facility_ids()));

ALTER POLICY owner_org_admin_manage_facilities ON public.facilities
  USING (
    organization_id = (SELECT haven.organization_id())
    AND (SELECT haven.app_role()) = ANY (ARRAY['owner', 'org_admin']::public.app_role[]));

ALTER POLICY family_see_facilities_for_linked_residents ON public.facilities
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND (SELECT haven.app_role()) = 'family'::public.app_role
    AND id IN (
      SELECT r.facility_id
      FROM public.residents r
      JOIN public.family_resident_links frl ON frl.resident_id = r.id
      WHERE frl.user_id = (SELECT auth.uid())
        AND frl.revoked_at IS NULL
        AND r.deleted_at IS NULL));

CREATE OR REPLACE FUNCTION public.observation_compliance_for_range (p_facility_id uuid, p_from date, p_to date)
  RETURNS TABLE (
    organization_id uuid,
    facility_id uuid,
    resident_id uuid,
    service_date date,
    window_key text,
    window_label text,
    shift_key text,
    cadence_version_id uuid,
    stamped_cadence_version_id uuid,
    projected_cadence_version_id uuid,
    cadence_version_matches_projection boolean,
    no_cadence_in_force boolean,
    due_at_utc timestamptz,
    window_opens_at_utc timestamptz,
    window_closes_at_utc timestamptz,
    task_id uuid,
    task_status text,
    covered_by_monitoring_order_id uuid,
    satisfied_by_log_id uuid,
    satisfied_at timestamptz,
    satisfied_by_monitoring_order_id uuid,
    satisfied boolean,
    absorbed boolean,
    expectation_source text)
  LANGUAGE plpgsql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
#variable_conflict use_column
DECLARE
  v_span integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'observation_compliance_for_range requires a from date and a to date'
      USING ERRCODE = '22023';
  END IF;

  IF p_to < p_from THEN
    RAISE EXCEPTION 'observation_compliance_for_range was called with % after %, which would return nothing; a compliance read must not answer an impossible question with silence', p_from, p_to
      USING ERRCODE = '22023';
  END IF;

  v_span := (p_to - p_from) + 1;
  IF v_span > 366 THEN
    RAISE EXCEPTION 'observation_compliance_for_range covers % days; the limit is 366', v_span
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH facility AS (
    SELECT
      f.id,
      f.organization_id AS org_id,
      COALESCE(f.timezone, 'America/New_York') AS tz
    FROM
      public.facilities f
    WHERE
      f.deleted_at IS NULL
      AND (p_facility_id IS NULL
        OR f.id = p_facility_id)
),
spine AS (
  SELECT
    d::date AS the_date
  FROM
    generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') AS d
),
occupancy AS (
 SELECT h.organization_id AS org_id,h.facility_id AS fac_id,h.resident_id AS res_id,s.the_date
 FROM public.resident_status_history h JOIN facility fac ON fac.id=h.facility_id CROSS JOIN spine s
 WHERE h.deleted_at IS NULL AND h.effective_from < ((s.the_date+1)::timestamp AT TIME ZONE fac.tz)
   AND (h.effective_to IS NULL OR h.effective_to > (s.the_date::timestamp AT TIME ZONE fac.tz))
 UNION
 SELECT r.organization_id,r.facility_id,r.id,s.the_date
 FROM public.residents r JOIN facility fac ON fac.id=r.facility_id CROSS JOIN spine s
 WHERE r.admission_date<=s.the_date AND (r.discharge_date IS NULL OR r.discharge_date>=s.the_date)
   AND ((r.status='active' AND NOT EXISTS(SELECT 1 FROM public.resident_status_history h WHERE h.resident_id=r.id AND h.deleted_at IS NULL))
     OR haven.observation_history_starts_after(r.id,r.facility_id,(s.the_date::timestamp AT TIME ZONE fac.tz)))
),
coverage AS (
  SELECT
    org_id,
    fac_id,
    res_id,
    the_date
  FROM
    occupancy
  UNION
  SELECT
    t.organization_id,
    t.facility_id,
    t.resident_id,
    t.service_date
  FROM
    public.resident_observation_tasks t
    JOIN facility fac ON fac.id = t.facility_id
  WHERE
    t.deleted_at IS NULL
    AND t.window_key IS NOT NULL
    AND t.service_date BETWEEN p_from AND p_to
  UNION
  SELECT
    o.organization_id,
    o.facility_id,
    o.resident_id,
    covered_day::date
  FROM
    public.resident_monitoring_orders o
    JOIN facility fac ON fac.id = o.facility_id
    CROSS JOIN LATERAL generate_series(GREATEST(date_trunc('day', o.starts_at AT TIME ZONE fac.tz), p_from::timestamp), LEAST(date_trunc('day', LEAST(haven.monitoring_order_in_force_until (o.status, o.ends_at, o.cancelled_at, o.closed_at), now()) AT TIME ZONE fac.tz), p_to::timestamp), interval '1 day') AS covered_day
  WHERE
    o.deleted_at IS NULL
),
resolved AS (SELECT * FROM coverage
),
-- COL-664: windows depend only on (facility, date) and (facility, stamped
-- version, date), not on the resident. Resolve each of those once instead of
-- once per resident-day; under RLS each window call cost several milliseconds.
date_windows AS MATERIALIZED (
  SELECT fac.id AS fac_id, s.the_date, pw.cadence_version_id, pw.window_key, pw.label,
    pw.shift_key, pw.due_at_utc, pw.window_opens_at_utc, pw.window_closes_at_utc
  FROM facility fac
  CROSS JOIN spine s
  CROSS JOIN LATERAL public.facility_observation_windows_for_date(fac.id, s.the_date) pw
),
stamped_versions AS MATERIALIZED (
  SELECT DISTINCT stamped.facility_id AS fac_id, stamped.cadence_version_id, stamped.service_date
  FROM public.resident_observation_tasks stamped
  JOIN facility fac ON fac.id = stamped.facility_id
  WHERE stamped.deleted_at IS NULL
    AND stamped.monitoring_order_id IS NULL
    AND stamped.cadence_version_id IS NOT NULL
    AND stamped.service_date BETWEEN p_from AND p_to
),
version_windows AS MATERIALIZED (
  SELECT sv.fac_id, sv.cadence_version_id AS stamped_version_id, sv.service_date, tw.cadence_version_id,
    tw.window_key, tw.label, tw.shift_key, tw.due_at_utc, tw.window_opens_at_utc, tw.window_closes_at_utc
  FROM stamped_versions sv
  CROSS JOIN LATERAL public.facility_observation_windows_for_version(sv.fac_id, sv.cadence_version_id, sv.service_date) tw
),
candidate_windows AS (
  SELECT r.org_id, r.fac_id, r.res_id, r.the_date, dw.cadence_version_id, dw.window_key, dw.label,
    dw.shift_key, dw.due_at_utc, dw.window_opens_at_utc, dw.window_closes_at_utc, 1 AS priority
  FROM resolved r
  JOIN date_windows dw ON dw.fac_id = r.fac_id AND dw.the_date = r.the_date
  UNION ALL
  SELECT r.org_id, r.fac_id, r.res_id, r.the_date, vw.cadence_version_id, vw.window_key, vw.label,
    vw.shift_key, vw.due_at_utc, vw.window_opens_at_utc, vw.window_closes_at_utc, 0 AS priority
  FROM resolved r
  JOIN public.resident_observation_tasks stamped
    ON stamped.resident_id = r.res_id AND stamped.facility_id = r.fac_id AND stamped.service_date = r.the_date
    AND stamped.deleted_at IS NULL AND stamped.monitoring_order_id IS NULL
  JOIN version_windows vw
    ON vw.fac_id = r.fac_id AND vw.stamped_version_id = stamped.cadence_version_id
    AND vw.service_date = r.the_date AND vw.window_key = stamped.window_key
),
picked_windows AS (
  SELECT DISTINCT ON (c.org_id, c.fac_id, c.res_id, c.the_date, c.window_key) c.*
  FROM candidate_windows c
  ORDER BY c.org_id, c.fac_id, c.res_id, c.the_date, c.window_key, c.priority, c.due_at_utc
),
cadence_in_force AS MATERIALIZED (
  SELECT k.fac_id, k.due_at_utc, public.facility_cadence_in_force(k.fac_id, k.due_at_utc) AS version_id
  FROM (SELECT DISTINCT fac_id, due_at_utc FROM picked_windows WHERE due_at_utc IS NOT NULL) k
)
SELECT
  r.org_id,
  r.fac_id,
  r.res_id,
  r.the_date,
  w.window_key,
  w.label,
  w.shift_key,
  COALESCE(standard_task.cadence_version_id, w.cadence_version_id),
  standard_task.cadence_version_id,
  cif.version_id,
  CASE WHEN w.window_key IS NULL THEN
    NULL::boolean
  ELSE
    (standard_task.cadence_version_id IS NULL OR standard_task.cadence_version_id IS NOT DISTINCT FROM cif.version_id)
  END,
  (w.cadence_version_id IS NULL),
  w.due_at_utc,
  w.window_opens_at_utc,
  w.window_closes_at_utc,
  standard_task.id,
  standard_task.status::text,
  covering_order.id,
  satisfying_log.id,
  satisfying_log.observed_at,
  satisfying_log.monitoring_order_id,
  (satisfying_log.id IS NOT NULL),
  (covering_order.id IS NOT NULL
    AND satisfying_log.monitoring_order_id IS NOT NULL),
  CASE WHEN w.window_key IS NULL THEN
    'no_cadence'
  WHEN covering_order.id IS NOT NULL THEN
    'monitoring_order'
  WHEN standard_task.id IS NOT NULL THEN
    'standard_task'
  WHEN live_shift.shift_key IS NULL THEN
    'orphaned_shift'
  ELSE
    'projected_only'
  END
FROM
  resolved r
  LEFT JOIN picked_windows w
    ON w.org_id = r.org_id AND w.fac_id = r.fac_id AND w.res_id = r.res_id AND w.the_date = r.the_date
  LEFT JOIN cadence_in_force cif ON cif.fac_id = r.fac_id AND cif.due_at_utc = w.due_at_utc
  LEFT JOIN LATERAL (
    SELECT
      s.shift_key
    FROM
      public.facility_observation_shift_history s
    WHERE
      s.facility_id = r.fac_id
      AND s.shift_key = w.shift_key
      AND s.deleted_at IS NULL
      AND s.enabled AND s.effective_from<=w.due_at_utc AND (s.effective_to IS NULL OR s.effective_to>w.due_at_utc)) live_shift ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      t.id,
      t.status,
      t.cadence_version_id
    FROM
      public.resident_observation_tasks t
    WHERE
      t.resident_id = r.res_id
      AND t.facility_id = r.fac_id
      AND t.service_date = r.the_date
      AND t.window_key = w.window_key
      AND t.monitoring_order_id IS NULL
      AND t.deleted_at IS NULL
    ORDER BY
      (t.status = 'excused'),
      t.due_at
    LIMIT 1) standard_task ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      o.id
    FROM
      public.resident_monitoring_orders o
    WHERE
      o.resident_id = r.res_id
      AND o.facility_id = r.fac_id
      AND o.deleted_at IS NULL
      AND o.starts_at <= w.window_closes_at_utc
      AND haven.monitoring_order_in_force_until (o.status, o.ends_at, o.cancelled_at, o.closed_at) > w.window_opens_at_utc
    ORDER BY
      o.starts_at DESC
    LIMIT 1) covering_order ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      l.id,
      l.observed_at,
      lt.monitoring_order_id
    FROM
      public.resident_observation_logs l
      JOIN public.resident_observation_tasks lt ON lt.id = l.task_id
    WHERE
      l.resident_id = r.res_id
      AND l.facility_id = r.fac_id
      AND l.deleted_at IS NULL
      AND l.observed_at >= w.window_opens_at_utc
      AND l.observed_at <= w.window_closes_at_utc
    ORDER BY
      l.observed_at
    LIMIT 1) satisfying_log ON TRUE
  WHERE
    (EXISTS(SELECT 1 FROM public.resident_status_history h
      WHERE h.resident_id=r.res_id AND h.facility_id=r.fac_id AND h.status='active' AND h.deleted_at IS NULL
      AND (CASE WHEN w.due_at_utc IS NULL THEN
        h.effective_from < ((r.the_date+1)::timestamp AT TIME ZONE (SELECT tz FROM facility WHERE id=r.fac_id))
        AND (h.effective_to IS NULL OR h.effective_to > (r.the_date::timestamp AT TIME ZONE (SELECT tz FROM facility WHERE id=r.fac_id)))
      ELSE h.effective_from<=w.due_at_utc AND (h.effective_to IS NULL OR h.effective_to>w.due_at_utc) END))
     OR (NOT EXISTS(SELECT 1 FROM public.resident_status_history h WHERE h.resident_id=r.res_id AND h.deleted_at IS NULL)
         AND EXISTS(SELECT 1 FROM public.residents present WHERE present.id=r.res_id AND present.facility_id=r.fac_id AND present.status='active'))
     OR haven.observation_history_starts_after(r.res_id,r.fac_id,COALESCE(w.due_at_utc,(r.the_date::timestamp AT TIME ZONE (SELECT tz FROM facility WHERE id=r.fac_id)))))
    OR standard_task.id IS NOT NULL
    OR satisfying_log.id IS NOT NULL
    OR covering_order.id IS NOT NULL
  ORDER BY
    r.fac_id,
    r.the_date,
    r.res_id,
    w.due_at_utc NULLS FIRST;
END;
$func$;


NOTIFY pgrst, 'reload schema';

COMMIT;
