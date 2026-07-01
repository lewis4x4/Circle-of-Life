"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Phone, Mail, CircleCheck } from "lucide-react";

import { useFacilityBedAvailability } from "@/hooks/useFacilityBedAvailability";
import type { FacilityDetailRow } from "@/types/facility";
import { OccupancyGauge } from "../shared/OccupancyGauge";
import { formatColLabel } from "@/lib/col-labels";
import { surveyResultDisplayLabel } from "@/lib/admin/facilities/facility-constants";
import { portfolioOccupancyKpiTextClass } from "@/lib/admin/facilities/portfolio-metrics";
import { createClient } from "@/lib/supabase/client";
import { fetchPresenceCensus, presenceSummaryText, type PresenceCensus } from "@/lib/executive/presence-census";
import { cn } from "@/lib/utils";
import { RecordDetailSection } from "@/design-system/components/record-detail";

interface OverviewTabProps {
  facilityId: string;
  facility: FacilityDetailRow;
  enableBedAvailability?: boolean;
}

const STANDUP_CLASS_LABELS: Record<"private" | "sp_female" | "sp_male" | "sp_flexible", string> = {
  private: formatColLabel("private"),
  sp_female: "Companion (women)",
  sp_male: "Companion (men)",
  sp_flexible: "Companion (any)",
};

function getBedStatusLabel(bed: { current_resident_id: string | null; is_temporarily_blocked: boolean; status: string }) {
  if (bed.current_resident_id) return "Occupied";
  if (bed.is_temporarily_blocked) return "Blocked";
  if (bed.status === "available") return "Open";
  return formatColLabel(bed.status, { fallback: "sentence" });
}

export function OverviewTab({
  facilityId,
  facility,
  enableBedAvailability = true,
}: OverviewTabProps) {
  const [shouldLoadBedAvailability, setShouldLoadBedAvailability] = useState(false);
  const bedAvailabilitySectionRef = useRef<HTMLDivElement | null>(null);
  const { rows: beds, isLoading: bedsLoading, error: bedsError, isSaving: bedsSaving, canEdit, updateBed } =
    useFacilityBedAvailability(facilityId, { enabled: shouldLoadBedAvailability });
  const [blockedReasonDrafts, setBlockedReasonDrafts] = useState<Record<string, string>>({});
  const [bedFilter, setBedFilter] = useState<"all" | "open" | "blocked" | "unclassified">("all");

  // Facility-scoped presence split (in-house vs on-hold) for the Census panel.
  const [presence, setPresence] = useState<PresenceCensus | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPresenceCensus(createClient(), facility.organization_id, facilityId)
      .then((result) => {
        if (!cancelled) setPresence(result);
      })
      .catch(() => {
        if (!cancelled) setPresence(null);
      });
    return () => {
      cancelled = true;
    };
  }, [facility.organization_id, facilityId]);

  const bedsRef = useRef(beds);

  useEffect(() => {
    if (!enableBedAvailability || shouldLoadBedAvailability) return;

    const section = bedAvailabilitySectionRef.current;
    if (!section || typeof IntersectionObserver === "undefined") {
      const timeoutId = window.setTimeout(() => {
        setShouldLoadBedAvailability(true);
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoadBedAvailability(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, [enableBedAvailability, shouldLoadBedAvailability]);

  useEffect(() => {
    bedsRef.current = beds;
  }, [beds]);

  const bedSummary = useMemo(() => {
    const openBeds = beds.filter((bed) => !bed.current_resident_id && !bed.is_temporarily_blocked && bed.status === "available");
    const openAssignable = openBeds.length;
    return {
      openAssignable,
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
      if (bedFilter === "unclassified")
        return (
          !bed.current_resident_id &&
          !bed.is_temporarily_blocked &&
          bed.status === "available" &&
          !bed.standup_availability_class
        );
      return true;
    });
  }, [bedFilter, beds]);

  useEffect(() => {
    if (!canEdit) return;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const bedId of Object.keys(blockedReasonDrafts)) {
      const draft = blockedReasonDrafts[bedId] ?? "";
      const row = bedsRef.current.find((b) => b.id === bedId);
      if (!row) continue;
      const serverVal = row.blocked_reason ?? "";
      if (draft === serverVal) continue;
      const tid = setTimeout(() => {
        const latest = bedsRef.current.find((b) => b.id === bedId);
        if (!latest) return;
        void updateBed(bedId, {
          standup_availability_class: latest.standup_availability_class,
          is_temporarily_blocked: latest.is_temporarily_blocked,
          blocked_reason: draft === "" ? null : draft,
        });
      }, 550);
      timers.push(tid);
    }
    return () => timers.forEach((t) => clearTimeout(t));
  }, [blockedReasonDrafts, canEdit, updateBed]);

  const occupiedBeds = facility.occupancy_count ?? facility.current_occupancy ?? 0;
  const licensedBeds =
    facility.total_licensed_beds ?? facility.licensed_beds ?? facility.total_beds ?? 0;
  const denomBeds =
    licensedBeds > 0 ? licensedBeds : beds.length > 0 ? beds.length : licensedBeds;
  const occupancyPct =
    denomBeds > 0 ? Math.min(100, Math.max(0, Math.round((occupiedBeds / denomBeds) * 100))) : 0;

  const standupSubtitle = [
    `${bedSummary.private} private open`,
    `${bedSummary.spFemale} companion (women)`,
    `${bedSummary.spMale} companion (men)`,
    `${bedSummary.spFlexible} companion (any)`,
    `${bedSummary.blocked} blocked`,
  ].join(" · ");

  const standupHeadline =
    bedSummary.openAssignable === 0
      ? "No vacant beds to categorize right now."
      : bedSummary.unclassified === 0
        ? "All vacant beds are categorized."
        : `${bedSummary.unclassified} of ${bedSummary.openAssignable} open beds need assignment.`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecordDetailSection title="Census">
          {occupiedBeds > 0 ? (
            <div className="flex justify-center">
              <OccupancyGauge occupied={occupiedBeds} total={denomBeds} size="lg" portfolioSemantics />
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">No occupied beds · census breakdown below</p>
          )}
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-[13px] text-muted-foreground">Occupancy</span>
              <span className="font-medium tabular-nums text-foreground">
                <span className={cn(portfolioOccupancyKpiTextClass(occupancyPct))}>{occupancyPct}%</span>
                <span className="text-muted-foreground"> · </span>
                <span>
                  {occupiedBeds} of {denomBeds} beds occupied
                </span>
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[13px] text-muted-foreground">Current residents</span>
              <span className="font-medium tabular-nums text-foreground">{occupiedBeds}</span>
            </div>
            {presence && presence.total > 0 ? (
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-[13px] text-muted-foreground">Presence</span>
                <span className="text-right font-medium tabular-nums text-foreground">
                  {presenceSummaryText(presence)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between text-sm">
              <span className="text-[13px] text-muted-foreground">Licensed capacity</span>
              <span className="font-medium tabular-nums text-foreground">{licensedBeds} beds</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[13px] text-muted-foreground">Available beds</span>
              <span className="font-medium tabular-nums text-foreground">{Math.max(0, licensedBeds - occupiedBeds)}</span>
            </div>
          </div>
        </RecordDetailSection>

        <RecordDetailSection title="Key contacts">
          <div className="space-y-4">
            <div className="flex items-start gap-3 border-b border-border pb-4">
              <div className="flex-shrink-0 rounded-[8px] bg-muted/10 p-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-muted-foreground">Administrator</p>
                <p className="mt-1 text-sm font-medium text-foreground">{facility.administrator_name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{facility.phone ?? "No phone"}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 rounded-[8px] bg-muted/10 p-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-muted-foreground">Contact email</p>
                <p className="mt-1 truncate text-sm font-medium text-foreground">{facility.email ?? "—"}</p>
              </div>
            </div>
          </div>
        </RecordDetailSection>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecordDetailSection title="Recent alerts">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheck className="h-4 w-4 flex-shrink-0 text-success/80" aria-hidden />
            <span>No active alerts</span>
          </div>
        </RecordDetailSection>

        <RecordDetailSection title="Upcoming expirations">
          {facility.ahca_license_expiration ? (
            <div className="flex justify-between text-sm">
              <span className="text-[13px] text-muted-foreground">AHCA license</span>
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
            <span className="text-[13px] text-muted-foreground">Survey date</span>
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
              <span className="text-[13px] text-muted-foreground">Result</span>
              <span className="font-medium text-foreground">
                {surveyResultDisplayLabel(facility.last_survey_result)}
              </span>
            </div>
          )}
        </div>
      </RecordDetailSection>

      <div ref={bedAvailabilitySectionRef}>
        <RecordDetailSection
          title="Standup bed availability"
        description={
          canEdit
            ? "Keeps vacant-bed buckets accurate for census and admissions standups. Owner-editable."
            : "Keeps vacant-bed buckets accurate for census and admissions standups."
        }
      >
        {!shouldLoadBedAvailability ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading bed inventory when this section is in view…
          </div>
        ) : bedsLoading ? (
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
            <div className="rounded-lg border border-border bg-muted/5 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{standupHeadline}</p>
              <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">{standupSubtitle}</p>
            </div>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Bed filters">
              {(
                [
                  ["all", "All beds"],
                  ["open", "Open only"],
                  ["blocked", "Blocked"],
                  ["unclassified", "Needs assignment"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setBedFilter(value)}
                  className={cn(
                    "rounded-[8px] border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    bedFilter === value
                      ? "border-primary bg-secondary text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-3 py-2 text-[12px] font-medium text-muted-foreground">Room</th>
                    <th className="px-3 py-2 text-[12px] font-medium text-muted-foreground">Bed</th>
                    <th className="px-3 py-2 text-[12px] font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-[12px] font-medium text-muted-foreground">Availability type</th>
                    <th className="px-3 py-2 text-[12px] font-medium text-muted-foreground">Blocked</th>
                    <th className="px-3 py-2 text-[12px] font-medium text-muted-foreground">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBeds.map((bed) => (
                    <tr key={bed.id} className="border-b border-border/50 align-top">
                      <td className="px-3 py-3 tabular-nums text-foreground">{bed.room_number}</td>
                      <td className="px-3 py-3 tabular-nums text-foreground">{bed.bed_label}</td>
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
                        <label className="inline-flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            className="rounded border-border"
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
                          Blocked
                        </label>
                      </td>
                      <td className="px-3 py-3">
                        <input
                          className="w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                          value={blockedReasonDrafts[bed.id] ?? bed.blocked_reason ?? ""}
                          disabled={!canEdit || bedsSaving}
                          placeholder="Reason if blocked"
                          onChange={(event) =>
                            setBlockedReasonDrafts((current) => ({
                              ...current,
                              [bed.id]: event.target.value,
                            }))
                          }
                        />
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
    </div>
  );
}
