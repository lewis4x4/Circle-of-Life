import { describe, expect, it } from "vitest";

import { summarizeFamilyBalances } from "./family-billing-data";
import {
  FAMILY_BILLING_NO_INVOICES,
  FAMILY_BILLING_NOT_SET_UP,
  describeFamilyBillingSummary,
} from "./family-billing-status";

const linked = { financialLinkCount: 1 };

describe("describeFamilyBillingSummary (COL-649)", () => {
  it("does not say '$0.00 · In good standing' on an unlinked account", () => {
    const s = describeFamilyBillingSummary({ ...summarizeFamilyBalances([]), financialLinkCount: 0 });
    expect(s.accountStatus).toBe(FAMILY_BILLING_NOT_SET_UP);
    expect(s.openBalance).not.toMatch(/\$/);
    expect(s.accountTone).toBe("muted");
  });

  it("says no invoices yet when nothing has been sent", () => {
    const s = describeFamilyBillingSummary({ ...summarizeFamilyBalances([]), ...linked });
    expect(s.openBalance).toBe(FAMILY_BILLING_NO_INVOICES);
    expect(s.accountStatus).toBe(FAMILY_BILLING_NO_INVOICES);
  });

  it("does not count drafts as owed", () => {
    const totals = summarizeFamilyBalances([{ status: "draft", balance_due: 444_000 }]);
    expect(totals.totalBalanceDue).toBe(0);
    expect(describeFamilyBillingSummary({ ...totals, ...linked }).accountStatus).toBe(FAMILY_BILLING_NO_INVOICES);
  });

  it("is in good standing only when sent invoices exist and all are settled", () => {
    const s = describeFamilyBillingSummary({
      ...summarizeFamilyBalances([{ status: "paid", balance_due: 0 }]),
      ...linked,
    });
    expect(s.accountStatus).toBe("In good standing");
    expect(s.openBalance).toBe("$0.00");
  });

  it("flags balances and overdue invoices", () => {
    expect(
      describeFamilyBillingSummary({ ...summarizeFamilyBalances([{ status: "sent", balance_due: 444_000 }]), ...linked })
        .accountStatus,
    ).toBe("Balance due");
    expect(
      describeFamilyBillingSummary({ ...summarizeFamilyBalances([{ status: "overdue", balance_due: 100 }]), ...linked })
        .accountStatus,
    ).toBe("Overdue balance");
  });
});
