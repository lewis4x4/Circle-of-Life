import { addDays, differenceInCalendarDays, parseISO, startOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const OPERATOR_TZ = "America/New_York";

/** Annual review anchor: `effective_date` + 365 days (facility policy default). */
export function carePlanAnnualDueDate(effectiveDateIso: string): Date {
  const anchor = parseISO(`${effectiveDateIso}T12:00:00`);
  return startOfDay(addDays(anchor, 365));
}

/**
 * Positive = days remaining until due; zero = due today; negative = overdue magnitude.
 * Calendar-day math in America/New_York to match Florida operator expectations.
 */
export function carePlanAnnualReviewDeltaDays(effectiveDateIso: string, now: Date = new Date()): number {
  const due = carePlanAnnualDueDate(effectiveDateIso);
  const todayZoned = startOfDay(toZonedTime(now, OPERATOR_TZ));
  return differenceInCalendarDays(due, todayZoned);
}

export type AnnualReviewHeadline =
  | { kind: "neutral" }
  | { kind: "approaching"; days: number }
  | { kind: "overdue"; days: number }
  /** Due date equals today's calendar day (day-count delta = 0). */
  | { kind: "dueToday" };

export function classifyAnnualReview(deltaDays: number): AnnualReviewHeadline {
  if (deltaDays > 30) return { kind: "neutral" };
  if (deltaDays >= 1) return { kind: "approaching", days: deltaDays };
  if (deltaDays === 0) return { kind: "dueToday" };
  return { kind: "overdue", days: Math.abs(deltaDays) };
}
