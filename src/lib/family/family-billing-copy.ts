import { formatUsd } from "@/lib/family/family-billing-data";
import { FAMILY_BILLING_NO_PAYMENT } from "@/lib/family/family-portal-copy";

/** Last payment amount for family billing summary — explicit copy when none posted. */
export function formatFamilyLastPaymentAmount(amount: number | null): string {
  if (amount == null) return FAMILY_BILLING_NO_PAYMENT;
  return formatUsd(amount);
}

/** Last payment date for family billing summary — explicit copy when none posted. */
export function formatFamilyLastPaymentDate(dateLabel: string | null): string {
  if (dateLabel == null) return FAMILY_BILLING_NO_PAYMENT;
  return dateLabel;
}
