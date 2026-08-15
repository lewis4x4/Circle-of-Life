/**
 * Quiet Operator copy for the admin approvals inbox (`/admin/approvals`).
 * Missing staff joins and blank posted names name real gaps — never fabricate labels.
 */

export const APPROVALS_NO_STAFF_COPY = "No staff posted";
export const APPROVALS_NO_NAME_COPY = "No name posted";

export type ApprovalsStaffNameInput =
  | {
      first_name?: string | null;
      last_name?: string | null;
    }
  | null
  | undefined;

/** Staff label on an approvals inbox row when the join is unset or names are blank. */
export function formatApprovalsStaffName(staff: ApprovalsStaffNameInput): string {
  if (!staff) return APPROVALS_NO_STAFF_COPY;

  const first = staff.first_name?.trim() ?? "";
  const last = staff.last_name?.trim() ?? "";
  const parts = [first, last].filter((part) => part.length > 0);

  if (parts.length === 0) return APPROVALS_NO_NAME_COPY;
  return parts.join(" ");
}
