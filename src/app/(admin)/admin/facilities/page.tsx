"use client";

import React, { useMemo, useState } from "react";
import { Building2, Loader2, Search } from "lucide-react";
import { useFacilities } from "@/hooks/useFacilities";
import { FacilityCard } from "@/components/admin/facilities/FacilityCard";
import { PortfolioFacilityComparison } from "@/components/admin/facilities/PortfolioFacilityComparison";
import { KpiCard } from "@/components/ui/kpi-card";
import {
  buildPortfolioStripTotals,
  portfolioKpiStripHelperLine,
  portfolioStripFacilityCountEmptyCopy,
  portfolioStripLicensedBedsEmptyCopy,
  portfolioStripOccupiedBedsEmptyCopy,
  portfolioStripPortfolioOccupancyDisplay,
  portfolioStripPortfolioOccupancyEmptyCopy,
} from "@/lib/admin/facilities/portfolio-hub-kpi-copy";

export default function FacilitiesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const { facilities, isLoading, error } = useFacilities({ search, status });

  const totals = useMemo(() => buildPortfolioStripTotals(facilities), [facilities]);

  const facilityCountEmptyCopy = portfolioStripFacilityCountEmptyCopy(totals.facilityCount);
  const licensedBedsEmptyCopy = portfolioStripLicensedBedsEmptyCopy(totals);
  const occupiedBedsEmptyCopy = portfolioStripOccupiedBedsEmptyCopy(totals);
  const portfolioOccupancyEmptyCopy = portfolioStripPortfolioOccupancyEmptyCopy(totals);

  const kpiStripHelperLine = portfolioKpiStripHelperLine(totals);

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
          <div className="flex flex-col gap-2">
            <div className="rounded-lg border border-border bg-card px-8 py-6">
              <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
                <KpiCard
                  value={facilityCountEmptyCopy ?? totals.facilityCount}
                  valuePresentation={facilityCountEmptyCopy != null ? "message" : "metric"}
                  label="Facilities"
                  className="border-0 bg-transparent px-0 py-0 shadow-none ring-0"
                />
                <KpiCard
                  value={licensedBedsEmptyCopy ?? totals.licensedSum}
                  valuePresentation={licensedBedsEmptyCopy != null ? "message" : "metric"}
                  label="Licensed beds"
                  className="border-0 bg-transparent px-0 py-0 shadow-none ring-0"
                />
                <KpiCard
                  value={occupiedBedsEmptyCopy ?? totals.occupiedSum}
                  valuePresentation={occupiedBedsEmptyCopy != null ? "message" : "metric"}
                  label="Occupied beds"
                  className="border-0 bg-transparent px-0 py-0 shadow-none ring-0"
                />
                <KpiCard
                  value={portfolioStripPortfolioOccupancyDisplay(totals)}
                  valuePresentation={portfolioOccupancyEmptyCopy != null ? "message" : "metric"}
                  label="Portfolio occupancy"
                  tone={
                    portfolioOccupancyEmptyCopy == null && totals.portfolioPctRounded != null
                      ? totals.portfolioPctRounded < 60
                        ? "warning"
                        : totals.portfolioPctRounded < 90
                          ? "success"
                          : "neutral"
                      : "neutral"
                  }
                  className="border-0 bg-transparent px-0 py-0 shadow-none ring-0"
                />
              </div>
            </div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{kpiStripHelperLine}</p>
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
