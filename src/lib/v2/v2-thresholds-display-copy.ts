/**
 * Quiet Operator copy for v2 thresholds facility labels when the facility join is missing.
 * Missing, blank, or em-dash values name real gaps — never silent dashes or fabricated names.
 */

export const V2_THRESHOLDS_NO_FACILITY_POSTED_COPY = "No facility posted";

const EM_DASH = "—";
const LEGACY_UNNAMED_FACILITY = "Unnamed facility";
const LEGACY_UNKNOWN = "Unknown";

function isBlankEmDashOrLegacyFacilityName(value: string): boolean {
  return (
    value === "" ||
    value === EM_DASH ||
    value === LEGACY_UNNAMED_FACILITY ||
    value === LEGACY_UNKNOWN
  );
}

/** Facility name on a v2 threshold row when the join is missing, blank, em dash, or legacy generic copy. */
export function formatV2ThresholdFacilityName(
  facilityName: string | null | undefined,
): string {
  if (facilityName == null) return V2_THRESHOLDS_NO_FACILITY_POSTED_COPY;
  const trimmed = String(facilityName).trim();
  if (isBlankEmDashOrLegacyFacilityName(trimmed)) {
    return V2_THRESHOLDS_NO_FACILITY_POSTED_COPY;
  }
  return trimmed;
}
