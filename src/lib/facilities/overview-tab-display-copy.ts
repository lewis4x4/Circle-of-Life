/**
 * Quiet Operator copy for the facility detail overview tab.
 * Missing contact fields name real gaps — never fabricate values.
 */

export const OVERVIEW_TAB_NO_EMAIL_COPY = "No email posted";

/** Contact email on the overview tab when unset, blank, whitespace-only, or a lone em dash. */
export function formatFacilityOverviewEmail(email: string | null | undefined): string {
  if (!email) return OVERVIEW_TAB_NO_EMAIL_COPY;
  const trimmed = email.trim();
  if (!trimmed || trimmed === "—") return OVERVIEW_TAB_NO_EMAIL_COPY;
  return trimmed;
}
