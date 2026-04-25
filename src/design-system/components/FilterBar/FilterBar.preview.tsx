"use client";

import { useState } from "react";

import type { Scope } from "@/lib/scope";
import { FilterBar, type FilterBarOption } from "./FilterBar";

const facilities: FilterBarOption[] = [
  { id: "oakridge", label: "Oakridge ALF" },
  { id: "homewood", label: "Homewood Lodge" },
  { id: "plantation", label: "Plantation" },
  { id: "rising-oaks", label: "Rising Oaks" },
];

const regions: FilterBarOption[] = [
  { id: "fl-central", label: "FL Central" },
  { id: "fl-north", label: "FL North" },
];

const statuses: FilterBarOption[] = [
  { id: "open", label: "Open" },
  { id: "ack", label: "Acknowledged" },
  { id: "resolved", label: "Resolved" },
];

export function FilterBarPreview() {
  return (
    <div className="flex flex-col gap-6">
      <PreviewSection state="default" title="Default — no filters">
        <ControlledFilterBar initial={{}} />
      </PreviewSection>

      <PreviewSection state="withSavedView" title="With saved view">
        <ControlledFilterBar
          initial={{}}
          savedViews={[
            { id: "morning", name: "Morning triage" },
            { id: "regulatory", name: "Regulatory watch" },
          ]}
        />
      </PreviewSection>

      <PreviewSection state="filtersActive" title="Filters active">
        <ControlledFilterBar
          initial={{
            dateRange: { start: "2026-04-01", end: "2026-04-24" },
            facilityIds: ["oakridge", "homewood"],
          }}
          initialStatuses={["open"]}
          initialRegion="fl-central"
        />
      </PreviewSection>
    </div>
  );
}

function ControlledFilterBar({
  initial,
  savedViews,
  initialStatuses = [],
  initialRegion,
}: {
  initial: Scope;
  savedViews?: Array<{ id: string; name: string }>;
  initialStatuses?: string[];
  initialRegion?: string;
}) {
  const [scope, setScope] = useState<Scope>(initial);
  const [statusIds, setStatusIds] = useState<string[]>(initialStatuses);
  const [regionId, setRegionId] = useState<string | undefined>(initialRegion);

  return (
    <FilterBar
      dashboardId="/admin/__preview__"
      facilities={facilities}
      regions={regions}
      statuses={statuses}
      savedViews={savedViews}
      scopeOverride={scope}
      onScopeChange={(partial) => setScope((prev) => ({ ...prev, ...partial }))}
      selectedStatusIds={statusIds}
      onStatusChange={setStatusIds}
      selectedRegionId={regionId}
      onRegionChange={setRegionId}
    />
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
      className="rounded-md border border-border bg-surface"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
          {state}
        </span>
        <span className="text-xs text-text-secondary">{title}</span>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
