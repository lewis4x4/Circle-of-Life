/**
 * Quiet Operator copy for vendor contract list and detail surfaces.
 * Missing vendor names and expiration dates name real gaps — never fabricate values.
 */

export const VENDOR_CONTRACT_NO_VENDOR_NAME_COPY = "No vendor posted";
export const VENDOR_CONTRACT_NO_EXPIRATION_DATE_COPY = "No expiration date posted";
export const VENDOR_CONTRACT_NO_STATUS_COPY = "No status posted";

/** Vendor name on a contract row or detail header when unset or blank. */
export function formatVendorContractVendorName(name: string | null | undefined): string {
  if (!name || !name.trim()) return VENDOR_CONTRACT_NO_VENDOR_NAME_COPY;
  return name.trim();
}

/** Expiration date on a contract row or detail — posted ISO stays as posted (trim only). */
export function formatVendorContractExpirationDate(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return VENDOR_CONTRACT_NO_EXPIRATION_DATE_COPY;
  return iso.trim();
}
