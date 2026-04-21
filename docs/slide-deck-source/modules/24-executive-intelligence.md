# 24 Executive Intelligence V1

- Spec maturity: `FULL + COL notes`
- Repo posture: executive command surfaces are shipped

## What It Covers

The portfolio command center for KPI rollups, prioritized alerts, benchmark cohorts, report definitions, and organization-to-facility drill-downs.

## Primary Users

- Owners
- Org admins
- Executive leadership

## Key Workflows

- review portfolio KPIs and alerts
- drill from organization to entity to facility
- compare performance against benchmark cohorts
- manage saved executive reports and dashboard settings

## Primary Surfaces

- `/admin/executive`
- `/admin/executive/alerts`
- `/admin/executive/reports`
- `/admin/executive/benchmarks`
- `/admin/executive/entity`
- `/admin/executive/entity/[id]`
- `/admin/executive/facility/[id]`
- `/admin/executive/settings`
- `/admin/executive/ceo`
- `/admin/executive/cfo`
- `/admin/executive/coo`

## Data, Controls, And Automation

- `exec_dashboard_configs`
- `exec_kpi_snapshots`
- `exec_alerts`
- `exec_alert_user_state`
- `benchmark_cohorts`
- daily KPI snapshot and alert evaluation automation

## Deck Framing

- This is the “one system, full portfolio” chapter.
- Use zoom-out visuals, deltas, alerts, and drill-down pathways rather than table-heavy screenshots.
