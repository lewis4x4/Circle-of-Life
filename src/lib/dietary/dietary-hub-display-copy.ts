/**
 * Quiet Operator copy for the admin dietary hub (`/admin/dietary`).
 * Missing resident names name real gaps — never fabricate labels.
 */

export const DIETARY_HUB_NO_RESIDENT_COPY = "No resident posted";

const LEGACY_UNKNOWN_RESIDENT = "Unknown";

/** Resident name on diet-order roster and attention cards when the join is unset, blank, or legacy generic copy. */
export function formatDietaryHubResidentDisplay(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const combined = `${first?.trim() ?? ""} ${last?.trim() ?? ""}`.trim();
  if (!combined || combined === LEGACY_UNKNOWN_RESIDENT) {
    return DIETARY_HUB_NO_RESIDENT_COPY;
  }
  return combined;
}
