"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, MapPin } from "lucide-react";
import type { FacilityRow } from "@/types/facility";
import { OccupancyGauge } from "./shared/OccupancyGauge";
import { AlertCountBadge } from "./shared/AlertCountBadge";
import { cn } from "@/lib/utils";

interface FacilityCardProps {
  facility: FacilityRow;
  redAlertCount?: number;
  yellowAlertCount?: number;
}

export function FacilityCard({ facility, redAlertCount = 0, yellowAlertCount = 0 }: FacilityCardProps) {
  const occupiedBeds = facility.occupancy_count ?? facility.current_occupancy ?? 0;
  const bedRowsTotal = facility.total_beds ?? 0;
  const licensedCapacity = facility.total_licensed_beds ?? facility.licensed_beds ?? 0;
  // If bed census rows are not seeded yet, fall back to licensed capacity for a meaningful %.
  const totalForGauge = bedRowsTotal > 0 ? bedRowsTotal : licensedCapacity;
  const administratorName = facility.administrator_name?.trim() || "Unassigned";
  const city = facility.city ?? "";
  const county = facility.county ?? "";
  const location = [city, county].filter(Boolean).join(", ");
  const status = facility.status ?? "active";

  return (
    <Link href={`/admin/facilities/${facility.id}`} className="group block h-full outline-none">
      <article
        className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white/90 p-6 shadow-sm transition-all duration-300",
          "dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
          "hover:-translate-y-0.5 hover:border-teal-400/50 hover:shadow-lg hover:shadow-teal-500/5",
          "focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-400/30 to-transparent opacity-0 transition group-hover:opacity-100" />

        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold leading-snug tracking-tight text-slate-900 transition group-hover:text-teal-700 dark:text-white dark:group-hover:text-teal-300">
                {facility.name}
              </h3>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                {status.replace(/_/g, " ")}
              </span>
            </div>
            {location ? (
              <div className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                <MapPin className="size-3.5 shrink-0 opacity-70" aria-hidden />
                <span className="truncate">{location}</span>
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {redAlertCount > 0 && <AlertCountBadge count={redAlertCount} severity="red" />}
            {yellowAlertCount > 0 && <AlertCountBadge count={yellowAlertCount} severity="yellow" />}
            <span
              className="flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 transition group-hover:border-teal-500/30 group-hover:bg-teal-500/10 group-hover:text-teal-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-500 dark:group-hover:text-teal-400"
              aria-hidden
            >
              <ArrowUpRight className="size-4" />
            </span>
          </div>
        </div>

        <div className="mb-5">
          <OccupancyGauge occupied={occupiedBeds} total={totalForGauge} size="sm" />
        </div>

        <dl className="mt-auto space-y-2 border-t border-slate-100 pt-4 text-sm dark:border-white/10">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">Licensed capacity</dt>
            <dd className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">{licensedCapacity}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">Administrator</dt>
            <dd className="max-w-[55%] truncate text-right font-medium text-slate-900 dark:text-slate-100" title={administratorName}>
              {administratorName}
            </dd>
          </div>
        </dl>
      </article>
    </Link>
  );
}
