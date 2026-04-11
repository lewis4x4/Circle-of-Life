"use client";

import React from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import type { FacilityRow } from "@/types/facility";
import { OccupancyGauge } from "./shared/OccupancyGauge";
import { AlertCountBadge } from "./shared/AlertCountBadge";

interface FacilityCardProps {
  facility: FacilityRow;
  redAlertCount?: number;
  yellowAlertCount?: number;
}

export function FacilityCard({ facility, redAlertCount = 0, yellowAlertCount = 0 }: FacilityCardProps) {
  const occupiedBeds = facility.occupancy_count ?? facility.current_occupancy ?? 0;
  const licensedBeds = facility.total_beds ?? facility.licensed_beds ?? facility.total_licensed_beds ?? 0;
  const administratorName = facility.administrator_name ?? "Unassigned";
  const city = facility.city ?? "";
  const county = facility.county ?? "";
  const location = [city, county].filter(Boolean).join(", ");

  return (
    <Link href={`/admin/facilities/${facility.id}`}>
      <div className="group rounded-lg border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-all hover:border-teal-300 cursor-pointer">
        {/* Header: Name + Alert Badges */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900 group-hover:text-teal-600 transition-colors">
              {facility.name}
            </h3>
            {location && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                <MapPin className="h-4 w-4" />
                {location}
              </div>
            )}
          </div>

          {/* Alert badges */}
          <div className="flex gap-2">
            {redAlertCount > 0 && <AlertCountBadge count={redAlertCount} severity="red" />}
            {yellowAlertCount > 0 && <AlertCountBadge count={yellowAlertCount} severity="yellow" />}
          </div>
        </div>

        {/* Occupancy gauge */}
        <div className="mb-4">
          <OccupancyGauge occupied={occupiedBeds} total={licensedBeds} size="sm" />
        </div>

        {/* Quick stats */}
        <div className="space-y-2 text-sm border-t border-gray-100 pt-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Licensed Beds</span>
            <span className="font-medium">{licensedBeds}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Administrator</span>
            <span className="font-medium">{administratorName}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
