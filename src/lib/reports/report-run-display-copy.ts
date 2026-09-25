/**
 * Quiet Operator copy for generic report run result grid cells and scope labels.
 * Missing values name the gap once — never use silent em dashes in data cells.
 * Scope labels never fabricate a facility name or say "Selected facility".
 */

export const REPORT_RUN_NO_VALUE_POSTED_COPY = "No value posted";
export const REPORT_RUN_NO_FACILITY_NAME_COPY = "No facility name posted";
export const REPORT_RUN_ALL_FACILITIES_SCOPE_COPY = "All facilities";

/** Detail-row cell display — names null/empty gaps; posted values stay literal. */
export function formatReportRunCellDisplay(
  value: string | number | boolean | null | undefined,
): string {
  if (value == null) return REPORT_RUN_NO_VALUE_POSTED_COPY;
  if (value === "") return REPORT_RUN_NO_VALUE_POSTED_COPY;
  return String(value);
}

/**
 * Scope chip / CSV / result description label for a report run.
 * Org-wide → "All facilities". Named facility → that name. Missing name → gap copy.
 */
export function formatReportRunScopeLabel(
  scopeFacilityId: string | null,
  facilityName: string | null | undefined,
): string {
  if (scopeFacilityId === null) return REPORT_RUN_ALL_FACILITIES_SCOPE_COPY;
  const trimmed = facilityName?.trim();
  if (trimmed) return trimmed;
  return REPORT_RUN_NO_FACILITY_NAME_COPY;
}
