"use client";

import React, { useMemo, useState } from "react";
import { Building2, Loader2, RefreshCw, Search } from "lucide-react";
import { useFacilities } from "@/hooks/useFacilities";
import { FacilityCard } from "@/components/admin/facilities/FacilityCard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function FacilitiesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const { facilities, isLoading, error, refetch, pagination } = useFacilities({ search, status });

  const totals = useMemo(() => {
    let licensed = 0;
    let occupied = 0;
    for (const f of facilities) {
      const beds = f.total_beds ?? f.total_licensed_beds ?? f.licensed_beds ?? 0;
      const occ = f.occupancy_count ?? f.current_occupancy ?? 0;
      licensed += typeof beds === "number" ? beds : 0;
      occupied += typeof occ === "number" ? occ : 0;
    }
    const pct = licensed > 0 ? Math.round((occupied / licensed) * 100) : 0;
    return { licensed, occupied, pct, count: facilities.length };
  }, [facilities]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-16">
      <div className="relative z-10 mx-auto max-w-7xl space-y-8 px-4 sm:px-6 xl:px-0">
        <header className="mt-2 flex flex-col gap-6 rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-full border border-border bg-muted text-muted-foreground">
                Portfolio
              </Badge>
              <span className="text-xs text-muted-foreground">Multi-site ALF operations</span>
            </div>
            <div className="flex items-start gap-3">
              <Building2 className="mt-1 size-9 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                  Facilities
                </h1>
                <p className="mt-1 max-w-2xl text-pretty text-base text-muted-foreground">
                  Live census, licensing context, and deep links into each site.
                </p>
              </div>
            </div>
          </div>

          {!isLoading && facilities.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:flex sm:flex-wrap sm:justify-end">
              <div className="rounded-lg border border-border bg-card px-4 py-3 text-center sm:text-left">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sites</p>
                <p className="font-mono text-xl font-semibold tabular-nums text-foreground">{totals.count}</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-4 py-3 text-center sm:text-left">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Licensed beds</p>
                <p className="font-mono text-xl font-semibold tabular-nums text-foreground">
                  {totals.occupied}
                  <span className="text-muted-foreground">/{totals.licensed}</span>
                </p>
              </div>
              <div className="rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-center sm:text-left">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-success">Portfolio occ.</p>
                <p className="font-mono text-xl font-semibold tabular-nums text-success">{totals.pct}%</p>
              </div>
            </div>
          )}
        </header>

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              placeholder="Search by name or city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-4 text-sm outline-none ring-ring/20 transition focus:border-ring/40 focus:ring-4 text-foreground"
              autoComplete="off"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:ring-4 focus:ring-ring/20 text-foreground"
            aria-label="Filter by status"
          >
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="under_renovation">Under renovation</option>
            <option value="archived">Archived</option>
          </select>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isLoading}
            className={cn(
              buttonVariants({ variant: "outline", size: "default" }),
              "gap-2 border-border"
            )}
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} aria-hidden />
            Refresh
          </button>
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
            <p className="text-xs text-muted-foreground">
              Showing {facilities.length}
              {pagination.total > facilities.length ? ` of ${pagination.total}` : ""} site
              {facilities.length === 1 ? "" : "s"}. Open a card for licensing, rates, staffing, and audit trails.
            </p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {facilities.map((facility) => (
                <FacilityCard
                  key={facility.id}
                  facility={facility}
                  redAlertCount={0}
                  yellowAlertCount={0}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
