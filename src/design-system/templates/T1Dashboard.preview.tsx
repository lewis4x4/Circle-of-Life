"use client";

import facilitiesFixture from "../components/DataTable/__fixtures__/facilities.json";
import { T1Dashboard, type T1DashboardProps } from "./T1Dashboard";

const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

type FacilityRow = (typeof facilitiesFixture)[number];

const PROPS: T1DashboardProps<FacilityRow> = {
  title: "Executive Triage",
  subtitle: "Portfolio rollup · last 24 hours",
  scope: {
    owners: [{ id: "col", label: "Circle of Life Holdings" }],
    groups: [{ id: "fl", label: "Florida Group", ownerId: "col" }],
    facilities: facilitiesFixture.map((f) => ({
      id: f.id,
      label: f.name,
      ownerId: "col",
      groupId: "fl",
    })),
  },
  filters: {
    dashboardId: "/admin",
    facilities: facilitiesFixture.map((f) => ({ id: f.id, label: f.name })),
    statuses: [
      { id: "open", label: "Open" },
      { id: "ack", label: "Acknowledged" },
    ],
  },
  kpis: [
    {
      label: "Occupancy",
      value: 92,
      unit: "%",
      info: "Census ÷ licensed beds",
      trend: { direction: "up", value: 1.8, unit: "pp", period: "vs prior 7d", goodDirection: "up" },
    },
    {
      label: "Open alerts",
      value: 7,
      info: "High + medium severity unacked",
      tone: "warning",
    },
    {
      label: "eMAR variance",
      value: 14,
      unit: "%",
      tone: "danger",
      info: "Missed/late doses ÷ scheduled",
    },
    {
      label: "Survey window",
      value: 21,
      unit: "days",
      tone: "regulatory",
      info: "Days until AHCA survey window",
    },
    {
      label: "NPS",
      value: 68,
      info: "Family NPS rolling 30d",
    },
    {
      label: "Active admits",
      value: 4,
      info: "Pending move-in within 7 days",
    },
  ],
  panels: [
    { title: "Census trend", children: <span className="text-xs text-text-secondary">Sparkline placeholder</span> },
    { title: "Top movers", children: <span className="text-xs text-text-secondary">List placeholder</span> },
    { title: "Compliance burndown", children: <span className="text-xs text-text-secondary">Burndown placeholder</span> },
    { title: "Recent acknowledgements", children: <span className="text-xs text-text-secondary">List placeholder</span> },
  ],
  table: {
    columns: [
      { id: "name", header: "Facility", accessor: (r) => r.name, align: "left", sticky: true },
      { id: "occupancyPct", header: "Occupancy %", accessor: (r) => r.occupancyPct, align: "right", numeric: true, metricKey: "occupancy_pct" },
      { id: "laborCostPct", header: "Labor cost %", accessor: (r) => r.laborCostPct, align: "right", numeric: true, metricKey: "labor_cost_pct" },
      { id: "openIncidents", header: "Open incidents", accessor: (r) => r.openIncidents, align: "right", numeric: true, metricKey: "open_incidents" },
    ],
    rows: facilitiesFixture.map((row) => ({
      id: row.id,
      data: row,
      status: row.openIncidents > 3 ? "critical" : row.openIncidents > 1 ? "warning" : "ok",
      statusTooltip:
        row.openIncidents > 1 ? `${row.openIncidents} open incidents` : undefined,
    })),
    thresholds: {
      occupancy_pct: { target: 90, direction: "up", warningBandPct: 10 },
      labor_cost_pct: { target: 35, direction: "down", warningBandPct: 10 },
      open_incidents: { target: 0, direction: "down", warningBandPct: 200 },
    },
    userPreferencesKey: "preview/t1",
    disablePreferences: true,
  },
  alerts: [
    {
      id: "alert-1",
      severity: "high",
      title: "Fall with injury",
      facilityId: "oakridge",
      organizationId: "col",
      facilityName: "Oakridge ALF",
      body: "Resident fall; suspected fracture.",
      openedAt: new Date("2026-04-24T15:30:00-04:00").toISOString(),
      status: "new",
      detailsHref: "/admin/incidents/alert-1",
    },
  ],
  actionQueue: [
    { id: "care", label: "Care plan reviews", count: 3, href: "/admin/care-plans/reviews-due" },
    { id: "certs", label: "Certifications expiring", count: 1, href: "/admin/certifications" },
  ],
  audit: {
    auditHref: "/admin/audit-log",
    updatedAt: "2026-04-24T15:57:00-04:00",
    now: FIXED_NOW,
  },
};

export function T1DashboardPreview() {
  return <T1Dashboard {...PROPS} />;
}
