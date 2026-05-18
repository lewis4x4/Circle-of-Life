"use client";

import React, { useMemo, useState } from "react";
import { Building2, Loader2, Search } from "lucide-react";
import { useFacilities } from "@/hooks/useFacilities";
import { FacilityCard } from "@/components/admin/facilities/FacilityCard";
import { PortfolioFacilityComparison } from "@/components/admin/facilities/PortfolioFacilityComparison";
import { cn } from "@/lib/utils";
import {
  portfolioOccupancyKpiTextClass,
  portfolioOccupancyPercent,
} from "@/lib/admin/facilities/portfolio-metrics";

export default function FacilitiesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const { facilities, isLoading, error } = useFacilities({ search, status });

  const totals = useMemo(() => {
    let licensedSum = 0;
    let occupiedSum = 0;
    const comparison: { id: string; name: string; occupancyPct: number }[] = [];

    for (const f of facilities) {
      const lic = typeof f.total_licensed_beds === "number" ? f.total_licensed_beds : (f.licensed_beds ?? 0);
      const occ = f.occupancy_count ?? f.current_occupancy ?? 0;
      const phy = f.total_beds ?? 0;
      licensedSum += lic;
      occupiedSum += occ;

      comparison.push({
        id: f.id,
        name: f.name,
        occupancyPct: portfolioOccupancyPercent(occ, phy, lic),
      });
    }

    const portfolioPctRounded = licensedSum > 0 ? Math.min(100, Math.round((occupiedSum / licensedSum) * 100)) : 0;

    return {
      facilityCount: facilities.length,
      licensedSum,
      occupiedSum,
      portfolioPctRounded,
      comparison,
      portfolioPctToneClass: portfolioOccupancyKpiTextClass(portfolioPctRounded),
    };
  }, [facilities]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-16">
      <div className="relative z-10 mx-auto max-w-7xl space-y-8 px-4 sm:px-6 xl:px-0">
        <header className="mt-2 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Facilities</h1>
          <p className="max-w-3xl text-pretty text-sm text-muted-foreground">
            Live census, licensing, staffing, and survey status across the portfolio.
          </p>
        </header>

        {!isLoading && facilities.length > 0 && (
          <div className="rounded-lg border border-border bg-card px-8 py-6">
            <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
              <PortfolioMetricFigure label="Facilities" value={totals.facilityCount} />
              <PortfolioMetricFigure label="Licensed beds" value={totals.licensedSum} />
              <PortfolioMetricFigure label="Occupied beds" value={totals.occupiedSum} />
              <PortfolioMetricFigure
                label="Portfolio occupancy"
                value={`${totals.portfolioPctRounded}%`}
                valueClassName={totals.portfolioPctToneClass}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative w-full md:w-1/2 md:max-w-none">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              placeholder="Search by name or city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-foreground outline-none ring-ring/20 transition focus:border-ring/40 focus:ring-4"
              autoComplete="off"
            />
          </div>
          <div className="flex min-w-[180px] flex-1 md:flex-initial md:justify-end">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:ring-4 focus:ring-ring/20 md:w-auto"
              aria-label="Filter by status"
            >
              <option value="">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="under_renovation">Under renovation</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <Loader2 className="size-10 animate-spin text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Loading facilities…</p>
          </div>
        ) : facilities.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-8 py-20 text-center">
            <Building2 className="mx-auto mb-4 size-14 text-muted-foreground/50" aria-hidden />
            <h3 className="text-lg font-semibold text-foreground">No facilities match</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Try another search, clear filters, or confirm onboarding has created sites for your organization.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              {facilities.map((facility) => (
                <FacilityCard key={facility.id} facility={facility} />
              ))}
            </div>

            <PortfolioFacilityComparison entries={totals.comparison} className="mt-12" />
          </>
        )}
      </div>
    </div>
  );
}

function PortfolioMetricFigure({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string | number;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className={cn("text-[28px] font-semibold leading-none tabular-nums tracking-tight", valueClassName ?? "text-foreground")}>
        {value}
      </span>
      <span className="text-[13px] text-muted-foreground">{label}</span>
    </div>
  );
}
