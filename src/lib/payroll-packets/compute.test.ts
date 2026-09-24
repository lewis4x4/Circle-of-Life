import { describe, expect, it } from "vitest";
import { buildPayrollSnapshot } from "./compute";
import type { PacketInput, PayrollPolicy, PayrollSource } from "./types";
import type { RawPunch } from "@/lib/timeclock/compute";

const policy: PayrollPolicy = { employerName: "Test employer", payFrequency: "weekly", anchorDate: "2026-09-21", workweekDay: 1, workweekTime: "00:00", timeZone: "America/New_York", overtimeThresholdMinutes: 2400, overtimeFacilityIds: ["a"], calculationMode: "automatic", mealPolicy: "punched_unpaid", roundingMinutes: 0, salaryTreatment: "hours", approvalRole: "central", defaultMethod: "phone", policyNote: "Training reclassifies regular hours; leave excludes overtime credit." };
const entry: PacketInput = { staffId: "employee", payrollId: "001", payBasis: "hourly", department: "operations", regularMinutes: null, overtimeMinutes: null, holidayMinutes: 0, personalMinutes: 0, trainingMinutes: 0, onCallCents: 0, bonusCents: 0, salaryCents: null, note: "", reason: "", reviewed: true };
function source(overrides: Partial<PayrollPolicy> = {}): PayrollSource {
  return { facilityId: "a", facilityName: "Test facility", sourceRevision: "r1", policy: { organization_id: "org", facility_id: "a", revision: 1, config: { ...policy, ...overrides }, confirmed_at: "2026-09-20T12:00:00Z", confirmed_by: "manager", updated_at: "2026-09-20T12:00:00Z" }, groupPolicies: [], people: [{ id: "employee", userId: "login", name: "Employee A", facilityId: "a", role: "resident_aide", employmentStatus: "active", employeeNumber: "001" }], punches: [], corrections: [], rejections: [], floorUnlocks: [] };
}
function punch(id: string, type: RawPunch["punch_type"], at: string, facility = "a"): RawPunch { return { id, staff_id: "employee", facility_id: facility, punch_type: type, punched_at: at }; }
function shift(s: PayrollSource, day: string, hours = 8, facility = "a") {
  const start = `${day}T08:00:00-04:00`, end = new Date(Date.parse(start) + hours * 3600_000).toISOString();
  s.punches.push(punch(`${day}-${facility}-in`, "in", start, facility), punch(`${day}-${facility}-out`, "out", end, facility));
}
function build(s: PayrollSource, inputs: PacketInput[] = [entry], periodStart = "2026-09-21", periodEnd = "2026-09-27") { return buildPayrollSnapshot(s, { periodStart, periodEnd, checkDate: "2026-10-02", inputs, now: new Date("2026-12-01T12:00:00Z") }); }

describe("payroll packet calculation", () => {
  it("uses staff identity, actual unpaid meals and separate hours/dollars", () => {
    const s = source();
    s.punches = [punch("in", "in", "2026-09-21T08:00:00-04:00"), punch("meal", "meal_start", "2026-09-21T12:00:00-04:00"), punch("resume", "meal_end", "2026-09-21T12:30:00-04:00"), punch("out", "out", "2026-09-21T16:00:00-04:00")];
    const snapshot = build(s, [{ ...entry, trainingMinutes: 60, holidayMinutes: 480, onCallCents: 2500, bonusCents: 10000 }]);
    expect(snapshot.blockers).toEqual([]);
    expect(snapshot.rows[0]).toMatchObject({ workedMinutes: 450, mealMinutes: 30, regularMinutes: 390, trainingMinutes: 60, paidMinutes: 930, onCallCents: 2500 });
  });
  it("paid meals affect pay but never actual worked hours", () => {
    const s = source({ mealPolicy: "paid" });
    s.punches = [punch("in", "in", "2026-09-21T08:00:00-04:00"), punch("meal", "meal_start", "2026-09-21T12:00:00-04:00"), punch("resume", "meal_end", "2026-09-21T12:30:00-04:00"), punch("out", "out", "2026-09-21T16:00:00-04:00")];
    expect(build(s).rows[0]).toMatchObject({ workedMinutes: 450, paidMinutes: 480, paidWorkMinutes: 480 });
  });
  it("allocates overtime to the actual facility crossing the threshold", () => {
    const s = source({ overtimeFacilityIds: ["a", "b"] });
    s.groupPolicies = [{ ...s.policy!, facility_id: "b" }];
    for (const day of [21, 22, 23, 24, 25]) shift(s, `2026-09-${day}`, 8, "b");
    shift(s, "2026-09-26", 8);
    expect(build(s).rows[0]).toMatchObject({ regularMinutes: 0, overtimeMinutes: 480, workedMinutes: 480 });
    expect(build(s).blockers).toEqual([]);
  });
  it("counts work before packet start in its full custom workweek exactly once", () => {
    const s = source({ workweekDay: 4, workweekTime: "06:00", overtimeThresholdMinutes: 960 });
    shift(s, "2026-09-18"); shift(s, "2026-09-19"); shift(s, "2026-09-21"); shift(s, "2026-09-24");
    expect(build(s).rows[0]).toMatchObject({ regularMinutes: 480, overtimeMinutes: 480 });
  });
  it("does not use unconfirmed or inconsistent group policies", () => {
    const s = source({ overtimeFacilityIds: ["a", "b"] }); shift(s, "2026-09-21");
    expect(build(s).blockers.join(" ")).toContain("matching overtime");
    s.policy!.confirmed_at = null;
    expect(build(s).rows[0].regularMinutes).toBeNull();
    expect(build(s).rows[0].workedMinutes).toBe(480);
    expect(build(s).totals.regularMinutes).toBeNull();
  });
  it("preserves departed employees with earned shifts or termination in period", () => {
    const s = source(); s.people[0].employmentStatus = "terminated"; shift(s, "2026-09-21");
    expect(build(s, []).rows).toHaveLength(1);
    s.punches = []; s.people[0].terminationDate = "2026-09-25";
    expect(build(s, []).rows).toHaveLength(1);
  });
  it("requires explicit reviewed hours and reason while keeping missing kiosk actuals unknown", () => {
    const s = source({ calculationMode: "reviewed" });
    const result = build(s, [{ ...entry, regularMinutes: 2100, overtimeMinutes: 30, reason: "Reviewed time sheet signed by staff", bonusCents: 2500 }]);
    expect(result.blockers).toEqual([]);
    expect(result.rows[0]).toMatchObject({ workedMinutes: null, regularMinutes: 2100, paidMinutes: 2130 });
    expect(result.totals.workedMinutes).toBeNull();
    expect(build(s).blockers.join(" ")).toContain("reviewed regular");
  });
  it("does not fabricate hours for salary amount/unchanged", () => {
    const s = source({ salaryTreatment: "amount", calculationMode: "reviewed" });
    expect(build(s, [{ ...entry, payBasis: "salary" }]).blockers.join(" ")).toContain("salary dollar amount");
    expect(build(s, [{ ...entry, payBasis: "salary" }]).totals.salaryCents).toBeNull();
    const result = build(s, [{ ...entry, payBasis: "salary", salaryCents: 225000 }]);
    expect(result.blockers).toEqual([]);
    expect(result.rows[0].paidMinutes).toBeNull(); expect(result.totals.salaryCents).toBe(225000);
    expect(result.warnings.join(" ")).toContain("exclude salary");
  });
  it("blocks missing punches, stray out and overlapping facilities", () => {
    const missing = source(); missing.punches = [punch("in", "in", "2026-09-21T08:00:00-04:00")];
    expect(build(missing).blockers.join(" ")).toContain("missing out");
    const stray = source(); stray.punches = [punch("out", "out", "2026-09-21T16:00:00-04:00")];
    expect(build(stray).blockers.join(" ")).toContain("punch sequence");
    const overlap = source({ overtimeFacilityIds: ["a", "b"] }); overlap.groupPolicies = [{ ...overlap.policy!, facility_id: "b" }]; shift(overlap, "2026-09-21", 8); shift(overlap, "2026-09-21", 8, "b");
    expect(build(overlap).blockers.join(" ")).toContain("Overlapping"); expect(build(overlap).rows[0].regularMinutes).toBeNull();
  });
  it("blocks unresolved prior-day shift crossing the packet boundary", () => {
    const s = source(); s.punches = [punch("in", "in", "2026-09-20T22:00:00-04:00"), punch("next", "in", "2026-09-21T08:00:00-04:00"), punch("out", "out", "2026-09-21T16:00:00-04:00")];
    expect(build(s).blockers.join(" ")).toContain("missing out");
  });
  it("applies corrected punch time and includes relevant correction provenance only", () => {
    const s = source(); shift(s, "2026-09-21"); shift(s, "2025-01-01");
    s.corrections = [{ id: "correction", staff_id: "employee", facility_id: "a", correction_type: "change_time", target_punch_id: "2026-09-21-a-out", target_correction_id: null, punch_type: null, corrected_punched_at: "2026-09-21T17:00:00-04:00", exception_key: null, reason: "manager_verified_time", note: "Verified", corrected_by: "manager", corrected_at: "2026-09-28T12:00:00Z" }];
    const result = build(s); expect(result.rows[0].regularMinutes).toBe(540);
    expect(result.rows[0].sourcePunchIds).toEqual(["2026-09-21-a-in", "2026-09-21-a-out"]);
    expect(result.rows[0].sourceCorrectionIds).toEqual(["correction"]);
  });
  it("rounds each effective punch while preserving raw actuals", () => {
    const s = source({ roundingMinutes: 15 }); s.punches = [punch("in", "in", "2026-09-21T08:07:00-04:00"), punch("out", "out", "2026-09-21T16:08:00-04:00")];
    expect(build(s).rows[0]).toMatchObject({ regularMinutes: 495, workedMinutes: 481 });
  });
  it("handles DST elapsed hours with a local-calendar pay period", () => {
    const s = source({ anchorDate: "2026-10-26" });
    s.punches = [punch("in", "in", "2026-11-01T00:00:00-04:00"), punch("out", "out", "2026-11-01T04:00:00-05:00")];
    expect(build(s, [entry], "2026-10-26", "2026-11-01").rows[0].regularMinutes).toBe(300);
  });
  it("preserves one whole minute split across midnight without double-counting", () => {
    const s = source(); s.punches = [punch("in", "in", "2026-09-20T23:59:30-04:00"), punch("out", "out", "2026-09-21T00:00:30-04:00")];
    expect(build(s).rows[0]).toMatchObject({ workedMinutes: 1, regularMinutes: 1, overtimeMinutes: 0 });
  });
  it("rejects invalid numeric inputs and unattributed rejected clock events", () => {
    const s = source(); shift(s, "2026-09-21");
    expect(() => build(s, [{ ...entry, bonusCents: NaN }])).toThrow("Invalid bonusCents");
    s.rejections = [{ id: "rejected", facility_id: "a", staff_id: null, punch_type: "in", device_time: "2026-09-21T12:00:00Z", reason: "unknown_identity", created_at: "2026-09-21T12:00:00Z" }];
    expect(build(s).blockers.join(" ")).toContain("unattributed rejected clock event");
  });

  it("allows unique names without payroll IDs but warns to verify the ADP employee", () => {
    const s = source({ calculationMode: "reviewed" });
    const result = build(s, [{ ...entry, payrollId: "", regularMinutes: 480, overtimeMinutes: 0, reason: "Reviewed source sheet" }]);
    expect(result.blockers).toEqual([]);
    expect(result.warnings.join(" ")).toContain("verify the employee name in ADP");
  });
  it("blocks same-name rows without IDs and duplicate supplied IDs", () => {
    const s = source({ calculationMode: "reviewed" });
    s.people.push({ ...s.people[0], id: "second", userId: "second-login" });
    const rows = ["employee", "second"].map((staffId) => ({ ...entry, staffId, payrollId: "", regularMinutes: 480, overtimeMinutes: 0, reason: "Reviewed source sheet" }));
    expect(build(s, rows).blockers.join(" ")).toContain("Multiple employees have this exact name");
    const identified = rows.map((r, index) => ({ ...r, payrollId: `ID${index}` }));
    expect(build(s, identified).blockers).toEqual([]);
    identified[1].payrollId = identified[0].payrollId;
    expect(build(s, identified).blockers.join(" ")).toContain("payroll identifier is used by more than one");
  });
  it("permits approval only once the exclusive period end is reached in local time", () => {
    const s = source({ calculationMode: "reviewed" });
    const input = { periodStart: "2026-09-21", periodEnd: "2026-09-27", checkDate: "2026-10-02", inputs: [{ ...entry, regularMinutes: 480, overtimeMinutes: 0, reason: "Reviewed source sheet" }] };
    expect(buildPayrollSnapshot(s, { ...input, now: new Date("2026-09-28T03:59:59.999Z") }).blockers.join(" ")).toContain("pay period has not ended");
    expect(buildPayrollSnapshot(s, { ...input, now: new Date("2026-09-28T04:00:00.000Z") }).blockers).toEqual([]);
  });
  it("matches SQL integer-cent, minute and employee-input bounds", () => {
    const s = source({ calculationMode: "reviewed" });
    const valid = { ...entry, regularMinutes: 44_640, overtimeMinutes: 0, bonusCents: 2_147_483_647, reason: "Reviewed source sheet" };
    expect(build(s, [valid]).blockers).toEqual([]);
    expect(() => build(s, [{ ...valid, bonusCents: 2_147_483_648 }])).toThrow("Invalid bonusCents");
    expect(() => build(s, [{ ...valid, regularMinutes: 44_641 }])).toThrow("Invalid regularMinutes");
    expect(() => build(s, Array.from({ length: 1001 }, () => valid))).toThrow("no more than 1000 employee inputs");
  });
  it("blocks identity ambiguity, excessive training and unreviewed rows", () => {
    const s = source(); shift(s, "2026-09-21"); s.people.push({ ...s.people[0], id: "duplicate", employmentStatus: "terminated" });
    expect(build(s).blockers.join(" ")).toContain("share this kiosk identity");
    s.people.pop();
    expect(build(s, [{ ...entry, trainingMinutes: 600, reviewed: false }]).blockers.join(" ")).toContain("Training hours cannot exceed");
  });
});
