/**
 * Quiet Operator copy for infection outbreak detail (`/admin/infection-control/outbreaks/[id]`).
 * Missing case counts name real gaps — never fabricate outbreak or clinical facts.
 */

export const OUTBREAK_DETAIL_NO_CASE_COUNT_COPY = "No case count posted";

/** Outbreak total case count — real zero stays `0`; null/undefined uses explicit missing copy. */
export function formatOutbreakDetailTotalCaseCount(
  value: number | null | undefined,
): string | number {
  if (value == null) return OUTBREAK_DETAIL_NO_CASE_COUNT_COPY;
  return value;
}

/** Header subtitle: status plus case count without silent em-dash fallbacks. */
export function formatOutbreakDetailStatusLine(
  status: unknown,
  totalCases: number | null | undefined,
): string {
  const cases = formatOutbreakDetailTotalCaseCount(totalCases);
  return `Status: ${String(status)} · Cases: ${String(cases)}`;
}
