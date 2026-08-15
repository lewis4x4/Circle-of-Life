/**
 * Quiet Operator copy for billing rate schedules (`/admin/billing/rates`).
 * Missing surcharge cents name real gaps — never fabricate amounts or silent em dashes.
 */

import {
  FORMAT_USD_NO_AMOUNT_POSTED_COPY,
  formatUsdFromCents,
} from "@/lib/insurance/format-money";

export const BILLING_RATE_NO_AMOUNT_COPY = FORMAT_USD_NO_AMOUNT_POSTED_COPY;

/** Surcharge or optional rate cell — formatted USD when cents are posted, or explicit gap copy. */
export function formatBillingRateSurchargeCents(cents: number | null | undefined): string {
  return formatUsdFromCents(cents);
}
