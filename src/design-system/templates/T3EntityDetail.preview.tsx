"use client";

import { T3EntityDetail } from "./T3EntityDetail";

const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

export function T3EntityDetailPreview() {
  return (
    <T3EntityDetail
      title="Resident · A. Smith"
      subtitle="Oakridge ALF · Specialty Unit · Wing B"
      identifiers={[
        { label: "MRN", value: "OAK-0142" },
        { label: "Admit date", value: "2024-09-01" },
        { label: "Primary physician", value: "Dr. Patel" },
        { label: "Care level", value: "Tier 3" },
      ]}
      status={{ label: "Active", tone: "success" }}
      tabs={[
        {
          id: "summary",
          label: "Summary",
          content: (
            <div className="rounded-md border border-border bg-surface p-4 text-sm text-text-secondary">
              Summary placeholder content.
            </div>
          ),
        },
        {
          id: "care-plan",
          label: "Care plan",
          count: 3,
          content: (
            <div className="rounded-md border border-border bg-surface p-4 text-sm text-text-secondary">
              3 active goals, last updated 2026-04-23.
            </div>
          ),
        },
        {
          id: "incidents",
          label: "Incidents",
          count: 1,
          content: (
            <div className="rounded-md border border-border bg-surface p-4 text-sm text-text-secondary">
              1 open incident — fall (no injury), 2026-04-21.
            </div>
          ),
        },
      ]}
      timeline={[
        { id: "t1", title: "Care plan signed", occurredAt: "2026-04-23T10:00:00-04:00", tone: "info" },
        { id: "t2", title: "Fall reported", occurredAt: "2026-04-21T03:14:00-04:00", tone: "warning" },
        { id: "t3", title: "Admitted", occurredAt: "2024-09-01T09:00:00-04:00", tone: "success" },
      ]}
      audit={{
        auditHref: "/admin/audit-log",
        updatedAt: "2026-04-24T15:57:00-04:00",
        now: FIXED_NOW,
      }}
    />
  );
}
