import { describe, expect, it } from "vitest";

import {
  financeLedgerQueueState,
  financeOverviewKpiEmptyCopy,
  financeOverviewKpiTileValue,
  type FinanceOverviewKpiContext,
} from "./finance-overview-display-copy";

const EM_DASH = "—";

function ctx(partial: Partial<FinanceOverviewKpiContext> = {}): FinanceOverviewKpiContext {
  return {
    loadFailed: false,
    ...partial,
  };
}

describe("financeOverviewKpiEmptyCopy", () => {
  it("names a failed overview fetch", () => {
    expect(financeOverviewKpiEmptyCopy("posted_count", ctx({ loadFailed: true }))).toBe(
      "Finance counts did not load",
    );
    expect(financeOverviewKpiEmptyCopy("unposted_invoices", ctx({ loadFailed: true }))).toBe(
      "Finance counts did not load",
    );
  });

  it("names per-metric load gaps when counts are absent", () => {
    expect(financeOverviewKpiEmptyCopy("posted_count", ctx())).toBe("Posted count not loaded yet");
    expect(financeOverviewKpiEmptyCopy("unposted_invoices", ctx())).toBe(
      "Unposted invoice count not loaded yet",
    );
  });
});

describe("financeOverviewKpiTileValue", () => {
  it("keeps real zeros numeric", () => {
    expect(financeOverviewKpiTileValue("posted_count", 0, ctx())).toBe(0);
    expect(financeOverviewKpiTileValue("unposted_invoices", 0, ctx())).toBe(0);
  });

  it("returns loaded counts unchanged", () => {
    expect(financeOverviewKpiTileValue("posted_count", 14, ctx())).toBe(14);
    expect(financeOverviewKpiTileValue("unposted_invoices", 3, ctx())).toBe(3);
  });

  it("returns explicit copy when the count is null", () => {
    expect(financeOverviewKpiTileValue("posted_count", null, ctx())).toBe("Posted count not loaded yet");
    expect(financeOverviewKpiTileValue("unposted_invoices", null, ctx())).toBe(
      "Unposted invoice count not loaded yet",
    );
    expect(financeOverviewKpiTileValue("posted_count", null, ctx({ loadFailed: true }))).toBe(
      "Finance counts did not load",
    );
    expect(financeOverviewKpiTileValue("unposted_invoices", null, ctx({ loadFailed: true }))).toBe(
      "Finance counts did not load",
    );
    expect(financeOverviewKpiTileValue("posted_count", null, ctx())).not.toBe(EM_DASH);
    expect(financeOverviewKpiTileValue("unposted_invoices", null, ctx())).not.toBe(EM_DASH);
  });
});

describe("financeLedgerQueueState (COL-649)", () => {
  it("does not claim 'Ledger Reconciled' when nothing was sent", () => {
    expect(financeLedgerQueueState({ unpostedInvoices: 0, sentInvoices: 0, loadFailed: false })).toEqual({
      kind: "no_sent_invoices",
    });
  });

  it("does not claim it when the counts did not load", () => {
    expect(financeLedgerQueueState({ unpostedInvoices: null, sentInvoices: null, loadFailed: false }).kind).toBe(
      "unavailable",
    );
    expect(financeLedgerQueueState({ unpostedInvoices: 0, sentInvoices: 12, loadFailed: true }).kind).toBe("unavailable");
  });

  it("reconciles only when sent invoices exist and none is unposted", () => {
    expect(financeLedgerQueueState({ unpostedInvoices: 0, sentInvoices: 12, loadFailed: false }).kind).toBe("reconciled");
    expect(financeLedgerQueueState({ unpostedInvoices: 3, sentInvoices: 12, loadFailed: false })).toEqual({
      kind: "unposted",
      count: 3,
    });
  });
});
