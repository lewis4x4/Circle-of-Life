import { describe, expect, it } from "vitest";

import {
  formatSeedTargetCoveragePct,
  SEED_TARGETS_NO_COVERAGE_COPY,
} from "./seed-targets-display-copy";

describe("formatSeedTargetCoveragePct", () => {
  it("names missing coverage pct without an em dash", () => {
    expect(formatSeedTargetCoveragePct(null)).toBe(SEED_TARGETS_NO_COVERAGE_COPY);
    expect(formatSeedTargetCoveragePct(undefined)).toBe(SEED_TARGETS_NO_COVERAGE_COPY);
    expect(formatSeedTargetCoveragePct(null)).not.toBe("—");
    expect(formatSeedTargetCoveragePct(undefined)).not.toBe("—");
  });

  it("keeps real zero as 0%", () => {
    expect(formatSeedTargetCoveragePct(0)).toBe("0%");
  });

  it("returns posted percentage unchanged", () => {
    expect(formatSeedTargetCoveragePct(42)).toBe("42%");
  });
});
