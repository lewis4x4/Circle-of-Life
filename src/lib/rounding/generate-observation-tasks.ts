import type { GeneratedTaskInput, ObservationTaskStatus, PlanRuleInput } from "@/lib/rounding/types";
import { calculateObservationTaskStatus } from "@/lib/rounding/update-task-status";

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

  // Overnight windows, e.g. 20:00 -> 06:00.
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

export function generateObservationTasks(args: GenerateArgs): GeneratedTaskInput[] {
  const windowStart = toDate(args.windowStart);
  const windowEnd = toDate(args.windowEnd);

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

    while (cursor.getTime() <= daypart.end.getTime() && cursor.getTime() <= windowEnd.getTime()) {
      const dueAt = new Date(cursor);
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

      cursor = new Date(cursor.getTime() + intervalMinutes * 60 * 1000);
    }

    dayCursor.setDate(dayCursor.getDate() + 1);
  }

  return tasks;
}
