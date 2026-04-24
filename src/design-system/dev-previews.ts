import type { ComponentType } from "react";

import { AuditFooterPreview } from "./components/AuditFooter/AuditFooter.preview";
import { FilterBarPreview } from "./components/FilterBar/FilterBar.preview";
import { PageShellPreview } from "./components/PageShell/PageShell.preview";
import { ScopeSelectorPreview } from "./components/ScopeSelector/ScopeSelector.preview";
import { TopBarPreview } from "./components/TopBar/TopBar.preview";

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
  "audit-footer": {
    code: "P13",
    name: "AuditFooter",
    description:
      "Audit Trail link + Live indicator + Updated N ago + facility timezone label.",
    Preview: AuditFooterPreview,
  },
};

export type UiV2PreviewSlug = keyof typeof UI_V2_PREVIEW_REGISTRY;
