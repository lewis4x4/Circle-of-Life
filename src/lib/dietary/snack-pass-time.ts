import {
  FACILITY_OPERATOR_TZ,
  facilityDatetimeLocalToUtcIso,
  formatFacilityTimestampEt,
  nowFacilityDatetimeLocal,
} from "@/lib/facility-wall-clock";

/** COL dietary snack pass wall clock — foundation spec anchors facilities to Eastern. */
export const SNACK_PASS_FACILITY_TZ = FACILITY_OPERATOR_TZ;

/** `<input type="datetime-local">` default: current facility-local wall clock (not UTC ISO slice). */
export function nowSnackPassDatetimeLocal(
  now: Date = new Date(),
  timeZone: string = SNACK_PASS_FACILITY_TZ,
): string {
  return nowFacilityDatetimeLocal(now, timeZone);
}

/** Parse facility-local datetime-local value to UTC ISO for `snack_logs.snack_at`. */
export function snackPassDatetimeLocalToUtcIso(
  datetimeLocal: string,
  timeZone: string = SNACK_PASS_FACILITY_TZ,
): string {
  return facilityDatetimeLocalToUtcIso(datetimeLocal, timeZone);
}

/** Recent snack pass list — always Eastern, matching billing / handoff stamps. */
export function formatSnackPassLoggedAtEt(iso: string): string {
  return formatFacilityTimestampEt(iso);
}
