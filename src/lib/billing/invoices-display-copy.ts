/**
 * Quiet Operator copy for invoice list display (`load-invoices` updated-at column).
 * Unparseable updated-at timestamps name the gap — never fabricate dates.
 */

export const INVOICE_NO_UPDATED_AT_COPY = "No date posted";

/** Invoice `updated_at` — posted ISO timestamp formatted, or explicit gap copy. */
export function formatUpdatedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return INVOICE_NO_UPDATED_AT_COPY;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}
