/**
 * Quiet Operator copy for v2 thresholds facility labels when the facility join is missing.
 * Missing, blank, or em-dash values name real gaps — never silent dashes or fabricated names.
 */

export const V2_THRESHOLDS_NO_FACILITY_POSTED_COPY = "No facility posted";

const EM_DASH = "—";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

/** Facility name on a v2 threshold row when the join is missing, blank, or em dash. */
export function formatV2ThresholdFacilityName(
  facilityName: string | null | undefined,
): string {
  if (isBlankOrEmDash(facilityName)) return V2_THRESHOLDS_NO_FACILITY_POSTED_COPY;
  return String(facilityName).trim();
}
