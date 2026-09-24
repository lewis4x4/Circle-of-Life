/**
 * Quiet Operator copy for monthly invoice generate preview
 * (`/admin/billing/invoices/generate`).
 * Posted zero concession cents stay formatted currency — never silent em dashes.
 */

import { formatUsdFromCents } from "@/lib/insurance/format-money";

export const GENERATE_PREVIEW_NO_CONCESSION_POSTED_COPY = "No concession posted";

export const GENERATE_PREVIEW_NO_BILLING_PERIOD_COPY = "Billing period not loaded";

/** Concession column — formatted USD when cents are posted (including 0), or explicit gap copy. */
export function formatGeneratePreviewConcessionCents(
  cents: number | null | undefined,
): string {
  if (cents == null) return GENERATE_PREVIEW_NO_CONCESSION_POSTED_COPY;
  return formatUsdFromCents(cents);
}

/** Billing period line under the preview table — range when both ISO dates are posted. */
export function formatGeneratePreviewBillingPeriodRange(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
): string {
  const start = periodStart?.trim() ?? "";
  const end = periodEnd?.trim() ?? "";
  if (!start || !end || start === "—" || end === "—") {
    return GENERATE_PREVIEW_NO_BILLING_PERIOD_COPY;
  }

  // Calendar dates as UTC noon, formatted in UTC, so each stays its stored day.
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return GENERATE_PREVIEW_NO_BILLING_PERIOD_COPY;
  }

  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  const sameMonth = sameYear && startDate.getUTCMonth() === endDate.getUTCMonth();

  const startFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(sameMonth ? {} : { year: "numeric" }),
  }).format(startDate);

  const endFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(endDate);

  return `${startFmt} – ${endFmt}`;
}
