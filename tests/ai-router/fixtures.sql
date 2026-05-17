-- Cross-org tool isolation fixtures (KB-NEXT-02).
--
-- Seeds two minimal orgs (A and B) with one facility each plus one row per
-- tool's primary domain. Used by scripts/eval-tool-isolation.mjs to confirm
-- that calling each ai_tool_* RPC with org A's caller context never returns
-- any of org B's rows.
--
-- Idempotent: every INSERT uses fixed UUIDs + ON CONFLICT DO NOTHING so the
-- script can be re-run. The fixture user ids match the standalone PG verify
-- stub (00000000-...-000000000001 is created by scripts/pg-verify-stub.sql).
--
-- DO NOT run this against production; it inserts org/facility rows with
-- well-known UUIDs that would collide with real data.

-- ----------------------------------------------------------------------------
-- Two test users (auth.users.id) for caller context
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at,
  confirmation_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'fixture-org-a@haven.test', '', now(), '{}', '{}',
   'authenticated', 'authenticated', now(), now(), ''),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'fixture-org-b@haven.test', '', now(), '{}', '{}',
   'authenticated', 'authenticated', now(), now(), '')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Two organizations
-- ----------------------------------------------------------------------------
INSERT INTO public.organizations (id, name, status, timezone)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Fixture Org A', 'active', 'America/New_York'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Fixture Org B', 'active', 'America/New_York')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Entities (one per org)
-- ----------------------------------------------------------------------------
INSERT INTO public.entities (id, organization_id, name, status)
VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fixture Entity A', 'active'),
  ('bbbbbbbb-1111-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Fixture Entity B', 'active')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Facilities (one per org)
-- ----------------------------------------------------------------------------
INSERT INTO public.facilities (
  id, organization_id, entity_id, name, license_number, license_type, status,
  address_line_1, city, state, zip, county, phone, email,
  administrator_name, total_licensed_beds
) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-1111-0000-0000-000000000001',
   'Fixture Facility A', 'ALF-A-FIX', 'alf_intermediate', 'active',
   '1 A St', 'Alphaville', 'FL', '00001', 'Test', '555-0101', 'a@haven.test',
   'Alice Admin', 50),
  ('bbbbbbbb-2222-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-1111-0000-0000-000000000001',
   'Fixture Facility B', 'ALF-B-FIX', 'alf_intermediate', 'active',
   '2 B St', 'Betaville', 'FL', '00002', 'Test', '555-0202', 'b@haven.test',
   'Bob Boss', 60)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- user_profiles + user_facility_access (so we can simulate caller context
-- exactly as the router would resolve it). app_role isn't used by the RPCs
-- themselves (they take p_caller_role text), but we set it for realism.
-- ----------------------------------------------------------------------------
INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'fixture-org-a@haven.test', 'Fixture A Admin', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'fixture-org-b@haven.test', 'Fixture B Admin', 'owner')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
   'aaaaaaaa-2222-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
   'bbbbbbbb-2222-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001', true);

-- ----------------------------------------------------------------------------
-- ai_invocation_policies (allow_phi = true for both so PHI tools are
-- reachable; cross-org isolation is what we're testing, not phi gating).
-- ----------------------------------------------------------------------------
INSERT INTO public.ai_invocation_policies (organization_id, allow_phi)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', true),
  ('bbbbbbbb-0000-0000-0000-000000000001', true)
ON CONFLICT (organization_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- One row per tool's primary domain, per org.
-- ----------------------------------------------------------------------------

-- staff
INSERT INTO public.staff (
  id, organization_id, facility_id, first_name, last_name, staff_role,
  employment_status, hire_date
) VALUES
  ('aaaaaaaa-3001-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-2222-0000-0000-000000000001',
   'Alice', 'AStaff', 'cna', 'active', '2025-01-01'),
  ('bbbbbbbb-3001-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-2222-0000-0000-000000000001',
   'Bob', 'BStaff', 'cna', 'active', '2025-01-01')
ON CONFLICT (id) DO NOTHING;

-- residents
INSERT INTO public.residents (
  id, organization_id, facility_id, first_name, last_name,
  date_of_birth, gender, status, primary_payer
) VALUES
  ('aaaaaaaa-3002-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-2222-0000-0000-000000000001',
   'Alfred', 'Resident-A', '1940-01-01', 'male', 'active', 'private_pay'),
  ('bbbbbbbb-3002-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-2222-0000-0000-000000000001',
   'Betty', 'Resident-B', '1940-01-01', 'female', 'active', 'private_pay')
ON CONFLICT (id) DO NOTHING;

-- resident_medications
INSERT INTO public.resident_medications (
  id, organization_id, facility_id, resident_id, medication_name,
  route, frequency, status, start_date, order_date
) VALUES
  ('aaaaaaaa-3003-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-2222-0000-0000-000000000001',
   'aaaaaaaa-3002-0000-0000-000000000001',
   'A-Drug', 'oral', 'daily', 'active', '2025-01-01', '2025-01-01'),
  ('bbbbbbbb-3003-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-2222-0000-0000-000000000001',
   'bbbbbbbb-3002-0000-0000-000000000001',
   'B-Drug', 'oral', 'daily', 'active', '2025-01-01', '2025-01-01')
ON CONFLICT (id) DO NOTHING;

-- incidents
INSERT INTO public.incidents (
  id, organization_id, facility_id, incident_number, category, severity,
  status, occurred_at, shift, location_description, description,
  immediate_actions, reported_by
) VALUES
  ('aaaaaaaa-3004-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-2222-0000-0000-000000000001',
   'A-INC-001', 'fall_without_injury', 'level_1', 'open',
   now() - interval '2 days', 'day', 'Hallway A', 'Fixture incident A',
   'Assisted', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001'),
  ('bbbbbbbb-3004-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-2222-0000-0000-000000000001',
   'B-INC-001', 'fall_without_injury', 'level_1', 'open',
   now() - interval '2 days', 'day', 'Hallway B', 'Fixture incident B',
   'Assisted', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001')
ON CONFLICT (id) DO NOTHING;

-- incident_followups
INSERT INTO public.incident_followups (
  id, organization_id, facility_id, incident_id, task_type, description, due_at
) VALUES
  ('aaaaaaaa-3005-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-2222-0000-0000-000000000001',
   'aaaaaaaa-3004-0000-0000-000000000001',
   'family_notification', 'Notify family A', now() - interval '1 day'),
  ('bbbbbbbb-3005-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-2222-0000-0000-000000000001',
   'bbbbbbbb-3004-0000-0000-000000000001',
   'family_notification', 'Notify family B', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- survey_deficiencies (compliance)
INSERT INTO public.survey_deficiencies (
  id, organization_id, facility_id, survey_date, survey_type, tag_number,
  tag_description, severity, scope, description, status
) VALUES
  ('aaaaaaaa-3006-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-2222-0000-0000-000000000001',
   CURRENT_DATE - 10, 'routine', 'A100', 'Fixture tag A',
   'standard', 'isolated', 'Fixture deficiency A', 'open'),
  ('bbbbbbbb-3006-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-2222-0000-0000-000000000001',
   CURRENT_DATE - 10, 'routine', 'B100', 'Fixture tag B',
   'standard', 'isolated', 'Fixture deficiency B', 'open')
ON CONFLICT (id) DO NOTHING;

-- invoices (AR aging)
INSERT INTO public.invoices (
  id, organization_id, entity_id, facility_id, resident_id, invoice_number,
  invoice_date, due_date, period_start, period_end, status,
  subtotal, total, amount_paid, balance_due
) VALUES
  ('aaaaaaaa-3007-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-1111-0000-0000-000000000001',
   'aaaaaaaa-2222-0000-0000-000000000001',
   'aaaaaaaa-3002-0000-0000-000000000001',
   'A-INV-001', CURRENT_DATE - 45, CURRENT_DATE - 15,
   CURRENT_DATE - 75, CURRENT_DATE - 45, 'sent',
   100000, 100000, 0, 100000),
  ('bbbbbbbb-3007-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-1111-0000-0000-000000000001',
   'bbbbbbbb-2222-0000-0000-000000000001',
   'bbbbbbbb-3002-0000-0000-000000000001',
   'B-INV-001', CURRENT_DATE - 45, CURRENT_DATE - 15,
   CURRENT_DATE - 75, CURRENT_DATE - 45, 'sent',
   200000, 200000, 0, 200000)
ON CONFLICT (id) DO NOTHING;

-- facility_medicaid_providers
INSERT INTO public.facility_medicaid_providers (
  id, organization_id, facility_id, provider_name, provider_type,
  default_rate_cents, rate_unit, active
) VALUES
  ('aaaaaaaa-3008-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-2222-0000-0000-000000000001',
   'Fixture MCO A', 'MMA', 300000, 'monthly', true),
  ('bbbbbbbb-3008-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-2222-0000-0000-000000000001',
   'Fixture MCO B', 'MMA', 350000, 'monthly', true)
ON CONFLICT (id) DO NOTHING;

-- exec_alerts
INSERT INTO public.exec_alerts (
  id, organization_id, source_module, severity, title, body, facility_id
) VALUES
  ('aaaaaaaa-3009-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'incidents', 'warning', 'Fixture alert A', 'Org A test alert',
   'aaaaaaaa-2222-0000-0000-000000000001'),
  ('bbbbbbbb-3009-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'incidents', 'warning', 'Fixture alert B', 'Org B test alert',
   'bbbbbbbb-2222-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- staff_certifications
INSERT INTO public.staff_certifications (
  id, organization_id, facility_id, staff_id, certification_type,
  certification_name, issue_date, expiration_date, status
) VALUES
  ('aaaaaaaa-3010-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-2222-0000-0000-000000000001',
   'aaaaaaaa-3001-0000-0000-000000000001',
   'cpr', 'BLS-CPR', CURRENT_DATE - 365, CURRENT_DATE + 15, 'active'),
  ('bbbbbbbb-3010-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-2222-0000-0000-000000000001',
   'bbbbbbbb-3001-0000-0000-000000000001',
   'cpr', 'BLS-CPR', CURRENT_DATE - 365, CURRENT_DATE + 20, 'active')
ON CONFLICT (id) DO NOTHING;

-- infection_outbreaks (needed for pilot_facility_snapshot aggregate count)
INSERT INTO public.infection_outbreaks (
  id, organization_id, facility_id, infection_type, status, detection_method,
  detected_at, declared_by
) VALUES
  ('aaaaaaaa-3011-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-2222-0000-0000-000000000001',
   'norovirus', 'active', 'manual',
   now() - interval '5 days', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001'),
  ('bbbbbbbb-3011-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-2222-0000-0000-000000000001',
   'norovirus', 'active', 'manual',
   now() - interval '5 days', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001')
ON CONFLICT (id) DO NOTHING;
