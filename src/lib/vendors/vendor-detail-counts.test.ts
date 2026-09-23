import { describe, expect, it } from "vitest";

import { formatMetric, metricValue } from "@/lib/metrics/metric-state";

import { vendorDetailCounts } from "./vendor-detail-counts";

describe("vendorDetailCounts", () => {
  it("shows Unavailable for a failed count instead of 0", () => {
    const counts = vendorDetailCounts(
      { count: null, error: { message: "permission denied" } },
      { count: 3, error: null },
      { count: null, error: null },
    );
    expect(formatMetric(counts.contracts)).toBe("Unavailable");
    expect(counts.pos).toEqual(metricValue(3));
    expect(formatMetric(counts.invoices)).toBe("Unavailable");
  });

  it("keeps a real zero", () => {
    expect(vendorDetailCounts({ count: 0 }, { count: 0 }, { count: 0 }).contracts).toEqual(metricValue(0));
  });
});
