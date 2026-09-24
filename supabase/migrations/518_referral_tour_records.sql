-- Tours as their own records (COL-332, tours part). Brian's rulings, 2026-09-24:
--   * Recruiters "need to log everything". Each tour is recorded with the
--     prospect, the building and the result, and the Thursday Stand Up (COL-754)
--     lists each tour under its facility, so every tour is its own record.
--   * Who records tours: owner, org_admin, facility_admin, manager,
--     admin_assistant and recruiter (the COL-331 contact-log ruling). Reading
--     follows the roles that read referrals (lead_read).
--
-- Until now a tour was four columns on referral_leads (migration 191), so a
-- second tour overwrote the first and a reschedule left no trace.
--
-- 1. public.referral_tours: one row per tour, with the lead (episode), the
--    building (the lead's facility), when it is scheduled, who gives it, its
--    outcome (scheduled / completed / cancelled / no_show / rescheduled), when
--    it was completed, a feedback note and who recorded it. A reschedule closes
--    the old tour as 'rescheduled' and links the new one to it through
--    replaces_tour_id, so a reschedule chain has exactly one live tour and is
--    never counted twice. Writes go only through public.referral_tour_command.
-- 2. haven.referral_capability gains 'tour_write' (the ruled set above), read
--    from haven.referral_tour_roles() so the capability and the tour-owner
--    eligibility cannot drift apart.
-- 3. public.referral_tour_command(episode, request_key, expected_revision,
--    command, payload): schedule, reschedule and record_outcome. Same shape as
--    referral_episode_command: idempotent request keys, the episode revision
--    for concurrency, and an immutable 'tour_recorded' episode event per write
--    so tours appear in the lead's history timeline. It keeps the legacy lead
--    columns (tour_scheduled_for, tour_completed_at) in sync from the records,
--    so the referrals hub and the executive stand-up pack keep working, and it
--    moves the lead status forward the way the lead page used to
--    (new/contacted -> tour_scheduled; new/contacted/tour_scheduled ->
--    tour_completed), now based on the tour records.
-- 4. The legacy columns can no longer be written any other way: a trigger
--    refuses a tour-column change on referral_leads unless the tour command is
--    making it. referral_lead_update / compatibility_update stay for status.
-- 5. public.referral_episode_tours_read(uuid): the tours of one lead with owner
--    and recorder names, the feedback note for work_note_read holders on leads
--    that are not public_summary, whether the reader may record tours, and the
--    eligible tour owners (names only).
-- 6. referral_episode_history_read shows 'tour_recorded' details to
--    work_note_read holders, like the contact log. Copied from 506 with only
--    that change.
-- 7. Backfill: every live lead with a recorded tour time becomes one tour
--    record, marked backfill_source = 'referral_leads_tour_columns'. Only what
--    was recorded is copied: a completion time makes it 'completed'; a
--    scheduled time alone stays 'scheduled' (no result recorded) and is never
--    guessed into a result. The old tour_owner_user_id was always whoever saved
--    the columns, so it is copied as recorded_by; the tour owner stays empty.

BEGIN;

-- ---------------------------------------------------------------------------
-- Roles and capability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.referral_tour_roles()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','recruiter']::text[]
$function$;

REVOKE ALL ON FUNCTION haven.referral_tour_roles() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.referral_capability(p_capability text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((
    SELECT CASE p_capability
      WHEN 'lead_read' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech','recruiter'])
      WHEN 'contact_read' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech','recruiter'])
      WHEN 'clinical_read' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','med_tech'])
      WHEN 'lead_write' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','med_tech','recruiter'])
      WHEN 'lead_export' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech','recruiter'])
      WHEN 'duplicate_review' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','med_tech'])
      WHEN 'triage_submit' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech','recruiter'])
      WHEN 'work_note_read' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','recruiter'])
      WHEN 'tour_write' THEN actor.actor_role_text = ANY (haven.referral_tour_roles())
      WHEN 'triage_read' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin'])
      WHEN 'source_manage' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin'])
      ELSE false
    END
    FROM haven.current_authorized_actor() AS actor
    WHERE actor.actor_is_managed
    LIMIT 1
  ), false)
$function$;

-- Who may give (own) a tour at a facility: an active person in a tour role with
-- access to that facility (owner and org_admin reach every facility).
CREATE OR REPLACE FUNCTION haven.referral_tour_owner_current(
  p_user_id uuid, p_organization_id uuid, p_facility_id uuid
)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles AS profile
    WHERE profile.id = p_user_id
      AND profile.organization_id = p_organization_id
      AND profile.is_active
      AND profile.deleted_at IS NULL
      AND profile.app_role::text = ANY (haven.referral_tour_roles())
      AND (
        profile.app_role IN ('owner', 'org_admin')
        OR EXISTS (
          SELECT 1
          FROM public.user_facility_access AS access
          JOIN public.facilities AS facility ON facility.id = access.facility_id
          WHERE access.user_id = profile.id
            AND access.organization_id = profile.organization_id
            AND access.facility_id = p_facility_id
            AND access.revoked_at IS NULL
            AND facility.organization_id = profile.organization_id
            AND facility.deleted_at IS NULL
        )
      )
  )
$function$;

REVOKE ALL ON FUNCTION haven.referral_tour_owner_current(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The tour record
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type AS t
    JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'referral_tour_outcome'
  ) THEN
    CREATE TYPE public.referral_tour_outcome AS ENUM (
      'scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled'
    );
  END IF;
END
$$;

CREATE TABLE public.referral_tours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  referral_lead_id uuid NOT NULL REFERENCES public.referral_leads(id),
  replaces_tour_id uuid REFERENCES public.referral_tours(id),
  scheduled_for timestamptz,
  owner_user_id uuid REFERENCES public.user_profiles(id),
  outcome public.referral_tour_outcome NOT NULL DEFAULT 'scheduled',
  completed_at timestamptz,
  feedback_note text CHECK (feedback_note IS NULL OR pg_catalog.length(feedback_note) BETWEEN 1 AND 4000),
  recorded_by uuid REFERENCES auth.users(id),
  outcome_recorded_at timestamptz,
  outcome_recorded_by uuid REFERENCES auth.users(id),
  backfill_source text CHECK (backfill_source IN ('referral_leads_tour_columns')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  CONSTRAINT referral_tours_completed_check
    CHECK ((outcome = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT referral_tours_native_fields_check
    CHECK (backfill_source IS NOT NULL
      OR (scheduled_for IS NOT NULL AND owner_user_id IS NOT NULL AND recorded_by IS NOT NULL)),
  CONSTRAINT referral_tours_backfill_has_time_check
    CHECK (scheduled_for IS NOT NULL OR completed_at IS NOT NULL),
  CONSTRAINT referral_tours_outcome_recorded_check
    CHECK (outcome = 'scheduled' OR backfill_source IS NOT NULL
      OR (outcome_recorded_at IS NOT NULL AND outcome_recorded_by IS NOT NULL)),
  CONSTRAINT referral_tours_not_self_replacing_check
    CHECK (replaces_tour_id IS DISTINCT FROM id)
);

COMMENT ON TABLE public.referral_tours IS
  'One row per prospect tour (COL-332). A reschedule closes the old row as rescheduled and links the new row through replaces_tour_id; count tours with outcome <> rescheduled so a chain counts once. Written only by public.referral_tour_command.';
COMMENT ON COLUMN public.referral_tours.backfill_source IS
  'Set when the row was copied from the single-tour columns on referral_leads (migration 191). Only recorded values were copied; outcome stays scheduled when no completion was recorded.';

CREATE UNIQUE INDEX idx_referral_tours_replaces_tour_id
  ON public.referral_tours (replaces_tour_id)
  WHERE replaces_tour_id IS NOT NULL;
CREATE UNIQUE INDEX idx_referral_tours_backfill_lead
  ON public.referral_tours (referral_lead_id)
  WHERE backfill_source IS NOT NULL;
CREATE INDEX idx_referral_tours_lead
  ON public.referral_tours (referral_lead_id, scheduled_for)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_referral_tours_facility_scheduled_for
  ON public.referral_tours (organization_id, facility_id, scheduled_for)
  WHERE deleted_at IS NULL;

ALTER TABLE public.referral_tours ENABLE ROW LEVEL SECURITY;

-- Like the rest of the referral module (379/380), the table is RPC-written.
-- Readers get every column except the feedback note, which follows the
-- contact-log note rule through referral_episode_tours_read.
REVOKE ALL ON TABLE public.referral_tours FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.referral_tours TO service_role;
GRANT SELECT (
  id, organization_id, facility_id, referral_lead_id, replaces_tour_id,
  scheduled_for, owner_user_id, outcome, completed_at, recorded_by,
  outcome_recorded_at, outcome_recorded_by, backfill_source, created_at,
  updated_at, created_by, updated_by, deleted_at
) ON public.referral_tours TO authenticated;

CREATE POLICY referral_tours_select ON public.referral_tours
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND (SELECT haven.referral_capability('lead_read'))
    AND (SELECT haven.has_facility_access(facility_id))
  );

-- Every write goes through the tour command; the record's identity, building,
-- lead, schedule and chain link never change after insert, and rows are never
-- hard-deleted.
CREATE OR REPLACE FUNCTION haven.guard_referral_tour()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Referral tours are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NOT haven.referral_command_active() THEN
    RAISE EXCEPTION 'Use the referral tour commands' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id, NEW.organization_id, NEW.facility_id, NEW.referral_lead_id,
    NEW.replaces_tour_id, NEW.scheduled_for, NEW.recorded_by,
    NEW.backfill_source, NEW.created_at, NEW.created_by
  ) IS DISTINCT FROM (
    OLD.id, OLD.organization_id, OLD.facility_id, OLD.referral_lead_id,
    OLD.replaces_tour_id, OLD.scheduled_for, OLD.recorded_by,
    OLD.backfill_source, OLD.created_at, OLD.created_by
  ) THEN
    RAISE EXCEPTION 'A recorded tour keeps its lead, building and time; reschedule it instead'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.outcome <> 'scheduled' THEN
    RAISE EXCEPTION 'This tour already has a result' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION haven.guard_referral_tour() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_referral_tours_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.referral_tours
  FOR EACH ROW EXECUTE FUNCTION haven.guard_referral_tour();
CREATE TRIGGER tr_referral_tours_set_updated_at
  BEFORE UPDATE ON public.referral_tours
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();
CREATE TRIGGER tr_referral_tours_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_tours
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();

-- ---------------------------------------------------------------------------
-- The legacy lead columns follow the records
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.guard_referral_lead_tour_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF COALESCE(pg_catalog.current_setting('haven.referral_tour_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT'
      AND (NEW.tour_scheduled_for IS NOT NULL OR NEW.tour_completed_at IS NOT NULL))
     OR (TG_OP = 'UPDATE'
      AND (NEW.tour_scheduled_for IS DISTINCT FROM OLD.tour_scheduled_for
        OR NEW.tour_completed_at IS DISTINCT FROM OLD.tour_completed_at)) THEN
    RAISE EXCEPTION 'Tours are recorded in the tour list; use the tour commands'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION haven.guard_referral_lead_tour_columns()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_referral_leads_tour_columns_guard
  BEFORE INSERT OR UPDATE ON public.referral_leads
  FOR EACH ROW EXECUTE FUNCTION haven.guard_referral_lead_tour_columns();

-- The episode event carries tours into the lead's history timeline.
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT constraint_row.conname INTO v_name
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.referral_episode_events'::regclass
    AND constraint_row.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%event_kind%'
    AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE '%admission_transition%';
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'referral_episode_events event_kind check not found';
  END IF;
  EXECUTE pg_catalog.format('ALTER TABLE public.referral_episode_events DROP CONSTRAINT %I', v_name);
END
$$;

ALTER TABLE public.referral_episode_events
  ADD CONSTRAINT referral_episode_events_event_kind_check CHECK (event_kind IN (
    'captured', 'assigned', 'ownership_handoff_requested',
    'ownership_overridden', 'coverage_accepted', 'interaction_recorded',
    'waiting_started', 'review_started', 'resumed', 'next_action_set',
    'interest_recorded', 'closed', 'reopened', 'contact_added',
    'contact_linked', 'contact_permission_recorded', 'identity_merged',
    'identity_split', 'identity_undo', 'compatibility_updated',
    'admission_transition', 'tour_recorded'
  ));

-- ---------------------------------------------------------------------------
-- The command
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_tour_command(
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
  v_episode public.referral_leads;
  v_before public.referral_leads;
  v_replayed public.referral_episode_events;
  v_event public.referral_episode_events;
  v_tour public.referral_tours;
  v_previous public.referral_tours;
  v_scheduled_for timestamptz;
  v_completed_at timestamptz;
  v_owner_id uuid;
  v_tour_id uuid;
  v_note text;
  v_outcome public.referral_tour_outcome;
  v_status public.referral_lead_status;
  v_mirror_scheduled timestamptz;
  v_mirror_completed timestamptz;
  v_has_completed boolean;
  v_has_open boolean;
  v_effective_at timestamptz := pg_catalog.clock_timestamp();
  v_owner_name text;
BEGIN
  CASE p_command
    WHEN 'schedule' THEN
      v_allowed_keys := ARRAY['scheduled_for','owner_user_id'];
    WHEN 'reschedule' THEN
      v_allowed_keys := ARRAY['tour_id','scheduled_for','owner_user_id','feedback_note'];
    WHEN 'record_outcome' THEN
      v_allowed_keys := ARRAY['tour_id','outcome','completed_at','feedback_note'];
    ELSE
      RAISE EXCEPTION 'Unsupported referral tour command' USING ERRCODE = '22023';
  END CASE;

  v_problem := haven.referral_request_problem(
    p_request_key, p_expected_revision, p_payload, v_allowed_keys
  );
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023';
  END IF;

  v_actor_id := haven.authorized_user_id();
  v_organization_id := haven.organization_id();
  IF v_actor_id IS NULL OR v_organization_id IS NULL
     OR NOT haven.referral_capability('tour_write') THEN
    RAISE EXCEPTION 'Tour write authority required' USING ERRCODE = '42501';
  END IF;

  v_request_hash := haven.referral_request_hash(
    pg_catalog.jsonb_build_object(
      'command', 'tour:' || p_command,
      'episode_id', p_episode_id,
      'expected_revision', p_expected_revision,
      'payload', p_payload
    )
  );
  PERFORM haven.referral_request_lock(v_organization_id, p_request_key);

  SELECT lead.* INTO v_episode
  FROM public.referral_leads AS lead
  WHERE lead.id = p_episode_id
    AND lead.organization_id = v_organization_id
    AND lead.deleted_at IS NULL
    AND haven.has_facility_access(lead.facility_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral episode unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM haven.lock_referral_actor_authority(
    v_episode.organization_id, v_episode.facility_id, 'tour_write'
  );

  v_replayed := haven.referral_replay(
    v_organization_id, p_episode_id, p_request_key, v_request_hash
  );
  IF v_replayed.id IS NOT NULL THEN
    RETURN haven.referral_episode_reply(v_episode, v_replayed, true)
      || pg_catalog.jsonb_build_object('tour_id', v_replayed.details -> 'tour_id');
  END IF;
  IF p_expected_revision IS DISTINCT FROM v_episode.episode_revision THEN
    RAISE EXCEPTION 'Referral episode changed; reload before saving'
      USING ERRCODE = '40001';
  END IF;
  IF v_episode.work_state = 'closed' THEN
    RAISE EXCEPTION 'Closed referral cannot receive a tour' USING ERRCODE = '22023';
  END IF;
  v_before := v_episode;

  v_scheduled_for := haven.referral_timestamp(p_payload, 'scheduled_for');
  v_completed_at := haven.referral_timestamp(p_payload, 'completed_at');
  v_owner_id := haven.referral_uuid(p_payload, 'owner_user_id');
  v_tour_id := haven.referral_uuid(p_payload, 'tour_id');
  v_note := haven.referral_text(p_payload, 'feedback_note', 4000);

  IF p_command IN ('reschedule', 'record_outcome') THEN
    IF v_tour_id IS NULL THEN
      RAISE EXCEPTION 'Choose the tour' USING ERRCODE = '22023';
    END IF;
    SELECT tour.* INTO v_previous
    FROM public.referral_tours AS tour
    WHERE tour.id = v_tour_id
      AND tour.referral_lead_id = v_episode.id
      AND tour.organization_id = v_episode.organization_id
      AND tour.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Tour is not part of this referral' USING ERRCODE = '22023';
    END IF;
    IF v_previous.outcome <> 'scheduled' THEN
      RAISE EXCEPTION 'This tour already has a result' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_command IN ('schedule', 'reschedule') THEN
    IF v_scheduled_for IS NULL THEN
      RAISE EXCEPTION 'Enter when the tour is scheduled' USING ERRCODE = '22023';
    END IF;
    IF p_command = 'reschedule' THEN
      v_owner_id := COALESCE(v_owner_id, v_previous.owner_user_id);
    END IF;
    IF v_owner_id IS NULL THEN
      RAISE EXCEPTION 'Choose who gives the tour' USING ERRCODE = '22023';
    END IF;
    IF NOT haven.referral_tour_owner_current(
      v_owner_id, v_episode.organization_id, v_episode.facility_id
    ) THEN
      RAISE EXCEPTION 'That person cannot give tours at this building' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM haven.activate_referral_command(false);

  IF p_command = 'schedule' THEN
    INSERT INTO public.referral_tours (
      organization_id, facility_id, referral_lead_id, scheduled_for,
      owner_user_id, outcome, recorded_by, created_by, updated_by
    ) VALUES (
      v_episode.organization_id, v_episode.facility_id, v_episode.id,
      v_scheduled_for, v_owner_id, 'scheduled', v_actor_id, v_actor_id, v_actor_id
    ) RETURNING * INTO v_tour;

  ELSIF p_command = 'reschedule' THEN
    UPDATE public.referral_tours
    SET outcome = 'rescheduled',
        outcome_recorded_at = pg_catalog.clock_timestamp(),
        outcome_recorded_by = v_actor_id,
        feedback_note = COALESCE(v_note, feedback_note),
        updated_by = v_actor_id
    WHERE id = v_previous.id;
    INSERT INTO public.referral_tours (
      organization_id, facility_id, referral_lead_id, replaces_tour_id,
      scheduled_for, owner_user_id, outcome, recorded_by, created_by, updated_by
    ) VALUES (
      v_episode.organization_id, v_episode.facility_id, v_episode.id,
      v_previous.id, v_scheduled_for, v_owner_id, 'scheduled', v_actor_id,
      v_actor_id, v_actor_id
    ) RETURNING * INTO v_tour;

  ELSE
    BEGIN
      v_outcome := (haven.referral_text(p_payload, 'outcome', 20))::public.referral_tour_outcome;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Unsupported tour result' USING ERRCODE = '22023';
    END;
    IF v_outcome IS NULL OR v_outcome NOT IN ('completed', 'cancelled', 'no_show') THEN
      RAISE EXCEPTION 'Choose what happened: completed, cancelled or no-show'
        USING ERRCODE = '22023';
    END IF;
    IF v_outcome = 'completed' AND v_completed_at IS NULL THEN
      RAISE EXCEPTION 'Enter when the tour was completed' USING ERRCODE = '22023';
    END IF;
    IF v_outcome <> 'completed' AND v_completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only a completed tour has a completion time' USING ERRCODE = '22023';
    END IF;
    IF v_completed_at > pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'A completed tour cannot finish in the future' USING ERRCODE = '22023';
    END IF;
    UPDATE public.referral_tours
    SET outcome = v_outcome,
        completed_at = v_completed_at,
        feedback_note = COALESCE(v_note, feedback_note),
        outcome_recorded_at = pg_catalog.clock_timestamp(),
        outcome_recorded_by = v_actor_id,
        updated_by = v_actor_id
    WHERE id = v_previous.id
    RETURNING * INTO v_tour;
    IF v_outcome = 'completed' THEN
      v_effective_at := v_completed_at;
    END IF;
  END IF;

  -- Legacy columns and status, derived from the records.
  SELECT
    pg_catalog.bool_or(tour.outcome = 'completed'),
    pg_catalog.bool_or(tour.outcome = 'scheduled'),
    pg_catalog.max(tour.completed_at)
  INTO v_has_completed, v_has_open, v_mirror_completed
  FROM public.referral_tours AS tour
  WHERE tour.referral_lead_id = v_episode.id
    AND tour.deleted_at IS NULL;
  SELECT tour.scheduled_for INTO v_mirror_scheduled
  FROM public.referral_tours AS tour
  WHERE tour.referral_lead_id = v_episode.id
    AND tour.deleted_at IS NULL
    AND tour.outcome = 'scheduled'
  ORDER BY tour.scheduled_for ASC NULLS LAST, tour.created_at ASC
  LIMIT 1;
  IF v_mirror_scheduled IS NULL THEN
    SELECT tour.scheduled_for INTO v_mirror_scheduled
    FROM public.referral_tours AS tour
    WHERE tour.referral_lead_id = v_episode.id
      AND tour.deleted_at IS NULL
      AND tour.outcome = 'completed'
    ORDER BY tour.completed_at DESC, tour.created_at DESC
    LIMIT 1;
  END IF;

  v_status := v_episode.status;
  IF COALESCE(v_has_completed, false)
     AND v_status IN ('new', 'contacted', 'tour_scheduled') THEN
    v_status := 'tour_completed';
  ELSIF COALESCE(v_has_open, false) AND v_status IN ('new', 'contacted') THEN
    v_status := 'tour_scheduled';
  END IF;

  PERFORM pg_catalog.set_config('haven.referral_tour_sync', 'on', true);
  UPDATE public.referral_leads
  SET status = v_status,
      tour_scheduled_for = v_mirror_scheduled,
      tour_completed_at = v_mirror_completed,
      episode_revision = haven.referral_revision(),
      updated_by = v_actor_id
  WHERE id = v_episode.id
  RETURNING * INTO v_episode;
  PERFORM pg_catalog.set_config('haven.referral_tour_sync', '', true);

  SELECT NULLIF(pg_catalog.btrim(profile.full_name), '') INTO v_owner_name
  FROM public.user_profiles AS profile
  WHERE profile.id = v_tour.owner_user_id;

  v_event := haven.write_referral_episode_event(
    v_before, v_episode, 'tour_recorded', p_request_key, v_request_hash,
    p_expected_revision, 'instant', v_effective_at, NULL, 'native', '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'action', p_command,
      'tour_id', v_tour.id,
      'replaces_tour_id', v_tour.replaces_tour_id,
      'previous_scheduled_for', v_previous.scheduled_for,
      'facility_id', v_tour.facility_id,
      'scheduled_for', v_tour.scheduled_for,
      'owner_user_id', v_tour.owner_user_id,
      'owner_name', v_owner_name,
      'outcome', v_tour.outcome,
      'completed_at', v_tour.completed_at,
      'feedback_note', v_note
    )
  );

  PERFORM haven.deactivate_referral_command();
  RETURN haven.referral_episode_reply(v_episode, v_event, false)
    || pg_catalog.jsonb_build_object('tour_id', v_tour.id);
END;
$function$;

COMMENT ON FUNCTION public.referral_tour_command(uuid, text, text, text, jsonb) IS
  'Schedule, reschedule or record the result of a prospect tour (COL-332). COL-37 ruling: definer required -- referral_tours, referral_leads and referral_episode_events are not writable by authenticated (379/380 made the referral module RPC-only), and the command calls haven helpers authenticated cannot execute (activate_referral_command, write_referral_episode_event). It checks the caller first through haven.referral_capability(''tour_write'') and the lead''s facility, locks the actor''s authority, and writes only the one lead named.';

REVOKE ALL ON FUNCTION public.referral_tour_command(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.referral_tour_command(uuid, text, text, text, jsonb)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- The read
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_episode_tours_read(p_episode_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_episode public.referral_leads;
  v_can_notes boolean;
  v_can_write boolean := haven.referral_capability('tour_write');
BEGIN
  IF NOT haven.referral_capability('lead_read') THEN
    RAISE EXCEPTION 'Referral read authority required' USING ERRCODE = '42501';
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
  v_can_notes := haven.referral_capability('work_note_read')
    AND v_episode.pii_access_tier <> 'public_summary';

  RETURN pg_catalog.jsonb_build_object(
    'self_user_id', haven.authorized_user_id(),
    'can_write', v_can_write AND v_episode.work_state <> 'closed',
    'episode_revision', v_episode.episode_revision,
    'facility_id', v_episode.facility_id,
    'facility_name', (
      SELECT facility.name FROM public.facilities AS facility
      WHERE facility.id = v_episode.facility_id
    ),
    'tours', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', tour.id,
        'replaces_tour_id', tour.replaces_tour_id,
        'replaced_by_tour_id', (
          SELECT successor.id FROM public.referral_tours AS successor
          WHERE successor.replaces_tour_id = tour.id AND successor.deleted_at IS NULL
        ),
        'scheduled_for', tour.scheduled_for,
        'owner_user_id', tour.owner_user_id,
        'owner_name', (
          SELECT NULLIF(pg_catalog.btrim(profile.full_name), '')
          FROM public.user_profiles AS profile
          WHERE profile.id = tour.owner_user_id
            AND profile.organization_id = v_episode.organization_id
        ),
        'outcome', tour.outcome,
        'completed_at', tour.completed_at,
        'feedback_note', CASE WHEN v_can_notes THEN tour.feedback_note END,
        'feedback_restricted', tour.feedback_note IS NOT NULL AND NOT v_can_notes,
        'recorded_at', tour.created_at,
        'recorded_by_name', (
          SELECT NULLIF(pg_catalog.btrim(profile.full_name), '')
          FROM public.user_profiles AS profile
          WHERE profile.id = tour.recorded_by
            AND profile.organization_id = v_episode.organization_id
        ),
        'outcome_recorded_at', tour.outcome_recorded_at,
        'outcome_recorded_by_name', (
          SELECT NULLIF(pg_catalog.btrim(profile.full_name), '')
          FROM public.user_profiles AS profile
          WHERE profile.id = tour.outcome_recorded_by
            AND profile.organization_id = v_episode.organization_id
        ),
        'backfilled', tour.backfill_source IS NOT NULL
      ) ORDER BY tour.scheduled_for DESC NULLS LAST, tour.created_at DESC)
      FROM public.referral_tours AS tour
      WHERE tour.referral_lead_id = v_episode.id
        AND tour.organization_id = v_episode.organization_id
        AND tour.deleted_at IS NULL
    ), '[]'::jsonb),
    'eligible_owners', CASE WHEN v_can_write THEN COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', profile.id, 'full_name', profile.full_name
      ) ORDER BY profile.full_name, profile.id)
      FROM public.user_profiles AS profile
      WHERE profile.organization_id = v_episode.organization_id
        AND profile.deleted_at IS NULL
        AND profile.is_active
        AND NULLIF(pg_catalog.btrim(profile.full_name), '') IS NOT NULL
        AND haven.referral_tour_owner_current(
          profile.id, v_episode.organization_id, v_episode.facility_id
        )
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END;
$function$;

COMMENT ON FUNCTION public.referral_episode_tours_read(uuid) IS
  'Tours of one referral lead with owner and recorder names (COL-332). COL-37 ruling: definer required -- the feedback note is withheld from authenticated by column grant and returned only to work_note_read holders on leads that are not public_summary, and most tour roles cannot read other user_profiles rows under RLS yet must see who gives a tour and pick an eligible owner. Gated on lead_read and the lead''s facility; returns names only for people.';

REVOKE ALL ON FUNCTION public.referral_episode_tours_read(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.referral_episode_tours_read(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- History: tour details for work-note readers (copied from 506, one change)
-- ---------------------------------------------------------------------------
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
  v_can_work_notes boolean := haven.referral_capability('work_note_read');
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
                 'coverage_accepted', 'waiting_started', 'review_started', 'resumed',
                 'tour_recorded'
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

-- ---------------------------------------------------------------------------
-- Backfill the single-tour columns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.backfill_referral_tours_from_lead_columns()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  PERFORM haven.activate_referral_command(false);
  INSERT INTO public.referral_tours (
    organization_id, facility_id, referral_lead_id, scheduled_for, owner_user_id,
    outcome, completed_at, recorded_by, backfill_source, created_by, updated_by
  )
  SELECT
    lead.organization_id,
    lead.facility_id,
    lead.id,
    lead.tour_scheduled_for,
    NULL,
    CASE WHEN lead.tour_completed_at IS NOT NULL
      THEN 'completed'::public.referral_tour_outcome
      ELSE 'scheduled'::public.referral_tour_outcome
    END,
    lead.tour_completed_at,
    lead.tour_owner_user_id,
    'referral_leads_tour_columns',
    lead.tour_owner_user_id,
    lead.tour_owner_user_id
  FROM public.referral_leads AS lead
  WHERE lead.deleted_at IS NULL
    AND (lead.tour_scheduled_for IS NOT NULL OR lead.tour_completed_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.referral_tours AS tour
      WHERE tour.referral_lead_id = lead.id
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM haven.deactivate_referral_command();
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION haven.backfill_referral_tours_from_lead_columns()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT haven.backfill_referral_tours_from_lead_columns() AS backfilled_tours;

NOTIFY pgrst, 'reload schema';

COMMIT;
