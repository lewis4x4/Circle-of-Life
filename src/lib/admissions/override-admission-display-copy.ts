/**
 * Quiet Operator copy for OverrideAdmissionForm facility labels.
 * Never fabricates a facility name or says "Selected facility".
 */

export const OVERRIDE_ADMISSION_NO_FACILITY_COPY = "No facility posted";
export const OVERRIDE_ADMISSION_NO_FACILITY_NAME_COPY = "No facility name posted";

/** Confirmation / title facility label for override admission. */
export function formatOverrideAdmissionFacilityLabel(
  selectedFacilityId: string | null | undefined,
  facilityName: string | null | undefined,
): string {
  if (!selectedFacilityId) return OVERRIDE_ADMISSION_NO_FACILITY_COPY;
  const trimmed = facilityName?.trim();
  if (trimmed) return trimmed;
  return OVERRIDE_ADMISSION_NO_FACILITY_NAME_COPY;
}
