"use client";

import { T7DocumentViewer } from "./T7DocumentViewer";

const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

export function T7DocumentViewerPreview() {
  return (
    <T7DocumentViewer
      title="Form 1823 — A. Smith"
      subtitle="AHCA physician's report"
      toolbar={
        <>
          <ToolbarButton>Highlight</ToolbarButton>
          <ToolbarButton>Comment</ToolbarButton>
          <ToolbarButton>Download</ToolbarButton>
        </>
      }
      document={
        <div className="aspect-[8.5/11] w-full max-w-3xl rounded-sm border border-border-strong bg-surface-elevated p-6 text-sm text-text-secondary">
          Document body placeholder. PDF / image / rendered HTML embeds here in real
          consumers.
        </div>
      }
      metadata={[
        { label: "Document type", value: "Form 1823" },
        { label: "Resident", value: "A. Smith" },
        { label: "Uploaded", value: "2026-04-23" },
        { label: "Signer", value: "Dr. Patel" },
        { label: "Version", value: "v3" },
      ]}
      activity={[
        { id: "a1", label: "Signed by physician", occurredAt: "2026-04-23T14:00:00-04:00", actor: "Dr. Patel" },
        { id: "a2", label: "Uploaded by admin", occurredAt: "2026-04-23T13:42:00-04:00", actor: "B. Lewis" },
      ]}
      audit={{
        auditHref: "/admin/audit-log",
        updatedAt: "2026-04-24T15:57:00-04:00",
        now: FIXED_NOW,
      }}
    />
  );
}

function ToolbarButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex h-7 items-center rounded-sm border border-border bg-surface-elevated px-3 text-xs font-medium text-text-secondary hover:border-border-strong hover:text-text-primary"
    >
      {children}
    </button>
  );
}
