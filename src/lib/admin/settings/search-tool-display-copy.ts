/**
 * Quiet Operator copy for the search tool dashboard (`SearchToolDashboard`).
 * Missing user emails name real gaps — never fabricate addresses.
 */

export const SEARCH_TOOL_NO_EMAIL_COPY = "No email posted";

const LEGACY_UNKNOWN_EMAIL = "Unknown";

/** User email on audit rows when unset, blank, or legacy generic copy. */
export function formatSearchToolUserEmailDisplay(
  userEmail: string | null | undefined,
): string {
  if (userEmail == null) return SEARCH_TOOL_NO_EMAIL_COPY;
  const trimmed = userEmail.trim();
  if (!trimmed || trimmed === LEGACY_UNKNOWN_EMAIL) {
    return SEARCH_TOOL_NO_EMAIL_COPY;
  }
  return trimmed;
}
