ALTER TABLE exec_standup_metric_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exec_standup_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE exec_standup_snapshot_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE exec_standup_manual_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE exec_standup_forecast_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exec_standup_metric_definitions_admin_read ON exec_standup_metric_definitions;
CREATE POLICY exec_standup_metric_definitions_admin_read ON exec_standup_metric_definitions
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS exec_standup_metric_definitions_org_manage ON exec_standup_metric_definitions;
CREATE POLICY exec_standup_metric_definitions_org_manage ON exec_standup_metric_definitions
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

DROP POLICY IF EXISTS exec_standup_snapshots_org_admin_read ON exec_standup_snapshots;
CREATE POLICY exec_standup_snapshots_org_admin_read ON exec_standup_snapshots
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS exec_standup_snapshots_facility_admin_read ON exec_standup_snapshots;
CREATE POLICY exec_standup_snapshots_facility_admin_read ON exec_standup_snapshots
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() = 'facility_admin'
  );

DROP POLICY IF EXISTS exec_standup_snapshots_create_admin ON exec_standup_snapshots;
CREATE POLICY exec_standup_snapshots_create_admin ON exec_standup_snapshots
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS exec_standup_snapshots_update_org_admin ON exec_standup_snapshots;
CREATE POLICY exec_standup_snapshots_update_org_admin ON exec_standup_snapshots
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS exec_standup_snapshots_update_facility_admin_draft ON exec_standup_snapshots;
CREATE POLICY exec_standup_snapshots_update_facility_admin_draft ON exec_standup_snapshots
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() = 'facility_admin'
    AND status = 'draft'
    AND created_by = auth.uid()
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() = 'facility_admin'
    AND status = 'draft'
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS exec_standup_snapshot_metrics_org_admin_read ON exec_standup_snapshot_metrics;
CREATE POLICY exec_standup_snapshot_metrics_org_admin_read ON exec_standup_snapshot_metrics
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS exec_standup_snapshot_metrics_facility_admin_read ON exec_standup_snapshot_metrics;
CREATE POLICY exec_standup_snapshot_metrics_facility_admin_read ON exec_standup_snapshot_metrics
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() = 'facility_admin'
    AND (
      facility_id IS NULL
      OR facility_id IN (SELECT haven.accessible_facility_ids())
    )
  );

DROP POLICY IF EXISTS exec_standup_snapshot_metrics_create_admin ON exec_standup_snapshot_metrics;
CREATE POLICY exec_standup_snapshot_metrics_create_admin ON exec_standup_snapshot_metrics
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND (
      facility_id IS NULL
      OR facility_id IN (SELECT haven.accessible_facility_ids())
      OR haven.app_role() IN ('owner', 'org_admin')
    )
  );

DROP POLICY IF EXISTS exec_standup_snapshot_metrics_update_org_admin ON exec_standup_snapshot_metrics;
CREATE POLICY exec_standup_snapshot_metrics_update_org_admin ON exec_standup_snapshot_metrics
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS exec_standup_manual_entries_admin_read ON exec_standup_manual_entries;
CREATE POLICY exec_standup_manual_entries_admin_read ON exec_standup_manual_entries
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR (
        haven.app_role() = 'facility_admin'
        AND facility_id IN (SELECT haven.accessible_facility_ids())
      )
    )
  );

DROP POLICY IF EXISTS exec_standup_manual_entries_admin_write ON exec_standup_manual_entries;
CREATE POLICY exec_standup_manual_entries_admin_write ON exec_standup_manual_entries
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR (
        haven.app_role() = 'facility_admin'
        AND facility_id IN (SELECT haven.accessible_facility_ids())
      )
    )
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR (
        haven.app_role() = 'facility_admin'
        AND facility_id IN (SELECT haven.accessible_facility_ids())
      )
    )
  );

DROP POLICY IF EXISTS exec_standup_forecast_entries_admin_read ON exec_standup_forecast_entries;
CREATE POLICY exec_standup_forecast_entries_admin_read ON exec_standup_forecast_entries
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR (
        haven.app_role() = 'facility_admin'
        AND facility_id IN (SELECT haven.accessible_facility_ids())
      )
    )
  );

DROP POLICY IF EXISTS exec_standup_forecast_entries_admin_write ON exec_standup_forecast_entries;
CREATE POLICY exec_standup_forecast_entries_admin_write ON exec_standup_forecast_entries
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR (
        haven.app_role() = 'facility_admin'
        AND facility_id IN (SELECT haven.accessible_facility_ids())
      )
    )
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (
      haven.app_role() IN ('owner', 'org_admin')
      OR (
        haven.app_role() = 'facility_admin'
        AND facility_id IN (SELECT haven.accessible_facility_ids())
      )
    )
  );

DROP TRIGGER IF EXISTS tr_exec_standup_metric_definitions_set_updated_at ON exec_standup_metric_definitions;
CREATE TRIGGER tr_exec_standup_metric_definitions_set_updated_at
  BEFORE UPDATE ON exec_standup_metric_definitions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_exec_standup_snapshots_set_updated_at ON exec_standup_snapshots;
CREATE TRIGGER tr_exec_standup_snapshots_set_updated_at
  BEFORE UPDATE ON exec_standup_snapshots
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_exec_standup_snapshot_metrics_set_updated_at ON exec_standup_snapshot_metrics;
CREATE TRIGGER tr_exec_standup_snapshot_metrics_set_updated_at
  BEFORE UPDATE ON exec_standup_snapshot_metrics
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_exec_standup_manual_entries_set_updated_at ON exec_standup_manual_entries;
CREATE TRIGGER tr_exec_standup_manual_entries_set_updated_at
  BEFORE UPDATE ON exec_standup_manual_entries
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_exec_standup_forecast_entries_set_updated_at ON exec_standup_forecast_entries;
CREATE TRIGGER tr_exec_standup_forecast_entries_set_updated_at
  BEFORE UPDATE ON exec_standup_forecast_entries
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_exec_standup_metric_definitions_audit ON exec_standup_metric_definitions;
CREATE TRIGGER tr_exec_standup_metric_definitions_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_standup_metric_definitions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

DROP TRIGGER IF EXISTS tr_exec_standup_snapshots_audit ON exec_standup_snapshots;
CREATE TRIGGER tr_exec_standup_snapshots_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_standup_snapshots
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

DROP TRIGGER IF EXISTS tr_exec_standup_snapshot_metrics_audit ON exec_standup_snapshot_metrics;
CREATE TRIGGER tr_exec_standup_snapshot_metrics_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_standup_snapshot_metrics
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

DROP TRIGGER IF EXISTS tr_exec_standup_manual_entries_audit ON exec_standup_manual_entries;
CREATE TRIGGER tr_exec_standup_manual_entries_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_standup_manual_entries
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

DROP TRIGGER IF EXISTS tr_exec_standup_forecast_entries_audit ON exec_standup_forecast_entries;
CREATE TRIGGER tr_exec_standup_forecast_entries_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_standup_forecast_entries
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();
