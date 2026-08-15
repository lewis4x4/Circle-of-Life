import { describe, expect, it } from "vitest";

import {
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
