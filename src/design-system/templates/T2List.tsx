"use client";

import { type AuditFooterProps } from "../components/AuditFooter";
import {
  DataTable,
  type DataTableProps,
} from "../components/DataTable";
import { FilterBar, type FilterBarProps } from "../components/FilterBar";
import { PageShell } from "../components/PageShell";
import { ScopeSelector, type ScopeSelectorProps } from "../components/ScopeSelector";

export type T2ListProps<TableRow> = {
  title: string;
  subtitle?: string;
  scope?: ScopeSelectorProps;
  filters?: FilterBarProps;
  actions?: React.ReactNode;
  table: DataTableProps<TableRow>;
  /** Optional side-panel detail; renders to the right of the table on xl+. */
  sidePanel?: React.ReactNode;
  audit: AuditFooterProps;
};

export function T2List<TableRow>({
  title,
  subtitle,
  scope,
  filters,
  actions,
  table,
  sidePanel,
  audit,
}: T2ListProps<TableRow>) {
  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      scope={scope ? <ScopeSelector {...scope} /> : undefined}
      filters={filters ? <FilterBar {...filters} /> : undefined}
      actions={actions}
      audit={audit}
      rightRail={sidePanel}
    >
      <section aria-label="Queue table">
        <DataTable {...table} />
      </section>
    </PageShell>
  );
}
