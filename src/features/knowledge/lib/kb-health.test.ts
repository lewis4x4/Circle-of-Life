import { describe, expect, it } from "vitest";

import { buildKBHealth, type KBHealthCounts } from "./kb-health";

const ok = (count: number) => ({ count, error: null });

const counts = (overrides: Partial<KBHealthCounts> = {}): KBHealthCounts => ({
  totalDocs: ok(20),
  publishedDocs: ok(18),
  failedDocs: ok(0),
  totalChunks: ok(400),
  embeddedChunks: ok(300),
  queryCount: ok(55),
  positiveFeedback: ok(4),
  negativeFeedback: ok(1),
  gapCount: ok(2),
  ...overrides,
});

describe("buildKBHealth (COL-708)", () => {
  it("throws on a missing count instead of reporting 0", () => {
    expect(() => buildKBHealth(counts({ failedDocs: { count: null } }))).toThrow(/Failed ingestion count/);
    expect(() => buildKBHealth(counts({ totalDocs: { count: null } }))).toThrow();
  });

  it("has no embedding coverage or average when there is nothing to divide", () => {
    const { health } = buildKBHealth(counts({ totalDocs: ok(0), totalChunks: ok(0), embeddedChunks: ok(0) }));
    expect(health.embeddingCoverage).toBeNull();
    expect(health.avgChunksPerDoc).toBeNull();
  });

  it("computes real figures, including real zeros", () => {
    const { health, insights } = buildKBHealth(counts());
    expect(health.embeddingCoverage).toBe(75);
    expect(health.avgChunksPerDoc).toBe(20);
    expect(health.failedIngestions).toBe(0);
    expect(insights.gapCount).toBe(2);
  });
});
