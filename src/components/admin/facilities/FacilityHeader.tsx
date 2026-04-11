"use client";

import React from "react";
import type { FacilityRow } from "@/types/facility";

interface FacilityHeaderProps {
  facility: FacilityRow;
}

export function FacilityHeader({ facility }: FacilityHeaderProps) {
  const occupiedBeds = facility.occupancy_count ?? facility.current_occupancy ?? 0;
  const licensedBeds =
    facility.total_beds ?? facility.licensed_beds ?? facility.total_licensed_beds ?? 0;
  const occupancyPercent = licensedBeds > 0 ? Math.round((occupiedBeds / licensedBeds) * 100) : 0;

  // Determine status badge color
  let statusColor = "bg-green-100 text-green-800"; // Active
  let statusText = "Active";
  if (facility.status === "inactive") {
    statusColor = "bg-gray-100 text-gray-800";
    statusText = "Inactive";
  } else if (facility.status === "under_renovation") {
    statusColor = "bg-amber-100 text-amber-900";
    statusText = "Under renovation";
  } else if (facility.status === "archived") {
    statusColor = "bg-slate-100 text-slate-800";
    statusText = "Archived";
  }

  return (
    <div className="space-y-4">
      {/* Title and status */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl lg:text-5xl font-display font-light text-slate-900 dark:text-white mb-2">{facility.name}</h1>
          <p className="text-[10px] font-mono tracking-widest uppercase text-slate-500 dark:text-slate-400 mt-1">{facility.entity_name ?? "Organization"}</p>
        </div>
        <span className={`inline-flex items-center px-3 py-1 mt-2 rounded-full text-[10px] uppercase tracking-widest font-bold ${statusColor}`}>
          {statusText}
        </span>
      </div>

      {/* Quick stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mt-6">
        <div className="rounded-[1.5rem] border border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-black/20 p-5 shadow-sm backdrop-blur-2xl">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 dark:text-slate-400">Licensed Beds</p>
          <p className="mt-2 font-mono text-3xl tracking-tighter text-slate-800 dark:text-slate-100">{licensedBeds}</p>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-black/20 p-5 shadow-sm backdrop-blur-2xl">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 dark:text-slate-400">Occupancy</p>
          <p className="mt-2 font-mono text-3xl tracking-tighter text-slate-800 dark:text-slate-100">
            {occupancyPercent}%
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-2">({occupiedBeds})</span>
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-black/20 p-5 shadow-sm backdrop-blur-2xl">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 dark:text-slate-400">Waitlist</p>
          <p className="mt-2 font-mono text-3xl tracking-tighter text-slate-800 dark:text-slate-100">{facility.waitlist_count ?? 0}</p>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-black/20 p-5 shadow-sm backdrop-blur-2xl">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 dark:text-slate-400">Last Survey</p>
          <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100 tracking-wide mt-3">
            {facility.last_survey_date
              ? new Date(facility.last_survey_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "Never"}
          </p>
        </div>
      </div>
    </div>
  );
}
