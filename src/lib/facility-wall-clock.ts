import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/** COL operator wall clock — foundation spec anchors facilities to Eastern. */
export const FACILITY_OPERATOR_TZ = "America/New_York";

const DATETIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Date-only `<input type="date">` default: Eastern calendar date (not UTC ISO slice). */
export function todayFacilityDateIso(
  now: Date = new Date(),
  timeZone: string = FACILITY_OPERATOR_TZ,
): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

/** Eastern calendar date offset from today (e.g. +1 = tomorrow, +2 = end of next-shift window). */
export function facilityDateIsoDaysFromToday(
  dayOffset: number,
  now: Date = new Date(),
  timeZone: string = FACILITY_OPERATOR_TZ,
): string {
  const zonedNow = toZonedTime(now, timeZone);
  return formatInTimeZone(addDays(zonedNow, dayOffset), timeZone, "yyyy-MM-dd");
}

/** Add days to a facility calendar date without converting the result through UTC midnight. */
export function addFacilityCalendarDays(
  dateIso: string,
  dayOffset: number,
  timeZone: string = FACILITY_OPERATOR_TZ,
): string {
  if (!DATE_ONLY_RE.test(dateIso)) {
    throw new Error("dateIso must match YYYY-MM-DD");
  }

  // Noon stays on the intended facility date across Eastern DST transitions.
  const facilityNoon = fromZonedTime(`${dateIso}T12:00:00`, timeZone);
  if (Number.isNaN(facilityNoon.getTime())) {
    throw new Error("dateIso must be a valid calendar date");
  }
  return formatInTimeZone(addDays(facilityNoon, dayOffset), timeZone, "yyyy-MM-dd");
}

/** `<input type="datetime-local">` default: current facility-local wall clock (not UTC ISO slice). */
export function nowFacilityDatetimeLocal(
  now: Date = new Date(),
  timeZone: string = FACILITY_OPERATOR_TZ,
): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd'T'HH:mm");
}

/** Hydrate `<input type="datetime-local">` from stored UTC ISO (not UTC ISO slice). */
export function utcIsoToFacilityDatetimeLocal(
  iso: string,
  timeZone: string = FACILITY_OPERATOR_TZ,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error("iso must be a valid timestamp");
  }
  return formatInTimeZone(d, timeZone, "yyyy-MM-dd'T'HH:mm");
}

/** Parse facility-local datetime-local value to UTC ISO for timestamptz columns. */
export function facilityDatetimeLocalToUtcIso(
  datetimeLocal: string,
  timeZone: string = FACILITY_OPERATOR_TZ,
): string {
  const m = DATETIME_LOCAL_RE.exec(datetimeLocal);
  if (!m) {
    throw new Error("datetimeLocal must match YYYY-MM-DDTHH:mm");
  }
  const wallClock = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`;
  return fromZonedTime(wallClock, timeZone).toISOString();
}

/** Operator-facing timestamps — always Eastern, matching billing / handoff stamps. */
export function formatFacilityTimestampEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_OPERATOR_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
