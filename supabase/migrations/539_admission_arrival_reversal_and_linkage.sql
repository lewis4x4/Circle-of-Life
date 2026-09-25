-- COL-333: a real arrival is reversed only by an audited compensating
-- workflow, the referral keeps its link through a return or an internal
-- transfer, and the records that need a person's review are listed, never
-- rewritten.
--
--   1. System handoff notes. The shared shift handoff board (shift_handoff_notes,
--      301; acknowledged by the receiving shift) is the existing handoff
--      infrastructure. Admission steps post to it through
--      haven.admission_handoff_note, which dates the note to the facility's
--      configured shift in force (facility_shift_window_at; the 7/15/23 buckets
--      only where a facility has none, as 492 does) and is replay-safe by
--      (source_kind, source_id). stamp_handoff_work_context (513) lets that one
--      caller post without a signed-in session; every other insert is unchanged.
--
--   2. public.admission_arrival_reverse(case, actor, reason, request): for an
--      arrival recorded in error. Only a role in admissions.arrival_approval_roles
--      (534), with a written reason, while the resident is still in the arrival
--      bed and census (someone who has since gone to hospital, on leave, moved
--      or left is handled by those workflows, not by undoing the arrival). In one
--      transaction it
--        * records the reversal (public.admission_arrival_reversals, append only,
--          with what the arrival was and who authorized it);
--        * returns the resident to pending admission, and voids (soft deletes,
--          audited) the census intervals the mistaken arrival opened in
--          resident_status_history, so census read from effective dates stops
--          counting a resident who never arrived; the voided rows are listed on
--          the reversal. Reports already produced from them (daily census, Stand
--          Up, invoices) are what the review notes below are for;
--        * frees the bed and holds it for the admission again;
--        * returns the case to bed reserved, clears the arrival, and voids the
--          approval (a new approval is required, 538);
--        * compensates the referral: converted back to the status it had,
--          with its own event (never a lone lead reset);
--        * posts two high-priority follow-ups to the handoff board, one to review
--          census for the dates the resident was counted and one to review
--          finance (invoices, deposits, rate terms). Acknowledging each is the
--          review.
--      A guard on referral_leads refuses taking a referral out of converted
--      while its arrival stands, from any writer.
--
--   3. Linkage. When an arrival is confirmed for a resident whose earlier
--      arrival converted a referral (a return after discharge, or an internal
--      transfer to another building), that referral records a return or
--      transfer event under the new admission, and stays converted. Its source
--      and conversion are never reassigned.
--
--   4. public.referral_conversion_reconciliation(facility): the prior records a
--      person should review, by kind: a referral marked converted with no
--      confirmed arrival behind it (the legacy status path), an arrived case
--      whose referral is still open, and a case at move-in with no arrival (the
--      legacy PATCH). Identifiers and dates only; nothing is changed.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. System handoff notes
-- ---------------------------------------------------------------------------
ALTER TABLE public.shift_handoff_notes
  ADD COLUMN source_kind text CHECK (source_kind IS NULL OR source_kind IN ('admission_arrival', 'arrival_reversal_census', 'arrival_reversal_finance')),
  ADD COLUMN source_id uuid,
  ADD CONSTRAINT shift_handoff_notes_source_complete CHECK ((source_kind IS NULL) = (source_id IS NULL));
CREATE UNIQUE INDEX idx_shift_handoff_notes_source ON public.shift_handoff_notes(source_kind, source_id) WHERE source_kind IS NOT NULL;
COMMENT ON COLUMN public.shift_handoff_notes.source_kind IS
  'COL-333: set when an admission step posted the note (arrival receiving acknowledgment, arrival reversal census and finance review). One note per source.';

-- Migration 513's trigger; the admission handoff helper may post without a
-- signed-in session (it names the actor itself). Everything else is unchanged.
CREATE OR REPLACE FUNCTION haven.stamp_handoff_work_context() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; staff_user uuid; counts integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.schedule_assignment_id,NEW.schedule_preset_name,NEW.schedule_group_id,NEW.schedule_starts_at,NEW.schedule_ends_at,NEW.schedule_time_zone) IS DISTINCT FROM (OLD.schedule_assignment_id,OLD.schedule_preset_name,OLD.schedule_group_id,OLD.schedule_starts_at,OLD.schedule_ends_at,OLD.schedule_time_zone) THEN RAISE EXCEPTION 'Handoff work context is immutable'; END IF;RETURN NEW;
 END IF;
 -- COL-333: a note posted by an admission step carries its source and author, and no shift work context.
 IF auth.uid() IS NULL AND NEW.source_kind IS NOT NULL AND coalesce(current_setting('haven.admission_handoff', true), '') = NEW.source_id::text THEN
  NEW.schedule_assignment_id:=NULL;NEW.schedule_preset_name:=NULL;NEW.schedule_group_id:=NULL;NEW.schedule_starts_at:=NULL;NEW.schedule_ends_at:=NULL;NEW.schedule_time_zone:=NULL;
  RETURN NEW;
 END IF;
 IF auth.uid() IS NULL OR NEW.organization_id IS DISTINCT FROM haven.organization_id() OR NOT haven.has_facility_access(NEW.facility_id) THEN RAISE EXCEPTION 'Handoff facility access required' USING ERRCODE='42501'; END IF;
 IF NEW.created_by IS NOT NULL AND NEW.created_by<>auth.uid() THEN RAISE EXCEPTION 'Handoff author must be current actor' USING ERRCODE='42501'; END IF;
 NEW.created_by:=auth.uid();
 SELECT * INTO candidate FROM public.schedule_assignment_intervals(NEW.facility_id,now(),now(),NULL) LIMIT 1;
 SELECT count(*),min(s.id::text)::uuid INTO counts,staff_user FROM public.staff s WHERE s.user_id=auth.uid() AND haven.schedule_staff_role(s.id,NEW.facility_id,(now() AT TIME ZONE haven.timeclock_facility_timezone(NEW.facility_id))::date,(now() AT TIME ZONE haven.timeclock_facility_timezone(NEW.facility_id))::date) IS NOT NULL AND s.organization_id=NEW.organization_id AND s.employment_status='active' AND s.deleted_at IS NULL;
 IF counts=1 THEN
  SELECT count(*) INTO counts FROM public.schedule_assignment_intervals(NEW.facility_id,now(),now()+interval '1 microsecond',staff_user);
  IF counts=1 THEN SELECT * INTO candidate FROM public.schedule_assignment_intervals(NEW.facility_id,now(),now()+interval '1 microsecond',staff_user); END IF;
 END IF;
 IF NEW.schedule_assignment_id IS NOT NULL AND (counts<>1 OR NEW.schedule_assignment_id IS DISTINCT FROM candidate.assignment_id) THEN RAISE EXCEPTION 'Handoff assignment does not match current work'; END IF;
 NEW.schedule_assignment_id:=NULL;NEW.schedule_preset_name:=NULL;NEW.schedule_group_id:=NULL;NEW.schedule_starts_at:=NULL;NEW.schedule_ends_at:=NULL;NEW.schedule_time_zone:=NULL;
 IF counts=1 AND candidate.assignment_id IS NOT NULL THEN NEW.schedule_assignment_id:=candidate.assignment_id;NEW.schedule_preset_name:=candidate.label;NEW.schedule_group_id:=candidate.group_id;NEW.schedule_starts_at:=candidate.starts_at;NEW.schedule_ends_at:=candidate.ends_at;NEW.schedule_time_zone:=candidate.time_zone;END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.stamp_handoff_work_context() FROM PUBLIC,anon,authenticated,service_role;

-- Posts one note for an admission step; returns its id (the existing one on replay).
CREATE FUNCTION haven.admission_handoff_note(p_organization uuid, p_facility uuid, p_resident uuid, p_actor uuid,
  p_category text, p_priority text, p_note text, p_source_kind text, p_source_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_tz text; v_now timestamptz := clock_timestamp(); v_shift public.shift_type; v_date date; v_hour integer;
BEGIN
  SELECT n.id INTO v_id FROM public.shift_handoff_notes n WHERE n.source_kind = p_source_kind AND n.source_id = p_source_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT coalesce(f.timezone, 'America/New_York') INTO v_tz FROM public.facilities f WHERE f.id = p_facility;
  v_tz := coalesce(v_tz, 'America/New_York');
  v_hour := extract(hour FROM v_now AT TIME ZONE v_tz)::integer;
  SELECT w.roster_shift_type, w.shift_service_date INTO v_shift, v_date FROM public.facility_shift_window_at(p_facility, v_now) w LIMIT 1;
  -- As 492: the fixed buckets only where the facility has no shift definitions.
  v_shift := coalesce(v_shift, CASE WHEN v_hour >= 7 AND v_hour < 15 THEN 'day' WHEN v_hour >= 15 AND v_hour < 23 THEN 'evening' ELSE 'night' END::public.shift_type);
  v_date := coalesce(v_date, (v_now AT TIME ZONE v_tz)::date);
  PERFORM set_config('haven.admission_handoff', p_source_id::text, true);
  INSERT INTO public.shift_handoff_notes (organization_id, facility_id, shift_date, shift, category, resident_id, note, priority,
    created_by, updated_by, source_kind, source_id)
  VALUES (p_organization, p_facility, v_date, v_shift::text, p_category, p_resident, p_note, p_priority, p_actor, p_actor, p_source_kind, p_source_id)
  RETURNING id INTO v_id;
  PERFORM set_config('haven.admission_handoff', '', true);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION haven.admission_handoff_note(uuid, uuid, uuid, uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Reversal
-- ---------------------------------------------------------------------------
CREATE TABLE public.admission_arrival_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  admission_case_id uuid NOT NULL REFERENCES public.admission_cases(id),
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  bed_id uuid NOT NULL REFERENCES public.beds(id),
  reversed_arrival_at timestamptz NOT NULL,
  reversed_arrival_precision text,
  reversed_approval_id uuid REFERENCES public.admission_arrival_approvals(id),
  voided_status_history_ids uuid[] NOT NULL DEFAULT '{}',
  referral_lead_id uuid REFERENCES public.referral_leads(id),
  referral_status_before text,
  referral_status_after text,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  actor_role text NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  census_review_note_id uuid NOT NULL REFERENCES public.shift_handoff_notes(id),
  finance_review_note_id uuid NOT NULL REFERENCES public.shift_handoff_notes(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_admission_arrival_reversals_admission_case_id ON public.admission_arrival_reversals(admission_case_id, created_at DESC);
CREATE INDEX idx_admission_arrival_reversals_organization_id ON public.admission_arrival_reversals(organization_id);
CREATE INDEX idx_admission_arrival_reversals_facility_id ON public.admission_arrival_reversals(facility_id);
CREATE INDEX idx_admission_arrival_reversals_resident_id ON public.admission_arrival_reversals(resident_id);
CREATE INDEX idx_admission_arrival_reversals_bed_id ON public.admission_arrival_reversals(bed_id);
CREATE INDEX idx_admission_arrival_reversals_reversed_approval_id ON public.admission_arrival_reversals(reversed_approval_id);
CREATE INDEX idx_admission_arrival_reversals_referral_lead_id ON public.admission_arrival_reversals(referral_lead_id);
CREATE INDEX idx_admission_arrival_reversals_actor_id ON public.admission_arrival_reversals(actor_id);
CREATE INDEX idx_admission_arrival_reversals_census_review_note_id ON public.admission_arrival_reversals(census_review_note_id);
CREATE INDEX idx_admission_arrival_reversals_finance_review_note_id ON public.admission_arrival_reversals(finance_review_note_id);
CREATE TRIGGER admission_arrival_reversal_immutable BEFORE UPDATE OR DELETE ON public.admission_arrival_reversals
  FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
CREATE TRIGGER tr_admission_arrival_reversals_audit AFTER INSERT ON public.admission_arrival_reversals
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
ALTER TABLE public.admission_arrival_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admission_arrival_reversals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.admission_arrival_reversals TO authenticated;
CREATE POLICY "Admissions staff read arrival reversals in accessible facilities"
  ON public.admission_arrival_reversals FOR SELECT TO authenticated
  USING (organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (SELECT haven.app_role())::text IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant', 'coordinator', 'med_tech'));
-- COL-627: a resident table decides for housekeepers; this one denies them.
CREATE POLICY "Housekeepers see resident name and room only" ON public.admission_arrival_reversals
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
COMMENT ON TABLE public.admission_arrival_reversals IS
  'COL-333: every reversal of a confirmed arrival, with what the arrival was, the approval it had, the referral compensation, the reason, who reversed it, and the census and finance review notes it opened. Append only.';

CREATE FUNCTION public.admission_arrival_reverse(p_case uuid, p_actor_id uuid, p_reason text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.admission_cases; r public.residents; existing public.admission_arrival_reversals; role text; lead public.referral_leads;
  v_id uuid := gen_random_uuid(); census_note uuid; finance_note uuid; lead_after text; arrival_day text; tz text; v_seq integer; v_after public.referral_leads;
  voided uuid[];
BEGIN
  IF p_request_id IS NULL OR nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Say why the arrival is being reversed' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.admission_cases WHERE id = p_case AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Admission not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO existing FROM public.admission_arrival_reversals WHERE request_id = p_request_id;
  IF FOUND THEN
    IF existing.admission_case_id <> c.id OR existing.actor_id <> p_actor_id OR existing.reason <> btrim(p_reason) THEN
      RAISE EXCEPTION 'Idempotency key payload differs' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('id', existing.id, 'replayed', true);
  END IF;
  role := haven.admission_actor_role(p_actor_id, c.facility_id, haven.admission_arrival_approval_roles(c.organization_id, c.facility_id));
  IF role IS NULL THEN RAISE EXCEPTION 'Only an administrator can reverse an arrival' USING ERRCODE = '42501'; END IF;
  IF c.actual_arrival_at IS NULL THEN RAISE EXCEPTION 'No arrival is recorded on this admission' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.residents WHERE id = c.resident_id AND deleted_at IS NULL FOR UPDATE;
  IF r.id IS NULL OR r.facility_id <> c.facility_id OR r.status <> 'active' OR r.bed_id IS DISTINCT FROM c.bed_id THEN
    RAISE EXCEPTION 'The resident is no longer in the arrival bed and census. Record the discharge, hospital stay or move instead of reversing the arrival' USING ERRCODE = '22023';
  END IF;
  PERFORM b.id FROM public.beds b WHERE b.id = c.bed_id FOR UPDATE;

  SELECT coalesce(f.timezone, 'America/New_York') INTO tz FROM public.facilities f WHERE f.id = c.facility_id;
  arrival_day := to_char(c.actual_arrival_at AT TIME ZONE coalesce(tz, 'America/New_York'), 'FMMon FMDD, YYYY');
  census_note := haven.admission_handoff_note(c.organization_id, c.facility_id, r.id, p_actor_id, 'follow_up', 'high',
    format('Arrival reversed (recorded for %s): %s. Census review: check the daily census and Stand Up figures that counted this resident, then acknowledge.', arrival_day, btrim(p_reason)),
    'arrival_reversal_census', v_id);
  finance_note := haven.admission_handoff_note(c.organization_id, c.facility_id, r.id, p_actor_id, 'follow_up', 'high',
    format('Arrival reversed (recorded for %s). Finance review: check invoices, deposits and rate terms started for this stay, then acknowledge.', arrival_day),
    'arrival_reversal_finance', v_id);

  -- The resident returns to pending admission, dated now; the recorded interval stays for the reviews.
  PERFORM set_config('haven.movement_actor', p_actor_id::text, true);
  UPDATE public.residents SET status = 'pending_admission', bed_id = NULL, admission_date = NULL,
    status_effective_at = NULL, status_effective_reason = left('Arrival reversed: ' || btrim(p_reason), 500), updated_by = p_actor_id
  WHERE id = r.id;
  UPDATE public.beds SET status = 'available', current_resident_id = NULL, updated_by = p_actor_id
  WHERE id = c.bed_id AND (current_resident_id IS NULL OR current_resident_id = r.id);
  -- The census intervals the mistaken arrival opened never happened.
  WITH v AS (
    UPDATE public.resident_status_history h SET deleted_at = clock_timestamp(), updated_at = clock_timestamp(), updated_by = p_actor_id
    WHERE h.resident_id = r.id AND h.deleted_at IS NULL AND h.effective_from >= c.actual_arrival_at
      AND h.status NOT IN ('inquiry', 'pending_admission')
    RETURNING h.id)
  SELECT coalesce(array_agg(v.id), '{}') INTO voided FROM v;

  -- The referral is compensated with its own event, only through this workflow.
  IF c.referral_lead_id IS NOT NULL THEN
    SELECT * INTO lead FROM public.referral_leads WHERE id = c.referral_lead_id AND deleted_at IS NULL FOR UPDATE;
    IF lead.id IS NOT NULL AND lead.status = 'converted' AND lead.converted_resident_id = r.id THEN
      PERFORM set_config('haven.admission_arrival_reversal', c.id::text, true);
      PERFORM haven.activate_referral_command(false);
      UPDATE public.referral_leads
      SET status = coalesce(status_before_close, 'application_pending'::public.referral_lead_status),
          status_before_close = NULL, converted_resident_id = NULL, converted_at = NULL,
          work_state = CASE WHEN owner_user_id IS NULL THEN 'unassigned'::public.referral_episode_work_state ELSE 'assigned'::public.referral_episode_work_state END,
          episode_revision = haven.referral_revision(), updated_by = p_actor_id
      WHERE id = lead.id RETURNING * INTO v_after;
      SELECT coalesce(max(e.event_seq), 0) + 1 INTO v_seq FROM public.referral_episode_events e WHERE e.referral_lead_id = lead.id;
      INSERT INTO public.referral_episode_events (organization_id, facility_id, referral_lead_id, event_seq, event_kind,
        from_status, to_status, from_work_state, to_work_state, effective_precision, effective_at, effective_date, actor_id, actor_role,
        expected_revision, result_revision, request_key, request_hash, source_kind, source_reference, details)
      VALUES (lead.organization_id, lead.facility_id, lead.id, v_seq, 'admission_transition',
        lead.status, v_after.status, lead.work_state, v_after.work_state, 'instant', clock_timestamp(), NULL, p_actor_id, role,
        lead.episode_revision, v_after.episode_revision, 'arrival-reversal:' || v_id::text,
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('arrival-reversal:' || v_id::text || ':' || c.id::text, 'UTF8')), 'hex'),
        'system_compatibility',
        jsonb_build_object('admission_case_id', c.id, 'arrival_reversal_id', v_id, 'reversed_arrival_at', c.actual_arrival_at, 'resident_id', r.id),
        jsonb_build_object('admission_case_id', c.id, 'arrival_reversal_id', v_id, 'reason', btrim(p_reason)));
      PERFORM haven.reconcile_referral_opportunity_state((SELECT fc.opportunity_id FROM public.referral_facility_considerations fc WHERE fc.id = lead.facility_consideration_id),
        lead.organization_id, p_actor_id);
      PERFORM haven.deactivate_referral_command();
      lead_after := v_after.status::text;
    END IF;
  END IF;

  INSERT INTO public.admission_arrival_reversals (id, organization_id, facility_id, admission_case_id, resident_id, bed_id, reversed_arrival_at,
    reversed_arrival_precision, reversed_approval_id, voided_status_history_ids, referral_lead_id, referral_status_before, referral_status_after, reason, actor_id, actor_role,
    request_id, census_review_note_id, finance_review_note_id)
  VALUES (v_id, c.organization_id, c.facility_id, c.id, r.id, c.bed_id, c.actual_arrival_at, c.actual_arrival_precision, c.arrival_approval_id,
    voided, c.referral_lead_id, lead.status::text, lead_after, btrim(p_reason), p_actor_id, role, p_request_id, census_note, finance_note);

  -- The case returns to bed reserved with the bed held for it; a new approval is needed.
  PERFORM set_config('haven.admission_arrival_reversal', c.id::text, true);
  UPDATE public.admission_cases SET status = 'bed_reserved', actual_arrival_at = NULL, actual_arrival_precision = NULL, arrival_approval_id = NULL,
    updated_by = p_actor_id
  WHERE id = c.id;
  PERFORM set_config('haven.admission_arrival_reversal', '', true);
  RETURN jsonb_build_object('id', v_id, 'replayed', false, 'census_review_note_id', census_note, 'finance_review_note_id', finance_note,
    'referral_status', lead_after);
END $$;
REVOKE ALL ON FUNCTION public.admission_arrival_reverse(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admission_arrival_reverse(uuid, uuid, text, uuid) TO service_role;
COMMENT ON FUNCTION public.admission_arrival_reverse(uuid, uuid, text, uuid) IS
  'COL-333: reverses an arrival recorded in error, in one transaction: reversal record, resident back to pending admission, bed held for the admission again, case back to bed reserved with the approval voided, the referral compensated with its own event, and census and finance review notes on the handoff board. Administrators only (admissions.arrival_approval_roles), with a reason. Service route only. COL-37 ruling: definer required -- it writes residents, beds, admission_cases, the RPC-only referral tables and handoff notes in one transaction for a caller the route has authenticated.';

-- A referral whose arrival stands stays converted, whoever writes.
CREATE FUNCTION haven.guard_referral_conversion_stands()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'converted' AND NEW.status IS DISTINCT FROM OLD.status
     AND EXISTS (SELECT 1 FROM public.admission_cases c WHERE c.referral_lead_id = OLD.id AND c.deleted_at IS NULL AND c.actual_arrival_at IS NOT NULL)
     AND coalesce(current_setting('haven.admission_arrival_reversal', true), '') NOT IN (
       SELECT c.id::text FROM public.admission_cases c WHERE c.referral_lead_id = OLD.id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This referral moved in. Reverse the arrival on the admission instead of changing the referral' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_referral_conversion_stands() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER tr_referral_leads_conversion_stands BEFORE UPDATE OF status ON public.referral_leads
  FOR EACH ROW EXECUTE FUNCTION haven.guard_referral_conversion_stands();

-- ---------------------------------------------------------------------------
-- 3. Return and transfer keep the referral's link
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.admission_arrival_links_referral()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE l record; v_actor uuid; v_kind text; v_tz text;
BEGIN
  v_actor := coalesce(nullif(current_setting('haven.movement_actor', true), '')::uuid, NEW.updated_by, NEW.created_by);
  SELECT coalesce(f.timezone, 'America/New_York') INTO v_tz FROM public.facilities f WHERE f.id = NEW.facility_id;
  FOR l IN
    SELECT lead.id, lead.facility_id FROM public.referral_leads lead
    WHERE lead.organization_id = NEW.organization_id AND lead.deleted_at IS NULL AND lead.status = 'converted'
      AND lead.converted_resident_id = NEW.resident_id
      -- Not the referral this very arrival converted.
      AND NOT EXISTS (SELECT 1 FROM public.referral_episode_events e WHERE e.referral_lead_id = lead.id
        AND e.request_key LIKE 'arrival:' || NEW.id::text || '%')
  LOOP
    v_kind := CASE WHEN l.facility_id = NEW.facility_id THEN 'return' ELSE 'transfer' END;
    PERFORM haven.referral_admission_event(l.id, NEW.id, v_actor, v_kind || ':' || NEW.id::text, 'converted',
      jsonb_build_object('linkage', v_kind, 'arrival_facility_id', NEW.facility_id, 'resident_id', NEW.resident_id,
        'actual_arrival_at', NEW.actual_arrival_at),
      CASE WHEN NEW.actual_arrival_precision = 'date' THEN 'date' ELSE 'instant' END::public.referral_effective_precision,
      NEW.actual_arrival_at, (NEW.actual_arrival_at AT TIME ZONE coalesce(v_tz, 'America/New_York'))::date);
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION haven.admission_arrival_links_referral() FROM PUBLIC, anon, authenticated, service_role;
-- Fires after tr_admission_arrival_converts_referral (name order), so the
-- referral this arrival converts is already marked and skipped.
CREATE TRIGGER tr_admission_arrival_links_referral
  AFTER UPDATE OF actual_arrival_at ON public.admission_cases
  FOR EACH ROW
  WHEN (OLD.actual_arrival_at IS NULL AND NEW.actual_arrival_at IS NOT NULL)
  EXECUTE FUNCTION haven.admission_arrival_links_referral();

-- ---------------------------------------------------------------------------
-- 4. Prior records for a person to review
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.referral_conversion_reconciliation(p_facility uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid; o uuid; r text;
BEGIN
  SELECT actor_user_id, actor_organization_id, actor_app_role::text INTO a, o, r FROM haven.current_authorized_actor() WHERE actor_is_managed;
  IF a IS NULL OR r NOT IN ('owner', 'org_admin', 'facility_admin') THEN
    RAISE EXCEPTION 'Referral reconciliation is for administrators' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x ->> 'kind', x ->> 'facility_id', x ->> 'at') FROM (
    SELECT jsonb_build_object('kind', 'converted_without_arrival', 'facility_id', lead.facility_id, 'referral_lead_id', lead.id,
      'admission_case_id', NULL, 'at', lead.converted_at) x
    FROM public.referral_leads lead
    WHERE lead.organization_id = o AND lead.deleted_at IS NULL AND lead.status = 'converted'
      AND (p_facility IS NULL OR lead.facility_id = p_facility) AND haven.has_facility_access(lead.facility_id)
      AND NOT EXISTS (SELECT 1 FROM public.admission_cases c WHERE c.referral_lead_id = lead.id AND c.deleted_at IS NULL AND c.actual_arrival_at IS NOT NULL)
    UNION ALL
    SELECT jsonb_build_object('kind', 'arrived_referral_open', 'facility_id', c.facility_id, 'referral_lead_id', c.referral_lead_id,
      'admission_case_id', c.id, 'at', c.actual_arrival_at)
    FROM public.admission_cases c JOIN public.referral_leads lead ON lead.id = c.referral_lead_id AND lead.deleted_at IS NULL
    WHERE c.organization_id = o AND c.deleted_at IS NULL AND c.actual_arrival_at IS NOT NULL
      AND lead.status NOT IN ('converted', 'lost', 'merged')
      AND (p_facility IS NULL OR c.facility_id = p_facility) AND haven.has_facility_access(c.facility_id)
    UNION ALL
    SELECT jsonb_build_object('kind', 'move_in_without_arrival', 'facility_id', c.facility_id, 'referral_lead_id', c.referral_lead_id,
      'admission_case_id', c.id, 'at', c.updated_at)
    FROM public.admission_cases c
    WHERE c.organization_id = o AND c.deleted_at IS NULL AND c.status = 'move_in' AND c.actual_arrival_at IS NULL
      AND (p_facility IS NULL OR c.facility_id = p_facility) AND haven.has_facility_access(c.facility_id)
  ) s), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.referral_conversion_reconciliation(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.referral_conversion_reconciliation(uuid) TO authenticated;
COMMENT ON FUNCTION public.referral_conversion_reconciliation(uuid) IS
  'COL-333: records a person should review, never rewritten: referrals marked converted with no confirmed arrival (legacy status path), arrived admissions whose referral is still open, and admissions at move-in with no arrival (legacy PATCH). Identifiers and dates only. Owner, org_admin, facility_admin. COL-37 ruling: definer required -- referral_leads is RPC-only; it checks the role first and filters by haven.has_facility_access.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: DROP TRIGGER tr_admission_arrival_links_referral ON public.admission_cases;
-- DROP TRIGGER tr_referral_leads_conversion_stands ON public.referral_leads;
-- DROP FUNCTION public.referral_conversion_reconciliation(uuid), public.admission_arrival_reverse(uuid,uuid,text,uuid),
-- haven.admission_arrival_links_referral(), haven.guard_referral_conversion_stands(), haven.admission_handoff_note(...);
-- restore migration 513's haven.stamp_handoff_work_context; export then drop
-- public.admission_arrival_reversals; keep the shift_handoff_notes source columns
-- (notes posted by admission steps still carry them).
