/**
 * The one place Haven turns instants and calendar dates into display text (COL-659).
 *
 * Every formatter here passes an explicit `timeZone`. `Intl.DateTimeFormat` and
 * `toLocale*String` without one use the runtime's zone, which is UTC on the
 * server and the viewer's zone in the browser, so the same incident rendered
 * 10:05 PM on one load and 2:05 AM the next day on another. The
 * `haven-time/require-time-zone` lint rule keeps new code from reintroducing it.
 *
 * Date-only values (`YYYY-MM-DD`: licence expiries, birth dates, service dates)
 * are calendar dates, not instants. `new Date("2026-09-27")` is UTC midnight,
 * which is Sep 26 in Florida, so they are formatted from their parts instead.
 */

/**
 * Fallback zone when a facility's own `facilities.timezone` is not at hand.
 * Deployment-configurable; every Circle of Life building is in Florida today.
 */
export const DEFAULT_DISPLAY_TIME_ZONE: string =
  process.env.NEXT_PUBLIC_HAVEN_DEFAULT_TIME_ZONE?.trim() || "America/New_York";

export const DATE_TIME_NOT_POSTED_COPY = "No date posted";

export type DisplayInstant = string | number | Date;

export type TimeZoneOption = {
  /** IANA zone, normally the facility's `timezone`. Defaults to {@link DEFAULT_DISPLAY_TIME_ZONE}. */
  timeZone?: string | null;
};

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function resolveTimeZone(timeZone: string | null | undefined): string {
  const trimmed = timeZone?.trim();
  return trimmed ? trimmed : DEFAULT_DISPLAY_TIME_ZONE;
}

function formatter(options: Intl.DateTimeFormatOptions & { timeZone: string }): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let cached = FORMATTER_CACHE.get(key);
  if (!cached) {
    try {
      cached = new Intl.DateTimeFormat("en-US", options);
    } catch {
      // An unknown zone string in facility data must not blank the page.
      cached = new Intl.DateTimeFormat("en-US", { ...options, timeZone: DEFAULT_DISPLAY_TIME_ZONE });
    }
    FORMATTER_CACHE.set(key, cached);
  }
  return cached;
}

/** True for a bare calendar date (`2026-09-27`), which has no time zone. */
export function isDateOnlyString(value: unknown): value is string {
  return typeof value === "string" && DATE_ONLY_RE.test(value.trim());
}

function toInstant(value: DisplayInstant | null | undefined): Date | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  const parsed = value instanceof Date ? value : new Date(typeof value === "string" ? value.trim() : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * A calendar date as the equivalent UTC-noon instant, so formatting it in UTC
 * reproduces the stored day exactly regardless of the viewer's zone.
 */
function dateOnlyAsUtcNoon(value: string): Date | null {
  const match = DATE_ONLY_RE.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12));
  // Reject rollovers such as 2026-02-31.
  return parsed.getUTCDate() === Number(d) ? parsed : null;
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const SHORT_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = { ...DATE_OPTIONS, hour: "numeric", minute: "2-digit" };
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/**
 * Display date, "Sep 27, 2026". A `YYYY-MM-DD` value is shown as that calendar
 * day; an instant is shown as the day it was in `timeZone`.
 */
export function formatDisplayDate(
  value: DisplayInstant | null | undefined,
  { timeZone, fallback = DATE_TIME_NOT_POSTED_COPY }: TimeZoneOption & { fallback?: string } = {},
): string {
  if (isDateOnlyString(value)) {
    const noon = dateOnlyAsUtcNoon(value);
    return noon ? formatter({ ...DATE_OPTIONS, timeZone: "UTC" }).format(noon) : fallback;
  }
  const instant = toInstant(value);
  return instant ? formatter({ ...DATE_OPTIONS, timeZone: resolveTimeZone(timeZone) }).format(instant) : fallback;
}

/** Date and time, "Sep 22, 2026, 10:05 PM", in the facility's zone. */
export function formatDisplayDateTime(
  value: DisplayInstant | null | undefined,
  { timeZone, fallback = DATE_TIME_NOT_POSTED_COPY }: TimeZoneOption & { fallback?: string } = {},
): string {
  const instant = toInstant(value);
  return instant ? formatter({ ...DATE_TIME_OPTIONS, timeZone: resolveTimeZone(timeZone) }).format(instant) : fallback;
}

/** Compact date and time for lists and boards, "Sep 22, 10:05 PM", in the facility's zone. */
export function formatShortDateTime(
  value: DisplayInstant | null | undefined,
  { timeZone, fallback = DATE_TIME_NOT_POSTED_COPY }: TimeZoneOption & { fallback?: string } = {},
): string {
  const instant = toInstant(value);
  return instant
    ? formatter({ ...SHORT_DATE_TIME_OPTIONS, timeZone: resolveTimeZone(timeZone) }).format(instant)
    : fallback;
}

/** Clock time, "10:05 PM", in the facility's zone. */
export function formatDisplayTime(
  value: DisplayInstant | null | undefined,
  { timeZone, fallback = DATE_TIME_NOT_POSTED_COPY }: TimeZoneOption & { fallback?: string } = {},
): string {
  const instant = toInstant(value);
  return instant ? formatter({ ...TIME_OPTIONS, timeZone: resolveTimeZone(timeZone) }).format(instant) : fallback;
}

/**
 * Relative time for "last seen" / "due" cells: "Now", "12m ago", "3h ago",
 * "2d ago", or "in 40m" / "in 5h" for the future. Never minutes past an hour
 * ("2462m ago" was the rounding board's reading of 41 hours).
 */
export function formatRelativeTime(
  value: DisplayInstant | null | undefined,
  now: DisplayInstant = Date.now(),
  { nowLabel = "Now", fallback = DATE_TIME_NOT_POSTED_COPY }: { nowLabel?: string; fallback?: string } = {},
): string {
  const target = toInstant(value);
  const reference = toInstant(now);
  if (!target || !reference) return fallback;

  const diffMs = target.getTime() - reference.getTime();
  const mins = Math.floor(Math.abs(diffMs) / 60_000);
  if (mins < 1) return nowLabel;

  let amount: string;
  if (mins < 60) amount = `${mins}m`;
  else if (mins < 48 * 60) amount = `${Math.floor(mins / 60)}h`;
  else amount = `${Math.floor(mins / (24 * 60))}d`;

  return diffMs > 0 ? `in ${amount}` : `${amount} ago`;
}

/** A duration in minutes as h:mm ("7:05"); negative or missing input reads as the fallback. */
export function formatDurationHoursMinutes(
  minutes: number | null | undefined,
  { fallback = "0:00" }: { fallback?: string } = {},
): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return fallback;
  const whole = Math.round(minutes);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export type PersonNameParts = {
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
};

/**
 * One person-name format across Haven: "First Last" (preferred name first when
 * posted). Returns `fallback` when no name is posted — callers never fall back
 * to a login handle or email.
 */
export function formatPersonName(
  person: PersonNameParts | null | undefined,
  { fallback = "No name posted" }: { fallback?: string } = {},
): string {
  if (!person) return fallback;
  const first = (person.preferred_name?.trim() || person.first_name?.trim()) ?? "";
  const last = person.last_name?.trim() ?? "";
  const combined = `${first} ${last}`.trim();
  return combined.length > 0 ? combined : fallback;
}

/**
 * Last-name-first, for exports that mirror a paper or office sheet sorted by
 * surname (the Incident Reports Log CSV, the rent-roll CSV) and for sort keys.
 * Never rendered on screen: the screen reads "First Last" (COL-686).
 */
export function formatPersonNameLastFirst(
  person: PersonNameParts | null | undefined,
  { fallback = "No name posted" }: { fallback?: string } = {},
): string {
  if (!person) return fallback;
  const first = (person.preferred_name?.trim() || person.first_name?.trim()) ?? "";
  const last = person.last_name?.trim() ?? "";
  if (first && last) return `${last}, ${first}`;
  return first || last || fallback;
}

const LOGIN_HANDLE_RE = /^[a-z0-9._+-]+$/;

/** True for an email or a lowercase login handle ("blewis") stored where a person's name belongs. */
export function looksLikeLoginIdentifier(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  return trimmed.includes("@") || LOGIN_HANDLE_RE.test(trimmed);
}

/**
 * A `user_profiles.full_name` for display. A blank value, an email or a login
 * handle reads as `fallback` — Haven never shows a login identifier as a
 * person's name (COL-686).
 */
export function formatProfileName(
  fullName: string | null | undefined,
  { fallback = "Staff" }: { fallback?: string } = {},
): string {
  const trimmed = fullName?.trim() ?? "";
  if (trimmed.length === 0 || looksLikeLoginIdentifier(trimmed)) return fallback;
  return trimmed;
}
