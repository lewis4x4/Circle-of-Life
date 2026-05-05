-- Facility Launch document parser pipeline.
-- Adds the approval/provenance layer between OCR/AI extraction and module writes.

CREATE TABLE IF NOT EXISTS public.document_parser_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid REFERENCES public.facilities(id),
  document_id uuid NOT NULL REFERENCES public.documents(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  parser_version text NOT NULL DEFAULT 'facility-launch-parser-v1',
  parse_mode text NOT NULL DEFAULT 'ocr_ai' CHECK (parse_mode IN ('ocr_ai', 'heuristic', 'manual')),
  queued_by uuid REFERENCES auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  result_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_document_parser_jobs_org_status
  ON public.document_parser_jobs (organization_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_document_parser_jobs_document
  ON public.document_parser_jobs (document_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.document_extracted_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid REFERENCES public.facilities(id),
  document_id uuid NOT NULL REFERENCES public.documents(id),
  parser_job_id uuid REFERENCES public.document_parser_jobs(id) ON DELETE SET NULL,
  artifact_type text NOT NULL DEFAULT 'other',
  fact_key text NOT NULL,
  fact_label text NOT NULL,
  extracted_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_value text,
  confidence numeric(5,4) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  source_excerpt text,
  page_number integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_module_code text NOT NULL DEFAULT 'M17',
  proposed_field_path text NOT NULL,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'applied', 'superseded')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_notes text,
  applied_by uuid REFERENCES auth.users(id),
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_document_extracted_facts_doc_status
  ON public.document_extracted_facts (document_id, approval_status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_document_extracted_facts_module
  ON public.document_extracted_facts (organization_id, facility_id, proposed_module_code, proposed_field_path)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.facility_launch_module_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid REFERENCES public.facilities(id),
  module_code text NOT NULL,
  field_path text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_document_id uuid REFERENCES public.documents(id),
  source_fact_id uuid REFERENCES public.document_extracted_facts(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_by uuid REFERENCES auth.users(id),
  applied_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_launch_module_values_active_unique
  ON public.facility_launch_module_values (organization_id, facility_id, module_code, field_path)
  WHERE deleted_at IS NULL AND superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_facility_launch_module_values_source_doc
  ON public.facility_launch_module_values (source_document_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.document_parser_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_extracted_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_launch_module_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_parser_jobs_org_read ON public.document_parser_jobs;
CREATE POLICY document_parser_jobs_org_read ON public.document_parser_jobs
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

DROP POLICY IF EXISTS document_parser_jobs_admin_write ON public.document_parser_jobs;
CREATE POLICY document_parser_jobs_admin_write ON public.document_parser_jobs
  FOR ALL
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

DROP POLICY IF EXISTS document_extracted_facts_org_read ON public.document_extracted_facts;
CREATE POLICY document_extracted_facts_org_read ON public.document_extracted_facts
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

DROP POLICY IF EXISTS document_extracted_facts_admin_write ON public.document_extracted_facts;
CREATE POLICY document_extracted_facts_admin_write ON public.document_extracted_facts
  FOR ALL
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

DROP POLICY IF EXISTS facility_launch_module_values_org_read ON public.facility_launch_module_values;
CREATE POLICY facility_launch_module_values_org_read ON public.facility_launch_module_values
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

DROP POLICY IF EXISTS facility_launch_module_values_admin_write ON public.facility_launch_module_values;
CREATE POLICY facility_launch_module_values_admin_write ON public.facility_launch_module_values
  FOR ALL
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

DROP TRIGGER IF EXISTS tr_document_parser_jobs_set_updated_at ON public.document_parser_jobs;
CREATE TRIGGER tr_document_parser_jobs_set_updated_at
  BEFORE UPDATE ON public.document_parser_jobs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_document_extracted_facts_set_updated_at ON public.document_extracted_facts;
CREATE TRIGGER tr_document_extracted_facts_set_updated_at
  BEFORE UPDATE ON public.document_extracted_facts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_facility_launch_module_values_set_updated_at ON public.facility_launch_module_values;
CREATE TRIGGER tr_facility_launch_module_values_set_updated_at
  BEFORE UPDATE ON public.facility_launch_module_values
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_document_parser_jobs_audit ON public.document_parser_jobs;
CREATE TRIGGER tr_document_parser_jobs_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.document_parser_jobs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

DROP TRIGGER IF EXISTS tr_document_extracted_facts_audit ON public.document_extracted_facts;
CREATE TRIGGER tr_document_extracted_facts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.document_extracted_facts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

DROP TRIGGER IF EXISTS tr_facility_launch_module_values_audit ON public.facility_launch_module_values;
CREATE TRIGGER tr_facility_launch_module_values_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_launch_module_values
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

COMMENT ON TABLE public.document_parser_jobs IS 'Facility Launch parser job queue for OCR/AI extraction over uploaded KB documents.';
COMMENT ON TABLE public.document_extracted_facts IS 'Human-reviewable facts extracted from documents with evidence, confidence, target module, and approval state.';
COMMENT ON TABLE public.facility_launch_module_values IS 'Approved/applied Facility Launch module values with source document/fact provenance.';
