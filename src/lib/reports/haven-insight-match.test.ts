import { describe, expect, it } from "vitest";

import { matchHavenInsightTemplates } from "@/lib/reports/haven-insight-match";

describe("matchHavenInsightTemplates", () => {
  it("maps fall intent to Incident Trend Summary with strong confidence", () => {
    const r = matchHavenInsightTemplates("Show me falls by facility this quarter");
    expect(r.variant).toBe("match");
    if (r.variant !== "match") return;
    expect(r.best.slug).toBe("incident-trend-summary");
    expect(r.best.confidence).toBeGreaterThanOrEqual(50);
  });

  it("maps occupancy intent to occupancy summary", () => {
    const r = matchHavenInsightTemplates("Compare occupancy across all facilities");
    expect(r.variant).toBe("match");
    if (r.variant !== "match") return;
    expect(r.best.slug).toBe("occupancy-census-summary");
  });

  it("maps gibberish to no-match with bounded confidence", () => {
    const r = matchHavenInsightTemplates("asdf qwerty zxzx nonexistent-topic-12345");
    expect(r.variant).toBe("no_match");
    if (r.variant !== "no_match") return;
    expect(r.highestConfidence).toBeLessThan(50);
  });
});
