-- COL-314 rollback-only proof: same locked triage inbox, anonymous provenance,
-- atomic audit, server-derived organization, and idempotent recovery.
BEGIN;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.public_referral_intake(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.public_referral_intake(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'haven.public_referral_intake_internal(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'haven.public_referral_intake_internal(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.referral_triage_inbox', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.referral_triage_inbox', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Public intake broadened a browser role grant';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.public_referral_intake(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'haven.public_referral_intake_internal(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Service intake execution boundary unavailable';
  END IF;
END $$;

-- The repository's lightweight replay stub creates service_role without the
-- BYPASSRLS attribute that Supabase assigns in hosted projects. Mirror the
-- hosted role for this rollback-only probe; ROLLBACK restores the stub.
ALTER ROLE service_role BYPASSRLS;
GRANT SELECT ON public.audit_log TO service_role;

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.public_referral_intake(gen_random_uuid(), '00000000-0000-0000-0002-000000000003', 'inquiry', 'Synthetic', '3865550199', 'col314@example.invalid', 'Test', repeat('a', 64));
    RAISE EXCEPTION 'Anon execution unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.public_referral_intake(gen_random_uuid(), '00000000-0000-0000-0002-000000000003', 'inquiry', 'Synthetic', '3865550199', 'col314@example.invalid', 'Test', repeat('a', 64));
    RAISE EXCEPTION 'Authenticated execution unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

CREATE TEMP TABLE public_intake_fixture AS
SELECT gen_random_uuid() request_key, id facility_id, organization_id, name facility_name,
  encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex') client_fingerprint
FROM public.facilities WHERE deleted_at IS NULL AND status = 'active'
ORDER BY id LIMIT 1;
GRANT SELECT ON public_intake_fixture TO service_role;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  fixture record;
  first_id uuid;
  second_id uuid;
  rejected_key uuid := gen_random_uuid();
  row_record public.referral_triage_inbox%ROWTYPE;
BEGIN
  SELECT * INTO STRICT fixture FROM public_intake_fixture;
  first_id := public.public_referral_intake(fixture.request_key, fixture.facility_id, 'inquiry', 'COL-314 synthetic inquiry', '3865550199', 'col314@example.invalid', 'Please call.', fixture.client_fingerprint);
  second_id := public.public_referral_intake(fixture.request_key, fixture.facility_id, 'inquiry', 'COL-314 synthetic inquiry', '3865550199', 'col314@example.invalid', 'Please call.', fixture.client_fingerprint);
  IF first_id IS DISTINCT FROM second_id OR (SELECT count(*) FROM public.referral_triage_inbox WHERE public_request_key = fixture.request_key) <> 1 THEN
    RAISE EXCEPTION 'Retry did not recover exactly one durable intake';
  END IF;
  SELECT * INTO STRICT row_record FROM public.referral_triage_inbox WHERE id = first_id;
  IF row_record.organization_id IS DISTINCT FROM fixture.organization_id
     OR row_record.requested_facility_id IS DISTINCT FROM fixture.facility_id
     OR row_record.created_by IS NOT NULL
     OR row_record.public_client_fingerprint IS DISTINCT FROM fixture.client_fingerprint
     OR row_record.received_precision <> 'instant' OR row_record.received_at IS NULL
     OR row_record.source_channel <> 'public_website_inquiry'
     OR row_record.notes NOT LIKE '%' || fixture.facility_name || '%' THEN
    RAISE EXCEPTION 'Facility, organization, receipt, provenance or staff-readable preference lost';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE table_name = 'referral_triage_inbox' AND record_id = first_id AND action = 'INSERT' AND user_id IS NULL AND organization_id = fixture.organization_id) <> 1 THEN
    RAISE EXCEPTION 'Exactly one anonymous intake audit event required';
  END IF;
  BEGIN
    PERFORM public.public_referral_intake(fixture.request_key, fixture.facility_id, 'inquiry', 'Changed', '3865550199', 'col314@example.invalid', 'Please call.', fixture.client_fingerprint);
    RAISE EXCEPTION 'Changed payload reused key';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM public.public_referral_intake(gen_random_uuid(), gen_random_uuid(), 'inquiry', 'Synthetic', '3865550199', 'col314@example.invalid', 'Test', fixture.client_fingerprint);
    RAISE EXCEPTION 'Missing facility accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.public_referral_intake(gen_random_uuid(), fixture.facility_id, 'staff', 'Synthetic', '3865550199', 'col314@example.invalid', 'Test', fixture.client_fingerprint);
    RAISE EXCEPTION 'Forged source accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    -- A transaction rolled back after intake must also roll back its audit row.
    second_id := public.public_referral_intake(gen_random_uuid(), fixture.facility_id, 'tour', 'COL-314 rollback tour', '3865550199', 'col314@example.invalid', 'Requested date: 2026-10-03; lunch for 2; not booked.', fixture.client_fingerprint);
    RAISE EXCEPTION 'Synthetic downstream rollback' USING ERRCODE = 'P0002';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.referral_triage_inbox WHERE id = second_id)
     OR EXISTS (SELECT 1 FROM public.audit_log WHERE record_id = second_id) THEN
    RAISE EXCEPTION 'Partial transaction persisted';
  END IF;
  BEGIN
    PERFORM public.public_referral_intake(gen_random_uuid(), fixture.facility_id, 'inquiry', 'Synthetic', '3865550199', 'col314@example.invalid', 'Test', '192.0.2.1');
    RAISE EXCEPTION 'Raw IP fingerprint accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  FOR i IN 2..20 LOOP
    PERFORM public.public_referral_intake(gen_random_uuid(), fixture.facility_id, 'inquiry', 'COL-314 quota fixture', '3865550199', 'col314@example.invalid', 'Please call.', fixture.client_fingerprint);
  END LOOP;
  BEGIN
    PERFORM public.public_referral_intake(rejected_key, fixture.facility_id, 'inquiry', 'COL-314 over quota', '3865550199', 'col314@example.invalid', 'Please call.', fixture.client_fingerprint);
    RAISE EXCEPTION 'Client quota exceeded without rejection';
  EXCEPTION WHEN SQLSTATE 'P0429' THEN NULL; END;
  -- Even at quota, a lost-response replay succeeds and changed content conflicts.
  second_id := public.public_referral_intake(fixture.request_key, fixture.facility_id, 'inquiry', 'COL-314 synthetic inquiry', '3865550199', 'col314@example.invalid', 'Please call.', fixture.client_fingerprint);
  IF second_id IS DISTINCT FROM first_id THEN RAISE EXCEPTION 'Quota blocked recovery'; END IF;
  BEGIN
    PERFORM public.public_referral_intake(fixture.request_key, fixture.facility_id, 'inquiry', 'Changed at quota', '3865550199', 'col314@example.invalid', 'Please call.', fixture.client_fingerprint);
    RAISE EXCEPTION 'Changed payload accepted at quota';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF (SELECT count(*) FROM public.referral_triage_inbox WHERE public_client_fingerprint = fixture.client_fingerprint) <> 20
     OR (SELECT count(*) FROM public.audit_log WHERE table_name = 'referral_triage_inbox' AND new_data ->> 'public_client_fingerprint' = fixture.client_fingerprint) <> 20
     OR EXISTS (SELECT 1 FROM public.referral_triage_inbox WHERE public_request_key = rejected_key)
     OR EXISTS (SELECT 1 FROM public.audit_log WHERE new_data ->> 'public_request_key' = rejected_key::text) THEN
    RAISE EXCEPTION 'Quota rejection or replay created extra intake/audit rows';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
