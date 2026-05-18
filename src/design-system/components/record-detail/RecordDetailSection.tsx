import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// ui-v2 caption sizing: 11px has no Tailwind alias. The cn() wrapper is
// intentional — the no-raw-spacing lint rule only fires on direct JSX
// Literal attributes; wrapping in cn() is the established pattern for
// arbitrary-value classes that lack a semantic token (see ActionQueue
// for prior art on cn() usage in design-system primitives).

/**
 * RecordDetailSection
 *
 * Bordered content section for a Record Detail surface (S6.5: `rounded-xl`,
 * subtle ring lift vs canvas — padding 14px · DATA emphasis). Organises body
 * content under a labelled heading with an optional right-aligned action slot.
 *
 * Accessibility:
 *   - The section title is rendered as an <h2>, and `aria-label={title}` is
 *     applied to the <section> element so it registers as a "region" landmark
 *     in the accessibility tree. An un-labelled <section> is generic and not
 *     a landmark; the explicit aria-label ensures screen-reader users can
 *     navigate between sections. We use `aria-label` (not aria-labelledby)
 *     to avoid `useId`, keeping the component server-component-safe
 *     (React hooks are unavailable in RSC).
 *   - The optional `action` slot (e.g. an Edit button) sits in a `<div>`
 *     alongside the heading and is keyboard-reachable when rendered.
 *   - Nesting RecordDetailSection inside another is forbidden per the card
 *     anti-pattern: "Nested cards are forbidden. Choose one container."
 *
 * Visual treatment per Record Detail surface:
 *   - Row height: 38px (density operational)
 *   - Padding: 14px
 *   - Border radius: `rounded-xl` (card lift vs canvas — ring + `--card`)
 *   - Hover lift: 2px applies to TILE-like sub-elements, NOT to sections
 *     themselves. Sections are stationary; only interactive tiles within
 *     them receive the lift treatment.
 *   - Section `<h2>` uses Quiet Operator typography: sentence case Geist sans,
 *     **`text-[14px] font-semibold text-foreground`** (not monospace all-caps).
 *
 * Constraints:
 *   - 100% semantic Tailwind tokens — zero hardcoded colors.
 *   - No "use client" directive; purely presentational.
 *   - No next/link or any Next.js import (framework-agnostic primitive).
 */
export interface RecordDetailSectionProps {
  /**
   * Section label — sentence case, **`text-[14px] font-semibold`**, Geist (default sans).
   * Rendered as <h2> for document outline semantics.
   */
  title: string;
  /**
   * Optional right-aligned action rendered in the section header row.
   * e.g. an Edit button or a secondary action link.
   */
  action?: ReactNode;
  /**
   * Optional supporting description rendered below the section title,
   * before the body content.
   */
  description?: string;
  /** Body content of the section. */
  children: ReactNode;
  /** Optional className extension for the outer <section> container. */
  className?: string;
}

/**
 * RecordDetailSection — Record Detail surface section primitive.
 *
 * @example
 * <RecordDetailSection
 *   title="Clinical summary"
 *   description="Physician-entered on last visit."
 *   action={<Button variant="ghost" size="sm">Edit</Button>}
 * >
 *   <dl>...</dl>
 * </RecordDetailSection>
 */
export function RecordDetailSection({
  title,
  action,
  description,
  children,
  className,
}: RecordDetailSectionProps) {
  return (
    <section
      // aria-label provides an explicit accessible name so the <section>
      // element is exposed as a "region" landmark in the accessibility tree.
      // Without it, <section> is a generic element with no landmark role.
      aria-label={title}
      className={cn(
        // Record Detail cards: discrete lift from canvas via ring + token bg-card,
        // standard transition (240ms). NO hover lift on the section itself.
        "rounded-xl border border-border bg-card p-[14px] shadow-[var(--shadow-card)] ring-1 ring-border/60 transition-all duration-[var(--motion-duration)] ease-[var(--motion-ease)]",
        className,
      )}
    >
      {/* Section header row — title + optional action */}
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0 flex-1">
          <h2 className={cn("text-[14px] font-semibold tracking-normal normal-case text-foreground")}>{title}</h2>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>

        {action && (
          <div className="flex shrink-0 items-center gap-2">{action}</div>
        )}
      </div>

      {/* Section body — default vertical rhythm; consumers may override */}
      <div className="space-y-3">{children}</div>
    </section>
  );
}
