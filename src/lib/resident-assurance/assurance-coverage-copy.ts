/**
 * Rounding assurance copy for leadership surfaces.
 *
 * A facility with nothing recorded and a facility with nothing wrong produce
 * the same counts. These helpers keep the two apart, and name what the system
 * does not record at all rather than implying it was checked.
 */

import { formatDisplayDate } from "@/lib/format/datetime";
import type {
  ResidentAssuranceFacilityRollup,
  ResidentAssuranceFacilityTrendRow,
} from "@/lib/resident-assurance/command-center-brief";

export const ROUNDING_NOT_OBSERVED_LABEL = "Not observed";

const BAND_LABEL: Record<ResidentAssuranceFacilityRollup["heatBand"], string> = {
  stable: "Low",
  watch: "Watch",
  elevated: "Elevated",
  critical: "Critical",
};

/**
 * Expected-versus-completed rounding is not recorded anywhere in Haven today:
 * there is no rounding schedule table to compare against. The page says so
 * rather than presenting recorded activity as full coverage.
 */
export const ROUNDING_EXPECTATION_NOT_RECORDED_COPY =
  "Haven records rounding findings, not a rounding schedule, so completed-versus-expected rounds cannot be shown here.";

export function roundingBandLabel(row: {
  observed: boolean;
  heatBand: ResidentAssuranceFacilityRollup["heatBand"];
}): string {
  return row.observed ? BAND_LABEL[row.heatBand] : ROUNDING_NOT_OBSERVED_LABEL;
}

/** Last recorded observation for a facility — or a plain statement that there is none. */
export function roundingLastObservedLine(lastObservedAt: string | null): string {
  if (!lastObservedAt) return "Nothing recorded yet";
  return formatDisplayDate(lastObservedAt, { fallback: "Nothing recorded yet" });
}

/** Coverage of a facility's day series: how many of the days carry any record. */
export function roundingTrendCoverageLine(row: Pick<ResidentAssuranceFacilityTrendRow, "observedDays" | "days">): string {
  if (row.days === 0) return "No days in range";
  if (row.observedDays === 0) return `0 of ${row.days} days recorded`;
  return `${row.observedDays} of ${row.days} days recorded`;
}

/** Counts are only readable as results where something was recorded. */
export function roundingCountsMeaningLine(observed: boolean): string {
  return observed
    ? "Counts are open items recorded for this facility."
    : "Nothing has been recorded for this facility, so these counts are absences of records, not results.";
}
