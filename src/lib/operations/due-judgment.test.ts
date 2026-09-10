import { describe, expect, it } from "vitest";

import { scoreMissPrediction } from "./miss-prediction";
import { buildOperationTaskResponse } from "./server";

type TaskRow = Parameters<typeof buildOperationTaskResponse>[0]["rows"][number];

function row(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: "task", template_id: "template", activity_id: "activity",
    organization_id: "org", facility_id: "site", template_name: "Generator check",
    template_category: "safety", template_cadence_type: "weekly",
    assigned_shift_date: "2026-09-01", assigned_shift: null, assigned_to: null,
    assigned_role: null, status: "pending", due_at: null, missed_at: null,
    deferred_until: null, priority: "normal", license_threatening: false,
    estimated_minutes: null, current_escalation_level: 0,
    created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-01T12:00:00Z",
    ...overrides,
  };
}

const now = new Date("2026-09-10T15:00:00Z");

function build(rows: TaskRow[]) {
  return buildOperationTaskResponse({
    rows,
    dateFrom: "2026-09-01",
    dateTo: "2026-09-10",
    facilityNames: new Map([["site", "Homewood"]]),
    assigneeNames: new Map(),
    facilityTimezones: new Map([["site", "America/New_York"]]),
    now,
  });
}

describe("task views judge due dates through the evaluator", () => {
  it("gives an open task with no due instant no overdue judgment, even with a past assigned date", () => {
    const response = build([row({ id: "unknown", assigned_shift_date: "2026-08-01", due_at: null })]);
    expect(response.tasks[0]).toMatchObject({ due_judgment: "unknown", days_overdue: null });
    expect(response.summary.overdue).toBe(0);
    expect(response.summary.schedule_unknown).toBe(1);
  });

  it("counts overdue only from the due instant in facility days", () => {
    const response = build([
      row({ id: "late", due_at: "2026-09-07T21:00:00Z" }),
      row({ id: "later-today", due_at: "2026-09-10T13:00:00Z" }),
      row({ id: "future", due_at: "2026-09-10T16:00:00Z" }),
      row({ id: "done", status: "completed", due_at: "2026-09-01T00:00:00Z" }),
      row({ id: "unknown", due_at: null }),
    ]);
    const byId = new Map(response.tasks.map((task) => [task.id, task]));
    expect(byId.get("late")).toMatchObject({ due_judgment: "overdue", days_overdue: 3 });
    expect(byId.get("later-today")).toMatchObject({ due_judgment: "overdue", days_overdue: 1 });
    expect(byId.get("future")).toMatchObject({ due_judgment: "not_due", days_overdue: 0 });
    expect(byId.get("done")).toMatchObject({ due_judgment: "settled", days_overdue: 0 });
    expect(byId.get("unknown")).toMatchObject({ due_judgment: "unknown", days_overdue: null });
    expect(response.summary).toMatchObject({ overdue: 2, schedule_unknown: 1, completed: 1 });
    expect(response.tasks.map((task) => task.id).slice(0, 2)).toEqual(["late", "later-today"]);
  });

  it("keeps history rows attributable without inventing a judgment for closed work", () => {
    const response = build([row({ id: "old", status: "completed", due_at: null }), row({ id: "missed", status: "missed", due_at: null })]);
    expect(response.tasks.every((task) => task.due_judgment === "settled" && task.days_overdue === 0)).toBe(true);
    expect(response.summary.schedule_unknown).toBe(0);
  });

  it("scores miss risk without treating an unknown schedule as overdue", () => {
    const base = { id: "t", template_name: "Generator check", status: "pending" as const, priority: "normal" as const, license_threatening: false, assigned_to_name: null, due_at: null, facility_name: "Homewood" };
    const unknown = scoreMissPrediction({ ...base, days_overdue: null }, null);
    const overdue = scoreMissPrediction({ ...base, days_overdue: 2 }, null);
    expect(unknown.rationale).toBe("stable execution conditions");
    expect(overdue.predictedRisk).toBeGreaterThan(unknown.predictedRisk);
  });
});
