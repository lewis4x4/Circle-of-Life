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
import { T1DashboardPreview } from "./templates/T1Dashboard.preview";
import { T2ListPreview } from "./templates/T2List.preview";
import { T3EntityDetailPreview } from "./templates/T3EntityDetail.preview";
import { T4AnalyticsPreview } from "./templates/T4Analytics.preview";
import { T5FormPreview } from "./templates/T5Form.preview";
import { T6SettingsPreview } from "./templates/T6Settings.preview";
import { T7DocumentViewerPreview } from "./templates/T7DocumentViewer.preview";
import { T8InboxThreadedPreview } from "./templates/T8InboxThreaded.preview";

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
  "t1-dashboard": {
    code: "T1",
    name: "T1Dashboard",
    description:
      "Dashboard template: scope + filters + 6 KPI tiles + 2×2 panel grid + DataTable + right-rail (alerts + actions).",
    Preview: T1DashboardPreview,
  },
  "t2-list": {
    code: "T2",
    name: "T2List",
    description: "List/Queue template: filter bar + DataTable + optional side-panel detail.",
    Preview: T2ListPreview,
  },
  "t3-entity-detail": {
    code: "T3",
    name: "T3EntityDetail",
    description: "Entity Detail template: identifier header + tabs + right-rail timeline.",
    Preview: T3EntityDetailPreview,
  },
  "t4-analytics": {
    code: "T4",
    name: "T4Analytics",
    description: "Analytics template: KPI strip + 1–2 charts + breakdown DataTable + export toolbar.",
    Preview: T4AnalyticsPreview,
  },
  "t5-form": {
    code: "T5",
    name: "T5Form",
    description: "Form/Wizard template: step indicator + form body + sticky save bar + right-rail audit log.",
    Preview: T5FormPreview,
  },
  "t6-settings": {
    code: "T6",
    name: "T6Settings",
    description: "Settings template: left sub-nav + stacked sections + save-state indicator.",
    Preview: T6SettingsPreview,
  },
  "t7-document-viewer": {
    code: "T7",
    name: "T7DocumentViewer",
    description: "Document viewer: annotation toolbar + document pane + metadata + activity rail.",
    Preview: T7DocumentViewerPreview,
  },
  "t8-inbox": {
    code: "T8",
    name: "T8InboxThreaded",
    description: "Inbox/Threaded: queue list + thread detail + context rail.",
    Preview: T8InboxThreadedPreview,
  },
};

export type UiV2PreviewSlug = keyof typeof UI_V2_PREVIEW_REGISTRY;
