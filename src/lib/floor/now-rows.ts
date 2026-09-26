/**
 * Now screen rows and the residents rail, derived from their values (spec 40
 * §6 screen 3, DESIGN.md screen 03). Pure: the screen loads, this decides what
 * each row says and which tone it carries.
 */

import type { StatusPillTone } from "@/components/ui/status-pill";
import type { ObservationTaskStatus } from "@/lib/rounding/types";

/** What every rounding check is called on the floor tablet. */
export const FLOOR_CHECK_NAME = "Safety check";

/** Upcoming checks the Now list shows, and the "next hour" count. */
export const NOW_UPCOMING_WINDOW_MINUTES = 60;

export type CheckTimingKind = "over" | "due" | "upcoming" | "done" | "excused";

export type CheckTiming = {
  kind: CheckTimingKind;
  /** Minutes past due (over) or until due (upcoming); 0 otherwise. */
  minutes: number;
  label: string;
  tone: StatusPillTone;
  /** The row's 3 px leading bar. */
  bar: "destructive" | "warning" | "none";
  /** The Done button is filled only when the check needs doing now. */
  primaryAction: boolean;
  /** The check's window is open (or past), so it can be charted now. */
  chartable: boolean;
};

const OVER_STATUSES: ReadonlySet<string> = new Set(["overdue", "critically_overdue", "missed", "escalated"]);
const DUE_STATUSES: ReadonlySet<string> = new Set(["due_now", "due_soon"]);
const DONE_STATUSES: ReadonlySet<string> = new Set(["completed_on_time", "completed_late"]);

function minutesBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / 60_000));
}

/** "10 min over", "95 min over", "3 h over". */
export function formatOverLabel(minutes: number): string {
  if (minutes < 120) return `${minutes} min over`;
  return `${Math.floor(minutes / 60)} h over`;
}

/** "In 20 min", "In 80 min", "In 3 h". */
export function formatUpcomingLabel(minutes: number): string {
  if (minutes < 120) return `In ${minutes} min`;
  return `In ${Math.floor(minutes / 60)} h`;
}

/** "Opens in 20 min", "Opens in 8 h". */
export function formatOpensLabel(minutes: number): string {
  return `Opens in ${formatUpcomingLabel(minutes).slice(3)}`;
}

/**
 * One check's timing from the status the server derived (its bands are the
 * facility's configuration) and its due time. The status decides the kind; the
 * clock only fills in the minutes.
 *
 * `opensAtIso` is the task's `scheduled_for`, the instant its window opens
 * (the cadence window's grace before the due time, or a monitoring order's
 * occurrence). Before it the check cannot be charted: the server refuses it
 * (migration 554), so the tablet offers no Done and says when it opens.
 */
export function checkTiming(
  derivedStatus: ObservationTaskStatus | string,
  dueAtIso: string,
  now: Date,
  opensAtIso?: string | null,
): CheckTiming {
  const dueMs = new Date(dueAtIso).getTime();
  const nowMs = now.getTime();
  const opensMs = opensAtIso ? new Date(opensAtIso).getTime() : Number.NaN;
  const notOpenYet = Number.isFinite(opensMs) && nowMs < opensMs;
  if (DONE_STATUSES.has(derivedStatus)) {
    return { kind: "done", minutes: 0, label: "Done", tone: "muted", bar: "none", primaryAction: false, chartable: false };
  }
  if (derivedStatus === "excused") {
    return { kind: "excused", minutes: 0, label: "Excused", tone: "muted", bar: "none", primaryAction: false, chartable: false };
  }
  if (OVER_STATUSES.has(derivedStatus)) {
    const minutes = minutesBetween(dueMs, nowMs);
    return { kind: "over", minutes, label: formatOverLabel(minutes), tone: "danger", bar: "destructive", primaryAction: true, chartable: true };
  }
  if (notOpenYet) {
    const minutes = Math.max(1, Math.ceil((dueMs - nowMs) / 60_000));
    const untilOpen = Math.max(1, Math.ceil((opensMs - nowMs) / 60_000));
    return { kind: "upcoming", minutes, label: formatOpensLabel(untilOpen), tone: "muted", bar: "none", primaryAction: false, chartable: false };
  }
  if (DUE_STATUSES.has(derivedStatus) || dueMs <= nowMs) {
    return { kind: "due", minutes: 0, label: "Due now", tone: "warning", bar: "warning", primaryAction: true, chartable: true };
  }
  const minutes = Math.max(1, Math.ceil((dueMs - nowMs) / 60_000));
  return { kind: "upcoming", minutes, label: formatUpcomingLabel(minutes), tone: "muted", bar: "none", primaryAction: false, chartable: true };
}

export type FloorTaskApiRow = {
  id: string;
  due_at: string;
  /** When the check's window opens; before it the check cannot be charted. */
  scheduled_for?: string | null;
  derived_status: string;
  status?: string;
  assigned_staff_id?: string | null;
  requires_claim?: boolean;
  residents?: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
};

export type NowCheck = {
  id: string;
  residentId: string | null;
  residentName: string;
  dueAt: string;
  timing: CheckTiming;
};

export function residentNameOf(person?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null): string {
  return [person?.preferred_name?.trim() || person?.first_name?.trim() || null, person?.last_name?.trim() || null]
    .filter(Boolean)
    .join(" ") || "Resident";
}

/**
 * The Now list: every over and due check since `windowStartIso` (the start of
 * the shift in force, so a backlog from earlier days does not bury this shift),
 * then checks due within the next hour. Time order.
 */
export function selectNowChecks(rows: readonly FloorTaskApiRow[], now: Date, windowStartIso: string): NowCheck[] {
  const windowStartMs = new Date(windowStartIso).getTime();
  const horizonMs = now.getTime() + NOW_UPCOMING_WINDOW_MINUTES * 60_000;
  const out: NowCheck[] = [];
  for (const row of rows) {
    const dueMs = new Date(row.due_at).getTime();
    const timing = checkTiming(row.derived_status, row.due_at, now, row.scheduled_for);
    if (timing.kind === "done" || timing.kind === "excused") continue;
    if ((timing.kind === "over" || timing.kind === "due") && dueMs < windowStartMs) continue;
    if (timing.kind === "upcoming" && dueMs > horizonMs) continue;
    out.push({
      id: row.id,
      residentId: row.residents?.id ?? null,
      residentName: residentNameOf(row.residents),
      dueAt: row.due_at,
      timing,
    });
  }
  return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
}

export type CountSegment = { text: string; tone: "destructive" | "warning" | "muted" };

/** "1 over · 2 due · 3 next hour · 2 tasks", sentence case, zeros left out. */
export function nowCountSegments(checks: readonly NowCheck[], taskCount: number): CountSegment[] {
  const over = checks.filter((check) => check.timing.kind === "over").length;
  const due = checks.filter((check) => check.timing.kind === "due").length;
  const next = checks.filter((check) => check.timing.kind === "upcoming").length;
  const segments: CountSegment[] = [];
  if (over > 0) segments.push({ text: `${over} over`, tone: "destructive" });
  if (due > 0) segments.push({ text: `${due} due`, tone: "warning" });
  if (next > 0) segments.push({ text: `${next} next hour`, tone: "muted" });
  if (taskCount > 0) segments.push({ text: `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`, tone: "muted" });
  return segments;
}

// ---------------------------------------------------------------------------
// Residents rail
// ---------------------------------------------------------------------------

export type ResidentFlag = "alert" | "watch" | "hold" | "stable";

/** Open escalation outranks an active watch, which outranks a hold. */
export function residentFlag(input: { hasOpenEscalation: boolean; hasActiveWatch: boolean; status: string | null }): ResidentFlag {
  if (input.hasOpenEscalation) return "alert";
  if (input.hasActiveWatch) return "watch";
  if (input.status === "hospital_hold" || input.status === "loa") return "hold";
  return "stable";
}

export const RESIDENT_FLAG_WORD: Record<ResidentFlag, string> = {
  alert: "Alert",
  watch: "Watch",
  hold: "Hold",
  stable: "Stable",
};

export const RESIDENT_FLAG_TONE: Record<ResidentFlag, StatusPillTone> = {
  alert: "danger",
  watch: "warning",
  hold: "info",
  stable: "muted",
};

const FLAG_RANK: Record<ResidentFlag, number> = { alert: 0, watch: 1, hold: 2, stable: 3 };

/** Natural room order: "2" before "10", "101A" after "101". */
export function compareRooms(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, "en-US", { numeric: true, sensitivity: "base" });
}

/** Soonest first; no next check sorts last. ISO instants compare as plain strings. */
export function compareDueTimes(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

export type RailCandidate = { id: string; room: string | null; flag: ResidentFlag; nextDueAt: string | null };

/**
 * The rail's tiles: flagged residents first (alert, watch, hold), then the
 * soonest next check, then room order.
 */
export function orderRailResidents<T extends RailCandidate>(residents: readonly T[], limit: number): T[] {
  return [...residents]
    .sort(
      (a, b) =>
        FLAG_RANK[a.flag] - FLAG_RANK[b.flag] ||
        compareDueTimes(a.nextDueAt, b.nextDueAt) ||
        compareRooms(a.room, b.room),
    )
    .slice(0, limit);
}

export type RoundsGroups = { over: NowCheck[]; due: NowCheck[]; upcoming: NowCheck[]; done: NowCheck[]; olderOpen: number };

/**
 * The Rounds tab: this shift's checks by where they stand. Open checks from
 * before the shift began are counted, not listed; they are the administrator's
 * board to reconcile.
 */
export function groupRoundsQueue(rows: readonly FloorTaskApiRow[], now: Date, windowStartIso: string, windowEndIso: string | null): RoundsGroups {
  const startMs = new Date(windowStartIso).getTime();
  const endMs = windowEndIso ? new Date(windowEndIso).getTime() : now.getTime() + 12 * 60 * 60_000;
  const groups: RoundsGroups = { over: [], due: [], upcoming: [], done: [], olderOpen: 0 };
  const sorted = [...rows].sort((a, b) => a.due_at.localeCompare(b.due_at) || a.id.localeCompare(b.id));
  for (const row of sorted) {
    const dueMs = new Date(row.due_at).getTime();
    const timing = checkTiming(row.derived_status, row.due_at, now, row.scheduled_for);
    const check: NowCheck = { id: row.id, residentId: row.residents?.id ?? null, residentName: residentNameOf(row.residents), dueAt: row.due_at, timing };
    if (dueMs < startMs) {
      if (timing.kind === "over" || timing.kind === "due") groups.olderOpen += 1;
      continue;
    }
    if (dueMs >= endMs) continue;
    if (timing.kind === "over") groups.over.push(check);
    else if (timing.kind === "due") groups.due.push(check);
    else if (timing.kind === "upcoming") groups.upcoming.push(check);
    else if (timing.kind === "done") groups.done.push(check);
  }
  return groups;
}
