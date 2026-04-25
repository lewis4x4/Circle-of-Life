"use client";

import { useState } from "react";

import { type AuditFooterProps } from "../components/AuditFooter";
import { PageShell } from "../components/PageShell";
import { cn } from "@/lib/utils";

export type T3Tab = {
  id: string;
  label: string;
  content: React.ReactNode;
  count?: number;
};

export type T3TimelineItem = {
  id: string;
  title: string;
  body?: string;
  occurredAt: string;
  tone?: "default" | "info" | "warning" | "danger" | "success" | "regulatory";
};

export type T3EntityDetailProps = {
  title: string;
  subtitle?: string;
  /** Identifying fields for the entity header (resident MRN, facility id, etc.). */
  identifiers?: Array<{ label: string; value: React.ReactNode }>;
  status?: { label: string; tone: "default" | "success" | "warning" | "danger" | "info" | "regulatory" };
  actions?: React.ReactNode;
  tabs: T3Tab[];
  initialTabId?: string;
  timeline?: T3TimelineItem[];
  audit: AuditFooterProps;
};

const STATUS_TONE: Record<NonNullable<T3EntityDetailProps["status"]>["tone"], string> = {
  default: "border-border text-text-primary",
  success: "border-success text-success",
  warning: "border-warning text-warning",
  danger: "border-danger text-danger",
  info: "border-info text-info",
  regulatory: "border-regulatory text-regulatory",
};

const TONE_DOT: Record<NonNullable<T3TimelineItem["tone"]>, string> = {
  default: "bg-neutral",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-danger",
  success: "bg-success",
  regulatory: "bg-regulatory",
};

export function T3EntityDetail({
  title,
  subtitle,
  identifiers,
  status,
  actions,
  tabs,
  initialTabId,
  timeline,
  audit,
}: T3EntityDetailProps) {
  const firstTabId = initialTabId ?? tabs[0]?.id ?? "";
  const [activeId, setActiveId] = useState<string>(firstTabId);
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      actions={actions}
      audit={audit}
      rightRail={timeline ? <Timeline items={timeline} /> : undefined}
    >
      {(identifiers?.length || status) && (
        <section
          aria-label="Entity header"
          className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-3"
        >
          {status && (
            <span
              className={cn(
                "inline-flex h-7 items-center rounded-sm border px-2 text-xs font-semibold",
                STATUS_TONE[status.tone],
              )}
            >
              {status.label}
            </span>
          )}
          {identifiers?.map((field) => (
            <div key={field.label} className="flex flex-col">
              <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
                {field.label}
              </span>
              <span className="text-sm text-text-primary">{field.value}</span>
            </div>
          ))}
        </section>
      )}

      <div role="tablist" aria-label="Entity tabs" className="mt-4 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((tab) => {
          const isActive = activeTab?.id === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`t3-tab-panel-${tab.id}`}
              id={`t3-tab-${tab.id}`}
              onClick={() => setActiveId(tab.id)}
              className={cn(
                "inline-flex h-9 items-center gap-2 px-3 text-sm font-medium",
                isActive
                  ? "border-b-2 border-brand-primary text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {tab.label}
              {typeof tab.count === "number" && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-elevated px-1 text-xs font-semibold tabular-nums text-text-muted">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <section
        role="tabpanel"
        id={`t3-tab-panel-${activeTab?.id ?? ""}`}
        aria-labelledby={`t3-tab-${activeTab?.id ?? ""}`}
        className="mt-4"
      >
        {activeTab?.content}
      </section>
    </PageShell>
  );
}

function Timeline({ items }: { items: T3TimelineItem[] }) {
  return (
    <section aria-label="Activity timeline" className="rounded-md border border-border bg-surface">
      <header className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-caps text-text-muted">
        Activity timeline
      </header>
      <ol className="flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 border-b border-border px-4 py-2 last:border-b-0">
            <span
              aria-hidden="true"
              className={cn("mt-1 h-2 w-2 rounded-full", TONE_DOT[item.tone ?? "default"])}
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-text-primary">{item.title}</span>
              {item.body && <span className="text-xs text-text-secondary">{item.body}</span>}
              <time dateTime={item.occurredAt} className="text-xs text-text-muted">
                {item.occurredAt}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
