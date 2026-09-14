-- COL-328 rollback-only referral authority and sensitive-field probe.
BEGIN;

GRANT USAGE ON SCHEMA auth, haven TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'role','')
$$;

CREATE TEMP TABLE referral_authority_fixture AS
SELECT
  gen_random_uuid() nurse_user, gen_random_uuid() nurse_session,
  gen_random_uuid() coordinator_user, gen_random_uuid() coordinator_session,
  gen_random_uuid() caregiver_user, gen_random_uuid() caregiver_session,
  gen_random_uuid() owner_user, gen_random_uuid() owner_session,
  gen_random_uuid() other_organization, gen_random_uuid() other_entity,
  gen_random_uuid() other_facility, gen_random_uuid() source,
  gen_random_uuid() lead, gen_random_uuid() same_site_duplicate,
  gen_random_uuid() lost_lead,
  gen_random_uuid() hidden_site_duplicate, gen_random_uuid() hidden_org_duplicate,
  gen_random_uuid() hl7_inbound,
  first_facility.organization_id organization,
  first_facility.id facility,
  second_facility.id other_col_facility
FROM public.facilities AS first_facility
JOIN public.facilities AS second_facility
  ON second_facility.organization_id = first_facility.organization_id
 AND second_facility.id <> first_facility.id
 AND second_facility.deleted_at IS NULL
WHERE first_facility.deleted_at IS NULL
ORDER BY first_facility.id, second_facility.id
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM referral_authority_fixture) THEN
    RAISE EXCEPTION 'COL-328 requires two seeded facilities in one organization';
  END IF;
END $$;

INSERT INTO public.organizations (id, name)
SELECT other_organization, 'COL-328 isolated organization'
FROM referral_authority_fixture;
INSERT INTO public.entities (id, organization_id, name)
SELECT other_entity, other_organization, 'COL-328 isolated entity'
FROM referral_authority_fixture;
INSERT INTO public.facilities (
  id, entity_id, organization_id, name, address_line_1, city, state, zip,
  total_licensed_beds
)
SELECT other_facility, other_entity, other_organization, 'COL-328 isolated facility',
  '1 Test Way', 'Test', 'FL', '00000', 1
FROM referral_authority_fixture;

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
SELECT nurse_user, nurse_user || '@col328.invalid', '{}'::jsonb, '{}'::jsonb
FROM referral_authority_fixture
UNION ALL
SELECT coordinator_user, coordinator_user || '@col328.invalid', '{}'::jsonb, '{}'::jsonb
FROM referral_authority_fixture
UNION ALL
SELECT caregiver_user, caregiver_user || '@col328.invalid', '{}'::jsonb, '{}'::jsonb
FROM referral_authority_fixture
UNION ALL
SELECT owner_user, owner_user || '@col328.invalid', '{}'::jsonb, '{}'::jsonb
FROM referral_authority_fixture;

INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role)
SELECT nurse_user, organization, nurse_user || '@col328.invalid', 'COL-328 nurse', 'nurse'::public.app_role
FROM referral_authority_fixture
UNION ALL
SELECT coordinator_user, organization, coordinator_user || '@col328.invalid', 'COL-328 coordinator', 'coordinator'::public.app_role
FROM referral_authority_fixture
UNION ALL
SELECT caregiver_user, organization, caregiver_user || '@col328.invalid', 'COL-328 caregiver', 'caregiver'::public.app_role
FROM referral_authority_fixture
UNION ALL
SELECT owner_user, organization, owner_user || '@col328.invalid', 'COL-328 owner', 'owner'::public.app_role
FROM referral_authority_fixture;

INSERT INTO auth.sessions (id, user_id)
SELECT nurse_session, nurse_user FROM referral_authority_fixture
UNION ALL SELECT coordinator_session, coordinator_user FROM referral_authority_fixture
UNION ALL SELECT caregiver_session, caregiver_user FROM referral_authority_fixture
UNION ALL SELECT owner_session, owner_user FROM referral_authority_fixture;

INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
SELECT nurse_user, facility, organization, true FROM referral_authority_fixture
UNION ALL SELECT coordinator_user, facility, organization, true FROM referral_authority_fixture
UNION ALL SELECT caregiver_user, facility, organization, true FROM referral_authority_fixture
UNION ALL SELECT owner_user, facility, organization, true FROM referral_authority_fixture
UNION ALL SELECT owner_user, other_col_facility, organization, false FROM referral_authority_fixture;

INSERT INTO public.referral_sources (
  id, organization_id, facility_id, name, source_type, is_active
)
SELECT source, organization, NULL, 'COL-328 hospital', 'hospital', true
FROM referral_authority_fixture;

INSERT INTO public.referral_hl7_inbound (
  id, organization_id, facility_id, raw_message, status, message_control_id,
  trigger_event
)
SELECT hl7_inbound, organization, facility,
  E'MSH|^~\\&|COL328\rPID|1||123||Trusted^Bound', 'processed',
  'COL328-CONTROL', 'ADT^A04'
FROM referral_authority_fixture;

INSERT INTO public.referral_leads (
  id, organization_id, facility_id, referral_source_id, first_name, last_name,
  date_of_birth, phone, email, notes, external_reference, status,
  pii_access_tier, updated_at
)
SELECT lead, organization, facility, source, 'Visible', 'Lead', '1940-01-02'::date,
  '(386) 555-0101', 'visible@col328.invalid', 'clinical note', 'external-visible',
  'new'::public.referral_lead_status, 'clinical_precheck'::public.pii_access_tier,
  '2026-01-01T00:00:00Z'::timestamptz
FROM referral_authority_fixture
UNION ALL
SELECT same_site_duplicate, organization, facility, source, 'Same', 'Site', '1940-01-02'::date,
  '3865550101', 'same@col328.invalid', 'same-site note', NULL,
  'contacted'::public.referral_lead_status, 'clinical_precheck'::public.pii_access_tier,
  '2026-01-01T00:00:00Z'::timestamptz
FROM referral_authority_fixture
UNION ALL
SELECT lost_lead, organization, facility, source, 'Lost', 'Prospect', '1941-02-03'::date,
  '3865550102', 'lost@col328.invalid', 'closed note', NULL,
  'lost'::public.referral_lead_status, 'clinical_precheck'::public.pii_access_tier,
  '2026-01-01T00:00:00Z'::timestamptz
FROM referral_authority_fixture
UNION ALL
SELECT hidden_site_duplicate, organization, other_col_facility, source, 'Hidden', 'Site', '1940-01-02'::date,
  '386-555-0101', 'hidden-site@col328.invalid', 'hidden-site note', NULL,
  'new'::public.referral_lead_status, 'clinical_precheck'::public.pii_access_tier,
  '2026-01-01T00:00:00Z'::timestamptz
FROM referral_authority_fixture;

INSERT INTO public.referral_sources (organization_id, facility_id, name, source_type, is_active)
SELECT other_organization, NULL, 'COL-328 other source', 'hospital', true
FROM referral_authority_fixture;
INSERT INTO public.referral_leads (
  id, organization_id, facility_id, referral_source_id, first_name, last_name,
  date_of_birth, phone, email, notes, status
)
SELECT f.hidden_org_duplicate, f.other_organization, f.other_facility, source.id,
  'Hidden', 'Organization', '1940-01-02', '3865550101',
  'hidden-org@col328.invalid', 'hidden-org note', 'new'
FROM referral_authority_fixture AS f
JOIN public.referral_sources AS source
  ON source.organization_id = f.other_organization;

GRANT SELECT ON referral_authority_fixture TO authenticated;
CREATE FUNCTION pg_temp.set_referral_claims(p_user uuid, p_session uuid, p_version integer)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user,
      'session_id', p_session,
      'role', 'authenticated',
      'auth_claim_version', p_version,
      'app_role', 'owner',
      'organization_id', gen_random_uuid()
    )::text,
    true
  )
$$;

-- Coordinator receives contact fields, never clinical/free-text fields, and
-- direct PostgREST table access cannot ask for the protected columns.
SELECT pg_temp.set_referral_claims(
  f.coordinator_user, f.coordinator_session, profile.auth_claim_version
)
FROM referral_authority_fixture AS f
JOIN public.user_profiles AS profile ON profile.id = f.coordinator_user;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  f referral_authority_fixture%ROWTYPE;
  projected record;
BEGIN
  SELECT * INTO STRICT f FROM referral_authority_fixture;
  SELECT * INTO STRICT projected
  FROM public.referral_leads_authorized_read(f.facility, f.lead, NULL, 1, 0);
  IF projected.phone IS DISTINCT FROM '(386) 555-0101'
     OR projected.email IS DISTINCT FROM 'visible@col328.invalid'
     OR projected.date_of_birth IS NOT NULL
     OR projected.notes IS NOT NULL
     OR projected.external_reference IS NOT NULL
     OR projected.closure_note IS NOT NULL
     OR projected.can_read_clinical THEN
    RAISE EXCEPTION 'Coordinator referral projection exposed the wrong fields';
  END IF;
  SELECT * INTO STRICT projected
  FROM public.referral_leads_authorized_export(f.facility, 'new', 10, 0)
  WHERE id = f.lead;
  IF projected.phone IS DISTINCT FROM '(386) 555-0101'
     OR projected.notes IS NOT NULL THEN
    RAISE EXCEPTION 'Referral export did not preserve projection masking';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.referral_leads WHERE id = f.lead)
     OR EXISTS (SELECT 1 FROM public.referral_leads WHERE id = f.hidden_site_duplicate)
     OR EXISTS (SELECT 1 FROM public.referral_leads WHERE id = f.hidden_org_duplicate) THEN
    RAISE EXCEPTION 'Direct referral SELECT crossed current facility or organization authority';
  END IF;
  BEGIN
    PERFORM public.referral_leads_authorized_read(f.facility, NULL, NULL, NULL, 0);
    RAISE EXCEPTION 'NULL referral read limit bypassed the page cap';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.referral_leads_authorized_export(f.facility, NULL, NULL, 0);
    RAISE EXCEPTION 'NULL referral export limit bypassed the page cap';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.referral_leads', 'notes', 'SELECT')
     OR has_column_privilege('authenticated', 'public.referral_leads', 'date_of_birth', 'SELECT')
     OR has_column_privilege('authenticated', 'public.referral_leads', 'phone', 'SELECT')
     OR has_column_privilege('authenticated', 'public.referral_leads', 'email', 'SELECT')
     OR has_column_privilege('authenticated', 'public.referral_leads', 'external_reference', 'SELECT')
     OR has_column_privilege('authenticated', 'public.referral_leads', 'closure_note', 'SELECT')
     OR has_column_privilege('authenticated', 'public.referral_leads', 'competitor_chosen', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated retained direct sensitive referral column access';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.referral_leads', 'status', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.referral_leads', 'tour_scheduled_for', 'SELECT') THEN
    RAISE EXCEPTION 'Approved aggregate columns lost direct compatibility';
  END IF;
  IF has_table_privilege('authenticated', 'public.referral_leads', 'INSERT')
     OR has_table_privilege('authenticated', 'public.referral_leads', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.referral_leads', 'DELETE')
     OR has_table_privilege('authenticated', 'public.referral_leads', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Authenticated retained direct referral mutation privileges';
  END IF;
END $$;

-- A role outside the explicit mapping receives neither table rows nor RPC data.
SELECT pg_temp.set_referral_claims(
  f.caregiver_user, f.caregiver_session, profile.auth_claim_version
)
FROM referral_authority_fixture AS f
JOIN public.user_profiles AS profile ON profile.id = f.caregiver_user;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f referral_authority_fixture%ROWTYPE;
BEGIN
  SELECT * INTO STRICT f FROM referral_authority_fixture;
  IF EXISTS (SELECT 1 FROM public.referral_leads WHERE id = f.lead) THEN
    RAISE EXCEPTION 'Caregiver received a referral row';
  END IF;
  BEGIN
    PERFORM public.referral_leads_authorized_read(f.facility, NULL, NULL, 10, 0);
    RAISE EXCEPTION 'Caregiver executed referral read projection';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Nurse receives clinical data only at its current site. Duplicate matching
-- returns the visible candidate itself, never even a count for hidden matches.
SELECT pg_temp.set_referral_claims(
  f.nurse_user, f.nurse_session, profile.auth_claim_version
)
FROM referral_authority_fixture AS f
JOIN public.user_profiles AS profile ON profile.id = f.nurse_user;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  f referral_authority_fixture%ROWTYPE;
  projected record;
  candidates uuid[];
  inserted uuid;
  hl7_lead uuid;
  persisted_actor uuid;
  persisted_tier public.pii_access_tier;
  persisted_status public.referral_lead_status;
  expected_updated_at timestamptz;
  changed_at timestamptz;
BEGIN
  SELECT * INTO STRICT f FROM referral_authority_fixture;
  SELECT * INTO STRICT projected
  FROM public.referral_leads_authorized_read(f.facility, f.lead, NULL, 1, 0);
  IF projected.notes IS DISTINCT FROM 'clinical note'
     OR projected.date_of_birth IS DISTINCT FROM '1940-01-02'::date
     OR NOT projected.can_read_clinical THEN
    RAISE EXCEPTION 'Nurse clinical projection was incomplete';
  END IF;
  SELECT * INTO STRICT projected
  FROM public.referral_leads_authorized_read(f.facility, f.lost_lead, NULL, 1, 0);
  IF projected.can_write THEN
    RAISE EXCEPTION 'Closed referral projection offered a generic reopen path';
  END IF;
  SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.id), '{}') INTO candidates
  FROM public.referral_duplicate_candidates(f.lead) AS candidate;
  IF candidates IS DISTINCT FROM ARRAY[f.same_site_duplicate] THEN
    RAISE EXCEPTION 'Duplicate projection leaked or omitted a facility candidate: %', candidates;
  END IF;
  SELECT updated_at INTO STRICT expected_updated_at
  FROM public.referral_leads WHERE id = f.lead;
  changed_at := public.referral_lead_update(
    f.lead, expected_updated_at, '{"status":"contacted"}'::jsonb
  );
  SELECT authorized.status, authorized.updated_by
  INTO STRICT persisted_status, persisted_actor
  FROM public.referral_leads_authorized_read(f.facility, f.lead, NULL, 1, 0) AS authorized;
  IF changed_at IS NOT DISTINCT FROM expected_updated_at
     OR persisted_status IS DISTINCT FROM 'contacted'::public.referral_lead_status
     OR persisted_actor IS DISTINCT FROM f.nurse_user THEN
    RAISE EXCEPTION 'Referral command did not enforce current actor/concurrency';
  END IF;
  BEGIN
    PERFORM public.referral_lead_update(
      f.lead, expected_updated_at, '{"tour_scheduled_for":"2026-09-20T14:00:00Z"}'::jsonb
    );
    RAISE EXCEPTION 'Stale referral update overwrote newer work';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  BEGIN
    PERFORM public.referral_lead_update(
      f.lead, changed_at, '{"status":"converted"}'::jsonb
    );
    RAISE EXCEPTION 'Generic referral command recorded conversion before move-in';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.referral_lead_update(
      f.lead, changed_at, '{"status":"merged"}'::jsonb
    );
    RAISE EXCEPTION 'Generic referral command recorded merge without merge evidence';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.referral_lead_update(
      f.lead, changed_at, '{"status":"lost"}'::jsonb
    );
    RAISE EXCEPTION 'Generic referral command archived without disposition history';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.referral_lead_update(
      f.lost_lead, '2026-01-01T00:00:00Z'::timestamptz, '{"status":"contacted"}'::jsonb
    );
    RAISE EXCEPTION 'Generic referral command reopened without prior-closure history';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.referral_lead_update(
      f.lead, changed_at, '{"notes":"blind overwrite"}'::jsonb
    );
    RAISE EXCEPTION 'Generic referral command overwrote protected notes';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    UPDATE public.referral_leads
    SET pii_access_tier = 'public_summary'
    WHERE id = f.lead;
    RAISE EXCEPTION 'Authenticated actor changed the protected PII tier';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.referral_leads (
      organization_id, facility_id, referral_source_id, first_name, last_name,
      created_by, pii_access_tier
    ) VALUES (
      f.organization, f.other_col_facility, f.source, 'Spoofed', 'Facility',
      f.owner_user, 'clinical_precheck'
    );
    RAISE EXCEPTION 'Nurse inserted into an inaccessible facility';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  inserted := public.referral_lead_create(
    f.facility, 'Current', 'Actor', f.source, NULL, NULL, 'either', NULL
  );
  SELECT created_by, pii_access_tier INTO persisted_actor, persisted_tier
  FROM public.referral_leads WHERE id = inserted;
  IF persisted_actor IS DISTINCT FROM f.nurse_user
     OR persisted_tier IS DISTINCT FROM 'standard_ops'::public.pii_access_tier THEN
    RAISE EXCEPTION 'Referral insert trusted client actor or PII tier';
  END IF;

  SELECT updated_at INTO STRICT expected_updated_at
  FROM public.referral_leads WHERE id = inserted;
  BEGIN
    PERFORM public.referral_lead_update(
      inserted, expected_updated_at, '{"notes":"hidden standard-tier overwrite"}'::jsonb
    );
    RAISE EXCEPTION 'Standard-tier lead accepted a blind protected-note write';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  hl7_lead := public.referral_lead_create_from_hl7(f.hl7_inbound);
END $$;
RESET ROLE;

DO $$
DECLARE
  f referral_authority_fixture%ROWTYPE;
  linked_lead uuid;
BEGIN
  SELECT * INTO STRICT f FROM referral_authority_fixture;
  SELECT linked_referral_lead_id INTO linked_lead
  FROM public.referral_hl7_inbound
  WHERE id = f.hl7_inbound;
  IF linked_lead IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.referral_leads
       WHERE id = linked_lead
         AND external_reference = 'hl7:' || f.hl7_inbound::text
         AND first_name = 'Bound'
         AND last_name = 'Trusted'
     ) THEN
    RAISE EXCEPTION 'HL7 referral command did not bind trusted identity and atomically link the lead';
  END IF;
END $$;

-- No-facility intake has one write-only route for ordinary intake roles and a
-- separate organization-admin read route. The table is never directly exposed.
SELECT pg_temp.set_referral_claims(
  f.coordinator_user, f.coordinator_session, profile.auth_claim_version
)
FROM referral_authority_fixture AS f
JOIN public.user_profiles AS profile ON profile.id = f.coordinator_user;
SET LOCAL ROLE authenticated;
SELECT public.referral_triage_submit(
  'Unassigned prospect', 'phone', '3865550199', NULL, 'needs a saving facility', NULL
);
DO $$
BEGIN
  BEGIN
    PERFORM public.referral_triage_authorized_read(10, 0);
    RAISE EXCEPTION 'Coordinator read the restricted triage inbox';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.referral_triage_inbox', 'SELECT')
     OR has_table_privilege('authenticated', 'public.referral_triage_inbox', 'INSERT') THEN
    RAISE EXCEPTION 'Triage inbox retained direct authenticated privileges';
  END IF;
END $$;

SELECT pg_temp.set_referral_claims(
  f.owner_user, f.owner_session, profile.auth_claim_version
)
FROM referral_authority_fixture AS f
JOIN public.user_profiles AS profile ON profile.id = f.owner_user;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.referral_triage_authorized_read(10, 0)) <> 1 THEN
    RAISE EXCEPTION 'Organization owner could not read restricted triage';
  END IF;
  BEGIN
    PERFORM public.referral_triage_authorized_read(NULL, 0);
    RAISE EXCEPTION 'NULL triage read limit bypassed the page cap';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;
RESET ROLE;

-- Database-current revocation/version wins over the old signed token.
SELECT pg_temp.set_referral_claims(
  f.coordinator_user, f.coordinator_session, profile.auth_claim_version
)
FROM referral_authority_fixture AS f
JOIN public.user_profiles AS profile ON profile.id = f.coordinator_user;
UPDATE public.user_profiles
SET app_role = 'caregiver'
WHERE id = (SELECT coordinator_user FROM referral_authority_fixture);
SET LOCAL ROLE authenticated;
DO $$
DECLARE f referral_authority_fixture%ROWTYPE;
BEGIN
  SELECT * INTO STRICT f FROM referral_authority_fixture;
  BEGIN
    PERFORM public.referral_leads_authorized_export(f.facility, NULL, 10, 0);
    RAISE EXCEPTION 'Stale referral token retained export authority';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Public, anonymous, and service credentials cannot call user referral doors.
DO $$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.referral_leads_authorized_read(uuid,uuid,public.referral_lead_status,integer,integer)',
    'public.referral_leads_authorized_export(uuid,public.referral_lead_status,integer,integer)',
    'public.referral_lead_create(uuid,text,text,uuid,text,text,public.referral_lead_preferred_contact,date)',
    'public.referral_lead_update(uuid,timestamp with time zone,jsonb)',
    'public.referral_lead_create_from_hl7(uuid)',
    'public.referral_source_create(uuid,text,text,boolean)',
    'public.referral_triage_submit(text,text,text,text,text,timestamp with time zone)',
    'public.referral_triage_authorized_read(integer,integer)',
    'public.referral_duplicate_candidates(uuid)'
  ] LOOP
    IF has_function_privilege('anon', signature, 'EXECUTE')
       OR has_function_privilege('service_role', signature, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Referral RPC grants incorrect for %', signature;
    END IF;
  END LOOP;
END $$;

ROLLBACK;
