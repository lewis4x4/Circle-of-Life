-- Phase 1 Foundation Item 4: Compliance Engine Skeleton
-- Source: Sections 8, 12, and 24 of COL Technical Handoff
--
-- This migration creates:
-- - legal_entities table for multi-entity compliance tracking
-- - fl_statutes reference table for FL regulatory citations
-- - background_screenings table for staff background screening compliance
--
-- All tables include RLS policies and audit triggers.

-- ============================================================
-- NEW ENUM TYPES
-- ============================================================

-- Screening status for background_screenings table
CREATE TYPE screening_status AS ENUM ('CLEARED', 'PENDING', 'EXPIRED', 'FAILED');

-- Screening type for background_screenings table
CREATE TYPE screening_type AS ENUM ('FDLE_FBI_LEVEL_2');

-- ============================================================
-- LEGAL ENTITIES TABLE
-- ============================================================

-- Legal entities for compliance tracking (multi-entity isolation)
-- One row per COL legal entity with AHCA license and survey history
-- Source: Section 12 "Multi-Entity Awareness"

CREATE TABLE legal_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- AHCA License data
  ahca_license_number text,
  ahca_license_expiration timestamptz,

  -- Survey history
  last_survey_date date,
  last_survey_result text NOT NULL DEFAULT 'PASSED_NO_CITATIONS'
    CHECK (last_survey_result IN ('PASSED_NO_CITATIONS', 'CITATIONS_ISSUED', 'FOLLOW_UP_REQUIRED')),

  -- Open POC count (computed trigger updates)
  open_pocs integer NOT NULL DEFAULT 0,

  -- Compliance tracking
  is_active boolean NOT NULL DEFAULT true,

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_legal_entities_entity ON legal_entities(entity_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_legal_entities_org ON legal_entities(organization_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE legal_entities IS 'Compliance tracking per legal entity. COL operates 5 facilities under 5 separate LLCs with different EINs.';
COMMENT ON COLUMN legal_entities.ahca_license_number IS 'PENDING — Brian obtaining from client.';
COMMENT ON COLUMN legal_entities.ahca_license_expiration IS 'PENDING — Brian obtaining from client.';
COMMENT ON COLUMN legal_entities.open_pocs IS 'Open Plans of Correction count. Updated via trigger from survey_deficiencies table.';

-- ============================================================
-- FL STATUTES TABLE
-- ============================================================

-- Florida Statute reference table for compliance citations
-- Source: Section 24 of handoff

CREATE TABLE fl_statutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Statute reference
  statute_code text NOT NULL, -- e.g., "429.28", "59A-36.006"
  statute_title text NOT NULL, -- e.g., "Resident Bill of Rights", "Admission Criteria"
  chapter text NOT NULL, -- e.g., "429", "59A"
  agency text NOT NULL DEFAULT 'AHCA',

  -- Description for UI tooltips
  description text,

  -- Categorization
  category text NOT NULL CHECK (category IN (
    'resident_rights',
    'admission',
    'care_delivery',
    'medication',
    'incident_reporting',
    'infection_control',
    'emergency_preparedness',
    'staffing',
    'dietary',
    'maintenance',
    'privacy_hipaa',
    'grievance',
    'other'
  )),

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_fl_statutes_code ON fl_statutes(organization_id, statute_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_fl_statutes_chapter ON fl_statutes(organization_id, chapter) WHERE deleted_at IS NULL;

COMMENT ON TABLE fl_statutes IS 'Florida regulatory reference for compliance citations. Every rule must embed the governing FL statute reference.';

-- ============================================================
-- BACKGROUND SCREENINGS TABLE
-- ============================================================

-- Staff background screening compliance
-- Source: Section 12 of handoff "Background Screening Compliance"

CREATE TABLE background_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Screening details
  screening_type screening_type NOT NULL DEFAULT 'FDLE_FBI_LEVEL_2',
  screening_date date NOT NULL,
  renewal_date date NOT NULL,

  -- FL Clearinghouse
  clearinghouse_reference boolean NOT NULL DEFAULT false,

  -- AHCA Attestation Form
  ahca_attestation_form text, -- Form #3100-0008

  -- Status
  status screening_status NOT NULL DEFAULT 'PENDING',

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,

  CONSTRAINT background_screenings_renewal_after_screening CHECK (renewal_date >= screening_date)
);

CREATE INDEX idx_bg_screenings_staff ON background_screenings(staff_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bg_screenings_facility ON background_screenings(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bg_screenings_renewal ON background_screenings(renewal_date) WHERE deleted_at IS NULL AND status = 'CLEARED';

COMMENT ON TABLE background_screenings IS 'Staff background screening compliance per F.A.C. 59A-36.011. FL §435.04, §408.809.';
COMMENT ON COLUMN background_screenings.ahca_attestation_form IS 'AHCA Attestation Form #3100-0008. Required for all staff.';
COMMENT ON COLUMN background_screenings.clearinghouse_reference IS 'FL Clearinghouse reference per FL §435.04, §408.809.';

-- ============================================================
-- FL STATUTES SEED DATA
-- ============================================================

-- Seed FL statutes from Section 24 of handoff
-- Select high-impact statutes for initial seed

INSERT INTO fl_statutes (organization_id, statute_code, statute_title, chapter, agency, description, category, created_by) VALUES
('00000000-0000-0000-0000-000000000001', '429.28', 'Resident Bill of Rights', '429', 'AHCA', 'Rights of residents in assisted living facilities including privacy, dignity, and self-determination.', 'resident_rights', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000001', '429.255', 'Advance Directives', '429', 'AHCA', 'DNRO per FL Ch 765, resident right to refuse treatment.', 'resident_rights', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000001', '59A-36.006', 'Admission Criteria', '59A', 'AHCA', 'Minimum admission criteria for ALF facilities.', 'admission', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000001', '59A-36.010', 'Assessment', '59A', 'AHCA', 'Resident assessment requirements including 3-year reassessment.', 'care_delivery', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000001', '59A-36.011', 'Background Screening', '59A', 'AHCA', 'Level 2 background screening requirements for staff.', 'staffing', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000001', '59A-36.012', 'Staffing', '59A', 'AHCA', 'Minimum staffing requirements and staffing plans.', 'staffing', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000001', '59A-36.018', 'Incident Reporting', '59A', 'AHCA', 'Requirements for reporting incidents to AHCA.', 'incident_reporting', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000001', '59A-36.019', 'Emergency Preparedness', '59A', 'AHCA', 'Emergency and disaster preparedness requirements.', 'emergency_preparedness', '00000000-0000-0000-0000-000000000001');

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- legal_entities RLS
ALTER TABLE legal_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY legal_entities_select ON legal_entities
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

CREATE POLICY legal_entities_manage ON legal_entities
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- fl_statutes RLS
ALTER TABLE fl_statutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY fl_statutes_select ON fl_statutes
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
  );

CREATE POLICY fl_statutes_manage ON fl_statutes
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- background_screenings RLS
ALTER TABLE background_screenings ENABLE ROW LEVEL SECURITY;

CREATE POLICY background_screenings_select ON background_screenings
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (
      staff_id = (SELECT id FROM staff WHERE user_id = auth.uid() LIMIT 1)
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    )
  );

CREATE POLICY background_screenings_manage ON background_screenings
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- ============================================================
-- AUDIT TRIGGERS
-- ============================================================

-- legal_entities triggers
CREATE TRIGGER tr_legal_entities_set_updated_at
  BEFORE UPDATE ON legal_entities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER tr_legal_entities_audit
  AFTER INSERT OR UPDATE OR DELETE ON legal_entities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

-- fl_statutes triggers
CREATE TRIGGER tr_fl_statutes_set_updated_at
  BEFORE UPDATE ON fl_statutes
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER tr_fl_statutes_audit
  AFTER INSERT OR UPDATE OR DELETE ON fl_statutes
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

-- background_screenings triggers
CREATE TRIGGER tr_background_screenings_set_updated_at
  BEFORE UPDATE ON background_screenings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER tr_background_screenings_audit
  AFTER INSERT OR UPDATE OR DELETE ON background_screenings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();
