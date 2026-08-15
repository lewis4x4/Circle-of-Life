/**
 * Quiet Operator copy for resident billing (`/admin/residents/[id]/billing`).
 * Missing Medicaid provider names and rate units name real gaps — never fabricate values.
 */

import { formatColLabel } from "@/lib/col-labels";

export const RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY = "No provider posted";
export const RESIDENT_BILLING_NO_RATE_UNIT_POSTED_COPY = "No rate unit posted";

/** Medicaid provider / MCO name — posted value trimmed, or explicit gap copy. */
export function formatResidentBillingMedicaidProviderName(
  providerName: string | null | undefined,
): string {
  if (providerName == null) return RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY;
  const trimmed = providerName.trim();
  if (!trimmed || trimmed === "—") return RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY;
  return trimmed;
}

type MedicaidProviderCatalogRow = {
  id: string;
  provider_name: string;
};

/** Resolve a posted facility Medicaid provider id against the active catalog. */
export function formatResidentBillingMedicaidProviderFromCatalog(
  providerId: string | null | undefined,
  providers: MedicaidProviderCatalogRow[],
): string {
  if (!providerId) return RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY;
  const provider = providers.find((item) => item.id === providerId);
  return formatResidentBillingMedicaidProviderName(provider?.provider_name);
}

/** Medicaid rate unit label — posted enum as human text, or explicit gap copy. */
export function formatResidentBillingMedicaidRateUnitLabel(
  value: string | null | undefined,
): string {
  if (value == null) return RESIDENT_BILLING_NO_RATE_UNIT_POSTED_COPY;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return RESIDENT_BILLING_NO_RATE_UNIT_POSTED_COPY;
  if (trimmed === "monthly") return "Monthly";
  if (trimmed === "daily") return "Daily";
  if (trimmed === "weekly") return "Weekly";
  if (trimmed === "per_billable_day") return "Per Billable Day";
  return formatColLabel(trimmed);
}
