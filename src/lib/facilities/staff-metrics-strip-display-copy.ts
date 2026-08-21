/**
 * Quiet Operator copy for the facility detail staffing metrics strip.
 * Missing coverage-gap telemetry names real gaps — never fabricate shift counts.
 */

export const STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY = "Not tracked";
export const STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY = "No coverage count posted yet";
export const STAFF_STRIP_COVERAGE_CONFIGURE_RATIO_SUBCOPY =
  "Configure a ratio rule set to compute shift coverage vs Rule 59A-36";
export const STAFF_STRIP_COVERAGE_POSTED_ZERO_SUBCOPY = "No shift gaps in window";
export const STAFF_STRIP_COVERAGE_POSTED_COUNT_SUBCOPY = "Posted shift gap count · next 7 days";
export const STAFF_STRIP_ACTIVE_STAFF_SUBCOPY = "Unique people · live roster";

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

export function staffStripCoverageGapMainIsNotComputed(value: StaffStripCoverageGapMainValue): boolean {
  return value === STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY;
}

export function staffStripCoverageGapMainIsNumeric(value: StaffStripCoverageGapMainValue): boolean {
  return typeof value === "number";
}

/** Coverage gap (next 7 days) subtitle — operator copy only; configure link stays in the strip component. */
export function formatStaffStripCoverageGapSubcopy(
  ratioConfigured: boolean,
  coverageGapNext7Days: number | null | undefined,
): string | null {
  if (!ratioConfigured) return STAFF_STRIP_COVERAGE_CONFIGURE_RATIO_SUBCOPY;
  if (coverageGapNext7Days == null) return null;
  if (coverageGapNext7Days === 0) return STAFF_STRIP_COVERAGE_POSTED_ZERO_SUBCOPY;
  return STAFF_STRIP_COVERAGE_POSTED_COUNT_SUBCOPY;
}
