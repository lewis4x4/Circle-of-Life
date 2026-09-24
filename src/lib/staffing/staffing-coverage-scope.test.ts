import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/metrics/metric-state";

import { describeCredentialPanel, describeShiftGapPanel, type StaffingCoverageScope } from "./staffing-coverage-scope";

const scope = (
  over: Partial<StaffingCoverageScope["credentials"]> = {},
  shiftsInWindow = 12,
): StaffingCoverageScope => ({
  shiftsInWindow,
  credentials: {
    requirementsSetUp: true,
    staffJudged: 20,
    requiredChecks: 30,
    expiredRequired: 0,
    staffMissingRequired: 0,
    expiredRequiredCertIds: [],
    expiredOnFile: 0,
    ...over,
  },
});

describe("describeShiftGapPanel (COL-649)", () => {
  it("does not call coverage sufficient when nothing is scheduled", () => {
    const panel = describeShiftGapPanel({ scope: scope({}, 0), openShiftShortage: 0, gapRows: 0 });
    expect(panel.badge).toBe("none_scheduled");
    expect(panel.emptyDescription).not.toMatch(/sufficient/i);
    expect(formatMetric(panel.tile)).toBe("No shifts scheduled");
  });

  it("does not call coverage sufficient when the schedule could not be read", () => {
    const panel = describeShiftGapPanel({ scope: null, openShiftShortage: 0, gapRows: 0 });
    expect(panel.badge).toBe("unknown");
    expect(formatMetric(panel.tile)).toBe("Unavailable");
  });

  it("says Clear only over scheduled shifts with no gaps", () => {
    const panel = describeShiftGapPanel({ scope: scope(), openShiftShortage: 0, gapRows: 0 });
    expect(panel.badgeLabel).toBe("Clear");
    expect(panel.emptyDescription).toMatch(/sufficient/i);
    expect(panel.tileCopy).toContain("12 scheduled shifts");
  });

  it("reports gaps", () => {
    const panel = describeShiftGapPanel({ scope: scope(), openShiftShortage: 3, gapRows: 2 });
    expect(panel.badge).toBe("gaps");
    expect(panel.tile).toEqual({ status: "value", value: 3 });
  });
});

describe("describeCredentialPanel (COL-649, COL-709)", () => {
  it("says requirements are not set up instead of flagging anyone", () => {
    const panel = describeCredentialPanel(
      scope({ requirementsSetUp: false, staffJudged: 0, requiredChecks: 0, expiredOnFile: 3 }),
    );
    expect(panel.clear).toBe(false);
    expect(panel.emptyTitle).toBe("Certification requirements not set up");
    expect(formatMetric(panel.tile)).toBe("Requirements not set up");
    expect(panel.tileCopy).toContain("3 certifications on file have lapsed");
  });

  it("is unavailable when certifications could not be read", () => {
    expect(describeCredentialPanel(null).tile.status).toBe("unavailable");
  });

  it("counts expired required credentials", () => {
    expect(describeCredentialPanel(scope({ expiredRequired: 23 })).tile).toEqual({ status: "value", value: 23 });
  });

  it("clears only when every required certification is on file and in date", () => {
    const panel = describeCredentialPanel(scope());
    expect(panel.clear).toBe(true);
    expect(panel.emptyTitle).toBe("No credential blockers");
    expect(panel.emptyDescription).toContain("All 30 required certifications");
  });

  it("does not clear while a required certification is missing", () => {
    const panel = describeCredentialPanel(scope({ staffMissingRequired: 4 }));
    expect(panel.clear).toBe(false);
    expect(panel.emptyTitle).toBe("Required certifications missing");
    expect(panel.emptyDescription).toContain("4 staff members are missing a required certification");
  });

  it("has nothing to check when no role in scope needs a certification", () => {
    const panel = describeCredentialPanel(scope({ requiredChecks: 0 }));
    expect(panel.clear).toBe(false);
    expect(formatMetric(panel.tile)).toBe("None required");
  });
});
