import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import fixtures from "./schedule-rule-fixtures.json";
import catalog from "./activity-catalog.json";
import {
  SCHEDULE_EVALUATOR_VERSION,
  judgeDue,
  legacyTemplateRule,
  listOccurrenceDates,
  nextOccurrenceDate,
  previewOccurrences,
  resolveOccurrence,
  validateScheduleRule,
  zonedTimeToInstant,
  type ScheduleRule,
} from "./schedule-evaluator";

type Fixture = { name: string; valid: boolean; first_problem?: string; rule: unknown };
const NY = "America/New_York";

function rule(recurrence: ScheduleRule["recurrence"], deadline: ScheduleRule["deadline"] = { time: "09:00" }, extra: Partial<ScheduleRule> = {}): ScheduleRule {
  const validated = validateScheduleRule({ rule_version: 1, timezone: NY, recurrence, deadline, ...extra });
  if (!validated.ok) throw new Error(validated.problems.join("; "));
  return validated.rule;
}

function dates(value: ReturnType<typeof listOccurrenceDates>) {
  if (value.kind === "unresolved") throw new Error(value.reason);
  return value.dates;
}

function resolved(value: ReturnType<typeof resolveOccurrence>) {
  if (value.kind === "unresolved") throw new Error(value.reason);
  return value;
}

describe("schedule rule validation", () => {
  it.each((fixtures as Fixture[]).map((fixture) => [fixture.name, fixture] as const))("%s", (_name, fixture) => {
    const result = validateScheduleRule(fixture.rule);
    expect(result.ok).toBe(fixture.valid);
    if (!result.ok) expect(result.problems[0]).toBe(fixture.first_problem);
  });

  it("keeps the database validator on the same fixtures", () => {
    const probe = readFileSync(path.resolve(__dirname, "../../../supabase/tests/review_hfo_schedule_evaluator.sql"), "utf8");
    const embedded = /\$fx\$([\s\S]*?)\$fx\$/.exec(probe);
    expect(embedded).not.toBeNull();
    expect(JSON.parse(embedded![1])).toEqual(fixtures);
  });

  it("never interprets free text, counts in parentheses or an abbreviation as a schedule", () => {
    expect(validateScheduleRule("(6)").ok).toBe(false);
    expect(validateScheduleRule({ rule_version: 1, timezone: NY, recurrence: "monthly", deadline: { time: "09:00" } }).ok).toBe(false);
    expect(validateScheduleRule({ rule_version: 1, timezone: NY, recurrence: { kind: "interval_months", every: "6", anchor: "2026-01-01" }, deadline: { time: "09:00" } }).ok).toBe(false);
  });
});

describe("timezone arithmetic", () => {
  it("shifts a non-existent spring-forward time past the gap and says so", () => {
    const result = zonedTimeToInstant("2026-03-08", 2, 30, NY);
    expect(result.instant.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(result.adjustment).toContain("does not exist");
  });

  it("resolves a repeated fall-back time to its first instant and says so", () => {
    const result = zonedTimeToInstant("2026-11-01", 1, 30, NY);
    expect(result.instant.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(result.adjustment).toContain("repeats");
  });

  it("converts an ordinary local time without adjustment", () => {
    expect(zonedTimeToInstant("2026-09-15", 9, 0, NY)).toEqual({ instant: new Date("2026-09-15T13:00:00.000Z"), adjustment: null });
    expect(zonedTimeToInstant("2026-01-15", 9, 0, NY).instant.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });
});

describe("recurrence outcomes", () => {
  it("lists weekday sets and weekly days in the facility calendar", () => {
    const weekdays = rule({ kind: "weekday_set", weekdays: ["monday", "wednesday", "saturday"] });
    expect(dates(listOccurrenceDates(weekdays, "2026-09-07", "2026-09-13"))).toEqual(["2026-09-07", "2026-09-09", "2026-09-12"]);
    const weekly = rule({ kind: "weekly", weekday: "tuesday" });
    expect(dates(listOccurrenceDates(weekly, "2026-09-01", "2026-09-30"))).toEqual(["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"]);
  });

  it("handles month end under an explicit policy", () => {
    const clamp = rule({ kind: "monthly", day: 31, short_month: "clamp" });
    expect(dates(listOccurrenceDates(clamp, "2026-01-01", "2026-05-31"))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
    const skip = rule({ kind: "monthly", day: 31, short_month: "skip" });
    expect(dates(listOccurrenceDates(skip, "2026-01-01", "2026-05-31"))).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
    const last = rule({ kind: "monthly", day: "last" });
    expect(dates(listOccurrenceDates(last, "2026-02-01", "2026-02-28"))).toEqual(["2026-02-28"]);
    expect(dates(listOccurrenceDates(last, "2028-02-01", "2028-02-29"))).toEqual(["2028-02-29"]);
  });

  it("handles a leap-day anniversary deterministically", () => {
    const clamp = rule({ kind: "interval_months", every: 12, anchor: "2024-02-29", short_month: "clamp" });
    expect(dates(listOccurrenceDates(clamp, "2025-01-01", "2026-01-01"))).toEqual(["2025-02-28"]);
    expect(dates(listOccurrenceDates(clamp, "2028-01-01", "2028-12-31"))).toEqual(["2028-02-29"]);
    const skip = rule({ kind: "interval_months", every: 12, anchor: "2024-02-29", short_month: "skip" });
    expect(dates(listOccurrenceDates(skip, "2025-01-01", "2026-01-01"))).toEqual([]);
    expect(dates(listOccurrenceDates(skip, "2028-01-01", "2028-12-31"))).toEqual(["2028-02-29"]);
  });

  it("keeps the two six-month meanings and the two-year meaning distinct", () => {
    const interval = rule({ kind: "interval_months", every: 6, anchor: "2026-03-15" });
    expect(dates(listOccurrenceDates(interval, "2026-01-01", "2027-03-31"))).toEqual(["2026-03-15", "2026-09-15", "2027-03-15"]);
    const halfYear = rule({ kind: "fixed_months", months: [1, 7], day: "last" });
    expect(dates(listOccurrenceDates(halfYear, "2026-01-01", "2027-03-31"))).toEqual(["2026-01-31", "2026-07-31", "2027-01-31"]);
    const biennial = rule({ kind: "interval_months", every: 24, anchor: "2026-05-01" });
    expect(dates(listOccurrenceDates(biennial, "2026-01-01", "2027-03-31"))).toEqual(["2026-05-01"]);
    expect(nextOccurrenceDate(biennial, "2026-05-02", 366)).toEqual({ kind: "unresolved", reason: "no occurrence within 366 days" });
    expect(dates(listOccurrenceDates(interval, "2025-01-01", "2026-03-14"))).toEqual([]);
  });

  it("bounds interval periods by the next occurrence from the anchor, not from a clamped date", () => {
    const monthly = rule({ kind: "interval_months", every: 1, anchor: "2026-01-31", short_month: "clamp" });
    expect(resolved(resolveOccurrence(monthly, "2026-02-28")).period).toEqual({ start_date: "2026-02-28", end_date: "2026-03-30" });
    expect(resolved(resolveOccurrence(monthly, "2026-03-31")).period).toEqual({ start_date: "2026-03-31", end_date: "2026-04-29" });
    const skipping = rule({ kind: "interval_months", every: 1, anchor: "2026-01-31", short_month: "skip" });
    expect(resolved(resolveOccurrence(skipping, "2026-01-31")).period).toEqual({ start_date: "2026-01-31", end_date: "2026-03-30" });
    expect(dates(listOccurrenceDates(rule({ kind: "expiry", expires_on: "0050-01-01" }), "0050-01-01", "0050-01-02"))).toEqual(["0050-01-01"]);
  });

  it("lists quarterly and annual fixed months with their periods", () => {
    const quarterly = rule({ kind: "fixed_months", months: [1, 4, 7, 10], day: 15 });
    expect(dates(listOccurrenceDates(quarterly, "2026-01-01", "2026-12-31"))).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
    expect(resolved(resolveOccurrence(quarterly, "2026-10-15")).period).toEqual({ start_date: "2026-10-01", end_date: "2026-12-31" });
    const annual = rule({ kind: "fixed_months", months: [7], day: 1 });
    expect(resolved(resolveOccurrence(annual, "2026-07-01")).period).toEqual({ start_date: "2026-07-01", end_date: "2027-06-30" });
  });

  it("uses the versioned holiday calendar for business-day rules and refuses uncovered dates", () => {
    const calendar = { key: "fixture-2026", version: "2026.1", covers_from: "2026-01-01", covers_to: "2026-12-31", weekend: ["saturday", "sunday"] as const, holidays: ["2026-01-01", "2026-09-07"] };
    const first = rule({ kind: "monthly_business_day", ordinal: 1, from: "start" }, { time: "17:00" }, { calendar: { ...calendar, weekend: [...calendar.weekend] } });
    expect(dates(listOccurrenceDates(first, "2026-01-01", "2026-02-28"))).toEqual(["2026-01-02", "2026-02-02"]);
    const septemberSecond = rule({ kind: "monthly_business_day", ordinal: 2, from: "start" }, { time: "17:00" }, { calendar: { ...calendar, weekend: [...calendar.weekend] } });
    expect(dates(listOccurrenceDates(septemberSecond, "2026-09-01", "2026-09-30"))).toEqual(["2026-09-02"]);
    const lastBusiness = rule({ kind: "monthly_business_day", ordinal: 1, from: "end" }, { time: "17:00" }, { calendar: { ...calendar, weekend: [...calendar.weekend] } });
    expect(dates(listOccurrenceDates(lastBusiness, "2026-01-01", "2026-01-31"))).toEqual(["2026-01-30"]);
    const uncovered = listOccurrenceDates(first, "2027-01-01", "2027-01-31");
    expect(uncovered.kind).toBe("resolved");
    if (uncovered.kind === "resolved") {
      expect(uncovered.dates).toEqual([]);
      expect(uncovered.unresolved[0]).toEqual({ date: "2027-01-01", reason: "calendar does not cover 2027-01" });
    }
    expect(nextOccurrenceDate(first, "2027-01-01")).toEqual({ kind: "unresolved", reason: "calendar does not cover 2027-01" });
  });

  it("skips calendar holidays only when the rule says so", () => {
    const calendar = { key: "fixture-2026", version: "2026.1", covers_from: "2026-01-01", covers_to: "2026-12-31", weekend: [], holidays: ["2026-01-01"] };
    const all: ScheduleRule["recurrence"] = { kind: "weekday_set", weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] };
    expect(dates(listOccurrenceDates(rule(all), "2026-01-01", "2026-01-02"))).toEqual(["2026-01-01", "2026-01-02"]);
    const skipping = rule({ ...all, on_holiday: "skipped" }, { time: "20:00" }, { calendar });
    expect(dates(listOccurrenceDates(skipping, "2026-01-01", "2026-01-02"))).toEqual(["2026-01-02"]);
    const outside = listOccurrenceDates(skipping, "2027-01-01", "2027-01-01");
    if (outside.kind === "resolved") expect(outside.unresolved).toEqual([{ date: "2027-01-01", reason: "calendar does not cover 2027-01-01" }]);
    else throw new Error(outside.reason);
  });

  it("anchors expiry work on the supplied date and asks for a new anchor afterwards", () => {
    const expiry = rule({ kind: "expiry", expires_on: "2026-12-31" }, { time: "17:00" });
    expect(dates(listOccurrenceDates(expiry, "2026-01-01", "2027-12-31"))).toEqual(["2026-12-31"]);
    expect(resolved(resolveOccurrence(expiry, "2026-12-31")).due_at).toBe("2026-12-31T22:00:00.000Z");
    expect(nextOccurrenceDate(expiry, "2027-01-01")).toEqual({ kind: "unresolved", reason: "expiry anchor has passed; a new expiry anchor is required" });
  });

  it("creates event work only from a source event instant", () => {
    const event = rule({ kind: "event", event_key: "admission" }, { time: "17:00", day_offset: 30 });
    expect(listOccurrenceDates(event, "2026-09-01", "2026-09-30")).toEqual({ kind: "unresolved", reason: "event occurrences are created by their source event" });
    expect(resolveOccurrence(event, "2026-09-10")).toEqual({ kind: "unresolved", reason: "event occurrences require the source event instant" });
    const occurrence = resolved(resolveOccurrence(event, "2026-09-10", { eventAt: "2026-09-10T23:30:00Z" }));
    expect(occurrence.occurrence_date).toBe("2026-09-10");
    expect(occurrence.due_at).toBe("2026-10-10T21:00:00.000Z");
  });
});

describe("due instants", () => {
  it("separates recurrence, deadline and reminder", () => {
    const weekly = rule({ kind: "weekly", weekday: "tuesday" }, { time: "10:00", offset_minutes: 30, grace_minutes: 60 }, { reminder: { lead_minutes: 1440 } });
    const occurrence = resolved(resolveOccurrence(weekly, "2026-09-15"));
    expect(occurrence).toMatchObject({
      evaluator_version: SCHEDULE_EVALUATOR_VERSION,
      occurrence_date: "2026-09-15",
      period: { start_date: "2026-09-14", end_date: "2026-09-20" },
      due_at: "2026-09-15T14:30:00.000Z",
      grace_ends_at: "2026-09-15T15:30:00.000Z",
      remind_at: "2026-09-14T14:30:00.000Z",
      timezone: NY,
      adjustments: [],
    });
    expect(resolveOccurrence(weekly, "2026-09-16")).toEqual({ kind: "unresolved", reason: "no occurrence on 2026-09-16" });
  });

  it("reports DST adjustments on the occurrence", () => {
    const sunday = rule({ kind: "weekly", weekday: "sunday" }, { time: "02:30" });
    const spring = resolved(resolveOccurrence(sunday, "2026-03-08"));
    expect(spring.due_at).toBe("2026-03-08T07:30:00.000Z");
    expect(spring.adjustments[0]).toContain("does not exist");
    const fall = resolved(resolveOccurrence(rule({ kind: "weekly", weekday: "sunday" }, { time: "01:30" }), "2026-11-01"));
    expect(fall.due_at).toBe("2026-11-01T05:30:00.000Z");
    expect(fall.adjustments[0]).toContain("repeats");
  });

  it("previews upcoming occurrences for next-due displays", () => {
    const preview = previewOccurrences(rule({ kind: "monthly", day: 1 }, { time: "17:00" }), "2026-09-10", 3);
    expect(preview.kind).toBe("resolved");
    if (preview.kind === "resolved") expect(preview.occurrences.map((occurrence) => occurrence.due_at)).toEqual(["2026-10-01T21:00:00.000Z", "2026-11-01T22:00:00.000Z", "2026-12-01T22:00:00.000Z"]);
  });
});

describe("due judgment", () => {
  const now = new Date("2026-09-10T15:00:00Z");

  it("returns no judgment for an unknown schedule and never uses the assigned date", () => {
    expect(judgeDue({ dueAt: null, status: "pending", now, timeZone: NY })).toEqual({ judgment: "unknown", days_overdue: null });
    expect(judgeDue({ dueAt: undefined, status: "in_progress", now, timeZone: NY })).toEqual({ judgment: "unknown", days_overdue: null });
    expect(judgeDue({ dueAt: "not a time", status: "pending", now, timeZone: NY })).toEqual({ judgment: "unknown", days_overdue: null });
  });

  it("judges open tasks against the due instant in facility days", () => {
    expect(judgeDue({ dueAt: "2026-09-10T16:00:00Z", status: "pending", now, timeZone: NY })).toEqual({ judgment: "not_due", days_overdue: 0 });
    expect(judgeDue({ dueAt: "2026-09-10T13:00:00Z", status: "pending", now, timeZone: NY })).toEqual({ judgment: "overdue", days_overdue: 1 });
    expect(judgeDue({ dueAt: "2026-09-07T21:00:00Z", status: "in_progress", now, timeZone: NY })).toEqual({ judgment: "overdue", days_overdue: 3 });
    expect(judgeDue({ dueAt: "2026-09-10T03:30:00Z", status: "pending", now, timeZone: NY })).toEqual({ judgment: "overdue", days_overdue: 1 });
    expect(judgeDue({ dueAt: "2026-09-10T03:30:00Z", status: "pending", now, timeZone: "UTC" })).toEqual({ judgment: "overdue", days_overdue: 1 });
    expect(judgeDue({ dueAt: "2026-09-09T23:30:00Z", status: "pending", now, timeZone: "UTC" })).toEqual({ judgment: "overdue", days_overdue: 1 });
  });

  it("settles closed tasks without a judgment", () => {
    for (const status of ["completed", "missed", "deferred", "cancelled"]) {
      expect(judgeDue({ dueAt: "2026-09-01T00:00:00Z", status, now, timeZone: NY })).toEqual({ judgment: "settled", days_overdue: 0 });
    }
  });
});

describe("legacy template translation", () => {
  const ladder = [{ role: "lpn_supervisor", sla_minutes: 15, enabled: true }];

  it("expresses the scheduler's recorded timing as a version-1 rule", () => {
    const daily = legacyTemplateRule({ cadence_type: "daily", day_of_week: null, day_of_month: null, month_of_year: null, estimated_minutes: 10, escalation_ladder: ladder }, "day", NY);
    expect(daily.kind).toBe("rule");
    if (daily.kind !== "rule") throw new Error(daily.reason);
    expect(daily.rule.recurrence).toEqual({ kind: "weekday_set", weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] });
    expect(daily.rule.deadline).toEqual({ time: "07:00", offset_minutes: 15 });
    expect(resolved(resolveOccurrence(daily.rule, "2026-09-10")).due_at).toBe("2026-09-10T11:15:00.000Z");
    const evening = legacyTemplateRule({ cadence_type: "daily", day_of_week: null, day_of_month: null, month_of_year: null, estimated_minutes: 90, escalation_ladder: [] }, "evening", NY);
    if (evening.kind !== "rule") throw new Error(evening.reason);
    expect(evening.rule.deadline).toEqual({ time: "15:00", offset_minutes: 90 });
    const night = legacyTemplateRule({ cadence_type: "daily", day_of_week: null, day_of_month: null, month_of_year: null, estimated_minutes: null, escalation_ladder: [{ sla_minutes: 30, enabled: false }] }, "night", NY);
    if (night.kind !== "rule") throw new Error(night.reason);
    expect(night.rule.deadline).toEqual({ time: "23:00", offset_minutes: 60 });
  });

  it("maps weekly, monthly, quarterly and yearly columns with the recorded clamping", () => {
    const weekly = legacyTemplateRule({ cadence_type: "weekly", day_of_week: 2, day_of_month: null, month_of_year: null, estimated_minutes: null, escalation_ladder: null }, null, NY);
    if (weekly.kind !== "rule") throw new Error(weekly.reason);
    expect(weekly.rule.recurrence).toEqual({ kind: "weekly", weekday: "tuesday" });
    expect(weekly.rule.deadline).toEqual({ time: "09:00", offset_minutes: 60 });
    const monthly = legacyTemplateRule({ cadence_type: "monthly", day_of_week: null, day_of_month: 31, month_of_year: null, estimated_minutes: null, escalation_ladder: null }, null, NY);
    if (monthly.kind !== "rule") throw new Error(monthly.reason);
    expect(dates(listOccurrenceDates(monthly.rule, "2026-02-01", "2026-02-28"))).toEqual(["2026-02-28"]);
    const quarterly = legacyTemplateRule({ cadence_type: "quarterly", day_of_week: null, day_of_month: null, month_of_year: null, estimated_minutes: null, escalation_ladder: null }, null, NY);
    if (quarterly.kind !== "rule") throw new Error(quarterly.reason);
    expect(dates(listOccurrenceDates(quarterly.rule, "2026-01-01", "2026-12-31"))).toEqual(["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"]);
    const yearly = legacyTemplateRule({ cadence_type: "yearly", day_of_week: null, day_of_month: null, month_of_year: 7, estimated_minutes: null, escalation_ladder: null }, null, NY);
    if (yearly.kind !== "rule") throw new Error(yearly.reason);
    expect(dates(listOccurrenceDates(yearly.rule, "2026-01-01", "2026-12-31"))).toEqual(["2026-07-01"]);
  });

  it("leaves on-demand, event-driven and incomplete templates unresolved", () => {
    expect(legacyTemplateRule({ cadence_type: "on_demand", day_of_week: null, day_of_month: null, month_of_year: null, estimated_minutes: null, escalation_ladder: null }, null, NY)).toEqual({ kind: "unresolved", reason: "on_demand templates have no recurrence" });
    expect(legacyTemplateRule({ cadence_type: "event_driven", day_of_week: null, day_of_month: null, month_of_year: null, estimated_minutes: null, escalation_ladder: null }, null, NY)).toEqual({ kind: "unresolved", reason: "event_driven templates have no recurrence" });
    expect(legacyTemplateRule({ cadence_type: "weekly", day_of_week: null, day_of_month: null, month_of_year: null, estimated_minutes: null, escalation_ladder: null }, null, NY)).toEqual({ kind: "unresolved", reason: "weekly template has no weekday" });
    expect(legacyTemplateRule({ cadence_type: "daily", day_of_week: null, day_of_month: null, month_of_year: null, estimated_minutes: null, escalation_ladder: null }, null, "Eastern")).toEqual({ kind: "unresolved", reason: "facility timezone is not an IANA zone name" });
  });
});

describe("unactivated source ambiguities", () => {
  const entries = (catalog as { entries: Array<{ sourceId: string; approvedRule: unknown }> }).entries;

  it.each(["AL-M05", "AL-M06", "AL-A07", "AL-Y05", "AL-Y07", "AL-E14", "AL-H01"])("%s carries no approved rule", (sourceId) => {
    const entry = entries.find((candidate) => candidate.sourceId === sourceId);
    expect(entry).toBeDefined();
    expect(entry?.approvedRule).toBeNull();
  });

  it("keeps the evaluator free of facility names and source-item defaults", () => {
    const source = readFileSync(path.resolve(__dirname, "schedule-evaluator.ts"), "utf8");
    for (const forbidden of ["Homewood", "Oakridge", "Rising Oaks", "Grande Cypress", "Plantation", "fire drill", "hood", "support plan", "AL-"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
