import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/metrics/metric-state";

import { payrollBatchCountState } from "./payroll-hub-display";

describe("payrollBatchCountState (COL-649)", () => {
  it("names the missing facility instead of showing 0 batches", () => {
    expect(formatMetric(payrollBatchCountState({ facilityReady: false, loading: false, error: null, shownCount: 0 }))).toBe(
      "Select a facility",
    );
  });

  it("is unavailable after a failed read", () => {
    expect(
      formatMetric(payrollBatchCountState({ facilityReady: true, loading: false, error: "boom", shownCount: 0 })),
    ).toBe("Unavailable");
  });

  it("keeps a real zero for a loaded facility", () => {
    expect(formatMetric(payrollBatchCountState({ facilityReady: true, loading: false, error: null, shownCount: 0 }))).toBe(
      "0",
    );
  });
});
