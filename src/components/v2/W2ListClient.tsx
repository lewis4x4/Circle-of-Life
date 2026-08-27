"use client";

import { T2List } from "@/design-system/templates";
import type { DataTableColumn, DataTableRow } from "@/design-system/components/DataTable";

import type { V2ListId, V2ListRow, V2LiveSource } from "@/lib/v2-lists";
import {
  isV2PaginationOutOfRange,
  type V2PaginationMeta,
} from "@/lib/v2-pagination";

import {
  formatW2ListDetail,
  formatW2ListFacilityName,
  formatW2ListOccurredAt,
  formatW2ListStatus,
} from "@/lib/v2/w2-list-display-copy";

import { FlagshipListLandingNav } from "./flagship-landing-nav";
import { V2PaginationControls } from "./V2PaginationControls";

const LIST_TITLES: Record<V2ListId, { title: string; subtitle: string; basePath: string }> = {
  residents: {
    title: "Residents",
    subtitle: "Current resident roster in scope",
    basePath: "/admin/residents",
  },
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
    render: (r) => formatW2ListFacilityName(r.facilityName),
    align: "left",
  },
  {
    id: "status",
    header: "Status",
    accessor: (r) => r.status,
    render: (r) => formatW2ListStatus(r.status),
    align: "left",
  },
  {
    id: "secondary",
    header: "Detail",
    accessor: (r) => r.secondary,
    render: (r) => formatW2ListDetail(r.secondary),
    align: "left",
  },
  {
    id: "occurredAt",
    header: "Occurred",
    accessor: (r) => r.occurredAt,
    render: (r) => formatW2ListOccurredAt(r.occurredAt),
    align: "right",
    numeric: true,
  },
];

export type W2ListClientProps = {
  listId: V2ListId;
  rows: V2ListRow[];
  source: V2LiveSource;
  generatedAt: string;
  pagination: V2PaginationMeta;
  /** Optional `now` override for deterministic relative-time rendering. */
  now?: Date;
};

export function W2ListClient({
  listId,
  rows,
  source,
  generatedAt,
  pagination,
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

  const sourceNote =
    source === "empty"
      ? "No live rows in scope"
      : source === "unavailable"
        ? "Live source unavailable; no fallback rows shown"
        : null;
  const isOutOfRange = isV2PaginationOutOfRange(pagination);
  const emptyStateCopy = isOutOfRange ? "No rows on this page." : (sourceNote ?? `No ${listId} in scope.`);

  return (
    <T2List<V2ListRow>
      title={meta.title}
      subtitle={sourceNote ? `${meta.subtitle} · ${sourceNote}` : meta.subtitle}
      filters={{
        dashboardId: meta.basePath,
        statuses: [
          { id: "open", label: "Open" },
          { id: "active", label: "Active" },
          { id: "resolved", label: "Resolved" },
        ],
      }}
      actions={<V2PaginationControls pagination={pagination} showCurrentPageExportNote />}
      topBarExtras={listId === "alerts" ? <FlagshipListLandingNav listId={listId} /> : undefined}
      table={{
        columns: COLUMNS,
        rows: tableRows,
        userPreferencesKey: meta.basePath,
        emptyState: <span>{emptyStateCopy}</span>,
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
