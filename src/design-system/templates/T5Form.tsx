"use client";

import { type AuditFooterProps } from "../components/AuditFooter";
import { PageShell } from "../components/PageShell";
import { cn } from "@/lib/utils";

export type T5Step = {
  id: string;
  label: string;
  state?: "complete" | "active" | "pending";
};

export type T5FormProps = {
  title: string;
  subtitle?: string;
  steps?: T5Step[];
  /** Form fields stack vertically; consumer renders a `<form>` if needed. */
  children: React.ReactNode;
  /** Right-rail audit log entries (chronological). */
  auditLog?: Array<{ id: string; label: string; occurredAt: string; actor?: string }>;
  /** Sticky save bar at the bottom of the form region. */
  saveBar: React.ReactNode;
  audit: AuditFooterProps;
};

export function T5Form({
  title,
  subtitle,
  steps,
  children,
  auditLog,
  saveBar,
  audit,
}: T5FormProps) {
  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      audit={audit}
      rightRail={
        auditLog && auditLog.length > 0 ? <FormAuditLog entries={auditLog} /> : undefined
      }
    >
      {steps && steps.length > 0 && (
        <ol
          aria-label="Wizard steps"
          className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2"
        >
          {steps.map((step, index) => (
            <li
              key={step.id}
              aria-current={step.state === "active" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 text-xs font-medium",
                step.state === "active"
                  ? "text-text-primary"
                  : step.state === "complete"
                    ? "text-success"
                    : "text-text-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs font-semibold",
                  step.state === "active"
                    ? "border-brand-primary text-brand-primary"
                    : step.state === "complete"
                      ? "border-success text-success"
                      : "border-border text-text-muted",
                )}
              >
                {index + 1}
              </span>
              {step.label}
              {index < steps.length - 1 && (
                <span aria-hidden="true" className="text-text-muted">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <section
        aria-label="Form body"
        className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4"
      >
        {children}
      </section>

      <div
        role="region"
        aria-label="Save bar"
        className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-end gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2"
      >
        {saveBar}
      </div>
    </PageShell>
  );
}

function FormAuditLog({
  entries,
}: {
  entries: NonNullable<T5FormProps["auditLog"]>;
}) {
  return (
    <section aria-label="Form audit log" className="rounded-md border border-border bg-surface">
      <header className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-caps text-text-muted">
        Audit log
      </header>
      <ol className="flex flex-col">
        {entries.map((entry) => (
          <li key={entry.id} className="border-b border-border px-4 py-2 last:border-b-0">
            <span className="block text-sm text-text-primary">{entry.label}</span>
            <span className="block text-xs text-text-muted">
              <time dateTime={entry.occurredAt}>{entry.occurredAt}</time>
              {entry.actor && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>{entry.actor}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
