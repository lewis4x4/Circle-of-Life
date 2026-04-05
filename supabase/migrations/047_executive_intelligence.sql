-- Module 24 — Executive Intelligence v1 (spec 24-executive-intelligence.md)

CREATE TYPE exec_alert_severity AS ENUM (
  'critical',
  'warning',
  'info'
);

CREATE TYPE exec_alert_source_module AS ENUM (
  'billing',
  'finance',
  'incidents',
  'infection',
  'compliance',
  'staff',
  'medications',
  'insurance',
  'vendors',
  'system'
);

CREATE TYPE exec_snapshot_scope AS ENUM (
  'organization',
  'entity',
  'facility'
);

CREATE TYPE exec_report_template AS ENUM (
  'ops_weekly',
  'financial_monthly',
  'board_quarterly',
  'custom'
);

CREATE TABLE exec_dashboard_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  widgets jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_date_range text NOT NULL DEFAULT 'mtd'
    CHECK (default_date_range IN ('mtd', 'qtd', 'ytd', 'last_30', 'last_90')),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_exec_dashboard_configs_user ON exec_dashboard_configs (organization_id, user_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE exec_kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  scope_type exec_snapshot_scope NOT NULL,
  scope_id uuid NOT NULL,
  snapshot_date date NOT NULL,
  metrics_version integer NOT NULL DEFAULT 1,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  lineage jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now (),
  computed_by text DEFAULT 'cron',
  deleted_at timestamptz
);

CREATE INDEX idx_exec_kpi_snapshots_lookup ON exec_kpi_snapshots (organization_id, scope_type, scope_id, snapshot_date DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE exec_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  source_module exec_alert_source_module NOT NULL,
  severity exec_alert_severity NOT NULL,
  title text NOT NULL,
  body text,
  entity_id uuid REFERENCES entities (id),
  facility_id uuid REFERENCES facilities (id),
  deep_link_path text,
  score numeric(12, 4),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users (id),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_exec_alerts_open ON exec_alerts (organization_id, severity, created_at DESC)
WHERE
  deleted_at IS NULL
  AND resolved_at IS NULL;

CREATE INDEX idx_exec_alerts_facility ON exec_alerts (facility_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE exec_alert_user_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  exec_alert_id uuid NOT NULL REFERENCES exec_alerts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id),
  acknowledged_at timestamptz,
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz,
  CONSTRAINT exec_alert_user_state_unique UNIQUE (exec_alert_id, user_id)
);

CREATE INDEX idx_exec_alert_user_state_user ON exec_alert_user_state (organization_id, user_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE benchmark_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL,
  description text,
  facility_ids uuid[] NOT NULL DEFAULT '{}',
  minimum_n integer NOT NULL DEFAULT 5 CHECK (minimum_n >= 5),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_benchmark_cohorts_org ON benchmark_cohorts (organization_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE exec_saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  name text NOT NULL,
  template exec_report_template NOT NULL DEFAULT 'custom',
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_generated_at timestamptz,
  last_output_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_exec_saved_reports_org ON exec_saved_reports (organization_id)
WHERE
  deleted_at IS NULL;

-- RLS
ALTER TABLE exec_dashboard_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_dashboard_configs_all ON exec_dashboard_configs
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND user_id = auth.uid ()
    AND deleted_at IS NULL)
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND user_id = auth.uid ());

ALTER TABLE exec_kpi_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_kpi_snapshots_org_admin ON exec_kpi_snapshots
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY exec_kpi_snapshots_facility ON exec_kpi_snapshots
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'facility_admin'
    AND scope_type = 'facility'
    AND scope_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY exec_kpi_snapshots_insert_admin ON exec_kpi_snapshots
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

ALTER TABLE exec_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_alerts_org_admin ON exec_alerts
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE POLICY exec_alerts_facility ON exec_alerts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'facility_admin'
    AND (
      facility_id IS NULL
      OR facility_id IN (
        SELECT
          haven.accessible_facility_ids ())));

CREATE POLICY exec_alerts_facility_update ON exec_alerts
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'facility_admin'
    AND (
      facility_id IS NULL
      OR facility_id IN (
        SELECT
          haven.accessible_facility_ids ())));

ALTER TABLE exec_alert_user_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_alert_user_state_own ON exec_alert_user_state
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND user_id = auth.uid ()
    AND deleted_at IS NULL)
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND user_id = auth.uid ());

ALTER TABLE benchmark_cohorts ENABLE ROW LEVEL SECURITY;

CREATE POLICY benchmark_cohorts_org_admin ON benchmark_cohorts
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE POLICY benchmark_cohorts_facility_read ON benchmark_cohorts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'facility_admin');

ALTER TABLE exec_saved_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_saved_reports_org_admin ON exec_saved_reports
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

-- Triggers
CREATE TRIGGER tr_exec_dashboard_configs_set_updated_at
  BEFORE UPDATE ON exec_dashboard_configs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_exec_dashboard_configs_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_dashboard_configs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_exec_alerts_set_updated_at
  BEFORE UPDATE ON exec_alerts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_exec_alerts_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_alerts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_exec_alert_user_state_set_updated_at
  BEFORE UPDATE ON exec_alert_user_state
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_exec_alert_user_state_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_alert_user_state
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_benchmark_cohorts_set_updated_at
  BEFORE UPDATE ON benchmark_cohorts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_benchmark_cohorts_audit
  AFTER INSERT OR UPDATE OR DELETE ON benchmark_cohorts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_exec_saved_reports_set_updated_at
  BEFORE UPDATE ON exec_saved_reports
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_exec_saved_reports_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_saved_reports
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
