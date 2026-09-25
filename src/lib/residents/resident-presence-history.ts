import type { ResidentPresenceHistoryEntry } from "@/lib/residents/resident-detail-overview-load";
import { isPresenceStatus, lifecycleStatusLabel, mapResidencyStatus, presenceLabel, type BedHoldStayType } from "@/lib/residents/presence";

/**
 * COL-599: presence said what, never since when or who.
 *
 * The header's presence control shows "In-house" / "Bed Hold — Hospital" and
 * can change it, and `tr_residents_status_history_capture` has recorded every
 * change in `resident_status_history` since migration 217 — but the record never
 * read it back. For a resident on hospital hold the first question anyone asks
 * is when they went, and the bed-hold clock depends on the answer.
 *
 * This only reads what the history recorded. When the open span is missing, or
 * the actor is, the copy says "not recorded" — it never falls back to the
 * admission date or to "staff" as if either were known.
 */

const ZONE = "America/New_York";

/** How many presence history rows the overview reads. A page-weight budget. */
export const PRESENCE_HISTORY_LIMIT = 25;

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** COL-755: a bed-hold span names hospital or rehab when its type was recorded. */
export function presenceStatusLabel(rawStatus: string, stayType?: BedHoldStayType | null): string {
  if (!isPresenceStatus(rawStatus)) return lifecycleStatusLabel(rawStatus);
  const status = mapResidencyStatus(rawStatus);
  return presenceLabel(status, status === "hospital" ? stayType : undefined);
}

const utcDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const easternClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * Which calendar a date-stamped span was cast in, or null for a real instant.
 *
 * The capture trigger opens a resident's first span at
 * `admission_date::timestamptz`, which lands on midnight in whatever time zone
 * the session had: UTC on production (all 33 live residents on 2026-09-22),
 * Eastern on some staging rows. Rendering a UTC midnight in Eastern time would
 * claim the resident arrived at 7 or 8 PM the evening before. A real change is
 * stamped with `now()` and is never on a midnight to the millisecond.
 */
function dateStampZone(parsed: Date, basis?: string | null): "UTC" | typeof ZONE | null {
  // COL-750: rows since migration 504 say what they are. A time staff entered
  // can fall on a midnight (8 PM Eastern is midnight UTC) and is still a time.
  if (basis === "save_time" || basis === "entered") return null;
  if (basis === "admission_date") return ZONE;
  if (parsed.getUTCMilliseconds() !== 0) return null;
  if (parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0 && parsed.getUTCSeconds() === 0) return "UTC";
  if (easternClockFormatter.format(parsed) === "00:00:00") return ZONE;
  return null;
}

export function isDateStampedInstant(iso: string, basis?: string | null): boolean {
  const parsed = new Date(iso);
  return !Number.isNaN(parsed.getTime()) && dateStampZone(parsed, basis) != null;
}

const easternDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

function stampedDayKey(parsed: Date, basis?: string | null): string {
  return dateStampZone(parsed, basis) === "UTC" ? parsed.toISOString().slice(0, 10) : dayKeyFormatter.format(parsed);
}

export function formatPresenceInstant(iso: string, basis?: string | null): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const zone = dateStampZone(parsed, basis);
  if (zone === "UTC") return `${utcDayFormatter.format(parsed)} (time not recorded)`;
  if (zone === ZONE) return `${easternDayFormatter.format(parsed)} (time not recorded)`;
  return dateTimeFormatter.format(parsed);
}

/**
 * Whole facility days between the start of a span and `now`: the day it began
 * is day 0. Facility days, not 24-hour periods — a resident sent out at 11 PM
 * is one day into the hold at 1 AM.
 */
export function facilityDaysSince(iso: string, now: Date = new Date(), basis?: string | null): number | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const startKey = stampedDayKey(parsed, basis);
  const start = Date.parse(`${startKey}T00:00:00Z`);
  const end = Date.parse(`${dayKeyFormatter.format(now)}T00:00:00Z`);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** A run of one status, merged from however many history rows recorded it. */
export type PresenceRun = ResidentPresenceHistoryEntry & {
  /**
   * True when the run reaches the oldest row the overview read and that read
   * was capped, so the run may have begun earlier than `effectiveFrom`.
   */
  startMayBeEarlier: boolean;
};

/**
 * Merge back-to-back rows of the same status into one run (newest first).
 *
 * The history is not a clean alternation: re-saves and replays have written
 * In-house → In-house rows, some of them zero-length (seen on staging
 * 2026-09-22). Read literally, the newest of those makes a resident who has
 * been in-house since 2023 look "in-house since last night". The run's start
 * and its actor are those of its oldest row — the change that began it.
 */
export function mergePresenceRuns(history: ResidentPresenceHistoryEntry[]): PresenceRun[] {
  const capped = history.length >= PRESENCE_HISTORY_LIMIT;
  const runs: PresenceRun[] = [];
  history.forEach((entry, index) => {
    const last = runs[runs.length - 1];
    const reachesEnd = capped && index === history.length - 1;
    if (last && last.status === entry.status) {
      last.effectiveFrom = entry.effectiveFrom;
      last.effectiveBasis = entry.effectiveBasis;
      last.recordedByName = entry.recordedByName;
      last.reason = entry.reason ?? last.reason;
      last.startMayBeEarlier = reachesEnd;
      return;
    }
    runs.push({ ...entry, startMayBeEarlier: reachesEnd });
  });
  return runs;
}

/** The open run, when the history carries one for the current status. */
export function currentPresenceSpan(
  history: ResidentPresenceHistoryEntry[],
  rawStatus: string | null,
): PresenceRun | null {
  const open = mergePresenceRuns(history).find((entry) => entry.effectiveTo == null) ?? null;
  // A history whose open span disagrees with the record is not evidence of when
  // the current status began; say "not recorded" rather than show that date.
  if (!open || (rawStatus != null && open.status !== rawStatus)) return null;
  return open;
}

/**
 * Who a run is attributed to. A run that opens on a date stamp was not
 * recorded by anyone at that moment: the capture trigger writes it from the
 * admission date, on insert or — on staging, observed 2026-09-22 — as a
 * backfill when the *next* change is saved, stamped with that later actor.
 * Naming that actor would say they recorded the admission.
 */
function runAttribution(run: ResidentPresenceHistoryEntry): string {
  if (isDateStampedInstant(run.effectiveFrom, run.effectiveBasis)) return "Opened from the admission date";
  return run.recordedByName ? `Recorded by ${run.recordedByName}` : "Recorded by: not attributed";
}

export type PresenceSinceSummary = {
  /** "Since Sep 12, 2026, 2:14 PM" or "Since not recorded". */
  sinceLabel: string;
  /** "Recorded by Jane Doe", "Recorded by: not attributed", or null when there is no span. */
  recordedByLabel: string | null;
  /** "Day 3 of this hospital stay" style count; only for away states. */
  awayDayLabel: string | null;
};

export function presenceSinceSummary(
  history: ResidentPresenceHistoryEntry[],
  rawStatus: string | null,
  now: Date = new Date(),
): PresenceSinceSummary {
  const span = currentPresenceSpan(history, rawStatus);
  if (!span) {
    return { sinceLabel: "Since not recorded", recordedByLabel: null, awayDayLabel: null };
  }
  const at = formatPresenceInstant(span.effectiveFrom, span.effectiveBasis);
  const days = facilityDaysSince(span.effectiveFrom, now, span.effectiveBasis);
  let awayDayLabel: string | null = null;
  if (days != null && (span.status === "hospital_hold" || span.status === "loa")) {
    const noun = span.status === "hospital_hold" ? "hospital stay" : "leave";
    awayDayLabel = days === 0 ? `Began today` : `Day ${days} of this ${noun}`;
  }
  return {
    sinceLabel: at ? `Since ${span.startMayBeEarlier ? "at least " : ""}${at}` : "Since not recorded",
    recordedByLabel: runAttribution(span),
    awayDayLabel,
  };
}

export type PresenceHistoryLine = {
  id: string;
  statusLabel: string;
  /** "Sep 12, 2026, 2:14 PM → Sep 15, 2026, 9:02 AM" or "Sep 15, 2026, 9:02 AM → now". */
  spanLabel: string;
  recordedByLabel: string;
  reason: string | null;
  current: boolean;
};

export function presenceHistoryLines(history: ResidentPresenceHistoryEntry[]): PresenceHistoryLine[] {
  return mergePresenceRuns(history).map((entry) => {
    const from = `${entry.startMayBeEarlier ? "at least " : ""}${formatPresenceInstant(entry.effectiveFrom, entry.effectiveBasis) ?? "Start not recorded"}`;
    const to = entry.effectiveTo == null ? "now" : (formatPresenceInstant(entry.effectiveTo, entry.effectiveToBasis) ?? "end not recorded");
    return {
      id: entry.id,
      statusLabel: presenceStatusLabel(entry.status, entry.bedHoldStayType),
      spanLabel: `${from} → ${to}`,
      recordedByLabel: runAttribution(entry),
      reason: entry.reason ?? entry.lateEntryReason ?? null,
      current: entry.effectiveTo == null,
    };
  });
}
