/**
 * Quiet Operator copy for the admin staffing console loader.
 * Missing staff names name real gaps — never fabricate labels.
 */

export const STAFFING_CONSOLE_NO_STAFF_COPY = "No staff posted";

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
