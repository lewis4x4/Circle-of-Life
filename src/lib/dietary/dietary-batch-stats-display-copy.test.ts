import { describe, expect, it } from "vitest";

import {
  DIETARY_BATCH_STAT_LOADING_COPY,
  DIETARY_BATCH_STAT_NO_DATA_COPY,
  DIETARY_HUB_NO_UPDATED_AT_COPY,
  dietaryBatchStatBarWidthPct,
  formatDietaryBatchStatPct,
  formatDietaryHubRelativeUpdatedAt,
} from "./dietary-batch-stats-display-copy";

const EM_DASH = "—";

describe("formatDietaryBatchStatPct", () => {
  it.each([
    ["thickened", DIETARY_BATCH_STAT_LOADING_COPY.thickened],
    ["swallow", DIETARY_BATCH_STAT_LOADING_COPY.swallow],
    ["allergy", DIETARY_BATCH_STAT_LOADING_COPY.allergy],
    ["texture", DIETARY_BATCH_STAT_LOADING_COPY.texture],
  ] as const)("returns named loading copy for %s", (metric, expected) => {
    expect(formatDietaryBatchStatPct(metric, 42, true)).toBe(expected);
    expect(formatDietaryBatchStatPct(metric, null, true)).toBe(expected);
    expect(formatDietaryBatchStatPct(metric, 42, true)).not.toBe(EM_DASH);
  });

  it.each([
    ["thickened", 0],
    ["swallow", 0],
    ["allergy", 0],
    ["texture", 0],
  ] as const)("keeps real zero as 0%% for %s", (metric, pct) => {
    expect(formatDietaryBatchStatPct(metric, pct, false)).toBe("0%");
  });

  it.each([
    ["thickened", 12],
    ["swallow", 33],
    ["allergy", 7],
    ["texture", 100],
  ] as const)("formats positive share as N%% for %s", (metric, pct) => {
    expect(formatDietaryBatchStatPct(metric, pct, false)).toBe(`${pct}%`);
  });

  it.each([
    ["thickened", DIETARY_BATCH_STAT_NO_DATA_COPY.thickened],
    ["swallow", DIETARY_BATCH_STAT_NO_DATA_COPY.swallow],
    ["allergy", DIETARY_BATCH_STAT_NO_DATA_COPY.allergy],
    ["texture", DIETARY_BATCH_STAT_NO_DATA_COPY.texture],
  ] as const)("names missing pct when not loading for %s", (metric, expected) => {
    expect(formatDietaryBatchStatPct(metric, null, false)).toBe(expected);
    expect(formatDietaryBatchStatPct(metric, undefined, false)).toBe(expected);
    expect(formatDietaryBatchStatPct(metric, Number.NaN, false)).toBe(expected);
    expect(formatDietaryBatchStatPct(metric, null, false)).not.toBe(EM_DASH);
  });
});

describe("dietaryBatchStatBarWidthPct", () => {
  it("returns 0 while loading", () => {
    expect(dietaryBatchStatBarWidthPct(42, true)).toBe(0);
  });

  it("returns posted pct when loaded", () => {
    expect(dietaryBatchStatBarWidthPct(0, false)).toBe(0);
    expect(dietaryBatchStatBarWidthPct(12, false)).toBe(12);
  });

  it("returns 0 when pct is missing", () => {
    expect(dietaryBatchStatBarWidthPct(null, false)).toBe(0);
  });
});

describe("formatDietaryHubRelativeUpdatedAt", () => {
  it("names a missing update time instead of an em dash", () => {
    expect(formatDietaryHubRelativeUpdatedAt(null)).toBe(DIETARY_HUB_NO_UPDATED_AT_COPY);
    expect(formatDietaryHubRelativeUpdatedAt("")).toBe(DIETARY_HUB_NO_UPDATED_AT_COPY);
    expect(formatDietaryHubRelativeUpdatedAt("not-a-date")).toBe(DIETARY_HUB_NO_UPDATED_AT_COPY);
    expect(formatDietaryHubRelativeUpdatedAt(null)).not.toBe(EM_DASH);
  });

  it("formats a recent timestamp", () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatDietaryHubRelativeUpdatedAt(recent)).toBe("5m ago");
  });
});
