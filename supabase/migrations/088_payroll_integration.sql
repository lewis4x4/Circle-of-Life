-- Phase 6: Payroll Integration (spec 13-payroll-integration) — batches + lines + RLS + audit

CREATE TYPE payroll_export_batch_status AS ENUM (
  'draft',
  'queued',
  'exported',
  'failed',
  'voided'
);

CREATE TABLE payroll_export_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  provider text NOT NULL DEFAULT 'generic',
  status payroll_export_batch_status NOT NULL DEFAULT 'draft',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CONSTRAINT payroll_export_batches_period_chk CHECK (period_end >= period_start)
);

CREATE INDEX idx_payroll_export_batches_facility ON payroll_export_batches (facility_id, period_start DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE payroll_export_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  batch_id uuid NOT NULL REFERENCES payroll_export_batches (id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff (id),
  line_kind text NOT NULL,
  amount_cents integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  time_record_id uuid REFERENCES time_records (id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CONSTRAINT payroll_export_lines_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX idx_payroll_export_lines_batch ON payroll_export_lines (batch_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_payroll_export_lines_staff ON payroll_export_lines (staff_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE payroll_export_batches IS 'Payroll vendor export runs; RLS admin roles.';

COMMENT ON TABLE payroll_export_lines IS 'Export line items; idempotency_key is globally unique.';

-- RLS
ALTER TABLE payroll_export_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_export_batches_select ON payroll_export_batches
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY payroll_export_batches_write ON payroll_export_batches
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY payroll_export_batches_update ON payroll_export_batches
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE payroll_export_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_export_lines_select ON payroll_export_lines
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        payroll_export_batches b
      WHERE
        b.id = payroll_export_lines.batch_id
        AND b.organization_id = haven.organization_id ()
        AND b.deleted_at IS NULL
        AND b.facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY payroll_export_lines_insert ON payroll_export_lines
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND EXISTS (
      SELECT
        1
      FROM
        payroll_export_batches b
      WHERE
        b.id = payroll_export_lines.batch_id
        AND b.organization_id = haven.organization_id ()
        AND b.deleted_at IS NULL
        AND b.facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY payroll_export_lines_update ON payroll_export_lines
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        payroll_export_batches b
      WHERE
        b.id = payroll_export_lines.batch_id
        AND b.organization_id = haven.organization_id ()
        AND b.deleted_at IS NULL
        AND b.facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND EXISTS (
      SELECT
        1
      FROM
        payroll_export_batches b
      WHERE
        b.id = payroll_export_lines.batch_id
        AND b.organization_id = haven.organization_id ()
        AND b.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())));

CREATE TRIGGER tr_payroll_export_batches_set_updated_at
  BEFORE UPDATE ON payroll_export_batches
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_payroll_export_batches_audit
  AFTER INSERT OR UPDATE OR DELETE ON payroll_export_batches
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_payroll_export_lines_set_updated_at
  BEFORE UPDATE ON payroll_export_lines
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_payroll_export_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON payroll_export_lines
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
