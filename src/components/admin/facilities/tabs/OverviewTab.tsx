"use client";

import React, { useMemo, useState } from "react";
import { Loader2, Phone, Mail, AlertTriangle } from "lucide-react";
import { useFacility } from "@/hooks/useFacility";
import { useFacilityBedAvailability } from "@/hooks/useFacilityBedAvailability";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { OccupancyGauge } from "../shared/OccupancyGauge";
import { formatColLabel } from "@/lib/col-labels";
import { RecordDetailSection } from "@/design-system/components/record-detail";

interface OverviewTabProps {
  facilityId: string;
}

const STANDUP_CLASS_LABELS: Record<"private" | "sp_female" | "sp_male" | "sp_flexible", string> = {
  private: formatColLabel("private"),
  sp_female: "Companion (Women)",
  sp_male: "Companion (Men)",
  sp_flexible: "Companion (Any)",
};

function getBedStatusLabel(bed: { current_resident_id: string | null; is_temporarily_blocked: boolean; status: string }) {
  if (bed.current_resident_id) return "Occupied";
  if (bed.is_temporarily_blocked) return "Blocked";
  if (bed.status === "available") return "Open";
  return formatColLabel(bed.status, { fallback: "sentence" });
}

export function OverviewTab({ facilityId }: OverviewTabProps) {
  const { facility, isLoading, error } = useFacility(facilityId);
  const { rows: beds, isLoading: bedsLoading, error: bedsError, isSaving: bedsSaving, canEdit, updateBed } = useFacilityBedAvailability(facilityId);
  const { appRole } = useHavenAuth();
  const [blockedReasonDrafts, setBlockedReasonDrafts] = useState<Record<string, string>>({});
  const [bedFilter, setBedFilter] = useState<"all" | "open" | "blocked" | "unclassified">("all");

  const bedSummary = useMemo(() => {
    const openBeds = beds.filter((bed) => !bed.current_resident_id && !bed.is_temporarily_blocked && bed.status === "available");
    return {
      private: openBeds.filter((bed) => bed.standup_availability_class === "private").length,
      spFemale: openBeds.filter((bed) => bed.standup_availability_class === "sp_female").length,
      spMale: openBeds.filter((bed) => bed.standup_availability_class === "sp_male").length,
      spFlexible: openBeds.filter((bed) => bed.standup_availability_class === "sp_flexible").length,
      blocked: beds.filter((bed) => bed.is_temporarily_blocked).length,
      unclassified: openBeds.filter((bed) => !bed.standup_availability_class).length,
    };
  }, [beds]);

  const filteredBeds = useMemo(() => {
    return beds.filter((bed) => {
      if (bedFilter === "open") return !bed.current_resident_id && !bed.is_temporarily_blocked && bed.status === "available";
      if (bedFilter === "blocked") return bed.is_temporarily_blocked;
      if (bedFilter === "unclassified") return !bed.current_resident_id && !bed.is_temporarily_blocked && bed.status === "available" && !bed.standup_availability_class;
      return true;
    });
  }, [bedFilter, beds]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !facility) {
    return (
      <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3">
        <p className="text-sm text-destructive">{error ?? "Failed to load facility details"}</p>
      </div>
    );
  }

  const occupiedBeds = facility.occupancy_count ?? facility.current_occupancy ?? 0;
  const licensedBeds =
    facility.total_licensed_beds ?? facility.licensed_beds ?? facility.total_beds ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecordDetailSection title="Census">
          <div className="flex justify-center">
            <OccupancyGauge occupied={occupiedBeds} total={licensedBeds} size="lg" />
          </div>
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Current occupancy</span>
              <span className="font-medium tabular-nums text-foreground">{occupiedBeds} residents</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Licensed capacity</span>
              <span className="font-medium tabular-nums text-foreground">{licensedBeds} beds</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Available beds</span>
              <span className="font-medium tabular-nums text-foreground">{licensedBeds - occupiedBeds}</span>
            </div>
          </div>
        </RecordDetailSection>

        <RecordDetailSection title="Key contacts">
          <div className="space-y-4">
            <div className="flex items-start gap-3 pb-4 border-b border-border">
              <div className="rounded-[8px] bg-muted/10 p-2 flex-shrink-0">
                <Phone className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Administrator</p>
                <p className="mt-1 text-sm font-medium text-foreground">{facility.administrator_name ?? "N/A"}</p>
                <p className="text-xs text-muted-foreground">{facility.phone ?? "No phone"}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="rounded-[8px] bg-muted/10 p-2 flex-shrink-0">
                <Mail className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact email</p>
                <p className="mt-1 text-sm font-medium text-foreground truncate">{facility.email ?? "N/A"}</p>
              </div>
            </div>
          </div>
        </RecordDetailSection>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecordDetailSection title="Recent alerts">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
            No active alerts
          </div>
        </RecordDetailSection>

        <RecordDetailSection title="Upcoming expirations">
          {facility.ahca_license_expiration ? (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">AHCA License</span>
              <span className="font-medium tabular-nums text-foreground">
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
        </RecordDetailSection>
      </div>

      <RecordDetailSection title="Last survey">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Survey date</span>
            <span className="font-medium text-foreground">
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
              <span className="font-medium text-foreground">{facility.last_survey_result}</span>
            </div>
          )}
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Standup bed availability model"
        action={
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {canEdit ? `${appRole.replace(/_/g, " ")} can edit` : "Read only"}
          </span>
        }
      >
        <p className="text-sm text-muted-foreground">
          These settings drive the standup bed-by-category breakdown. Keep them current as rooms change or are blocked.
        </p>

        {bedsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading bed inventory…
          </div>
        ) : bedsError ? (
          <p className="text-sm text-destructive">{bedsError}</p>
        ) : beds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No beds found for this facility.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {[
                [`${STANDUP_CLASS_LABELS.private} Open`, bedSummary.private],
                [`${STANDUP_CLASS_LABELS.sp_female} Open`, bedSummary.spFemale],
                [`${STANDUP_CLASS_LABELS.sp_male} Open`, bedSummary.spMale],
                [`${STANDUP_CLASS_LABELS.sp_flexible} Open`, bedSummary.spFlexible],
                ["Blocked", bedSummary.blocked],
                ["Needs Assignment", bedSummary.unclassified],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-[8px] border border-border bg-muted/10 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label as string}</div>
                  <div className="mt-2 text-2xl tabular-nums font-semibold text-foreground">{value as number}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                ["all", "All beds"],
                ["open", "Open only"],
                ["blocked", "Blocked"],
                ["unclassified", "Needs assignment"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setBedFilter(value as "all" | "open" | "blocked" | "unclassified")}
                  className={`rounded-[8px] border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest transition ${
                    bedFilter === value
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border bg-transparent text-muted-foreground hover:bg-muted/10"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2">Room</th>
                    <th className="px-3 py-2">Bed</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Availability type</th>
                    <th className="px-3 py-2">Blocked</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBeds.map((bed) => (
                    <tr key={bed.id} className="border-b border-border/50 align-top">
                      <td className="px-3 py-3 text-foreground">{bed.room_number}</td>
                      <td className="px-3 py-3 text-foreground">{bed.bed_label}</td>
                      <td className="px-3 py-3 text-muted-foreground">{getBedStatusLabel(bed)}</td>
                      <td className="px-3 py-3">
                        <select
                          className="w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground"
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
                          <option value="">Needs assignment</option>
                          <option value="private">{STANDUP_CLASS_LABELS.private}</option>
                          <option value="sp_female">{STANDUP_CLASS_LABELS.sp_female}</option>
                          <option value="sp_male">{STANDUP_CLASS_LABELS.sp_male}</option>
                          <option value="sp_flexible">{STANDUP_CLASS_LABELS.sp_flexible}</option>
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <label className="inline-flex items-center gap-2 text-foreground">
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
                          className="w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground"
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
                          className="rounded-[8px] border border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-foreground hover:bg-muted/10 disabled:opacity-50"
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
          </div>
        )}
      </RecordDetailSection>
    </div>
  );
}
