"use client";

import React from "react";
import type { FacilityRow } from "@/types/facility";

interface FacilityHeaderProps {
  facility: FacilityRow;
}

export function FacilityHeader({ facility }: FacilityHeaderProps) {
  const occupiedBeds = facility.current_occupancy ?? 0;
  const licensedBeds = facility.licensed_beds ?? 0;
  const occupancyPercent = licensedBeds > 0 ? Math.round((occupiedBeds / licensedBeds) * 100) : 0;

  // Determine status badge color
  let statusColor = "bg-green-100 text-green-800"; // Active
  let statusText = "Active";
  if (facility.status === "inactive") {
    statusColor = "bg-gray-100 text-gray-800";
    statusText = "Inactive";
  } else if (facility.status === "pending") {
    statusColor = "bg-blue-100 text-blue-800";
    statusText = "Pending";
  }

  return (
    <div className="space-y-4">
      {/* Title and status */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{facility.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{facility.entity_name ?? "Organization"}</p>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${statusColor}`}>
          {statusText}
        </span>
      </div>

      {/* Quick stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Licensed Beds</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{licensedBeds}</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Occupancy</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">
            {occupancyPercent}%
            <span className="text-xs font-normal text-muted-foreground ml-1">({occupiedBeds})</span>
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Waitlist</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{facility.waitlist_count ?? 0}</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Last Survey</p>
          <p className="mt-2 text-sm font-medium text-gray-900">
            {facility.last_survey_date
              ? new Date(facility.last_survey_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "Never"}
          </p>
        </div>
      </div>
    </div>
  );
}
