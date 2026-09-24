import { fromZonedTime } from "date-fns-tz";
import { addFacilityCalendarDays, FACILITY_OPERATOR_TZ } from "@/lib/facility-wall-clock";
import type { Database } from "@/types/database";

export type ScheduleShiftDefinition = {
  id: string;
  label: string;
  roster_shift_type: Database["public"]["Enums"]["shift_type"];
  starts_at_local: string;
  ends_at_local: string;
};
export type ScheduleAssignment = Database["public"]["Tables"]["shift_assignments"]["Row"] & {
  shift_definition_id?: string | null;
};
export type ScheduleTimeBlock = { start_time: string; end_time: string };
export type ScheduleCellChange = {
  staff_id: string;
  shift_date: string;
  shift_definition_id: string | null;
  custom_start_time?: string;
  custom_end_time?: string;
  /** A split shift: two same-day blocks saved as two assignments in one cell. */
  custom_blocks?: ScheduleTimeBlock[];
};

/** Grid value for the cook split preset. Facility definition IDs are UUIDs, so this cannot collide. */
export const COOK_SPLIT = "cook_split";
export const COOK_SPLIT_LABEL = "Cook split";
/** COL-795: the same split at every building — breakfast and lunch, then supper. */
export const COOK_SPLIT_BLOCKS: readonly ScheduleTimeBlock[] = [
  { start_time: "06:00", end_time: "13:00" },
  { start_time: "16:00", end_time: "18:00" },
];
/** Kitchen staff roles that get the Cook split step in the click cycle. */
export const COOK_STAFF_ROLES: ReadonlySet<string> = new Set(["cook", "dietary_staff", "dietary_aide", "dietary_manager"]);

export function isCookStaffRole(staffRole: string | null | undefined): boolean {
  return COOK_STAFF_ROLES.has(staffRole ?? "");
}

/** True when a saved cell holds exactly the cook split: two plain custom blocks at the preset times. */
export function isCookSplitCell(assignments: Pick<ScheduleAssignment, "shift_type" | "shift_definition_id" | "custom_start_time" | "custom_end_time">[]): boolean {
  if (assignments.length !== COOK_SPLIT_BLOCKS.length) return false;
  const sorted = [...assignments].sort((a, b) => (a.custom_start_time ?? "").localeCompare(b.custom_start_time ?? ""));
  return sorted.every((assignment, index) => assignment.shift_type === "custom" && !assignment.shift_definition_id
    && assignment.custom_start_time?.slice(0, 5) === COOK_SPLIT_BLOCKS[index].start_time
    && assignment.custom_end_time?.slice(0, 5) === COOK_SPLIT_BLOCKS[index].end_time);
}

export function scheduleWeekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addFacilityCalendarDays(start, index));
}

export function scheduleCellKey(staffId: string, date: string): string {
  return `${staffId}:${date}`;
}

export function formatScheduleTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")}${hour < 12 ? "a" : "p"}`;
}

export function formatScheduleTimes(start: string | null, end: string | null): string {
  if (!start || !end) return "Times not recorded";
  return `${formatScheduleTime(start)}–${formatScheduleTime(end)}${end <= start ? " (+1 day)" : ""}`;
}

/** One label per run of blocks, so a split reads "Cook split 6:00a–1:00p and 4:00p–6:00p". */
export function describeScheduleCell(shifts: { label: string; start: string | null; end: string | null }[]): string {
  const parts: string[] = [];
  shifts.forEach((shift, index) => {
    const times = formatScheduleTimes(shift.start, shift.end);
    if (index > 0 && shifts[index - 1].label === shift.label) parts[parts.length - 1] += ` and ${times}`;
    else parts.push(`${shift.label} ${times}`);
  });
  return parts.join(", ");
}

/** Actual elapsed scheduled hours, including overnight shifts and DST changes. No meal deduction is inferred. */
export function scheduledHours(date: string, start: string | null, end: string | null, timeZone = FACILITY_OPERATOR_TZ): number | null {
  if (!start || !end || start === end) return null;
  const endDate = end <= start ? addFacilityCalendarDays(date, 1, timeZone) : date;
  const hours = (fromZonedTime(`${endDate}T${end}`, timeZone).getTime() - fromZonedTime(`${date}T${start}`, timeZone).getTime()) / 3_600_000;
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

export function assignmentDefinitionId(assignment: ScheduleAssignment, definitions: ScheduleShiftDefinition[]): string | null {
  // Explicit custom shifts keep their identity even when their times match a preset.
  if (assignment.shift_type === "custom" && !assignment.shift_definition_id) return null;
  // A stored definition ID preserves identity. Legacy rows are matched only when both recorded times agree.
  const definition = definitions.find((item) => item.id === assignment.shift_definition_id)
    ?? definitions.find((item) => item.roster_shift_type === assignment.shift_type
      && item.starts_at_local.slice(0, 5) === assignment.custom_start_time?.slice(0, 5)
      && item.ends_at_local.slice(0, 5) === assignment.custom_end_time?.slice(0, 5));
  return definition?.id ?? null;
}

/** Off → facility definitions → Cook split (kitchen staff only) → Custom → Off. */
export function nextScheduleCellValue(current: string | null, definitions: ScheduleShiftDefinition[], options: { cookSplit?: boolean } = {}): string | null {
  if (current === "custom") return null;
  if (current === COOK_SPLIT) return "custom";
  const index = definitions.findIndex((definition) => definition.id === current);
  return definitions[index + 1]?.id ?? (options.cookSplit ? COOK_SPLIT : "custom");
}
