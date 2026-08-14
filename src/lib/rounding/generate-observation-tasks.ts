import { formatInTimeZone, toDate as zonedToDate } from "date-fns-tz";

import type { GeneratedTaskInput, ObservationTaskStatus, PlanRuleInput } from "@/lib/rounding/types";
import { extractDiscreteScheduledTime } from "@/lib/rounding/col-discovery-round-cadence";
import { calculateObservationTaskStatus } from "@/lib/rounding/update-task-status";

const OPERATOR_TZ = "America/New_York";

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

function coerceToDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function combineDateAndTime(day: Date, hhmm: string): Date {
  const parts = hhmm.split(":");
  const hours = Number.parseInt(parts[0] ?? "0", 10);
  const minutes = Number.parseInt(parts[1] ?? "0", 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    const ymd = formatInTimeZone(day, OPERATOR_TZ, "yyyy-MM-dd");
    return zonedToDate(`${ymd}T00:00:00`, { timeZone: OPERATOR_TZ });
  }
  const ymd = formatInTimeZone(day, OPERATOR_TZ, "yyyy-MM-dd");
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return zonedToDate(`${ymd}T${hh}:${mm}:00`, { timeZone: OPERATOR_TZ });
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

  // Overnight windows, e.g. 20:00 -> 06:00.
  if (end.getTime() <= start.getTime()) {
    end.setDate(end.getDate() + 1);
  }

  return { start, end };
}

function sameDay(date: Date) {
  const ymd = formatInTimeZone(date, OPERATOR_TZ, "yyyy-MM-dd");
  return zonedToDate(`${ymd}T00:00:00`, { timeZone: OPERATOR_TZ });
}

function isOvernightDaypart(startTime?: string | null, endTime?: string | null): boolean {
  if (!startTime || !endTime) return false;
  const startParts = startTime.split(":").map(Number);
  const endParts = endTime.split(":").map(Number);
  const startMinutes = (startParts[0] ?? 0) * 60 + (startParts[1] ?? 0);
  const endMinutes = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0);
  return endMinutes <= startMinutes;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}

function pushGeneratedTask(
  tasks: GeneratedTaskInput[],
  args: GenerateArgs,
  dueAt: Date,
) {
  const graceEndsAt = new Date(dueAt.getTime() + (args.rule.graceMinutes ?? 15) * 60 * 1000);
  const status = calculateObservationTaskStatus({
    dueAt,
    graceEndsAt,
    now: args.now,
  });

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
  const windowStart = coerceToDate(args.windowStart);
  const windowEnd = coerceToDate(args.windowEnd);
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

  const windowStart = coerceToDate(args.windowStart);
  const windowEnd = coerceToDate(args.windowEnd);

  if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime()) || windowEnd.getTime() < windowStart.getTime()) {
    return [];
  }

  const intervalMinutes = args.rule.intervalMinutes ?? (args.rule.intervalType === "per_shift" ? 8 * 60 : null);

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

    const overnight = isOvernightDaypart(args.rule.daypartStart, args.rule.daypartEnd);
    const endInclusive = !overnight;

    while (
      (endInclusive ? cursor.getTime() <= daypart.end.getTime() : cursor.getTime() < daypart.end.getTime()) &&
      cursor.getTime() <= windowEnd.getTime()
    ) {
      pushGeneratedTask(tasks, args, new Date(cursor));
      cursor = new Date(cursor.getTime() + intervalMinutes * 60 * 1000);
    }

    dayCursor.setDate(dayCursor.getDate() + 1);
  }

  return tasks;
}
