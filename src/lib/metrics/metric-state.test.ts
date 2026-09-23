import { describe, expect, it } from "vitest";

import {
  averageOfReported,
  canClaimAllClear,
  formatMetric,
  metricFromCount,
  metricFromRead,
  metricNeedsFacility,
  metricRate,
  metricValue,
} from "./metric-state";

describe("metricFromCount", () => {
  it("is unavailable when the count query failed, never 0", () => {
    const state = metricFromCount({ count: null, error: { message: "column does not exist" } });
    expect(state.status).toBe("unavailable");
    expect(formatMetric(state)).toBe("Unavailable");
  });

  it("is unavailable when the count is missing without an error", () => {
    expect(metricFromCount({ count: null }).status).toBe("unavailable");
  });

  it("keeps a real zero", () => {
    expect(metricFromCount({ count: 0 })).toEqual(metricValue(0));
  });

  it("reports loading first", () => {
    expect(formatMetric(metricFromCount({ count: 3, loading: true }))).toBe("Loading…");
  });
});

describe("metricFromRead", () => {
  it("names the missing facility instead of reading", () => {
    const state = metricFromRead({ scopeReady: false, value: 0 });
    expect(formatMetric(state)).toBe("Select a facility");
  });

  it("is no_data when the read succeeded with nothing to compute", () => {
    expect(formatMetric(metricFromRead({ value: null, noDataReason: "No payments recorded" }))).toBe(
      "No payments recorded",
    );
    expect(metricFromRead({ value: Number.NaN }).status).toBe("no_data");
  });

  it("prefers the error over a stale value", () => {
    expect(metricFromRead({ error: new Error("500"), value: 12 }).status).toBe("unavailable");
  });
});

describe("metricRate", () => {
  it("has no value when the denominator is zero (not 0% and not 100%)", () => {
    expect(metricRate({ numerator: 0, denominator: 0 }).status).toBe("no_data");
  });

  it("computes a percentage", () => {
    expect(metricRate({ numerator: 34, denominator: 36 })).toEqual(metricValue((34 / 36) * 100));
  });
});

describe("canClaimAllClear", () => {
  it("refuses an all-clear over an empty scope", () => {
    expect(canClaimAllClear({ scopeSize: 0, issueCount: 0 })).toBe(false);
  });

  it("refuses an all-clear after a failed read", () => {
    expect(canClaimAllClear({ error: new Error("403"), scopeSize: 12, issueCount: 0 })).toBe(false);
  });

  it("refuses an all-clear with no facility chosen or while loading", () => {
    expect(canClaimAllClear({ scopeReady: false, scopeSize: 12, issueCount: 0 })).toBe(false);
    expect(canClaimAllClear({ loading: true, scopeSize: 12, issueCount: 0 })).toBe(false);
  });

  it("refuses an all-clear when the issue count is unknown", () => {
    expect(canClaimAllClear({ scopeSize: 12, issueCount: null })).toBe(false);
  });

  it("allows it when a successful read over real scope found nothing", () => {
    expect(canClaimAllClear({ scopeSize: 12, issueCount: 0 })).toBe(true);
  });
});

describe("averageOfReported", () => {
  it("leaves out members with no figure instead of counting them as 0", () => {
    const facilities = [
      { name: "Homewood", pct: 94.4 },
      { name: "Plantation", pct: null },
      { name: "Oakridge", pct: undefined },
    ];
    const result = averageOfReported(facilities, (f) => f.pct);
    expect(result.state).toEqual(metricValue(94.4));
    expect(result.reported).toBe(1);
    expect(result.excluded).toBe(2);
  });

  it("is no_data when nobody reported", () => {
    expect(averageOfReported([{ pct: null }], (f) => f.pct).state.status).toBe("no_data");
  });
});

describe("metricNeedsFacility", () => {
  it("renders the missing choice", () => {
    expect(formatMetric(metricNeedsFacility())).toBe("Select a facility");
  });
});
