/**
 * Quiet Operator copy for the Smart Rounding Live board.
 *
 * The board is `/admin/rounding` itself. Overview folded into it, so this file
 * also carries the copy the overview used to own, and Escalations folded into
 * it as a filter, so it carries the rung words too.
 *
 * Three rules this file exists to hold:
 *
 *   - No raw enum value, table name, column name or migration number renders
 *     anywhere (defect 3). Every status, rung and window arrives as a code and
 *     leaves as a sentence.
 *   - No shift name is written here (defect 2). Shift labels come from
 *     `facility_shift_definitions` rows; this file only knows how to put one in
 *     a sentence. The retired third daypart cannot appear because no list of
 *     shifts exists to put it in.
 *   - Empty states are left aligned, two lines, and say what would populate
 *     them. No centered halo, no dashed box, no "Discovery cadence not
 *     configured": the facility cadence is always configured.
 */

import type { LiveBoardShiftRow, LiveBoardWindowRow } from "@/lib/rounding/live-board-fetch";

export const LIVE_BOARD_NO_ROOM_COPY = "No room posted";
export const LIVE_BOARD_UNASSIGNED_COPY = "Unassigned";

/** What a check is called when it belongs to a Monitoring Order, not a window. */
export const LIVE_BOARD_ORDER_CHECK_COPY = "Monitoring Order check";

export type LiveBoardTone = "default" | "warning" | "danger";

export type LiveBoardFilter =
  | "all"
  | "critical"
  | "overdue"
  | "pending"
  | "completed"
  | "late"
  | "escalated";

export type LiveBoardStatusCopy = {
  label: string;
  tone: LiveBoardTone;
  group: Exclude<LiveBoardFilter, "all" | "escalated">;
  /** False for a completed or excused check, which nobody can act on. */
  actionable: boolean;
};

/**
 * Every value of `resident_observation_task_status`, named. An unrecognized
 * code reads as a gap rather than leaking the code itself onto the board.
 */
const STATUS_COPY: Record<string, LiveBoardStatusCopy> = {
  upcoming: { label: "Upcoming", tone: "default", group: "pending", actionable: true },
  due_soon: { label: "Due soon", tone: "default", group: "pending", actionable: true },
  due_now: { label: "Due now", tone: "default", group: "pending", actionable: true },
  overdue: { label: "Overdue", tone: "warning", group: "overdue", actionable: true },
  critically_overdue: { label: "Critical", tone: "danger", group: "critical", actionable: true },
  missed: { label: "Missed", tone: "danger", group: "critical", actionable: true },
  escalated: { label: "Escalated", tone: "danger", group: "critical", actionable: true },
  reassigned: { label: "Reassigned", tone: "warning", group: "pending", actionable: true },
  completed_on_time: { label: "On time", tone: "default", group: "completed", actionable: false },
  completed_late: { label: "Late", tone: "warning", group: "late", actionable: false },
  excused: { label: "Excused", tone: "default", group: "completed", actionable: false },
};

const UNKNOWN_STATUS_COPY: LiveBoardStatusCopy = {
  label: "No status posted",
  tone: "default",
  group: "pending",
  actionable: false,
};

export function liveBoardStatusCopy(status: string | null | undefined): LiveBoardStatusCopy {
  const trimmed = status?.trim();
  if (!trimmed) return UNKNOWN_STATUS_COPY;
  return STATUS_COPY[trimmed] ?? UNKNOWN_STATUS_COPY;
}

/** Room label from the bed-to-room join. Never a column name, never a guess. */
export function liveBoardRoomLabel(roomNumber: string | null | undefined): string {
  const trimmed = roomNumber?.trim();
  return trimmed ? `Room ${trimmed}` : LIVE_BOARD_NO_ROOM_COPY;
}

/**
 * The escalation rungs, as words. The rung key is configuration
 * (`facility_escalation_rungs.rung_key`) and the number beside it is a level,
 * not a score, so neither reaches the operator.
 */
const RUNG_COPY: Record<string, string> = {
  nudge: "Staff reminder",
  tier_1: "First escalation",
  tier_2: "Second escalation",
  tier_3: "Terminal escalation",
};

export function liveBoardRungLabel(rungKey: string | null | undefined): string {
  const trimmed = rungKey?.trim();
  if (!trimmed) return "Escalated";
  return RUNG_COPY[trimmed] ?? "Escalated";
}

/**
 * "Day shift" from a `facility_shift_definitions` row. A task whose window has
 * no shift row behind it says so; it does not fall back to a shift name,
 * because guessing one is how three dayparts survived in a two-shift building.
 */
export function liveBoardShiftLabel(
  shiftKey: string | null | undefined,
  shifts: readonly LiveBoardShiftRow[],
): string {
  const trimmed = shiftKey?.trim();
  if (!trimmed) return "No shift posted";
  const match = shifts.find((shift) => shift.shift_key === trimmed);
  if (!match) return "No shift posted";
  return `${match.label} shift`;
}

/** The window's own label, from the cadence version in force for the date. */
export function liveBoardWindowLabel(
  windowKey: string | null | undefined,
  monitoringOrderId: string | null | undefined,
  windows: readonly LiveBoardWindowRow[],
): string {
  if (monitoringOrderId) return LIVE_BOARD_ORDER_CHECK_COPY;
  const trimmed = windowKey?.trim();
  if (!trimmed) return "No window posted";
  const match = windows.find((window) => window.window_key === trimmed);
  return match?.label ?? "No window posted";
}

export type LiveBoardEmptyCopy = { why: string; guidance: string };

/**
 * Two lines, and the second one says what would fill the board. It never tells
 * the operator to go and apply a cadence: the facility cadence is configuration
 * and it is already in force, so an empty board means the generator has not run
 * for this window, which is a different problem with a different owner.
 */
export function liveBoardEmptyCopy(args: {
  hasFacility: boolean;
  rosterCount: number;
  windowCount: number;
}): LiveBoardEmptyCopy {
  if (!args.hasFacility) {
    return {
      why: "No building selected.",
      guidance: "Choose one in the top bar to load today's checks and yesterday's.",
    };
  }
  if (args.rosterCount === 0) {
    return {
      why: "No residents on this building's roster.",
      guidance: "Checks are generated per active resident, so the board fills once one is admitted.",
    };
  }
  if (args.windowCount === 0) {
    return {
      why: "No observation windows in force for today.",
      guidance:
        "The building's cadence decides the windows. Ask an administrator to check the cadence in facility administration.",
    };
  }
  return {
    why: "No checks recorded or due today or yesterday.",
    guidance:
      "Checks appear once the scheduled generator runs for the next shift, or when a Monitoring Order starts.",
  };
}

export function liveBoardFilterEmptyCopy(filter: LiveBoardFilter): LiveBoardEmptyCopy {
  if (filter === "escalated") {
    return {
      why: "No check has escalated on this board.",
      guidance: "A check that passes its window and its grace lands here with the rung that fired.",
    };
  }
  return {
    why: "No checks match this filter.",
    guidance: "Clear the filter to see the rest of the board, or wait for the next window to open.",
  };
}

/** Page subtitle. Names the building when it can and says so when it cannot. */
export function liveBoardSubtitle(facilityName: string | null): string {
  if (!facilityName) {
    // The board below is the facility gate (COL-651); the subtitle only says what the board is.
    return "Today's checks and yesterday's, per building.";
  }
  return `Today's checks and yesterday's at ${facilityName}. Select a resident to record one.`;
}
