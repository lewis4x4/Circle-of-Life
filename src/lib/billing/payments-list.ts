/**
 * Recorded-payments list (`/admin/billing/payments`, COL-650). The index used to
 * redirect to the record form, so no screen showed what had been recorded.
 */

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  check: "Check",
  ach: "ACH / EFT",
  credit_card: "Credit card",
  cash: "Cash",
  medicaid_payment: "Medicaid payment",
  insurance_payment: "Insurance payment",
  other: "Other",
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? "Other";
}

export type PaymentListRow = {
  id: string;
  paymentDate: string;
  amountCents: number;
  refunded: boolean;
  refundAmountCents: number | null;
};

export type PaymentListSummary = {
  count: number;
  receivedCents: number;
  refundedCents: number;
};

/** Received = every payment amount; refunds are reported beside it, never netted silently. */
export function summarizePayments(rows: ReadonlyArray<PaymentListRow>): PaymentListSummary {
  let receivedCents = 0;
  let refundedCents = 0;
  for (const row of rows) {
    receivedCents += Math.max(0, row.amountCents);
    if (row.refunded) refundedCents += Math.max(0, row.refundAmountCents ?? row.amountCents);
  }
  return { count: rows.length, receivedCents, refundedCents };
}

/** Empty-state copy: "nothing recorded" is a fact about Haven, not about the facility's cash. */
export function paymentsEmptyCopy(scopeLabel: string): { title: string; description: string } {
  return {
    title: "No payments recorded in Haven",
    description: `No payment has been recorded for ${scopeLabel}. Payments taken outside Haven (for example in QuickBooks) do not appear here until they are recorded.`,
  };
}
