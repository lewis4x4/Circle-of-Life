"use client";

import facilitiesFixture from "../components/DataTable/__fixtures__/facilities.json";
import { T4Analytics, type T4AnalyticsProps } from "./T4Analytics";

const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

type Row = (typeof facilitiesFixture)[number];

const PROPS: T4AnalyticsProps<Row> = {
  title: "Executive standup",
  subtitle: "Last 30 days",
  filters: {
    dashboardId: "/admin/executive/standup",
    statuses: [{ id: "open", label: "Open alerts" }],
  },
  kpiStrip: [
    { label: "Occupancy", value: 92, unit: "%", info: "Census ÷ licensed beds" },
    { label: "Labor cost", value: 36, unit: "%", info: "GM weekly", tone: "warning" },
    { label: "Open incidents", value: 13, info: "Across portfolio", tone: "danger" },
    { label: "Revenue", value: "$1.2M", info: "Trailing 30 days" },
  ],
  charts: [
    <div key="trend" className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
        Trend
      </span>
      <div className="h-32 rounded-sm bg-surface-elevated" aria-label="Trend chart placeholder" />
    </div>,
    <div key="break" className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
        Mix
      </span>
      <div className="h-32 rounded-sm bg-surface-elevated" aria-label="Mix chart placeholder" />
    </div>,
  ],
  breakdownTable: {
    columns: [
      { id: "name", header: "Facility", accessor: (r) => r.name, align: "left" },
      { id: "occupancyPct", header: "Occupancy %", accessor: (r) => r.occupancyPct, align: "right", numeric: true },
      { id: "openIncidents", header: "Incidents", accessor: (r) => r.openIncidents, align: "right", numeric: true },
    ],
    rows: facilitiesFixture.map((row) => ({ id: row.id, data: row })),
    userPreferencesKey: "preview/t4",
    disablePreferences: true,
  },
  exportToolbar: (
    <span className="text-xs text-text-muted">Use Export menu in the table to download.</span>
  ),
  audit: {
    auditHref: "/admin/audit-log",
    updatedAt: "2026-04-24T15:57:00-04:00",
    now: FIXED_NOW,
  },
};

export function T4AnalyticsPreview() {
  return <T4Analytics {...PROPS} />;
}
