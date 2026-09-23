import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/metrics/metric-state";

import { describeCredentialPanel, describeShiftGapPanel, type StaffingCoverageScope } from "./staffing-coverage-scope";

const scope = (over: Partial<StaffingCoverageScope> = {}): StaffingCoverageScope => ({
  shiftsInWindow: 12,
  certificationsOnFile: 30,
  expiredCertifications: 0,
  staffWithoutCertifications: 0,
  ...over,
});

describe("describeShiftGapPanel (COL-649)", () => {
  it("does not call coverage sufficient when nothing is scheduled", () => {
    const panel = describeShiftGapPanel({ scope: scope({ shiftsInWindow: 0 }), openShiftShortage: 0, gapRows: 0 });
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

describe("describeCredentialPanel (COL-649)", () => {
  it("does not claim 'No credential blockers' when no certification is on file", () => {
    const panel = describeCredentialPanel(scope({ certificationsOnFile: 0, staffWithoutCertifications: 56 }));
    expect(panel.clear).toBe(false);
    expect(panel.emptyTitle).toBe("No certifications on file");
    expect(formatMetric(panel.tile)).toBe("No certs on file");
    expect(panel.tileCopy).toContain("56 active staff members have no certification on file");
  });

  it("is unavailable when certifications could not be read", () => {
    expect(describeCredentialPanel(null).tile.status).toBe("unavailable");
  });

  it("uses the true expired count, not the 10-row list", () => {
    expect(describeCredentialPanel(scope({ expiredCertifications: 23 })).tile).toEqual({ status: "value", value: 23 });
  });

  it("clears only over certifications on file, and still names staff without any", () => {
    const panel = describeCredentialPanel(scope({ staffWithoutCertifications: 4 }));
    expect(panel.clear).toBe(true);
    expect(panel.emptyTitle).toBe("No credential blockers");
    expect(panel.emptyDescription).toContain("4 active staff members have no certification on file");
  });
});
