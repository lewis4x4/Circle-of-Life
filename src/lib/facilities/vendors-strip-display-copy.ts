/**
 * Quiet Operator copy for the facility detail vendors metrics strip.
 * Missing COI and contract-expiry counts name real gaps — never fabricate telemetry.
 */

export const VENDORS_STRIP_NO_COI_COUNT_COPY = "No COI count posted";
export const VENDORS_STRIP_NO_EXPIRING_CONTRACTS_COPY = "No expiring contracts posted";

/** COIs-current tile when `vendor_facilities.coi_*` is not wired; real zero stays numeric. */
export function formatVendorsStripCoiCurrentDisplay(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return VENDORS_STRIP_NO_COI_COUNT_COPY;
  return String(count);
}

/** Contracts-expiring tile when vendor contracts backlog is not wired; real zero stays numeric. */
export function formatVendorsStripContractsExpiringDisplay(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return VENDORS_STRIP_NO_EXPIRING_CONTRACTS_COPY;
  return String(count);
}

/** Whether the COIs-current tile should use muted unwired styling. */
export function vendorsStripCoiCurrentIsMissing(count: number | null | undefined): boolean {
  return formatVendorsStripCoiCurrentDisplay(count) === VENDORS_STRIP_NO_COI_COUNT_COPY;
}

/** Whether the contracts-expiring tile should use muted unwired styling. */
export function vendorsStripContractsExpiringIsMissing(count: number | null | undefined): boolean {
  return formatVendorsStripContractsExpiringDisplay(count) === VENDORS_STRIP_NO_EXPIRING_CONTRACTS_COPY;
}
