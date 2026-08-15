import { describe, expect, it } from "vitest";

import { FORMAT_USD_NO_AMOUNT_POSTED_COPY } from "@/lib/insurance/format-money";

import {
  AR_AGING_NO_INVOICE_COUNT_POSTED_COPY,
  formatArAgingBucketCents,
  formatArAgingInvoiceCount,
  formatArAgingInvoiceCountCaption,
} from "./ar-aging-display-copy";

const EM_DASH = "—";

describe("formatArAgingBucketCents", () => {
  it("names missing cents instead of an em dash", () => {
    expect(formatArAgingBucketCents(null)).toBe(FORMAT_USD_NO_AMOUNT_POSTED_COPY);
    expect(formatArAgingBucketCents(undefined)).toBe(FORMAT_USD_NO_AMOUNT_POSTED_COPY);
    expect(formatArAgingBucketCents(null)).not.toBe(EM_DASH);
  });

  it("keeps real zero cents as $0.00", () => {
    expect(formatArAgingBucketCents(0)).toBe("$0.00");
  });

  it("formats positive cents as USD currency", () => {
    expect(formatArAgingBucketCents(12_345)).toBe("$123.45");
    expect(formatArAgingBucketCents(1)).toBe("$0.01");
  });
});

describe("formatArAgingInvoiceCount", () => {
  it("names missing counts instead of an em dash", () => {
    expect(formatArAgingInvoiceCount(null)).toBe(AR_AGING_NO_INVOICE_COUNT_POSTED_COPY);
    expect(formatArAgingInvoiceCount(undefined)).toBe(AR_AGING_NO_INVOICE_COUNT_POSTED_COPY);
    expect(formatArAgingInvoiceCount(null)).not.toBe(EM_DASH);
  });

  it("keeps real zero counts numeric", () => {
    expect(formatArAgingInvoiceCount(0)).toBe(0);
  });

  it("returns loaded counts unchanged", () => {
    expect(formatArAgingInvoiceCount(3)).toBe(3);
    expect(formatArAgingInvoiceCount(14)).toBe(14);
  });
});

describe("formatArAgingInvoiceCountCaption", () => {
  it("names missing counts instead of em-dash invoices", () => {
    expect(formatArAgingInvoiceCountCaption(null)).toBe(AR_AGING_NO_INVOICE_COUNT_POSTED_COPY);
    expect(formatArAgingInvoiceCountCaption(undefined)).toBe(AR_AGING_NO_INVOICE_COUNT_POSTED_COPY);
    expect(formatArAgingInvoiceCountCaption(null)).not.toBe("— invoices");
  });

  it("keeps real zero as 0 invoices", () => {
    expect(formatArAgingInvoiceCountCaption(0)).toBe("0 invoices");
  });

  it("formats positive counts with invoices suffix", () => {
    expect(formatArAgingInvoiceCountCaption(1)).toBe("1 invoices");
    expect(formatArAgingInvoiceCountCaption(12)).toBe("12 invoices");
  });
});
