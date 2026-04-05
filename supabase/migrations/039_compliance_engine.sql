-- Compliance engine (spec 08-compliance-engine)
-- Triggers: public.haven_set_updated_at, public.haven_capture_audit_log (see 006_audit_triggers.sql)
--
-- Canonical survey visit model: survey_visit_sessions + survey_visit_log_entries (append-only rows).
-- Older single-table/JSONB sketches are superseded.
--
-- Active POC uniqueness: idx_poc_one_active_per_deficiency applies to rows where status is
-- draft, submitted, or accepted (excludes rejected and revised).

-- ============================================================
-- SURVEY DEFICIENCIES
-- ============================================================
CREATE TABLE survey_deficiencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  survey_date date NOT NULL,
  survey_type text NOT NULL
    CHECK (survey_type IN ('routine', 'complaint', 'follow_up', 'change_of_ownership', 'other')),
  surveyor_name text,
  surveyor_agency text NOT NULL DEFAULT 'AHCA',
  tag_number text NOT NULL,
  tag_description text NOT NULL,
  severity text NOT NULL
    CHECK (severity IN ('minor', 'standard', 'serious', 'immediate_jeopardy')),
  scope text NOT NULL DEFAULT 'isolated'
    CHECK (scope IN ('isolated', 'pattern', 'widespread')),
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'poc_submitted', 'poc_accepted', 'corrected', 'verified', 'recited')),
  corrected_at timestamptz,
  verified_at timestamptz,
  follow_up_survey_date date,
  follow_up_notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_deficiencies_facility ON survey_deficiencies (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_deficiencies_status ON survey_deficiencies (facility_id, status)
WHERE
  deleted_at IS NULL
  AND status NOT IN ('verified', 'corrected');

CREATE INDEX idx_deficiencies_tag ON survey_deficiencies (tag_number)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- PLANS OF CORRECTION
-- ============================================================
CREATE TABLE plans_of_correction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  deficiency_id uuid NOT NULL REFERENCES survey_deficiencies (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  corrective_action text NOT NULL,
  policy_changes text,
  monitoring_plan text,
  responsible_party text NOT NULL,
  monitoring_frequency text,
  submission_due_date date NOT NULL,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES auth.users (id),
  completion_target_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'accepted', 'rejected', 'revised')),
  reviewer_notes text,
  accepted_at timestamptz,
  evidence_description text,
  evidence_document_ids uuid[],
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_poc_deficiency ON plans_of_correction (deficiency_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_poc_facility_status ON plans_of_correction (facility_id, status)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_poc_due ON plans_of_correction (submission_due_date)
WHERE
  deleted_at IS NULL
  AND status = 'draft';

CREATE UNIQUE INDEX idx_poc_one_active_per_deficiency ON plans_of_correction (deficiency_id)
WHERE
  deleted_at IS NULL
  AND status NOT IN ('rejected', 'revised');

-- ============================================================
-- POLICY DOCUMENTS
-- ============================================================
CREATE TABLE policy_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  title text NOT NULL,
  category text NOT NULL
    CHECK (category IN (
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
  content text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  previous_version_id uuid REFERENCES policy_documents (id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  published_by uuid REFERENCES auth.users (id),
  requires_acknowledgment boolean NOT NULL DEFAULT TRUE,
  acknowledgment_due_days integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_policy_docs_facility ON policy_documents (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_policy_docs_category ON policy_documents (facility_id, category)
WHERE
  deleted_at IS NULL
  AND status = 'published';

-- ============================================================
-- POLICY ACKNOWLEDGMENTS
-- ============================================================
CREATE TABLE policy_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  policy_document_id uuid NOT NULL REFERENCES policy_documents (id),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  acknowledged_at timestamptz NOT NULL DEFAULT now (),
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE UNIQUE INDEX idx_policy_ack_unique ON policy_acknowledgments (policy_document_id, user_id);

CREATE INDEX idx_policy_ack_user ON policy_acknowledgments (user_id);

CREATE INDEX idx_policy_ack_document ON policy_acknowledgments (policy_document_id);

-- ============================================================
-- SURVEY VISIT SESSIONS
-- ============================================================
CREATE TABLE survey_visit_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  activated_by uuid NOT NULL REFERENCES auth.users (id),
  activated_at timestamptz NOT NULL DEFAULT now (),
  deactivated_at timestamptz,
  deactivated_by uuid REFERENCES auth.users (id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX idx_svs_facility ON survey_visit_sessions (facility_id, activated_at DESC);

CREATE UNIQUE INDEX idx_svs_one_active ON survey_visit_sessions (facility_id)
WHERE
  deactivated_at IS NULL;

-- ============================================================
-- SURVEY VISIT LOG ENTRIES
-- ============================================================
CREATE TABLE survey_visit_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  session_id uuid NOT NULL REFERENCES survey_visit_sessions (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  accessed_by uuid NOT NULL REFERENCES auth.users (id),
  accessed_at timestamptz NOT NULL DEFAULT now (),
  record_type text NOT NULL
    CHECK (record_type IN ('resident_chart', 'staff_record', 'policy_document', 'incident', 'medication', 'assessment', 'care_plan', 'daily_logs', 'other')),
  record_id uuid,
  record_description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX idx_svle_session ON survey_visit_log_entries (session_id);

CREATE INDEX idx_svle_facility ON survey_visit_log_entries (facility_id, accessed_at DESC);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE survey_deficiencies ENABLE ROW LEVEL SECURITY;

ALTER TABLE plans_of_correction ENABLE ROW LEVEL SECURITY;

ALTER TABLE policy_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE policy_acknowledgments ENABLE ROW LEVEL SECURITY;

ALTER TABLE survey_visit_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE survey_visit_log_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_deficiencies ON survey_deficiencies
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY admin_manage_deficiencies ON survey_deficiencies
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY nurse_see_deficiencies ON survey_deficiencies
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () = 'nurse');

CREATE POLICY admin_see_poc ON plans_of_correction
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY admin_manage_poc ON plans_of_correction
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY all_staff_see_published_policies ON policy_documents
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (
      status = 'published'
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin')));

CREATE POLICY admin_manage_policies ON policy_documents
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY staff_see_own_acknowledgments ON policy_acknowledgments
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND (user_id = auth.uid ()
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin')));

CREATE POLICY staff_create_own_acknowledgments ON policy_acknowledgments
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND user_id = auth.uid ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY admin_see_all_acknowledgments ON policy_acknowledgments
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY admin_manage_visit_sessions ON survey_visit_sessions
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY nurse_see_visit_sessions ON survey_visit_sessions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () = 'nurse');

CREATE POLICY admin_nurse_see_log_entries ON survey_visit_log_entries
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY admin_nurse_create_log_entries ON survey_visit_log_entries
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')
    AND accessed_by = auth.uid ());

-- ============================================================
-- Audit + updated_at
-- ============================================================
CREATE TRIGGER tr_survey_deficiencies_set_updated_at
  BEFORE UPDATE ON survey_deficiencies
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_survey_deficiencies_audit
  AFTER INSERT OR UPDATE OR DELETE ON survey_deficiencies
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_plans_of_correction_set_updated_at
  BEFORE UPDATE ON plans_of_correction
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_plans_of_correction_audit
  AFTER INSERT OR UPDATE OR DELETE ON plans_of_correction
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_policy_documents_set_updated_at
  BEFORE UPDATE ON policy_documents
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_policy_documents_audit
  AFTER INSERT OR UPDATE OR DELETE ON policy_documents
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_policy_acknowledgments_audit
  AFTER INSERT ON policy_acknowledgments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_survey_visit_sessions_audit
  AFTER INSERT OR UPDATE ON survey_visit_sessions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_survey_visit_log_entries_audit
  AFTER INSERT ON survey_visit_log_entries
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
