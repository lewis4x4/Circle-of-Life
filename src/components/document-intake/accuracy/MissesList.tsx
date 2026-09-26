"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import type { Miss } from "@/lib/document-intake/jev-accuracy-report";

import { DESTINATION_KIND_LABELS } from "../model";
import { jevChoiceLabel } from "./labels";

const FIRST_PAGE = 25;

function destinationLabel(kind: string | null): string {
  if (!kind) return "Not available";
  return kind in DESTINATION_KIND_LABELS ? DESTINATION_KIND_LABELS[kind as keyof typeof DESTINATION_KIND_LABELS] : kind;
}

function missedLabel(miss: Miss): string {
  const parts: string[] = [];
  if (miss.reasons.includes("top_pick")) parts.push("Top pick");
  if (miss.reasons.includes("check")) parts.push(`Marked wrong: ${miss.wrongChecks.join(", ")}`);
  return parts.join("; ");
}

/** Tier 3: filed documents where Jev's top pick was wrong or a reviewer marked a check Wrong. Newest first. */
export function MissesList({ misses }: { misses: Miss[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? misses : misses.slice(0, FIRST_PAGE);
  return (
    <section aria-labelledby="jev-misses-heading" className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="jev-misses-heading" className="text-sm font-semibold text-foreground">
          Misses
        </h2>
        <p className="text-xs text-muted-foreground">
          {misses.length === 0 ? "None in this window." : `${misses.length} ${misses.length === 1 ? "document" : "documents"}, newest first`}
        </p>
      </div>
      {misses.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          No filed document in this window had a wrong top pick or a check a reviewer marked Wrong.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table aria-label="Documents Jev missed">
            <TableHeader>
              <TableRow>
                <TableHead>Filed (ET)</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>What missed</TableHead>
                <TableHead>Jev&apos;s pick</TableHead>
                <TableHead>Filed to</TableHead>
                <TableHead>
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((m) => (
                <TableRow key={m.filingId}>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatFacilityTimestampEt(m.approvedAt)}</TableCell>
                  <TableCell>{m.label}</TableCell>
                  <TableCell className="max-w-80">{missedLabel(m)}</TableCell>
                  <TableCell>
                    {jevChoiceLabel(m.jevChoice)}
                    {m.jevChoice && m.jevChoice !== "none" ? <code className="ml-1 font-mono text-xs text-muted-foreground">{m.jevChoice}</code> : null}
                  </TableCell>
                  <TableCell>{destinationLabel(m.destinationKind)}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/admin/document-intake/${m.itemId}`}
                      className="font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Open<span className="sr-only"> {m.label} filed {formatFacilityTimestampEt(m.approvedAt)}</span>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {misses.length > FIRST_PAGE && !showAll ? (
            <div className="border-t border-border p-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowAll(true)}>
                Show all {misses.length}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
