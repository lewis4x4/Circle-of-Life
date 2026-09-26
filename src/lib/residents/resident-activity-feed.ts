/**
 * Resident overview activity feed — explicit state machine and a visible period.
 *
 * The feed shows what was recorded for the resident in the chosen number of
 * facility days (America/New_York), 30 by default. An empty feed is reported
 * as "no activity recorded for this period", never as a quiet or uneventful
 * shift: the feed only knows what was documented, not what happened.
 *
 * COL-599: the period used to be fixed. The filter changed the *kind* of entry
 * and never the *span*, so a behaviour pattern that began 45 days ago was
 * invisible on the overview. The operator now picks the span; the loader reads
 * the same span, so a wider period is never a wider label over the same rows.
 */

/** The period the overview opens on. */
export const ACTIVITY_FEED_WINDOW_DAYS = 30;

/**
 * Periods an operator can choose. A view control, not a business rule: it
 * decides how much history is on screen, and nothing is computed from it.
 */
export const ACTIVITY_FEED_PERIOD_OPTIONS = [30, 90, 180, 365] as const;

export type ActivityFeedPeriodDays = (typeof ACTIVITY_FEED_PERIOD_OPTIONS)[number];

export function isActivityFeedPeriod(value: unknown): value is ActivityFeedPeriodDays {
  return ACTIVITY_FEED_PERIOD_OPTIONS.includes(value as ActivityFeedPeriodDays);
}

export function activityFeedPeriodLabel(days: ActivityFeedPeriodDays): string {
  return days === 365 ? "Last 12 months" : `Last ${days} days`;
}

/**
 * Most rows of one kind the overview reads for a period. An engineering budget
 * (page weight), not a business rule. When a kind reaches it the feed says so
 * and points at the Timeline, rather than showing a silently clipped list.
 */
export const ACTIVITY_FEED_ROW_CAP = 200;
export const ACTIVITY_FEED_TIME_ZONE = "America/New_York";

export type ActivityFeedKind = "condition" | "behavior" | "adl" | "note" | "check" | "visit";

export type ActivityFeedFilter = "all" | ActivityFeedKind;

export type ActivityFeedState =
  | "loading"
  | "error"
  | "success-empty"
  | "filtered-empty"
  | "populated";

export type ActivityFeedWindow = {
  /** Inclusive first facility day, YYYY-MM-DD. */
  startDay: string;
  /** Inclusive last facility day (today), YYYY-MM-DD. */
  endDay: string;
  /** Operator label, e.g. "Aug 17 – Sep 15, 2026". */
  label: string;
};

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ACTIVITY_FEED_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const monthDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ACTIVITY_FEED_TIME_ZONE,
  month: "short",
  day: "numeric",
});
const monthDayYearFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ACTIVITY_FEED_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Facility-day key (YYYY-MM-DD in America/New_York) for an instant. */
export function facilityDayKey(instant: Date): string {
  return dayKeyFormatter.format(instant);
}

/**
 * Day key for a recorded timestamp. Date-only values (`log_date`) are already
 * facility days and pass through; full timestamps are converted to the
 * facility time zone. Unparseable values return null.
 */
export function recordedDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const trimmed = iso.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return facilityDayKey(parsed);
}

export function activityFeedWindow(
  now: Date = new Date(),
  days: ActivityFeedPeriodDays = ACTIVITY_FEED_WINDOW_DAYS,
): ActivityFeedWindow {
  const endDay = facilityDayKey(now);
  // Walk back (days − 1) × 24h from `now`; the day key is what matters, and
  // a DST shift of an hour cannot move a noon-anchored instant across a day.
  const startInstant = new Date(now.getTime() - (days - 1) * 86_400_000);
  const startDay = facilityDayKey(startInstant);
  const label = `${monthDayFormatter.format(startInstant)} – ${monthDayYearFormatter.format(now)}`;
  return { startDay, endDay, label };
}

/**
 * Lower bound for the loader's queries: one day earlier than the window's first
 * facility day, so no Eastern-time entry near midnight is lost. The feed trims
 * to the exact window with `isWithinActivityWindow`.
 */
export function activityFeedQueryBounds(
  days: ActivityFeedPeriodDays,
  now: Date = new Date(),
): { sinceIso: string; sinceDay: string } {
  const since = new Date(now.getTime() - days * 86_400_000);
  return { sinceIso: since.toISOString(), sinceDay: facilityDayKey(since) };
}

/** True when a recorded timestamp falls inside the window. Unknown times are kept, not hidden. */
export function isWithinActivityWindow(iso: string | null | undefined, window: ActivityFeedWindow): boolean {
  const key = recordedDayKey(iso);
  if (key == null) return true;
  return key >= window.startDay && key <= window.endDay;
}

export function resolveActivityFeedState(input: {
  status: "loading" | "error" | "ready";
  inWindowCount: number;
  visibleCount: number;
}): ActivityFeedState {
  if (input.status === "loading") return "loading";
  if (input.status === "error") return "error";
  if (input.inWindowCount === 0) return "success-empty";
  if (input.visibleCount === 0) return "filtered-empty";
  return "populated";
}

export const ACTIVITY_FEED_FILTER_LABELS: Record<ActivityFeedFilter, string> = {
  all: "All entries",
  condition: "Condition changes",
  behavior: "Behavior",
  adl: "ADL refusals",
  note: "General notes",
  check: "Safety checks",
  visit: "Visits",
};

export function activityFeedEmptyCopy(window: ActivityFeedWindow): string {
  return `No activity recorded for ${window.label}.`;
}

/** Stated under the feed when a kind reached `ACTIVITY_FEED_ROW_CAP` for the period. */
export function activityFeedTruncatedCopy(kinds: ActivityFeedKind[]): string | null {
  if (kinds.length === 0) return null;
  const names = kinds.map((kind) => ACTIVITY_FEED_FILTER_LABELS[kind].toLowerCase()).join(", ");
  return `Showing the most recent ${ACTIVITY_FEED_ROW_CAP} ${names} for this period. The Timeline tab has every entry.`;
}

export function activityFeedFilteredEmptyCopy(filter: ActivityFeedFilter, window: ActivityFeedWindow): string {
  const kind = ACTIVITY_FEED_FILTER_LABELS[filter].toLowerCase();
  return `No ${kind} recorded for ${window.label}. Other entry types were recorded in this period.`;
}
