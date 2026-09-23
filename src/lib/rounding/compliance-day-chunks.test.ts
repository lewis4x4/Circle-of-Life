import { describe, expect, it } from "vitest";

import { complianceServiceDates, mapWithConcurrency } from "./compliance-day-chunks";

describe("complianceServiceDates", () => {
  it("lists every calendar date inclusive, across a month end and a DST change", () => {
    expect(complianceServiceDates("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(complianceServiceDates("2026-09-22", "2026-09-22")).toEqual(["2026-09-22"]);
  });
});

describe("mapWithConcurrency", () => {
  it("keeps input order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 8 - n));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
