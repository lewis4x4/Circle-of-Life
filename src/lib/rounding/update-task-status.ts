import { MS_PER_MINUTE } from "@/lib/rounding/duration-units";
import type { ObservationTaskStatus } from "@/lib/rounding/types";

/**
 * What a check on the board reads as, and where that answer comes from.
 *
 * This file used to compute `overdue`, `critically_overdue` and `missed` from
 * three constants, and that was a second source of truth with a visible
 * consequence. Part 4 replaced the escalation engine: `overdue` is written by
 * `public.advance_observation_task_lapse` once the window has closed, and
 * `critically_overdue` and `missed` are written by
 * `public.record_observation_escalation_rung` from `facility_escalation_rungs`,
 * which an administrator edits in the settings surface. Recomputing them here
 * from constants meant that moving a rung to a different offset left the board
 * painting a task critically overdue on a schedule nobody could see, and the
 * operator had no way to tell which answer was real.
 *
 * So the recomputation is gone rather than relocated. The rules now:
 *
 *   - A status the server owns is returned unchanged. That is every status
 *     except `upcoming`: `overdue`, `critically_overdue`, `missed`, the two
 *     completions, `excused`, `reassigned` and `escalated`.
 *   - `due_soon` and `due_now` are refinements of `upcoming` that no row
 *     carries, because no server-side writer produces them. `due_now` needs no
 *     policy value at all: it is the span between the check being due and its
 *     window closing, and the window close arrives on the row.
 *   - `due_soon` needs one value, how far ahead a check starts reading as due,
 *     and that value is `facility_observation_thresholds.task_upcoming_lead_minutes`.
 *   - A row still `upcoming` whose window has already closed is a row the
 *     server has not caught up with. Rather than guess, the ladder answers:
 *     the same in-force rung offsets `record_observation_escalation_rung`
 *     reads decide whether the engine's next tick will make it
 *     `critically_overdue` or `missed`, and until a rung is reached it is
 *     `overdue`, which is exactly what `advance_observation_task_lapse` writes.
 *
 * There is no literal minute value in this file.
 */

/** Statuses only a server-side writer produces. Never recomputed here. */
const SERVER_OWNED_STATUSES: ReadonlySet<ObservationTaskStatus> = new Set([
  "overdue",
  "critically_overdue",
  "missed",
  "completed_on_time",
  "completed_late",
  "excused",
  "reassigned",
  "escalated",
]);

/**
 * One rung of the escalation version in force, reduced to the fields that
 * decide a task's status. The shape mirrors `facility_escalation_rungs`.
 *
 * `offsetMinutes` is signed and measured from window close, so a nudge before
 * the window shuts carries a negative offset. `assignedStaffOnly` matters
 * because the nudge is not an escalation and does not move the task's status.
 */
export type EscalationRungOffset = {
  offsetMinutes: number;
  isTerminal: boolean;
  assignedStaffOnly: boolean;
};

/**
 * Everything this module needs from configuration to say what a check reads
 * as. Both halves are rows, and the caller fetches them.
 */
export type ObservationBoardPolicy = {
  /** `facility_observation_thresholds.task_upcoming_lead_minutes`. */
  upcomingLeadMinutes: number;
  /** The rungs of the escalation version in force, enabled only. */
  rungs: readonly EscalationRungOffset[];
};

type TaskTimingInput = {
  /** The status the row carries. */
  status: ObservationTaskStatus;
  dueAt: string | Date;
  /** Window close. `resident_observation_tasks.grace_ends_at`. */
  graceEndsAt: string | Date;
  now?: string | Date;
  policy: ObservationBoardPolicy;
};

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * The status a rung would leave a task in, per
 * `public.record_observation_escalation_rung`: the terminal rung writes
 * `missed`, a non terminal rung that reaches past the assigned staff member
 * writes `critically_overdue`, and a rung addressed only to the assigned staff
 * member (the nudge) writes nothing.
 */
function statusAfterRung(rung: EscalationRungOffset): ObservationTaskStatus | null {
  if (rung.isTerminal) return "missed";
  if (rung.assignedStaffOnly) return null;
  return "critically_overdue";
}

export function calculateObservationTaskStatus(input: TaskTimingInput): ObservationTaskStatus {
  if (SERVER_OWNED_STATUSES.has(input.status)) return input.status;

  const now = toDate(input.now ?? new Date());
  const dueAt = toDate(input.dueAt);
  const windowClosesAt = toDate(input.graceEndsAt);

  // An unreadable timestamp is a defect in the row, not a missed check. The
  // row's own status is the honest answer.
  if (Number.isNaN(dueAt.getTime()) || Number.isNaN(windowClosesAt.getTime())) {
    return input.status;
  }

  const msUntilDue = dueAt.getTime() - now.getTime();
  if (msUntilDue > input.policy.upcomingLeadMinutes * MS_PER_MINUTE) return "upcoming";
  if (msUntilDue > 0) return "due_soon";
  if (now.getTime() < windowClosesAt.getTime()) return "due_now";

  // Past window close and the row still says upcoming, so the lapse tick and
  // the escalation engine have not reached it yet. The ladder in force says
  // what they will do.
  const minutesPastClose = (now.getTime() - windowClosesAt.getTime()) / MS_PER_MINUTE;
  let reached: ObservationTaskStatus = "overdue";
  for (const rung of [...input.policy.rungs].sort((a, b) => a.offsetMinutes - b.offsetMinutes)) {
    if (rung.offsetMinutes > minutesPastClose) break;
    const after = statusAfterRung(rung);
    if (after) reached = after;
  }
  return reached;
}

export function getCompletionTaskStatus(input: {
  observedAt: string | Date;
  graceEndsAt: string | Date;
}): ObservationTaskStatus {
  const observedAt = toDate(input.observedAt);
  const graceEndsAt = toDate(input.graceEndsAt);

  if (Number.isNaN(observedAt.getTime()) || Number.isNaN(graceEndsAt.getTime())) {
    return "completed_late";
  }

  return observedAt.getTime() <= graceEndsAt.getTime() ? "completed_on_time" : "completed_late";
}
