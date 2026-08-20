import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** COL dietary snack pass wall clock — foundation spec anchors facilities to Eastern. */
export const SNACK_PASS_FACILITY_TZ = "America/New_York";

const DATETIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** `<input type="datetime-local">` default: current facility-local wall clock (not UTC ISO slice). */
export function nowSnackPassDatetimeLocal(
  now: Date = new Date(),
  timeZone: string = SNACK_PASS_FACILITY_TZ,
): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd'T'HH:mm");
}

/** Parse facility-local datetime-local value to UTC ISO for `snack_logs.snack_at`. */
export function snackPassDatetimeLocalToUtcIso(
  datetimeLocal: string,
  timeZone: string = SNACK_PASS_FACILITY_TZ,
): string {
  const m = DATETIME_LOCAL_RE.exec(datetimeLocal);
  if (!m) {
    throw new Error("datetimeLocal must match YYYY-MM-DDTHH:mm");
  }
  const wallClock = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`;
  return fromZonedTime(wallClock, timeZone).toISOString();
}

/** Recent snack pass list — always Eastern, matching billing / handoff stamps. */
export function formatSnackPassLoggedAtEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SNACK_PASS_FACILITY_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
