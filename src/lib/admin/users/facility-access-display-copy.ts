/**
 * Quiet Operator copy for the admin users facility-access manager.
 * Missing facility names name real gaps — never fabricate labels or legacy "Unknown facility" copy.
 */

export const FACILITY_ACCESS_NO_FACILITY_COPY = "No facility posted";

const LEGACY_UNKNOWN_FACILITY = "Unknown facility";

/** Facility name on a facility-access row when the join is unset, blank, or legacy generic copy. */
export function formatFacilityAccessNameDisplay(name: string | null | undefined): string {
  if (name == null) return FACILITY_ACCESS_NO_FACILITY_COPY;
  const trimmed = name.trim();
  if (!trimmed || trimmed === LEGACY_UNKNOWN_FACILITY) {
    return FACILITY_ACCESS_NO_FACILITY_COPY;
  }
  return trimmed;
}
