"use client";

import { useState } from "react";

import { PriorityAlertStack, type AlertItem } from "./PriorityAlertStack";

const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

const HIGH: AlertItem = {
  id: "hi-1",
  severity: "high",
  title: "Fall with injury",
  facilityId: "oakridge",
  organizationId: "col",
  facilityName: "Oakridge ALF",
  body: "Resident fall in memory care hallway; suspected hip injury.",
  openedAt: new Date("2026-04-24T15:42:00-04:00").toISOString(),
  status: "new",
  detailsHref: "/admin/incidents/hi-1",
};

const MEDIUM: AlertItem = {
  id: "md-1",
  severity: "medium",
  title: "eMAR missed dose streak",
  facilityId: "homewood",
  organizationId: "col",
  facilityName: "Homewood Lodge",
  body: "3rd missed dose within 24h for Resident A.",
  openedAt: new Date("2026-04-24T14:11:00-04:00").toISOString(),
  status: "action",
  detailsHref: "/admin/medications/errors",
};

const LOW: AlertItem = {
  id: "lo-1",
  severity: "low",
  title: "Survey window opens in 30d",
  facilityId: "plantation",
  organizationId: "col",
  facilityName: "Plantation",
  body: "AHCA 59A-36 biennial survey window opens 2026-05-24.",
  openedAt: new Date("2026-04-23T08:00:00-04:00").toISOString(),
  status: "review",
  detailsHref: "/admin/compliance",
};

export function PriorityAlertStackPreview() {
  return (
    <div className="flex flex-col gap-4">
      <PreviewSection state="empty" title="Empty">
        <PriorityAlertStack items={[]} now={FIXED_NOW} />
      </PreviewSection>
      <PreviewSection state="oneHigh" title="One high-severity">
        <StubbedStack items={[HIGH]} />
      </PreviewSection>
      <PreviewSection state="highMediumLow" title="High / medium / low">
        <StubbedStack items={[HIGH, MEDIUM, LOW]} />
      </PreviewSection>
      <PreviewSection state="ackInFlight" title="ACK in flight (stubbed delay)">
        <StubbedStack items={[HIGH]} delayMs={800} />
      </PreviewSection>
      <PreviewSection state="ackError" title="ACK error (always fails)">
        <StubbedStack items={[HIGH]} fail />
      </PreviewSection>
    </div>
  );
}

function StubbedStack({
  items,
  delayMs = 150,
  fail = false,
}: {
  items: AlertItem[];
  delayMs?: number;
  fail?: boolean;
}) {
  const [log, setLog] = useState<string[]>([]);
  return (
    <div className="flex flex-col gap-2">
      <PriorityAlertStack
        items={items}
        now={FIXED_NOW}
        onAck={async (alert) => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          if (fail) throw new Error("simulated ACK failure");
          setLog((prev) => [...prev, `ack:${alert.id}@${new Date().toISOString()}`]);
        }}
      />
      {log.length > 0 && (
        <pre className="rounded-sm border border-border bg-surface-subtle p-2 text-xs text-text-muted">
          {log.join("\n")}
        </pre>
      )}
    </div>
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
      <div className="p-3">{children}</div>
    </section>
  );
}
