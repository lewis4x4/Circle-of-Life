-- Module 12: training_programs + staff_training_completions (Track D D38; spec 12-training-competency)

CREATE TYPE training_delivery_method AS ENUM (
  'in_person',
  'external',
  'online',
  'hybrid'
);

CREATE TYPE training_frequency AS ENUM (
  'at_hire',
  'annual',
  'biennial',
  'as_needed',
  'one_time'
);

CREATE TABLE training_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  delivery_method training_delivery_method NOT NULL DEFAULT 'in_person',
  frequency training_frequency NOT NULL,
  required_hours numeric(5, 2),
  applies_to_roles text[] NOT NULL DEFAULT '{}',
  regulatory_cite text,
  external_provider text,
  is_mandatory boolean NOT NULL DEFAULT false,
  is_fl_required boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, code)
);

CREATE INDEX idx_training_programs_org ON training_programs (organization_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE training_programs IS 'Org training catalog (FL-mandated + internal); RLS + audit below.';

CREATE TABLE staff_training_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  staff_id uuid NOT NULL REFERENCES staff (id),
  training_program_id uuid NOT NULL REFERENCES training_programs (id),
  completed_at date NOT NULL,
  expires_at date,
  hours_completed numeric(5, 2),
  delivery_method training_delivery_method NOT NULL,
  external_provider text,
  certificate_number text,
  evaluator_user_id uuid REFERENCES auth.users (id),
  notes text,
  attachment_path text,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_staff_training_staff ON staff_training_completions (staff_id, training_program_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_staff_training_facility ON staff_training_completions (facility_id, completed_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_staff_training_expiry ON staff_training_completions (expires_at)
WHERE
  deleted_at IS NULL
  AND expires_at IS NOT NULL;

COMMENT ON TABLE staff_training_completions IS 'Per-staff training completion log; Core metadata only (uploads = Enhanced).';

ALTER TABLE training_programs ENABLE ROW LEVEL SECURITY;

ALTER TABLE staff_training_completions ENABLE ROW LEVEL SECURITY;

-- training_programs: any org member may read catalog rows; admins manage
CREATE POLICY training_programs_select ON training_programs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

CREATE POLICY training_programs_insert ON training_programs
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY training_programs_update ON training_programs
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY training_programs_delete ON training_programs
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

-- staff_training_completions: mirror staff_certifications + competency_demonstrations
CREATE POLICY staff_training_completions_select_admins ON staff_training_completions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY staff_training_completions_select_self ON staff_training_completions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        staff s
      WHERE
        s.id = staff_training_completions.staff_id
        AND s.user_id = auth.uid ()
        AND s.deleted_at IS NULL));

CREATE POLICY staff_training_completions_insert ON staff_training_completions
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY staff_training_completions_update ON staff_training_completions
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY staff_training_completions_delete ON staff_training_completions
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE TRIGGER tr_training_programs_set_updated_at
  BEFORE UPDATE ON training_programs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_training_programs_audit
  AFTER INSERT OR UPDATE OR DELETE ON training_programs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_staff_training_completions_set_updated_at
  BEFORE UPDATE ON staff_training_completions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_staff_training_completions_audit
  AFTER INSERT OR UPDATE OR DELETE ON staff_training_completions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

-- Florida mandatory programs for COL org (spec 12 — seed at org init; fixed UUIDs for stable references)
INSERT INTO training_programs (
  id,
  organization_id,
  code,
  name,
  description,
  delivery_method,
  frequency,
  required_hours,
  regulatory_cite,
  external_provider,
  is_mandatory,
  is_fl_required,
  active
)
VALUES
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'fl_cpr_first_aid', 'CPR & First Aid', NULL, 'in_person', 'biennial', 6.00, 'FAC 59A-36.011(2)', NULL, TRUE, TRUE, TRUE),
  ('b1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'fl_alzheimers', 'Alzheimer''s & Dementia Care', NULL, 'in_person', 'annual', 4.00, '§429.52', NULL, TRUE, TRUE, TRUE),
  ('b1000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'fl_hipaa', 'HIPAA & Privacy', NULL, 'in_person', 'at_hire', 2.00, '45 CFR §164', NULL, TRUE, TRUE, TRUE),
  ('b1000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'fl_abuse_neglect', 'Abuse, Neglect & Exploitation Prevention', NULL, 'in_person', 'annual', 2.00, '§430.80', NULL, TRUE, TRUE, TRUE),
  ('b1000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'fl_food_safety', 'Food Safety / Food Handler', NULL, 'in_person', 'at_hire', 2.00, 'FAC 64E-11', NULL, TRUE, TRUE, TRUE),
  ('b1000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'fl_chw', 'Community Health Worker', NULL, 'in_person', 'at_hire', 8.00, '§381.0101', NULL, FALSE, TRUE, TRUE),
  ('b1000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'fl_elopement', 'Elopement Prevention & Response', NULL, 'in_person', 'annual', 1.00, 'FAC 59A-36.019', NULL, TRUE, TRUE, TRUE),
  ('b1000000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'fl_emergency_mgmt', 'Emergency Management & Evacuation', NULL, 'in_person', 'annual', 2.00, '§429.41(1)(a)', NULL, TRUE, TRUE, TRUE),
  ('b1000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', 'baya_medication', 'Baya Medication Safety Program', NULL, 'external', 'annual', 8.00, 'FAC 59A-36.022', 'Baya', TRUE, TRUE, TRUE),
  ('b1000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000001', 'col_orientation', 'COL New Employee Orientation', NULL, 'in_person', 'at_hire', NULL, 'Internal (COL)', NULL, TRUE, FALSE, TRUE);
