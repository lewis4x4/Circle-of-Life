import { describe, expect, it } from "vitest";

import type {
  LiveBoardEscalationRow,
  LiveBoardRosterRow,
  LiveBoardTaskRow,
} from "./live-board-fetch";
import {
  deriveLiveBoardCounts,
  deriveLiveBoardState,
  filterLiveBoardTasks,
  groupEscalationsByTask,
  indexLiveBoardRoster,
  liveBoardResidentCount,
  scopeLiveBoardTasks,
} from "./live-board-state";

/**
 * No resident PHI in here. Residents are `Resident One`, `Resident Two` and so
 * on, and the facilities are ids. Spec acceptance item 14.
 */
function roster(facilitySuffix: string, count: number): LiveBoardRosterRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${facilitySuffix}-resident-${index + 1}`,
    first_name: "Resident",
    last_name: String(index + 1),
    preferred_name: null,
    status: "active",
    beds: { rooms: { room_number: `${index + 1}` } },
  }));
}

function task(overrides: Partial<LiveBoardTaskRow> & { id: string }): LiveBoardTaskRow {
  return {
    organization_id: "org",
    facility_id: "facility-a",
    resident_id: "a-resident-1",
    due_at: "2026-09-17T10:00:00Z",
    grace_ends_at: "2026-09-17T11:00:00Z",
    status: "due_now",
    window_key: "mid_morning",
    service_date: "2026-09-17",
    monitoring_order_id: null,
    assigned_staff_id: null,
    escalated_at: null,
    staff: null,
    ...overrides,
  };
}

describe("Live board facility scoping", () => {
  /**
   * Spec acceptance item 12: a reader with access to one building sees only
   * that building's residents, and the count matches its active roster.
   *
   * The regression this guards is a response from the previously selected
   * building landing after the operator has switched. Row level security and
   * the `facility_id` filter both already apply at the database; neither
   * protects against a stale in-flight response, and one row from the wrong
   * building on the board is the whole of defect 1 as an operator sees it.
   */
  it("shows only the selected building's residents, and counts its active roster", () => {
    const facilityARoster = roster("a", 33);
    const tasks = [
      ...facilityARoster.map((resident, index) =>
        task({ id: `a-task-${index}`, facility_id: "facility-a", resident_id: resident.id }),
      ),
      task({ id: "b-task-1", facility_id: "facility-b", resident_id: "b-resident-1" }),
      task({ id: "b-task-2", facility_id: "facility-b", resident_id: "b-resident-2" }),
    ];

    const scoped = scopeLiveBoardTasks(tasks, "facility-a");

    expect(scoped).toHaveLength(33);
    expect(scoped.every((row) => row.facility_id === "facility-a")).toBe(true);
    expect(liveBoardResidentCount(scoped)).toBe(facilityARoster.length);
    expect(liveBoardResidentCount(scoped)).toBe(33);
  });

  it("shows nothing at all when no building is selected", () => {
    expect(scopeLiveBoardTasks([task({ id: "a" })], null)).toEqual([]);
  });

  it("resolves a name and a room from the roster, and names the gap when it cannot", () => {
    const index = indexLiveBoardRoster([
      ...roster("a", 1),
      {
        id: "a-resident-9",
        first_name: null,
        last_name: null,
        preferred_name: null,
        status: "active",
        beds: null,
      },
    ]);
    expect(index.get("a-resident-1")?.name).toBe("Resident 1");
    expect(index.get("a-resident-1")?.roomNumber).toBe("1");
    expect(index.get("a-resident-9")?.name).toBe("No resident posted");
    expect(index.get("a-resident-9")?.roomNumber).toBeNull();
  });
});

describe("Live board counts and filters", () => {
  const tasks = [
    task({ id: "t1", status: "due_now" }),
    task({ id: "t2", status: "overdue" }),
    task({ id: "t3", status: "critically_overdue" }),
    task({ id: "t4", status: "missed" }),
    task({ id: "t5", status: "completed_on_time" }),
    task({ id: "t6", status: "completed_late" }),
    task({ id: "t7", status: "excused" }),
  ];
  const escalated = new Set(["t3", "t4"]);

  it("counts by band, and counts completed as on time plus late", () => {
    const counts = deriveLiveBoardCounts(tasks, escalated);
    expect(counts.total).toBe(7);
    expect(counts.critical).toBe(2);
    expect(counts.overdue).toBe(1);
    expect(counts.pending).toBe(1);
    expect(counts.onTime).toBe(2);
    expect(counts.late).toBe(1);
    expect(counts.completed).toBe(3);
    expect(counts.escalated).toBe(2);
  });

  it("filters the escalated band from the escalation rows, not from a task status", () => {
    expect(filterLiveBoardTasks(tasks, "escalated", escalated).map((row) => row.id)).toEqual([
      "t3",
      "t4",
    ]);
  });

  it("groups escalations by the task they belong to", () => {
    const rows: LiveBoardEscalationRow[] = [
      {
        id: "e1",
        task_id: "t3",
        resident_id: "a-resident-1",
        escalation_level: 1,
        escalation_type: "missed_observation",
        rung_key: "tier_1",
        status: "open",
        triggered_at: "2026-09-17T11:30:00Z",
        acknowledged_at: null,
      },
      {
        id: "e2",
        task_id: "t3",
        resident_id: "a-resident-1",
        escalation_level: 2,
        escalation_type: "missed_observation",
        rung_key: "tier_2",
        status: "open",
        triggered_at: "2026-09-17T12:00:00Z",
        acknowledged_at: null,
      },
    ];
    const grouped = groupEscalationsByTask(rows);
    expect(grouped.get("t3")).toHaveLength(2);
    expect(grouped.has("t4")).toBe(false);
  });

  it("names the no-facility state before the loading state", () => {
    expect(
      deriveLiveBoardState({
        loadState: "loading",
        hasFacility: false,
        totalTasks: 0,
        filteredTasks: 0,
        filterApplied: false,
      }),
    ).toBe("no_facility");
  });

  it("separates an empty board from a filter that matched nothing", () => {
    const base = { loadState: "ready" as const, hasFacility: true };
    expect(
      deriveLiveBoardState({ ...base, totalTasks: 0, filteredTasks: 0, filterApplied: false }),
    ).toBe("empty");
    expect(
      deriveLiveBoardState({ ...base, totalTasks: 5, filteredTasks: 0, filterApplied: true }),
    ).toBe("empty_filtered");
  });
});
