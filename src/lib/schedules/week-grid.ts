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
export type ScheduleCellChange = {
  staff_id: string;
  shift_date: string;
  shift_definition_id: string | null;
  custom_start_time?: string;
  custom_end_time?: string;
};

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

export function nextScheduleCellValue(current: string | null, definitions: ScheduleShiftDefinition[]): string | null {
  if (current === "custom") return null;
  const index = definitions.findIndex((definition) => definition.id === current);
  return definitions[index + 1]?.id ?? "custom";
}
