import { describe, expect, it } from "vitest";

import { PILLARS, findActivePillar } from "./pillars";

describe("pillars navigation", () => {
  it("does not place reputation under the Quality pillar", () => {
    const qualityPillar = PILLARS.find((pillar) => pillar.id === "quality");

    expect(qualityPillar).toBeDefined();
    expect(qualityPillar?.items.map((item) => item.key)).not.toContain("reputation");
    expect(qualityPillar?.items.map((item) => item.href)).not.toContain("/admin/reputation");
  });

  it("does not assign the reputation route to any pillar", () => {
    expect(findActivePillar("/admin/reputation")?.id).not.toBe("quality");
  });
});
