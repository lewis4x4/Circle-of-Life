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
  );

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
    ),
  version text NOT NULL DEFAULT '1.0',
  is_active boolean NOT NULL DEFAULT true,
  effective_date date,
  retirement_date date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_compliance_kb_category ON compliance_knowledge_repository(category, workspace_id);
CREATE INDEX idx_compliance_kb_version ON compliance_knowledge_repository(workspace_id, effective_date DESC);

-- ============================================================
-- AUDIT TRIGGERS FOR COMPLIANCE CHANGES
-- ============================================================

CREATE TRIGGER tr_compliance_kb_category_set_updated_at
BEFORE UPDATE ON compliance_knowledge_repository
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();
-- Log change

CREATE TRIGGER tr_compliance_kb_audit_after_insert
AFTER INSERT ON compliance_knowledge_repository
  FOR EACH ROW
  EXECUTE PROCEDURE public.capture_audit_log();

CREATE TRIGGER tr_compliance_kb_audit_after_update
AFTER UPDATE ON compliance_knowledge_repository
  FOR EACH ROW
  EXECUTE PROCEDURE public.capture_audit_log();

-- ============================================================
-- SEED DATA FOR COMPLIANCE RULES
-- ============================================================

-- AHCA Tag 220: Personal Care
-- AHCA Tag 417: Adequate Care
-- AHCA Tag 502: Infection Control
-- AHCA Tag 201: Resident Rights
-- AHCA Tag 205: Grievance
-- AHCA Tag 309: Staffing
-- AHCA Tag 314: Staff Training
-- AHCA Tag 325: Background Screening
-- AHCA Tag 404: Resident Assessment
-- AHCA Tag 409: Care Plan Updates
-- AHCA Tag 501: Medication Admin
-- AHCA Tag 504: Medication Errors
-- AHCA Tag 601: Physical Plant
-- AHCA Tag 602: Emergency Prep
-- AHCA Tag 701: Dietary
-- AHCA Tag 504: SOP
-- AHCA Tag 601: Facility Policy

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT
  o.id,
  '220',
  'Personal Care',
  'ADL care plans current; daily ADL logs present; daily logs present for assigned residents',
  'serious';

INSERT INTO public.documents (organization_id, title, source, audience, status, compliance_category)
SELECT 'o.id',
  'AHCA Regulations',
  'ahca_regulation_220',
  'content: AHCA Form 3020-2020 requires facilities to maintain up-to-date ADL care plans and daily logs for all residents. Non-compliance results in deficiencies or citations.',
  'approved_by_admin': (SELECT id FROM auth.users WHERE app_role = 'owner' LIMIT 1),
  'effective_date': CURRENT_DATE,
  'compliance_category': 'ahca_regulation',
  'regulation_version': '1.0';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id',
  '417',
  'Adequate Care',
  'PRN effectiveness documented; condition changes reported within 24 hours; daily ADL logs present for assigned residents.',
  'serious';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '201',
  'Resident Rights',
  'Rights violations documented and addressed within 48 hours of discovery.',
  'serious';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '205',
  'Grievance',
  'Grievances logged and resolved within 5 business days. Non-compliance results in deficiencies or citations.',
  'standard';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '309',
  'Staffing',
  'Staffing ratios maintained per AHCA requirements. Minimum ratios for all shifts. Minimum staff for all shifts. Direct care staff to resident ratio >= 1:5 for all shifts. ',
  'serious';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '314',
  'Staff Training',
  'All staff have required training documented. Monthly competency records current for all staff.',
  'standard';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '325',
  'Background Screening',
  'All staff have completed background screenings within last 30 days. Criminal background checks completed for all staff.',
  'immediate_jeopardy';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '404',
  'Resident Assessment',
  'PRN effectiveness documented. Condition changes reported within 24 hours. Daily ADL logs present for assigned residents.',
  'serious';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '409',
  'Care Plan Updates',
  'Care plans reviewed and updated within 30 days.',
  'serious';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '501',
  'Medication Admin',
  'Medication administration documented. Med orders managed and administered as per AHCA regulations.',
  'serious';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '504',
  'Medication Errors',
  'Error rate below threshold (0.5% of all medication administrations). Medication error count in last 30 days must be below 0.5% of all administrations. ',
  'immediate_jeopardy';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '601',
  'Physical Plant',
  'Facility maintenance items addressed within 30 days. Generator tests (monthly), fire drills (quarterly), evacuation drills (annually). All items addressed.',
  'serious';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '602',
  'Emergency Prep',
  'Emergency preparedness checklist completed. All checklist items addressed within 30 days. Generator tests (monthly), fire drills (quarterly), evacuation drills (annually). All items addressed.',
  'serious';

INSERT INTO public.compliance_rules (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity)
SELECT 'o.id,
  '701',
  'Dietary',
  'Dietary assessments and needs documented for residents with dietary requirements. Assessment done and needs documented for all residents with dietary restrictions. ',
  'standard';
