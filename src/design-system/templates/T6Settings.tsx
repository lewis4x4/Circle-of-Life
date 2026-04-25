"use client";

import { type AuditFooterProps } from "../components/AuditFooter";
import { PageShell } from "../components/PageShell";
import { cn } from "@/lib/utils";

export type T6SettingsSection = {
  id: string;
  label: string;
  description?: string;
  body: React.ReactNode;
};

export type T6SettingsProps = {
  title: string;
  subtitle?: string;
  /** Left sub-nav links. Caller controls which is active via aria-current/href. */
  subnav?: Array<{
    id: string;
    label: string;
    href: string;
    active?: boolean;
  }>;
  sections: T6SettingsSection[];
  /** "saving" → in-flight, "dirty" → unsaved changes, "clean" → saved, "error" → save failed */
  saveState?: "clean" | "dirty" | "saving" | "error";
  audit: AuditFooterProps;
};

const SAVE_STATE_COPY: Record<NonNullable<T6SettingsProps["saveState"]>, string> = {
  clean: "All changes saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed — retry",
};

const SAVE_STATE_TONE: Record<NonNullable<T6SettingsProps["saveState"]>, string> = {
  clean: "text-success",
  dirty: "text-warning",
  saving: "text-info",
  error: "text-danger",
};

export function T6Settings({
  title,
  subtitle,
  subnav,
  sections,
  saveState,
  audit,
}: T6SettingsProps) {
  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      audit={audit}
      actions={
        saveState ? (
          <span
            role="status"
            aria-live="polite"
            className={cn("text-xs font-semibold", SAVE_STATE_TONE[saveState])}
          >
            {SAVE_STATE_COPY[saveState]}
          </span>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 md:flex-row">
        {subnav && subnav.length > 0 && (
          <nav aria-label="Settings sub-nav" className="w-full shrink-0 rounded-md border border-border bg-surface p-2 md:w-52">
            <ul className="flex flex-col gap-1">
              {subnav.map((item) => (
                <li key={item.id}>
                  <a
                    href={item.href}
                    aria-current={item.active ? "page" : undefined}
                    className={cn(
                      "block rounded-sm px-3 py-2 text-sm",
                      item.active
                        ? "bg-surface-elevated text-text-primary"
                        : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {sections.map((section) => (
            <section
              key={section.id}
              aria-label={section.label}
              className="rounded-md border border-border bg-surface"
            >
              <header className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-text-primary">{section.label}</h2>
                {section.description && (
                  <p className="text-xs text-text-secondary">{section.description}</p>
                )}
              </header>
              <div className="px-4 py-3">{section.body}</div>
            </section>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
