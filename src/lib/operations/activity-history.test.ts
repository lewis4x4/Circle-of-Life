import { describe, expect, it } from "vitest";

import { buildOperationTaskResponse } from "./server";

type TaskRow = Parameters<typeof buildOperationTaskResponse>[0]["rows"][number];
function row(id: string, template: string | null, activity: string | null): TaskRow {
  return {
    id, template_id: template, activity_id: activity,
    organization_id: "org", facility_id: "site", template_name: "Generator check",
    template_category: "safety", template_cadence_type: "weekly",
    assigned_shift_date: "2026-09-09", assigned_shift: null, assigned_to: null,
    assigned_role: null, status: "completed", due_at: null, missed_at: null,
    deferred_until: null, priority: "normal", license_threatening: false,
    estimated_minutes: null, current_escalation_level: 0,
    created_at: "2026-09-09T12:00:00Z", updated_at: "2026-09-09T12:00:00Z",
  };
}
function response(rows: TaskRow[]) {
  return buildOperationTaskResponse({ rows, dateFrom: "2026-09-09", dateTo: "2026-09-09",
    facilityNames: new Map([["site", "Homewood"]]), assigneeNames: new Map() });
}

describe("activity identity in existing task reads", () => {
  it("keeps both occurrences attributable to one activity across revisions", () => {
    const tasks = response([row("old", "v1", "activity"), row("new", "v2", "activity")]).tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.activity_id)).toEqual(["activity", "activity"]);
    expect(new Set(tasks.map((task) => task.template_id))).toEqual(new Set(["v1", "v2"]));
    expect(tasks.every((task) => task.status === "completed")).toBe(true);
  });
  it("keeps unlinked legacy work explicitly unknown rather than fabricating identity", () => {
    const legacy = row("legacy", null, null);
    delete legacy.activity_id;
    expect(response([legacy]).tasks[0].activity_id).toBeNull();
  });
});
