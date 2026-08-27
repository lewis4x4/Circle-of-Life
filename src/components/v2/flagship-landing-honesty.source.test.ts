import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveUiV2AdminRewritePath, uiV2 } from "@/lib/flags";

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const navSource = read("src/components/v2/flagship-landing-nav.tsx");
const w1Source = read("src/components/v2/W1DashboardClient.tsx");
const w2Source = read("src/components/v2/W2ListClient.tsx");
const w3Source = read("src/components/v2/W3AnalyticsClient.tsx");

describe("flagship V2 landing honesty", () => {
  it("keeps V2 as the default landing and does not kill-switch the rewrite", () => {
    expect(uiV2({})).toBe(true);
    expect(resolveUiV2AdminRewritePath("/admin/executive", { enabled: true })).toBe(
      "/admin/v2/executive",
    );
    expect(resolveUiV2AdminRewritePath("/admin/executive/standup", { enabled: true })).toBe(
      "/admin/v2/executive/standup",
    );
    expect(resolveUiV2AdminRewritePath("/admin/rounding", { enabled: true })).toBe(
      "/admin/v2/rounding",
    );
    expect(resolveUiV2AdminRewritePath("/admin/residents", { enabled: true })).toBe(
      "/admin/v2/residents",
    );
  });

  it("mounts rounding and executive hub nav on rewritten V2 dashboards", () => {
    expect(w1Source).toContain("FlagshipDashboardHeaderNav");
    expect(w1Source).toContain("FlagshipDashboardBoardNav");
    expect(navSource).toContain("RoundingHubNav");
    expect(navSource).toContain("ExecutiveHubNav");
    expect(navSource).toContain('dashboardId === "rounding-operations"');
    expect(navSource).toContain('dashboardId === "executive-intelligence"');
  });

  it("mounts executive hub nav on rewritten standup / reports / benchmarks", () => {
    expect(w3Source).toContain("FlagshipAnalyticsLandingNav");
    expect(navSource).toContain('"executive-standup"');
    expect(navSource).toContain('"executive-reports"');
    expect(navSource).toContain('"executive-benchmarks"');
  });

  it("names the residents V2 list as the current roster landing", () => {
    expect(w2Source).toContain("Current resident roster in scope");
    expect(w2Source).not.toContain("All admitted residents in scope");
  });
});
