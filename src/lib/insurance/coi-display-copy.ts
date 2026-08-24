/**
 * Quiet Operator copy for certificates of insurance list surfaces.
 * Missing expiry dates name real gaps — never fabricate calendar days.
 */

import { format, parseISO } from "date-fns";

export const INSURANCE_COI_NO_EXPIRATION_DATE_COPY = "No expiration date posted";

/** One-line cue: org-scoped list; expiry dates are Eastern calendar days. */
export const INSURANCE_COI_ORG_SCOPE_COPY =
  "Certificates listed here are scoped to your organization; expiry dates follow Eastern (ET) calendar days.";

/** COI expiration date on a list row — never invents a calendar day. */
export function formatInsuranceCoiExpirationDate(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return INSURANCE_COI_NO_EXPIRATION_DATE_COPY;
  const parsed = parseISO(iso.length <= 10 ? `${iso}T12:00:00.000Z` : iso);
  if (Number.isNaN(parsed.getTime())) return INSURANCE_COI_NO_EXPIRATION_DATE_COPY;
  return format(parsed, "MMM d, yyyy");
}
