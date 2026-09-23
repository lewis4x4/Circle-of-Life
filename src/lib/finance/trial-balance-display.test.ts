import { describe, expect, it } from "vitest";

import { trialBalanceEmptyCopy } from "./trial-balance-display";

const base = {
  error: null,
  loading: false,
  entityId: "e1",
  dateFrom: "2026-09-01",
  dateTo: "2026-09-30",
  rowCount: 0,
};

describe("trialBalanceEmptyCopy (COL-649)", () => {
  it("does not say 'No posted entries' before the report ran for this range", () => {
    expect(trialBalanceEmptyCopy({ ...base, lastRun: null })).toMatch(/^Run the report/);
    expect(
      trialBalanceEmptyCopy({ ...base, lastRun: { entityId: "e1", dateFrom: "2026-08-01", dateTo: "2026-08-31" } }),
    ).toMatch(/^Run the report/);
  });

  it("names a missing legal entity", () => {
    expect(trialBalanceEmptyCopy({ ...base, entityId: "", lastRun: null })).toMatch(/No legal entity/);
  });

  it("says nothing after a failed run (the error is shown)", () => {
    expect(trialBalanceEmptyCopy({ ...base, error: "boom", lastRun: null })).toBeNull();
  });

  it("reports an empty result only for the range that actually ran", () => {
    expect(
      trialBalanceEmptyCopy({ ...base, lastRun: { entityId: "e1", dateFrom: "2026-09-01", dateTo: "2026-09-30" } }),
    ).toBe("No posted entries between 2026-09-01 and 2026-09-30.");
  });
});
