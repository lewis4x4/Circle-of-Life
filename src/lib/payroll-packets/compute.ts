import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { computeTimesheet, effectivePunches, segmentMinutesWithin, type EffectivePunch, type WorkSegment } from "@/lib/timeclock/compute";
import type { PacketInput, PacketRow, PacketSnapshot, PacketTotals, PayrollPolicy, PayrollSource } from "./types";

const MINUTE = 60_000;
const dayAfter = (iso: string, days = 1) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
const unique = (items: string[]) => [...new Set(items)];

/** No payroll defaults: an incomplete policy permits inspection but cannot approve pay. */
function policyIssues(policy: PayrollSource["policy"]): string[] {
  const p = policy?.config;
  if (!p) return ["Configure and confirm this facility's payroll policy."];
  const issues: string[] = [];
  if (!policy?.confirmed_at || !policy.confirmed_by) issues.push("Payroll policy must be confirmed by an authorized person.");
  if (!p.employerName?.trim()) issues.push("Confirm the legal employer name.");
  if (!["weekly", "biweekly"].includes(p.payFrequency ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(p.anchorDate ?? "")) issues.push("Confirm pay frequency and period anchor.");
  if (!Number.isInteger(p.workweekDay) || p.workweekDay! < 0 || p.workweekDay! > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.workweekTime ?? "")) issues.push("Confirm the workweek day and start time.");
  try { if (!p.timeZone) throw new Error(); new Intl.DateTimeFormat("en", { timeZone: p.timeZone }).format(); } catch { issues.push("Confirm a valid facility time zone."); }
  if (!Number.isInteger(p.overtimeThresholdMinutes) || p.overtimeThresholdMinutes! <= 0 || p.overtimeThresholdMinutes! > 10080) issues.push("Confirm the weekly overtime threshold.");
  if (!p.overtimeFacilityIds?.length || !p.overtimeFacilityIds.includes(policy!.facility_id) || new Set(p.overtimeFacilityIds).size !== p.overtimeFacilityIds.length) issues.push("Confirm the complete employer group for cross-building overtime.");
  if (!["automatic", "reviewed"].includes(p.calculationMode ?? "")) issues.push("Select automatic or reviewed payroll calculation.");
  if (!["paid", "punched_unpaid"].includes(p.mealPolicy ?? "") || ![0, 5, 6, 15].includes(p.roundingMinutes ?? -1)) issues.push("Confirm meal and rounding rules.");
  if (!["hours", "amount", "unchanged"].includes(p.salaryTreatment ?? "")) issues.push("Confirm salary treatment.");
  if (!["central", "facility"].includes(p.approvalRole ?? "") || !["phone", "run"].includes(p.defaultMethod ?? "")) issues.push("Confirm the approver role and payroll handoff method.");
  if (!p.policyNote?.trim()) issues.push("Confirm earning-category rules: training reclassifies regular hours; holiday and personal leave do not accrue automatic overtime.");
  return issues;
}

/** Civil-calendar boundaries retain the configured local start across DST. */
function weekStart(at: Date, p: PayrollPolicy): Date {
  const iso = formatInTimeZone(at, p.timeZone, "yyyy-MM-dd");
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  let date = dayAfter(iso, -((dow - p.workweekDay + 7) % 7));
  let start = fromZonedTime(`${date}T${p.workweekTime}:00`, p.timeZone);
  if (start > at) { date = dayAfter(date, -7); start = fromZonedTime(`${date}T${p.workweekTime}:00`, p.timeZone); }
  return start;
}
function nextWeek(at: Date, p: PayrollPolicy): Date {
  return fromZonedTime(`${dayAfter(formatInTimeZone(at, p.timeZone, "yyyy-MM-dd"), 7)}T${p.workweekTime}:00`, p.timeZone);
}
function groupKey(p: Partial<PayrollPolicy>): string {
  return JSON.stringify([p.employerName, p.workweekDay, p.workweekTime, p.timeZone, p.overtimeThresholdMinutes, p.mealPolicy, p.roundingMinutes, p.calculationMode, [...p.overtimeFacilityIds ?? []].sort()]);
}

const blankInput = (staffId: string, payrollId: string, role: string): PacketInput => ({ staffId, payrollId, payBasis: null, department: /administrator|admin|executive|business_office/.test(role) ? "administration" : "operations", regularMinutes: null, overtimeMinutes: null, holidayMinutes: 0, personalMinutes: 0, trainingMinutes: 0, onCallCents: 0, bonusCents: 0, salaryCents: null, note: "", reason: "", reviewed: false });
const overlap = (segment: WorkSegment, from: Date, to: Date, now: Date) => segment.start < to && (segment.end ?? now) > from;

/** Reject ignored/stray punches rather than silently trusting the timesheet walk's best effort. */
function sequenceIssues(punches: EffectivePunch[], from: Date, to: Date): string[] {
  let state = "out";
  const issues: string[] = [];
  for (const punch of punches) {
    const expected = punch.punchType === "in" ? "out" : punch.punchType === "meal_end" ? "meal" : "in";
    if (state !== expected && punch.at >= from && punch.at < to) issues.push(`Resolve the ${punch.punchType.replaceAll("_", " ")} punch sequence at ${punch.at.toISOString()}.`);
    state = punch.punchType === "out" ? "out" : punch.punchType === "meal_start" ? "meal" : "in";
  }
  return issues;
}

function rounded(punch: EffectivePunch, interval: number): number {
  return interval ? Math.round(punch.at.getTime() / (interval * MINUTE)) * interval * MINUTE : punch.at.getTime();
}

type FacilitySegments = { facilityId: string; segments: WorkSegment[] };
/** Assign each whole minute to its ending instant, preserving totals when splitting. */
function splitPay(segments: FacilitySegments[], p: PayrollPolicy, facilityId: string, from: Date, to: Date): { regular: number; overtime: number } {
  const ordered = segments.flatMap((entry) => entry.segments.filter((s) => s.end && (s.kind === "work" || p.mealPolicy === "paid")).map((segment) => ({ ...segment, facilityId: entry.facilityId }))).sort((a, b) => +a.start - +b.start);
  const accumulated = new Map<string, number>();
  let regular = 0, overtime = 0;
  for (const segment of ordered) {
    const end = segment.end!;
    let cursor = segment.start;
    const wholeMinutes = Math.floor((+end - +segment.start) / MINUTE);
    // Payroll periods are bounded by the source loader. Iterate segments by workweek,
    // not minute, so large rosters do not amplify computation with elapsed duration.
    let assigned = 0;
    while (cursor < end && assigned < wholeMinutes) {
      const week = weekStart(cursor, p), boundary = nextWeek(week, p);
      const stop = new Date(Math.min(+end, +boundary));
      const through = Math.min(wholeMinutes, Math.floor((+stop - +segment.start) / MINUTE));
      const count = through - assigned;
      const before = accumulated.get(week.toISOString()) ?? 0;
      const regularCount = Math.min(count, Math.max(0, p.overtimeThresholdMinutes - before));
      const cut = new Date(+segment.start + (assigned + regularCount) * MINUTE);
      const pieceStart = new Date(+segment.start + assigned * MINUTE);
      const pieceEnd = new Date(+segment.start + through * MINUTE);
      if (segment.facilityId === facilityId) {
        regular += segmentMinutesWithin({ kind: "work", start: pieceStart, end: cut }, from, to, end);
        overtime += segmentMinutesWithin({ kind: "work", start: cut, end: pieceEnd }, from, to, end);
      }
      accumulated.set(week.toISOString(), before + count);
      assigned = through; cursor = stop;
    }
  }
  return { regular, overtime };
}

export function payrollTotals(rows: PacketRow[], salaryTreatment?: PayrollPolicy["salaryTreatment"]): PacketTotals {
  const hourRows = rows.filter((row) => row.payBasis !== "salary" || !["amount", "unchanged"].includes(salaryTreatment ?? ""));
  const sum = (key: "regularMinutes" | "overtimeMinutes" | "paidMinutes" | "workedMinutes", selected = hourRows) => selected.some((r) => r[key] == null) ? null : selected.reduce((n, r) => n + (r[key] ?? 0), 0);
  return { regularMinutes: sum("regularMinutes"), overtimeMinutes: sum("overtimeMinutes"), holidayMinutes: rows.reduce((n, r) => n + r.holidayMinutes, 0), personalMinutes: rows.reduce((n, r) => n + r.personalMinutes, 0), trainingMinutes: rows.reduce((n, r) => n + r.trainingMinutes, 0), paidMinutes: sum("paidMinutes"), workedMinutes: sum("workedMinutes", rows), onCallCents: rows.reduce((n, r) => n + r.onCallCents, 0), bonusCents: rows.reduce((n, r) => n + r.bonusCents, 0), salaryCents: salaryTreatment === "amount" && rows.some((r) => r.payBasis === "salary" && r.salaryCents == null) ? null : rows.reduce((n, r) => n + (r.salaryCents ?? 0), 0) };
}

export function buildPayrollSnapshot(source: PayrollSource, input: { periodStart: string; periodEnd: string; checkDate: string; inputs: PacketInput[]; now: Date }): PacketSnapshot {
  if (input.inputs.length > 1000) throw new Error("A payroll packet supports no more than 1000 employee inputs.");
  const blockers = policyIssues(source.policy), warnings: string[] = [];
  const partial = source.policy?.config ?? null;
  const validPolicy = blockers.length === 0;
  const p = validPolicy ? partial as PayrollPolicy : null;
  let tz = partial?.timeZone;
  try { if (!tz) throw new Error(); new Intl.DateTimeFormat("en", { timeZone: tz }).format(); } catch { tz = undefined; }
  // UTC here is only an inspection window; unconfirmed timezone blocks all payroll splits.
  const from = tz ? fromZonedTime(`${input.periodStart}T00:00:00`, tz) : new Date(`${input.periodStart}T00:00:00Z`);
  const to = tz ? fromZonedTime(`${dayAfter(input.periodEnd)}T00:00:00`, tz) : new Date(`${dayAfter(input.periodEnd)}T00:00:00Z`);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || to <= from || (+to - +from) > 32 * 86400_000) throw new Error("Select a valid payroll period of no more than 31 days.");
  if (to > input.now) blockers.push("The pay period has not ended. Approve payroll only after the entire period is complete.");
  if (p) {
    const days = Math.round((Date.parse(`${dayAfter(input.periodEnd)}T12:00:00Z`) - Date.parse(`${input.periodStart}T12:00:00Z`)) / 86400_000);
    const expected = p.payFrequency === "weekly" ? 7 : 14;
    const offset = Math.round((Date.parse(`${input.periodStart}T12:00:00Z`) - Date.parse(`${p.anchorDate}T12:00:00Z`)) / 86400_000);
    if (days !== expected || offset % expected !== 0) blockers.push("The packet dates do not match the confirmed pay-period frequency and anchor.");
  }
  const rangeFrom = p?.calculationMode === "automatic" ? weekStart(from, p) : from;
  const rangeTo = p?.calculationMode === "automatic" ? nextWeek(weekStart(new Date(+to - 1), p), p) : to;
  const facilities = p?.overtimeFacilityIds ?? [source.facilityId];
  if (p?.calculationMode === "automatic") {
    for (const facilityId of facilities) {
      const policy = facilityId === source.facilityId ? source.policy : source.groupPolicies.find((policy) => policy.facility_id === facilityId);
      if (!policy || policyIssues(policy).length || groupKey(policy.config) !== groupKey(p)) blockers.push(`Confirm matching overtime, meal and rounding policy for employer-group facility ${facilityId}.`);
    }
  }
  if (!tz) warnings.push("Raw hours cannot be attributed to calendar dates until the facility time zone is confirmed.");
  warnings.push("Holiday and personal leave are additional paid leave without automatic overtime credit. Training reclassifies regular hours. Actual worked hours exclude meals and paid leave.");
  if (partial?.salaryTreatment === "amount" || partial?.salaryTreatment === "unchanged") warnings.push("Hour-based totals exclude salary amount/unchanged rows; salary instructions and dollar amounts are separate.");
  const inputs = new Map<string, PacketInput>();
  for (const row of input.inputs) {
    for (const key of ["regularMinutes", "overtimeMinutes", "holidayMinutes", "personalMinutes", "trainingMinutes", "onCallCents", "bonusCents", "salaryCents"] as const) {
      const value = row[key];
      if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > (key.endsWith("Cents") ? 2_147_483_647 : 44_640))) throw new Error(`Invalid ${key}; use nonnegative whole minutes or cents within the supported range.`);
    }
    if (inputs.has(row.staffId)) blockers.push(`Employee ${row.staffId} has duplicate payroll inputs.`);
    inputs.set(row.staffId, row);
  }
  const identities = new Map<string, string[]>();
  for (const person of source.people) if (person.userId) identities.set(person.userId, [...identities.get(person.userId) ?? [], person.id]);
  const rows: PacketRow[] = [];
  for (const rejection of source.rejections) {
    const at = new Date(rejection.device_time ?? rejection.created_at);
    if (!rejection.staff_id && rejection.facility_id === source.facilityId && at >= from && at < to) blockers.push(`Resolve unattributed rejected clock event ${rejection.id} before payroll.`);
  }
  const targetActivityIds = new Set([...source.rejections.filter((r) => r.staff_id && r.facility_id === source.facilityId && new Date(r.device_time ?? r.created_at) >= from && new Date(r.device_time ?? r.created_at) < to).map((r) => r.staff_id!), ...source.floorUnlocks.filter((r) => r.facility_id === source.facilityId && new Date(r.started_at) >= from && new Date(r.started_at) < to).map((r) => r.staff_id), ...source.punches.filter((r) => r.facility_id === source.facilityId && new Date(r.punched_at) >= from && new Date(r.punched_at) < to).map((r) => r.staff_id), ...source.corrections.filter((r) => r.facility_id === source.facilityId && r.corrected_punched_at && new Date(r.corrected_punched_at) >= from && new Date(r.corrected_punched_at) < to).map((r) => r.staff_id)]);
  for (const identity of targetActivityIds) if (!source.people.some((person) => person.id === identity)) blockers.push(`Map kiosk identity ${identity} to an employee before preparing payroll.`);
  for (const person of source.people) {
    const issues: string[] = [];
    const userId = person.id;
    const values = { ...blankInput(person.id, person.employeeNumber ?? "", person.role), ...inputs.get(person.id) };
    const segmentsByFacility: FacilitySegments[] = [];
    let worked = 0, meal = 0, activity = false, targetSegments = false;
    const sourcePunchIds: string[] = [], sourceCorrectionIds: string[] = [];
    if (userId) for (const facilityId of facilities) {
      const punches = source.punches.filter((r) => r.staff_id === userId && r.facility_id === facilityId);
      const corrections = source.corrections.filter((r) => r.staff_id === userId && r.facility_id === facilityId);
      const effective = effectivePunches(punches, corrections);
      if (effective.some((r) => !Number.isFinite(+r.at))) { issues.push("A source punch has an invalid timestamp."); continue; }
      const sheet = computeTimesheet({ staffId: userId, punches, corrections, rejections: source.rejections.filter((r) => r.facility_id === facilityId), floorUnlocks: source.floorUnlocks.filter((r) => r.facility_id === facilityId), periodStart: new Date(Math.min(+rangeFrom, ...effective.map((e) => +e.at))), periodEnd: rangeTo, now: input.now, timeZone: tz ?? "UTC" });
      const intersects = sheet.segments.some((s) => overlap(s, from, to, input.now));
      const relevant = effective.some((e) => e.at >= from && e.at < to) || intersects;
      if (facilityId === source.facilityId) {
        activity = relevant || targetActivityIds.has(userId);
        targetSegments = intersects;
        for (const segment of sheet.segments) {
          const minutes = segmentMinutesWithin(segment, from, to, input.now);
          if (segment.kind === "work") worked += minutes; else meal += minutes;
        }
      }
      issues.push(...sheet.exceptions.filter((e) => !e.acknowledged && (e.at >= rangeFrom || (["missing_out", "missing_meal_end", "long_shift"].includes(e.type) && (effective.find((punch) => punch.at > e.at && ["out", "in"].includes(punch.punchType))?.at ?? input.now) > rangeFrom))).map((e) => `Resolve ${e.type.replaceAll("_", " ")} (${facilityId}, ${e.at.toISOString()}).`));
      issues.push(...sequenceIssues(effective.filter((e) => e.at <= input.now), rangeFrom, rangeTo));
      if (sheet.segments.some((s) => !s.end && overlap(s, rangeFrom, rangeTo, input.now))) issues.push(`Finish or correct the open shift/meal at facility ${facilityId}.`);
      // Provenance includes boundary punches and corrections, even when their timestamps
      // sit outside this packet: they may affect cross-building weekly overtime.
      const relevantTimes = new Set(sheet.segments.filter((s) => overlap(s, rangeFrom, rangeTo, input.now)).flatMap((s) => [+s.start, ...(s.end ? [+s.end] : [])]));
      const relevantIds = new Set(effective.filter((e) => (e.at >= rangeFrom && e.at < rangeTo) || relevantTimes.has(+e.at)).map((e) => e.id));
      for (const punch of punches) if (new Date(punch.punched_at) >= rangeFrom && new Date(punch.punched_at) < rangeTo) relevantIds.add(punch.id);
      for (const rejection of source.rejections) if (rejection.staff_id === userId && rejection.facility_id === facilityId && new Date(rejection.device_time ?? rejection.created_at) >= rangeFrom && new Date(rejection.device_time ?? rejection.created_at) < rangeTo) relevantIds.add(rejection.id);
      for (const unlock of source.floorUnlocks) if (unlock.staff_id === userId && unlock.facility_id === facilityId && new Date(unlock.started_at) >= rangeFrom && new Date(unlock.started_at) < rangeTo) relevantIds.add(unlock.id);
      for (let pass = 0; pass <= corrections.length; pass++) {
        let changed = false;
        for (const correction of corrections) {
          if (relevantIds.has(correction.id)) continue;
          if ((correction.target_punch_id && relevantIds.has(correction.target_punch_id)) || (correction.target_correction_id && relevantIds.has(correction.target_correction_id)) || (correction.corrected_punched_at && new Date(correction.corrected_punched_at) >= rangeFrom && new Date(correction.corrected_punched_at) < rangeTo) || (correction.exception_key && [...relevantIds].some((id) => correction.exception_key!.endsWith(`:${id}`)))) { relevantIds.add(correction.id); changed = true; }
        }
        if (!changed) break;
      }
      sourcePunchIds.push(...punches.filter((r) => relevantIds.has(r.id)).map((r) => r.id)); sourceCorrectionIds.push(...corrections.filter((r) => relevantIds.has(r.id)).map((r) => r.id));
      const byTime = new Map(effective.map((e) => [+e.at, p ? rounded(e, p.roundingMinutes) : +e.at]));
      segmentsByFacility.push({ facilityId, segments: sheet.segments.filter((s) => s.end).map((s) => ({ kind: s.kind, start: new Date(byTime.get(+s.start) ?? +s.start), end: new Date(byTime.get(+s.end!) ?? +s.end!) })) });
    }
    if (!(person.facilityId === source.facilityId && person.employmentStatus === "active") && !(person.facilityId === source.facilityId && person.terminationDate && person.terminationDate >= input.periodStart && person.terminationDate <= input.periodEnd) && !activity && !inputs.has(person.id)) continue;
    if (person.userId && (identities.get(person.userId)?.length ?? 0) > 1) issues.push("Multiple employee records share this kiosk identity; resolve the employee mapping.");
    if (!values.payrollId.trim()) warnings.push(`${person.name}: No payroll identifier supplied; verify the employee name in ADP before reporting payroll.`);
    if (!values.payBasis) issues.push("Select hourly or salary pay basis.");
    if (!values.reviewed) issues.push("Review this employee's payroll row.");
    const occupied = segmentsByFacility.flatMap(({ facilityId, segments }) => segments.filter((s) => overlap(s, rangeFrom, rangeTo, input.now)).map((s) => ({ ...s, facilityId }))).sort((a, b) => +a.start - +b.start);
    let lastEnd = -Infinity;
    for (const segment of occupied) { if (+segment.start < lastEnd) issues.push("Overlapping clock segments must be corrected before payroll."); lastEnd = Math.max(lastEnd, +segment.end!); }
    let regular: number | null = null, overtime: number | null = null;
    const salaryWithoutHours = values.payBasis === "salary" && ["amount", "unchanged"].includes(partial?.salaryTreatment ?? "");
    if (salaryWithoutHours) {
      if (partial?.salaryTreatment === "amount" && values.salaryCents == null) issues.push("Enter the confirmed salary dollar amount.");
      if (values.trainingMinutes || values.holidayMinutes || values.personalMinutes) issues.push("Salary amount/unchanged rows cannot add hour-based categories; confirm salary treatment or remove those hours.");
    } else if (p?.calculationMode === "reviewed") {
      regular = values.regularMinutes; overtime = values.overtimeMinutes;
      if (regular == null || overtime == null) issues.push("Enter reviewed regular and overtime minutes.");
      if (!values.reason.trim()) issues.push("Record the source and reason for manually reviewed hours.");
    } else if (p?.calculationMode === "automatic" && tz) {
      if (!targetSegments) issues.push("No completed kiosk shift supports this row; use confirmed reviewed calculation for manual payroll.");
      else {
        const calculated = splitPay(segmentsByFacility, p, source.facilityId, from, to);
        if (values.trainingMinutes > calculated.regular) issues.push("Training hours cannot exceed automatically calculated regular hours.");
        else { regular = calculated.regular - values.trainingMinutes; overtime = calculated.overtime; }
      }
    }
    if (values.payBasis !== "salary" && values.salaryCents != null) issues.push("Salary dollars require a salary pay basis.");
    if (values.payBasis === "salary" && partial?.salaryTreatment !== "amount" && values.salaryCents != null) issues.push("Salary dollars require the confirmed salary amount treatment.");
    const ledgerUncertain = issues.some((issue) => /Resolve |punch sequence|open shift|Overlapping|kiosk identity|invalid timestamp/.test(issue));
    if (ledgerUncertain && p?.calculationMode === "automatic") { regular = null; overtime = null; }
    rows.push({ ...values, name: person.name, role: person.role, regularMinutes: regular, overtimeMinutes: overtime, workedMinutes: tz && targetSegments && !ledgerUncertain ? worked : null, mealMinutes: tz && targetSegments && !ledgerUncertain ? meal : null, paidWorkMinutes: p && targetSegments && !ledgerUncertain ? p.calculationMode === "automatic" ? (regular == null || overtime == null ? null : regular + overtime + values.trainingMinutes) : worked + (p.mealPolicy === "paid" ? meal : 0) : null, paidMinutes: regular == null || overtime == null ? null : regular + overtime + values.trainingMinutes + values.holidayMinutes + values.personalMinutes, issues: unique(issues), sourcePunchIds: unique(sourcePunchIds).sort(), sourceCorrectionIds: unique(sourceCorrectionIds).sort() });
  }
  for (const id of inputs.keys()) if (!source.people.some((p) => p.id === id)) blockers.push(`Employee ${id} is no longer available; refresh the roster and review the packet.`);
  rows.sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name) || a.staffId.localeCompare(b.staffId));
  const payrollIds = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const row of rows) nameCounts.set(row.name.trim(), (nameCounts.get(row.name.trim()) ?? 0) + 1);
  for (const row of rows) {
    if (!row.payrollId.trim() && (nameCounts.get(row.name.trim()) ?? 0) > 1) row.issues.push("Multiple employees have this exact name; supply a payroll identifier to distinguish this employee.");
    if (payrollIds.has(row.payrollId.trim()) && row.payrollId.trim()) row.issues.push("This payroll identifier is used by more than one employee row.");
    payrollIds.add(row.payrollId.trim());
    blockers.push(...row.issues.map((issue) => `${row.name}: ${issue}`));
  }
  if (!rows.length) blockers.push("No employees are available for this packet.");
  return { schemaVersion: 1, facilityId: source.facilityId, facilityName: source.facilityName, employerName: partial?.employerName ?? "Not configured", periodStart: input.periodStart, periodEnd: input.periodEnd, checkDate: input.checkDate, generatedAt: input.now.toISOString(), sourceRevision: source.sourceRevision, policy: partial, policyConfirmedAt: source.policy?.confirmed_at ?? null, rows, totals: payrollTotals(rows, partial?.salaryTreatment), blockers: unique(blockers), warnings };
}
