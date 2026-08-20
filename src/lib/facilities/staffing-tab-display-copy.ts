/**
 * Quiet Operator copy for the facility detail staffing tab.
 * Missing roster dates and administrator names name real gaps — never fabricate values.
 */

const NY_TZ = "America/New_York";

export const STAFFING_TAB_NO_ROSTER_DATE_COPY = "No roster date posted";
export const STAFFING_TAB_NO_ADMINISTRATOR_COPY = "No administrator posted";
export const STAFFING_TAB_ACTIVE_STAFF_COUNT_HINT = "Unique people on the active roster";

/** Roster update date on the staffing tab when unset, blank, or unparseable. */
export function formatStaffingTabRosterDate(iso: string | null | undefined): string {
  if (!iso) return STAFFING_TAB_NO_ROSTER_DATE_COPY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return STAFFING_TAB_NO_ROSTER_DATE_COPY;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: NY_TZ }).format(d);
}

/** Administrator of record on the staffing tab when unset or blank. */
export function formatStaffingTabAdministratorName(name: string | null | undefined): string {
  if (!name || !name.trim()) return STAFFING_TAB_NO_ADMINISTRATOR_COPY;
  return name;
}
