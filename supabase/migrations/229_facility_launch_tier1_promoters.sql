-- Facility Launch Tier-1 promoter target columns and document-vault extensions.
-- Extends existing operational tables instead of introducing parallel launch-only targets.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS launch_profile_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS dba text,
  ADD COLUMN IF NOT EXISTS facility_type text,
  ADD COLUMN IF NOT EXISTS license_state text,
  ADD COLUMN IF NOT EXISTS license_agency text,
  ADD COLUMN IF NOT EXISTS license_expiration date,
  ADD COLUMN IF NOT EXISTS physical_address text,
  ADD COLUMN IF NOT EXISTS facility_address text,
  ADD COLUMN IF NOT EXISTS mailing_address text,
  ADD COLUMN IF NOT EXISTS main_phone text,
  ADD COLUMN IF NOT EXISTS after_hours_phone text,
  ADD COLUMN IF NOT EXISTS capacity integer,
  ADD COLUMN IF NOT EXISTS floors_wings text,
  ADD COLUMN IF NOT EXISTS executive_director_name text,
  ADD COLUMN IF NOT EXISTS don_name text,
  ADD COLUMN IF NOT EXISTS maintenance_director_name text,
  ADD COLUMN IF NOT EXISTS business_office_manager_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS operating_address_confirmed boolean,
  ADD COLUMN IF NOT EXISTS launch_profile_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Existing schema already has facilities.license_number. Keep it as the M2 target.

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS launch_profile_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Existing facility_documents is the facility-visible vault. Add launch metadata columns
-- needed for pending source-of-truth registration without requiring file upload yet.
ALTER TABLE public.facility_documents
  ADD COLUMN IF NOT EXISTS artifact_type text,
  ADD COLUMN IF NOT EXISTS original_filename text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS entity_association text,
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS term text,
  ADD COLUMN IF NOT EXISTS version text,
  ADD COLUMN IF NOT EXISTS is_source_of_truth boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custodian_approval_status text,
  ADD COLUMN IF NOT EXISTS confidence text,
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.documents(id),
  ADD COLUMN IF NOT EXISTS pending_upload boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_documents_launch_active_key
  ON public.facility_documents (facility_id, artifact_type, original_filename)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_facility_documents_launch_artifact
  ON public.facility_documents (facility_id, artifact_type)
  WHERE deleted_at IS NULL;

-- Promoters create run item rows before execution so links can point at the item.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.facility_launch_promotion_run_items'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.facility_launch_promotion_run_items DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.facility_launch_promotion_run_items
  ADD CONSTRAINT facility_launch_promotion_run_items_status_check
  CHECK (status IN ('running', 'promoted', 'skipped', 'partial', 'failed', 'not_implemented'));

COMMENT ON COLUMN public.organizations.launch_profile_metadata IS 'Facility Launch profile overflow metadata promoted from M1.';
COMMENT ON COLUMN public.facilities.launch_profile_metadata IS 'Facility Launch profile overflow metadata promoted from supported modules.';
COMMENT ON COLUMN public.rooms.launch_profile_metadata IS 'Facility Launch room/unit source metadata not represented by core room columns.';
COMMENT ON COLUMN public.facility_documents.pending_upload IS 'True when Facility Launch registered document metadata before an actual file upload/link exists.';
