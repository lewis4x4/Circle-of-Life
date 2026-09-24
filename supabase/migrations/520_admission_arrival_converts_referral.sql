-- COL-333 (part of COL-749): a confirmed arrival marks its referral converted.
--
-- Until now the only thing that moved a referral forward from an admission was
-- referral_episode_command('admission_transition'), which stops at
-- application_pending and records 'arrival_conversion_deferred_to' = 'COL-333'.
-- A resident who moved in therefore stayed an open "potential resident" on
-- every referral list, and would have stayed on the Thursday Stand Up list
-- (COL-754) forever.
--
-- The fact that proves arrival is admission_cases.actual_arrival_at, which only
-- confirm_admission_arrival_review sets (504), inside the same transaction that
-- activates the resident, occupies the bed and moves the case to move_in. This
-- migration adds an AFTER UPDATE trigger on that column, so:
--
--   * Atomic: the referral closes as converted in the arrival's transaction. If
--     anything later in that transaction fails, the conversion rolls back with it.
--   * Every writer: the trigger fires whoever sets the arrival, so no entry point
--     can confirm an arrival and leave the referral open. Setting the case to
--     move_in without an actual arrival (the legacy admission PATCH) converts
--     nothing: intake, accepted or ready is not arrival.
--   * Replay-safe: it fires only on the NULL -> NOT NULL transition, the arrival
--     function already returns early for an arrived case, and a lead that is
--     already converted, lost or merged is left exactly as it is. The episode
--     event's request key is unique per admission case, so a second write for the
--     same arrival is refused rather than recorded twice.
--   * Scoped: only the lead named on the case, in the case's own organization and
--     facility. A lead considered for another building is not touched.
--   * Attributable: the event names the person who confirmed the arrival (the
--     route names its actor through haven.movement_actor, 504), falling back to
--     the case's updated_by.
--
-- The lead keeps its history; nothing is deleted. converted_at is the arrival
-- time, converted_resident_id the resident who arrived. closed_at stays null:
-- referral_leads_closure_complete_check reserves it for 'lost'.
--
-- Existing data: an arrived case whose linked lead is still open is converted
-- here by the same helper (0 such leads on staging and production on
-- 2026-09-24: neither has referral leads yet). Leads already marked converted
-- by the old path are not rewritten.
BEGIN;

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

  INSERT INTO public.referral_episode_events (
    organization_id, facility_id, referral_lead_id, event_seq, event_kind,
    from_status, to_status, from_work_state, to_work_state,
    effective_precision, effective_at, effective_date, actor_id, actor_role,
    expected_revision, result_revision, request_key, request_hash, source_kind,
    source_reference, details
  ) VALUES (
    v_after.organization_id, v_after.facility_id, v_after.id, v_seq, 'admission_transition',
    v_before.status, v_after.status, v_before.work_state, v_after.work_state,
    'instant', v_case.actual_arrival_at, NULL, v_actor, v_role,
    v_before.episode_revision, v_after.episode_revision, v_key,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      v_key || ':' || v_case.resident_id::text || ':' || v_case.actual_arrival_at::text, 'UTF8')), 'hex'),
    'system_compatibility',
    pg_catalog.jsonb_build_object(
      'admission_case_id', v_case.id,
      'admission_case_status', v_case.status,
      'resident_id', v_case.resident_id,
      'actual_arrival_at', v_case.actual_arrival_at,
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

REVOKE ALL ON FUNCTION haven.referral_convert_for_arrival(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.referral_convert_for_arrival(uuid, uuid) IS
  'COL-333: closes the referral linked to an arrived admission case as converted (resident and arrival time recorded, one admission_transition event keyed arrival:<case>). No-op when the case has not arrived, has no lead, or the lead is already converted, lost, merged or in another facility. Called only by the admission-case arrival trigger and the one-time backfill in migration 520. COL-37 ruling: definer required -- referral_leads and referral_episode_events are RPC-only (379/380) and the confirming caller is the service role, which cannot execute the referral command helpers.';

CREATE OR REPLACE FUNCTION haven.admission_arrival_converts_referral()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM haven.referral_convert_for_arrival(
    NEW.id,
    coalesce(
      nullif(pg_catalog.current_setting('haven.movement_actor', true), '')::uuid,
      haven.authorized_user_id(),
      NEW.updated_by
    )
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION haven.admission_arrival_converts_referral()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_admission_arrival_converts_referral
  AFTER UPDATE OF actual_arrival_at ON public.admission_cases
  FOR EACH ROW
  WHEN (OLD.actual_arrival_at IS NULL AND NEW.actual_arrival_at IS NOT NULL AND NEW.referral_lead_id IS NOT NULL)
  EXECUTE FUNCTION haven.admission_arrival_converts_referral();

-- Arrived cases whose linked lead is still open (none on either host today).
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT ac.id, coalesce(ac.updated_by, ac.created_by) AS actor
    FROM public.admission_cases AS ac
    JOIN public.referral_leads AS lead ON lead.id = ac.referral_lead_id
    WHERE ac.deleted_at IS NULL
      AND ac.actual_arrival_at IS NOT NULL
      AND lead.deleted_at IS NULL
      AND lead.status NOT IN ('converted', 'lost', 'merged')
  LOOP
    PERFORM haven.referral_convert_for_arrival(c.id, c.actor);
  END LOOP;
END $$;

COMMIT;

-- Rollback: DROP TRIGGER tr_admission_arrival_converts_referral ON
-- public.admission_cases; DROP FUNCTION haven.admission_arrival_converts_referral();
-- DROP FUNCTION haven.referral_convert_for_arrival(uuid,uuid). Converted leads
-- and their events stay: a real arrival is not undone by a lone lead reset.
