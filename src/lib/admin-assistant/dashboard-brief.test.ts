import { describe, expect, it } from "vitest";

import { transportationTodayStartUtcIso } from "./dashboard-brief";

describe("transportationTodayStartUtcIso", () => {
  it("uses Eastern midnight after 8 p.m. ET instead of the next UTC date", () => {
    const eightOhFivePmEt = new Date("2026-08-21T00:05:00.000Z");

    expect(transportationTodayStartUtcIso(eightOhFivePmEt)).toBe(
      "2026-08-20T04:00:00.000Z",
    );
  });

  it("serializes Eastern midnight as a UTC ISO timestamp", () => {
    const eightOhFivePmEt = new Date("2026-08-22T00:05:00.000Z");

    expect(transportationTodayStartUtcIso(eightOhFivePmEt)).toBe(
      "2026-08-21T04:00:00.000Z",
    );
  });
});
