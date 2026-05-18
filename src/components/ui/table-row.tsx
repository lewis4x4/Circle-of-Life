"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

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
 *     (10-11px uppercase tracked) on top borders.
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
 *   Default tag is `<div role="row">`. When you render as an anchor /
 *   button you don't need to add `role` — the underlying tag carries the
 *   right semantics for keyboard nav.
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
  "flex items-center gap-3 h-8 px-[13px] border-b border-border bg-card/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

export function TableRow({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        role: "row",
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
        role: "row",
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
