/**
 * Quiet Operator copy for rounding completion report KPIs (`/admin/rounding/reports`).
 * Empty windows name the gap — never fabricate rates or counts.
 */

export const ROUNDING_REPORT_NO_VALUE_COPY = "No value posted";

/** KPI value on the completion reports strip — names empty windows, preserves posted zeros. */
export function formatRoundingReportKpiValue(hasData: boolean, formatted: string): string {
  if (!hasData) return ROUNDING_REPORT_NO_VALUE_COPY;
  return formatted;
}
