import { describe, expect, it } from "vitest";

import {
  buildExecutiveCoverage,
  coverageFollowUps,
  coverageGapLine,
  coverageHeadline,
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
  metricDates: {},
  todayIsoDate: "2026-09-15",
  observedFacilityCount: 0,
  surveyFacilityCount: 0,
};

const RECORDED_TODAY = {
  kind: "recorded" as const,
  evidence: {
    snapshotDate: "2026-09-15",
    computedAt: null,
    occupiedResidents: 25,
    licensedBeds: 60,
    incidentRatePer1kResidentDays: 0,
    billedRevenueMtdCents: 0,
    laborCostMtdCents: null,
  },
  ageDays: 0,
  stale: false,
};

function row(input: CoverageInput, key: string) {
  const found = buildExecutiveCoverage(input).find((candidate) => candidate.key === key);
  if (!found) throw new Error(`missing coverage row ${key}`);
  return found;
}

describe("executive evidence coverage", () => {
  it("reports partial census with the facilities it covers", () => {
    expect(row(BASE, "census")).toMatchObject({
      key: "census",
      label: "Census",
      state: "partial",
      short: "2 of 5",
      detail: "2 of 5 facilities posted. Occupancy covers those 2 only.",
    });
    expect(row(BASE, "census").followUp?.summary).toBe("Census missing at 3 facilities");
  });

  it("separates a measure never reported from one reported as zero", () => {
    expect(row(BASE, "payroll").state).toBe("not_reported");
    expect(
      row(
        {
          ...BASE,
          metrics: { labor_pct: 0 },
          snapshot: {
            ...RECORDED_TODAY,
            evidence: { ...RECORDED_TODAY.evidence, laborCostMtdCents: 0 },
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
        ...RECORDED_TODAY,
        evidence: { ...RECORDED_TODAY.evidence, occupiedResidents: 0 },
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
    expect(row(withDenominator, "incidents").state).toBe("estimated");
  });

  it("does not present a projected resident-day denominator as an established rate", () => {
    const estimated = row(
      { ...BASE, metrics: { inc_rate: 0.4 }, snapshot: RECORDED_TODAY },
      "incidents",
    );

    expect(estimated.state).toBe("estimated");
    expect(estimated.short).toBe("Estimated");
    expect(estimated.detail).toContain("projected from one day's census");
    // The arithmetic itself lives beside the figure, not restated here.
    expect(estimated.detail).not.toContain("resident-days is");
  });

  it("reports the incident rate as counted only when no day of the window is projected", () => {
    const withCount = { ...BASE, metrics: { inc_rate: 0.4 }, snapshot: RECORDED_TODAY };

    const partlyCounted = row(
      {
        ...withCount,
        residentDays: {
          windowDays: 30,
          measuredDays: 29,
          residentDays: 928,
          startDate: "2026-08-17",
          endDate: "2026-09-15",
        },
      },
      "incidents",
    );
    // Twenty-nine days of counted census is still an estimate, and says which
    // part of the denominator was counted and which was assumed.
    expect(partlyCounted.state).toBe("estimated");
    expect(partlyCounted.short).toBe("Estimated");
    expect(partlyCounted.detail).toContain("recorded census on 29 of those days");
    expect(partlyCounted.detail).toContain("projected from one day's census for the other 1");

    const fullyCounted = row(
      {
        ...withCount,
        residentDays: {
          windowDays: 30,
          measuredDays: 30,
          residentDays: 960,
          startDate: "2026-08-17",
          endDate: "2026-09-15",
        },
      },
      "incidents",
    );
    expect(fullyCounted.state).toBe("reported");
    expect(fullyCounted.short).toBe("Counted");
    expect(fullyCounted.detail).toContain("added up from the census recorded on each of those days");
    expect(fullyCounted.detail).not.toContain("estimate");
  });

  it("ages each measure against its own recording, not the run's", () => {
    // The run executed today and wrote billed revenue. Survey readiness was
    // last computed three days ago, so its value is the newest on file — and
    // reading it off the run's date would report it as current.
    const mixed: CoverageInput = {
      ...BASE,
      metrics: { rev_mtd: 125_000, survey_rd: 0.92 },
      snapshot: RECORDED_TODAY,
      surveyFacilityCount: 5,
      metricDates: { rev_mtd: "2026-09-15", survey_rd: "2026-09-12" },
      todayIsoDate: "2026-09-15",
    };

    expect(row(mixed, "billing").state).toBe("reported");
    expect(row(mixed, "survey")).toMatchObject({
      state: "past",
      short: "Earlier day",
      detail: "Recorded 2026-09-12, 3 days ago.",
    });
    // A measure describing an earlier day is still outstanding work, so it
    // keeps a row in the follow-up list rather than dropping out of sight.
    expect(row(mixed, "survey").followUp).toMatchObject({
      summary: "Survey readiness last recorded 2026-09-12",
      href: "/admin/risk",
    });
  });

  it("still ages an undated value off the run, so a stale run is never read as current", () => {
    const staleRun: CoverageInput = {
      ...BASE,
      metrics: { survey_rd: 0.9 },
      snapshot: {
        ...RECORDED_TODAY,
        evidence: { ...RECORDED_TODAY.evidence, snapshotDate: "2026-09-12" },
        ageDays: 3,
        stale: true,
      },
      metricDates: {},
    };

    expect(row(staleRun, "survey")).toMatchObject({
      state: "past",
      detail: "Recorded 2026-09-12, 3 days ago.",
    });
  });

  it("reports unknown coverage when the run could not be read", () => {
    expect(row({ ...BASE, snapshot: { kind: "unreadable", message: "boom" } }, "incidents").state).toBe(
      "unreadable",
    );
  });

  it("does not read a returned figure as a dated one", () => {
    // A figure with no run record behind it has no age and no basis; calling
    // that "reported" would treat a successful read as complete reporting.
    const undated = row({ ...BASE, metrics: { rev_mtd: 125_000 } }, "billing");
    expect(undated.state).toBe("unreadable");
    expect(undated.detail).toContain("the run that produced it is not");
  });

  it("counts rounding coverage by facilities with any recorded observation", () => {
    expect(row(BASE, "rounding").state).toBe("not_reported");
    expect(row({ ...BASE, observedFacilityCount: 3 }, "rounding").detail).toBe(
      "Observations recorded at 3 of 5 facilities.",
    );
    expect(row({ ...BASE, observedFacilityCount: 5 }, "rounding").state).toBe("reported");
  });

  it("names the period and the exclusions behind a portfolio-wide zero", () => {
    const zero = row({ ...BASE, metrics: { rev_mtd: 0 }, snapshot: RECORDED_TODAY }, "billing");

    expect(zero.state).toBe("reported");
    expect(zero.short).toBe("Nothing issued");
    expect(zero.detail).toContain("Every facility in scope was read for 2026-09-01 through 2026-09-15.");
    expect(zero.detail).toContain("true zero");

    const billed = row(
      { ...BASE, metrics: { rev_mtd: 125_000 }, snapshot: RECORDED_TODAY },
      "billing",
    );
    expect(billed.short).toBe("Recorded");
    expect(billed.detail).not.toContain("true zero");
  });

  it("does not blame payroll for a labor percentage that has no revenue to divide by", () => {
    // Payroll cost was recorded; the percentage is absent because nothing was
    // billed. Saying "no payroll hours" here would name the wrong cause.
    const noRevenue = row(
      {
        ...BASE,
        metrics: { rev_mtd: 0 },
        snapshot: {
          ...RECORDED_TODAY,
          evidence: { ...RECORDED_TODAY.evidence, laborCostMtdCents: 480_000 },
        },
      },
      "payroll",
    );
    expect(noRevenue.detail).toContain("nothing was billed this period");
    expect(noRevenue.followUp?.href).toBe("/admin/billing");

    const noHours = row({ ...BASE, snapshot: RECORDED_TODAY }, "payroll");
    expect(noHours.detail).toBe("No payroll hours have been loaded for this period.");
    expect(noHours.followUp?.href).toBe("/admin/payroll");

    // With no run on file the cause is unknown, so no cause is named.
    expect(row(BASE, "payroll").detail).toBe(
      "No labor cost percentage has been recorded for this period.",
    );
  });

  it("scopes survey readiness to the facilities holding a review", () => {
    const partial = row(
      {
        ...BASE,
        metrics: { survey_rd: 0.92 },
        snapshot: RECORDED_TODAY,
        surveyFacilityCount: 3,
      },
      "survey",
    );
    expect(partial.state).toBe("partial");
    expect(partial.detail).toContain("Readiness review on file at 3 of 5 facilities");
    expect(partial.followUp?.summary).toBe("Survey readiness missing at 2 facilities");

    const complete = row(
      {
        ...BASE,
        metrics: { survey_rd: 0.92 },
        snapshot: RECORDED_TODAY,
        surveyFacilityCount: 5,
      },
      "survey",
    );
    expect(complete.state).toBe("reported");
  });

  it("summarises coverage without claiming an all-clear", () => {
    const rows = buildExecutiveCoverage(BASE);
    expect(coverageHeadline(rows)).toBe("Coverage incomplete");
    expect(coverageSummaryLine(rows)).toBe("None of the 6 measures is fully reported.");
    expect(coverageGapLine(rows)).toContain("Missing information is not the same as an all-clear.");

    const empty = noAlertsCopy(rows);
    expect(empty.headline).toBe("No critical alerts recorded in the available data.");
    expect(empty.body).toContain("6 of 6 measures are not fully reported");
  });

  it("gives every gap a destination that the page can actually open", () => {
    const followUps = coverageFollowUps(buildExecutiveCoverage(BASE));

    expect(followUps.length).toBeGreaterThan(0);
    for (const row of followUps) {
      expect(row.followUp.href).toMatch(/^\/admin\//);
      expect(row.followUp.summary.length).toBeGreaterThan(0);
    }
    // An estimated figure is qualified where it is shown, not chased as missing.
    const estimated = buildExecutiveCoverage({
      ...BASE,
      metrics: { inc_rate: 0.4 },
      snapshot: RECORDED_TODAY,
    }).find((candidate) => candidate.key === "incidents");
    expect(estimated?.state).toBe("estimated");
    expect(estimated?.followUp).toBeUndefined();
  });
});
