/**
 * Quiet Operator copy for user-management audit API acting-user enrichment.
 * Missing actors and blank profile fields name real gaps — never generic "Unknown" copy.
 */

export const USER_AUDIT_NO_NAME_COPY = "No name posted";
export const USER_AUDIT_NO_EMAIL_COPY = "No email posted";

const EM_DASH = "—";
const LEGACY_UNKNOWN = "Unknown";
const LEGACY_UNKNOWN_LOWER = "unknown";

function isGapValue(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed === EM_DASH) return true;
  if (trimmed === LEGACY_UNKNOWN || trimmed === LEGACY_UNKNOWN_LOWER) return true;
  return false;
}

/** Acting-user full name when the profile is missing, blank, em dash, or legacy generic copy. */
export function formatUserAuditActingUserNameDisplay(
  fullName: string | null | undefined,
): string {
  if (isGapValue(fullName)) return USER_AUDIT_NO_NAME_COPY;
  return fullName!.trim();
}

/** Acting-user email when the profile is missing, blank, em dash, or legacy generic copy. */
export function formatUserAuditActingUserEmailDisplay(
  email: string | null | undefined,
): string {
  if (isGapValue(email)) return USER_AUDIT_NO_EMAIL_COPY;
  return email!.trim();
}
