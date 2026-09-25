-- COL-754 (part of COL-749): the Thursday Stand Up report.
--
-- Brian, 2026-09-24: "The call is mainly for referrals and recruiters BUT the
-- admins will share the current A/R, current census, depatures, and hosptial
-- stays ... What could be incredible is under each location, we pull into the
-- facility under the standup what referrals there are that are linked as a
-- potential resident and all the notes." And: recruiters "need to log
-- everything".
--
-- stand_up_command('report', {meeting_day:'thursday', facility_id?, week_start?})
-- returns, per facility the caller may read:
--
--   1. The facility figures Haven computes for Thursday, to prefill the form the
--      administrator verifies: current A/R (the COL-665 statuses), census and
--      hospital or rehab from the roster with hospital and rehab apart (COL-755;
--      stays with no recorded type are in the total only), and departures since
--      Monday's call from effective-dated status history (COL-750). Monday's
--      submitted figures and the Thursday report itself come from the existing
--      workspace read, unchanged.
--   2. Who: the departures (discharges and deaths, with dates) and the hospital
--      and rehab stays (out now, went out since Monday, came back since Monday).
--      Resident names only for the roles that already read the roster (owner,
--      org_admin, facility_admin, manager, admin_assistant); a recruiter sees
--      the counts.
--   3. Potential residents: every open referral for the facility (not converted,
--      lost or merged; a confirmed arrival converts it, COL-333) with stage,
--      owner, tours (COL-332), admission case stage (Form 1823, clearance,
--      orders, bed, target move-in, Medicaid), next action, and every note and
--      contact in time order: logged contacts and next steps, tour results, the
--      lead's notes and the admission's notes. Anything recorded since Monday's
--      call is marked new. Notes follow the COL-331 rule: work_note_read roles
--      (owner, org_admin, facility_admin, manager, admin_assistant, recruiter),
--      never on a public_summary lead. Admission notes go only to the roles that
--      read admission cases (not recruiters): no PHI beyond what the referral and
--      admission screens already show.
--   4. Each recruiter's activity at the facility since Monday's call: contacts,
--      tours and outreach, with what was logged.
--
-- Readers of Thursday widen to the COL-331 note-reader roles: owner, org_admin,
-- facility_admin, manager, admin_assistant and recruiter. Only owner, org_admin
-- and facility_admin write figures, as before.
--
-- Haven only (Brian, 2026-09-24): no publisher, export or Google sync reads any
-- of this.
BEGIN;

CREATE OR REPLACE FUNCTION haven.stand_up_meeting_reader(p_facility uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; o uuid; r text;
BEGIN
 SELECT actor_user_id,actor_organization_id,actor_app_role::text INTO a,o,r FROM haven.current_authorized_actor() WHERE actor_is_managed;
 IF a IS NULL OR r NOT IN('owner','org_admin','facility_admin','manager','admin_assistant','recruiter')
  OR (p_facility IS NOT NULL AND (NOT haven.has_facility_access(p_facility)
   OR NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=p_facility AND organization_id=o AND deleted_at IS NULL))) THEN
  RAISE EXCEPTION 'Stand Up access denied' USING ERRCODE='42501';
 END IF;
 RETURN o;
END $$;


-- ---------------------------------------------------------------------------
-- The report
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.stand_up_thursday_facility(p_organization uuid, p_facility uuid, p_week date, p_day text, p_role text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  monday jsonb; since timestamptz; now_at timestamptz := clock_timestamp(); fname text;
  people boolean := p_role IN ('owner','org_admin','facility_admin','manager','admin_assistant');
  admission_notes boolean := p_role IN ('owner','org_admin','facility_admin','manager','admin_assistant');
  work_notes boolean := p_role IN ('owner','org_admin','facility_admin','manager','admin_assistant','recruiter');
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
   'names_shown', people, 'admission_notes_shown', admission_notes,
   'potential_residents', leads, 'recruiters', recruiters);
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_thursday_facility(uuid,uuid,date,text,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION haven.stand_up_thursday_report(p_organization uuid, p_facility uuid, p_week date, p_day text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r text := haven.app_role()::text;
BEGIN
  IF p_day<>'thursday' THEN RAISE EXCEPTION 'This report is the Thursday meeting''s'; END IF;
  RETURN jsonb_build_object('meeting_day', p_day, 'generated_at', clock_timestamp(), 'actor_role', r, 'facilities', coalesce((
   SELECT jsonb_agg(x.rep ORDER BY x.rep->>'facility_name')
   FROM (SELECT haven.stand_up_thursday_facility(p_organization, fa.id,
      coalesce(p_week, haven.stand_up_meeting_open_week(p_organization, fa.id, p_day, clock_timestamp())), p_day, r) AS rep
     FROM public.facilities fa
     WHERE fa.organization_id=p_organization AND fa.deleted_at IS NULL AND haven.has_facility_access(fa.id)
       AND (p_facility IS NULL OR fa.id=p_facility)
       AND coalesce(p_week, haven.stand_up_meeting_open_week(p_organization, fa.id, p_day, clock_timestamp())) IS NOT NULL) x
   WHERE x.rep IS NOT NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_thursday_report(uuid,uuid,date,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.stand_up_meeting_command(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE d text:=p_payload->>'meeting_day'; o uuid; f uuid; w date; role text; r public.stand_up_meeting_reports%ROWTYPE;
 facilities jsonb; reports jsonb; baselines jsonb; times jsonb; snapshot uuid; org_week date;
BEGIN
 IF haven.stand_up_meeting_keys(d) IS NULL THEN RAISE EXCEPTION 'Unknown Stand Up meeting'; END IF;
 IF p_action='save' THEN RETURN haven.stand_up_meeting_save(p_payload); END IF;
 f:=(p_payload->>'facility_id')::uuid;
 o:=haven.stand_up_meeting_reader(f);
 role:=haven.app_role()::text;
 IF p_action IN('workspace','list') THEN
  org_week:=haven.stand_up_meeting_open_week(o,NULL,d,clock_timestamp());
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'open_week',x.open_week,
    'window',haven.stand_up_meeting_times(o,x.id,d,x.open_week)) ORDER BY x.name),'[]'::jsonb) INTO facilities
  FROM (SELECT fa.id,fa.name,haven.stand_up_meeting_open_week(o,fa.id,d,clock_timestamp()) open_week
   FROM public.facilities fa WHERE fa.organization_id=o AND fa.deleted_at IS NULL AND haven.has_facility_access(fa.id)
    AND (f IS NULL OR fa.id=f)) x;
  SELECT coalesce(jsonb_agg(haven.stand_up_meeting_report_json(m.id) ORDER BY m.week_start DESC,m.facility_id),'[]'::jsonb) INTO reports
  FROM public.stand_up_meeting_reports m
  WHERE m.organization_id=o AND m.meeting_day=d AND haven.has_facility_access(m.facility_id) AND (f IS NULL OR m.facility_id=f);
  -- Monday's submitted figures for each facility's open week, which has no report yet.
  SELECT coalesce(jsonb_agg(jsonb_build_object('facility_id',y->>'id','week_start',y->>'open_week','monday_submitted',
    haven.stand_up_meeting_monday_submitted((y->>'id')::uuid,(y->>'open_week')::date,d))),'[]'::jsonb) INTO baselines
  FROM jsonb_array_elements(facilities) y WHERE y->>'open_week' IS NOT NULL;
  RETURN jsonb_build_object('meeting_day',d,'scheduled',org_week IS NOT NULL,'current_week',org_week,
   'window',haven.stand_up_meeting_times(o,NULL,d,org_week),
   'schedule',haven.stand_up_meeting_schedule_json(o,f),
   'keys',to_jsonb(haven.stand_up_meeting_keys(d)),
   'facilities',facilities,'reports',reports,'monday_baselines',baselines,
   'can_edit',role IN('owner','org_admin','facility_admin'),
   'can_edit_submitted',role IN('owner','org_admin','facility_admin'),
   'server_now',clock_timestamp(),'actor_role',role);
 ELSIF p_action='report' THEN
  -- COL-754: the meeting's report for one facility (or every readable one).
  RETURN haven.stand_up_thursday_report(o,f,(p_payload->>'week_start')::date,d);
 ELSIF p_action='revisions' THEN
  w:=(p_payload->>'week_start')::date;
  IF f IS NULL OR w IS NULL THEN RAISE EXCEPTION 'Facility and week required'; END IF;
  times:=haven.stand_up_meeting_times(o,f,d,w);
  SELECT * INTO r FROM public.stand_up_meeting_reports WHERE facility_id=f AND week_start=w AND meeting_day=d;
  IF r.id IS NULL THEN RETURN jsonb_build_object('facility_id',f,'week_start',w,'meeting_day',d,'window',times,'call_snapshot_revision_id',NULL,'revisions','[]'::jsonb); END IF;
  -- The meeting's own "as of the call" snapshot: the revision current when the call started.
  IF times IS NOT NULL AND clock_timestamp()>=(times->>'call_at')::timestamptz THEN
   SELECT v.id INTO snapshot FROM public.stand_up_meeting_revisions v WHERE v.report_id=r.id AND v.created_at<=(times->>'call_at')::timestamptz ORDER BY v.created_at DESC,v.version DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object('facility_id',f,'week_start',w,'meeting_day',d,'window',times,'call_snapshot_revision_id',snapshot,'revisions',coalesce((
   SELECT jsonb_agg(jsonb_build_object('version',v.version,'revision_id',v.id,'status',v.status,'created_at',v.created_at,'reason',v.reason,'values',v.values,
    'source_as_of',v.source_as_of,'updated_by',v.actor_id,
    'updated_by_name',(SELECT p.full_name FROM public.user_profiles p WHERE p.id=v.actor_id AND p.organization_id=r.organization_id)) ORDER BY v.version)
   FROM public.stand_up_meeting_revisions v WHERE v.report_id=r.id),'[]'::jsonb));
 END IF;
 RAISE EXCEPTION 'This action is not available for the % meeting',initcap(d);
END $$;


REVOKE ALL ON FUNCTION haven.stand_up_meeting_reader(uuid), haven.stand_up_meeting_command(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.stand_up_meeting_command(text,jsonb) IS 'COL-752 / COL-754: workspace, list, save, revisions and report for a Stand Up meeting other than Monday (payload meeting_day). Owner, org_admin, facility_admin, manager, admin_assistant and recruiter read; owner, org_admin and facility_admin write. Haven only: nothing here is published.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 517's haven.stand_up_meeting_reader and
-- haven.stand_up_meeting_command, then DROP FUNCTION
-- haven.stand_up_thursday_report(uuid,uuid,date,text) and
-- haven.stand_up_thursday_facility(uuid,uuid,date,text,text). Nothing is stored.
