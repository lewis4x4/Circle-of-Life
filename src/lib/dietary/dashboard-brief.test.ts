import { describe, expect, it } from "vitest";

import { dietaryMealsTodayStartUtcIso } from "./dashboard-brief";

describe("dietaryMealsTodayStartUtcIso", () => {
  it("uses Eastern midnight after 8 p.m. ET instead of the next UTC date", () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

    expect(dietaryMealsTodayStartUtcIso(eightOhFivePmEt)).toBe(
      "2026-08-20T04:00:00.000Z",
    );
    expect(dietaryMealsTodayStartUtcIso(eightOhFivePmEt)).not.toBe(
      "2026-08-21T00:00:00.000Z",
    );
  });
});
