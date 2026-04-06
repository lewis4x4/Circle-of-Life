-- Phase 5: Quality Metrics (spec 10-quality-metrics) — DDL + view

CREATE TYPE pbj_export_batch_status AS ENUM (
  'pending',
  'processing',
  'complete',
  'failed'
);

CREATE TABLE quality_measures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  measure_key text NOT NULL,
  name text NOT NULL,
  description text,
  domain text,
  unit text,
  cms_tag text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_quality_measures_org_measure_active ON quality_measures (organization_id, measure_key)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_quality_measures_org ON quality_measures (organization_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE quality_measure_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  quality_measure_id uuid NOT NULL REFERENCES quality_measures (id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  value_numeric numeric,
  value_text text,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CONSTRAINT quality_measure_results_period_chk CHECK (period_start <= period_end)
);

CREATE INDEX idx_quality_measure_results_facility ON quality_measure_results (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_quality_measure_results_measure ON quality_measure_results (quality_measure_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE pbj_export_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status pbj_export_batch_status NOT NULL DEFAULT 'pending',
  storage_path text,
  row_count integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CONSTRAINT pbj_export_batches_period_chk CHECK (period_start <= period_end)
);

CREATE INDEX idx_pbj_export_batches_facility ON pbj_export_batches (facility_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE quality_measures IS 'Org-scoped quality measure catalog (Phase 5); RLS in 082.';

COMMENT ON TABLE quality_measure_results IS 'Periodic measure values per facility; RLS in 082.';

COMMENT ON TABLE pbj_export_batches IS 'PBJ export batch metadata; RLS in 082.';

CREATE OR REPLACE VIEW quality_latest_facility_measures AS
SELECT
  r.*
FROM
  quality_measure_results r
  INNER JOIN (
    SELECT
      facility_id,
      quality_measure_id,
      max(period_end) AS max_period_end
    FROM
      quality_measure_results
  WHERE
    deleted_at IS NULL
  GROUP BY
    facility_id,
    quality_measure_id) latest ON latest.facility_id = r.facility_id
    AND latest.quality_measure_id = r.quality_measure_id
    AND latest.max_period_end = r.period_end
WHERE
  r.deleted_at IS NULL;

COMMENT ON VIEW quality_latest_facility_measures IS 'Latest result row per facility + measure by period_end (Invoker: RLS on base table).';
