import { addDays, addMonths, getDay, setHours, setMilliseconds, setMinutes, setSeconds } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

import type { ScheduleFrequency } from "@/lib/reports/pack-ui-metadata";

function parseHm(timeLocal: string): { hour: number; minute: number } {
  const [h, m] = timeLocal.split(":").map((x) => Number(x));
  const hour = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 8;
  const minute = Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0;
  return { hour, minute };
}

/** Next UTC instant matching frequency + weekday + local wall time (preview / initial `next_run_at`). */
export function computeNextRunUtc(params: {
  frequency: ScheduleFrequency;
  weekday: number;
  timeLocal: string;
  timezone: string;
}): Date {
  const tz = params.timezone || "America/New_York";
  const { hour, minute } = parseHm(params.timeLocal);
  const now = new Date();
  const zNow = toZonedTime(now, tz);

  let candidate = setMilliseconds(setSeconds(setMinutes(setHours(zNow, hour), minute), 0), 0);

  if (params.frequency === "daily") {
    if (candidate.getTime() <= zNow.getTime()) candidate = addDays(candidate, 1);
    return fromZonedTime(candidate, tz);
  }

  if (params.frequency === "weekly") {
    const target = params.weekday % 7;
    let daysAhead = (target - getDay(candidate) + 7) % 7;
    if (daysAhead === 0 && candidate.getTime() <= zNow.getTime()) daysAhead = 7;
    candidate = addDays(candidate, daysAhead);
    return fromZonedTime(candidate, tz);
  }

  if (params.frequency === "monthly") {
    if (candidate.getTime() <= zNow.getTime()) candidate = addMonths(candidate, 1);
    return fromZonedTime(candidate, tz);
  }

  if (candidate.getTime() <= zNow.getTime()) candidate = addMonths(candidate, 3);
  return fromZonedTime(candidate, tz);
}

export function recurrenceRuleForFrequency(frequency: ScheduleFrequency): string {
  if (frequency === "daily") return "daily";
  if (frequency === "monthly") return "monthly";
  if (frequency === "quarterly") return "quarterly";
  return "weekly";
}

export function estimatePdfPages(reportCount: number): number {
  return Math.max(1, Math.round(reportCount * 3));
}
