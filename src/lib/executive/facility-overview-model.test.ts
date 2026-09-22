import { describe, expect, it } from "vitest";

import type { ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import {
  attentionEmptyCopy,
  buildFacilityAttentionItems,
  buildFacilityCoverageGaps,
  buildFacilitySnapshotTiles,
  buildInsuranceCostDisplay,
  buildRoundingComplianceDisplay,
  buildRoundingSummary,
  longDateLabel,
  roundingDayBreakdown,
  settledSection,
  shortDayLabel,
  updatedAtLine,
} from "@/lib/executive/facility-overview-model";
import type { ComplianceSummary } from "@/lib/rounding/observation-compliance-summary";
import type {
  ResidentAssuranceFacilityRollup,
  ResidentAssuranceFacilityTrendPoint,
} from "@/lib/resident-assurance/command-center-brief";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";

function kpi(overrides: Partial<ExecKpiPayload> = {}): ExecKpiPayload {
  return {
    version: 1,
    census: { occupiedResidents: 0, licensedBeds: 52, occupancyPct: null, presence: { inHouse: 0, hospital: 0, onLeave: 0, onHold: 0, total: 0 } },
    financial: { openInvoicesCount: 0, totalBalanceDueCents: 0 },
    clinical: { openIncidents: 0, medicationErrorsMtd: 0 },
    compliance: { openSurveyDeficiencies: 0 },
    workforce: { certificationsExpiring30d: 0 },
    infection: { activeOutbreaks: 0 },
    residentAssurance: { overdueTasksCount: 0, missedRate: null, openExceptions: 0, activeWatchCount: 0 },
    ...overrides,
  };
}

function rollup(overrides: Partial<ResidentAssuranceFacilityRollup> = {}): ResidentAssuranceFacilityRollup {
  return {
    facilityId: FACILITY_ID,
    facilityName: "Anon",
    activeWatches: 0,
    pendingWatchApprovals: 0,
    openEscalations: 0,
    openIntegrityFlags: 0,
    criticalSafetyResidents: 0,
    highOrCriticalSafetyResidents: 0,
    heatScore: 0,
    heatBand: "stable",
    observed: false,
    lastObservedAt: null,
    ...overrides,
  };
}

function point(overrides: Partial<ResidentAssuranceFacilityTrendPoint> = {}): ResidentAssuranceFacilityTrendPoint {
  return {
    date: "2026-09-15",
    watchStarts: 0,
    escalations: 0,
    integrityFlags: 0,
    criticalResidents: 0,
    heatScore: 0,
    heatBand: "stable",
    observed: false,
    ...overrides,
  };
}

function complianceSummary(
  overrides: Partial<ComplianceSummary["totals"]> = {},
): ComplianceSummary {
  return {
    from: "2026-09-09",
    to: "2026-09-15",
    totals: {
      expected: 0,
      satisfied: 0,
      unconfigured: 0,
      absorbed: 0,
      withTask: 0,
      onTime: 0,
      late: 0,
      ...overrides,
    },
    byShift: [],
    byHall: [],
    byStaff: [],
  };
}

describe("buildFacilityAttentionItems", () => {
  it("lists did-not-run checks and uncleared operator rows escalated to the viewer (COL-602)", () => {
    const items = buildFacilityAttentionItems(null, null, { facilityId: "f-1", didNotRun: 1, uncleared: 2 });
    expect(items.map((item) => item.label)).toEqual([
      "1 check recorded as did not run",
      "2 operator rows not cleared by end of day",
    ]);
    expect(items[0].href).toBe("/admin/operations/work?facility_id=f-1");
    expect(buildFacilityAttentionItems(null, null, { facilityId: "f-1", didNotRun: 0, uncleared: 0 })).toEqual([]);
  });

  it("lists only recorded open items, in record terms", () => {
    const items = buildFacilityAttentionItems(
      kpi({ clinical: { openIncidents: 2, medicationErrorsMtd: 1 }, workforce: { certificationsExpiring30d: 3 } }),
      rollup({ openEscalations: 1, criticalSafetyResidents: 0, pendingWatchApprovals: 0, openIntegrityFlags: 0 }),
    );

    expect(items.map((item) => item.label)).toEqual([
      "2 open incidents",
      "1 medication error this month",
      "3 staff certifications expiring within 30 days",
      "1 open rounding escalation",
    ]);
    expect(items[0].href).toBe("/admin/incidents?scope=open");
    expect(items[0].linkLabel).toBe("View incidents");
  });

  it("returns nothing when every recorded count is zero", () => {
    expect(buildFacilityAttentionItems(kpi(), rollup())).toEqual([]);
  });

  it("tolerates a failed section", () => {
    expect(buildFacilityAttentionItems(null, rollup({ openIntegrityFlags: 2 }))).toHaveLength(1);
    expect(buildFacilityAttentionItems(kpi({ infection: { activeOutbreaks: 1 } }), null)).toHaveLength(1);
  });
});

describe("buildFacilityCoverageGaps", () => {
  it("names each unrecorded measure separately from open items", () => {
    const gaps = buildFacilityCoverageGaps({
      facilityId: FACILITY_ID,
      kpi: kpi(),
      rounding: rollup(),
      insurance: { periodStart: "2025-09-15", periodEnd: "2026-09-15", premiumsCents: 0, incurredLossesCents: 0, tcorCents: 0, policyRows: 0, claimRows: 0 },
    });

    expect(gaps.map((gap) => gap.key)).toEqual(["census", "rounding", "insurance"]);
    expect(gaps[0].href).toBe(`/admin/facilities/${FACILITY_ID}`);
  });

  it("treats a posted zero census, an observed facility and a filed policy as recorded", () => {
    const gaps = buildFacilityCoverageGaps({
      facilityId: FACILITY_ID,
      kpi: kpi({ census: { occupiedResidents: 0, licensedBeds: 52, occupancyPct: 0, presence: { inHouse: 0, hospital: 0, onLeave: 0, onHold: 0, total: 0 } } }),
      rounding: rollup({ observed: true }),
      insurance: { periodStart: "2025-09-15", periodEnd: "2026-09-15", premiumsCents: 0, incurredLossesCents: 0, tcorCents: 0, policyRows: 1, claimRows: 0 },
    });

    expect(gaps).toEqual([]);
  });
});

describe("attentionEmptyCopy", () => {
  it("never calls a partial or failed read an all-clear", () => {
    expect(attentionEmptyCopy(0, 0)).toBe("No open items recorded for this facility.");
    expect(attentionEmptyCopy(1, 0)).toContain("One measure is not recorded");
    expect(attentionEmptyCopy(2, 0)).toContain("2 measures are not recorded");
    expect(attentionEmptyCopy(0, 1)).toContain("could not be read");
  });
});

describe("buildFacilitySnapshotTiles", () => {
  it("keeps unposted census apart from counted zeros", () => {
    const tiles = buildFacilitySnapshotTiles(kpi(), FACILITY_ID);
    const byKey = Object.fromEntries(tiles.map((tile) => [tile.key, tile]));

    expect(byKey.census.state).toBe("not_recorded");
    expect(byKey.census.value).toBe("Not posted");
    expect(byKey.presence.state).toBe("recorded");
    expect(byKey.presence.value).toBe("No residents on the roster");
    expect(byKey.receivables.value).toBe("None open");
    expect(byKey.safety.value).toBe("0 open incidents");
    expect(byKey.compliance.value).toBe("0 open deficiencies");
    expect(byKey.workforce.value).toBe("0 certifications expiring");
    expect(byKey.infection.value).toBe("0 active outbreaks");
  });

  it("formats recorded values with their basis", () => {
    const tiles = buildFacilitySnapshotTiles(
      kpi({
        census: { occupiedResidents: 40, licensedBeds: 52, occupancyPct: 76.9, presence: { inHouse: 38, hospital: 2, onLeave: 0, onHold: 2, total: 40 } },
        financial: { openInvoicesCount: 3, totalBalanceDueCents: 452500 },
        clinical: { openIncidents: 1, medicationErrorsMtd: 2 },
      }),
      FACILITY_ID,
    );
    const byKey = Object.fromEntries(tiles.map((tile) => [tile.key, tile]));

    expect(byKey.census.value).toBe("40 beds occupied");
    expect(byKey.census.detail).toBe("77% of the posted bed grid · 52 licensed");
    expect(byKey.presence.value).toBe("38 in-house");
    expect(byKey.presence.detail).toBe("2 hospital · 0 on leave · 40 on the roster");
    expect(byKey.receivables.value).toBe("$4,525.00");
    expect(byKey.receivables.detail).toBe("3 open invoices with a balance due");
    expect(byKey.safety.value).toBe("1 open incident");
    expect(byKey.safety.detail).toBe("2 medication errors month to date");
  });
});

describe("buildRoundingSummary", () => {
  it("marks unobserved days as gaps and explains observed ones", () => {
    const summary = buildRoundingSummary(
      rollup({ observed: true, heatBand: "watch", heatScore: 3, lastObservedAt: "2026-09-15T12:00:00Z", openEscalations: 1 }),
      {
        facilityId: FACILITY_ID,
        facilityName: "Anon",
        latestHeatScore: 3,
        peakHeatScore: 3,
        avgHeatScore: 0.4,
        points: [
          point({ date: "2026-09-14" }),
          point({ date: "2026-09-15", observed: true, escalations: 1, watchStarts: 2, heatScore: 5, heatBand: "watch" }),
        ],
        observedDays: 1,
        days: 2,
        lastObservedDate: "2026-09-15",
      },
    );

    expect(summary.bandLabel).toBe("Watch");
    expect(summary.coverageLine).toBe("1 of 2 days recorded");
    expect(summary.days[0]).toMatchObject({ label: "Sep 14", observed: false, bandLabel: "Not observed", breakdown: "" });
    expect(summary.days[1]).toMatchObject({ label: "Sep 15", observed: true, bandLabel: "Watch", breakdown: "1 escalation · 2 watch starts" });
    expect(summary.openItems.find((item) => item.key === "escalations")?.count).toBe(1);
  });

  it("labels a never-observed facility as not observed even at score zero", () => {
    const summary = buildRoundingSummary(rollup(), null);
    expect(summary.bandLabel).toBe("Not observed");
    expect(summary.lastObservedLine).toBe("Nothing recorded yet");
    expect(summary.coverageLine).toBe("No days in range");
    expect(summary.days).toEqual([]);
  });
});

describe("buildRoundingComplianceDisplay", () => {
  it("reports completed, missed and configuration-gap windows without combining their denominators", () => {
    expect(
      buildRoundingComplianceDisplay(
        complianceSummary({ expected: 12, satisfied: 9, unconfigured: 2 }),
      ),
    ).toEqual({
      state: "recorded",
      from: "2026-09-09",
      to: "2026-09-15",
      completed: 9,
      missed: 3,
      expected: 12,
      configurationGaps: 2,
      rateLabel: "75%",
    });
  });

  it("names a successful empty read instead of presenting favorable zeroes", () => {
    expect(buildRoundingComplianceDisplay(complianceSummary())).toEqual({
      state: "successful-empty",
      from: "2026-09-09",
      to: "2026-09-15",
    });
  });

  it("names configuration-only rows as a gap rather than zero completed and zero missed", () => {
    expect(
      buildRoundingComplianceDisplay(complianceSummary({ unconfigured: 4 })),
    ).toEqual({
      state: "configuration-gap",
      from: "2026-09-09",
      to: "2026-09-15",
      configurationGaps: 4,
    });
  });
});

describe("roundingDayBreakdown", () => {
  it("lists only the non-zero parts", () => {
    expect(roundingDayBreakdown(point({ observed: true }))).toBe("");
    expect(roundingDayBreakdown(point({ observed: true, criticalResidents: 1, integrityFlags: 2 }))).toBe(
      "1 critical-score resident · 2 integrity flags",
    );
  });
});

describe("buildInsuranceCostDisplay", () => {
  it("distinguishes nothing on file from a recorded total", () => {
    const base = { periodStart: "2025-09-15", periodEnd: "2026-09-15", premiumsCents: 0, incurredLossesCents: 0, tcorCents: 0, policyRows: 0, claimRows: 0 };

    expect(buildInsuranceCostDisplay(base)).toEqual({
      state: "not_on_file",
      periodLine: "Sep 15, 2025 – Sep 15, 2026 · rolling 12 months",
    });

    const recorded = buildInsuranceCostDisplay({ ...base, premiumsCents: 100000, tcorCents: 100000, policyRows: 1 });
    expect(recorded.state).toBe("recorded");
    if (recorded.state === "recorded") {
      expect(recorded.total).toBe("$1,000.00");
      expect(recorded.breakdownLine).toBe("$1,000.00 premiums across 1 policy · $0.00 incurred losses (paid plus reserves) across 0 claims");
    }
  });
});

describe("date and freshness helpers", () => {
  it("formats ISO dates without shifting the day", () => {
    expect(shortDayLabel("2026-09-09")).toBe("Sep 9");
    expect(shortDayLabel("2026-01-31")).toBe("Jan 31");
    expect(longDateLabel("2025-09-15")).toBe("Sep 15, 2025");
    expect(shortDayLabel("not-a-date")).toBe("not-a-date");
  });

  it("stamps the read time in the facility timezone", () => {
    expect(updatedAtLine(null)).toBe("Not yet loaded");
    expect(updatedAtLine(new Date("2026-09-15T22:52:00Z"))).toBe("Updated Sep 15, 6:52 PM ET");
  });
});

describe("settledSection", () => {
  it("carries the error message or the fallback", () => {
    expect(settledSection({ status: "fulfilled", value: 1 }, "fallback")).toEqual({ status: "loaded", data: 1 });
    expect(settledSection({ status: "rejected", reason: new Error("boom") }, "fallback")).toEqual({ status: "failed", message: "boom" });
    expect(settledSection({ status: "rejected", reason: "string" }, "fallback")).toEqual({ status: "failed", message: "fallback" });
  });
});
