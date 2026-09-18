import type { GeneratedTaskInput, ObservationTaskStatus, PlanRuleInput } from "@/lib/rounding/types";
import { MS_PER_MINUTE } from "@/lib/rounding/duration-units";

type GenerateArgs = {
  organizationId: string;
  entityId?: string | null;
  facilityId: string;
  residentId: string;
  planId: string;
  planRuleId: string | null;
  watchInstanceId?: string | null;
  shiftAssignmentId?: string | null;
  assignedStaffId?: string | null;
  windowStart: string | Date;
  windowEnd: string | Date;
  rule: PlanRuleInput;
  now?: string | Date;
};

/**
 * The wall-clock time a discrete rule carries, when it carries one.
 *
 * Inlined from `col-discovery-round-cadence.ts`, which is gone: that file
 * resolved a facility by name against a hardcoded list and held the 2026-08-14
 * observation times as literals. This is the only thing in it this generator
 * ever used, and it reads a rule's own schema rather than any cadence.
 */
function extractDiscreteScheduledTime(rule: PlanRuleInput): string | null {
  const value = rule.requiredFieldsSchema?.scheduled_time;
  return typeof value === "string" ? value : null;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function combineDateAndTime(day: Date, hhmm: string): Date {
  const parts = hhmm.split(":");
  const hours = Number.parseInt(parts[0] ?? "0", 10);
  const minutes = Number.parseInt(parts[1] ?? "0", 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    const result = new Date(day);
    result.setHours(0, 0, 0, 0);
    return result;
  }
  const result = new Date(day);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function normalizeDaypartWindow(day: Date, startTime?: string | null, endTime?: string | null) {
  if (!startTime || !endTime) {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  const start = combineDateAndTime(day, startTime);
  const end = combineDateAndTime(day, endTime);

  // An overnight window whose end reads earlier than its start ends the next day.
  if (end.getTime() <= start.getTime()) {
    end.setDate(end.getDate() + 1);
  }

  return { start, end };
}

function sameDay(date: Date) {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}

function pushGeneratedTask(
  tasks: GeneratedTaskInput[],
  args: GenerateArgs,
  dueAt: Date,
) {
  // resident_observation_plan_rules.grace_minutes is NOT NULL, so the rule
  // always carries its own grace. A default here would be a second copy of the
  // column default, which is the literal acceptance 19 exists to forbid; zero
  // is the honest answer if a caller ever omits it.
  const graceEndsAt = new Date(dueAt.getTime() + (args.rule.graceMinutes ?? 0) * MS_PER_MINUTE);

  // Every generated task is written `upcoming`, which is what the two SQL
  // generators do (`public.record_cadence_observation_tasks` and
  // `public.generate_monitoring_order_tasks` both insert `'upcoming'`).
  //
  // This used to derive a band at generation time from constants that stopped
  // governing anything when Part 4 replaced the escalation engine. Deriving it
  // here was also the wrong layer: a generated task moves through the bands
  // afterwards, driven by `public.advance_observation_task_lapse` and
  // `public.record_observation_escalation_rung` from configuration rows, and a
  // status stamped at generation is stale the moment it is written.
  const status: ObservationTaskStatus = "upcoming";

  tasks.push({
    organizationId: args.organizationId,
    entityId: args.entityId ?? null,
    facilityId: args.facilityId,
    residentId: args.residentId,
    planId: args.planId,
    planRuleId: args.planRuleId,
    watchInstanceId: args.watchInstanceId ?? null,
    shiftAssignmentId: args.shiftAssignmentId ?? null,
    assignedStaffId: args.assignedStaffId ?? null,
    scheduledFor: dueAt.toISOString(),
    dueAt: dueAt.toISOString(),
    graceEndsAt: graceEndsAt.toISOString(),
    status: status as ObservationTaskStatus,
    notes: null,
  });
}

function generateDiscreteScheduledTasks(args: GenerateArgs, scheduledTime: string): GeneratedTaskInput[] {
  const windowStart = toDate(args.windowStart);
  const windowEnd = toDate(args.windowEnd);
  if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime()) || windowEnd.getTime() < windowStart.getTime()) {
    return [];
  }

  const tasks: GeneratedTaskInput[] = [];
  const startDay = sameDay(windowStart);
  const endDay = sameDay(windowEnd);
  const dayCursor = new Date(startDay);

  while (dayCursor.getTime() <= endDay.getTime()) {
    const dayOfWeek = dayCursor.getDay();
    const allowedDays = args.rule.daysOfWeek?.length ? args.rule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
    if (!allowedDays.includes(dayOfWeek)) {
      dayCursor.setDate(dayCursor.getDate() + 1);
      continue;
    }

    const dueAt = combineDateAndTime(dayCursor, scheduledTime);
    if (dueAt.getTime() >= windowStart.getTime() && dueAt.getTime() <= windowEnd.getTime()) {
      pushGeneratedTask(tasks, args, dueAt);
    }

    dayCursor.setDate(dayCursor.getDate() + 1);
  }

  return tasks;
}

export function generateObservationTasks(args: GenerateArgs): GeneratedTaskInput[] {
  const scheduledTime = extractDiscreteScheduledTime(args.rule);
  if (scheduledTime && args.rule.intervalType === "daypart" && args.rule.intervalMinutes == null) {
    return generateDiscreteScheduledTasks(args, scheduledTime);
  }

  const windowStart = toDate(args.windowStart);
  const windowEnd = toDate(args.windowEnd);

  if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime()) || windowEnd.getTime() < windowStart.getTime()) {
    return [];
  }

  // A `per_shift` rule with no interval carries no cadence of its own. It used
  // to fall back to an eight hour shift, which is the retired three daypart
  // model; shift length is now facility configuration and belongs to
  // `facility_shift_definitions`, never to a default in code.
  const intervalMinutes = args.rule.intervalMinutes;

  if (!intervalMinutes || intervalMinutes <= 0) {
    return [];
  }

  const tasks: GeneratedTaskInput[] = [];
  const startDay = sameDay(windowStart);
  const endDay = sameDay(windowEnd);
  const dayCursor = new Date(startDay);

  while (dayCursor.getTime() <= endDay.getTime()) {
    const dayOfWeek = dayCursor.getDay();
    const allowedDays = args.rule.daysOfWeek?.length ? args.rule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
    if (!allowedDays.includes(dayOfWeek)) {
      dayCursor.setDate(dayCursor.getDate() + 1);
      continue;
    }

    const daypart = normalizeDaypartWindow(dayCursor, args.rule.daypartStart, args.rule.daypartEnd);
    if (!overlaps(daypart.start, daypart.end, windowStart, windowEnd)) {
      dayCursor.setDate(dayCursor.getDate() + 1);
      continue;
    }

    let cursor = new Date(Math.max(daypart.start.getTime(), windowStart.getTime()));
    cursor.setSeconds(0, 0);

    while (cursor.getTime() <= daypart.end.getTime() && cursor.getTime() <= windowEnd.getTime()) {
      pushGeneratedTask(tasks, args, new Date(cursor));
      cursor = new Date(cursor.getTime() + intervalMinutes * MS_PER_MINUTE);
    }

    dayCursor.setDate(dayCursor.getDate() + 1);
  }

  return tasks;
}
