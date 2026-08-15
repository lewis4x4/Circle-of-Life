/**
 * Quiet Operator copy for the admin training hub (`/admin/training`).
 * Missing facility and program names name real gaps — never fabricate labels.
 */

export const TRAINING_HUB_NO_FACILITY_COPY = "No facility posted";
export const TRAINING_HUB_NO_PROGRAM_COPY = "No program posted";

/** Facility name on a training hub row when the join is unset or blank. */
export function formatTrainingHubFacilityName(name: string | null | undefined): string {
  if (!name || !name.trim()) return TRAINING_HUB_NO_FACILITY_COPY;
  return name;
}

/** Training program name on a completion or in-service row when unset or blank. */
export function formatTrainingHubProgramName(name: string | null | undefined): string {
  if (!name || !name.trim()) return TRAINING_HUB_NO_PROGRAM_COPY;
  return name;
}
