-- Document Vault: FL ALF taxonomy expansion, carrier/title metadata, series + supersede columns.
-- Replaces facility_documents.document_category CHECK with expanded enum + data backfill.

ALTER TABLE public.facility_documents
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS friendly_title text,
  ADD COLUMN IF NOT EXISTS vault_series_id uuid,
  ADD COLUMN IF NOT EXISTS supersedes_document_id uuid REFERENCES public.facility_documents(id),
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Back-fill series id (each row is its own series until a replace workflow shares it).
UPDATE public.facility_documents
SET vault_series_id = id
WHERE vault_series_id IS NULL;

ALTER TABLE public.facility_documents
  ALTER COLUMN vault_series_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fd_vault_series_active
  ON public.facility_documents (vault_series_id)
  WHERE deleted_at IS NULL;

-- Drop legacy CHECK and install expanded taxonomy ----------------------------

ALTER TABLE public.facility_documents
  DROP CONSTRAINT IF EXISTS facility_documents_document_category_check;

-- Map deprecated codes → new taxonomy
UPDATE public.facility_documents SET document_category = 'ahca_licensing' WHERE document_category = 'ahca_license';
UPDATE public.facility_documents SET document_category = 'fire_inspections' WHERE document_category = 'fire_inspection';
UPDATE public.facility_documents SET document_category = 'elevator_certificate' WHERE document_category = 'elevator_inspection';
UPDATE public.facility_documents SET document_category = 'food_service_license' WHERE document_category = 'kitchen_license';
UPDATE public.facility_documents SET document_category = 'survey_reports_poc' WHERE document_category = 'survey_report';
UPDATE public.facility_documents SET document_category = 'survey_reports_poc' WHERE document_category = 'poc_response';
UPDATE public.facility_documents SET document_category = 'resident_contracts_master' WHERE document_category = 'resident_handbook';
UPDATE public.facility_documents SET document_category = 'policies_procedures_manual' WHERE document_category = 'employee_handbook';
UPDATE public.facility_documents SET document_category = 'building_permits_cof' WHERE document_category IN ('building_permit', 'occupancy_certificate');
UPDATE public.facility_documents SET document_category = 'generator_service_records' WHERE document_category = 'generator_inspection';
UPDATE public.facility_documents SET document_category = 'sprinkler_inspections' WHERE document_category = 'sprinkler_inspection';
UPDATE public.facility_documents SET document_category = 'pest_control_records' WHERE document_category = 'pest_control_report';
UPDATE public.facility_documents SET document_category = 'floor_plans_evacuation_maps' WHERE document_category IN ('floor_plan', 'evacuation_plan');
UPDATE public.facility_documents SET document_category = 'photos' WHERE document_category LIKE 'photo_%';
UPDATE public.facility_documents SET document_category = 'vendor_contracts' WHERE document_category = 'vendor_contract';
UPDATE public.facility_documents SET document_category = 'fire_inspections' WHERE document_category = 'fire_alarm_inspection';

-- Roll legacy ancillary codes into “Other / Miscellaneous” (not in Haven FL vault taxonomy chips).
UPDATE public.facility_documents SET document_category = 'other_misc'
WHERE document_category IN (
  'storm_preparedness',
  'other',
  'radon_test',
  'water_quality_report',
  'ada_compliance',
  'backflow_prevention'
);

-- Homewood insurance quartet (explicit filenames)
UPDATE public.facility_documents
SET
  document_category = 'insurance_general_liability',
  carrier = COALESCE(carrier, 'Smith & Sorensen')
WHERE document_name ILIKE '%GL CERT%';

UPDATE public.facility_documents
SET
  document_category = 'insurance_property',
  carrier = COALESCE(carrier, 'Smith & Sorensen')
WHERE document_name ILIKE '%PROPERTY%POLICY%';

UPDATE public.facility_documents
SET
  document_category = 'insurance_bond',
  carrier = COALESCE(carrier, 'Smith & Sorensen')
WHERE document_name ILIKE '%BOND%CERTIFICATE%';

UPDATE public.facility_documents
SET
  document_category = 'insurance_loss_run',
  carrier = COALESCE(carrier, 'Smith & Sorensen')
WHERE document_name ILIKE '%LOSS%RUN%';

-- Remaining ambiguous insurance uploads collapse to GL placeholder (reviewers split via re-categorize).
UPDATE public.facility_documents SET document_category = 'insurance_general_liability'
WHERE document_category = 'insurance_certificate';

ALTER TABLE public.facility_documents ADD CONSTRAINT facility_documents_document_category_check
CHECK (document_category IN (
  'ahca_licensing',
  'survey_reports_poc',
  'fire_inspections',
  'sprinkler_inspections',
  'generator_service_records',
  'cemp',
  'insurance_general_liability',
  'insurance_property',
  'insurance_professional_liability',
  'insurance_workers_comp',
  'insurance_bond',
  'insurance_loss_run',
  'vendor_contracts',
  'vendor_coi',
  'medical_director_agreement',
  'hospice_partnership_agreements',
  'pharmacy_contract',
  'resident_contracts_master',
  'building_permits_cof',
  'elevator_certificate',
  'pest_control_records',
  'health_department_inspections',
  'food_service_license',
  'background_check_records',
  'staff_training_records',
  'policies_procedures_manual',
  'floor_plans_evacuation_maps',
  'photos',
  'other_misc'
));

COMMENT ON COLUMN public.facility_documents.carrier IS 'Optional underwriting / broker label (often insurance carrier)';
COMMENT ON COLUMN public.facility_documents.friendly_title IS 'Optional reviewer-facing title; document_name retains source filename.';
COMMENT ON COLUMN public.facility_documents.vault_series_id IS 'Stable series id tying replacement versions together.';
COMMENT ON COLUMN public.facility_documents.supersedes_document_id IS 'Prior facility_documents row superseded by this upload.';
COMMENT ON COLUMN public.facility_documents.archived_at IS 'Soft-archive timestamp (30-day compliance retention before purge workflows).';

-- Version ledger (immutable rows per superseded upload)
CREATE TABLE IF NOT EXISTS public.facility_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  superseded_document_id uuid NOT NULL REFERENCES public.facility_documents(id) ON DELETE CASCADE,
  vault_series_id uuid NOT NULL,
  version_number integer NOT NULL,
  document_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  expiration_date date,
  document_category text NOT NULL,
  replaced_by uuid REFERENCES auth.users(id),
  replaced_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.facility_document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY fdv_select ON public.facility_document_versions
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY fdv_manage ON public.facility_document_versions
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE INDEX IF NOT EXISTS idx_fdv_series ON public.facility_document_versions (vault_series_id);
