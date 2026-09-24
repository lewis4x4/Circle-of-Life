/**
 * Quiet Operator copy for the admin staff roster (`/admin/staff`).
 * Missing next-shift fields name real gaps — never fabricate values.
 */
import { assignmentLabel, type AssignmentSnapshot } from "@/lib/schedules/assignment-context";
import { formatScheduleTimes } from "@/lib/schedules/week-grid";
import { formatDateTimeWith } from "@/lib/format/datetime";


export const STAFF_ROSTER_NO_SHIFT_COPY = "No shift posted";

export type StaffRosterNextShift = AssignmentSnapshot & {
  custom_start_time?: string | null; custom_end_time?: string | null;
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
  if (shift.schedule_preset_name) {
    const date = formatDateTimeWith(shift.shift_date.slice(0, 10), { month: "short", day: "numeric" }, { fallback: shift.shift_date });
    return `${date} · ${assignmentLabel(shift)} · ${formatScheduleTimes(shift.custom_start_time ?? null, shift.custom_end_time ?? null)}`;
  }
  return formatNextShiftLabel(shift.shift_date, shift.shift_type);
}
