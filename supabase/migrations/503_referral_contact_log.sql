-- Referral contact log: recruiters and referral staff log every contact with a
-- prospective resident (how, with whom, what was said, what happens next), and
-- read the whole history back on the lead.
--
-- 1. record_interaction gains three optional payload keys, stored in the
--    immutable event details: method (how the contact happened), contacted_name
--    (who was reached, as said by the person logging it) and person_contact_id
--    (a contact already linked to this prospective resident). Earlier callers
--    that send none of them keep working unchanged.
-- 2. referral_episode_history_read returns each event's actor_name (the reader
--    may not be able to read other staff profiles directly) and shows work-note
--    details (interactions, next steps, ownership, waiting/review) to the
--    people who may already read the prospect's phone and email
--    (contact_read), on every lead that is not public_summary. Clinical-tier
--    gating of lead notes, date of birth and clinical_precheck details is
--    unchanged.
--
-- Both functions are replaced from their 380 text with only the changes above;
-- comments (COL-37 rulings) and grants survive CREATE OR REPLACE.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type AS t
    JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'referral_interaction_method'
  ) THEN
    CREATE TYPE public.referral_interaction_method AS ENUM (
      'phone_call', 'voicemail', 'text_message', 'email', 'in_person',
      'video_call', 'mail', 'other'
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.referral_episode_command(
  p_episode_id uuid,
  p_request_key text,
  p_expected_revision text,
  p_command text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_problem text;
  v_allowed_keys text[];
  v_actor_id uuid;
  v_organization_id uuid;
  v_request_hash text;
  v_source_kind text := 'native';
  v_source_reference jsonb := '{}'::jsonb;
  v_episode public.referral_leads;
  v_before public.referral_leads;
  v_replayed public.referral_episode_events;
  v_event public.referral_episode_events;
  v_event_kind text;
  v_effective_precision public.referral_effective_precision := 'instant';
  v_effective_at timestamptz := pg_catalog.clock_timestamp();
  v_effective_date date;
  v_owner_id uuid;
  v_backup_id uuid;
  v_reason text;
  v_note text;
  v_follow_up_at timestamptz;
  v_next_action text;
  v_next_action_at timestamptz;
  v_interest public.referral_interest_state;
  v_closure_reason_id uuid;
  v_closed_by_party text;
  v_historical_unknown boolean;
  v_is_historical boolean;
  v_relationship_id uuid;
  v_contact_id uuid;
  v_person_id uuid;
  v_current_consideration public.referral_facility_considerations;
  v_replacement_consideration public.referral_facility_considerations;
  v_current_opportunity public.referral_opportunities;
  v_current_person public.referral_people;
  v_target_opportunity public.referral_opportunities;
  v_target_opportunity_revision text;
  v_target_person public.referral_people;
  v_target_episode public.referral_leads;
  v_review jsonb;
  v_live_review jsonb;
  v_correction_id uuid;
  v_related_correction public.referral_identity_corrections;
  v_replacement_sequence integer;
  v_permission_state public.referral_contact_permission_state;
  v_channel public.referral_contact_channel;
  v_status public.referral_lead_status;
  v_admission_id uuid;
  v_admission public.admission_cases;
  v_method public.referral_interaction_method;
  v_contacted_name text;
  v_person_contact_id uuid;
BEGIN
  CASE p_command
    WHEN 'assign' THEN
      v_allowed_keys := ARRAY['owner_user_id','backup_user_id','next_action','next_action_at','override_reason','source_kind','source_reference'];
    WHEN 'accept_coverage' THEN
      v_allowed_keys := ARRAY['coverage_reason','source_kind','source_reference'];
    WHEN 'record_interaction' THEN
      v_allowed_keys := ARRAY['summary','method','contacted_name','person_contact_id','effective_precision','effective_at','effective_date','next_action','next_action_at','source_kind','source_reference'];
    WHEN 'wait' THEN
      v_allowed_keys := ARRAY['reason','follow_up_at','source_kind','source_reference'];
    WHEN 'review' THEN
      v_allowed_keys := ARRAY['reason','follow_up_at','source_kind','source_reference'];
    WHEN 'resume' THEN
      v_allowed_keys := ARRAY['reason','source_kind','source_reference'];
    WHEN 'next_action' THEN
      v_allowed_keys := ARRAY['next_action','next_action_at','source_kind','source_reference'];
    WHEN 'interest' THEN
      v_allowed_keys := ARRAY['interest_state','effective_precision','effective_at','effective_date','source_kind','source_reference'];
    WHEN 'close' THEN
      v_allowed_keys := ARRAY['closure_reason_id','closed_by_party','closure_note','competitor_chosen','historical_outcome_unknown','is_historical','effective_precision','effective_at','effective_date','source_kind','source_reference'];
    WHEN 'reopen' THEN
      v_allowed_keys := ARRAY['reason','source_kind','source_reference'];
    WHEN 'contact_add' THEN
      v_allowed_keys := ARRAY['first_name','last_name','phone','email','relationship','is_primary','source_kind','source_reference'];
    WHEN 'contact_link' THEN
      v_allowed_keys := ARRAY['contact_id','relationship','is_primary','source_kind','source_reference'];
    WHEN 'contact_permission' THEN
      v_allowed_keys := ARRAY['person_contact_id','channel','permission_state','evidence_note','source_kind','source_reference'];
    WHEN 'identity_merge' THEN
      v_allowed_keys := ARRAY['target_opportunity_id','target_opportunity_revision','reason','downstream_review','source_kind','source_reference'];
    WHEN 'identity_split' THEN
      v_allowed_keys := ARRAY['reason','downstream_review','source_kind','source_reference'];
    WHEN 'identity_undo' THEN
      v_allowed_keys := ARRAY['correction_id','reason','downstream_review','source_kind','source_reference'];
    WHEN 'admission_transition' THEN
      v_allowed_keys := ARRAY['admission_case_id','target_status'];
    WHEN 'compatibility_update' THEN
      v_allowed_keys := ARRAY['status','tour_scheduled_for','tour_completed_at','source_kind','source_reference'];
    ELSE
      RAISE EXCEPTION 'Unsupported referral episode command' USING ERRCODE = '22023';
  END CASE;

  v_problem := haven.referral_request_problem(
    p_request_key, p_expected_revision, p_payload, v_allowed_keys
  );
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023';
  END IF;

  v_actor_id := haven.authorized_user_id();
  v_organization_id := haven.organization_id();
  IF v_actor_id IS NULL OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Referral write authority required' USING ERRCODE = '42501';
  END IF;
  v_source_kind := CASE WHEN p_command = 'admission_transition'
    THEN 'system_compatibility'
    ELSE COALESCE(haven.referral_text(p_payload, 'source_kind', 40), 'native')
  END;
  IF v_source_kind NOT IN ('native', 'import', 'outage_replay', 'hl7', 'system_compatibility') THEN
    RAISE EXCEPTION 'Unsupported referral source kind' USING ERRCODE = '22023';
  END IF;
  IF v_source_kind IN ('hl7', 'system_compatibility')
     AND NOT haven.referral_internal_source_active()
     AND p_command <> 'admission_transition' THEN
    RAISE EXCEPTION 'Internal referral provenance cannot be asserted by this caller'
      USING ERRCODE = '42501';
  END IF;
  IF v_source_kind IN ('import', 'outage_replay')
     AND NOT haven.referral_capability('source_manage') THEN
    RAISE EXCEPTION 'Referral source management authority required' USING ERRCODE = '42501';
  END IF;
  v_source_reference := COALESCE(p_payload -> 'source_reference', '{}'::jsonb);
  IF pg_catalog.jsonb_typeof(v_source_reference) <> 'object' THEN
    RAISE EXCEPTION 'source_reference must be an object' USING ERRCODE = '22023';
  END IF;

  v_request_hash := haven.referral_request_hash(
    pg_catalog.jsonb_build_object(
      'command', p_command,
      'episode_id', p_episode_id,
      'expected_revision', p_expected_revision,
      'payload', p_payload
    )
  );
  PERFORM haven.referral_request_lock(v_organization_id, p_request_key);
  IF p_command = 'admission_transition' THEN
    IF NOT haven.referral_capability('lead_read') THEN
      RAISE EXCEPTION 'Referral read authority required for admission reconciliation'
        USING ERRCODE = '42501';
    END IF;
    SELECT lead.* INTO v_episode
    FROM public.referral_leads AS lead
    WHERE lead.id = p_episode_id
      AND lead.organization_id = v_organization_id
      AND lead.deleted_at IS NULL
      AND haven.has_facility_access(lead.facility_id)
    FOR UPDATE;
    IF NOT FOUND OR NOT haven.referral_capability('lead_read')
       OR NOT haven.has_facility_access(v_episode.facility_id) THEN
      RAISE EXCEPTION 'Referral admission reconciliation scope unavailable'
        USING ERRCODE = '42501';
    END IF;
    PERFORM haven.lock_referral_actor_authority(
      v_episode.organization_id, v_episode.facility_id, 'lead_read'
    );
  ELSE
    v_episode := haven.lock_referral_episode(p_episode_id);
  END IF;
  v_replayed := haven.referral_replay(
    v_organization_id, p_episode_id, p_request_key, v_request_hash
  );
  IF v_replayed.id IS NOT NULL THEN
    RETURN haven.referral_episode_reply(v_episode, v_replayed, true);
  END IF;
  IF p_expected_revision IS DISTINCT FROM v_episode.episode_revision THEN
    RAISE EXCEPTION 'Referral episode changed; reload before saving'
      USING ERRCODE = '40001';
  END IF;
  v_before := v_episode;

  IF p_command IN ('record_interaction', 'interest', 'close') THEN
    BEGIN
      v_effective_precision := COALESCE(
        (haven.referral_text(p_payload, 'effective_precision', 20))::public.referral_effective_precision,
        'unknown'
      );
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Unsupported referral effective precision' USING ERRCODE = '22023';
    END;
    v_effective_at := haven.referral_timestamp(p_payload, 'effective_at');
    v_effective_date := haven.referral_date(p_payload, 'effective_date');
    IF NOT (
      (v_effective_precision = 'unknown' AND v_effective_at IS NULL AND v_effective_date IS NULL)
      OR (v_effective_precision = 'date' AND v_effective_at IS NULL AND v_effective_date IS NOT NULL)
      OR (v_effective_precision = 'instant' AND v_effective_at IS NOT NULL AND v_effective_date IS NULL)
    ) THEN
      RAISE EXCEPTION 'Referral effective value does not match its precision'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT consideration.* INTO STRICT v_current_consideration
  FROM public.referral_facility_considerations AS consideration
  WHERE consideration.id = v_episode.facility_consideration_id
    AND consideration.organization_id = v_episode.organization_id
    AND consideration.facility_id = v_episode.facility_id
    AND consideration.deleted_at IS NULL
  FOR UPDATE;
  SELECT opportunity.* INTO STRICT v_current_opportunity
  FROM public.referral_opportunities AS opportunity
  WHERE opportunity.id = v_current_consideration.opportunity_id
    AND opportunity.organization_id = v_episode.organization_id
    AND opportunity.deleted_at IS NULL
  FOR UPDATE;
  SELECT person.* INTO STRICT v_current_person
  FROM public.referral_people AS person
  WHERE person.id = v_current_opportunity.person_id
    AND person.organization_id = v_episode.organization_id
    AND person.deleted_at IS NULL
  FOR UPDATE;

  PERFORM haven.activate_referral_command(false);

  IF p_command = 'assign' THEN
    IF v_episode.work_state = 'closed' THEN
      RAISE EXCEPTION 'Closed referral cannot be assigned' USING ERRCODE = '22023';
    END IF;
    v_owner_id := haven.referral_uuid(p_payload, 'owner_user_id');
    v_backup_id := haven.referral_uuid(p_payload, 'backup_user_id');
    v_reason := haven.referral_text(p_payload, 'override_reason', 2000);
    PERFORM 1
    FROM public.user_profiles AS profile
    WHERE profile.id IN (v_owner_id, v_backup_id)
    FOR SHARE;
    IF v_owner_id IS NULL
       OR NOT haven.referral_staff_current_for_facility(
         v_owner_id, v_episode.organization_id, v_episode.facility_id
       ) THEN
      RAISE EXCEPTION 'Referral owner is not current for this facility'
        USING ERRCODE = '22023';
    END IF;
    IF v_backup_id IS NOT NULL AND (
      v_backup_id = v_owner_id
      OR NOT haven.referral_staff_current_for_facility(
        v_backup_id, v_episode.organization_id, v_episode.facility_id
      )
    ) THEN
      RAISE EXCEPTION 'Referral backup is not current and distinct for this facility'
        USING ERRCODE = '22023';
    END IF;
    v_next_action := haven.referral_text(p_payload, 'next_action', 2000);
    v_next_action_at := haven.referral_timestamp(p_payload, 'next_action_at');
    IF (v_next_action IS NULL) <> (v_next_action_at IS NULL) THEN
      RAISE EXCEPTION 'Next action and due time must be supplied together'
        USING ERRCODE = '22023';
    END IF;
    IF v_episode.owner_user_id IS NOT NULL
       AND v_owner_id IS DISTINCT FROM v_episode.owner_user_id
       AND v_reason IS NULL THEN
      IF v_actor_id IS DISTINCT FROM v_episode.owner_user_id
         AND haven.app_role() NOT IN ('owner', 'org_admin', 'facility_admin') THEN
        RAISE EXCEPTION 'Only the accountable owner or a referral supervisor can request handoff'
          USING ERRCODE = '42501';
      END IF;
      UPDATE public.referral_leads
      SET pending_owner_user_id = v_owner_id,
          pending_backup_user_id = v_backup_id,
          ownership_handoff_requested_at = pg_catalog.clock_timestamp(),
          ownership_handoff_requested_by = v_actor_id,
          next_action = CASE WHEN p_payload ? 'next_action' THEN v_next_action ELSE next_action END,
          next_action_at = CASE WHEN p_payload ? 'next_action_at' THEN v_next_action_at ELSE next_action_at END,
          episode_revision = haven.referral_revision(),
          updated_by = v_actor_id
      WHERE id = v_episode.id
      RETURNING * INTO v_episode;
      v_event_kind := 'ownership_handoff_requested';
    ELSE
      IF v_reason IS NOT NULL
         AND (v_episode.owner_user_id IS NULL
           OR v_owner_id IS NOT DISTINCT FROM v_episode.owner_user_id) THEN
        RAISE EXCEPTION 'Ownership override reason requires an owner replacement'
          USING ERRCODE = '22023';
      END IF;
      IF v_episode.owner_user_id IS NOT NULL
         AND v_owner_id IS DISTINCT FROM v_episode.owner_user_id
         AND haven.app_role() NOT IN ('owner', 'org_admin', 'facility_admin') THEN
        RAISE EXCEPTION 'Only a referral supervisor can override ownership'
          USING ERRCODE = '42501';
      END IF;
      UPDATE public.referral_leads
      SET owner_user_id = v_owner_id,
          backup_user_id = v_backup_id,
          ownership_accepted_at = CASE WHEN v_reason IS NULL THEN NULL
            ELSE pg_catalog.clock_timestamp() END,
          ownership_accepted_by = CASE WHEN v_reason IS NULL THEN NULL ELSE v_actor_id END,
          pending_owner_user_id = NULL,
          pending_backup_user_id = NULL,
          ownership_handoff_requested_at = NULL,
          ownership_handoff_requested_by = NULL,
          work_state = 'assigned',
          waiting_reason = NULL,
          review_reason = NULL,
          follow_up_at = NULL,
          next_action = v_next_action,
          next_action_at = v_next_action_at,
          episode_revision = haven.referral_revision(),
          updated_by = v_actor_id
      WHERE id = v_episode.id
      RETURNING * INTO v_episode;
      v_event_kind := CASE WHEN v_reason IS NULL THEN 'assigned'
                           ELSE 'ownership_overridden' END;
    END IF;

  ELSIF p_command = 'accept_coverage' THEN
    IF v_episode.work_state = 'closed'
       OR (v_actor_id IS DISTINCT FROM v_episode.owner_user_id
           AND v_actor_id IS DISTINCT FROM v_episode.backup_user_id
           AND v_actor_id IS DISTINCT FROM v_episode.pending_owner_user_id) THEN
      RAISE EXCEPTION 'Referral coverage is unavailable' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.user_profiles AS profile
    WHERE profile.id = v_actor_id FOR SHARE;
    IF NOT haven.referral_staff_current_for_facility(
      v_actor_id, v_episode.organization_id, v_episode.facility_id
    ) THEN
      RAISE EXCEPTION 'Referral coverage actor is no longer current'
        USING ERRCODE = '42501';
    END IF;
    v_reason := haven.referral_text(p_payload, 'coverage_reason', 2000);
    IF v_actor_id = v_episode.backup_user_id
       AND haven.referral_staff_current_for_facility(
         v_episode.owner_user_id, v_episode.organization_id, v_episode.facility_id
       )
       AND v_reason IS NULL THEN
      RAISE EXCEPTION 'Backup coverage requires a reason while the owner is current'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.referral_leads
    SET owner_user_id = CASE WHEN v_actor_id = pending_owner_user_id
          THEN pending_owner_user_id ELSE owner_user_id END,
        backup_user_id = CASE WHEN v_actor_id = pending_owner_user_id
          THEN pending_backup_user_id ELSE backup_user_id END,
        ownership_accepted_at = pg_catalog.clock_timestamp(),
        ownership_accepted_by = v_actor_id,
        pending_owner_user_id = CASE WHEN v_actor_id = pending_owner_user_id
          THEN NULL ELSE pending_owner_user_id END,
        pending_backup_user_id = CASE WHEN v_actor_id = pending_owner_user_id
          THEN NULL ELSE pending_backup_user_id END,
        ownership_handoff_requested_at = CASE WHEN v_actor_id = pending_owner_user_id
          THEN NULL ELSE ownership_handoff_requested_at END,
        ownership_handoff_requested_by = CASE WHEN v_actor_id = pending_owner_user_id
          THEN NULL ELSE ownership_handoff_requested_by END,
        work_state = 'assigned',
        episode_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;
    v_event_kind := 'coverage_accepted';

  ELSIF p_command = 'record_interaction' THEN
    IF v_episode.work_state = 'closed' THEN
      RAISE EXCEPTION 'Closed referral cannot receive an interaction or next action'
        USING ERRCODE = '22023';
    END IF;
    v_note := haven.referral_text(p_payload, 'summary', 4000);
    IF v_note IS NULL THEN
      RAISE EXCEPTION 'Interaction summary is required' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_method := (haven.referral_text(p_payload, 'method', 40))::public.referral_interaction_method;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Unsupported contact method' USING ERRCODE = '22023';
    END;
    v_contacted_name := haven.referral_text(p_payload, 'contacted_name', 200);
    v_person_contact_id := haven.referral_uuid(p_payload, 'person_contact_id');
    IF v_person_contact_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.referral_person_contacts AS relationship
      WHERE relationship.id = v_person_contact_id
        AND relationship.organization_id = v_episode.organization_id
        AND relationship.person_id = v_current_person.id
        AND relationship.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Contact is not linked to this prospective resident'
        USING ERRCODE = '22023';
    END IF;
    v_next_action := haven.referral_text(p_payload, 'next_action', 2000);
    v_next_action_at := haven.referral_timestamp(p_payload, 'next_action_at');
    IF (v_next_action IS NULL) <> (v_next_action_at IS NULL) THEN
      RAISE EXCEPTION 'Next action and due time must be supplied together'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.referral_leads
    SET next_action = CASE WHEN p_payload ? 'next_action' THEN v_next_action ELSE next_action END,
        next_action_at = CASE WHEN p_payload ? 'next_action_at' THEN v_next_action_at ELSE next_action_at END,
        episode_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;
    v_event_kind := 'interaction_recorded';

  ELSIF p_command IN ('wait', 'review') THEN
    IF v_episode.work_state = 'closed' THEN
      RAISE EXCEPTION 'Closed referral cannot wait for follow-up' USING ERRCODE = '22023';
    END IF;
    v_reason := haven.referral_text(p_payload, 'reason', 2000);
    v_follow_up_at := haven.referral_timestamp(p_payload, 'follow_up_at');
    IF v_reason IS NULL OR v_follow_up_at IS NULL THEN
      RAISE EXCEPTION 'Waiting or review requires a reason and follow-up time'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.referral_leads
    SET work_state = CASE WHEN p_command = 'wait' THEN 'waiting'::public.referral_episode_work_state
                          ELSE 'review'::public.referral_episode_work_state END,
        waiting_reason = CASE WHEN p_command = 'wait' THEN v_reason END,
        review_reason = CASE WHEN p_command = 'review' THEN v_reason END,
        follow_up_at = v_follow_up_at,
        episode_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;
    v_event_kind := CASE WHEN p_command = 'wait' THEN 'waiting_started' ELSE 'review_started' END;

  ELSIF p_command = 'resume' THEN
    IF v_episode.work_state NOT IN ('waiting', 'review') THEN
      RAISE EXCEPTION 'Referral is not waiting for follow-up or review'
        USING ERRCODE = '22023';
    END IF;
    v_reason := haven.referral_text(p_payload, 'reason', 2000);
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Referral resume reason is required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.referral_leads
    SET work_state = CASE WHEN owner_user_id IS NULL THEN 'unassigned'::public.referral_episode_work_state
                          ELSE 'assigned'::public.referral_episode_work_state END,
        waiting_reason = NULL,
        review_reason = NULL,
        follow_up_at = NULL,
        episode_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;
    v_event_kind := 'resumed';

  ELSIF p_command = 'next_action' THEN
    IF v_episode.work_state = 'closed' THEN
      RAISE EXCEPTION 'Closed referral cannot receive a next action' USING ERRCODE = '22023';
    END IF;
    v_next_action := haven.referral_text(p_payload, 'next_action', 2000);
    v_next_action_at := haven.referral_timestamp(p_payload, 'next_action_at');
    IF v_next_action IS NULL OR v_next_action_at IS NULL THEN
      RAISE EXCEPTION 'Next action and due time are required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.referral_leads
    SET next_action = v_next_action,
        next_action_at = v_next_action_at,
        episode_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;
    v_event_kind := 'next_action_set';

  ELSIF p_command = 'interest' THEN
    BEGIN
      v_interest := (haven.referral_text(p_payload, 'interest_state', 40))::public.referral_interest_state;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Unsupported referral interest state' USING ERRCODE = '22023';
    END;
    IF v_interest IS NULL THEN
      RAISE EXCEPTION 'Interest state is required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.referral_facility_considerations
    SET interest_state = v_interest,
        interest_recorded_at = pg_catalog.clock_timestamp(),
        interest_recorded_by = v_actor_id,
        consideration_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_current_consideration.id;
    UPDATE public.referral_leads
    SET episode_revision = haven.referral_revision(), updated_by = v_actor_id
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;
    v_event_kind := 'interest_recorded';

  ELSIF p_command = 'close' THEN
    IF v_episode.status IN ('converted', 'lost', 'merged') THEN
      RAISE EXCEPTION 'Referral episode is already closed' USING ERRCODE = '22023';
    END IF;
    v_closure_reason_id := haven.referral_uuid(p_payload, 'closure_reason_id');
    v_closed_by_party := haven.referral_text(p_payload, 'closed_by_party', 40);
    v_historical_unknown := COALESCE(
      haven.referral_boolean(p_payload, 'historical_outcome_unknown'), false
    );
    v_is_historical := COALESCE(haven.referral_boolean(p_payload, 'is_historical'), false);
    IF (v_closure_reason_id IS NULL) = NOT v_historical_unknown THEN
      RAISE EXCEPTION 'Choose one approved closure reason or an unknown historical outcome'
        USING ERRCODE = '22023';
    END IF;
    IF v_historical_unknown THEN
      IF NOT v_is_historical OR v_closed_by_party IS NOT NULL
         OR p_payload ? 'closure_note' OR p_payload ? 'competitor_chosen' THEN
        RAISE EXCEPTION 'Unknown outcomes are allowed only for explicit history and remain unclassified'
          USING ERRCODE = '22023';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1
      FROM public.referral_closure_reasons AS closure
      WHERE closure.id = v_closure_reason_id
        AND closure.organization_id = v_episode.organization_id
        AND closure.closed_by_party = v_closed_by_party
        AND closure.is_active
        AND closure.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Approved referral closure reason is unavailable'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.referral_leads
    SET status_before_close = status,
        status = 'lost',
        closed_at = CASE WHEN v_historical_unknown THEN NULL
          ELSE pg_catalog.clock_timestamp() END,
        closed_by_party = CASE WHEN v_historical_unknown THEN NULL ELSE v_closed_by_party END,
        closure_reason_id = CASE WHEN v_historical_unknown THEN NULL ELSE v_closure_reason_id END,
        closure_note = CASE WHEN v_historical_unknown THEN NULL ELSE haven.referral_text(p_payload, 'closure_note', 4000) END,
        competitor_chosen = CASE WHEN v_historical_unknown THEN NULL ELSE haven.referral_text(p_payload, 'competitor_chosen', 500) END,
        work_state = 'closed',
        waiting_reason = NULL,
        review_reason = NULL,
        follow_up_at = NULL,
        next_action = NULL,
        next_action_at = NULL,
        episode_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;
    IF NOT EXISTS (
      SELECT 1
      FROM public.referral_leads AS other_episode
      JOIN public.referral_facility_considerations AS other_consideration
        ON other_consideration.id = other_episode.facility_consideration_id
      WHERE other_consideration.opportunity_id = v_current_opportunity.id
        AND other_episode.deleted_at IS NULL
        AND other_episode.status NOT IN ('converted', 'lost', 'merged')
    ) THEN
      UPDATE public.referral_opportunities
      SET state = 'closed', closed_at = pg_catalog.clock_timestamp(),
          opportunity_revision = haven.referral_revision(), updated_by = v_actor_id
      WHERE id = v_current_opportunity.id;
    END IF;
    v_event_kind := 'closed';

  ELSIF p_command = 'reopen' THEN
    v_reason := haven.referral_text(p_payload, 'reason', 2000);
    IF v_episode.status <> 'lost' OR v_reason IS NULL THEN
      RAISE EXCEPTION 'A lost referral and reopen reason are required'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.referral_leads
    SET status = COALESCE(status_before_close, 'contacted'::public.referral_lead_status),
        status_before_close = NULL,
        closed_at = NULL,
        closed_by_party = NULL,
        closure_reason_id = NULL,
        closure_note = NULL,
        competitor_chosen = NULL,
        work_state = CASE WHEN owner_user_id IS NULL THEN 'unassigned'::public.referral_episode_work_state
                          ELSE 'assigned'::public.referral_episode_work_state END,
        reopen_count = reopen_count + 1,
        episode_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;
    UPDATE public.referral_opportunities
    SET state = 'open', closed_at = NULL,
        opportunity_revision = haven.referral_revision(), updated_by = v_actor_id
    WHERE id = v_current_opportunity.id;
    v_event_kind := 'reopened';

  ELSIF p_command = 'contact_add' THEN
    IF haven.referral_text(p_payload, 'first_name', 200) IS NULL
       OR haven.referral_text(p_payload, 'last_name', 200) IS NULL
       OR haven.referral_text(p_payload, 'relationship', 200) IS NULL THEN
      RAISE EXCEPTION 'Contact name and relationship are required'
        USING ERRCODE = '22023';
    END IF;
    v_contact_id := pg_catalog.gen_random_uuid();
    v_relationship_id := pg_catalog.gen_random_uuid();
    INSERT INTO public.referral_contacts (
      id, organization_id, first_name, last_name, phone, email,
      created_by, updated_by
    ) VALUES (
      v_contact_id, v_episode.organization_id,
      haven.referral_text(p_payload, 'first_name', 200),
      haven.referral_text(p_payload, 'last_name', 200),
      haven.referral_text(p_payload, 'phone', 100),
      haven.referral_text(p_payload, 'email', 320),
      v_actor_id, v_actor_id
    );
    INSERT INTO public.referral_person_contacts (
      id, organization_id, person_id, contact_id, originating_referral_lead_id,
      relationship, is_primary,
      created_by, updated_by
    ) VALUES (
      v_relationship_id, v_episode.organization_id, v_current_person.id,
      v_contact_id, v_episode.id,
      haven.referral_text(p_payload, 'relationship', 200),
      COALESCE(haven.referral_boolean(p_payload, 'is_primary'), false),
      v_actor_id, v_actor_id
    );
    INSERT INTO public.referral_contact_permissions (
      organization_id, person_contact_id, channel, permission_state,
      recorded_by
    )
    SELECT v_episode.organization_id, v_relationship_id, channel, 'unknown', v_actor_id
    FROM pg_catalog.unnest(ARRAY[
      'phone'::public.referral_contact_channel,
      'sms'::public.referral_contact_channel,
      'email'::public.referral_contact_channel
    ]) AS channel;
    UPDATE public.referral_leads
    SET episode_revision = haven.referral_revision(), updated_by = v_actor_id
    WHERE id = v_episode.id RETURNING * INTO v_episode;
    v_event_kind := 'contact_added';

  ELSIF p_command = 'contact_link' THEN
    IF NOT haven.referral_capability('duplicate_review') THEN
      RAISE EXCEPTION 'Reviewed referral identity authority required'
        USING ERRCODE = '42501';
    END IF;
    v_contact_id := haven.referral_uuid(p_payload, 'contact_id');
      IF v_contact_id IS NULL
       OR haven.referral_text(p_payload, 'relationship', 200) IS NULL
       OR NOT haven.referral_contact_visible(v_contact_id)
       OR NOT EXISTS (
         SELECT 1 FROM public.referral_contacts AS contact
         WHERE contact.id = v_contact_id
           AND contact.organization_id = v_episode.organization_id
           AND contact.deleted_at IS NULL
       ) THEN
      RAISE EXCEPTION 'Referral contact is unavailable' USING ERRCODE = '42501';
    END IF;
    v_relationship_id := pg_catalog.gen_random_uuid();
    BEGIN
      INSERT INTO public.referral_person_contacts (
        id, organization_id, person_id, contact_id, originating_referral_lead_id,
        relationship, is_primary,
        created_by, updated_by
      ) VALUES (
        v_relationship_id, v_episode.organization_id, v_current_person.id,
        v_contact_id, v_episode.id,
        haven.referral_text(p_payload, 'relationship', 200),
        COALESCE(haven.referral_boolean(p_payload, 'is_primary'), false),
        v_actor_id, v_actor_id
      );
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Referral contact is already linked to this person'
        USING ERRCODE = 'P0001';
    END;
    INSERT INTO public.referral_contact_permissions (
      organization_id, person_contact_id, channel, permission_state,
      recorded_by
    )
    SELECT v_episode.organization_id, v_relationship_id, channel, 'unknown', v_actor_id
    FROM pg_catalog.unnest(ARRAY[
      'phone'::public.referral_contact_channel,
      'sms'::public.referral_contact_channel,
      'email'::public.referral_contact_channel
    ]) AS channel;
    UPDATE public.referral_leads
    SET episode_revision = haven.referral_revision(), updated_by = v_actor_id
    WHERE id = v_episode.id RETURNING * INTO v_episode;
    v_event_kind := 'contact_linked';

  ELSIF p_command = 'contact_permission' THEN
    v_relationship_id := haven.referral_uuid(p_payload, 'person_contact_id');
    BEGIN
      v_channel := (haven.referral_text(p_payload, 'channel', 20))::public.referral_contact_channel;
      v_permission_state := (haven.referral_text(p_payload, 'permission_state', 20))::public.referral_contact_permission_state;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Unsupported contact permission value' USING ERRCODE = '22023';
    END;
    IF v_relationship_id IS NULL OR v_channel IS NULL OR v_permission_state IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.referral_person_contacts AS relationship
         WHERE relationship.id = v_relationship_id
           AND relationship.organization_id = v_episode.organization_id
           AND (
             relationship.person_id = v_current_person.id
             OR relationship.originating_referral_lead_id = v_episode.id
           )
           AND relationship.deleted_at IS NULL
       ) THEN
      RAISE EXCEPTION 'Referral contact relationship is unavailable'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.referral_contact_permissions (
      organization_id, person_contact_id, channel, permission_state,
      evidence_note, recorded_at, recorded_by
    ) VALUES (
      v_episode.organization_id, v_relationship_id, v_channel,
      v_permission_state, haven.referral_text(p_payload, 'evidence_note', 2000),
      pg_catalog.clock_timestamp(), v_actor_id
    )
    ON CONFLICT (organization_id, person_contact_id, channel) DO UPDATE
    SET permission_state = EXCLUDED.permission_state,
        evidence_note = EXCLUDED.evidence_note,
        recorded_at = EXCLUDED.recorded_at,
        recorded_by = EXCLUDED.recorded_by,
        permission_revision = haven.referral_revision();
    UPDATE public.referral_leads
    SET episode_revision = haven.referral_revision(), updated_by = v_actor_id
    WHERE id = v_episode.id RETURNING * INTO v_episode;
    v_event_kind := 'contact_permission_recorded';

  ELSIF p_command IN ('identity_merge', 'identity_split', 'identity_undo') THEN
    IF NOT haven.referral_capability('duplicate_review') THEN
      RAISE EXCEPTION 'Reviewed referral identity authority required'
        USING ERRCODE = '42501';
    END IF;
    v_reason := haven.referral_text(p_payload, 'reason', 2000);
    v_review := p_payload -> 'downstream_review';
    v_live_review := haven.referral_downstream_snapshot(v_episode.id);
    IF v_reason IS NULL OR v_review IS NULL
       OR pg_catalog.jsonb_typeof(v_review) <> 'object'
       OR v_review IS DISTINCT FROM v_live_review THEN
      RAISE EXCEPTION 'Current downstream reference review is required'
        USING ERRCODE = '40001';
    END IF;
    v_correction_id := pg_catalog.gen_random_uuid();

    IF p_command = 'identity_merge' THEN
      v_target_opportunity_revision := haven.referral_text(
        p_payload, 'target_opportunity_revision', 64
      );
      IF v_target_opportunity_revision IS NULL
         OR v_target_opportunity_revision !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Target referral opportunity revision is required'
          USING ERRCODE = '22023';
      END IF;
      SELECT opportunity.* INTO v_target_opportunity
      FROM public.referral_opportunities AS opportunity
      WHERE opportunity.id = haven.referral_uuid(p_payload, 'target_opportunity_id')
        AND opportunity.organization_id = v_episode.organization_id
        AND opportunity.deleted_at IS NULL
        AND haven.referral_opportunity_visible(opportunity.id)
      FOR UPDATE;
      IF NOT FOUND OR v_target_opportunity.id = v_current_opportunity.id THEN
        RAISE EXCEPTION 'Target referral opportunity is unavailable'
          USING ERRCODE = '42501';
      END IF;
      IF v_target_opportunity.opportunity_revision
         IS DISTINCT FROM v_target_opportunity_revision THEN
        RAISE EXCEPTION 'Target referral opportunity changed; reload before saving'
          USING ERRCODE = '40001';
      END IF;
      PERFORM 1
      FROM public.referral_facility_considerations AS target_consideration
      JOIN public.facilities AS target_facility
        ON target_facility.id = target_consideration.facility_id
       AND target_facility.organization_id = target_consideration.organization_id
      WHERE target_consideration.opportunity_id = v_target_opportunity.id
        AND target_consideration.organization_id = v_episode.organization_id
        AND target_consideration.deleted_at IS NULL
        AND target_facility.deleted_at IS NULL
        AND haven.has_facility_access(target_consideration.facility_id)
      FOR SHARE OF target_consideration, target_facility;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Target referral opportunity is unavailable'
          USING ERRCODE = '42501';
      END IF;
      IF NOT haven.referral_opportunity_visible(v_target_opportunity.id) THEN
        RAISE EXCEPTION 'Target referral opportunity authority changed'
          USING ERRCODE = '42501';
      END IF;
      SELECT person.* INTO STRICT v_target_person
      FROM public.referral_people AS person
      WHERE person.id = v_target_opportunity.person_id
        AND person.organization_id = v_episode.organization_id
        AND person.deleted_at IS NULL;
      SELECT consideration.* INTO v_replacement_consideration
      FROM public.referral_facility_considerations AS consideration
      WHERE consideration.organization_id = v_episode.organization_id
        AND consideration.opportunity_id = v_target_opportunity.id
        AND consideration.facility_id = v_episode.facility_id
        AND consideration.deleted_at IS NULL
      FOR UPDATE;
      IF NOT FOUND THEN
        INSERT INTO public.referral_facility_considerations (
          organization_id, opportunity_id, facility_id, created_by, updated_by
        ) VALUES (
          v_episode.organization_id, v_target_opportunity.id,
          v_episode.facility_id, v_actor_id, v_actor_id
        ) RETURNING * INTO v_replacement_consideration;
      END IF;
      SELECT target_episode.* INTO v_target_episode
      FROM public.referral_leads AS target_episode
      WHERE target_episode.facility_consideration_id = v_replacement_consideration.id
        AND target_episode.organization_id = v_episode.organization_id
        AND target_episode.facility_id = v_episode.facility_id
        AND target_episode.deleted_at IS NULL
        AND target_episode.status NOT IN ('converted', 'lost', 'merged')
      FOR UPDATE;
      v_event_kind := 'identity_merged';

    ELSIF p_command = 'identity_split' THEN
      IF v_episode.status = 'merged' THEN
        RAISE EXCEPTION 'Undo the active identity merge before splitting this referral'
          USING ERRCODE = '22023';
      END IF;
      v_person_id := pg_catalog.gen_random_uuid();
      INSERT INTO public.referral_people (
        id, organization_id, first_name, last_name, preferred_name,
        date_of_birth, created_by, updated_by
      ) VALUES (
        v_person_id, v_episode.organization_id, v_episode.first_name,
        v_episode.last_name, v_episode.preferred_name, v_episode.date_of_birth,
        v_actor_id, v_actor_id
      );
      INSERT INTO public.referral_opportunities (
        organization_id, person_id, created_by, updated_by
      ) VALUES (
        v_episode.organization_id, v_person_id, v_actor_id, v_actor_id
      ) RETURNING * INTO v_target_opportunity;
      INSERT INTO public.referral_facility_considerations (
        organization_id, opportunity_id, facility_id, created_by, updated_by
      ) VALUES (
        v_episode.organization_id, v_target_opportunity.id,
        v_episode.facility_id, v_actor_id, v_actor_id
      ) RETURNING * INTO v_replacement_consideration;
      v_event_kind := 'identity_split';

    ELSE
      SELECT correction.* INTO v_related_correction
      FROM public.referral_identity_corrections AS correction
      WHERE correction.id = haven.referral_uuid(p_payload, 'correction_id')
        AND correction.organization_id = v_episode.organization_id
        AND correction.facility_id = v_episode.facility_id
        AND correction.referral_lead_id = v_episode.id
        AND correction.correction_kind IN ('merge', 'split')
        AND correction.reversed_by_correction_id IS NULL
      FOR UPDATE;
      IF NOT FOUND
         OR v_episode.facility_consideration_id
            IS DISTINCT FROM v_related_correction.replacement_consideration_id
         OR v_episode.episode_sequence
            IS DISTINCT FROM v_related_correction.replacement_episode_sequence THEN
        RAISE EXCEPTION 'Referral identity correction is unavailable for undo'
          USING ERRCODE = '42501';
      END IF;
      SELECT consideration.* INTO STRICT v_replacement_consideration
      FROM public.referral_facility_considerations AS consideration
      WHERE consideration.id = v_related_correction.previous_consideration_id
        AND consideration.organization_id = v_episode.organization_id
        AND consideration.facility_id = v_episode.facility_id
        AND consideration.deleted_at IS NULL
      FOR UPDATE;
      v_replacement_sequence := v_related_correction.previous_episode_sequence;
      IF EXISTS (
        SELECT 1 FROM public.referral_leads AS other_episode
        WHERE other_episode.id <> v_episode.id
          AND other_episode.facility_consideration_id = v_replacement_consideration.id
          AND other_episode.episode_sequence = v_replacement_sequence
      ) THEN
        RAISE EXCEPTION 'Original episode sequence is no longer available'
          USING ERRCODE = '40001';
      END IF;
      IF v_related_correction.previous_status NOT IN ('converted', 'lost', 'merged')
         AND EXISTS (
           SELECT 1 FROM public.referral_leads AS other_episode
           WHERE other_episode.id <> v_episode.id
             AND other_episode.facility_consideration_id = v_replacement_consideration.id
             AND other_episode.deleted_at IS NULL
             AND other_episode.status NOT IN ('converted', 'lost', 'merged')
         ) THEN
        RAISE EXCEPTION 'Original facility consideration now has another open episode'
          USING ERRCODE = '40001';
      END IF;
      PERFORM 1
      FROM public.user_profiles AS profile
      WHERE profile.id = ANY (ARRAY[
        NULLIF(v_related_correction.previous_projection ->> 'owner_user_id', '')::uuid,
        NULLIF(v_related_correction.previous_projection ->> 'backup_user_id', '')::uuid,
        NULLIF(v_related_correction.previous_projection ->> 'pending_owner_user_id', '')::uuid,
        NULLIF(v_related_correction.previous_projection ->> 'pending_backup_user_id', '')::uuid
      ])
      FOR SHARE;
      IF (
        NULLIF(v_related_correction.previous_projection ->> 'owner_user_id', '') IS NOT NULL
        AND NOT haven.referral_staff_current_for_facility(
          NULLIF(v_related_correction.previous_projection ->> 'owner_user_id', '')::uuid,
          v_episode.organization_id,
          v_episode.facility_id
        )
      ) OR (
        NULLIF(v_related_correction.previous_projection ->> 'backup_user_id', '') IS NOT NULL
        AND NOT haven.referral_staff_current_for_facility(
          NULLIF(v_related_correction.previous_projection ->> 'backup_user_id', '')::uuid,
          v_episode.organization_id,
          v_episode.facility_id
        )
      ) OR (
        NULLIF(v_related_correction.previous_projection ->> 'pending_owner_user_id', '') IS NOT NULL
        AND NOT haven.referral_staff_current_for_facility(
          NULLIF(v_related_correction.previous_projection ->> 'pending_owner_user_id', '')::uuid,
          v_episode.organization_id,
          v_episode.facility_id
        )
      ) OR (
        NULLIF(v_related_correction.previous_projection ->> 'pending_backup_user_id', '') IS NOT NULL
        AND NOT haven.referral_staff_current_for_facility(
          NULLIF(v_related_correction.previous_projection ->> 'pending_backup_user_id', '')::uuid,
          v_episode.organization_id,
          v_episode.facility_id
        )
      ) THEN
        RAISE EXCEPTION 'Historical referral assignment is no longer current'
          USING ERRCODE = '40001';
      END IF;
      v_event_kind := 'identity_undo';
    END IF;

    PERFORM haven.lock_referral_downstream(v_episode.id);
    v_live_review := haven.referral_downstream_snapshot(v_episode.id);
    IF NOT haven.referral_capability('duplicate_review')
       OR NOT haven.has_facility_access(v_episode.facility_id)
       OR v_review IS DISTINCT FROM v_live_review
       OR (p_command = 'identity_merge'
         AND NOT haven.referral_opportunity_visible(v_target_opportunity.id)) THEN
      RAISE EXCEPTION 'Referral identity authority or downstream review changed'
        USING ERRCODE = '40001';
    END IF;

    IF p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL THEN
      v_replacement_sequence := v_episode.episode_sequence;
    ELSIF p_command <> 'identity_undo' THEN
      SELECT COALESCE(MAX(other_episode.episode_sequence), 0) + 1
      INTO v_replacement_sequence
      FROM public.referral_leads AS other_episode
      WHERE other_episode.facility_consideration_id = v_replacement_consideration.id;
    END IF;
    UPDATE public.referral_leads
    SET facility_consideration_id = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL
            THEN facility_consideration_id
          ELSE v_replacement_consideration.id
        END,
        episode_sequence = v_replacement_sequence,
        status = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL
            THEN 'merged'::public.referral_lead_status
          WHEN p_command = 'identity_undo' THEN v_related_correction.previous_status
          ELSE status
        END,
        work_state = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL
            THEN 'closed'::public.referral_episode_work_state
          WHEN p_command = 'identity_undo' THEN v_related_correction.previous_work_state
          ELSE work_state
        END,
        owner_user_id = CASE WHEN p_command = 'identity_undo'
          THEN NULLIF(v_related_correction.previous_projection ->> 'owner_user_id', '')::uuid
          ELSE owner_user_id END,
        backup_user_id = CASE WHEN p_command = 'identity_undo'
          THEN NULLIF(v_related_correction.previous_projection ->> 'backup_user_id', '')::uuid
          ELSE backup_user_id END,
        ownership_accepted_at = CASE WHEN p_command = 'identity_undo'
          THEN NULLIF(v_related_correction.previous_projection ->> 'ownership_accepted_at', '')::timestamptz
          ELSE ownership_accepted_at END,
        ownership_accepted_by = CASE WHEN p_command = 'identity_undo'
          THEN NULLIF(v_related_correction.previous_projection ->> 'ownership_accepted_by', '')::uuid
          ELSE ownership_accepted_by END,
        pending_owner_user_id = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL THEN NULL
          WHEN p_command = 'identity_undo'
            THEN NULLIF(v_related_correction.previous_projection ->> 'pending_owner_user_id', '')::uuid
          ELSE pending_owner_user_id END,
        pending_backup_user_id = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL THEN NULL
          WHEN p_command = 'identity_undo'
            THEN NULLIF(v_related_correction.previous_projection ->> 'pending_backup_user_id', '')::uuid
          ELSE pending_backup_user_id END,
        ownership_handoff_requested_at = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL THEN NULL
          WHEN p_command = 'identity_undo'
            THEN NULLIF(v_related_correction.previous_projection ->> 'ownership_handoff_requested_at', '')::timestamptz
          ELSE ownership_handoff_requested_at END,
        ownership_handoff_requested_by = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL THEN NULL
          WHEN p_command = 'identity_undo'
            THEN NULLIF(v_related_correction.previous_projection ->> 'ownership_handoff_requested_by', '')::uuid
          ELSE ownership_handoff_requested_by END,
        merged_into_lead_id = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL
            THEN v_target_episode.id
          WHEN p_command = 'identity_undo'
            THEN NULLIF(v_related_correction.previous_projection ->> 'merged_into_lead_id', '')::uuid
          ELSE merged_into_lead_id END,
        merged_at = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL
            THEN pg_catalog.clock_timestamp()
          WHEN p_command = 'identity_undo'
            THEN NULLIF(v_related_correction.previous_projection ->> 'merged_at', '')::timestamptz
          ELSE merged_at END,
        merged_by = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL
            THEN v_actor_id
          WHEN p_command = 'identity_undo'
            THEN NULLIF(v_related_correction.previous_projection ->> 'merged_by', '')::uuid
          ELSE merged_by END,
        next_action = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL THEN NULL
          WHEN p_command = 'identity_undo'
            THEN v_related_correction.previous_projection ->> 'next_action'
          ELSE next_action END,
        next_action_at = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL THEN NULL
          WHEN p_command = 'identity_undo'
            THEN NULLIF(v_related_correction.previous_projection ->> 'next_action_at', '')::timestamptz
          ELSE next_action_at END,
        waiting_reason = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL THEN NULL
          WHEN p_command = 'identity_undo'
            THEN v_related_correction.previous_projection ->> 'waiting_reason'
          ELSE waiting_reason END,
        review_reason = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL THEN NULL
          WHEN p_command = 'identity_undo'
            THEN v_related_correction.previous_projection ->> 'review_reason'
          ELSE review_reason END,
        follow_up_at = CASE
          WHEN p_command = 'identity_merge' AND v_target_episode.id IS NOT NULL THEN NULL
          WHEN p_command = 'identity_undo'
            THEN NULLIF(v_related_correction.previous_projection ->> 'follow_up_at', '')::timestamptz
          ELSE follow_up_at END,
        episode_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;
    PERFORM haven.reconcile_referral_opportunity_state(
      v_current_opportunity.id, v_episode.organization_id, v_actor_id
    );
    IF v_replacement_consideration.opportunity_id
       IS DISTINCT FROM v_current_opportunity.id THEN
      PERFORM haven.reconcile_referral_opportunity_state(
        v_replacement_consideration.opportunity_id,
        v_episode.organization_id,
        v_actor_id
      );
    END IF;

  ELSIF p_command = 'admission_transition' THEN
    v_admission_id := haven.referral_uuid(p_payload, 'admission_case_id');
    BEGIN
      v_status := (haven.referral_text(p_payload, 'target_status', 40))::public.referral_lead_status;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Unsupported admission referral transition'
        USING ERRCODE = '22023';
    END;
    IF v_admission_id IS NULL
       OR v_status <> 'application_pending' THEN
      RAISE EXCEPTION 'Admission case and supported referral target are required'
        USING ERRCODE = '22023';
    END IF;
    SELECT admission.* INTO v_admission
    FROM public.admission_cases AS admission
    WHERE admission.id = v_admission_id
      AND admission.organization_id = v_episode.organization_id
      AND admission.facility_id = v_episode.facility_id
      AND admission.referral_lead_id = v_episode.id
      AND admission.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Admission case is unavailable for this referral episode'
        USING ERRCODE = '42501';
    END IF;
    IF (
      v_admission.status NOT IN ('pending_clearance', 'bed_reserved')
      OR v_episode.status IN ('application_pending', 'waitlisted', 'converted', 'lost', 'merged')
    ) THEN
      RAISE EXCEPTION 'Admission case cannot advance this referral to application pending'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.referral_leads
    SET status = v_status,
        episode_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;
    v_source_reference := pg_catalog.jsonb_build_object(
      'admission_case_id', v_admission.id,
      'admission_case_status', v_admission.status,
      'resident_id', v_admission.resident_id,
      'arrival_conversion_deferred_to', 'COL-333'
    );
    v_event_kind := 'admission_transition';

  ELSIF p_command = 'compatibility_update' THEN
    IF v_episode.status IN ('converted', 'lost', 'merged') THEN
      RAISE EXCEPTION 'Closed referral transitions require their dedicated commands'
        USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'status' THEN
      BEGIN
        v_status := (p_payload ->> 'status')::public.referral_lead_status;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Unsupported referral status' USING ERRCODE = '22023';
      END;
      IF v_status IN ('converted', 'lost', 'merged') THEN
        RAISE EXCEPTION 'Terminal referral statuses require dedicated commands'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    UPDATE public.referral_leads
    SET status = CASE WHEN p_payload ? 'status' THEN v_status ELSE status END,
        tour_scheduled_for = CASE WHEN p_payload ? 'tour_scheduled_for'
          THEN haven.referral_timestamp(p_payload, 'tour_scheduled_for') ELSE tour_scheduled_for END,
        tour_completed_at = CASE WHEN p_payload ? 'tour_completed_at'
          THEN haven.referral_timestamp(p_payload, 'tour_completed_at') ELSE tour_completed_at END,
        tour_owner_user_id = CASE
          WHEN p_payload ? 'tour_scheduled_for' OR p_payload ? 'tour_completed_at'
            THEN v_actor_id ELSE tour_owner_user_id END,
        episode_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;
    v_event_kind := 'compatibility_updated';
  END IF;

  v_event := haven.write_referral_episode_event(
    v_before, v_episode, v_event_kind, p_request_key, v_request_hash,
    p_expected_revision, v_effective_precision, v_effective_at,
    v_effective_date, v_source_kind, v_source_reference,
    CASE p_command
      WHEN 'assign' THEN pg_catalog.jsonb_build_object(
        'owner_user_id', v_episode.owner_user_id,
        'backup_user_id', v_episode.backup_user_id,
        'pending_owner_user_id', v_episode.pending_owner_user_id,
        'pending_backup_user_id', v_episode.pending_backup_user_id,
        'override_reason', v_reason,
        'next_action', v_episode.next_action,
        'next_action_at', v_episode.next_action_at
      )
      WHEN 'accept_coverage' THEN pg_catalog.jsonb_build_object(
        'accepted_by', v_episode.ownership_accepted_by,
        'previous_owner_user_id', v_before.owner_user_id,
        'owner_user_id', v_episode.owner_user_id,
        'coverage_reason', v_reason
      )
      WHEN 'record_interaction' THEN pg_catalog.jsonb_build_object(
        'summary', v_note,
        'method', v_method,
        'contacted_name', v_contacted_name,
        'person_contact_id', v_person_contact_id,
        'next_action', v_episode.next_action,
        'next_action_at', v_episode.next_action_at
      )
      WHEN 'wait' THEN pg_catalog.jsonb_build_object(
        'reason', v_episode.waiting_reason, 'follow_up_at', v_episode.follow_up_at
      )
      WHEN 'review' THEN pg_catalog.jsonb_build_object(
        'reason', v_episode.review_reason, 'follow_up_at', v_episode.follow_up_at
      )
      WHEN 'resume' THEN pg_catalog.jsonb_build_object(
        'reason', v_reason,
        'previous_waiting_reason', v_before.waiting_reason,
        'previous_review_reason', v_before.review_reason,
        'previous_follow_up_at', v_before.follow_up_at
      )
      WHEN 'next_action' THEN pg_catalog.jsonb_build_object(
        'next_action', v_episode.next_action, 'next_action_at', v_episode.next_action_at
      )
      WHEN 'interest' THEN pg_catalog.jsonb_build_object('interest_state', v_interest)
      WHEN 'close' THEN pg_catalog.jsonb_build_object(
        'closure_reason_id', v_episode.closure_reason_id,
        'closed_by_party', v_episode.closed_by_party,
        'historical_outcome_unknown', v_historical_unknown,
        'status_before_close', v_episode.status_before_close
      )
      WHEN 'reopen' THEN pg_catalog.jsonb_build_object(
        'reason', v_reason,
        'reopen_count', v_episode.reopen_count,
        'prior_closure', pg_catalog.jsonb_build_object(
          'closed_at', v_before.closed_at,
          'closed_by_party', v_before.closed_by_party,
          'closure_reason_id', v_before.closure_reason_id,
          'closure_note', v_before.closure_note,
          'competitor_chosen', v_before.competitor_chosen
        )
      )
      WHEN 'contact_add' THEN pg_catalog.jsonb_build_object(
        'contact_id', v_contact_id, 'person_contact_id', v_relationship_id,
        'permissions_defaulted_to', 'unknown'
      )
      WHEN 'contact_link' THEN pg_catalog.jsonb_build_object(
        'contact_id', v_contact_id, 'person_contact_id', v_relationship_id,
        'permissions_defaulted_to', 'unknown'
      )
      WHEN 'contact_permission' THEN pg_catalog.jsonb_build_object(
        'person_contact_id', v_relationship_id, 'channel', v_channel,
        'permission_state', v_permission_state
      )
      WHEN 'identity_merge' THEN pg_catalog.jsonb_build_object(
        'correction_id', v_correction_id,
        'from_consideration_id', v_before.facility_consideration_id,
        'to_consideration_id', v_episode.facility_consideration_id,
        'target_person_id', v_target_person.id,
        'target_referral_lead_id', v_target_episode.id,
        'duplicate_episode_superseded', v_target_episode.id IS NOT NULL,
        'downstream_review', v_review
      )
      WHEN 'identity_split' THEN pg_catalog.jsonb_build_object(
        'correction_id', v_correction_id,
        'from_consideration_id', v_before.facility_consideration_id,
        'to_consideration_id', v_episode.facility_consideration_id,
        'new_person_id', v_person_id,
        'downstream_review', v_review
      )
      WHEN 'identity_undo' THEN pg_catalog.jsonb_build_object(
        'correction_id', v_correction_id,
        'reversed_correction_id', v_related_correction.id,
        'from_consideration_id', v_before.facility_consideration_id,
        'to_consideration_id', v_episode.facility_consideration_id,
        'downstream_review', v_review
      )
      WHEN 'admission_transition' THEN pg_catalog.jsonb_build_object(
        'admission_case_id', v_admission.id,
        'admission_case_status', v_admission.status,
        'resident_id', v_admission.resident_id,
        'target_status', v_episode.status
      )
      ELSE pg_catalog.jsonb_build_object('patch', p_payload - 'source_reference')
    END
  );

  IF p_command IN ('identity_merge', 'identity_split', 'identity_undo') THEN
    INSERT INTO public.referral_identity_corrections (
      id, organization_id, facility_id, referral_lead_id, correction_kind,
      previous_consideration_id, previous_episode_sequence, previous_status,
      previous_work_state, previous_projection, replacement_consideration_id,
      replacement_episode_sequence, target_referral_lead_id,
      related_correction_id, downstream_review, reason, event_id, created_by
    ) VALUES (
      v_correction_id, v_episode.organization_id, v_episode.facility_id,
      v_episode.id,
      CASE p_command WHEN 'identity_merge' THEN 'merge'
                     WHEN 'identity_split' THEN 'split' ELSE 'undo' END,
      v_before.facility_consideration_id, v_before.episode_sequence,
      v_before.status, v_before.work_state,
      pg_catalog.jsonb_build_object(
        'owner_user_id', v_before.owner_user_id,
        'backup_user_id', v_before.backup_user_id,
        'ownership_accepted_at', v_before.ownership_accepted_at,
        'ownership_accepted_by', v_before.ownership_accepted_by,
        'pending_owner_user_id', v_before.pending_owner_user_id,
        'pending_backup_user_id', v_before.pending_backup_user_id,
        'ownership_handoff_requested_at', v_before.ownership_handoff_requested_at,
        'ownership_handoff_requested_by', v_before.ownership_handoff_requested_by,
        'merged_into_lead_id', v_before.merged_into_lead_id,
        'merged_at', v_before.merged_at,
        'merged_by', v_before.merged_by,
        'next_action', v_before.next_action,
        'next_action_at', v_before.next_action_at,
        'waiting_reason', v_before.waiting_reason,
        'review_reason', v_before.review_reason,
        'follow_up_at', v_before.follow_up_at
      ),
      v_episode.facility_consideration_id, v_episode.episode_sequence,
      CASE WHEN p_command = 'identity_merge' THEN v_target_episode.id END,
      CASE WHEN p_command = 'identity_undo' THEN v_related_correction.id END,
      v_review, v_reason, v_event.id, v_actor_id
    );
    IF p_command = 'identity_undo' THEN
      UPDATE public.referral_identity_corrections
      SET reversed_by_correction_id = v_correction_id
      WHERE id = v_related_correction.id;
    END IF;
  END IF;

  PERFORM haven.deactivate_referral_command();
  RETURN haven.referral_episode_reply(v_episode, v_event, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.referral_episode_history_read(
  p_episode_id uuid,
  p_before_sequence integer DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_episode public.referral_leads;
  v_result jsonb;
  v_can_clinical boolean := haven.referral_capability('clinical_read');
  v_can_contact boolean := haven.referral_capability('contact_read');
  v_can_duplicate boolean := haven.referral_capability('duplicate_review');
  v_can_source boolean := haven.referral_capability('source_manage');
  v_can_work_notes boolean := haven.referral_capability('contact_read');
BEGIN
  IF NOT haven.referral_capability('lead_read') THEN
    RAISE EXCEPTION 'Referral read authority required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200
     OR (p_before_sequence IS NOT NULL AND p_before_sequence < 2) THEN
    RAISE EXCEPTION 'Referral history page is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT lead.* INTO v_episode
  FROM public.referral_leads AS lead
  WHERE lead.id = p_episode_id
    AND lead.organization_id = haven.organization_id()
    AND lead.deleted_at IS NULL
    AND haven.has_facility_access(lead.facility_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral episode unavailable' USING ERRCODE = '42501';
  END IF;

  WITH page AS MATERIALIZED (
    SELECT event.*
    FROM public.referral_episode_events AS event
    WHERE event.organization_id = v_episode.organization_id
      AND event.facility_id = v_episode.facility_id
      AND event.referral_lead_id = v_episode.id
      AND (p_before_sequence IS NULL OR event.event_seq < p_before_sequence)
    ORDER BY event.event_seq DESC
    LIMIT p_limit
  )
  SELECT pg_catalog.jsonb_build_object(
    'events', COALESCE(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', page.id,
        'event_sequence', page.event_seq,
        'event_kind', page.event_kind,
        'from_status', page.from_status,
        'to_status', page.to_status,
        'from_work_state', page.from_work_state,
        'to_work_state', page.to_work_state,
        'effective_precision', page.effective_precision,
        'effective_at', page.effective_at,
        'effective_date', page.effective_date,
        'recorded_at', page.recorded_at,
        'actor_id', page.actor_id,
        'actor_role', page.actor_role,
        'actor_name', (
          SELECT NULLIF(pg_catalog.btrim(profile.full_name), '')
          FROM public.user_profiles AS profile
          WHERE profile.id = page.actor_id
            AND profile.organization_id = v_episode.organization_id
        ),
        'request_key', page.request_key,
        'source_kind', page.source_kind,
        'source_reference', CASE WHEN v_can_source
          THEN page.source_reference ELSE '{}'::jsonb END,
        'details', CASE
          WHEN v_can_clinical
               AND v_episode.pii_access_tier = 'clinical_precheck' THEN page.details
          WHEN v_can_duplicate AND page.event_kind IN (
            'identity_merged', 'identity_split', 'identity_undo'
          ) THEN page.details
          WHEN v_can_contact AND page.event_kind IN (
            'contact_added', 'contact_linked', 'contact_permission_recorded'
          ) THEN page.details
          WHEN v_can_work_notes
               AND v_episode.pii_access_tier <> 'public_summary'
               AND page.event_kind IN (
                 'interaction_recorded', 'next_action_set', 'assigned',
                 'ownership_handoff_requested', 'ownership_overridden',
                 'coverage_accepted', 'waiting_started', 'review_started', 'resumed'
               ) THEN page.details
          ELSE '{}'::jsonb
        END
      ) ORDER BY page.event_seq DESC
    ), '[]'::jsonb),
    'next_before_sequence', CASE
      WHEN COALESCE(pg_catalog.min(page.event_seq), 1) > 1
        THEN pg_catalog.min(page.event_seq)
      ELSE NULL
    END
  ) INTO v_result
  FROM page;
  RETURN v_result;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
