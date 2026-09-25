-- COL-749 rulings 3 and 4 (COL-754): the Thursday report carries the census
-- bridge, and recruiters read the non-clinical admission workflow.
--
-- Ruling 3: the bridge (migration 542) sits at the top of each building's
-- section. The report now returns it per facility ('bridge', counts only), so
-- the screen, the entry form and the printout show the same figures.
--
-- Ruling 4 (Brian, 2026-09-25): "Recruiters see all admission notes" on the
-- Thursday report; "they are working with the admins to get them pushed through
-- and in the building." Any clinical category is listed and sent to the lead
-- before it opens. Inventory of what an admission exposes, and where each
-- category lands:
--
--   Opened to recruiters (non-clinical admission workflow), behind
--   stand_up.thursday_admission_workflow_to_recruiters (542, default on):
--     * workflow_events for the lead or its admission case: admission started,
--       status changed (from and to), move-in blocked (the names of what is
--       missing, e.g. "quoted rate terms", "Form 1823"), Form 1823 received (that
--       it was received; not its dates or content), referral converted.
--     * admission_case_rate_terms.notes, with the accommodation quoted (private
--       or semi-private). Not the care surcharge, which reflects a care level.
--     * admission_document_checklist_items notes and waiver reasons for the
--       non-clinical documents only: face sheet, photo ID, insurance and
--       financial cards, admission agreement, financial agreement, pet addendum,
--       privacy practices, resident bill of rights.
--   Already shown to recruiters (unchanged): the case's stage, Form 1823 status
--   (a status only), financial clearance date, the date physician orders were
--   received (a date only), bed, target move-in and Medicaid stage.
--
--   Held back (clinical, or free text that invites clinical content), still
--   administrators only, for Brian to rule on:
--     * admission_cases.notes: free text the admission form invites as "Reason
--       for admission, payer details, family preferences". Stays behind
--       stand_up.thursday_admission_notes_to_recruiters, which stays off.
--     * admission_cases.physician_orders_summary (physician orders content).
--       Never on the report.
--     * form_1823_records medical content (medical history, allergies,
--       physical limitations, cognitive and behavioral status, service needs,
--       precautions, elopement risk, ADLs, diet, medication assistance,
--       communicable disease, bedridden, pressure injury, TB and special
--       precautions, height and weight, ALF appropriateness, examiner). Never
--       on the report.
--     * admission_document_checklist_items notes and waiver reasons for the
--       clinical documents (Form 1823, resident assessment, care plan
--       acknowledgment, medication list, advance directives, TB screening,
--       dietary evaluation, physician orders, acknowledgment of risk, catheter
--       care); even the presence of some of these (catheter care) is clinical.
--     * Arrival approval and reversal reasons and the approval's readiness
--       snapshot (free text and Form 1823 state). Not on the report.
--
-- Recruiter scope is unchanged: the report reads only facilities the caller
-- can access (haven.has_facility_access), and recruiter row-level access to
-- leads, referrals and admission tables is not widened.
--
-- The function below is migration 536's haven.stand_up_thursday_facility with
-- the three timeline sources, the admission_workflow switch and the bridge added.
BEGIN;

CREATE OR REPLACE FUNCTION haven.stand_up_thursday_facility(p_organization uuid, p_facility uuid, p_week date, p_day text, p_role text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  monday jsonb; since timestamptz; now_at timestamptz := clock_timestamp(); fname text;
  people boolean := p_role IN ('owner','org_admin','facility_admin','manager','admin_assistant');
  -- COL-754: recruiters read admission notes only where the facility turns it on.
  admission_notes boolean := p_role IN ('owner','org_admin','facility_admin','manager','admin_assistant')
    OR (p_role = 'recruiter' AND coalesce((SELECT o.value FROM public.haven_operating_rule(p_organization, p_facility,
      'stand_up.thursday_admission_notes_to_recruiters', (clock_timestamp() AT TIME ZONE 'America/New_York')::date) o) = 'true'::jsonb, false));
  work_notes boolean := p_role IN ('owner','org_admin','facility_admin','manager','admin_assistant','recruiter');
  -- COL-749 ruling 4: the non-clinical admission workflow (status steps,
  -- blocks, quoted-rate notes and non-clinical checklist notes) goes to
  -- recruiters where stand_up.thursday_admission_workflow_to_recruiters is on
  -- (default on). Clinical categories stay behind admission_notes above.
  admission_workflow boolean := p_role IN ('owner','org_admin','facility_admin','manager','admin_assistant')
    OR (p_role = 'recruiter' AND coalesce((SELECT o.value FROM public.haven_operating_rule(p_organization, p_facility,
      'stand_up.thursday_admission_workflow_to_recruiters', (clock_timestamp() AT TIME ZONE 'America/New_York')::date) o) = 'true'::jsonb, false));
  -- Checklist documents whose status and notes are not clinical. Every other
  -- document type (Form 1823, assessment, care plan, medication list, advance
  -- directives, TB screening, dietary evaluation, physician orders,
  -- acknowledgment of risk, catheter care) can carry or reveal clinical
  -- content, so it stays off the report entirely: this is a privacy boundary,
  -- not a business setting, and no facility setting widens it.
  nonclinical_documents text[] := ARRAY['facesheet_demographics','photo_identification','insurance_financial_cards','admission_agreement',
    'financial_agreement','pet_addendum','privacy_practices_hipaa','resident_bill_of_rights'];
  roster record; split record; ar bigint; has_invoices boolean; departures integer;
  figures jsonb; departure_rows jsonb; out_now jsonb; went_out jsonb; came_back jsonb; leads jsonb; recruiters jsonb;
BEGIN
  SELECT f.name INTO fname FROM public.facilities f WHERE f.id=p_facility AND f.organization_id=p_organization AND f.deleted_at IS NULL;
  IF fname IS NULL THEN RETURN NULL; END IF;
  -- "Since Monday" is Monday's call for the same week.
  monday := haven.stand_up_meeting_times(p_organization, p_facility, 'monday', p_week);
  since := coalesce((monday->>'call_at')::timestamptz, p_week::timestamp AT TIME ZONE 'America/New_York');

  -- 1. Facility figures for Thursday.
  SELECT EXISTS(SELECT 1 FROM public.invoices i WHERE i.organization_id=p_organization AND i.facility_id=p_facility AND i.deleted_at IS NULL) INTO has_invoices;
  SELECT coalesce(sum(greatest(i.balance_due,0)),0) INTO ar FROM public.invoices i
   WHERE i.organization_id=p_organization AND i.facility_id=p_facility AND i.deleted_at IS NULL AND i.status IN ('draft','sent','partial','overdue');
  SELECT * INTO roster FROM public.stand_up_roster_census(p_organization, p_facility);
  SELECT * INTO split FROM public.stand_up_bed_hold_split(p_organization, p_facility, NULL);
  SELECT count(*) INTO departures FROM public.resident_status_history h
   JOIN public.residents r ON r.id=h.resident_id AND r.deleted_at IS NULL
   WHERE h.organization_id=p_organization AND h.facility_id=p_facility AND h.deleted_at IS NULL
     AND h.status IN ('discharged','deceased') AND h.effective_from>=since AND h.effective_from<=now_at
     AND (h.effective_to IS NULL OR h.effective_to>h.effective_from);
  figures := jsonb_build_object(
   'current_ar_cents', CASE WHEN has_invoices THEN jsonb_build_object('value',ar,'source','Invoices in Haven: sent with a balance, plus drafts not yet sent')
     ELSE jsonb_build_object('value',NULL,'source',NULL,'note','Haven has no invoices for this facility') END,
   'current_total_census', CASE WHEN roster.resident_count_in_haven>0 THEN jsonb_build_object('value',roster.roster_census_count,'source','Resident roster: in house, at hospital or rehab, and on leave')
     ELSE jsonb_build_object('value',NULL,'source',NULL,'note','No residents in Haven for this facility') END,
   'hospital_and_rehab_total', CASE WHEN roster.resident_count_in_haven>0 THEN jsonb_build_object('value',roster.hospital_hold_count,'source','Resident roster: bed-hold stays at a hospital or in rehab')
     ELSE jsonb_build_object('value',NULL,'source',NULL,'note','No residents in Haven for this facility') END,
   'hospital_total', CASE WHEN roster.resident_count_in_haven>0 THEN jsonb_build_object('value',split.hospital_count,'source','Resident roster: stays recorded as hospital',
       'note',CASE WHEN split.type_not_recorded_count>0 THEN split.type_not_recorded_count||' stay(s) have no hospital or rehab recorded and are in the total only' END)
     ELSE jsonb_build_object('value',NULL,'source',NULL,'note','No residents in Haven for this facility') END,
   'rehab_total', CASE WHEN roster.resident_count_in_haven>0 THEN jsonb_build_object('value',split.rehab_count,'source','Resident roster: stays recorded as rehab',
       'note',CASE WHEN split.type_not_recorded_count>0 THEN split.type_not_recorded_count||' stay(s) have no hospital or rehab recorded and are in the total only' END)
     ELSE jsonb_build_object('value',NULL,'source',NULL,'note','No residents in Haven for this facility') END,
   'departures_since_monday', CASE WHEN roster.resident_count_in_haven>0 THEN jsonb_build_object('value',departures,'source','Discharges and deaths dated since Monday''s call')
     ELSE jsonb_build_object('value',NULL,'source',NULL,'note','No residents in Haven for this facility') END);

  -- 2. Who left, and who is or was at hospital or rehab. Names only for roster readers.
  SELECT coalesce(jsonb_agg(jsonb_build_object('resident', CASE WHEN people THEN btrim(r.first_name||' '||r.last_name) END,
     'kind', h.status, 'at', h.effective_from, 'recorded_at', h.created_at, 'new', h.created_at>=since) ORDER BY h.effective_from), '[]'::jsonb)
   INTO departure_rows
   FROM public.resident_status_history h JOIN public.residents r ON r.id=h.resident_id AND r.deleted_at IS NULL
   WHERE h.organization_id=p_organization AND h.facility_id=p_facility AND h.deleted_at IS NULL
     AND h.status IN ('discharged','deceased') AND h.effective_from>=since AND h.effective_from<=now_at
     AND (h.effective_to IS NULL OR h.effective_to>h.effective_from);
  SELECT coalesce(jsonb_agg(jsonb_build_object('resident', CASE WHEN people THEN btrim(r.first_name||' '||r.last_name) END,
     'stay_type', r.bed_hold_stay_type, 'since', coalesce(r.status_effective_at, h.effective_from)) ORDER BY coalesce(r.status_effective_at, h.effective_from)), '[]'::jsonb)
   INTO out_now
   FROM public.residents r
   LEFT JOIN public.resident_status_history h ON h.resident_id=r.id AND h.deleted_at IS NULL AND h.effective_to IS NULL
   WHERE r.organization_id=p_organization AND r.facility_id=p_facility AND r.deleted_at IS NULL AND r.status='hospital_hold';
  SELECT coalesce(jsonb_agg(jsonb_build_object('resident', CASE WHEN people THEN btrim(r.first_name||' '||r.last_name) END,
     'stay_type', h.bed_hold_stay_type, 'at', h.effective_from, 'back_at', h.effective_to) ORDER BY h.effective_from), '[]'::jsonb)
   INTO went_out
   FROM public.resident_status_history h JOIN public.residents r ON r.id=h.resident_id AND r.deleted_at IS NULL
   WHERE h.organization_id=p_organization AND h.facility_id=p_facility AND h.deleted_at IS NULL
     AND h.status='hospital_hold' AND h.effective_from>=since AND h.effective_from<=now_at
     -- A hospital-to-rehab move is the same trip, not a second one out.
     AND NOT EXISTS(SELECT 1 FROM public.resident_status_history p WHERE p.resident_id=h.resident_id AND p.deleted_at IS NULL
       AND p.status='hospital_hold' AND p.effective_to=h.effective_from);
  SELECT coalesce(jsonb_agg(jsonb_build_object('resident', CASE WHEN people THEN btrim(r.first_name||' '||r.last_name) END,
     'stay_type', h.bed_hold_stay_type, 'back_at', h.effective_to) ORDER BY h.effective_to), '[]'::jsonb)
   INTO came_back
   FROM public.resident_status_history h JOIN public.residents r ON r.id=h.resident_id AND r.deleted_at IS NULL
   JOIN public.resident_status_history nx ON nx.resident_id=h.resident_id AND nx.deleted_at IS NULL AND nx.effective_from=h.effective_to AND nx.status='active'
   WHERE h.organization_id=p_organization AND h.facility_id=p_facility AND h.deleted_at IS NULL
     AND h.status='hospital_hold' AND h.effective_to>=since AND h.effective_to<=now_at;

  -- 3. Potential residents: every open referral for this facility.
  SELECT coalesce(jsonb_agg(x.lead ORDER BY x.sort_at DESC), '[]'::jsonb) INTO leads FROM (
   SELECT coalesce(l.next_action_at, l.updated_at) AS sort_at, jsonb_build_object(
    'lead_id', l.id, 'name', btrim(l.first_name||' '||l.last_name), 'stage', l.status, 'work_state', l.work_state,
    'owner_name', (SELECT nullif(btrim(p.full_name),'') FROM public.user_profiles p WHERE p.id=l.owner_user_id AND p.organization_id=l.organization_id),
    'next_action', l.next_action, 'next_action_at', l.next_action_at,
    'created_at', l.created_at, 'new', l.created_at>=since,
    'tours', coalesce((SELECT jsonb_agg(jsonb_build_object('scheduled_for', t.scheduled_for, 'outcome', t.outcome, 'completed_at', t.completed_at,
        'owner_name', (SELECT nullif(btrim(p.full_name),'') FROM public.user_profiles p WHERE p.id=t.owner_user_id AND p.organization_id=l.organization_id),
        'new', greatest(t.created_at, coalesce(t.outcome_recorded_at, t.created_at))>=since) ORDER BY t.scheduled_for NULLS LAST, t.created_at)
      FROM public.referral_tours t WHERE t.referral_lead_id=l.id AND t.deleted_at IS NULL AND t.outcome<>'rescheduled'), '[]'::jsonb),
    'admission', (SELECT jsonb_build_object('status', a.status, 'target_move_in_date', a.target_move_in_date,
        'financial_clearance_at', a.financial_clearance_at, 'physician_orders_received_at', a.physician_orders_received_at,
        'medicaid_pipeline_stage', a.medicaid_pipeline_stage,
        'bed_label', (SELECT coalesce(rm.room_number||'-','')||b.bed_label FROM public.beds b LEFT JOIN public.rooms rm ON rm.id=b.room_id WHERE b.id=a.bed_id),
        'form_1823_status', (SELECT fr.status FROM public.form_1823_records fr WHERE fr.resident_id=a.resident_id AND fr.deleted_at IS NULL
           ORDER BY (fr.admission_case_id=a.id) DESC, fr.updated_at DESC LIMIT 1))
      FROM public.admission_cases a WHERE a.referral_lead_id=l.id AND a.deleted_at IS NULL AND a.status::text NOT IN ('cancelled')
      ORDER BY a.created_at DESC LIMIT 1),
    'notes_withheld', NOT work_notes OR l.pii_access_tier='public_summary',
    'timeline', coalesce((SELECT jsonb_agg(e.item ORDER BY e.at, e.seq) FROM (
       -- Logged contacts, next steps and tour results, from the lead's history.
       SELECT coalesce(ev.effective_at, ev.effective_date::timestamp AT TIME ZONE 'America/New_York', ev.recorded_at) AS at, ev.event_seq AS seq,
         jsonb_build_object('at', coalesce(ev.effective_at, ev.effective_date::timestamp AT TIME ZONE 'America/New_York', ev.recorded_at),
           'recorded_at', ev.recorded_at, 'new', ev.recorded_at>=since,
           'kind', CASE ev.event_kind WHEN 'interaction_recorded' THEN 'contact' WHEN 'next_action_set' THEN 'next_step' WHEN 'tour_recorded' THEN 'tour' ELSE 'status' END,
           'by', (SELECT nullif(btrim(p.full_name),'') FROM public.user_profiles p WHERE p.id=ev.actor_id AND p.organization_id=l.organization_id),
           'method', ev.details->>'method', 'with', ev.details->>'contacted_name',
           'text', CASE WHEN NOT work_notes OR l.pii_access_tier='public_summary' THEN NULL
             WHEN ev.event_kind='interaction_recorded' THEN ev.details->>'summary'
             WHEN ev.event_kind='next_action_set' THEN ev.details->>'next_action'
             WHEN ev.event_kind='tour_recorded' THEN ev.details->>'feedback_note'
             ELSE NULL END,
           'status', CASE WHEN ev.event_kind='tour_recorded' THEN ev.details->>'outcome' ELSE ev.to_status::text END) AS item
       FROM public.referral_episode_events ev
       WHERE ev.referral_lead_id=l.id AND ev.event_kind IN ('interaction_recorded','next_action_set','tour_recorded','closed','reopened','admission_transition','captured')
       UNION ALL
       -- The lead's own notes, as last saved.
       SELECT l.updated_at, 0, jsonb_build_object('at', l.updated_at, 'recorded_at', l.updated_at, 'new', l.updated_at>=since, 'kind', 'lead_note', 'by', NULL, 'method', NULL, 'with', NULL,
           'text', l.notes, 'status', NULL::text)
       WHERE work_notes AND l.pii_access_tier<>'public_summary' AND nullif(btrim(coalesce(l.notes,'')),'') IS NOT NULL
       UNION ALL
       -- The admission's notes, as last saved: only for roles that read admission cases.
       SELECT a.updated_at, 0, jsonb_build_object('at', a.updated_at, 'recorded_at', a.updated_at, 'new', a.updated_at>=since, 'kind', 'admission_note', 'by', NULL, 'method', NULL, 'with', NULL,
           'text', a.notes, 'status', NULL::text)
       FROM public.admission_cases a
       WHERE admission_notes AND a.referral_lead_id=l.id AND a.deleted_at IS NULL AND nullif(btrim(coalesce(a.notes,'')),'') IS NOT NULL
       UNION ALL
       -- COL-749: the admission's workflow steps. Names and statuses only: the
       -- Form 1823 step says it was received, never what it says.
       SELECT we.created_at, 0, jsonb_build_object('at', we.created_at, 'recorded_at', we.created_at, 'new', we.created_at>=since, 'kind', 'admission_step',
           'by', (SELECT nullif(btrim(p.full_name),'') FROM public.user_profiles p WHERE p.id=we.created_by AND p.organization_id=l.organization_id),
           'method', we.event_type::text,
           'with', CASE WHEN we.event_type::text='admission_status_changed' THEN we.payload_json->>'from_status' END,
           'text', CASE WHEN we.event_type::text='admission_move_in_blocked' AND jsonb_typeof(we.payload_json->'blocked_by')='array'
             THEN (SELECT string_agg(b #>> '{}', ', ') FROM jsonb_array_elements(we.payload_json->'blocked_by') b) END,
           'status', CASE WHEN we.event_type::text='admission_status_changed' THEN we.payload_json->>'to_status' END)
       FROM public.workflow_events we
       WHERE admission_workflow AND we.organization_id=l.organization_id AND we.deleted_at IS NULL
         AND we.event_type::text IN ('referral_admission_started','admission_status_changed','admission_move_in_blocked','form_1823_received','referral_converted')
         AND (we.referral_lead_id=l.id OR we.admission_case_id IN (SELECT a.id FROM public.admission_cases a WHERE a.referral_lead_id=l.id AND a.deleted_at IS NULL))
       UNION ALL
       -- The quoted rate's notes (accommodation and notes; no clinical level).
       SELECT t.created_at, 0, jsonb_build_object('at', t.created_at, 'recorded_at', t.created_at, 'new', t.created_at>=since, 'kind', 'rate_note',
           'by', NULL, 'method', NULL, 'with', NULL, 'text', t.notes, 'status', t.accommodation_type::text)
       FROM public.admission_case_rate_terms t JOIN public.admission_cases a ON a.id=t.admission_case_id
       WHERE admission_workflow AND a.referral_lead_id=l.id AND a.deleted_at IS NULL AND nullif(btrim(coalesce(t.notes,'')),'') IS NOT NULL
       UNION ALL
       -- Non-clinical checklist documents' notes and waivers.
       SELECT c.updated_at, 0, jsonb_build_object('at', c.updated_at, 'recorded_at', c.updated_at, 'new', c.updated_at>=since, 'kind', 'checklist_note',
           'by', NULL, 'method', CASE WHEN c.received_at IS NOT NULL THEN 'received' WHEN nullif(btrim(coalesce(c.waived_reason,'')),'') IS NOT NULL THEN 'waived' ELSE 'outstanding' END,
           'with', NULL, 'text', concat_ws(' · ', nullif(btrim(coalesce(c.notes,'')),''), CASE WHEN nullif(btrim(coalesce(c.waived_reason,'')),'') IS NOT NULL THEN 'Waived: '||btrim(c.waived_reason) END),
           'status', c.document_type::text)
       FROM public.admission_document_checklist_items c JOIN public.admission_cases a ON a.id=c.admission_case_id
       WHERE admission_workflow AND a.referral_lead_id=l.id AND a.deleted_at IS NULL AND c.deleted_at IS NULL
         AND c.document_type::text = ANY (nonclinical_documents)
         AND (nullif(btrim(coalesce(c.notes,'')),'') IS NOT NULL OR nullif(btrim(coalesce(c.waived_reason,'')),'') IS NOT NULL)
       ORDER BY 1 DESC LIMIT 200
      ) e), '[]'::jsonb)
   ) AS lead
   FROM public.referral_leads l
   WHERE l.organization_id=p_organization AND l.facility_id=p_facility AND l.deleted_at IS NULL
     AND l.status NOT IN ('converted','lost','merged')
  ) x;

  -- 4. Each recruiter's activity at this facility since Monday's call.
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', coalesce(nullif(btrim(p.full_name),''), 'Recruiter'),
     'contacts', (SELECT count(*) FROM public.referral_episode_events ev WHERE ev.facility_id=p_facility AND ev.actor_id=p.id AND ev.event_kind='interaction_recorded' AND ev.recorded_at>=since),
     'tours', (SELECT count(*) FROM public.referral_episode_events ev WHERE ev.facility_id=p_facility AND ev.actor_id=p.id AND ev.event_kind='tour_recorded' AND ev.recorded_at>=since),
     'outreach', (SELECT count(*) FROM public.referral_outreach_activities o WHERE o.facility_id=p_facility AND o.organization_id=p_organization AND o.deleted_at IS NULL
        AND o.status<>'cancelled' AND o.owner_user_id=p.id AND (o.created_at>=since OR o.performed_for_week=p_week OR (o.scheduled_for>=since AND o.scheduled_for<=now_at))),
     'items', coalesce((SELECT jsonb_agg(i.item ORDER BY i.at) FROM (
        SELECT ev.recorded_at AS at, jsonb_build_object('at', ev.recorded_at,
          'kind', CASE ev.event_kind WHEN 'interaction_recorded' THEN 'contact' ELSE 'tour' END,
          'lead_name', btrim(l.first_name||' '||l.last_name), 'method', ev.details->>'method',
          'text', CASE WHEN NOT work_notes OR l.pii_access_tier='public_summary' THEN NULL
             WHEN ev.event_kind='interaction_recorded' THEN ev.details->>'summary' ELSE ev.details->>'feedback_note' END,
          'status', CASE WHEN ev.event_kind='tour_recorded' THEN ev.details->>'outcome' END) AS item
        FROM public.referral_episode_events ev JOIN public.referral_leads l ON l.id=ev.referral_lead_id
        WHERE ev.facility_id=p_facility AND ev.actor_id=p.id AND ev.event_kind IN ('interaction_recorded','tour_recorded') AND ev.recorded_at>=since
        UNION ALL
        SELECT coalesce(o.scheduled_for, o.created_at), jsonb_build_object('at', coalesce(o.scheduled_for, o.created_at), 'kind', 'outreach',
          'lead_name', coalesce(o.external_partner_name, ''), 'method', o.activity_type::text, 'text', CASE WHEN work_notes THEN o.notes END, 'status', o.status::text)
        FROM public.referral_outreach_activities o WHERE o.facility_id=p_facility AND o.organization_id=p_organization AND o.deleted_at IS NULL
          AND o.status<>'cancelled' AND o.owner_user_id=p.id AND (o.created_at>=since OR o.performed_for_week=p_week OR (o.scheduled_for>=since AND o.scheduled_for<=now_at))
        ORDER BY 1 LIMIT 200) i), '[]'::jsonb)) ORDER BY p.full_name), '[]'::jsonb)
   INTO recruiters
   FROM public.user_profiles p
   WHERE p.organization_id=p_organization AND p.deleted_at IS NULL AND p.is_active AND p.app_role::text='recruiter'
     AND EXISTS(SELECT 1 FROM public.user_facility_access u WHERE u.user_id=p.id AND u.facility_id=p_facility AND u.revoked_at IS NULL);

  RETURN jsonb_build_object('facility_id', p_facility, 'facility_name', fname, 'week_start', p_week, 'since', since,
   'figures', figures, 'departures', departure_rows,
   'hospital', jsonb_build_object('out_now', out_now, 'went_out', went_out, 'came_back', came_back),
   'names_shown', people, 'admission_notes_shown', admission_notes, 'admission_workflow_shown', admission_workflow,
   -- COL-749 ruling 3: the census bridge heads the facility's section. Counts only.
   'bridge', haven.stand_up_census_bridge(p_organization, p_facility, p_week, now_at),
   'potential_residents', leads, 'recruiters', recruiters);
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_thursday_facility(uuid,uuid,date,text,text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.stand_up_thursday_facility(uuid,uuid,date,text,text) IS
  'COL-754 / COL-749: one facility''s Thursday Stand Up report: the census bridge (counts only), figures, departures, hospital stays, potential residents with every note, recruiter activity. Admission notes (admission_cases.notes) go to owner, org_admin, facility_admin, manager and admin_assistant, and to recruiters only where stand_up.thursday_admission_notes_to_recruiters is true. The non-clinical admission workflow (status steps, blocks, rate-term notes, non-clinical checklist notes) goes to those roles and to recruiters where stand_up.thursday_admission_workflow_to_recruiters is true (default). Clinical admission content is never on the report.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 536's haven.stand_up_thursday_facility. Nothing is stored.
