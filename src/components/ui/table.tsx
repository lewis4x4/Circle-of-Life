"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Table — Quiet Operator data-table primitive (component-rules.md §Tables,
 * surface-map.md "Table / List").
 *
 * Density: 36px row default (h-9 head, py-2 cells with text-sm) — matches
 * the operational Table/List surface. For Inbox/Work-Queue density (33–36px)
 * override per-row; for Settings (35px) override per-row.
 *
 * Headers: 12px semibold muted sentence case — labels read as captions, not
 * shout caps (Quiet Operator constitution). The visual separator under the header is the first
 * body row's top edge, NOT a `<thead>` bottom border. Renders `<thead>`
 * with `border-t border-border`.
 *
 * Hover: changes background, NEVER lifts. Row hover uses `bg-accent/40`
 * (the warm muted chip slot at 40% — subtle wash, no brand cue).
 *
 * Status indicators: dot + label, never label alone (constitution rule 4
 * "Critical states never rely on color alone"). Use `<StatusPill>` from
 * `@/components/ui/status-pill` inside cells; the primitive does not render
 * status markers itself.
 *
 * Numeric columns: right-aligned, tabular. Tabular figures are global
 * (constitution rule 7). Apply `text-right` per cell — the primitive does
 * not auto-detect column type.
 *
 *   <TableCell className="text-right">{formatCurrency(amount)}</TableCell>
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("border-t border-border", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-border bg-muted/40 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] hover:bg-accent/40 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-3 text-left align-middle text-[12px] font-semibold normal-case tracking-normal text-muted-foreground whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
