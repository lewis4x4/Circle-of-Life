import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addFacilityCalendarDays } from "@/lib/facility-wall-clock";
import type { Database } from "@/types/database";
import type { AssignmentSnapshot } from "./assignment-context";

export type ScheduleShiftDefinition = {
  id: string;
  label: string;
  roster_shift_type: Database["public"]["Enums"]["shift_type"];
  starts_at_local: string;
  ends_at_local: string;
};
export type ScheduleAssignment = Database["public"]["Tables"]["shift_assignments"]["Row"] & AssignmentSnapshot & {
  shift_definition_id?: string | null;
};
export type ScheduleCellChange = {
  staff_id: string;
  shift_date: string;
  shift_definition_id: string | null;
  custom_start_time?: string;
  custom_end_time?: string;
  custom_blocks?: Array<{ start: string; end: string }>;
  custom_rounding_coverage?: boolean;
  preset_id?: string;
  expected_preset_version?: number;
};

export function scheduleWeekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addFacilityCalendarDays(start, index, "UTC"));
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

/** Match PostgreSQL wall-clock resolution: reject nonexistent times, choose the later fall-back occurrence. */
export function scheduleWallTime(date: string, time: string, timeZone: string): Date | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?$/.test(time)) return null;
  try {
    const wall = new Date(`${date}T${time}Z`);
    const seed = fromZonedTime(`${date}T${time}`, timeZone);
    if (!Number.isFinite(wall.getTime()) || !Number.isFinite(seed.getTime())) return null;
    const target = wall.toISOString().slice(0, -1);
    const offsets = new Set([-36, 0, 36].map((hours) => formatInTimeZone(new Date(seed.getTime() + hours * 3_600_000), timeZone, "xxx")));
    const candidates: Date[] = [];
    for (const offset of offsets) {
      const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
      if (!match) continue;
      const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "-" ? -1 : 1);
      const instant = new Date(wall.getTime() - minutes * 60_000);
      if (formatInTimeZone(instant, timeZone, "yyyy-MM-dd'T'HH:mm:ss.SSS") === target) candidates.push(instant);
    }
    return candidates.sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
  } catch { return null; }
}

/** Actual elapsed scheduled hours; no meal deduction or universal facility time zone is inferred. */
export function scheduledHours(date: string, start: string | null, end: string | null, timeZone: string): number | null {
  if (!start || !end) return null;
  const startWall = Date.parse(`${date}T${start}Z`); const endWall = Date.parse(`${date}T${end}Z`);
  if (startWall === endWall) return null;
  const endDate = endWall < startWall ? addFacilityCalendarDays(date, 1, timeZone) : date;
  const from = scheduleWallTime(date, start, timeZone); const to = scheduleWallTime(endDate, end, timeZone);
  if (!from || !to) return null;
  const hours = (to.getTime() - from.getTime()) / 3_600_000;
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

/** Split cells are editable as a unit only when all saved managed blocks are present. */
export function isManagedScheduleGroup(rows: ScheduleAssignment[]): boolean {
  if (!rows.length || !rows[0].schedule_group_id) return false;
  const first = rows[0];
  return first.schedule_block_count === rows.length
    && rows.every((row) => row.schedule_group_id === first.schedule_group_id
      && row.schedule_block_count === rows.length && row.schedule_preset_id === first.schedule_preset_id)
    && rows.map((row) => row.schedule_block_index).sort((a, b) => (a ?? -1) - (b ?? -1)).every((value, index) => value === index);
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

export function nextScheduleCellValue(current: string | null, definitions: ReadonlyArray<{ id: string }>): string | null {
  if (current === "custom") return null;
  const index = definitions.findIndex((definition) => definition.id === current);
  return definitions[index + 1]?.id ?? "custom";
}
