-- Migration 205: Risk score snapshots and owner alert deliveries
-- Part of Module 29 — Risk & Survey Command
-- Nightly facility risk scoring with owner-alert delivery tracking

-- ============================================================================
-- Table: risk_score_snapshots
-- ============================================================================

CREATE TABLE IF NOT EXISTS risk_score_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  entity_id UUID REFERENCES entities(id),

  snapshot_date DATE NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score_version INTEGER NOT NULL DEFAULT 1 CHECK (score_version > 0),

  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'moderate', 'high', 'critical')),
  score_delta INTEGER,

  component_scores_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  alert_threshold_breached BOOLEAN NOT NULL DEFAULT false,
  owner_alert_triggered_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ,

  UNIQUE (facility_id, snapshot_date, score_version)
);

CREATE INDEX IF NOT EXISTS idx_risk_score_snapshots_org_date
  ON risk_score_snapshots(organization_id, snapshot_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_risk_score_snapshots_facility_date
  ON risk_score_snapshots(facility_id, snapshot_date DESC, computed_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_risk_score_snapshots_level
  ON risk_score_snapshots(risk_level, risk_score, snapshot_date DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE risk_score_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY risk_score_snapshots_select ON risk_score_snapshots
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY risk_score_snapshots_insert ON risk_score_snapshots
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  );

CREATE POLICY risk_score_snapshots_update ON risk_score_snapshots
  FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE TRIGGER risk_score_snapshots_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON risk_score_snapshots
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

COMMENT ON TABLE risk_score_snapshots IS
  'Nightly per-facility risk score snapshots for Module 29. Aggregates operational, staffing, compliance, and incident pressure into an explainable 0-100 score.';

COMMENT ON COLUMN risk_score_snapshots.component_scores_json IS
  'Machine-readable component penalties by domain, for example operations/staffing/compliance/incidents/resident_safety.';

COMMENT ON COLUMN risk_score_snapshots.summary_json IS
  'Human-facing summary, top drivers, and raw counts used to explain the nightly score on the risk command page.';

-- ============================================================================
-- Table: risk_owner_alert_deliveries
-- ============================================================================

CREATE TABLE IF NOT EXISTS risk_owner_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID REFERENCES facilities(id),
  entity_id UUID REFERENCES entities(id),

  risk_score_snapshot_id UUID REFERENCES risk_score_snapshots(id) ON DELETE SET NULL,
  exec_alert_id UUID REFERENCES exec_alerts(id) ON DELETE SET NULL,

  recipient_user_id UUID REFERENCES auth.users(id),
  recipient_role TEXT NOT NULL DEFAULT 'owner',
  recipient_phone TEXT,

  channel TEXT NOT NULL CHECK (channel IN ('sms', 'push', 'in_app')),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('sent', 'failed', 'skipped')),
  provider_message_id TEXT,
  provider_payload JSONB,
  error_message TEXT,

  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_risk_owner_alert_deliveries_org_sent
  ON risk_owner_alert_deliveries(organization_id, sent_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_risk_owner_alert_deliveries_facility_sent
  ON risk_owner_alert_deliveries(facility_id, sent_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_risk_owner_alert_deliveries_snapshot
  ON risk_owner_alert_deliveries(risk_score_snapshot_id)
  WHERE deleted_at IS NULL;

ALTER TABLE risk_owner_alert_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY risk_owner_alert_deliveries_select ON risk_owner_alert_deliveries
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      facility_id IS NULL
      OR facility_id IN (SELECT haven.accessible_facility_ids())
    )
  );

CREATE POLICY risk_owner_alert_deliveries_insert ON risk_owner_alert_deliveries
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND (
      facility_id IS NULL
      OR facility_id IN (SELECT haven.accessible_facility_ids())
    )
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE TRIGGER risk_owner_alert_deliveries_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON risk_owner_alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

COMMENT ON TABLE risk_owner_alert_deliveries IS
  'Outbound owner-alert delivery log for Module 29 nightly risk scoring. Stores SMS/push outcomes and provider payloads for auditability.';
