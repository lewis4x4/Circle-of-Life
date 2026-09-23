/**
 * Timeclock computation (COL-352, spec 37 §7). The single source for:
 * workweek boundaries, effective punches (corrections applied), segment
 * pairing, worked and meal minutes, workweek split, overtime, day rows,
 * exceptions and the current status line.
 *
 * Durations are integer minutes from UTC instants. No rounding. Nothing here
 * decides pay; ADP alignment is COL-357.
 */

import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

import type { PunchType } from "@/lib/timeclock/kiosk-contract";

export const WORKWEEK_TZ = "America/New_York";
/** Overtime starts after this many worked minutes in a Monday to Sunday workweek. */
export const OVERTIME_THRESHOLD_MINUTES = 2400;
/** An open in or meal older than this is a missing punch, not a long shift. */
export const STALE_OPEN_MINUTES = 16 * 60;
/** Out to the next in under this is a short turnaround. */
export const SHORT_TURNAROUND_MINUTES = 8 * 60;

export type CorrectionType = "add_punch" | "void_punch" | "change_time" | "acknowledge";
export type CorrectionReason = "missed_punch" | "wrong_punch_type" | "device_outage" | "manager_verified_time" | "duplicate";

export type RawPunch = {
  id: string;
  staff_id: string;
  facility_id?: string;
  punch_type: PunchType;
  punched_at: string;
  device_time?: string | null;
  captured_offline?: boolean;
  flags?: string[] | null;
};

export type RawCorrection = {
  id: string;
  staff_id: string;
  correction_type: CorrectionType;
  target_punch_id: string | null;
  target_correction_id: string | null;
  punch_type: PunchType | null;
  corrected_punched_at: string | null;
  exception_key: string | null;
  reason: CorrectionReason;
  note: string | null;
  corrected_by: string;
  corrected_at: string;
};

export type RawSyncRejection = {
  id: string;
  staff_id: string | null;
  punch_type: string;
  device_time: string | null;
  reason: string;
  created_at: string;
};

/** A floor tablet unlock (COL-690). Only `on_clock = false` rows raise an exception. */
export type RawFloorUnlock = {
  id: string;
  staff_id: string;
  started_at: string;
  on_clock: boolean;
};

export type EffectivePunch = {
  id: string;
  source: "punch" | "correction";
  punchType: PunchType;
  at: Date;
  flags: string[];
  /** True when a change_time correction moved this punch. */
  timeChanged: boolean;
};

export type ExceptionType = "missing_out" | "missing_meal_end" | "clock_skew" | "offline_capture" | "rejected_offline_sync" | "short_turnaround" | "unlock_without_punch";

export type TimesheetException = {
  key: string;
  type: ExceptionType;
  staffId: string;
  anchorId: string;
  at: Date;
  acknowledged: boolean;
};

export type WorkSegment = {
  kind: "work" | "meal";
  start: Date;
  /** Null when still open at `now`. */
  end: Date | null;
};

export type WeekTotals = {
  workweekStart: string;
  workedMinutes: number;
  mealMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
};

export type DayRow = {
  dateIso: string;
  punches: EffectivePunch[];
  workedMinutes: number;
  mealMinutes: number;
  flags: string[];
  exceptions: TimesheetException[];
};

export type StatusNow = { state: "in" | "meal" | "out"; since: Date | null };

export type Timesheet = {
  staffId: string;
  effective: EffectivePunch[];
  segments: WorkSegment[];
  weeks: WeekTotals[];
  days: DayRow[];
  exceptions: TimesheetException[];
  status: StatusNow;
  periodWorkedMinutes: number;
  periodMealMinutes: number;
  periodOvertimeMinutes: number;
};

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

/** Calendar date (yyyy-MM-dd) of an instant in the workweek time zone. */
export function facilityDateIso(at: Date, timeZone: string = WORKWEEK_TZ): string {
  return formatInTimeZone(at, timeZone, "yyyy-MM-dd");
}

/** Midnight of a calendar date in the workweek time zone. */
export function facilityDayStart(dateIso: string, timeZone: string = WORKWEEK_TZ): Date {
  return fromZonedTime(`${dateIso}T00:00:00`, timeZone);
}

/**
 * Monday 00:00 America/New_York of the workweek containing `at`. The only
 * workweek boundary computation in Haven; the Stand Up staffing week is the
 * same Monday.
 */
export function workweekStart(at: Date, timeZone: string = WORKWEEK_TZ): Date {
  const zoned = toZonedTime(at, timeZone);
  const isoDow = zoned.getDay() === 0 ? 7 : zoned.getDay();
  const monday = addDays(zoned, 1 - isoDow);
  const mondayIso = formatInTimeZone(fromZonedTime(monday, timeZone), timeZone, "yyyy-MM-dd");
  return facilityDayStart(mondayIso, timeZone);
}

export function workweekStartIso(at: Date, timeZone: string = WORKWEEK_TZ): string {
  return facilityDateIso(workweekStart(at, timeZone), timeZone);
}

/** Add whole workweeks (7 calendar days) across DST without drifting off midnight. */
export function addWorkweeks(start: Date, count: number, timeZone: string = WORKWEEK_TZ): Date {
  const iso = facilityDateIso(start, timeZone);
  const noon = fromZonedTime(`${iso}T12:00:00`, timeZone);
  const shifted = addDays(noon, 7 * count);
  return facilityDayStart(facilityDateIso(shifted, timeZone), timeZone);
}

/** Every workweek start from the one containing periodStart up to (excluding) periodEnd. */
export function workweeksBetween(periodStart: Date, periodEnd: Date, timeZone: string = WORKWEEK_TZ): Date[] {
  const weeks: Date[] = [];
  let cursor = workweekStart(periodStart, timeZone);
  while (cursor.getTime() < periodEnd.getTime()) {
    weeks.push(cursor);
    cursor = addWorkweeks(cursor, 1, timeZone);
  }
  return weeks;
}

export type PayPeriodSettings = { timeclock_pay_period: "weekly" | "biweekly" | null; timeclock_pay_period_anchor: string | null };

export type PayPeriod = { startIso: string; endIso: string; start: Date; end: Date; source: "pay_period" | "workweek" };

/**
 * Pay period containing `at`. Falls back to the workweek when the organization
 * setting is null (the export stays disabled in that case). `end` is exclusive.
 */
export function payPeriodContaining(at: Date, settings: PayPeriodSettings | null, timeZone: string = WORKWEEK_TZ): PayPeriod {
  const week = workweekStart(at, timeZone);
  if (!settings?.timeclock_pay_period || !settings.timeclock_pay_period_anchor) {
    const end = addWorkweeks(week, 1, timeZone);
    return { start: week, end, startIso: facilityDateIso(week, timeZone), endIso: facilityDateIso(end, timeZone), source: "workweek" };
  }
  if (settings.timeclock_pay_period === "weekly") {
    const end = addWorkweeks(week, 1, timeZone);
    return { start: week, end, startIso: facilityDateIso(week, timeZone), endIso: facilityDateIso(end, timeZone), source: "pay_period" };
  }
  const anchor = workweekStart(facilityDayStart(settings.timeclock_pay_period_anchor, timeZone), timeZone);
  const weeksFromAnchor = Math.floor(Math.round((week.getTime() - anchor.getTime()) / (7 * 24 * 60 * 60 * 1000)) / 2) * 2;
  const start = addWorkweeks(anchor, weeksFromAnchor, timeZone);
  const end = addWorkweeks(start, 2, timeZone);
  return { start, end, startIso: facilityDateIso(start, timeZone), endIso: facilityDateIso(end, timeZone), source: "pay_period" };
}

export function shiftPayPeriod(period: PayPeriod, settings: PayPeriodSettings | null, direction: -1 | 1, timeZone: string = WORKWEEK_TZ): PayPeriod {
  const weeks = settings?.timeclock_pay_period === "biweekly" ? 2 : 1;
  const start = addWorkweeks(period.start, direction * weeks, timeZone);
  return payPeriodContaining(start, settings, timeZone);
}

// ---------------------------------------------------------------------------
// Effective punches
// ---------------------------------------------------------------------------

function toDate(value: string): Date {
  return new Date(value);
}

/** Voids removed, time changes applied (latest wins), added punches included. Sorted by time. */
export function effectivePunches(punches: RawPunch[], corrections: RawCorrection[]): EffectivePunch[] {
  const voidedPunches = new Set<string>();
  const voidedCorrections = new Set<string>();
  const changedPunches = new Map<string, { at: string; correctedAt: string }>();
  const changedCorrections = new Map<string, { at: string; correctedAt: string }>();
  for (const c of corrections) {
    if (c.correction_type === "void_punch") {
      if (c.target_punch_id) voidedPunches.add(c.target_punch_id);
      if (c.target_correction_id) voidedCorrections.add(c.target_correction_id);
    } else if (c.correction_type === "change_time" && c.corrected_punched_at) {
      const target = c.target_punch_id ? changedPunches : changedCorrections;
      const id = c.target_punch_id ?? c.target_correction_id;
      if (!id) continue;
      const existing = target.get(id);
      if (!existing || existing.correctedAt < c.corrected_at) target.set(id, { at: c.corrected_punched_at, correctedAt: c.corrected_at });
    }
  }
  const result: EffectivePunch[] = [];
  for (const p of punches) {
    if (voidedPunches.has(p.id)) continue;
    const change = changedPunches.get(p.id);
    result.push({ id: p.id, source: "punch", punchType: p.punch_type, at: toDate(change?.at ?? p.punched_at), flags: p.flags ?? [], timeChanged: Boolean(change) });
  }
  for (const c of corrections) {
    if (c.correction_type !== "add_punch" || !c.punch_type || !c.corrected_punched_at) continue;
    if (voidedCorrections.has(c.id)) continue;
    const change = changedCorrections.get(c.id);
    result.push({ id: c.id, source: "correction", punchType: c.punch_type, at: toDate(change?.at ?? c.corrected_punched_at), flags: [], timeChanged: Boolean(change) });
  }
  result.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.source === b.source ? 0 : a.source === "punch" ? -1 : 1));
  return result;
}

// ---------------------------------------------------------------------------
// Segments and exceptions
// ---------------------------------------------------------------------------

type Walk = { segments: WorkSegment[]; exceptions: Omit<TimesheetException, "acknowledged" | "staffId">[]; status: StatusNow };

function walk(effective: EffectivePunch[], now: Date): Walk {
  const segments: WorkSegment[] = [];
  const exceptions: Walk["exceptions"] = [];
  let shiftOpen = false;
  let shiftIn: EffectivePunch | null = null;
  let workStart: Date | null = null;
  let mealStart: EffectivePunch | null = null;
  let lastOut: EffectivePunch | null = null;
  let state: StatusNow = { state: "out", since: null };

  const closeMeal = (end: Date) => {
    if (mealStart) {
      segments.push({ kind: "meal", start: mealStart.at, end });
      mealStart = null;
    }
  };

  for (const p of effective) {
    if (p.at.getTime() > now.getTime()) break;
    switch (p.punchType) {
      case "in": {
        if (shiftOpen && shiftIn) {
          // A new in without an out: the previous shift is unclosed and counts nothing.
          exceptions.push({ key: `missing_out:${shiftIn.id}`, type: "missing_out", anchorId: shiftIn.id, at: shiftIn.at });
          if (mealStart) exceptions.push({ key: `missing_meal_end:${mealStart.id}`, type: "missing_meal_end", anchorId: mealStart.id, at: mealStart.at });
          mealStart = null;
        }
        if (lastOut && minutesBetween(lastOut.at, p.at) < SHORT_TURNAROUND_MINUTES) {
          exceptions.push({ key: `short_turnaround:${p.id}`, type: "short_turnaround", anchorId: p.id, at: p.at });
        }
        shiftOpen = true;
        shiftIn = p;
        workStart = p.at;
        state = { state: "in", since: p.at };
        break;
      }
      case "meal_start": {
        if (!shiftOpen) break; // stray, ignored
        if (workStart) {
          segments.push({ kind: "work", start: workStart, end: p.at });
          workStart = null;
        }
        if (mealStart) exceptions.push({ key: `missing_meal_end:${mealStart.id}`, type: "missing_meal_end", anchorId: mealStart.id, at: mealStart.at });
        mealStart = p;
        state = { state: "meal", since: p.at };
        break;
      }
      case "meal_end": {
        if (!shiftOpen) break;
        // Only a meal that was actually open may reset the work start. Overwriting it
        // on a stray meal_end (which a manager can add as a correction, since the
        // correction shape check does not validate sequence) would erase every minute
        // worked since the last in, with nothing on the timesheet to show for it.
        if (!mealStart) break;
        closeMeal(p.at);
        workStart = p.at;
        state = { state: "in", since: shiftIn?.at ?? p.at };
        break;
      }
      case "out": {
        if (!shiftOpen) break;
        if (mealStart) {
          exceptions.push({ key: `missing_meal_end:${mealStart.id}`, type: "missing_meal_end", anchorId: mealStart.id, at: mealStart.at });
          closeMeal(p.at);
        }
        if (workStart) {
          segments.push({ kind: "work", start: workStart, end: p.at });
          workStart = null;
        }
        if (shiftIn && minutesBetween(shiftIn.at, p.at) > STALE_OPEN_MINUTES) {
          exceptions.push({ key: `missing_out:${shiftIn.id}`, type: "missing_out", anchorId: shiftIn.id, at: shiftIn.at });
        }
        shiftOpen = false;
        shiftIn = null;
        lastOut = p;
        state = { state: "out", since: p.at };
        break;
      }
    }
  }

  if (shiftOpen && shiftIn) {
    const stale = minutesBetween(shiftIn.at, now) > STALE_OPEN_MINUTES;
    if (mealStart) {
      const mealPunch: EffectivePunch = mealStart;
      if (minutesBetween(mealPunch.at, now) > STALE_OPEN_MINUTES) {
        exceptions.push({ key: `missing_meal_end:${mealPunch.id}`, type: "missing_meal_end", anchorId: mealPunch.id, at: mealPunch.at });
      } else {
        segments.push({ kind: "meal", start: mealPunch.at, end: null });
      }
    }
    if (stale) {
      exceptions.push({ key: `missing_out:${shiftIn.id}`, type: "missing_out", anchorId: shiftIn.id, at: shiftIn.at });
      state = { state: "out", since: null };
    } else if (workStart) {
      segments.push({ kind: "work", start: workStart, end: null });
    }
  }

  return { segments, exceptions, status: state };
}

/** Minutes of `segment` that fall inside [from, to), using whole-minute splitting that preserves totals. */
export function segmentMinutesWithin(segment: WorkSegment, from: Date, to: Date, now: Date): number {
  const end = segment.end ?? now;
  const total = minutesBetween(segment.start, end);
  if (total === 0) return 0;
  const before = segment.start.getTime() < from.getTime() ? Math.min(total, minutesBetween(segment.start, from)) : 0;
  const untilTo = end.getTime() > to.getTime() ? Math.min(total, minutesBetween(segment.start, to)) : total;
  return Math.max(0, untilTo - before);
}

// ---------------------------------------------------------------------------
// Timesheet
// ---------------------------------------------------------------------------

export type ComputeTimesheetInput = {
  staffId: string;
  punches: RawPunch[];
  corrections: RawCorrection[];
  rejections?: RawSyncRejection[];
  floorUnlocks?: RawFloorUnlock[];
  /** Inclusive start of the period. */
  periodStart: Date;
  /** Exclusive end of the period. */
  periodEnd: Date;
  now: Date;
  timeZone?: string;
};

export function computeTimesheet(input: ComputeTimesheetInput): Timesheet {
  const timeZone = input.timeZone ?? WORKWEEK_TZ;
  const own = (row: { staff_id: string | null }) => row.staff_id === input.staffId;
  const punches = input.punches.filter(own);
  const corrections = input.corrections.filter(own);
  const effective = effectivePunches(punches, corrections);
  const { segments, exceptions: walked, status } = walk(effective, input.now);

  const acknowledgedKeys = new Set(corrections.filter((c) => c.correction_type === "acknowledge" && c.exception_key).map((c) => c.exception_key as string));

  const exceptions: TimesheetException[] = walked.map((e) => ({ ...e, staffId: input.staffId, acknowledged: acknowledgedKeys.has(e.key) }));
  for (const p of effective) {
    for (const flag of p.flags) {
      if (flag === "clock_skew" || flag === "offline_capture") {
        exceptions.push({ key: `${flag}:${p.id}`, type: flag, staffId: input.staffId, anchorId: p.id, at: p.at, acknowledged: acknowledgedKeys.has(`${flag}:${p.id}`) });
      }
    }
  }
  for (const r of input.rejections ?? []) {
    if (r.staff_id !== input.staffId) continue;
    exceptions.push({ key: `rejected_offline_sync:${r.id}`, type: "rejected_offline_sync", staffId: input.staffId, anchorId: r.id, at: toDate(r.device_time ?? r.created_at), acknowledged: acknowledgedKeys.has(`rejected_offline_sync:${r.id}`) });
  }
  // Someone used a floor tablet by employee number without being clocked in.
  for (const u of input.floorUnlocks ?? []) {
    if (u.staff_id !== input.staffId || u.on_clock) continue;
    exceptions.push({ key: `unlock_without_punch:${u.id}`, type: "unlock_without_punch", staffId: input.staffId, anchorId: u.id, at: toDate(u.started_at), acknowledged: acknowledgedKeys.has(`unlock_without_punch:${u.id}`) });
  }
  const inPeriod = (at: Date) => at.getTime() >= input.periodStart.getTime() && at.getTime() < input.periodEnd.getTime();
  const periodExceptions = exceptions.filter((e) => inPeriod(e.at)).sort((a, b) => a.at.getTime() - b.at.getTime());

  const weeks: WeekTotals[] = workweeksBetween(input.periodStart, input.periodEnd, timeZone).map((weekStart) => {
    const weekEnd = addWorkweeks(weekStart, 1, timeZone);
    const from = new Date(Math.max(weekStart.getTime(), input.periodStart.getTime()));
    const to = new Date(Math.min(weekEnd.getTime(), input.periodEnd.getTime()));
    let worked = 0;
    let meal = 0;
    for (const segment of segments) {
      const minutes = segmentMinutesWithin(segment, from, to, input.now);
      if (segment.kind === "work") worked += minutes;
      else meal += minutes;
    }
    const overtime = Math.max(0, worked - OVERTIME_THRESHOLD_MINUTES);
    return { workweekStart: facilityDateIso(weekStart, timeZone), workedMinutes: worked, mealMinutes: meal, regularMinutes: worked - overtime, overtimeMinutes: overtime };
  });

  const dayMap = new Map<string, DayRow>();
  const dayFor = (iso: string): DayRow => {
    let row = dayMap.get(iso);
    if (!row) {
      row = { dateIso: iso, punches: [], workedMinutes: 0, mealMinutes: 0, flags: [], exceptions: [] };
      dayMap.set(iso, row);
    }
    return row;
  };
  for (const p of effective) {
    if (!inPeriod(p.at)) continue;
    const row = dayFor(facilityDateIso(p.at, timeZone));
    row.punches.push(p);
    for (const flag of p.flags) if (!row.flags.includes(flag)) row.flags.push(flag);
  }
  for (const segment of segments) {
    const minutes = segmentMinutesWithin(segment, input.periodStart, input.periodEnd, input.now);
    if (minutes === 0) continue;
    // Attribute to the segment's start day, clamped into the period: a night shift that
    // began before periodStart lands on the period's first day rather than vanishing.
    const attributedAt = segment.start.getTime() < input.periodStart.getTime() ? input.periodStart : segment.start;
    const row = dayFor(facilityDateIso(attributedAt, timeZone));
    if (segment.kind === "work") row.workedMinutes += minutes;
    else row.mealMinutes += minutes;
  }
  for (const e of periodExceptions) dayFor(facilityDateIso(e.at, timeZone)).exceptions.push(e);
  const days = [...dayMap.values()].sort((a, b) => (a.dateIso < b.dateIso ? -1 : 1));

  return {
    staffId: input.staffId,
    effective,
    segments,
    weeks,
    days,
    exceptions: periodExceptions,
    status,
    periodWorkedMinutes: weeks.reduce((sum, w) => sum + w.workedMinutes, 0),
    periodMealMinutes: weeks.reduce((sum, w) => sum + w.mealMinutes, 0),
    periodOvertimeMinutes: weeks.reduce((sum, w) => sum + w.overtimeMinutes, 0),
  };
}

/** Current status for the tier 1 table, from all effective punches. */
export function statusNow(punches: RawPunch[], corrections: RawCorrection[], staffId: string, now: Date): StatusNow {
  const effective = effectivePunches(
    punches.filter((p) => p.staff_id === staffId),
    corrections.filter((c) => c.staff_id === staffId),
  );
  return walk(effective, now).status;
}

/** Whole period summary for a set of timesheets, for the export gate. */
export function unresolvedExceptionCount(timesheets: Timesheet[]): number {
  return timesheets.reduce((sum, t) => sum + t.exceptions.filter((e) => !e.acknowledged).length, 0);
}
