"use client";

/**
 * Watchlist tier 2: the facility board. Spec 25A section 7.5.
 *
 * Resident, room, signal, since, band, status, owner. Ranked by band and then
 * by age, which the view does in SQL so a truncated read still shows the worst
 * rows first.
 *
 * A documentation signal renders in its own class. A building behind on its
 * paperwork must not read as a building full of residents going downhill, which
 * is the single most important rendering rule on this page.
 *
 * There is no number on a resident row here beyond a count of named signals and
 * an age in days, both of which open onto the rows behind them.
 */

import Link from "next/link";
import { FileWarning, Stethoscope } from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";
import {
  bandTone,
  isDocumentationSignal,
  ownerLabel,
  residentDisplayName,
  roomLabel,
  signalAgeLabel,
  signalStatusLabel,
  signalStatusTone,
  sourceKindLabel,
  WATCHLIST_EMPTY_STATE,
} from "@/lib/rounding/watchlist-display-copy";
import type { WatchlistSignalRow } from "@/lib/rounding/watchlist-fetch";
import { cn } from "@/lib/utils";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

export function WatchlistFacilityTable({ rows }: { rows: readonly WatchlistSignalRow[] }) {
  if (rows.length === 0) {
    return (
      <section
        aria-label="Facility watchlist"
        className="rounded-lg border border-border bg-card p-5"
      >
        <p className="text-sm font-semibold text-foreground">{WATCHLIST_EMPTY_STATE.title}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{WATCHLIST_EMPTY_STATE.body}</p>
      </section>
    );
  }

  return (
    <section
      aria-label="Facility watchlist"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div>
        <HorizontalScroll label="Watchlist by facility">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-[12px] font-semibold text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5">Resident</th>
                <th className="px-3 py-2.5">Room</th>
                <th className="px-3 py-2.5">Signal</th>
                <th className="px-3 py-2.5">Since</th>
                <th className="px-3 py-2.5">Band</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const documentation = isDocumentationSignal(row.source_kind);
                return (
                  <tr
                    key={row.signal_instance_id}
                    className={cn(
                      "h-9 transition-colors hover:bg-muted/40",
                      documentation && "bg-muted/25",
                    )}
                  >
                    <td className="px-3 py-2 font-medium text-foreground">
                      <Link
                        href={`/admin/rounding/watchlist/${row.resident_id}`}
                        className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {residentDisplayName(row)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-[13px] text-muted-foreground">
                      {roomLabel(row.room_number)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        {documentation ? (
                          <FileWarning className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        ) : (
                          <Stethoscope className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                        <span
                          className={cn(
                            "text-[13px]",
                            documentation ? "italic text-muted-foreground" : "text-foreground",
                          )}
                        >
                          {row.signal_label}
                        </span>
                        <span className="sr-only">{sourceKindLabel(row.source_kind)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[13px] text-muted-foreground">
                      {signalAgeLabel(row.days_open)}
                    </td>
                    <td className="px-3 py-2">
                      {row.band_label ? (
                        <StatusPill tone={bandTone(row.band_key)}>{row.band_label}</StatusPill>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">Not banded</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill tone={signalStatusTone(row.status)}>
                        {signalStatusLabel(row.status)}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2 text-[13px] text-muted-foreground">
                      {ownerLabel(row.owner_name)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </HorizontalScroll>
      </div>
      <p className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
        Rows in the lighter band are documentation signals: nobody wrote the check down. They are not
        a report that a resident is declining.
      </p>
    </section>
  );
}
