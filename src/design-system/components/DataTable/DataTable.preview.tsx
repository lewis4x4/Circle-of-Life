"use client";

import { useState } from "react";

import { DataTable } from "./DataTable";
import type { DataTableColumn, DataTableRow } from "./columns";
import facilitiesFixture from "./__fixtures__/facilities.json";
import thresholdsFixture from "./__fixtures__/thresholds.json";
import type { ThresholdMap } from "./thresholds";

type FacilityFixture = (typeof facilitiesFixture)[number];

const COLUMNS: DataTableColumn<FacilityFixture>[] = [
  {
    id: "name",
    header: "Facility",
    accessor: (row) => row.name,
    align: "left",
    sticky: true,
  },
  {
    id: "occupancyPct",
    header: "Occupancy %",
    accessor: (row) => row.occupancyPct,
    align: "right",
    numeric: true,
    metricKey: "occupancy_pct",
  },
  {
    id: "laborCostPct",
    header: "Labor cost %",
    accessor: (row) => row.laborCostPct,
    align: "right",
    numeric: true,
    metricKey: "labor_cost_pct",
  },
  {
    id: "openIncidents",
    header: "Open incidents",
    accessor: (row) => row.openIncidents,
    align: "right",
    numeric: true,
    metricKey: "open_incidents",
  },
  {
    id: "surveyReadinessPct",
    header: "Survey readiness %",
    accessor: (row) => row.surveyReadinessPct,
    align: "right",
    numeric: true,
    metricKey: "survey_readiness_pct",
  },
];

const THRESHOLDS = thresholdsFixture as ThresholdMap;

function asRows(
  list: FacilityFixture[],
  statusOf?: (row: FacilityFixture) => DataTableRow<FacilityFixture>["status"],
  tooltipOf?: (row: FacilityFixture) => string | undefined,
): DataTableRow<FacilityFixture>[] {
  return list.map((row) => ({
    id: row.id,
    data: row,
    status: statusOf?.(row),
    statusTooltip: tooltipOf?.(row),
  }));
}

function generateLargeDataset(): FacilityFixture[] {
  const rows: FacilityFixture[] = [];
  for (let i = 0; i < 1200; i += 1) {
    const seed = (i * 31) % 100;
    rows.push({
      id: `gen-${i}`,
      name: `Synthetic Facility ${i + 1}`,
      occupancyPct: 60 + (seed % 40),
      laborCostPct: 25 + (seed % 25),
      openIncidents: seed % 7,
      surveyReadinessPct: 50 + (seed % 50),
    });
  }
  return rows;
}

export function DataTablePreview() {
  const [largeRows] = useState<FacilityFixture[]>(() => generateLargeDataset());
  const allOk = facilitiesFixture.slice(0, 3).map((f) => ({
    ...f,
    occupancyPct: 95,
    laborCostPct: 30,
    openIncidents: 0,
    surveyReadinessPct: 92,
  }));

  return (
    <div className="flex flex-col gap-4">
      <PreviewSection state="loading" title="Loading skeleton">
        <DataTable<FacilityFixture>
          columns={COLUMNS}
          rows={[]}
          userPreferencesKey="preview/datatable-loading"
          disablePreferences
          loading
        />
      </PreviewSection>

      <PreviewSection state="empty" title="Empty">
        <DataTable<FacilityFixture>
          columns={COLUMNS}
          rows={[]}
          userPreferencesKey="preview/datatable-empty"
          disablePreferences
          emptyState="No facilities in scope."
        />
      </PreviewSection>

      <PreviewSection state="fiveRowsAllOk" title="Five rows · all ok">
        <DataTable<FacilityFixture>
          columns={COLUMNS}
          rows={asRows(allOk, () => "ok")}
          thresholds={THRESHOLDS}
          userPreferencesKey="preview/datatable-allok"
          disablePreferences
        />
      </PreviewSection>

      <PreviewSection state="mixedSeverity" title="Mixed severity (thresholds drive color)">
        <DataTable<FacilityFixture>
          columns={COLUMNS}
          rows={asRows(
            facilitiesFixture,
            (row) =>
              row.openIncidents > 3
                ? "critical"
                : row.openIncidents > 1
                  ? "warning"
                  : "ok",
            (row) => (row.openIncidents > 1 ? `${row.openIncidents} open incidents` : undefined),
          )}
          thresholds={THRESHOLDS}
          userPreferencesKey="preview/datatable-mixed"
          disablePreferences
          onRowOpenPanel={(id) => console.info("open panel", id)}
          onRowOpenNewTab={(id) => console.info("open new tab", id)}
        />
      </PreviewSection>

      <PreviewSection state="filtered" title="Filtered (only critical)">
        <DataTable<FacilityFixture>
          columns={COLUMNS}
          rows={asRows(
            facilitiesFixture.filter((row) => row.openIncidents > 3),
            () => "critical",
            (row) => `${row.openIncidents} open incidents`,
          )}
          thresholds={THRESHOLDS}
          userPreferencesKey="preview/datatable-filtered"
          disablePreferences
        />
      </PreviewSection>

      <PreviewSection state="columnsCustomized" title="Columns customized (occupancy hidden by default)">
        <DataTable<FacilityFixture>
          columns={COLUMNS.map((c) =>
            c.id === "occupancyPct" ? { ...c } : c,
          )}
          rows={asRows(facilitiesFixture)}
          thresholds={THRESHOLDS}
          userPreferencesKey="preview/datatable-customized"
          disablePreferences
        />
      </PreviewSection>

      <PreviewSection state="largeDataset" title="Large dataset · 1,200 rows · virtualized">
        <DataTable<FacilityFixture>
          columns={COLUMNS}
          rows={asRows(largeRows)}
          thresholds={THRESHOLDS}
          userPreferencesKey="preview/datatable-large"
          disablePreferences
          virtualizeThreshold={100}
        />
      </PreviewSection>
    </div>
  );
}

function PreviewSection({
  title,
  state,
  children,
}: {
  title: string;
  state: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-state={state}
      className="rounded-md border border-border bg-surface-subtle"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
          {state}
        </span>
        <span className="text-xs text-text-secondary">{title}</span>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}
