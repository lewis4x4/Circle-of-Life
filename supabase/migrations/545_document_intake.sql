-- COL-771 / COL-834..838 (DI-01, DI-02, DI-04, DI-05): Haven Document Intake.
--
-- Brian, 2026-09-25: Document Intake is launch-critical and starts at Homewood
-- only on 2026-10-01. Reviewed plan: Linear document "Haven Document Intake -
-- reviewed launch plan and acceptance tests"; spec docs/specs/41-document-intake.md.
--
-- Received document -> preserved original -> authorized reader + Jev proposal
-- -> Pending review -> a person approves or changes the filing -> filed record
-- with history. Every filing needs a human approval (v1). Nothing here writes
-- a clinical fact, a payment, a training completion or a Medicaid deadline.
--
-- Shape:
--   document_intake_catalog        what each document type is and where it files (config rows)
--   document_intake_items          one received document (original bytes, custody, review state)
--   document_intake_runs           one processing attempt (reader or Jev), leased and fenced
--   document_intake_proposals      immutable proposal generations written by the worker
--   document_intake_filings        filing receipts (two phase: prepare -> attest -> complete)
--   document_intake_events         append-only history
--   document_intake_reviewers      named primary / backup per facility
--   document_intake_mailboxes / _messages / _sender_routes   email receipt and manifest
--   document_intake_requests       idempotency ledger for every user command
--
-- Principals: people act through the authenticated RPCs below; the background
-- worker and mail receiver act only through document_intake_worker_* functions,
-- which are granted to service_role alone and can never approve a filing
-- (filing requires haven.authorized_user_id() to be a reviewer).
BEGIN;

-- ── Configuration ───────────────────────────────────────────────────────────

CREATE TABLE public.document_intake_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  claim_minutes integer NOT NULL DEFAULT 20 CHECK (claim_minutes BETWEEN 1 AND 480),
  pending_alert_hours integer NOT NULL DEFAULT 24 CHECK (pending_alert_hours BETWEEN 1 AND 720),
  max_source_bytes integer NOT NULL DEFAULT 20971520 CHECK (max_source_bytes BETWEEN 1048576 AND 20971520),
  upload_roles text[] NOT NULL DEFAULT ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator'],
  review_roles text[] NOT NULL DEFAULT ARRAY['owner','org_admin','facility_admin','manager','admin_assistant'],
  custodian_roles text[] NOT NULL DEFAULT ARRAY['owner','org_admin'],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.user_profiles(id)
);

CREATE TABLE public.document_intake_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  document_group text NOT NULL CHECK (document_group IN ('resident','medicaid','staff','facility','vendor','other')),
  destination_kind text NOT NULL CHECK (destination_kind IN ('resident_document','benefits_document','employee_file','facility_document','none')),
  -- resident_documents.document_type, facility_documents.document_category,
  -- employee_file_requirements.code, benefits_documents.document_type.
  destination_category text,
  subject_kind text NOT NULL CHECK (subject_kind IN ('resident','staff','facility','medicaid_case','none')),
  contains_phi boolean NOT NULL DEFAULT true,
  reviewer_roles text[] NOT NULL DEFAULT ARRAY['owner','org_admin','facility_admin','manager','admin_assistant'],
  reader_enabled boolean NOT NULL DEFAULT true,
  jev_enabled boolean NOT NULL DEFAULT true,
  -- Plain-language hints the reader sees for this type. Never business rules.
  reader_hint text NOT NULL DEFAULT '' CHECK (length(reader_hint) <= 1000),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.user_profiles(id),
  UNIQUE (organization_id, code),
  CHECK ((destination_kind = 'none') = (subject_kind = 'none')),
  CHECK (destination_kind = 'none' OR destination_category IS NOT NULL),
  CHECK (destination_kind <> 'resident_document' OR subject_kind = 'resident'),
  CHECK (destination_kind <> 'benefits_document' OR subject_kind = 'medicaid_case'),
  CHECK (destination_kind <> 'employee_file' OR subject_kind = 'staff'),
  CHECK (destination_kind <> 'facility_document' OR subject_kind = 'facility')
);

CREATE TABLE public.document_intake_reviewers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid REFERENCES public.facilities(id),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  coverage text NOT NULL CHECK (coverage IN ('primary','backup','custodian')),
  effective_from date NOT NULL DEFAULT current_date,
  revoked_at timestamptz,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coverage = 'custodian' OR facility_id IS NOT NULL)
);
CREATE UNIQUE INDEX idx_document_intake_reviewers_active
  ON public.document_intake_reviewers (organization_id, coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid), user_id, coverage)
  WHERE revoked_at IS NULL;

-- ── Email receipt ───────────────────────────────────────────────────────────

CREATE TABLE public.document_intake_mailboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  address text NOT NULL CHECK (address ~* '^[^@\s]+@[^@\s]+$'),
  provider text NOT NULL DEFAULT 'microsoft_graph' CHECK (provider IN ('microsoft_graph')),
  folders text[] NOT NULL DEFAULT ARRAY['inbox'],
  -- Per-folder delta links. Advanced only after every enumerated message has a
  -- stored receipt or a recorded exception (worker_advance_mailbox_cursor).
  cursors jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT false,
  last_sync_started_at timestamptz,
  last_sync_succeeded_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, address)
);

CREATE TABLE public.document_intake_sender_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  sender_address text NOT NULL CHECK (sender_address = lower(sender_address) AND sender_address ~ '^[^@\s]+@[^@\s]+$'),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  sender_kind text NOT NULL CHECK (sender_kind IN ('facility_copier','facility_staff','home_office','vendor','agency','other')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  effective_from date NOT NULL DEFAULT current_date,
  revoked_at timestamptz,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_document_intake_sender_routes_active
  ON public.document_intake_sender_routes (organization_id, sender_address) WHERE revoked_at IS NULL;

CREATE TABLE public.document_intake_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  mailbox_id uuid NOT NULL REFERENCES public.document_intake_mailboxes(id),
  folder text NOT NULL,
  provider_message_id text NOT NULL CHECK (length(provider_message_id) BETWEEN 1 AND 512),
  internet_message_id text CHECK (length(internet_message_id) <= 998),
  sender_address text CHECK (length(sender_address) <= 320),
  sender_authenticated boolean NOT NULL DEFAULT false,
  authentication_results text CHECK (length(authentication_results) <= 8000),
  subject_hash text CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  received_at timestamptz,
  raw_path text,
  raw_sha256 text CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
  raw_size_bytes integer CHECK (raw_size_bytes >= 0),
  part_count integer NOT NULL DEFAULT 0 CHECK (part_count >= 0),
  status text NOT NULL DEFAULT 'stored' CHECK (status IN ('stored','itemized','no_documents','exception')),
  exception_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mailbox_id, provider_message_id)
);

-- ── Items, runs, proposals, filings, history ────────────────────────────────

CREATE TABLE public.document_intake_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  -- NULL = facility unknown (unmapped sender). Only custodians can see it.
  facility_id uuid REFERENCES public.facilities(id),
  channel text NOT NULL CHECK (channel IN ('upload','email','split')),
  message_id uuid REFERENCES public.document_intake_messages(id),
  parent_item_id uuid REFERENCES public.document_intake_items(id),
  parent_pages integer[],
  original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  display_title text CHECK (length(display_title) <= 200),
  declared_mime text NOT NULL,
  declared_size_bytes integer NOT NULL CHECK (declared_size_bytes >= 1),
  declared_sha256 text NOT NULL CHECK (declared_sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text NOT NULL UNIQUE,
  object_id uuid,
  verified_mime text,
  verified_sha256 text CHECK (verified_sha256 ~ '^[a-f0-9]{64}$'),
  page_count integer CHECK (page_count >= 0),
  status text NOT NULL DEFAULT 'receiving' CHECK (status IN (
    'receiving','queued','processing','pending_review','held','needs_attention',
    'filed','excluded','duplicate','split')),
  processing_state text NOT NULL DEFAULT 'not_started' CHECK (processing_state IN (
    'not_started','queued','running','succeeded','blocked','failed','uncertain','skipped')),
  processing_reason text CHECK (length(processing_reason) <= 200),
  attention_reason text CHECK (length(attention_reason) <= 500),
  hold_reason text CHECK (length(hold_reason) <= 2000),
  exclude_reason text CHECK (length(exclude_reason) <= 2000),
  duplicate_of uuid REFERENCES public.document_intake_items(id),
  assigned_to uuid REFERENCES public.user_profiles(id),
  claimed_by uuid REFERENCES public.user_profiles(id),
  claim_expires_at timestamptz,
  current_proposal_id uuid,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_address text CHECK (length(sender_address) <= 320),
  sender_authenticated boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  created_principal text NOT NULL CHECK (created_principal IN ('person','mail_receiver','split')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (channel <> 'split' OR (parent_item_id IS NOT NULL AND parent_pages IS NOT NULL)),
  CHECK (channel <> 'email' OR message_id IS NOT NULL),
  CHECK (status <> 'duplicate' OR duplicate_of IS NOT NULL),
  CHECK (status <> 'excluded' OR length(btrim(coalesce(exclude_reason,''))) > 0),
  CHECK (status <> 'held' OR length(btrim(coalesce(hold_reason,''))) > 0)
);
CREATE INDEX idx_document_intake_items_queue ON public.document_intake_items (organization_id, facility_id, status, received_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_document_intake_items_sha ON public.document_intake_items (organization_id, declared_sha256) WHERE deleted_at IS NULL;
CREATE INDEX idx_document_intake_items_parent ON public.document_intake_items (parent_item_id) WHERE parent_item_id IS NOT NULL;
CREATE INDEX idx_document_intake_items_message ON public.document_intake_items (message_id) WHERE message_id IS NOT NULL;

CREATE TABLE public.document_intake_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  item_id uuid NOT NULL REFERENCES public.document_intake_items(id),
  generation integer NOT NULL CHECK (generation >= 1),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','claimed','dispatched','succeeded','blocked','failed','uncertain','superseded')),
  -- Lease/fence: a stale worker cannot publish after another claims the run.
  fence uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  -- Durable dispatch intent: recorded BEFORE any paid provider call. A run that
  -- expires while dispatched becomes 'uncertain' and is never re-sent silently.
  dispatch_stage text CHECK (dispatch_stage IN ('reader','jev')),
  dispatch_key uuid,
  dispatched_at timestamptz,
  reader_provider text,
  reader_model text,
  jev_model text,
  policy_snapshot jsonb,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome_code text CHECK (length(outcome_code) <= 120),
  requested_by uuid REFERENCES public.user_profiles(id),
  accept_uncertain_retry boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (item_id, generation)
);
CREATE INDEX idx_document_intake_runs_queue ON public.document_intake_runs (state, created_at) WHERE state IN ('queued','claimed','dispatched');

CREATE TABLE public.document_intake_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  item_id uuid NOT NULL REFERENCES public.document_intake_items(id),
  run_id uuid NOT NULL REFERENCES public.document_intake_runs(id),
  generation integer NOT NULL,
  suggested_title text CHECK (length(suggested_title) <= 200),
  summary text CHECK (length(summary) <= 600),
  summary_pages integer[],
  document_date date,
  catalog_code text,
  -- [{kind, subject_id, label, facility_id, case_id, requirement_id, reason}] plus the explicit none option
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(candidates) = 'array'),
  proposed_candidate integer,
  -- Page segmentation proposed by the reader: [{pages:[..], catalog_code, title}]
  segments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(segments) = 'array'),
  reader jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Jev output as returned: question version, model, per-question answers with probabilities.
  jev jsonb NOT NULL DEFAULT '{}'::jsonb,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checks) = 'array'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  stage_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, generation)
);
ALTER TABLE public.document_intake_items
  ADD CONSTRAINT document_intake_items_current_proposal_fkey
  FOREIGN KEY (current_proposal_id) REFERENCES public.document_intake_proposals(id);

CREATE TABLE public.document_intake_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  item_id uuid NOT NULL REFERENCES public.document_intake_items(id),
  proposal_id uuid REFERENCES public.document_intake_proposals(id),
  request_key uuid NOT NULL,
  catalog_code text NOT NULL,
  destination_kind text NOT NULL CHECK (destination_kind IN ('resident_document','benefits_document','employee_file','facility_document')),
  destination_category text NOT NULL,
  subject_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  document_date date,
  expiration_date date,
  target_bucket text NOT NULL,
  target_path text NOT NULL UNIQUE,
  target_object_id uuid,
  target_sha256 text CHECK (target_sha256 ~ '^[a-f0-9]{64}$'),
  destination_record_id uuid,
  state text NOT NULL DEFAULT 'preparing' CHECK (state IN ('preparing','attested','filed','abandoned','corrected')),
  reviewer_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by uuid NOT NULL REFERENCES public.user_profiles(id),
  approved_at timestamptz,
  expected_item_revision uuid NOT NULL,
  corrected_by uuid REFERENCES public.user_profiles(id),
  corrected_at timestamptz,
  correction_reason text CHECK (length(correction_reason) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, request_key),
  CHECK (state <> 'filed' OR (destination_record_id IS NOT NULL AND approved_at IS NOT NULL AND target_sha256 IS NOT NULL)),
  CHECK (state <> 'corrected' OR (corrected_by IS NOT NULL AND length(btrim(coalesce(correction_reason,''))) > 0))
);
-- One live filing per item: a second concurrent approval gets an explicit conflict.
CREATE UNIQUE INDEX idx_document_intake_filings_one_live ON public.document_intake_filings (item_id) WHERE state IN ('preparing','attested','filed');

CREATE TABLE public.document_intake_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  item_id uuid NOT NULL REFERENCES public.document_intake_items(id),
  event text NOT NULL CHECK (length(event) BETWEEN 1 AND 80),
  actor_id uuid REFERENCES public.user_profiles(id),
  principal text NOT NULL CHECK (principal IN ('person','mail_receiver','worker','system')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_document_intake_events_item ON public.document_intake_events (item_id, created_at);

CREATE TABLE public.document_intake_requests (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  request_key uuid NOT NULL,
  actor_id uuid NOT NULL,
  command text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, request_key)
);

-- Append-only guards.
CREATE FUNCTION haven.document_intake_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;
CREATE TRIGGER document_intake_events_append_only BEFORE UPDATE OR DELETE ON public.document_intake_events
  FOR EACH ROW EXECUTE FUNCTION haven.document_intake_append_only();
CREATE TRIGGER document_intake_proposals_append_only BEFORE UPDATE OR DELETE ON public.document_intake_proposals
  FOR EACH ROW EXECUTE FUNCTION haven.document_intake_append_only();
CREATE TRIGGER document_intake_requests_append_only BEFORE UPDATE OR DELETE ON public.document_intake_requests
  FOR EACH ROW EXECUTE FUNCTION haven.document_intake_append_only();

-- Original bytes are immutable once attested.
CREATE FUNCTION haven.document_intake_item_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Document intake items are never deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.verified_sha256 IS NOT NULL AND (
       NEW.storage_path IS DISTINCT FROM OLD.storage_path
    OR NEW.declared_sha256 IS DISTINCT FROM OLD.declared_sha256
    OR NEW.verified_sha256 IS DISTINCT FROM OLD.verified_sha256
    OR NEW.object_id IS DISTINCT FROM OLD.object_id
    OR NEW.declared_size_bytes IS DISTINCT FROM OLD.declared_size_bytes
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.parent_item_id IS DISTINCT FROM OLD.parent_item_id
    OR NEW.parent_pages IS DISTINCT FROM OLD.parent_pages) THEN
    RAISE EXCEPTION 'Document intake source is immutable' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER document_intake_items_guard BEFORE UPDATE OR DELETE ON public.document_intake_items
  FOR EACH ROW EXECUTE FUNCTION haven.document_intake_item_guard();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['document_intake_settings','document_intake_catalog','document_intake_reviewers',
    'document_intake_mailboxes','document_intake_sender_routes','document_intake_messages','document_intake_items',
    'document_intake_runs','document_intake_proposals','document_intake_filings','document_intake_events',
    'document_intake_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ── Storage: private bucket, no direct client access ───────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('document-intake', 'document-intake', false, 26214400,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif','image/tiff','message/rfc822'])
ON CONFLICT (id) DO NOTHING;
-- Restrictive: no browser can read or write intake objects directly. Uploads go
-- through server-issued signed upload URLs for one prepared path; reads go
-- through the authorized server route.
CREATE POLICY document_intake_no_direct_objects ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'document-intake') WITH CHECK (bucket_id <> 'document-intake');

-- ── Actor and scope helpers ─────────────────────────────────────────────────

CREATE FUNCTION haven.document_intake_settings_for(p_org uuid) RETURNS public.document_intake_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT s FROM public.document_intake_settings s WHERE s.organization_id = p_org),
    ROW(p_org, 20, 24, 20971520,
      ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator'],
      ARRAY['owner','org_admin','facility_admin','manager','admin_assistant'],
      ARRAY['owner','org_admin'], now(), NULL)::public.document_intake_settings);
$$;

-- Returns id, organization, role for a managed, active person; raises otherwise.
CREATE FUNCTION haven.document_intake_actor() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM haven.current_authorized_actor();
  IF a.actor_user_id IS NULL OR NOT a.actor_is_managed OR a.actor_organization_id IS NULL
     OR EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = a.actor_user_id
                AND coalesce(p.settings->>'must_change_password','false') <> 'false') THEN
    RAISE EXCEPTION 'Document intake actor unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('id', a.actor_user_id, 'org', a.actor_organization_id, 'role', a.actor_role_text);
END $$;

CREATE FUNCTION haven.document_intake_has_role(p_role text, p_roles text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT p_role = ANY (p_roles) $$;

-- Can the current person see items for this facility (NULL = unknown facility)?
CREATE FUNCTION haven.document_intake_can_view(p_org uuid, p_facility uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; s public.document_intake_settings;
BEGIN
  SELECT * INTO a FROM haven.current_authorized_actor();
  IF a.actor_user_id IS NULL OR NOT a.actor_is_managed OR a.actor_organization_id IS DISTINCT FROM p_org THEN RETURN false; END IF;
  s := haven.document_intake_settings_for(p_org);
  IF p_facility IS NULL THEN RETURN a.actor_role_text = ANY (s.custodian_roles); END IF;
  RETURN (a.actor_role_text = ANY (s.review_roles) OR a.actor_role_text = ANY (s.custodian_roles))
     AND haven.has_facility_access(p_facility);
END $$;

-- Can the current person upload for this facility?
CREATE FUNCTION haven.document_intake_can_upload(p_org uuid, p_facility uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; s public.document_intake_settings;
BEGIN
  SELECT * INTO a FROM haven.current_authorized_actor();
  IF a.actor_user_id IS NULL OR NOT a.actor_is_managed OR a.actor_organization_id IS DISTINCT FROM p_org OR p_facility IS NULL THEN RETURN false; END IF;
  s := haven.document_intake_settings_for(p_org);
  RETURN a.actor_role_text = ANY (s.upload_roles) AND haven.has_facility_access(p_facility);
END $$;

-- A split parent (mixed packet) stays with custodians only once split.
CREATE FUNCTION haven.document_intake_item_visible(i public.document_intake_items) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; s public.document_intake_settings;
BEGIN
  IF i.deleted_at IS NOT NULL THEN RETURN false; END IF;
  IF i.status = 'split' THEN
    SELECT * INTO a FROM haven.current_authorized_actor();
    s := haven.document_intake_settings_for(i.organization_id);
    RETURN a.actor_user_id IS NOT NULL AND a.actor_is_managed AND a.actor_organization_id = i.organization_id
      AND a.actor_role_text = ANY (s.custodian_roles);
  END IF;
  RETURN haven.document_intake_can_view(i.organization_id, i.facility_id);
END $$;

CREATE FUNCTION haven.document_intake_item_visible_id(p_item uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT haven.document_intake_item_visible(i) FROM public.document_intake_items i WHERE i.id = p_item), false);
$$;

-- ── Read policies (proposals, titles, summaries share the item's scope) ────

CREATE POLICY "Intake reviewers see items in scope" ON public.document_intake_items
  FOR SELECT TO authenticated USING (organization_id = (SELECT haven.organization_id()) AND haven.document_intake_item_visible(document_intake_items));
CREATE POLICY "Intake reviewers see proposals in scope" ON public.document_intake_proposals
  FOR SELECT TO authenticated USING (organization_id = (SELECT haven.organization_id()) AND haven.document_intake_item_visible_id(item_id));
CREATE POLICY "Intake reviewers see runs in scope" ON public.document_intake_runs
  FOR SELECT TO authenticated USING (organization_id = (SELECT haven.organization_id()) AND haven.document_intake_item_visible_id(item_id));
CREATE POLICY "Intake reviewers see filings in scope" ON public.document_intake_filings
  FOR SELECT TO authenticated USING (organization_id = (SELECT haven.organization_id()) AND haven.document_intake_item_visible_id(item_id));
CREATE POLICY "Intake reviewers see history in scope" ON public.document_intake_events
  FOR SELECT TO authenticated USING (organization_id = (SELECT haven.organization_id()) AND haven.document_intake_item_visible_id(item_id));
CREATE POLICY "Staff see their organization's intake catalog" ON public.document_intake_catalog
  FOR SELECT TO authenticated USING (organization_id = (SELECT haven.organization_id()));
CREATE POLICY "Staff see their organization's intake settings" ON public.document_intake_settings
  FOR SELECT TO authenticated USING (organization_id = (SELECT haven.organization_id()));
CREATE POLICY "Intake reviewers see reviewer coverage" ON public.document_intake_reviewers
  FOR SELECT TO authenticated USING (organization_id = (SELECT haven.organization_id()) AND haven.document_intake_can_view(organization_id, facility_id));
CREATE POLICY "Custodians see mailboxes" ON public.document_intake_mailboxes
  FOR SELECT TO authenticated USING (organization_id = (SELECT haven.organization_id()) AND haven.document_intake_can_view(organization_id, NULL));
CREATE POLICY "Custodians see sender routes" ON public.document_intake_sender_routes
  FOR SELECT TO authenticated USING (organization_id = (SELECT haven.organization_id()) AND haven.document_intake_can_view(organization_id, NULL));
CREATE POLICY "Custodians see message manifest" ON public.document_intake_messages
  FOR SELECT TO authenticated USING (organization_id = (SELECT haven.organization_id()) AND haven.document_intake_can_view(organization_id, NULL));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['document_intake_settings','document_intake_catalog','document_intake_reviewers',
    'document_intake_mailboxes','document_intake_sender_routes','document_intake_messages','document_intake_items',
    'document_intake_runs','document_intake_proposals','document_intake_filings','document_intake_events'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ── Catalog seed (DI-01): every type maps to an existing canonical record ──

CREATE FUNCTION haven.document_intake_seed_catalog(p_org uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.document_intake_catalog
    (organization_id, code, label, document_group, destination_kind, destination_category, subject_kind, contains_phi, reviewer_roles, jev_enabled, reader_hint, sort_order)
  SELECT p_org, v.code, v.label, v.grp, v.kind, v.cat, v.subj, v.phi, v.roles, v.jev, v.hint, v.sort
  FROM (VALUES
    -- Resident record (resident_documents.document_type; allowed list from haven.resident_record_document_type_allowed)
    ('form_1823','AHCA Form 1823 (physician''s report)','resident','resident_document','form_1823','resident',true,ARRAY['owner','org_admin','facility_admin','manager'],true,'Florida AHCA Form 1823 Resident Health Assessment completed by a physician or APRN.',10),
    ('face_sheet','Face sheet / demographics','resident','resident_document','demographics_face_sheet','resident',true,ARRAY['owner','org_admin','facility_admin','manager','admin_assistant'],true,'Resident face sheet: name, date of birth, contacts, payer.',11),
    ('physician_orders','Physician orders / medication list','resident','resident_document','physician_orders_medication_list','resident',true,ARRAY['owner','org_admin','facility_admin','manager'],true,'Signed physician orders or a medication list for one resident.',12),
    ('advance_directive','Advance directive / DNR','resident','resident_document','advance_directive','resident',true,ARRAY['owner','org_admin','facility_admin','manager'],true,'Living will, DNRO (Florida yellow form), health care surrogate designation.',13),
    ('authority_instrument','Power of attorney / guardianship','resident','resident_document','authority_instrument','resident',true,ARRAY['owner','org_admin','facility_admin','manager'],true,'Durable power of attorney, guardianship letters, representative payee papers.',14),
    ('insurance_card','Insurance / Medicare / Medicaid card','resident','resident_document','insurance_card','resident',true,ARRAY['owner','org_admin','facility_admin','manager','admin_assistant'],true,'Photo or scan of an insurance, Medicare or Medicaid card.',15),
    ('photo_id','Photo identification','resident','resident_document','photo_identification','resident',true,ARRAY['owner','org_admin','facility_admin','manager','admin_assistant'],true,'Driver license or state ID of a resident.',16),
    ('admission_agreement','Admission / residency agreement','resident','resident_document','admission_agreement','resident',true,ARRAY['owner','org_admin','facility_admin','manager'],true,'Signed admission or residency contract.',17),
    ('financial_agreement','Financial agreement','resident','resident_document','financial_agreement','resident',true,ARRAY['owner','org_admin','facility_admin','manager'],true,'Resident financial responsibility agreement.',18),
    ('tb_screening','TB screening','resident','resident_document','tb_screening','resident',true,ARRAY['owner','org_admin','facility_admin','manager'],true,'Tuberculosis test or chest x-ray result for a resident.',19),
    ('resident_consent','Resident consent / acknowledgment','resident','resident_document','resident_rights','resident',true,ARRAY['owner','org_admin','facility_admin','manager','admin_assistant'],true,'Resident rights, HIPAA, photo release and similar signed acknowledgments.',20),
    ('resident_other','Other resident document','resident','resident_document','other_resident_evidence','resident',true,ARRAY['owner','org_admin','facility_admin','manager'],true,'Any other document about one resident (hospital discharge papers, lab results, correspondence).',29),
    -- Medicaid case (benefits_documents)
    ('medicaid_letter','Medicaid / DCF / agency letter','medicaid','benefits_document','agency_letter','medicaid_case',true,ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator'],true,'Letter from DCF, AHCA, the Area Agency on Aging, SSA or a Medicaid plan about one resident''s benefits.',30),
    ('medicaid_application_doc','Medicaid application document','medicaid','benefits_document','application_document','medicaid_case',true,ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator'],true,'Bank statement, income proof, 701B/3008 or other document gathered for a Medicaid application.',31),
    -- Staff file (employee_file_records; destination_category = requirement category match)
    ('staff_certification','Staff certification / license','staff','employee_file','training','staff',true,ARRAY['owner','org_admin','facility_admin','manager'],true,'CPR, first aid, CNA license, med tech certificate, ALF core training certificate for one employee.',40),
    ('staff_training','Staff training record','staff','employee_file','training','staff',true,ARRAY['owner','org_admin','facility_admin','manager'],true,'Training sign-in sheet or certificate for one employee.',41),
    ('staff_personnel','Staff personnel document','staff','employee_file','application','staff',true,ARRAY['owner','org_admin','facility_admin','manager'],true,'Application, I-9 support, background screening result, reference or other personnel paper for one employee.',42),
    ('staff_medical','Staff health record','staff','employee_file','medical','staff',true,ARRAY['owner','org_admin','facility_admin'],true,'Employee TB test, physical or other health record.',43),
    -- Facility vault (facility_documents.document_category)
    ('facility_license','License / permit','facility','facility_document','ahca_licensing','facility',false,ARRAY['owner','org_admin','facility_admin'],true,'AHCA license, food service license, business permits.',50),
    ('facility_inspection','Inspection report','facility','facility_document','health_department_inspections','facility',false,ARRAY['owner','org_admin','facility_admin'],true,'Health department, fire marshal, elevator or sprinkler inspection report.',51),
    ('facility_fire','Fire inspection','facility','facility_document','fire_inspections','facility',false,ARRAY['owner','org_admin','facility_admin'],true,'Fire inspection or fire alarm inspection report.',52),
    ('facility_generator','Generator service record','facility','facility_document','generator_service_records','facility',false,ARRAY['owner','org_admin','facility_admin','manager'],true,'Generator vendor service or load test record.',53),
    ('facility_pest','Pest control record','facility','facility_document','pest_control_records','facility',false,ARRAY['owner','org_admin','facility_admin','manager'],true,'Pest control service ticket.',54),
    ('facility_survey','Survey report / plan of correction','facility','facility_document','survey_reports_poc','facility',true,ARRAY['owner','org_admin','facility_admin'],true,'AHCA survey statement of deficiencies or plan of correction.',55),
    ('facility_insurance','Facility insurance document','facility','facility_document','insurance_general_liability','facility',false,ARRAY['owner','org_admin'],true,'Certificate or declarations page for facility liability or property insurance.',56),
    ('vendor_coi','Vendor certificate of insurance','vendor','facility_document','vendor_coi','facility',false,ARRAY['owner','org_admin','facility_admin'],true,'Certificate of insurance from a vendor or contractor.',60),
    ('vendor_contract','Vendor contract / agreement','vendor','facility_document','vendor_contracts','facility',false,ARRAY['owner','org_admin','facility_admin'],true,'Service agreement, contract or W-9 from a vendor.',61),
    ('facility_other','Other facility document','facility','facility_document','other_misc','facility',false,ARRAY['owner','org_admin','facility_admin'],true,'Any other facility operating document.',69),
    -- No automatic destination in v1: stays an owned intake exception.
    ('payment_evidence','Check / deposit / payment evidence','other','none',NULL,'none',true,ARRAY['owner','org_admin','facility_admin'],false,'Checks, money orders, deposit slips. No AI on check images; record the payment on the Home page.',90),
    ('unknown','Not sure yet','other','none',NULL,'none',true,ARRAY['owner','org_admin','facility_admin','manager','admin_assistant'],true,'Anything that does not fit another type.',99)
  ) AS v(code, label, grp, kind, cat, subj, phi, roles, jev, hint, sort)
  ON CONFLICT (organization_id, code) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- Payment evidence never goes to a reader (bank account numbers on the MICR line).
  UPDATE public.document_intake_catalog SET reader_enabled = false
   WHERE organization_id = p_org AND code = 'payment_evidence' AND reader_enabled;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION haven.document_intake_seed_catalog(uuid) FROM PUBLIC, anon, authenticated;

INSERT INTO public.document_intake_settings (organization_id)
SELECT o.id FROM public.organizations o WHERE o.deleted_at IS NULL
ON CONFLICT (organization_id) DO NOTHING;
SELECT haven.document_intake_seed_catalog(o.id) FROM public.organizations o WHERE o.deleted_at IS NULL;

-- ── Internal helpers ────────────────────────────────────────────────────────

CREATE FUNCTION haven.document_intake_event(p_item public.document_intake_items, p_event text, p_actor uuid, p_principal text, p_detail jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.document_intake_events (organization_id, item_id, event, actor_id, principal, detail)
  VALUES (p_item.organization_id, p_item.id, p_event, p_actor, p_principal, coalesce(p_detail, '{}'::jsonb));
$$;

CREATE FUNCTION haven.document_intake_item_json(i public.document_intake_items) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_jsonb(i) - 'storage_path' - 'object_id';
$$;

CREATE FUNCTION haven.document_intake_allowed_mime(p_mime text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_mime = ANY (ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif','image/tiff']);
$$;

-- Replay an idempotent request, or refuse a reused key with a changed payload.
CREATE FUNCTION haven.document_intake_replay(p_org uuid, p_key uuid, p_actor uuid, p_command text, p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.document_intake_requests;
BEGIN
  IF p_key IS NULL THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.document_intake_requests WHERE organization_id = p_org AND request_key = p_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.actor_id <> p_actor OR r.command <> p_command OR r.request_hash <> p_hash THEN
    RAISE EXCEPTION 'Request key reused with a different request' USING ERRCODE = '22023';
  END IF;
  RETURN r.result || jsonb_build_object('replayed', true);
END $$;

CREATE FUNCTION haven.document_intake_remember(p_org uuid, p_key uuid, p_actor uuid, p_command text, p_hash text, p_result jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.document_intake_requests (organization_id, request_key, actor_id, command, request_hash, result)
  VALUES (p_org, p_key, p_actor, p_command, p_hash, p_result) RETURNING p_result;
$$;

CREATE FUNCTION haven.document_intake_hash(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT md5(coalesce(p, 'null'::jsonb)::text) $$;

-- Queue a new processing generation for an item.
CREATE FUNCTION haven.document_intake_queue_run(p_item public.document_intake_items, p_requested_by uuid, p_accept_uncertain boolean)
RETURNS public.document_intake_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.document_intake_runs; g integer;
BEGIN
  UPDATE public.document_intake_runs SET state = 'superseded', completed_at = coalesce(completed_at, now())
   WHERE item_id = p_item.id AND state = 'queued';
  SELECT coalesce(max(generation), 0) + 1 INTO g FROM public.document_intake_runs WHERE item_id = p_item.id;
  INSERT INTO public.document_intake_runs (organization_id, item_id, generation, requested_by, accept_uncertain_retry)
  VALUES (p_item.organization_id, p_item.id, g, p_requested_by, coalesce(p_accept_uncertain, false)) RETURNING * INTO r;
  UPDATE public.document_intake_items SET processing_state = 'queued', processing_reason = NULL,
    status = CASE WHEN status IN ('receiving','queued','needs_attention','pending_review','held') AND current_proposal_id IS NULL THEN 'queued' ELSE status END,
    revision = gen_random_uuid()
   WHERE id = p_item.id;
  RETURN r;
END $$;

-- Lock the item for a person's command and verify revision + visibility.
CREATE FUNCTION haven.document_intake_lock_item(p_item uuid, p_expected_revision uuid) RETURNS public.document_intake_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.document_intake_items;
BEGIN
  SELECT * INTO i FROM public.document_intake_items WHERE id = p_item FOR UPDATE;
  IF NOT FOUND OR NOT haven.document_intake_item_visible(i) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_revision IS NOT NULL AND i.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'This document changed; refresh before continuing' USING ERRCODE = '40001';
  END IF;
  RETURN i;
END $$;

-- ── Person RPCs: upload ─────────────────────────────────────────────────────

CREATE FUNCTION public.document_intake_prepare_upload(p_request_key uuid, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := haven.document_intake_actor(); org uuid := (a->>'org')::uuid; me uuid := (a->>'id')::uuid;
  h text := haven.document_intake_hash(p_payload); prior jsonb; f uuid; s public.document_intake_settings;
  i public.document_intake_items; new_id uuid := gen_random_uuid(); mime text; fname text; result jsonb;
BEGIN
  prior := haven.document_intake_replay(org, p_request_key, me, 'prepare_upload', h);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid upload request' USING ERRCODE = '22023'; END IF;
  f := (p_payload->>'facility_id')::uuid;
  IF NOT haven.document_intake_can_upload(org, f) THEN RAISE EXCEPTION 'You cannot add documents for this facility' USING ERRCODE = '42501'; END IF;
  s := haven.document_intake_settings_for(org);
  mime := lower(p_payload->>'declared_mime');
  fname := btrim(p_payload->>'file_name');
  IF NOT haven.document_intake_allowed_mime(mime) THEN RAISE EXCEPTION 'That file type is not accepted' USING ERRCODE = '22023'; END IF;
  IF fname IS NULL OR length(fname) NOT BETWEEN 1 AND 255 OR fname ~ '[/\\]' THEN RAISE EXCEPTION 'Invalid file name' USING ERRCODE = '22023'; END IF;
  IF (p_payload->>'declared_size_bytes')::bigint NOT BETWEEN 1 AND s.max_source_bytes THEN
    RAISE EXCEPTION 'File is larger than % MB', s.max_source_bytes / 1048576 USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_payload->>'declared_sha256','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid checksum' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.document_intake_items (id, organization_id, facility_id, channel, original_filename, declared_mime,
    declared_size_bytes, declared_sha256, storage_path, created_by, created_principal)
  VALUES (new_id, org, f, 'upload', fname, mime, (p_payload->>'declared_size_bytes')::integer, p_payload->>'declared_sha256',
    format('%s/%s/%s/original', org, f, new_id), me, 'person')
  RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, 'upload_prepared', me, 'person', jsonb_build_object('channel', 'upload'));
  result := jsonb_build_object('item', haven.document_intake_item_json(i), 'path', i.storage_path);
  RETURN haven.document_intake_remember(org, p_request_key, me, 'prepare_upload', h, result);
END $$;

-- Service: record the verified bytes of a stored original (upload, mail or split child).
-- p_object_id may be NULL: the stored object at the prepared path is then used.
CREATE FUNCTION public.document_intake_attest_source(p_item uuid, p_object_id uuid, p_size integer, p_mime text, p_sha256 text, p_page_count integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.document_intake_items; o record;
BEGIN
  SELECT * INTO i FROM public.document_intake_items WHERE id = p_item FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found' USING ERRCODE = 'P0002'; END IF;
  IF i.verified_sha256 IS NOT NULL THEN
    IF i.verified_sha256 = p_sha256 AND (p_object_id IS NULL OR i.object_id = p_object_id) THEN RETURN haven.document_intake_item_json(i); END IF;
    RAISE EXCEPTION 'Source already attested with different bytes' USING ERRCODE = '55000';
  END IF;
  SELECT id, (metadata->>'size')::bigint AS size INTO o FROM storage.objects
   WHERE bucket_id = 'document-intake' AND name = i.storage_path;
  IF o.id IS NULL OR o.id <> coalesce(p_object_id, o.id) OR o.size <> p_size THEN
    RAISE EXCEPTION 'Stored object does not match' USING ERRCODE = '22023';
  END IF;
  IF p_size <> i.declared_size_bytes OR p_sha256 <> i.declared_sha256 OR NOT haven.document_intake_allowed_mime(p_mime) THEN
    RAISE EXCEPTION 'Stored bytes do not match the declaration' USING ERRCODE = '22023';
  END IF;
  UPDATE public.document_intake_items SET object_id = o.id, verified_mime = p_mime, verified_sha256 = p_sha256,
    page_count = p_page_count, revision = gen_random_uuid()
   WHERE id = p_item RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, 'source_verified', NULL, 'system', jsonb_build_object('size', p_size, 'mime', p_mime, 'pages', p_page_count));
  RETURN haven.document_intake_item_json(i);
END $$;

-- Service: bytes that failed server verification never become a document.
-- The row stays (history), excluded with the reason; nothing reads its bytes.
CREATE FUNCTION public.document_intake_reject_source(p_item uuid, p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.document_intake_items;
BEGIN
  SELECT * INTO i FROM public.document_intake_items WHERE id = p_item FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found' USING ERRCODE = 'P0002'; END IF;
  IF i.verified_sha256 IS NOT NULL OR i.status <> 'receiving' THEN RETURN haven.document_intake_item_json(i); END IF;
  UPDATE public.document_intake_items SET status = 'excluded',
    exclude_reason = left('The file failed verification (' || coalesce(nullif(btrim(p_code), ''), 'unknown') || '); upload it again', 2000),
    revision = gen_random_uuid()
   WHERE id = i.id RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, 'source_rejected', NULL, 'system', jsonb_build_object('code', left(p_code, 120)));
  RETURN haven.document_intake_item_json(i);
END $$;

CREATE FUNCTION public.document_intake_finalize_upload(p_item uuid, p_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := haven.document_intake_actor(); org uuid := (a->>'org')::uuid; me uuid := (a->>'id')::uuid;
  h text := haven.document_intake_hash(jsonb_build_object('item', p_item)); prior jsonb; i public.document_intake_items; dup uuid; result jsonb;
BEGIN
  prior := haven.document_intake_replay(org, p_request_key, me, 'finalize_upload', h);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  SELECT * INTO i FROM public.document_intake_items WHERE id = p_item AND organization_id = org FOR UPDATE;
  IF NOT FOUND OR i.created_by IS DISTINCT FROM me OR NOT haven.document_intake_can_upload(org, i.facility_id) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.verified_sha256 IS NULL THEN RAISE EXCEPTION 'The file has not been verified yet' USING ERRCODE = '55000'; END IF;
  IF i.status <> 'receiving' THEN
    RETURN haven.document_intake_remember(org, p_request_key, me, 'finalize_upload', h, jsonb_build_object('item', haven.document_intake_item_json(i)));
  END IF;
  SELECT d.id INTO dup FROM public.document_intake_items d
   WHERE d.organization_id = org AND d.id <> i.id AND d.verified_sha256 = i.verified_sha256 AND d.deleted_at IS NULL
     AND d.status NOT IN ('excluded') ORDER BY d.received_at LIMIT 1;
  UPDATE public.document_intake_items SET status = 'queued', revision = gen_random_uuid() WHERE id = i.id RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, 'received', me, 'person', jsonb_build_object('channel', 'upload', 'possible_duplicate_of', dup));
  PERFORM haven.document_intake_queue_run(i, me, false);
  SELECT * INTO i FROM public.document_intake_items WHERE id = p_item;
  result := jsonb_build_object('item', haven.document_intake_item_json(i), 'possible_duplicate_of', dup);
  RETURN haven.document_intake_remember(org, p_request_key, me, 'finalize_upload', h, result);
END $$;

-- ── Person RPCs: review commands ────────────────────────────────────────────
-- Commands: claim, release, assign, hold, resume, exclude, mark_duplicate,
-- set_facility (custodian), set_title, reprocess.
CREATE FUNCTION public.document_intake_command(p_item uuid, p_request_key uuid, p_expected_revision uuid, p_command text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := haven.document_intake_actor(); org uuid := (a->>'org')::uuid; me uuid := (a->>'id')::uuid; role text := a->>'role';
  h text := haven.document_intake_hash(jsonb_build_object('item', p_item, 'rev', p_expected_revision, 'command', p_command, 'payload', p_payload));
  prior jsonb; i public.document_intake_items; s public.document_intake_settings; reason text; target uuid; last_run public.document_intake_runs; result jsonb;
BEGIN
  prior := haven.document_intake_replay(org, p_request_key, me, 'command:' || p_command, h);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  p_payload := coalesce(p_payload, '{}'::jsonb);
  IF jsonb_typeof(p_payload) <> 'object' OR length(p_payload::text) > 16384 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE = '22023'; END IF;
  i := haven.document_intake_lock_item(p_item, p_expected_revision);
  s := haven.document_intake_settings_for(org);
  reason := nullif(btrim(p_payload->>'reason'), '');
  IF i.status IN ('filed','split') THEN
    RAISE EXCEPTION 'This document is already %', i.status USING ERRCODE = '55000';
  END IF;

  CASE p_command
  WHEN 'claim' THEN
    IF i.claimed_by IS NOT NULL AND i.claimed_by <> me AND i.claim_expires_at > now() THEN
      RAISE EXCEPTION 'Someone else is reviewing this document' USING ERRCODE = '40001';
    END IF;
    UPDATE public.document_intake_items SET claimed_by = me, claim_expires_at = now() + make_interval(mins => s.claim_minutes) WHERE id = i.id;
  WHEN 'release' THEN
    UPDATE public.document_intake_items SET claimed_by = NULL, claim_expires_at = NULL WHERE id = i.id AND claimed_by = me;
  WHEN 'assign' THEN
    target := (p_payload->>'user_id')::uuid;
    IF target IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = target AND p.organization_id = org
        AND p.is_active AND p.deleted_at IS NULL AND p.app_role::text = ANY (s.review_roles || s.custodian_roles)) THEN
      RAISE EXCEPTION 'That person cannot review documents' USING ERRCODE = '22023';
    END IF;
    UPDATE public.document_intake_items SET assigned_to = target WHERE id = i.id;
  WHEN 'hold' THEN
    IF reason IS NULL THEN RAISE EXCEPTION 'Say why the document is on hold' USING ERRCODE = '22023'; END IF;
    UPDATE public.document_intake_items SET status = 'held', hold_reason = reason WHERE id = i.id;
  WHEN 'resume' THEN
    UPDATE public.document_intake_items SET status = CASE WHEN current_proposal_id IS NULL AND processing_state IN ('queued','running') THEN 'queued' ELSE 'pending_review' END,
      hold_reason = NULL, attention_reason = NULL WHERE id = i.id;
  WHEN 'exclude' THEN
    IF reason IS NULL THEN RAISE EXCEPTION 'Say why the document is excluded' USING ERRCODE = '22023'; END IF;
    UPDATE public.document_intake_items SET status = 'excluded', exclude_reason = reason, claimed_by = NULL, claim_expires_at = NULL WHERE id = i.id;
  WHEN 'mark_duplicate' THEN
    target := (p_payload->>'duplicate_of')::uuid;
    IF target IS NULL OR target = i.id OR NOT haven.document_intake_item_visible_id(target) THEN
      RAISE EXCEPTION 'Pick the document this duplicates' USING ERRCODE = '22023';
    END IF;
    UPDATE public.document_intake_items SET status = 'duplicate', duplicate_of = target, claimed_by = NULL, claim_expires_at = NULL WHERE id = i.id;
  WHEN 'set_facility' THEN
    IF NOT role = ANY (s.custodian_roles) THEN RAISE EXCEPTION 'Only the intake custodian can move documents between facilities' USING ERRCODE = '42501'; END IF;
    target := (p_payload->>'facility_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = target AND f.organization_id = org AND f.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Facility not found' USING ERRCODE = '22023';
    END IF;
    UPDATE public.document_intake_items SET facility_id = target,
      status = CASE WHEN status = 'needs_attention' AND attention_reason = 'Facility unknown' THEN
        CASE WHEN current_proposal_id IS NULL THEN 'queued' ELSE 'pending_review' END ELSE status END,
      attention_reason = CASE WHEN attention_reason = 'Facility unknown' THEN NULL ELSE attention_reason END
     WHERE id = i.id;
    -- Anything processed without a facility is re-read with the right candidates.
    IF i.facility_id IS NULL THEN
      SELECT * INTO i FROM public.document_intake_items WHERE id = p_item;
      PERFORM haven.document_intake_queue_run(i, me, false);
    END IF;
  WHEN 'set_title' THEN
    IF length(btrim(coalesce(p_payload->>'title',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title must be 1-200 characters' USING ERRCODE = '22023'; END IF;
    UPDATE public.document_intake_items SET display_title = btrim(p_payload->>'title') WHERE id = i.id;
  WHEN 'reprocess' THEN
    SELECT * INTO last_run FROM public.document_intake_runs WHERE item_id = i.id ORDER BY generation DESC LIMIT 1;
    IF last_run.state IN ('queued','claimed','dispatched') THEN RAISE EXCEPTION 'Processing is already running' USING ERRCODE = '55000'; END IF;
    IF last_run.state = 'uncertain' AND coalesce((p_payload->>'accept_possible_duplicate_charge')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'The last AI request may already have been charged; confirm to send it again' USING ERRCODE = '55000';
    END IF;
    PERFORM haven.document_intake_queue_run(i, me, last_run.state = 'uncertain');
  ELSE
    RAISE EXCEPTION 'Unknown command' USING ERRCODE = '22023';
  END CASE;

  UPDATE public.document_intake_items SET revision = gen_random_uuid() WHERE id = i.id RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, p_command, me, 'person', p_payload - 'accept_possible_duplicate_charge');
  result := jsonb_build_object('item', haven.document_intake_item_json(i));
  RETURN haven.document_intake_remember(org, p_request_key, me, 'command:' || p_command, h, result);
END $$;

-- ── Person RPCs: split a mixed packet into separate files ──────────────────
-- p_parts: [{"pages":[1,2], "title":"..."}]. Every page is either in exactly one
-- part or listed in p_excluded_pages; nothing is silently dropped.
CREATE FUNCTION public.document_intake_prepare_split(p_item uuid, p_request_key uuid, p_expected_revision uuid, p_parts jsonb, p_excluded_pages integer[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := haven.document_intake_actor(); org uuid := (a->>'org')::uuid; me uuid := (a->>'id')::uuid;
  h text := haven.document_intake_hash(jsonb_build_object('item', p_item, 'rev', p_expected_revision, 'parts', p_parts, 'excluded', p_excluded_pages));
  prior jsonb; i public.document_intake_items; part jsonb; pages integer[]; all_pages integer[] := ARRAY[]::integer[];
  child public.document_intake_items; children jsonb := '[]'::jsonb; n integer := 0; result jsonb;
BEGIN
  prior := haven.document_intake_replay(org, p_request_key, me, 'prepare_split', h);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  i := haven.document_intake_lock_item(p_item, p_expected_revision);
  IF i.facility_id IS NULL THEN RAISE EXCEPTION 'Set the facility before splitting' USING ERRCODE = '55000'; END IF;
  IF i.status NOT IN ('pending_review','held','needs_attention','queued') OR i.verified_mime <> 'application/pdf' OR coalesce(i.page_count, 0) < 2 THEN
    RAISE EXCEPTION 'Only a multi-page PDF waiting for review can be split' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) < 1 OR jsonb_array_length(p_parts) > 50 THEN
    RAISE EXCEPTION 'Give between 1 and 50 parts' USING ERRCODE = '22023';
  END IF;
  FOR part IN SELECT * FROM jsonb_array_elements(p_parts) LOOP
    SELECT array_agg(x::integer ORDER BY ord) INTO pages FROM jsonb_array_elements_text(part->'pages') WITH ORDINALITY AS t(x, ord);
    IF pages IS NULL OR cardinality(pages) = 0 THEN RAISE EXCEPTION 'Each part needs at least one page' USING ERRCODE = '22023'; END IF;
    all_pages := all_pages || pages;
  END LOOP;
  all_pages := all_pages || coalesce(p_excluded_pages, ARRAY[]::integer[]);
  IF (SELECT count(*) FROM unnest(all_pages)) <> i.page_count
     OR (SELECT count(DISTINCT p) FROM unnest(all_pages) p) <> i.page_count
     OR EXISTS (SELECT 1 FROM unnest(all_pages) p WHERE p < 1 OR p > i.page_count) THEN
    RAISE EXCEPTION 'Every page must be in exactly one part or excluded' USING ERRCODE = '22023';
  END IF;
  FOR part IN SELECT * FROM jsonb_array_elements(p_parts) LOOP
    n := n + 1;
    SELECT array_agg(x::integer ORDER BY ord) INTO pages FROM jsonb_array_elements_text(part->'pages') WITH ORDINALITY AS t(x, ord);
    INSERT INTO public.document_intake_items (organization_id, facility_id, channel, parent_item_id, parent_pages, original_filename,
      display_title, declared_mime, declared_size_bytes, declared_sha256, storage_path, sender_address, sender_authenticated,
      received_at, created_by, created_principal)
    VALUES (org, i.facility_id, 'split', i.id, pages,
      left(regexp_replace(i.original_filename, '\.pdf$', '', 'i'), 230) || format(' (part %s).pdf', n),
      nullif(left(btrim(coalesce(part->>'title','')), 200), ''), 'application/pdf',
      greatest(1, coalesce((part->>'size_bytes')::integer, 1)), coalesce(part->>'sha256', repeat('0', 64)),
      format('%s/%s/%s/split-%s', org, i.facility_id, i.id, n), i.sender_address, i.sender_authenticated,
      i.received_at, me, 'split')
    RETURNING * INTO child;
    children := children || jsonb_build_array(jsonb_build_object('item_id', child.id, 'path', child.storage_path, 'pages', to_jsonb(pages)));
  END LOOP;
  UPDATE public.document_intake_items SET revision = gen_random_uuid() WHERE id = i.id RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, 'split_prepared', me, 'person', jsonb_build_object('parts', jsonb_array_length(p_parts), 'excluded_pages', to_jsonb(coalesce(p_excluded_pages, ARRAY[]::integer[]))));
  result := jsonb_build_object('parent_revision', i.revision, 'children', children);
  RETURN haven.document_intake_remember(org, p_request_key, me, 'prepare_split', h, result);
END $$;

-- Service: declare the bytes of a split child before attesting (size/hash are
-- only known once the server has cut the pages).
CREATE FUNCTION public.document_intake_declare_split_child(p_item uuid, p_size integer, p_sha256 text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.document_intake_items SET declared_size_bytes = p_size, declared_sha256 = p_sha256
   WHERE id = p_item AND channel = 'split' AND verified_sha256 IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Split child unavailable' USING ERRCODE = 'P0002'; END IF;
END $$;

CREATE FUNCTION public.document_intake_finalize_split(p_item uuid, p_request_key uuid, p_expected_revision uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := haven.document_intake_actor(); org uuid := (a->>'org')::uuid; me uuid := (a->>'id')::uuid;
  h text := haven.document_intake_hash(jsonb_build_object('item', p_item, 'rev', p_expected_revision));
  prior jsonb; i public.document_intake_items; c public.document_intake_items; result jsonb;
BEGIN
  prior := haven.document_intake_replay(org, p_request_key, me, 'finalize_split', h);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  i := haven.document_intake_lock_item(p_item, p_expected_revision);
  IF EXISTS (SELECT 1 FROM public.document_intake_items x WHERE x.parent_item_id = i.id AND x.status = 'receiving' AND x.verified_sha256 IS NULL) THEN
    RAISE EXCEPTION 'Not every part has been saved yet' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.document_intake_items x WHERE x.parent_item_id = i.id) THEN
    RAISE EXCEPTION 'Nothing to finalize' USING ERRCODE = '55000';
  END IF;
  FOR c IN SELECT * FROM public.document_intake_items x WHERE x.parent_item_id = i.id AND x.status = 'receiving' FOR UPDATE LOOP
    UPDATE public.document_intake_items SET status = 'queued', revision = gen_random_uuid() WHERE id = c.id RETURNING * INTO c;
    PERFORM haven.document_intake_event(c, 'received', me, 'person', jsonb_build_object('channel', 'split', 'parent_item_id', i.id, 'pages', to_jsonb(c.parent_pages)));
    PERFORM haven.document_intake_queue_run(c, me, false);
  END LOOP;
  UPDATE public.document_intake_items SET status = 'split', claimed_by = NULL, claim_expires_at = NULL, revision = gen_random_uuid()
   WHERE id = i.id RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, 'split', me, 'person', '{}'::jsonb);
  result := jsonb_build_object('item', haven.document_intake_item_json(i));
  RETURN haven.document_intake_remember(org, p_request_key, me, 'finalize_split', h, result);
END $$;

-- ── Person RPCs: approve filing (two phase) ─────────────────────────────────

-- Authority for a destination: catalog reviewer role + the destination's own rule.
CREATE FUNCTION haven.document_intake_assert_destination(p_item public.document_intake_items, c public.document_intake_catalog, p_subject uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT c.active OR c.destination_kind = 'none' THEN RAISE EXCEPTION 'This document type has no filing destination' USING ERRCODE = '22023'; END IF;
  IF NOT p_role = ANY (c.reviewer_roles) THEN RAISE EXCEPTION 'Your role cannot file this document type' USING ERRCODE = '42501'; END IF;
  IF p_item.facility_id IS NULL OR NOT haven.has_facility_access(p_item.facility_id) THEN RAISE EXCEPTION 'Facility access required' USING ERRCODE = '42501'; END IF;
  CASE c.destination_kind
  WHEN 'resident_document' THEN
    IF NOT EXISTS (SELECT 1 FROM public.residents r WHERE r.id = p_subject AND r.organization_id = p_item.organization_id
        AND r.facility_id = p_item.facility_id AND r.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Resident not found at this facility' USING ERRCODE = '22023';
    END IF;
    IF NOT haven.resident_record_document_type_allowed(c.destination_category) THEN
      RAISE EXCEPTION 'Catalog row names an unknown resident document type' USING ERRCODE = '22023';
    END IF;
  WHEN 'benefits_document' THEN
    PERFORM haven.benefits_assert_case(p_subject, 'write');
    IF NOT EXISTS (SELECT 1 FROM public.benefits_cases b WHERE b.id = p_subject AND b.facility_id = p_item.facility_id) THEN
      RAISE EXCEPTION 'Medicaid case not found at this facility' USING ERRCODE = '22023';
    END IF;
  WHEN 'employee_file' THEN
    IF NOT haven.employee_manager() THEN RAISE EXCEPTION 'Staff files need a manager' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_subject AND s.organization_id = p_item.organization_id AND s.deleted_at IS NULL
        AND (s.facility_id = p_item.facility_id OR EXISTS (SELECT 1 FROM public.staff_facility_assignments x WHERE x.staff_id = s.id
          AND x.facility_id = p_item.facility_id AND x.deleted_at IS NULL))) THEN
      RAISE EXCEPTION 'Employee not found at this facility' USING ERRCODE = '22023';
    END IF;
  WHEN 'facility_document' THEN
    IF p_subject <> p_item.facility_id THEN RAISE EXCEPTION 'Facility documents file to the item''s facility' USING ERRCODE = '22023'; END IF;
  END CASE;
END $$;

-- The employee requirement a staff document files against.
CREATE FUNCTION haven.document_intake_employee_requirement(p_org uuid, p_facility uuid, p_category text, p_requirement uuid)
RETURNS public.employee_file_requirements LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE q public.employee_file_requirements;
BEGIN
  SELECT * INTO q FROM public.employee_file_requirements r
   WHERE r.organization_id = p_org AND r.facility_id = p_facility AND r.deleted_at IS NULL
     AND (p_requirement IS NULL OR r.id = p_requirement)
     AND (p_requirement IS NOT NULL OR r.category = p_category)
   ORDER BY (r.id = p_requirement) DESC NULLS LAST, r.code LIMIT 1;
  RETURN q;
END $$;

CREATE FUNCTION public.document_intake_prepare_filing(p_item uuid, p_request_key uuid, p_expected_revision uuid, p_destination jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := haven.document_intake_actor(); org uuid := (a->>'org')::uuid; me uuid := (a->>'id')::uuid; role text := a->>'role';
  h text := haven.document_intake_hash(jsonb_build_object('item', p_item, 'rev', p_expected_revision, 'destination', p_destination));
  prior jsonb; i public.document_intake_items; c public.document_intake_catalog; subject uuid; title text; f public.document_intake_filings;
  bucket text; path text; q public.employee_file_requirements; record_id uuid := gen_random_uuid(); ext text; p public.document_intake_proposals;
  changes jsonb := '{}'::jsonb; result jsonb;
BEGIN
  prior := haven.document_intake_replay(org, p_request_key, me, 'prepare_filing', h);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  i := haven.document_intake_lock_item(p_item, p_expected_revision);
  IF i.status NOT IN ('pending_review','held','needs_attention') THEN RAISE EXCEPTION 'This document is not waiting for review' USING ERRCODE = '55000'; END IF;
  IF i.verified_sha256 IS NULL THEN RAISE EXCEPTION 'The original has not been verified' USING ERRCODE = '55000'; END IF;
  IF i.claimed_by IS NOT NULL AND i.claimed_by <> me AND i.claim_expires_at > now() THEN
    RAISE EXCEPTION 'Someone else is reviewing this document' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO c FROM public.document_intake_catalog WHERE organization_id = org AND code = p_destination->>'catalog_code';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pick a document type' USING ERRCODE = '22023'; END IF;
  subject := CASE WHEN c.destination_kind = 'facility_document' THEN i.facility_id ELSE (p_destination->>'subject_id')::uuid END;
  IF subject IS NULL THEN RAISE EXCEPTION 'Pick who or what this document is about' USING ERRCODE = '22023'; END IF;
  PERFORM haven.document_intake_assert_destination(i, c, subject, role);
  title := btrim(coalesce(p_destination->>'title', i.display_title, ''));
  IF length(title) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Give the document a title' USING ERRCODE = '22023'; END IF;
  IF c.destination_kind = 'benefits_document' AND (i.verified_mime NOT IN ('application/pdf','image/jpeg','image/png') OR i.declared_size_bytes > 15728640) THEN
    RAISE EXCEPTION 'Medicaid case documents must be PDF, JPEG or PNG under 15 MB' USING ERRCODE = '22023';
  END IF;
  IF c.destination_kind = 'resident_document' AND i.verified_mime NOT IN ('application/pdf','image/jpeg','image/png') THEN
    RAISE EXCEPTION 'Resident documents must be PDF, JPEG or PNG' USING ERRCODE = '22023';
  END IF;
  IF c.destination_kind = 'employee_file' THEN
    q := haven.document_intake_employee_requirement(org, i.facility_id, c.destination_category, (p_destination->>'requirement_id')::uuid);
    IF q.id IS NULL THEN RAISE EXCEPTION 'No staff file requirement of this kind exists for the facility' USING ERRCODE = '22023'; END IF;
  END IF;
  ext := CASE i.verified_mime WHEN 'application/pdf' THEN 'pdf' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp' WHEN 'image/tiff' THEN 'tif' ELSE 'heic' END;
  CASE c.destination_kind
  WHEN 'resident_document' THEN bucket := 'resident-documents'; path := format('intake/%s/%s/%s.%s', i.facility_id, subject, record_id, ext);
  WHEN 'benefits_document' THEN bucket := 'benefits-documents'; path := format('%s/intake-%s.%s', subject, record_id, ext);
  WHEN 'employee_file' THEN bucket := CASE WHEN q.category = 'medical' THEN 'employee-medical' ELSE 'employee-personnel' END;
    path := format('%s/intake.%s', record_id, ext);
  WHEN 'facility_document' THEN bucket := 'facility-documents'; path := format('%s/%s/%s.%s', i.facility_id, record_id, 'intake', ext);
  END CASE;
  SELECT * INTO p FROM public.document_intake_proposals WHERE id = i.current_proposal_id;
  IF p.id IS NOT NULL THEN
    changes := jsonb_strip_nulls(jsonb_build_object(
      'catalog_code', CASE WHEN p.catalog_code IS DISTINCT FROM c.code THEN jsonb_build_object('proposed', p.catalog_code, 'chosen', c.code) END,
      'title', CASE WHEN p.suggested_title IS DISTINCT FROM title THEN jsonb_build_object('proposed', p.suggested_title, 'chosen', title) END,
      'subject', CASE WHEN p.proposed_candidate IS NULL OR (p.candidates->p.proposed_candidate->>'subject_id')::uuid IS DISTINCT FROM subject
        THEN jsonb_build_object('proposed', p.candidates->p.proposed_candidate->>'subject_id', 'chosen', subject) END));
  END IF;
  BEGIN
    INSERT INTO public.document_intake_filings (id, organization_id, facility_id, item_id, proposal_id, request_key, catalog_code, destination_kind,
      destination_category, subject_id, title, document_date, expiration_date, target_bucket, target_path, reviewer_changes, approved_by, expected_item_revision)
    VALUES (record_id, org, i.facility_id, i.id, i.current_proposal_id, p_request_key, c.code, c.destination_kind,
      CASE WHEN c.destination_kind = 'employee_file' THEN q.id::text ELSE c.destination_category END, subject, title,
      (p_destination->>'document_date')::date, (p_destination->>'expiration_date')::date, bucket, path, changes, me, i.revision)
    RETURNING * INTO f;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Another filing of this document is already in progress' USING ERRCODE = '40001';
  END;
  UPDATE public.document_intake_items SET claimed_by = me, claim_expires_at = now() + interval '10 minutes' WHERE id = i.id;
  PERFORM haven.document_intake_event(i, 'filing_prepared', me, 'person', jsonb_build_object('filing_id', f.id, 'catalog_code', c.code, 'destination_kind', c.destination_kind));
  result := jsonb_build_object('filing_id', f.id, 'bucket', bucket, 'path', path, 'source_path', i.storage_path, 'sha256', i.verified_sha256, 'mime', i.verified_mime);
  RETURN haven.document_intake_remember(org, p_request_key, me, 'prepare_filing', h, result);
END $$;

-- Service: the server copied the original to the destination bucket and verified it.
CREATE FUNCTION public.document_intake_attest_filing_object(p_filing uuid, p_object_id uuid, p_sha256 text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.document_intake_filings; i public.document_intake_items; o uuid;
BEGIN
  SELECT * INTO f FROM public.document_intake_filings WHERE id = p_filing FOR UPDATE;
  IF NOT FOUND OR f.state NOT IN ('preparing','attested') THEN RAISE EXCEPTION 'Filing unavailable' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO i FROM public.document_intake_items WHERE id = f.item_id;
  SELECT id INTO o FROM storage.objects WHERE bucket_id = f.target_bucket AND name = f.target_path;
  IF o IS NULL OR o <> coalesce(p_object_id, o) OR p_sha256 <> i.verified_sha256 THEN RAISE EXCEPTION 'Filed copy does not match the original' USING ERRCODE = '22023'; END IF;
  UPDATE public.document_intake_filings SET state = 'attested', target_object_id = o, target_sha256 = p_sha256 WHERE id = p_filing;
END $$;

CREATE FUNCTION public.document_intake_complete_filing(p_filing uuid, p_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := haven.document_intake_actor(); org uuid := (a->>'org')::uuid; me uuid := (a->>'id')::uuid; role text := a->>'role';
  h text := haven.document_intake_hash(jsonb_build_object('filing', p_filing)); prior jsonb;
  f public.document_intake_filings; i public.document_intake_items; c public.document_intake_catalog; dest uuid; bobj jsonb; result jsonb;
BEGIN
  prior := haven.document_intake_replay(org, p_request_key, me, 'complete_filing', h);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  SELECT * INTO f FROM public.document_intake_filings WHERE id = p_filing AND organization_id = org FOR UPDATE;
  IF NOT FOUND OR f.approved_by <> me THEN RAISE EXCEPTION 'Filing not found' USING ERRCODE = 'P0002'; END IF;
  IF f.state = 'filed' THEN
    RETURN jsonb_build_object('filing', to_jsonb(f), 'replayed', true);
  END IF;
  IF f.state <> 'attested' THEN RAISE EXCEPTION 'The filed copy has not been verified yet' USING ERRCODE = '55000'; END IF;
  i := haven.document_intake_lock_item(f.item_id, f.expected_item_revision);
  SELECT * INTO c FROM public.document_intake_catalog WHERE organization_id = org AND code = f.catalog_code;
  -- Authority is re-checked now: waits and retries do not carry old permission.
  PERFORM haven.document_intake_assert_destination(i, c, f.subject_id, role);
  CASE f.destination_kind
  WHEN 'resident_document' THEN
    INSERT INTO public.resident_documents (resident_id, facility_id, organization_id, document_type, title, storage_path, storage_bucket,
      file_type, file_size, uploaded_by, expiration_date, notes)
    VALUES (f.subject_id, f.facility_id, org, f.destination_category, f.title, f.target_path, f.target_bucket, i.verified_mime,
      i.declared_size_bytes, me, f.expiration_date, format('Filed from Document Intake (%s)', i.id))
    RETURNING id INTO dest;
  WHEN 'facility_document' THEN
    INSERT INTO public.facility_documents (facility_id, organization_id, document_category, document_name, friendly_title, file_path,
      file_size_bytes, mime_type, expiration_date, effective_date, notes, uploaded_by, original_filename, vault_series_id)
    VALUES (f.facility_id, org, f.destination_category, f.title, f.title, f.target_path, i.declared_size_bytes, i.verified_mime,
      f.expiration_date, f.document_date, format('Filed from Document Intake (%s)', i.id), me, i.original_filename, gen_random_uuid())
    RETURNING id INTO dest;
  WHEN 'employee_file' THEN
    dest := f.id;
    INSERT INTO public.employee_file_records (id, organization_id, facility_id, staff_id, requirement_id, status, completed_on,
      expires_on, notes, storage_path, created_by)
    VALUES (dest, org, f.facility_id, f.subject_id, f.destination_category::uuid, 'submitted', NULL, NULL,
      left(format('%s — filed from Document Intake (%s)', f.title, i.id), 2000), f.target_path, me);
  WHEN 'benefits_document' THEN
    bobj := haven.benefits_object(f.target_path);
    INSERT INTO public.benefits_documents (case_id, filename, mime_type, size_bytes, sha256, storage_path, status, document_type,
      created_by, verified_object, verified_at)
    VALUES (f.subject_id, left(regexp_replace(f.title, '[/\\]', '-', 'g'), 255), i.verified_mime, i.declared_size_bytes, f.target_sha256,
      f.target_path, 'ready', f.destination_category, me, bobj, now())
    RETURNING id INTO dest;
  END CASE;
  UPDATE public.document_intake_filings SET state = 'filed', destination_record_id = dest, approved_at = now() WHERE id = f.id RETURNING * INTO f;
  UPDATE public.document_intake_items SET status = 'filed', claimed_by = NULL, claim_expires_at = NULL,
    display_title = f.title, revision = gen_random_uuid() WHERE id = i.id RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, 'filed', me, 'person', jsonb_build_object('filing_id', f.id, 'destination_kind', f.destination_kind,
    'destination_record_id', dest, 'catalog_code', f.catalog_code, 'reviewer_changes', f.reviewer_changes));
  result := jsonb_build_object('filing', to_jsonb(f));
  RETURN haven.document_intake_remember(org, p_request_key, me, 'complete_filing', h, result);
END $$;

-- Abandon a prepared filing that never completed (the copy failed or the reviewer backed out).
CREATE FUNCTION public.document_intake_abandon_filing(p_filing uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := haven.document_intake_actor(); f public.document_intake_filings; i public.document_intake_items;
BEGIN
  SELECT * INTO f FROM public.document_intake_filings WHERE id = p_filing AND organization_id = (a->>'org')::uuid FOR UPDATE;
  IF NOT FOUND OR f.state NOT IN ('preparing','attested') OR (f.approved_by <> (a->>'id')::uuid AND f.created_at > now() - interval '15 minutes') THEN
    RAISE EXCEPTION 'Filing unavailable' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.document_intake_filings SET state = 'abandoned' WHERE id = f.id;
  SELECT * INTO i FROM public.document_intake_items WHERE id = f.item_id;
  PERFORM haven.document_intake_event(i, 'filing_abandoned', (a->>'id')::uuid, 'person', jsonb_build_object('filing_id', f.id));
END $$;

-- Correct a wrong filing: the destination record is withdrawn with a reason and
-- the document returns to review. History keeps both.
CREATE FUNCTION public.document_intake_correct_filing(p_filing uuid, p_request_key uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := haven.document_intake_actor(); org uuid := (a->>'org')::uuid; me uuid := (a->>'id')::uuid; role text := a->>'role';
  h text := haven.document_intake_hash(jsonb_build_object('filing', p_filing, 'reason', p_reason)); prior jsonb;
  f public.document_intake_filings; i public.document_intake_items; c public.document_intake_catalog; result jsonb;
BEGIN
  prior := haven.document_intake_replay(org, p_request_key, me, 'correct_filing', h);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Say what was wrong with the filing' USING ERRCODE = '22023'; END IF;
  SELECT * INTO f FROM public.document_intake_filings WHERE id = p_filing AND organization_id = org FOR UPDATE;
  IF NOT FOUND OR f.state <> 'filed' THEN RAISE EXCEPTION 'Filing not found' USING ERRCODE = 'P0002'; END IF;
  i := haven.document_intake_lock_item(f.item_id, NULL);
  SELECT * INTO c FROM public.document_intake_catalog WHERE organization_id = org AND code = f.catalog_code;
  PERFORM haven.document_intake_assert_destination(i, c, f.subject_id, role);
  CASE f.destination_kind
  WHEN 'resident_document' THEN
    UPDATE public.resident_documents SET deleted_at = now(), notes = left(coalesce(notes,'') || format(' | Withdrawn from Document Intake: %s', p_reason), 4000)
     WHERE id = f.destination_record_id AND deleted_at IS NULL;
  WHEN 'facility_document' THEN
    UPDATE public.facility_documents SET deleted_at = now(), updated_by = me,
      notes = left(coalesce(notes,'') || format(' | Withdrawn from Document Intake: %s', p_reason), 4000)
     WHERE id = f.destination_record_id AND deleted_at IS NULL;
  WHEN 'benefits_document' THEN
    UPDATE public.benefits_documents SET voided_at = now(), voided_by = me, void_reason = left(p_reason, 2000)
     WHERE id = f.destination_record_id AND voided_at IS NULL;
  WHEN 'employee_file' THEN
    UPDATE public.employee_file_records SET status = 'rejected', review_note = left(format('Withdrawn from Document Intake: %s', p_reason), 2000),
      reviewed_by = me, reviewed_at = now()
     WHERE id = f.destination_record_id AND status = 'submitted';
    IF NOT FOUND THEN RAISE EXCEPTION 'This staff record was already reviewed; correct it from the staff file' USING ERRCODE = '55000'; END IF;
  END CASE;
  UPDATE public.document_intake_filings SET state = 'corrected', corrected_by = me, corrected_at = now(), correction_reason = btrim(p_reason)
   WHERE id = f.id RETURNING * INTO f;
  UPDATE public.document_intake_items SET status = 'pending_review', revision = gen_random_uuid() WHERE id = i.id RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, 'filing_corrected', me, 'person', jsonb_build_object('filing_id', f.id, 'reason', btrim(p_reason)));
  result := jsonb_build_object('item', haven.document_intake_item_json(i), 'filing', to_jsonb(f));
  RETURN haven.document_intake_remember(org, p_request_key, me, 'correct_filing', h, result);
END $$;

-- ── Worker RPCs (service_role only) ─────────────────────────────────────────

-- Claim the next run. Expired leases: a run that never dispatched is re-queued;
-- a run that dispatched a paid request becomes 'uncertain' and waits for a person.
CREATE FUNCTION public.document_intake_worker_claim(p_worker text, p_lease_seconds integer DEFAULT 240) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.document_intake_runs; i public.document_intake_items; c record; v_fence uuid := gen_random_uuid();
BEGIN
  FOR c IN SELECT * FROM public.document_intake_runs WHERE state IN ('claimed','dispatched') AND lease_expires_at < now() FOR UPDATE SKIP LOCKED LOOP
    -- Any run that ever dispatched a paid call is never silently re-sent.
    IF c.state = 'dispatched' OR c.dispatched_at IS NOT NULL THEN
      UPDATE public.document_intake_runs SET state = 'uncertain', outcome_code = 'lease_expired_after_dispatch', completed_at = now(), fence = NULL WHERE id = c.id;
      UPDATE public.document_intake_items SET processing_state = 'uncertain', processing_reason = 'The AI request may have been sent; confirm before sending again',
        status = CASE WHEN status IN ('queued','processing') THEN 'needs_attention' ELSE status END,
        attention_reason = CASE WHEN status IN ('queued','processing') THEN 'AI result unknown' ELSE attention_reason END,
        revision = gen_random_uuid() WHERE id = c.item_id RETURNING * INTO i;
      PERFORM haven.document_intake_event(i, 'processing_uncertain', NULL, 'worker', jsonb_build_object('run_id', c.id, 'stage', c.dispatch_stage));
    ELSE
      UPDATE public.document_intake_runs SET state = 'queued', fence = NULL, lease_owner = NULL, lease_expires_at = NULL WHERE id = c.id;
    END IF;
  END LOOP;
  SELECT * INTO r FROM public.document_intake_runs WHERE state = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO i FROM public.document_intake_items WHERE id = r.item_id FOR UPDATE;
  IF i.verified_sha256 IS NULL OR i.status IN ('filed','excluded','duplicate','split') OR i.deleted_at IS NOT NULL THEN
    UPDATE public.document_intake_runs SET state = 'superseded', completed_at = now() WHERE id = r.id;
    RETURN jsonb_build_object('skip', true, 'run_id', r.id);
  END IF;
  UPDATE public.document_intake_runs SET state = 'claimed', fence = v_fence, lease_owner = left(p_worker, 120),
    lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))), attempts = attempts + 1, started_at = now()
   WHERE id = r.id RETURNING * INTO r;
  UPDATE public.document_intake_items SET processing_state = 'running',
    status = CASE WHEN status = 'queued' THEN 'processing' ELSE status END, revision = gen_random_uuid() WHERE id = i.id RETURNING * INTO i;
  RETURN jsonb_build_object('run', to_jsonb(r), 'item', to_jsonb(i),
    'catalog', (SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.sort_order), '[]'::jsonb) FROM public.document_intake_catalog k WHERE k.organization_id = i.organization_id AND k.active),
    'policy', (SELECT jsonb_build_object('allow_phi', p.allow_phi, 'baa_recorded', p.baa_reference IS NOT NULL AND p.baa_verified_at IS NOT NULL,
        'default_provider', p.default_provider, 'routing', p.routing_json->'document_intake')
      FROM public.ai_invocation_policies p WHERE p.organization_id = i.organization_id));
END $$;

CREATE FUNCTION haven.document_intake_worker_run(p_run uuid, p_fence uuid) RETURNS public.document_intake_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.document_intake_runs;
BEGIN
  SELECT * INTO r FROM public.document_intake_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND OR r.fence IS DISTINCT FROM p_fence OR r.state NOT IN ('claimed','dispatched') THEN
    RAISE EXCEPTION 'Run lease lost' USING ERRCODE = '40001';
  END IF;
  RETURN r;
END $$;

-- Record dispatch intent BEFORE a paid call. Refuses if an earlier generation
-- is uncertain and nobody accepted a possible duplicate charge.
CREATE FUNCTION public.document_intake_worker_dispatch(p_run uuid, p_fence uuid, p_stage text, p_provider text, p_model text, p_policy jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.document_intake_runs := haven.document_intake_worker_run(p_run, p_fence); k uuid := gen_random_uuid();
BEGIN
  IF p_stage NOT IN ('reader','jev') THEN RAISE EXCEPTION 'Unknown stage' USING ERRCODE = '22023'; END IF;
  IF NOT r.accept_uncertain_retry AND EXISTS (SELECT 1 FROM public.document_intake_runs x WHERE x.item_id = r.item_id AND x.generation < r.generation AND x.state = 'uncertain'
      AND NOT EXISTS (SELECT 1 FROM public.document_intake_runs y WHERE y.item_id = r.item_id AND y.generation > x.generation AND y.accept_uncertain_retry)) THEN
    RAISE EXCEPTION 'Earlier AI request is unresolved' USING ERRCODE = '55000';
  END IF;
  UPDATE public.document_intake_runs SET state = 'dispatched', dispatch_stage = p_stage, dispatch_key = k, dispatched_at = now(),
    reader_provider = CASE WHEN p_stage = 'reader' THEN p_provider ELSE reader_provider END,
    reader_model = CASE WHEN p_stage = 'reader' THEN p_model ELSE reader_model END,
    jev_model = CASE WHEN p_stage = 'jev' THEN p_model ELSE jev_model END,
    policy_snapshot = coalesce(p_policy, policy_snapshot)
   WHERE id = r.id;
  RETURN k;
END $$;

-- A provider call returned (success or definite failure): back to 'claimed'.
CREATE FUNCTION public.document_intake_worker_returned(p_run uuid, p_fence uuid, p_usage jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.document_intake_runs := haven.document_intake_worker_run(p_run, p_fence);
BEGIN
  UPDATE public.document_intake_runs SET state = 'claimed', usage = usage || coalesce(p_usage, '{}'::jsonb) WHERE id = r.id;
END $$;

-- Publish the proposal generation. A late worker cannot publish over a newer generation.
CREATE FUNCTION public.document_intake_worker_complete(p_run uuid, p_fence uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.document_intake_runs := haven.document_intake_worker_run(p_run, p_fence); i public.document_intake_items; p public.document_intake_proposals;
  newest integer; unknown_facility boolean;
BEGIN
  SELECT max(generation) INTO newest FROM public.document_intake_runs WHERE item_id = r.item_id;
  IF newest > r.generation THEN
    UPDATE public.document_intake_runs SET state = 'superseded', completed_at = now(), fence = NULL WHERE id = r.id;
    RETURN jsonb_build_object('superseded', true);
  END IF;
  IF jsonb_typeof(p_result) <> 'object' OR length(p_result::text) > 200000 THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE = '22023'; END IF;
  SELECT * INTO i FROM public.document_intake_items WHERE id = r.item_id FOR UPDATE;
  INSERT INTO public.document_intake_proposals (organization_id, item_id, run_id, generation, suggested_title, summary, summary_pages, document_date,
    catalog_code, candidates, proposed_candidate, segments, reader, jev, checks, warnings, stage_status)
  VALUES (i.organization_id, i.id, r.id, r.generation, left(p_result->>'suggested_title', 200), left(p_result->>'summary', 600),
    (SELECT array_agg(x::integer) FROM jsonb_array_elements_text(coalesce(p_result->'summary_pages','[]'::jsonb)) x),
    (p_result->>'document_date')::date,
    CASE WHEN EXISTS (SELECT 1 FROM public.document_intake_catalog k WHERE k.organization_id = i.organization_id AND k.code = p_result->>'catalog_code') THEN p_result->>'catalog_code' END,
    coalesce(p_result->'candidates', '[]'::jsonb), (p_result->>'proposed_candidate')::integer, coalesce(p_result->'segments', '[]'::jsonb),
    coalesce(p_result->'reader', '{}'::jsonb), coalesce(p_result->'jev', '{}'::jsonb), coalesce(p_result->'checks', '[]'::jsonb),
    coalesce(p_result->'warnings', '[]'::jsonb), coalesce(p_result->'stage_status', '{}'::jsonb))
  RETURNING * INTO p;
  unknown_facility := i.facility_id IS NULL;
  UPDATE public.document_intake_runs SET state = CASE WHEN p_result->>'outcome' = 'blocked' THEN 'blocked' ELSE 'succeeded' END,
    outcome_code = left(p_result->>'outcome_code', 120), completed_at = now(), fence = NULL
   WHERE id = r.id;
  UPDATE public.document_intake_items SET current_proposal_id = p.id,
    processing_state = CASE WHEN p_result->>'outcome' = 'blocked' THEN 'blocked' WHEN p_result->>'outcome' = 'skipped' THEN 'skipped' ELSE 'succeeded' END,
    processing_reason = left(p_result->>'processing_reason', 200),
    page_count = coalesce(page_count, (p_result->>'page_count')::integer),
    status = CASE WHEN status IN ('queued','processing','receiving') THEN CASE WHEN unknown_facility THEN 'needs_attention' ELSE 'pending_review' END ELSE status END,
    attention_reason = CASE WHEN unknown_facility AND status IN ('queued','processing','receiving') THEN 'Facility unknown' ELSE attention_reason END,
    display_title = coalesce(display_title, left(p_result->>'suggested_title', 200)),
    revision = gen_random_uuid()
   WHERE id = i.id RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, 'proposal_ready', NULL, 'worker', jsonb_build_object('run_id', r.id, 'generation', r.generation,
    'outcome', p_result->>'outcome', 'reader', p_result->'stage_status'->'reader', 'jev', p_result->'stage_status'->'jev'));
  RETURN jsonb_build_object('proposal_id', p.id);
END $$;

CREATE FUNCTION public.document_intake_worker_fail(p_run uuid, p_fence uuid, p_code text, p_uncertain boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.document_intake_runs := haven.document_intake_worker_run(p_run, p_fence); i public.document_intake_items;
BEGIN
  UPDATE public.document_intake_runs SET state = CASE WHEN p_uncertain THEN 'uncertain' ELSE 'failed' END,
    outcome_code = left(p_code, 120), completed_at = now(), fence = NULL WHERE id = r.id;
  UPDATE public.document_intake_items SET processing_state = CASE WHEN p_uncertain THEN 'uncertain' ELSE 'failed' END,
    processing_reason = left(CASE WHEN p_uncertain THEN 'The AI request may have been sent; confirm before sending again' ELSE 'Processing failed: ' || p_code END, 200),
    status = CASE WHEN status IN ('queued','processing') THEN 'needs_attention' ELSE status END,
    attention_reason = CASE WHEN status IN ('queued','processing') THEN CASE WHEN p_uncertain THEN 'AI result unknown' ELSE 'Processing failed' END ELSE attention_reason END,
    revision = gen_random_uuid()
   WHERE id = r.item_id RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, CASE WHEN p_uncertain THEN 'processing_uncertain' ELSE 'processing_failed' END, NULL, 'worker',
    jsonb_build_object('run_id', r.id, 'code', left(p_code, 120)));
END $$;

-- Candidate subjects for one item. Names only for the item's own facility; the
-- worker ranks them in code and sends a short list, never the whole roster.
CREATE FUNCTION public.document_intake_worker_subjects(p_item uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'residents', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'first_name', r.first_name, 'last_name', r.last_name,
        'preferred_name', r.preferred_name, 'date_of_birth', r.date_of_birth, 'status', r.status))
      FROM public.residents r WHERE r.facility_id = i.facility_id AND r.organization_id = i.organization_id AND r.deleted_at IS NULL), '[]'::jsonb),
    'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'first_name', s.first_name, 'last_name', s.last_name,
        'preferred_name', s.preferred_name, 'employment_status', s.employment_status))
      FROM public.staff s WHERE s.organization_id = i.organization_id AND s.deleted_at IS NULL
        AND (s.facility_id = i.facility_id OR EXISTS (SELECT 1 FROM public.staff_facility_assignments x WHERE x.staff_id = s.id AND x.facility_id = i.facility_id AND x.deleted_at IS NULL))), '[]'::jsonb),
    'medicaid_cases', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'resident_id', b.resident_id, 'program', b.program, 'status', b.status))
      FROM public.benefits_cases b WHERE b.facility_id = i.facility_id AND b.organization_id = i.organization_id AND b.status <> 'closed'), '[]'::jsonb),
    'facility', (SELECT jsonb_build_object('id', f.id, 'name', f.name) FROM public.facilities f WHERE f.id = i.facility_id))
  FROM public.document_intake_items i WHERE i.id = p_item;
$$;

-- Mail receiver: store the manifest row for one provider message (idempotent).
CREATE FUNCTION public.document_intake_worker_record_message(p_mailbox uuid, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE mb public.document_intake_mailboxes; m public.document_intake_messages;
BEGIN
  SELECT * INTO mb FROM public.document_intake_mailboxes WHERE id = p_mailbox;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mailbox not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.document_intake_messages (organization_id, mailbox_id, folder, provider_message_id, internet_message_id, sender_address,
    sender_authenticated, authentication_results, subject_hash, received_at, raw_path, raw_sha256, raw_size_bytes, part_count, status, exception_code)
  VALUES (mb.organization_id, mb.id, p_payload->>'folder', p_payload->>'provider_message_id', p_payload->>'internet_message_id',
    lower(p_payload->>'sender_address'), coalesce((p_payload->>'sender_authenticated')::boolean, false), left(p_payload->>'authentication_results', 8000),
    p_payload->>'subject_hash', (p_payload->>'received_at')::timestamptz, p_payload->>'raw_path', p_payload->>'raw_sha256',
    (p_payload->>'raw_size_bytes')::integer, coalesce((p_payload->>'part_count')::integer, 0), coalesce(p_payload->>'status', 'stored'), p_payload->>'exception_code')
  ON CONFLICT (mailbox_id, provider_message_id) DO UPDATE SET status = EXCLUDED.status, exception_code = EXCLUDED.exception_code,
    part_count = greatest(public.document_intake_messages.part_count, EXCLUDED.part_count)
  RETURNING * INTO m;
  RETURN to_jsonb(m);
END $$;

-- Mail receiver: create one item per accepted attachment (idempotent by path).
CREATE FUNCTION public.document_intake_worker_create_mail_item(p_message uuid, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.document_intake_messages; i public.document_intake_items; route public.document_intake_sender_routes; new_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO m FROM public.document_intake_messages WHERE id = p_message;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO i FROM public.document_intake_items WHERE message_id = m.id AND original_filename = p_payload->>'file_name'
    AND declared_sha256 = p_payload->>'sha256' LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('item_id', i.id, 'path', i.storage_path, 'existing', true, 'verified', i.verified_sha256 IS NOT NULL); END IF;
  -- A sender route counts only for a first-hop authenticated sender.
  IF m.sender_authenticated THEN
    SELECT * INTO route FROM public.document_intake_sender_routes r WHERE r.organization_id = m.organization_id
      AND r.sender_address = m.sender_address AND r.revoked_at IS NULL AND r.effective_from <= current_date;
  END IF;
  IF NOT haven.document_intake_allowed_mime(lower(p_payload->>'mime')) THEN RAISE EXCEPTION 'Unsupported part' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.document_intake_items (id, organization_id, facility_id, channel, message_id, original_filename, declared_mime, declared_size_bytes,
    declared_sha256, storage_path, sender_address, sender_authenticated, received_at, created_principal)
  VALUES (new_id, m.organization_id, route.facility_id, 'email', m.id, left(coalesce(nullif(btrim(p_payload->>'file_name'), ''), 'attachment'), 255),
    lower(p_payload->>'mime'), (p_payload->>'size_bytes')::integer, p_payload->>'sha256',
    format('%s/%s/%s/original', m.organization_id, coalesce(route.facility_id::text, 'unassigned'), new_id),
    m.sender_address, m.sender_authenticated, coalesce(m.received_at, now()), 'mail_receiver')
  RETURNING * INTO i;
  RETURN jsonb_build_object('item_id', i.id, 'path', i.storage_path, 'existing', false, 'verified', false);
END $$;

-- Mail receiver: an attested mail item is received and queued.
CREATE FUNCTION public.document_intake_worker_release_mail_item(p_item uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.document_intake_items;
BEGIN
  SELECT * INTO i FROM public.document_intake_items WHERE id = p_item AND channel = 'email' FOR UPDATE;
  IF NOT FOUND OR i.verified_sha256 IS NULL THEN RAISE EXCEPTION 'Mail item not verified' USING ERRCODE = '55000'; END IF;
  IF i.status <> 'receiving' THEN RETURN; END IF;
  UPDATE public.document_intake_items SET status = 'queued', revision = gen_random_uuid() WHERE id = i.id RETURNING * INTO i;
  PERFORM haven.document_intake_event(i, 'received', NULL, 'mail_receiver', jsonb_build_object('channel', 'email', 'message_id', i.message_id,
    'sender_authenticated', i.sender_authenticated, 'facility_known', i.facility_id IS NOT NULL));
  PERFORM haven.document_intake_queue_run(i, NULL, false);
END $$;

CREATE FUNCTION public.document_intake_worker_mailbox_state(p_mailbox uuid, p_folder text, p_cursor text, p_succeeded boolean, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.document_intake_mailboxes SET
    cursors = CASE WHEN p_succeeded AND p_cursor IS NOT NULL THEN cursors || jsonb_build_object(p_folder, p_cursor) ELSE cursors END,
    last_sync_succeeded_at = CASE WHEN p_succeeded THEN now() ELSE last_sync_succeeded_at END,
    last_error_code = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 120) END,
    last_error_at = CASE WHEN p_succeeded THEN last_error_at ELSE now() END,
    last_sync_started_at = now(), updated_at = now()
   WHERE id = p_mailbox;
END $$;

-- Operations summary for monitoring (DI-07): counts only, no content.
CREATE FUNCTION public.document_intake_operations_summary() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := haven.document_intake_actor(); org uuid := (a->>'org')::uuid; s public.document_intake_settings := haven.document_intake_settings_for(org);
BEGIN
  RETURN jsonb_build_object(
    'facilities', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT i.facility_id, count(*) FILTER (WHERE i.status IN ('pending_review','held')) AS pending,
        count(*) FILTER (WHERE i.status = 'needs_attention') AS needs_attention,
        count(*) FILTER (WHERE i.status IN ('queued','processing','receiving')) AS processing,
        count(*) FILTER (WHERE i.status IN ('pending_review','held','needs_attention') AND i.received_at < now() - make_interval(hours => s.pending_alert_hours)) AS overdue,
        count(*) FILTER (WHERE i.status IN ('pending_review','held','needs_attention') AND i.assigned_to IS NULL) AS unassigned,
        min(i.received_at) FILTER (WHERE i.status IN ('pending_review','held','needs_attention')) AS oldest_waiting
      FROM public.document_intake_items i
      WHERE i.organization_id = org AND i.deleted_at IS NULL AND haven.document_intake_item_visible(i)
      GROUP BY i.facility_id) x), '[]'::jsonb),
    'mailboxes', CASE WHEN haven.document_intake_can_view(org, NULL) THEN coalesce((SELECT jsonb_agg(jsonb_build_object('address', m.address, 'active', m.active,
        'last_sync_succeeded_at', m.last_sync_succeeded_at, 'last_error_code', m.last_error_code, 'last_error_at', m.last_error_at))
      FROM public.document_intake_mailboxes m WHERE m.organization_id = org), '[]'::jsonb) ELSE '[]'::jsonb END,
    'stuck_runs', (SELECT count(*) FROM public.document_intake_runs r WHERE r.organization_id = org AND r.state IN ('claimed','dispatched') AND r.lease_expires_at < now()),
    'pending_alert_hours', s.pending_alert_hours);
END $$;


-- COL-37 rulings (COL-391 probe): every definer RPC a person can call.
COMMENT ON FUNCTION public.document_intake_prepare_upload(uuid,jsonb) IS 'COL-771. COL-37 ruling: definer required; the caller has no INSERT on document_intake_items. Checks the organization upload roles and facility access, validates type/size/checksum, and is idempotent by request key.';
COMMENT ON FUNCTION public.document_intake_finalize_upload(uuid,uuid) IS 'COL-771. COL-37 ruling: definer required; only the uploader, after server byte attestation, moves the item to queued and queues processing.';
COMMENT ON FUNCTION public.document_intake_command(uuid,uuid,uuid,text,jsonb) IS 'COL-771. COL-37 ruling: definer required; review commands re-check item visibility and revision under a row lock, custodian-only commands check the custodian roles.';
COMMENT ON FUNCTION public.document_intake_prepare_split(uuid,uuid,uuid,jsonb,integer[]) IS 'COL-771. COL-37 ruling: definer required; creates child items for a visible multi-page PDF only when every page is placed exactly once or excluded.';
COMMENT ON FUNCTION public.document_intake_finalize_split(uuid,uuid,uuid) IS 'COL-771. COL-37 ruling: definer required; refuses until every child file is server-attested, then restricts the parent to custodians.';
COMMENT ON FUNCTION public.document_intake_prepare_filing(uuid,uuid,uuid,jsonb) IS 'COL-771. COL-37 ruling: definer required; checks catalog reviewer role and the destination domain authority (resident facility, benefits write grant, employee manager) before reserving one live filing per item.';
COMMENT ON FUNCTION public.document_intake_complete_filing(uuid,uuid) IS 'COL-771. COL-37 ruling: definer required; re-checks authority and item revision at approval, then writes exactly one destination record from a server-attested copy.';
COMMENT ON FUNCTION public.document_intake_abandon_filing(uuid) IS 'COL-771. COL-37 ruling: definer required; the approving person (or anyone after 15 minutes) may abandon a filing that never completed.';
COMMENT ON FUNCTION public.document_intake_correct_filing(uuid,uuid,text) IS 'COL-771. COL-37 ruling: definer required; withdraws a wrong destination record with a reason under the same destination authority and returns the document to review.';
COMMENT ON FUNCTION public.document_intake_operations_summary() IS 'COL-771. COL-37 ruling: definer required; returns counts only, filtered by the same item visibility as the read policies.';

-- ── Grants ──────────────────────────────────────────────────────────────────

DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.document_intake_prepare_upload(uuid,jsonb)',
    'public.document_intake_finalize_upload(uuid,uuid)',
    'public.document_intake_command(uuid,uuid,uuid,text,jsonb)',
    'public.document_intake_prepare_split(uuid,uuid,uuid,jsonb,integer[])',
    'public.document_intake_finalize_split(uuid,uuid,uuid)',
    'public.document_intake_prepare_filing(uuid,uuid,uuid,jsonb)',
    'public.document_intake_complete_filing(uuid,uuid)',
    'public.document_intake_abandon_filing(uuid)',
    'public.document_intake_correct_filing(uuid,uuid,text)',
    'public.document_intake_operations_summary()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'public.document_intake_attest_source(uuid,uuid,integer,text,text,integer)',
    'public.document_intake_declare_split_child(uuid,integer,text)',
    'public.document_intake_reject_source(uuid,text)',
    'public.document_intake_attest_filing_object(uuid,uuid,text)',
    'public.document_intake_worker_claim(text,integer)',
    'public.document_intake_worker_dispatch(uuid,uuid,text,text,text,jsonb)',
    'public.document_intake_worker_returned(uuid,uuid,jsonb)',
    'public.document_intake_worker_complete(uuid,uuid,jsonb)',
    'public.document_intake_worker_fail(uuid,uuid,text,boolean)',
    'public.document_intake_worker_subjects(uuid)',
    'public.document_intake_worker_record_message(uuid,jsonb)',
    'public.document_intake_worker_create_mail_item(uuid,jsonb)',
    'public.document_intake_worker_release_mail_item(uuid)',
    'public.document_intake_worker_mailbox_state(uuid,text,text,boolean,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
-- Internal haven helpers run only inside the definer RPCs above; the five
-- read helpers are also called by RLS policies, so authenticated needs them.
DO $$ DECLARE fn record; BEGIN
  FOR fn IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'haven' AND p.proname LIKE 'document_intake_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    IF fn.proname IN ('document_intake_settings_for','document_intake_can_view','document_intake_can_upload',
        'document_intake_item_visible','document_intake_item_visible_id','document_intake_has_role','document_intake_actor') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.sig);
    END IF;
  END LOOP;
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
