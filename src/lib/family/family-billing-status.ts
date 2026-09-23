import type { FamilyBillingContext } from "@/lib/family/family-billing-data";
import { formatCents } from "@/lib/finance/format-cents";
import { canClaimAllClear } from "@/lib/metrics/metric-state";

export type FamilyBillingTone = "muted" | "warning" | "success";

export type FamilyBillingSummary = {
  openBalance: string;
  balanceTone: FamilyBillingTone;
  accountStatus: string;
  accountTone: FamilyBillingTone;
};

export const FAMILY_BILLING_NOT_SET_UP = "Billing access not set up yet";
export const FAMILY_BILLING_NO_INVOICES = "No invoices yet";

/**
 * Family billing summary (COL-649). "$0.00 · In good standing" is only said
 * when this family member can see a resident's billing, at least one invoice
 * has been sent, and none carries a balance. An unlinked account or one with
 * nothing billed yet says so instead.
 */
export function describeFamilyBillingSummary(
  data: Pick<
    FamilyBillingContext,
    "totalBalanceDue" | "billedInvoiceCount" | "openInvoiceCount" | "hasOverdue" | "financialLinkCount"
  >,
): FamilyBillingSummary {
  if (data.financialLinkCount === 0) {
    return {
      openBalance: "Not set up",
      balanceTone: "muted",
      accountStatus: FAMILY_BILLING_NOT_SET_UP,
      accountTone: "muted",
    };
  }
  if (data.billedInvoiceCount === 0) {
    return {
      openBalance: FAMILY_BILLING_NO_INVOICES,
      balanceTone: "muted",
      accountStatus: FAMILY_BILLING_NO_INVOICES,
      accountTone: "muted",
    };
  }
  const openBalance = formatCents(data.totalBalanceDue);
  if (data.hasOverdue) {
    return { openBalance, balanceTone: "warning", accountStatus: "Overdue balance", accountTone: "warning" };
  }
  if (data.totalBalanceDue > 0) {
    return { openBalance, balanceTone: "warning", accountStatus: "Balance due", accountTone: "warning" };
  }
  if (canClaimAllClear({ scopeSize: data.billedInvoiceCount, issueCount: data.openInvoiceCount })) {
    return { openBalance, balanceTone: "success", accountStatus: "In good standing", accountTone: "success" };
  }
  return { openBalance, balanceTone: "muted", accountStatus: "Balance due", accountTone: "warning" };
}
