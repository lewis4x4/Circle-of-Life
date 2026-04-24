"use client";

import { useId, useState } from "react";

import { V2Card } from "@/components/ui/moonshot/v2-card";
import { cn } from "@/lib/utils";

export type PanelProps = {
  title: string;
  subtitle?: string;
  info?: string;
  actionCta?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  loading?: boolean;
  error?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

export function Panel({
  title,
  subtitle,
  info,
  actionCta,
  loading,
  error,
  children,
  className,
}: PanelProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = useId();

  return (
    <V2Card className={cn("p-0", className)}>
      <section
        aria-label={title}
        data-loading={loading ? "true" : undefined}
        data-error={error ? "true" : undefined}
        className="flex h-full flex-col"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-text-primary">
                {title}
              </h2>
              {info && (
                <span className="relative">
                  <button
                    type="button"
                    aria-label={`Info for ${title}`}
                    aria-expanded={infoOpen}
                    aria-describedby={infoOpen ? infoId : undefined}
                    onClick={() => setInfoOpen((prev) => !prev)}
                    onBlur={() => setInfoOpen(false)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-elevated text-xs font-semibold text-text-secondary hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  >
                    i
                  </button>
                  {infoOpen && (
                    <span
                      role="tooltip"
                      id={infoId}
                      className="absolute left-6 top-0 z-10 w-56 rounded-md border border-border bg-surface-elevated p-2 text-xs text-text-secondary shadow-panel"
                    >
                      {info}
                    </span>
                  )}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-xs text-text-secondary">{subtitle}</p>
            )}
          </div>
        </header>

        <div className="flex-1 px-4 py-3">
          {loading ? (
            <PanelLoading />
          ) : error ? (
            <PanelError>{error}</PanelError>
          ) : (
            children
          )}
        </div>

        {actionCta && (
          <footer className="flex justify-end border-t border-border px-4 py-2">
            {actionCta.href ? (
              <a
                href={actionCta.href}
                className="text-xs font-semibold text-brand-primary hover:text-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded-sm"
              >
                {actionCta.label} →
              </a>
            ) : (
              <button
                type="button"
                onClick={actionCta.onClick}
                className="text-xs font-semibold text-brand-primary hover:text-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded-sm"
              >
                {actionCta.label} →
              </button>
            )}
          </footer>
        )}
      </section>
    </V2Card>
  );
}

function PanelLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="h-3 w-2/3 animate-pulse rounded-sm bg-surface-elevated" />
      <span className="h-3 w-1/2 animate-pulse rounded-sm bg-surface-elevated" />
      <span className="h-3 w-3/5 animate-pulse rounded-sm bg-surface-elevated" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function PanelError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-sm border border-danger bg-surface-subtle px-3 py-2 text-xs text-danger"
    >
      {children}
    </p>
  );
}
