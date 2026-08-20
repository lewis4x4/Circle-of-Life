/**
 * Quiet Operator copy for the admin staffing console loader.
 * Missing staff names and ratio telemetry name real gaps — never fabricate labels.
 */

export const STAFFING_CONSOLE_NO_STAFF_COPY = "No staff posted";

/** Current ratio KPI when no live staffing snapshot is in scope. */
export const STAFFING_CONSOLE_NO_RATIO_COPY = "No ratio posted";

export type StaffingConsoleCurrentRatioMainValue = string | number;

/** Current ratio main tile — real posted zero stays numeric; nullish gets explicit copy. */
export function formatStaffingConsoleCurrentRatioMainValue(
  ratio: number | null | undefined,
): StaffingConsoleCurrentRatioMainValue {
  if (ratio == null) return STAFFING_CONSOLE_NO_RATIO_COPY;
  return ratio;
}

export function staffingConsoleCurrentRatioMainIsNumeric(
  value: StaffingConsoleCurrentRatioMainValue,
): value is number {
  return typeof value === "number";
}

/** Staff name on an expired-cert warning when first/last are unset or blank. */
export function formatStaffingConsoleExpiredCertStaffName(
  staff: { first_name?: string | null; last_name?: string | null } | null | undefined,
): string {
  if (!staff) return STAFFING_CONSOLE_NO_STAFF_COPY;
  const first = staff.first_name?.trim() ?? "";
  const last = staff.last_name?.trim() ?? "";
  const name = `${first} ${last}`.trim();
  if (!name) return STAFFING_CONSOLE_NO_STAFF_COPY;
  return name;
}
