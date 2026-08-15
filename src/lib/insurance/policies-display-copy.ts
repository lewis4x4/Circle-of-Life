/**
 * Quiet Operator copy for insurance policies list surfaces.
 * Missing expiration dates name real gaps — never fabricate values.
 */

import { format, parseISO } from "date-fns";

export const INSURANCE_POLICY_NO_EXPIRATION_DATE_COPY = "No expiration date posted";

/** Policy expiration date on a list row — never invents a calendar day. */
export function formatInsurancePolicyExpirationDate(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return INSURANCE_POLICY_NO_EXPIRATION_DATE_COPY;
  const parsed = parseISO(iso.length <= 10 ? `${iso}T12:00:00.000Z` : iso);
  if (Number.isNaN(parsed.getTime())) return INSURANCE_POLICY_NO_EXPIRATION_DATE_COPY;
  return format(parsed, "MMM d, yyyy");
}
