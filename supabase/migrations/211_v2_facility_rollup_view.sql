-- UI-V2 S8.5: per-facility rollup view that backs the W1 P0 dashboards
-- (Command Center, Executive, Quality, Rounding) DataTable rows.
--
-- The view joins `public.facilities`, an `open_incidents` aggregate from
-- `public.incidents`, and the latest `public.risk_score_snapshots` row per
-- facility. It uses `security_invoker = true` so RLS on the underlying tables
-- naturally constrains output to the caller's accessible facilities — the view
-- does not re-filter by `haven.accessible_facility_ids()` because that is
-- already enforced by the source-table policies.
--
-- Labor-cost % is intentionally NULL: the canonical source spans payroll +
-- finance modules (13/17) and is not yet aggregated in a single relation.
-- Once that lands, swap the NULL projection for the live aggregate.
--
-- Survey readiness % comes from the most recent risk snapshot's
-- `summary_json -> 'survey_readiness_pct'` if present, else NULL. The
-- summary_json contract is owned by Module 24 (Executive Intelligence).

CREATE OR REPLACE VIEW haven.vw_v2_facility_rollup
WITH (security_invoker = true) AS
WITH latest_risk AS (
  SELECT DISTINCT ON (rs.facility_id)
    rs.facility_id,
    rs.risk_score,
    rs.risk_level,
    rs.computed_at,
    rs.summary_json
  FROM public.risk_score_snapshots rs
  WHERE rs.deleted_at IS NULL
  ORDER BY rs.facility_id, rs.computed_at DESC
),
incident_counts AS (
  SELECT
    i.facility_id,
    COUNT(*) FILTER (
      WHERE i.deleted_at IS NULL
        AND i.status NOT IN ('closed', 'resolved')
    ) AS open_incidents_count
  FROM public.incidents i
  GROUP BY i.facility_id
)
SELECT
  f.id AS facility_id,
  f.name AS facility_name,
  f.organization_id,
  f.occupancy_pct,
  f.target_occupancy_pct,
  f.last_survey_date,
  f.ahca_license_expiration,
  COALESCE(ic.open_incidents_count, 0) AS open_incidents_count,
  lr.risk_score,
  lr.risk_level,
  lr.computed_at AS risk_computed_at,
  CASE
    WHEN lr.summary_json ? 'survey_readiness_pct'
      THEN (lr.summary_json ->> 'survey_readiness_pct')::numeric
    ELSE NULL
  END AS survey_readiness_pct,
  -- Placeholder until payroll/finance aggregate lands.
  NULL::numeric AS labor_cost_pct
FROM public.facilities f
LEFT JOIN incident_counts ic ON ic.facility_id = f.id
LEFT JOIN latest_risk lr ON lr.facility_id = f.id
WHERE f.deleted_at IS NULL;

COMMENT ON VIEW haven.vw_v2_facility_rollup IS
  'UI-V2 W1 dashboard table rollup. security_invoker; RLS cascades from public.facilities + public.incidents + public.risk_score_snapshots. UI-V2 S8.5.';

-- View access: anyone with SELECT on the underlying tables can read this view.
-- Grant USAGE on the haven schema and SELECT on the view to authenticated +
-- service_role so Next.js route handlers can query it.
GRANT USAGE ON SCHEMA haven TO authenticated, service_role;
GRANT SELECT ON haven.vw_v2_facility_rollup TO authenticated, service_role;
