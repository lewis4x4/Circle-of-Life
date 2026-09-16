import { describe, expect, it } from "vitest";

import { classifyCarePlanCoverage } from "./resident-roster-metrics";

const TODAY = "2026-09-15";
const HORIZON = "2026-09-22";

describe("classifyCarePlanCoverage", () => {
  it("counts every roster resident as lacking a plan when there are no plans", () => {
    expect(classifyCarePlanCoverage([], ["a", "b", "c"], TODAY, HORIZON)).toEqual({
      reviewsDueWeek: 0,
      reviewsOverdue: 0,
      residentsWithoutActivePlan: 3,
      plansWithoutReviewDate: 0,
    });
  });

  it("separates due this week, overdue, and beyond the horizon", () => {
    const plans = [
      { resident_id: "a", review_due_date: "2026-09-15" },
      { resident_id: "b", review_due_date: "2026-09-22" },
      { resident_id: "c", review_due_date: "2026-09-14" },
      { resident_id: "d", review_due_date: "2026-09-23" },
    ];
    expect(classifyCarePlanCoverage(plans, ["a", "b", "c", "d", "e"], TODAY, HORIZON)).toEqual({
      reviewsDueWeek: 2,
      reviewsOverdue: 1,
      residentsWithoutActivePlan: 1,
      plansWithoutReviewDate: 0,
    });
  });

  it("counts plans without a review date instead of dropping them", () => {
    const plans = [
      { resident_id: "a", review_due_date: null },
      { resident_id: "b", review_due_date: "  " },
    ];
    expect(classifyCarePlanCoverage(plans, ["a", "b"], TODAY, HORIZON)).toEqual({
      reviewsDueWeek: 0,
      reviewsOverdue: 0,
      residentsWithoutActivePlan: 0,
      plansWithoutReviewDate: 2,
    });
  });

  it("counts a resident once even with several plans in review", () => {
    const plans = [
      { resident_id: "a", review_due_date: "2026-09-16" },
      { resident_id: "a", review_due_date: "2026-09-17" },
    ];
    expect(classifyCarePlanCoverage(plans, ["a"], TODAY, HORIZON).reviewsDueWeek).toBe(1);
  });

  it("does not count plans for residents who are no longer on the roster as a gap", () => {
    const plans = [{ resident_id: "discharged", review_due_date: "2026-09-16" }];
    const result = classifyCarePlanCoverage(plans, ["a"], TODAY, HORIZON);
    expect(result.residentsWithoutActivePlan).toBe(1);
    expect(result.reviewsDueWeek).toBe(1);
  });
});
