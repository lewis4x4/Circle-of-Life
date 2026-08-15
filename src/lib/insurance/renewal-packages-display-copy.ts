/**
 * Quiet Operator copy for renewal data package list and detail surfaces.
 * Missing policy numbers, payload versions, and metric counts name real gaps — never fabricate values.
 */

import { formatUsdFromCents } from "@/lib/insurance/format-money";

export const RENEWAL_PACKAGE_NO_POLICY_NUMBER_COPY = "No policy number posted";
export const RENEWAL_PACKAGE_NO_PAYLOAD_VERSION_COPY = "No payload version posted";
export const RENEWAL_PACKAGE_NO_RESIDENT_COUNT_COPY = "No resident count posted";
export const RENEWAL_PACKAGE_NO_INCIDENT_COUNT_COPY = "No incident count posted";
export const RENEWAL_PACKAGE_NO_STAFF_COUNT_COPY = "No staff count posted";
export const RENEWAL_PACKAGE_NO_INVOICE_TOTAL_COPY = "No invoice total posted";

/** Policy number on a renewal package row — never invents a carrier policy id. */
export function formatRenewalPackagePolicyNumber(policyNumber: string | null | undefined): string {
  if (!policyNumber || !policyNumber.trim()) return RENEWAL_PACKAGE_NO_POLICY_NUMBER_COPY;
  return policyNumber;
}

/** JSON payload schema version — real numbers stay numeric; null/undefined names the gap. */
export function formatRenewalPackagePayloadVersion(version: number | null | undefined): string | number {
  if (version == null) return RENEWAL_PACKAGE_NO_PAYLOAD_VERSION_COPY;
  return version;
}

/** Metric count — real zero stays `0`; null/undefined uses explicit missing copy. */
export function formatRenewalPackageMetricCount(
  value: number | null | undefined,
  missingCopy: string,
): string | number {
  if (value == null) return missingCopy;
  return value;
}

export function formatRenewalPackageActiveResidents(value: number | null | undefined): string | number {
  return formatRenewalPackageMetricCount(value, RENEWAL_PACKAGE_NO_RESIDENT_COUNT_COPY);
}

export function formatRenewalPackageIncidentsInPeriod(value: number | null | undefined): string | number {
  return formatRenewalPackageMetricCount(value, RENEWAL_PACKAGE_NO_INCIDENT_COUNT_COPY);
}

export function formatRenewalPackageActiveStaff(value: number | null | undefined): string | number {
  return formatRenewalPackageMetricCount(value, RENEWAL_PACKAGE_NO_STAFF_COUNT_COPY);
}

/** Invoice total when metrics block is present; names gap when metrics object is missing. */
export function formatRenewalPackageInvoiceTotal(
  metrics: { invoice_total_cents: number } | null | undefined,
): string {
  if (metrics == null) return RENEWAL_PACKAGE_NO_INVOICE_TOTAL_COPY;
  return formatUsdFromCents(metrics.invoice_total_cents);
}
