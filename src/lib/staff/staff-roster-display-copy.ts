/**
 * Quiet Operator copy for the admin staff roster (`/admin/staff`).
 * Missing next-shift fields name real gaps — never fabricate values.
 */

export const STAFF_ROSTER_NO_SHIFT_COPY = "No shift posted";

export type StaffRosterNextShift = {
  shift_date: string;
  shift_type: string;
};

function formatNextShiftLabel(shiftDate: string, shiftType: string): string {
  const parsed = new Date(`${shiftDate}T12:00:00`);
  const datePart = Number.isNaN(parsed.getTime())
    ? shiftDate
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
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
