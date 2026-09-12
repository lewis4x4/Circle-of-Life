/**
 * Facility operations recurrence and due-date evaluator (COL-137 / HFO-03).
 *
 * One evaluator for occurrence dates, due instants, reminders and the
 * due/overdue judgment of an existing task. It is shared by the Next server
 * (task list, history and exception views) and the Deno scheduler, so it must
 * stay runtime-agnostic: no imports, no `node:` APIs, no `process`, no
 * `Deno`, only plain JavaScript and `Intl`.
 *
 * Rules are structured objects (`ScheduleRule`, version 1). The evaluator
 * never parses workbook or interview text, never guesses a facility, and never
 * turns an unknown schedule into a date: when it cannot decide it returns an
 * explicit unresolved result, and `judgeDue` returns `unknown` for a task
 * without a due instant instead of falling back to the assigned date at
 * midnight.
 */

export const SCHEDULE_RULE_VERSION = 1 as const;
export const SCHEDULE_EVALUATOR_VERSION = "hfo-evaluator/1";

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Month-end policy for day-of-month rules that name a day a short month lacks. */
export type ShortMonthPolicy = "clamp" | "skip";

export type HolidayCalendar = {
  key: string;
  version: string;
  covers_from: string;
  covers_to: string;
  weekend: Weekday[];
  holidays: string[];
};

export type ScheduleRecurrence =
  | { kind: "weekday_set"; weekdays: Weekday[]; on_holiday?: "occurs" | "skipped" }
  | { kind: "weekly"; weekday: Weekday }
  | { kind: "monthly"; day: number | "last"; short_month?: ShortMonthPolicy }
  | { kind: "monthly_business_day"; ordinal: number; from: "start" | "end" }
  | { kind: "fixed_months"; months: number[]; day: number | "last"; short_month?: ShortMonthPolicy }
  | { kind: "interval_months"; every: number; anchor: string; short_month?: ShortMonthPolicy }
  | { kind: "expiry"; expires_on: string }
  | { kind: "event"; event_key: string };

export type ScheduleDeadline = {
  /** Local wall-clock time on the due date, HH:MM (24-hour). */
  time: string;
  /** Days after the occurrence date on which the deadline falls (default 0). */
  day_offset?: number;
  /** Minutes added after the local time (default 0). */
  offset_minutes?: number;
  /** Grace after the due instant before the occurrence counts as overdue for escalation purposes (default 0). */
  grace_minutes?: number;
};

export type ScheduleReminder = { lead_minutes: number };

export type ScheduleRule = {
  rule_version: typeof SCHEDULE_RULE_VERSION;
  timezone: string;
  recurrence: ScheduleRecurrence;
  deadline: ScheduleDeadline;
  reminder?: ScheduleReminder | null;
  calendar?: HolidayCalendar | null;
};

export type ScheduleRuleValidation = { ok: true; rule: ScheduleRule } | { ok: false; problems: string[] };

export type ScheduleUnresolved = { kind: "unresolved"; reason: string };

export type ScheduleOccurrence = {
  kind: "resolved";
  evaluator_version: typeof SCHEDULE_EVALUATOR_VERSION;
  occurrence_date: string;
  period: { start_date: string; end_date: string };
  due_at: string;
  grace_ends_at: string | null;
  remind_at: string | null;
  timezone: string;
  adjustments: string[];
};

export type OccurrenceDates = {
  kind: "resolved";
  dates: string[];
  /** Dates inside the range the rule could not decide, each with its reason. */
  unresolved: Array<{ date: string; reason: string }>;
};

export type DueJudgment = {
  judgment: "unknown" | "settled" | "not_due" | "overdue";
  /** Calendar days overdue in the facility timezone; null when no judgment exists. */
  days_overdue: number | null;
};

export const SCHEDULE_UNKNOWN_REASON = "schedule needs confirmation";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;
const ZONE_RE = /^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/;
export const MAX_ENUMERATION_DAYS = 800;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Date-only arithmetic (proleptic Gregorian, no timezone).
// ---------------------------------------------------------------------------

type DateParts = { y: number; m: number; d: number };

function isLeapYear(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number) {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

export function parseDateOnly(value: unknown): DateParts | null {
  if (typeof value !== "string") return null;
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function pad(value: number, width = 2) {
  return String(value).padStart(width, "0");
}

export function formatDateOnly(parts: DateParts) {
  return `${pad(parts.y, 4)}-${pad(parts.m)}-${pad(parts.d)}`;
}

/** UTC milliseconds for a calendar date; unlike Date.UTC this does not remap years 0–99. */
function utcMidnight(parts: DateParts) {
  const date = new Date(0);
  date.setUTCFullYear(parts.y, parts.m - 1, parts.d);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function toDayNumber(parts: DateParts) {
  return Math.round(utcMidnight(parts) / MS_PER_DAY);
}

function fromDayNumber(dayNumber: number): DateParts {
  const date = new Date(dayNumber * MS_PER_DAY);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

export function addDays(date: string, days: number) {
  const parts = parseDateOnly(date);
  if (!parts) throw new Error("addDays requires a calendar date");
  return formatDateOnly(fromDayNumber(toDayNumber(parts) + days));
}

/** Monday = 0 … Sunday = 6. */
function weekdayIndex(parts: DateParts) {
  const jsDay = new Date(utcMidnight(parts)).getUTCDay();
  return (jsDay + 6) % 7;
}

export function weekdayOf(date: string): Weekday {
  const parts = parseDateOnly(date);
  if (!parts) throw new Error("weekdayOf requires a calendar date");
  return WEEKDAYS[weekdayIndex(parts)];
}

/**
 * The date `months` months after `anchor` under an explicit short-month policy.
 * Returns null when the target month lacks the day and the policy is `skip`.
 */
function addMonthsWithPolicy(anchor: DateParts, months: number, policy: ShortMonthPolicy | undefined): DateParts | null {
  const total = anchor.y * 12 + (anchor.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const limit = daysInMonth(y, m);
  if (anchor.d <= limit) return { y, m, d: anchor.d };
  if (policy === "clamp") return { y, m, d: limit };
  return null;
}

function resolveDayOfMonth(y: number, m: number, day: number | "last", policy: ShortMonthPolicy | undefined): number | null {
  const limit = daysInMonth(y, m);
  if (day === "last") return limit;
  if (day <= limit) return day;
  return policy === "clamp" ? limit : null;
}

// ---------------------------------------------------------------------------
// Timezone arithmetic through Intl. DST outcomes are explicit: a local time
// that does not exist is shifted forward past the gap; a repeated local time
// resolves to its first (earlier) instant. Both are reported as adjustments.
// ---------------------------------------------------------------------------

type LocalParts = DateParts & { hh: number; mi: number; ss: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !ZONE_RE.test(value)) return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

export function localPartsOf(instant: Date, timeZone: string): LocalParts {
  const lookup = new Map(formatterFor(timeZone).formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    y: Number(lookup.get("year")),
    m: Number(lookup.get("month")),
    d: Number(lookup.get("day")),
    hh: Number(lookup.get("hour")) % 24,
    mi: Number(lookup.get("minute")),
    ss: Number(lookup.get("second")),
  };
}

export function localDateOf(instant: Date, timeZone: string) {
  return formatDateOnly(localPartsOf(instant, timeZone));
}

function offsetMinutesAt(instant: Date, timeZone: string) {
  const local = localPartsOf(instant, timeZone);
  const asUtc = Date.UTC(local.y, local.m - 1, local.d, local.hh, local.mi, local.ss);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

export type ZonedInstant = { instant: Date; adjustment: string | null };

/** The UTC instant of a local wall-clock time, with an explicit DST outcome. */
export function zonedTimeToInstant(date: string, hh: number, mi: number, timeZone: string): ZonedInstant {
  const parts = parseDateOnly(date);
  if (!parts) throw new Error("zonedTimeToInstant requires a calendar date");
  const naive = Date.UTC(parts.y, parts.m - 1, parts.d, hh, mi, 0);
  const before = offsetMinutesAt(new Date(naive - MS_PER_DAY), timeZone);
  const after = offsetMinutesAt(new Date(naive + MS_PER_DAY), timeZone);
  const candidates = Array.from(new Set([before, after])).map((offset) => new Date(naive - offset * 60000));
  const matches = candidates.filter((candidate) => {
    const local = localPartsOf(candidate, timeZone);
    return local.y === parts.y && local.m === parts.m && local.d === parts.d && local.hh === hh && local.mi === mi;
  });
  if (matches.length === 1) return { instant: matches[0], adjustment: null };
  if (matches.length > 1) {
    const earliest = new Date(Math.min(...matches.map((candidate) => candidate.getTime())));
    return { instant: earliest, adjustment: `local time ${date} ${pad(hh)}:${pad(mi)} repeats in ${timeZone}; the first instant was used` };
  }
  const latest = new Date(Math.max(...candidates.map((candidate) => candidate.getTime())));
  return { instant: latest, adjustment: `local time ${date} ${pad(hh)}:${pad(mi)} does not exist in ${timeZone}; shifted forward past the gap` };
}

// ---------------------------------------------------------------------------
// Rule validation. Strict and ordered so the database mirror
// (haven.operation_schedule_rule_problems) reports the same first problem.
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Unknown keys in jsonb storage order (length, then bytes) so the database mirror names the same first field. */
function unknownKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort((left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0));
}

function validateWeekdays(value: unknown, allowEmpty: boolean): Weekday[] | string {
  if (!Array.isArray(value)) return "weekdays must be a list";
  if (!allowEmpty && value.length === 0) return "weekdays must not be empty";
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !(WEEKDAYS as readonly string[]).includes(entry)) return "weekdays must be weekday names";
    if (seen.has(entry)) return "weekdays must be unique";
    seen.add(entry);
  }
  return [...(value as Weekday[])];
}

function validateCalendar(value: unknown): HolidayCalendar | string {
  if (!isPlainObject(value)) return "calendar must be an object";
  const extra = unknownKeys(value, ["key", "version", "covers_from", "covers_to", "weekend", "holidays"]);
  if (extra.length > 0) return `calendar has an unknown field: ${extra[0]}`;
  if (typeof value.key !== "string" || !SLUG_RE.test(value.key)) return "calendar key must be a slug";
  if (typeof value.version !== "string" || value.version.trim().length === 0 || value.version.length > 64) return "calendar version is required";
  const from = parseDateOnly(value.covers_from);
  const to = parseDateOnly(value.covers_to);
  if (!from || !to) return "calendar coverage must be calendar dates";
  if (toDayNumber(from) > toDayNumber(to)) return "calendar coverage must start before it ends";
  const weekend = validateWeekdays(value.weekend, true);
  if (typeof weekend === "string") return `calendar ${weekend}`;
  if (!Array.isArray(value.holidays) || value.holidays.length > 400) return "calendar holidays must be a list of at most 400 dates";
  const seen = new Set<string>();
  for (const holiday of value.holidays) {
    const parsed = parseDateOnly(holiday);
    if (!parsed) return "calendar holidays must be calendar dates";
    if (toDayNumber(parsed) < toDayNumber(from) || toDayNumber(parsed) > toDayNumber(to)) return "calendar holidays must lie inside the coverage";
    if (seen.has(holiday as string)) return "calendar holidays must be unique";
    seen.add(holiday as string);
  }
  return {
    key: value.key,
    version: value.version,
    covers_from: value.covers_from as string,
    covers_to: value.covers_to as string,
    weekend,
    holidays: [...(value.holidays as string[])],
  };
}

function validateShortMonth(value: unknown): ShortMonthPolicy | undefined | string {
  if (value === undefined) return undefined;
  if (value === "clamp" || value === "skip") return value;
  return "short_month must be clamp or skip";
}

function validateDay(value: unknown): number | "last" | string {
  if (value === "last") return "last";
  if (isInt(value, 1, 31)) return value;
  return "day must be 1 to 31 or last";
}

function validateRecurrence(value: unknown): ScheduleRecurrence | string {
  if (!isPlainObject(value)) return "recurrence must be an object";
  const kind = value.kind;
  switch (kind) {
    case "weekday_set": {
      const extra = unknownKeys(value, ["kind", "weekdays", "on_holiday"]);
      if (extra.length > 0) return `recurrence has an unknown field: ${extra[0]}`;
      const weekdays = validateWeekdays(value.weekdays, false);
      if (typeof weekdays === "string") return weekdays;
      if (value.on_holiday !== undefined && value.on_holiday !== "occurs" && value.on_holiday !== "skipped") return "on_holiday must be occurs or skipped";
      return { kind, weekdays, ...(value.on_holiday !== undefined ? { on_holiday: value.on_holiday as "occurs" | "skipped" } : {}) };
    }
    case "weekly": {
      const extra = unknownKeys(value, ["kind", "weekday"]);
      if (extra.length > 0) return `recurrence has an unknown field: ${extra[0]}`;
      if (typeof value.weekday !== "string" || !(WEEKDAYS as readonly string[]).includes(value.weekday)) return "weekday must be a weekday name";
      return { kind, weekday: value.weekday as Weekday };
    }
    case "monthly": {
      const extra = unknownKeys(value, ["kind", "day", "short_month"]);
      if (extra.length > 0) return `recurrence has an unknown field: ${extra[0]}`;
      const day = validateDay(value.day);
      if (typeof day === "string" && day !== "last") return day;
      const policy = validateShortMonth(value.short_month);
      if (typeof policy === "string" && policy !== "clamp" && policy !== "skip") return policy;
      return { kind, day, ...(policy ? { short_month: policy } : {}) };
    }
    case "monthly_business_day": {
      const extra = unknownKeys(value, ["kind", "ordinal", "from"]);
      if (extra.length > 0) return `recurrence has an unknown field: ${extra[0]}`;
      if (!isInt(value.ordinal, 1, 15)) return "ordinal must be 1 to 15";
      if (value.from !== "start" && value.from !== "end") return "from must be start or end";
      return { kind, ordinal: value.ordinal, from: value.from };
    }
    case "fixed_months": {
      const extra = unknownKeys(value, ["kind", "months", "day", "short_month"]);
      if (extra.length > 0) return `recurrence has an unknown field: ${extra[0]}`;
      if (!Array.isArray(value.months) || value.months.length === 0 || value.months.length > 12) return "months must be a non-empty list";
      const months: number[] = [];
      for (const month of value.months) {
        if (!isInt(month, 1, 12)) return "months must be 1 to 12";
        if (months.includes(month)) return "months must be unique";
        months.push(month);
      }
      const day = validateDay(value.day);
      if (typeof day === "string" && day !== "last") return day;
      const policy = validateShortMonth(value.short_month);
      if (typeof policy === "string" && policy !== "clamp" && policy !== "skip") return policy;
      return { kind, months: [...months].sort((left, right) => left - right), day, ...(policy ? { short_month: policy } : {}) };
    }
    case "interval_months": {
      const extra = unknownKeys(value, ["kind", "every", "anchor", "short_month"]);
      if (extra.length > 0) return `recurrence has an unknown field: ${extra[0]}`;
      if (!isInt(value.every, 1, 120)) return "every must be 1 to 120 months";
      if (!parseDateOnly(value.anchor)) return "anchor must be a calendar date";
      const policy = validateShortMonth(value.short_month);
      if (typeof policy === "string" && policy !== "clamp" && policy !== "skip") return policy;
      return { kind, every: value.every, anchor: value.anchor as string, ...(policy ? { short_month: policy } : {}) };
    }
    case "expiry": {
      const extra = unknownKeys(value, ["kind", "expires_on"]);
      if (extra.length > 0) return `recurrence has an unknown field: ${extra[0]}`;
      if (!parseDateOnly(value.expires_on)) return "expires_on must be a calendar date";
      return { kind, expires_on: value.expires_on as string };
    }
    case "event": {
      const extra = unknownKeys(value, ["kind", "event_key"]);
      if (extra.length > 0) return `recurrence has an unknown field: ${extra[0]}`;
      if (typeof value.event_key !== "string" || !SLUG_RE.test(value.event_key)) return "event_key must be a slug";
      return { kind, event_key: value.event_key };
    }
    default:
      return "recurrence kind is unknown";
  }
}

function validateDeadline(value: unknown): ScheduleDeadline | string {
  if (!isPlainObject(value)) return "deadline must be an object";
  const extra = unknownKeys(value, ["time", "day_offset", "offset_minutes", "grace_minutes"]);
  if (extra.length > 0) return `deadline has an unknown field: ${extra[0]}`;
  if (typeof value.time !== "string" || !TIME_RE.test(value.time)) return "deadline time must be HH:MM";
  if (value.day_offset !== undefined && !isInt(value.day_offset, 0, 366)) return "deadline day_offset must be 0 to 366";
  if (value.offset_minutes !== undefined && !isInt(value.offset_minutes, 0, 10080)) return "deadline offset_minutes must be 0 to 10080";
  if (value.grace_minutes !== undefined && !isInt(value.grace_minutes, 0, 44640)) return "deadline grace_minutes must be 0 to 44640";
  const deadline: ScheduleDeadline = { time: value.time };
  if (value.day_offset !== undefined) deadline.day_offset = value.day_offset as number;
  if (value.offset_minutes !== undefined) deadline.offset_minutes = value.offset_minutes as number;
  if (value.grace_minutes !== undefined) deadline.grace_minutes = value.grace_minutes as number;
  return deadline;
}

function validateReminder(value: unknown): ScheduleReminder | null | string {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) return "reminder must be an object";
  const extra = unknownKeys(value, ["lead_minutes"]);
  if (extra.length > 0) return `reminder has an unknown field: ${extra[0]}`;
  if (!isInt(value.lead_minutes, 1, 86400)) return "reminder lead_minutes must be 1 to 86400";
  return { lead_minutes: value.lead_minutes };
}

function needsShortMonthPolicy(recurrence: ScheduleRecurrence) {
  if (recurrence.kind === "monthly" || recurrence.kind === "fixed_months") return recurrence.day !== "last" && recurrence.day > 28 && !recurrence.short_month;
  if (recurrence.kind === "interval_months") {
    const anchor = parseDateOnly(recurrence.anchor);
    return !!anchor && anchor.d > 28 && !recurrence.short_month;
  }
  return false;
}

function needsCalendar(recurrence: ScheduleRecurrence) {
  if (recurrence.kind === "monthly_business_day") return true;
  return recurrence.kind === "weekday_set" && recurrence.on_holiday === "skipped";
}

export function validateScheduleRule(input: unknown): ScheduleRuleValidation {
  const problems: string[] = [];
  if (!isPlainObject(input)) return { ok: false, problems: ["schedule rule must be an object"] };
  const extra = unknownKeys(input, ["rule_version", "timezone", "recurrence", "deadline", "reminder", "calendar"]);
  if (extra.length > 0) return { ok: false, problems: [`schedule rule has an unknown field: ${extra[0]}`] };
  if (input.rule_version !== SCHEDULE_RULE_VERSION) problems.push("schedule rule version must be 1");
  if (!isValidTimeZone(input.timezone)) problems.push("schedule rule timezone must be an IANA zone name");
  let calendar: HolidayCalendar | null = null;
  if (input.calendar !== undefined && input.calendar !== null) {
    const result = validateCalendar(input.calendar);
    if (typeof result === "string") problems.push(`schedule rule ${result}`);
    else calendar = result;
  }
  const recurrence = validateRecurrence(input.recurrence);
  if (typeof recurrence === "string") problems.push(`schedule rule ${recurrence}`);
  const deadline = validateDeadline(input.deadline);
  if (typeof deadline === "string") problems.push(`schedule rule ${deadline}`);
  const reminder = validateReminder(input.reminder);
  if (typeof reminder === "string") problems.push(`schedule rule ${reminder}`);
  if (typeof recurrence !== "string") {
    if (needsCalendar(recurrence) && !calendar) problems.push("schedule rule recurrence needs a calendar");
    if (needsShortMonthPolicy(recurrence)) problems.push("schedule rule recurrence needs a short_month policy");
  }
  if (problems.length > 0 || typeof recurrence === "string" || typeof deadline === "string" || typeof reminder === "string") {
    return { ok: false, problems };
  }
  const rule: ScheduleRule = { rule_version: SCHEDULE_RULE_VERSION, timezone: input.timezone as string, recurrence, deadline };
  if (reminder) rule.reminder = reminder;
  if (calendar) rule.calendar = calendar;
  return { ok: true, rule };
}

// ---------------------------------------------------------------------------
// Calendar helpers (weekend and holiday awareness).
// ---------------------------------------------------------------------------

function calendarCovers(calendar: HolidayCalendar, date: string) {
  return date >= calendar.covers_from && date <= calendar.covers_to;
}

function isBusinessDay(calendar: HolidayCalendar, date: string) {
  return !calendar.weekend.includes(weekdayOf(date)) && !calendar.holidays.includes(date);
}

function businessDaysOfMonth(calendar: HolidayCalendar, y: number, m: number): string[] | null {
  const first = formatDateOnly({ y, m, d: 1 });
  const last = formatDateOnly({ y, m, d: daysInMonth(y, m) });
  if (!calendarCovers(calendar, first) || !calendarCovers(calendar, last)) return null;
  const days: string[] = [];
  for (let d = 1; d <= daysInMonth(y, m); d += 1) {
    const date = formatDateOnly({ y, m, d });
    if (isBusinessDay(calendar, date)) days.push(date);
  }
  return days;
}

// ---------------------------------------------------------------------------
// Recurrence: does an occurrence arise on a given local date?
// ---------------------------------------------------------------------------

type DateDecision = { occurs: boolean } | { occurs: null; reason: string };

function decideDate(rule: ScheduleRule, date: string): DateDecision {
  const parts = parseDateOnly(date);
  if (!parts) return { occurs: null, reason: "date is not a calendar date" };
  const recurrence = rule.recurrence;
  switch (recurrence.kind) {
    case "weekday_set": {
      if (!recurrence.weekdays.includes(weekdayOf(date))) return { occurs: false };
      if (recurrence.on_holiday === "skipped") {
        const calendar = rule.calendar;
        if (!calendar || !calendarCovers(calendar, date)) return { occurs: null, reason: `calendar does not cover ${date}` };
        if (calendar.holidays.includes(date)) return { occurs: false };
      }
      return { occurs: true };
    }
    case "weekly":
      return { occurs: weekdayOf(date) === recurrence.weekday };
    case "monthly":
      return { occurs: resolveDayOfMonth(parts.y, parts.m, recurrence.day, recurrence.short_month) === parts.d };
    case "monthly_business_day": {
      const calendar = rule.calendar;
      if (!calendar) return { occurs: null, reason: "business-day rule requires a calendar" };
      const days = businessDaysOfMonth(calendar, parts.y, parts.m);
      if (!days) return { occurs: null, reason: `calendar does not cover ${pad(parts.y, 4)}-${pad(parts.m)}` };
      const index = recurrence.from === "start" ? recurrence.ordinal - 1 : days.length - recurrence.ordinal;
      return { occurs: index >= 0 && index < days.length && days[index] === date };
    }
    case "fixed_months": {
      if (!recurrence.months.includes(parts.m)) return { occurs: false };
      return { occurs: resolveDayOfMonth(parts.y, parts.m, recurrence.day, recurrence.short_month) === parts.d };
    }
    case "interval_months": {
      const anchor = parseDateOnly(recurrence.anchor);
      if (!anchor) return { occurs: null, reason: "anchor is not a calendar date" };
      const diff = (parts.y * 12 + parts.m) - (anchor.y * 12 + anchor.m);
      if (diff < 0 || diff % recurrence.every !== 0) return { occurs: false };
      const target = addMonthsWithPolicy(anchor, diff, recurrence.short_month);
      return { occurs: !!target && target.d === parts.d };
    }
    case "expiry":
      return { occurs: date === recurrence.expires_on };
    case "event":
      return { occurs: null, reason: "event occurrences are created by their source event" };
  }
}

/** Occurrence dates inside an inclusive local date range (at most MAX_ENUMERATION_DAYS). */
export function listOccurrenceDates(rule: ScheduleRule, fromDate: string, toDate: string): OccurrenceDates | ScheduleUnresolved {
  const from = parseDateOnly(fromDate);
  const to = parseDateOnly(toDate);
  if (!from || !to) return { kind: "unresolved", reason: "range must use calendar dates" };
  const start = toDayNumber(from);
  const end = toDayNumber(to);
  if (end < start) return { kind: "unresolved", reason: "range must start before it ends" };
  if (end - start >= MAX_ENUMERATION_DAYS) return { kind: "unresolved", reason: `range exceeds ${MAX_ENUMERATION_DAYS} days` };
  if (rule.recurrence.kind === "event") return { kind: "unresolved", reason: "event occurrences are created by their source event" };
  const dates: string[] = [];
  const unresolved: Array<{ date: string; reason: string }> = [];
  for (let cursor = start; cursor <= end; cursor += 1) {
    const date = formatDateOnly(fromDayNumber(cursor));
    const decision = decideDate(rule, date);
    if (decision.occurs === null) unresolved.push({ date, reason: decision.reason });
    else if (decision.occurs) dates.push(date);
  }
  return { kind: "resolved", dates, unresolved };
}

/** The next occurrence date on or after `fromDate`, searching at most `horizonDays`. */
export function nextOccurrenceDate(rule: ScheduleRule, fromDate: string, horizonDays = 366): { date: string } | ScheduleUnresolved {
  const listed = listOccurrenceDates(rule, fromDate, addDays(fromDate, Math.min(horizonDays, MAX_ENUMERATION_DAYS - 1)));
  if (listed.kind === "unresolved") return listed;
  if (listed.dates.length > 0) {
    const firstUnresolved = listed.unresolved[0];
    if (firstUnresolved && firstUnresolved.date < listed.dates[0]) return { kind: "unresolved", reason: firstUnresolved.reason };
    return { date: listed.dates[0] };
  }
  if (listed.unresolved.length > 0) return { kind: "unresolved", reason: listed.unresolved[0].reason };
  if (rule.recurrence.kind === "expiry") return { kind: "unresolved", reason: "expiry anchor has passed; a new expiry anchor is required" };
  return { kind: "unresolved", reason: `no occurrence within ${horizonDays} days` };
}

// ---------------------------------------------------------------------------
// Period and due instant for one occurrence.
// ---------------------------------------------------------------------------

function periodFor(rule: ScheduleRule, parts: DateParts): { start_date: string; end_date: string } {
  const date = formatDateOnly(parts);
  const recurrence = rule.recurrence;
  switch (recurrence.kind) {
    case "weekday_set":
    case "event":
    case "expiry":
      return { start_date: date, end_date: date };
    case "weekly": {
      const start = addDays(date, -weekdayIndex(parts));
      return { start_date: start, end_date: addDays(start, 6) };
    }
    case "monthly":
    case "monthly_business_day":
      return { start_date: formatDateOnly({ y: parts.y, m: parts.m, d: 1 }), end_date: formatDateOnly({ y: parts.y, m: parts.m, d: daysInMonth(parts.y, parts.m) }) };
    case "fixed_months": {
      const months = recurrence.months;
      const position = months.indexOf(parts.m);
      const nextMonth = position >= 0 && position < months.length - 1 ? months[position + 1] : months[0] + 12;
      const span = nextMonth - parts.m;
      const end = addMonthsWithPolicy({ y: parts.y, m: parts.m, d: 1 }, span, "clamp") as DateParts;
      return { start_date: formatDateOnly({ y: parts.y, m: parts.m, d: 1 }), end_date: addDays(formatDateOnly(end), -1) };
    }
    case "interval_months": {
      // The period runs to the next occurrence computed from the anchor (not
      // from this clamped date), skipping months the policy produces none in.
      const anchor = parseDateOnly(recurrence.anchor) as DateParts;
      const diff = (parts.y * 12 + parts.m) - (anchor.y * 12 + anchor.m);
      let next: DateParts | null = null;
      for (let step = diff + recurrence.every; next === null && step <= diff + recurrence.every * 12; step += recurrence.every) {
        next = addMonthsWithPolicy(anchor, step, recurrence.short_month);
      }
      const fallback = addMonthsWithPolicy(parts, recurrence.every, "clamp") as DateParts;
      return { start_date: date, end_date: addDays(formatDateOnly(next ?? fallback), -1) };
    }
  }
}

export type ResolveOccurrenceOptions = {
  /** Required for event rules: the source event instant (ISO 8601). */
  eventAt?: string;
};

/**
 * Period bounds, due instant, grace end and reminder instant for the
 * occurrence on `occurrenceDate` (facility-local calendar date). Returns an
 * unresolved result when the rule does not produce an occurrence on that
 * date or cannot decide.
 */
export function resolveOccurrence(rule: ScheduleRule, occurrenceDate: string, options: ResolveOccurrenceOptions = {}): ScheduleOccurrence | ScheduleUnresolved {
  let date = occurrenceDate;
  if (rule.recurrence.kind === "event") {
    if (!options.eventAt) return { kind: "unresolved", reason: "event occurrences require the source event instant" };
    const eventInstant = new Date(options.eventAt);
    if (Number.isNaN(eventInstant.getTime())) return { kind: "unresolved", reason: "event instant is not a timestamp" };
    date = localDateOf(eventInstant, rule.timezone);
  } else {
    const decision = decideDate(rule, date);
    if (decision.occurs === null) return { kind: "unresolved", reason: decision.reason };
    if (!decision.occurs) return { kind: "unresolved", reason: `no occurrence on ${date}` };
  }
  const parts = parseDateOnly(date);
  if (!parts) return { kind: "unresolved", reason: "date is not a calendar date" };
  const [hh, mi] = rule.deadline.time.split(":").map(Number);
  const dueDate = addDays(date, rule.deadline.day_offset ?? 0);
  const zoned = zonedTimeToInstant(dueDate, hh, mi, rule.timezone);
  const dueAt = new Date(zoned.instant.getTime() + (rule.deadline.offset_minutes ?? 0) * 60000);
  const grace = rule.deadline.grace_minutes ?? 0;
  const adjustments = zoned.adjustment ? [zoned.adjustment] : [];
  return {
    kind: "resolved",
    evaluator_version: SCHEDULE_EVALUATOR_VERSION,
    occurrence_date: date,
    period: periodFor(rule, parts),
    due_at: dueAt.toISOString(),
    grace_ends_at: grace > 0 ? new Date(dueAt.getTime() + grace * 60000).toISOString() : null,
    remind_at: rule.reminder ? new Date(dueAt.getTime() - rule.reminder.lead_minutes * 60000).toISOString() : null,
    timezone: rule.timezone,
    adjustments,
  };
}

/** Upcoming occurrences with their due instants, for next-due displays and previews. */
export function previewOccurrences(rule: ScheduleRule, fromDate: string, count: number, horizonDays = 366): { kind: "resolved"; occurrences: ScheduleOccurrence[]; unresolved: Array<{ date: string; reason: string }> } | ScheduleUnresolved {
  const listed = listOccurrenceDates(rule, fromDate, addDays(fromDate, Math.min(horizonDays, MAX_ENUMERATION_DAYS - 1)));
  if (listed.kind === "unresolved") return listed;
  const occurrences: ScheduleOccurrence[] = [];
  for (const date of listed.dates.slice(0, Math.max(0, count))) {
    const occurrence = resolveOccurrence(rule, date);
    if (occurrence.kind === "resolved") occurrences.push(occurrence);
  }
  return { kind: "resolved", occurrences, unresolved: listed.unresolved };
}

// ---------------------------------------------------------------------------
// Due judgment for an existing task. The only place a task becomes overdue.
// ---------------------------------------------------------------------------

export const OPEN_TASK_STATUSES = ["pending", "in_progress"] as const;

export function judgeDue(args: { dueAt: string | null | undefined; status: string; now: Date; timeZone: string }): DueJudgment {
  if (!(OPEN_TASK_STATUSES as readonly string[]).includes(args.status)) return { judgment: "settled", days_overdue: 0 };
  if (!args.dueAt) return { judgment: "unknown", days_overdue: null };
  const due = new Date(args.dueAt);
  if (Number.isNaN(due.getTime())) return { judgment: "unknown", days_overdue: null };
  if (due.getTime() >= args.now.getTime()) return { judgment: "not_due", days_overdue: 0 };
  const timeZone = isValidTimeZone(args.timeZone) ? args.timeZone : "UTC";
  const dueDay = toDayNumber(localPartsOf(due, timeZone));
  const nowDay = toDayNumber(localPartsOf(args.now, timeZone));
  return { judgment: "overdue", days_overdue: Math.max(1, nowDay - dueDay) };
}

// ---------------------------------------------------------------------------
// Legacy template translation. Existing operation_task_templates carry
// cadence columns and an escalation ladder; the scheduler used to derive its
// due instant from them with its own arithmetic. This translation expresses
// the same timing as a version-1 rule so the scheduler shares the evaluator.
// It preserves the recorded behaviour (shift base times, first enabled SLA
// or the estimate floor as the deadline offset, month-end clamping) and does
// not approve any COL rule; on-demand and event-driven templates stay
// unresolved.
// ---------------------------------------------------------------------------

export type LegacyTemplateTiming = {
  cadence_type: string;
  day_of_week: number | null;
  day_of_month: number | null;
  month_of_year: number | null;
  estimated_minutes: number | null;
  escalation_ladder: Array<{ sla_minutes?: number; enabled?: boolean }> | null;
};

export type LegacyShift = "day" | "evening" | "night" | null;

export function legacyShiftBaseTime(shift: LegacyShift) {
  if (shift === "day") return "07:00";
  if (shift === "evening") return "15:00";
  if (shift === "night") return "23:00";
  return "09:00";
}

export function legacyTemplateRule(template: LegacyTemplateTiming, shift: LegacyShift, timeZone: string): { kind: "rule"; rule: ScheduleRule } | ScheduleUnresolved {
  if (!isValidTimeZone(timeZone)) return { kind: "unresolved", reason: "facility timezone is not an IANA zone name" };
  const ladder = Array.isArray(template.escalation_ladder) ? template.escalation_ladder : [];
  const firstStep = ladder.find((step) => step && step.enabled !== false && typeof step.sla_minutes === "number");
  const offsetMinutes = firstStep?.sla_minutes ?? Math.max(template.estimated_minutes ?? 0, 60);
  const deadline: ScheduleDeadline = { time: legacyShiftBaseTime(shift), offset_minutes: Math.max(0, Math.min(10080, Math.round(offsetMinutes))) };
  let recurrence: ScheduleRecurrence;
  switch (template.cadence_type) {
    case "daily":
      recurrence = { kind: "weekday_set", weekdays: [...WEEKDAYS] };
      break;
    case "weekly": {
      const weekday = template.day_of_week;
      if (!isInt(weekday, 1, 7)) return { kind: "unresolved", reason: "weekly template has no weekday" };
      recurrence = { kind: "weekly", weekday: WEEKDAYS[weekday - 1] };
      break;
    }
    case "monthly":
      recurrence = { kind: "monthly", day: isInt(template.day_of_month, 1, 31) ? template.day_of_month : 1, short_month: "clamp" };
      break;
    case "quarterly":
      recurrence = { kind: "fixed_months", months: [1, 4, 7, 10], day: isInt(template.day_of_month, 1, 31) ? template.day_of_month : 1, short_month: "clamp" };
      break;
    case "yearly":
      recurrence = { kind: "fixed_months", months: [isInt(template.month_of_year, 1, 12) ? template.month_of_year : 1], day: 1 };
      break;
    default:
      return { kind: "unresolved", reason: `${template.cadence_type} templates have no recurrence` };
  }
  const validated = validateScheduleRule({ rule_version: SCHEDULE_RULE_VERSION, timezone: timeZone, recurrence, deadline });
  if (!validated.ok) return { kind: "unresolved", reason: validated.problems[0] ?? "legacy template timing is invalid" };
  return { kind: "rule", rule: validated.rule };
}
