"use client";

/**
 * The disposition ledger, and its CSV. Spec 25A section 7.4.
 *
 * Append only, so this table only ever grows. A transition the scheduled
 * evaluation made is labeled as such and names nobody, because it claims
 * nothing about anybody: a signal that stopped being true stopped being true.
 *
 * The CSV matches the column order of the paper log it replaces.
 */

import { formatDisplayDate } from "@/lib/format/datetime";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  buildLedgerCsv,
  LEDGER_EMPTY_STATE,
  type LedgerCsvRow,
  ledgerCsvFilename,
  ownerLabel,
  signalStatusLabel,
  signalStatusTone,
  type FacilityScope,
} from "@/lib/rounding/watchlist-display-copy";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

export interface LedgerEntry extends LedgerCsvRow {
  id: string;
}

function downloadCsv(filename: string, body: string) {
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function WatchlistDispositionLedger({
  entries,
  facilityScope,
}: {
  entries: readonly LedgerEntry[];
  facilityScope: FacilityScope;
}) {
  if (entries.length === 0) {
    return (
      <section aria-label="Disposition ledger" className="rounded-lg border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">{LEDGER_EMPTY_STATE.title}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{LEDGER_EMPTY_STATE.body}</p>
      </section>
    );
  }

  return (
    <section
      aria-label="Disposition ledger"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <p className="text-sm font-semibold text-foreground">Disposition ledger</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            downloadCsv(
              ledgerCsvFilename(facilityScope, new Date().toISOString().slice(0, 10)),
              buildLedgerCsv(entries),
            )
          }
        >
          <Download className="size-3.5" aria-hidden />
          Export CSV
        </Button>
      </div>
      <div>
        <HorizontalScroll label="Watchlist dispositions">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-[12px] font-semibold text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Signal</th>
                <th className="px-3 py-2.5">Moved to</th>
                <th className="px-3 py-2.5">Reviewed by</th>
                <th className="px-3 py-2.5">What was done</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id} className="h-9">
                  <td className="px-3 py-2 text-[13px] tabular-nums text-muted-foreground">
                    {formatDisplayDate(entry.acted_at)}
                  </td>
                  <td className="px-3 py-2 text-[13px] text-foreground">{entry.signal_label}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={signalStatusTone(entry.to_status)}>
                      {signalStatusLabel(entry.to_status)}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2 text-[13px] text-muted-foreground">
                    {entry.actor_kind === "system"
                      ? "Scheduled evaluation"
                      : ownerLabel(entry.acted_by_name)}
                  </td>
                  <td className="px-3 py-2 text-[13px] text-foreground">
                    {entry.note?.trim() ? entry.note : "Nothing written"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HorizontalScroll>
      </div>
    </section>
  );
}
