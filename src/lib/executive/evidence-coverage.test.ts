import { describe, expect, it } from "vitest";

import {
  buildExecutiveCoverage,
  coverageGapLine,
  coverageSummaryLine,
  noAlertsCopy,
  type CoverageInput,
} from "./evidence-coverage";

const BASE: CoverageInput = {
  facilityCount: 5,
  occupancy: {
    occupiedResidents: 22,
    licensedBeds: 66,
    occupancyPct: 33,
    allFacilitiesPosted: false,
    postedFacilityCount: 2,
    totalFacilityCount: 5,
  },
  metrics: {},
  snapshot: { kind: "never_recorded" },
  observedFacilityCount: 0,
};

function row(input: CoverageInput, key: string) {
  const found = buildExecutiveCoverage(input).find((candidate) => candidate.key === key);
  if (!found) throw new Error(`missing coverage row ${key}`);
  return found;
}

describe("executive evidence coverage", () => {
  it("reports partial census with the facilities it covers", () => {
    expect(row(BASE, "census")).toEqual({
      key: "census",
      label: "Census",
      state: "partial",
      detail: "2 of 5 facilities posted. Occupancy covers those 2 only.",
    });
  });

  it("separates a measure never reported from one reported as zero", () => {
    expect(row(BASE, "payroll").state).toBe("not_reported");
    expect(
      row(
        {
          ...BASE,
          metrics: { labor_pct: 0 },
          snapshot: {
            kind: "recorded",
            evidence: {
              snapshotDate: "2026-09-15",
              computedAt: null,
              occupiedResidents: 25,
              licensedBeds: 60,
              incidentRatePer1kResidentDays: 0,
              billedRevenueMtdCents: 0,
              laborCostMtdCents: 0,
            },
            ageDays: 0,
            stale: false,
          },
        },
        "payroll",
      ).state,
    ).toBe("reported");
  });

  it("marks figures from an earlier run as past rather than current", () => {
    const state = row(
      {
        ...BASE,
        metrics: { survey_rd: 0.9 },
        snapshot: {
          kind: "recorded",
          evidence: {
            snapshotDate: "2026-09-12",
            computedAt: null,
            occupiedResidents: 25,
            licensedBeds: 60,
            incidentRatePer1kResidentDays: null,
            billedRevenueMtdCents: null,
            laborCostMtdCents: null,
          },
          ageDays: 3,
          stale: true,
        },
      },
      "survey",
    );
    expect(state.state).toBe("past");
    expect(state.detail).toBe("Recorded 2026-09-12, 3 days ago.");
  });

  it("does not call an incident rate reported without a denominator", () => {
    const withCount = {
      ...BASE,
      metrics: { inc_rate: 0 },
      snapshot: {
        kind: "recorded" as const,
        evidence: {
          snapshotDate: "2026-09-15",
          computedAt: null,
          occupiedResidents: 0,
          licensedBeds: 60,
          incidentRatePer1kResidentDays: 0,
          billedRevenueMtdCents: null,
          laborCostMtdCents: null,
        },
        ageDays: 0,
        stale: false,
      },
    };
    expect(row(withCount, "incidents")).toMatchObject({
      state: "not_reported",
      detail: "An incident count exists but no resident-day denominator was recorded, so there is no rate.",
    });

    const withDenominator = {
      ...withCount,
      snapshot: {
        ...withCount.snapshot,
        evidence: { ...withCount.snapshot.evidence, occupiedResidents: 25 },
      },
    };
    expect(row(withDenominator, "incidents").state).toBe("reported");
  });

  it("reports unknown coverage when the run could not be read", () => {
    expect(row({ ...BASE, snapshot: { kind: "unreadable", message: "boom" } }, "incidents").state).toBe(
      "unreadable",
    );
  });

  it("counts rounding coverage by facilities with any recorded observation", () => {
    expect(row(BASE, "rounding").state).toBe("not_reported");
    expect(row({ ...BASE, observedFacilityCount: 3 }, "rounding").detail).toBe(
      "Observations recorded at 3 of 5 facilities.",
    );
    expect(row({ ...BASE, observedFacilityCount: 5 }, "rounding").state).toBe("reported");
  });

  it("summarises coverage without claiming an all-clear", () => {
    const rows = buildExecutiveCoverage(BASE);
    expect(coverageSummaryLine(rows)).toBe(
      "None of the 5 measures is fully reported — each line below says what is missing.",
    );
    expect(coverageGapLine(rows)).toContain("Missing information is not the same as an all-clear.");

    const empty = noAlertsCopy(rows);
    expect(empty.headline).toBe("No critical alerts recorded in the available data.");
    expect(empty.body).toContain("5 measures are not fully reported");
  });
});
