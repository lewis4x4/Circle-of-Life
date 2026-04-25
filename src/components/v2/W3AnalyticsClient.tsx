"use client";

import { T4Analytics } from "@/design-system/templates";
import type { DataTableColumn, DataTableRow } from "@/design-system/components/DataTable";

import type {
  V2AnalyticsId,
  V2AnalyticsLoad,
  V2AnalyticsRollupRow,
} from "@/lib/v2-analytics";

const DASHBOARD_PATH: Record<V2AnalyticsId, string> = {
  "executive-standup": "/admin/executive/standup",
  "facility-deep-dive": "/admin/executive/facility",
  "executive-reports": "/admin/executive/reports",
  "executive-benchmarks": "/admin/executive/benchmarks",
  "finance-hub": "/admin/finance",
  "finance-labor": "/admin/finance/ledger",
  "finance-revenue": "/admin/finance/trial-balance",
};

const COLUMNS: DataTableColumn<V2AnalyticsRollupRow>[] = [
  { id: "facility_name", header: "Facility", accessor: (r) => r.facility_name, align: "left", sticky: true },
  {
    id: "occupancy_pct",
    header: "Occupancy %",
    accessor: (r) => r.occupancy_pct,
    render: (r) => (r.occupancy_pct == null ? "—" : String(r.occupancy_pct)),
    align: "right",
    numeric: true,
    metricKey: "occupancy_pct",
  },
  {
    id: "open_incidents_count",
    header: "Open incidents",
    accessor: (r) => r.open_incidents_count,
    align: "right",
    numeric: true,
    metricKey: "open_incidents",
  },
  {
    id: "risk_score",
    header: "Risk score",
    accessor: (r) => r.risk_score,
    render: (r) => (r.risk_score == null ? "—" : String(r.risk_score)),
    align: "right",
    numeric: true,
  },
  {
    id: "survey_readiness_pct",
    header: "Survey readiness %",
    accessor: (r) => r.survey_readiness_pct,
    render: (r) => (r.survey_readiness_pct == null ? "—" : String(r.survey_readiness_pct)),
    align: "right",
    numeric: true,
    metricKey: "survey_readiness_pct",
  },
];

export function W3AnalyticsClient({ load }: { load: V2AnalyticsLoad }) {
  const totalIncidents = load.rollup.reduce(
    (acc, row) => acc + (row.open_incidents_count ?? 0),
    0,
  );
  const avgRisk =
    load.rollup.length > 0
      ? Math.round(
          load.rollup
            .map((r) => r.risk_score ?? 0)
            .reduce((a, b) => a + b, 0) / load.rollup.length,
        )
      : 0;

  const tableRows: DataTableRow<V2AnalyticsRollupRow>[] = load.rollup.map((row) => ({
    id: row.facility_id,
    data: row,
    status:
      row.open_incidents_count > 3
        ? "critical"
        : row.open_incidents_count > 1
          ? "warning"
          : "ok",
    statusTooltip:
      row.open_incidents_count > 1
        ? `${row.open_incidents_count} open incidents`
        : undefined,
  }));

  return (
    <T4Analytics<V2AnalyticsRollupRow>
      title={load.title}
      subtitle={
        load.source === "fixture"
          ? `${load.subtitle} · fixture (no rows in scope)`
          : load.subtitle
      }
      filters={{
        dashboardId: DASHBOARD_PATH[load.id],
        statuses: [
          { id: "active", label: "Active" },
          { id: "review", label: "Review" },
        ],
      }}
      kpiStrip={[
        {
          label: "Facilities in scope",
          value: load.rollup.length,
          info: "Number of facilities the caller can read under RLS",
        },
        {
          label: "Open incidents",
          value: totalIncidents,
          info: "Sum of open incidents across the rollup",
          tone: totalIncidents > 0 ? "warning" : "default",
        },
        {
          label: "Avg risk score",
          value: avgRisk,
          info: "Mean of latest risk_score across facilities (lower = healthier)",
        },
        {
          label: "Generated",
          value: load.generatedAt.slice(11, 16),
          info: "UTC time the analytics payload was assembled",
        },
      ]}
      charts={[
        <div key="trend" className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
            Trend
          </span>
          <div
            aria-label="Trend chart placeholder"
            className="h-40 rounded-sm bg-surface-elevated"
          />
          <span className="text-xs text-text-muted">
            Live chart slot — wires to Recharts in S10.5 once per-page time-series
            views land.
          </span>
        </div>,
        <div key="mix" className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
            Mix
          </span>
          <div
            aria-label="Mix chart placeholder"
            className="h-40 rounded-sm bg-surface-elevated"
          />
          <span className="text-xs text-text-muted">
            Live chart slot — wires to Recharts in S10.5 once per-page breakdown
            views land.
          </span>
        </div>,
      ]}
      breakdownTable={{
        columns: COLUMNS,
        rows: tableRows,
        userPreferencesKey: DASHBOARD_PATH[load.id],
      }}
      exportToolbar={
        <span className="text-xs text-text-muted">
          CSV export available on the breakdown table; XLSX/PDF land with the
          shared export Edge Function in S10.5.
        </span>
      }
      audit={{
        auditHref: "/admin/audit-log",
        updatedAt: load.generatedAt,
      }}
    />
  );
}
