/**
 * Resident overview activity feed — explicit state machine and a visible period.
 *
 * The feed shows what was recorded for the resident in the last 30 facility
 * days (America/New_York). An empty feed is reported as "no activity recorded
 * for this period", never as a quiet or uneventful shift: the feed only knows
 * what was documented, not what happened.
 */

export const ACTIVITY_FEED_WINDOW_DAYS = 30;
export const ACTIVITY_FEED_TIME_ZONE = "America/New_York";

export type ActivityFeedKind = "condition" | "behavior" | "adl" | "note";

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

export function activityFeedWindow(now: Date = new Date()): ActivityFeedWindow {
  const endDay = facilityDayKey(now);
  // Walk back (days − 1) × 24h from `now`; the day key is what matters, and
  // a DST shift of an hour cannot move a noon-anchored instant across a day.
  const startInstant = new Date(now.getTime() - (ACTIVITY_FEED_WINDOW_DAYS - 1) * 86_400_000);
  const startDay = facilityDayKey(startInstant);
  const label = `${monthDayFormatter.format(startInstant)} – ${monthDayYearFormatter.format(now)}`;
  return { startDay, endDay, label };
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
};

export function activityFeedEmptyCopy(window: ActivityFeedWindow): string {
  return `No activity recorded for ${window.label}.`;
}

export function activityFeedFilteredEmptyCopy(filter: ActivityFeedFilter, window: ActivityFeedWindow): string {
  const kind = ACTIVITY_FEED_FILTER_LABELS[filter].toLowerCase();
  return `No ${kind} recorded for ${window.label}. Other entry types were recorded in this period.`;
}
