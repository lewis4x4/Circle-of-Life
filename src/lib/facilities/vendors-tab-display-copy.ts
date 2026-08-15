/**
 * Quiet Operator copy for the facility detail vendors tab.
 * Missing contact phone and activity timestamps name real gaps — never fabricate phones or dates.
 */

export const VENDORS_TAB_NO_PHONE_COPY = "No phone posted";
export const VENDORS_TAB_NO_LAST_ACTIVITY_COPY = "No last activity posted";

/** Primary contact phone when unset or blank; posted values are trimmed. */
export function formatVendorsTabPhoneDisplay(
  primaryContactPhone: string | null | undefined,
): string {
  if (primaryContactPhone == null) return VENDORS_TAB_NO_PHONE_COPY;
  const trimmed = primaryContactPhone.trim();
  if (!trimmed) return VENDORS_TAB_NO_PHONE_COPY;
  return trimmed;
}

/** Last invoice or payment activity; prefers invoice timestamp when both exist. */
export function formatVendorsTabLastActivityDisplay(
  lastInvoiceAt: string | null | undefined,
  lastPaymentAt: string | null | undefined,
): string {
  const timestamp = lastInvoiceAt ?? lastPaymentAt;
  if (!timestamp) return VENDORS_TAB_NO_LAST_ACTIVITY_COPY;
  return new Date(timestamp).toLocaleDateString(undefined, { dateStyle: "medium" });
}
