-- Referral tour records rollback-only probe (COL-332).
-- Every tour is its own record with the prospect, the building and the result
-- (Brian, 2026-09-24). A reschedule chain counts once; repeated tours each
-- count; owner, org_admin, facility_admin, manager, admin_assistant and
-- recruiter record tours; coordinator and med_tech read them without the
-- feedback note and cannot write; cook and staff without the facility read
-- nothing. The legacy lead columns follow the records and cannot be written
-- any other way.
BEGIN;

GRANT USAGE ON SCHEMA auth, haven TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'role','')
$$;

CREATE TEMP TABLE tour_fixture AS
SELECT
  gen_random_uuid() organization_id,
  gen_random_uuid() entity_id,
  gen_random_uuid() facility_a,
  gen_random_uuid() facility_b,
  gen_random_uuid() recruiter_user, gen_random_uuid() recruiter_session,
  gen_random_uuid() manager_user, gen_random_uuid() manager_session,
  gen_random_uuid() assistant_user, gen_random_uuid() assistant_session,
  gen_random_uuid() coordinator_user, gen_random_uuid() coordinator_session,
  gen_random_uuid() med_tech_user, gen_random_uuid() med_tech_session,
  gen_random_uuid() cook_user, gen_random_uuid() cook_session,
  gen_random_uuid() outsider_user, gen_random_uuid() outsider_session,
  NULL::uuid episode_id,
  NULL::text revision,
  NULL::uuid first_tour,
  NULL::uuid second_tour,
  NULL::uuid third_tour,
  NULL::uuid repeat_tour,
  NULL::uuid backfill_scheduled_lead,
  NULL::uuid backfill_completed_lead;

INSERT INTO public.organizations (id, name)
SELECT organization_id, 'Tour probe organization' FROM tour_fixture;
INSERT INTO public.entities (id, organization_id, name)
SELECT entity_id, organization_id, 'Tour probe entity' FROM tour_fixture;
INSERT INTO public.facilities (
  id, entity_id, organization_id, name, address_line_1, city, state, zip,
  total_licensed_beds
)
SELECT facility_a, entity_id, organization_id, 'Tour probe building A',
  '1 Test Way', 'Test', 'FL', '00000', 10
FROM tour_fixture
UNION ALL
SELECT facility_b, entity_id, organization_id, 'Tour probe building B',
  '2 Test Way', 'Test', 'FL', '00000', 10
FROM tour_fixture;

CREATE TEMP TABLE tour_actor (
  label text PRIMARY KEY,
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  full_name text NOT NULL,
  app_role text NOT NULL,
  facility_id uuid NOT NULL,
  claim_version integer
);
INSERT INTO tour_actor (label, user_id, session_id, full_name, app_role, facility_id)
SELECT 'recruiter', recruiter_user, recruiter_session, 'Robin Recruiter', 'recruiter', facility_a FROM tour_fixture
UNION ALL SELECT 'manager', manager_user, manager_session, 'Morgan Manager', 'manager', facility_a FROM tour_fixture
UNION ALL SELECT 'assistant', assistant_user, assistant_session, 'Ari Assistant', 'admin_assistant', facility_a FROM tour_fixture
UNION ALL SELECT 'coordinator', coordinator_user, coordinator_session, 'Casey Coordinator', 'coordinator', facility_a FROM tour_fixture
UNION ALL SELECT 'med_tech', med_tech_user, med_tech_session, 'Mel MedTech', 'med_tech', facility_a FROM tour_fixture
UNION ALL SELECT 'cook', cook_user, cook_session, 'Cam Cook', 'cook', facility_a FROM tour_fixture
UNION ALL SELECT 'outsider', outsider_user, outsider_session, 'Olive Outsider', 'recruiter', facility_b FROM tour_fixture;

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
SELECT user_id, user_id || '@tour-probe.invalid', '{}'::jsonb, '{}'::jsonb FROM tour_actor;
INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role, is_active)
SELECT actor.user_id, fixture.organization_id, actor.user_id || '@tour-probe.invalid',
  actor.full_name, actor.app_role::public.app_role, true
FROM tour_actor AS actor CROSS JOIN tour_fixture AS fixture;
INSERT INTO auth.sessions (id, user_id) SELECT session_id, user_id FROM tour_actor;
INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
SELECT actor.user_id, actor.facility_id, fixture.organization_id, true
FROM tour_actor AS actor CROSS JOIN tour_fixture AS fixture;
UPDATE tour_actor AS actor
SET claim_version = (SELECT auth_claim_version FROM public.user_profiles WHERE id = actor.user_id);

GRANT SELECT, INSERT, UPDATE ON tour_fixture, tour_actor TO authenticated;

CREATE FUNCTION pg_temp.act_as(p_label text)
RETURNS void
LANGUAGE sql
AS $$
  SELECT pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', actor.user_id,
      'session_id', actor.session_id,
      'role', 'authenticated',
      'auth_claim_version', actor.claim_version,
      'organization_id', gen_random_uuid()
    )::text,
    true
  )
  FROM tour_actor AS actor
  WHERE actor.label = p_label
$$;

-- The recruiter captures a lead and schedules a tour.
SELECT pg_temp.act_as('recruiter');
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
  captured jsonb;
  reply jsonb;
  lead public.referral_leads;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  captured := public.referral_episode_capture(
    'tour-probe:capture', public.referral_episode_initial_revision(),
    pg_catalog.jsonb_build_object('facility_id', fixture.facility_a,
      'first_name', 'Avery', 'last_name', 'Prospect', 'receipt_precision', 'unknown'));

  -- A person outside the tour roles cannot be named as the tour's owner.
  BEGIN
    PERFORM public.referral_tour_command(
      (captured ->> 'episode_id')::uuid, 'tour-probe:schedule:bad-owner',
      captured ->> 'episode_revision', 'schedule',
      pg_catalog.jsonb_build_object('scheduled_for', '2026-10-01T14:00:00Z',
        'owner_user_id', fixture.coordinator_user));
    RAISE EXCEPTION 'A coordinator was accepted as a tour owner';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  reply := public.referral_tour_command(
    (captured ->> 'episode_id')::uuid, 'tour-probe:schedule:one',
    captured ->> 'episode_revision', 'schedule',
    pg_catalog.jsonb_build_object('scheduled_for', '2026-10-01T14:00:00Z',
      'owner_user_id', fixture.recruiter_user));
  IF reply ->> 'event_kind' IS DISTINCT FROM 'tour_recorded'
     OR reply ->> 'status' IS DISTINCT FROM 'tour_scheduled' THEN
    RAISE EXCEPTION 'Scheduling a tour did not record the event and status: %', reply;
  END IF;

  -- A retry with the same key replays; it does not record a second tour.
  IF (public.referral_tour_command(
        (captured ->> 'episode_id')::uuid, 'tour-probe:schedule:one',
        captured ->> 'episode_revision', 'schedule',
        pg_catalog.jsonb_build_object('scheduled_for', '2026-10-01T14:00:00Z',
          'owner_user_id', fixture.recruiter_user)) ->> 'replayed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'A retried tour save was not a replay';
  END IF;

  UPDATE tour_fixture
  SET episode_id = (captured ->> 'episode_id')::uuid,
      revision = reply ->> 'episode_revision',
      first_tour = (reply ->> 'tour_id')::uuid;
END $$;

-- A manager (tour_write, not lead_write) reschedules it.
RESET ROLE;
SELECT pg_temp.act_as('manager');
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
  reply jsonb;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  -- A stale revision is refused so nothing is overwritten.
  BEGIN
    PERFORM public.referral_tour_command(
      fixture.episode_id, 'tour-probe:reschedule:stale',
      public.referral_episode_initial_revision(), 'reschedule',
      pg_catalog.jsonb_build_object('tour_id', fixture.first_tour,
        'scheduled_for', '2026-10-02T14:00:00Z'));
    RAISE EXCEPTION 'A stale tour save was accepted';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  reply := public.referral_tour_command(
    fixture.episode_id, 'tour-probe:reschedule:one', fixture.revision, 'reschedule',
    pg_catalog.jsonb_build_object('tour_id', fixture.first_tour,
      'scheduled_for', '2026-10-02T14:00:00Z',
      'feedback_note', 'Daughter asked to move it a day.'));
  UPDATE tour_fixture
  SET revision = reply ->> 'episode_revision', second_tour = (reply ->> 'tour_id')::uuid;
END $$;

-- An admin assistant reschedules again and hands the tour to the manager.
RESET ROLE;
SELECT pg_temp.act_as('assistant');
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
  reply jsonb;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  reply := public.referral_tour_command(
    fixture.episode_id, 'tour-probe:reschedule:two', fixture.revision, 'reschedule',
    pg_catalog.jsonb_build_object('tour_id', fixture.second_tour,
      'scheduled_for', '2026-10-03T15:30:00Z', 'owner_user_id', fixture.manager_user));
  UPDATE tour_fixture
  SET revision = reply ->> 'episode_revision', third_tour = (reply ->> 'tour_id')::uuid;
  SELECT * INTO STRICT fixture FROM tour_fixture;

  -- A tour that was already rescheduled cannot be rescheduled again.
  BEGIN
    PERFORM public.referral_tour_command(
      fixture.episode_id, 'tour-probe:reschedule:closed', fixture.revision, 'reschedule',
      pg_catalog.jsonb_build_object('tour_id', fixture.first_tour,
        'scheduled_for', '2026-10-04T14:00:00Z'));
    RAISE EXCEPTION 'A rescheduled tour was rescheduled twice';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END $$;

-- The reschedule chain counts once and the legacy columns follow it.
RESET ROLE;
DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
  lead public.referral_leads;
  live integer;
  total integer;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  SELECT pg_catalog.count(*) FILTER (WHERE outcome <> 'rescheduled'), pg_catalog.count(*)
  INTO live, total
  FROM public.referral_tours WHERE referral_lead_id = fixture.episode_id AND deleted_at IS NULL;
  IF live <> 1 OR total <> 3 THEN
    RAISE EXCEPTION 'A reschedule chain counted % live tours of % records', live, total;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.referral_tours AS third
    JOIN public.referral_tours AS second ON second.id = third.replaces_tour_id
    JOIN public.referral_tours AS first ON first.id = second.replaces_tour_id
    WHERE third.id = fixture.third_tour
      AND second.id = fixture.second_tour
      AND first.id = fixture.first_tour
      AND first.outcome = 'rescheduled'
      AND first.feedback_note = 'Daughter asked to move it a day.'
      AND second.outcome = 'rescheduled'
      AND third.outcome = 'scheduled'
      AND third.owner_user_id = fixture.manager_user
      AND second.owner_user_id = fixture.recruiter_user
      AND third.recorded_by = fixture.assistant_user
      AND third.facility_id = fixture.facility_a
  ) THEN
    RAISE EXCEPTION 'The reschedule chain is not linked the way it was recorded';
  END IF;
  SELECT * INTO STRICT lead FROM public.referral_leads WHERE id = fixture.episode_id;
  IF lead.tour_scheduled_for IS DISTINCT FROM '2026-10-03T15:30:00Z'::timestamptz
     OR lead.tour_completed_at IS NOT NULL
     OR lead.status IS DISTINCT FROM 'tour_scheduled' THEN
    RAISE EXCEPTION 'Legacy tour columns did not follow the records: % % %',
      lead.tour_scheduled_for, lead.tour_completed_at, lead.status;
  END IF;
END $$;

-- Coordinator and med-tech read tours without the note and cannot record them.
SELECT pg_temp.act_as('coordinator');
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
  tours jsonb;
  seen integer;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  SELECT pg_catalog.count(*) INTO seen FROM public.referral_tours
  WHERE referral_lead_id = fixture.episode_id;
  IF seen <> 3 THEN
    RAISE EXCEPTION 'Coordinator should read the three tour records, saw %', seen;
  END IF;
  tours := public.referral_episode_tours_read(fixture.episode_id);
  IF (tours ->> 'can_write')::boolean
     OR pg_catalog.jsonb_array_length(tours -> 'tours') <> 3
     OR tours -> 'eligible_owners' <> '[]'::jsonb
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(tours -> 'tours') AS tour
       WHERE tour ->> 'feedback_note' IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(tours -> 'tours') AS tour
       WHERE (tour ->> 'feedback_restricted')::boolean
     ) THEN
    RAISE EXCEPTION 'Coordinator tour read is wrong: %', tours;
  END IF;
  BEGIN
    PERFORM public.referral_tour_command(
      fixture.episode_id, 'tour-probe:coordinator', fixture.revision, 'schedule',
      pg_catalog.jsonb_build_object('scheduled_for', '2026-10-05T14:00:00Z',
        'owner_user_id', fixture.recruiter_user));
    RAISE EXCEPTION 'A coordinator recorded a tour';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM pg_catalog.count(*) FROM (SELECT feedback_note FROM public.referral_tours) AS notes;
    RAISE EXCEPTION 'The feedback note column is readable directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;
SELECT pg_temp.act_as('med_tech');
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  BEGIN
    PERFORM public.referral_tour_command(
      fixture.episode_id, 'tour-probe:med-tech', fixture.revision, 'schedule',
      pg_catalog.jsonb_build_object('scheduled_for', '2026-10-05T14:00:00Z',
        'owner_user_id', fixture.recruiter_user));
    RAISE EXCEPTION 'A med-tech recorded a tour';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT pg_catalog.count(*) FROM public.referral_tours WHERE referral_lead_id = fixture.episode_id) <> 3 THEN
    RAISE EXCEPTION 'Med-tech should read the tour records';
  END IF;
END $$;

-- A cook, and a recruiter at another building, read nothing.
RESET ROLE;
SELECT pg_temp.act_as('cook');
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  IF EXISTS (SELECT 1 FROM public.referral_tours WHERE referral_lead_id = fixture.episode_id) THEN
    RAISE EXCEPTION 'A cook can read tour records';
  END IF;
  BEGIN
    PERFORM public.referral_episode_tours_read(fixture.episode_id);
    RAISE EXCEPTION 'A cook can read tours through the RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;
SELECT pg_temp.act_as('outsider');
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  IF EXISTS (SELECT 1 FROM public.referral_tours WHERE referral_lead_id = fixture.episode_id) THEN
    RAISE EXCEPTION 'A recruiter at another building can read these tours';
  END IF;
  BEGIN
    PERFORM public.referral_tour_command(
      fixture.episode_id, 'tour-probe:outsider', fixture.revision, 'schedule',
      pg_catalog.jsonb_build_object('scheduled_for', '2026-10-05T14:00:00Z',
        'owner_user_id', fixture.outsider_user));
    RAISE EXCEPTION 'A recruiter at another building recorded a tour';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- The recruiter records the result, schedules a second visit, and cannot
-- write tours or the legacy columns any other way.
RESET ROLE;
SELECT pg_temp.act_as('recruiter');
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
  reply jsonb;
  tours jsonb;
  history jsonb;
  updated_at timestamptz;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  BEGIN
    PERFORM public.referral_tour_command(
      fixture.episode_id, 'tour-probe:outcome:no-time', fixture.revision, 'record_outcome',
      pg_catalog.jsonb_build_object('tour_id', fixture.third_tour, 'outcome', 'completed'));
    RAISE EXCEPTION 'A completed tour was accepted without its completion time';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.referral_tour_command(
      fixture.episode_id, 'tour-probe:outcome:no-show-time', fixture.revision, 'record_outcome',
      pg_catalog.jsonb_build_object('tour_id', fixture.third_tour, 'outcome', 'no_show',
        'completed_at', '2026-09-20T15:00:00Z'));
    RAISE EXCEPTION 'A no-show was accepted with a completion time';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  reply := public.referral_tour_command(
    fixture.episode_id, 'tour-probe:outcome:done', fixture.revision, 'record_outcome',
    pg_catalog.jsonb_build_object('tour_id', fixture.third_tour, 'outcome', 'completed',
      'completed_at', '2026-09-20T15:45:00Z',
      'feedback_note', 'Loved the garden; worried about stairs.'));
  IF reply ->> 'status' IS DISTINCT FROM 'tour_completed' THEN
    RAISE EXCEPTION 'A completed tour did not move the lead to tour completed: %', reply;
  END IF;
  -- Repeated tours are each their own record.
  reply := public.referral_tour_command(
    fixture.episode_id, 'tour-probe:schedule:repeat', reply ->> 'episode_revision', 'schedule',
    pg_catalog.jsonb_build_object('scheduled_for', '2026-10-10T14:00:00Z',
      'owner_user_id', fixture.recruiter_user));
  IF reply ->> 'status' IS DISTINCT FROM 'tour_completed' THEN
    RAISE EXCEPTION 'A second visit moved the lead status backwards: %', reply;
  END IF;
  UPDATE tour_fixture
  SET revision = reply ->> 'episode_revision', repeat_tour = (reply ->> 'tour_id')::uuid;

  tours := public.referral_episode_tours_read(fixture.episode_id);
  IF NOT (tours ->> 'can_write')::boolean
     OR pg_catalog.jsonb_array_length(tours -> 'tours') <> 4
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(tours -> 'tours') AS tour
       WHERE tour ->> 'id' = fixture.third_tour::text
         AND tour ->> 'outcome' = 'completed'
         AND tour ->> 'feedback_note' = 'Loved the garden; worried about stairs.'
         AND tour ->> 'owner_name' = 'Morgan Manager'
         AND tour ->> 'recorded_by_name' = 'Ari Assistant'
         AND tour ->> 'outcome_recorded_by_name' = 'Robin Recruiter'
         AND tour ->> 'replaces_tour_id' = fixture.second_tour::text
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(tours -> 'eligible_owners') AS person
       WHERE person ->> 'user_id' = fixture.assistant_user::text
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(tours -> 'eligible_owners') AS person
       WHERE person ->> 'user_id' IN (fixture.coordinator_user::text, fixture.med_tech_user::text,
         fixture.cook_user::text, fixture.outsider_user::text)
         OR person ?| ARRAY['email', 'app_role', 'phone']
     ) THEN
    RAISE EXCEPTION 'Recruiter tour read is wrong: %', tours;
  END IF;

  history := public.referral_episode_history_read(fixture.episode_id, NULL, 100);
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(history -> 'events') AS event
      WHERE event ->> 'event_kind' = 'tour_recorded') <> 5
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(history -> 'events') AS event
       WHERE event ->> 'event_kind' = 'tour_recorded'
         AND event -> 'details' ->> 'action' = 'record_outcome'
         AND event -> 'details' ->> 'feedback_note' = 'Loved the garden; worried about stairs.'
         AND event ->> 'effective_at' IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Tours are missing from the lead history: %', history;
  END IF;

  BEGIN
    INSERT INTO public.referral_tours (organization_id, facility_id, referral_lead_id,
      scheduled_for, owner_user_id, recorded_by)
    VALUES (fixture.organization_id, fixture.facility_a, fixture.episode_id,
      '2026-10-11T14:00:00Z', fixture.recruiter_user, fixture.recruiter_user);
    RAISE EXCEPTION 'A tour was written without the tour command';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT lead.updated_at INTO STRICT updated_at
  FROM public.referral_leads_authorized_read(fixture.facility_a, fixture.episode_id, NULL, 1, 0) AS lead;
  BEGIN
    PERFORM public.referral_lead_update(
      fixture.episode_id, updated_at, '{"tour_scheduled_for":"2026-10-12T14:00:00Z"}'::jsonb);
    RAISE EXCEPTION 'The legacy tour column was written around the tour records';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END $$;

RESET ROLE;
DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
  lead public.referral_leads;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  SELECT * INTO STRICT lead FROM public.referral_leads WHERE id = fixture.episode_id;
  IF lead.tour_scheduled_for IS DISTINCT FROM '2026-10-10T14:00:00Z'::timestamptz
     OR lead.tour_completed_at IS DISTINCT FROM '2026-09-20T15:45:00Z'::timestamptz THEN
    RAISE EXCEPTION 'Legacy columns did not follow a completed tour and a second visit: % %',
      lead.tour_scheduled_for, lead.tour_completed_at;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.referral_tours
      WHERE referral_lead_id = fixture.episode_id AND outcome <> 'rescheduled') <> 2 THEN
    RAISE EXCEPTION 'Two real tours should count twice and the chain once';
  END IF;
END $$;

-- Backfill: copies only what the old single-tour fields recorded and never
-- guesses a result.
SELECT pg_temp.act_as('recruiter');
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  UPDATE tour_fixture
  SET backfill_scheduled_lead = (public.referral_episode_capture(
        'tour-probe:capture:backfill-scheduled', public.referral_episode_initial_revision(),
        pg_catalog.jsonb_build_object('facility_id', fixture.facility_a,
          'first_name', 'Bailey', 'last_name', 'Scheduled', 'receipt_precision', 'unknown')) ->> 'episode_id')::uuid,
      backfill_completed_lead = (public.referral_episode_capture(
        'tour-probe:capture:backfill-completed', public.referral_episode_initial_revision(),
        pg_catalog.jsonb_build_object('facility_id', fixture.facility_a,
          'first_name', 'Cory', 'last_name', 'Completed', 'receipt_precision', 'unknown')) ->> 'episode_id')::uuid;
END $$;

RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claims', '', true);
ALTER TABLE public.referral_leads DISABLE TRIGGER USER;
UPDATE public.referral_leads AS lead
SET tour_scheduled_for = '2026-08-01T14:00:00Z', tour_owner_user_id = fixture.recruiter_user
FROM tour_fixture AS fixture WHERE lead.id = fixture.backfill_scheduled_lead;
UPDATE public.referral_leads AS lead
SET tour_scheduled_for = '2026-08-02T14:00:00Z', tour_completed_at = '2026-08-02T15:00:00Z',
    tour_owner_user_id = fixture.manager_user
FROM tour_fixture AS fixture WHERE lead.id = fixture.backfill_completed_lead;
ALTER TABLE public.referral_leads ENABLE TRIGGER USER;

DO $$
DECLARE
  fixture tour_fixture%ROWTYPE;
  copied integer;
BEGIN
  SELECT * INTO STRICT fixture FROM tour_fixture;
  copied := haven.backfill_referral_tours_from_lead_columns();
  IF copied <> 2 THEN
    RAISE EXCEPTION 'Backfill copied % tours, expected the two leads with old tour fields', copied;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.referral_tours
    WHERE referral_lead_id = fixture.backfill_scheduled_lead
      AND outcome = 'scheduled' AND completed_at IS NULL
      AND scheduled_for = '2026-08-01T14:00:00Z'
      AND owner_user_id IS NULL AND recorded_by = fixture.recruiter_user
      AND backfill_source = 'referral_leads_tour_columns'
      AND facility_id = fixture.facility_a
  ) OR NOT EXISTS (
    SELECT 1 FROM public.referral_tours
    WHERE referral_lead_id = fixture.backfill_completed_lead
      AND outcome = 'completed' AND completed_at = '2026-08-02T15:00:00Z'
      AND scheduled_for = '2026-08-02T14:00:00Z'
      AND owner_user_id IS NULL AND recorded_by = fixture.manager_user
      AND backfill_source = 'referral_leads_tour_columns'
  ) THEN
    RAISE EXCEPTION 'Backfill did not copy exactly what was recorded';
  END IF;
  IF EXISTS (SELECT 1 FROM public.referral_tours WHERE referral_lead_id = fixture.episode_id AND backfill_source IS NOT NULL) THEN
    RAISE EXCEPTION 'Backfill copied a lead that already has tour records';
  END IF;
  IF haven.backfill_referral_tours_from_lead_columns() <> 0 THEN
    RAISE EXCEPTION 'Backfill is not safe to run twice';
  END IF;
END $$;

ROLLBACK;
