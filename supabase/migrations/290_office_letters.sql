-- ============================================================================
-- 290_office_letters.sql
-- Module 35 (Office Suite) — F2-1 Letter & document generator
--
-- Mail-merge letter templates on facility letterhead (rate-increase notices,
-- family letters, DCF/payee correspondence, employment verification) and an
-- immutable log of every generated letter tied to the resident or employee
-- file. Generated letters are correspondence evidence → audit-logged, soft
-- deletes, rendered body stored verbatim at generation time.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- letter_templates
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS letter_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  name text NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (category IN (
    'rate_increase', 'family', 'dcf_payee', 'employment_verification', 'general'
  )),
  -- Who the merge fields resolve against ({{resident.*}} vs {{staff.*}})
  subject_kind text NOT NULL DEFAULT 'resident' CHECK (subject_kind IN (
    'resident', 'staff', 'none'
  )),
  -- Plain text body with {{merge.fields}}; rendered client-side onto letterhead
  body text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_letter_templates_facility
  ON letter_templates(facility_id)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- generated_letters (the logged copy in the resident / employee file)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS generated_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  template_id uuid REFERENCES letter_templates(id),
  template_name text NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (category IN (
    'rate_increase', 'family', 'dcf_payee', 'employment_verification', 'general'
  )),

  -- Exactly one subject (or neither for general correspondence)
  resident_id uuid REFERENCES residents(id),
  staff_user_id uuid REFERENCES auth.users(id),
  CONSTRAINT generated_letters_single_subject CHECK (
    NOT (resident_id IS NOT NULL AND staff_user_id IS NOT NULL)
  ),

  recipient_name text,
  -- Rendered body stored verbatim at generation time (legal copy of record;
  -- later template edits never change what was sent)
  rendered_body text NOT NULL,
  -- Merge field values used, for traceability ({"resident.full_name": "..."}).
  merge_values jsonb NOT NULL DEFAULT '{}'::jsonb,

  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES auth.users(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_generated_letters_facility_generated_at
  ON generated_letters(facility_id, generated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_generated_letters_resident_id
  ON generated_letters(resident_id)
  WHERE deleted_at IS NULL AND resident_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generated_letters_staff_user_id
  ON generated_letters(staff_user_id)
  WHERE deleted_at IS NULL AND staff_user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER letter_templates_set_updated_at
  BEFORE UPDATE ON letter_templates
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER generated_letters_set_updated_at
  BEFORE UPDATE ON generated_letters
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS (enabled before any data lands)
-- ----------------------------------------------------------------------------

ALTER TABLE letter_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_letters ENABLE ROW LEVEL SECURITY;

-- letter_templates: office/admin roles manage; same roles read.

CREATE POLICY "Admins see letter templates in accessible facilities"
  ON letter_templates FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
  );

CREATE POLICY "Admins create letter templates in accessible facilities"
  ON letter_templates FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
  );

CREATE POLICY "Admins update letter templates in accessible facilities"
  ON letter_templates FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
  );

-- generated_letters: correspondence is PII-bearing — admin/office roles only.
-- No UPDATE policy beyond soft delete by admins: the rendered body is a legal
-- copy of record and must not be editable after generation.

CREATE POLICY "Admins see generated letters in accessible facilities"
  ON generated_letters FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
  );

CREATE POLICY "Admins log generated letters in accessible facilities"
  ON generated_letters FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
  );

CREATE POLICY "Owners soft-delete generated letters"
  ON generated_letters FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- No DELETE policies: soft deletes only (deleted_at via UPDATE).

-- ----------------------------------------------------------------------------
-- Audit triggers (correspondence in the resident/employee file)
-- ----------------------------------------------------------------------------

CREATE TRIGGER letter_templates_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON letter_templates
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER generated_letters_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON generated_letters
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE letter_templates IS
  'Mail-merge letter templates ({{merge.fields}}, plain text) rendered on facility letterhead. Module 35 F2-1.';

COMMENT ON TABLE generated_letters IS
  'Immutable log of generated correspondence (rendered body verbatim) tied to the resident or employee file. Module 35 F2-1.';
