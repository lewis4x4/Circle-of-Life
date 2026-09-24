import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { addFacilityCalendarDays, todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { fetchFacilityShiftDefinitions } from "@/lib/caregiver/shift";
import { computeTimesheet, facilityDayStart, workweekStart, statusNow } from "@/lib/timeclock/compute";
import { loadFacilityTimeclockEnabled, loadOrganizationPayPeriod, loadTimeclockPeriod, type TimeclockStaff } from "@/lib/timeclock/load";
import { assessEmployeeFile, type EmployeeRequirement, type EmployeeFileRecord, type EmployeeSummary } from "@/lib/staff/employee-file";
import { assignmentSpan, attendanceState, type WorkforceAssignment, type WorkforcePerson, type WorkforceSnapshot } from "./model";
import type { Database } from "@/types/database";
import { enumLabel } from "@/lib/display/enum-label";

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; count: number | null; error: { message: string } | null }>): Promise<T[]> {
  const { data } = await readAllPages<T>(async (from, to) => {
    const page = await query(from, to);
    return { ...page, data: page.data as T[] | null };
  });
  return data;
}

/** Caller RLS and current server identity govern every source. No service-role read. */
export async function loadWorkforce(client: SupabaseClient<Database>, facility: { id: string; name: string }, organizationId: string, now = new Date()): Promise<WorkforceSnapshot> {
  const today = todayFacilityDateIso(now);
  const thisWeek = todayFacilityDateIso(workweekStart(now));
  const weekStart = addFacilityCalendarDays(thisWeek, -7);
  const nextWeekStart = addFacilityCalendarDays(thisWeek, 7);
  const horizon = addFacilityCalendarDays(nextWeekStart, 7);
  const [enabled, settings, staff, definitions, schedules, assignments, requirements, records] = await Promise.all([
    loadFacilityTimeclockEnabled(client, facility.id),
    loadOrganizationPayPeriod(client, organizationId),
    allRows<EmployeeSummary>((from, to) => client.from("staff").select("id, first_name, last_name, staff_role, hire_date, employment_status, facility_id, user_id", { count: "exact" }).eq("facility_id", facility.id).is("deleted_at", null).order("id").range(from, to)),
    fetchFacilityShiftDefinitions(client, [facility.id]),
    allRows<{ id: string; week_start_date: string; status: string; published_at: string | null }>((from, to) => client.from("schedules").select("id, week_start_date, status, published_at", { count: "exact" }).eq("facility_id", facility.id).is("deleted_at", null).gte("week_start_date", addFacilityCalendarDays(weekStart, -7)).lt("week_start_date", horizon).order("id").range(from, to)),
    allRows<WorkforceAssignment>((from, to) => client.from("shift_assignments").select("id, staff_id, schedule_id, shift_date, shift_type, status, custom_start_time, custom_end_time", { count: "exact" }).eq("facility_id", facility.id).is("deleted_at", null).gte("shift_date", addFacilityCalendarDays(weekStart, -1)).lt("shift_date", horizon).order("id").range(from, to)),
    allRows<EmployeeRequirement>((from, to) => client.from("employee_file_requirements" as never).select("*", { count: "exact" }).eq("facility_id", facility.id).neq("category", "medical").is("deleted_at", null).order("id").range(from, to)),
    allRows<EmployeeFileRecord>((from, to) => client.from("employee_file_records" as never).select("id, requirement_id, staff_id, status, completed_on, expires_on, created_at, reviewed_by", { count: "exact" }).eq("facility_id", facility.id).is("deleted_at", null).order("id").range(from, to)),
  ]);
  // Turning off new punches does not erase the completed week's recorded work.
  const ledger = await loadTimeclockPeriod(client, { facilityId: facility.id, periodStart: facilityDayStart(weekStart), periodEnd: facilityDayStart(addFacilityCalendarDays(today, 1)) });
  const published = new Set(schedules.filter((s) => s.status === "published").map((s) => s.id));
  const archivedPublished = new Set(schedules.filter((s) => s.status === "archived" && s.published_at).map((s) => s.id));
  const periodScheduleMissing = !schedules.some((s) => s.week_start_date === weekStart && (published.has(s.id) || archivedPublished.has(s.id)));
  const publishedAssignments = assignments.filter((a) => published.has(a.schedule_id) || (a.shift_date < thisWeek && archivedPublished.has(a.schedule_id)));
  const shifts = definitions.get(facility.id) ?? [];
  const staffById = new Map<string, EmployeeSummary | TimeclockStaff>(staff.map((s) => [s.id, s]));
  // Visiting staff with punches still appear, but their personnel file is never inferred.
  for (const s of ledger.staff) if (!staffById.has(s.id)) staffById.set(s.id, s);
  const recordedStaffIds = new Set([...publishedAssignments, ...ledger.punches, ...ledger.corrections, ...ledger.rejections].map((row) => row.staff_id).filter((id): id is string => !!id));
  if ([...recordedStaffIds].some((id) => !staffById.has(id))) throw new Error("Recorded staff scope is incomplete. Employee information could not be resolved.");
  const periodStart = facilityDayStart(weekStart);
  const periodEnd = facilityDayStart(thisWeek);
  const yesterday = addFacilityCalendarDays(today, -1);
  const dueThrough = addFacilityCalendarDays(today, 60);
  const people: WorkforcePerson[] = [...staffById.values()].map((s) => {
    const personAssignments = publishedAssignments.filter((a) => a.staff_id === s.id);
    const resolved = personAssignments.map((a) => ({ assignment: a, span: assignmentSpan(a, shifts) }));
    const spans = resolved.filter((v) => v.span !== null);
    const historicalSpans = personAssignments.filter((a) => a.shift_date < thisWeek).map((a) => assignmentSpan(a, shifts, { recordedTimesOnly: true }));
    const unresolved = resolved.filter((v) => v.span === null).map((v) => v.assignment);
    const unknownToday = unresolved.find((a) => a.shift_date >= yesterday && a.shift_date <= today);
    const unknownNext = unresolved.filter((a) => a.shift_date > today && !["called_out", "no_show"].includes(a.status)).sort((a, b) => a.shift_date.localeCompare(b.shift_date))[0];
    const current = spans.find((v) => v.span!.start <= now && v.span!.end > now);
    const next = spans.filter((v) => v.span!.start > now && !["called_out", "no_show"].includes(v.assignment.status)).sort((a, b) => a.span!.start.getTime() - b.span!.start.getTime())[0];
    const clock = statusNow(ledger.punches, ledger.corrections, s.id, now);
    const sheet = computeTimesheet({ staffId: s.id, punches: ledger.punches, corrections: ledger.corrections, rejections: ledger.rejections, periodStart, periodEnd, now });
    const file = "hire_date" in s ? assessEmployeeFile(requirements, records, s, today) : [];
    const due = file.flatMap((a) => {
      // Incomplete or unverified evidence cannot replace a completion deadline
      // with its proposed expiry. For a completed requirement, show renewal due.
      const completionDue = a.state !== "verified" && a.state !== "expired" ? a.dueOn : null;
      const verifiedExpiry = a.record?.status === "verified" && a.record.completed_on && a.record.completed_on <= today ? a.record.expires_on : null;
      const date = [completionDue, verifiedExpiry].filter((value): value is string => !!value).sort()[0];
      return date && date <= dueThrough ? [{ title: a.requirement.title, date }] : [];
    });
    return {
      id: s.id, name: "first_name" in s ? `${s.first_name} ${s.last_name}` : s.name, role: "staff_role" in s ? enumLabel(s.staff_role) : "Visiting staff", status: clock.state, since: clock.since?.toISOString() ?? null,
      currentShift: current?.span?.label ?? (unknownToday ? "Shift times not configured" : null),
      nextShift: unknownNext && (!next || unknownNext.shift_date <= next.assignment.shift_date) ? `${unknownNext.shift_date} · Shift times not configured` : next ? `${next.assignment.shift_date} · ${next.span!.label}` : null,
      scheduleId: current?.assignment.schedule_id ?? unknownToday?.schedule_id ?? next?.assignment.schedule_id ?? unknownNext?.schedule_id ?? null,
      attendance: unknownToday ? "unknown" : attendanceState(!!current, clock.state !== "out", !!current && ["called_out", "no_show"].includes(current.assignment.status)),
      scheduleMissing: periodScheduleMissing,
      scheduledMinutes: periodScheduleMissing || historicalSpans.some((span) => span === null) ? null : historicalSpans.reduce((total, span) => total + Math.max(0, Math.round((Math.min(span!.end.getTime(), periodEnd.getTime()) - Math.max(span!.start.getTime(), periodStart.getTime())) / 60000)), 0),
      workedMinutes: sheet.days.some((d) => d.punches.length > 0) ? sheet.periodWorkedMinutes : null,
      timeIncomplete: sheet.exceptions.some((e) => !e.acknowledged && (e.type === "missing_out" || e.type === "missing_meal_end")),
      exceptions: sheet.exceptions.filter((e) => !e.acknowledged).length,
      fileStatus: !("hire_date" in s) ? "Employee file unavailable here" : file.length === 0 ? "Requirements not configured" : file.every((a) => a.state === "verified") ? "Recorded requirements verified" : `${file.filter((a) => a.state !== "verified").length} requirements to review`, due,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const nextSchedules = schedules.filter((s) => s.week_start_date === nextWeekStart);
  return { facilityId: facility.id, facilityName: facility.name, generatedAt: now.toISOString(), timeclockEnabled: enabled, weekStart, weekEnd: addFacilityCalendarDays(thisWeek, -1), nextWeekStart, scheduleStatus: nextSchedules.length === 0 ? "Not started" : nextSchedules.every((s) => s.status === "published") ? "Published" : "Draft", people, payrollStatus: "Prepare payroll packet", payrollRulesConfigured: !!settings?.timeclock_pay_period };
}
