/**
 * Quiet Operator copy for insurance renewals list surfaces.
 * Missing target effective dates name real gaps — never fabricate calendar days.
 */

import { format, parseISO } from "date-fns";

export const INSURANCE_RENEWAL_NO_DATE_COPY = "No date posted";

/** Target effective date on a renewal row — never invents a calendar day. */
export function formatInsuranceRenewalTargetDate(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return INSURANCE_RENEWAL_NO_DATE_COPY;
  const parsed = parseISO(iso.length <= 10 ? `${iso}T12:00:00.000Z` : iso);
  if (Number.isNaN(parsed.getTime())) return INSURANCE_RENEWAL_NO_DATE_COPY;
  return format(parsed, "MMM d, yyyy");
}
