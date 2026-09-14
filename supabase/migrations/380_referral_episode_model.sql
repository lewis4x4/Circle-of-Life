-- COL-329 / REF-02: durable referral people, opportunities, placement episodes,
-- contacts, event history, ownership, next actions, and reviewed corrections.
--
-- referral_leads remains the stable facility placement-episode identity used by
-- admissions, HL7, outreach, and workflow history. Identity review changes the
-- episode's consideration link; it never silently rewrites those downstream
-- references. Existing statuses retain an explicit compatibility map and none
-- of them, including converted, is treated here as proof of actual arrival.

BEGIN;

CREATE TYPE public.referral_effective_precision AS ENUM ('unknown', 'date', 'instant');
CREATE TYPE public.referral_interest_state AS ENUM ('unknown', 'interested', 'not_interested');
CREATE TYPE public.referral_episode_work_state AS ENUM ('unassigned', 'assigned', 'waiting', 'review', 'closed');
CREATE TYPE public.referral_contact_channel AS ENUM ('phone', 'sms', 'email');
CREATE TYPE public.referral_contact_permission_state AS ENUM ('unknown', 'permitted', 'denied');

CREATE OR REPLACE FUNCTION haven.referral_revision()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.concat_ws(':', pg_catalog.clock_timestamp()::text, public.gen_random_uuid()::text),
        'UTF8'
      )
    ),
    'hex'
  )
$function$;

CREATE OR REPLACE FUNCTION haven.referral_empty_revision()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.repeat('0', 64)
$function$;

REVOKE ALL ON FUNCTION haven.referral_revision(), haven.referral_empty_revision()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.referral_people (
  id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  first_name text NOT NULL CHECK (pg_catalog.btrim(first_name) <> ''),
  last_name text NOT NULL CHECK (pg_catalog.btrim(last_name) <> ''),
  preferred_name text,
  date_of_birth date,
  identity_revision text NOT NULL DEFAULT haven.referral_revision()
    CHECK (identity_revision ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_referral_people_org_name
  ON public.referral_people (organization_id, last_name, first_name, id)
  WHERE deleted_at IS NULL;

CREATE TABLE public.referral_opportunities (
  id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  person_id uuid NOT NULL REFERENCES public.referral_people(id),
  state text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  closed_at timestamptz,
  opportunity_revision text NOT NULL DEFAULT haven.referral_revision()
    CHECK (opportunity_revision ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  CONSTRAINT referral_opportunities_state_check CHECK (
    (state = 'open' AND closed_at IS NULL) OR (state = 'closed' AND closed_at IS NOT NULL)
  ),
  UNIQUE (organization_id, id, person_id)
);

CREATE INDEX idx_referral_opportunities_person
  ON public.referral_opportunities (organization_id, person_id, opened_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE public.referral_facility_considerations (
  id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  opportunity_id uuid NOT NULL REFERENCES public.referral_opportunities(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  interest_state public.referral_interest_state NOT NULL DEFAULT 'unknown',
  interest_recorded_at timestamptz,
  interest_recorded_by uuid REFERENCES auth.users(id),
  consideration_revision text NOT NULL DEFAULT haven.referral_revision()
    CHECK (consideration_revision ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  UNIQUE (organization_id, opportunity_id, facility_id),
  UNIQUE (organization_id, id, facility_id)
);

CREATE INDEX idx_referral_considerations_facility
  ON public.referral_facility_considerations (facility_id, interest_state, updated_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.referral_leads
  ALTER COLUMN inquiry_date DROP DEFAULT,
  ALTER COLUMN inquiry_date DROP NOT NULL,
  ADD COLUMN facility_consideration_id uuid,
  ADD COLUMN episode_sequence integer,
  ADD COLUMN receipt_effective_at timestamptz,
  ADD COLUMN receipt_precision public.referral_effective_precision NOT NULL DEFAULT 'unknown',
  ADD COLUMN owner_user_id uuid REFERENCES public.user_profiles(id),
  ADD COLUMN backup_user_id uuid REFERENCES public.user_profiles(id),
  ADD COLUMN ownership_accepted_at timestamptz,
  ADD COLUMN ownership_accepted_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN pending_owner_user_id uuid REFERENCES public.user_profiles(id),
  ADD COLUMN pending_backup_user_id uuid REFERENCES public.user_profiles(id),
  ADD COLUMN ownership_handoff_requested_at timestamptz,
  ADD COLUMN ownership_handoff_requested_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN work_state public.referral_episode_work_state NOT NULL DEFAULT 'unassigned',
  ADD COLUMN next_action text,
  ADD COLUMN next_action_at timestamptz,
  ADD COLUMN waiting_reason text,
  ADD COLUMN review_reason text,
  ADD COLUMN follow_up_at timestamptz,
  ADD COLUMN status_before_close public.referral_lead_status,
  ADD COLUMN reopen_count integer NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  ADD COLUMN episode_revision text NOT NULL DEFAULT haven.referral_revision()
    CHECK (episode_revision ~ '^[0-9a-f]{64}$');

UPDATE public.referral_leads
SET receipt_precision = CASE WHEN inquiry_date IS NULL THEN 'unknown'::public.referral_effective_precision
                             ELSE 'date'::public.referral_effective_precision END,
    work_state = CASE WHEN status IN ('converted', 'lost', 'merged')
                      THEN 'closed'::public.referral_episode_work_state
                      ELSE 'unassigned'::public.referral_episode_work_state END;

-- Every legacy lead starts as its own reviewed identity/opportunity. This
-- deliberately avoids inferring that same-name, same-phone, or same-DOB rows
-- represent the same person. Review commands may link them later.
INSERT INTO public.referral_people (
  id, organization_id, first_name, last_name, preferred_name, date_of_birth,
  identity_revision, created_at, updated_at, created_by, updated_by, deleted_at
)
SELECT lead.id, lead.organization_id, lead.first_name, lead.last_name,
  lead.preferred_name, lead.date_of_birth, haven.referral_revision(),
  lead.created_at, lead.updated_at, lead.created_by, lead.updated_by, lead.deleted_at
FROM public.referral_leads AS lead;

INSERT INTO public.referral_opportunities (
  id, organization_id, person_id, state, opened_at, closed_at,
  opportunity_revision, created_at, updated_at, created_by, updated_by, deleted_at
)
SELECT lead.id, lead.organization_id, lead.id,
  CASE WHEN lead.status IN ('converted', 'lost', 'merged') THEN 'closed' ELSE 'open' END,
  lead.created_at,
  CASE WHEN lead.status IN ('converted', 'lost', 'merged')
       THEN COALESCE(lead.closed_at, lead.converted_at, lead.merged_at, lead.updated_at) END,
  haven.referral_revision(), lead.created_at, lead.updated_at,
  lead.created_by, lead.updated_by, lead.deleted_at
FROM public.referral_leads AS lead;

INSERT INTO public.referral_facility_considerations (
  id, organization_id, opportunity_id, facility_id, interest_state,
  consideration_revision, created_at, updated_at, created_by, updated_by, deleted_at
)
SELECT lead.id, lead.organization_id, lead.id, lead.facility_id, 'unknown',
  haven.referral_revision(), lead.created_at, lead.updated_at,
  lead.created_by, lead.updated_by, lead.deleted_at
FROM public.referral_leads AS lead;

UPDATE public.referral_leads
SET facility_consideration_id = id,
    episode_sequence = 1;

ALTER TABLE public.referral_leads
  ALTER COLUMN facility_consideration_id SET NOT NULL,
  ALTER COLUMN episode_sequence SET NOT NULL,
  ADD CONSTRAINT referral_leads_consideration_scope_fkey
    FOREIGN KEY (organization_id, facility_consideration_id, facility_id)
    REFERENCES public.referral_facility_considerations(organization_id, id, facility_id),
  ADD CONSTRAINT referral_leads_episode_sequence_check CHECK (episode_sequence > 0),
  ADD CONSTRAINT referral_leads_receipt_precision_check CHECK (
    (receipt_precision = 'unknown' AND inquiry_date IS NULL AND receipt_effective_at IS NULL)
    OR (receipt_precision = 'date' AND inquiry_date IS NOT NULL AND receipt_effective_at IS NULL)
    OR (receipt_precision = 'instant' AND inquiry_date IS NULL AND receipt_effective_at IS NOT NULL)
  ),
  ADD CONSTRAINT referral_leads_next_action_check CHECK (
    (next_action IS NULL AND next_action_at IS NULL)
    OR (next_action IS NOT NULL AND pg_catalog.btrim(next_action) <> '')
  ),
  ADD CONSTRAINT referral_leads_pending_handoff_check CHECK (
    (
      pending_owner_user_id IS NULL
      AND pending_backup_user_id IS NULL
      AND ownership_handoff_requested_at IS NULL
      AND ownership_handoff_requested_by IS NULL
    )
    OR (
      pending_owner_user_id IS NOT NULL
      AND ownership_handoff_requested_at IS NOT NULL
      AND ownership_handoff_requested_by IS NOT NULL
      AND pending_owner_user_id IS DISTINCT FROM owner_user_id
      AND pending_backup_user_id IS DISTINCT FROM pending_owner_user_id
    )
  ),
  ADD CONSTRAINT referral_leads_work_state_check CHECK (
    (work_state = 'unassigned' AND owner_user_id IS NULL AND waiting_reason IS NULL
      AND review_reason IS NULL AND follow_up_at IS NULL)
    OR (work_state = 'assigned' AND owner_user_id IS NOT NULL AND waiting_reason IS NULL
      AND review_reason IS NULL AND follow_up_at IS NULL)
    OR (work_state = 'waiting' AND waiting_reason IS NOT NULL AND review_reason IS NULL
      AND follow_up_at IS NOT NULL)
    OR (work_state = 'review' AND review_reason IS NOT NULL AND waiting_reason IS NULL
      AND follow_up_at IS NOT NULL)
    OR (work_state = 'closed' AND waiting_reason IS NULL AND review_reason IS NULL
      AND follow_up_at IS NULL)
  );

CREATE UNIQUE INDEX idx_referral_leads_consideration_episode
  ON public.referral_leads (facility_consideration_id, episode_sequence);
CREATE UNIQUE INDEX idx_referral_leads_one_open_episode
  ON public.referral_leads (facility_consideration_id)
  WHERE deleted_at IS NULL AND status NOT IN ('converted', 'lost', 'merged');
CREATE INDEX idx_referral_leads_owner_follow_up
  ON public.referral_leads (facility_id, owner_user_id, follow_up_at)
  WHERE deleted_at IS NULL AND work_state <> 'closed';
CREATE INDEX idx_referral_leads_next_action
  ON public.referral_leads (facility_id, next_action_at)
  WHERE deleted_at IS NULL AND next_action IS NOT NULL AND work_state <> 'closed';

CREATE TABLE public.referral_contacts (
  id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  first_name text NOT NULL CHECK (pg_catalog.btrim(first_name) <> ''),
  last_name text NOT NULL CHECK (pg_catalog.btrim(last_name) <> ''),
  phone text,
  email text,
  contact_revision text NOT NULL DEFAULT haven.referral_revision()
    CHECK (contact_revision ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

-- There is intentionally no uniqueness constraint on names, phone numbers, or
-- email addresses. A shared family/provider contact is linked explicitly and
-- never causes two prospective residents to be merged.
CREATE INDEX idx_referral_contacts_org_name
  ON public.referral_contacts (organization_id, last_name, first_name, id)
  WHERE deleted_at IS NULL;

CREATE TABLE public.referral_person_contacts (
  id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  person_id uuid NOT NULL REFERENCES public.referral_people(id),
  contact_id uuid NOT NULL REFERENCES public.referral_contacts(id),
  originating_referral_lead_id uuid NOT NULL REFERENCES public.referral_leads(id),
  relationship text NOT NULL CHECK (pg_catalog.btrim(relationship) <> ''),
  is_primary boolean NOT NULL DEFAULT false,
  relationship_revision text NOT NULL DEFAULT haven.referral_revision()
    CHECK (relationship_revision ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  UNIQUE (organization_id, person_id, contact_id)
);

CREATE INDEX idx_referral_person_contacts_person
  ON public.referral_person_contacts (organization_id, person_id, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_referral_person_contacts_episode
  ON public.referral_person_contacts (organization_id, originating_referral_lead_id, created_at)
  WHERE deleted_at IS NULL;

CREATE TABLE public.referral_contact_permissions (
  id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  person_contact_id uuid NOT NULL REFERENCES public.referral_person_contacts(id),
  channel public.referral_contact_channel NOT NULL,
  permission_state public.referral_contact_permission_state NOT NULL DEFAULT 'unknown',
  evidence_note text,
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  recorded_by uuid REFERENCES auth.users(id),
  permission_revision text NOT NULL DEFAULT haven.referral_revision()
    CHECK (permission_revision ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE (organization_id, person_contact_id, channel)
);

CREATE TABLE public.referral_outcome_reason_drafts (
  id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  proposed_code text NOT NULL CHECK (pg_catalog.btrim(proposed_code) <> ''),
  proposed_label text NOT NULL CHECK (pg_catalog.btrim(proposed_label) <> ''),
  closed_by_party text CHECK (closed_by_party IN ('prospect', 'facility')),
  is_active boolean NOT NULL DEFAULT false CHECK (is_active = false),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  UNIQUE (organization_id, proposed_code)
);

COMMENT ON TABLE public.referral_outcome_reason_drafts IS
  'Inactive proposals only. COL-329 activates no unapproved closure vocabulary; approved reasons remain referral_closure_reasons.';

CREATE TABLE public.referral_status_compatibility (
  legacy_status public.referral_lead_status PRIMARY KEY,
  canonical_stage text NOT NULL CHECK (pg_catalog.btrim(canonical_stage) <> ''),
  episode_closed boolean NOT NULL,
  proves_arrival boolean NOT NULL DEFAULT false CHECK (proves_arrival = false),
  meaning text NOT NULL CHECK (pg_catalog.btrim(meaning) <> '')
);

INSERT INTO public.referral_status_compatibility (
  legacy_status, canonical_stage, episode_closed, proves_arrival, meaning
) VALUES
  ('new', 'inquiry', false, false, 'Legacy open inquiry; no contact fact is implied.'),
  ('contacted', 'contacted', false, false, 'Legacy contact stage; interaction details require an event.'),
  ('tour_scheduled', 'tour_scheduled', false, false, 'Legacy tour schedule stage; scheduled is not completed.'),
  ('tour_completed', 'tour_completed', false, false, 'Legacy tour completion stage; no admission is implied.'),
  ('application_pending', 'application_pending', false, false, 'Legacy application stage; readiness and arrival are separate facts.'),
  ('waitlisted', 'waitlisted', false, false, 'Legacy waitlist stage; waiting reason and review time may be unknown.'),
  ('converted', 'legacy_converted', true, false, 'Legacy conversion marker; it is not actual-arrival proof.'),
  ('lost', 'closed', true, false, 'Closed placement episode; old outcomes may remain explicitly unclassified.'),
  ('merged', 'superseded', true, false, 'Legacy duplicate marker; reviewed identity history is separate.');

CREATE TABLE public.referral_episode_events (
  id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  referral_lead_id uuid NOT NULL REFERENCES public.referral_leads(id),
  event_seq integer NOT NULL CHECK (event_seq > 0),
  event_kind text NOT NULL CHECK (event_kind IN (
    'captured', 'assigned', 'ownership_handoff_requested',
    'ownership_overridden', 'coverage_accepted', 'interaction_recorded',
    'waiting_started', 'review_started', 'resumed', 'next_action_set',
    'interest_recorded', 'closed', 'reopened', 'contact_added',
    'contact_linked', 'contact_permission_recorded', 'identity_merged',
    'identity_split', 'identity_undo', 'compatibility_updated',
    'admission_transition'
  )),
  from_status public.referral_lead_status,
  to_status public.referral_lead_status NOT NULL,
  from_work_state public.referral_episode_work_state,
  to_work_state public.referral_episode_work_state NOT NULL,
  effective_precision public.referral_effective_precision NOT NULL,
  effective_at timestamptz,
  effective_date date,
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  actor_role text NOT NULL,
  expected_revision text NOT NULL CHECK (expected_revision ~ '^[0-9a-f]{64}$'),
  result_revision text NOT NULL CHECK (result_revision ~ '^[0-9a-f]{64}$'),
  request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  source_kind text NOT NULL DEFAULT 'native'
    CHECK (source_kind IN ('native', 'import', 'outage_replay', 'hl7', 'system_compatibility')),
  source_reference jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_catalog.jsonb_typeof(source_reference) = 'object'),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_catalog.jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (referral_lead_id, event_seq),
  UNIQUE (organization_id, request_key),
  CONSTRAINT referral_episode_events_effective_check CHECK (
    (effective_precision = 'unknown' AND effective_at IS NULL AND effective_date IS NULL)
    OR (effective_precision = 'date' AND effective_at IS NULL AND effective_date IS NOT NULL)
    OR (effective_precision = 'instant' AND effective_at IS NOT NULL AND effective_date IS NULL)
  )
);

CREATE INDEX idx_referral_episode_events_timeline
  ON public.referral_episode_events (referral_lead_id, event_seq);
CREATE INDEX idx_referral_episode_events_effective
  ON public.referral_episode_events (facility_id, effective_date, effective_at, recorded_at);

CREATE TABLE public.referral_identity_corrections (
  id uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  referral_lead_id uuid NOT NULL REFERENCES public.referral_leads(id),
  correction_kind text NOT NULL CHECK (correction_kind IN ('merge', 'split', 'undo')),
  previous_consideration_id uuid NOT NULL REFERENCES public.referral_facility_considerations(id),
  previous_episode_sequence integer NOT NULL CHECK (previous_episode_sequence > 0),
  previous_status public.referral_lead_status NOT NULL,
  previous_work_state public.referral_episode_work_state NOT NULL,
  previous_projection jsonb NOT NULL
    CHECK (pg_catalog.jsonb_typeof(previous_projection) = 'object'),
  replacement_consideration_id uuid NOT NULL REFERENCES public.referral_facility_considerations(id),
  replacement_episode_sequence integer NOT NULL CHECK (replacement_episode_sequence > 0),
  target_referral_lead_id uuid REFERENCES public.referral_leads(id),
  related_correction_id uuid REFERENCES public.referral_identity_corrections(id),
  reversed_by_correction_id uuid REFERENCES public.referral_identity_corrections(id),
  downstream_review jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(downstream_review) = 'object'),
  reason text NOT NULL CHECK (pg_catalog.btrim(reason) <> ''),
  event_id uuid NOT NULL REFERENCES public.referral_episode_events(id),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_by uuid NOT NULL REFERENCES public.user_profiles(id),
  UNIQUE (event_id)
);

CREATE INDEX idx_referral_identity_corrections_episode
  ON public.referral_identity_corrections (referral_lead_id, created_at DESC, id);

-- Triage receipt time is also allowed to stay unknown. recorded_at remains the
-- immutable database insertion time, distinct from the source receipt fact.
ALTER TABLE public.referral_triage_inbox
  ALTER COLUMN received_at DROP DEFAULT,
  ALTER COLUMN received_at DROP NOT NULL,
  ADD COLUMN received_precision public.referral_effective_precision NOT NULL DEFAULT 'unknown';

UPDATE public.referral_triage_inbox
SET received_precision = CASE WHEN received_at IS NULL THEN 'unknown'::public.referral_effective_precision
                              ELSE 'instant'::public.referral_effective_precision END;

ALTER TABLE public.referral_triage_inbox
  ADD CONSTRAINT referral_triage_receipt_precision_check CHECK (
    (received_precision = 'unknown' AND received_at IS NULL)
    OR (received_precision = 'instant' AND received_at IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Audit, current-authority read boundaries, and immutable history.
-- ---------------------------------------------------------------------------

CREATE TRIGGER tr_referral_people_set_updated_at
  BEFORE UPDATE ON public.referral_people
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER tr_referral_people_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_people
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER tr_referral_opportunities_set_updated_at
  BEFORE UPDATE ON public.referral_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER tr_referral_opportunities_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER tr_referral_considerations_set_updated_at
  BEFORE UPDATE ON public.referral_facility_considerations
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER tr_referral_considerations_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_facility_considerations
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER tr_referral_contacts_set_updated_at
  BEFORE UPDATE ON public.referral_contacts
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER tr_referral_contacts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_contacts
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER tr_referral_person_contacts_set_updated_at
  BEFORE UPDATE ON public.referral_person_contacts
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER tr_referral_person_contacts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_person_contacts
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER tr_referral_contact_permissions_set_updated_at
  BEFORE UPDATE ON public.referral_contact_permissions
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER tr_referral_contact_permissions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_contact_permissions
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER tr_referral_outcome_drafts_set_updated_at
  BEFORE UPDATE ON public.referral_outcome_reason_drafts
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER tr_referral_outcome_drafts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_outcome_reason_drafts
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER tr_referral_episode_events_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_episode_events
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER tr_referral_identity_corrections_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_identity_corrections
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE TABLE haven.referral_command_context (
  transaction_id xid8 NOT NULL,
  backend_pid integer NOT NULL,
  command_active boolean NOT NULL DEFAULT false,
  internal_source_active boolean NOT NULL DEFAULT false,
  PRIMARY KEY (transaction_id, backend_pid)
);

REVOKE ALL ON TABLE haven.referral_command_context
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.activate_referral_command(
  p_internal_source boolean DEFAULT false
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  INSERT INTO haven.referral_command_context (
    transaction_id, backend_pid, command_active, internal_source_active
  ) VALUES (
    pg_catalog.pg_current_xact_id(), pg_catalog.pg_backend_pid(), true,
    COALESCE(p_internal_source, false)
  )
  ON CONFLICT (transaction_id, backend_pid) DO UPDATE
  SET command_active = true,
      internal_source_active =
        haven.referral_command_context.internal_source_active
        OR EXCLUDED.internal_source_active
$function$;

CREATE OR REPLACE FUNCTION haven.deactivate_referral_command()
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  DELETE FROM haven.referral_command_context
  WHERE transaction_id = pg_catalog.pg_current_xact_id()
    AND backend_pid = pg_catalog.pg_backend_pid()
$function$;

CREATE OR REPLACE FUNCTION haven.referral_command_active()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM haven.referral_command_context AS context
    WHERE context.transaction_id = pg_catalog.pg_current_xact_id()
      AND context.backend_pid = pg_catalog.pg_backend_pid()
      AND context.command_active
  )
$function$;

CREATE OR REPLACE FUNCTION haven.referral_internal_source_active()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM haven.referral_command_context AS context
    WHERE context.transaction_id = pg_catalog.pg_current_xact_id()
      AND context.backend_pid = pg_catalog.pg_backend_pid()
      AND context.internal_source_active
  )
$function$;

REVOKE ALL ON FUNCTION haven.activate_referral_command(boolean),
  haven.deactivate_referral_command(), haven.referral_command_active(),
  haven.referral_internal_source_active()
  FROM PUBLIC, anon, authenticated, service_role;

-- The prior authority trigger remains the outer scope guard. Commands normally
-- require lead_write before activating the command context; the application
-- pending compatibility transition is the sole constrained exception and
-- revalidates a matching admission record.
CREATE OR REPLACE FUNCTION haven.guard_referral_lead_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_organization_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  v_actor_id := haven.authorized_user_id();
  v_organization_id := haven.organization_id();
  IF v_actor_id IS NULL OR v_organization_id IS NULL
     OR (NOT haven.referral_capability('lead_write')
       AND NOT haven.referral_command_active()) THEN
    RAISE EXCEPTION 'Referral write authority required' USING ERRCODE = '42501';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM v_organization_id
     OR NOT haven.has_facility_access(NEW.facility_id) THEN
    RAISE EXCEPTION 'Referral lead scope unavailable' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.facility_id IS DISTINCT FROM OLD.facility_id THEN
      RAISE EXCEPTION 'Referral lead scope cannot be changed directly' USING ERRCODE = '42501';
    END IF;
    IF NEW.merged_into_lead_id IS DISTINCT FROM OLD.merged_into_lead_id
       OR NEW.merged_at IS DISTINCT FROM OLD.merged_at
       OR NEW.merged_by IS DISTINCT FROM OLD.merged_by THEN
      IF NOT haven.referral_command_active() THEN
        RAISE EXCEPTION 'Referral merges require the dedicated merge command'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.pii_access_tier IS DISTINCT FROM OLD.pii_access_tier THEN
      RAISE EXCEPTION 'Referral PII tier requires controlled approval' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
  ELSE
    NEW.created_by := v_actor_id;
    NEW.pii_access_tier := 'standard_ops';
    IF NEW.merged_into_lead_id IS NOT NULL OR NEW.merged_at IS NOT NULL OR NEW.merged_by IS NOT NULL THEN
      RAISE EXCEPTION 'Referral merges require the dedicated merge command' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_by := v_actor_id;
  IF TG_OP = 'INSERT' THEN
    NEW.tour_owner_user_id := CASE
      WHEN NEW.tour_scheduled_for IS NOT NULL OR NEW.tour_completed_at IS NOT NULL
        THEN v_actor_id
      ELSE NULL
    END;
  ELSIF NEW.tour_scheduled_for IS DISTINCT FROM OLD.tour_scheduled_for
     OR NEW.tour_completed_at IS DISTINCT FROM OLD.tour_completed_at THEN
    NEW.tour_owner_user_id := CASE
      WHEN NEW.tour_scheduled_for IS NOT NULL OR NEW.tour_completed_at IS NOT NULL
        THEN v_actor_id
      ELSE NULL
    END;
  ELSIF NEW.tour_owner_user_id IS DISTINCT FROM OLD.tour_owner_user_id THEN
    RAISE EXCEPTION 'Tour ownership follows the current tour command actor' USING ERRCODE = '42501';
  END IF;

  IF NEW.referral_source_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.referral_sources AS source
    WHERE source.id = NEW.referral_source_id
      AND source.organization_id = NEW.organization_id
      AND source.deleted_at IS NULL
      AND (source.facility_id IS NULL OR source.facility_id = NEW.facility_id)
  ) THEN
    RAISE EXCEPTION 'Referral source unavailable for lead scope' USING ERRCODE = '42501';
  END IF;

  IF NEW.converted_resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.residents AS resident
    WHERE resident.id = NEW.converted_resident_id
      AND resident.organization_id = NEW.organization_id
      AND resident.facility_id = NEW.facility_id
      AND resident.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Converted resident unavailable for lead scope' USING ERRCODE = '42501';
  END IF;

  IF NEW.merged_into_lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.referral_leads AS winner
    WHERE winner.id = NEW.merged_into_lead_id
      AND winner.organization_id = NEW.organization_id
      AND winner.facility_id = NEW.facility_id
      AND winner.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Merge target unavailable for lead scope' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION haven.guard_referral_lead_authority()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.guard_referral_episode_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Referral episode events are immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT haven.referral_command_active() THEN
    RAISE EXCEPTION 'Use the referral episode commands' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION haven.guard_referral_identity_correction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT haven.referral_command_active() THEN
    RAISE EXCEPTION 'Use the referral identity commands' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Referral identity corrections are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.reversed_by_correction_id IS NOT NULL
       OR NEW.reversed_by_correction_id IS NULL
       OR (NEW.id, NEW.organization_id, NEW.facility_id, NEW.referral_lead_id,
           NEW.correction_kind, NEW.previous_consideration_id,
           NEW.previous_episode_sequence,
           NEW.previous_status, NEW.previous_work_state, NEW.previous_projection,
           NEW.replacement_consideration_id, NEW.target_referral_lead_id,
           NEW.related_correction_id,
           NEW.replacement_episode_sequence,
           NEW.downstream_review, NEW.reason, NEW.event_id, NEW.created_at,
           NEW.created_by)
          IS DISTINCT FROM
          (OLD.id, OLD.organization_id, OLD.facility_id, OLD.referral_lead_id,
           OLD.correction_kind, OLD.previous_consideration_id,
           OLD.previous_episode_sequence,
           OLD.previous_status, OLD.previous_work_state, OLD.previous_projection,
           OLD.replacement_consideration_id, OLD.target_referral_lead_id,
           OLD.related_correction_id,
           OLD.replacement_episode_sequence,
           OLD.downstream_review, OLD.reason, OLD.event_id, OLD.created_at,
           OLD.created_by) THEN
      RAISE EXCEPTION 'Referral identity corrections are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION haven.guard_referral_history_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Referral history cannot be truncated' USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION haven.guard_referral_episode_event(),
  haven.guard_referral_identity_correction(), haven.guard_referral_history_truncate()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_referral_episode_event_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.referral_episode_events
  FOR EACH ROW EXECUTE FUNCTION haven.guard_referral_episode_event();
CREATE TRIGGER tr_referral_episode_events_no_truncate
  BEFORE TRUNCATE ON public.referral_episode_events
  FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_referral_history_truncate();
CREATE TRIGGER tr_referral_identity_correction_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.referral_identity_corrections
  FOR EACH ROW EXECUTE FUNCTION haven.guard_referral_identity_correction();
CREATE TRIGGER tr_referral_identity_corrections_no_truncate
  BEFORE TRUNCATE ON public.referral_identity_corrections
  FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_referral_history_truncate();

CREATE OR REPLACE FUNCTION haven.ensure_referral_episode_model()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := COALESCE(NEW.created_by, NEW.updated_by, haven.authorized_user_id());
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.facility_consideration_id, NEW.episode_sequence,
        NEW.receipt_effective_at, NEW.receipt_precision,
        NEW.owner_user_id, NEW.backup_user_id, NEW.ownership_accepted_at,
        NEW.ownership_accepted_by, NEW.pending_owner_user_id,
        NEW.pending_backup_user_id, NEW.ownership_handoff_requested_at,
        NEW.ownership_handoff_requested_by, NEW.work_state, NEW.next_action,
        NEW.next_action_at, NEW.waiting_reason, NEW.review_reason,
        NEW.follow_up_at, NEW.status_before_close, NEW.reopen_count)
       IS DISTINCT FROM
       (OLD.facility_consideration_id, OLD.episode_sequence,
        OLD.receipt_effective_at, OLD.receipt_precision,
        OLD.owner_user_id, OLD.backup_user_id, OLD.ownership_accepted_at,
        OLD.ownership_accepted_by, OLD.pending_owner_user_id,
        OLD.pending_backup_user_id, OLD.ownership_handoff_requested_at,
        OLD.ownership_handoff_requested_by, OLD.work_state, OLD.next_action,
        OLD.next_action_at, OLD.waiting_reason, OLD.review_reason,
        OLD.follow_up_at, OLD.status_before_close, OLD.reopen_count)
       AND NOT haven.referral_command_active() THEN
      RAISE EXCEPTION 'Use the referral episode commands' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT haven.referral_command_active() THEN
      NEW.episode_revision := haven.referral_revision();
      IF NEW.status IN ('converted', 'lost', 'merged') THEN
        NEW.work_state := 'closed';
        NEW.waiting_reason := NULL;
        NEW.review_reason := NULL;
        NEW.follow_up_at := NULL;
      END IF;
    ELSIF NEW.episode_revision IS DISTINCT FROM OLD.episode_revision
          AND NOT haven.referral_command_active() THEN
      RAISE EXCEPTION 'Use the referral episode commands' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.facility_consideration_id IS NULL THEN
    INSERT INTO public.referral_people (
      id, organization_id, first_name, last_name, preferred_name, date_of_birth,
      created_by, updated_by
    ) VALUES (
      NEW.id, NEW.organization_id, NEW.first_name, NEW.last_name,
      NEW.preferred_name, NEW.date_of_birth, v_actor, v_actor
    );
    INSERT INTO public.referral_opportunities (
      id, organization_id, person_id, state, opened_at, closed_at,
      created_by, updated_by
    ) VALUES (
      NEW.id, NEW.organization_id, NEW.id,
      CASE WHEN NEW.status IN ('converted', 'lost', 'merged') THEN 'closed' ELSE 'open' END,
      NEW.created_at,
      CASE WHEN NEW.status IN ('converted', 'lost', 'merged')
           THEN COALESCE(NEW.closed_at, NEW.converted_at, NEW.merged_at, NEW.updated_at) END,
      v_actor, v_actor
    );
    INSERT INTO public.referral_facility_considerations (
      id, organization_id, opportunity_id, facility_id, created_by, updated_by
    ) VALUES (
      NEW.id, NEW.organization_id, NEW.id, NEW.facility_id, v_actor, v_actor
    );
    NEW.facility_consideration_id := NEW.id;
    NEW.episode_sequence := 1;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.referral_facility_considerations AS consideration
    WHERE consideration.id = NEW.facility_consideration_id
      AND consideration.organization_id = NEW.organization_id
      AND consideration.facility_id = NEW.facility_id
      AND consideration.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Referral consideration unavailable' USING ERRCODE = '42501';
  END IF;

  IF NEW.episode_sequence IS NULL THEN
    SELECT COALESCE(MAX(lead.episode_sequence), 0) + 1
    INTO NEW.episode_sequence
    FROM public.referral_leads AS lead
    WHERE lead.facility_consideration_id = NEW.facility_consideration_id;
  END IF;
  IF NEW.status IN ('converted', 'lost', 'merged') THEN
    NEW.work_state := 'closed';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION haven.ensure_referral_episode_model()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER tr_referral_episode_model
  BEFORE INSERT OR UPDATE ON public.referral_leads
  FOR EACH ROW EXECUTE FUNCTION haven.ensure_referral_episode_model();

ALTER TABLE public.referral_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_facility_considerations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_person_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_contact_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_outcome_reason_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_status_compatibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_episode_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_identity_corrections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.referral_people, public.referral_opportunities,
  public.referral_facility_considerations, public.referral_contacts,
  public.referral_person_contacts, public.referral_contact_permissions,
  public.referral_outcome_reason_drafts, public.referral_status_compatibility,
  public.referral_episode_events, public.referral_identity_corrections
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.referral_people, public.referral_opportunities,
  public.referral_facility_considerations, public.referral_contacts,
  public.referral_person_contacts, public.referral_contact_permissions,
  public.referral_outcome_reason_drafts, public.referral_status_compatibility,
  public.referral_episode_events, public.referral_identity_corrections
  TO service_role;
GRANT SELECT ON TABLE public.referral_status_compatibility TO authenticated;

CREATE POLICY referral_status_compatibility_read
  ON public.referral_status_compatibility FOR SELECT TO authenticated
  USING ((SELECT haven.referral_capability('lead_read')));

CREATE POLICY referral_episode_events_read
  ON public.referral_episode_events FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND (SELECT haven.referral_capability('clinical_read'))
    AND (SELECT haven.has_facility_access(facility_id))
  );

CREATE POLICY referral_identity_corrections_read
  ON public.referral_identity_corrections FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND (SELECT haven.referral_capability('duplicate_review'))
    AND (SELECT haven.has_facility_access(facility_id))
  );

COMMENT ON TABLE public.referral_people IS
  'Portfolio person identities. Legacy leads backfill one-to-one; matching never auto-merges identities.';
COMMENT ON TABLE public.referral_opportunities IS
  'Portfolio-level referral opportunities that may have multiple facility considerations and repeated episodes.';
COMMENT ON TABLE public.referral_facility_considerations IS
  'One opportunity considered by one facility. Interest is independent of episode stage.';
COMMENT ON TABLE public.referral_episode_events IS
  'Immutable effective-time and recorded-time history for versioned, idempotent referral episode commands.';
COMMENT ON TABLE public.referral_identity_corrections IS
  'Reviewed merge, split, and undo history. Downstream rows retain the stable referral_lead_id.';

-- ---------------------------------------------------------------------------
-- Shared command mechanics.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION haven.referral_request_problem(
  p_request_key text,
  p_expected_revision text,
  p_payload jsonb,
  p_allowed_keys text[]
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_key text;
BEGIN
  IF p_request_key IS NULL
     OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN
    RETURN 'A referral request key is required';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision !~ '^[0-9a-f]{64}$' THEN
    RETURN 'An expected referral revision is required';
  END IF;
  IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object' THEN
    RETURN 'Referral payload must be an object';
  END IF;
  FOR v_key IN SELECT * FROM pg_catalog.jsonb_object_keys(p_payload) LOOP
    IF NOT (v_key = ANY (p_allowed_keys)) THEN
      RETURN 'Referral payload field is not editable';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION haven.referral_text(p_payload jsonb, p_key text, p_max integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_value text;
BEGIN
  IF NOT (p_payload ? p_key) OR pg_catalog.jsonb_typeof(p_payload -> p_key) = 'null' THEN
    RETURN NULL;
  END IF;
  IF pg_catalog.jsonb_typeof(p_payload -> p_key) <> 'string' THEN
    RAISE EXCEPTION '% must be text of at most % characters', p_key, p_max
      USING ERRCODE = '22023';
  END IF;
  v_value := NULLIF(pg_catalog.btrim(p_payload ->> p_key), '');
  IF v_value IS NOT NULL AND pg_catalog.length(v_value) > p_max THEN
    RAISE EXCEPTION '% must be text of at most % characters', p_key, p_max
      USING ERRCODE = '22023';
  END IF;
  RETURN v_value;
END;
$function$;

CREATE OR REPLACE FUNCTION haven.referral_uuid(p_payload jsonb, p_key text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
BEGIN
  IF NOT (p_payload ? p_key) OR pg_catalog.jsonb_typeof(p_payload -> p_key) = 'null' THEN
    RETURN NULL;
  END IF;
  IF pg_catalog.jsonb_typeof(p_payload -> p_key) <> 'string' THEN
    RAISE EXCEPTION '% must be a uuid', p_key USING ERRCODE = '22023';
  END IF;
  RETURN (p_payload ->> p_key)::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION '% must be a uuid', p_key USING ERRCODE = '22023';
END;
$function$;

CREATE OR REPLACE FUNCTION haven.referral_timestamp(p_payload jsonb, p_key text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
BEGIN
  IF NOT (p_payload ? p_key) OR pg_catalog.jsonb_typeof(p_payload -> p_key) = 'null' THEN
    RETURN NULL;
  END IF;
  IF pg_catalog.jsonb_typeof(p_payload -> p_key) <> 'string' THEN
    RAISE EXCEPTION '% must be an ISO timestamp', p_key USING ERRCODE = '22023';
  END IF;
  IF (p_payload ->> p_key)
     !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RAISE EXCEPTION '% must include an explicit UTC or numeric offset', p_key
      USING ERRCODE = '22023';
  END IF;
  RETURN (p_payload ->> p_key)::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION '% must be an ISO timestamp', p_key USING ERRCODE = '22023';
END;
$function$;

CREATE OR REPLACE FUNCTION haven.referral_date(p_payload jsonb, p_key text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
BEGIN
  IF NOT (p_payload ? p_key) OR pg_catalog.jsonb_typeof(p_payload -> p_key) = 'null' THEN
    RETURN NULL;
  END IF;
  IF pg_catalog.jsonb_typeof(p_payload -> p_key) <> 'string' THEN
    RAISE EXCEPTION '% must be an ISO date', p_key USING ERRCODE = '22023';
  END IF;
  IF (p_payload ->> p_key) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION '% must be an ISO date', p_key USING ERRCODE = '22023';
  END IF;
  RETURN (p_payload ->> p_key)::date;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION '% must be an ISO date', p_key USING ERRCODE = '22023';
END;
$function$;

CREATE OR REPLACE FUNCTION haven.referral_boolean(p_payload jsonb, p_key text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
BEGIN
  IF NOT (p_payload ? p_key) OR pg_catalog.jsonb_typeof(p_payload -> p_key) = 'null' THEN
    RETURN NULL;
  END IF;
  IF pg_catalog.jsonb_typeof(p_payload -> p_key) <> 'boolean' THEN
    RAISE EXCEPTION '% must be boolean', p_key USING ERRCODE = '22023';
  END IF;
  RETURN (p_payload ->> p_key)::boolean;
END;
$function$;

CREATE OR REPLACE FUNCTION haven.referral_request_hash(p_canonical jsonb)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'actor', haven.authorized_user_id(),
          'payload', p_canonical
        )::text,
        'UTF8'
      )
    ),
    'hex'
  )
$function$;

CREATE OR REPLACE FUNCTION haven.referral_request_lock(p_organization_id uuid, p_request_key text)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $function$
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_request_key, 0)
  )
$function$;

CREATE OR REPLACE FUNCTION haven.referral_replay(
  p_organization_id uuid,
  p_episode_id uuid,
  p_request_key text,
  p_request_hash text
)
RETURNS public.referral_episode_events
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $function$
DECLARE
  v_event public.referral_episode_events;
BEGIN
  SELECT event.* INTO v_event
  FROM public.referral_episode_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.request_key = p_request_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF (p_episode_id IS NULL OR v_event.referral_lead_id = p_episode_id)
     AND v_event.request_hash = p_request_hash
     AND v_event.actor_id = haven.authorized_user_id() THEN
    RETURN v_event;
  END IF;
  RAISE EXCEPTION 'This referral request was already saved with different content'
    USING ERRCODE = 'P0001';
END;
$function$;

CREATE OR REPLACE FUNCTION haven.lock_referral_actor_authority(
  p_organization_id uuid,
  p_facility_id uuid,
  p_capability text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := haven.authorized_user_id();
  v_session_id uuid;
BEGIN
  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_session_id := NULL;
  END;
  IF v_actor_id IS NULL OR v_session_id IS NULL THEN
    RAISE EXCEPTION 'Referral authority is unavailable' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.user_profiles AS profile
  WHERE profile.id = v_actor_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral authority is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_actor_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral authority is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM auth.sessions AS session
  WHERE session.id = v_session_id
    AND session.user_id = v_actor_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral authority is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM public.facilities AS facility
  WHERE facility.id = p_facility_id
    AND facility.organization_id = p_organization_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral facility is unavailable' USING ERRCODE = '42501';
  END IF;
  -- The profile lock is the serialization point for facility-access changes:
  -- the existing access trigger advances auth_claim_version on that same row.
  -- Do not lock user_facility_access after the profile; revocation acquires those
  -- locks in the opposite order and would introduce a deadlock cycle.
  IF haven.authorized_user_id() IS DISTINCT FROM v_actor_id
     OR haven.organization_id() IS DISTINCT FROM p_organization_id
     OR NOT haven.referral_capability(p_capability)
     OR NOT haven.has_facility_access(p_facility_id) THEN
    RAISE EXCEPTION 'Referral authority changed' USING ERRCODE = '42501';
  END IF;
  RETURN v_actor_id;
END;
$function$;

CREATE OR REPLACE FUNCTION haven.lock_referral_episode(p_episode_id uuid)
RETURNS public.referral_leads
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_episode public.referral_leads;
BEGIN
  IF NOT haven.referral_capability('lead_write') THEN
    RAISE EXCEPTION 'Referral write authority required' USING ERRCODE = '42501';
  END IF;
  SELECT lead.* INTO v_episode
  FROM public.referral_leads AS lead
  WHERE lead.id = p_episode_id
    AND lead.organization_id = haven.organization_id()
    AND lead.deleted_at IS NULL
    AND haven.has_facility_access(lead.facility_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral episode unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM haven.lock_referral_actor_authority(
    v_episode.organization_id, v_episode.facility_id, 'lead_write'
  );
  RETURN v_episode;
END;
$function$;

CREATE OR REPLACE FUNCTION haven.referral_staff_current_for_facility(
  p_user_id uuid,
  p_organization_id uuid,
  p_facility_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles AS profile
    WHERE profile.id = p_user_id
      AND profile.organization_id = p_organization_id
      AND profile.is_active
      AND profile.deleted_at IS NULL
      AND profile.app_role IN ('owner', 'org_admin', 'facility_admin', 'nurse')
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

CREATE OR REPLACE FUNCTION haven.referral_opportunity_visible(p_opportunity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.referral_facility_considerations AS consideration
    WHERE consideration.opportunity_id = p_opportunity_id
      AND consideration.organization_id = haven.organization_id()
      AND consideration.deleted_at IS NULL
      AND haven.has_facility_access(consideration.facility_id)
  )
$function$;

CREATE OR REPLACE FUNCTION haven.referral_contact_visible(p_contact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.referral_person_contacts AS relationship
    LEFT JOIN public.referral_leads AS origin_episode
      ON origin_episode.id = relationship.originating_referral_lead_id
     AND origin_episode.organization_id = relationship.organization_id
     AND origin_episode.deleted_at IS NULL
    LEFT JOIN public.referral_opportunities AS opportunity
      ON opportunity.person_id = relationship.person_id
     AND opportunity.organization_id = relationship.organization_id
     AND opportunity.deleted_at IS NULL
    LEFT JOIN public.referral_facility_considerations AS consideration
      ON consideration.opportunity_id = opportunity.id
     AND consideration.organization_id = opportunity.organization_id
     AND consideration.deleted_at IS NULL
    WHERE relationship.contact_id = p_contact_id
      AND relationship.organization_id = haven.organization_id()
      AND relationship.deleted_at IS NULL
      AND (
        (origin_episode.id IS NOT NULL
          AND haven.has_facility_access(origin_episode.facility_id))
        OR (consideration.id IS NOT NULL
          AND haven.has_facility_access(consideration.facility_id))
      )
  )
$function$;

CREATE OR REPLACE FUNCTION haven.referral_downstream_snapshot(p_episode_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'reviewed', true,
    'referral_lead_id', p_episode_id,
    'admission_cases', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', admission.id,
        'status', admission.status,
        'updated_at', admission.updated_at,
        'deleted_at', admission.deleted_at
      ) ORDER BY admission.id)
      FROM public.admission_cases AS admission
      WHERE admission.referral_lead_id = p_episode_id
    ), '[]'::jsonb),
    'workflow_events', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', event.id,
        'event_type', event.event_type,
        'created_at', event.created_at,
        'deleted_at', event.deleted_at
      ) ORDER BY event.id)
      FROM public.workflow_events AS event
      WHERE event.referral_lead_id = p_episode_id
    ), '[]'::jsonb),
    'hl7_inbound', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', inbound.id,
        'status', inbound.status,
        'updated_at', inbound.updated_at,
        'deleted_at', inbound.deleted_at
      ) ORDER BY inbound.id)
      FROM public.referral_hl7_inbound AS inbound
      WHERE inbound.linked_referral_lead_id = p_episode_id
    ), '[]'::jsonb),
    'outreach_activities', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', outreach.id,
        'status', outreach.status,
        'updated_at', outreach.updated_at,
        'deleted_at', outreach.deleted_at
      ) ORDER BY outreach.id)
      FROM public.referral_outreach_activities AS outreach
      WHERE outreach.referral_lead_id = p_episode_id
    ), '[]'::jsonb),
    'person_contacts', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', relationship.id,
        'contact_id', relationship.contact_id,
        'updated_at', relationship.updated_at,
        'deleted_at', relationship.deleted_at
      ) ORDER BY relationship.id)
      FROM public.referral_leads AS lead
      JOIN public.referral_facility_considerations AS consideration
        ON consideration.id = lead.facility_consideration_id
      JOIN public.referral_opportunities AS opportunity
        ON opportunity.id = consideration.opportunity_id
      JOIN public.referral_person_contacts AS relationship
        ON relationship.person_id = opportunity.person_id
       OR relationship.originating_referral_lead_id = lead.id
      WHERE lead.id = p_episode_id
        AND relationship.organization_id = lead.organization_id
    ), '[]'::jsonb),
    'contact_permissions', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', permission.id,
        'person_contact_id', permission.person_contact_id,
        'permission_revision', permission.permission_revision,
        'updated_at', permission.updated_at
      ) ORDER BY permission.id)
      FROM public.referral_leads AS lead
      JOIN public.referral_facility_considerations AS consideration
        ON consideration.id = lead.facility_consideration_id
      JOIN public.referral_opportunities AS opportunity
        ON opportunity.id = consideration.opportunity_id
      JOIN public.referral_person_contacts AS relationship
        ON relationship.person_id = opportunity.person_id
        OR relationship.originating_referral_lead_id = lead.id
      JOIN public.referral_contact_permissions AS permission
        ON permission.person_contact_id = relationship.id
       AND permission.organization_id = relationship.organization_id
      WHERE lead.id = p_episode_id
        AND relationship.organization_id = lead.organization_id
    ), '[]'::jsonb)
  )
$function$;

CREATE OR REPLACE FUNCTION haven.lock_referral_downstream(p_episode_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM 1 FROM public.admission_cases
  WHERE referral_lead_id = p_episode_id FOR UPDATE;
  PERFORM 1 FROM public.workflow_events
  WHERE referral_lead_id = p_episode_id FOR UPDATE;
  PERFORM 1 FROM public.referral_hl7_inbound
  WHERE linked_referral_lead_id = p_episode_id FOR UPDATE;
  PERFORM 1 FROM public.referral_outreach_activities
  WHERE referral_lead_id = p_episode_id FOR UPDATE;
  PERFORM 1
  FROM public.referral_person_contacts AS relationship
  WHERE relationship.id IN (
    SELECT candidate.id
    FROM public.referral_leads AS lead
    JOIN public.referral_facility_considerations AS consideration
      ON consideration.id = lead.facility_consideration_id
    JOIN public.referral_opportunities AS opportunity
      ON opportunity.id = consideration.opportunity_id
    JOIN public.referral_person_contacts AS candidate
      ON candidate.person_id = opportunity.person_id
      OR candidate.originating_referral_lead_id = lead.id
    WHERE lead.id = p_episode_id
      AND candidate.organization_id = lead.organization_id
  )
  FOR UPDATE;
  PERFORM 1
  FROM public.referral_contact_permissions AS permission
  JOIN public.referral_person_contacts AS relationship
    ON relationship.id = permission.person_contact_id
  WHERE relationship.id IN (
    SELECT candidate.id
    FROM public.referral_leads AS lead
    JOIN public.referral_facility_considerations AS consideration
      ON consideration.id = lead.facility_consideration_id
    JOIN public.referral_opportunities AS opportunity
      ON opportunity.id = consideration.opportunity_id
    JOIN public.referral_person_contacts AS candidate
      ON candidate.person_id = opportunity.person_id
      OR candidate.originating_referral_lead_id = lead.id
    WHERE lead.id = p_episode_id
      AND candidate.organization_id = lead.organization_id
  )
  FOR UPDATE OF permission;
END;
$function$;

CREATE OR REPLACE FUNCTION haven.reconcile_referral_opportunity_state(
  p_opportunity_id uuid,
  p_organization_id uuid,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_has_open_episode boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.referral_facility_considerations AS consideration
    JOIN public.referral_leads AS episode
      ON episode.facility_consideration_id = consideration.id
     AND episode.organization_id = consideration.organization_id
     AND episode.deleted_at IS NULL
    WHERE consideration.opportunity_id = p_opportunity_id
      AND consideration.organization_id = p_organization_id
      AND consideration.deleted_at IS NULL
      AND episode.status NOT IN ('converted', 'lost', 'merged')
  ) INTO v_has_open_episode;

  UPDATE public.referral_opportunities AS opportunity
  SET state = CASE WHEN v_has_open_episode THEN 'open' ELSE 'closed' END,
      closed_at = CASE
        WHEN v_has_open_episode THEN NULL
        ELSE COALESCE(opportunity.closed_at, pg_catalog.clock_timestamp())
      END,
      opportunity_revision = haven.referral_revision(),
      updated_by = p_actor_id
  WHERE opportunity.id = p_opportunity_id
    AND opportunity.organization_id = p_organization_id
    AND opportunity.deleted_at IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION haven.write_referral_episode_event(
  p_before public.referral_leads,
  p_after public.referral_leads,
  p_event_kind text,
  p_request_key text,
  p_request_hash text,
  p_expected_revision text,
  p_effective_precision public.referral_effective_precision,
  p_effective_at timestamptz,
  p_effective_date date,
  p_source_kind text,
  p_source_reference jsonb,
  p_details jsonb
)
RETURNS public.referral_episode_events
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $function$
DECLARE
  v_event public.referral_episode_events;
  v_seq integer;
BEGIN
  SELECT COALESCE(MAX(event.event_seq), 0) + 1 INTO v_seq
  FROM public.referral_episode_events AS event
  WHERE event.referral_lead_id = p_after.id;

  INSERT INTO public.referral_episode_events (
    organization_id, facility_id, referral_lead_id, event_seq, event_kind,
    from_status, to_status, from_work_state, to_work_state,
    effective_precision, effective_at, effective_date, actor_id, actor_role,
    expected_revision, result_revision, request_key, request_hash, source_kind,
    source_reference, details
  ) VALUES (
    p_after.organization_id, p_after.facility_id, p_after.id, v_seq, p_event_kind,
    p_before.status, p_after.status, p_before.work_state, p_after.work_state,
    p_effective_precision, p_effective_at, p_effective_date,
    haven.authorized_user_id(), haven.app_role()::text,
    p_expected_revision, p_after.episode_revision,
    p_request_key, p_request_hash, p_source_kind,
    COALESCE(p_source_reference, '{}'::jsonb), COALESCE(p_details, '{}'::jsonb)
  ) RETURNING * INTO v_event;
  RETURN v_event;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This referral request was already saved with different content'
    USING ERRCODE = 'P0001';
END;
$function$;

CREATE OR REPLACE FUNCTION haven.referral_episode_reply(
  p_episode public.referral_leads,
  p_event public.referral_episode_events,
  p_replayed boolean
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'episode_id', p_event.referral_lead_id,
    'episode_revision', p_event.result_revision,
    'status', p_event.to_status,
    'work_state', p_event.to_work_state,
    'event_id', p_event.id,
    'event_kind', p_event.event_kind,
    'replayed', p_replayed
  )
$function$;

REVOKE ALL ON FUNCTION haven.referral_request_problem(text,text,jsonb,text[]),
  haven.referral_text(jsonb,text,integer), haven.referral_uuid(jsonb,text),
  haven.referral_timestamp(jsonb,text), haven.referral_date(jsonb,text),
  haven.referral_boolean(jsonb,text), haven.referral_request_hash(jsonb),
  haven.referral_request_lock(uuid,text),
  haven.referral_replay(uuid,uuid,text,text),
  haven.lock_referral_actor_authority(uuid,uuid,text),
  haven.lock_referral_episode(uuid),
  haven.referral_staff_current_for_facility(uuid,uuid,uuid),
  haven.referral_opportunity_visible(uuid), haven.referral_contact_visible(uuid),
  haven.referral_downstream_snapshot(uuid),
  haven.lock_referral_downstream(uuid),
  haven.reconcile_referral_opportunity_state(uuid,uuid,uuid),
  haven.write_referral_episode_event(
    public.referral_leads,public.referral_leads,text,text,text,text,
    public.referral_effective_precision,timestamptz,date,text,jsonb,jsonb
  ),
  haven.referral_episode_reply(
    public.referral_leads,public.referral_episode_events,boolean
  )
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Capture. A new identity is the default. Reuse of an existing person and
-- opportunity must be explicit and uses the opportunity revision.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.referral_episode_capture(
  p_request_key text,
  p_expected_revision text,
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
  v_actor_id uuid;
  v_organization_id uuid;
  v_facility_id uuid;
  v_person_id uuid;
  v_existing_person_id uuid;
  v_opportunity_id uuid;
  v_existing_opportunity_id uuid;
  v_consideration_id uuid;
  v_episode_id uuid := public.gen_random_uuid();
  v_episode_sequence integer;
  v_first_name text;
  v_last_name text;
  v_preferred_name text;
  v_phone text;
  v_email text;
  v_notes text;
  v_external_reference text;
  v_referral_source_id uuid;
  v_date_of_birth date;
  v_inquiry_date date;
  v_receipt_at timestamptz;
  v_precision public.referral_effective_precision;
  v_preferred_contact public.referral_lead_preferred_contact;
  v_source_kind text;
  v_source_reference jsonb;
  v_request_hash text;
  v_event public.referral_episode_events;
  v_replayed public.referral_episode_events;
  v_episode public.referral_leads;
  v_before public.referral_leads;
  v_opportunity public.referral_opportunities;
  v_person public.referral_people;
BEGIN
  v_problem := haven.referral_request_problem(
    p_request_key,
    p_expected_revision,
    p_payload,
    ARRAY[
      'facility_id','existing_person_id','existing_opportunity_id',
      'first_name','last_name','preferred_name','date_of_birth','phone','email',
      'notes','external_reference',
      'preferred_contact','referral_source_id','receipt_precision',
      'inquiry_date','receipt_effective_at','source_kind','source_reference'
    ]
  );
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023';
  END IF;
  IF NOT haven.referral_capability('lead_write') THEN
    RAISE EXCEPTION 'Referral write authority required' USING ERRCODE = '42501';
  END IF;

  v_actor_id := haven.authorized_user_id();
  v_organization_id := haven.organization_id();
  v_facility_id := haven.referral_uuid(p_payload, 'facility_id');
  IF v_actor_id IS NULL OR v_organization_id IS NULL OR v_facility_id IS NULL
     OR NOT haven.has_facility_access(v_facility_id) THEN
    RAISE EXCEPTION 'Referral write scope unavailable' USING ERRCODE = '42501';
  END IF;

  v_existing_person_id := haven.referral_uuid(p_payload, 'existing_person_id');
  v_existing_opportunity_id := haven.referral_uuid(p_payload, 'existing_opportunity_id');
  IF (v_existing_person_id IS NULL) <> (v_existing_opportunity_id IS NULL) THEN
    RAISE EXCEPTION 'Existing person and opportunity must be supplied together'
      USING ERRCODE = '22023';
  END IF;

  v_source_kind := COALESCE(haven.referral_text(p_payload, 'source_kind', 40), 'native');
  IF v_source_kind NOT IN ('native', 'import', 'outage_replay', 'hl7', 'system_compatibility') THEN
    RAISE EXCEPTION 'Unsupported referral source kind' USING ERRCODE = '22023';
  END IF;
  IF v_source_kind IN ('hl7', 'system_compatibility')
     AND NOT haven.referral_internal_source_active() THEN
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

  BEGIN
    v_precision := COALESCE(
      (haven.referral_text(p_payload, 'receipt_precision', 20))::public.referral_effective_precision,
      'unknown'
    );
    v_preferred_contact := COALESCE(
      (haven.referral_text(p_payload, 'preferred_contact', 20))::public.referral_lead_preferred_contact,
      'either'
    );
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Unsupported referral receipt or contact value' USING ERRCODE = '22023';
  END;
  v_inquiry_date := haven.referral_date(p_payload, 'inquiry_date');
  v_receipt_at := haven.referral_timestamp(p_payload, 'receipt_effective_at');
  IF NOT (
    (v_precision = 'unknown' AND v_inquiry_date IS NULL AND v_receipt_at IS NULL)
    OR (v_precision = 'date' AND v_inquiry_date IS NOT NULL AND v_receipt_at IS NULL)
    OR (v_precision = 'instant' AND v_inquiry_date IS NULL AND v_receipt_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Referral receipt value does not match its precision'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := haven.referral_request_hash(
    pg_catalog.jsonb_build_object(
      'command', 'capture',
      'expected_revision', p_expected_revision,
      'payload', p_payload
    )
  );
  PERFORM haven.referral_request_lock(v_organization_id, p_request_key);
  PERFORM haven.lock_referral_actor_authority(
    v_organization_id, v_facility_id, 'lead_write'
  );
  v_replayed := haven.referral_replay(
    v_organization_id, NULL, p_request_key, v_request_hash
  );
  IF v_replayed.id IS NOT NULL THEN
    SELECT lead.* INTO STRICT v_episode
    FROM public.referral_leads AS lead
    WHERE lead.id = v_replayed.referral_lead_id
      AND lead.organization_id = v_organization_id
      AND lead.deleted_at IS NULL
      AND haven.has_facility_access(lead.facility_id);
    RETURN haven.referral_episode_reply(v_episode, v_replayed, true);
  END IF;

  v_first_name := haven.referral_text(p_payload, 'first_name', 200);
  v_last_name := haven.referral_text(p_payload, 'last_name', 200);
  v_preferred_name := haven.referral_text(p_payload, 'preferred_name', 200);
  v_phone := haven.referral_text(p_payload, 'phone', 100);
  v_email := haven.referral_text(p_payload, 'email', 320);
  v_notes := haven.referral_text(p_payload, 'notes', 8000);
  v_external_reference := haven.referral_text(p_payload, 'external_reference', 500);
  v_referral_source_id := haven.referral_uuid(p_payload, 'referral_source_id');
  v_date_of_birth := haven.referral_date(p_payload, 'date_of_birth');

  IF v_existing_opportunity_id IS NULL THEN
    IF p_expected_revision IS DISTINCT FROM haven.referral_empty_revision() THEN
      RAISE EXCEPTION 'New referral capture requires the empty revision'
        USING ERRCODE = '40001';
    END IF;
    IF v_first_name IS NULL OR v_last_name IS NULL THEN
      RAISE EXCEPTION 'Referral name is required' USING ERRCODE = '22023';
    END IF;
    v_person_id := public.gen_random_uuid();
    v_opportunity_id := public.gen_random_uuid();
    v_consideration_id := public.gen_random_uuid();

    INSERT INTO public.referral_people (
      id, organization_id, first_name, last_name, preferred_name, date_of_birth,
      created_by, updated_by
    ) VALUES (
      v_person_id, v_organization_id, v_first_name, v_last_name,
      v_preferred_name, v_date_of_birth, v_actor_id, v_actor_id
    );
    INSERT INTO public.referral_opportunities (
      id, organization_id, person_id, created_by, updated_by
    ) VALUES (
      v_opportunity_id, v_organization_id, v_person_id, v_actor_id, v_actor_id
    );
    INSERT INTO public.referral_facility_considerations (
      id, organization_id, opportunity_id, facility_id, created_by, updated_by
    ) VALUES (
      v_consideration_id, v_organization_id, v_opportunity_id,
      v_facility_id, v_actor_id, v_actor_id
    );
  ELSE
    IF NOT haven.referral_capability('duplicate_review') THEN
      RAISE EXCEPTION 'Reviewed referral identity authority required'
        USING ERRCODE = '42501';
    END IF;
    SELECT opportunity.* INTO v_opportunity
    FROM public.referral_opportunities AS opportunity
    WHERE opportunity.id = v_existing_opportunity_id
      AND opportunity.organization_id = v_organization_id
      AND opportunity.person_id = v_existing_person_id
      AND opportunity.state = 'open'
      AND opportunity.deleted_at IS NULL
      AND haven.referral_opportunity_visible(opportunity.id)
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Referral opportunity unavailable' USING ERRCODE = '42501';
    END IF;
    IF p_expected_revision IS DISTINCT FROM v_opportunity.opportunity_revision THEN
      RAISE EXCEPTION 'Referral opportunity changed; reload before saving'
        USING ERRCODE = '40001';
    END IF;
    SELECT person.* INTO STRICT v_person
    FROM public.referral_people AS person
    WHERE person.id = v_existing_person_id
      AND person.organization_id = v_organization_id
      AND person.deleted_at IS NULL;
    v_first_name := v_person.first_name;
    v_last_name := v_person.last_name;
    v_preferred_name := v_person.preferred_name;
    v_date_of_birth := v_person.date_of_birth;
    v_person_id := v_person.id;
    v_opportunity_id := v_opportunity.id;

    SELECT consideration.id INTO v_consideration_id
    FROM public.referral_facility_considerations AS consideration
    WHERE consideration.organization_id = v_organization_id
      AND consideration.opportunity_id = v_opportunity_id
      AND consideration.facility_id = v_facility_id
      AND consideration.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      v_consideration_id := public.gen_random_uuid();
      INSERT INTO public.referral_facility_considerations (
        id, organization_id, opportunity_id, facility_id, created_by, updated_by
      ) VALUES (
        v_consideration_id, v_organization_id, v_opportunity_id,
        v_facility_id, v_actor_id, v_actor_id
      );
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.referral_leads AS existing_episode
      WHERE existing_episode.facility_consideration_id = v_consideration_id
        AND existing_episode.organization_id = v_organization_id
        AND existing_episode.deleted_at IS NULL
        AND existing_episode.status NOT IN ('converted', 'lost', 'merged')
    ) THEN
      RAISE EXCEPTION 'This facility consideration already has an open referral episode'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  SELECT COALESCE(MAX(lead.episode_sequence), 0) + 1
  INTO v_episode_sequence
  FROM public.referral_leads AS lead
  WHERE lead.facility_consideration_id = v_consideration_id;

  PERFORM haven.activate_referral_command(false);
  INSERT INTO public.referral_leads (
    id, organization_id, facility_id, facility_consideration_id,
    episode_sequence, referral_source_id, first_name, last_name,
    preferred_name, date_of_birth, phone, email, preferred_contact,
    notes, external_reference, inquiry_date, receipt_effective_at,
    receipt_precision, status,
    created_by, updated_by
  ) VALUES (
    v_episode_id, v_organization_id, v_facility_id, v_consideration_id,
    v_episode_sequence, v_referral_source_id, v_first_name, v_last_name,
    v_preferred_name, v_date_of_birth, v_phone, v_email, v_preferred_contact,
    v_notes, v_external_reference, v_inquiry_date, v_receipt_at, v_precision,
    'new', v_actor_id, v_actor_id
  ) RETURNING * INTO v_episode;
  IF v_existing_opportunity_id IS NOT NULL THEN
    UPDATE public.referral_opportunities
    SET opportunity_revision = haven.referral_revision(),
        updated_by = v_actor_id
    WHERE id = v_opportunity_id;
  END IF;
  v_before := v_episode;
  v_event := haven.write_referral_episode_event(
    v_before, v_episode, 'captured', p_request_key, v_request_hash,
    p_expected_revision, v_precision, v_receipt_at, v_inquiry_date,
    v_source_kind, v_source_reference,
    pg_catalog.jsonb_build_object(
      'person_id', v_person_id,
      'opportunity_id', v_opportunity_id,
      'facility_consideration_id', v_consideration_id,
      'episode_sequence', v_episode_sequence,
      'receipt_unknown', v_precision = 'unknown'
    )
  );
  PERFORM haven.deactivate_referral_command();
  RETURN haven.referral_episode_reply(v_episode, v_event, false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Versioned episode command. Every branch locks the stable episode, rechecks
-- current authority, refuses stale revisions, updates one projection, and
-- appends one immutable event. Interest never changes stage; waiting/review
-- never claims contact; close/reopen never deletes prior history.
-- ---------------------------------------------------------------------------

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
BEGIN
  CASE p_command
    WHEN 'assign' THEN
      v_allowed_keys := ARRAY['owner_user_id','backup_user_id','next_action','next_action_at','override_reason','source_kind','source_reference'];
    WHEN 'accept_coverage' THEN
      v_allowed_keys := ARRAY['coverage_reason','source_kind','source_reference'];
    WHEN 'record_interaction' THEN
      v_allowed_keys := ARRAY['summary','effective_precision','effective_at','effective_date','next_action','next_action_at','source_kind','source_reference'];
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
    v_contact_id := public.gen_random_uuid();
    v_relationship_id := public.gen_random_uuid();
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
    v_relationship_id := public.gen_random_uuid();
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
    v_correction_id := public.gen_random_uuid();

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
      v_person_id := public.gen_random_uuid();
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

CREATE OR REPLACE FUNCTION public.referral_episode_downstream_review(p_episode_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_episode public.referral_leads;
BEGIN
  IF NOT haven.referral_capability('duplicate_review') THEN
    RAISE EXCEPTION 'Reviewed referral identity authority required'
      USING ERRCODE = '42501';
  END IF;
  v_episode := haven.lock_referral_episode(p_episode_id);
  RETURN haven.referral_downstream_snapshot(v_episode.id);
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

CREATE OR REPLACE FUNCTION public.referral_episode_initial_revision()
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT haven.referral_empty_revision()
$function$;

-- Existing UI compatibility doors now enter the durable model. The richer
-- capture/command APIs own idempotency; these wrappers retain their established
-- signatures until COL-331 moves the staff UI onto explicit request keys.
CREATE OR REPLACE FUNCTION public.referral_lead_create(
  p_facility_id uuid,
  p_first_name text,
  p_last_name text,
  p_referral_source_id uuid,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_preferred_contact public.referral_lead_preferred_contact DEFAULT 'either',
  p_inquiry_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_reply jsonb;
BEGIN
  PERFORM haven.activate_referral_command(true);
  v_reply := public.referral_episode_capture(
    'compat-create:' || public.gen_random_uuid()::text,
    haven.referral_empty_revision(),
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'facility_id', p_facility_id,
      'first_name', p_first_name,
      'last_name', p_last_name,
      'referral_source_id', p_referral_source_id,
      'phone', p_phone,
      'email', p_email,
      'preferred_contact', p_preferred_contact,
      'receipt_precision', CASE WHEN p_inquiry_date IS NULL THEN 'unknown' ELSE 'date' END,
      'inquiry_date', p_inquiry_date,
      'source_kind', 'system_compatibility'
    ))
  );
  PERFORM haven.deactivate_referral_command();
  RETURN (v_reply ->> 'episode_id')::uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.referral_lead_update(
  p_lead_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_episode public.referral_leads;
  v_reply jsonb;
  v_allowed_keys text[] := ARRAY['status','tour_scheduled_for','tour_completed_at'];
BEGIN
  IF pg_catalog.jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
     OR p_patch = '{}'::jsonb
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) AS key
       WHERE NOT (key = ANY(v_allowed_keys))
     ) THEN
    RAISE EXCEPTION 'Unsupported referral update field' USING ERRCODE = '22023';
  END IF;
  v_episode := haven.lock_referral_episode(p_lead_id);
  IF p_expected_updated_at IS NULL
     OR v_episode.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Referral lead changed; reload before saving'
      USING ERRCODE = '40001';
  END IF;
  PERFORM haven.activate_referral_command(true);
  v_reply := public.referral_episode_command(
    p_lead_id,
    'compat-update:' || public.gen_random_uuid()::text,
    v_episode.episode_revision,
    'compatibility_update',
    p_patch || pg_catalog.jsonb_build_object('source_kind', 'system_compatibility')
  );
  PERFORM haven.deactivate_referral_command();
  SELECT lead.updated_at INTO STRICT p_expected_updated_at
  FROM public.referral_leads AS lead
  WHERE lead.id = (v_reply ->> 'episode_id')::uuid;
  RETURN p_expected_updated_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.referral_lead_create_from_hl7(p_inbound_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_inbound public.referral_hl7_inbound%ROWTYPE;
  v_reply jsonb;
  v_lead_id uuid;
  v_pid_line text;
  v_field_separator text;
  v_patient_name text;
  v_first_name text := 'HL7';
  v_last_name text := 'Referral';
BEGIN
  IF NOT haven.referral_capability('lead_write') THEN
    RAISE EXCEPTION 'Referral write authority required' USING ERRCODE = '42501';
  END IF;
  SELECT inbound.* INTO v_inbound
  FROM public.referral_hl7_inbound AS inbound
  WHERE inbound.id = p_inbound_id
    AND inbound.organization_id = haven.organization_id()
    AND inbound.deleted_at IS NULL
    AND inbound.status = 'processed'
    AND haven.has_facility_access(inbound.facility_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Processed HL7 referral is unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT haven.referral_capability('lead_write')
     OR NOT haven.has_facility_access(v_inbound.facility_id) THEN
    RAISE EXCEPTION 'Referral write authority changed' USING ERRCODE = '42501';
  END IF;
  IF v_inbound.linked_referral_lead_id IS NOT NULL THEN
    RETURN v_inbound.linked_referral_lead_id;
  END IF;

  SELECT pg_catalog.btrim(segment)
  INTO v_pid_line
  FROM pg_catalog.regexp_split_to_table(v_inbound.raw_message, E'\\r\\n|\\r|\\n') AS segment
  WHERE pg_catalog.left(pg_catalog.btrim(segment), 3) = 'PID'
  ORDER BY segment
  LIMIT 1;
  IF v_pid_line IS NOT NULL AND pg_catalog.length(v_pid_line) >= 4 THEN
    v_field_separator := pg_catalog.substr(v_pid_line, 4, 1);
    IF v_field_separator NOT IN (E'\r', E'\n', '') THEN
      v_patient_name := (pg_catalog.string_to_array(
        pg_catalog.substr(v_pid_line, 5), v_field_separator
      ))[5];
      IF NULLIF(pg_catalog.btrim(v_patient_name), '') IS NOT NULL THEN
        v_last_name := COALESCE(
          NULLIF(pg_catalog.btrim((pg_catalog.string_to_array(v_patient_name, '^'))[1]), ''),
          'Referral'
        );
        v_first_name := COALESCE(
          NULLIF(pg_catalog.btrim((pg_catalog.string_to_array(v_patient_name, '^'))[2]), ''),
          'HL7'
        );
      END IF;
    END IF;
  END IF;

  PERFORM haven.activate_referral_command(true);
  v_reply := public.referral_episode_capture(
    'hl7:' || v_inbound.id::text,
    haven.referral_empty_revision(),
    pg_catalog.jsonb_build_object(
      'facility_id', v_inbound.facility_id,
      'first_name', v_first_name,
      'last_name', v_last_name,
      'notes', pg_catalog.concat_ws(
        E'\n',
        'Created from processed HL7 inbound queue.',
        CASE WHEN v_inbound.message_control_id IS NOT NULL
          THEN 'Message control ID: ' || v_inbound.message_control_id END,
        CASE WHEN v_inbound.trigger_event IS NOT NULL
          THEN 'Trigger: ' || v_inbound.trigger_event END,
        'Inbound row: ' || v_inbound.id::text
      ),
      'external_reference', 'hl7:' || v_inbound.id::text,
      'receipt_precision', 'unknown',
      'source_kind', 'hl7',
      'source_reference', pg_catalog.jsonb_build_object(
        'table', 'referral_hl7_inbound',
        'id', v_inbound.id,
        'message_control_id', v_inbound.message_control_id
      )
    )
  );
  PERFORM haven.deactivate_referral_command();
  v_lead_id := (v_reply ->> 'episode_id')::uuid;
  UPDATE public.referral_hl7_inbound
  SET linked_referral_lead_id = v_lead_id,
      updated_by = haven.authorized_user_id()
  WHERE id = v_inbound.id;
  RETURN v_lead_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.referral_triage_submit(
  p_display_name text,
  p_source_channel text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_received_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT haven.referral_capability('triage_submit') THEN
    RAISE EXCEPTION 'Referral triage submission authority required' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_display_name), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_source_channel), '') IS NULL THEN
    RAISE EXCEPTION 'Display name and source channel are required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.referral_triage_inbox (
    organization_id, display_name, source_channel, phone, email, notes,
    received_at, received_precision, created_by
  ) VALUES (
    haven.organization_id(), pg_catalog.btrim(p_display_name),
    pg_catalog.btrim(p_source_channel), NULLIF(pg_catalog.btrim(p_phone), ''),
    NULLIF(pg_catalog.btrim(p_email), ''), NULLIF(pg_catalog.btrim(p_notes), ''),
    p_received_at,
    CASE WHEN p_received_at IS NULL THEN 'unknown'::public.referral_effective_precision
         ELSE 'instant'::public.referral_effective_precision END,
    haven.authorized_user_id()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Event/contact audit rows can contain sensitive values. Authorized readers use
-- the scoped event/correction policies, not the generic audit-log row image.
CREATE POLICY referral_model_audit_current
  ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated
  USING (table_name NOT IN (
    'referral_people', 'referral_opportunities',
    'referral_facility_considerations', 'referral_contacts',
    'referral_person_contacts', 'referral_contact_permissions',
    'referral_outcome_reason_drafts', 'referral_episode_events',
    'referral_identity_corrections'
  ));

CREATE OR REPLACE FUNCTION public.referral_episode_model_read(p_episode_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT haven.referral_capability('lead_read') THEN
    RAISE EXCEPTION 'Referral read authority required' USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.jsonb_build_object(
    'episode', pg_catalog.jsonb_build_object(
      'id', lead.id,
      'facility_id', lead.facility_id,
      'status', lead.status,
      'converted_resident_id', lead.converted_resident_id,
      'merged_into_lead_id', lead.merged_into_lead_id,
      'merged_at', lead.merged_at,
      'merged_by', lead.merged_by,
      'work_state', lead.work_state,
      'episode_sequence', lead.episode_sequence,
      'episode_revision', lead.episode_revision,
      'owner_user_id', lead.owner_user_id,
      'backup_user_id', lead.backup_user_id,
      'ownership_accepted_at', lead.ownership_accepted_at,
      'ownership_accepted_by', lead.ownership_accepted_by,
      'pending_owner_user_id', lead.pending_owner_user_id,
      'pending_backup_user_id', lead.pending_backup_user_id,
      'ownership_handoff_requested_at', lead.ownership_handoff_requested_at,
      'ownership_handoff_requested_by', lead.ownership_handoff_requested_by,
      'next_action', lead.next_action,
      'next_action_at', lead.next_action_at,
      'waiting_reason', lead.waiting_reason,
      'review_reason', lead.review_reason,
      'follow_up_at', lead.follow_up_at,
      'reopen_count', lead.reopen_count,
      'receipt_precision', lead.receipt_precision,
      'inquiry_date', lead.inquiry_date,
      'receipt_effective_at', lead.receipt_effective_at,
      'phone', CASE WHEN haven.referral_capability('contact_read')
                      AND lead.pii_access_tier <> 'public_summary' THEN lead.phone END,
      'email', CASE WHEN haven.referral_capability('contact_read')
                      AND lead.pii_access_tier <> 'public_summary' THEN lead.email END,
      'notes', CASE WHEN haven.referral_capability('clinical_read')
                      AND lead.pii_access_tier = 'clinical_precheck' THEN lead.notes END,
      'is_overdue', lead.work_state <> 'closed' AND COALESCE(
        lead.follow_up_at < pg_catalog.now(),
        lead.next_action_at < pg_catalog.now(),
        false
      )
    ),
    'person', pg_catalog.jsonb_build_object(
      'id', person.id,
      'first_name', person.first_name,
      'last_name', person.last_name,
      'preferred_name', person.preferred_name,
      'date_of_birth', CASE WHEN haven.referral_capability('clinical_read')
                              AND lead.pii_access_tier = 'clinical_precheck'
                            THEN person.date_of_birth END,
      'identity_revision', person.identity_revision
    ),
    'opportunity', pg_catalog.jsonb_build_object(
      'id', opportunity.id,
      'state', opportunity.state,
      'opened_at', opportunity.opened_at,
      'closed_at', opportunity.closed_at,
      'opportunity_revision', opportunity.opportunity_revision
    ),
    'facility_consideration', pg_catalog.jsonb_build_object(
      'id', consideration.id,
      'facility_id', consideration.facility_id,
      'interest_state', consideration.interest_state,
      'interest_recorded_at', consideration.interest_recorded_at,
      'interest_recorded_by', consideration.interest_recorded_by,
      'consideration_revision', consideration.consideration_revision
    ),
    'status_compatibility', (
      SELECT pg_catalog.to_jsonb(compatibility)
      FROM public.referral_status_compatibility AS compatibility
      WHERE compatibility.legacy_status = lead.status
    ),
    'contacts', CASE WHEN haven.referral_capability('contact_read')
      THEN COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'person_contact_id', relationship.id,
            'person_id', relationship.person_id,
            'originating_referral_lead_id', relationship.originating_referral_lead_id,
            'belongs_to_current_person', relationship.person_id = person.id,
            'contact_id', contact.id,
            'first_name', contact.first_name,
            'last_name', contact.last_name,
            'relationship', relationship.relationship,
            'is_primary', relationship.is_primary,
            'phone', contact.phone,
            'email', contact.email,
            'permissions', COALESCE((
              SELECT pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'channel', permission.channel,
                  'permission_state', permission.permission_state,
                  'evidence_note', permission.evidence_note,
                  'recorded_at', permission.recorded_at,
                  'recorded_by', permission.recorded_by,
                  'permission_revision', permission.permission_revision
                ) ORDER BY permission.channel
              )
              FROM public.referral_contact_permissions AS permission
              WHERE permission.person_contact_id = relationship.id
                AND permission.organization_id = lead.organization_id
            ), '[]'::jsonb)
          ) ORDER BY relationship.is_primary DESC, relationship.created_at, relationship.id
        )
        FROM public.referral_person_contacts AS relationship
        JOIN public.referral_contacts AS contact ON contact.id = relationship.contact_id
        WHERE relationship.organization_id = lead.organization_id
          AND (
            relationship.person_id = person.id
            OR relationship.originating_referral_lead_id = lead.id
          )
          AND relationship.deleted_at IS NULL
          AND contact.organization_id = lead.organization_id
          AND contact.deleted_at IS NULL
      ), '[]'::jsonb)
      ELSE '[]'::jsonb END
  ) INTO v_result
  FROM public.referral_leads AS lead
  JOIN public.referral_facility_considerations AS consideration
    ON consideration.id = lead.facility_consideration_id
   AND consideration.organization_id = lead.organization_id
   AND consideration.facility_id = lead.facility_id
   AND consideration.deleted_at IS NULL
  JOIN public.referral_opportunities AS opportunity
    ON opportunity.id = consideration.opportunity_id
   AND opportunity.organization_id = lead.organization_id
   AND opportunity.deleted_at IS NULL
  JOIN public.referral_people AS person
    ON person.id = opportunity.person_id
   AND person.organization_id = lead.organization_id
   AND person.deleted_at IS NULL
  WHERE lead.id = p_episode_id
    AND lead.organization_id = haven.organization_id()
    AND lead.deleted_at IS NULL
    AND haven.has_facility_access(lead.facility_id);
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Referral episode unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.referral_episode_capture(text,text,jsonb),
  public.referral_episode_command(uuid,text,text,text,jsonb),
  public.referral_episode_downstream_review(uuid),
  public.referral_episode_history_read(uuid,integer,integer),
  public.referral_episode_model_read(uuid),
  public.referral_episode_initial_revision()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.referral_episode_capture(text,text,jsonb),
  public.referral_episode_command(uuid,text,text,text,jsonb),
  public.referral_episode_downstream_review(uuid),
  public.referral_episode_history_read(uuid,integer,integer),
  public.referral_episode_model_read(uuid),
  public.referral_episode_initial_revision()
  TO authenticated;

-- Reassert compatibility grants after replacing the existing functions.
REVOKE ALL ON FUNCTION public.referral_lead_create(
  uuid,text,text,uuid,text,text,public.referral_lead_preferred_contact,date
), public.referral_lead_update(uuid,timestamptz,jsonb),
  public.referral_lead_create_from_hl7(uuid),
  public.referral_triage_submit(text,text,text,text,text,timestamptz)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.referral_lead_create(
  uuid,text,text,uuid,text,text,public.referral_lead_preferred_contact,date
), public.referral_lead_update(uuid,timestamptz,jsonb),
  public.referral_lead_create_from_hl7(uuid),
  public.referral_triage_submit(text,text,text,text,text,timestamptz)
  TO authenticated;

-- Existing direct compatibility reads gain only the new non-sensitive workflow
-- projection columns. People, contacts, permissions, events, and corrections
-- remain behind their own current-authority boundaries.
GRANT SELECT (
  facility_consideration_id, episode_sequence, receipt_effective_at,
  receipt_precision, owner_user_id, backup_user_id,
  ownership_accepted_at, ownership_accepted_by, pending_owner_user_id,
  pending_backup_user_id, ownership_handoff_requested_at,
  ownership_handoff_requested_by, work_state, next_action,
  next_action_at, waiting_reason, review_reason, follow_up_at,
  status_before_close, reopen_count, episode_revision
) ON public.referral_leads TO authenticated;

COMMENT ON COLUMN public.referral_leads.inquiry_date IS
  'Source-effective referral receipt date when receipt_precision=date; unknown remains null.';
COMMENT ON COLUMN public.referral_leads.episode_revision IS
  'Opaque version required by idempotent referral episode commands.';
COMMENT ON COLUMN public.referral_leads.owner_user_id IS
  'Current case owner, distinct from tour owner and source relationship owner.';
COMMENT ON COLUMN public.referral_leads.follow_up_at IS
  'Required review time while waiting/review; overdue is evaluated at read time.';

COMMIT;
