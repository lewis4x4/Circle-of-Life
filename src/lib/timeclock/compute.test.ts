import { fromZonedTime } from "date-fns-tz";
import { describe, expect, it } from "vitest";

import {
  addWorkweeks,
  computeTimesheet,
  effectivePunches,
  facilityDayStart,
  payPeriodContaining,
  statusNow,
  workweekStart,
  workweekStartIso,
  workweeksBetween,
  type RawCorrection,
  type RawPunch,
  WORKWEEK_TZ,
} from "./compute";
import { EXCEPTION_LABELS } from "./display-copy";

const STAFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Eastern wall time to UTC instant. */
function et(local: string): Date {
  const [date, time] = local.split(" ");
  return fromZonedTime(`${date}T${time}:00`, WORKWEEK_TZ);
}

let counter = 0;
function punch(local: string, punch_type: RawPunch["punch_type"], extra: Partial<RawPunch> = {}): RawPunch {
  counter += 1;
  return { id: `p${counter}`, staff_id: STAFF, punch_type, punched_at: et(local).toISOString(), flags: [], ...extra };
}
function correction(partial: Partial<RawCorrection> & Pick<RawCorrection, "correction_type" | "reason">): RawCorrection {
  counter += 1;
  return {
    id: `c${counter}`,
    staff_id: STAFF,
    target_punch_id: null,
    target_correction_id: null,
    punch_type: null,
    corrected_punched_at: null,
    exception_key: null,
    note: null,
    corrected_by: MANAGER,
    corrected_at: new Date("2026-11-10T12:00:00Z").toISOString(),
    ...partial,
  };
}

describe("workweek boundaries (Monday 00:00 America/New_York)", () => {
  it("returns Monday midnight Eastern, expressed in UTC, on both sides of the DST change", () => {
    // Week of 2026-10-26 is EDT (UTC-4); week of 2026-11-02 is EST (UTC-5); DST ends 2026-11-01.
    expect(workweekStart(new Date("2026-10-28T12:00:00Z")).toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(workweekStart(new Date("2026-11-04T12:00:00Z")).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    // Sunday 11:30 p.m. Eastern still belongs to the week that started the previous Monday.
    expect(workweekStartIso(et("2026-11-08 23:30"))).toBe("2026-11-02");
    // Monday 00:30 Eastern starts the new week.
    expect(workweekStartIso(et("2026-11-09 00:30"))).toBe("2026-11-09");
  });

  it("adds workweeks across the DST change without drifting off midnight", () => {
    const week = workweekStart(new Date("2026-10-28T12:00:00Z"));
    expect(addWorkweeks(week, 1).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(workweeksBetween(week, addWorkweeks(week, 2)).map((d) => workweekStartIso(d))).toEqual(["2026-10-26", "2026-11-02"]);
  });

  it("derives the pay period from the organization setting and falls back to the workweek", () => {
    const at = new Date("2026-11-04T12:00:00Z");
    expect(payPeriodContaining(at, null)).toMatchObject({ startIso: "2026-11-02", endIso: "2026-11-09", source: "workweek" });
    expect(payPeriodContaining(at, { timeclock_pay_period: "weekly", timeclock_pay_period_anchor: "2026-01-05" })).toMatchObject({ startIso: "2026-11-02", endIso: "2026-11-09", source: "pay_period" });
    const biweekly = { timeclock_pay_period: "biweekly" as const, timeclock_pay_period_anchor: "2026-10-19" };
    expect(payPeriodContaining(at, biweekly)).toMatchObject({ startIso: "2026-11-02", endIso: "2026-11-16" });
    expect(payPeriodContaining(new Date("2026-10-28T12:00:00Z"), biweekly)).toMatchObject({ startIso: "2026-10-19", endIso: "2026-11-02" });
  });
});

describe("computeTimesheet", () => {
  const dstWeekStart = facilityDayStart("2026-11-02");
  const dstWeekEnd = facilityDayStart("2026-11-09");

  it("DST week: five 8 hour shifts with unpaid meals total 2,400 minutes and no overtime", () => {
    const punches: RawPunch[] = [];
    for (const day of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]) {
      punches.push(punch(`${day} 06:58`, "in"), punch(`${day} 11:00`, "meal_start"), punch(`${day} 11:30`, "meal_end"), punch(`${day} 15:28`, "out"));
    }
    const sheet = computeTimesheet({ staffId: STAFF, punches, corrections: [], periodStart: dstWeekStart, periodEnd: dstWeekEnd, now: new Date("2026-11-10T12:00:00Z") });
    expect(sheet.weeks).toEqual([{ workweekStart: "2026-11-02", workedMinutes: 2400, mealMinutes: 150, regularMinutes: 2400, overtimeMinutes: 0 }]);
    expect(sheet.days.map((d) => [d.dateIso, d.workedMinutes, d.mealMinutes])).toEqual([
      ["2026-11-02", 480, 30],
      ["2026-11-03", 480, 30],
      ["2026-11-04", 480, 30],
      ["2026-11-05", 480, 30],
      ["2026-11-06", 480, 30],
    ]);
    expect(sheet.exceptions).toEqual([]);
  });

  it("overtime starts at minute 2,401 in the workweek, with no rounding", () => {
    const punches: RawPunch[] = [];
    for (const day of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]) {
      punches.push(punch(`${day} 07:00`, "in"), punch(`${day} 17:00`, "out"));
    }
    punches.push(punch("2026-11-06 07:00", "in"), punch("2026-11-06 07:01", "out"));
    const sheet = computeTimesheet({ staffId: STAFF, punches, corrections: [], periodStart: dstWeekStart, periodEnd: dstWeekEnd, now: new Date("2026-11-10T12:00:00Z") });
    expect(sheet.weeks[0]).toMatchObject({ workedMinutes: 2401, regularMinutes: 2400, overtimeMinutes: 1 });
  });

  it("a shift crossing midnight stays whole inside its workweek and is attributed to its start day", () => {
    const punches = [punch("2026-11-03 19:00", "in"), punch("2026-11-04 07:02", "out")];
    const sheet = computeTimesheet({ staffId: STAFF, punches, corrections: [], periodStart: dstWeekStart, periodEnd: dstWeekEnd, now: new Date("2026-11-10T12:00:00Z") });
    expect(sheet.weeks[0]!.workedMinutes).toBe(722);
    expect(sheet.days).toHaveLength(2);
    expect(sheet.days[0]).toMatchObject({ dateIso: "2026-11-03", workedMinutes: 722 });
    expect(sheet.days[1]).toMatchObject({ dateIso: "2026-11-04", workedMinutes: 0 });
  });

  it("a Sunday into Monday shift splits at the workweek boundary, including the DST night", () => {
    // Sunday 2026-11-01 (DST ended at 02:00 that morning) 19:00 EST to Monday 2026-11-02 07:00 EST is 12 hours.
    const punches = [punch("2026-11-01 19:00", "in"), punch("2026-11-02 07:00", "out")];
    const periodStart = facilityDayStart("2026-10-26");
    const sheet = computeTimesheet({ staffId: STAFF, punches, corrections: [], periodStart, periodEnd: dstWeekEnd, now: new Date("2026-11-10T12:00:00Z") });
    const total = sheet.weeks.reduce((s, w) => s + w.workedMinutes, 0);
    expect(total).toBe(12 * 60);
    expect(sheet.weeks.map((w) => [w.workweekStart, w.workedMinutes])).toEqual([
      ["2026-10-26", 5 * 60],
      ["2026-11-02", 7 * 60],
    ]);
    // And a shift that spans the 02:00 fallback itself is measured in real elapsed time.
    const acrossDst = [punch("2026-10-31 22:00", "in"), punch("2026-11-01 06:00", "out")];
    const dst = computeTimesheet({ staffId: STAFF, punches: acrossDst, corrections: [], periodStart, periodEnd: dstWeekEnd, now: new Date("2026-11-10T12:00:00Z") });
    expect(dst.weeks[0]!.workedMinutes).toBe(9 * 60);
  });

  it("applies a void plus an added punch, and change_time moves a punch", () => {
    const dup = punch("2026-11-03 07:05", "in");
    const punches = [punch("2026-11-03 07:00", "in"), dup, punch("2026-11-03 15:00", "out"), punch("2026-11-04 07:00", "in")];
    const corrections = [
      correction({ correction_type: "void_punch", reason: "duplicate", target_punch_id: dup.id }),
      correction({ correction_type: "add_punch", reason: "missed_punch", punch_type: "out", corrected_punched_at: et("2026-11-04 15:00").toISOString() }),
      correction({ correction_type: "change_time", reason: "manager_verified_time", target_punch_id: punches[0]!.id, corrected_punched_at: et("2026-11-03 06:30").toISOString() }),
    ];
    const sheet = computeTimesheet({ staffId: STAFF, punches, corrections, periodStart: dstWeekStart, periodEnd: dstWeekEnd, now: new Date("2026-11-10T12:00:00Z") });
    expect(effectivePunches(punches, corrections).map((p) => p.punchType)).toEqual(["in", "out", "in", "out"]);
    expect(sheet.weeks[0]!.workedMinutes).toBe(510 + 480);
    expect(sheet.exceptions).toEqual([]);
    expect(sheet.effective[0]).toMatchObject({ timeChanged: true });
  });

  it("raises each exception type and honours acknowledgments", () => {
    const openIn = punch("2026-11-02 07:00", "in", { flags: ["clock_skew"] });
    const mealNoEnd = punch("2026-11-03 07:00", "in");
    const meal = punch("2026-11-03 11:00", "meal_start");
    const outAfterMeal = punch("2026-11-03 15:00", "out");
    const shortIn = punch("2026-11-03 20:00", "in", { flags: ["offline_capture"], captured_offline: true });
    const shortOut = punch("2026-11-04 04:00", "out");
    const punches = [openIn, mealNoEnd, meal, outAfterMeal, shortIn, shortOut];
    const corrections = [correction({ correction_type: "acknowledge", reason: "manager_verified_time", exception_key: `clock_skew:${openIn.id}` })];
    const rejections = [{ id: "r1", staff_id: STAFF, punch_type: "in", device_time: et("2026-11-05 07:00").toISOString(), reason: "pin_unavailable", created_at: et("2026-11-05 09:00").toISOString() }];
    const sheet = computeTimesheet({ staffId: STAFF, punches, corrections, rejections, periodStart: dstWeekStart, periodEnd: dstWeekEnd, now: new Date("2026-11-10T12:00:00Z") });
    const byType = Object.fromEntries(sheet.exceptions.map((e) => [e.type, e]));
    expect(byType.missing_out).toMatchObject({ anchorId: openIn.id, acknowledged: false });
    expect(byType.missing_meal_end).toMatchObject({ anchorId: meal.id });
    expect(byType.short_turnaround).toMatchObject({ anchorId: shortIn.id });
    expect(byType.clock_skew).toMatchObject({ anchorId: openIn.id, acknowledged: true });
    expect(byType.offline_capture).toMatchObject({ anchorId: shortIn.id, acknowledged: false });
    expect(byType.rejected_offline_sync).toMatchObject({ anchorId: "r1" });
    expect(sheet.exceptions.filter((e) => !e.acknowledged)).toHaveLength(5);
    // The unclosed 11-02 shift counts nothing; 11-03 counts 07:00 to 11:00 (meal never ended) and 20:00 to 04:00.
    expect(sheet.weeks[0]!.workedMinutes).toBe(240 + 480);
  });

  it("raises unlock_without_punch for an off-clock floor unlock only, acknowledgeable (COL-690)", () => {
    const punches = [punch("2026-11-03 07:00", "in"), punch("2026-11-03 15:00", "out")];
    const floorUnlocks = [
      { id: "u-off", staff_id: STAFF, started_at: et("2026-11-04 08:00").toISOString(), on_clock: false },
      { id: "u-on", staff_id: STAFF, started_at: et("2026-11-03 08:00").toISOString(), on_clock: true },
      { id: "u-other", staff_id: MANAGER, started_at: et("2026-11-04 09:00").toISOString(), on_clock: false },
      { id: "u-outside", staff_id: STAFF, started_at: et("2026-11-20 09:00").toISOString(), on_clock: false },
    ];
    const input = { staffId: STAFF, punches, floorUnlocks, periodStart: dstWeekStart, periodEnd: dstWeekEnd, now: new Date("2026-11-10T12:00:00Z") };
    const sheet = computeTimesheet({ ...input, corrections: [] });
    expect(sheet.exceptions).toEqual([
      expect.objectContaining({ key: "unlock_without_punch:u-off", type: "unlock_without_punch", anchorId: "u-off", acknowledged: false }),
    ]);
    expect(sheet.days.find((d) => d.dateIso === "2026-11-04")?.exceptions.map((e) => e.type)).toEqual(["unlock_without_punch"]);
    // It records a use, not time: worked minutes are the punches' alone.
    expect(sheet.weeks[0]!.workedMinutes).toBe(480);

    const acknowledged = computeTimesheet({
      ...input,
      corrections: [correction({ correction_type: "acknowledge", reason: "manager_verified_time", exception_key: "unlock_without_punch:u-off" })],
    });
    expect(acknowledged.exceptions).toEqual([expect.objectContaining({ type: "unlock_without_punch", acknowledged: true })]);
    expect(EXCEPTION_LABELS.unlock_without_punch).toBe("Used a floor tablet without clocking in");
  });

  it("a stray meal_end does not erase the hour already worked (COL-352 review S4)", () => {
    // A manager can add a meal_end as a correction; the shape check does not validate sequence.
    const punches = [punch("2026-11-03 08:00", "in"), punch("2026-11-03 09:00", "meal_end"), punch("2026-11-03 17:00", "out")];
    const sheet = computeTimesheet({ staffId: STAFF, punches, corrections: [], periodStart: dstWeekStart, periodEnd: dstWeekEnd, now: new Date("2026-11-10T12:00:00Z") });
    expect(sheet.weeks[0]!.workedMinutes).toBe(9 * 60);
    expect(sheet.periodMealMinutes).toBe(0);
  });

  it("a shift that began before the period still lands on a day row, so days sum to the period total (COL-352 review S3)", () => {
    // Sunday 23:00 into Monday 07:00, with the period starting that Monday.
    const punches = [punch("2026-11-01 23:00", "in"), punch("2026-11-02 07:00", "out")];
    const sheet = computeTimesheet({ staffId: STAFF, punches, corrections: [], periodStart: dstWeekStart, periodEnd: dstWeekEnd, now: new Date("2026-11-10T12:00:00Z") });
    expect(sheet.periodWorkedMinutes).toBe(7 * 60);
    expect(sheet.days.reduce((sum, d) => sum + d.workedMinutes, 0)).toBe(sheet.periodWorkedMinutes);
    expect(sheet.days[0]).toMatchObject({ dateIso: "2026-11-02", workedMinutes: 420 });
  });

  it("voiding a flagged punch clears its exception, and changing its time moves it (COL-352 review M7)", () => {
    const offline = punch("2026-11-03 07:00", "in", { flags: ["offline_capture"] });
    const punches = [offline, punch("2026-11-03 15:00", "out")];
    const open = computeTimesheet({ staffId: STAFF, punches, corrections: [], periodStart: dstWeekStart, periodEnd: dstWeekEnd, now: new Date("2026-11-10T12:00:00Z") });
    expect(open.exceptions.filter((e) => !e.acknowledged)).toHaveLength(1);

    const voided = computeTimesheet({
      staffId: STAFF,
      punches,
      corrections: [correction({ correction_type: "void_punch", reason: "duplicate", target_punch_id: offline.id })],
      periodStart: dstWeekStart,
      periodEnd: dstWeekEnd,
      now: new Date("2026-11-10T12:00:00Z"),
    });
    expect(voided.exceptions.filter((e) => e.type === "offline_capture")).toHaveLength(0);

    const moved = computeTimesheet({
      staffId: STAFF,
      punches,
      corrections: [correction({ correction_type: "change_time", reason: "manager_verified_time", target_punch_id: offline.id, corrected_punched_at: et("2026-11-03 06:30").toISOString() })],
      periodStart: dstWeekStart,
      periodEnd: dstWeekEnd,
      now: new Date("2026-11-10T12:00:00Z"),
    });
    expect(moved.exceptions.find((e) => e.type === "offline_capture")!.at.toISOString()).toBe(et("2026-11-03 06:30").toISOString());
  });

  it("reports the current status line from the last effective punch", () => {
    const now = et("2026-11-03 10:00");
    const punches = [punch("2026-11-03 06:58", "in")];
    expect(statusNow(punches, [], STAFF, now)).toEqual({ state: "in", since: et("2026-11-03 06:58") });
    punches.push(punch("2026-11-03 09:00", "meal_start"));
    expect(statusNow(punches, [], STAFF, now).state).toBe("meal");
    punches.push(punch("2026-11-03 09:30", "meal_end"), punch("2026-11-03 09:45", "out"));
    expect(statusNow(punches, [], STAFF, now).state).toBe("out");
    // An in older than 16 hours is not "still in".
    expect(statusNow([punch("2026-11-01 06:00", "in")], [], STAFF, now).state).toBe("out");
  });
});
