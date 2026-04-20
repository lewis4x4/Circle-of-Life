CREATE TABLE IF NOT EXISTS exec_standup_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  week_of date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  draft_notes text,
  review_notes text,
  published_version integer NOT NULL DEFAULT 1 CHECK (published_version >= 1),
  confidence_band exec_standup_confidence_band NOT NULL DEFAULT 'medium',
  completeness_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (completeness_pct >= 0 AND completeness_pct <= 100),
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_attachment_path text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES auth.users(id),
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_exec_standup_snapshots_org_week
  ON exec_standup_snapshots (organization_id, week_of)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_exec_standup_snapshots_org_status
  ON exec_standup_snapshots (organization_id, status, week_of DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS exec_standup_snapshot_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES exec_standup_snapshots(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid REFERENCES facilities(id),
  section_key text NOT NULL,
  metric_key text NOT NULL,
  metric_label text NOT NULL,
  value_numeric numeric(14,2),
  value_text text,
  value_currency_code text NOT NULL DEFAULT 'USD',
  source_mode exec_standup_source_mode NOT NULL DEFAULT 'auto',
  confidence_band exec_standup_confidence_band NOT NULL DEFAULT 'medium',
  totals_included boolean NOT NULL DEFAULT false,
  freshness_at timestamptz,
  source_ref_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  override_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_exec_standup_snapshot_metrics_facility_unique
  ON exec_standup_snapshot_metrics (snapshot_id, facility_id, metric_key)
  WHERE deleted_at IS NULL
    AND facility_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_exec_standup_snapshot_metrics_total_unique
  ON exec_standup_snapshot_metrics (snapshot_id, metric_key)
  WHERE deleted_at IS NULL
    AND facility_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_exec_standup_snapshot_metrics_section
  ON exec_standup_snapshot_metrics (snapshot_id, section_key, metric_key)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS exec_standup_manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  week_of date NOT NULL,
  section_key text NOT NULL,
  metric_key text NOT NULL,
  value_numeric numeric(14,2),
  value_text text,
  note text,
  confidence_band exec_standup_confidence_band NOT NULL DEFAULT 'low',
  entered_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  CONSTRAINT exec_standup_manual_entries_unique UNIQUE (facility_id, week_of, section_key, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_exec_standup_manual_entries_org_week
  ON exec_standup_manual_entries (organization_id, week_of DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS exec_standup_forecast_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  week_of date NOT NULL,
  metric_key text NOT NULL,
  expected_value_numeric numeric(14,2),
  expected_value_text text,
  rationale text,
  confidence_band exec_standup_confidence_band NOT NULL DEFAULT 'medium',
  entered_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  CONSTRAINT exec_standup_forecast_entries_unique UNIQUE (facility_id, week_of, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_exec_standup_forecast_entries_org_week
  ON exec_standup_forecast_entries (organization_id, week_of DESC)
  WHERE deleted_at IS NULL;
