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

/**
 * COL-242: the stored state of one drill record, never inferred from the row
 * existing. Migration 359 leaves every row this page writes as a draft, so a
 * saved drill must not read as a satisfied requirement.
 */
export function formatDrillRecordState(record: { finalized_at: string | null; voided_at: string | null }): string {
  if (record.voided_at) return "voided — retained history";
  if (record.finalized_at) return "final — delivered to its requirement";
  return "draft — does not satisfy the requirement yet";
}

/** What this page proved when a drill saved: a draft, and the step that completes it. */
export const DRILL_LOG_DRAFT_SAVED_COPY =
  "Saved as a draft. This drill does not satisfy its requirement yet: an authorized person finalizes it on the site work surface, which records who finalized it and delivers it once.";

/**
 * The migration 359 lifecycle guard refuses content and finality changes by
 * name. Repeat its answer plainly instead of a raw database message, and never
 * imply that a refused save was recorded.
 */
export function formatDrillSaveProblem(message: string): string {
  if (/finalized drill logs change only through a correction/i.test(message))
    return "That drill record is already final. A final record changes only through a correction on the site work surface; nothing was saved here.";
  if (/voided drill logs are immutable/i.test(message))
    return "That drill record was voided and is retained history. It cannot be changed; nothing was saved here.";
  if (/finality changes only through|carries no lifecycle values|recorded as a draft/i.test(message))
    return "This page records a draft only. Finality is recorded by the finalize command on the site work surface; nothing was saved here.";
  return message;
}
