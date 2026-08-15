/**
 * Quiet Operator copy for emergency preparedness drill log surfaces.
 * Missing attendance counts name real gaps — never fabricate drill facts.
 */

export const DRILL_LOG_NO_STAFF_COUNT_COPY = "No staff count posted";
export const DRILL_LOG_NO_RESIDENT_COUNT_COPY = "No resident count posted";

/** Metric count — real zero stays `0`; null/undefined uses explicit missing copy. */
export function formatDrillLogMetricCount(
  value: number | null | undefined,
  missingCopy: string,
): string | number {
  if (value == null) return missingCopy;
  return value;
}

/** Staff present count on a drill log row. */
export function formatDrillLogStaffPresentCount(value: number | null | undefined): string | number {
  return formatDrillLogMetricCount(value, DRILL_LOG_NO_STAFF_COUNT_COPY);
}

/** Residents present count on a drill log row. */
export function formatDrillLogResidentsPresentCount(value: number | null | undefined): string | number {
  return formatDrillLogMetricCount(value, DRILL_LOG_NO_RESIDENT_COUNT_COPY);
}

/** Attendance fragment for drill log list rows: "staff X / residents Y". */
export function formatDrillLogAttendanceLine(
  staffPresentCount: number | null | undefined,
  residentsPresentCount: number | null | undefined,
): string {
  const staff = formatDrillLogStaffPresentCount(staffPresentCount);
  const residents = formatDrillLogResidentsPresentCount(residentsPresentCount);
  return `staff ${staff} / residents ${residents}`;
}
