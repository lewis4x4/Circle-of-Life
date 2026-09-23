/**
 * Roles that may approve or deny a shift swap and read every swap in their
 * facilities. Mirrors the role arm of the `staff_see_shift_swap_requests` and
 * `staff_update_shift_swap_requests` policies (migration 069, amended by 468);
 * everyone else reads only swaps they request or cover.
 */
export const SHIFT_SWAP_APPROVER_ROLES = ["owner", "org_admin", "facility_admin", "med_tech"] as const;

export function canApproveShiftSwaps(role: string | null | undefined): boolean {
  return Boolean(role) && (SHIFT_SWAP_APPROVER_ROLES as readonly string[]).includes(role as string);
}
