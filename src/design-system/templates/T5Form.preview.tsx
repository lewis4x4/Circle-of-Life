"use client";

import { T5Form } from "./T5Form";

const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

export function T5FormPreview() {
  return (
    <T5Form
      title="Admit new resident"
      subtitle="Oakridge ALF"
      steps={[
        { id: "id", label: "Identity", state: "complete" },
        { id: "care", label: "Care plan", state: "active" },
        { id: "billing", label: "Billing", state: "pending" },
        { id: "review", label: "Review", state: "pending" },
      ]}
      auditLog={[
        { id: "a1", label: "Draft created", occurredAt: "2026-04-24T11:00:00-04:00", actor: "B. Lewis" },
        { id: "a2", label: "Auto-saved", occurredAt: "2026-04-24T11:14:00-04:00" },
      ]}
      saveBar={
        <>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-sm border border-border bg-surface px-3 text-xs font-medium text-text-secondary hover:border-border-strong"
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-sm border border-brand-primary bg-surface-elevated px-3 text-xs font-semibold text-text-primary hover:bg-surface"
          >
            Save and continue
          </button>
        </>
      }
      audit={{
        auditHref: "/admin/audit-log",
        updatedAt: "2026-04-24T15:57:00-04:00",
        now: FIXED_NOW,
      }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FieldStub label="First name" value="Aria" />
        <FieldStub label="Last name" value="Smith" />
        <FieldStub label="DOB" value="1948-03-12" />
        <FieldStub label="MRN" value="OAK-0142" />
      </div>
    </T5Form>
  );
}

function FieldStub({ label, value }: { label: string; value: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      <span className="font-semibold uppercase tracking-caps">{label}</span>
      <input
        readOnly
        value={value}
        className="h-8 rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
      />
    </label>
  );
}
