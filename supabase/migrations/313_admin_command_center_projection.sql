-- Navigation performance: collapse the Command Center's 30+ PostgREST calls
-- into one RLS-governed database projection. SECURITY INVOKER is deliberate:
-- every underlying table keeps enforcing its own tenant/facility policies.

CREATE OR REPLACE FUNCTION public.admin_command_center_projection(
  p_facility_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, haven
AS $function$
DECLARE
  v_organization_id uuid;
  v_payload jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  v_organization_id := haven.organization_id();
  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization missing on profile' USING ERRCODE = '42501';
  END IF;

  IF haven.app_role() NOT IN ('owner', 'org_admin', 'facility_admin', 'manager') THEN
    RAISE EXCEPTION 'Command Center access denied' USING ERRCODE = '42501';
  END IF;

  IF p_facility_id IS NOT NULL AND NOT haven.has_facility_access(p_facility_id) THEN
    RAISE EXCEPTION 'Facility access denied' USING ERRCODE = '42501';
  END IF;

  WITH
  scoped_facilities AS MATERIALIZED (
    SELECT f.id, f.name, f.total_licensed_beds, f.timezone
    FROM public.facilities f
    WHERE f.organization_id = v_organization_id
      AND f.deleted_at IS NULL
      AND (p_facility_id IS NULL OR f.id = p_facility_id)
  ),
  scoped_residents AS MATERIALIZED (
    SELECT
      r.id,
      r.first_name,
      r.last_name,
      r.facility_id,
      r.status,
      r.acuity_level,
      r.updated_at,
      r.date_of_birth
    FROM public.residents r
    WHERE r.organization_id = v_organization_id
      AND r.deleted_at IS NULL
      AND r.status IN ('active', 'hospital_hold', 'loa')
      AND (p_facility_id IS NULL OR r.facility_id = p_facility_id)
  ),
  residents_preview AS MATERIALIZED (
    SELECT
      r.*,
      bed.bed_label,
      bed.room_number
    FROM scoped_residents r
    LEFT JOIN LATERAL (
      SELECT b.bed_label, rm.room_number
      FROM public.beds b
      LEFT JOIN public.rooms rm ON rm.id = b.room_id AND rm.deleted_at IS NULL
      WHERE b.current_resident_id = r.id
        AND b.deleted_at IS NULL
      ORDER BY b.updated_at DESC NULLS LAST, b.id
      LIMIT 1
    ) bed ON true
    ORDER BY r.updated_at DESC
    LIMIT 8
  ),
  acuity_watchlist AS MATERIALIZED (
    SELECT
      r.*,
      bed.bed_label,
      bed.room_number
    FROM scoped_residents r
    LEFT JOIN LATERAL (
      SELECT b.bed_label, rm.room_number
      FROM public.beds b
      LEFT JOIN public.rooms rm ON rm.id = b.room_id AND rm.deleted_at IS NULL
      WHERE b.current_resident_id = r.id
        AND b.deleted_at IS NULL
      ORDER BY b.updated_at DESC NULLS LAST, b.id
      LIMIT 1
    ) bed ON true
    WHERE r.acuity_level IN ('level_2', 'level_3')
    ORDER BY r.acuity_level DESC, r.updated_at DESC
    LIMIT 4
  ),
  scoped_incidents AS MATERIALIZED (
    SELECT i.*
    FROM public.incidents i
    WHERE i.organization_id = v_organization_id
      AND i.deleted_at IS NULL
      AND (p_facility_id IS NULL OR i.facility_id = p_facility_id)
  ),
  incidents_feed AS MATERIALIZED (
    SELECT
      i.id,
      i.occurred_at,
      i.category,
      i.severity,
      i.status,
      i.resident_id,
      r.first_name AS resident_first_name,
      r.last_name AS resident_last_name
    FROM scoped_incidents i
    LEFT JOIN public.residents r ON r.id = i.resident_id AND r.deleted_at IS NULL
    ORDER BY i.occurred_at DESC
    LIMIT 6
  ),
  doctrine_docs AS MATERIALIZED (
    SELECT d.id, d.review_owner, d.review_due_at
    FROM public.documents d
    WHERE d.workspace_id = v_organization_id
      AND d.status = 'pending_review'
      AND d.deleted_at IS NULL
  ),
  doctrine_state AS MATERIALIZED (
    SELECT
      d.*,
      audit.latest_draft_at,
      audit.latest_review_at
    FROM doctrine_docs d
    LEFT JOIN LATERAL (
      SELECT
        max(e.created_at) FILTER (WHERE e.event_type = 'obsidian_draft_created') AS latest_draft_at,
        max(e.created_at) FILTER (WHERE e.event_type = 'review_completed') AS latest_review_at
      FROM public.document_audit_events e
      WHERE e.document_id = d.id
        AND e.event_type IN ('obsidian_draft_created', 'review_completed')
    ) audit ON true
  ),
  scoped_admissions AS MATERIALIZED (
    SELECT a.*
    FROM public.admission_cases a
    WHERE a.organization_id = v_organization_id
      AND a.deleted_at IS NULL
      AND a.status <> 'cancelled'
      AND (p_facility_id IS NULL OR a.facility_id = p_facility_id)
  ),
  admission_readiness AS MATERIALIZED (
    SELECT
      a.*,
      EXISTS (
        SELECT 1 FROM public.care_plans cp
        WHERE cp.resident_id = a.resident_id AND cp.deleted_at IS NULL
      ) AS has_care_plan,
      EXISTS (
        SELECT 1 FROM public.resident_medications rm
        WHERE rm.resident_id = a.resident_id AND rm.deleted_at IS NULL
      ) AS has_medication,
      EXISTS (
        SELECT 1 FROM public.resident_payers rp
        WHERE rp.resident_id = a.resident_id AND rp.deleted_at IS NULL
      ) AS has_payer,
      EXISTS (
        SELECT 1 FROM public.family_consent_records fc
        WHERE fc.resident_id = a.resident_id AND fc.deleted_at IS NULL
      ) AS has_consent
    FROM scoped_admissions a
  ),
  risk_candidates AS MATERIALIZED (
    SELECT s.resident_id, s.risk_tier, s.computed_at
    FROM public.resident_safety_scores s
    WHERE s.organization_id = v_organization_id
      AND s.deleted_at IS NULL
      AND (p_facility_id IS NULL OR s.facility_id = p_facility_id)
    ORDER BY s.computed_at DESC
    LIMIT 200
  ),
  latest_risk_scores AS MATERIALIZED (
    SELECT DISTINCT ON (r.resident_id)
      r.resident_id,
      r.risk_tier,
      r.computed_at
    FROM risk_candidates r
    ORDER BY r.resident_id, r.computed_at DESC
  ),
  command_counts AS (
    SELECT jsonb_build_object(
      'residentCount', (SELECT count(*) FROM scoped_residents),
      'awayResidentCount', (
        SELECT count(*) FROM scoped_residents r WHERE r.status IN ('hospital_hold', 'loa')
      ),
      'activeStaffCount', (
        SELECT count(*)
        FROM public.staff s
        WHERE s.organization_id = v_organization_id
          AND s.deleted_at IS NULL
          AND s.employment_status = 'active'
          AND (p_facility_id IS NULL OR s.facility_id = p_facility_id)
      ),
      'openIncidentAlerts', (
        SELECT count(*) FROM scoped_incidents i WHERE i.status IN ('open', 'investigating')
      ),
      'staffingGapSnapshots24h', (
        SELECT count(*)
        FROM public.staffing_ratio_snapshots s
        WHERE s.organization_id = v_organization_id
          AND s.is_compliant = false
          AND s.snapshot_at >= now() - interval '24 hours'
          AND (p_facility_id IS NULL OR s.facility_id = p_facility_id)
      ),
      'medicationErrorsUnreviewed', (
        SELECT count(*)
        FROM public.medication_errors m
        WHERE m.organization_id = v_organization_id
          AND m.deleted_at IS NULL
          AND m.reviewed_at IS NULL
          AND (p_facility_id IS NULL OR m.facility_id = p_facility_id)
      ),
      'expiringCertifications30d', (
        SELECT count(*)
        FROM public.staff_certifications c
        WHERE c.organization_id = v_organization_id
          AND c.deleted_at IS NULL
          AND c.status = 'active'
          AND c.expiration_date BETWEEN current_date AND current_date + 30
          AND (p_facility_id IS NULL OR c.facility_id = p_facility_id)
      )
    ) AS value
  ),
  workflow_counts AS (
    SELECT jsonb_build_object(
      'doctrinePendingReview', (SELECT count(*) FROM doctrine_state),
      'doctrineBlockedReview', (
        SELECT count(*)
        FROM doctrine_state d
        WHERE d.review_owner IS NULL
          OR d.review_due_at IS NULL
          OR d.latest_draft_at IS NULL
          OR d.latest_review_at IS NULL
          OR d.latest_review_at < d.latest_draft_at
      ),
      'doctrineReadyToPublish', (
        SELECT count(*)
        FROM doctrine_state d
        WHERE d.review_owner IS NOT NULL
          AND d.review_due_at IS NOT NULL
          AND d.latest_draft_at IS NOT NULL
          AND d.latest_review_at IS NOT NULL
          AND d.latest_review_at >= d.latest_draft_at
      ),
      'doctrineDueSoon', (
        SELECT count(*) FROM doctrine_state d
        WHERE d.review_due_at::date BETWEEN current_date AND current_date + 3
      ),
      'doctrineOverdue', (
        SELECT count(*) FROM doctrine_state d WHERE d.review_due_at::date < current_date
      ),
      'incidentOverdueFollowups', (
        SELECT count(*)
        FROM public.incident_followups f
        WHERE f.organization_id = v_organization_id
          AND f.deleted_at IS NULL
          AND f.completed_at IS NULL
          AND f.due_at < now()
          AND (p_facility_id IS NULL OR f.facility_id = p_facility_id)
      ),
      'incidentUnassignedFollowups', (
        SELECT count(*)
        FROM public.incident_followups f
        WHERE f.organization_id = v_organization_id
          AND f.deleted_at IS NULL
          AND f.completed_at IS NULL
          AND f.assigned_to IS NULL
          AND (p_facility_id IS NULL OR f.facility_id = p_facility_id)
      ),
      'incidentEscalatedFollowups', (
        SELECT count(*)
        FROM public.incident_followups f
        WHERE f.organization_id = v_organization_id
          AND f.deleted_at IS NULL
          AND f.completed_at IS NULL
          AND f.due_at < now() - interval '48 hours'
          AND (p_facility_id IS NULL OR f.facility_id = p_facility_id)
      ),
      'incidentOpenObligations', (
        SELECT count(*)
        FROM scoped_incidents i
        WHERE i.status IN ('open', 'investigating', 'resolved')
          AND (
            NOT coalesce(i.nurse_notified, false)
            OR NOT coalesce(i.administrator_notified, false)
            OR (
              i.severity IN ('level_3', 'level_4')
              AND (
                NOT coalesce(i.owner_notified, false)
                OR NOT coalesce(i.physician_notified, false)
                OR NOT coalesce(i.family_notified, false)
              )
            )
            OR (coalesce(i.ahca_reportable, false) AND NOT coalesce(i.ahca_reported, false))
            OR (coalesce(i.insurance_reportable, false) AND NOT coalesce(i.insurance_reported, false))
          )
      ),
      'incidentRootCausePending', (
        SELECT count(*)
        FROM scoped_incidents i
        WHERE i.status IN ('open', 'investigating', 'resolved')
          AND i.severity IN ('level_3', 'level_4')
          AND NOT EXISTS (
            SELECT 1 FROM public.incident_rca r
            WHERE r.incident_id = i.id AND r.investigation_status = 'complete'
          )
      ),
      'incidentCarePlanPending', (
        SELECT count(*)
        FROM scoped_incidents i
        WHERE i.status IN ('open', 'investigating', 'resolved')
          AND i.resolved_at IS NOT NULL
          AND NOT coalesce(i.care_plan_updated, false)
          AND i.severity IN ('level_3', 'level_4')
      ),
      'admissionsBlocked', (
        SELECT count(*) FROM admission_readiness a
        WHERE a.financial_clearance_at IS NULL
          OR a.physician_orders_received_at IS NULL
          OR a.bed_id IS NULL
          OR a.target_move_in_date IS NULL
      ),
      'admissionsMoveInReady', (
        SELECT count(*) FROM admission_readiness a
        WHERE a.financial_clearance_at IS NOT NULL
          AND a.physician_orders_received_at IS NOT NULL
          AND a.bed_id IS NOT NULL
          AND a.target_move_in_date IS NOT NULL
      ),
      'admissionsOnboardingPending', (
        SELECT count(*) FROM admission_readiness a
        WHERE a.status = 'move_in'
          AND NOT (a.has_care_plan AND a.has_medication AND a.has_payer AND a.has_consent)
      ),
      'referralsInAdmissions', (
        SELECT count(*) FROM admission_readiness a WHERE a.referral_lead_id IS NOT NULL
      ),
      'referralsBlockedHandoffs', (
        SELECT count(*) FROM admission_readiness a
        WHERE a.referral_lead_id IS NOT NULL
          AND (
            a.financial_clearance_at IS NULL
            OR a.physician_orders_received_at IS NULL
            OR a.bed_id IS NULL
            OR a.target_move_in_date IS NULL
          )
      ),
      'referralsReadyHandoffs', (
        SELECT count(*) FROM admission_readiness a
        WHERE a.referral_lead_id IS NOT NULL
          AND a.status <> 'move_in'
          AND a.financial_clearance_at IS NOT NULL
          AND a.physician_orders_received_at IS NOT NULL
          AND a.bed_id IS NOT NULL
          AND a.target_move_in_date IS NOT NULL
      ),
      'referralsOnboardingHandoffs', (
        SELECT count(*) FROM admission_readiness a
        WHERE a.referral_lead_id IS NOT NULL
          AND a.status = 'move_in'
          AND a.financial_clearance_at IS NOT NULL
          AND a.physician_orders_received_at IS NOT NULL
          AND a.bed_id IS NOT NULL
          AND a.target_move_in_date IS NOT NULL
          AND NOT (a.has_care_plan AND a.has_medication AND a.has_payer AND a.has_consent)
      ),
      'dischargePlanning', (
        SELECT count(*)
        FROM public.discharge_med_reconciliation d
        JOIN public.residents r ON r.id = d.resident_id
        WHERE d.organization_id = v_organization_id
          AND d.deleted_at IS NULL
          AND d.status NOT IN ('complete', 'cancelled')
          AND (
            r.discharge_target_date IS NULL
            OR r.hospice_status = 'pending'
            OR nullif(trim(d.nurse_reconciliation_notes), '') IS NULL
          )
          AND (p_facility_id IS NULL OR d.facility_id = p_facility_id)
      ),
      'dischargePharmacistReview', (
        SELECT count(*)
        FROM public.discharge_med_reconciliation d
        JOIN public.residents r ON r.id = d.resident_id
        WHERE d.organization_id = v_organization_id
          AND d.deleted_at IS NULL
          AND d.status NOT IN ('complete', 'cancelled')
          AND r.discharge_target_date IS NOT NULL
          AND r.hospice_status <> 'pending'
          AND nullif(trim(d.nurse_reconciliation_notes), '') IS NOT NULL
          AND (
            d.status = 'draft'
            OR nullif(trim(d.pharmacist_npi), '') IS NULL
            OR nullif(trim(d.pharmacist_notes), '') IS NULL
          )
          AND (p_facility_id IS NULL OR d.facility_id = p_facility_id)
      ),
      'dischargeReadyToComplete', (
        SELECT count(*)
        FROM public.discharge_med_reconciliation d
        JOIN public.residents r ON r.id = d.resident_id
        WHERE d.organization_id = v_organization_id
          AND d.deleted_at IS NULL
          AND d.status NOT IN ('complete', 'cancelled', 'draft')
          AND r.discharge_target_date IS NOT NULL
          AND r.hospice_status <> 'pending'
          AND nullif(trim(d.nurse_reconciliation_notes), '') IS NOT NULL
          AND nullif(trim(d.pharmacist_npi), '') IS NOT NULL
          AND nullif(trim(d.pharmacist_notes), '') IS NOT NULL
          AND (p_facility_id IS NULL OR d.facility_id = p_facility_id)
      ),
      'familyTriagePending', (
        SELECT count(*)
        FROM public.family_message_triage_items f
        WHERE f.organization_id = v_organization_id
          AND f.deleted_at IS NULL
          AND f.triage_status IN ('pending_review', 'in_review')
          AND (p_facility_id IS NULL OR f.facility_id = p_facility_id)
      ),
      'familyConferencesUpcoming', (
        SELECT count(*)
        FROM public.family_care_conference_sessions f
        WHERE f.organization_id = v_organization_id
          AND f.deleted_at IS NULL
          AND f.scheduled_start >= now()
          AND (p_facility_id IS NULL OR f.facility_id = p_facility_id)
      )
    ) AS value
  ),
  assurance_counts AS (
    SELECT jsonb_build_object(
      'activeWatches', (
        SELECT count(*) FROM public.resident_watch_instances w
        WHERE w.organization_id = v_organization_id
          AND w.deleted_at IS NULL
          AND w.status = 'active'
          AND (p_facility_id IS NULL OR w.facility_id = p_facility_id)
      ),
      'pendingWatchApprovals', (
        SELECT count(*) FROM public.resident_watch_instances w
        WHERE w.organization_id = v_organization_id
          AND w.deleted_at IS NULL
          AND w.status = 'pending_approval'
          AND (p_facility_id IS NULL OR w.facility_id = p_facility_id)
      ),
      'openEscalations', (
        SELECT count(*) FROM public.resident_observation_escalations e
        WHERE e.organization_id = v_organization_id
          AND e.deleted_at IS NULL
          AND e.status IN ('open', 'in_progress')
          AND (p_facility_id IS NULL OR e.facility_id = p_facility_id)
      ),
      'openIntegrityFlags', (
        SELECT count(*) FROM public.resident_observation_integrity_flags f
        WHERE f.organization_id = v_organization_id
          AND f.deleted_at IS NULL
          AND f.status IN ('open', 'in_progress')
          AND (p_facility_id IS NULL OR f.facility_id = p_facility_id)
      ),
      'criticalSafetyResidents', (
        SELECT count(*) FROM latest_risk_scores s WHERE s.risk_tier = 'critical'
      ),
      'highOrCriticalSafetyResidents', (
        SELECT count(*) FROM latest_risk_scores s WHERE s.risk_tier IN ('high', 'critical')
      )
    ) AS value
  )
  SELECT jsonb_build_object(
    'headlineName', CASE
      WHEN p_facility_id IS NOT NULL THEN coalesce((SELECT f.name FROM scoped_facilities f LIMIT 1), 'Facility')
      ELSE 'All facilities'
    END,
    'timezoneLabel', coalesce((SELECT f.timezone FROM scoped_facilities f ORDER BY f.name LIMIT 1), 'America/New_York'),
    'licensedBeds', nullif((SELECT coalesce(sum(f.total_licensed_beds), 0) FROM scoped_facilities f), 0),
    'counts', (SELECT c.value FROM command_counts c),
    'workflowQueues', (SELECT w.value FROM workflow_counts w),
    'residentAssurance', (SELECT a.value FROM assurance_counts a),
    'censusPreview', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.updated_at DESC) FROM residents_preview r
    ), '[]'::jsonb),
    'acuityWatchlist', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.acuity_level DESC, r.updated_at DESC) FROM acuity_watchlist r
    ), '[]'::jsonb),
    'activity', coalesce((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.occurred_at DESC) FROM incidents_feed i
    ), '[]'::jsonb)
  ) INTO v_payload;

  RETURN v_payload;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_command_center_projection(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_command_center_projection(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_command_center_projection(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_command_center_projection(uuid) IS
  'RLS-governed Command Center read projection. Returns only the caller organization and accessible facility scope.';

CREATE INDEX IF NOT EXISTS idx_documents_command_center_review
  ON public.documents (workspace_id, status, review_due_at)
  WHERE deleted_at IS NULL AND status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_medication_errors_command_center_unreviewed
  ON public.medication_errors (organization_id, facility_id)
  WHERE deleted_at IS NULL AND reviewed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_certifications_command_center_expiry
  ON public.staff_certifications (organization_id, facility_id, expiration_date)
  WHERE deleted_at IS NULL AND status = 'active' AND expiration_date IS NOT NULL;
