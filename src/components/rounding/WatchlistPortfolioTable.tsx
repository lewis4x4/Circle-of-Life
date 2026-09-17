"use client";

/**
 * Watchlist tier 1: the portfolio. Spec 25A section 7.5.
 *
 * One row per building. How many residents are on the Watchlist, how many open
 * Acute signals, the worst band in the building and which way the ninety day
 * facility trend is pointing.
 *
 * A composite survives at this level and only at this level: a facility trend
 * is a management instrument, and no care decision hangs on one reading of it.
 * Nothing on this table describes an individual.
 */

import Link from "next/link";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";
import {
  bandTone,
  PORTFOLIO_EMPTY_STATE,
  trendLabel,
} from "@/lib/rounding/watchlist-display-copy";
import type { WatchlistPortfolioRow } from "@/lib/rounding/watchlist-fetch";
import { cn } from "@/lib/utils";

function TrendGlyph({ direction }: { direction: string | null }) {
  if (direction === "rising") {
    return <TrendingUp className="size-3.5 text-danger" aria-hidden />;
  }
  if (direction === "easing") {
    return <TrendingDown className="size-3.5 text-success" aria-hidden />;
  }
  return <Minus className="size-3.5 text-muted-foreground" aria-hidden />;
}

export function WatchlistPortfolioTable({
  rows,
  selectedFacilityId,
  onSelectFacility,
}: {
  rows: readonly WatchlistPortfolioRow[];
  selectedFacilityId: string | null;
  onSelectFacility?: (facilityId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <section
        aria-label="Portfolio watchlist"
        className="rounded-lg border border-border bg-card p-5"
      >
        <p className="text-sm font-semibold text-foreground">{PORTFOLIO_EMPTY_STATE.title}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{PORTFOLIO_EMPTY_STATE.body}</p>
      </section>
    );
  }

  return (
    <section
      aria-label="Portfolio watchlist"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-[12px] font-semibold text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5">Building</th>
              <th className="px-3 py-2.5">Open Acute</th>
              <th className="px-3 py-2.5">Residents listed</th>
              <th className="px-3 py-2.5">Worst band</th>
              <th className="px-3 py-2.5">Documentation</th>
              <th className="px-3 py-2.5">Ninety day trend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const selected = row.facility_id === selectedFacilityId;
              return (
                <tr
                  key={row.facility_id}
                  className={cn(
                    "h-9 transition-colors hover:bg-muted/40",
                    selected && "bg-muted/40",
                  )}
                >
                  <td className="px-3 py-2 font-medium text-foreground">
                    {onSelectFacility ? (
                      <button
                        type="button"
                        onClick={() => onSelectFacility(row.facility_id)}
                        className="rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {row.facility_name}
                      </button>
                    ) : (
                      <Link
                        href="/admin/rounding/watchlist"
                        className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {row.facility_name}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "text-[15px] font-semibold tabular-nums",
                        row.open_acute_signal_count > 0 ? "text-danger" : "text-muted-foreground",
                      )}
                    >
                      {row.open_acute_signal_count}
                    </span>
                    <span className="ml-1.5 text-[12px] text-muted-foreground">
                      {row.acute_resident_count === 1
                        ? "on 1 resident"
                        : `on ${row.acute_resident_count} residents`}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[13px] text-foreground">
                    {row.residents_on_watchlist}
                  </td>
                  <td className="px-3 py-2">
                    {row.worst_band_label ? (
                      <StatusPill tone={bandTone(row.worst_band_key)}>
                        {row.worst_band_label}
                      </StatusPill>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">Nobody listed</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[13px] text-muted-foreground">
                    {row.data_quality_signal_count}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                      <TrendGlyph direction={row.trend_direction} />
                      {trendLabel(row.trend_direction)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
