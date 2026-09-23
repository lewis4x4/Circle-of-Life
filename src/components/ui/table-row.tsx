"use client";

import type * as React from "react";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { cn } from "@/lib/utils";

/**
 * TableRow + TableRowHeader — Quiet Operator Table / List / Queue row
 * primitives. Single source of truth for row density and chrome.
 *
 * Spec bindings:
 *   - docs/specs/FRONTEND-CONTRACT.md §8 (Table / List surface)
 *   - surface-map.md §Table/List + §Inbox/Work Queue:
 *     Row height 36px · Padding 13px · Border radius 8px · Hover lift 1-2px
 *   - component-rules.md §Tables rule 1 — "Row height matches the per-
 *     surface density. Hover changes background, not lift." (Lift is held
 *     to 1px so the background swap reads as the primary cue.)
 *   - component-rules.md §Tables rule 2 — column headers use caption
 *     typography (≈11px sentence case) along header row borders.
 *   - constitution.md rule 6 — tables and lists default to data density.
 *
 * Hard constraints (binding):
 *   - Row is exactly 36px tall (`h-9`). NO vertical padding — content sits
 *     on the row's intrinsic baseline. Column cells must be single-line.
 *   - Horizontal padding is 13px (`px-[13px]`).
 *   - Transitions ride `--motion-duration-micro` (100ms) on `--motion-ease`.
 *   - Focus ring: 2px against `bg-card`, no offset (the row already sits
 *     on a panel).
 *
 * Polymorphism:
 *   Both primitives accept the base-ui `render` prop (same pattern as the
 *   project's Badge primitive). To render as a different element:
 *
 *     <TableRow render={<a href={url} />}>...</TableRow>
 *     <TableRow render={<Link href={url} />}>...</TableRow>
 *
 *   Default tag is a plain `<div>`. These are flex rows, not an ARIA grid:
 *   they carry no `role="row"` (COL-658). A row role needs a `table` /
 *   `rowgroup` parent and `cell` children, which callers never render, so
 *   axe flagged every list (aria-required-parent / -children, critical) —
 *   and on `render={<Link />}` it overrode the link role, hiding the link
 *   from screen readers. Rendered as an anchor / button, the underlying tag
 *   carries the semantics. For real tabular data use `@/components/ui/table`,
 *   or build the full grid yourself (`role="table"` → `rowgroup` → pass
 *   `role="row"` here → `cell` children), as the resident roster does.
 *
 * Children:
 *   Pass `flex-[N]` column cells. Status chips MUST use the StatusPill
 *   primitive (component-rules.md §Tables rule 3). NEVER stack "label /
 *   value" two-line content inside a row — render labels in a sibling
 *   TableRowHeader above the rows.
 *
 * Usage:
 *
 *   <div className="overflow-hidden rounded-lg border border-border bg-card">
 *     <TableRowHeader>
 *       <div className="flex-[3]">Staff</div>
 *       <div className="flex-1">Status</div>
 *       <div className="flex-1">Certifications</div>
 *     </TableRowHeader>
 *
 *     {rows.map((row) => (
 *       <TableRow key={row.id} render={<Link href={`/admin/staff/${row.id}`} />}>
 *         <div className="flex-[3] flex items-center gap-2.5 min-w-0">…</div>
 *         <div className="flex-1"><StatusPill>Active</StatusPill></div>
 *         <div className="flex-1"><StatusPill>Current</StatusPill></div>
 *       </TableRow>
 *     ))}
 *   </div>
 */

const TABLE_ROW_BASE =
  "flex items-center gap-3 h-9 px-[13px] rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0";

const TABLE_HEADER_BASE =
  "flex items-center gap-3 h-8 px-[13px] border-b border-border bg-card/60 text-[11px] font-semibold normal-case tracking-tight text-muted-foreground";

export function TableRow({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(TABLE_ROW_BASE, "group", className),
      },
      props,
    ),
    render,
    state: {
      slot: "table-row",
    },
  });
}

export function TableRowHeader({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(TABLE_HEADER_BASE, className),
      },
      props,
    ),
    render,
    state: {
      slot: "table-row-header",
    },
  });
}

/**
 * TableRowList — the scroll box every TableRowHeader + TableRow list sits in
 * (COL-657). Flex rows squeeze their `flex-[N]` columns to whatever width the
 * card has, so on a phone names truncate to a few characters and trailing
 * columns vanish behind the card's `overflow-hidden`. The list keeps a
 * minimum width that fits its columns and scrolls sideways inside the card
 * instead; on wider screens it simply fills the card.
 *
 *   <TableRowList label="Staff roster">
 *     <TableRowHeader>…</TableRowHeader>
 *     <MotionList>…rows…</MotionList>
 *   </TableRowList>
 */
export function TableRowList({
  label,
  minWidthClassName = "min-w-[44rem]",
  className,
  children,
}: {
  /** Accessible name for the scroll region, e.g. "Staff roster". */
  label: string;
  /** Narrowest width at which every column still reads; override per list. */
  minWidthClassName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <HorizontalScroll label={label} className={className}>
      <div data-slot="table-row-list" className={minWidthClassName}>
        {children}
      </div>
    </HorizontalScroll>
  );
}
