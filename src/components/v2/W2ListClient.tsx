"use client";

import { T2List } from "@/design-system/templates";
import type { DataTableColumn, DataTableRow } from "@/design-system/components/DataTable";

import type { V2ListId, V2ListRow } from "@/lib/v2-lists";

const LIST_TITLES: Record<V2ListId, { title: string; subtitle: string; basePath: string }> = {
  residents: { title: "Residents", subtitle: "All admitted residents in scope", basePath: "/admin/residents" },
  incidents: { title: "Incidents", subtitle: "Incident queue", basePath: "/admin/incidents" },
  alerts: { title: "Executive alerts", subtitle: "Active alerts in scope", basePath: "/admin/executive/alerts" },
  admissions: { title: "Admissions", subtitle: "Active admission cases", basePath: "/admin/admissions" },
};

const COLUMNS: DataTableColumn<V2ListRow>[] = [
  { id: "primary", header: "Name", accessor: (r) => r.primary, align: "left", sticky: true },
  {
    id: "facility",
    header: "Facility",
    accessor: (r) => r.facilityName,
    render: (r) => r.facilityName ?? "—",
    align: "left",
  },
  {
    id: "status",
    header: "Status",
    accessor: (r) => r.status,
    render: (r) => r.status ?? "—",
    align: "left",
  },
  {
    id: "secondary",
    header: "Detail",
    accessor: (r) => r.secondary,
    render: (r) => r.secondary ?? "—",
    align: "left",
  },
  {
    id: "occurredAt",
    header: "Occurred",
    accessor: (r) => r.occurredAt,
    render: (r) => formatTime(r.occurredAt),
    align: "right",
    numeric: true,
  },
];

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export type W2ListClientProps = {
  listId: V2ListId;
  rows: V2ListRow[];
  source: "live" | "fixture";
  generatedAt: string;
  /** Optional `now` override for deterministic relative-time rendering. */
  now?: Date;
};

export function W2ListClient({
  listId,
  rows,
  source,
  generatedAt,
  now,
}: W2ListClientProps) {
  const meta = LIST_TITLES[listId];
  const tableRows: DataTableRow<V2ListRow>[] = rows.map((row) => ({
    id: row.id,
    data: row,
    status:
      row.severity === "high" ? "critical" : row.severity === "medium" ? "warning" : "ok",
    statusTooltip:
      row.severity === "high"
        ? "High severity"
        : row.severity === "medium"
          ? "Medium severity"
          : undefined,
  }));

  return (
    <T2List<V2ListRow>
      title={meta.title}
      subtitle={
        source === "fixture"
          ? `${meta.subtitle} · fixture (no rows in scope)`
          : meta.subtitle
      }
      filters={{
        dashboardId: meta.basePath,
        statuses: [
          { id: "open", label: "Open" },
          { id: "active", label: "Active" },
          { id: "resolved", label: "Resolved" },
        ],
      }}
      table={{
        columns: COLUMNS,
        rows: tableRows,
        userPreferencesKey: meta.basePath,
        emptyState: <span>No {listId} in scope.</span>,
        onRowOpenNewTab: (id) => {
          if (typeof window !== "undefined") {
            window.open(`${meta.basePath}/${id}`, "_blank", "noopener");
          }
        },
        onRowOpenPanel: (id) => {
          if (typeof window !== "undefined") {
            window.location.assign(`${meta.basePath}/${id}`);
          }
        },
      }}
      audit={{
        auditHref: "/admin/audit-log",
        updatedAt: generatedAt,
        now,
      }}
    />
  );
}
