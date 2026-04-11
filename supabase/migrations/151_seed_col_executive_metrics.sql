-- Seed exec_metric_definitions + exec_metric_snapshots + exec_alerts
-- for the COL organization (00000000-0000-0000-0000-000000000001).
-- Populates the Executive Intelligence Command Center overview dashboard.

-- ── 1. Metric definitions (org-agnostic; idempotent via ON CONFLICT) ──

INSERT INTO exec_metric_definitions (code, name, category, description, formula_type, display_format, threshold_config_json)
VALUES
  ('occ_pt',    'Occupancy %',      'growth',    'Percentage of operational beds currently occupied.',                  'beds_occupied / beds_licensed',              'percentage', '{"target":0.95,"warning":0.90,"critical":0.85,"logic":"higher_is_better"}'::jsonb),
  ('rev_mtd',   'Billed Revenue',   'finance',   'Total invoice amounts posted month-to-date (cents).',                'sum(invoices.total_amount_cents)',            'currency',   '{"logic":"higher_is_better"}'::jsonb),
  ('labor_pct', 'Labor Cost %',     'finance',   'Labor expenses as a percentage of revenue.',                          'sum(payroll_gross) / sum(invoice_total)',     'percentage', '{"target":0.50,"warning":0.55,"critical":0.60,"logic":"lower_is_better"}'::jsonb),
  ('inc_rate',  'Incident Rate',    'clinical',  'Incidents per 1,000 resident days.',                                  '(sum(incidents) / resident_days) * 1000',    'number',     '{"target":2.0,"warning":4.0,"critical":6.0,"logic":"lower_is_better"}'::jsonb),
  ('survey_rd', 'Survey Readiness', 'compliance','Weighted readiness score across compliance dimensions.',              'weighted(deficiency_clear, training_current)','percentage', '{"target":0.95,"warning":0.88,"critical":0.80,"logic":"higher_is_better"}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- ── 2. Org-level metric snapshots (6 months of synthetic history) ──

DO $$
DECLARE
  col_org  uuid := '00000000-0000-0000-0000-000000000001';
  fac_ids  uuid[] := ARRAY[
    '00000000-0000-0000-0002-000000000001',  -- Oakridge
    '00000000-0000-0000-0002-000000000002',  -- Rising Oaks
    '00000000-0000-0000-0002-000000000003',  -- Homewood Lodge
    '00000000-0000-0000-0002-000000000004',  -- Plantation
    '00000000-0000-0000-0002-000000000005'   -- Grande Cypress
  ];
  ent_ids  uuid[] := ARRAY[
    '00000000-0000-0000-0001-000000000001',  -- Pine House (Oakridge)
    '00000000-0000-0000-0001-000000000002',  -- Smith & Sorensen (Rising Oaks)
    '00000000-0000-0000-0001-000000000003',  -- Sorensen Smith Bay (Homewood)
    '00000000-0000-0000-0001-000000000004',  -- Plantation on Summers
    '00000000-0000-0000-0001-000000000005'   -- Grande Cypress LLC
  ];
  snap_date date;
  m        int;
  f        int;
  base_occ numeric;
  base_rev numeric;
  base_lab numeric;
  base_inc numeric;
  base_srv numeric;
  jitter   numeric;
BEGIN
  FOR m IN 0..5 LOOP
    snap_date := (current_date - (m * interval '30 days'))::date;

    base_occ := (0.891 - (m * 0.008) + (random() * 0.02 - 0.01))::numeric;
    base_rev := (84500000 + (random() * 4000000 - 2000000))::numeric;
    base_lab := (0.525 + (m * 0.005) + (random() * 0.02 - 0.01))::numeric;
    base_inc := (2.8 + (random() * 1.0 - 0.5))::numeric;
    base_srv := (0.882 - (m * 0.006) + (random() * 0.02 - 0.01))::numeric;

    INSERT INTO exec_metric_snapshots (organization_id, metric_code, snapshot_date, period_type, metric_value_numeric, status_color)
    VALUES
      (col_org, 'occ_pt',    snap_date, 'daily', ROUND(base_occ, 4), CASE WHEN base_occ >= 0.90 THEN 'green' WHEN base_occ >= 0.85 THEN 'yellow' ELSE 'red' END),
      (col_org, 'rev_mtd',   snap_date, 'daily', ROUND(base_rev),    'green'),
      (col_org, 'labor_pct', snap_date, 'daily', ROUND(base_lab, 4), CASE WHEN base_lab <= 0.50 THEN 'green' WHEN base_lab <= 0.55 THEN 'yellow' ELSE 'red' END),
      (col_org, 'inc_rate',  snap_date, 'daily', ROUND(base_inc, 2), CASE WHEN base_inc <= 2.0 THEN 'green' WHEN base_inc <= 4.0 THEN 'yellow' ELSE 'red' END),
      (col_org, 'survey_rd', snap_date, 'daily', ROUND(base_srv, 4), CASE WHEN base_srv >= 0.95 THEN 'green' WHEN base_srv >= 0.88 THEN 'yellow' ELSE 'red' END);

    FOR f IN 1..5 LOOP
      jitter := ((f - 3) * 0.015 + (random() * 0.02 - 0.01))::numeric;

      INSERT INTO exec_metric_snapshots (organization_id, facility_id, entity_id, metric_code, snapshot_date, period_type, metric_value_numeric, status_color)
      VALUES
        (col_org, fac_ids[f], ent_ids[f], 'occ_pt',    snap_date, 'daily',
         ROUND(GREATEST(0.72::numeric, LEAST(0.99::numeric, base_occ + jitter)), 4),
         CASE WHEN (base_occ + jitter) >= 0.90 THEN 'green' WHEN (base_occ + jitter) >= 0.85 THEN 'yellow' ELSE 'red' END),
        (col_org, fac_ids[f], ent_ids[f], 'rev_mtd',   snap_date, 'daily',
         ROUND((base_rev / 5 + (f - 3) * 800000 + (random() * 500000 - 250000))::numeric),
         'green'),
        (col_org, fac_ids[f], ent_ids[f], 'labor_pct', snap_date, 'daily',
         ROUND(GREATEST(0.35::numeric, LEAST(0.70::numeric, base_lab - jitter)), 4),
         CASE WHEN (base_lab - jitter) <= 0.50 THEN 'green' WHEN (base_lab - jitter) <= 0.55 THEN 'yellow' ELSE 'red' END),
        (col_org, fac_ids[f], ent_ids[f], 'inc_rate',  snap_date, 'daily',
         ROUND(GREATEST(0.5::numeric, (base_inc + (f * 0.4) + (random() * 0.6 - 0.3))::numeric), 2),
         CASE WHEN (base_inc + f * 0.4) <= 2.0 THEN 'green' WHEN (base_inc + f * 0.4) <= 4.0 THEN 'yellow' ELSE 'red' END),
        (col_org, fac_ids[f], ent_ids[f], 'survey_rd', snap_date, 'daily',
         ROUND(GREATEST(0.70::numeric, LEAST(0.99::numeric, base_srv + jitter)), 4),
         CASE WHEN (base_srv + jitter) >= 0.95 THEN 'green' WHEN (base_srv + jitter) >= 0.88 THEN 'yellow' ELSE 'red' END);
    END LOOP;
  END LOOP;
END $$;

-- ── 3. Seed executive alerts so the Watchlist panel renders ──

INSERT INTO exec_alerts (
  organization_id, facility_id, source_module, severity, title, body,
  category, why_it_matters, status, first_triggered_at, last_evaluated_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'compliance',
    'critical',
    'Oakridge occupancy dropped below 85% threshold',
    'Oakridge ALF occupancy fell from 88.2% to 83.7% over the past 14 days following 4 discharges with no offsetting admissions.',
    'growth',
    'Revenue break-even requires >88% occupancy. Continuing at this rate erodes cash reserves by approximately $38,000/month.',
    'open',
    now() - interval '2 days',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0002-000000000004',
    'finance',
    'warning',
    'Plantation labor cost exceeds 58% of revenue',
    'Labor cost at Plantation ALF reached 58.3% of month-to-date revenue, above the 55% warning threshold.',
    'finance',
    'Labor costs above 55% compress operating margins. Review overtime hours and agency staffing usage for the current pay period.',
    'open',
    now() - interval '1 day',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0002-000000000003',
    'incidents',
    'warning',
    'Homewood Lodge incident rate elevated (4.2 per 1k days)',
    'Incident rate at Homewood Lodge ALF is 4.2 per 1,000 resident days, exceeding the 4.0 warning threshold. Three fall incidents in the past week.',
    'clinical',
    'Elevated incident rates increase regulatory scrutiny risk and may trigger AHCA follow-up if a pattern is established.',
    'open',
    now() - interval '3 days',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0002-000000000002',
    'compliance',
    'warning',
    'Rising Oaks survey readiness score below 88%',
    'Survey readiness at Rising Oaks ALF dropped to 86.5% driven by 2 overdue staff training completions and 1 pending fire safety recertification.',
    'compliance',
    'AHCA surveys can occur with 1 business-day notice. Facilities below 88% readiness face higher deficiency risk.',
    'open',
    now() - interval '5 days',
    now()
  );

COMMENT ON COLUMN exec_metric_snapshots.metric_value_numeric IS 'Numeric metric value; percentages as decimals (0.89 = 89%), currency in cents.';
