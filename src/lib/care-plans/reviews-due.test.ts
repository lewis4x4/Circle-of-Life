import { describe, expect, it } from "vitest";

import { mergeCarePlanReviewRows, type SupabasePlan, type SupabaseReviewAlert } from "./reviews-due";

function plan(overrides: Partial<SupabasePlan>): SupabasePlan {
  return {
    id: "plan",
    resident_id: "res",
    facility_id: "fac",
    version: 1,
    status: "active",
    effective_date: "2026-01-10",
    review_due_date: "2027-01-10",
    ...overrides,
  };
}

function alert(overrides: Partial<SupabaseReviewAlert>): SupabaseReviewAlert {
  return {
    id: "alert",
    care_plan_id: "plan",
    trigger_type: "fall_incident",
    trigger_detail: "Fall (fall without injury) on Sep 03, 2026",
    status: "open",
    created_at: "2026-09-03T15:00:00.000Z",
    ...overrides,
  };
}

const residents = [
  { id: "res-a", first_name: "Ada", last_name: "Example" },
  { id: "res-b", first_name: "Ben", last_name: "Example" },
];

describe("mergeCarePlanReviewRows", () => {
  it("lists a plan with a future review date when it carries an open alert, and says why", () => {
    const rows = mergeCarePlanReviewRows({
      duePlans: [],
      alertPlans: [plan({ id: "p1", resident_id: "res-a" })],
      alerts: [alert({ id: "a1", care_plan_id: "p1" })],
      residents,
      today: "2026-09-15",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].daysOverdue).toBe(0);
    expect(rows[0].reasons).toEqual([
      {
        kind: "alert",
        label: "Fall: Fall (fall without injury) on Sep 03, 2026",
        alertId: "a1",
        alertStatus: "open",
        triggerType: "fall_incident",
      },
    ]);
  });

  it("puts the date reason first and alerts newest-first on one row", () => {
    const rows = mergeCarePlanReviewRows({
      duePlans: [plan({ id: "p1", resident_id: "res-a", review_due_date: "2026-09-03" })],
      alertPlans: [],
      alerts: [
        alert({ id: "old", care_plan_id: "p1", trigger_type: "hospital_return", trigger_detail: "Returned from hospital Sep 01, 2026", created_at: "2026-09-01T12:00:00.000Z", status: "acknowledged" }),
        alert({ id: "new", care_plan_id: "p1", created_at: "2026-09-10T12:00:00.000Z" }),
      ],
      residents,
      today: "2026-09-15",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].daysOverdue).toBe(12);
    expect(rows[0].reasons.map((r) => r.label)).toEqual([
      "Review 12 days overdue",
      "Fall: Fall (fall without injury) on Sep 03, 2026",
      "Returned from hospital: Returned from hospital Sep 01, 2026",
    ]);
    expect(rows[0].reasons[2].alertStatus).toBe("acknowledged");
  });

  it("orders date-due rows by overdue days, then alert-only rows by newest alert", () => {
    const rows = mergeCarePlanReviewRows({
      duePlans: [
        plan({ id: "due-1", resident_id: "res-a", review_due_date: "2026-09-14" }),
        plan({ id: "due-10", resident_id: "res-b", review_due_date: "2026-09-05" }),
      ],
      alertPlans: [
        plan({ id: "alert-old", resident_id: "res-a" }),
        plan({ id: "alert-new", resident_id: "res-b" }),
      ],
      alerts: [
        alert({ id: "x", care_plan_id: "alert-old", created_at: "2026-09-01T00:00:00.000Z" }),
        alert({ id: "y", care_plan_id: "alert-new", created_at: "2026-09-12T00:00:00.000Z" }),
      ],
      residents,
      today: "2026-09-15",
    });
    expect(rows.map((r) => r.id)).toEqual(["due-10", "due-1", "alert-new", "alert-old"]);
  });

  it("ignores alerts whose plan is not active and names a missing resident", () => {
    const rows = mergeCarePlanReviewRows({
      duePlans: [plan({ id: "p1", resident_id: "ghost", review_due_date: "2026-09-15" })],
      alertPlans: [],
      alerts: [alert({ id: "stray", care_plan_id: "archived-plan" })],
      residents,
      today: "2026-09-15",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].residentName).toBe("No resident posted");
    expect(rows[0].reasons).toEqual([{ kind: "review_due", label: "Review due today" }]);
  });
});
