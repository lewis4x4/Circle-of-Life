"use client";

import { T1Dashboard } from "@/design-system/templates";
import type { DataTableColumn, DataTableRow } from "@/design-system/components/DataTable";
import { PageShell } from "@/design-system/components/PageShell";
import { ScopeSelector, type ScopeOption } from "@/design-system/components/ScopeSelector";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import type { V2DashboardRowsSource } from "@/lib/v2-dashboard-loader";
import type {
  V2DashboardId,
  V2DashboardPayload,
  V2DashboardTableRow,
} from "@/lib/v2-dashboards";
import { V2EmptyOnboarding } from "./V2EmptyOnboarding";

const DASHBOARD_BASE_PATH: Record<V2DashboardId, string> = {
  "command-center": "/admin",
  "executive-intelligence": "/admin/executive",
  "clinical-quality": "/admin/quality",
  "rounding-operations": "/admin/rounding",
};

function fmtMetric(value: number | null): string {
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
    render: (r) => fmtMetric(r.occupancyPct),
    align: "right",
    numeric: true,
    metricKey: "occupancy_pct",
  },
  {
    id: "laborCostPct",
    header: "Labor cost %",
    accessor: (r) => r.laborCostPct,
    render: (r) => fmtMetric(r.laborCostPct),
    align: "right",
    numeric: true,
    metricKey: "labor_cost_pct",
  },
  {
    id: "openIncidents",
    header: "Open incidents",
    accessor: (r) => r.openIncidents,
    render: (r) => fmtMetric(r.openIncidents),
    align: "right",
    numeric: true,
    metricKey: "open_incidents",
  },
  {
    id: "surveyReadinessPct",
    header: "Survey readiness %",
    accessor: (r) => r.surveyReadinessPct,
    render: (r) => fmtMetric(r.surveyReadinessPct),
    align: "right",
    numeric: true,
    metricKey: "survey_readiness_pct",
  },
];

export type W1DashboardClientProps = {
  payload: V2DashboardPayload;
  facilities: ScopeOption[];
  /**
   * Total org facilities visible under RLS (regardless of rollup data).
   * Drives empty-install onboarding copy. Optional — falls back to
   * `facilities.length` then to the shell facility store.
   */
  orgFacilityCount?: number;
  auditUpdatedAt: string;
  rowsSource: V2DashboardRowsSource;
  /** Optional `now` override for deterministic relative-time rendering in tests. */
  now?: Date;
};

export function W1DashboardClient({
  payload,
  facilities,
  orgFacilityCount,
  auditUpdatedAt,
  rowsSource,
  now,
}: W1DashboardClientProps) {
  const rows: DataTableRow<V2DashboardTableRow>[] = payload.tableRows.map((row) => ({
    id: row.id,
    data: row,
    status:
      row.openIncidents == null
        ? "warning"
        : row.openIncidents > 3
          ? "critical"
          : row.openIncidents > 1
            ? "warning"
            : "ok",
    statusTooltip:
      row.openIncidents == null
        ? "Open incident count unavailable"
        : row.openIncidents > 1
          ? `${row.openIncidents} open incidents`
          : undefined,
  }));

  const sourceNote =
    rowsSource === "empty"
      ? "No live facility rollup rows in scope"
      : rowsSource === "unavailable"
        ? "Live facility rollup unavailable; no fallback rows shown"
        : null;

  // "Empty install" — the underlying jobs haven't run yet, so every KPI is
  // the seeded "—" placeholder, the alerts/action-queue/table arrays are
  // empty, and the panels carry the "Live source pending; no fixture value
  // is shown" subtitle. Render an onboarding card instead of the empty
  // dashboard chrome so the page tells the operator what to do next.
  const shellAvailableFacilities = useFacilityStore((s) => s.availableFacilities);
  const allKpisEmpty = payload.kpis.every((k) => k.value === "—" || k.value == null || k.value === "");
  const allTableRowsEmpty = payload.tableRows.length === 0;
  const allAlertsEmpty = payload.alerts.length === 0;
  const allActionsEmpty = payload.actionQueue.length === 0;
  const isOrgEmpty = allKpisEmpty && allTableRowsEmpty && allAlertsEmpty && allActionsEmpty;

  if (isOrgEmpty) {
    // Onboarding copy needs the *org* facility count, not the rollup-derived
    // `facilities` (which is 0 on empty installs because the view returns
    // nothing yet). Source of truth: `orgFacilityCount` from the server
    // loader (counts public.facilities under RLS). Fallback: the shell-level
    // facility store, populated by the AdminShell's facility-scope dropdown.
    const shellFacilityCount = shellAvailableFacilities.length;
    const reportedFacilityCount = Math.max(
      orgFacilityCount ?? 0,
      facilities.length,
      shellFacilityCount,
    );
    return (
      <PageShell
        title={payload.title}
        subtitle={sourceNote ? `${payload.subtitle} · ${sourceNote}` : payload.subtitle}
        scope={
          <ScopeSelector
            owners={[{ id: "current", label: "Current organization" }]}
            groups={[]}
            facilities={facilities.map((f) => ({ ...f, ownerId: "current" }))}
          />
        }
        audit={{
          auditHref: "/admin/audit-log",
          updatedAt: auditUpdatedAt,
          now,
        }}
      >
        <V2EmptyOnboarding dashboardId={payload.id} facilityCount={reportedFacilityCount} />
      </PageShell>
    );
  }

  return (
    <T1Dashboard<V2DashboardTableRow>
      title={payload.title}
      subtitle={sourceNote ? `${payload.subtitle} · ${sourceNote}` : payload.subtitle}
      scope={{
        owners: [{ id: "current", label: "Current organization" }],
        groups: [],
        facilities: facilities.map((f) => ({ ...f, ownerId: "current" })),
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
        emptyState: sourceNote ? <span>{sourceNote}.</span> : undefined,
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
