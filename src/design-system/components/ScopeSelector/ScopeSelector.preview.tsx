"use client";

import { useState } from "react";

import type { Scope } from "@/lib/scope";
import { ScopeSelector, type FacilityOption, type GroupOption, type ScopeOption } from "./ScopeSelector";

const owners: ScopeOption[] = [
  { id: "col", label: "Circle of Life Holdings" },
  { id: "partner-ops", label: "Partner Ops" },
];

const groups: GroupOption[] = [
  { id: "fl-central", label: "FL Central", ownerId: "col" },
  { id: "fl-north", label: "FL North", ownerId: "col" },
  { id: "partner-group-1", label: "Partner Group One", ownerId: "partner-ops" },
];

const facilities: FacilityOption[] = [
  { id: "oakridge", label: "Oakridge ALF", ownerId: "col", groupId: "fl-central" },
  { id: "homewood", label: "Homewood Lodge", ownerId: "col", groupId: "fl-central" },
  { id: "plantation", label: "Plantation", ownerId: "col", groupId: "fl-central" },
  { id: "rising-oaks", label: "Rising Oaks", ownerId: "col", groupId: "fl-north" },
  { id: "grande-cypress", label: "Grande Cypress", ownerId: "col", groupId: "fl-north" },
];

export function ScopeSelectorPreview() {
  return (
    <div className="flex flex-col gap-6">
      <PreviewSection state="empty" title="Empty — nothing selected">
        <ControlledScope initial={{}} />
      </PreviewSection>
      <PreviewSection state="ownerOnly" title="Owner only">
        <ControlledScope initial={{ ownerId: "col" }} />
      </PreviewSection>
      <PreviewSection
        state="ownerGroupFacility"
        title="Owner → Group → single facility"
      >
        <ControlledScope
          initial={{ ownerId: "col", groupId: "fl-central", facilityIds: ["oakridge"] }}
        />
      </PreviewSection>
      <PreviewSection state="multiFacility" title="Multi-facility selection">
        <ControlledScope
          initial={{ ownerId: "col", facilityIds: ["oakridge", "homewood", "rising-oaks"] }}
        />
      </PreviewSection>
    </div>
  );
}

function ControlledScope({ initial }: { initial: Scope }) {
  const [scope, setScope] = useState<Scope>(initial);
  return (
    <ScopeSelector
      owners={owners}
      groups={groups}
      facilities={facilities}
      scopeOverride={scope}
      onChange={(partial) => setScope((prev) => ({ ...prev, ...partial }))}
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
