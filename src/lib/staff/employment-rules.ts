/**
 * COL employment rules (tardy / NCNS) — operational defaults for scheduling integrations.
 */

export enum EmploymentType {
  FULL_TIME = "FULL_TIME",
  PART_TIME = "PART_TIME",
  TEMPORARY = "TEMPORARY",
  PRN = "PRN",
}

export const FULL_TIME_MIN_HOURS = 36;

export function classifyEmploymentType(weeklyHours: number): EmploymentType {
  if (weeklyHours >= FULL_TIME_MIN_HOURS) return EmploymentType.FULL_TIME;
  if (weeklyHours > 0) return EmploymentType.PART_TIME;
  return EmploymentType.PRN;
}

export const TARDY_THRESHOLD_MINUTES = 7;
export const TARDIES_PER_ABSENCE = 4;

export function tardiesToAbsenceEquivalent(tardyCount: number): number {
  return Math.floor(tardyCount / TARDIES_PER_ABSENCE);
}

/** No-call / no-show treated as automatic resignation in policy engine. */
export function isAutoResignationNoCallNoShow(): boolean {
  return true;
}

/** Three or more consecutive absent days may require physician statement (policy flag). */
export function requiresPhysicianStatement(consecutiveAbsentDays: number): boolean {
  return consecutiveAbsentDays >= 3;
}
