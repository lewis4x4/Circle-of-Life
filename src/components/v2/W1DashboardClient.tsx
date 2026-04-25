"use client";

import { T1Dashboard } from "@/design-system/templates";
import type { DataTableColumn, DataTableRow } from "@/design-system/components/DataTable";
import type { ScopeOption } from "@/design-system/components/ScopeSelector";

import type {
  V2DashboardId,
  V2DashboardPayload,
  V2DashboardTableRow,
} from "@/lib/v2-dashboards";

const DASHBOARD_BASE_PATH: Record<V2DashboardId, string> = {
  "command-center": "/admin",
  "executive-intelligence": "/admin/executive",
  "clinical-quality": "/admin/quality",
  "rounding-operations": "/admin/rounding",
};

function fmtPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  // Show 1 decimal when fractional, integer otherwise.
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const COLUMNS: DataTableColumn<V2DashboardTableRow>[] = [
  { id: "name", header: "Facility", accessor: (r) => r.name, align: "left", sticky: true },
  {
    id: "occupancyPct",
    header: "Occupancy %",
    accessor: (r) => r.occupancyPct,
    render: (r) => fmtPct(r.occupancyPct),
    align: "right",
    numeric: true,
    metricKey: "occupancy_pct",
  },
  {
    id: "laborCostPct",
    header: "Labor cost %",
    accessor: (r) => r.laborCostPct,
    render: (r) => fmtPct(r.laborCostPct),
    align: "right",
    numeric: true,
    metricKey: "labor_cost_pct",
  },
  {
    id: "openIncidents",
    header: "Open incidents",
    accessor: (r) => r.openIncidents,
    align: "right",
    numeric: true,
    metricKey: "open_incidents",
  },
  {
    id: "surveyReadinessPct",
    header: "Survey readiness %",
    accessor: (r) => r.surveyReadinessPct,
    render: (r) => fmtPct(r.surveyReadinessPct),
    align: "right",
    numeric: true,
    metricKey: "survey_readiness_pct",
  },
];

export type W1DashboardClientProps = {
  payload: V2DashboardPayload;
  facilities: ScopeOption[];
  auditUpdatedAt: string;
  /** Optional `now` override for deterministic relative-time rendering in tests. */
  now?: Date;
};

export function W1DashboardClient({
  payload,
  facilities,
  auditUpdatedAt,
  now,
}: W1DashboardClientProps) {
  const rows: DataTableRow<V2DashboardTableRow>[] = payload.tableRows.map((row) => ({
    id: row.id,
    data: row,
    status:
      row.openIncidents > 3 ? "critical" : row.openIncidents > 1 ? "warning" : "ok",
    statusTooltip:
      row.openIncidents > 1 ? `${row.openIncidents} open incidents` : undefined,
  }));

  return (
    <T1Dashboard<V2DashboardTableRow>
      title={payload.title}
      subtitle={payload.subtitle}
      scope={{
        owners: [{ id: "col", label: "Circle of Life Holdings" }],
        groups: [],
        facilities: facilities.map((f) => ({ ...f, ownerId: "col" })),
      }}
      filters={{
        dashboardId: DASHBOARD_BASE_PATH[payload.id],
        facilities,
        statuses: [
          { id: "open", label: "Open" },
          { id: "ack", label: "Acknowledged" },
        ],
      }}
      kpis={payload.kpis}
      panels={payload.panels}
      table={{
        columns: COLUMNS,
        rows,
        thresholds: payload.thresholds,
        userPreferencesKey: `/admin/v2/${payload.id}`,
      }}
      alerts={payload.alerts}
      actionQueue={payload.actionQueue}
      audit={{
        auditHref: "/admin/audit-log",
        updatedAt: auditUpdatedAt,
        now,
      }}
    />
  );
}
