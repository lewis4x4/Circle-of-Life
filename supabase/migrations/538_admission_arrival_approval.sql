-- COL-333: an actual arrival needs an administrator's approval of the current
-- readiness, and nothing but the arrival records a move-in.
--
--   1. Readiness has a fingerprint. haven.admission_arrival_readiness(case)
--      states whether the case is ready for arrival (the same checks the
--      arrival itself makes: financial clearance, physician orders, bed, quoted
--      rate terms, a current Form 1823 with verified evidence, the resident's
--      date of birth and gender) and fingerprints the material facts: those
--      fields, the rate terms, the Form 1823 record and its evidence, the
--      resident's identity, the bed and target date, and the payer. A change to
--      any of them is a new fingerprint.
--
--   2. Approval is bound to that fingerprint.
--      public.admission_arrival_approve(case, actor, expected_fingerprint, request)
--      records who approved which readiness (public.admission_arrival_approvals,
--      append only). The approver must hold a role in admissions.arrival_approval_roles
--      (534; default owner, org_admin, facility_admin, and the rule cannot be
--      emptied or widened beyond them), be active and reach the facility. An
--      approval counts only while the fingerprint still matches, the approver
--      still holds that authority, it was not withdrawn, and it was given after
--      the last arrival reversal (539). Material readiness changes therefore
--      invalidate it without anyone having to remember to.
--
--   3. confirm_admission_arrival_review (504) now also requires:
--        * the confirming actor to be active, hold an arrival role (owner,
--          org_admin, facility_admin, manager, med_tech: the confirm route's
--          roles; never a recruiter) and reach the facility;
--        * a current approval. The approval that authorized the arrival is kept
--          on the case (arrival_approval_id).
--      It records the arrival's precision: 'date' when no time was given, so a
--      date-only arrival is never passed off as an instant (the referral event
--      carries the same precision).
--
--   4. A guard on admission_cases, for every writer (the legacy PATCH route, a
--      direct SQL write, the service role):
--        * a case moves to move_in only with its actual arrival, and only the
--          arrival function sets the arrival;
--        * an arrival is changed or cleared only by the reversal (539);
--        * no case is created already moved in.
--      Cases already at move_in without an arrival (the legacy path) are left
--      exactly as they are and listed by referral_conversion_reconciliation (539).
BEGIN;

ALTER TABLE public.admission_cases
  ADD COLUMN actual_arrival_precision text CHECK (actual_arrival_precision IS NULL OR actual_arrival_precision IN ('instant', 'date')),
  ADD COLUMN arrival_approval_id uuid;
COMMENT ON COLUMN public.admission_cases.actual_arrival_precision IS
  'COL-333: instant when the arrival time was given, date when only the day was. Null on arrivals recorded before migration 538.';
COMMENT ON COLUMN public.admission_cases.arrival_approval_id IS
  'COL-333: the administrator approval (admission_arrival_approvals) the arrival was confirmed under.';

-- ---------------------------------------------------------------------------
-- 1. Readiness and its fingerprint
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.admission_arrival_readiness(p_case uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.admission_cases; r public.residents; tz text; today date; blocked text[] := ARRAY[]::text[];
  form jsonb; evidence jsonb; terms jsonb; snapshot jsonb; form_ok boolean;
BEGIN
  SELECT * INTO c FROM public.admission_cases WHERE id = p_case AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(f.timezone, 'America/New_York') INTO tz FROM public.facilities f WHERE f.id = c.facility_id;
  today := (clock_timestamp() AT TIME ZONE coalesce(tz, 'America/New_York'))::date;
  SELECT * INTO r FROM public.residents WHERE id = c.resident_id AND deleted_at IS NULL;

  SELECT to_jsonb(x) INTO form FROM (
    SELECT fr.id, fr.status, fr.exam_date, fr.expiration_date, nullif(btrim(fr.physician_name), '') AS physician_name, fr.updated_at
    FROM public.form_1823_records fr
    WHERE fr.resident_id = c.resident_id AND fr.deleted_at IS NULL
    ORDER BY CASE WHEN fr.admission_case_id = c.id THEN 1 ELSE 0 END DESC, fr.updated_at DESC, fr.id DESC LIMIT 1) x;
  SELECT to_jsonb(x) INTO evidence FROM (
    SELECT d.id, d.received_at, md5(coalesce(d.notes, '')) AS notes_hash, nullif(btrim(d.notes), '') IS NOT NULL AS has_notes
    FROM public.admission_document_checklist_items d
    WHERE d.admission_case_id = c.id AND d.document_type = 'form_1823' AND d.deleted_at IS NULL LIMIT 1) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'accommodation_type', t.accommodation_type, 'base', t.quoted_base_rate_cents,
    'care', t.quoted_care_surcharge_cents, 'effective_date', t.effective_date, 'schedule', t.rate_schedule_id) ORDER BY t.id), '[]'::jsonb)
    INTO terms FROM public.admission_case_rate_terms t WHERE t.admission_case_id = c.id;
  form_ok := form IS NOT NULL AND evidence IS NOT NULL AND form ->> 'status' = 'received'
    AND (form ->> 'exam_date')::date <= today AND (form ->> 'expiration_date')::date >= today AND form ->> 'physician_name' IS NOT NULL
    AND evidence ->> 'received_at' IS NOT NULL AND (evidence ->> 'has_notes')::boolean;

  IF c.status::text IN ('cancelled', 'closed') THEN blocked := array_append(blocked, 'the admission is cancelled or closed'::text); END IF;
  IF c.actual_arrival_at IS NOT NULL THEN blocked := array_append(blocked, 'the arrival is already recorded'::text); END IF;
  IF c.financial_clearance_at IS NULL THEN blocked := array_append(blocked, 'financial clearance'::text); END IF;
  IF c.physician_orders_received_at IS NULL THEN blocked := array_append(blocked, 'physician orders'::text); END IF;
  IF c.bed_id IS NULL THEN blocked := array_append(blocked, 'bed assignment'::text); END IF;
  IF jsonb_array_length(terms) = 0 THEN blocked := array_append(blocked, 'quoted rate terms'::text); END IF;
  IF NOT form_ok THEN blocked := array_append(blocked, 'a current Form 1823 with verified evidence'::text); END IF;
  IF r.id IS NULL OR r.date_of_birth IS NULL OR r.gender IS NULL THEN blocked := array_append(blocked, 'resident date of birth and gender'::text); END IF;

  snapshot := jsonb_build_object(
    'case', jsonb_build_object('resident_id', c.resident_id, 'bed_id', c.bed_id, 'target_move_in_date', c.target_move_in_date,
      'financial_clearance_at', c.financial_clearance_at, 'physician_orders_received_at', c.physician_orders_received_at,
      'anticipated_payer_source', c.anticipated_payer_source, 'anticipated_payer_other', c.anticipated_payer_other,
      'intake_program_type', c.intake_program_type),
    'resident', jsonb_build_object('first_name', r.first_name, 'last_name', r.last_name, 'date_of_birth', r.date_of_birth, 'gender', r.gender),
    'rate_terms', terms, 'form_1823', form, 'form_1823_evidence', evidence);
  RETURN jsonb_build_object('admission_case_id', c.id, 'ready', cardinality(blocked) = 0, 'blocked_by', to_jsonb(blocked),
    'fingerprint', md5(snapshot::text), 'snapshot', snapshot);
END $$;
REVOKE ALL ON FUNCTION haven.admission_arrival_readiness(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Approvals
-- ---------------------------------------------------------------------------
CREATE TABLE public.admission_arrival_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  admission_case_id uuid NOT NULL REFERENCES public.admission_cases(id),
  decision text NOT NULL CHECK (decision IN ('approved', 'withdrawn')),
  readiness_fingerprint text NOT NULL CHECK (readiness_fingerprint ~ '^[0-9a-f]{32}$'),
  readiness_snapshot jsonb NOT NULL CHECK (jsonb_typeof(readiness_snapshot) = 'object'),
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  actor_role text NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500),
  request_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (decision = 'approved' OR reason IS NOT NULL)
);
CREATE INDEX idx_admission_arrival_approvals_admission_case_id ON public.admission_arrival_approvals(admission_case_id, created_at DESC);
CREATE INDEX idx_admission_arrival_approvals_organization_id ON public.admission_arrival_approvals(organization_id);
CREATE INDEX idx_admission_arrival_approvals_facility_id ON public.admission_arrival_approvals(facility_id);
CREATE INDEX idx_admission_arrival_approvals_actor_id ON public.admission_arrival_approvals(actor_id);
CREATE TRIGGER admission_arrival_approval_immutable BEFORE UPDATE OR DELETE ON public.admission_arrival_approvals
  FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
CREATE TRIGGER tr_admission_arrival_approvals_audit AFTER INSERT ON public.admission_arrival_approvals
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
ALTER TABLE public.admission_cases ADD CONSTRAINT admission_cases_arrival_approval_id_fkey
  FOREIGN KEY (arrival_approval_id) REFERENCES public.admission_arrival_approvals(id);
CREATE INDEX idx_admission_cases_arrival_approval_id ON public.admission_cases(arrival_approval_id) WHERE arrival_approval_id IS NOT NULL;
ALTER TABLE public.admission_arrival_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admission_arrival_approvals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.admission_arrival_approvals TO authenticated;
CREATE POLICY "Admissions staff read arrival approvals in accessible facilities"
  ON public.admission_arrival_approvals FOR SELECT TO authenticated
  USING (organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (SELECT haven.app_role())::text IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant', 'coordinator', 'med_tech'));
COMMENT ON TABLE public.admission_arrival_approvals IS
  'COL-333: every administrator approval (and withdrawal) of an admission''s readiness for arrival, with the readiness fingerprint and snapshot it was given for. Written only by admission_arrival_approve / admission_arrival_approval_withdraw. Append only.';

-- The roles that may approve at a facility today (the rule; never empty).
CREATE FUNCTION haven.admission_arrival_approval_roles(p_organization uuid, p_facility uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(nullif((SELECT array_agg(x #>> '{}') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.value) = 'array' THEN o.value ELSE '[]'::jsonb END) x
    WHERE x #>> '{}' IN ('owner', 'org_admin', 'facility_admin')), '{}'), ARRAY['owner', 'org_admin', 'facility_admin'])
  FROM public.haven_operating_rule(p_organization, p_facility, 'admissions.arrival_approval_roles', (clock_timestamp() AT TIME ZONE 'America/New_York')::date) o
$$;
REVOKE ALL ON FUNCTION haven.admission_arrival_approval_roles(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The approval in force for a case, or null. Derived on every read.
CREATE FUNCTION haven.admission_arrival_approval_current(p_case uuid)
RETURNS public.admission_arrival_approvals LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.admission_cases; latest public.admission_arrival_approvals; readiness jsonb; last_reversal timestamptz;
BEGIN
  SELECT * INTO c FROM public.admission_cases WHERE id = p_case AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO latest FROM public.admission_arrival_approvals a WHERE a.admission_case_id = c.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1;
  IF latest.id IS NULL OR latest.decision <> 'approved' THEN RETURN NULL; END IF;
  IF to_regclass('public.admission_arrival_reversals') IS NOT NULL THEN
    EXECUTE 'SELECT max(created_at) FROM public.admission_arrival_reversals WHERE admission_case_id=$1' INTO last_reversal USING c.id;
    IF last_reversal IS NOT NULL AND latest.created_at <= last_reversal THEN RETURN NULL; END IF;
  END IF;
  readiness := haven.admission_arrival_readiness(c.id);
  IF readiness ->> 'fingerprint' IS DISTINCT FROM latest.readiness_fingerprint THEN RETURN NULL; END IF;
  IF haven.admission_actor_role(latest.actor_id, c.facility_id, haven.admission_arrival_approval_roles(c.organization_id, c.facility_id)) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN latest;
END $$;
REVOKE ALL ON FUNCTION haven.admission_arrival_approval_current(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- What a screen shows: readiness, the approval in force, and why the latest one does not count.
CREATE FUNCTION public.admission_arrival_status(p_case uuid, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.admission_cases; readiness jsonb; cur public.admission_arrival_approvals; latest public.admission_arrival_approvals;
  why text; approver text; roles text[];
BEGIN
  SELECT * INTO c FROM public.admission_cases WHERE id = p_case AND deleted_at IS NULL;
  IF NOT FOUND OR haven.admission_actor_role(p_actor_id, c.facility_id,
       ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech']) IS NULL THEN
    RAISE EXCEPTION 'Admission not found' USING ERRCODE = '42501';
  END IF;
  readiness := haven.admission_arrival_readiness(c.id);
  cur := haven.admission_arrival_approval_current(c.id);
  SELECT * INTO latest FROM public.admission_arrival_approvals a WHERE a.admission_case_id = c.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1;
  roles := haven.admission_arrival_approval_roles(c.organization_id, c.facility_id);
  IF cur.id IS NULL AND latest.id IS NOT NULL THEN
    why := CASE
      WHEN latest.decision = 'withdrawn' THEN 'withdrawn'
      WHEN latest.readiness_fingerprint IS DISTINCT FROM readiness ->> 'fingerprint' THEN 'readiness_changed'
      WHEN haven.admission_actor_role(latest.actor_id, c.facility_id, roles) IS NULL THEN 'approver_no_longer_authorized'
      ELSE 'superseded_by_reversal' END;
  END IF;
  SELECT full_name INTO approver FROM public.user_profiles WHERE id = coalesce(cur.actor_id, latest.actor_id);
  RETURN jsonb_build_object(
    'admission_case_id', c.id, 'status', c.status, 'actual_arrival_at', c.actual_arrival_at, 'actual_arrival_precision', c.actual_arrival_precision,
    'ready', (readiness ->> 'ready')::boolean, 'blocked_by', readiness -> 'blocked_by', 'fingerprint', readiness ->> 'fingerprint',
    'approval', CASE WHEN cur.id IS NULL THEN NULL ELSE jsonb_build_object('id', cur.id, 'approved_by', cur.actor_id, 'approved_by_name', approver,
      'approved_role', cur.actor_role, 'approved_at', cur.created_at) END,
    'latest_decision', CASE WHEN latest.id IS NULL THEN NULL ELSE jsonb_build_object('decision', latest.decision, 'by', latest.actor_id, 'by_name', approver,
      'at', latest.created_at, 'reason', latest.reason) END,
    'approval_invalid_because', why,
    'approval_roles', to_jsonb(roles),
    'can_approve', haven.admission_actor_role(p_actor_id, c.facility_id, roles) IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.admission_arrival_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admission_arrival_status(uuid, uuid) TO service_role;

CREATE FUNCTION public.admission_arrival_approve(p_case uuid, p_actor_id uuid, p_expected_fingerprint text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.admission_cases; readiness jsonb; role text; existing public.admission_arrival_approvals; created public.admission_arrival_approvals;
BEGIN
  IF p_request_id IS NULL OR p_expected_fingerprint IS NULL THEN RAISE EXCEPTION 'Approval request incomplete' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.admission_cases WHERE id = p_case AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Admission not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO existing FROM public.admission_arrival_approvals WHERE request_id = p_request_id;
  IF FOUND THEN
    IF existing.admission_case_id <> c.id OR existing.actor_id <> p_actor_id OR existing.decision <> 'approved' OR existing.readiness_fingerprint <> p_expected_fingerprint THEN
      RAISE EXCEPTION 'Idempotency key payload differs' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('id', existing.id, 'approved_at', existing.created_at, 'replayed', true);
  END IF;
  role := haven.admission_actor_role(p_actor_id, c.facility_id, haven.admission_arrival_approval_roles(c.organization_id, c.facility_id));
  IF role IS NULL THEN RAISE EXCEPTION 'Only an administrator can approve an arrival' USING ERRCODE = '42501'; END IF;
  readiness := haven.admission_arrival_readiness(c.id);
  IF NOT (readiness ->> 'ready')::boolean THEN
    RAISE EXCEPTION 'Not ready for arrival: %', (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(readiness -> 'blocked_by') x) USING ERRCODE = '22023';
  END IF;
  IF readiness ->> 'fingerprint' <> p_expected_fingerprint THEN
    RAISE EXCEPTION 'The readiness changed since you reviewed it. Review it again before approving' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.admission_arrival_approvals (organization_id, facility_id, admission_case_id, decision, readiness_fingerprint, readiness_snapshot,
    actor_id, actor_role, request_id)
  VALUES (c.organization_id, c.facility_id, c.id, 'approved', readiness ->> 'fingerprint', readiness -> 'snapshot', p_actor_id, role, p_request_id)
  RETURNING * INTO created;
  RETURN jsonb_build_object('id', created.id, 'approved_at', created.created_at, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.admission_arrival_approve(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admission_arrival_approve(uuid, uuid, text, uuid) TO service_role;

CREATE FUNCTION public.admission_arrival_approval_withdraw(p_case uuid, p_actor_id uuid, p_reason text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.admission_cases; readiness jsonb; role text; existing public.admission_arrival_approvals; created public.admission_arrival_approvals;
BEGIN
  IF p_request_id IS NULL OR nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Say why the approval is withdrawn' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.admission_cases WHERE id = p_case AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Admission not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO existing FROM public.admission_arrival_approvals WHERE request_id = p_request_id;
  IF FOUND THEN
    IF existing.admission_case_id <> c.id OR existing.actor_id <> p_actor_id OR existing.decision <> 'withdrawn' THEN
      RAISE EXCEPTION 'Idempotency key payload differs' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('id', existing.id, 'replayed', true);
  END IF;
  role := haven.admission_actor_role(p_actor_id, c.facility_id, haven.admission_arrival_approval_roles(c.organization_id, c.facility_id));
  IF role IS NULL THEN RAISE EXCEPTION 'Only an administrator can withdraw an arrival approval' USING ERRCODE = '42501'; END IF;
  IF c.actual_arrival_at IS NOT NULL THEN RAISE EXCEPTION 'The arrival is already recorded; reverse the arrival instead' USING ERRCODE = '22023'; END IF;
  readiness := haven.admission_arrival_readiness(c.id);
  INSERT INTO public.admission_arrival_approvals (organization_id, facility_id, admission_case_id, decision, readiness_fingerprint, readiness_snapshot,
    actor_id, actor_role, reason, request_id)
  VALUES (c.organization_id, c.facility_id, c.id, 'withdrawn', readiness ->> 'fingerprint', readiness -> 'snapshot', p_actor_id, role, btrim(p_reason), p_request_id)
  RETURNING * INTO created;
  RETURN jsonb_build_object('id', created.id, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.admission_arrival_approval_withdraw(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admission_arrival_approval_withdraw(uuid, uuid, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The arrival
-- ---------------------------------------------------------------------------
-- Migration 504's text, plus: the actor's authority, the approval in force,
-- the precision, and the flag the guard below reads.
CREATE OR REPLACE FUNCTION public.confirm_admission_arrival_review(
  p_case_id uuid,
  p_actor_id uuid,
  p_arrival_date date,
  p_arrival_at timestamptz DEFAULT NULL,
  p_late_entry_reason text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c admission_cases%ROWTYPE; r residents%ROWTYPE; b beds%ROWTYPE; today date; tz text; v_at timestamptz; approval admission_arrival_approvals%ROWTYPE;
BEGIN
 SELECT * INTO STRICT c FROM admission_cases WHERE id=p_case_id AND deleted_at IS NULL FOR UPDATE;
 SELECT coalesce(timezone,'America/New_York') INTO tz FROM facilities WHERE id=c.facility_id;
 tz := coalesce(tz,'America/New_York');
 today := (now() AT TIME ZONE tz)::date;
 IF c.actual_arrival_at IS NOT NULL THEN RETURN c.resident_id; END IF;
 IF haven.admission_actor_role(p_actor_id,c.facility_id,ARRAY['owner','org_admin','facility_admin','manager','med_tech']) IS NULL THEN
   RAISE EXCEPTION 'You no longer have access to confirm this arrival' USING ERRCODE='42501';
 END IF;
 IF c.status::text IN('cancelled','closed') THEN RAISE EXCEPTION 'A cancelled or closed admission cannot confirm arrival'; END IF;
 IF p_arrival_date IS NULL OR p_arrival_date>today OR p_arrival_at>now() THEN RAISE EXCEPTION 'Choose an actual arrival date, not a future date'; END IF;
 IF p_arrival_at IS NOT NULL AND (p_arrival_at AT TIME ZONE tz)::date<>p_arrival_date THEN RAISE EXCEPTION 'The arrival time must fall on the arrival date'; END IF;
 IF c.financial_clearance_at IS NULL OR c.physician_orders_received_at IS NULL OR c.bed_id IS NULL OR NOT EXISTS(SELECT 1 FROM admission_case_rate_terms WHERE admission_case_id=c.id) THEN RAISE EXCEPTION 'Complete financial, physician-order, bed and rate readiness first'; END IF;
 IF NOT EXISTS(SELECT 1 FROM (SELECT fr.* FROM form_1823_records fr WHERE fr.resident_id=c.resident_id AND fr.deleted_at IS NULL ORDER BY CASE WHEN fr.admission_case_id=c.id THEN 1 ELSE 0 END DESC,fr.updated_at DESC,fr.id DESC LIMIT 1) f JOIN admission_document_checklist_items d ON d.admission_case_id=c.id AND d.document_type='form_1823' WHERE f.resident_id=c.resident_id AND f.status='received' AND f.exam_date<=today AND f.expiration_date>=today AND nullif(trim(f.physician_name),'') IS NOT NULL AND d.received_at IS NOT NULL AND nullif(trim(d.notes),'') IS NOT NULL AND f.deleted_at IS NULL AND d.deleted_at IS NULL) THEN RAISE EXCEPTION 'Current Form 1823 and verified evidence are required'; END IF;
 SELECT * INTO STRICT r FROM residents WHERE id=c.resident_id AND facility_id=c.facility_id AND deleted_at IS NULL FOR UPDATE;
 IF r.gender IS NULL OR r.date_of_birth IS NULL THEN RAISE EXCEPTION 'Complete resident date of birth and gender before confirming arrival'; END IF;
 -- COL-333: an administrator approved this readiness, and it has not changed since.
 approval := haven.admission_arrival_approval_current(c.id);
 IF approval.id IS NULL THEN RAISE EXCEPTION 'An administrator must approve the current readiness before arrival' USING ERRCODE='42501'; END IF;
 PERFORM bed.id FROM public.beds bed WHERE bed.id IN(r.bed_id,c.bed_id) ORDER BY bed.id FOR UPDATE;
 SELECT * INTO STRICT b FROM beds WHERE id=c.bed_id AND facility_id=c.facility_id AND deleted_at IS NULL FOR UPDATE;
 IF b.reserved_for_admission_case_id IS NOT NULL AND b.reserved_for_admission_case_id<>c.id THEN RAISE EXCEPTION 'The selected bed is reserved for another admission'; END IF;
 IF b.current_resident_id IS NOT NULL AND b.current_resident_id<>r.id THEN RAISE EXCEPTION 'The selected bed is occupied by another resident'; END IF;
 IF b.status NOT IN('available','hold','occupied') THEN RAISE EXCEPTION 'The bed is unavailable for arrival'; END IF;
 -- Today with no time is now; an earlier day with no time is that day's start
 -- (the admission-date convention the capture trigger already uses).
 v_at := coalesce(p_arrival_at, CASE WHEN p_arrival_date=today THEN now() ELSE p_arrival_date::timestamp AT TIME ZONE tz END);
 -- The route calls as the service role; name the actor for the movement guard.
 PERFORM set_config('haven.movement_actor', p_actor_id::text, true);
 UPDATE residents SET status='active',admission_date=p_arrival_date,bed_id=b.id,
   status_effective_at=v_at,status_effective_reason=nullif(btrim(coalesce(p_late_entry_reason,'')),''),
   updated_by=p_actor_id WHERE id=r.id;
 UPDATE beds SET status='occupied',current_resident_id=r.id,reserved_for_admission_case_id=NULL,updated_by=p_actor_id WHERE id=b.id;
 PERFORM set_config('haven.admission_arrival_case', c.id::text, true);
 UPDATE admission_cases SET status='move_in',actual_arrival_at=v_at,actual_arrival_precision=CASE WHEN p_arrival_at IS NULL THEN 'date' ELSE 'instant' END,
   arrival_approval_id=approval.id,updated_by=p_actor_id WHERE id=c.id;
 PERFORM set_config('haven.admission_arrival_case', '', true);
 RETURN r.id;
END $$;
REVOKE ALL ON FUNCTION public.confirm_admission_arrival_review(uuid,uuid,date,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_admission_arrival_review(uuid,uuid,date,timestamptz,text) TO service_role;
-- The arrival runs as its caller (the service route); it reads these two checks.
GRANT EXECUTE ON FUNCTION haven.admission_actor_role(uuid, uuid, text[]), haven.admission_arrival_approval_current(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Nothing else records a move-in
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.guard_admission_arrival()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'move_in' OR NEW.actual_arrival_at IS NOT NULL OR NEW.arrival_approval_id IS NOT NULL THEN
      RAISE EXCEPTION 'Move-in is recorded by confirming the actual arrival' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.actual_arrival_at IS NULL AND NEW.actual_arrival_at IS NOT NULL
     AND coalesce(current_setting('haven.admission_arrival_case', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'Arrival is recorded only by confirming it' USING ERRCODE = '42501';
  END IF;
  IF OLD.actual_arrival_at IS NOT NULL AND NEW.actual_arrival_at IS DISTINCT FROM OLD.actual_arrival_at
     AND coalesce(current_setting('haven.admission_arrival_reversal', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'A recorded arrival is changed only by reversing it' USING ERRCODE = '42501';
  END IF;
  IF (NEW.actual_arrival_precision IS DISTINCT FROM OLD.actual_arrival_precision OR NEW.arrival_approval_id IS DISTINCT FROM OLD.arrival_approval_id)
     AND coalesce(current_setting('haven.admission_arrival_case', true), '') <> NEW.id::text
     AND coalesce(current_setting('haven.admission_arrival_reversal', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'Arrival details are recorded only by confirming or reversing the arrival' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'move_in' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.actual_arrival_at IS NULL THEN
    RAISE EXCEPTION 'Move-in is recorded by confirming the actual arrival' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_admission_arrival() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER tr_admission_cases_guard_arrival BEFORE INSERT OR UPDATE ON public.admission_cases
  FOR EACH ROW EXECUTE FUNCTION haven.guard_admission_arrival();

-- ---------------------------------------------------------------------------
-- 5. The referral conversion keeps the arrival's precision
-- ---------------------------------------------------------------------------
-- Migration 520's text; a date-only arrival is recorded on the referral event
-- as a date, never as an invented instant.
CREATE OR REPLACE FUNCTION haven.referral_convert_for_arrival(
  p_admission_case_id uuid,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_case public.admission_cases;
  v_before public.referral_leads;
  v_after public.referral_leads;
  v_opportunity_id uuid;
  v_actor uuid;
  v_role text;
  v_seq integer;
  v_key text;
  v_date_only boolean;
  v_tz text;
BEGIN
  SELECT c.* INTO v_case
  FROM public.admission_cases AS c
  WHERE c.id = p_admission_case_id AND c.deleted_at IS NULL;
  IF NOT FOUND OR v_case.actual_arrival_at IS NULL OR v_case.referral_lead_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT lead.* INTO v_before
  FROM public.referral_leads AS lead
  WHERE lead.id = v_case.referral_lead_id
    AND lead.organization_id = v_case.organization_id
    AND lead.facility_id = v_case.facility_id
    AND lead.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_before.status IN ('converted', 'lost', 'merged') THEN
    RETURN NULL;
  END IF;

  v_actor := coalesce(p_actor_id, v_case.updated_by, v_case.created_by);
  SELECT p.app_role::text INTO v_role
  FROM public.user_profiles AS p
  WHERE p.id = v_actor;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'The arrival must name the person who confirmed it before its referral can be closed'
      USING ERRCODE = '42501';
  END IF;
  v_date_only := v_case.actual_arrival_precision = 'date';
  SELECT coalesce(f.timezone, 'America/New_York') INTO v_tz FROM public.facilities f WHERE f.id = v_case.facility_id;

  PERFORM haven.activate_referral_command(false);

  UPDATE public.referral_leads
  SET status_before_close = status,
      status = 'converted',
      converted_resident_id = v_case.resident_id,
      converted_at = v_case.actual_arrival_at,
      work_state = 'closed',
      waiting_reason = NULL,
      review_reason = NULL,
      follow_up_at = NULL,
      next_action = NULL,
      next_action_at = NULL,
      episode_revision = haven.referral_revision(),
      updated_by = v_actor
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  SELECT coalesce(max(e.event_seq), 0) + 1 INTO v_seq
  FROM public.referral_episode_events AS e
  WHERE e.referral_lead_id = v_after.id;
  v_key := 'arrival:' || v_case.id::text;
  -- An arrival confirmed again after a reversal (539) is a new event, not a replay.
  IF EXISTS (SELECT 1 FROM public.referral_episode_events e WHERE e.organization_id = v_after.organization_id AND e.request_key = v_key) THEN
    v_key := v_key || ':' || (SELECT count(*) + 1 FROM public.referral_episode_events e
      WHERE e.organization_id = v_after.organization_id AND e.request_key LIKE 'arrival:' || v_case.id::text || '%')::text;
  END IF;

  INSERT INTO public.referral_episode_events (
    organization_id, facility_id, referral_lead_id, event_seq, event_kind,
    from_status, to_status, from_work_state, to_work_state,
    effective_precision, effective_at, effective_date, actor_id, actor_role,
    expected_revision, result_revision, request_key, request_hash, source_kind,
    source_reference, details
  ) VALUES (
    v_after.organization_id, v_after.facility_id, v_after.id, v_seq, 'admission_transition',
    v_before.status, v_after.status, v_before.work_state, v_after.work_state,
    CASE WHEN v_date_only THEN 'date' ELSE 'instant' END::public.referral_effective_precision,
    CASE WHEN v_date_only THEN NULL ELSE v_case.actual_arrival_at END,
    CASE WHEN v_date_only THEN (v_case.actual_arrival_at AT TIME ZONE coalesce(v_tz, 'America/New_York'))::date END,
    v_actor, v_role,
    v_before.episode_revision, v_after.episode_revision, v_key,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      v_key || ':' || v_case.resident_id::text || ':' || v_case.actual_arrival_at::text, 'UTF8')), 'hex'),
    'system_compatibility',
    pg_catalog.jsonb_build_object(
      'admission_case_id', v_case.id,
      'admission_case_status', v_case.status,
      'resident_id', v_case.resident_id,
      'actual_arrival_at', v_case.actual_arrival_at,
      'actual_arrival_precision', v_case.actual_arrival_precision,
      'arrival_approval_id', v_case.arrival_approval_id,
      'arrival_proof', 'admission_cases.actual_arrival_at'
    ),
    pg_catalog.jsonb_build_object(
      'admission_case_id', v_case.id,
      'admission_case_status', v_case.status,
      'resident_id', v_case.resident_id,
      'target_status', 'converted'
    )
  );

  SELECT consideration.opportunity_id INTO v_opportunity_id
  FROM public.referral_facility_considerations AS consideration
  WHERE consideration.id = v_after.facility_consideration_id;
  IF v_opportunity_id IS NOT NULL THEN
    PERFORM haven.reconcile_referral_opportunity_state(v_opportunity_id, v_after.organization_id, v_actor);
  END IF;

  PERFORM haven.deactivate_referral_command();
  RETURN v_after.id;
END;
$function$;
REVOKE ALL ON FUNCTION haven.referral_convert_for_arrival(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: DROP TRIGGER tr_admission_cases_guard_arrival ON public.admission_cases;
-- restore migration 504's public.confirm_admission_arrival_review and 520's
-- haven.referral_convert_for_arrival; DROP FUNCTION public.admission_arrival_status,
-- public.admission_arrival_approve, public.admission_arrival_approval_withdraw,
-- haven.admission_arrival_approval_current, haven.admission_arrival_approval_roles,
-- haven.admission_arrival_readiness, haven.guard_admission_arrival; export then
-- drop public.admission_arrival_approvals (drop the case FK first); keep the two
-- admission_cases columns (they record what happened).
