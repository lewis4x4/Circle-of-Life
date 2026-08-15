/**
 * Quiet Operator copy for generic report run result grid cells.
 * Missing values name the gap once — never use silent em dashes in data cells.
 */

export const REPORT_RUN_NO_VALUE_POSTED_COPY = "No value posted";

/** Detail-row cell display — names null/empty gaps; posted values stay literal. */
export function formatReportRunCellDisplay(
  value: string | number | boolean | null | undefined,
): string {
  if (value == null) return REPORT_RUN_NO_VALUE_POSTED_COPY;
  if (value === "") return REPORT_RUN_NO_VALUE_POSTED_COPY;
  return String(value);
}
