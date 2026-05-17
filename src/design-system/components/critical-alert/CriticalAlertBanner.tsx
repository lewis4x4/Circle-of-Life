import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * CriticalAlertBanner
 *
 * Page-level alert primitive for the Critical Alert surface
 * (surface-map.md: Linear 40% · Stripe 30% · Mercury 20% · Pylon 10%).
 * Used to surface stress-time information that requires acknowledgment
 * (e.g. "Unable to load this page", "Resident with active fall watch
 * just rang"). Calm hierarchy, unambiguous actions.
 *
 * Visual contract (Quiet Operator):
 *   - Background  `bg-destructive/10` (soft tint, 10% — never `/5`).
 *   - Border      `border-destructive/30` (30% — never `/50` solid).
 *   - Text        `text-destructive` for headline + icon; body uses
 *                 `text-muted-foreground` so prose stays readable on
 *                 the tint without competing with the destructive
 *                 headline.
 *   - Radius      `rounded-lg` (matches Critical Alert surface 10px).
 *   - Padding     `p-4` (~14px — matches surface-map padding).
 *   - Icon        Caller-supplied (lucide-react `<AlertTriangle />` is
 *                 the canonical choice). The slot is `aria-hidden` —
 *                 the role/text carry the semantic weight.
 *
 * Accessibility:
 *   - When `severity="critical"` (default), the wrapper has
 *     `role="alert"` so assistive tech announces it assertively. Use
 *     this only for genuinely critical surfaces (page-level errors,
 *     active clinical risk). For informational tinted callouts, pass
 *     `severity="info"` — that variant uses a polite live region
 *     (`role="status"`) and warning-toned semantic colors.
 *   - The headline is rendered as a heading element (default `<h2>`).
 *     Override with `headingLevel` when nesting under a different
 *     heading hierarchy. There must be exactly one `<h1>` per route.
 *   - Actions slot consumers must supply keyboard-reachable controls
 *     with `focus-visible:ring-2 focus-visible:ring-ring`.
 *
 * Constraints:
 *   - 100% semantic tokens — zero hardcoded slate/zinc/red/amber.
 *   - Soft-tint policy: `/10` for backgrounds, `/30` for borders.
 *   - No `backdrop-blur`, no decorative gradients, no `rounded-2xl`.
 *   - Framework-agnostic: no next/link, no "use client".
 */
export type CriticalAlertSeverity = "critical" | "info";

export interface CriticalAlertBannerProps {
  /** Headline rendered as a heading. Must not be empty. */
  title: string;
  /** Optional body copy. Operator-grade neutral — no apologies. */
  description?: ReactNode;
  /**
   * Optional reference identifier (e.g. Sentry digest, incident ID).
   * Rendered as tabular numerics so identifiers align across stacks.
   */
  reference?: string;
  /**
   * Optional icon node. The slot is `aria-hidden`; semantic meaning
   * comes from `role="alert"` + heading copy. Recommended:
   * `<AlertTriangle aria-hidden />` from lucide-react, sized 5×5.
   */
  icon?: ReactNode;
  /**
   * Optional action group rendered below the body. Right-aligned on
   * desktop, stacked on mobile. Consumers should use `<Button />`
   * (variant `default` for primary retry, `outline` for navigation).
   */
  actions?: ReactNode;
  /**
   * Severity tone. Defaults to `"critical"` — uses `role="alert"`,
   * destructive tint (`/10` bg, `/30` border), destructive headline.
   * `"info"` uses `role="status"`, info-tinted soft surface (same
   * `/10` and `/30` policy), foreground headline (quiet callout).
   */
  severity?: CriticalAlertSeverity;
  /**
   * Heading level for the title. Defaults to `2`. Use `1` only when
   * the banner replaces the page heading (e.g. global-error.tsx).
   */
  headingLevel?: 1 | 2 | 3;
  /** Optional className extension for the outer container. */
  className?: string;
}

const SEVERITY_TO_CONTAINER: Record<CriticalAlertSeverity, string> = {
  critical: "border-destructive/30 bg-destructive/10",
  info: "border-info/30 bg-info/10",
};

const SEVERITY_TO_TITLE: Record<CriticalAlertSeverity, string> = {
  critical: "text-destructive",
  info: "text-foreground",
};

const SEVERITY_TO_ICON: Record<CriticalAlertSeverity, string> = {
  critical: "text-destructive",
  info: "text-muted-foreground",
};

/**
 * CriticalAlertBanner — Critical Alert surface primitive.
 *
 * @example
 * <CriticalAlertBanner
 *   title="Unable to load this page"
 *   description="Try refreshing or contact support if the issue persists."
 *   icon={<AlertTriangle aria-hidden className="h-5 w-5" />}
 *   reference={error.digest}
 *   actions={
 *     <>
 *       <Button onClick={reset}>Retry</Button>
 *       <Link href="/admin" className={cn(buttonVariants({ variant: "outline" }))}>
 *         Dashboard
 *       </Link>
 *     </>
 *   }
 * />
 */
export function CriticalAlertBanner({
  title,
  description,
  reference,
  icon,
  actions,
  severity = "critical",
  headingLevel = 2,
  className,
}: CriticalAlertBannerProps) {
  const HeadingTag = `h${headingLevel}` as "h1" | "h2" | "h3";
  const role = severity === "critical" ? "alert" : "status";
  const ariaLive = severity === "critical" ? "assertive" : "polite";

  return (
    <div
      role={role}
      aria-live={ariaLive}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        SEVERITY_TO_CONTAINER[severity],
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span
            aria-hidden="true"
            className={cn("mt-0.5 shrink-0", SEVERITY_TO_ICON[severity])}
          >
            {icon}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <HeadingTag
            className={cn(
              "text-base font-semibold tracking-tight",
              SEVERITY_TO_TITLE[severity],
            )}
          >
            {title}
          </HeadingTag>
          {description && (
            <div className="text-sm text-muted-foreground">{description}</div>
          )}
          {reference && (
            <p className="text-xs tabular-nums text-muted-foreground">
              Reference: <span>{reference}</span>
            </p>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
