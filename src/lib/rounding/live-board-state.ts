/**
 * Live board derivation, kept out of the component so it can be asserted.
 *
 * Acceptance item 12 is the reason this file exists as a separate module: "a
 * signed-in user with access to one facility sees only that facility's
 * residents on every tab, and the resident count matches the facility's active
 * roster." That is a statement about a pure function over rows, and it is
 * testable as one.
 */

import type {
  LiveBoardEscalationRow,
  LiveBoardRosterRow,
  LiveBoardTaskRow,
} from "@/lib/rounding/live-board-fetch";
import { liveBoardStatusCopy, type LiveBoardFilter } from "@/lib/rounding/live-board-display-copy";
import { metricLoading, metricUnavailable, metricValue, type MetricState } from "@/lib/metrics/metric-state";

export type LiveBoardLoadState = "idle" | "loading" | "ready" | "error";

export type LiveBoardState =
  | "no_facility"
  | "loading"
  | "error"
  | "empty"
  | "empty_filtered"
  | "populated";

export type LiveBoardResident = {
  id: string;
  name: string;
  roomNumber: string | null;
};

export const LIVE_BOARD_NO_RESIDENT_COPY = "No resident posted";

/**
 * The roster, indexed. Names and rooms come from here rather than from an
 * embed on the task read, so a task whose resident the reader cannot see reads
 * as a named gap instead of failing the whole query.
 */
export function indexLiveBoardRoster(
  roster: readonly LiveBoardRosterRow[],
): Map<string, LiveBoardResident> {
  const index = new Map<string, LiveBoardResident>();
  for (const row of roster) {
    const first = (row.preferred_name ?? row.first_name)?.trim() ?? "";
    const last = row.last_name?.trim() ?? "";
    const name = `${first} ${last}`.trim();
    index.set(row.id, {
      id: row.id,
      name: name || LIVE_BOARD_NO_RESIDENT_COPY,
      roomNumber: row.beds?.rooms?.room_number ?? null,
    });
  }
  return index;
}

/**
 * Tasks for the selected building only.
 *
 * Every read in the module already filters `facility_id`, and row level
 * security filters it a second time, so this is a third gate rather than the
 * only one. It is here because a stale response from a previous building can
 * land after the operator has switched, and a board that renders one row from
 * the wrong building is the defect acceptance item 12 exists to catch.
 */
export function scopeLiveBoardTasks(
  tasks: readonly LiveBoardTaskRow[],
  facilityId: string | null,
): LiveBoardTaskRow[] {
  if (!facilityId) return [];
  return tasks.filter((task) => task.facility_id === facilityId);
}

/** Distinct residents the board is showing a check for. */
export function liveBoardResidentCount(tasks: readonly LiveBoardTaskRow[]): number {
  return new Set(tasks.map((task) => task.resident_id)).size;
}

export function groupEscalationsByTask(
  escalations: readonly LiveBoardEscalationRow[],
): Map<string, LiveBoardEscalationRow[]> {
  const byTask = new Map<string, LiveBoardEscalationRow[]>();
  for (const row of escalations) {
    const existing = byTask.get(row.task_id);
    if (existing) existing.push(row);
    else byTask.set(row.task_id, [row]);
  }
  return byTask;
}

export type LiveBoardCounts = {
  total: number;
  critical: number;
  overdue: number;
  pending: number;
  completed: number;
  late: number;
  onTime: number;
  escalated: number;
};

export function deriveLiveBoardCounts(
  tasks: readonly LiveBoardTaskRow[],
  escalatedTaskIds: ReadonlySet<string>,
): LiveBoardCounts {
  const counts: LiveBoardCounts = {
    total: tasks.length,
    critical: 0,
    overdue: 0,
    pending: 0,
    completed: 0,
    late: 0,
    onTime: 0,
    escalated: 0,
  };
  for (const task of tasks) {
    const status = liveBoardStatusCopy(task.status);
    if (status.group === "critical") counts.critical += 1;
    if (status.group === "overdue") counts.overdue += 1;
    if (status.group === "pending") counts.pending += 1;
    if (status.group === "completed") counts.completed += 1;
    if (status.group === "late") counts.late += 1;
    if (escalatedTaskIds.has(task.id)) counts.escalated += 1;
  }
  // On time is what completed without being late. Completed and late are
  // separate groups, so the sum is the completed total.
  counts.onTime = counts.completed;
  counts.completed = counts.completed + counts.late;
  return counts;
}

export function filterLiveBoardTasks(
  tasks: readonly LiveBoardTaskRow[],
  filter: LiveBoardFilter,
  escalatedTaskIds: ReadonlySet<string>,
): LiveBoardTaskRow[] {
  if (filter === "all") return [...tasks];
  if (filter === "escalated") return tasks.filter((task) => escalatedTaskIds.has(task.id));
  return tasks.filter((task) => liveBoardStatusCopy(task.status).group === filter);
}

export function deriveLiveBoardState(args: {
  loadState: LiveBoardLoadState;
  hasFacility: boolean;
  totalTasks: number;
  filteredTasks: number;
  filterApplied: boolean;
}): LiveBoardState {
  if (!args.hasFacility) return "no_facility";
  if (args.loadState === "loading" || args.loadState === "idle") return "loading";
  if (args.loadState === "error") return "error";
  if (args.totalTasks === 0) return "empty";
  if (args.filterApplied && args.filteredTasks === 0) return "empty_filtered";
  return "populated";
}

/**
 * A Live board count as a MetricState (COL-649). Counts are derived from the
 * loaded tasks, so before the read finishes they are "Loading…" and after a
 * failed read they are "Unavailable" — never a 0 beside the error banner.
 */
export function liveBoardCountMetric(loadState: LiveBoardLoadState, value: number): MetricState<number> {
  if (loadState === "idle" || loadState === "loading") return metricLoading();
  if (loadState === "error") return metricUnavailable();
  return metricValue(value);
}

export const LIVE_BOARD_OVERDUE_HINT = "Past the window and its grace";

/**
 * Overdue and Critical are consecutive bands: a check leaves Overdue when it
 * becomes critical or missed. "Overdue 0" beside a critical count is therefore
 * not "nothing is late"; the hint says where the late checks went.
 */
export function liveBoardOverdueHint(counts: Pick<LiveBoardCounts, "overdue" | "critical">): string {
  if (counts.overdue === 0 && counts.critical > 0) {
    return `None still in the overdue band; ${counts.critical} went past it and are counted under Critical`;
  }
  return LIVE_BOARD_OVERDUE_HINT;
}
