import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** COL operator wall clock — foundation spec anchors facilities to Eastern. */
export const FACILITY_OPERATOR_TZ = "America/New_York";

const DATETIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** `<input type="datetime-local">` default: current facility-local wall clock (not UTC ISO slice). */
export function nowFacilityDatetimeLocal(
  now: Date = new Date(),
  timeZone: string = FACILITY_OPERATOR_TZ,
): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd'T'HH:mm");
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
