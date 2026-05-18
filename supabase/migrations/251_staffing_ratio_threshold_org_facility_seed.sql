-- Backfill staffing ratio threshold defaults (missing from COL seed snapshot) + org inheritance row.

INSERT INTO organization_operational_threshold_defaults (
  organization_id,
  threshold_type,
  yellow_threshold,
  red_threshold,
  notify_roles,
  alert_frequency
)
SELECT o.id,
  'staffing_ratio_violation'::text,
  2::numeric,
  5::numeric,
  ARRAY['owner', 'org_admin', 'facility_admin']::text[],
  'daily_until_resolved'::text
FROM organizations o
WHERE o.deleted_at IS NULL
ON CONFLICT (organization_id, threshold_type) DO NOTHING;

INSERT INTO facility_operational_thresholds (
  facility_id,
  organization_id,
  threshold_type,
  yellow_threshold,
  red_threshold,
  notify_roles,
  alert_frequency
)
SELECT f.id,
  f.organization_id,
  'staffing_ratio_violation'::text,
  d.yellow_threshold,
  d.red_threshold,
  d.notify_roles,
  d.alert_frequency
FROM facilities f
JOIN organization_operational_threshold_defaults d
  ON d.organization_id = f.organization_id
 AND d.threshold_type = 'staffing_ratio_violation'
WHERE f.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM facility_operational_thresholds existing
    WHERE existing.facility_id = f.id
      AND existing.threshold_type = 'staffing_ratio_violation'
  );
