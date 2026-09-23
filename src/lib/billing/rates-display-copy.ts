/**
 * Quiet Operator copy for billing rate schedules (`/admin/billing/rates`).
 * Missing surcharge cents name real gaps — never fabricate amounts or silent em dashes.
 */

import {
  FORMAT_USD_NO_AMOUNT_POSTED_COPY,
  formatUsdFromCents,
} from "@/lib/insurance/format-money";

export const BILLING_RATE_NO_AMOUNT_COPY = FORMAT_USD_NO_AMOUNT_POSTED_COPY;

/**
 * A stored 0 on a surcharge or community fee. The columns default to 0, so a
 * zero almost always means nobody set the amount; residents are charged $0.00
 * for it. Say both rather than a bare "$0.00" that reads as a chosen price
 * (COL-649).
 */
export const BILLING_RATE_ZERO_COPY = "Not set — $0.00";

/** Surcharge or optional rate cell — formatted USD when cents are posted, or explicit gap copy. */
export function formatBillingRateSurchargeCents(cents: number | null | undefined): string {
  if (cents === 0) return BILLING_RATE_ZERO_COPY;
  return formatUsdFromCents(cents);
}
