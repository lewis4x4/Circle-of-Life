import { formatInTimeZone } from "date-fns-tz";
import { addFacilityCalendarDays } from "@/lib/facility-wall-clock";
import type { FacilityShiftDefinition } from "@/lib/caregiver/shift";
import { assignmentIntervalSpan, type AssignmentSnapshot } from "@/lib/schedules/assignment-context";

export type WorkforceAssignment = AssignmentSnapshot & { id: string; staff_id: string; schedule_id: string; shift_date: string; shift_type: string; status: string; custom_start_time: string | null; custom_end_time: string | null };
export type WorkforcePerson = { id: string; name: string; role: string; status: string; since: string | null; currentShift: string | null; nextShift: string | null; scheduleId: string | null; attendance: "expected" | "missing" | "extra" | "off" | "called_out" | "unknown"; scheduledMinutes: number | null; scheduleMissing?: boolean; workedMinutes: number | null; timeIncomplete?: boolean; exceptions: number; fileStatus: string; due: { title: string; date: string }[] };
export type WorkforceSnapshot = { facilityId: string; facilityName: string; generatedAt: string; timeclockEnabled: boolean; weekStart: string; weekEnd: string; nextWeekStart: string; scheduleStatus: string; people: WorkforcePerson[]; payrollStatus: string; payrollRulesConfigured: boolean };

export function assignmentSpan(row: WorkforceAssignment, definitions: readonly FacilityShiftDefinition[], options: { recordedTimesOnly?: boolean } = {}) {
  // Active definitions can help describe today's legacy roster, but cannot
  // establish what hours were published for a completed historical week.
  if (options.recordedTimesOnly && !row.schedule_starts_at && (!row.custom_start_time || !row.custom_end_time)) return null;
  const definition = definitions.find((d) => d.rosterShiftType === row.shift_type);
  const startTime = row.custom_start_time ?? definition?.startsAtLocal;
  const endTime = row.custom_end_time ?? definition?.endsAtLocal;
  if (!startTime || !endTime) return null;
  const span = assignmentIntervalSpan({ ...row, custom_start_time: startTime, custom_end_time: endTime });
  if (!span) return null;
  return { ...span, label: `${row.schedule_preset_name || definition?.label || span.label} ${formatInTimeZone(span.start, span.timeZone, "h:mma")}–${formatInTimeZone(span.end, span.timeZone, "h:mma")}` };
}

export function completedWeekTimesheetHref(staffId: string, period: Pick<WorkforceSnapshot, "weekStart" | "weekEnd">): string {
  const query = new URLSearchParams({
    period_start: period.weekStart,
    period_end: addFacilityCalendarDays(period.weekEnd, 1),
    period_mode: "workweek",
  });
  return `/admin/timeclock/${encodeURIComponent(staffId)}?${query}`;
}

export function attendanceState(scheduled: boolean, clockedIn: boolean, calledOut: boolean): WorkforcePerson["attendance"] {
  if (calledOut && !clockedIn) return "called_out";
  if (scheduled) return clockedIn ? "expected" : "missing";
  return clockedIn ? "extra" : "off";
}
