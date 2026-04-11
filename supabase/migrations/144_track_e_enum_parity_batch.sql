-- Track E — E10: Cross-module enum / column parity (handoff verification batch)

-- ── Module 06 — Medication order method ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE medication_order_method AS ENUM ('fax','call_in');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE resident_medications
ADD COLUMN IF NOT EXISTS order_method medication_order_method;

COMMENT ON COLUMN resident_medications.order_method IS 'How the original order was received (fax vs call-in); distinct from pharmacy routing.';

-- ── Module 07 — Medication errors: grievance category + signature capture ───
ALTER TABLE medication_errors
ADD COLUMN IF NOT EXISTS grievance_category text;

ALTER TABLE medication_errors
ADD COLUMN IF NOT EXISTS staff_finding_sig text;

ALTER TABLE medication_errors
ADD COLUMN IF NOT EXISTS staff_error_sig text;

ALTER TABLE medication_errors
ADD COLUMN IF NOT EXISTS exec_director_sig text;

ALTER TABLE medication_errors
ADD COLUMN IF NOT EXISTS resident_services_coordinator_sig text;

ALTER TABLE medication_errors
DROP CONSTRAINT IF EXISTS medication_errors_grievance_category_chk;

ALTER TABLE medication_errors
ADD CONSTRAINT medication_errors_grievance_category_chk CHECK (
  grievance_category IS NULL
  OR grievance_category IN ('A', 'C', 'F', 'FIN', 'O', 'MI', 'EMP', 'RES', 'VIS')
);

COMMENT ON COLUMN medication_errors.grievance_category IS 'AHCA grievance routing code (9-code set from handoff).';

-- ── Module 22 — Referral CRM extensions ────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE referral_source_channel AS ENUM ('social_media','radio','newspaper','friend','caring_com','other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE referral_sources
ADD COLUMN IF NOT EXISTS source_channel referral_source_channel;

ALTER TABLE referral_leads
ADD COLUMN IF NOT EXISTS satisfaction_rating smallint;

ALTER TABLE referral_leads
DROP CONSTRAINT IF EXISTS referral_leads_satisfaction_rating_chk;

ALTER TABLE referral_leads
ADD CONSTRAINT referral_leads_satisfaction_rating_chk CHECK (
  satisfaction_rating IS NULL
  OR (
    satisfaction_rating >= 1
    AND satisfaction_rating <= 5
  )
);

-- ── Module 15 — Transport: optional flat trip fee (owner may choose vs mileage) ─
ALTER TABLE organization_transport_settings
ADD COLUMN IF NOT EXISTS flat_trip_fee_cents integer CHECK (
  flat_trip_fee_cents IS NULL
  OR (
    flat_trip_fee_cents >= 0
    AND flat_trip_fee_cents <= 5000000
  )
);

COMMENT ON COLUMN organization_transport_settings.flat_trip_fee_cents IS 'Optional flat per-trip fee in cents (e.g. $75); alternative to mileage reimbursement.';

-- ── Module 21 — Family portal: visiting hours default + guest policies ───────
ALTER TABLE facility_communication_settings
ADD COLUMN IF NOT EXISTS guest_meal_policy text;

ALTER TABLE facility_communication_settings
ADD COLUMN IF NOT EXISTS overnight_guest_policy text;

UPDATE facility_communication_settings
SET
  visiting_hours_start = '06:00',
  visiting_hours_end = '21:00'
WHERE
  visiting_hours_start = '09:00'::time
  AND visiting_hours_end = '20:00'::time;

-- ── Module 19 — Vendor category expansion (service-type granularity) ───────
ALTER TYPE vendor_category ADD VALUE IF NOT EXISTS 'laundry';
ALTER TYPE vendor_category ADD VALUE IF NOT EXISTS 'transportation';
ALTER TYPE vendor_category ADD VALUE IF NOT EXISTS 'laboratory';
ALTER TYPE vendor_category ADD VALUE IF NOT EXISTS 'utilities';
ALTER TYPE vendor_category ADD VALUE IF NOT EXISTS 'security';

-- ── Module 21 — Resident rights reference copy for family portal ───────────
CREATE TABLE IF NOT EXISTS family_portal_resident_rights_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  sort_order integer NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fp_rights_org ON family_portal_resident_rights_entries (organization_id, sort_order)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE family_portal_resident_rights_entries IS 'Twelve concise resident-rights clauses for family portal display (handoff parity).';

ALTER TABLE family_portal_resident_rights_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fp_rights_select ON family_portal_resident_rights_entries;
CREATE POLICY fp_rights_select ON family_portal_resident_rights_entries
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

DROP POLICY IF EXISTS fp_rights_insert ON family_portal_resident_rights_entries;
CREATE POLICY fp_rights_insert ON family_portal_resident_rights_entries
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

DROP POLICY IF EXISTS fp_rights_update ON family_portal_resident_rights_entries;
CREATE POLICY fp_rights_update ON family_portal_resident_rights_entries
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL)
  WITH CHECK (
    organization_id = haven.organization_id ());

DROP TRIGGER IF EXISTS tr_fp_rights_set_updated_at ON family_portal_resident_rights_entries;
CREATE TRIGGER tr_fp_rights_set_updated_at
  BEFORE UPDATE ON family_portal_resident_rights_entries
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

INSERT INTO family_portal_resident_rights_entries (organization_id, sort_order, title, summary)
VALUES
  ('00000000-0000-0000-0000-000000000001', 1, 'Dignity & respect', 'Care and services are delivered with respect for personal dignity and autonomy.'),
  ('00000000-0000-0000-0000-000000000001', 2, 'Privacy', 'Reasonable privacy in treatment and personal needs is honored.'),
  ('00000000-0000-0000-0000-000000000001', 3, 'Participation in care', 'Residents may participate in planning care and refuse treatment within regulatory limits.'),
  ('00000000-0000-0000-0000-000000000001', 4, 'Freedom from abuse', 'Residents have the right to be free from mental, physical, and verbal abuse.'),
  ('00000000-0000-0000-0000-000000000001', 5, 'Communication', 'Residents may communicate freely with persons of their choice in private.'),
  ('00000000-0000-0000-0000-000000000001', 6, 'Personal property', 'Personal property is protected subject to facility safety policies.'),
  ('00000000-0000-0000-0000-000000000001', 7, 'Grievances', 'Residents may present grievances without fear of reprisal.'),
  ('00000000-0000-0000-0000-000000000001', 8, 'Financial affairs', 'Residents manage their own financial affairs unless legally delegated.'),
  ('00000000-0000-0000-0000-000000000001', 9, 'Religious freedom', 'Residents may participate in religious activities of their choice.'),
  ('00000000-0000-0000-0000-000000000001', 10, 'Access & visitation', 'Visitation follows facility visiting policies and clinical appropriateness.'),
  ('00000000-0000-0000-0000-000000000001', 11, 'Transfer & discharge notice', 'Residents receive required notices before transfer or discharge except emergencies.'),
  ('00000000-0000-0000-0000-000000000001', 12, 'Advance directives', 'Advance directives and surrogate decision-making are honored as permitted by law.');
