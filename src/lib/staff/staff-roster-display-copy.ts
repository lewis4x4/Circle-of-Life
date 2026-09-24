/**
 * Quiet Operator copy for the admin staff roster (`/admin/staff`).
 * Missing next-shift fields name real gaps — never fabricate values.
 */
import { formatDateTimeWith } from "@/lib/format/datetime";


export const STAFF_ROSTER_NO_SHIFT_COPY = "No shift posted";

export type StaffRosterNextShift = {
  shift_date: string;
  shift_type: string;
};

function formatNextShiftLabel(shiftDate: string, shiftType: string): string {
  const datePart = formatDateTimeWith(shiftDate.slice(0, 10), { month: "short", day: "numeric" }, { fallback: shiftDate });
  const typeLabel =
    shiftType === "day"
      ? "Day"
      : shiftType === "evening"
        ? "Evening"
        : shiftType === "night"
          ? "Night"
          : "Shift";
  return `${datePart} · ${typeLabel}`;
}

/** Next shift on the staff roster when unset or when no upcoming shift is assigned. */
export function formatStaffRosterNextShift(
  shift: StaffRosterNextShift | null | undefined,
): string {
  if (!shift) return STAFF_ROSTER_NO_SHIFT_COPY;
  return formatNextShiftLabel(shift.shift_date, shift.shift_type);
}
