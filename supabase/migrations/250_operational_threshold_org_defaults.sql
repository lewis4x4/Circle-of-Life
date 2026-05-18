-- Operational threshold org defaults + corrected facility values (Quiet Operator)
-- 1) organization_operational_threshold_defaults — inheritance source per org
-- 2) facility_operational_thresholds.alert_frequency (UI scaffold)
-- 3) One-time data corrections: drill overdue, screening + training windows

-- ── Org defaults table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organization_operational_threshold_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  threshold_type text NOT NULL CHECK (threshold_type IN (
    'occupancy_low_pct', 'occupancy_high_pct',
    'staffing_ratio_violation', 'license_expiry_days',
    'insurance_expiry_days', 'document_expiry_days',
    'background_check_expiry_days', 'training_overdue_days',
    'fire_drill_overdue_days', 'elopement_drill_overdue_days',
    'incident_spike_count', 'census_change_alert'
  )),
  yellow_threshold numeric NOT NULL,
  red_threshold numeric NOT NULL,
  notify_roles text[] NOT NULL DEFAULT ARRAY['owner', 'org_admin'],
  alert_frequency text NOT NULL DEFAULT 'daily_until_resolved' CHECK (alert_frequency IN (
    'once_on_breach', 'daily_until_resolved', 'hourly', 'custom'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, threshold_type)
);

ALTER TABLE organization_operational_threshold_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_threshold_defaults_select ON organization_operational_threshold_defaults
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

CREATE POLICY org_threshold_defaults_manage ON organization_operational_threshold_defaults
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- ── Facility rows: alert_frequency scaffold ─────────────────────────────────
ALTER TABLE facility_operational_thresholds
  ADD COLUMN IF NOT EXISTS alert_frequency text
  CHECK (alert_frequency IS NULL OR alert_frequency IN (
    'once_on_breach', 'daily_until_resolved', 'hourly', 'custom'
  ));

-- Seed org defaults for every existing organization
INSERT INTO organization_operational_threshold_defaults (
  organization_id, threshold_type, yellow_threshold, red_threshold, notify_roles, alert_frequency
)
SELECT o.id, t.threshold_type, t.yellow_val::numeric, t.red_val::numeric, t.roles::text[], t.freq
FROM organizations o
CROSS JOIN (
  VALUES
    ('occupancy_low_pct',              80,    70,  ARRAY['owner', 'org_admin']::text[], 'daily_until_resolved'),
    ('occupancy_high_pct',             95,    98,  ARRAY['owner', 'org_admin']::text[], 'daily_until_resolved'),
    ('license_expiry_days',            60,    30,  ARRAY['owner', 'org_admin', 'facility_admin']::text[], 'daily_until_resolved'),
    ('insurance_expiry_days',          90,    30,  ARRAY['owner', 'org_admin']::text[], 'daily_until_resolved'),
    ('document_expiry_days',           60,    30,  ARRAY['owner', 'org_admin']::text[], 'daily_until_resolved'),
    ('background_check_expiry_days',   30,    14,  ARRAY['owner', 'org_admin', 'facility_admin']::text[], 'daily_until_resolved'),
    ('training_overdue_days',           7,    30,  ARRAY['owner', 'org_admin', 'facility_admin']::text[], 'daily_until_resolved'),
    ('fire_drill_overdue_days',        80,    90,  ARRAY['owner', 'org_admin', 'facility_admin']::text[], 'daily_until_resolved'),
    ('elopement_drill_overdue_days',   80,   100,  ARRAY['owner', 'org_admin', 'facility_admin']::text[], 'daily_until_resolved'),
    ('incident_spike_count',            5,    10,  ARRAY['owner', 'org_admin']::text[], 'once_on_breach'),
    ('census_change_alert',             3,     5,  ARRAY['owner', 'org_admin']::text[], 'once_on_breach')
) AS t(threshold_type, yellow_val, red_val, roles, freq)
WHERE o.deleted_at IS NULL
ON CONFLICT (organization_id, threshold_type) DO UPDATE SET
  yellow_threshold = EXCLUDED.yellow_threshold,
  red_threshold = EXCLUDED.red_threshold,
  notify_roles = EXCLUDED.notify_roles,
  alert_frequency = EXCLUDED.alert_frequency,
  updated_at = now();

-- Align facility rows to corrected defaults (bulk — only touches known-bad seeds)
UPDATE facility_operational_thresholds f
SET
  yellow_threshold = d.yellow_threshold,
  red_threshold = d.red_threshold,
  alert_frequency = COALESCE(f.alert_frequency, d.alert_frequency),
  updated_at = now()
FROM organization_operational_threshold_defaults d
WHERE f.organization_id = d.organization_id
  AND f.threshold_type = d.threshold_type
  AND d.threshold_type IN (
    'background_check_expiry_days',
    'training_overdue_days',
    'fire_drill_overdue_days',
    'elopement_drill_overdue_days'
  );

COMMENT ON TABLE organization_operational_threshold_defaults IS
  'Org-wide default yellow/red windows for facility_operational_thresholds; facilities inherit until overridden.';
