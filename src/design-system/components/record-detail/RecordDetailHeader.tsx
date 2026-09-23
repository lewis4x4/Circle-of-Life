import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { BackLink } from "../BackLink";

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
 *   - `backLink` renders the shared design-system BackLink (COL-656), a
 *     keyboard-reachable anchor with client-side navigation.
 *   - `statusChips` consumers should supply appropriate aria-label or role
 *     attributes on their chip elements (e.g. role="status" or role="img").
 *   - `actions` consumers should ensure each interactive element is
 *     keyboard-reachable (focusable, visible focus ring).
 *
 * Constraints:
 *   - 100% semantic Tailwind tokens — zero hardcoded colors.
 *   - No "use client" directive; purely presentational.
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
   * Optional quiet control rendered at the end of the subtitle line.
   * For a reveal toggle or a single inline link that belongs to the identity
   * line rather than the action group — keeping it out of `statusChips` is what
   * stops the chip row turning into a second toolbar.
   * Only rendered when `subtitle` is supplied.
   */
  subtitleTrailing?: ReactNode;
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
  subtitleTrailing,
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
      {backLink && <BackLink label={backLink.label} href={backLink.href} />}

      {/* Title row: [heading + chips] and [actions]. The heading column keeps
          a readable minimum width, so on a phone the actions wrap below it
          instead of squeezing the subtitle to one word per line and sliding
          over the title (COL-657). */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-72 flex-1 flex-col gap-1.5">
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
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums text-muted-foreground">
              <span>{subtitle}</span>
              {subtitleTrailing && (
                <>
                  <span aria-hidden="true">·</span>
                  {subtitleTrailing}
                </>
              )}
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
