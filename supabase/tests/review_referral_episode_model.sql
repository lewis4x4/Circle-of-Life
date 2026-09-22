-- COL-329 rollback-only durable referral episode model probe.
BEGIN;

GRANT USAGE ON SCHEMA auth, haven TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'role','')
$$;

CREATE TEMP TABLE referral_episode_fixture AS
SELECT
  gen_random_uuid() organization_id,
  gen_random_uuid() entity_id,
  gen_random_uuid() facility_a,
  gen_random_uuid() facility_b,
  gen_random_uuid() owner_user,
  gen_random_uuid() owner_session,
  NULL::integer owner_version,
  gen_random_uuid() backup_user,
  gen_random_uuid() backup_session,
  NULL::integer backup_version,
  gen_random_uuid() admissions_user,
  gen_random_uuid() admissions_session,
  NULL::integer admissions_version,
  gen_random_uuid() inactive_user,
  gen_random_uuid() inactive_session,
  gen_random_uuid() resident_id,
  gen_random_uuid() admission_case_id,
  gen_random_uuid() source_id,
  gen_random_uuid() closure_reason_id;

INSERT INTO public.organizations (id, name)
SELECT organization_id, 'COL-329 isolated organization'
FROM referral_episode_fixture;

INSERT INTO public.entities (id, organization_id, name)
SELECT entity_id, organization_id, 'COL-329 isolated entity'
FROM referral_episode_fixture;
INSERT INTO public.facilities (
  id, entity_id, organization_id, name, address_line_1, city, state, zip,
  total_licensed_beds
)
SELECT facility_a, entity_id, organization_id, 'COL-329 facility A',
  '1 Test Way', 'Test', 'FL', '00000', 10
FROM referral_episode_fixture
UNION ALL
SELECT facility_b, entity_id, organization_id, 'COL-329 facility B',
  '2 Test Way', 'Test', 'FL', '00000', 10
FROM referral_episode_fixture;

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
SELECT owner_user, owner_user || '@col329.invalid', '{}'::jsonb, '{}'::jsonb
FROM referral_episode_fixture
UNION ALL
SELECT backup_user, backup_user || '@col329.invalid', '{}'::jsonb, '{}'::jsonb
FROM referral_episode_fixture
UNION ALL
SELECT admissions_user, admissions_user || '@col329.invalid', '{}'::jsonb, '{}'::jsonb
FROM referral_episode_fixture
UNION ALL
SELECT inactive_user, inactive_user || '@col329.invalid', '{}'::jsonb, '{}'::jsonb
FROM referral_episode_fixture;

INSERT INTO public.user_profiles (
  id, organization_id, email, full_name, app_role, is_active
)
SELECT owner_user, organization_id, owner_user || '@col329.invalid',
  'COL-329 owner', 'owner'::public.app_role, true
FROM referral_episode_fixture
UNION ALL
SELECT backup_user, organization_id, backup_user || '@col329.invalid',
  'COL-329 backup', 'med_tech'::public.app_role, true
FROM referral_episode_fixture
UNION ALL
SELECT admissions_user, organization_id, admissions_user || '@col329.invalid',
  'COL-329 admissions manager', 'manager'::public.app_role, true
FROM referral_episode_fixture
UNION ALL
SELECT inactive_user, organization_id, inactive_user || '@col329.invalid',
  'COL-329 inactive', 'med_tech'::public.app_role, false
FROM referral_episode_fixture;

INSERT INTO auth.sessions (id, user_id)
SELECT owner_session, owner_user FROM referral_episode_fixture
UNION ALL SELECT backup_session, backup_user FROM referral_episode_fixture
UNION ALL SELECT admissions_session, admissions_user FROM referral_episode_fixture
UNION ALL SELECT inactive_session, inactive_user FROM referral_episode_fixture;

INSERT INTO public.user_facility_access (
  user_id, facility_id, organization_id, is_primary
)
SELECT owner_user, facility_a, organization_id, true FROM referral_episode_fixture
UNION ALL SELECT owner_user, facility_b, organization_id, false FROM referral_episode_fixture
UNION ALL SELECT backup_user, facility_a, organization_id, true FROM referral_episode_fixture
UNION ALL SELECT admissions_user, facility_a, organization_id, true FROM referral_episode_fixture
UNION ALL SELECT inactive_user, facility_a, organization_id, true FROM referral_episode_fixture;

-- Facility-access changes advance the authoritative claim version. Snapshot the
-- versions only after the complete access fixture exists so these JWTs model
-- freshly issued sessions rather than correctly rejected stale credentials.
UPDATE referral_episode_fixture AS fixture
SET owner_version = owner_profile.auth_claim_version,
    backup_version = backup_profile.auth_claim_version,
    admissions_version = admissions_profile.auth_claim_version
FROM public.user_profiles AS owner_profile,
     public.user_profiles AS backup_profile,
     public.user_profiles AS admissions_profile
WHERE owner_profile.id = fixture.owner_user
  AND backup_profile.id = fixture.backup_user
  AND admissions_profile.id = fixture.admissions_user;

INSERT INTO public.referral_sources (
  id, organization_id, name, source_type, is_active
)
SELECT source_id, organization_id, 'COL-329 hospital', 'hospital', true
FROM referral_episode_fixture;

INSERT INTO public.referral_closure_reasons (
  id, organization_id, code, label, closed_by_party, is_active
)
SELECT closure_reason_id, organization_id, 'other_choice', 'Chose another setting',
  'prospect', true
FROM referral_episode_fixture;

INSERT INTO public.residents (
  id, organization_id, facility_id, first_name, last_name, date_of_birth, gender
)
SELECT resident_id, organization_id, facility_a, 'Arrival', 'Proof', '1940-01-01', 'female'
FROM referral_episode_fixture;

CREATE TEMP TABLE referral_episode_results (
  name text PRIMARY KEY,
  value jsonb NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON referral_episode_fixture, referral_episode_results
  TO authenticated;

CREATE FUNCTION pg_temp.set_referral_episode_claims(
  p_user uuid,
  p_session uuid,
  p_version integer
)
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
      'app_role', 'caregiver',
      'organization_id', gen_random_uuid()
    )::text,
    true
  )
$$;

SELECT pg_temp.set_referral_episode_claims(
  fixture.owner_user, fixture.owner_session, fixture.owner_version
)
FROM referral_episode_fixture AS fixture;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture referral_episode_fixture%ROWTYPE;
  first_capture jsonb;
  replay_capture jsonb;
  second_capture jsonb;
  triage_id uuid;
BEGIN
  SELECT * INTO STRICT fixture FROM referral_episode_fixture;
  first_capture := public.referral_episode_capture(
    'col329:capture:first',
    public.referral_episode_initial_revision(),
    pg_catalog.jsonb_build_object(
      'facility_id', fixture.facility_a,
      'first_name', 'Same',
      'last_name', 'Person',
      'receipt_precision', 'unknown'
    )
  );
  replay_capture := public.referral_episode_capture(
    'col329:capture:first',
    public.referral_episode_initial_revision(),
    pg_catalog.jsonb_build_object(
      'facility_id', fixture.facility_a,
      'first_name', 'Same',
      'last_name', 'Person',
      'receipt_precision', 'unknown'
    )
  );
  IF (first_capture ->> 'episode_id') IS DISTINCT FROM (replay_capture ->> 'episode_id')
     OR (replay_capture ->> 'replayed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Same-key same-payload capture did not replay';
  END IF;
  BEGIN
    PERFORM public.referral_episode_capture(
      'col329:capture:first',
      public.referral_episode_initial_revision(),
      pg_catalog.jsonb_build_object(
        'facility_id', fixture.facility_a,
        'first_name', 'Changed',
        'last_name', 'Person',
        'receipt_precision', 'unknown'
      )
    );
    RAISE EXCEPTION 'Changed payload reused a referral request key' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    PERFORM public.referral_episode_capture(
      'col329:capture:first',
      pg_catalog.repeat('1', 64),
      pg_catalog.jsonb_build_object(
        'facility_id', fixture.facility_a,
        'first_name', 'Same',
        'last_name', 'Person',
        'receipt_precision', 'unknown'
      )
    );
    RAISE EXCEPTION 'Changed revision reused a referral request key' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    PERFORM public.referral_episode_capture(
      'col329:capture:ambiguous-time',
      public.referral_episode_initial_revision(),
      pg_catalog.jsonb_build_object(
        'facility_id', fixture.facility_a,
        'first_name', 'Ambiguous',
        'last_name', 'Time',
        'receipt_precision', 'instant',
        'receipt_effective_at', '2026-09-14T18:00:00'
      )
    );
    RAISE EXCEPTION 'Timezone-less referral instant was accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  second_capture := public.referral_episode_capture(
    'col329:capture:second',
    public.referral_episode_initial_revision(),
    pg_catalog.jsonb_build_object(
      'facility_id', fixture.facility_a,
      'first_name', 'Same',
      'last_name', 'Person',
      'receipt_precision', 'date',
      'inquiry_date', '2026-09-13'
    )
  );
  INSERT INTO referral_episode_results (name, value) VALUES
    ('first', first_capture),
    ('second', second_capture);

  BEGIN
    PERFORM pg_catalog.set_config(
      'haven.referral_command', 'col329-referral-command-v1', true
    );
    UPDATE public.referral_leads
    SET status = 'merged',
        merged_into_lead_id = (second_capture ->> 'episode_id')::uuid,
        merged_at = pg_catalog.clock_timestamp(),
        merged_by = fixture.owner_user
    WHERE id = (first_capture ->> 'episode_id')::uuid;
    RAISE EXCEPTION 'Caller-controlled session setting forged referral command authority'
      USING ERRCODE = 'XX000';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  triage_id := public.referral_triage_submit(
    'Unknown receipt', 'phone', NULL, NULL, NULL, NULL
  );
  INSERT INTO referral_episode_results (name, value)
  VALUES ('triage', pg_catalog.jsonb_build_object('id', triage_id));
END $$;

RESET ROLE;

DO $$
DECLARE
  first_episode uuid := (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'first');
  second_episode uuid := (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'second');
  first_person uuid;
  second_person uuid;
BEGIN
  SELECT opportunity.person_id INTO STRICT first_person
  FROM public.referral_leads AS lead
  JOIN public.referral_facility_considerations AS consideration
    ON consideration.id = lead.facility_consideration_id
  JOIN public.referral_opportunities AS opportunity
    ON opportunity.id = consideration.opportunity_id
  WHERE lead.id = first_episode;
  SELECT opportunity.person_id INTO STRICT second_person
  FROM public.referral_leads AS lead
  JOIN public.referral_facility_considerations AS consideration
    ON consideration.id = lead.facility_consideration_id
  JOIN public.referral_opportunities AS opportunity
    ON opportunity.id = consideration.opportunity_id
  WHERE lead.id = second_episode;
  IF first_person = second_person THEN
    RAISE EXCEPTION 'Same-name referral rows were automatically merged';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.referral_leads
    WHERE id = first_episode
      AND (inquiry_date IS NOT NULL OR receipt_effective_at IS NOT NULL
        OR receipt_precision <> 'unknown')
  ) THEN
    RAISE EXCEPTION 'Unknown referral receipt defaulted to a current date';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.referral_leads
    WHERE id = second_episode
      AND inquiry_date = '2026-09-13'
      AND receipt_precision = 'date'
  ) THEN
    RAISE EXCEPTION 'Date-precision referral receipt was not preserved';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.referral_triage_inbox
    WHERE id = (SELECT (value ->> 'id')::uuid FROM referral_episode_results WHERE name = 'triage')
      AND received_at IS NULL
      AND received_precision = 'unknown'
  ) THEN
    RAISE EXCEPTION 'Unknown triage receipt defaulted to now';
  END IF;
  IF (SELECT count(*) FROM public.referral_status_compatibility) <> 9
     OR (SELECT proves_arrival FROM public.referral_status_compatibility WHERE legacy_status = 'converted') THEN
    RAISE EXCEPTION 'Legacy referral status compatibility is incomplete or claims arrival';
  END IF;
END $$;

-- Persist the first opportunity identity for explicit second-site capture.
INSERT INTO referral_episode_results (name, value)
SELECT 'first_identity', pg_catalog.jsonb_build_object(
  'person_id', opportunity.person_id,
  'opportunity_id', opportunity.id,
  'opportunity_revision', opportunity.opportunity_revision
)
FROM public.referral_leads AS lead
JOIN public.referral_facility_considerations AS consideration
  ON consideration.id = lead.facility_consideration_id
JOIN public.referral_opportunities AS opportunity
  ON opportunity.id = consideration.opportunity_id
WHERE lead.id = (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'first');

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture referral_episode_fixture%ROWTYPE;
  identity jsonb := (SELECT value FROM referral_episode_results WHERE name = 'first_identity');
  first_result jsonb := (SELECT value FROM referral_episode_results WHERE name = 'first');
  site_b jsonb;
  isolated_b jsonb;
  assigned jsonb;
  handoff jsonb;
  accepted jsonb;
BEGIN
  SELECT * INTO STRICT fixture FROM referral_episode_fixture;
  site_b := public.referral_episode_capture(
    'col329:capture:site-b',
    identity ->> 'opportunity_revision',
    pg_catalog.jsonb_build_object(
      'facility_id', fixture.facility_b,
      'existing_person_id', identity ->> 'person_id',
      'existing_opportunity_id', identity ->> 'opportunity_id',
      'receipt_precision', 'unknown'
    )
  );
  INSERT INTO referral_episode_results (name, value) VALUES ('site_b', site_b);

  isolated_b := public.referral_episode_capture(
    'col329:capture:isolated-site-b',
    public.referral_episode_initial_revision(),
    pg_catalog.jsonb_build_object(
      'facility_id', fixture.facility_b,
      'first_name', 'Site',
      'last_name', 'Restricted',
      'receipt_precision', 'unknown'
    )
  );
  INSERT INTO referral_episode_results (name, value) VALUES ('isolated_b', isolated_b);

  BEGIN
    PERFORM public.referral_episode_command(
      (first_result ->> 'episode_id')::uuid,
      'col329:assign:inactive',
      first_result ->> 'episode_revision',
      'assign',
      pg_catalog.jsonb_build_object('owner_user_id', fixture.inactive_user)
    );
    RAISE EXCEPTION 'Deactivated staff member became a referral owner';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  assigned := public.referral_episode_command(
    (first_result ->> 'episode_id')::uuid,
    'col329:assign:current',
    first_result ->> 'episode_revision',
    'assign',
    pg_catalog.jsonb_build_object(
      'owner_user_id', fixture.owner_user,
      'backup_user_id', fixture.backup_user,
      'next_action', 'Call the family',
      'next_action_at', '2026-09-14T13:00:00Z'
    )
  );
  handoff := public.referral_episode_command(
    (first_result ->> 'episode_id')::uuid,
    'col329:assign:handoff',
    assigned ->> 'episode_revision',
    'assign',
    pg_catalog.jsonb_build_object('owner_user_id', fixture.backup_user)
  );
  IF (SELECT owner_user_id FROM public.referral_leads
      WHERE id = (first_result ->> 'episode_id')::uuid) IS DISTINCT FROM fixture.owner_user
     OR (SELECT pending_owner_user_id FROM public.referral_leads
         WHERE id = (first_result ->> 'episode_id')::uuid) IS DISTINCT FROM fixture.backup_user THEN
    RAISE EXCEPTION 'Ownership handoff replaced the accountable owner before acceptance';
  END IF;
  PERFORM pg_temp.set_referral_episode_claims(
    fixture.backup_user,
    fixture.backup_session,
    fixture.backup_version
  );
  accepted := public.referral_episode_command(
    (first_result ->> 'episode_id')::uuid,
    'col329:assign:accept',
    handoff ->> 'episode_revision',
    'accept_coverage',
    '{"coverage_reason":"Accepted accountable-owner handoff"}'::jsonb
  );
  IF (SELECT owner_user_id FROM public.referral_leads
      WHERE id = (first_result ->> 'episode_id')::uuid) IS DISTINCT FROM fixture.backup_user
     OR (SELECT pending_owner_user_id FROM public.referral_leads
         WHERE id = (first_result ->> 'episode_id')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'Accepted ownership handoff did not promote the new owner';
  END IF;
  PERFORM pg_temp.set_referral_episode_claims(
    fixture.owner_user,
    fixture.owner_session,
    fixture.owner_version
  );
  INSERT INTO referral_episode_results (name, value) VALUES ('assigned', accepted);

  BEGIN
    PERFORM public.referral_episode_command(
      (first_result ->> 'episode_id')::uuid,
      'col329:stale:writer',
      first_result ->> 'episode_revision',
      'next_action',
      '{"next_action":"Overwrite","next_action_at":"2026-09-16T12:00:00Z"}'::jsonb
    );
    RAISE EXCEPTION 'Stale referral writer overwrote a current assignment';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
END $$;

DO $$
DECLARE
  first_episode uuid := (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'first');
  assigned jsonb := (SELECT value FROM referral_episode_results WHERE name = 'assigned');
  interaction jsonb;
  interest jsonb;
  contact_result jsonb;
  waiting jsonb;
  resumed jsonb;
  closed jsonb;
  reopened jsonb;
BEGIN
  interaction := public.referral_episode_command(
    first_episode, 'col329:interaction:one', assigned ->> 'episode_revision',
    'record_interaction',
    '{"summary":"Family called.","effective_precision":"date","effective_date":"2026-09-12"}'::jsonb
  );
  interest := public.referral_episode_command(
    first_episode, 'col329:interest:one', interaction ->> 'episode_revision',
    'interest',
    '{"interest_state":"interested","effective_precision":"unknown"}'::jsonb
  );
  IF (interest ->> 'status') IS DISTINCT FROM 'new' THEN
    RAISE EXCEPTION 'Interest incorrectly changed the referral stage';
  END IF;
  contact_result := public.referral_episode_command(
    first_episode, 'col329:contact:add', interest ->> 'episode_revision',
    'contact_add',
    '{"first_name":"Shared","last_name":"Guardian","relationship":"guardian","phone":"5550100"}'::jsonb
  );
  waiting := public.referral_episode_command(
    first_episode, 'col329:wait:start', contact_result ->> 'episode_revision',
    'wait',
    '{"reason":"Family reviewing terms","follow_up_at":"2026-09-10T12:00:00Z"}'::jsonb
  );
  resumed := public.referral_episode_command(
    first_episode, 'col329:wait:resume', waiting ->> 'episode_revision',
    'resume', '{"reason":"Family replied"}'::jsonb
  );
  closed := public.referral_episode_command(
    first_episode, 'col329:close:unknown', resumed ->> 'episode_revision',
    'close',
    '{"historical_outcome_unknown":true,"is_historical":true,"effective_precision":"unknown"}'::jsonb
  );
  reopened := public.referral_episode_command(
    first_episode, 'col329:reopen:one', closed ->> 'episode_revision',
    'reopen', '{"reason":"Historical source was corrected"}'::jsonb
  );
  INSERT INTO referral_episode_results (name, value) VALUES
    ('contact', contact_result), ('reopened', reopened);
END $$;

RESET ROLE;

DO $$
DECLARE
  first_episode uuid := (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'first');
BEGIN
  IF (SELECT count(*)
      FROM public.referral_contact_permissions AS permission
      JOIN public.referral_person_contacts AS relationship
        ON relationship.id = permission.person_contact_id
      JOIN public.referral_opportunities AS opportunity
        ON opportunity.person_id = relationship.person_id
      JOIN public.referral_facility_considerations AS consideration
        ON consideration.opportunity_id = opportunity.id
      JOIN public.referral_leads AS lead
        ON lead.facility_consideration_id = consideration.id
      WHERE lead.id = first_episode
        AND permission.permission_state = 'unknown') <> 3 THEN
    RAISE EXCEPTION 'New referral contact permissions did not default to unknown';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.referral_leads
    WHERE id = first_episode
      AND status = 'new'
      AND reopen_count = 1
      AND closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Referral reopen did not restore the prior stage';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.referral_episode_events
    WHERE referral_lead_id = first_episode
      AND event_kind = 'closed'
      AND details ->> 'historical_outcome_unknown' = 'true'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.referral_episode_events
    WHERE referral_lead_id = first_episode
      AND event_kind = 'reopened'
      AND details -> 'prior_closure' IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Close/reopen history was not preserved';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.referral_episode_events
    WHERE referral_lead_id = first_episode
      AND event_kind = 'interaction_recorded'
      AND effective_precision = 'date'
      AND effective_date = '2026-09-12'
      AND recorded_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Effective and recorded interaction time were not separated';
  END IF;
END $$;

INSERT INTO referral_episode_results (name, value)
SELECT 'isolated_b_identity', pg_catalog.jsonb_build_object(
  'person_id', opportunity.person_id,
  'opportunity_id', opportunity.id,
  'opportunity_revision', opportunity.opportunity_revision
)
FROM public.referral_leads AS lead
JOIN public.referral_facility_considerations AS consideration
  ON consideration.id = lead.facility_consideration_id
JOIN public.referral_opportunities AS opportunity
  ON opportunity.id = consideration.opportunity_id
WHERE lead.id = (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'isolated_b');

SELECT pg_temp.set_referral_episode_claims(
  fixture.backup_user, fixture.backup_session, fixture.backup_version
)
FROM referral_episode_fixture AS fixture;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  second_episode uuid := (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'second');
  isolated_b jsonb := (SELECT value FROM referral_episode_results WHERE name = 'isolated_b_identity');
  review jsonb;
BEGIN
  review := public.referral_episode_downstream_review(second_episode);
  BEGIN
    PERFORM public.referral_episode_command(
      second_episode,
      'col329:identity:cross-site-denied',
      (SELECT episode_revision FROM public.referral_leads WHERE id = second_episode),
      'identity_merge',
      pg_catalog.jsonb_build_object(
        'target_opportunity_id', isolated_b ->> 'opportunity_id',
        'target_opportunity_revision', isolated_b ->> 'opportunity_revision',
        'reason', 'This target must not be visible from facility A',
        'downstream_review', review
      )
    );
    RAISE EXCEPTION 'Known UUID bypassed target facility visibility';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;

SELECT pg_temp.set_referral_episode_claims(
  fixture.owner_user, fixture.owner_session, fixture.owner_version
)
FROM referral_episode_fixture AS fixture;

-- Identity merge, split and undo use an exact fresh downstream snapshot. The
-- episode ID never changes, so admission/HL7/outreach/workflow references do
-- not need to be rewritten.
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  first_episode uuid := (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'first');
  second_episode uuid := (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'second');
  target_opportunity uuid := (SELECT (value ->> 'opportunity_id')::uuid FROM referral_episode_results WHERE name = 'first_identity');
  target_opportunity_revision text;
  second_revision text := (SELECT episode_revision FROM public.referral_leads WHERE id = second_episode);
  contact_created jsonb;
  permissioned jsonb;
  permission_after_merge jsonb;
  review jsonb;
  merged jsonb;
  undo_merge jsonb;
  split_result jsonb;
  undo_result jsonb;
  model jsonb;
  history_page jsonb;
  relationship_id uuid;
  merge_correction uuid;
  split_correction uuid;
BEGIN
  target_opportunity_revision := public.referral_episode_model_read(first_episode)
    -> 'opportunity' ->> 'opportunity_revision';
  contact_created := public.referral_episode_command(
    second_episode, 'col329:identity:contact', second_revision,
    'contact_add',
    '{"first_name":"Second","last_name":"Contact","relationship":"guardian","phone":"5550102"}'::jsonb
  );
  model := public.referral_episode_model_read(second_episode);
  SELECT (contact ->> 'person_contact_id')::uuid INTO STRICT relationship_id
  FROM pg_catalog.jsonb_array_elements(model -> 'contacts') AS contact
  WHERE contact ->> 'originating_referral_lead_id' = second_episode::text;
  permissioned := public.referral_episode_command(
    second_episode, 'col329:identity:permission', contact_created ->> 'episode_revision',
    'contact_permission',
    pg_catalog.jsonb_build_object(
      'person_contact_id', relationship_id,
      'channel', 'phone',
      'permission_state', 'permitted',
      'evidence_note', 'Reviewed source consent'
    )
  );
  review := public.referral_episode_downstream_review(second_episode);
  BEGIN
    PERFORM public.referral_episode_command(
      second_episode, 'col329:identity:stale-review', permissioned ->> 'episode_revision',
      'identity_merge',
      pg_catalog.jsonb_build_object(
        'target_opportunity_id', target_opportunity,
        'target_opportunity_revision', target_opportunity_revision,
        'reason', 'Reviewed duplicate entry',
        'downstream_review', review || pg_catalog.jsonb_build_object(
          'workflow_events', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('id', gen_random_uuid())
          )
        )
      )
    );
    RAISE EXCEPTION 'Stale downstream review allowed an identity correction';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  merged := public.referral_episode_command(
    second_episode, 'col329:identity:merge', permissioned ->> 'episode_revision',
    'identity_merge',
    pg_catalog.jsonb_build_object(
      'target_opportunity_id', target_opportunity,
      'target_opportunity_revision', target_opportunity_revision,
      'reason', 'Reviewed duplicate entry',
      'downstream_review', review
    )
  );
  IF merged ->> 'status' IS DISTINCT FROM 'merged'
     OR (SELECT merged_into_lead_id FROM public.referral_leads WHERE id = second_episode)
        IS DISTINCT FROM first_episode
     OR (SELECT count(*)
         FROM public.referral_leads
         WHERE id IN (first_episode, second_episode)
           AND deleted_at IS NULL
           AND status NOT IN ('converted', 'lost', 'merged')) <> 1 THEN
    RAISE EXCEPTION 'Duplicate merge left competing active same-site episodes';
  END IF;
  model := public.referral_episode_model_read(second_episode);
  IF model -> 'episode' ->> 'merged_into_lead_id' IS DISTINCT FROM first_episode::text THEN
    RAISE EXCEPTION 'Identity merge did not expose its canonical episode target';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(model -> 'contacts') AS contact
    WHERE contact ->> 'person_contact_id' = relationship_id::text
      AND contact ->> 'originating_referral_lead_id' = second_episode::text
  ) THEN
    RAISE EXCEPTION 'Identity merge stranded the episode-origin contact';
  END IF;
  permission_after_merge := public.referral_episode_command(
    second_episode, 'col329:identity:permission-after-merge', merged ->> 'episode_revision',
    'contact_permission',
    pg_catalog.jsonb_build_object(
      'person_contact_id', relationship_id,
      'channel', 'phone',
      'permission_state', 'permitted',
      'evidence_note', 'Origin relationship remains authoritative'
    )
  );
  history_page := public.referral_episode_history_read(second_episode, NULL, 100);
  SELECT (event -> 'details' ->> 'correction_id')::uuid INTO STRICT merge_correction
  FROM pg_catalog.jsonb_array_elements(history_page -> 'events') AS event
  WHERE event ->> 'id' = merged ->> 'event_id';
  review := public.referral_episode_downstream_review(second_episode);
  undo_merge := public.referral_episode_command(
    second_episode, 'col329:identity:undo-merge', permission_after_merge ->> 'episode_revision',
    'identity_undo',
    pg_catalog.jsonb_build_object(
      'correction_id', merge_correction,
      'reason', 'The duplicate review was reversed',
      'downstream_review', review
    )
  );
  model := public.referral_episode_model_read(second_episode);
  IF model -> 'episode' ->> 'status' IS DISTINCT FROM 'new'
     OR model -> 'episode' ->> 'merged_into_lead_id' IS NOT NULL THEN
    RAISE EXCEPTION 'Identity merge undo did not restore the canonical target link';
  END IF;
  review := public.referral_episode_downstream_review(second_episode);
  split_result := public.referral_episode_command(
    second_episode, 'col329:identity:split', undo_merge ->> 'episode_revision',
    'identity_split',
    pg_catalog.jsonb_build_object(
      'reason', 'The two people were confirmed distinct',
      'downstream_review', review
    )
  );
  history_page := public.referral_episode_history_read(second_episode, NULL, 100);
  SELECT (event -> 'details' ->> 'correction_id')::uuid INTO STRICT split_correction
  FROM pg_catalog.jsonb_array_elements(history_page -> 'events') AS event
  WHERE event ->> 'id' = split_result ->> 'event_id';
  review := public.referral_episode_downstream_review(second_episode);
  undo_result := public.referral_episode_command(
    second_episode, 'col329:identity:undo', split_result ->> 'episode_revision',
    'identity_undo',
    pg_catalog.jsonb_build_object(
      'correction_id', split_correction,
      'reason', 'Split was entered against the wrong episode',
      'downstream_review', review
    )
  );
  model := public.referral_episode_model_read(second_episode);
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(model -> 'contacts') AS contact
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(contact -> 'permissions') AS permission
    WHERE contact ->> 'person_contact_id' = relationship_id::text
      AND permission ->> 'channel' = 'phone'
      AND permission ->> 'permission_state' = 'permitted'
  ) THEN
    RAISE EXCEPTION 'Identity corrections did not preserve contact permission history';
  END IF;
  INSERT INTO referral_episode_results (name, value) VALUES ('identity_undo', undo_result);
END $$;

RESET ROLE;

DO $$
DECLARE
  second_episode uuid := (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'second');
BEGIN
  IF (SELECT count(*) FROM public.referral_identity_corrections WHERE referral_lead_id = second_episode) <> 4
     OR (SELECT count(*) FROM public.referral_episode_events
         WHERE referral_lead_id = second_episode
           AND event_kind IN ('identity_merged','identity_split','identity_undo')) <> 4 THEN
    RAISE EXCEPTION 'Identity correction history is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.referral_identity_corrections
    WHERE referral_lead_id = second_episode
      AND correction_kind IN ('merge', 'split')
      AND reversed_by_correction_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Identity undo did not mark the merge and split as reversed';
  END IF;
  BEGIN
    UPDATE public.referral_episode_events
    SET details = '{}'::jsonb
    WHERE referral_lead_id = second_episode;
    RAISE EXCEPTION 'Referral event history was mutable';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.referral_outcome_reason_drafts (
      organization_id, proposed_code, proposed_label, is_active
    )
    SELECT organization_id, 'unapproved', 'Unapproved', true
    FROM referral_episode_fixture;
    RAISE EXCEPTION 'Unapproved outcome vocabulary was activated';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO public.admission_cases (
  id, organization_id, facility_id, resident_id, referral_lead_id, status
)
SELECT admission_case_id, organization_id, facility_a, resident_id,
  (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'second'),
  'pending_clearance'
FROM referral_episode_fixture;

SELECT pg_temp.set_referral_episode_claims(
  admissions_user, admissions_session, admissions_version
)
FROM referral_episode_fixture;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture referral_episode_fixture%ROWTYPE;
  episode_id uuid := (SELECT (value ->> 'episode_id')::uuid FROM referral_episode_results WHERE name = 'second');
  current_revision text := (SELECT episode_revision FROM public.referral_leads WHERE id = episode_id);
  application_pending jsonb;
BEGIN
  SELECT * INTO STRICT fixture FROM referral_episode_fixture;
  BEGIN
    PERFORM public.referral_episode_command(
      episode_id, 'col329:admission:premature-conversion', current_revision,
      'admission_transition',
      pg_catalog.jsonb_build_object(
        'admission_case_id', fixture.admission_case_id,
        'target_status', 'converted'
      )
    );
    RAISE EXCEPTION 'Referral conversion was counted before actual arrival';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  application_pending := public.referral_episode_command(
    episode_id, 'col329:admission:application-pending', current_revision,
    'admission_transition',
    pg_catalog.jsonb_build_object(
      'admission_case_id', fixture.admission_case_id,
      'target_status', 'application_pending'
    )
  );
  INSERT INTO referral_episode_results (name, value)
  VALUES ('application_pending', application_pending);
END $$;

RESET ROLE;

DO $$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.referral_episode_capture(text,text,jsonb)',
    'public.referral_episode_command(uuid,text,text,text,jsonb)',
    'public.referral_episode_downstream_review(uuid)',
    'public.referral_episode_history_read(uuid,integer,integer)',
    'public.referral_episode_model_read(uuid)',
    'public.referral_episode_initial_revision()'
  ] LOOP
    IF has_function_privilege('anon', signature, 'EXECUTE')
       OR has_function_privilege('service_role', signature, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Referral episode RPC grants incorrect for %', signature;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.referral_people', 'SELECT')
     OR has_table_privilege('authenticated', 'public.referral_contacts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.referral_episode_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.referral_identity_corrections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.referral_contact_permissions', 'UPDATE') THEN
    RAISE EXCEPTION 'Sensitive referral model tables are directly exposed';
  END IF;
END $$;

ROLLBACK;
