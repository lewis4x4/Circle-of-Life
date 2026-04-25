"use client";

import facilitiesFixture from "../components/DataTable/__fixtures__/facilities.json";
import { T2List, type T2ListProps } from "./T2List";

const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

type Row = (typeof facilitiesFixture)[number];

const PROPS: T2ListProps<Row> = {
  title: "Residents",
  subtitle: "All admitted residents in scope",
  filters: {
    dashboardId: "/admin/residents",
    statuses: [
      { id: "active", label: "Active" },
      { id: "discharge", label: "Discharge planning" },
    ],
  },
  table: {
    columns: [
      { id: "name", header: "Facility", accessor: (r) => r.name, align: "left", sticky: true },
      { id: "occupancyPct", header: "Occupancy %", accessor: (r) => r.occupancyPct, align: "right", numeric: true },
      { id: "openIncidents", header: "Open incidents", accessor: (r) => r.openIncidents, align: "right", numeric: true },
    ],
    rows: facilitiesFixture.map((row) => ({ id: row.id, data: row })),
    userPreferencesKey: "preview/t2",
    disablePreferences: true,
  },
  audit: {
    auditHref: "/admin/audit-log",
    updatedAt: "2026-04-24T15:57:00-04:00",
    now: FIXED_NOW,
  },
};

export function T2ListPreview() {
  return <T2List {...PROPS} />;
}
