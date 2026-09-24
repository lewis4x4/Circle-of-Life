import {
  addFacilityCalendarDays,
  facilityDatetimeLocalToUtcIso,
  todayFacilityDateIso,
} from "@/lib/facility-wall-clock";

/**
 * COL-750: a resident movement (hospital out and back, leave out and back,
 * discharge, death, arrival) carries the time it actually happened, not the
 * time someone saved it.
 *
 * Every flow asks "when did this happen?" with an Eastern date and time. Both
 * blank means "just now" and the database stamps the save time, exactly as
 * before. The database (migration 503, `haven.resident_status_effective_guard`)
 * is the authority on every rule below; this module only says the same thing
 * before the save so staff are not surprised by a refusal:
 *
 *   - no future time;
 *   - no time at or before the resident's last recorded change (overlap);
 *   - older than the back-date window (the operating rule
 *     `resident_movement.backdate_window_days`, never a literal here) needs an
 *     owner or org admin and a reason.
 */

export type MovementWhenDraft = {
  /** `YYYY-MM-DD`, Eastern calendar date; empty when not given. */
  date: string;
  /** `HH:mm`, Eastern wall clock; empty when not given. */
  time: string;
  /** Why it is entered late; only needed beyond the window. */
  reason: string;
};

export const EMPTY_MOVEMENT_WHEN: MovementWhenDraft = { date: "", time: "", reason: "" };

export type MovementWhen = {
  /** UTC ISO instant, or null for "now" (the database stamps the save time). */
  effectiveAt: string | null;
  /** Older than the back-date window: an owner or org admin and a reason are required. */
  beyondWindow: boolean;
  /** Trimmed reason, or null. */
  reason: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * True when a movement dated `dateIso` is older than the window allows. An
 * unreadable window (null) means any back-date needs an owner or org admin,
 * matching the database.
 */
export function isBeyondBackdateWindow(dateIso: string, windowDays: number | null, now: Date = new Date()): boolean {
  if (!DATE_RE.test(dateIso)) return false;
  if (windowDays === null) return true;
  return dateIso < addFacilityCalendarDays(todayFacilityDateIso(now), -windowDays);
}

/**
 * Turns the "when did this happen?" fields into what the save sends, or the
 * one thing to fix. `dateRequired` is for discharge, whose date is also the
 * billing cutoff and is never assumed.
 */
export function resolveMovementWhen(
  draft: MovementWhenDraft,
  options: { windowDays: number | null; dateRequired?: boolean; now?: Date },
): { ok: true; value: MovementWhen } | { ok: false; error: string } {
  const now = options.now ?? new Date();
  const date = draft.date.trim();
  const time = draft.time.trim();
  const reason = draft.reason.trim() || null;
  const today = todayFacilityDateIso(now);

  if (!date && !time) {
    if (options.dateRequired) return { ok: false, error: "Choose the date it happened." };
    return { ok: true, value: { effectiveAt: null, beyondWindow: false, reason: null } };
  }
  if (!date) return { ok: false, error: "Choose the date as well as the time." };
  if (!DATE_RE.test(date)) return { ok: false, error: "Enter the date as a calendar date." };
  if (date > today) return { ok: false, error: "That date is in the future. Enter when it actually happened." };
  if (!time) {
    if (date === today) return { ok: true, value: { effectiveAt: null, beyondWindow: false, reason: null } };
    return { ok: false, error: "Enter the time it happened (Eastern)." };
  }
  if (!TIME_RE.test(time)) return { ok: false, error: "Enter the time as hours and minutes." };

  const effectiveAt = facilityDatetimeLocalToUtcIso(`${date}T${time}`);
  if (new Date(effectiveAt).getTime() > now.getTime()) {
    return { ok: false, error: "That time is in the future. Enter when it actually happened." };
  }
  const beyondWindow = isBeyondBackdateWindow(date, options.windowDays, now);
  if (beyondWindow && !reason) {
    return { ok: false, error: "Say why this is being entered late." };
  }
  return { ok: true, value: { effectiveAt, beyondWindow, reason } };
}

/**
 * The residents columns a status change carries. "Now" sends nothing, so the
 * database stamps the save time.
 */
export function movementPatchFields(when: MovementWhen): Record<string, string> {
  if (!when.effectiveAt) return {};
  return when.reason
    ? { status_effective_at: when.effectiveAt, status_effective_reason: when.reason }
    : { status_effective_at: when.effectiveAt };
}

/** Human line for the window, for the form's hint. */
export function backdateWindowHint(windowDays: number | null | undefined): string | null {
  if (windowDays === undefined) return null;
  if (windowDays === null || windowDays === 0) {
    return "Only an owner or org admin can date a movement earlier than today, with a reason.";
  }
  return windowDays === 1
    ? "You can date it up to 1 day back. Earlier needs an owner or org admin and a reason."
    : `You can date it up to ${windowDays} days back. Earlier needs an owner or org admin and a reason.`;
}

/**
 * The refusals the movement guard raises (migration 503). A message that
 * starts with one of these is written for staff and is shown as it is; any
 * other database error keeps the caller's generic wording.
 */
export const MOVEMENT_GUARD_MESSAGE_STARTS = [
  "A resident movement cannot be dated in the future",
  "This would overlap the resident's last recorded change",
  "Only an owner or org admin can date a resident movement",
  "Say why this movement is being entered late",
  "The time of the discharge must fall on the discharge date",
  "When a status began is recorded with the status change itself",
  "The arrival time must fall on the arrival date",
] as const;

export function movementGuardMessage(error: unknown): string | null {
  const message =
    error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string"
      ? (error as { message: string }).message
      : null;
  if (!message) return null;
  return MOVEMENT_GUARD_MESSAGE_STARTS.some((start) => message.startsWith(start)) ? message : null;
}
