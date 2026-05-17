"use client";

import React from "react";
import type { FacilityRow } from "@/types/facility";

interface FacilityHeaderProps {
  facility: FacilityRow;
}

export function FacilityHeader({ facility }: FacilityHeaderProps) {
  const occupiedBeds = facility.occupancy_count ?? facility.current_occupancy ?? 0;
  const licensedBeds =
    facility.total_licensed_beds ?? facility.licensed_beds ?? facility.total_beds ?? 0;
  const occupancyPercent = licensedBeds > 0 ? Math.round((occupiedBeds / licensedBeds) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Licensed beds</p>
        <p className="mt-2 text-3xl tabular-nums font-semibold text-foreground">{licensedBeds}</p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Occupancy</p>
        <p className="mt-2 text-3xl tabular-nums font-semibold text-foreground">
          {occupancyPercent}%
          <span className="text-xs font-normal text-muted-foreground ml-2 tabular-nums">({occupiedBeds})</span>
        </p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Waitlist</p>
        <p className="mt-2 text-3xl tabular-nums font-semibold text-foreground">{facility.waitlist_count ?? 0}</p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Last survey</p>
        <p className="mt-3 text-sm font-semibold text-foreground">
          {facility.last_survey_date
            ? new Date(facility.last_survey_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "Never"}
        </p>
      </div>
    </div>
  );
}
