/**
 * Quiet Operator copy for the staff illness list (`/admin/infection-control/staff-illness`).
 * Missing staff records and blank posted names name real gaps — never fabricate labels.
 */

export const STAFF_ILLNESS_NO_STAFF_COPY = "No staff posted";
export const STAFF_ILLNESS_NO_NAME_COPY = "No name posted";

export type StaffIllnessStaffMini = {
  first_name?: string | null;
  last_name?: string | null;
};

/** Staff label on a staff illness row when the join is missing or blank. */
export function formatStaffIllnessStaffLabel(
  staff: StaffIllnessStaffMini | null | undefined,
): string {
  if (!staff) return STAFF_ILLNESS_NO_STAFF_COPY;
  const first = staff.first_name?.trim() ?? "";
  const last = staff.last_name?.trim() ?? "";
  const name = `${first} ${last}`.trim();
  if (!name) return STAFF_ILLNESS_NO_NAME_COPY;
  return name;
}
