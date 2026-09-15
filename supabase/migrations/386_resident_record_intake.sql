BEGIN;

-- RRI-01: reviewed resident-record packet intake.  Intake evidence is kept
-- separate from canonical resident records until an attributable reviewer
-- applies an allowlisted fact or promotes an eligible source.

CREATE TYPE public.resident_record_intake_state AS ENUM (
  'draft','uploading','ready_to_parse','parsing','match_required','review','partially_applied','complete','cancelled'
);
CREATE TYPE public.resident_record_source_state AS ENUM (
  'prepared','finalized','ready_to_parse','parsing','review','quarantined','promoted','excluded','failed'
);
CREATE TYPE public.resident_record_source_class AS ENUM (
  'unclassified','resident','facility','employee','other_resident','credential_secret','unreadable','unsupported'
);
CREATE TYPE public.resident_record_page_disposition AS ENUM (
  'unknown','resident_eligible','excluded','quarantined','unreadable'
);
CREATE TYPE public.resident_record_fact_state AS ENUM (
  'proposed','approved','rejected','superseded','stale','applied'
);
CREATE TYPE public.resident_record_reviewer_class AS ENUM (
  'operational','clinical','payer','legal','authority'
);

CREATE OR REPLACE FUNCTION haven.resident_record_document_type_allowed(p_value text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
  SELECT p_value = ANY (ARRAY[
    'demographics_face_sheet','form_1823','photo_identification','insurance_card',
    'prescription_benefit_card','physician_orders_medication_list','advance_directive',
    'authority_instrument','admission_agreement','financial_agreement','arbitration',
    'resident_rights','hipaa_privacy','photo_release','secured_environment_acknowledgment',
    'medication_assistance_consent','behavioral_health_consent_referral',
    'provider_enrollment_consent','resident_screening','dietary_evaluation','tb_screening',
    'care_plan_service_plan_acknowledgment','other_resident_evidence'
  ])
$function$;

CREATE OR REPLACE FUNCTION haven.resident_record_field_allowed(p_value text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
  SELECT p_value = ANY (ARRAY[
    'resident.first_name','resident.middle_name','resident.last_name','resident.preferred_name',
    'resident.date_of_birth','resident.gender','resident.ssn_last_four',
    'resident.primary_physician_name','resident.primary_physician_phone','resident.primary_physician_fax',
    'resident.primary_diagnosis','resident.diagnosis_list','resident.allergy_list',
    'resident.diet_order','resident.diet_restrictions','resident.code_status','resident.ambulatory',
    'resident.assistive_device','resident.fall_risk_level','resident.elopement_risk',
    'resident.wandering_risk','resident.smoking_status','resident.primary_payer',
    'resident.contact','resident.assessment','resident.payer','resident.advance_directive',
    'resident.profile_fact','resident.authority_instrument','resident.pharmacy_benefit',
    'resident.screening','resident.provider_referral','resident.contract',
    'resident.medication_order','admission.form_1823','admission.checklist_evidence','resident.room_evidence',
    'resident.admission_date_evidence'
  ])
$function$;

REVOKE ALL ON FUNCTION haven.resident_record_document_type_allowed(text),
  haven.resident_record_field_allowed(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.resident_record_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid REFERENCES public.residents(id),
  admission_case_id uuid REFERENCES public.admission_cases(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  state public.resident_record_intake_state NOT NULL DEFAULT 'draft',
  parser_state text NOT NULL DEFAULT 'not_started'
    CHECK (parser_state IN ('not_started','ready','running','retryable','failed','complete','manual_only')),
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  source_count integer NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  finalized_source_count integer NOT NULL DEFAULT 0 CHECK (finalized_source_count >= 0),
  quarantined_source_count integer NOT NULL DEFAULT 0 CHECK (quarantined_source_count >= 0),
  applied_fact_count integer NOT NULL DEFAULT 0 CHECK (applied_fact_count >= 0),
  created_by uuid NOT NULL REFERENCES public.user_profiles(id),
  reviewed_by uuid REFERENCES public.user_profiles(id),
  reviewed_at timestamptz,
  completed_by uuid REFERENCES public.user_profiles(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK ((state='complete') = (completed_at IS NOT NULL AND completed_by IS NOT NULL)),
  CHECK (admission_case_id IS NULL OR resident_id IS NOT NULL),
  UNIQUE (organization_id,id,facility_id)
);

CREATE INDEX idx_resident_record_intakes_facility_state
  ON public.resident_record_intakes(facility_id,state,updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_record_intakes_resident
  ON public.resident_record_intakes(resident_id,updated_at DESC) WHERE deleted_at IS NULL AND resident_id IS NOT NULL;
CREATE INDEX idx_resident_record_intakes_case
  ON public.resident_record_intakes(admission_case_id,updated_at DESC) WHERE deleted_at IS NULL AND admission_case_id IS NOT NULL;

CREATE TABLE public.resident_record_intake_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.resident_record_intakes(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  source_order integer NOT NULL CHECK (source_order > 0),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 255),
  original_filename text NOT NULL CHECK (length(btrim(original_filename)) BETWEEN 1 AND 255),
  declared_mime text NOT NULL CHECK (declared_mime IN (
    'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
    'image/heic-sequence','image/heif-sequence'
  )),
  declared_size_bytes integer NOT NULL CHECK (declared_size_bytes BETWEEN 1 AND 20971520),
  declared_sha256 text NOT NULL CHECK (declared_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text NOT NULL UNIQUE,
  state public.resident_record_source_state NOT NULL DEFAULT 'prepared',
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  object_id uuid,
  object_version text,
  object_etag text,
  verified_mime text,
  verified_size_bytes integer,
  verified_sha256 text,
  verified_md5 text,
  finalized_at timestamptz,
  source_class public.resident_record_source_class NOT NULL DEFAULT 'unclassified',
  document_type text CHECK (document_type IS NULL OR haven.resident_record_document_type_allowed(document_type)),
  classification_confidence numeric(5,4) CHECK (classification_confidence BETWEEN 0 AND 1),
  classification_reason_code text,
  preflight_state text NOT NULL DEFAULT 'needs_confirmation'
    CHECK (preflight_state IN ('needs_confirmation','safe','credential_detected','overridden','not_applicable')),
  credential_pattern_codes text[] NOT NULL DEFAULT '{}',
  credential_quarantined boolean NOT NULL DEFAULT false,
  quarantine_reason_code text,
  safe_confirmed_by uuid REFERENCES public.user_profiles(id),
  safe_confirmed_at timestamptz,
  page_count integer CHECK (page_count > 0),
  canonical_document_id uuid REFERENCES public.resident_documents(id),
  promotion_mode text CHECK (promotion_mode IS NULL OR promotion_mode IN ('add','replace')),
  supersedes_source_id uuid REFERENCES public.resident_record_intake_sources(id),
  supersedes_document_id uuid REFERENCES public.resident_documents(id),
  parser_metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(parser_metadata)='object'),
  uploaded_by uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK ((state='prepared' AND finalized_at IS NULL AND object_id IS NULL AND verified_sha256 IS NULL)
      OR state<>'prepared'),
  CHECK (finalized_at IS NULL OR (
    object_id IS NOT NULL AND object_version IS NOT NULL AND object_etag IS NOT NULL
    AND verified_mime=declared_mime AND verified_size_bytes=declared_size_bytes
    AND verified_sha256=declared_sha256 AND verified_md5 ~ '^[0-9a-f]{32}$'
  )),
  CHECK (NOT credential_quarantined OR source_class='credential_secret'),
  CHECK (canonical_document_id IS NULL OR state='promoted'),
  UNIQUE (intake_id,source_order),
  UNIQUE (organization_id,id,facility_id)
);

CREATE INDEX idx_resident_record_sources_intake
  ON public.resident_record_intake_sources(intake_id,source_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_record_sources_state
  ON public.resident_record_intake_sources(facility_id,state,updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE public.resident_record_intake_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.resident_record_intakes(id),
  source_id uuid NOT NULL REFERENCES public.resident_record_intake_sources(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  page_number integer NOT NULL CHECK (page_number > 0),
  source_class public.resident_record_source_class NOT NULL DEFAULT 'unclassified',
  document_type text CHECK (document_type IS NULL OR haven.resident_record_document_type_allowed(document_type)),
  disposition public.resident_record_page_disposition NOT NULL DEFAULT 'unknown',
  confidence numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  reason_code text,
  parse_run_id uuid,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  UNIQUE (source_id,page_number)
);

CREATE TABLE public.resident_record_parse_runs (
  id uuid PRIMARY KEY,
  intake_id uuid NOT NULL REFERENCES public.resident_record_intakes(id),
  source_id uuid NOT NULL REFERENCES public.resident_record_intake_sources(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 160),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 80),
  model text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 160),
  model_version text,
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^[0-9a-f]{64}$'),
  response_hash text CHECK (response_hash IS NULL OR response_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('running','succeeded','failed','authorization_changed','quarantined')),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,80}$'),
  requested_by uuid NOT NULL REFERENCES public.user_profiles(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (requested_by,request_key)
);

CREATE TABLE public.resident_record_extracted_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.resident_record_intakes(id),
  source_id uuid NOT NULL REFERENCES public.resident_record_intake_sources(id),
  parse_run_id uuid REFERENCES public.resident_record_parse_runs(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  fact_key uuid NOT NULL DEFAULT gen_random_uuid(),
  fact_version integer NOT NULL DEFAULT 1 CHECK (fact_version > 0),
  field_code text NOT NULL CHECK (haven.resident_record_field_allowed(field_code)),
  domain text NOT NULL CHECK (domain IN ('demographics','clinical','payer','legal','authority','admission','contact','screening')),
  structured_value jsonb NOT NULL,
  display_value text NOT NULL CHECK (length(display_value) BETWEEN 1 AND 2000),
  source_page_start integer CHECK (source_page_start > 0),
  source_page_end integer CHECK (source_page_end >= source_page_start),
  confidence numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  current_value_fingerprint text NOT NULL CHECK (current_value_fingerprint ~ '^[0-9a-f]{64}$'),
  conflict boolean NOT NULL DEFAULT false,
  conflict_code text,
  required_reviewer public.resident_record_reviewer_class NOT NULL,
  state public.resident_record_fact_state NOT NULL DEFAULT 'proposed',
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  corrected_fact_id uuid REFERENCES public.resident_record_extracted_facts(id),
  proposal_origin text NOT NULL CHECK (proposal_origin IN ('provider','manual','reviewer_correction')),
  proposed_by uuid REFERENCES public.user_profiles(id),
  reviewed_by uuid REFERENCES public.user_profiles(id),
  reviewed_at timestamptz,
  review_reason text,
  applied_destination text,
  applied_record_id uuid,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (fact_key,fact_version),
  CHECK ((state IN ('approved','rejected','superseded','stale','applied')) = (reviewed_at IS NOT NULL)),
  CHECK ((state='applied') = (applied_at IS NOT NULL AND applied_destination IS NOT NULL AND applied_record_id IS NOT NULL))
);

CREATE INDEX idx_resident_record_facts_intake_state
  ON public.resident_record_extracted_facts(intake_id,state,created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_record_facts_source
  ON public.resident_record_extracted_facts(source_id,source_page_start) WHERE deleted_at IS NULL;

CREATE TABLE public.resident_record_intake_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.resident_record_intakes(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  candidate_kind text NOT NULL CHECK (candidate_kind IN ('resident','referral','provisional_new','no_match')),
  candidate_resident_id uuid REFERENCES public.residents(id),
  candidate_referral_id uuid REFERENCES public.referral_leads(id),
  match_basis text[] NOT NULL DEFAULT '{}',
  confidence numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  disposition text NOT NULL CHECK (disposition IN ('proposed','confirmed','rejected','duplicate_reviewed','created_provisional')),
  reason text,
  proposed_by text NOT NULL CHECK (proposed_by IN ('provider','deterministic','reviewer')),
  reviewed_by uuid REFERENCES public.user_profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (num_nonnulls(candidate_resident_id,candidate_referral_id) <= 1),
  CHECK ((disposition IN ('confirmed','rejected','duplicate_reviewed','created_provisional')) = (reviewed_at IS NOT NULL))
);

CREATE UNIQUE INDEX idx_resident_record_match_selected
  ON public.resident_record_intake_matches(intake_id)
  WHERE deleted_at IS NULL AND disposition IN ('confirmed','created_provisional');

CREATE TABLE public.resident_record_fact_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.resident_record_intakes(id),
  fact_id uuid REFERENCES public.resident_record_extracted_facts(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  event_type text NOT NULL CHECK (event_type IN (
    'proposed','approved','rejected','corrected','superseded','stale_target','applied','application_failed'
  )),
  fact_revision uuid,
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.resident_record_application_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.resident_record_intakes(id),
  fact_id uuid NOT NULL REFERENCES public.resident_record_extracted_facts(id),
  fact_revision uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  request_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  before_fingerprint text NOT NULL CHECK (before_fingerprint ~ '^[0-9a-f]{64}$'),
  after_fingerprint text CHECK (after_fingerprint IS NULL OR after_fingerprint ~ '^[0-9a-f]{64}$'),
  destination_type text NOT NULL,
  destination_id uuid,
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  result text NOT NULL CHECK (result IN ('applied','stale_target','rejected','failed')),
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (actor_id,request_key)
);

CREATE TABLE haven.resident_record_intake_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  intake_id uuid,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 160),
  operation text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id,request_key)
);

CREATE TABLE haven.resident_record_intake_byte_attestations (
  source_id uuid NOT NULL REFERENCES public.resident_record_intake_sources(id),
  object_id uuid NOT NULL,
  object_version text NOT NULL,
  object_etag text NOT NULL CHECK (object_etag ~ '^[0-9a-f]{32,64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  mime text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  md5 text NOT NULL CHECK (md5 ~ '^[0-9a-f]{32}$'),
  uploader_id uuid NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_id,object_id,object_version,object_etag)
);

ALTER TABLE haven.resident_record_intake_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.resident_record_intake_byte_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.resident_record_intake_requests,
  haven.resident_record_intake_byte_attestations FROM PUBLIC,anon,authenticated,service_role;

-- Controlled destinations for facts that do not belong on residents.
CREATE TABLE public.resident_profile_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  category text NOT NULL CHECK (category IN ('identity','clinical','preference','safety','admission','other')),
  field_code text NOT NULL CHECK (field_code ~ '^[a-z][a-z0-9_.]{1,79}$'),
  structured_value jsonb NOT NULL,
  display_value text NOT NULL,
  source_document_id uuid REFERENCES public.resident_documents(id),
  source_intake_fact_id uuid UNIQUE REFERENCES public.resident_record_extracted_facts(id),
  effective_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz
);

CREATE TABLE public.resident_authority_instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  instrument_type text NOT NULL CHECK (instrument_type IN ('healthcare_proxy','durable_power_of_attorney','guardianship','representative_payee','ssa_787','other')),
  holder_contact_id uuid REFERENCES public.resident_contacts(id),
  holder_name text NOT NULL CHECK (btrim(holder_name)<>''),
  holder_relationship text,
  authority_scope text[] NOT NULL CHECK (cardinality(authority_scope)>0),
  scope_text text,
  status text NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','under_review','verified','expired','revoked','disputed')),
  effective_date date,
  expiration_date date,
  reviewed_by uuid REFERENCES public.user_profiles(id),
  reviewed_at timestamptz,
  source_document_id uuid REFERENCES public.resident_documents(id),
  source_intake_fact_id uuid UNIQUE REFERENCES public.resident_record_extracted_facts(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK (expiration_date IS NULL OR effective_date IS NULL OR expiration_date >= effective_date)
);

CREATE TABLE public.resident_pharmacy_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  payer_id uuid REFERENCES public.resident_payers(id),
  plan_name text,
  member_id text,
  bin text,
  pcn text,
  group_number text,
  effective_date date,
  end_date date,
  source_document_id uuid REFERENCES public.resident_documents(id),
  source_intake_fact_id uuid UNIQUE REFERENCES public.resident_record_extracted_facts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK (end_date IS NULL OR effective_date IS NULL OR end_date >= effective_date)
);

CREATE TABLE public.resident_screening_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  screening_type text NOT NULL CHECK (screening_type IN ('background_registry','sex_offender_registry','tb','behavioral_health','admission','other')),
  result text NOT NULL CHECK (result IN ('clear','potential_match','match','inconclusive','not_reviewed')),
  searched_on date,
  reviewed_by uuid NOT NULL REFERENCES public.user_profiles(id),
  reviewed_at timestamptz NOT NULL,
  source_document_id uuid REFERENCES public.resident_documents(id),
  source_intake_fact_id uuid UNIQUE REFERENCES public.resident_record_extracted_facts(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz
);

CREATE TABLE public.resident_provider_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  referral_type text NOT NULL CHECK (referral_type IN ('behavioral_health','primary_care','specialist','therapy','hospice','home_health','other')),
  provider_name text NOT NULL,
  provider_phone text,
  referred_on date,
  status text NOT NULL DEFAULT 'documented' CHECK (status IN ('documented','pending','accepted','declined','completed','cancelled')),
  source_document_id uuid REFERENCES public.resident_documents(id),
  source_intake_fact_id uuid UNIQUE REFERENCES public.resident_record_extracted_facts(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz
);

CREATE INDEX idx_resident_profile_facts_resident ON public.resident_profile_facts(resident_id,field_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_authority_instruments_resident ON public.resident_authority_instruments(resident_id,status) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_pharmacy_benefits_resident ON public.resident_pharmacy_benefits(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_screening_records_resident ON public.resident_screening_records(resident_id,screening_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_provider_referrals_resident ON public.resident_provider_referrals(resident_id,status) WHERE deleted_at IS NULL;

-- Source lineage on existing canonical destinations.
ALTER TABLE public.resident_documents
  ADD COLUMN storage_bucket text NOT NULL DEFAULT 'resident-documents',
  ADD COLUMN resident_record_intake_id uuid REFERENCES public.resident_record_intakes(id),
  ADD COLUMN resident_record_intake_source_id uuid UNIQUE REFERENCES public.resident_record_intake_sources(id),
  ADD COLUMN resident_record_intake_fact_id uuid REFERENCES public.resident_record_extracted_facts(id),
  ADD COLUMN supersedes_document_id uuid REFERENCES public.resident_documents(id),
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN superseded_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN is_current boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT resident_documents_supersession_check CHECK (
    (is_current AND superseded_at IS NULL AND superseded_by IS NULL)
    OR (NOT is_current AND superseded_at IS NOT NULL AND superseded_by IS NOT NULL)
  );

ALTER TABLE public.resident_contacts
  ADD COLUMN source_resident_document_id uuid REFERENCES public.resident_documents(id),
  ADD COLUMN source_intake_fact_id uuid UNIQUE REFERENCES public.resident_record_extracted_facts(id);
ALTER TABLE public.assessments
  ADD COLUMN source_resident_document_id uuid REFERENCES public.resident_documents(id),
  ADD COLUMN source_intake_fact_id uuid UNIQUE REFERENCES public.resident_record_extracted_facts(id);
ALTER TABLE public.resident_payers
  ADD COLUMN source_resident_document_id uuid REFERENCES public.resident_documents(id),
  ADD COLUMN source_intake_fact_id uuid UNIQUE REFERENCES public.resident_record_extracted_facts(id);
ALTER TABLE public.advance_directive_documents
  ADD COLUMN source_resident_document_id uuid REFERENCES public.resident_documents(id),
  ADD COLUMN source_intake_fact_id uuid UNIQUE REFERENCES public.resident_record_extracted_facts(id);
ALTER TABLE public.resident_contracts
  ADD COLUMN source_intake_fact_id uuid UNIQUE REFERENCES public.resident_record_extracted_facts(id);
ALTER TABLE public.admission_document_checklist_items
  ADD COLUMN resident_document_id uuid REFERENCES public.resident_documents(id),
  ADD COLUMN source_intake_fact_id uuid REFERENCES public.resident_record_extracted_facts(id);

ALTER TABLE public.form_1823_records
  ADD COLUMN form_schema_version text NOT NULL DEFAULT '2021-04',
  ADD COLUMN form_version integer NOT NULL DEFAULT 1 CHECK (form_version > 0),
  ADD COLUMN supersedes_form_1823_id uuid REFERENCES public.form_1823_records(id),
  ADD COLUMN is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN representative_name text,
  ADD COLUMN representative_relationship text,
  ADD COLUMN representative_phone text,
  ADD COLUMN allergies text[],
  ADD COLUMN height_inches numeric(5,2),
  ADD COLUMN weight_lbs numeric(6,2),
  ADD COLUMN medical_history jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN physical_limitations jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN cognitive_behavioral_status jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN service_requirements jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN precautions jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN elopement_risk boolean,
  ADD COLUMN adl_bathing text,
  ADD COLUMN adl_dressing text,
  ADD COLUMN adl_eating text,
  ADD COLUMN adl_transferring text,
  ADD COLUMN adl_toileting text,
  ADD COLUMN adl_grooming text,
  ADD COLUMN adl_walking text,
  ADD COLUMN prescribed_diet text,
  ADD COLUMN condition_communicable_disease boolean,
  ADD COLUMN condition_bedridden boolean,
  ADD COLUMN condition_pressure_injury boolean,
  ADD COLUMN condition_tuberculosis boolean,
  ADD COLUMN condition_special_precautions boolean,
  ADD COLUMN alf_care_appropriate boolean,
  ADD COLUMN medication_assistance text,
  ADD COLUMN examiner_license_number text,
  ADD COLUMN examiner_license_type text,
  ADD COLUMN examiner_title text,
  ADD COLUMN examiner_phone text,
  ADD COLUMN examiner_address text,
  ADD COLUMN examiner_signature_date date,
  ADD COLUMN source_resident_document_id uuid REFERENCES public.resident_documents(id),
  ADD COLUMN source_page_numbers integer[],
  ADD COLUMN source_intake_fact_id uuid UNIQUE REFERENCES public.resident_record_extracted_facts(id),
  ADD CONSTRAINT form_1823_adl_values_check CHECK (
    adl_bathing IS NULL OR adl_bathing IN ('independent','supervision','assistance','dependent','not_assessed')
  ),
  ADD CONSTRAINT form_1823_adl_dressing_values_check CHECK (
    adl_dressing IS NULL OR adl_dressing IN ('independent','supervision','assistance','dependent','not_assessed')
  ),
  ADD CONSTRAINT form_1823_adl_eating_values_check CHECK (
    adl_eating IS NULL OR adl_eating IN ('independent','supervision','assistance','dependent','not_assessed')
  ),
  ADD CONSTRAINT form_1823_adl_transferring_values_check CHECK (
    adl_transferring IS NULL OR adl_transferring IN ('independent','supervision','assistance','dependent','not_assessed')
  ),
  ADD CONSTRAINT form_1823_adl_toileting_values_check CHECK (
    adl_toileting IS NULL OR adl_toileting IN ('independent','supervision','assistance','dependent','not_assessed')
  ),
  ADD CONSTRAINT form_1823_adl_grooming_values_check CHECK (
    adl_grooming IS NULL OR adl_grooming IN ('independent','supervision','assistance','dependent','not_assessed')
  ),
  ADD CONSTRAINT form_1823_adl_walking_values_check CHECK (
    adl_walking IS NULL OR adl_walking IN ('independent','supervision','assistance','dependent','not_assessed')
  );

ALTER TYPE public.admission_document_type ADD VALUE IF NOT EXISTS 'secured_environment_acknowledgment';
ALTER TYPE public.admission_document_type ADD VALUE IF NOT EXISTS 'photo_consent';
ALTER TYPE public.admission_document_type ADD VALUE IF NOT EXISTS 'medication_assistance_consent';
ALTER TYPE public.admission_document_type ADD VALUE IF NOT EXISTS 'provider_enrollment';
ALTER TYPE public.admission_document_type ADD VALUE IF NOT EXISTS 'behavioral_health_referral';
ALTER TYPE public.admission_document_type ADD VALUE IF NOT EXISTS 'registry_screening';
ALTER TYPE public.admission_document_type ADD VALUE IF NOT EXISTS 'directive_cover_sheet';

ALTER TABLE public.resident_contracts DROP CONSTRAINT resident_contracts_contract_type_check;
ALTER TABLE public.resident_contracts ADD CONSTRAINT resident_contracts_contract_type_check CHECK (contract_type IN (
  'admission_agreement','financial_agreement','arbitration_agreement','resident_rights_acknowledgment',
  'hipaa_privacy_consent','service_plan_acknowledgment','medicaid_assignment','photo_release',
  'secured_environment_acknowledgment','medication_assistance_consent','provider_enrollment_consent',
  'behavioral_health_consent','directive_cover_sheet','other'
));

-- Inquiry residents may truthfully retain unknown clinical and payer fields.
ALTER TABLE public.residents
  ALTER COLUMN code_status DROP NOT NULL,
  ALTER COLUMN code_status DROP DEFAULT,
  ALTER COLUMN ambulatory DROP NOT NULL,
  ALTER COLUMN ambulatory DROP DEFAULT,
  ALTER COLUMN elopement_risk DROP NOT NULL,
  ALTER COLUMN elopement_risk DROP DEFAULT,
  ALTER COLUMN wandering_risk DROP NOT NULL,
  ALTER COLUMN wandering_risk DROP DEFAULT,
  ALTER COLUMN fall_risk_level DROP DEFAULT,
  ALTER COLUMN smoking_status DROP DEFAULT,
  ALTER COLUMN primary_payer DROP NOT NULL,
  ALTER COLUMN primary_payer DROP DEFAULT;

CREATE OR REPLACE FUNCTION haven.guard_resident_activation_review()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
BEGIN
  IF NEW.status IN ('active','hospital_hold','loa')
     AND EXISTS(SELECT 1 FROM public.resident_record_intake_matches m
       WHERE m.candidate_resident_id=NEW.id AND m.disposition='created_provisional' AND m.deleted_at IS NULL)
     AND (TG_OP='INSERT'
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.code_status IS DISTINCT FROM NEW.code_status
       OR OLD.ambulatory IS DISTINCT FROM NEW.ambulatory
       OR OLD.elopement_risk IS DISTINCT FROM NEW.elopement_risk
       OR OLD.wandering_risk IS DISTINCT FROM NEW.wandering_risk
       OR OLD.fall_risk_level IS DISTINCT FROM NEW.fall_risk_level
       OR OLD.smoking_status IS DISTINCT FROM NEW.smoking_status
       OR OLD.primary_payer IS DISTINCT FROM NEW.primary_payer)
     AND num_nulls(NEW.code_status,NEW.ambulatory,NEW.elopement_risk,NEW.wandering_risk,
       NEW.fall_risk_level,NEW.smoking_status,NEW.primary_payer) > 0 THEN
    RAISE EXCEPTION 'Clinical and payer fields require review before resident activation'
      USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION haven.guard_resident_activation_review() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS tr_resident_activation_review ON public.residents;
CREATE TRIGGER tr_resident_activation_review
  BEFORE INSERT OR UPDATE OF status,code_status,ambulatory,elopement_risk,wandering_risk,
    fall_risk_level,smoking_status,primary_payer ON public.residents
  FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_activation_review();

CREATE OR REPLACE FUNCTION haven.resident_record_intake_scope(p_intake_id uuid,p_write boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE v public.resident_record_intakes; a record;
BEGIN
  SELECT * INTO a FROM haven.current_authorized_actor() WHERE actor_is_managed LIMIT 1;
  IF a.actor_user_id IS NULL OR a.actor_role_text NOT IN ('owner','org_admin','facility_admin','nurse') THEN
    RAISE EXCEPTION 'Resident intake scope unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v FROM public.resident_record_intakes WHERE id=p_intake_id AND deleted_at IS NULL;
  IF NOT FOUND OR v.organization_id IS DISTINCT FROM a.actor_organization_id
     OR NOT haven.has_facility_access(v.facility_id) THEN
    RAISE EXCEPTION 'Resident intake scope unavailable' USING ERRCODE='42501';
  END IF;
  IF v.resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.residents r WHERE r.id=v.resident_id
      AND r.organization_id=v.organization_id AND r.facility_id=v.facility_id AND r.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Resident intake scope unavailable' USING ERRCODE='42501'; END IF;
  IF v.admission_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.admission_cases c WHERE c.id=v.admission_case_id
      AND c.organization_id=v.organization_id AND c.facility_id=v.facility_id
      AND c.resident_id=v.resident_id AND c.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Resident intake scope unavailable' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('actor_id',a.actor_user_id,'organization_id',v.organization_id,
    'facility_id',v.facility_id,'role',a.actor_role_text,'resident_id',v.resident_id,
    'admission_case_id',v.admission_case_id,'revision',v.revision,'state',v.state);
END
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_intake_scope(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION haven.resident_record_intake_can_read(p_organization_id uuid,p_facility_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT coalesce(haven.organization_id()=p_organization_id
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
    AND haven.has_facility_access(p_facility_id),false)
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_intake_can_read(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_record_intake_can_read(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION haven.resident_record_reviewer_allowed(p_class public.resident_record_reviewer_class)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT CASE p_class
    WHEN 'clinical' THEN haven.app_role()='nurse'
    WHEN 'payer' THEN haven.app_role() IN ('owner','org_admin','facility_admin')
    WHEN 'legal' THEN haven.app_role() IN ('owner','org_admin','facility_admin')
    WHEN 'authority' THEN haven.app_role() IN ('owner','org_admin','facility_admin')
    ELSE haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
  END
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_reviewer_allowed(public.resident_record_reviewer_class)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_record_reviewer_allowed(public.resident_record_reviewer_class)
  TO authenticated;

CREATE OR REPLACE FUNCTION haven.resident_record_expected_reviewer(p_field_code text)
RETURNS public.resident_record_reviewer_class LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
  SELECT CASE
    WHEN p_field_code IN ('resident.payer','resident.pharmacy_benefit','resident.primary_payer')
      THEN 'payer'::public.resident_record_reviewer_class
    WHEN p_field_code IN ('resident.contract')
      THEN 'legal'::public.resident_record_reviewer_class
    WHEN p_field_code IN ('resident.authority_instrument')
      THEN 'authority'::public.resident_record_reviewer_class
    WHEN p_field_code IN ('resident.primary_diagnosis','resident.diagnosis_list','resident.allergy_list',
      'resident.diet_order','resident.diet_restrictions','resident.code_status','resident.ambulatory',
      'resident.assistive_device','resident.fall_risk_level','resident.elopement_risk',
      'resident.wandering_risk','resident.smoking_status','resident.assessment',
      'resident.advance_directive','resident.medication_order','admission.form_1823')
      THEN 'clinical'::public.resident_record_reviewer_class
    ELSE 'operational'::public.resident_record_reviewer_class
  END
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_expected_reviewer(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION haven.resident_record_payload_safe(p_payload jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
  SELECT p_payload IS NOT NULL
    AND p_payload::text !~* '(-----BEGIN[[:space:]]+(RSA |EC |OPENSSH )?PRIVATE KEY-----|api[_ -]?key[[:space:]]*[:=]|secret[_ -]?key[[:space:]]*[:=]|password[[:space:]]*[:=])'
    AND p_payload::text !~ '(^|[^0-9])[0-9]{3}-?[0-9]{2}-?[0-9]{4}([^0-9]|$)'
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_payload_safe(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION haven.guard_resident_record_controlled_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN
    RAISE EXCEPTION 'Resident intake mutations require a reviewed command' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Resident intake records use retained history' USING ERRCODE='42501'; END IF;
  IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'Resident intake history cannot be truncated' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION haven.guard_resident_record_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
BEGIN
  IF TG_OP='INSERT' AND current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Resident intake evidence history is immutable' USING ERRCODE='42501';
END
$function$;
REVOKE ALL ON FUNCTION haven.guard_resident_record_controlled_mutation(),
  haven.guard_resident_record_immutable() FROM PUBLIC,anon,authenticated,service_role;

DO $do$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'resident_record_intakes','resident_record_intake_sources','resident_record_intake_pages',
    'resident_record_parse_runs','resident_record_extracted_facts','resident_profile_facts',
    'resident_authority_instruments','resident_pharmacy_benefits','resident_screening_records',
    'resident_provider_referrals'
  ] LOOP
    EXECUTE format('CREATE TRIGGER tr_%I_controlled BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_record_controlled_mutation()',v_table,v_table);
    EXECUTE format('CREATE TRIGGER tr_%I_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_resident_record_controlled_mutation()',v_table,v_table);
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY['resident_record_intake_matches','resident_record_fact_events','resident_record_application_receipts'] LOOP
    EXECUTE format('CREATE TRIGGER tr_%I_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_record_immutable()',v_table,v_table);
    EXECUTE format('CREATE TRIGGER tr_%I_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_resident_record_immutable()',v_table,v_table);
  END LOOP;
END
$do$;

DO $do$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'resident_record_intakes','resident_record_intake_sources','resident_profile_facts',
    'resident_authority_instruments','resident_pharmacy_benefits','resident_screening_records',
    'resident_provider_referrals'
  ] LOOP
    EXECUTE format('CREATE TRIGGER tr_%I_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at()',v_table,v_table);
  END LOOP;
END
$do$;

DO $do$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'resident_record_intakes','resident_record_intake_sources','resident_record_intake_pages',
    'resident_record_parse_runs','resident_record_extracted_facts','resident_record_intake_matches',
    'resident_record_fact_events','resident_record_application_receipts','resident_profile_facts',
    'resident_authority_instruments','resident_pharmacy_benefits','resident_screening_records',
    'resident_provider_referrals'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (haven.resident_record_intake_can_read(organization_id,facility_id) AND deleted_at IS NULL)',v_table||'_read',v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated,service_role',v_table);
    EXECUTE format('CREATE TRIGGER tr_%I_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log()',v_table,v_table);
  END LOOP;
END
$do$;

DROP POLICY resident_pharmacy_benefits_read ON public.resident_pharmacy_benefits;
CREATE POLICY resident_pharmacy_benefits_read ON public.resident_pharmacy_benefits FOR SELECT TO authenticated
USING (organization_id=haven.organization_id() AND facility_id IN(SELECT haven.accessible_facility_ids())
  AND haven.app_role() IN ('owner','org_admin','facility_admin') AND deleted_at IS NULL);

-- Private immutable packet storage.  Path authorization is derived from the
-- prepared source row, never from an arbitrary folder name.
CREATE OR REPLACE FUNCTION haven.resident_record_intake_storage_access(
  p_bucket text,p_path text,p_write boolean,p_object_id uuid DEFAULT NULL,
  p_version text DEFAULT NULL,p_etag text DEFAULT NULL,p_size integer DEFAULT NULL,p_mime text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE s public.resident_record_intake_sources; c jsonb;
BEGIN
  IF p_bucket<>'resident-intake-sources' THEN RETURN false; END IF;
  SELECT * INTO s FROM public.resident_record_intake_sources
    WHERE storage_path=p_path AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  c:=haven.resident_record_intake_scope(s.intake_id,p_write);
  IF p_write THEN
    RETURN s.state='prepared' AND s.uploaded_by=(c->>'actor_id')::uuid;
  END IF;
  IF s.credential_quarantined AND c->>'role' NOT IN ('owner','org_admin') THEN RETURN false; END IF;
  IF s.state='prepared' THEN RETURN s.uploaded_by=(c->>'actor_id')::uuid; END IF;
  RETURN (p_object_id,p_version,p_etag,p_size,p_mime)
    IS NOT DISTINCT FROM (s.object_id,s.object_version,s.object_etag,s.verified_size_bytes,s.verified_mime);
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_intake_storage_access(text,text,boolean,uuid,text,text,integer,text)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_record_intake_storage_access(text,text,boolean,uuid,text,text,integer,text)
  TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('resident-intake-sources','resident-intake-sources',false,20971520,ARRAY[
  'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
  'image/heic-sequence','image/heif-sequence'
]) ON CONFLICT(id) DO NOTHING;
DO $do$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='resident-intake-sources'
    AND public=false AND file_size_limit=20971520) THEN
    RAISE EXCEPTION 'Existing resident intake bucket configuration is incompatible';
  END IF;
END $do$;

CREATE POLICY resident_intake_source_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='resident-intake-sources' AND haven.resident_record_intake_storage_access(
  bucket_id,name,false,id,version,lower(trim(both '"' from metadata->>'eTag')),
  CASE WHEN metadata->>'size' ~ '^[0-9]{1,9}$' THEN (metadata->>'size')::integer END,metadata->>'mimetype'));
CREATE POLICY resident_intake_source_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='resident-intake-sources' AND haven.resident_record_intake_storage_access(bucket_id,name,true));
CREATE POLICY resident_intake_source_read_boundary ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING (bucket_id<>'resident-intake-sources' OR haven.resident_record_intake_storage_access(
  bucket_id,name,false,id,version,lower(trim(both '"' from metadata->>'eTag')),
  CASE WHEN metadata->>'size' ~ '^[0-9]{1,9}$' THEN (metadata->>'size')::integer END,metadata->>'mimetype'));
CREATE POLICY resident_intake_source_insert_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (bucket_id<>'resident-intake-sources' OR haven.resident_record_intake_storage_access(bucket_id,name,true));
CREATE POLICY resident_intake_source_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
USING (bucket_id<>'resident-intake-sources') WITH CHECK (bucket_id<>'resident-intake-sources');
CREATE POLICY resident_intake_source_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
USING (bucket_id<>'resident-intake-sources');

CREATE OR REPLACE FUNCTION public.prepare_resident_record_intake(
  p_request_key text,p_facility_id uuid,p_title text,p_resident_id uuid DEFAULT NULL,
  p_admission_case_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE a record; v public.resident_record_intakes; q haven.resident_record_intake_requests;
  h text; response jsonb;
BEGIN
  SELECT * INTO a FROM haven.current_authorized_actor() WHERE actor_is_managed LIMIT 1;
  IF a.actor_user_id IS NULL OR a.actor_role_text NOT IN ('owner','org_admin','facility_admin','nurse')
     OR NOT haven.has_facility_access(p_facility_id) THEN
    RAISE EXCEPTION 'Resident intake scope unavailable' USING ERRCODE='42501';
  END IF;
  IF p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' OR length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Valid request key and intake title are required' USING ERRCODE='22023';
  END IF;
  IF p_resident_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.residents r WHERE r.id=p_resident_id
      AND r.organization_id=a.actor_organization_id AND r.facility_id=p_facility_id AND r.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Resident intake scope unavailable' USING ERRCODE='42501';
  END IF;
  IF p_admission_case_id IS NOT NULL AND (p_resident_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.admission_cases c
      WHERE c.id=p_admission_case_id AND c.organization_id=a.actor_organization_id
      AND c.facility_id=p_facility_id AND c.resident_id=p_resident_id AND c.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Resident intake scope unavailable' USING ERRCODE='42501';
  END IF;
  h:=encode(sha256(convert_to(jsonb_build_object('facility_id',p_facility_id,'title',btrim(p_title),
    'resident_id',p_resident_id,'admission_case_id',p_admission_case_id)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(a.actor_user_id::text||'|'||p_request_key,1510));
  SELECT * INTO q FROM haven.resident_record_intake_requests
    WHERE actor_id=a.actor_user_id AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF q.operation<>'prepare_intake' OR q.request_hash<>h THEN
      RAISE EXCEPTION 'Resident intake request key content conflict' USING ERRCODE='23505';
    END IF;
    PERFORM haven.resident_record_intake_scope(q.intake_id,false);
    RETURN q.response||jsonb_build_object('replayed',true);
  END IF;
  INSERT INTO public.resident_record_intakes(
    organization_id,facility_id,resident_id,admission_case_id,title,state,created_by,updated_by
  ) VALUES(a.actor_organization_id,p_facility_id,p_resident_id,p_admission_case_id,btrim(p_title),
    CASE WHEN p_resident_id IS NULL THEN 'draft'::public.resident_record_intake_state ELSE 'uploading'::public.resident_record_intake_state END,a.actor_user_id,a.actor_user_id)
  RETURNING * INTO v;
  response:=jsonb_build_object('intake',to_jsonb(v),'replayed',false);
  INSERT INTO haven.resident_record_intake_requests(actor_id,intake_id,request_key,operation,request_hash,response,completed_at)
    VALUES(a.actor_user_id,v.id,p_request_key,'prepare_intake',h,response,clock_timestamp());
  RETURN response;
END
$function$;

CREATE OR REPLACE FUNCTION public.prepare_resident_record_intake_source(
  p_intake_id uuid,p_request_key text,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE c jsonb; s public.resident_record_intake_sources; q haven.resident_record_intake_requests;
  h text; response jsonb; n integer; intake_revision uuid;
BEGIN
  c:=haven.resident_record_intake_scope(p_intake_id,true);
  IF p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'Valid source request is required' USING ERRCODE='22023';
  END IF;
  h:=encode(sha256(convert_to(jsonb_build_object('intake_id',p_intake_id,'payload',p_payload)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended((c->>'actor_id')||'|'||p_request_key,1511));
  SELECT * INTO q FROM haven.resident_record_intake_requests
    WHERE actor_id=(c->>'actor_id')::uuid AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF q.operation<>'prepare_source' OR q.intake_id<>p_intake_id OR q.request_hash<>h THEN
      RAISE EXCEPTION 'Resident source request key content conflict' USING ERRCODE='23505';
    END IF;
    RETURN q.response||jsonb_build_object('replayed',true);
  END IF;
  IF nullif(p_payload->>'expected_intake_revision','')::uuid IS DISTINCT FROM (c->>'revision')::uuid THEN
    RAISE EXCEPTION 'Resident intake changed; reload before adding a source' USING ERRCODE='40001';
  END IF;
  n:=coalesce((p_payload->>'source_order')::integer,
    (SELECT coalesce(max(source_order),0)+1 FROM public.resident_record_intake_sources WHERE intake_id=p_intake_id));
  INSERT INTO public.resident_record_intake_sources(
    intake_id,organization_id,facility_id,source_order,title,original_filename,
    declared_mime,declared_size_bytes,declared_sha256,storage_path,uploaded_by,updated_by
  ) VALUES(p_intake_id,(c->>'organization_id')::uuid,(c->>'facility_id')::uuid,n,
    btrim(p_payload->>'title'),btrim(p_payload->>'original_filename'),lower(p_payload->>'declared_mime'),
    (p_payload->>'declared_size_bytes')::integer,lower(p_payload->>'declared_sha256'),'pending',
    (c->>'actor_id')::uuid,(c->>'actor_id')::uuid) RETURNING * INTO s;
  UPDATE public.resident_record_intake_sources SET storage_path=s.organization_id::text||'/'||s.facility_id::text||'/'||s.intake_id::text||'/'||s.id::text||'/source'
    WHERE id=s.id RETURNING * INTO s;
  UPDATE public.resident_record_intakes SET state='uploading',source_count=(SELECT count(*) FROM public.resident_record_intake_sources x WHERE x.intake_id=p_intake_id AND x.deleted_at IS NULL),revision=gen_random_uuid()
    WHERE id=p_intake_id RETURNING revision INTO intake_revision;
  response:=jsonb_build_object('source',to_jsonb(s),'upload',jsonb_build_object(
    'bucket','resident-intake-sources','path',s.storage_path),'intake_revision',intake_revision,'replayed',false);
  INSERT INTO haven.resident_record_intake_requests(actor_id,intake_id,request_key,operation,request_hash,response,completed_at)
    VALUES((c->>'actor_id')::uuid,p_intake_id,p_request_key,'prepare_source',h,response,clock_timestamp());
  RETURN response;
EXCEPTION WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
  RAISE EXCEPTION 'Source title, filename, MIME, size, and SHA-256 are required' USING ERRCODE='22023';
END
$function$;

CREATE OR REPLACE FUNCTION public.resident_record_intake_source_target(p_intake_id uuid,p_source_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE c jsonb; s public.resident_record_intake_sources; obj storage.objects;
BEGIN
  c:=haven.resident_record_intake_scope(p_intake_id,false);
  SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=p_source_id
    AND intake_id=p_intake_id AND organization_id=(c->>'organization_id')::uuid
    AND facility_id=(c->>'facility_id')::uuid AND deleted_at IS NULL;
  IF NOT FOUND OR (s.credential_quarantined AND c->>'role' NOT IN ('owner','org_admin')) THEN
    RAISE EXCEPTION 'Resident source unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO obj FROM storage.objects WHERE bucket_id='resident-intake-sources' AND name=s.storage_path;
  RETURN jsonb_build_object('source_id',s.id,'bucket','resident-intake-sources','path',s.storage_path,
    'declared_mime',s.declared_mime,'declared_size_bytes',s.declared_size_bytes,
    'declared_sha256',s.declared_sha256,'state',s.state,'revision',s.revision,
    'object',CASE WHEN obj.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',obj.id,'version',obj.version,'etag',lower(trim(both '"' from obj.metadata->>'eTag')),
      'size_bytes',CASE WHEN obj.metadata->>'size'~'^[0-9]{1,9}$' THEN (obj.metadata->>'size')::integer END,
      'mime',obj.metadata->>'mimetype','owner_id',coalesce(to_jsonb(obj)->>'owner_id',to_jsonb(obj)->>'owner')) END);
END
$function$;

CREATE OR REPLACE FUNCTION public.attest_resident_record_intake_bytes(
  p_source_id uuid,p_object_id uuid,p_object_version text,p_etag text,p_size integer,
  p_mime text,p_sha256 text,p_md5 text,p_uploader uuid
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE s public.resident_record_intake_sources;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server byte verification required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=p_source_id AND deleted_at IS NULL;
  IF NOT FOUND OR s.state<>'prepared' OR s.uploaded_by<>p_uploader
     OR p_size<>s.declared_size_bytes OR lower(p_mime)<>s.declared_mime
     OR lower(p_sha256)<>s.declared_sha256 OR lower(p_sha256)!~'^[0-9a-f]{64}$'
     OR lower(p_md5)!~'^[0-9a-f]{32}$' OR lower(p_etag)!~'^[0-9a-f]{32,64}$' THEN
    RAISE EXCEPTION 'Invalid resident source byte attestation' USING ERRCODE='22023';
  END IF;
  INSERT INTO haven.resident_record_intake_byte_attestations(
    source_id,object_id,object_version,object_etag,size_bytes,mime,sha256,md5,uploader_id
  ) VALUES(s.id,p_object_id,p_object_version,lower(p_etag),p_size,lower(p_mime),lower(p_sha256),lower(p_md5),p_uploader)
  ON CONFLICT DO NOTHING;
END
$function$;

CREATE OR REPLACE FUNCTION public.finalize_resident_record_intake_source(
  p_intake_id uuid,p_source_id uuid,p_request_key text,p_expected_revision uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE c jsonb; s public.resident_record_intake_sources; q haven.resident_record_intake_requests;
  proof haven.resident_record_intake_byte_attestations; obj storage.objects; h text; response jsonb;
BEGIN
  c:=haven.resident_record_intake_scope(p_intake_id,true);
  h:=encode(sha256(convert_to(jsonb_build_object('intake_id',p_intake_id,'source_id',p_source_id,
    'expected_revision',p_expected_revision)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended((c->>'actor_id')||'|'||p_request_key,1512));
  SELECT * INTO q FROM haven.resident_record_intake_requests
    WHERE actor_id=(c->>'actor_id')::uuid AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF q.operation<>'finalize_source' OR q.intake_id<>p_intake_id OR q.request_hash<>h THEN
      RAISE EXCEPTION 'Resident source finalization request conflict' USING ERRCODE='23505';
    END IF;
    RETURN q.response||jsonb_build_object('replayed',true);
  END IF;
  SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=p_source_id
    AND intake_id=p_intake_id AND organization_id=(c->>'organization_id')::uuid
    AND facility_id=(c->>'facility_id')::uuid AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resident source unavailable' USING ERRCODE='42501'; END IF;
  IF s.state<>'prepared' OR s.revision<>p_expected_revision THEN
    RAISE EXCEPTION 'Resident source changed; reload before finalizing' USING ERRCODE='40001';
  END IF;
  SELECT * INTO obj FROM storage.objects WHERE bucket_id='resident-intake-sources' AND name=s.storage_path;
  SELECT * INTO proof FROM haven.resident_record_intake_byte_attestations a WHERE a.source_id=s.id
    ORDER BY verified_at DESC LIMIT 1;
  IF obj.id IS NULL OR proof.source_id IS NULL
     OR coalesce(to_jsonb(obj)->>'owner_id',to_jsonb(obj)->>'owner') IS DISTINCT FROM s.uploaded_by::text
     OR proof.object_id<>obj.id OR proof.object_version IS DISTINCT FROM obj.version
     OR proof.object_etag IS DISTINCT FROM lower(trim(both '"' from obj.metadata->>'eTag'))
     OR proof.size_bytes<>s.declared_size_bytes OR proof.mime<>s.declared_mime
     OR proof.sha256<>s.declared_sha256 OR proof.uploader_id<>s.uploaded_by
     OR (obj.metadata->>'size')::integer<>s.declared_size_bytes
     OR obj.metadata->>'mimetype'<>s.declared_mime THEN
    RAISE EXCEPTION 'Server-verified resident source bytes required' USING ERRCODE='42501';
  END IF;
  UPDATE public.resident_record_intake_sources SET state='finalized',revision=gen_random_uuid(),
    object_id=obj.id,object_version=obj.version,object_etag=proof.object_etag,
    verified_mime=proof.mime,verified_size_bytes=proof.size_bytes,verified_sha256=proof.sha256,
    verified_md5=proof.md5,finalized_at=clock_timestamp(),
    page_count=CASE WHEN declared_mime<>'application/pdf' THEN 1 ELSE NULL END
    WHERE id=s.id RETURNING * INTO s;
  IF s.page_count=1 THEN
    INSERT INTO public.resident_record_intake_pages(intake_id,source_id,organization_id,facility_id,page_number,created_by)
      VALUES(s.intake_id,s.id,s.organization_id,s.facility_id,1,(c->>'actor_id')::uuid);
  END IF;
  UPDATE public.resident_record_intakes SET
    finalized_source_count=(SELECT count(*) FROM public.resident_record_intake_sources x
      WHERE x.intake_id=p_intake_id AND x.finalized_at IS NOT NULL AND x.deleted_at IS NULL),
    state=CASE WHEN resident_id IS NULL THEN 'match_required'::public.resident_record_intake_state ELSE 'ready_to_parse'::public.resident_record_intake_state END,revision=gen_random_uuid()
    WHERE id=p_intake_id;
  response:=jsonb_build_object('source',to_jsonb(s),'replayed',false);
  INSERT INTO haven.resident_record_intake_requests(actor_id,intake_id,request_key,operation,request_hash,response,completed_at)
    VALUES((c->>'actor_id')::uuid,p_intake_id,p_request_key,'finalize_source',h,response,clock_timestamp());
  RETURN response;
END
$function$;

CREATE OR REPLACE FUNCTION public.resident_record_intake_snapshot(p_intake_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE c jsonb; i public.resident_record_intakes; sources jsonb; facts jsonb; matches jsonb; counts jsonb; checklist jsonb;
BEGIN
  c:=haven.resident_record_intake_scope(p_intake_id,false);
  SELECT * INTO i FROM public.resident_record_intakes WHERE id=p_intake_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'source_order',s.source_order,'title',s.title,'original_filename',s.original_filename,
    'declared_mime',s.declared_mime,'declared_size_bytes',s.declared_size_bytes,'state',s.state,
    'revision',s.revision,'source_class',s.source_class,'document_type',s.document_type,
    'classification_confidence',s.classification_confidence,'classification_reason_code',s.classification_reason_code,
    'preflight_state',s.preflight_state,'credential_quarantined',s.credential_quarantined,
    'quarantine_reason_code',s.quarantine_reason_code,'page_count',s.page_count,
    'canonical_document_id',s.canonical_document_id,'promotion_mode',s.promotion_mode,
    'supersedes_document_id',s.supersedes_document_id,'finalized_at',s.finalized_at
  ) ORDER BY s.source_order),'[]') INTO sources
  FROM public.resident_record_intake_sources s WHERE s.intake_id=i.id AND s.deleted_at IS NULL;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'fact_key',f.fact_key,'fact_version',f.fact_version,'field_code',f.field_code,
    'domain',f.domain,'structured_value',f.structured_value,'display_value',f.display_value,
    'source_id',f.source_id,'page_start',f.source_page_start,'page_end',f.source_page_end,
    'confidence',f.confidence,'conflict',f.conflict,'conflict_code',f.conflict_code,
    'required_reviewer',f.required_reviewer,'state',f.state,'revision',f.revision,
    'current_value',haven.resident_record_canonical_value(i.id,f.field_code,f.structured_value),
    'current_value_fingerprint',f.current_value_fingerprint,'canonical_fingerprint',f.current_value_fingerprint,
    'reviewed_by',f.reviewed_by,'reviewed_at',f.reviewed_at,'review_reason',f.review_reason,
    'applied_destination',f.applied_destination,'applied_record_id',f.applied_record_id
  ) ORDER BY f.created_at,f.id),'[]') INTO facts
  FROM public.resident_record_extracted_facts f WHERE f.intake_id=i.id AND f.deleted_at IS NULL;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'candidate_kind',m.candidate_kind,'candidate_resident_id',m.candidate_resident_id,
    'candidate_referral_id',m.candidate_referral_id,'match_basis',m.match_basis,'confidence',m.confidence,
    'disposition',m.disposition,'reason',m.reason,'proposed_by',m.proposed_by,
    'candidate_first_name',coalesce(r.first_name,lead.first_name),
    'candidate_last_name',coalesce(r.last_name,lead.last_name),
    'candidate_date_of_birth',coalesce(r.date_of_birth,lead.date_of_birth),
    'candidate_status',coalesce(r.status::text,lead.status::text),
    'reviewed_by',m.reviewed_by,'reviewed_at',m.reviewed_at
  ) ORDER BY m.created_at,m.id),'[]') INTO matches
  FROM public.resident_record_intake_matches m
  LEFT JOIN public.residents r ON r.id=m.candidate_resident_id AND r.deleted_at IS NULL
  LEFT JOIN public.referral_leads lead ON lead.id=m.candidate_referral_id AND lead.deleted_at IS NULL
  WHERE m.intake_id=i.id AND m.deleted_at IS NULL;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'document_type',d.document_type,
    'required',d.required,'received_at',d.received_at,'waived_reason',d.waived_reason,
    'resident_document_id',d.resident_document_id,'state',CASE
      WHEN d.received_at IS NOT NULL THEN 'present' WHEN d.waived_reason IS NOT NULL THEN 'waived' ELSE 'missing' END)
    ORDER BY d.document_type::text),'[]') INTO checklist
  FROM public.admission_document_checklist_items d
  WHERE d.admission_case_id=i.admission_case_id AND d.deleted_at IS NULL;
  SELECT jsonb_build_object(
    'sources_total',count(*),'sources_finalized',count(*) FILTER(WHERE s.finalized_at IS NOT NULL),
    'sources_quarantined',count(*) FILTER(WHERE s.credential_quarantined),
    'sources_promoted',count(*) FILTER(WHERE s.canonical_document_id IS NOT NULL),
    'facts_total',(SELECT count(*) FROM public.resident_record_extracted_facts f WHERE f.intake_id=i.id AND f.deleted_at IS NULL),
    'facts_awaiting_review',(SELECT count(*) FROM public.resident_record_extracted_facts f WHERE f.intake_id=i.id AND f.deleted_at IS NULL AND f.state='proposed'),
    'facts_applied',(SELECT count(*) FROM public.resident_record_extracted_facts f WHERE f.intake_id=i.id AND f.deleted_at IS NULL AND f.state='applied'),
    'facts_conflicting',(SELECT count(*) FROM public.resident_record_extracted_facts f WHERE f.intake_id=i.id AND f.deleted_at IS NULL AND f.conflict AND f.state NOT IN('rejected','applied'))
  ) INTO counts FROM public.resident_record_intake_sources s WHERE s.intake_id=i.id AND s.deleted_at IS NULL;
  RETURN jsonb_build_object('intake',to_jsonb(i),'sources',sources,'facts',facts,'matches',matches,'checklist',checklist,
    'counts',counts,'can',jsonb_build_object('read',true,'manage',true,
      'clinical',c->>'role'='nurse','payer',c->>'role' IN ('owner','org_admin','facility_admin'),
      'legal',c->>'role' IN ('owner','org_admin','facility_admin')));
END
$function$;

CREATE OR REPLACE FUNCTION public.resident_record_intake_match_candidates(
  p_intake_id uuid,p_first_name text,p_last_name text,p_date_of_birth date DEFAULT NULL,p_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE c jsonb; result jsonb; n integer;
BEGIN
  c:=haven.resident_record_intake_scope(p_intake_id,false);
  IF length(btrim(coalesce(p_first_name,'')))=0 OR length(btrim(coalesce(p_last_name,'')))=0
     OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Name and bounded candidate limit required' USING ERRCODE='22023'; END IF;
  WITH candidates AS (
    SELECT r.id,r.facility_id,r.first_name,r.middle_name,r.last_name,r.date_of_birth,r.status,
      array_remove(ARRAY[
        CASE WHEN lower(r.first_name)=lower(btrim(p_first_name)) THEN 'first_name' END,
        CASE WHEN lower(r.last_name)=lower(btrim(p_last_name)) THEN 'last_name' END,
        CASE WHEN p_date_of_birth IS NOT NULL AND r.date_of_birth=p_date_of_birth THEN 'date_of_birth' END
      ],NULL) basis
    FROM public.residents r WHERE r.organization_id=(c->>'organization_id')::uuid
      AND r.deleted_at IS NULL AND haven.has_facility_access(r.facility_id)
      AND lower(r.first_name)=lower(btrim(p_first_name)) AND lower(r.last_name)=lower(btrim(p_last_name))
    ORDER BY (r.facility_id=(c->>'facility_id')::uuid) DESC,
      (p_date_of_birth IS NOT NULL AND r.date_of_birth=p_date_of_birth) DESC,r.created_at DESC LIMIT p_limit
  ) SELECT count(*),coalesce(jsonb_agg(to_jsonb(candidates)),'[]') INTO n,result FROM candidates;
  RETURN jsonb_build_object('state',CASE WHEN n=0 THEN 'zero' WHEN n=1 THEN 'one' ELSE 'multiple' END,
    'name_only',p_date_of_birth IS NULL,'candidates',result,'requires_explicit_disposition',true);
END
$function$;

CREATE OR REPLACE FUNCTION haven.resident_record_canonical_value(
  p_intake_id uuid,p_field_code text,p_value jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE i public.resident_record_intakes; r public.residents; v jsonb; target uuid;
BEGIN
  SELECT * INTO i FROM public.resident_record_intakes WHERE id=p_intake_id AND deleted_at IS NULL;
  IF NOT FOUND OR i.resident_id IS NULL THEN RETURN 'null'::jsonb; END IF;
  SELECT * INTO r FROM public.residents WHERE id=i.resident_id AND organization_id=i.organization_id
    AND facility_id=i.facility_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  IF p_field_code LIKE 'resident.%' AND p_field_code IN (
    'resident.first_name','resident.middle_name','resident.last_name','resident.preferred_name',
    'resident.date_of_birth','resident.gender','resident.ssn_last_four','resident.primary_physician_name',
    'resident.primary_physician_phone','resident.primary_physician_fax','resident.primary_diagnosis',
    'resident.diagnosis_list','resident.allergy_list','resident.diet_order','resident.diet_restrictions',
    'resident.code_status','resident.ambulatory','resident.assistive_device','resident.fall_risk_level',
    'resident.elopement_risk','resident.wandering_risk','resident.smoking_status','resident.primary_payer'
  ) THEN
    v:=to_jsonb(r)->split_part(p_field_code,'.',2);
  ELSE
    BEGIN target:=nullif(p_value->>'target_id','')::uuid; EXCEPTION WHEN invalid_text_representation THEN target:=NULL; END;
    IF p_field_code='admission.form_1823' THEN
      SELECT to_jsonb(f)-ARRAY['updated_at','updated_by'] INTO v FROM public.form_1823_records f
        WHERE f.resident_id=i.resident_id AND f.organization_id=i.organization_id
          AND f.facility_id=i.facility_id AND f.deleted_at IS NULL
        ORDER BY (f.admission_case_id=i.admission_case_id) DESC,f.updated_at DESC,f.id DESC LIMIT 1;
    ELSIF target IS NOT NULL AND p_field_code='resident.contact' THEN SELECT to_jsonb(x)-ARRAY['updated_at','updated_by'] INTO v FROM public.resident_contacts x WHERE x.id=target AND x.deleted_at IS NULL;
    ELSIF target IS NOT NULL AND p_field_code='resident.assessment' THEN SELECT to_jsonb(x)-ARRAY['updated_at','updated_by'] INTO v FROM public.assessments x WHERE x.id=target AND x.deleted_at IS NULL;
    ELSIF target IS NOT NULL AND p_field_code='resident.payer' THEN SELECT to_jsonb(x)-ARRAY['updated_at','updated_by'] INTO v FROM public.resident_payers x WHERE x.id=target AND x.deleted_at IS NULL;
    ELSIF target IS NOT NULL AND p_field_code='resident.advance_directive' THEN SELECT to_jsonb(x)-ARRAY['updated_at','updated_by'] INTO v FROM public.advance_directive_documents x WHERE x.id=target AND x.deleted_at IS NULL;
    ELSIF target IS NOT NULL AND p_field_code='resident.profile_fact' THEN SELECT to_jsonb(x)-ARRAY['updated_at','updated_by'] INTO v FROM public.resident_profile_facts x WHERE x.id=target AND x.deleted_at IS NULL;
    ELSIF target IS NOT NULL AND p_field_code='resident.authority_instrument' THEN SELECT to_jsonb(x)-ARRAY['updated_at','updated_by'] INTO v FROM public.resident_authority_instruments x WHERE x.id=target AND x.deleted_at IS NULL;
    ELSIF target IS NOT NULL AND p_field_code='resident.pharmacy_benefit' THEN SELECT to_jsonb(x)-ARRAY['updated_at','updated_by'] INTO v FROM public.resident_pharmacy_benefits x WHERE x.id=target AND x.deleted_at IS NULL;
    ELSIF target IS NOT NULL AND p_field_code='resident.screening' THEN SELECT to_jsonb(x)-ARRAY['updated_at','updated_by'] INTO v FROM public.resident_screening_records x WHERE x.id=target AND x.deleted_at IS NULL;
    ELSIF target IS NOT NULL AND p_field_code='resident.provider_referral' THEN SELECT to_jsonb(x)-ARRAY['updated_at','updated_by'] INTO v FROM public.resident_provider_referrals x WHERE x.id=target AND x.deleted_at IS NULL;
    ELSIF target IS NOT NULL AND p_field_code='resident.contract' THEN SELECT to_jsonb(x)-ARRAY['updated_at','updated_by'] INTO v FROM public.resident_contracts x WHERE x.id=target AND x.deleted_at IS NULL;
    ELSE v:=NULL; END IF;
  END IF;
  RETURN coalesce(v,'null'::jsonb);
END
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_canonical_value(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION haven.resident_record_canonical_fingerprint(
  p_intake_id uuid,p_field_code text,p_value jsonb
) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT encode(sha256(convert_to(haven.resident_record_canonical_value(p_intake_id,p_field_code,p_value)::text,'UTF8')),'hex')
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_canonical_fingerprint(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION haven.promote_resident_record_source(
  p_intake_id uuid,p_source_id uuid,p_mode text,p_replace_document_id uuid,p_actor_id uuid
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE i public.resident_record_intakes; s public.resident_record_intake_sources;
  prior public.resident_documents; document_id uuid;
BEGIN
  SELECT * INTO i FROM public.resident_record_intakes WHERE id=p_intake_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=p_source_id
    AND intake_id=i.id AND organization_id=i.organization_id AND facility_id=i.facility_id
    AND deleted_at IS NULL FOR UPDATE;
  IF i.resident_id IS NULL OR s.id IS NULL OR s.finalized_at IS NULL OR s.credential_quarantined
     OR s.source_class<>'resident' OR s.document_type IS NULL OR p_mode NOT IN ('add','replace') THEN
    RAISE EXCEPTION 'Only reviewed resident evidence can be promoted' USING ERRCODE='55000';
  END IF;
  IF s.canonical_document_id IS NOT NULL THEN
    -- Promotion is source-level and already complete.  Subsequent approved
    -- facts reuse the same canonical document; they cannot re-run or alter the
    -- original Add/Replace decision.
    RETURN s.canonical_document_id;
  END IF;
  IF s.page_count IS NULL OR (SELECT count(*) FROM public.resident_record_intake_pages p
       WHERE p.source_id=s.id AND p.deleted_at IS NULL)<>s.page_count
     OR EXISTS(SELECT 1 FROM public.resident_record_intake_pages p WHERE p.source_id=s.id
       AND p.deleted_at IS NULL AND (p.disposition<>'resident_eligible' OR p.source_class<>'resident'
         OR p.document_type IS DISTINCT FROM s.document_type)) THEN
    RAISE EXCEPTION 'Every source page must be reviewed as one resident document type' USING ERRCODE='55000';
  END IF;
  IF p_mode='replace' THEN
    SELECT * INTO prior FROM public.resident_documents WHERE id=p_replace_document_id
      AND resident_id=i.resident_id AND organization_id=i.organization_id AND facility_id=i.facility_id
      AND document_type=s.document_type AND is_current AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose the current resident document to replace' USING ERRCODE='55000'; END IF;
    UPDATE public.resident_documents SET is_current=false,superseded_at=clock_timestamp(),
      superseded_by=p_actor_id WHERE id=prior.id;
  ELSIF p_replace_document_id IS NOT NULL THEN
    RAISE EXCEPTION 'Add does not accept a replaced document' USING ERRCODE='22023';
  END IF;
  document_id:=gen_random_uuid();
  INSERT INTO public.resident_documents(
    id,resident_id,facility_id,organization_id,document_type,title,storage_path,storage_bucket,
    file_type,file_size,uploaded_by,uploaded_at,resident_record_intake_id,
    resident_record_intake_source_id,supersedes_document_id,is_current
  ) VALUES(document_id,i.resident_id,i.facility_id,i.organization_id,s.document_type,s.title,s.storage_path,
    'resident-intake-sources',s.verified_mime,s.verified_size_bytes,p_actor_id,s.finalized_at,
    i.id,s.id,prior.id,true);
  UPDATE public.resident_record_intake_sources SET canonical_document_id=document_id,state='promoted',
    promotion_mode=p_mode,supersedes_document_id=prior.id,revision=gen_random_uuid() WHERE id=s.id;
  RETURN document_id;
END
$function$;
REVOKE ALL ON FUNCTION haven.promote_resident_record_source(uuid,uuid,text,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.stage_resident_record_parse_result(
  p_intake_id uuid,p_source_id uuid,p_run_id uuid,p_request_key text,p_expected_revision uuid,
  p_actor_id uuid,p_provider text,p_model text,p_model_version text,p_prompt_hash text,
  p_response_hash text,p_result jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE i public.resident_record_intakes; s public.resident_record_intake_sources;
  a public.user_profiles; run public.resident_record_parse_runs; h text; item jsonb;
  fact_ids jsonb:='[]'; fact_id uuid; page_count integer; result_class text;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server parser staging required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO a FROM public.user_profiles WHERE id=p_actor_id AND is_active AND deleted_at IS NULL FOR SHARE;
  SELECT * INTO i FROM public.resident_record_intakes WHERE id=p_intake_id AND deleted_at IS NULL FOR UPDATE;
  IF a.id IS NULL OR i.id IS NULL OR a.organization_id<>i.organization_id
     OR a.app_role NOT IN ('owner','org_admin','facility_admin','nurse')
     OR (a.app_role NOT IN ('owner','org_admin') AND NOT EXISTS(SELECT 1 FROM public.user_facility_access ufa
       WHERE ufa.user_id=a.id AND ufa.organization_id=i.organization_id AND ufa.facility_id=i.facility_id
         AND ufa.revoked_at IS NULL)) THEN
    RAISE EXCEPTION 'Parser actor authority changed' USING ERRCODE='42501';
  END IF;
  SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=p_source_id AND intake_id=i.id
    AND organization_id=i.organization_id AND facility_id=i.facility_id AND deleted_at IS NULL FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Resident source unavailable' USING ERRCODE='42501'; END IF;
  h:=encode(sha256(convert_to(jsonb_build_object('intake_id',p_intake_id,'source_id',p_source_id,
    'expected_revision',p_expected_revision,'provider',p_provider,'model',p_model,'model_version',p_model_version,
    'prompt_hash',p_prompt_hash,'response_hash',p_response_hash)::text,'UTF8')),'hex');
  SELECT * INTO run FROM public.resident_record_parse_runs WHERE requested_by=p_actor_id AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF run.request_hash<>h OR run.id<>p_run_id OR run.source_id<>p_source_id THEN
      RAISE EXCEPTION 'Parse request key content conflict' USING ERRCODE='23505';
    END IF;
    SELECT coalesce(jsonb_agg(f.id ORDER BY f.created_at),'[]') INTO fact_ids
      FROM public.resident_record_extracted_facts f WHERE f.parse_run_id=run.id;
    RETURN jsonb_build_object('run_id',run.id,'source_id',run.source_id,'fact_ids',fact_ids,'state',run.state,'replayed',true);
  END IF;
  IF s.revision<>p_expected_revision OR s.finalized_at IS NULL OR s.state NOT IN ('finalized','ready_to_parse','parsing','review')
     OR s.preflight_state NOT IN ('safe','overridden') OR s.credential_quarantined THEN
    RAISE EXCEPTION 'Source is not currently authorized for parsing' USING ERRCODE='55000';
  END IF;
  IF p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
     OR p_prompt_hash!~'^[0-9a-f]{64}$' OR p_response_hash!~'^[0-9a-f]{64}$'
     OR jsonb_typeof(p_result)<>'object' THEN RAISE EXCEPTION 'Invalid parser receipt' USING ERRCODE='22023'; END IF;
  result_class:=p_result->>'source_class';
  IF result_class NOT IN ('resident','facility','employee','other_resident','credential_secret','unreadable','unsupported') THEN
    RAISE EXCEPTION 'Parser returned an unsupported source class' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.resident_record_parse_runs(id,intake_id,source_id,organization_id,facility_id,
    request_key,request_hash,provider,model,model_version,prompt_hash,response_hash,state,requested_by)
  VALUES(p_run_id,i.id,s.id,i.organization_id,i.facility_id,p_request_key,h,btrim(p_provider),btrim(p_model),
    nullif(btrim(p_model_version),''),lower(p_prompt_hash),lower(p_response_hash),'running',a.id);
  IF result_class='credential_secret' OR NOT haven.resident_record_payload_safe(p_result) THEN
    UPDATE public.resident_record_intake_sources SET source_class='credential_secret',credential_quarantined=true,
      preflight_state='credential_detected',quarantine_reason_code='provider_credential_indicator',
      state='quarantined',revision=gen_random_uuid(),parser_metadata='{}' WHERE id=s.id;
    UPDATE public.resident_record_parse_runs SET state='quarantined',error_code='credential_detected_provider',completed_at=clock_timestamp()
      WHERE id=p_run_id;
    UPDATE public.resident_record_intakes SET quarantined_source_count=(SELECT count(*) FROM public.resident_record_intake_sources x
      WHERE x.intake_id=i.id AND x.credential_quarantined AND x.deleted_at IS NULL),state='review',revision=gen_random_uuid() WHERE id=i.id;
    RETURN jsonb_build_object('run_id',p_run_id,'source_id',s.id,'fact_ids','[]'::jsonb,'state','quarantined','replayed',false);
  END IF;
  IF result_class='resident' AND NOT haven.resident_record_document_type_allowed(p_result->>'document_type') THEN
    RAISE EXCEPTION 'Parser returned an unsupported resident document type' USING ERRCODE='22023';
  END IF;
  page_count:=coalesce((p_result->>'page_count')::integer,jsonb_array_length(coalesce(p_result->'pages','[]')),
    CASE WHEN s.declared_mime<>'application/pdf' THEN 1 END);
  IF page_count IS NULL OR page_count<1 OR jsonb_array_length(coalesce(p_result->'pages','[]'))<>page_count THEN
    RAISE EXCEPTION 'Parser must classify every source page' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_result->'pages') LOOP
    IF (item->>'page_number')::integer NOT BETWEEN 1 AND page_count
       OR item->>'source_class' NOT IN ('resident','facility','employee','other_resident','credential_secret','unreadable','unsupported')
       OR item->>'disposition' NOT IN ('resident_eligible','excluded','quarantined','unreadable')
       OR (item->>'source_class'='resident' AND NOT haven.resident_record_document_type_allowed(item->>'document_type')) THEN
      RAISE EXCEPTION 'Parser returned an invalid page classification' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.resident_record_intake_pages(intake_id,source_id,organization_id,facility_id,page_number,
      source_class,document_type,disposition,confidence,reason_code,parse_run_id,created_by)
    VALUES(i.id,s.id,i.organization_id,i.facility_id,(item->>'page_number')::integer,
      (item->>'source_class')::public.resident_record_source_class,item->>'document_type',
      (item->>'disposition')::public.resident_record_page_disposition,(item->>'confidence')::numeric,
      nullif(item->>'reason_code',''),p_run_id,a.id)
    ON CONFLICT(source_id,page_number) DO UPDATE SET
      source_class=EXCLUDED.source_class,document_type=EXCLUDED.document_type,
      disposition=EXCLUDED.disposition,confidence=EXCLUDED.confidence,
      reason_code=EXCLUDED.reason_code,parse_run_id=EXCLUDED.parse_run_id,
      revision=gen_random_uuid(),created_at=clock_timestamp(),created_by=EXCLUDED.created_by,deleted_at=NULL;
  END LOOP;
  UPDATE public.resident_record_extracted_facts SET state='superseded',reviewed_by=a.id,
    reviewed_at=clock_timestamp(),review_reason='Superseded by reparse',revision=gen_random_uuid()
    WHERE source_id=s.id AND state='proposed' AND deleted_at IS NULL;
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_result->'facts','[]')) LOOP
    IF NOT haven.resident_record_field_allowed(item->>'field_code')
       OR item->>'domain' NOT IN ('demographics','clinical','payer','legal','authority','admission','contact','screening')
       OR item->'structured_value' IS NULL OR length(item->>'display_value') NOT BETWEEN 1 AND 2000
       OR ((item->>'field_code')='resident.ssn_last_four' AND (item#>>'{structured_value,value}')!~'^[0-9]{4}$') THEN
      RAISE EXCEPTION 'Parser returned an invalid controlled fact' USING ERRCODE='22023';
    END IF;
    fact_id:=gen_random_uuid();
    INSERT INTO public.resident_record_extracted_facts(id,intake_id,source_id,parse_run_id,organization_id,facility_id,
      field_code,domain,structured_value,display_value,source_page_start,source_page_end,confidence,
      current_value_fingerprint,conflict,conflict_code,required_reviewer,proposal_origin,proposed_by)
    VALUES(fact_id,i.id,s.id,p_run_id,i.organization_id,i.facility_id,item->>'field_code',item->>'domain',
      item->'structured_value',item->>'display_value',nullif(item->>'page_start','')::integer,
      nullif(item->>'page_end','')::integer,nullif(item->>'confidence','')::numeric,
      haven.resident_record_canonical_fingerprint(i.id,item->>'field_code',item->'structured_value'),
      coalesce((item->>'conflict')::boolean,false),nullif(item->>'conflict_code',''),
      haven.resident_record_expected_reviewer(item->>'field_code'),'provider',a.id);
    INSERT INTO public.resident_record_fact_events(intake_id,fact_id,organization_id,facility_id,event_type,fact_revision,actor_id,metadata)
      SELECT i.id,fact_id,i.organization_id,i.facility_id,'proposed',f.revision,a.id,
        jsonb_build_object('origin','provider','parse_run_id',p_run_id) FROM public.resident_record_extracted_facts f WHERE f.id=fact_id;
    fact_ids:=fact_ids||to_jsonb(fact_id);
  END LOOP;
  UPDATE public.resident_record_intake_sources SET source_class=result_class::public.resident_record_source_class,
    document_type=CASE WHEN result_class='resident' THEN p_result->>'document_type' END,
    classification_confidence=nullif(p_result->>'confidence','')::numeric,
    classification_reason_code=nullif(p_result->>'reason_code',''),page_count=page_count,
    state=CASE WHEN result_class='resident' THEN 'review'::public.resident_record_source_state ELSE 'excluded'::public.resident_record_source_state END,
    revision=gen_random_uuid(),parser_metadata=jsonb_build_object('provider',p_provider,'model',p_model,'run_id',p_run_id)
    WHERE id=s.id;
  UPDATE public.resident_record_parse_runs SET state='succeeded',completed_at=clock_timestamp() WHERE id=p_run_id;
  UPDATE public.resident_record_intakes SET parser_state='complete',state=CASE WHEN resident_id IS NULL THEN 'match_required'::public.resident_record_intake_state ELSE 'review'::public.resident_record_intake_state END,
    revision=gen_random_uuid() WHERE id=i.id;
  RETURN jsonb_build_object('run_id',p_run_id,'source_id',s.id,'fact_ids',fact_ids,'state','succeeded','replayed',false);
END
$function$;

CREATE OR REPLACE FUNCTION haven.apply_resident_record_fact(
  p_fact_id uuid,p_actor_id uuid,p_promotion_mode text,p_replace_document_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE f public.resident_record_extracted_facts; i public.resident_record_intakes;
  v jsonb; scalar jsonb; doc_id uuid; destination_id uuid; destination_type text;
  destination_row jsonb; prior_form public.form_1823_records; form_version integer;
BEGIN
  SELECT * INTO f FROM public.resident_record_extracted_facts WHERE id=p_fact_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO i FROM public.resident_record_intakes WHERE id=f.intake_id AND deleted_at IS NULL FOR UPDATE;
  IF f.id IS NULL OR i.id IS NULL OR i.resident_id IS NULL OR f.state<>'approved' THEN
    RAISE EXCEPTION 'Approved fact and confirmed resident are required' USING ERRCODE='55000';
  END IF;
  v:=f.structured_value; scalar:=CASE WHEN v ? 'value' THEN v->'value' ELSE v END;
  IF f.source_id IS NOT NULL THEN
    doc_id:=haven.promote_resident_record_source(i.id,f.source_id,coalesce(p_promotion_mode,'add'),p_replace_document_id,p_actor_id);
  END IF;
  destination_type:=split_part(f.field_code,'.',1);
  destination_id:=i.resident_id;

  IF f.field_code='resident.first_name' THEN UPDATE public.residents SET first_name=btrim(scalar#>>'{}'),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.middle_name' THEN UPDATE public.residents SET middle_name=nullif(btrim(scalar#>>'{}'),''),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.last_name' THEN UPDATE public.residents SET last_name=btrim(scalar#>>'{}'),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.preferred_name' THEN UPDATE public.residents SET preferred_name=nullif(btrim(scalar#>>'{}'),''),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.date_of_birth' THEN UPDATE public.residents SET date_of_birth=(scalar#>>'{}')::date,updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.gender' THEN UPDATE public.residents SET gender=(scalar#>>'{}')::public.gender,updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.ssn_last_four' THEN
    IF scalar#>>'{}' !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Only confirmed SSN last four can be applied' USING ERRCODE='22023'; END IF;
    UPDATE public.residents SET ssn_last_four=scalar#>>'{}',updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.primary_physician_name' THEN UPDATE public.residents SET primary_physician_name=nullif(btrim(scalar#>>'{}'),''),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.primary_physician_phone' THEN UPDATE public.residents SET primary_physician_phone=nullif(btrim(scalar#>>'{}'),''),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.primary_physician_fax' THEN UPDATE public.residents SET primary_physician_fax=nullif(btrim(scalar#>>'{}'),''),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.primary_diagnosis' THEN UPDATE public.residents SET primary_diagnosis=nullif(btrim(scalar#>>'{}'),''),primary_diagnosis_reviewed_at=clock_timestamp(),primary_diagnosis_reviewed_by=p_actor_id,updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.diagnosis_list' THEN UPDATE public.residents SET diagnosis_list=ARRAY(SELECT jsonb_array_elements_text(scalar)),primary_diagnosis_reviewed_at=clock_timestamp(),primary_diagnosis_reviewed_by=p_actor_id,updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.allergy_list' THEN UPDATE public.residents SET allergy_list=ARRAY(SELECT jsonb_array_elements_text(scalar)),allergy_list_reviewed_at=clock_timestamp(),allergy_list_reviewed_by=p_actor_id,updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.diet_order' THEN UPDATE public.residents SET diet_order=nullif(btrim(scalar#>>'{}'),''),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.diet_restrictions' THEN UPDATE public.residents SET diet_restrictions=ARRAY(SELECT jsonb_array_elements_text(scalar)),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.code_status' THEN UPDATE public.residents SET code_status=nullif(btrim(scalar#>>'{}'),''),code_status_verified_at=clock_timestamp(),code_status_verified_by=p_actor_id,updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.ambulatory' THEN UPDATE public.residents SET ambulatory=(scalar#>>'{}')::boolean,updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.assistive_device' THEN UPDATE public.residents SET assistive_device=nullif(btrim(scalar#>>'{}'),''),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.fall_risk_level' THEN UPDATE public.residents SET fall_risk_level=nullif(btrim(scalar#>>'{}'),''),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.elopement_risk' THEN UPDATE public.residents SET elopement_risk=(scalar#>>'{}')::boolean,updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.wandering_risk' THEN UPDATE public.residents SET wandering_risk=(scalar#>>'{}')::boolean,updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.smoking_status' THEN UPDATE public.residents SET smoking_status=nullif(btrim(scalar#>>'{}'),''),updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.primary_payer' THEN UPDATE public.residents SET primary_payer=(scalar#>>'{}')::public.payer_type,updated_by=p_actor_id WHERE id=i.resident_id;
  ELSIF f.field_code='resident.contact' THEN
    IF nullif(btrim(v->>'contact_type'),'') IS NULL OR nullif(btrim(v->>'name'),'') IS NULL THEN
      RAISE EXCEPTION 'Contact type and name are required' USING ERRCODE='22023'; END IF;
    destination_id:=coalesce(nullif(v->>'target_id','')::uuid,gen_random_uuid());destination_type:='resident_contacts';
    IF v ? 'target_id' THEN
      UPDATE public.resident_contacts SET contact_type=v->>'contact_type',name=v->>'name',relationship=v->>'relationship',
        phone=v->>'phone',phone_alt=v->>'phone_alt',email=v->>'email',fax=v->>'fax',address=v->>'address',
        is_emergency_contact=coalesce((v->>'is_emergency_contact')::boolean,false),
        is_healthcare_proxy=coalesce((v->>'is_healthcare_proxy')::boolean,false),
        is_power_of_attorney=coalesce((v->>'is_power_of_attorney')::boolean,false),
        notes=v->>'notes',source_resident_document_id=doc_id,source_intake_fact_id=f.id,updated_by=p_actor_id
        WHERE id=destination_id AND resident_id=i.resident_id AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Contact target changed' USING ERRCODE='40001'; END IF;
    ELSE
      INSERT INTO public.resident_contacts(id,resident_id,facility_id,organization_id,contact_type,name,relationship,
        phone,phone_alt,email,fax,address,is_emergency_contact,is_healthcare_proxy,is_power_of_attorney,notes,
        source_resident_document_id,source_intake_fact_id,created_by,updated_by)
      VALUES(destination_id,i.resident_id,i.facility_id,i.organization_id,v->>'contact_type',v->>'name',v->>'relationship',
        v->>'phone',v->>'phone_alt',v->>'email',v->>'fax',v->>'address',coalesce((v->>'is_emergency_contact')::boolean,false),
        coalesce((v->>'is_healthcare_proxy')::boolean,false),coalesce((v->>'is_power_of_attorney')::boolean,false),v->>'notes',
        doc_id,f.id,p_actor_id,p_actor_id);
    END IF;
  ELSIF f.field_code='resident.assessment' THEN
    destination_id:=gen_random_uuid();destination_type:='assessments';
    INSERT INTO public.assessments(id,resident_id,facility_id,organization_id,assessment_type,assessment_date,total_score,
      risk_level,scores,notes,assessed_by,next_due_date,source_resident_document_id,source_intake_fact_id,created_by,updated_by)
    VALUES(destination_id,i.resident_id,i.facility_id,i.organization_id,v->>'assessment_type',(v->>'assessment_date')::date,
      nullif(v->>'total_score','')::numeric,v->>'risk_level',coalesce(v->'scores','{}'),v->>'notes',p_actor_id,
      nullif(v->>'next_due_date','')::date,doc_id,f.id,p_actor_id,p_actor_id);
  ELSIF f.field_code='resident.payer' THEN
    destination_id:=gen_random_uuid();destination_type:='resident_payers';
    INSERT INTO public.resident_payers(id,resident_id,facility_id,organization_id,payer_type,is_primary,payer_name,
      policy_number,group_number,payer_phone,payer_contact_name,medicaid_recipient_id,effective_date,end_date,notes,
      source_resident_document_id,source_intake_fact_id,created_by,updated_by)
    VALUES(destination_id,i.resident_id,i.facility_id,i.organization_id,(v->>'payer_type')::public.payer_type,
      coalesce((v->>'is_primary')::boolean,false),v->>'payer_name',v->>'policy_number',v->>'group_number',v->>'payer_phone',
      v->>'payer_contact_name',v->>'medicaid_recipient_id',(v->>'effective_date')::date,nullif(v->>'end_date','')::date,
      v->>'notes',doc_id,f.id,p_actor_id,p_actor_id);
  ELSIF f.field_code='resident.advance_directive' THEN
    destination_id:=gen_random_uuid();destination_type:='advance_directive_documents';
    INSERT INTO public.advance_directive_documents(id,resident_id,facility_id,organization_id,document_type,polst_status,
      code_status,physician_signature_date,scanned_document_storage_path,verified_by,verified_at,notes,
      source_resident_document_id,source_intake_fact_id,created_by,updated_by)
    VALUES(destination_id,i.resident_id,i.facility_id,i.organization_id,coalesce(v->>'document_type','advance_directive'),
      coalesce((v->>'polst_status')::public.polst_status,'on_file'),v->>'code_status',nullif(v->>'physician_signature_date','')::date,
      (SELECT storage_path FROM public.resident_documents WHERE id=doc_id),p_actor_id,clock_timestamp(),v->>'notes',
      doc_id,f.id,p_actor_id,p_actor_id);
  ELSIF f.field_code IN ('resident.profile_fact','resident.room_evidence','resident.admission_date_evidence') THEN
    destination_id:=gen_random_uuid();destination_type:='resident_profile_facts';
    INSERT INTO public.resident_profile_facts(id,organization_id,facility_id,resident_id,category,field_code,
      structured_value,display_value,source_document_id,source_intake_fact_id,effective_date,created_by,updated_by)
    VALUES(destination_id,i.organization_id,i.facility_id,i.resident_id,
      CASE WHEN f.field_code IN ('resident.room_evidence','resident.admission_date_evidence') THEN 'admission' ELSE coalesce(v->>'category','other') END,
      CASE WHEN f.field_code='resident.profile_fact' THEN coalesce(v->>'code',v->>'field_code') ELSE f.field_code END,
      coalesce(v->'value',v),f.display_value,doc_id,f.id,nullif(v->>'effective_date','')::date,p_actor_id,p_actor_id);
  ELSIF f.field_code='resident.authority_instrument' THEN
    destination_id:=gen_random_uuid();destination_type:='resident_authority_instruments';
    INSERT INTO public.resident_authority_instruments(id,organization_id,facility_id,resident_id,instrument_type,
      holder_contact_id,holder_name,holder_relationship,authority_scope,scope_text,status,effective_date,expiration_date,reviewed_by,reviewed_at,
      source_document_id,source_intake_fact_id,notes,created_by,updated_by)
    VALUES(destination_id,i.organization_id,i.facility_id,i.resident_id,v->>'instrument_type',nullif(v->>'holder_contact_id','')::uuid,
      v->>'holder_name',v->>'relationship',ARRAY(SELECT jsonb_array_elements_text(coalesce(v->'scope','[]'))),
      coalesce(v->>'scope_text',array_to_string(ARRAY(SELECT jsonb_array_elements_text(coalesce(v->'scope','[]'))),', ')),
      coalesce(v->>'status','reported'),nullif(v->>'effective_date','')::date,
      nullif(v->>'expiration_date','')::date,p_actor_id,clock_timestamp(),doc_id,f.id,v->>'notes',p_actor_id,p_actor_id);
  ELSIF f.field_code='resident.pharmacy_benefit' THEN
    destination_id:=gen_random_uuid();destination_type:='resident_pharmacy_benefits';
    INSERT INTO public.resident_pharmacy_benefits(id,organization_id,facility_id,resident_id,payer_id,plan_name,
      member_id,bin,pcn,group_number,effective_date,end_date,source_document_id,source_intake_fact_id,created_by,updated_by)
    VALUES(destination_id,i.organization_id,i.facility_id,i.resident_id,nullif(v->>'payer_id','')::uuid,coalesce(v->>'plan_name',v->>'processor_name'),
      v->>'member_id',v->>'bin',v->>'pcn',v->>'group_number',nullif(v->>'effective_date','')::date,
      nullif(v->>'end_date','')::date,doc_id,f.id,p_actor_id,p_actor_id);
  ELSIF f.field_code='resident.screening' THEN
    destination_id:=gen_random_uuid();destination_type:='resident_screening_records';
    INSERT INTO public.resident_screening_records(id,organization_id,facility_id,resident_id,screening_type,result,
      searched_on,reviewed_by,reviewed_at,source_document_id,source_intake_fact_id,notes,created_by,updated_by)
    VALUES(destination_id,i.organization_id,i.facility_id,i.resident_id,v->>'screening_type',v->>'result',
      nullif(v->>'searched_on','')::date,p_actor_id,clock_timestamp(),doc_id,f.id,v->>'notes',p_actor_id,p_actor_id);
  ELSIF f.field_code='resident.provider_referral' THEN
    destination_id:=gen_random_uuid();destination_type:='resident_provider_referrals';
    INSERT INTO public.resident_provider_referrals(id,organization_id,facility_id,resident_id,referral_type,provider_name,
      provider_phone,referred_on,status,source_document_id,source_intake_fact_id,notes,created_by,updated_by)
    VALUES(destination_id,i.organization_id,i.facility_id,i.resident_id,v->>'referral_type',v->>'provider_name',
      v->>'provider_phone',nullif(v->>'referred_on','')::date,coalesce(v->>'status','documented'),doc_id,f.id,v->>'notes',p_actor_id,p_actor_id);
  ELSIF f.field_code='resident.contract' THEN
    destination_id:=gen_random_uuid();destination_type:='resident_contracts';
    INSERT INTO public.resident_contracts(id,organization_id,facility_id,resident_id,admission_case_id,resident_document_id,
      contract_type,title,provider,status,source_type,effective_date,expiration_date,metadata,source_intake_fact_id,created_by,updated_by)
    VALUES(destination_id,i.organization_id,i.facility_id,i.resident_id,i.admission_case_id,doc_id,v->>'contract_type',
      coalesce(v->>'title',f.display_value),'manual',coalesce(v->>'status','draft'),'manual_scan',
      nullif(v->>'effective_date','')::date,nullif(v->>'expiration_date','')::date,
      jsonb_build_object('paper_signature_observation',coalesce(v->'paper_signature_observation','null'::jsonb),
        'cryptographic_signature_verified',false),f.id,p_actor_id,p_actor_id);
  ELSIF f.field_code='resident.medication_order' THEN
    IF jsonb_typeof(v->'order')<>'object' OR nullif(btrim(coalesce(v->>'reason',f.review_reason)),'') IS NULL THEN
      RAISE EXCEPTION 'Complete medication order and review reason are required' USING ERRCODE='22023'; END IF;
    destination_id:=coalesce(nullif(v->>'medication_id','')::uuid,gen_random_uuid());destination_type:='resident_medications';
    PERFORM public.save_medication_order_review(destination_id,i.resident_id,nullif(v->>'previous_medication_id','')::uuid,
      coalesce(v->>'action','save'),coalesce(v->>'reason',f.review_reason),v->'order');
  ELSIF f.field_code='admission.checklist_evidence' THEN
    IF i.admission_case_id IS NULL THEN RAISE EXCEPTION 'Admission case is required for checklist evidence' USING ERRCODE='55000'; END IF;
    destination_type:='admission_document_checklist_items';
    UPDATE public.admission_document_checklist_items SET received_at=clock_timestamp(),resident_document_id=doc_id,
      source_intake_fact_id=f.id,notes=coalesce(v->>'notes','Reviewed packet evidence'),updated_by=p_actor_id
    WHERE admission_case_id=i.admission_case_id AND document_type=(v->>'document_type')::public.admission_document_type
      AND deleted_at IS NULL RETURNING id INTO destination_id;
    IF destination_id IS NULL THEN
      destination_id:=gen_random_uuid();
      INSERT INTO public.admission_document_checklist_items(id,organization_id,facility_id,admission_case_id,document_type,
        required,received_at,notes,resident_document_id,source_intake_fact_id,created_by,updated_by)
      VALUES(destination_id,i.organization_id,i.facility_id,i.admission_case_id,
        (v->>'document_type')::public.admission_document_type,coalesce((v->>'required')::boolean,true),clock_timestamp(),
        coalesce(v->>'notes','Reviewed packet evidence'),doc_id,f.id,p_actor_id,p_actor_id);
    END IF;
  ELSIF f.field_code='admission.form_1823' THEN
    IF i.admission_case_id IS NULL THEN RAISE EXCEPTION 'Admission case is required for Form 1823' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.resident_record_intake_sources s WHERE s.id=f.source_id AND s.document_type='form_1823') THEN
      RAISE EXCEPTION 'Form 1823 must come from a reviewed Form 1823 source' USING ERRCODE='55000';
    END IF;
    SELECT * INTO prior_form FROM public.form_1823_records x WHERE x.resident_id=i.resident_id
      AND x.facility_id=i.facility_id AND x.organization_id=i.organization_id AND x.deleted_at IS NULL AND x.is_current
      ORDER BY (x.admission_case_id=i.admission_case_id) DESC,x.updated_at DESC,x.id DESC LIMIT 1 FOR UPDATE;
    form_version:=coalesce(prior_form.form_version,0)+1;
    IF prior_form.id IS NOT NULL THEN UPDATE public.form_1823_records SET is_current=false,updated_by=p_actor_id WHERE id=prior_form.id; END IF;
    destination_id:=gen_random_uuid();destination_type:='form_1823_records';
    INSERT INTO public.form_1823_records(id,organization_id,facility_id,resident_id,admission_case_id,physician_name,
      exam_date,expiration_date,status,form_schema_version,form_version,supersedes_form_1823_id,is_current,
      representative_name,representative_relationship,representative_phone,allergies,height_inches,weight_lbs,
      medical_history,physical_limitations,cognitive_behavioral_status,service_requirements,precautions,elopement_risk,
      adl_bathing,adl_dressing,adl_eating,adl_transferring,adl_toileting,adl_grooming,adl_walking,prescribed_diet,
      condition_communicable_disease,condition_bedridden,condition_pressure_injury,condition_tuberculosis,
      condition_special_precautions,alf_care_appropriate,medication_assistance,examiner_license_number,
      examiner_license_type,examiner_title,examiner_phone,examiner_address,examiner_signature_date,
      source_resident_document_id,source_page_numbers,source_intake_fact_id,created_by,updated_by)
    VALUES(destination_id,i.organization_id,i.facility_id,i.resident_id,i.admission_case_id,v->>'physician_name',
      (v->>'exam_date')::date,(v->>'expiration_date')::date,'received','2021-04',form_version,prior_form.id,true,
      v->>'representative_name',v->>'representative_relationship',v->>'representative_phone',
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v->'allergies','[]'))),nullif(v->>'height_inches','')::numeric,
      nullif(v->>'weight_lbs','')::numeric,coalesce(v->'medical_history','{}'),coalesce(v->'physical_limitations','{}'),
      coalesce(v->'cognitive_behavioral_status','{}'),coalesce(v->'service_requirements','{}'),coalesce(v->'precautions','{}'),
      nullif(v->>'elopement_risk','')::boolean,v->>'adl_bathing',v->>'adl_dressing',v->>'adl_eating',v->>'adl_transferring',
      v->>'adl_toileting',v->>'adl_grooming',v->>'adl_walking',v->>'prescribed_diet',
      nullif(v->>'condition_communicable_disease','')::boolean,nullif(v->>'condition_bedridden','')::boolean,
      nullif(v->>'condition_pressure_injury','')::boolean,nullif(v->>'condition_tuberculosis','')::boolean,
      nullif(v->>'condition_special_precautions','')::boolean,nullif(v->>'alf_care_appropriate','')::boolean,
      v->>'medication_assistance',v->>'examiner_license_number',v->>'examiner_license_type',v->>'examiner_title',
      v->>'examiner_phone',v->>'examiner_address',nullif(v->>'examiner_signature_date','')::date,doc_id,
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v->'source_pages','[]'))::integer),f.id,p_actor_id,p_actor_id);
    UPDATE public.admission_document_checklist_items SET received_at=clock_timestamp(),resident_document_id=doc_id,
      source_intake_fact_id=f.id,notes=coalesce(v->>'checklist_note','Nurse-reviewed Form 1823 packet evidence'),updated_by=p_actor_id
      WHERE admission_case_id=i.admission_case_id AND document_type='form_1823' AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Form 1823 checklist row is unavailable' USING ERRCODE='55000'; END IF;
  ELSE RAISE EXCEPTION 'Fact destination is not implemented' USING ERRCODE='22023'; END IF;

  IF doc_id IS NOT NULL THEN UPDATE public.resident_documents SET resident_record_intake_fact_id=coalesce(resident_record_intake_fact_id,f.id)
    WHERE id=doc_id; END IF;
  IF destination_type='resident' THEN
    destination_row:=to_jsonb((SELECT x FROM public.residents x WHERE x.id=destination_id));
  ELSIF destination_type='resident_contacts' THEN destination_row:=to_jsonb((SELECT x FROM public.resident_contacts x WHERE x.id=destination_id));
  ELSIF destination_type='assessments' THEN destination_row:=to_jsonb((SELECT x FROM public.assessments x WHERE x.id=destination_id));
  ELSIF destination_type='resident_payers' THEN destination_row:=to_jsonb((SELECT x FROM public.resident_payers x WHERE x.id=destination_id));
  ELSIF destination_type='advance_directive_documents' THEN destination_row:=to_jsonb((SELECT x FROM public.advance_directive_documents x WHERE x.id=destination_id));
  ELSIF destination_type='resident_profile_facts' THEN destination_row:=to_jsonb((SELECT x FROM public.resident_profile_facts x WHERE x.id=destination_id));
  ELSIF destination_type='resident_authority_instruments' THEN destination_row:=to_jsonb((SELECT x FROM public.resident_authority_instruments x WHERE x.id=destination_id));
  ELSIF destination_type='resident_pharmacy_benefits' THEN destination_row:=to_jsonb((SELECT x FROM public.resident_pharmacy_benefits x WHERE x.id=destination_id));
  ELSIF destination_type='resident_screening_records' THEN destination_row:=to_jsonb((SELECT x FROM public.resident_screening_records x WHERE x.id=destination_id));
  ELSIF destination_type='resident_provider_referrals' THEN destination_row:=to_jsonb((SELECT x FROM public.resident_provider_referrals x WHERE x.id=destination_id));
  ELSIF destination_type='resident_contracts' THEN destination_row:=to_jsonb((SELECT x FROM public.resident_contracts x WHERE x.id=destination_id));
  ELSIF destination_type='resident_medications' THEN destination_row:=to_jsonb((SELECT x FROM public.resident_medications x WHERE x.id=destination_id));
  ELSIF destination_type='admission_document_checklist_items' THEN destination_row:=to_jsonb((SELECT x FROM public.admission_document_checklist_items x WHERE x.id=destination_id));
  ELSIF destination_type='form_1823_records' THEN destination_row:=to_jsonb((SELECT x FROM public.form_1823_records x WHERE x.id=destination_id));
  END IF;
  RETURN jsonb_build_object('destination_type',destination_type,'destination_id',destination_id,
    'source_document_id',doc_id,'after_fingerprint',encode(sha256(convert_to(coalesce(destination_row,'null'::jsonb)::text,'UTF8')),'hex'));
END
$function$;
REVOKE ALL ON FUNCTION haven.apply_resident_record_fact(uuid,uuid,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.resident_record_intake_command(
  p_intake_id uuid,p_request_key text,p_command text,p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE c jsonb; i public.resident_record_intakes; s public.resident_record_intake_sources;
  f public.resident_record_extracted_facts; q haven.resident_record_intake_requests;
  h text; response jsonb; item jsonb; new_fact uuid; v_resident_id uuid; document_id uuid;
  application jsonb; receipt_id uuid; before_hash text; current_hash text; after_hash text;
  reviewer public.resident_record_reviewer_class; new_state public.resident_record_source_state;
BEGIN
  c:=haven.resident_record_intake_scope(p_intake_id,true);
  IF p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'Valid resident intake command request required' USING ERRCODE='22023';
  END IF;
  h:=encode(sha256(convert_to(jsonb_build_object('intake_id',p_intake_id,'command',p_command,'payload',p_payload)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended((c->>'actor_id')||'|'||p_request_key,1513));
  SELECT * INTO q FROM haven.resident_record_intake_requests
    WHERE actor_id=(c->>'actor_id')::uuid AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF q.operation<>p_command OR q.intake_id<>p_intake_id OR q.request_hash<>h THEN
      RAISE EXCEPTION 'Resident intake command request key content conflict' USING ERRCODE='23505';
    END IF;
    RETURN q.response||jsonb_build_object('replayed',true);
  END IF;
  SELECT * INTO i FROM public.resident_record_intakes WHERE id=p_intake_id FOR UPDATE;

  IF p_command='confirm_source_safe_for_external_parse' THEN
    SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=(p_payload->>'source_id')::uuid
      AND intake_id=i.id AND deleted_at IS NULL FOR UPDATE;
    IF s.id IS NULL OR s.revision<>(p_payload->>'expected_revision')::uuid OR s.finalized_at IS NULL
       OR s.credential_quarantined OR s.preflight_state='credential_detected'
       OR nullif(btrim(p_payload->>'reason'),'') IS NULL THEN
      RAISE EXCEPTION 'Current source and preview confirmation reason are required' USING ERRCODE='55000';
    END IF;
    UPDATE public.resident_record_intake_sources SET preflight_state='safe',safe_confirmed_by=(c->>'actor_id')::uuid,
      safe_confirmed_at=clock_timestamp(),state='ready_to_parse',revision=gen_random_uuid(),
      classification_reason_code='operator_preview_confirmed' WHERE id=s.id;

  ELSIF p_command='quarantine_source' THEN
    SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=(p_payload->>'source_id')::uuid
      AND intake_id=i.id AND deleted_at IS NULL FOR UPDATE;
    IF s.id IS NULL OR s.revision<>(p_payload->>'expected_revision')::uuid
       OR nullif(btrim(p_payload->>'reason_code'),'') IS NULL THEN
      RAISE EXCEPTION 'Current source and quarantine reason are required' USING ERRCODE='55000';
    END IF;
    UPDATE public.resident_record_intake_sources SET source_class='credential_secret',credential_quarantined=true,
      preflight_state='credential_detected',quarantine_reason_code=p_payload->>'reason_code',state='quarantined',
      document_type=NULL,credential_pattern_codes=coalesce(ARRAY(SELECT jsonb_array_elements_text(p_payload->'pattern_codes')),'{}'),
      revision=gen_random_uuid() WHERE id=s.id;

  ELSIF p_command='credential_override' THEN
    IF c->>'role' NOT IN ('owner','org_admin') OR nullif(btrim(p_payload->>'reason'),'') IS NULL THEN
      RAISE EXCEPTION 'Owner credential override and reason required' USING ERRCODE='42501';
    END IF;
    SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=(p_payload->>'source_id')::uuid
      AND intake_id=i.id AND deleted_at IS NULL FOR UPDATE;
    IF s.id IS NULL OR s.revision<>(p_payload->>'expected_revision')::uuid OR NOT s.credential_quarantined THEN
      RAISE EXCEPTION 'Current quarantined source required' USING ERRCODE='55000';
    END IF;
    UPDATE public.resident_record_intake_sources SET source_class='unclassified',credential_quarantined=false,
      quarantine_reason_code=NULL,credential_pattern_codes='{}',preflight_state='overridden',state='ready_to_parse',
      classification_reason_code='owner_credential_override:'||left(btrim(p_payload->>'reason'),400),revision=gen_random_uuid()
      WHERE id=s.id;

  ELSIF p_command='manual_classify_source' THEN
    SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=(p_payload->>'source_id')::uuid
      AND intake_id=i.id AND deleted_at IS NULL FOR UPDATE;
    IF s.id IS NULL OR s.revision<>(p_payload->>'expected_revision')::uuid OR s.finalized_at IS NULL
       OR p_payload->>'source_class' NOT IN ('resident','facility','employee','other_resident','credential_secret','unreadable','unsupported')
       OR nullif(btrim(p_payload->>'reason'),'') IS NULL THEN
      RAISE EXCEPTION 'Current finalized source, classification, and reason are required' USING ERRCODE='55000';
    END IF;
    IF p_payload->>'source_class'='resident' AND NOT haven.resident_record_document_type_allowed(p_payload->>'document_type') THEN
      RAISE EXCEPTION 'Choose a controlled resident document type' USING ERRCODE='22023';
    END IF;
    IF p_payload->>'source_class'='credential_secret' THEN new_state:='quarantined';
    ELSIF p_payload->>'source_class'='resident' THEN new_state:='review'; ELSE new_state:='excluded'; END IF;
    IF s.declared_mime='application/pdf' AND (p_payload->>'page_count')::integer<1 THEN
      RAISE EXCEPTION 'PDF page count and per-page decisions are required' USING ERRCODE='22023';
    END IF;
    UPDATE public.resident_record_intake_sources SET
      source_class=(p_payload->>'source_class')::public.resident_record_source_class,
      document_type=CASE WHEN p_payload->>'source_class'='resident' THEN p_payload->>'document_type' END,
      classification_confidence=nullif(p_payload->>'confidence','')::numeric,
      classification_reason_code=left(btrim(p_payload->>'reason'),500),state=new_state,
      credential_quarantined=p_payload->>'source_class'='credential_secret',
      preflight_state=CASE WHEN p_payload->>'source_class'='credential_secret' THEN 'credential_detected'
        WHEN p_payload->>'source_class'='resident' AND preflight_state='needs_confirmation' THEN 'safe' ELSE preflight_state END,
      safe_confirmed_by=CASE WHEN p_payload->>'source_class'='resident' THEN (c->>'actor_id')::uuid ELSE safe_confirmed_by END,
      safe_confirmed_at=CASE WHEN p_payload->>'source_class'='resident' THEN clock_timestamp() ELSE safe_confirmed_at END,
      quarantine_reason_code=CASE WHEN p_payload->>'source_class'='credential_secret' THEN 'operator_classified_credential' END,
      page_count=coalesce((p_payload->>'page_count')::integer,s.page_count,1),revision=gen_random_uuid()
      WHERE id=s.id RETURNING * INTO s;
    IF jsonb_array_length(coalesce(p_payload->'pages','[]'))=0 THEN
      IF s.page_count<>1 THEN RAISE EXCEPTION 'Every PDF page requires a classification' USING ERRCODE='22023'; END IF;
      item:=jsonb_build_object('page_number',1,'source_class',s.source_class,'document_type',s.document_type,
        'disposition',CASE WHEN s.source_class='resident' THEN 'resident_eligible' WHEN s.source_class='credential_secret' THEN 'quarantined'
          WHEN s.source_class IN ('unreadable','unsupported') THEN 'unreadable' ELSE 'excluded' END);
      p_payload:=p_payload||jsonb_build_object('pages',jsonb_build_array(item));
    END IF;
    IF jsonb_array_length(p_payload->'pages')<>s.page_count THEN RAISE EXCEPTION 'Every source page requires a classification' USING ERRCODE='22023'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'pages') LOOP
      IF (item->>'page_number')::integer NOT BETWEEN 1 AND s.page_count THEN RAISE EXCEPTION 'Invalid page number' USING ERRCODE='22023'; END IF;
      INSERT INTO public.resident_record_intake_pages(intake_id,source_id,organization_id,facility_id,page_number,
        source_class,document_type,disposition,confidence,reason_code,created_by)
      VALUES(i.id,s.id,i.organization_id,i.facility_id,(item->>'page_number')::integer,
        coalesce(item->>'source_class',s.source_class::text)::public.resident_record_source_class,
        coalesce(item->>'document_type',s.document_type),
        coalesce(item->>'disposition',CASE WHEN s.source_class='resident' THEN 'resident_eligible' ELSE 'excluded' END)::public.resident_record_page_disposition,
        nullif(item->>'confidence','')::numeric,left(btrim(p_payload->>'reason'),500),(c->>'actor_id')::uuid)
      ON CONFLICT(source_id,page_number) DO UPDATE SET source_class=EXCLUDED.source_class,
        document_type=EXCLUDED.document_type,disposition=EXCLUDED.disposition,confidence=EXCLUDED.confidence,
        reason_code=EXCLUDED.reason_code,revision=gen_random_uuid(),created_by=EXCLUDED.created_by,deleted_at=NULL;
    END LOOP;
    IF s.source_class='resident' AND EXISTS(SELECT 1 FROM public.resident_record_intake_pages p WHERE p.source_id=s.id
      AND (p.source_class<>'resident' OR p.document_type IS DISTINCT FROM s.document_type OR p.disposition<>'resident_eligible')) THEN
      UPDATE public.resident_record_intake_sources SET classification_reason_code='mixed_pages_require_split' WHERE id=s.id;
    END IF;

  ELSIF p_command='link_resident' THEN
    IF nullif(btrim(p_payload->>'duplicate_disposition'),'') IS NULL OR nullif(btrim(p_payload->>'reason'),'') IS NULL THEN
      RAISE EXCEPTION 'Explicit duplicate disposition and reason required' USING ERRCODE='22023';
    END IF;
    SELECT r.id INTO v_resident_id FROM public.residents r WHERE r.id=(p_payload->>'resident_id')::uuid
      AND r.organization_id=i.organization_id AND r.facility_id=i.facility_id AND r.deleted_at IS NULL FOR UPDATE;
    IF v_resident_id IS NULL OR i.resident_id IS NOT NULL AND i.resident_id<>v_resident_id THEN
      RAISE EXCEPTION 'Resident match unavailable' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.resident_record_intake_matches(intake_id,organization_id,facility_id,candidate_kind,
      candidate_resident_id,match_basis,disposition,reason,proposed_by,reviewed_by,reviewed_at)
    VALUES(i.id,i.organization_id,i.facility_id,'resident',v_resident_id,
      coalesce(ARRAY(SELECT jsonb_array_elements_text(p_payload->'match_basis')),'{}'),'confirmed',
      left(btrim(p_payload->>'reason'),1000),'reviewer',(c->>'actor_id')::uuid,clock_timestamp());
    UPDATE public.resident_record_intakes SET resident_id=v_resident_id,state='review',reviewed_by=(c->>'actor_id')::uuid,
      reviewed_at=clock_timestamp(),revision=gen_random_uuid() WHERE id=i.id;

  ELSIF p_command='create_provisional_resident' THEN
    IF i.resident_id IS NOT NULL OR length(btrim(coalesce(p_payload->>'first_name','')))=0
       OR length(btrim(coalesce(p_payload->>'last_name','')))=0
       OR p_payload->>'duplicate_disposition' NOT IN ('no_match','not_same_person','known_duplicate_not_linked')
       OR nullif(btrim(p_payload->>'reason'),'') IS NULL THEN
      RAISE EXCEPTION 'Confirmed name, duplicate disposition, and reason are required' USING ERRCODE='22023';
    END IF;
    v_resident_id:=gen_random_uuid();
    INSERT INTO public.residents(id,organization_id,facility_id,first_name,middle_name,last_name,date_of_birth,gender,
      status,code_status,ambulatory,elopement_risk,wandering_risk,fall_risk_level,smoking_status,primary_payer,
      created_by,updated_by)
    VALUES(v_resident_id,i.organization_id,i.facility_id,btrim(p_payload->>'first_name'),nullif(btrim(p_payload->>'middle_name'),''),
      btrim(p_payload->>'last_name'),nullif(p_payload->>'date_of_birth','')::date,nullif(p_payload->>'gender','')::public.gender,
      'inquiry',NULL,NULL,NULL,NULL,NULL,NULL,NULL,(c->>'actor_id')::uuid,(c->>'actor_id')::uuid);
    INSERT INTO public.resident_record_intake_matches(intake_id,organization_id,facility_id,candidate_kind,
      candidate_resident_id,match_basis,disposition,reason,proposed_by,reviewed_by,reviewed_at)
    VALUES(i.id,i.organization_id,i.facility_id,'provisional_new',v_resident_id,ARRAY[p_payload->>'duplicate_disposition'],
      'created_provisional',left(btrim(p_payload->>'reason'),1000),'reviewer',(c->>'actor_id')::uuid,clock_timestamp());
    UPDATE public.resident_record_intakes SET resident_id=v_resident_id,state='review',reviewed_by=(c->>'actor_id')::uuid,
      reviewed_at=clock_timestamp(),revision=gen_random_uuid() WHERE id=i.id;

  ELSIF p_command='propose_manual_fact' THEN
    SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=(p_payload->>'source_id')::uuid
      AND intake_id=i.id AND deleted_at IS NULL;
    IF i.resident_id IS NULL OR s.id IS NULL OR s.finalized_at IS NULL OR s.source_class<>'resident'
       OR NOT haven.resident_record_field_allowed(p_payload->>'field_code')
       OR p_payload->>'domain' NOT IN ('demographics','clinical','payer','legal','authority','admission','contact','screening')
       OR NOT haven.resident_record_payload_safe(p_payload->'structured_value')
       OR length(p_payload->>'display_value') NOT BETWEEN 1 AND 2000 THEN
      RAISE EXCEPTION 'Bound resident and controlled safe manual fact are required' USING ERRCODE='22023';
    END IF;
    IF p_payload->>'field_code'='resident.ssn_last_four' AND (p_payload#>>'{structured_value,value}')!~'^[0-9]{4}$' THEN
      RAISE EXCEPTION 'Only confirmed SSN last four can be proposed' USING ERRCODE='22023';
    END IF;
    new_fact:=gen_random_uuid();reviewer:=haven.resident_record_expected_reviewer(p_payload->>'field_code');
    INSERT INTO public.resident_record_extracted_facts(id,intake_id,source_id,organization_id,facility_id,field_code,domain,
      structured_value,display_value,source_page_start,source_page_end,confidence,current_value_fingerprint,
      conflict,conflict_code,required_reviewer,proposal_origin,proposed_by)
    VALUES(new_fact,i.id,s.id,i.organization_id,i.facility_id,p_payload->>'field_code',p_payload->>'domain',
      p_payload->'structured_value',p_payload->>'display_value',nullif(p_payload->>'page_start','')::integer,
      nullif(p_payload->>'page_end','')::integer,nullif(p_payload->>'confidence','')::numeric,
      haven.resident_record_canonical_fingerprint(i.id,p_payload->>'field_code',p_payload->'structured_value'),
      coalesce((p_payload->>'conflict')::boolean,false),nullif(p_payload->>'conflict_code',''),reviewer,'manual',(c->>'actor_id')::uuid);
    INSERT INTO public.resident_record_fact_events(intake_id,fact_id,organization_id,facility_id,event_type,fact_revision,actor_id,reason,metadata)
      SELECT i.id,new_fact,i.organization_id,i.facility_id,'proposed',x.revision,(c->>'actor_id')::uuid,p_payload->>'reason',
        jsonb_build_object('origin','manual') FROM public.resident_record_extracted_facts x WHERE x.id=new_fact;

  ELSIF p_command IN ('approve_fact','reject_fact') THEN
    SELECT * INTO f FROM public.resident_record_extracted_facts WHERE id=(p_payload->>'fact_id')::uuid
      AND intake_id=i.id AND deleted_at IS NULL FOR UPDATE;
    IF f.id IS NULL OR f.revision<>(p_payload->>'expected_revision')::uuid OR f.state<>'proposed'
       OR NOT haven.resident_record_reviewer_allowed(f.required_reviewer)
       OR nullif(btrim(p_payload->>'reason'),'') IS NULL
       OR (p_command='approve_fact' AND f.conflict AND nullif(btrim(p_payload->>'reason'),'') IS NULL) THEN
      RAISE EXCEPTION 'Current fact, authorized reviewer, and reason are required' USING ERRCODE='42501';
    END IF;
    UPDATE public.resident_record_extracted_facts SET state=CASE WHEN p_command='approve_fact' THEN 'approved'::public.resident_record_fact_state ELSE 'rejected'::public.resident_record_fact_state END,
      current_value_fingerprint=haven.resident_record_canonical_fingerprint(i.id,f.field_code,f.structured_value),
      reviewed_by=(c->>'actor_id')::uuid,reviewed_at=clock_timestamp(),review_reason=left(btrim(p_payload->>'reason'),1000),
      revision=gen_random_uuid() WHERE id=f.id RETURNING * INTO f;
    INSERT INTO public.resident_record_fact_events(intake_id,fact_id,organization_id,facility_id,event_type,fact_revision,actor_id,reason)
    VALUES(i.id,f.id,i.organization_id,i.facility_id,CASE WHEN p_command='approve_fact' THEN 'approved' ELSE 'rejected' END,
      f.revision,(c->>'actor_id')::uuid,left(btrim(p_payload->>'reason'),1000));

  ELSIF p_command='correct_fact' THEN
    SELECT * INTO f FROM public.resident_record_extracted_facts WHERE id=(p_payload->>'fact_id')::uuid
      AND intake_id=i.id AND deleted_at IS NULL FOR UPDATE;
    IF f.id IS NULL OR f.revision<>(p_payload->>'expected_revision')::uuid OR f.state NOT IN ('proposed','approved')
       OR NOT haven.resident_record_reviewer_allowed(f.required_reviewer)
       OR NOT haven.resident_record_payload_safe(p_payload->'structured_value')
       OR length(p_payload->>'display_value') NOT BETWEEN 1 AND 2000
       OR nullif(btrim(p_payload->>'reason'),'') IS NULL THEN
      RAISE EXCEPTION 'Current fact, safe correction, and reviewer reason are required' USING ERRCODE='22023';
    END IF;
    UPDATE public.resident_record_extracted_facts SET state='superseded',reviewed_by=(c->>'actor_id')::uuid,
      reviewed_at=coalesce(reviewed_at,clock_timestamp()),review_reason=left(btrim(p_payload->>'reason'),1000),revision=gen_random_uuid()
      WHERE id=f.id;
    new_fact:=gen_random_uuid();
    INSERT INTO public.resident_record_extracted_facts(id,intake_id,source_id,organization_id,facility_id,fact_key,fact_version,
      field_code,domain,structured_value,display_value,source_page_start,source_page_end,confidence,
      current_value_fingerprint,conflict,conflict_code,required_reviewer,corrected_fact_id,proposal_origin,proposed_by)
    VALUES(new_fact,i.id,f.source_id,i.organization_id,i.facility_id,f.fact_key,f.fact_version+1,f.field_code,f.domain,
      p_payload->'structured_value',p_payload->>'display_value',coalesce(nullif(p_payload->>'page_start','')::integer,f.source_page_start),
      coalesce(nullif(p_payload->>'page_end','')::integer,f.source_page_end),f.confidence,
      haven.resident_record_canonical_fingerprint(i.id,f.field_code,p_payload->'structured_value'),
      coalesce((p_payload->>'conflict')::boolean,false),nullif(p_payload->>'conflict_code',''),f.required_reviewer,
      f.id,'reviewer_correction',(c->>'actor_id')::uuid);
    INSERT INTO public.resident_record_fact_events(intake_id,fact_id,organization_id,facility_id,event_type,fact_revision,actor_id,reason,metadata)
      SELECT i.id,new_fact,i.organization_id,i.facility_id,'corrected',x.revision,(c->>'actor_id')::uuid,
        left(btrim(p_payload->>'reason'),1000),jsonb_build_object('corrects_fact_id',f.id)
      FROM public.resident_record_extracted_facts x WHERE x.id=new_fact;

  ELSIF p_command='apply_fact' THEN
    SELECT * INTO f FROM public.resident_record_extracted_facts WHERE id=(p_payload->>'fact_id')::uuid
      AND intake_id=i.id AND deleted_at IS NULL FOR UPDATE;
    IF f.id IS NULL OR f.revision<>(p_payload->>'expected_revision')::uuid OR f.state<>'approved'
       OR NOT haven.resident_record_reviewer_allowed(f.required_reviewer) THEN
      RAISE EXCEPTION 'Current approved fact and authorized applier are required' USING ERRCODE='42501';
    END IF;
    before_hash:=f.current_value_fingerprint;
    current_hash:=haven.resident_record_canonical_fingerprint(i.id,f.field_code,f.structured_value);
    receipt_id:=gen_random_uuid();
    IF current_hash<>before_hash THEN
      UPDATE public.resident_record_extracted_facts SET state='stale',reviewed_at=clock_timestamp(),
        reviewed_by=(c->>'actor_id')::uuid,review_reason='Canonical target changed after approval',revision=gen_random_uuid() WHERE id=f.id;
      INSERT INTO public.resident_record_application_receipts(id,intake_id,fact_id,fact_revision,organization_id,facility_id,
        request_key,request_hash,before_fingerprint,after_fingerprint,destination_type,actor_id,result)
      VALUES(receipt_id,i.id,f.id,f.revision,i.organization_id,i.facility_id,p_request_key,h,before_hash,current_hash,
        split_part(f.field_code,'.',1),(c->>'actor_id')::uuid,'stale_target');
      INSERT INTO public.resident_record_fact_events(intake_id,fact_id,organization_id,facility_id,event_type,fact_revision,actor_id,reason)
      VALUES(i.id,f.id,i.organization_id,i.facility_id,'stale_target',f.revision,(c->>'actor_id')::uuid,'Canonical target changed after approval');
      response:=public.resident_record_intake_snapshot(i.id)||jsonb_build_object('receipt',jsonb_build_object(
        'id',receipt_id,'result','stale_target','before_fingerprint',before_hash,'after_fingerprint',current_hash));
    ELSE
      application:=haven.apply_resident_record_fact(f.id,(c->>'actor_id')::uuid,
        coalesce(p_payload->>'promotion_mode','add'),nullif(p_payload->>'replace_document_id','')::uuid);
      after_hash:=application->>'after_fingerprint';
      UPDATE public.resident_record_extracted_facts SET state='applied',applied_destination=application->>'destination_type',
        applied_record_id=(application->>'destination_id')::uuid,applied_at=clock_timestamp(),revision=gen_random_uuid() WHERE id=f.id RETURNING * INTO f;
      INSERT INTO public.resident_record_application_receipts(id,intake_id,fact_id,fact_revision,organization_id,facility_id,
        request_key,request_hash,before_fingerprint,after_fingerprint,destination_type,destination_id,actor_id,result,applied_at)
      VALUES(receipt_id,i.id,f.id,f.revision,i.organization_id,i.facility_id,p_request_key,h,before_hash,after_hash,
        application->>'destination_type',(application->>'destination_id')::uuid,(c->>'actor_id')::uuid,'applied',clock_timestamp());
      INSERT INTO public.resident_record_fact_events(intake_id,fact_id,organization_id,facility_id,event_type,fact_revision,actor_id,metadata)
      VALUES(i.id,f.id,i.organization_id,i.facility_id,'applied',f.revision,(c->>'actor_id')::uuid,
        jsonb_build_object('destination_type',application->>'destination_type','destination_id',application->>'destination_id'));
      UPDATE public.resident_record_intakes SET state='partially_applied',applied_fact_count=(SELECT count(*) FROM public.resident_record_extracted_facts x
        WHERE x.intake_id=i.id AND x.state='applied' AND x.deleted_at IS NULL),revision=gen_random_uuid() WHERE id=i.id;
      response:=public.resident_record_intake_snapshot(i.id)||jsonb_build_object('receipt',jsonb_build_object(
        'id',receipt_id,'result','applied','destination_type',application->>'destination_type',
        'destination_id',application->>'destination_id','source_document_id',application->>'source_document_id'));
    END IF;

  ELSIF p_command='apply_source_document' THEN
    SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=(p_payload->>'source_id')::uuid
      AND intake_id=i.id AND deleted_at IS NULL FOR UPDATE;
    IF s.id IS NULL OR s.revision<>(p_payload->>'expected_revision')::uuid OR s.document_type='form_1823' THEN
      RAISE EXCEPTION 'Current non-1823 reviewed source required' USING ERRCODE='55000';
    END IF;
    document_id:=haven.promote_resident_record_source(i.id,s.id,coalesce(p_payload->>'promotion_mode','add'),
      nullif(p_payload->>'replace_document_id','')::uuid,(c->>'actor_id')::uuid);

  ELSIF p_command='record_parse_failure' THEN
    IF p_payload->>'error_code' !~ '^[a-z0-9_]{1,80}$' THEN RAISE EXCEPTION 'Sanitized parser error code required' USING ERRCODE='22023'; END IF;
    SELECT * INTO s FROM public.resident_record_intake_sources WHERE id=(p_payload->>'source_id')::uuid
      AND intake_id=i.id AND deleted_at IS NULL FOR UPDATE;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Resident source unavailable' USING ERRCODE='42501'; END IF;
    UPDATE public.resident_record_intake_sources SET state='failed',parser_metadata=jsonb_build_object('error_code',p_payload->>'error_code'),
      revision=gen_random_uuid() WHERE id=s.id;
    UPDATE public.resident_record_intakes SET parser_state='retryable',state='review',revision=gen_random_uuid() WHERE id=i.id;

  ELSIF p_command='complete_intake' THEN
    IF i.resident_id IS NULL OR EXISTS(SELECT 1 FROM public.resident_record_intake_sources x WHERE x.intake_id=i.id
         AND x.deleted_at IS NULL AND x.state IN ('prepared','finalized','ready_to_parse','parsing'))
       OR EXISTS(SELECT 1 FROM public.resident_record_extracted_facts x WHERE x.intake_id=i.id
         AND x.deleted_at IS NULL AND x.state IN ('proposed','approved')) THEN
      RAISE EXCEPTION 'Resolve resident, source, and fact review before completion' USING ERRCODE='55000';
    END IF;
    UPDATE public.resident_record_intakes SET state='complete',completed_by=(c->>'actor_id')::uuid,
      completed_at=clock_timestamp(),revision=gen_random_uuid() WHERE id=i.id;
  ELSE RAISE EXCEPTION 'Unsupported resident intake command' USING ERRCODE='22023'; END IF;

  UPDATE public.resident_record_intakes SET
    quarantined_source_count=(SELECT count(*) FROM public.resident_record_intake_sources x WHERE x.intake_id=i.id AND x.credential_quarantined AND x.deleted_at IS NULL),
    finalized_source_count=(SELECT count(*) FROM public.resident_record_intake_sources x WHERE x.intake_id=i.id AND x.finalized_at IS NOT NULL AND x.deleted_at IS NULL)
    WHERE id=i.id;
  IF response IS NULL THEN
    response:=public.resident_record_intake_snapshot(i.id)||jsonb_build_object('result',jsonb_strip_nulls(jsonb_build_object(
      'fact_id',new_fact,'resident_id',v_resident_id,'document_id',document_id)));
  END IF;
  response:=response||jsonb_build_object('replayed',false);
  INSERT INTO haven.resident_record_intake_requests(actor_id,intake_id,request_key,operation,request_hash,response,completed_at)
    VALUES((c->>'actor_id')::uuid,i.id,p_request_key,p_command,h,response,clock_timestamp());
  RETURN response;
END
$function$;

CREATE OR REPLACE FUNCTION haven.guard_resident_record_source_lineage()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE old_row jsonb:=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  new_row jsonb:=to_jsonb(NEW); key text;
  -- Columns that only a reviewed intake command may ever set: they name an
  -- intake, one of its sources, or one of its reviewed facts.
  lineage_keys constant text[] := ARRAY[
    'resident_record_intake_id','resident_record_intake_source_id','resident_record_intake_fact_id',
    'source_resident_document_id','source_intake_fact_id','source_page_numbers',
    'supersedes_form_1823_id'
  ];
  -- Ordinary document versioning. Intake uses it, but so does every other
  -- feature that supersedes a document, so it is guarded only on UPDATE --
  -- where changing it is a supersession act. On INSERT these arrive from column
  -- defaults (is_current is NOT NULL DEFAULT true), and refusing a default
  -- would block every authenticated document write in the product, not just
  -- intake's.
  versioning_keys constant text[] := ARRAY[
    'source_document_id','supersedes_document_id','superseded_at','superseded_by',
    'is_current','resident_document_id','form_version'
  ];
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
  FOREACH key IN ARRAY (CASE WHEN TG_OP='INSERT' THEN lineage_keys ELSE lineage_keys||versioning_keys END) LOOP
    IF new_row ? key AND new_row->key IS DISTINCT FROM old_row->key AND new_row->key<> 'null'::jsonb THEN
      RAISE EXCEPTION 'Resident intake source lineage requires a reviewed command' USING ERRCODE='42501';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION haven.guard_resident_record_source_lineage() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER tr_resident_documents_intake_lineage BEFORE INSERT OR UPDATE ON public.resident_documents
  FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_record_source_lineage();
CREATE TRIGGER tr_resident_contacts_intake_lineage BEFORE INSERT OR UPDATE ON public.resident_contacts
  FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_record_source_lineage();
CREATE TRIGGER tr_assessments_intake_lineage BEFORE INSERT OR UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_record_source_lineage();
CREATE TRIGGER tr_resident_payers_intake_lineage BEFORE INSERT OR UPDATE ON public.resident_payers
  FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_record_source_lineage();
CREATE TRIGGER tr_advance_directives_intake_lineage BEFORE INSERT OR UPDATE ON public.advance_directive_documents
  FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_record_source_lineage();
CREATE TRIGGER tr_resident_contracts_intake_lineage BEFORE INSERT OR UPDATE ON public.resident_contracts
  FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_record_source_lineage();
CREATE TRIGGER tr_admission_checklist_intake_lineage BEFORE INSERT OR UPDATE ON public.admission_document_checklist_items
  FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_record_source_lineage();
CREATE TRIGGER tr_form_1823_intake_lineage BEFORE INSERT OR UPDATE ON public.form_1823_records
  FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_record_source_lineage();

REVOKE ALL ON FUNCTION public.prepare_resident_record_intake(text,uuid,text,uuid,uuid),
  public.prepare_resident_record_intake_source(uuid,text,jsonb),
  public.resident_record_intake_source_target(uuid,uuid),
  public.finalize_resident_record_intake_source(uuid,uuid,text,uuid),
  public.resident_record_intake_snapshot(uuid),
  public.resident_record_intake_match_candidates(uuid,text,text,date,integer),
  public.resident_record_intake_command(uuid,text,text,jsonb)
FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_resident_record_intake(text,uuid,text,uuid,uuid),
  public.prepare_resident_record_intake_source(uuid,text,jsonb),
  public.resident_record_intake_source_target(uuid,uuid),
  public.finalize_resident_record_intake_source(uuid,uuid,text,uuid),
  public.resident_record_intake_snapshot(uuid),
  public.resident_record_intake_match_candidates(uuid,text,text,date,integer),
  public.resident_record_intake_command(uuid,text,text,jsonb)
TO authenticated;

REVOKE ALL ON FUNCTION public.attest_resident_record_intake_bytes(uuid,uuid,text,text,integer,text,text,text,uuid),
  public.stage_resident_record_parse_result(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,text,jsonb)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attest_resident_record_intake_bytes(uuid,uuid,text,text,integer,text,text,text,uuid),
  public.stage_resident_record_parse_result(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,text,jsonb)
TO service_role;

COMMENT ON TABLE public.resident_record_intakes IS 'One facility-scoped, intended-resident packet review. Completion is source workflow completion, not arrival, census, or release acceptance.';
COMMENT ON TABLE public.resident_record_intake_sources IS 'Immutable declared and server-attested packet source identity; excluded and credential sources never become resident documents.';
COMMENT ON TABLE public.resident_record_extracted_facts IS 'Versioned parser/manual proposals. Corrections append a new version; approval and application remain separate.';
COMMENT ON TABLE public.resident_record_application_receipts IS 'Replay-safe destination application receipts, including durable stale-target refusal.';
COMMENT ON FUNCTION public.resident_record_intake_command(uuid,text,text,jsonb) IS 'Allowlisted current-authority intake command surface; it never activates census, occupies a bed, or creates eMAR history.';
COMMENT ON FUNCTION public.stage_resident_record_parse_result(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,text,jsonb) IS 'Service-only staging of schema-validated provider output after direct revalidation of the current database actor and facility grant.';

COMMIT;
