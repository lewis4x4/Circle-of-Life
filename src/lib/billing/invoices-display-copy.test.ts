import { describe, expect, it } from "vitest";

import {
  BILLING_LEDGER_INVOICE_COLUMN_LABEL,
  INVOICE_NO_UPDATED_AT_COPY,
  INVOICE_NUMBER_MISSING_COPY,
  formatInvoiceNumberForDisplay,
  formatUpdatedAt,
} from "./invoices-display-copy";

const EM_DASH = "—";

describe("formatInvoiceNumberForDisplay", () => {
  it("passes through human-posted invoice numbers unchanged", () => {
    expect(
      formatInvoiceNumberForDisplay("OAK-2026-03-001", {
        invoiceDateIso: "2026-03-01",
        invoiceId: "b5000000-0000-0000-0000-000000000001",
      }),
    ).toBe("OAK-2026-03-001");
    expect(formatInvoiceNumberForDisplay("INV-1001")).toBe("INV-1001");
  });

  it("formats internal persist keys without leaking UUID-shaped segments", () => {
    const formatted = formatInvoiceNumberForDisplay(
      "00000000-2026-08-c0000000-0000-0000-0000-0000000000a1",
      {
        invoiceDateIso: "2026-08-01",
        invoiceId: "b5000000-0000-0000-0000-0000000000a1",
      },
    );

    expect(formatted).toBe("Invoice Aug 2026 · …00a1");
    expect(formatted).not.toContain("00000000-2026-08");
    expect(formatted).not.toContain("c0000000-0000-0000-0000-0000000000a1");
    expect(formatted).not.toBe(EM_DASH);
  });

  it("formats a raw UUID invoice number with invoice id suffix", () => {
    expect(
      formatInvoiceNumberForDisplay("123e4567-e89b-12d3-a456-426614174000", {
        invoiceDateIso: "2026-05-15",
        invoiceId: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).toBe("Invoice May 2026 · …4000");
  });

  it("names the gap when invoice number is blank", () => {
    expect(formatInvoiceNumberForDisplay("")).toBe(INVOICE_NUMBER_MISSING_COPY);
    expect(formatInvoiceNumberForDisplay("   ")).toBe(INVOICE_NUMBER_MISSING_COPY);
    expect(formatInvoiceNumberForDisplay("")).not.toBe(EM_DASH);
  });
});

describe("billing ledger invoice column label", () => {
  it("uses Invoice instead of a bare hash symbol", () => {
    expect(BILLING_LEDGER_INVOICE_COLUMN_LABEL).toBe("Invoice");
    expect(BILLING_LEDGER_INVOICE_COLUMN_LABEL).not.toBe("#");
  });
});

describe("formatUpdatedAt", () => {
  it("names the gap when updated-at is unparseable", () => {
    expect(formatUpdatedAt("not-a-date")).toBe(INVOICE_NO_UPDATED_AT_COPY);
    expect(formatUpdatedAt("")).toBe(INVOICE_NO_UPDATED_AT_COPY);
    expect(formatUpdatedAt("not-a-date")).not.toBe(EM_DASH);
  });

  it("formats a posted ISO timestamp with en-US month, day, hour, and minute", () => {
    const formatted = formatUpdatedAt("2026-05-20T14:05:00Z");
    expect(formatted).toMatch(/May/);
    expect(formatted).toMatch(/20/);
    expect(formatted).not.toBe(INVOICE_NO_UPDATED_AT_COPY);
    expect(formatted).not.toBe(EM_DASH);
  });
});
