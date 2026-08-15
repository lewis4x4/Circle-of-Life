/**
 * Quiet Operator copy for AR aging (`/admin/billing/ar-aging`).
 * Real bucket zeros stay visible — null/missing values name gaps instead of em dashes.
 */

import { formatUsdFromCents } from "@/lib/insurance/format-money";

export const AR_AGING_NO_INVOICE_COUNT_POSTED_COPY = "No invoice count posted";

/** Bucket or cell money — real $0.00 stays formatted; null/missing gets explicit copy. */
export function formatArAgingBucketCents(cents: number | null | undefined): string {
  return formatUsdFromCents(cents);
}

/** Invoice count for a bucket — real zero stays numeric; null/missing gets explicit copy. */
export function formatArAgingInvoiceCount(count: number | null | undefined): string | number {
  if (count == null) return AR_AGING_NO_INVOICE_COUNT_POSTED_COPY;
  return count;
}

/** KPI tile caption — keeps "N invoices" shape; real zero reads as "0 invoices". */
export function formatArAgingInvoiceCountCaption(count: number | null | undefined): string {
  if (count == null) return AR_AGING_NO_INVOICE_COUNT_POSTED_COPY;
  return `${count} invoices`;
}
