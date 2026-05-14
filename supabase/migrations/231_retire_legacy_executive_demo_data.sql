-- Retire legacy Executive Intelligence demo telemetry.
--
-- These rows came from migration 151 to make the portfolio dashboard look
-- populated before live Homewood onboarding existed. They now create a false
-- signal: seeded occupancy/revenue/labor/incident/survey values appear next to
-- real promoted Homewood facility data. Soft-delete them so Executive Overview
-- renders only live snapshots or blanks until the real aggregation jobs write
-- replacement rows.

ALTER TABLE public.exec_alerts
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

UPDATE public.exec_metric_snapshots
SET deleted_at = COALESCE(deleted_at, now())
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  AND deleted_at IS NULL
  AND metric_code IN ('occ_pt', 'rev_mtd', 'labor_pct', 'inc_rate', 'survey_rd')
  AND source_version = 1
  AND (
    facility_id IS NULL
    OR facility_id IN (
      '00000000-0000-0000-0002-000000000001',
      '00000000-0000-0000-0002-000000000002',
      '00000000-0000-0000-0002-000000000003',
      '00000000-0000-0000-0002-000000000004',
      '00000000-0000-0000-0002-000000000005'
    )
    OR entity_id IN (
      '00000000-0000-0000-0001-000000000001',
      '00000000-0000-0000-0001-000000000002',
      '00000000-0000-0000-0001-000000000003',
      '00000000-0000-0000-0001-000000000004',
      '00000000-0000-0000-0001-000000000005'
    )
  );

UPDATE public.exec_alerts
SET
  deleted_at = COALESCE(deleted_at, now()),
  resolved_at = COALESCE(resolved_at, now()),
  status = 'resolved'
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  AND deleted_at IS NULL
  AND title IN (
    'Oakridge occupancy dropped below 85% threshold',
    'Plantation labor cost exceeds 58% of revenue',
    'Homewood Lodge incident rate elevated (4.2 per 1k days)',
    'Rising Oaks survey readiness score below 88%'
  );
