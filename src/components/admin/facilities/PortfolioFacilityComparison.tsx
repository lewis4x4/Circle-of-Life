"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { portfolioOccupancyBarClass } from "@/lib/admin/facilities/portfolio-metrics";
import {
  portfolioComparisonHelperLine,
  portfolioComparisonOccupancyEmptyCopy,
  type PortfolioComparisonEntry,
} from "@/lib/admin/facilities/portfolio-hub-kpi-copy";

type PortfolioFacilityComparisonProps = {
  entries: PortfolioComparisonEntry[];
  className?: string;
};

type SortMode = "occupancy" | "name";

export function PortfolioFacilityComparison({ entries, className }: PortfolioFacilityComparisonProps) {
  const [sortMode, setSortMode] = useState<SortMode>("occupancy");

  const sorted = useMemo(() => {
    const copy = [...entries];
    copy.sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      const d = b.occupancyPct - a.occupancyPct;
      if (d !== 0) return d;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return copy;
  }, [entries, sortMode]);

  const comparisonHelperLine = portfolioComparisonHelperLine(entries);

  return (
    <section className={cn("rounded-lg border border-border bg-card px-8 py-6", className)} aria-labelledby="portfolio-comparison-heading">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="portfolio-comparison-heading" className="text-base font-semibold text-foreground">
            Portfolio comparison
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Occupancy by facility ({sorted.length})</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: sortMode === "occupancy" ? "secondary" : "ghost", size: "sm" }),
              "h-9",
            )}
            onClick={() => setSortMode("occupancy")}
          >
            Sort by occupancy
          </button>
          <button
            type="button"
            className={cn(buttonVariants({ variant: sortMode === "name" ? "secondary" : "ghost", size: "sm" }), "h-9")}
            onClick={() => setSortMode("name")}
          >
            Sort by facility name
          </button>
        </div>
      </div>

      <ul className="space-y-4">
        {sorted.map((f) => {
          const pct = Math.min(100, Math.max(0, Math.round(f.occupancyPct)));
          const barClass = pct > 0 ? portfolioOccupancyBarClass(pct) : "";
          const emptyCopy = f.occupancyLoaded ? null : portfolioComparisonOccupancyEmptyCopy();

          return (
            <li key={f.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(140px,1fr)_4fr_auto] sm:items-center sm:gap-4">
              <span className="truncate text-sm font-medium text-foreground">{f.name}</span>
              <div className="relative h-2 w-full min-w-[120px] overflow-hidden rounded-full border border-border/60 bg-muted/40">
                {f.occupancyLoaded && pct > 0 ? (
                  <div className={cn("h-full rounded-full transition-all", barClass)} style={{ width: `${pct}%` }} />
                ) : null}
              </div>
              <span
                className={cn(
                  "text-right text-sm sm:min-w-[8rem]",
                  emptyCopy
                    ? "font-medium leading-snug text-muted-foreground"
                    : "tabular-nums font-semibold text-muted-foreground",
                )}
              >
                {emptyCopy ?? `${pct}%`}
              </span>
            </li>
          );
        })}
      </ul>

      {comparisonHelperLine ? (
        <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">{comparisonHelperLine}</p>
      ) : null}
    </section>
  );
}
