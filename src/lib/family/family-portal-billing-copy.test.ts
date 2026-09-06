import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FAMILY_BILLING_NO_REFERENCE_COPY,
  formatFamilyLastPaymentAmount,
  formatFamilyLastPaymentDate,
  formatFamilyPaymentReference,
} from "@/lib/family/family-billing-copy";
import {
  FAMILY_BILLING_EMPTY_INVOICES_DESCRIPTION,
  FAMILY_BILLING_EMPTY_INVOICES_TITLE,
  FAMILY_BILLING_LOADING,
  FAMILY_BILLING_NO_PAYMENT,
  FAMILY_BILLING_PAGE_DESCRIPTION,
  FAMILY_BILLING_PAGE_TITLE,
  FAMILY_BILLING_RETRY,
  FAMILY_INVOICES_EMPTY_DESCRIPTION,
  FAMILY_INVOICES_EMPTY_TITLE,
  FAMILY_INVOICES_LOADING,
  FAMILY_INVOICES_RETRY,
  FAMILY_PAYMENTS_EMPTY_DESCRIPTION,
  FAMILY_PAYMENTS_EMPTY_TITLE,
  FAMILY_PAYMENTS_LOADING,
  FAMILY_PAYMENTS_RETRY,
} from "@/lib/family/family-portal-copy";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const familyPortalCopyPath = path.join(repoRoot, "src/lib/family/family-portal-copy.ts");
const billingPagePath = path.join(repoRoot, "src/app/(family)/family/billing/page.tsx");
const billingDataPath = path.join(repoRoot, "src/lib/family/family-billing-data.ts");
const invoicesPagePath = path.join(repoRoot, "src/app/(family)/family/invoices/page.tsx");
const paymentsPagePath = path.join(repoRoot, "src/app/(family)/family/payments/page.tsx");

const FORBIDDEN_BILLING_COPY = [
  /crunching/i,
  /retry connection/i,
  /calm overview/i,
  /fintech/i,
];

function assertNoForbiddenCopy(label: string, text: string) {
  for (const pattern of FORBIDDEN_BILLING_COPY) {
    expect(text, `${label} must not match ${pattern}`).not.toMatch(pattern);
  }
}

describe("family billing portal copy", () => {
  it("uses calm read-only billing language in shared constants", () => {
    assertNoForbiddenCopy("page title", FAMILY_BILLING_PAGE_TITLE);
    assertNoForbiddenCopy("page description", FAMILY_BILLING_PAGE_DESCRIPTION);
    assertNoForbiddenCopy("loading", FAMILY_BILLING_LOADING);
    assertNoForbiddenCopy("retry", FAMILY_BILLING_RETRY);
    assertNoForbiddenCopy("no payment", FAMILY_BILLING_NO_PAYMENT);
    assertNoForbiddenCopy("empty invoices title", FAMILY_BILLING_EMPTY_INVOICES_TITLE);
    assertNoForbiddenCopy("empty invoices description", FAMILY_BILLING_EMPTY_INVOICES_DESCRIPTION);

    expect(FAMILY_BILLING_PAGE_TITLE).toBe("Billing");
    expect(FAMILY_BILLING_LOADING).toBe("Loading billing…");
    expect(FAMILY_BILLING_RETRY).toBe("Retry");
    expect(FAMILY_BILLING_NO_PAYMENT).toBe("No payment posted");
    expect(FAMILY_BILLING_EMPTY_INVOICES_TITLE).toBe("No invoices posted yet");
    expect(FAMILY_BILLING_PAGE_DESCRIPTION).toMatch(/read-only/i);
    expect(FAMILY_BILLING_EMPTY_INVOICES_DESCRIPTION).toMatch(/business office posts a statement/i);
  });

  it("invoice and payment pages share calm loading and retry copy", () => {
    assertNoForbiddenCopy("invoices loading", FAMILY_INVOICES_LOADING);
    assertNoForbiddenCopy("invoices retry", FAMILY_INVOICES_RETRY);
    assertNoForbiddenCopy("payments loading", FAMILY_PAYMENTS_LOADING);
    assertNoForbiddenCopy("payments retry", FAMILY_PAYMENTS_RETRY);

    expect(FAMILY_INVOICES_LOADING).toBe("Loading invoices…");
    expect(FAMILY_INVOICES_RETRY).toBe("Retry");
    expect(FAMILY_INVOICES_EMPTY_TITLE).toBe(FAMILY_BILLING_EMPTY_INVOICES_TITLE);
    expect(FAMILY_INVOICES_EMPTY_DESCRIPTION).toBe(FAMILY_BILLING_EMPTY_INVOICES_DESCRIPTION);
    expect(FAMILY_PAYMENTS_LOADING).toBe("Loading payments…");
    expect(FAMILY_PAYMENTS_RETRY).toBe("Retry");
    expect(FAMILY_PAYMENTS_EMPTY_TITLE).toBe("No payments posted yet");
    expect(FAMILY_PAYMENTS_EMPTY_DESCRIPTION).toMatch(/business office posts a payment/i);
  });

  it("last payment helpers use explicit copy instead of silent dashes", () => {
    expect(formatFamilyLastPaymentAmount(null)).toBe("No payment posted");
    expect(formatFamilyLastPaymentDate(null)).toBe("No payment posted");

    // Stored invoice and payment amounts are integer cents.
    expect(formatFamilyLastPaymentAmount(0)).toBe("$0.00");
    expect(formatFamilyLastPaymentAmount(12500)).toBe("$125.00");
    expect(formatFamilyLastPaymentAmount(12345)).toBe("$123.45");
    expect(formatFamilyLastPaymentDate("Jan 15, 2026")).toBe("Jan 15, 2026");
  });

  it("payment reference helper uses explicit copy instead of silent dashes", () => {
    expect(FAMILY_BILLING_NO_REFERENCE_COPY).toBe("No reference posted");
    expect(formatFamilyPaymentReference(null)).toBe("No reference posted");
    expect(formatFamilyPaymentReference(undefined)).toBe("No reference posted");
    expect(formatFamilyPaymentReference("")).toBe("No reference posted");
    expect(formatFamilyPaymentReference("   ")).toBe("No reference posted");
    expect(formatFamilyPaymentReference("  REF-PLACEHOLDER-001  ")).toBe("REF-PLACEHOLDER-001");
  });

  it("family billing data load path uses payment reference formatter", () => {
    const source = fs.readFileSync(billingDataPath, "utf8");

    expect(source).toMatch(/formatFamilyPaymentReference/);
    expect(source).not.toMatch(/reference_number\?\.trim\(\) \|\| "—"/);
  });

  it("billing page imports shared copy and has no fintech demo language", () => {
    const source = fs.readFileSync(billingPagePath, "utf8");

    expect(source).toMatch(/FAMILY_BILLING_PAGE_TITLE/);
    expect(source).toMatch(/FAMILY_BILLING_PAGE_DESCRIPTION/);
    expect(source).toMatch(/FAMILY_BILLING_LOADING/);
    expect(source).toMatch(/FAMILY_BILLING_RETRY/);
    expect(source).toMatch(/FAMILY_BILLING_EMPTY_INVOICES_TITLE/);
    expect(source).toMatch(/FAMILY_BILLING_EMPTY_INVOICES_DESCRIPTION/);
    expect(source).toMatch(/formatFamilyLastPaymentAmount/);
    expect(source).toMatch(/formatFamilyLastPaymentDate/);

    expect(source).not.toMatch(/Crunching the numbers/i);
    expect(source).not.toMatch(/Retry Connection/i);
    expect(source).not.toMatch(/"—"/);
    expect(source).not.toMatch(/calm overview/i);
  });

  it("invoices and payments pages import shared copy without fintech demo language", () => {
    const invoicesSource = fs.readFileSync(invoicesPagePath, "utf8");
    const paymentsSource = fs.readFileSync(paymentsPagePath, "utf8");

    expect(invoicesSource).toMatch(/FAMILY_INVOICES_LOADING/);
    expect(invoicesSource).toMatch(/FAMILY_INVOICES_RETRY/);
    expect(invoicesSource).not.toMatch(/Crunching the numbers/i);
    expect(invoicesSource).not.toMatch(/Retry Connection/i);

    expect(paymentsSource).toMatch(/FAMILY_PAYMENTS_LOADING/);
    expect(paymentsSource).toMatch(/FAMILY_PAYMENTS_RETRY/);
    expect(paymentsSource).not.toMatch(/Crunching the numbers/i);
    expect(paymentsSource).not.toMatch(/Retry Connection/i);
  });

  it("family-portal-copy module keeps billing strings free of fintech demo language", () => {
    const source = fs.readFileSync(familyPortalCopyPath, "utf8");
    const billingBlock = source.slice(source.indexOf("FAMILY_BILLING_PAGE_TITLE"));

    for (const pattern of FORBIDDEN_BILLING_COPY) {
      expect(billingBlock).not.toMatch(pattern);
    }
    expect(billingBlock).toMatch(/read-only/i);
    expect(billingBlock).toMatch(/No invoices posted yet/);
    expect(billingBlock).toMatch(/No payment posted/);
  });
});
