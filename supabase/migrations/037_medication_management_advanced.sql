-- Medication Management Advanced (spec 06-medication-management)
-- verbal_orders, medication_errors, controlled_substance_counts

-- ============================================================
-- VERBAL ORDERS
-- ============================================================
CREATE TABLE verbal_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),

  order_type text NOT NULL
    CHECK (order_type IN ('new_medication', 'dose_change', 'frequency_change', 'discontinue', 'diet_change', 'activity_restriction', 'lab_order', 'other')),
  order_text text NOT NULL,
  indication text,
  prescriber_name text NOT NULL,
  prescriber_phone text,

  received_by uuid NOT NULL REFERENCES auth.users (id),
  received_at timestamptz NOT NULL DEFAULT now (),
  read_back_confirmed boolean NOT NULL DEFAULT false,

  cosignature_status text NOT NULL DEFAULT 'pending'
    CHECK (cosignature_status IN ('pending', 'signed', 'expired')),
  cosigned_by uuid REFERENCES auth.users (id),
  cosigned_at timestamptz,
  physician_signed_date date,
  cosignature_due_at timestamptz NOT NULL,

  linked_medication_id uuid REFERENCES resident_medications (id),

  implemented boolean NOT NULL DEFAULT false,
  implemented_by uuid REFERENCES auth.users (id),
  implemented_at timestamptz,
  implementation_notes text,

  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,

  CONSTRAINT chk_verbal_orders_signed_metadata
    CHECK (
      (cosignature_status <> 'signed')
      OR (cosigned_by IS NOT NULL AND cosigned_at IS NOT NULL)
    )
);

CREATE INDEX idx_verbal_orders_resident ON verbal_orders (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_verbal_orders_facility_pending ON verbal_orders (facility_id, cosignature_status)
WHERE
  deleted_at IS NULL
  AND cosignature_status = 'pending';

CREATE INDEX idx_verbal_orders_due ON verbal_orders (cosignature_due_at)
WHERE
  deleted_at IS NULL
  AND cosignature_status = 'pending';

-- ============================================================
-- MEDICATION ERRORS
-- ============================================================
CREATE TABLE medication_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),

  error_type text NOT NULL
    CHECK (error_type IN (
      'wrong_medication',
      'wrong_dose',
      'wrong_time',
      'wrong_resident',
      'wrong_route',
      'omission',
      'unauthorized_medication',
      'documentation_error',
      'other'
    )),
  severity text NOT NULL DEFAULT 'near_miss'
    CHECK (severity IN ('near_miss', 'no_harm', 'minor_harm', 'moderate_harm', 'severe_harm')),

  emar_record_id uuid REFERENCES emar_records (id),
  resident_medication_id uuid REFERENCES resident_medications (id),
  linked_incident_id uuid REFERENCES incidents (id),
  occurred_at timestamptz NOT NULL DEFAULT now (),
  shift shift_type NOT NULL,
  discovered_by uuid NOT NULL REFERENCES auth.users (id),

  description text NOT NULL,
  contributing_factors text[],
  immediate_actions text NOT NULL,

  root_cause text,
  corrective_actions text,
  reviewed_by uuid REFERENCES auth.users (id),
  reviewed_at timestamptz,

  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_med_errors_facility ON medication_errors (facility_id, occurred_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_med_errors_resident ON medication_errors (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_med_errors_type ON medication_errors (facility_id, error_type)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_med_errors_severity ON medication_errors (facility_id, severity)
WHERE
  deleted_at IS NULL
  AND severity NOT IN ('near_miss', 'no_harm');

-- ============================================================
-- CONTROLLED SUBSTANCE COUNTS
-- ============================================================
CREATE TABLE controlled_substance_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  resident_medication_id uuid NOT NULL REFERENCES resident_medications (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),

  count_date date NOT NULL,
  shift shift_type NOT NULL,
  count_type text NOT NULL DEFAULT 'shift_change'
    CHECK (count_type IN ('shift_change', 'initial_receipt', 'destruction', 'discrepancy_recount')),

  expected_count integer NOT NULL,
  actual_count integer NOT NULL,
  discrepancy integer NOT NULL DEFAULT 0,

  outgoing_staff_id uuid NOT NULL REFERENCES auth.users (id),
  outgoing_signed_at timestamptz NOT NULL DEFAULT now (),
  incoming_staff_id uuid REFERENCES auth.users (id),
  incoming_signed_at timestamptz,

  discrepancy_resolved boolean DEFAULT true,
  resolution_notes text,
  resolved_by uuid REFERENCES auth.users (id),
  resolved_at timestamptz,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz,

  CONSTRAINT chk_csc_incoming_not_outgoing
    CHECK (incoming_staff_id IS NULL OR incoming_staff_id <> outgoing_staff_id)
);

CREATE INDEX idx_csc_medication ON controlled_substance_counts (resident_medication_id, count_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_csc_facility_date ON controlled_substance_counts (facility_id, count_date, shift)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_csc_discrepancy ON controlled_substance_counts (facility_id)
WHERE
  deleted_at IS NULL
  AND discrepancy != 0
  AND discrepancy_resolved = false;

CREATE OR REPLACE FUNCTION public.haven_csc_discrepancy_defaults ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $func$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.discrepancy <> 0 THEN
      NEW.discrepancy_resolved := false;
    ELSE
      NEW.discrepancy_resolved := true;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.discrepancy IS DISTINCT FROM OLD.discrepancy AND NEW.discrepancy <> 0 THEN
      NEW.discrepancy_resolved := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

CREATE TRIGGER tr_csc_discrepancy_defaults
  BEFORE INSERT OR UPDATE ON controlled_substance_counts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_csc_discrepancy_defaults ();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE verbal_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_verbal_orders ON verbal_orders
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY nurse_plus_create_verbal_orders ON verbal_orders
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY nurse_plus_update_verbal_orders ON verbal_orders
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE medication_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_nurse_see_medication_errors ON medication_errors
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY reporter_see_own_medication_errors ON medication_errors
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND discovered_by = auth.uid ());

CREATE POLICY clinical_staff_create_medication_errors ON medication_errors
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY nurse_plus_update_medication_errors ON medication_errors
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE controlled_substance_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinical_staff_see_counts ON controlled_substance_counts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY med_staff_create_counts ON controlled_substance_counts
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('nurse', 'caregiver'));

CREATE POLICY nurse_plus_update_counts ON controlled_substance_counts
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

-- ============================================================
-- Audit + updated_at (Haven helpers)
-- ============================================================
CREATE TRIGGER tr_verbal_orders_set_updated_at
  BEFORE UPDATE ON verbal_orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_verbal_orders_audit
  AFTER INSERT OR UPDATE OR DELETE ON verbal_orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_medication_errors_set_updated_at
  BEFORE UPDATE ON medication_errors
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_medication_errors_audit
  AFTER INSERT OR UPDATE OR DELETE ON medication_errors
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_controlled_substance_counts_audit
  AFTER INSERT OR UPDATE OR DELETE ON controlled_substance_counts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
