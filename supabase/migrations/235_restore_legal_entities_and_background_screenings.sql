-- ============================================================
-- Migration 235: Restore legal_entities + background_screenings
-- ============================================================
--
-- Why this exists
-- ---------------
-- Migration `104_phase1_compliance_skeleton.sql` was committed to the repo but
-- was never applied to the production Supabase database (it has been an
-- "orphan" in the local migrations directory for some time). The application
-- code in `src/lib/M1.ts` (and downstream compliance flows) references the
-- `legal_entities` and `background_screenings` tables that migration 104 was
-- supposed to introduce, so production currently 500s any time those code
-- paths are hit.
--
-- This migration restores the missing schema in an idempotent shape so it
-- can land cleanly even if any of the objects partially exist on a given
-- environment.
--
-- Why fl_statutes is NOT recreated here
-- -------------------------------------
-- Migration `145_track_e_fl_statutes_module_links.sql` later created
-- `public.fl_statutes` (with `CREATE TABLE IF NOT EXISTS`) and that table is
-- present on the live database. Re-creating it here would either be a no-op
-- or fight with the later migration's structure. Leave fl_statutes ownership
-- with migration 145.
--
-- Idempotency
-- -----------
-- * Enum types are created in a `DO` block that swallows `duplicate_object`.
-- * Tables, indexes use `IF NOT EXISTS`.
-- * Policies are wrapped with `DROP POLICY IF EXISTS` before `CREATE POLICY`.
-- * Triggers are wrapped with `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`.
-- * `ENABLE ROW LEVEL SECURITY` is harmless to re-run.
--
-- Safe to re-run.
-- ============================================================

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
--
-- One row per COL legal entity with AHCA license and survey history.
-- Source: Section 12 "Multi-Entity Awareness" of the COL Technical Handoff.

CREATE TABLE IF NOT EXISTS public.legal_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),

  -- AHCA License data
  ahca_license_number text,
  ahca_license_expiration timestamptz,

  -- Survey history
  last_survey_date date,
  last_survey_result text NOT NULL DEFAULT 'PASSED_NO_CITATIONS'
    CHECK (last_survey_result IN ('PASSED_NO_CITATIONS', 'CITATIONS_ISSUED', 'FOLLOW_UP_REQUIRED')),

  -- Open POC count (computed via trigger from survey_deficiencies)
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
-- BACKGROUND SCREENINGS TABLE
-- ============================================================
--
-- Staff background screening compliance per F.A.C. 59A-36.011.
-- FL §435.04, §408.809.
-- Source: Section 12 of the COL Technical Handoff.

CREATE TABLE IF NOT EXISTS public.background_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),

  -- Screening details
  screening_type public.screening_type NOT NULL DEFAULT 'FDLE_FBI_LEVEL_2',
  screening_date date NOT NULL,
  renewal_date date NOT NULL,

  -- FL Clearinghouse
  clearinghouse_reference boolean NOT NULL DEFAULT false,

  -- AHCA Attestation Form #3100-0008
  ahca_attestation_form text,

  -- Status
  status public.screening_status NOT NULL DEFAULT 'PENDING',

  -- Audit
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
-- RLS — legal_entities
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

-- ============================================================
-- RLS — background_screenings
-- ============================================================

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
-- TRIGGERS — legal_entities
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

-- ============================================================
-- TRIGGERS — background_screenings
-- ============================================================

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
