import { describe, expect, it } from "vitest";

import { paymentMethodLabel, paymentsEmptyCopy, summarizePayments } from "./payments-list";

describe("recorded payments list (COL-650)", () => {
  it("labels every payment method and falls back to Other", () => {
    expect(paymentMethodLabel("ach")).toBe("ACH / EFT");
    expect(paymentMethodLabel("medicaid_payment")).toBe("Medicaid payment");
    expect(paymentMethodLabel("something_new")).toBe("Other");
  });

  it("reports refunds beside receipts instead of netting them", () => {
    const summary = summarizePayments([
      { id: "a", paymentDate: "2026-09-01", amountCents: 500_000, refunded: false, refundAmountCents: null },
      { id: "b", paymentDate: "2026-09-02", amountCents: 20_000, refunded: true, refundAmountCents: 5_000 },
      { id: "c", paymentDate: "2026-09-03", amountCents: 10_000, refunded: true, refundAmountCents: null },
    ]);
    expect(summary).toEqual({ count: 3, receivedCents: 530_000, refundedCents: 15_000 });
  });

  it("says nothing is recorded in Haven rather than that nothing was paid", () => {
    const copy = paymentsEmptyCopy("Homewood Lodge");
    expect(copy.title).toBe("No payments recorded in Haven");
    expect(copy.description).toContain("Homewood Lodge");
    expect(copy.description).toContain("outside Haven");
  });
});
