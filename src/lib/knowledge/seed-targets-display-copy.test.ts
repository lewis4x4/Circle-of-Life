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

describe("seedTargetStatusActions (COL-710)", () => {
  it("never offers a hand-set 'covered'", async () => {
    const { seedTargetStatusActions } = await import("./seed-targets-display-copy");
    expect(seedTargetStatusActions({ isGlobal: false, storedStatus: "uncovered" })).toEqual(["wip", "retired"]);
    expect(seedTargetStatusActions({ isGlobal: false, storedStatus: "covered" })).toEqual(["wip", "retired"]);
  });

  it("offers nothing on global default topics", async () => {
    const { seedTargetStatusActions } = await import("./seed-targets-display-copy");
    expect(seedTargetStatusActions({ isGlobal: true, storedStatus: "uncovered" })).toEqual([]);
  });
});

describe("linkableDocuments (COL-710)", () => {
  it("offers only published, undeleted documents not already linked", async () => {
    const { linkableDocuments } = await import("./seed-targets-display-copy");
    const docs = [
      { id: "a", status: "published", deleted_at: null },
      { id: "b", status: "archived", deleted_at: null },
      { id: "c", status: "published", deleted_at: "2026-09-01T00:00:00Z" },
      { id: "d", status: "published", deleted_at: null },
    ];
    expect(linkableDocuments(docs, new Set(["d"])).map((d) => d.id)).toEqual(["a"]);
  });
});
