import type { ComponentType } from "react";

import { ActionQueuePreview } from "./components/ActionQueue/ActionQueue.preview";
import { AuditFooterPreview } from "./components/AuditFooter/AuditFooter.preview";
import { CopilotButtonPreview } from "./components/CopilotButton/CopilotButton.preview";
import { DataTablePreview } from "./components/DataTable/DataTable.preview";
import { FilterBarPreview } from "./components/FilterBar/FilterBar.preview";
import { HealthDotPreview } from "./components/HealthDot/HealthDot.preview";
import { KPITilePreview } from "./components/KPITile/KPITile.preview";
import { PageShellPreview } from "./components/PageShell/PageShell.preview";
import { PanelPreview } from "./components/Panel/Panel.preview";
import { PriorityAlertStackPreview } from "./components/PriorityAlertStack/PriorityAlertStack.preview";
import { ScopeSelectorPreview } from "./components/ScopeSelector/ScopeSelector.preview";
import { SeverityChipPreview } from "./components/SeverityChip/SeverityChip.preview";
import { SparklinePreview } from "./components/Sparkline/Sparkline.preview";
import { TopBarPreview } from "./components/TopBar/TopBar.preview";
import { TrendDeltaPreview } from "./components/TrendDelta/TrendDelta.preview";

export type DevPreviewEntry = {
  code: string;
  name: string;
  description: string;
  Preview: ComponentType;
};

export const UI_V2_PREVIEW_REGISTRY: Record<string, DevPreviewEntry> = {
  "page-shell": {
    code: "P01",
    name: "PageShell",
    description:
      "Page wrapper composing TopBar + scope + filters + main + optional right rail + AuditFooter.",
    Preview: PageShellPreview,
  },
  "top-bar": {
    code: "P02",
    name: "TopBar",
    description:
      "Page title/subtitle, scope slot, actions, Copilot button stub, notifications, user menu.",
    Preview: TopBarPreview,
  },
  "scope-selector": {
    code: "P03",
    name: "ScopeSelector",
    description:
      "Owner → Group → Facility three-tier selector, URL-backed via useScope().",
    Preview: ScopeSelectorPreview,
  },
  "filter-bar": {
    code: "P04",
    name: "FilterBar",
    description:
      "Date range, facilities, regions, statuses. Reset + Save View (stubbed until S6).",
    Preview: FilterBarPreview,
  },
  "kpi-tile": {
    code: "P05",
    name: "KPITile",
    description:
      "Metric card: label, value, unit, tone, trend delta, sparkline, info tooltip, breach message.",
    Preview: KPITilePreview,
  },
  "trend-delta": {
    code: "P06",
    name: "TrendDelta",
    description:
      "Directional arrow + value + unit + period; tone resolves against goodDirection.",
    Preview: TrendDeltaPreview,
  },
  "severity-chip": {
    code: "P11",
    name: "SeverityChip",
    description:
      "Low/Medium/High chip with optional trend (from X N ago).",
    Preview: SeverityChipPreview,
  },
  "health-dot": {
    code: "P12",
    name: "HealthDot",
    description:
      "Colored dot + proportional bar + numeric score; bands ≥80 success / ≥65 warning / <65 danger.",
    Preview: HealthDotPreview,
  },
  "sparkline": {
    code: "P05i",
    name: "Sparkline",
    description:
      "Thin Recharts area chart used inside KPITile; semantic tone mapping.",
    Preview: SparklinePreview,
  },
  "panel": {
    code: "P07",
    name: "Panel",
    description:
      "Mid-section card with title + info + action CTA; wraps Haven V2Card with loading/error states.",
    Preview: PanelPreview,
  },
  "priority-alert-stack": {
    code: "P08",
    name: "PriorityAlertStack",
    description:
      "Right-rail alert queue with ACK/Details; optimistic UI posts to /api/v2/alerts/[id]/ack with rollback.",
    Preview: PriorityAlertStackPreview,
  },
  "action-queue": {
    code: "P09",
    name: "ActionQueue",
    description:
      "Counted action list: icon + label + sublabel + count badge (danger when >0) + chevron.",
    Preview: ActionQueuePreview,
  },
  "copilot-button": {
    code: "P14",
    name: "CopilotButton",
    description:
      "AI entry point; opens CopilotDrawer. Uncited suggestions are filtered (cite-backed contract).",
    Preview: CopilotButtonPreview,
  },
  "data-table": {
    code: "P10",
    name: "DataTable",
    description:
      "Dense table: row status, threshold-colored numerics, virtualized large datasets, Customize + Export, per-user column persistence.",
    Preview: DataTablePreview,
  },
  "audit-footer": {
    code: "P13",
    name: "AuditFooter",
    description:
      "Audit Trail link + Live indicator + Updated N ago + facility timezone label.",
    Preview: AuditFooterPreview,
  },
};

export type UiV2PreviewSlug = keyof typeof UI_V2_PREVIEW_REGISTRY;
