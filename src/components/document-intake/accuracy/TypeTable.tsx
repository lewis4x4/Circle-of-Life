"use client";

import { ChevronRight } from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMargin, formatShare, type TypeSummary } from "@/lib/document-intake/jev-accuracy-report";
import { cn } from "@/lib/utils";

import { recommendationLabel, recommendationNote, recommendationTone } from "./labels";

/** Tier 1: one line per filed type with Jev activity in the window. */
export function TypeTable({
  types,
  selected,
  detailId,
  onSelect,
}: {
  types: TypeSummary[];
  selected: string | null;
  detailId: string;
  onSelect: (code: string | null) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table aria-label="Jev accuracy by document type">
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Filed</TableHead>
            <TableHead className="text-right">Jev ran</TableHead>
            <TableHead>Top pick right</TableHead>
            <TableHead className="text-right">Margin now</TableHead>
            <TableHead>Recommendation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.map((t) => {
            const open = selected === t.code;
            return (
              <TableRow key={t.code} data-state={open ? "selected" : undefined}>
                <TableCell className="max-w-80">
                  <button
                    type="button"
                    onClick={() => onSelect(open ? null : t.code)}
                    aria-expanded={open}
                    aria-controls={open ? detailId : undefined}
                    className="inline-flex min-h-11 items-center gap-1 text-left font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted-foreground", open && "rotate-90")} />
                    {t.label}
                  </button>
                  {t.excludedOlder > 0 ? (
                    <span className="block pl-5 text-xs text-muted-foreground">
                      {t.excludedOlder} {t.excludedOlder === 1 ? "document" : "documents"} on older questions left out
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{t.filed}</TableCell>
                <TableCell className="text-right tabular-nums">{t.jevRan}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {t.evaluated ? (
                    <>
                      <span className="block tabular-nums text-foreground">
                        {t.right} of {t.evaluated}
                      </span>
                      <span className="block text-xs tabular-nums text-muted-foreground">Lower bound {formatShare(t.lowerBound)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">None checked yet</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <span className="block tabular-nums text-foreground">{formatMargin(t.marginNow.value)}</span>
                  {t.marginNow.source === "last_run" ? <span className="block text-xs text-muted-foreground">At last run</span> : null}
                </TableCell>
                <TableCell className="min-w-56">
                  <StatusPill tone={recommendationTone(t.recommendation)}>{recommendationLabel(t.recommendation)}</StatusPill>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{recommendationNote(t.recommendation)}</span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
