import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/metrics/metric-state";
import { summarizeOperationTasks } from "@/lib/operations/server";

import {
  assetSummaryStates,
  operationsQueueEmptyCopy,
  rangeEmptyCopy,
  taskCompletionState,
  taskSummaryTileStates,
  templateSummaryStates,
} from "./operations-metric-states";

const empty = summarizeOperationTasks([], "2026-09-01", "2026-09-30");

describe("task summary tiles (COL-649)", () => {
  it("does not show Completion 0% when no task was published", () => {
    const state = taskCompletionState(empty, {});
    expect(state.status).toBe("no_data");
    expect(formatMetric(state)).toBe("No tasks published");
  });

  it("shows unavailable, not zeros, when the read failed", () => {
    const tiles = taskSummaryTileStates(null, { error: "Failed to load operations tasks" });
    expect(tiles.total.status).toBe("unavailable");
    expect(tiles.schedule_unknown.status).toBe("unavailable");
    expect(taskCompletionState(null, { error: "x" }).status).toBe("unavailable");
  });

  it("keeps the total as a real 0 but has nothing to break down", () => {
    const tiles = taskSummaryTileStates(empty, {});
    expect(tiles.total).toEqual({ status: "value", value: 0 });
    expect(tiles.schedule_unknown.status).toBe("no_data");
    expect(tiles.overdue.status).toBe("no_data");
  });

  it("computes completion from real tasks", () => {
    const summary = { ...empty, total_tasks: 4, completed: 1 };
    expect(taskCompletionState(summary, {})).toEqual({ status: "value", value: 25 });
    expect(taskSummaryTileStates(summary, {}).completed).toEqual({ status: "value", value: 1 });
  });

  it("never says a category 'is clear' for an empty range", () => {
    expect(rangeEmptyCopy("Weekly Rounds").body).not.toMatch(/is clear/i);
  });
});

describe("overdue / missed empty states", () => {
  it("does not praise an empty queue over a scope with no tasks", () => {
    const copy = operationsQueueEmptyCopy({ queue: "overdue", scopeTaskCount: 0 });
    expect(copy.claimsClear).toBe(false);
    expect(copy.body).not.toMatch(/great work|on schedule/i);
  });

  it("does not claim clear when the scope read failed", () => {
    const copy = operationsQueueEmptyCopy({ queue: "missed", scopeTaskCount: null });
    expect(copy.claimsClear).toBe(false);
    expect(copy.body).toMatch(/could not be read/);
  });

  it("claims clear only over published tasks", () => {
    expect(operationsQueueEmptyCopy({ queue: "missed", scopeTaskCount: 1 }).claimsClear).toBe(true);
  });
});

describe("asset register tiles", () => {
  it("names the missing facility instead of red/amber zeros", () => {
    const s = assetSummaryStates({ facilitySelected: false, assets: [], dueSoonDays: 30 });
    expect(formatMetric(s.overdue)).toBe("Select a facility");
    expect(formatMetric(s.dueSoon)).toBe("Select a facility");
  });

  it("is unavailable after a failed read", () => {
    expect(assetSummaryStates({ facilitySelected: true, error: true, assets: [], dueSoonDays: 30 }).overdue.status).toBe(
      "unavailable",
    );
  });

  it("counts overdue and due-soon assets", () => {
    const now = new Date("2026-09-23T12:00:00Z");
    const s = assetSummaryStates({
      facilitySelected: true,
      now,
      dueSoonDays: 30,
      assets: [
        { next_service_due_at: "2026-09-01T00:00:00Z", linked_template_count: 0 },
        { next_service_due_at: "2026-10-05T00:00:00Z", linked_template_count: 2 },
        { next_service_due_at: null, linked_template_count: 0 },
      ],
    });
    expect(s.total).toEqual({ status: "value", value: 3 });
    expect(s.overdue).toEqual({ status: "value", value: 1 });
    expect(s.dueSoon).toEqual({ status: "value", value: 1 });
    expect(s.templated).toEqual({ status: "value", value: 1 });
  });
});

describe("template library tiles", () => {
  const templates = [
    { is_active: true, facility_id: null, license_threatening: true },
    { is_active: true, facility_id: "f", license_threatening: false },
  ];

  it("is unavailable when the template read failed", () => {
    expect(templateSummaryStates({ error: true, templates: [], statusFilter: "active" }).active.status).toBe(
      "unavailable",
    );
  });

  it("does not show Inactive history 0 while the filter hides inactive templates", () => {
    const s = templateSummaryStates({ templates, statusFilter: "active" });
    expect(s.inactive.status).toBe("no_data");
    expect(s.active).toEqual({ status: "value", value: 2 });
    expect(s.licenseThreatening).toEqual({ status: "value", value: 1 });
  });
});
