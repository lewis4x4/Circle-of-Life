"use client";

import React, { useMemo, useState } from "react";
import { Building2, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { useFacilities } from "@/hooks/useFacilities";
import { FacilityCard } from "@/components/admin/facilities/FacilityCard";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

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
      <AmbientMatrix hasCriticals={false} primaryClass="bg-teal-700/10" secondaryClass="bg-slate-900/10" />

      <div className="relative z-10 mx-auto max-w-7xl space-y-8 px-4 sm:px-6 xl:px-0">
        <header className="mt-2 flex flex-col gap-6 rounded-[2rem] border border-slate-200/50 bg-white/50 p-6 shadow-sm backdrop-blur-xl dark:border-white/5 dark:bg-black/25 sm:p-8 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-full border border-teal-500/25 bg-teal-500/10 text-teal-800 dark:text-teal-200">
                <Sparkles className="mr-1 size-3" aria-hidden />
                Portfolio
              </Badge>
              <span className="text-xs text-slate-500 dark:text-slate-400">Multi-site ALF operations</span>
            </div>
            <div className="flex items-start gap-3">
              <Building2 className="mt-1 size-9 shrink-0 text-teal-600 dark:text-teal-400" strokeWidth={1.5} aria-hidden />
              <div>
                <h1 className="font-display text-3xl font-light tracking-tight text-slate-900 dark:text-white md:text-4xl">
                  Facilities
                </h1>
                <p className="mt-1 max-w-2xl text-pretty text-base text-slate-600 dark:text-slate-400">
                  Live census, licensing context, and deep links into each site—without hopping spreadsheets.
                </p>
              </div>
            </div>
          </div>

          {!isLoading && facilities.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:flex sm:flex-wrap sm:justify-end">
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-center dark:border-white/10 dark:bg-white/[0.04] sm:text-left">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Sites</p>
                <p className="font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-white">{totals.count}</p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-center dark:border-white/10 dark:bg-white/[0.04] sm:text-left">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Licensed beds</p>
                <p className="font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {totals.occupied}
                  <span className="text-slate-400">/{totals.licensed}</span>
                </p>
              </div>
              <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 px-4 py-3 text-center dark:bg-teal-500/10 sm:text-left">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">Portfolio occ.</p>
                <p className="font-mono text-xl font-semibold tabular-nums text-teal-800 dark:text-teal-100">{totals.pct}%</p>
              </div>
            </div>
          )}
        </header>

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              placeholder="Search by name or city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white/90 py-2.5 pl-10 pr-4 text-sm shadow-sm outline-none ring-teal-500/20 transition focus:border-teal-500/40 focus:ring-4 dark:border-white/10 dark:bg-black/40 dark:text-white"
              autoComplete="off"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm shadow-sm outline-none focus:ring-4 focus:ring-teal-500/20 dark:border-white/10 dark:bg-black/40 dark:text-white"
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
              "gap-2 border-slate-200 dark:border-white/15"
            )}
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} aria-hidden />
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-5 py-4 text-sm text-rose-800 dark:text-rose-200">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <Loader2 className="size-10 animate-spin text-teal-500" aria-hidden />
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading facilities…</p>
          </div>
        ) : facilities.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-slate-200 bg-slate-50/80 px-8 py-20 text-center dark:border-white/10 dark:bg-white/[0.02]">
            <Building2 className="mx-auto mb-4 size-14 text-slate-300 dark:text-slate-600" aria-hidden />
            <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">No facilities match</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
              Try another search, clear filters, or confirm onboarding has created sites for your organization.
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400">
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
