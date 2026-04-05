-- Phase 3.5-A: platform-audit-log-access
-- RLS SELECT on audit_log; export jobs table. (Monthly partitioning: run in maintenance window — not applied here to avoid table rewrite locks.)

-- ============================================================
-- audit_log: allow read for privileged roles (was: no policies)
-- ============================================================
CREATE POLICY audit_log_select_owner_org_admin ON public.audit_log
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY audit_log_select_facility_admin ON public.audit_log
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () = 'facility_admin'
    AND (
      facility_id IS NULL
      OR facility_id IN (
        SELECT
          haven.accessible_facility_ids ())));

-- ============================================================
-- audit_log_export_jobs
-- ============================================================
CREATE TYPE audit_log_export_format AS ENUM (
  'csv',
  'pdf'
);

CREATE TYPE audit_log_export_status AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed'
);

CREATE TABLE audit_log_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  requested_by uuid NOT NULL REFERENCES auth.users (id),
  facility_id uuid REFERENCES facilities (id),
  date_from date,
  date_to date,
  format audit_log_export_format NOT NULL DEFAULT 'csv',
  status audit_log_export_status NOT NULL DEFAULT 'pending',
  storage_path text,
  sha256_checksum text,
  row_count integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now (),
  completed_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX idx_audit_log_export_jobs_org ON audit_log_export_jobs (organization_id, created_at DESC)
WHERE
  deleted_at IS NULL;

ALTER TABLE audit_log_export_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_export_jobs_select ON audit_log_export_jobs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY audit_log_export_jobs_insert ON audit_log_export_jobs
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND requested_by = auth.uid ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY audit_log_export_jobs_update ON audit_log_export_jobs
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());
