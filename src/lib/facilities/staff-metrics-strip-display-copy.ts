/**
 * Quiet Operator copy for the facility detail staffing metrics strip.
 * Missing coverage-gap telemetry names real gaps — never fabricate shift counts.
 */

export const STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY = "Not tracked";
export const STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY = "Coverage not computed yet";

export type StaffStripCoverageGapMainValue = string | number;

/** Coverage gap (next 7 days) main tile — real zero stays numeric; nullish gets explicit copy. */
export function formatStaffStripCoverageGapMainValue(
  ratioConfigured: boolean,
  coverageGapNext7Days: number | null | undefined,
): StaffStripCoverageGapMainValue {
  if (!ratioConfigured) return STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY;
  if (coverageGapNext7Days == null) return STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY;
  return coverageGapNext7Days;
}

export function staffStripCoverageGapMainIsNotTracked(value: StaffStripCoverageGapMainValue): boolean {
  return value === STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY;
}

export function staffStripCoverageGapMainIsNumeric(value: StaffStripCoverageGapMainValue): boolean {
  return typeof value === "number";
}
