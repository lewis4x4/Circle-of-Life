"use client";

import { type AuditFooterProps } from "../components/AuditFooter";
import {
  DataTable,
  type DataTableProps,
} from "../components/DataTable";
import { FilterBar, type FilterBarProps } from "../components/FilterBar";
import { KPITile, type KPITileProps } from "../components/KPITile";
import { PageShell } from "../components/PageShell";
import { ScopeSelector, type ScopeSelectorProps } from "../components/ScopeSelector";

export type T4AnalyticsProps<TableRow> = {
  title: string;
  subtitle?: string;
  scope?: ScopeSelectorProps;
  filters?: FilterBarProps;
  kpiStrip?: KPITileProps[];
  /** 1–2 chart slots (cards rendered as full-width on small viewports). */
  charts: [React.ReactNode] | [React.ReactNode, React.ReactNode];
  breakdownTable: DataTableProps<TableRow>;
  /** Right-aligned export toolbar slot rendered above the breakdown table. */
  exportToolbar?: React.ReactNode;
  audit: AuditFooterProps;
};

export function T4Analytics<TableRow>({
  title,
  subtitle,
  scope,
  filters,
  kpiStrip,
  charts,
  breakdownTable,
  exportToolbar,
  audit,
}: T4AnalyticsProps<TableRow>) {
  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      scope={scope ? <ScopeSelector {...scope} /> : undefined}
      filters={filters ? <FilterBar {...filters} /> : undefined}
      audit={audit}
    >
      {kpiStrip && kpiStrip.length > 0 && (
        <section
          aria-label="KPI strip"
          className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"
        >
          {kpiStrip.map((kpi, index) => (
            <KPITile key={kpi.label + index} {...kpi} />
          ))}
        </section>
      )}

      <section
        aria-label="Charts"
        className="mt-5 grid gap-4 lg:grid-cols-2"
      >
        {charts.map((chart, index) => (
          <div
            key={index}
            className="rounded-md border border-border bg-surface p-4"
          >
            {chart}
          </div>
        ))}
      </section>

      <section aria-label="Breakdown table" className="mt-5">
        {exportToolbar && (
          <div className="mb-2 flex justify-end">{exportToolbar}</div>
        )}
        <DataTable {...breakdownTable} />
      </section>
    </PageShell>
  );
}
