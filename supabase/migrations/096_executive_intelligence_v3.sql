-- Phase 6/7: Executive Intelligence v3 (spec 24-executive-v3) — Metric Definitions, Snapshots, and Actions

CREATE TABLE exec_metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  code text NOT NULL UNIQUE CHECK (length(code) > 0 AND length(code) <= 100),
  name text NOT NULL,
  category text NOT NULL,
  description text,
  formula_type text NOT NULL,
  formula_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_format text NOT NULL DEFAULT 'number',
  threshold_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  role_visibility_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_exec_metric_definitions_code ON exec_metric_definitions (code)
WHERE
  deleted_at IS NULL;

CREATE TABLE exec_metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  metric_code text NOT NULL REFERENCES exec_metric_definitions (code),
  entity_id uuid REFERENCES entities (id),
  facility_id uuid REFERENCES facilities (id),
  snapshot_date date NOT NULL,
  period_type text NOT NULL DEFAULT 'daily',
  metric_value_numeric numeric,
  metric_value_json jsonb,
  comparison_value_numeric numeric,
  variance_numeric numeric,
  status_color text,
  source_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_exec_metric_snapshots_lookup ON exec_metric_snapshots (organization_id, metric_code, snapshot_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_exec_metric_snapshots_facility ON exec_metric_snapshots (facility_id)
WHERE
  deleted_at IS NULL;

-- Expanding existing exec_alerts table to match PRD
ALTER TABLE exec_alerts
  ADD COLUMN category text,
  ADD COLUMN why_it_matters text,
  ADD COLUMN threshold_json jsonb,
  ADD COLUMN current_value_json jsonb,
  ADD COLUMN prior_value_json jsonb,
  ADD COLUMN status text NOT NULL DEFAULT 'open',
  ADD COLUMN owner_user_id uuid REFERENCES auth.users (id),
  ADD COLUMN source_metric_code text REFERENCES exec_metric_definitions (code),
  ADD COLUMN first_triggered_at timestamptz NOT NULL DEFAULT now (),
  ADD COLUMN last_evaluated_at timestamptz NOT NULL DEFAULT now (),
  ADD COLUMN related_link_json jsonb;

CREATE TABLE exec_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  alert_id uuid REFERENCES exec_alerts (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  owner_user_id uuid NOT NULL REFERENCES auth.users (id),
  due_date date,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'medium',
  related_link_json jsonb,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_exec_actions_org_status ON exec_actions (organization_id, status)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_exec_actions_owner ON exec_actions (owner_user_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE exec_metric_definitions IS 'KPI dictionary for executive intelligence; RLS organization wide.';
COMMENT ON TABLE exec_metric_snapshots IS 'Pre-calculated metric aggregates per facility/entity; RLS matched to exec_kpi_snapshots.';
COMMENT ON TABLE exec_actions IS 'Operational tasks spawned from exec exceptions; RLS matched to exec_alerts.';

-- RLS
ALTER TABLE exec_metric_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_metric_definitions_select ON exec_metric_definitions
  FOR SELECT
  USING (
    deleted_at IS NULL
  );

CREATE POLICY exec_metric_definitions_admin ON exec_metric_definitions
  FOR ALL
  USING (haven.app_role () = 'owner')
  WITH CHECK (haven.app_role () = 'owner');

ALTER TABLE exec_metric_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_metric_snapshots_org_admin ON exec_metric_snapshots
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY exec_metric_snapshots_facility ON exec_metric_snapshots
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'facility_admin'
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY exec_metric_snapshots_insert_admin ON exec_metric_snapshots
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

ALTER TABLE exec_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_actions_org_admin ON exec_actions
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE POLICY exec_actions_owner ON exec_actions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND owner_user_id = auth.uid ());

CREATE POLICY exec_actions_owner_update ON exec_actions
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND owner_user_id = auth.uid ())
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND owner_user_id = auth.uid ());

-- Triggers
CREATE TRIGGER tr_exec_metric_definitions_set_updated_at
  BEFORE UPDATE ON exec_metric_definitions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_exec_actions_set_updated_at
  BEFORE UPDATE ON exec_actions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_exec_actions_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_actions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
