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

/**
 * Line under the summary strip — only speaks when a facility figure is missing.
 * "Loaded" confirms retrieval, not completeness, so a fully loaded strip says nothing.
 */
export function residentRosterKpiStripHelperLine(
  facilityId: string | null,
  openBedsLoaded: boolean,
  careReviewsLoaded: boolean,
): string | null {
  const serverKpiTotal = 2;
  const loadedCount = (openBedsLoaded ? 1 : 0) + (careReviewsLoaded ? 1 : 0);

  if (!residentRosterFacilityScopeReady(facilityId)) {
    return "Select a facility in the header — capacity and care plan figures load per site.";
  }
  if (loadedCount >= serverKpiTotal) {
    return null;
  }
  if (loadedCount === 0) {
    return "Capacity and care plan figures did not load — the empty cells name what is missing.";
  }
  return `${loadedCount} of ${serverKpiTotal} facility figures loaded — the empty cell names what is missing.`;
}
