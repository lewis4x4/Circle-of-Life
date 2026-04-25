"use client";

import {
  ActionQueue,
  type ActionQueueItem,
} from "../components/ActionQueue";
import { type AuditFooterProps } from "../components/AuditFooter";
import {
  DataTable,
  type DataTableProps,
} from "../components/DataTable";
import { FilterBar, type FilterBarProps } from "../components/FilterBar";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { KPITile, type KPITileProps } from "../components/KPITile";
import { PageShell } from "../components/PageShell";
import { Panel, type PanelProps } from "../components/Panel";
import {
  PriorityAlertStack,
  type AlertItem,
} from "../components/PriorityAlertStack";
import { ScopeSelector, type ScopeSelectorProps } from "../components/ScopeSelector";

export type KPIStripTuple = [
  KPITileProps,
  KPITileProps,
  KPITileProps,
  KPITileProps,
  KPITileProps,
  KPITileProps,
];

export type DashboardPanelTuple = [PanelProps, PanelProps, PanelProps, PanelProps];

export type T1DashboardProps<TableRow> = {
  title: string;
  subtitle?: string;
  scope: ScopeSelectorProps;
  filters?: FilterBarProps;
  actions?: React.ReactNode;
  kpis: KPIStripTuple;
  panels: DashboardPanelTuple;
  table: DataTableProps<TableRow>;
  alerts: AlertItem[];
  actionQueue: ActionQueueItem[];
  audit: AuditFooterProps;
};

export function T1Dashboard<TableRow>({
  title,
  subtitle,
  scope,
  filters,
  actions,
  kpis,
  panels,
  table,
  alerts,
  actionQueue,
  audit,
}: T1DashboardProps<TableRow>) {
  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      scope={<ScopeSelector {...scope} />}
      filters={filters ? <FilterBar {...filters} /> : undefined}
      actions={actions}
      audit={audit}
      rightRail={
        <>
          <Panel title="Priority alerts" subtitle={`${alerts.length} in scope`}>
            <PriorityAlertStack items={alerts} />
          </Panel>
          <Panel title="Action queue" subtitle={`${actionQueue.length} pending`}>
            <ActionQueue items={actionQueue} />
          </Panel>
        </>
      }
    >
      <section aria-label="KPI strip" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi, index) => (
          <KPITile key={kpi.label + index} {...kpi} />
        ))}
      </section>

      <section aria-label="Panel grid" className="mt-5">
        <KineticGrid className="grid-cols-1 gap-4 md:grid-cols-2">
          {panels.map((panel, index) => (
            <Panel key={panel.title + index} {...panel} />
          ))}
        </KineticGrid>
      </section>

      <section aria-label="Primary table" className="mt-5">
        <DataTable {...table} />
      </section>
    </PageShell>
  );
}
