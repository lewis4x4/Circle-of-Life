/**
 * Quiet Operator copy for deficiencies analysis surfaces.
 * Missing metrics name real gaps — never fabricate survey scores, citation counts, or resolution days.
 */

export const DEFICIENCIES_ANALYSIS_NO_AVERAGE_RESOLUTION_DAYS_COPY =
  "No average resolution days posted";

export const DEFICIENCIES_ANALYSIS_NO_AVERAGE_GAP_DAYS_COPY =
  "No average gap days posted";

/** Average resolution days — real zero stays `0`; null/undefined uses explicit missing copy. */
export function formatDeficiencyAverageResolutionDays(
  value: number | null | undefined,
): string | number {
  if (value == null) return DEFICIENCIES_ANALYSIS_NO_AVERAGE_RESOLUTION_DAYS_COPY;
  return value;
}

/**
 * Recurring-tag average gap between citations.
 * With fewer than two occurrences there is no gap average to post; real `0` stays `0`.
 */
export function formatRecurringTagAverageGapDays(
  totalOccurrences: number,
  daysBetweenAverage: number,
): string | number {
  if (totalOccurrences < 2) return DEFICIENCIES_ANALYSIS_NO_AVERAGE_GAP_DAYS_COPY;
  return daysBetweenAverage;
}

/** Cell copy for recurring-tag average gap (includes "~N days" suffix when numeric). */
export function formatRecurringTagAverageGapCell(
  totalOccurrences: number,
  daysBetweenAverage: number,
): string {
  const value = formatRecurringTagAverageGapDays(totalOccurrences, daysBetweenAverage);
  if (typeof value === "string") return value;
  return `~${value} days`;
}
