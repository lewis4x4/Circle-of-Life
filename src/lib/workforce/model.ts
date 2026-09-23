import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { addFacilityCalendarDays } from "@/lib/facility-wall-clock";
import type { FacilityShiftDefinition } from "@/lib/caregiver/shift";

export type WorkforceAssignment = { id: string; staff_id: string; schedule_id: string; shift_date: string; shift_type: string; status: string; custom_start_time: string | null; custom_end_time: string | null };
export type WorkforcePerson = { id: string; name: string; role: string; status: string; since: string | null; currentShift: string | null; nextShift: string | null; scheduleId: string | null; attendance: "expected" | "missing" | "extra" | "off" | "called_out" | "unknown"; scheduledMinutes: number | null; scheduleMissing?: boolean; workedMinutes: number | null; timeIncomplete?: boolean; exceptions: number; fileStatus: string; due: { title: string; date: string }[] };
export type WorkforceSnapshot = { facilityId: string; facilityName: string; generatedAt: string; timeclockEnabled: boolean; weekStart: string; weekEnd: string; nextWeekStart: string; scheduleStatus: string; people: WorkforcePerson[]; payrollStatus: string; payrollRulesConfigured: boolean };

export function assignmentSpan(row: WorkforceAssignment, definitions: readonly FacilityShiftDefinition[]) {
  const definition = definitions.find((d) => d.rosterShiftType === row.shift_type);
  const startTime = row.custom_start_time ?? definition?.startsAtLocal;
  const endTime = row.custom_end_time ?? definition?.endsAtLocal;
  if (!startTime || !endTime) return null;
  const endDate = endTime <= startTime ? addFacilityCalendarDays(row.shift_date, 1) : row.shift_date;
  const start = fromZonedTime(`${row.shift_date}T${startTime}`, "America/New_York");
  const end = fromZonedTime(`${endDate}T${endTime}`, "America/New_York");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  return { start, end, label: `${definition?.label ?? "Shift"} ${formatInTimeZone(start, "America/New_York", "h:mma")}–${formatInTimeZone(end, "America/New_York", "h:mma")}` };
}

export function attendanceState(scheduled: boolean, clockedIn: boolean, calledOut: boolean): WorkforcePerson["attendance"] {
  if (calledOut && !clockedIn) return "called_out";
  if (scheduled) return clockedIn ? "expected" : "missing";
  return clockedIn ? "extra" : "off";
}
