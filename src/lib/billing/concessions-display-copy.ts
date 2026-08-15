/**
 * Quiet Operator copy for billing concessions (`/admin/billing/concessions`).
 * Missing dates name real gaps — never fabricate values or silent em dashes.
 */

export const CONCESSIONS_NO_DATE_POSTED_COPY = "No date posted";

/** Effective or expiry date on a concession row — formatted when valid, or explicit gap copy. */
export function formatConcessionsDateDisplay(iso: string | null | undefined): string {
  if (iso == null) return CONCESSIONS_NO_DATE_POSTED_COPY;
  const trimmed = iso.trim();
  if (!trimmed || trimmed === "—") return CONCESSIONS_NO_DATE_POSTED_COPY;
  const d = new Date(`${trimmed}T12:00:00`);
  if (Number.isNaN(d.getTime())) return trimmed;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}
