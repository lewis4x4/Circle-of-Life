/**
 * Quiet Operator copy for schedule detail shift assignments (`/admin/schedules/[id]`).
 * Missing staff joins and blank posted names name real gaps — never fabricate labels.
 */

export const SCHEDULE_ASSIGNMENT_NO_STAFF_COPY = "No staff posted";

export type ScheduleAssignmentStaffMini = {
  first_name?: string | null;
  last_name?: string | null;
};

/** Staff label on an assignment row when the staff join is missing or names are blank. */
export function formatScheduleAssignmentStaffLabel(
  staff: ScheduleAssignmentStaffMini | null | undefined,
): string {
  if (!staff) return SCHEDULE_ASSIGNMENT_NO_STAFF_COPY;
  const first = staff.first_name?.trim() ?? "";
  const last = staff.last_name?.trim() ?? "";
  const name = `${first} ${last}`.trim();
  if (!name) return SCHEDULE_ASSIGNMENT_NO_STAFF_COPY;
  return name;
}

/** Staff label when only a resolved display name is available (list row or CSV export). */
export function formatScheduleAssignmentStaffDisplayName(
  name: string | null | undefined,
): string {
  if (!name || !name.trim()) return SCHEDULE_ASSIGNMENT_NO_STAFF_COPY;
  return name.trim();
}
