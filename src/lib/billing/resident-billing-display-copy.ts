/**
 * Quiet Operator copy for resident billing (`/admin/residents/[id]/billing`).
 * Missing Medicaid provider names and rate units name real gaps — never fabricate values.
 */

import { formatColLabel } from "@/lib/col-labels";
import { formatUsdFromCents } from "@/lib/insurance/format-money";

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

/**
 * The provider line on a Medicaid payer card (COL-667). A payer row can name
 * its insurer (e.g. an MCO) without being linked to a facility Medicaid
 * provider; saying "No provider posted" under that name read as a
 * contradiction. Say which is true: linked, named but not linked, or neither.
 */
export function formatResidentBillingMedicaidProviderCurrent(
  providerId: string | null | undefined,
  providers: MedicaidProviderCatalogRow[],
  payerName: string | null | undefined,
): string {
  const linked = formatResidentBillingMedicaidProviderFromCatalog(providerId, providers);
  if (linked !== RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY) return linked;
  const named = payerName?.trim();
  if (named) return `${named} is on the payer record but not linked to a facility Medicaid provider`;
  return RESIDENT_BILLING_NO_PROVIDER_POSTED_COPY;
}

/**
 * How a Medicaid resident's monthly terms split between Medicaid and the
 * resident, and what the monthly invoices cover today. Monthly invoice
 * generation bills the resident share on its own invoice from October 2026
 * (COL-678 ruling; earlier months were not back-filled), so the card says which
 * invoice carries which part.
 */
export function residentBillingMedicaidSplitLine(
  medicaidRateCents: number | null | undefined,
  residentShareCents: number | null | undefined,
): string | null {
  if (medicaidRateCents == null && residentShareCents == null) return null;
  const medicaid = medicaidRateCents == null ? "Medicaid rate not posted" : `Medicaid pays ${formatUsdFromCents(medicaidRateCents)}`;
  const share = residentShareCents == null ? "no resident share posted" : `resident share ${formatUsdFromCents(residentShareCents)}`;
  const invoiced =
    residentShareCents != null && residentShareCents > 0
      ? " From October 2026 the resident share is billed on its own invoice to the resident or responsible party; earlier invoices carry the Medicaid portion only."
      : "";
  return `${medicaid} · ${share} a month.${invoiced}`;
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
