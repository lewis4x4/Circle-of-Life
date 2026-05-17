import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * RecordDetailHeader
 *
 * Page-level header for a Record Detail surface (surface-map.md: Attio 50% ·
 * Mercury 25% · Stripe 15% · Linear 10%). Emphasis is DATA — reading and
 * editing focus, minimal chrome.
 *
 * Accessibility:
 *   - The entity name (`title`) is rendered as an <h1>. Every detail page
 *     contains exactly one <h1> (this component). Do not add a second <h1>
 *     on the same page.
 *   - `backLink` renders a plain <a href> (not next/link) so the primitive
 *     stays framework-agnostic. The consumer may wrap children in Link if
 *     client-side navigation is required; the rendered <a> is functional
 *     either way and remains keyboard-reachable as a standard anchor.
 *   - `statusChips` consumers should supply appropriate aria-label or role
 *     attributes on their chip elements (e.g. role="status" or role="img").
 *   - `actions` consumers should ensure each interactive element is
 *     keyboard-reachable (focusable, visible focus ring).
 *
 * Constraints:
 *   - 100% semantic Tailwind tokens — zero hardcoded colors.
 *   - No "use client" directive; purely presentational.
 *   - No next/link or any Next.js import (framework-agnostic primitive).
 */
export interface RecordDetailHeaderProps {
  /** Primary entity name. Rendered as <h1>. Must not be empty. */
  title: string;
  /**
   * Optional secondary identifier line.
   * e.g. "Room 207 · MRN 048213" or "Reported 2026-04-15 14:32".
   * Uses tabular figures — safe for numeric identifiers.
   */
  subtitle?: string;
  /**
   * Optional status chip(s) rendered inline with the title.
   * Consumers supply <Badge> or similar with appropriate aria role/label.
   */
  statusChips?: ReactNode;
  /**
   * Optional primary action group, right-aligned on desktop.
   * e.g. Edit, Save, Print buttons.
   */
  actions?: ReactNode;
  /**
   * Optional back-navigation link. Renders "← {label}" above the title row.
   * Rendered as a plain <a href>. Stays server-safe and framework-agnostic.
   */
  backLink?: { label: string; href: string };
  /** Optional className extension for the outer container. */
  className?: string;
}

/**
 * RecordDetailHeader — Record Detail surface header primitive.
 *
 * @example
 * <RecordDetailHeader
 *   title="Mary Johnson"
 *   subtitle="Room 207 · MRN 048213"
 *   statusChips={<Badge>Active</Badge>}
 *   backLink={{ label: "All residents", href: "/admin/residents" }}
 *   actions={<Button>Edit profile</Button>}
 * />
 */
export function RecordDetailHeader({
  title,
  subtitle,
  statusChips,
  actions,
  backLink,
  className,
}: RecordDetailHeaderProps) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 border-b border-border pb-4",
        className,
      )}
    >
      {backLink && (
        <a
          href={backLink.href}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors duration-[var(--motion-duration-micro)] hover:text-foreground"
        >
          {/* Arrow is decorative — aria-hidden prevents duplicate reading */}
          <span aria-hidden="true">←</span>
          {backLink.label}
        </a>
      )}

      {/* Title row: [heading + chips] and [actions] */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {title}
            </h1>
            {statusChips && (
              <div className="flex flex-wrap items-center gap-2">
                {statusChips}
              </div>
            )}
          </div>
          {subtitle && (
            <p className="text-sm tabular-nums text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
