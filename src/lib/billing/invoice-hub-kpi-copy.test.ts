import { describe, expect, it } from "vitest";

import {
  invoiceHubKpiCountTileValue,
  invoiceHubKpiEmptyCopy,
  invoiceHubKpiMoneyTileValue,
  invoiceHubKpiTileIsMetric,
  type InvoiceHubKpiContext,
} from "./invoice-hub-kpi-copy";

function ctx(partial: Partial<InvoiceHubKpiContext> = {}): InvoiceHubKpiContext {
  return {
    isLoading: false,
    loadFailed: false,
    invoiceFetchComplete: true,
    ...partial,
  };
}

describe("invoiceHubKpiEmptyCopy", () => {
  it("names a loading gap while invoices are in flight", () => {
    expect(invoiceHubKpiEmptyCopy("in_scope", ctx({ isLoading: true, invoiceFetchComplete: false }))).toBe(
      "Loading invoice scope…",
    );
    expect(invoiceHubKpiEmptyCopy("total_billed", ctx({ isLoading: true, invoiceFetchComplete: false }))).toBe(
      "Loading billed totals…",
    );
  });

  it("names a failed fetch", () => {
    expect(invoiceHubKpiEmptyCopy("outstanding", ctx({ loadFailed: true }))).toBe("Billing data did not load");
  });

  it("returns null when the snapshot is loaded", () => {
    expect(invoiceHubKpiEmptyCopy("overdue", ctx())).toBeNull();
  });
});

describe("invoiceHubKpiCountTileValue", () => {
  it("keeps real zeros numeric", () => {
    expect(invoiceHubKpiCountTileValue("in_scope", 0, ctx())).toBe(0);
    expect(invoiceHubKpiCountTileValue("overdue", 0, ctx())).toBe(0);
  });

  it("returns loaded counts unchanged", () => {
    expect(invoiceHubKpiCountTileValue("in_scope", 14, ctx())).toBe(14);
    expect(invoiceHubKpiCountTileValue("overdue", 3, ctx())).toBe(3);
  });

  it("returns explicit copy when the count is null", () => {
    expect(invoiceHubKpiCountTileValue("in_scope", null, ctx({ invoiceFetchComplete: false }))).toBe(
      "Loading invoice scope…",
    );
    expect(invoiceHubKpiCountTileValue("overdue", null, ctx({ loadFailed: true }))).toBe(
      "Billing data did not load",
    );
  });
});

describe("invoiceHubKpiMoneyTileValue", () => {
  it("keeps real zero cents as $0.00", () => {
    expect(invoiceHubKpiMoneyTileValue("total_billed", 0, ctx())).toBe("$0.00");
    expect(invoiceHubKpiMoneyTileValue("outstanding", 0, ctx())).toBe("$0.00");
  });

  it("formats loaded cents", () => {
    expect(invoiceHubKpiMoneyTileValue("total_billed", 12_345, ctx())).toBe("$123.45");
  });

  it("returns explicit copy when cents are null", () => {
    expect(invoiceHubKpiMoneyTileValue("outstanding", null, ctx({ invoiceFetchComplete: false }))).toBe(
      "Loading outstanding balances…",
    );
    expect(invoiceHubKpiMoneyTileValue("total_billed", null, ctx({ loadFailed: true }))).toBe(
      "Billing data did not load",
    );
  });
});

describe("invoiceHubKpiTileIsMetric", () => {
  it("treats numeric displays as metrics", () => {
    expect(invoiceHubKpiTileIsMetric(0)).toBe(true);
    expect(invoiceHubKpiTileIsMetric(12)).toBe(true);
  });

  it("treats gap copy as messages", () => {
    expect(invoiceHubKpiTileIsMetric("Loading invoice scope…")).toBe(false);
    expect(invoiceHubKpiTileIsMetric("$0.00")).toBe(false);
  });
});
