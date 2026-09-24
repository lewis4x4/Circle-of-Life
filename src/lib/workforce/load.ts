import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { addFacilityCalendarDays, todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { fetchFacilityShiftDefinitions } from "@/lib/caregiver/shift";
import { computeTimesheet, facilityDayStart, workweekStart, statusNow } from "@/lib/timeclock/compute";
import { loadFacilityTimeclockEnabled, loadOrganizationPayPeriod, loadTimeclockPeriod, type TimeclockStaff } from "@/lib/timeclock/load";
import { assessEmployeeFile, type EmployeeRequirement, type EmployeeFileRecord, type EmployeeSummary } from "@/lib/staff/employee-file";
import { assignmentSpan, attendanceState, type WorkforceAssignment, type WorkforcePerson, type WorkforceSnapshot } from "./model";
import type { Database } from "@/types/database";
import { ASSIGNMENT_SNAPSHOT_SELECT } from "@/lib/schedules/assignment-context";
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
    loadWorkforceStaff(client, organizationId, [facility.id], today),
    fetchFacilityShiftDefinitions(client, [facility.id]),
    allRows<{ id: string; week_start_date: string; status: string; published_at: string | null }>((from, to) => client.from("schedules").select("id, week_start_date, status, published_at", { count: "exact" }).eq("facility_id", facility.id).is("deleted_at", null).gte("week_start_date", addFacilityCalendarDays(weekStart, -7)).lt("week_start_date", horizon).order("id").range(from, to)),
    allRows<WorkforceAssignment>((from, to) => client.from("shift_assignments").select(`id, staff_id, schedule_id, shift_date, shift_type, status, custom_start_time, custom_end_time, ${ASSIGNMENT_SNAPSHOT_SELECT}`, { count: "exact" }).eq("facility_id", facility.id).is("deleted_at", null).gte("shift_date", addFacilityCalendarDays(weekStart, -1)).lt("shift_date", horizon).order("id").range(from, to)),
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
  type ScheduledPerson = Pick<EmployeeSummary, "id" | "first_name" | "last_name" | "staff_role" | "employment_status">;
  const staffById = new Map<string, EmployeeSummary | TimeclockStaff | ScheduledPerson>(staff.map((s) => [s.id, s]));
  // Visiting staff with punches still appear, but their personnel file is never inferred.
  for (const s of ledger.staff) if (!staffById.has(s.id)) staffById.set(s.id, s);
  // Published visitors may not have clocked in yet. Resolve only their work
  // identity through the schedule projection, never their home personnel file.
  const missingAssignments = publishedAssignments.filter((assignment) => !staffById.has(assignment.staff_id));
  const missingIds = new Set(missingAssignments.map((assignment) => assignment.staff_id));
  const weekIds = [...new Set(missingAssignments.map((assignment) => assignment.schedule_id))];
  const scheduledPeople = await Promise.all(weekIds.map((id) => allRows<ScheduledPerson>((from, to) => client
    .rpc("schedule_people_for_week" as never, { p_schedule_id: id } as never, { count: "exact" })
    .order("id").range(from, to))));
  for (const person of scheduledPeople.flat()) if (missingIds.has(person.id) && !staffById.has(person.id)) staffById.set(person.id, {
    id: person.id, first_name: person.first_name, last_name: person.last_name,
    staff_role: person.staff_role, employment_status: person.employment_status,
  });
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

/** Staff whose home facility or current assignment is in the requested visible facilities. */
async function loadWorkforceStaff(client: SupabaseClient<Database>, organizationId: string, facilityIds: string[], asOf: string): Promise<EmployeeSummary[]> {
  if (facilityIds.length === 0) return [];
  const assignments = await allRows<{ staff_id: string; start_date: string; end_date: string | null }>((from, to) => client.from("staff_facility_assignments" as never)
    .select("staff_id, start_date, end_date", { count: "exact" })
    .eq("organization_id", organizationId)
    .in("facility_id", facilityIds)
    .is("deleted_at", null)
    .order("staff_id")
    .range(from, to));
  const assignedIds = [...new Set(assignments.filter((assignment) => isCurrentAssignment(assignment, asOf)).map((assignment) => assignment.staff_id))];
  const homeStaff = await allRows<EmployeeSummary>((from, to) => client.from("staff")
    .select("id, first_name, last_name, staff_role, hire_date, employment_status, facility_id, user_id", { count: "exact" })
    .in("facility_id", facilityIds)
    .is("deleted_at", null)
    .order("id")
    .range(from, to));
  const assignedStaff = assignedIds.length === 0 ? [] : await allRows<EmployeeSummary>((from, to) => client.from("staff")
    .select("id, first_name, last_name, staff_role, hire_date, employment_status, facility_id, user_id", { count: "exact" })
    .in("id", assignedIds)
    .is("deleted_at", null)
    .order("id")
    .range(from, to));
  return [...new Map([...homeStaff, ...assignedStaff].map((person) => [person.id, person])).values()];
}

function isCurrentAssignment(assignment: { start_date: string; end_date: string | null }, asOf: string): boolean {
  return assignment.start_date <= asOf && (assignment.end_date === null || assignment.end_date >= asOf);
}

/** One row per person for the People page while the shell is scoped to All Facilities. */
export async function loadAllFacilitiesWorkforce(client: SupabaseClient<Database>, organizationId: string, now = new Date()): Promise<WorkforceSnapshot> {
  const today = todayFacilityDateIso(now);
  const facilities = await allRows<{ id: string; name: string }>((from, to) => client.from("facilities")
    .select("id, name", { count: "exact" })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("name")
    .range(from, to));
  if (facilities.length === 0) {
    const thisWeek = todayFacilityDateIso(workweekStart(now));
    return { facilityId: null, facilityName: "All Facilities", allFacilities: true, generatedAt: now.toISOString(), timeclockEnabled: false, weekStart: addFacilityCalendarDays(thisWeek, -7), weekEnd: addFacilityCalendarDays(thisWeek, -1), nextWeekStart: addFacilityCalendarDays(thisWeek, 7), scheduleStatus: "Facility-specific", people: [], payrollStatus: "Facility-specific", payrollRulesConfigured: false };
  }
  const staff = await loadWorkforceStaff(client, organizationId, facilities.map((facility) => facility.id), today);
  const assignmentRows = await allRows<{ staff_id: string; facility_id: string; start_date: string; end_date: string | null }>((from, to) => client.from("staff_facility_assignments" as never)
    .select("staff_id, facility_id, start_date, end_date", { count: "exact" })
    .eq("organization_id", organizationId)
    .in("facility_id", facilities.map((facility) => facility.id))
    .is("deleted_at", null)
    .order("staff_id")
    .range(from, to));
  const facilityNamesById = new Map(facilities.map((facility) => [facility.id, facility.name]));
  const assignedFacilities = new Map<string, Set<string>>();
  for (const assignment of assignmentRows.filter((row) => isCurrentAssignment(row, today))) {
    const names = assignedFacilities.get(assignment.staff_id) ?? new Set<string>();
    const name = facilityNamesById.get(assignment.facility_id);
    if (name) names.add(name);
    assignedFacilities.set(assignment.staff_id, names);
  }
  const people: WorkforcePerson[] = staff.map((person) => {
    const names = assignedFacilities.get(person.id) ?? new Set<string>();
    const homeName = facilityNamesById.get(person.facility_id);
    if (homeName) names.add(homeName);
    return {
      id: person.id,
      name: `${person.first_name} ${person.last_name}`,
      role: enumLabel(person.staff_role),
      facilityNames: [...names].sort((a, b) => a.localeCompare(b)),
      status: "out",
      since: null,
      currentShift: null,
      nextShift: null,
      scheduleId: null,
      attendance: "off" as const,
      scheduledMinutes: null,
      workedMinutes: null,
      exceptions: 0,
      fileStatus: "Open employee file",
      due: [],
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const thisWeek = todayFacilityDateIso(workweekStart(now));
  const weekStart = addFacilityCalendarDays(thisWeek, -7);
  const nextWeekStart = addFacilityCalendarDays(thisWeek, 7);
  return { facilityId: null, facilityName: "All Facilities", allFacilities: true, generatedAt: now.toISOString(), timeclockEnabled: false, weekStart, weekEnd: addFacilityCalendarDays(thisWeek, -1), nextWeekStart, scheduleStatus: "Facility-specific", people, payrollStatus: "Facility-specific", payrollRulesConfigured: false };
}
