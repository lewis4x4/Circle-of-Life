-- Phase 1 Foundation Item 4: Compliance Engine Skeleton
-- Source: Sections 8, 12, and 24 of COL Technical Handoff
--
-- This migration creates:
-- - legal_entities table for multi-entity compliance tracking
-- - fl_statutes reference table for FL regulatory citations
-- - background_screenings table for staff background screening compliance
--
-- Idempotency
-- -----------
-- Migration 235 (legal_entities + background_screenings) and 145 (fl_statutes)
-- already own most of this schema on fresh Docker replay. This file uses the
-- same idempotent patterns as 235/282 so replay does not fail on duplicates.
--
-- Safe to re-run.

-- ============================================================
-- NEW ENUM TYPES
-- ============================================================

DO $$
BEGIN
  CREATE TYPE public.screening_status AS ENUM ('CLEARED', 'PENDING', 'EXPIRED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE public.screening_type AS ENUM ('FDLE_FBI_LEVEL_2');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ============================================================
-- LEGAL ENTITIES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.legal_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),

  ahca_license_number text,
  ahca_license_expiration timestamptz,

  last_survey_date date,
  last_survey_result text NOT NULL DEFAULT 'PASSED_NO_CITATIONS'
    CHECK (last_survey_result IN ('PASSED_NO_CITATIONS', 'CITATIONS_ISSUED', 'FOLLOW_UP_REQUIRED')),

  open_pocs integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_legal_entities_entity
  ON public.legal_entities(entity_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_legal_entities_org
  ON public.legal_entities(organization_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.legal_entities IS
  'Compliance tracking per legal entity. COL operates 5 facilities under 5 separate LLCs with different EINs.';
COMMENT ON COLUMN public.legal_entities.ahca_license_number IS
  'PENDING — Brian obtaining from client.';
COMMENT ON COLUMN public.legal_entities.ahca_license_expiration IS
  'PENDING — Brian obtaining from client.';
COMMENT ON COLUMN public.legal_entities.open_pocs IS
  'Open Plans of Correction count. Updated via trigger from survey_deficiencies table.';

-- ============================================================
-- FL STATUTES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fl_statutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),

  statute_code text NOT NULL,
  statute_title text NOT NULL,
  chapter text NOT NULL,
  agency text NOT NULL DEFAULT 'AHCA',
  description text,

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

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fl_statutes_code
  ON public.fl_statutes(organization_id, statute_code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fl_statutes_chapter
  ON public.fl_statutes(organization_id, chapter)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.fl_statutes IS
  'Florida regulatory reference for compliance citations. Every rule must embed the governing FL statute reference.';

-- ============================================================
-- BACKGROUND SCREENINGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.background_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),

  screening_type public.screening_type NOT NULL DEFAULT 'FDLE_FBI_LEVEL_2',
  screening_date date NOT NULL,
  renewal_date date NOT NULL,

  clearinghouse_reference boolean NOT NULL DEFAULT false,
  ahca_attestation_form text,

  status public.screening_status NOT NULL DEFAULT 'PENDING',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,

  CONSTRAINT background_screenings_renewal_after_screening
    CHECK (renewal_date >= screening_date)
);

CREATE INDEX IF NOT EXISTS idx_bg_screenings_staff
  ON public.background_screenings(staff_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bg_screenings_facility
  ON public.background_screenings(facility_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bg_screenings_renewal
  ON public.background_screenings(renewal_date)
  WHERE deleted_at IS NULL AND status = 'CLEARED';

COMMENT ON TABLE public.background_screenings IS
  'Staff background screening compliance per F.A.C. 59A-36.011. FL §435.04, §408.809.';
COMMENT ON COLUMN public.background_screenings.ahca_attestation_form IS
  'AHCA Attestation Form #3100-0008. Required for all staff.';
COMMENT ON COLUMN public.background_screenings.clearinghouse_reference IS
  'FL Clearinghouse reference per FL §435.04, §408.809.';

-- ============================================================
-- FL STATUTES SEED DATA
-- ============================================================

INSERT INTO public.fl_statutes (organization_id, statute_code, statute_title, chapter, agency, description, category, created_by)
SELECT '00000000-0000-0000-0000-000000000001', '429.28', 'Resident Bill of Rights', '429', 'AHCA', 'Rights of residents in assisted living facilities including privacy, dignity, and self-determination.', 'resident_rights', '062c3cfb-53a5-4482-814a-cbef2b028760'
WHERE NOT EXISTS (
  SELECT 1 FROM public.fl_statutes
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND statute_code = '429.28'
    AND deleted_at IS NULL
);

INSERT INTO public.fl_statutes (organization_id, statute_code, statute_title, chapter, agency, description, category, created_by)
SELECT '00000000-0000-0000-0000-000000000001', '429.255', 'Advance Directives', '429', 'AHCA', 'DNRO per FL Ch 765, resident right to refuse treatment.', 'resident_rights', '062c3cfb-53a5-4482-814a-cbef2b028760'
WHERE NOT EXISTS (
  SELECT 1 FROM public.fl_statutes
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND statute_code = '429.255'
    AND deleted_at IS NULL
);

INSERT INTO public.fl_statutes (organization_id, statute_code, statute_title, chapter, agency, description, category, created_by)
SELECT '00000000-0000-0000-0000-000000000001', '59A-36.006', 'Admission Criteria', '59A', 'AHCA', 'Minimum admission criteria for ALF facilities.', 'admission', '062c3cfb-53a5-4482-814a-cbef2b028760'
WHERE NOT EXISTS (
  SELECT 1 FROM public.fl_statutes
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND statute_code = '59A-36.006'
    AND deleted_at IS NULL
);

INSERT INTO public.fl_statutes (organization_id, statute_code, statute_title, chapter, agency, description, category, created_by)
SELECT '00000000-0000-0000-0000-000000000001', '59A-36.010', 'Assessment', '59A', 'AHCA', 'Resident assessment requirements including 3-year reassessment.', 'care_delivery', '062c3cfb-53a5-4482-814a-cbef2b028760'
WHERE NOT EXISTS (
  SELECT 1 FROM public.fl_statutes
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND statute_code = '59A-36.010'
    AND deleted_at IS NULL
);

INSERT INTO public.fl_statutes (organization_id, statute_code, statute_title, chapter, agency, description, category, created_by)
SELECT '00000000-0000-0000-0000-000000000001', '59A-36.011', 'Background Screening', '59A', 'AHCA', 'Level 2 background screening requirements for staff.', 'staffing', '062c3cfb-53a5-4482-814a-cbef2b028760'
WHERE NOT EXISTS (
  SELECT 1 FROM public.fl_statutes
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND statute_code = '59A-36.011'
    AND deleted_at IS NULL
);

INSERT INTO public.fl_statutes (organization_id, statute_code, statute_title, chapter, agency, description, category, created_by)
SELECT '00000000-0000-0000-0000-000000000001', '59A-36.012', 'Staffing', '59A', 'AHCA', 'Minimum staffing requirements and staffing plans.', 'staffing', '062c3cfb-53a5-4482-814a-cbef2b028760'
WHERE NOT EXISTS (
  SELECT 1 FROM public.fl_statutes
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND statute_code = '59A-36.012'
    AND deleted_at IS NULL
);

INSERT INTO public.fl_statutes (organization_id, statute_code, statute_title, chapter, agency, description, category, created_by)
SELECT '00000000-0000-0000-0000-000000000001', '59A-36.018', 'Incident Reporting', '59A', 'AHCA', 'Requirements for reporting incidents to AHCA.', 'incident_reporting', '062c3cfb-53a5-4482-814a-cbef2b028760'
WHERE NOT EXISTS (
  SELECT 1 FROM public.fl_statutes
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND statute_code = '59A-36.018'
    AND deleted_at IS NULL
);

INSERT INTO public.fl_statutes (organization_id, statute_code, statute_title, chapter, agency, description, category, created_by)
SELECT '00000000-0000-0000-0000-000000000001', '59A-36.019', 'Emergency Preparedness', '59A', 'AHCA', 'Emergency and disaster preparedness requirements.', 'emergency_preparedness', '062c3cfb-53a5-4482-814a-cbef2b028760'
WHERE NOT EXISTS (
  SELECT 1 FROM public.fl_statutes
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND statute_code = '59A-36.019'
    AND deleted_at IS NULL
);

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE public.legal_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legal_entities_select ON public.legal_entities;
CREATE POLICY legal_entities_select ON public.legal_entities
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS legal_entities_manage ON public.legal_entities;
CREATE POLICY legal_entities_manage ON public.legal_entities
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

ALTER TABLE public.fl_statutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fl_statutes_select ON public.fl_statutes;
CREATE POLICY fl_statutes_select ON public.fl_statutes
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS fl_statutes_manage ON public.fl_statutes;
CREATE POLICY fl_statutes_manage ON public.fl_statutes
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

ALTER TABLE public.background_screenings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS background_screenings_select ON public.background_screenings;
CREATE POLICY background_screenings_select ON public.background_screenings
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (
      staff_id = (SELECT id FROM public.staff WHERE user_id = auth.uid() LIMIT 1)
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    )
  );

DROP POLICY IF EXISTS background_screenings_manage ON public.background_screenings;
CREATE POLICY background_screenings_manage ON public.background_screenings
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- ============================================================
-- AUDIT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS tr_legal_entities_set_updated_at ON public.legal_entities;
CREATE TRIGGER tr_legal_entities_set_updated_at
  BEFORE UPDATE ON public.legal_entities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_legal_entities_audit ON public.legal_entities;
CREATE TRIGGER tr_legal_entities_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.legal_entities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

DROP TRIGGER IF EXISTS tr_fl_statutes_set_updated_at ON public.fl_statutes;
CREATE TRIGGER tr_fl_statutes_set_updated_at
  BEFORE UPDATE ON public.fl_statutes
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_fl_statutes_audit ON public.fl_statutes;
CREATE TRIGGER tr_fl_statutes_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.fl_statutes
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

DROP TRIGGER IF EXISTS tr_background_screenings_set_updated_at ON public.background_screenings;
CREATE TRIGGER tr_background_screenings_set_updated_at
  BEFORE UPDATE ON public.background_screenings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_background_screenings_audit ON public.background_screenings;
CREATE TRIGGER tr_background_screenings_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.background_screenings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();
