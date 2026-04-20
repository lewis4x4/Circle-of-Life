"use client";

import React, { useState } from "react";
import { Loader2, Calendar, Phone, Mail, AlertTriangle, Clock } from "lucide-react";
import { useFacility } from "@/hooks/useFacility";
import { useFacilityBedAvailability } from "@/hooks/useFacilityBedAvailability";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { OccupancyGauge } from "../shared/OccupancyGauge";

interface OverviewTabProps {
  facilityId: string;
}

export function OverviewTab({ facilityId }: OverviewTabProps) {
  const { facility, isLoading, error } = useFacility(facilityId);
  const { rows: beds, isLoading: bedsLoading, error: bedsError, isSaving: bedsSaving, canEdit, updateBed } = useFacilityBedAvailability(facilityId);
  const { appRole } = useHavenAuth();
  const [blockedReasonDrafts, setBlockedReasonDrafts] = useState<Record<string, string>>({});

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

  const occupiedBeds = facility.occupancy_count ?? facility.current_occupancy ?? 0;
  const licensedBeds =
    facility.total_beds ?? facility.licensed_beds ?? facility.total_licensed_beds ?? 0;

  return (
    <div className="space-y-6">
      {/* Left and right columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left Column: Occupancy Gauge */}
        <div className="rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6 space-y-6">
          <h3 className="text-sm font-semibold text-white">Census</h3>
          <div className="flex justify-center">
            <OccupancyGauge occupied={occupiedBeds} total={licensedBeds} size="lg" />
          </div>
          <div className="space-y-3 border-t border-white/5 pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Current Occupancy</span>
              <span className="font-medium">{occupiedBeds} residents</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Licensed Capacity</span>
              <span className="font-medium">{licensedBeds} beds</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Available Beds</span>
              <span className="font-medium">{licensedBeds - occupiedBeds}</span>
            </div>
          </div>
        </div>

        {/* Right Column: Key Contacts */}
        <div className="rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6 space-y-6">
          <h3 className="text-sm font-semibold text-white">Key Contacts</h3>
          <div className="space-y-4">
            {/* Administrator */}
            <div className="flex items-start gap-3 pb-4 border-b border-white/5">
              <div className="rounded-full bg-teal-500/100/20 p-2 flex-shrink-0">
                <Phone className="h-4 w-4 text-teal-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Administrator</p>
                <p className="mt-1 text-sm font-medium text-slate-200">{facility.administrator_name ?? "N/A"}</p>
                <p className="text-xs text-slate-400">{facility.phone ?? "No phone"}</p>
              </div>
            </div>

            {/* Contact Email */}
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-teal-500/100/20 p-2 flex-shrink-0">
                <Mail className="h-4 w-4 text-teal-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Contact Email</p>
                <p className="mt-1 text-sm font-medium text-slate-200 truncate">{facility.email ?? "N/A"}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Alerts and Expirations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Alerts */}
        <div className="rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6 space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Recent Alerts
          </h3>
          <div className="space-y-2">
            <p className="text-sm text-slate-400">No active alerts</p>
          </div>
        </div>

        {/* Upcoming Expirations */}
        <div className="rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6 space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Clock className="h-5 w-5 text-teal-500" />
            Upcoming Expirations
          </h3>
          <div className="space-y-2">
            {facility.ahca_license_expiration ? (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">AHCA License</span>
                <span className="font-medium">
                  {new Date(facility.ahca_license_expiration).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No expirations scheduled</p>
            )}
          </div>
        </div>
      </div>

      {/* Last Survey Result */}
      <div className="rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
          <Calendar className="h-5 w-5 text-teal-500" />
          Last Survey
        </h3>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Survey Date</span>
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
              <span className="text-slate-400">Result</span>
              <span className="font-medium">{facility.last_survey_result}</span>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Standup bed availability model</h3>
            <p className="mt-1 text-sm text-slate-400">
              These settings drive the standup bed-by-category breakdown. Keep them current as rooms change or are blocked.
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-widest font-mono text-slate-500">
            {canEdit ? `${appRole.replace(/_/g, " ")} can edit` : "Read only"}
          </div>
        </div>

        {bedsLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading bed inventory…
          </div>
        ) : bedsError ? (
          <p className="text-sm text-rose-400">{bedsError}</p>
        ) : beds.length === 0 ? (
          <p className="text-sm text-slate-400">No beds found for this facility.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="px-3 py-2">Room</th>
                  <th className="px-3 py-2">Bed</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Standup class</th>
                  <th className="px-3 py-2">Blocked</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {beds.map((bed) => (
                  <tr key={bed.id} className="border-b border-white/5 align-top">
                    <td className="px-3 py-3 text-slate-200">{bed.room_number}</td>
                    <td className="px-3 py-3 text-slate-200">{bed.bed_label}</td>
                    <td className="px-3 py-3 text-slate-400">{bed.current_resident_id ? "Occupied" : bed.status}</td>
                    <td className="px-3 py-3">
                      <select
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                        value={bed.standup_availability_class ?? ""}
                        disabled={!canEdit || bedsSaving}
                        onChange={(event) =>
                          void updateBed(bed.id, {
                            standup_availability_class:
                              event.target.value === ""
                                ? null
                                : (event.target.value as "private" | "sp_female" | "sp_male" | "sp_flexible"),
                            is_temporarily_blocked: bed.is_temporarily_blocked,
                            blocked_reason: blockedReasonDrafts[bed.id] ?? bed.blocked_reason,
                          })
                        }
                      >
                        <option value="">Unset</option>
                        <option value="private">Private</option>
                        <option value="sp_female">SP Female</option>
                        <option value="sp_male">SP Male</option>
                        <option value="sp_flexible">SP Flexible</option>
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <label className="inline-flex items-center gap-2 text-slate-300">
                        <input
                          type="checkbox"
                          checked={bed.is_temporarily_blocked}
                          disabled={!canEdit || bedsSaving}
                          onChange={(event) =>
                            void updateBed(bed.id, {
                              standup_availability_class: bed.standup_availability_class,
                              is_temporarily_blocked: event.target.checked,
                              blocked_reason: blockedReasonDrafts[bed.id] ?? bed.blocked_reason,
                            })
                          }
                        />
                        Yes
                      </label>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                        value={blockedReasonDrafts[bed.id] ?? bed.blocked_reason ?? ""}
                        disabled={!canEdit || bedsSaving}
                        placeholder="Blocked reason"
                        onChange={(event) =>
                          setBlockedReasonDrafts((current) => ({ ...current, [bed.id]: event.target.value }))
                        }
                      />
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-slate-200 hover:bg-white/5 disabled:opacity-50"
                        disabled={!canEdit || bedsSaving}
                        onClick={() =>
                          void updateBed(bed.id, {
                            standup_availability_class: bed.standup_availability_class,
                            is_temporarily_blocked: bed.is_temporarily_blocked,
                            blocked_reason: blockedReasonDrafts[bed.id] ?? bed.blocked_reason,
                          })
                        }
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
