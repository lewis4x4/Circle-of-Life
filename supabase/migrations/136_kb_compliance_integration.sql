-- ============================================================
-- Knowledge Base Compliance Integration (Module 08 Enhanced Tier)
-- Migration: 127
-- Spec: docs/specs/08-compliance-engine.md § Enhanced Tier
-- ============================================================

-- COMPLIANCE CATEGORY ADDITIONS TO public.documents
-- ============================================================

ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS compliance_category text
CHECK (compliance_category IN (
    'general',
    'ahca_regulation',
    'ahca_tag_reference',
    'sop',
    'training_material',
    'inspection_guideline',
    'facility_policy',
    'resident_rights_policy',
    'medication_admin_policy',
    'dietary_policy',
    'emergency_prep_policy'
  ));

-- ============================================================
-- REGULATORY REFERENCE COLUMNS TO public.documents
-- ============================================================

ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS regulation_version text,
ADD COLUMN IF NOT EXISTS regulation_citation text,
ADD COLUMN IF NOT EXISTS regulation_effective_date date;

-- ============================================================
-- COMPLIANCE DEFICIENCY LINK COLUMNS TO public.documents
-- ============================================================

ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS compliance_deficiency_id uuid REFERENCES survey_deficiencies(id),
ADD COLUMN IF NOT EXISTS kb_document_id uuid REFERENCES public.documents(id),
ADD COLUMN IF NOT EXISTS compliance_relevance_score float;

-- Add approved_by/admin capability for facility policies
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS approved_by_admin uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Add SOP reference column
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS sop_id uuid,
ADD COLUMN IF NOT EXISTS sop_type text
  CHECK (sop_type IN ('standard', 'emergency', 'facility_specific'));

-- ============================================================
-- COMPLIANCE KNOWLEDGE REPOSITORY TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS compliance_knowledge_repository (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  description text,
  category text NOT NULL
    CHECK (category IN (
      'regulation',
      'ahca_tag_220',
      'ahca_tag_417',
      'ahca_tag_502',
      'ahca_tag_201',
      'ahca_tag_205',
      'ahca_tag_309',
      'ahca_tag_314',
      'ahca_tag_325',
      'ahca_tag_404',
      'ahca_tag_409',
      'ahca_tag_501',
      'ahca_tag_504',
      'ahca_tag_502',
      'ahca_tag_502',
      'ahca_tag_504',
      'ahca_tag_504',
      'ahca_tag_601',
      'ahca_tag_701',
      'sop',
      'training_material',
      'policy',
      'facility_policy',
      'resident_rights_policy',
      'medication_admin_policy',
      'dietary_policy',
      'emergency_prep_policy'
    )),
  version text NOT NULL DEFAULT '1.0',
  is_active boolean NOT NULL DEFAULT true,
  effective_date date,
  retirement_date date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_kb_category ON compliance_knowledge_repository(category, workspace_id);
CREATE INDEX IF NOT EXISTS idx_compliance_kb_version ON compliance_knowledge_repository(workspace_id, effective_date DESC);

-- ============================================================
-- AUDIT TRIGGERS FOR COMPLIANCE CHANGES
-- ============================================================

DROP TRIGGER IF EXISTS tr_compliance_kb_category_set_updated_at ON compliance_knowledge_repository;
CREATE TRIGGER tr_compliance_kb_category_set_updated_at
BEFORE UPDATE ON compliance_knowledge_repository
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();
-- Log change

DROP TRIGGER IF EXISTS tr_compliance_kb_audit_after_insert ON compliance_knowledge_repository;
CREATE TRIGGER tr_compliance_kb_audit_after_insert
AFTER INSERT ON compliance_knowledge_repository
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

DROP TRIGGER IF EXISTS tr_compliance_kb_audit_after_update ON compliance_knowledge_repository;
CREATE TRIGGER tr_compliance_kb_audit_after_update
AFTER UPDATE ON compliance_knowledge_repository
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

-- ============================================================
-- SEED DATA FOR COMPLIANCE RULES (deferred — will be loaded via admin UI or a follow-up seed migration)
-- ============================================================
