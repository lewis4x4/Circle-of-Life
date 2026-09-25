-- COL-333: starting an intake from a referral is one server transaction.
--
-- Characterization (the browser path this replaces, admissions/new "From a
-- referral"): the page inserted an inquiry resident straight from the browser
-- (gender invented as prefer_not_to_say), remembered its id in sessionStorage,
-- then called POST /api/admin/workflows/admission-cases, which created the case
-- (create_admission_case_review) and, in a later separate write, moved the lead
-- to application_pending through referral_episode_command('admission_transition').
-- Three writes, three transactions: a failed case left an orphan inquiry
-- resident, a lost response or a second tab created a second resident for the
-- same referral, and a failed lead step left an open case under a lead that
-- still read as a tour.
--
-- public.admission_intake_start(actor, payload) does all of it in one
-- transaction, locked on the placement episode (the referral lead):
--
--   * Authority: the actor is an active user of the lead's organization holding
--     an admissions role (owner, org_admin, facility_admin, manager,
--     admin_assistant, coordinator, med_tech, the admission-case route's roles)
--     with current access to the facility. Recruiters do not start intakes. The
--     check runs inside the transaction, so a revoked actor is refused even if
--     the route admitted them a moment earlier.
--   * The lead must be open (not converted, lost or merged) and in the named
--     facility; a wrong facility is refused, never re-scoped.
--   * Replay: every request carries a request id. The durable receipt
--     (public.admission_intake_receipts) returns the same result for the same
--     request, so a lost response is recovered by retrying, and the same id with
--     a different request is refused ("Idempotency key payload differs").
--   * One case per referral: a second tab or a second user starting the same
--     referral gets the case that already exists (outcome already_started),
--     never a second resident or case. A draft is submitted by starting it
--     again with intent submit (outcome submitted_draft).
--   * The inquiry resident is created from the lead with gender left null:
--     unknown is recorded as unknown (321 made gender nullable for inquiries);
--     arrival still requires it.
--   * Submitting moves the lead to application_pending with one
--     admission_transition event keyed intake:<case>. Intake linkage is not
--     conversion: only a confirmed arrival converts a referral (520).
--
-- Legacy status mapping (for COL-333's characterization; nothing is rewritten):
--   admission_cases.status   draft               lead unchanged
--                            pending_clearance   lead application_pending (intake)
--                            bed_reserved        lead application_pending
--                            move_in             only with actual_arrival_at (538):
--                                                lead converted (520)
--                            cancelled           lead unchanged (reopen or close it
--                                                through the referral commands)
-- Prior records that need a person's review are listed by
-- public.referral_conversion_reconciliation() (539); their outcomes are never
-- rewritten automatically.
BEGIN;

-- ---------------------------------------------------------------------------
-- Who may act on an admission, at a facility, right now
-- ---------------------------------------------------------------------------
-- The actor's login role when they are active in the facility's organization,
-- hold one of p_roles and can reach the facility (owner and org_admin reach
-- every facility of their organization); null otherwise.
CREATE FUNCTION haven.admission_actor_role(p_actor uuid, p_facility uuid, p_roles text[])
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.app_role::text
  FROM public.user_profiles p
  JOIN public.facilities f ON f.id = p_facility AND f.organization_id = p.organization_id AND f.deleted_at IS NULL
  WHERE p.id = p_actor AND p.is_active AND p.deleted_at IS NULL
    AND p.app_role::text = ANY (p_roles)
    AND (p.app_role::text IN ('owner', 'org_admin') OR EXISTS (
      SELECT 1 FROM public.user_facility_access u
      WHERE u.user_id = p.id AND u.facility_id = p_facility AND u.organization_id = p.organization_id AND u.revoked_at IS NULL))
$$;
REVOKE ALL ON FUNCTION haven.admission_actor_role(uuid, uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One referral event written by an admission step
-- ---------------------------------------------------------------------------
-- Moves the lead to p_to_status (or leaves the status when it is the same),
-- and records one admission_transition event under p_key. Replay-safe: a key
-- already recorded for the organization is a no-op returning null. Used by the
-- intake (application_pending), the arrival reversal (back from converted) and
-- the arrival linkage events (return and transfer), all of which run as the
-- service route or a trigger, never as the referral's own command.
CREATE FUNCTION haven.referral_admission_event(
  p_lead uuid,
  p_case uuid,
  p_actor uuid,
  p_key text,
  p_to_status public.referral_lead_status,
  p_details jsonb,
  p_precision public.referral_effective_precision,
  p_effective_at timestamptz,
  p_effective_date date
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_before public.referral_leads; v_after public.referral_leads; v_role text; v_seq integer; v_event uuid; v_opportunity uuid;
BEGIN
  SELECT lead.* INTO v_before FROM public.referral_leads lead WHERE lead.id = p_lead AND lead.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.referral_episode_events e WHERE e.organization_id = v_before.organization_id AND e.request_key = p_key) THEN
    RETURN NULL;
  END IF;
  SELECT p.app_role::text INTO v_role FROM public.user_profiles p WHERE p.id = p_actor;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'The admission step must name the person who took it' USING ERRCODE = '42501';
  END IF;
  PERFORM haven.activate_referral_command(false);
  IF p_to_status IS DISTINCT FROM v_before.status THEN
    UPDATE public.referral_leads
    SET status = p_to_status,
        episode_revision = haven.referral_revision(),
        updated_by = p_actor
    WHERE id = v_before.id
    RETURNING * INTO v_after;
  ELSE
    v_after := v_before;
  END IF;
  SELECT coalesce(max(e.event_seq), 0) + 1 INTO v_seq FROM public.referral_episode_events e WHERE e.referral_lead_id = v_before.id;
  INSERT INTO public.referral_episode_events (
    organization_id, facility_id, referral_lead_id, event_seq, event_kind,
    from_status, to_status, from_work_state, to_work_state,
    effective_precision, effective_at, effective_date, actor_id, actor_role,
    expected_revision, result_revision, request_key, request_hash, source_kind,
    source_reference, details
  ) VALUES (
    v_before.organization_id, v_before.facility_id, v_before.id, v_seq, 'admission_transition',
    v_before.status, v_after.status, v_before.work_state, v_after.work_state,
    p_precision, CASE WHEN p_precision = 'instant' THEN p_effective_at END, CASE WHEN p_precision = 'date' THEN p_effective_date END,
    p_actor, v_role, v_before.episode_revision, v_after.episode_revision, p_key,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_key || ':' || coalesce(p_details::text, ''), 'UTF8')), 'hex'),
    'system_compatibility',
    jsonb_build_object('admission_case_id', p_case) || coalesce(p_details, '{}'::jsonb),
    coalesce(p_details, '{}'::jsonb)
  ) RETURNING id INTO v_event;
  SELECT c.opportunity_id INTO v_opportunity FROM public.referral_facility_considerations c WHERE c.id = v_after.facility_consideration_id;
  IF v_opportunity IS NOT NULL AND p_to_status IS DISTINCT FROM v_before.status THEN
    PERFORM haven.reconcile_referral_opportunity_state(v_opportunity, v_after.organization_id, p_actor);
  END IF;
  PERFORM haven.deactivate_referral_command();
  RETURN v_event;
END $$;
REVOKE ALL ON FUNCTION haven.referral_admission_event(uuid, uuid, uuid, text, public.referral_lead_status, jsonb, public.referral_effective_precision, timestamptz, date)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The durable receipt
-- ---------------------------------------------------------------------------
CREATE TABLE public.admission_intake_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  referral_lead_id uuid NOT NULL REFERENCES public.referral_leads(id),
  request_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  actor_role text NOT NULL,
  request_hash text NOT NULL,
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  admission_case_id uuid NOT NULL REFERENCES public.admission_cases(id),
  outcome text NOT NULL CHECK (outcome IN ('started_draft', 'started', 'submitted_draft', 'already_started')),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_admission_intake_receipts_referral_lead_id ON public.admission_intake_receipts(referral_lead_id, created_at);
CREATE INDEX idx_admission_intake_receipts_organization_id ON public.admission_intake_receipts(organization_id);
CREATE INDEX idx_admission_intake_receipts_facility_id ON public.admission_intake_receipts(facility_id);
CREATE INDEX idx_admission_intake_receipts_admission_case_id ON public.admission_intake_receipts(admission_case_id);
CREATE INDEX idx_admission_intake_receipts_resident_id ON public.admission_intake_receipts(resident_id);
CREATE INDEX idx_admission_intake_receipts_actor_id ON public.admission_intake_receipts(actor_id);
CREATE TRIGGER admission_intake_receipt_immutable BEFORE UPDATE OR DELETE ON public.admission_intake_receipts
  FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
ALTER TABLE public.admission_intake_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admission_intake_receipts FROM PUBLIC, anon, authenticated, service_role;
-- COL-627: a resident table decides for housekeepers; this one denies them.
CREATE POLICY "Housekeepers see resident name and room only" ON public.admission_intake_receipts
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
COMMENT ON TABLE public.admission_intake_receipts IS
  'COL-333: one row per intake request started from a referral, written by public.admission_intake_start in the same transaction as the resident, case and referral step it reports. Replaying the request returns result. Append only.';

-- ---------------------------------------------------------------------------
-- The transaction
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admission_intake_start(p_actor_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_request uuid; v_lead_id uuid; v_facility uuid; v_intent text; v_hash text;
  v_receipt public.admission_intake_receipts; v_lead public.referral_leads; v_role text; v_org uuid;
  v_case public.admission_cases; v_resident uuid; v_outcome text; v_result jsonb; v_today date; v_tz text;
  v_target date; v_bed uuid; v_status public.admission_case_status;
  allowed_keys constant text[] := ARRAY['request_id','facility_id','referral_lead_id','intent','bed_id','target_move_in_date','notes',
    'intake_program_type','anticipated_payer_source','anticipated_payer_other','medicaid_pipeline_stage'];
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k <> ALL (allowed_keys)) THEN
    RAISE EXCEPTION 'Invalid intake request' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_request := (p_payload ->> 'request_id')::uuid;
    v_lead_id := (p_payload ->> 'referral_lead_id')::uuid;
    v_facility := (p_payload ->> 'facility_id')::uuid;
    v_bed := nullif(p_payload ->> 'bed_id', '')::uuid;
    v_target := nullif(p_payload ->> 'target_move_in_date', '')::date;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'Invalid intake request' USING ERRCODE = '22023';
  END;
  v_intent := coalesce(p_payload ->> 'intent', 'submit');
  IF v_request IS NULL OR v_lead_id IS NULL OR v_facility IS NULL OR v_intent NOT IN ('draft', 'submit') THEN
    RAISE EXCEPTION 'Referral, facility, request and intent are required' USING ERRCODE = '22023';
  END IF;
  v_hash := md5(p_payload::text || ':' || p_actor_id::text);

  -- The placement episode is the lock: every intake for this referral waits here.
  PERFORM pg_advisory_xact_lock(hashtextextended('referral-intake:' || v_lead_id::text, 0));

  SELECT * INTO v_receipt FROM public.admission_intake_receipts WHERE request_id = v_request;
  IF FOUND THEN
    IF v_receipt.request_hash <> v_hash THEN
      RAISE EXCEPTION 'Idempotency key payload differs' USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.result || jsonb_build_object('replayed', true);
  END IF;

  SELECT lead.* INTO v_lead FROM public.referral_leads lead WHERE lead.id = v_lead_id AND lead.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_lead.facility_id <> v_facility THEN
    RAISE EXCEPTION 'Referral lead not found in facility' USING ERRCODE = '22023';
  END IF;
  v_org := v_lead.organization_id;
  v_role := haven.admission_actor_role(p_actor_id, v_facility,
    ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech']);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You no longer have access to start an intake at this facility' USING ERRCODE = '42501';
  END IF;
  IF v_lead.status IN ('converted', 'lost', 'merged') THEN
    RAISE EXCEPTION 'This referral is closed (%). Reopen it before starting an intake', v_lead.status USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(f.timezone, 'America/New_York') INTO v_tz FROM public.facilities f WHERE f.id = v_facility;
  v_today := (clock_timestamp() AT TIME ZONE v_tz)::date;
  IF v_intent = 'submit' AND (v_target IS NULL OR v_target < v_today) THEN
    RAISE EXCEPTION 'A target move-in date of today or later is required' USING ERRCODE = '22023';
  END IF;
  IF v_bed IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.beds b WHERE b.id = v_bed AND b.facility_id = v_facility AND b.organization_id = v_org AND b.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Bed not found in this facility' USING ERRCODE = '22023';
  END IF;

  -- One case per referral.
  SELECT c.* INTO v_case FROM public.admission_cases c
  WHERE c.referral_lead_id = v_lead.id AND c.deleted_at IS NULL AND c.status::text NOT IN ('cancelled', 'closed')
  ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    v_resident := v_case.resident_id;
    IF v_intent = 'submit' AND v_case.status = 'draft' THEN
      UPDATE public.admission_cases
      SET status = 'pending_clearance',
          target_move_in_date = v_target,
          bed_id = coalesce(v_bed, bed_id),
          notes = CASE WHEN p_payload ? 'notes' THEN nullif(btrim(p_payload ->> 'notes'), '') ELSE notes END,
          intake_program_type = CASE WHEN p_payload ? 'intake_program_type' THEN nullif(btrim(p_payload ->> 'intake_program_type'), '') ELSE intake_program_type END,
          anticipated_payer_source = CASE WHEN p_payload ? 'anticipated_payer_source' THEN nullif(p_payload ->> 'anticipated_payer_source', '')::public.anticipated_payer_source ELSE anticipated_payer_source END,
          anticipated_payer_other = CASE WHEN p_payload ? 'anticipated_payer_other' THEN nullif(btrim(p_payload ->> 'anticipated_payer_other'), '') ELSE anticipated_payer_other END,
          updated_by = p_actor_id
      WHERE id = v_case.id RETURNING * INTO v_case;
      v_outcome := 'submitted_draft';
    ELSE
      v_outcome := 'already_started';
    END IF;
  ELSE
    -- The inquiry resident: an earlier intake of this referral whose case was
    -- cancelled leaves its resident, which is resumed rather than duplicated.
    SELECT r.id INTO v_resident
    FROM public.admission_intake_receipts x JOIN public.residents r ON r.id = x.resident_id
    WHERE x.referral_lead_id = v_lead.id AND r.deleted_at IS NULL AND r.status = 'inquiry' AND r.facility_id = v_facility
    ORDER BY x.created_at DESC LIMIT 1;
    IF v_resident IS NULL THEN
      INSERT INTO public.residents (facility_id, organization_id, first_name, last_name, preferred_name, date_of_birth, gender, status,
        referral_source_id, created_by, updated_by)
      VALUES (v_facility, v_org, btrim(v_lead.first_name), btrim(v_lead.last_name), nullif(btrim(coalesce(v_lead.preferred_name, '')), ''),
        v_lead.date_of_birth, NULL, 'inquiry', v_lead.referral_source_id, p_actor_id, p_actor_id)
      RETURNING id INTO v_resident;
    END IF;
    v_status := CASE WHEN v_intent = 'draft' THEN 'draft' ELSE 'pending_clearance' END;
    INSERT INTO public.admission_cases (organization_id, facility_id, resident_id, referral_lead_id, bed_id, target_move_in_date, notes,
      intake_program_type, medicaid_pipeline_stage, anticipated_payer_source, anticipated_payer_other, status, create_request_id,
      creation_request_hash, created_by, updated_by)
    VALUES (v_org, v_facility, v_resident, v_lead.id, v_bed, v_target, nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'intake_program_type', '')), ''), coalesce(nullif(p_payload ->> 'medicaid_pipeline_stage', ''), 'prospect'),
      nullif(p_payload ->> 'anticipated_payer_source', '')::public.anticipated_payer_source,
      nullif(btrim(coalesce(p_payload ->> 'anticipated_payer_other', '')), ''), v_status, v_request, v_hash, p_actor_id, p_actor_id)
    RETURNING * INTO v_case;
    v_outcome := CASE WHEN v_intent = 'draft' THEN 'started_draft' ELSE 'started' END;
  END IF;

  -- Submitting links the referral to its intake. It is not a conversion.
  IF v_case.status <> 'draft' AND v_lead.status NOT IN ('application_pending', 'waitlisted') THEN
    PERFORM haven.referral_admission_event(v_lead.id, v_case.id, p_actor_id, 'intake:' || v_case.id::text, 'application_pending',
      jsonb_build_object('admission_case_status', v_case.status, 'resident_id', v_resident, 'intake_request_id', v_request,
        'arrival_conversion', 'on confirmed arrival only'),
      'instant', clock_timestamp(), NULL);
  END IF;

  SELECT jsonb_build_object('resident_id', v_resident, 'admission_case_id', v_case.id, 'admission_case_status', v_case.status,
    'referral_lead_id', v_lead.id, 'lead_status', lead.status, 'outcome', v_outcome, 'replayed', false)
    INTO v_result FROM public.referral_leads lead WHERE lead.id = v_lead.id;
  INSERT INTO public.admission_intake_receipts (organization_id, facility_id, referral_lead_id, request_id, actor_id, actor_role, request_hash,
    resident_id, admission_case_id, outcome, result)
  VALUES (v_org, v_facility, v_lead.id, v_request, p_actor_id, v_role, v_hash, v_resident, v_case.id, v_outcome, v_result);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admission_intake_start(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admission_intake_start(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.admission_intake_start(uuid, jsonb) IS
  'COL-333: starts (or resumes, or submits) the intake for one referral in one transaction locked on the referral: inquiry resident (gender left unknown), admission case, the referral''s move to application_pending on submit, and a durable receipt. Replay-safe by request_id. Called only by the admissions route with the service role, naming the actor, who is re-checked here. COL-37 ruling: definer required -- it writes residents, admission_cases and the RPC-only referral tables in one transaction for a caller the route has authenticated.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: DROP FUNCTION public.admission_intake_start(uuid,jsonb),
-- haven.referral_admission_event(...), haven.admission_actor_role(uuid,uuid,text[]);
-- export then DROP TABLE public.admission_intake_receipts. Residents, cases and
-- referral events it wrote stay: they are real records.
