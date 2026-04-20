CREATE TABLE IF NOT EXISTS exec_standup_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  source_file_name text NOT NULL,
  source_kind text NOT NULL DEFAULT 'xlsx' CHECK (source_kind IN ('xlsx', 'csv', 'manual')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  imported_week_count integer NOT NULL DEFAULT 0,
  imported_metric_count integer NOT NULL DEFAULT 0,
  source_ref_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_exec_standup_import_jobs_org_created
  ON exec_standup_import_jobs (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE exec_standup_import_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exec_standup_import_jobs_org_admin_read ON exec_standup_import_jobs;
CREATE POLICY exec_standup_import_jobs_org_admin_read ON exec_standup_import_jobs
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS exec_standup_import_jobs_org_admin_write ON exec_standup_import_jobs;
CREATE POLICY exec_standup_import_jobs_org_admin_write ON exec_standup_import_jobs
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP TRIGGER IF EXISTS tr_exec_standup_import_jobs_set_updated_at ON exec_standup_import_jobs;
CREATE TRIGGER tr_exec_standup_import_jobs_set_updated_at
  BEFORE UPDATE ON exec_standup_import_jobs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_exec_standup_import_jobs_audit ON exec_standup_import_jobs;
CREATE TRIGGER tr_exec_standup_import_jobs_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_standup_import_jobs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();
