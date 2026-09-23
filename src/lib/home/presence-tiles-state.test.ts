import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/metrics/metric-state";

import { presenceSubtitle, presenceTileState } from "./presence-tiles-state";

describe("Home residents-today tiles (COL-649)", () => {
  it("an empty roster is not '0 in house'", () => {
    expect(formatMetric(presenceTileState({ available: true, rosterTotal: 0, value: 0 }))).toBe("None on roster");
    expect(presenceSubtitle({ available: true, rosterTotal: 0, licensedBeds: 54, openBeds: 54 })).toBe(
      "No residents are on the roster yet, so these tiles are not a census.",
    );
  });

  it("a failed read is unavailable", () => {
    expect(formatMetric(presenceTileState({ available: false, rosterTotal: 0, value: 0 }))).toBe("Unavailable");
  });

  it("a loaded roster shows real counts, including a real zero on one tile", () => {
    expect(formatMetric(presenceTileState({ available: true, rosterTotal: 34, value: 0 }))).toBe("0");
    expect(presenceSubtitle({ available: true, rosterTotal: 34, licensedBeds: 36, openBeds: 2 })).toBe(
      "34 on census · 36 licensed beds · 2 open. Every held bed counts.",
    );
  });
});
