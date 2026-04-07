-- Segment 4 - Backfill legacy exec_saved_reports into report_saved_views.
-- Idempotent by deterministic ID derivation from legacy row id.

WITH legacy AS (
  SELECT
    r.id AS legacy_id,
    r.organization_id,
    r.created_by,
    r.name,
    r.template
  FROM
    exec_saved_reports r
  WHERE
    r.deleted_at IS NULL
),
template_map AS (
  SELECT
    l.legacy_id,
    l.organization_id,
    l.created_by,
    l.name,
    CASE
      WHEN l.template = 'ops_weekly' THEN 'facility-operating-scorecard'
      WHEN l.template = 'financial_monthly' THEN 'ar-aging-summary'
      WHEN l.template = 'board_quarterly' THEN 'executive-weekly-operating-pack'
      ELSE 'facility-operating-scorecard'
    END AS slug
  FROM
    legacy l
),
resolved AS (
  SELECT
    tm.legacy_id,
    tm.organization_id,
    tm.created_by,
    tm.name,
    t.id AS template_id
  FROM
    template_map tm
    JOIN report_templates t ON t.slug = tm.slug
    AND t.deleted_at IS NULL
),
resolved_versions AS (
  SELECT
    r.legacy_id,
    r.organization_id,
    r.created_by,
    r.name,
    r.template_id,
    v.id AS template_version_id
  FROM
    resolved r
    JOIN LATERAL (
      SELECT
        id
      FROM
        report_template_versions
      WHERE
        template_id = r.template_id
        AND deleted_at IS NULL
      ORDER BY
        version_number DESC
      LIMIT 1
    ) v ON TRUE
)
INSERT INTO report_saved_views (
  id,
  organization_id,
  template_id,
  template_version_id,
  owner_user_id,
  sharing_scope,
  name,
  pinned_template_version,
  created_at,
  updated_at
)
SELECT
  ('f0000000-0000-0000-0000-' || right(rv.legacy_id::text, 12))::uuid AS id,
  rv.organization_id,
  rv.template_id,
  rv.template_version_id,
  rv.created_by,
  'organization'::report_sharing_scope,
  rv.name,
  true,
  now(),
  now()
FROM
  resolved_versions rv
ON CONFLICT (id) DO NOTHING;
