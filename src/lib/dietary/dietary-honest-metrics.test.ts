import { describe, expect, it } from "vitest";

import { computeDietaryBatchStats, formatDietaryBatchStatPct } from "./dietary-batch-stats-display-copy";
import { dietaryActiveOrdersMetric, dietaryAttentionQueueIsClear } from "./dietary-hub-display-copy";
import { formatMetric } from "@/lib/metrics/metric-state";

const row = (over: Partial<{ iddsi_fluid_level: string; requires_swallow_eval: boolean | null; allergy_constraints: string[]; medication_texture_review_notes: string | null }> = {}) => ({
  iddsi_fluid_level: "thin",
  requires_swallow_eval: false,
  allergy_constraints: [] as string[],
  medication_texture_review_notes: null,
  ...over,
});
const thick = (level: string) => level !== "thin";

describe("dietary hub honest metrics (COL-649)", () => {
  it("Active diet orders names the missing facility instead of 0", () => {
    const state = dietaryActiveOrdersMetric({ facilityReady: false, loading: false, error: null, count: 0 });
    expect(formatMetric(state)).toBe("Select a facility");
  });

  it("Active diet orders is Unavailable after a failed read", () => {
    expect(formatMetric(dietaryActiveOrdersMetric({ facilityReady: true, loading: false, error: "x", count: 0 }))).toBe(
      "Unavailable",
    );
  });

  it("keeps a real zero once a facility's orders were read", () => {
    expect(formatMetric(dietaryActiveOrdersMetric({ facilityReady: true, loading: false, error: null, count: 0 }))).toBe("0");
  });

  it("therapeutic shares have no value over zero orders (not 0%)", () => {
    const stats = computeDietaryBatchStats([], thick);
    expect(stats.thickenedPct).toBeNull();
    expect(formatDietaryBatchStatPct("thickened", stats.thickenedPct, false)).toBe("No thickened share posted");
  });

  it("computes shares over real orders", () => {
    const stats = computeDietaryBatchStats([row({ iddsi_fluid_level: "mildly_thick" }), row()], thick);
    expect(stats.thickenedPct).toBe(50);
    expect(stats.swallowPct).toBe(0);
  });

  it("the attention queue is All Clear only over loaded orders", () => {
    const base = { facilityReady: true, loading: false, error: null, attentionCount: 0 };
    expect(dietaryAttentionQueueIsClear({ ...base, ordersInView: 0 })).toBe(false);
    expect(dietaryAttentionQueueIsClear({ ...base, ordersInView: 5, error: "x" })).toBe(false);
    expect(dietaryAttentionQueueIsClear({ ...base, ordersInView: 5 })).toBe(true);
  });
});
