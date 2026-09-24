-- Referral contact log rollback-only probe.
-- A recruiter logs a contact (how, with whom, what was said, next step) and reads
-- the full history back; a manager reads it too; public_summary leads stay closed;
-- bad methods and foreign contacts are refused.
BEGIN;

GRANT USAGE ON SCHEMA auth, haven TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'role','')
$$;

CREATE TEMP TABLE contact_log_fixture AS
SELECT
  gen_random_uuid() organization_id,
  gen_random_uuid() entity_id,
  gen_random_uuid() facility_a,
  gen_random_uuid() recruiter_user,
  gen_random_uuid() recruiter_session,
  NULL::integer recruiter_version,
  gen_random_uuid() manager_user,
  gen_random_uuid() manager_session,
  NULL::integer manager_version,
  NULL::uuid episode_id,
  NULL::uuid other_episode_id,
  NULL::uuid person_contact_id,
  NULL::uuid other_person_contact_id;

INSERT INTO public.organizations (id, name)
SELECT organization_id, 'Contact log isolated organization' FROM contact_log_fixture;
INSERT INTO public.entities (id, organization_id, name)
SELECT entity_id, organization_id, 'Contact log isolated entity' FROM contact_log_fixture;
INSERT INTO public.facilities (
  id, entity_id, organization_id, name, address_line_1, city, state, zip,
  total_licensed_beds
)
SELECT facility_a, entity_id, organization_id, 'Contact log facility',
  '1 Test Way', 'Test', 'FL', '00000', 10
FROM contact_log_fixture;

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
SELECT recruiter_user, recruiter_user || '@contact-log.invalid', '{}'::jsonb, '{}'::jsonb
FROM contact_log_fixture
UNION ALL
SELECT manager_user, manager_user || '@contact-log.invalid', '{}'::jsonb, '{}'::jsonb
FROM contact_log_fixture;

INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role, is_active)
SELECT recruiter_user, organization_id, recruiter_user || '@contact-log.invalid',
  'Robin Recruiter', 'recruiter'::public.app_role, true
FROM contact_log_fixture
UNION ALL
SELECT manager_user, organization_id, manager_user || '@contact-log.invalid',
  'Morgan Manager', 'manager'::public.app_role, true
FROM contact_log_fixture;

INSERT INTO auth.sessions (id, user_id)
SELECT recruiter_session, recruiter_user FROM contact_log_fixture
UNION ALL SELECT manager_session, manager_user FROM contact_log_fixture;

INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
SELECT recruiter_user, facility_a, organization_id, true FROM contact_log_fixture
UNION ALL SELECT manager_user, facility_a, organization_id, true FROM contact_log_fixture;

UPDATE contact_log_fixture AS fixture
SET recruiter_version = recruiter_profile.auth_claim_version,
    manager_version = manager_profile.auth_claim_version
FROM public.user_profiles AS recruiter_profile,
     public.user_profiles AS manager_profile
WHERE recruiter_profile.id = fixture.recruiter_user
  AND manager_profile.id = fixture.manager_user;

GRANT SELECT, INSERT, UPDATE ON contact_log_fixture TO authenticated;

CREATE FUNCTION pg_temp.set_contact_log_claims(p_user uuid, p_session uuid, p_version integer)
RETURNS void
LANGUAGE sql
AS $$
  SELECT pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_user,
      'session_id', p_session,
      'role', 'authenticated',
      'auth_claim_version', p_version,
      'organization_id', gen_random_uuid()
    )::text,
    true
  )
$$;

SELECT pg_temp.set_contact_log_claims(f.recruiter_user, f.recruiter_session, f.recruiter_version)
FROM contact_log_fixture AS f;

SET LOCAL ROLE authenticated;

-- The recruiter captures two leads, links a contact to each and logs a contact.
DO $$
DECLARE
  fixture contact_log_fixture%ROWTYPE;
  captured jsonb;
  other jsonb;
  added jsonb;
  other_added jsonb;
  logged jsonb;
  next_step jsonb;
  model jsonb;
  other_model jsonb;
  revision text;
  history jsonb;
  interaction jsonb;
BEGIN
  SELECT * INTO STRICT fixture FROM contact_log_fixture;
  captured := public.referral_episode_capture(
    'contact-log:capture:one', public.referral_episode_initial_revision(),
    pg_catalog.jsonb_build_object('facility_id', fixture.facility_a,
      'first_name', 'Avery', 'last_name', 'Prospect', 'receipt_precision', 'unknown'));
  other := public.referral_episode_capture(
    'contact-log:capture:two', public.referral_episode_initial_revision(),
    pg_catalog.jsonb_build_object('facility_id', fixture.facility_a,
      'first_name', 'Blake', 'last_name', 'Elsewhere', 'receipt_precision', 'unknown'));

  added := public.referral_episode_command(
    (captured ->> 'episode_id')::uuid, 'contact-log:contact:one',
    captured ->> 'episode_revision', 'contact_add',
    pg_catalog.jsonb_build_object('first_name', 'Jordan', 'last_name', 'Prospect',
      'relationship', 'Daughter', 'is_primary', true));
  other_added := public.referral_episode_command(
    (other ->> 'episode_id')::uuid, 'contact-log:contact:two',
    other ->> 'episode_revision', 'contact_add',
    pg_catalog.jsonb_build_object('first_name', 'Casey', 'last_name', 'Elsewhere',
      'relationship', 'Son', 'is_primary', true));

  model := public.referral_episode_model_read((captured ->> 'episode_id')::uuid);
  other_model := public.referral_episode_model_read((other ->> 'episode_id')::uuid);
  UPDATE contact_log_fixture
  SET episode_id = (captured ->> 'episode_id')::uuid,
      other_episode_id = (other ->> 'episode_id')::uuid,
      person_contact_id = (model -> 'contacts' -> 0 ->> 'person_contact_id')::uuid,
      other_person_contact_id = (other_model -> 'contacts' -> 0 ->> 'person_contact_id')::uuid;
  SELECT * INTO STRICT fixture FROM contact_log_fixture;
  revision := added ->> 'episode_revision';

  -- A contact linked to a different prospective resident is refused.
  BEGIN
    PERFORM public.referral_episode_command(
      fixture.episode_id, 'contact-log:interaction:foreign', revision, 'record_interaction',
      pg_catalog.jsonb_build_object('summary', 'Called', 'method', 'phone_call',
        'person_contact_id', fixture.other_person_contact_id,
        'effective_precision', 'unknown'));
    RAISE EXCEPTION 'Foreign contact was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- An unknown method is refused.
  BEGIN
    PERFORM public.referral_episode_command(
      fixture.episode_id, 'contact-log:interaction:bad-method', revision, 'record_interaction',
      pg_catalog.jsonb_build_object('summary', 'Called', 'method', 'carrier_pigeon',
        'effective_precision', 'unknown'));
    RAISE EXCEPTION 'Unknown contact method was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  logged := public.referral_episode_command(
    fixture.episode_id, 'contact-log:interaction:one', revision, 'record_interaction',
    pg_catalog.jsonb_build_object(
      'summary', 'Daughter wants a tour next week; mother uses a walker.',
      'method', 'phone_call',
      'contacted_name', 'Jordan Prospect (Daughter)',
      'person_contact_id', fixture.person_contact_id,
      'effective_precision', 'instant',
      'effective_at', '2026-09-24T14:30:00Z',
      'next_action', 'Call back to book the tour',
      'next_action_at', '2026-09-26T13:00:00Z'));
  IF logged ->> 'event_kind' IS DISTINCT FROM 'interaction_recorded' THEN
    RAISE EXCEPTION 'Recruiter could not record an interaction: %', logged;
  END IF;

  next_step := public.referral_episode_command(
    fixture.episode_id, 'contact-log:next-action:one', logged ->> 'episode_revision', 'next_action',
    pg_catalog.jsonb_build_object('next_action', 'Send the brochure',
      'next_action_at', '2026-09-25T13:00:00Z'));
  IF next_step ->> 'event_kind' IS DISTINCT FROM 'next_action_set' THEN
    RAISE EXCEPTION 'Recruiter could not set a next step: %', next_step;
  END IF;

  history := public.referral_episode_history_read(fixture.episode_id, NULL, 100);
  SELECT event INTO interaction
  FROM pg_catalog.jsonb_array_elements(history -> 'events') AS event
  WHERE event ->> 'event_kind' = 'interaction_recorded';
  IF interaction IS NULL
     OR interaction -> 'details' ->> 'summary' IS DISTINCT FROM 'Daughter wants a tour next week; mother uses a walker.'
     OR interaction -> 'details' ->> 'method' IS DISTINCT FROM 'phone_call'
     OR interaction -> 'details' ->> 'contacted_name' IS DISTINCT FROM 'Jordan Prospect (Daughter)'
     OR interaction -> 'details' ->> 'person_contact_id' IS DISTINCT FROM fixture.person_contact_id::text
     OR interaction ->> 'actor_name' IS DISTINCT FROM 'Robin Recruiter' THEN
    RAISE EXCEPTION 'Recruiter cannot read back the logged contact: %', interaction;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(history -> 'events') AS event
    WHERE event ->> 'event_kind' = 'next_action_set'
      AND event -> 'details' ->> 'next_action' = 'Send the brochure'
  ) THEN
    RAISE EXCEPTION 'Recruiter cannot read back the next step: %', history;
  END IF;
END $$;

-- A manager (contact_read, not lead_write) reads the same notes.
RESET ROLE;
SELECT pg_temp.set_contact_log_claims(f.manager_user, f.manager_session, f.manager_version)
FROM contact_log_fixture AS f;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture contact_log_fixture%ROWTYPE;
  history jsonb;
BEGIN
  SELECT * INTO STRICT fixture FROM contact_log_fixture;
  history := public.referral_episode_history_read(fixture.episode_id, NULL, 100);
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(history -> 'events') AS event
    WHERE event ->> 'event_kind' = 'interaction_recorded'
      AND event -> 'details' ->> 'method' = 'phone_call'
      AND event ->> 'actor_name' = 'Robin Recruiter'
  ) THEN
    RAISE EXCEPTION 'Manager cannot read the contact log: %', history;
  END IF;
END $$;

-- A public_summary lead keeps its work notes closed.
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claims', '', true);
ALTER TABLE public.referral_leads DISABLE TRIGGER USER;
UPDATE public.referral_leads SET pii_access_tier = 'public_summary'
WHERE id = (SELECT episode_id FROM contact_log_fixture);
ALTER TABLE public.referral_leads ENABLE TRIGGER USER;
SELECT pg_temp.set_contact_log_claims(f.manager_user, f.manager_session, f.manager_version)
FROM contact_log_fixture AS f;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture contact_log_fixture%ROWTYPE;
  history jsonb;
BEGIN
  SELECT * INTO STRICT fixture FROM contact_log_fixture;
  history := public.referral_episode_history_read(fixture.episode_id, NULL, 100);
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(history -> 'events') AS event
    WHERE event ->> 'event_kind' = 'interaction_recorded'
      AND event -> 'details' <> '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'public_summary lead exposed its contact log: %', history;
  END IF;
END $$;

RESET ROLE;

ROLLBACK;
