import { describe, expect, it } from "vitest";

import type { ExecKpiPayload } from "@/lib/exec-kpi-snapshot";

import { computeLeagueRows, formatLeagueScore, summarizeLeague, type EntityInsuranceReadiness } from "./league";

function kpi(occupancyPct: number | null, occupiedResidents: number): ExecKpiPayload {
  return {
    version: 1,
    census: { occupiedResidents, licensedBeds: 36, occupancyPct },
    financial: { openInvoicesCount: 3, totalBalanceDueCents: 300_000 },
    clinical: { openIncidents: 0, medicationErrorsMtd: 0 },
    compliance: { openSurveyDeficiencies: 0 },
    workforce: { certificationsExpiring30d: 0 },
    infection: { activeOutbreaks: 0 },
    residentAssurance: { overdueTasksCount: 0, missedRate: null, openExceptions: 0, activeWatchCount: 0 },
  };
}

const insurance: EntityInsuranceReadiness = {
  entityId: "e1",
  entityName: "Entity",
  readinessScore: 50,
  readinessLabel: "at_risk",
  activePolicies: 3,
  expiringPolicies60d: 0,
  expiredPolicies: 1,
  pendingRenewals: 0,
  boundRenewals: 0,
  latestPacketAt: null,
  latestPacketReviewedAt: null,
  primaryConcern: "1 policy record(s) are expired or past the effective window.",
};

const board = {
  weekOf: null,
  status: null,
  confidenceBand: null,
  completenessPct: null,
  publishedVersion: null,
  publishedAt: null,
  savedPacketCount: 0,
  lastSavedAt: null,
};

describe("executive league (COL-649)", () => {
  const rows = computeLeagueRows({
    facilities: [
      { facilityId: "hw", facilityName: "Homewood", entityId: "e1", entityName: "Entity" },
      { facilityId: "gc", facilityName: "Grande Cypress", entityId: "e1", entityName: "Entity" },
    ],
    kpis: new Map([
      ["hw", kpi(94.4, 34)],
      ["gc", kpi(null, 0)],
    ]),
    riskSnapshots: new Map([["hw", { facilityId: "hw", score: 80, level: "low" as const, scoreDelta: null }]]),
    insuranceReadinessByEntity: new Map([["e1", insurance]]),
    boardSummary: board,
  });

  it("does not score a facility with no risk score and no census (was 59/100)", () => {
    const gc = rows.find((row) => row.facilityId === "gc")!;
    expect(gc.leagueScore).toBeNull();
    expect(gc.leagueLabel).toBe("not_scored");
    expect(gc.operationalScore).toBeNull();
    expect(gc.financialScore).toBeNull();
    expect(gc.primaryConcern).toContain("Not scored: no nightly risk score, no census loaded");
    expect(formatLeagueScore(gc.leagueScore)).toBe("Not scored");
  });

  it("scores a facility with every input, and ranks unscored facilities last", () => {
    expect(rows[0]!.facilityId).toBe("hw");
    expect(rows[0]!.leagueScore).not.toBeNull();
  });

  it("averages scored facilities only and says how many were scored", () => {
    const summary = summarizeLeague(rows);
    expect(summary.averageLeagueScore).toBe(rows[0]!.leagueScore);
    expect(summary.scoredCount).toBe(1);
    expect(summary.totalCount).toBe(2);
    expect(summary.leadingFacility?.facilityName).toBe("Homewood");
  });
});
