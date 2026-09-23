import { describe, expect, it } from "vitest";

import { complianceDateChunks, complianceServiceDates, mapWithConcurrency } from "./compliance-day-chunks";

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

describe("complianceDateChunks", () => {
  it("covers the range in consecutive week-long spans with no gap or overlap", () => {
    expect(complianceDateChunks("2026-08-24", "2026-09-23")).toEqual([
      { from: "2026-08-24", to: "2026-08-30" },
      { from: "2026-08-31", to: "2026-09-06" },
      { from: "2026-09-07", to: "2026-09-13" },
      { from: "2026-09-14", to: "2026-09-20" },
      { from: "2026-09-21", to: "2026-09-23" },
    ]);
    expect(complianceDateChunks("2026-09-22", "2026-09-22")).toEqual([{ from: "2026-09-22", to: "2026-09-22" }]);
  });

  it("never asks for more than the chunk size in one call", () => {
    for (const chunk of complianceDateChunks("2026-01-01", "2026-12-31", 7)) {
      expect(complianceServiceDates(chunk.from, chunk.to).length).toBeLessThanOrEqual(7);
    }
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
