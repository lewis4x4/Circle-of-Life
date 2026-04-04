-- Infection control & health monitoring (spec 09-infection-control)
-- Triggers: haven_set_updated_at, haven_capture_audit_log (not spec placeholders)

-- ============================================================
-- INFECTION SURVEILLANCE
-- ============================================================
CREATE TABLE infection_surveillance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  unit_id uuid REFERENCES units (id),
  infection_type text NOT NULL
    CHECK (infection_type IN (
      'uti',
      'respiratory_upper',
      'respiratory_lower',
      'gi',
      'skin_wound',
      'skin_fungal',
      'eye',
      'bloodstream',
      'covid',
      'influenza',
      'other'
    )),
  status text NOT NULL DEFAULT 'suspected'
    CHECK (status IN ('suspected', 'confirmed', 'resolved', 'hospitalized', 'deceased')),
  onset_date date NOT NULL,
  identified_at timestamptz NOT NULL DEFAULT now (),
  identified_by uuid NOT NULL REFERENCES auth.users (id),
  resolved_date date,
  symptoms text[] NOT NULL,
  temperature_at_onset numeric(5, 2),
  lab_ordered boolean NOT NULL DEFAULT false,
  lab_type text,
  lab_result text,
  organism text,
  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,
  treatment_type text,
  antibiotic_name text,
  antibiotic_start_date date,
  antibiotic_end_date date,
  treatment_notes text,
  outcome text
    CHECK (outcome IS NULL OR outcome IN ('resolved', 'chronic', 'hospitalized', 'deceased')),
  outcome_date date,
  outcome_notes text,
  ahca_reportable boolean NOT NULL DEFAULT false,
  ahca_reported boolean NOT NULL DEFAULT false,
  ahca_reported_at timestamptz,
  outbreak_id uuid,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_inf_surv_facility ON infection_surveillance (facility_id, onset_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_inf_surv_resident ON infection_surveillance (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_inf_surv_type ON infection_surveillance (facility_id, infection_type, onset_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_inf_surv_active ON infection_surveillance (facility_id, unit_id, infection_type)
WHERE
  deleted_at IS NULL
  AND status IN ('suspected', 'confirmed');

-- ============================================================
-- INFECTION OUTBREAKS
-- ============================================================
CREATE TABLE infection_outbreaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  unit_id uuid REFERENCES units (id),
  infection_type text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'contained', 'resolved')),
  detection_method text NOT NULL DEFAULT 'algorithmic'
    CHECK (detection_method IN ('algorithmic', 'manual')),
  detected_at timestamptz NOT NULL DEFAULT now (),
  declared_by uuid NOT NULL REFERENCES auth.users (id),
  contained_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users (id),
  initial_case_count integer NOT NULL DEFAULT 2,
  peak_case_count integer,
  total_cases integer,
  ahca_reported boolean NOT NULL DEFAULT false,
  ahca_reported_at timestamptz,
  ahca_report_notes text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_outbreaks_facility ON infection_outbreaks (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_outbreaks_active ON infection_outbreaks (facility_id)
WHERE
  deleted_at IS NULL
  AND status = 'active';

CREATE INDEX idx_outbreaks_facility_unit_type ON infection_outbreaks (facility_id, unit_id, infection_type)
WHERE
  deleted_at IS NULL
  AND status IN ('active', 'contained');

ALTER TABLE infection_surveillance
  ADD CONSTRAINT fk_infection_outbreak FOREIGN KEY (outbreak_id) REFERENCES infection_outbreaks (id);

-- ============================================================
-- OUTBREAK ACTIONS
-- ============================================================
CREATE TABLE outbreak_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  outbreak_id uuid NOT NULL REFERENCES infection_outbreaks (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  action_type text NOT NULL
    CHECK (action_type IN (
      'isolation_cohorting',
      'enhanced_ppe',
      'visitor_restriction',
      'staff_screening',
      'environmental_cleaning',
      'physician_notification',
      'ahca_notification',
      'family_notification',
      'testing_protocol',
      'treatment_protocol',
      'other'
    )),
  title text NOT NULL,
  instructions text,
  priority text NOT NULL DEFAULT 'standard'
    CHECK (priority IN ('immediate', 'standard', 'when_possible')),
  assigned_to uuid REFERENCES auth.users (id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'not_applicable')),
  completed_by uuid REFERENCES auth.users (id),
  completed_at timestamptz,
  completion_notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_outbreak_actions_outbreak ON outbreak_actions (outbreak_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_outbreak_actions_pending ON outbreak_actions (outbreak_id, status)
WHERE
  deleted_at IS NULL
  AND status IN ('pending', 'in_progress');

-- ============================================================
-- VITAL SIGN ALERT THRESHOLDS
-- ============================================================
CREATE TABLE vital_sign_alert_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  temperature_high numeric(5, 2),
  temperature_low numeric(5, 2),
  bp_systolic_high integer,
  bp_systolic_low integer,
  bp_diastolic_high integer,
  bp_diastolic_low integer,
  pulse_high integer,
  pulse_low integer,
  respiration_high integer,
  respiration_low integer,
  oxygen_saturation_low numeric(5, 2),
  weight_change_lbs numeric(6, 2),
  configured_by uuid NOT NULL REFERENCES auth.users (id),
  configured_at timestamptz NOT NULL DEFAULT now (),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_vsat_resident ON vital_sign_alert_thresholds (resident_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- VITAL SIGN ALERTS
-- ============================================================
CREATE TABLE vital_sign_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  daily_log_id uuid NOT NULL REFERENCES daily_logs (id),
  vital_type text NOT NULL
    CHECK (vital_type IN ('temperature', 'bp_systolic', 'bp_diastolic', 'pulse', 'respiration', 'oxygen_saturation', 'weight_change')),
  recorded_value numeric(8, 2) NOT NULL,
  threshold_value numeric(8, 2) NOT NULL,
  direction text NOT NULL CHECK (direction IN ('above', 'below')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_by uuid REFERENCES auth.users (id),
  acknowledged_at timestamptz,
  resolved_by uuid REFERENCES auth.users (id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_vsa_facility_open ON vital_sign_alerts (facility_id)
WHERE
  deleted_at IS NULL
  AND status = 'open';

CREATE INDEX idx_vsa_resident ON vital_sign_alerts (resident_id, created_at DESC)
WHERE
  deleted_at IS NULL;

CREATE UNIQUE INDEX idx_vsa_log_vital_open ON vital_sign_alerts (daily_log_id, vital_type)
WHERE
  deleted_at IS NULL
  AND status = 'open';

-- ============================================================
-- STAFF ILLNESS RECORDS
-- ============================================================
CREATE TABLE staff_illness_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  staff_id uuid NOT NULL REFERENCES staff (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  reported_date date NOT NULL,
  illness_type text NOT NULL
    CHECK (illness_type IN ('respiratory', 'gi', 'covid', 'influenza', 'skin', 'other', 'personal')),
  symptoms text[],
  absent_from date NOT NULL,
  absent_to date,
  shifts_missed integer,
  return_cleared boolean NOT NULL DEFAULT false,
  cleared_by uuid REFERENCES auth.users (id),
  cleared_at timestamptz,
  clearance_type text
    CHECK (clearance_type IS NULL OR clearance_type IN ('self_certification', 'occupational_health', 'physician_note', 'negative_test')),
  clearance_notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_sir_staff ON staff_illness_records (staff_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_sir_facility_date ON staff_illness_records (facility_id, reported_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_sir_active ON staff_illness_records (facility_id)
WHERE
  deleted_at IS NULL
  AND absent_to IS NULL;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE infection_surveillance ENABLE ROW LEVEL SECURITY;

ALTER TABLE infection_outbreaks ENABLE ROW LEVEL SECURITY;

ALTER TABLE outbreak_actions ENABLE ROW LEVEL SECURITY;

ALTER TABLE vital_sign_alert_thresholds ENABLE ROW LEVEL SECURITY;

ALTER TABLE vital_sign_alerts ENABLE ROW LEVEL SECURITY;

ALTER TABLE staff_illness_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_nurse_see_infections ON infection_surveillance
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY admin_nurse_manage_infections ON infection_surveillance
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY admin_nurse_see_outbreaks ON infection_outbreaks
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY admin_nurse_manage_outbreaks ON infection_outbreaks
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY clinical_staff_see_outbreak_actions ON outbreak_actions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY admin_nurse_manage_outbreak_actions ON outbreak_actions
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY caregiver_complete_outbreak_actions ON outbreak_actions
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () = 'caregiver'
    AND assigned_to = auth.uid ())
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () = 'caregiver'
    AND assigned_to = auth.uid ());

CREATE POLICY admin_nurse_see_thresholds ON vital_sign_alert_thresholds
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY admin_nurse_manage_thresholds ON vital_sign_alert_thresholds
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY admin_nurse_see_vital_alerts ON vital_sign_alerts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY caregiver_see_own_resident_vital_alerts ON vital_sign_alerts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'caregiver'
    AND resident_id IN (
      SELECT
        dl.resident_id
      FROM
        daily_logs dl
      WHERE
        dl.logged_by = auth.uid ()
        AND dl.organization_id = haven.organization_id ()
        AND dl.facility_id = vital_sign_alerts.facility_id
        AND dl.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND dl.deleted_at IS NULL
        AND dl.log_date >= CURRENT_DATE - INTERVAL '1 day'));

CREATE POLICY admin_nurse_manage_vital_alerts ON vital_sign_alerts
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY admin_nurse_see_illness_records ON staff_illness_records
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY staff_see_own_illness ON staff_illness_records
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL));

CREATE POLICY admin_nurse_manage_illness ON staff_illness_records
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY staff_self_report_illness ON staff_illness_records
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL));

-- ============================================================
-- Audit + updated_at (thresholds: config only — no audit on thresholds)
-- ============================================================
CREATE TRIGGER tr_infection_surveillance_set_updated_at
  BEFORE UPDATE ON infection_surveillance
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_infection_surveillance_audit
  AFTER INSERT OR UPDATE OR DELETE ON infection_surveillance
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_infection_outbreaks_set_updated_at
  BEFORE UPDATE ON infection_outbreaks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_infection_outbreaks_audit
  AFTER INSERT OR UPDATE OR DELETE ON infection_outbreaks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_outbreak_actions_set_updated_at
  BEFORE UPDATE ON outbreak_actions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_outbreak_actions_audit
  AFTER INSERT OR UPDATE OR DELETE ON outbreak_actions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_vital_sign_alert_thresholds_set_updated_at
  BEFORE UPDATE ON vital_sign_alert_thresholds
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_vital_sign_alerts_audit
  AFTER INSERT OR UPDATE OR DELETE ON vital_sign_alerts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_staff_illness_records_set_updated_at
  BEFORE UPDATE ON staff_illness_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_staff_illness_records_audit
  AFTER INSERT OR UPDATE OR DELETE ON staff_illness_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
