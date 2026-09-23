import { describe, expect, it } from "vitest";

import type { ResidentRow } from "./load-residents";
import type { ResidentRosterMetrics } from "./resident-roster-metrics";
import {
  acuityCoverage,
  carePlanFigure,
  effectiveRosterGroupBy,
  highAcuityFigure,
  HIGH_ACUITY_NOT_ESTABLISHED,
  presenceBreakdown,
  presenceLine,
  rosterShowingCopy,
  unoccupiedBedsFigure,
} from "./resident-roster-summary";

function row(partial: Partial<ResidentRow> & { id: string }): ResidentRow {
  return {
    name: "Resident",
    initials: "R",
    room: "1-A",
    unit: "",
    acuity: 1,
    acuityLevel: null,
    adlStatus: "independent",
    status: "active",
    careSummary: "",
    updatedAtIso: null,
    ...partial,
  };
}

describe("high acuity paired with assessment coverage", () => {
  it("is not established when no resident has a posted acuity", () => {
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    expect(acuityCoverage(rows)).toEqual({ total: 3, assessed: 0, highAcuity: 0 });
    expect(highAcuityFigure(acuityCoverage(rows))).toEqual({
      headline: HIGH_ACUITY_NOT_ESTABLISHED,
      detail: "Acuity posted for 0 of 3 residents",
      tone: "neutral",
    });
  });

  it("states the documented count against partial coverage", () => {
    const rows = [
      row({ id: "a", acuityLevel: "level_3", acuity: 3 }),
      row({ id: "b", acuityLevel: "level_1", acuity: 1 }),
      row({ id: "c" }),
      row({ id: "d" }),
    ];
    expect(highAcuityFigure(acuityCoverage(rows))).toEqual({
      headline: "1 of 2 assessed",
      detail: "Acuity posted for 2 of 4 · 2 not posted",
      tone: "warning",
    });
  });

  it("names full coverage when every resident has a posted acuity", () => {
    const rows = [
      row({ id: "a", acuityLevel: "level_2", acuity: 2 }),
      row({ id: "b", acuityLevel: "level_1", acuity: 1 }),
    ];
    expect(highAcuityFigure(acuityCoverage(rows))).toEqual({
      headline: "0 of 2 assessed",
      detail: "Acuity posted for all 2 residents",
      tone: "neutral",
    });
  });

  it("ignores blank acuity strings as unposted", () => {
    expect(acuityCoverage([row({ id: "a", acuityLevel: "   ", acuity: 3 })])).toEqual({
      total: 1,
      assessed: 0,
      highAcuity: 0,
    });
  });

  it("handles an empty scope without inventing a denominator", () => {
    expect(highAcuityFigure(acuityCoverage([])).detail).toBe("No residents in scope");
  });
});

describe("facility-wide presence line", () => {
  it("counts every scoped resident by presence", () => {
    const rows = [
      row({ id: "a", status: "active" }),
      row({ id: "b", status: "hospital" }),
      row({ id: "c", status: "loa" }),
      row({ id: "d", status: "active" }),
    ];
    expect(presenceBreakdown(rows)).toEqual({ total: 4, inHouse: 2, hospital: 1, onLeave: 1 });
    expect(presenceLine(presenceBreakdown(rows))).toBe("4 residents · 2 in-house · 1 hospital · 1 on leave");
  });

  it("uses the singular for one resident", () => {
    expect(presenceLine(presenceBreakdown([row({ id: "a" })]))).toBe("1 resident · 1 in-house · 0 hospital · 0 on leave");
  });
});

describe("row count beside the table", () => {
  it("separates the filtered population from the facility total", () => {
    expect(rosterShowingCopy(25, 25)).toBe("Showing all 25 residents");
    expect(rosterShowingCopy(3, 25)).toBe("Showing 3 of 25 residents");
    expect(rosterShowingCopy(0, 25)).toBe("Showing 0 of 25 residents");
    expect(rosterShowingCopy(0, 0)).toBe("Showing 0 residents");
  });
});

describe("unoccupied licensed beds", () => {
  const metrics = (partial: Partial<ResidentRosterMetrics>): ResidentRosterMetrics => ({
    licensedBeds: null,
    occupiedResidents: 0,
    openBeds: null,
    carePlanReviewsDueWeek: null,
    carePlanCoverage: null,
    ...partial,
  });

  it("labels the arithmetic and says what it does not subtract", () => {
    expect(unoccupiedBedsFigure(metrics({ licensedBeds: 36, occupiedResidents: 25, openBeds: 11 }))).toEqual({
      headline: "11",
      detail: "25 in census · 36 licensed · holds and blocked beds not subtracted",
      tone: "neutral",
    });
  });

  it("returns nothing when licensed beds are not on file", () => {
    expect(unoccupiedBedsFigure(metrics({ licensedBeds: null, openBeds: null }))).toBeNull();
    expect(unoccupiedBedsFigure(null)).toBeNull();
  });
});

describe("care plan reviews with the plan gap beside them", () => {
  it("shows a genuine zero due together with residents lacking a plan", () => {
    expect(
      carePlanFigure({ reviewsDueWeek: 0, reviewsOverdue: 0, residentsWithoutActivePlan: 25, plansWithoutReviewDate: 0 }),
    ).toEqual({ headline: "0", detail: "25 without an active plan", tone: "warning" });
  });

  it("is neutral only when every resident has a plan and nothing is due or overdue", () => {
    expect(
      carePlanFigure({ reviewsDueWeek: 0, reviewsOverdue: 0, residentsWithoutActivePlan: 0, plansWithoutReviewDate: 0 }),
    ).toEqual({ headline: "0", detail: "0 without an active plan", tone: "neutral" });
  });

  it("names overdue reviews and plans missing a review date", () => {
    expect(
      carePlanFigure({ reviewsDueWeek: 2, reviewsOverdue: 3, residentsWithoutActivePlan: 1, plansWithoutReviewDate: 1 }),
    ).toEqual({
      headline: "2",
      detail: "3 overdue · 1 without an active plan · 1 plan without a review date",
      tone: "warning",
    });
  });

  it("returns nothing when coverage did not load", () => {
    expect(carePlanFigure(null)).toBeNull();
  });
});

describe("grouping by a field nobody carries", () => {
  it("falls back to the flat list with a notice when no resident has a unit", () => {
    const rows = [row({ id: "a" }), row({ id: "b" })];
    expect(effectiveRosterGroupBy("unit", rows)).toEqual({
      groupBy: "none",
      notice: "No unit assignments on file for these residents — showing the room-sorted list.",
    });
  });

  it("keeps unit grouping when at least one resident has a unit", () => {
    const rows = [row({ id: "a", unit: "North" }), row({ id: "b" })];
    expect(effectiveRosterGroupBy("unit", rows)).toEqual({ groupBy: "unit", notice: null });
  });

  it("leaves other groupings alone", () => {
    expect(effectiveRosterGroupBy("acuity", [row({ id: "a" })])).toEqual({ groupBy: "acuity", notice: null });
    expect(effectiveRosterGroupBy("none", [])).toEqual({ groupBy: "none", notice: null });
  });
});
