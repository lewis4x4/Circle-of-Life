import { describe, expect, it } from "vitest";

import {
  billingActionQueueDraftCopy,
  billingActionQueueOverdueCopy,
  billingOverviewAppliedPeriodEmptyCopy,
  billingOverviewKpiEmptyCopy,
  billingOverviewKpiIsLoaded,
  billingOverviewKpiStripHelperLine,
  billingOverviewNinetyPlusShareEmptyCopy,
  billingOverviewOutstandingArEmptyCopy,
  billingOverviewOverdueCountEmptyCopy,
  type BillingOverviewKpiContext,
} from "./billing-overview-kpi-copy";

function ctx(partial: Partial<BillingOverviewKpiContext> = {}): BillingOverviewKpiContext {
  return {
    isLoading: false,
    loadFailed: false,
    invoiceFetchComplete: true,
    totalInvoiceRows: 0,
    openArTotalCents: 0,
    cohortResidentCount: 0,
    periodBilledCents: 0,
    periodAppliedRatePct: null,
    ninetyPlusSharePct: null,
    overdueCount: 0,
    ...partial,
  };
}

describe("billingOverviewOutstandingArEmptyCopy", () => {
  it("names a loading gap while invoices are in flight", () => {
    expect(
      billingOverviewOutstandingArEmptyCopy(
        ctx({ isLoading: true, invoiceFetchComplete: false }),
      ),
    ).toBe("Loading open balances…");
  });

  it("names an empty scope with active census", () => {
    expect(
      billingOverviewOutstandingArEmptyCopy(
        ctx({ totalInvoiceRows: 0, cohortResidentCount: 12 }),
      ),
    ).toBe("No invoices loaded — use opening balance import");
  });

  it("names an empty scope without census", () => {
    expect(billingOverviewOutstandingArEmptyCopy(ctx({ totalInvoiceRows: 0 }))).toBe(
      "No invoices in this scope",
    );
  });

  it("returns null when open AR is a real loaded balance including zero", () => {
    expect(
      billingOverviewOutstandingArEmptyCopy(
        ctx({ totalInvoiceRows: 3, openArTotalCents: 0 }),
      ),
    ).toBeNull();
  });
});

describe("billingOverviewNinetyPlusShareEmptyCopy", () => {
  it("names the gap when there is no open AR to age", () => {
    expect(billingOverviewNinetyPlusShareEmptyCopy(ctx({ openArTotalCents: 0 }))).toBe(
      "No open AR to age",
    );
  });

  it("returns null when ninety-plus share is loaded", () => {
    expect(
      billingOverviewNinetyPlusShareEmptyCopy(
        ctx({ openArTotalCents: 50_000, ninetyPlusSharePct: 12 }),
      ),
    ).toBeNull();
  });
});

describe("billingOverviewAppliedPeriodEmptyCopy", () => {
  it("names the gap when no invoices fall in the period", () => {
    expect(billingOverviewAppliedPeriodEmptyCopy(ctx({ periodBilledCents: 0 }))).toBe(
      "No invoices this period",
    );
  });

  it("returns null when collection rate is loaded", () => {
    expect(
      billingOverviewAppliedPeriodEmptyCopy(
        ctx({ periodBilledCents: 100_000, periodAppliedRatePct: 92 }),
      ),
    ).toBeNull();
  });
});

describe("billingOverviewOverdueCountEmptyCopy", () => {
  it("returns null when zero overdue is a real loaded count", () => {
    expect(
      billingOverviewOverdueCountEmptyCopy(
        ctx({ totalInvoiceRows: 4, overdueCount: 0 }),
      ),
    ).toBeNull();
  });
});

describe("billingOverviewKpiEmptyCopy", () => {
  it("routes metric keys to the right helper", () => {
    expect(billingOverviewKpiEmptyCopy("applied_period", ctx({ periodBilledCents: 0 }))).toBe(
      "No invoices this period",
    );
  });
});

describe("billingOverviewKpiIsLoaded", () => {
  it("treats zero overdue as loaded", () => {
    expect(
      billingOverviewKpiIsLoaded(
        "overdue_count",
        ctx({ totalInvoiceRows: 2, overdueCount: 0 }),
      ),
    ).toBe(true);
  });
});

describe("billingActionQueueOverdueCopy", () => {
  it("explains an empty scope", () => {
    expect(billingActionQueueOverdueCopy(ctx({ totalInvoiceRows: 0 }))).toBe(
      "No invoices in scope — nothing overdue yet",
    );
  });

  it("names a loaded zero-overdue state", () => {
    expect(billingActionQueueOverdueCopy(ctx({ totalInvoiceRows: 5, overdueCount: 0 }))).toBe(
      "No overdue invoices in scope",
    );
  });
});

describe("billingActionQueueDraftCopy", () => {
  it("names draft work when rows exist", () => {
    expect(billingActionQueueDraftCopy(2, ctx({ totalInvoiceRows: 5 }))).toBe(
      "2 draft invoices to finalize",
    );
  });
});

describe("billingOverviewKpiStripHelperLine", () => {
  it("celebrates a fully loaded strip", () => {
    expect(
      billingOverviewKpiStripHelperLine(
        ctx({
          totalInvoiceRows: 3,
          openArTotalCents: 25_000,
          periodBilledCents: 100_000,
          periodAppliedRatePct: 88,
          ninetyPlusSharePct: 4,
          overdueCount: 1,
        }),
      ),
    ).toBe(
      "AR snapshot loaded for the selected scope — open Invoices or Opening balance for ledger work.",
    );
  });

  it("reassures when every tile is empty", () => {
    expect(
      billingOverviewKpiStripHelperLine(
        ctx({ isLoading: true, invoiceFetchComplete: false }),
      ),
    ).toBe("Empty tiles name what is still missing — nothing is broken.");
  });

  it("counts partial loads", () => {
    expect(
      billingOverviewKpiStripHelperLine(
        ctx({
          totalInvoiceRows: 2,
          openArTotalCents: 0,
          periodBilledCents: 0,
        }),
      ),
    ).toBe("2 of 4 AR snapshot tiles loaded — empty tiles name what is still missing.");
  });
});
