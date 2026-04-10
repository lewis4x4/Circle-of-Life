"use client";

import React from "react";
import { Loader2, Calendar, Phone, Mail, AlertTriangle, Clock } from "lucide-react";
import { useFacility } from "@/hooks/useFacility";
import { OccupancyGauge } from "../shared/OccupancyGauge";

interface OverviewTabProps {
  facilityId: string;
}

export function OverviewTab({ facilityId }: OverviewTabProps) {
  const { facility, isLoading, error } = useFacility(facilityId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error || !facility) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
        <p className="text-sm text-destructive">{error ?? "Failed to load facility details"}</p>
      </div>
    );
  }

  const occupiedBeds = facility.current_occupancy ?? 0;
  const licensedBeds = facility.licensed_beds ?? 0;

  return (
    <div className="space-y-6">
      {/* Left and right columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left Column: Occupancy Gauge */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-6">
          <h3 className="text-lg font-semibold">Census</h3>
          <div className="flex justify-center">
            <OccupancyGauge occupied={occupiedBeds} total={licensedBeds} size="lg" />
          </div>
          <div className="space-y-3 border-t border-gray-100 pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Current Occupancy</span>
              <span className="font-medium">{occupiedBeds} residents</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Licensed Capacity</span>
              <span className="font-medium">{licensedBeds} beds</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Available Beds</span>
              <span className="font-medium">{licensedBeds - occupiedBeds}</span>
            </div>
          </div>
        </div>

        {/* Right Column: Key Contacts */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-6">
          <h3 className="text-lg font-semibold">Key Contacts</h3>
          <div className="space-y-4">
            {/* Administrator */}
            <div className="flex items-start gap-3 pb-4 border-b border-gray-100">
              <div className="rounded-full bg-teal-100 p-2 flex-shrink-0">
                <Phone className="h-4 w-4 text-teal-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Administrator</p>
                <p className="mt-1 text-sm font-medium text-gray-900">{facility.administrator_name ?? "N/A"}</p>
                <p className="text-xs text-muted-foreground">{facility.administrator_phone ?? "No phone"}</p>
              </div>
            </div>

            {/* Contact Email */}
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-teal-100 p-2 flex-shrink-0">
                <Mail className="h-4 w-4 text-teal-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact Email</p>
                <p className="mt-1 text-sm font-medium text-gray-900 truncate">{facility.email ?? "N/A"}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Alerts and Expirations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Alerts */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Recent Alerts
          </h3>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">No active alerts</p>
          </div>
        </div>

        {/* Upcoming Expirations */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-teal-500" />
            Upcoming Expirations
          </h3>
          <div className="space-y-2">
            {facility.ahca_license_expiration ? (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">AHCA License</span>
                <span className="font-medium">
                  {new Date(facility.ahca_license_expiration).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No expirations scheduled</p>
            )}
          </div>
        </div>
      </div>

      {/* Last Survey Result */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Calendar className="h-5 w-5 text-teal-500" />
          Last Survey
        </h3>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Survey Date</span>
            <span className="font-medium">
              {facility.last_survey_date
                ? new Date(facility.last_survey_date).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })
                : "No survey yet"}
            </span>
          </div>
          {facility.last_survey_result && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Result</span>
              <span className="font-medium">{facility.last_survey_result}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
