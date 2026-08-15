/**
 * Quiet Operator copy for resident detail overview verifier labels.
 * Missing staff joins name real gaps — never fabricate verifier names.
 */

export const RESIDENT_OVERVIEW_NO_STAFF_COPY = "No staff posted";

/**
 * Verifier staff label on the resident overview when a verifier id is posted.
 * Returns null when no verifier id is recorded (do not invent a verifier).
 */
export function formatResidentOverviewVerifiedByStaffLabel(
  verifierId: string | null | undefined,
  joinedName: string | null | undefined,
): string | null {
  if (!verifierId) return null;
  if (!joinedName) return RESIDENT_OVERVIEW_NO_STAFF_COPY;
  const trimmed = joinedName.trim();
  if (!trimmed) return RESIDENT_OVERVIEW_NO_STAFF_COPY;
  return trimmed;
}
