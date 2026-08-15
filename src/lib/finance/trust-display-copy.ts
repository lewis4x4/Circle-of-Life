/**
 * Quiet Operator copy for resident trust reconciliation (`/admin/finance/trust`).
 * Missing last-entry dates name real gaps — never fabricate dates or balances.
 */

export const TRUST_NO_LAST_ENTRY_DATE_COPY = "No last entry date posted";

/** Last trust entry date on a reconciliation row — posted value as-is (trim only), or explicit gap copy. */
export function formatTrustLastEntryDate(date: string | null | undefined): string {
  if (date == null) return TRUST_NO_LAST_ENTRY_DATE_COPY;
  const trimmed = date.trim();
  if (!trimmed || trimmed === "—") return TRUST_NO_LAST_ENTRY_DATE_COPY;
  return trimmed;
}
