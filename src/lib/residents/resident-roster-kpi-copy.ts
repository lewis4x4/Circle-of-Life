/**
 * Quiet Operator copy for resident roster KPI tiles when server metrics are absent.
 * Copy reflects real data gaps — never fabricates occupancy, open-bed, or review counts.
 */

import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

import type { ResidentRosterMetrics } from "./resident-roster-metrics";

export type ResidentRosterServerKpiKey = "open_beds" | "care_plan_reviews";

const EMPTY_COPY: Record<
  ResidentRosterServerKpiKey,
  { noScope: string; notLoaded: string; partial?: string }
> = {
  open_beds: {
    noScope: "Select a facility to load capacity",
    notLoaded: "Capacity not loaded yet",
    partial: "Licensed beds not on file",
  },
  care_plan_reviews: {
    noScope: "Select a facility to load reviews",
    notLoaded: "Review schedule not loaded yet",
  },
};

/** Whether the roster can query facility-scoped capacity and care-plan metrics. */
export function residentRosterFacilityScopeReady(facilityId: string | null): boolean {
  return isValidFacilityIdForQuery(facilityId);
}

/** One-line reason the open-beds tile is empty instead of showing a count. */
export function residentRosterOpenBedsEmptyCopy(
  facilityId: string | null,
  metrics: ResidentRosterMetrics | null,
): string | null {
  if (!residentRosterFacilityScopeReady(facilityId)) {
    return EMPTY_COPY.open_beds.noScope;
  }
  if (metrics == null) {
    return EMPTY_COPY.open_beds.notLoaded;
  }
  if (metrics.licensedBeds == null) {
    return EMPTY_COPY.open_beds.partial ?? EMPTY_COPY.open_beds.notLoaded;
  }
  if (metrics.openBeds == null) {
    return EMPTY_COPY.open_beds.notLoaded;
  }
  return null;
}

/** One-line reason the care-plan review tile is empty instead of showing a count. */
export function residentRosterCarePlanReviewsEmptyCopy(
  facilityId: string | null,
  metrics: ResidentRosterMetrics | null,
): string | null {
  if (!residentRosterFacilityScopeReady(facilityId)) {
    return EMPTY_COPY.care_plan_reviews.noScope;
  }
  if (metrics == null || metrics.carePlanReviewsDueWeek == null) {
    return EMPTY_COPY.care_plan_reviews.notLoaded;
  }
  return null;
}

/** Short qualifier when open beds are loaded — census vs licensed capacity. */
export function rosterOpenBedsLoadedFootnote(metrics: ResidentRosterMetrics): string | null {
  if (metrics.openBeds == null || metrics.licensedBeds == null) return null;
  return `${metrics.occupiedResidents} in census · ${metrics.licensedBeds} licensed beds`;
}

/** Summary line under the KPI strip — makes loaded vs empty facility metrics obvious. */
export function residentRosterKpiStripHelperLine(
  facilityId: string | null,
  openBedsLoaded: boolean,
  careReviewsLoaded: boolean,
): string {
  const serverKpiTotal = 2;
  const loadedCount = (openBedsLoaded ? 1 : 0) + (careReviewsLoaded ? 1 : 0);

  if (!residentRosterFacilityScopeReady(facilityId)) {
    return "Select a facility in the header — capacity and review tiles load per site.";
  }
  if (loadedCount >= serverKpiTotal) {
    return "Capacity and review schedule loaded for the selected facility.";
  }
  if (loadedCount === 0) {
    return "Empty tiles name what is still missing — nothing is broken.";
  }
  return `${loadedCount} of ${serverKpiTotal} facility metrics loaded — empty tiles name what is still missing.`;
}
