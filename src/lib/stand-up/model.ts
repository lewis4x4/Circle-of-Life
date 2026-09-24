import { legacyOvertimeToMinutes, formatOvertimeMinutes } from './duration'
import type { RosterConfirmations } from './roster-census'

/**
 * Three different time frames share this one report, so every section declares
 * which one it belongs to: `current` is the state of the ALF while the
 * administrator prepares the report, `completed` is the closed Monday–Sunday
 * payroll week, and `expected` is a forecast for the reporting week ahead.
 * A previous `expected` figure is last week's forecast, never an actual result.
 */
export const SECTIONS = [
  { key: 'census', label: 'Census and rent', period: 'current' },
  { key: 'beds', label: 'Beds', period: 'current' },
  { key: 'admissions', label: 'Admissions and discharges', period: 'expected' },
  { key: 'staffing', label: 'Staffing and payroll', period: 'completed' },
  { key: 'marketing', label: 'Marketing', period: 'expected' },
] as const
export type StandUpSection = typeof SECTIONS[number]
export type SectionKey = StandUpSection['key']
export type SectionPeriod = StandUpSection['period']

export const METRICS = [
  { key: 'monthly_rent_roll_cents', label: 'Monthly rent roll', section: 'census' },
  { key: 'current_total_census', label: 'Current census', section: 'census' },
  // A current count, kept out of the forecast fields it used to sit between.
  { key: 'hospital_and_rehab_total', label: 'Residents at hospital or rehab', section: 'census' },
  { key: 'sp_female_beds_open', label: 'Semi-private female beds open', section: 'beds' },
  { key: 'sp_male_beds_open', label: 'Semi-private male beds open', section: 'beds' },
  { key: 'sp_flexible_beds_open', label: 'Semi-private flexible beds open', section: 'beds' },
  { key: 'private_beds_open', label: 'Private beds open', section: 'beds' },
  { key: 'admissions_expected', label: 'Expected admissions this week', section: 'admissions' },
  { key: 'expected_discharges', label: 'Expected discharges this week', section: 'admissions' },
  { key: 'callouts_last_week', label: 'Callouts last week', section: 'staffing' },
  { key: 'terminations_last_week', label: 'Terminations last week', section: 'staffing' },
  { key: 'current_open_positions', label: 'Open positions last week', section: 'staffing' },
  { key: 'overtime_reported', label: 'Overtime last week', section: 'staffing' },
  { key: 'tours_expected', label: 'Expected tours this week', section: 'marketing' },
  { key: 'provider_activities_expected', label: 'Home-health activities this week', section: 'marketing' },
  { key: 'outreach_engagements', label: 'Outreach and engagements this week', section: 'marketing' },
] as const
export type MetricKey = typeof METRICS[number]['key']
export const sectionMetrics = (section: SectionKey) => METRICS.filter(metric => metric.section === section)
export const metricSection = (key: MetricKey): StandUpSection => SECTIONS.find(section => section.key === METRICS.find(metric => metric.key === key)!.section)!
export const METRIC_KEYS: MetricKey[] = METRICS.map(metric => metric.key)
export type StandUpValues = Record<MetricKey, number | null>
export type StandUpReport = { id: string; facility_id: string; week_start: string; version: number; revision_id: string; values: StandUpValues; status: 'draft' | 'ready'; updated_at: string; /** COL-298: the save carried no figures, so no report row exists. */ not_started?: boolean; source_as_of?: string | null; overtime_minutes?: number | null; overtime_issue?: boolean; entry_origin?: 'imported' | 'manual' | 'recovery' | 'initialized'; updated_by?: string | null; updated_by_name?: string | null; first_submitted_at?: string | null; last_submitted_at?: string | null; last_submitted_revision_id?: string | null; /** COL-797: who made the last submission. */ last_submitted_by?: string | null; field_dispositions?: Record<string, string>; roster_confirmations?: RosterConfirmations }
/** Shared vocabulary: docs/specs/26-stand-up-field-state-vocabulary.md. One token per metric per report. */
export const FIELD_STATES = ['provided', 'not_provided', 'held_unit_unconfirmed', 'needs_duration_review', 'source_held', 'no_report'] as const
export type FieldState = typeof FIELD_STATES[number]
export const FIELD_STATE_VERSION = 1
export const FIELD_STATE_CODES: Record<Exclude<FieldState, 'no_report'>, number> = { provided: 0, not_provided: 1, held_unit_unconfirmed: 2, needs_duration_review: 3, source_held: 4 }
export const FIELD_STATE_TEXT: Record<Exclude<FieldState, 'provided'>, string> = { not_provided: 'Not provided', held_unit_unconfirmed: 'Held: unit unconfirmed', needs_duration_review: 'Needs duration review', source_held: 'Source held for review', no_report: 'No report' }
export const HELD_UNIT_DISPOSITION = 'historical_unit_unconfirmed'
/** Outage fallback named in the recovery section and on the sign-in page. */
export const STAND_UP_WORKBOOK_URL = 'https://docs.google.com/spreadsheets/d/1rUozaY9YLhD77lS_jjdRbUW2LsdvgS1r/edit'
export const STAND_UP_WORKBOOK_LINK_TEXT = 'Open the shared Stand Up workbook'
export const STAND_UP_OUTAGE_BACKUP_TEXT = 'No internet: use the JSON or CSV backup you downloaded last week.'
export const REPORT_STATES = ['Not started', 'Draft', 'Imported, awaiting review', 'Submitted', 'Changes awaiting resubmission'] as const
export function emptyValues(): StandUpValues { return Object.fromEntries(METRIC_KEYS.map(key => [key, null])) as StandUpValues }
export function validateValues(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['Values must be an object.']
  const values = input as Record<string, unknown>
  const errors: string[] = []
  if (Object.keys(values).length !== METRIC_KEYS.length || Object.keys(values).some(key => !METRIC_KEYS.includes(key as MetricKey))) errors.push('Include exactly the sixteen supported metrics.')
  for (const key of METRIC_KEYS) {
    const value = values[key]
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2147483647 || (key !== 'overtime_reported' && !Number.isSafeInteger(value)))) errors.push(`${METRICS.find(metric => metric.key === key)?.label}: enter a nonnegative ${key === 'overtime_reported' ? 'number' : 'whole number'} or leave blank.`)
  }
  if (typeof values.overtime_reported === 'number') {
    try { legacyOvertimeToMinutes(values.overtime_reported) } catch { errors.push('Overtime: enter whole hours and minutes from 0 to 59.') }
  }
  return errors
}
/**
 * The one entry-window model. Every surface that needs to know when a Monday
 * report opens, closes, or is being read late asks this file; nothing else in
 * Haven states an open weekday or an open hour. The mirror in SQL is
 * `public.stand_up_entry_opens_at`, which is what the server actually enforces.
 *
 * All five ALFs keep Eastern wall clock, so every boundary is built by placing a
 * wall-clock time in America/New_York and resolving it to an instant. A lead is
 * wall-clock minutes before the Monday 8:45 a.m. deadline, not elapsed minutes:
 * on the November fall-back weekend a Sunday 12:00 a.m. open is still Sunday
 * 12:00 a.m., even though 33 hours 45 minutes pass before the deadline.
 */
export const STAND_UP_DEADLINE_MINUTES = 8 * 60 + 45
export const STAND_UP_CALL_MINUTES = 9 * 60 + 15
/** Sunday 12:00 a.m. Eastern. Null on a facility means this constant. */
export const STAND_UP_DEFAULT_ENTRY_OPEN_LEAD_MINUTES = 1965
/** Monday 7:45 a.m. Eastern: the window never opens after the report is nearly due. */
export const STAND_UP_ENTRY_OPEN_LEAD_MIN = 60
/** Saturday 12:00 a.m. Eastern: the window never reaches back into the prior Monday's meeting. */
export const STAND_UP_ENTRY_OPEN_LEAD_MAX = 3405
export const STAND_UP_ENTRY_OPEN_CHOICES = [
  { minutes: 3405, label: 'Saturday 12:00 a.m.' },
  { minutes: 1965, label: 'Sunday 12:00 a.m.' },
  { minutes: 885, label: 'Sunday 6:00 p.m.' },
  { minutes: 525, label: 'Monday 12:00 a.m.' },
] as const
export type StandUpEntryOpenChoice = typeof STAND_UP_ENTRY_OPEN_CHOICES[number]
export type StandUpEntryState = 'not_open' | 'open' | 'past_deadline'
export type StandUpEntryWindow = {
  opensAt: Date; deadlineAt: Date; callAt: Date
  staffingPeriodStart: Date; staffingPeriodEnd: Date
  leadMinutes: number; state: StandUpEntryState
}

export function isEntryOpenLeadMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= STAND_UP_ENTRY_OPEN_LEAD_MIN && value <= STAND_UP_ENTRY_OPEN_LEAD_MAX
}
/** Null, undefined and out-of-range values all fall back to the code default. */
export function entryOpenLeadMinutes(value?: number | null): number {
  return isEntryOpenLeadMinutes(value) ? value : STAND_UP_DEFAULT_ENTRY_OPEN_LEAD_MINUTES
}

const easternParts = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(value)
/** Minutes that America/New_York is ahead of UTC at this instant (negative). */
function easternOffsetMinutes(instant: number): number {
  const parts = easternParts(new Date(instant))
  const get = (type: string) => Number(parts.find(part => part.type === type)!.value)
  return (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant) / 60000
}
/**
 * The instant of an Eastern wall-clock time. Two passes settle the spring-forward
 * and fall-back hours, where the first offset guess belongs to the other side of
 * the transition. Never UTC plus a fixed offset.
 */
export function easternInstant(day: string, minutesFromMidnight: number): Date {
  const [year, month, date] = day.split('-').map(Number)
  const wall = Date.UTC(year, month - 1, date) + minutesFromMidnight * 60000
  const first = wall - easternOffsetMinutes(wall) * 60000
  return new Date(wall - easternOffsetMinutes(first) * 60000)
}
/** The Eastern calendar date of an instant, as YYYY-MM-DD. */
export function easternDay(now: Date): string {
  const parts = easternParts(now)
  const get = (type: string) => parts.find(part => part.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
const mondayOf = (day: string): string => {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
  return shiftDay(day, weekday === 0 ? -6 : 1 - weekday)
}

/**
 * When a facility's entry window opens for one meeting Monday. A lead is counted
 * back from Monday 8:45 a.m. in calendar terms, so 1,965 lands on Sunday 12:00
 * a.m. in both standard and daylight time.
 */
export function standUpEntryOpensAt(meetingMonday: string, leadMinutes?: number | null): Date {
  const fromMidnight = STAND_UP_DEADLINE_MINUTES - entryOpenLeadMinutes(leadMinutes)
  const days = Math.floor(fromMidnight / 1440)
  return easternInstant(shiftDay(meetingMonday, days), fromMidnight - days * 1440)
}

export function getStandUpEntryWindow(input: { meetingMonday: string; leadMinutes?: number | null; now: Date }): StandUpEntryWindow {
  const leadMinutes = entryOpenLeadMinutes(input.leadMinutes)
  const opensAt = standUpEntryOpensAt(input.meetingMonday, leadMinutes)
  const deadlineAt = easternInstant(input.meetingMonday, STAND_UP_DEADLINE_MINUTES)
  return {
    opensAt, deadlineAt, leadMinutes,
    callAt: easternInstant(input.meetingMonday, STAND_UP_CALL_MINUTES),
    staffingPeriodStart: easternInstant(shiftDay(input.meetingMonday, -7), 0),
    // Exclusive: the payroll week runs through the Sunday 11:59 p.m. before this meeting.
    staffingPeriodEnd: easternInstant(input.meetingMonday, 0),
    state: input.now < opensAt ? 'not_open' : input.now >= deadlineAt ? 'past_deadline' : 'open',
  }
}

/**
 * The meeting Monday a facility may enter right now: the latest Monday whose
 * window has opened. With the default lead that is the upcoming Monday from
 * Sunday 12:00 a.m. Eastern, which is the behaviour Haven has always had.
 */
export function standUpOpenWeek(input: { now?: Date; leadMinutes?: number | null } = {}): string {
  const now = input.now ?? new Date()
  const monday = mondayOf(easternDay(now))
  // A lead of at most 3,405 minutes reaches back two days, so the open week is
  // always the upcoming Monday, this one, or the previous one.
  const previous = shiftDay(monday, -7)
  for (const candidate of [shiftDay(monday, 7), monday]) {
    if (now >= standUpEntryOpensAt(candidate, input.leadMinutes)) return candidate
  }
  return previous
}

/** The organization-default open week. Facility overrides use standUpOpenWeek. */
export function reportingWeek(now = new Date()): string { return standUpOpenWeek({ now }) }

/** "Opens Sunday 12:00 a.m. · Due Monday 8:45 a.m. · Call 9:15 a.m. Eastern" */
export function entryWindowLine(leadMinutes?: number | null): string {
  return `Opens ${entryOpenLabel(leadMinutes)} · Due Monday 8:45 a.m. · Call 9:15 a.m. Eastern`
}
/** The weekday-and-time name of an open, matching the management choices. */
export function entryOpenLabel(leadMinutes?: number | null): string {
  const lead = entryOpenLeadMinutes(leadMinutes)
  const choice = STAND_UP_ENTRY_OPEN_CHOICES.find(item => item.minutes === lead)
  if (choice) return choice.label
  const opens = standUpEntryOpensAt('2026-09-21', lead)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(opens).replace(' AM', ' a.m.').replace(' PM', ' p.m.').replace(' at ', ' ')
}
/** "Sunday, September 20 at 12:00 a.m. Eastern" for the before-open line. */
export function entryOpensStamp(meetingMonday: string, leadMinutes?: number | null): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(standUpEntryOpensAt(meetingMonday, leadMinutes))
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('weekday')}, ${part('month')} ${part('day')} at ${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase() === 'am' ? 'a.m.' : 'p.m.'} Eastern`
}
export function derivedValues(values: StandUpValues) {
  const beds = [values.sp_female_beds_open, values.sp_male_beds_open, values.sp_flexible_beds_open, values.private_beds_open]
  return { average_rent_cents: values.monthly_rent_roll_cents !== null && values.current_total_census !== null && values.current_total_census > 0 ? Math.round(values.monthly_rent_roll_cents / values.current_total_census) : null,
    total_beds_open: beds.every(value => value !== null) ? beds.reduce<number>((sum, value) => sum + value!, 0) : null,
    // A held raw notation is evidence, not a provided figure; it never counts.
    completed_fields: METRIC_KEYS.filter(key => values[key] !== null && (key !== 'overtime_reported' || validOvertime(values[key]))).length }
}
export type DerivedFigures = ReturnType<typeof derivedValues>
function validOvertime(value: number | null): boolean { try { legacyOvertimeToMinutes(value); return true } catch { return false } }
/** True when the stored overtime cannot be read as whole hours and minutes. */
export function overtimeNeedsReview(report: StandUpReport | undefined): boolean {
  if (!report) return false
  return !!report.overtime_issue || !validOvertime(report.values.overtime_reported)
}
/**
 * Whether any of the sixteen figures has been entered. A held or unreadable
 * overtime notation still counts as something entered, even though it is not a
 * countable provided figure: evidence exists, so the report is not untouched.
 */
export function reportHasFigures(report: StandUpReport | undefined): boolean {
  return !!report && METRIC_KEYS.some(key => report.values[key] !== null)
}
/**
 * COL-298: a report with nothing in it is nothing, whatever row happens to
 * exist behind it. A week opened and abandoned before this fix left a real row
 * with sixteen blanks; it reads as never started rather than as a Draft, and it
 * is not counted as work in progress anywhere.
 */
function notStarted(report: StandUpReport | undefined): boolean {
  return !reportHasFigures(report)
}
export function fieldState(report: StandUpReport | undefined, key: MetricKey): FieldState {
  if (notStarted(report)) return 'no_report'
  if (key === 'overtime_reported' && overtimeNeedsReview(report)) return 'needs_duration_review'
  if (report!.values[key] === null) return report!.field_dispositions?.[key] === HELD_UNIT_DISPOSITION ? 'held_unit_unconfirmed' : 'not_provided'
  return 'provided'
}
/** The value when provided, otherwise the vocabulary text for why it is absent. */
export function fieldDisplay(report: StandUpReport | undefined, key: MetricKey): string {
  const state = fieldState(report, key)
  return state === 'provided' ? metricDisplay(key, report!.values[key]) : FIELD_STATE_TEXT[state]
}

export const dollars = (cents: number | null) => cents === null ? 'Not provided' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
export function reportOvertimeMinutes(report: StandUpReport): number | null {
  if (report.overtime_issue) return null
  try {
    const minutes = legacyOvertimeToMinutes(report.values.overtime_reported)
    if (report.overtime_minutes !== undefined && report.overtime_minutes !== minutes) return null
    return minutes
  } catch { return null }
}
export function metricDisplay(key: MetricKey, value: number | null): string {
  if (key === 'monthly_rent_roll_cents') return dollars(value)
  if (key === 'overtime_reported') {
    try { return formatOvertimeMinutes(legacyOvertimeToMinutes(value)) } catch { return 'Needs duration review' }
  }
  return value === null ? 'Not provided' : value.toLocaleString('en-US')
}
export function reportState(report?: StandUpReport): typeof REPORT_STATES[number] {
  if (notStarted(report)) return 'Not started'
  if (report!.status === 'ready') return 'Submitted'
  if (report!.last_submitted_at) return 'Changes awaiting resubmission'
  if (report!.entry_origin === 'imported') return 'Imported, awaiting review'
  return 'Draft'
}
export function dateLabel(day: string, weekday = false): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...(weekday ? { weekday: 'long' as const } : {}), month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`))
}
export function shiftDay(day: string, count: number): string {
  const value = new Date(`${day}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + count); return value.toISOString().slice(0, 10)
}
export function staffingPeriod(week: string): string { return `${dateLabel(shiftDay(week, -7))}–${dateLabel(shiftDay(week, -1))}` }
const monthDay = (day: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`))
/** Compact inclusive range for a section period label: "September 7–13, 2026". */
export function periodRange(start: string, end: string): string {
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${dateLabel(start)} – ${dateLabel(end)}`
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  const finish = sameMonth ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: 'numeric' }).format(new Date(`${end}T12:00:00Z`)) : monthDay(end)
  return `${monthDay(start)}${sameMonth ? '–' : ' – '}${finish}, ${end.slice(0, 4)}`
}
/**
 * The period a section covers, stated prominently enough that it is not skimmed
 * past, and worded so it still reads correctly on a past meeting's report.
 *
 * The owner settled the `current` as-of point on 2026-09-15 (COL-374): these
 * figures describe the ALF as it stands Monday morning, the state the week
 * starts from. That is the moment the report is saved, so the section names
 * Monday morning and then carries `source_as_of` — the time Haven recorded the
 * figures, stamped by `haven.stand_up_save` on every save of the open period,
 * or passed by the hosted connector as the time it read the workbook. Each ALF
 * saves at its own minute, so the recorded time is shown rather than implied.
 * An open report without a stamp is simply not saved yet; a historical report
 * without one has no recorded time, and the label never invents one from the
 * reader's clock. Correcting a past week keeps whatever time was recorded then
 * (COL-395, migration 416), so "No recorded time" on a historical report means
 * none was ever recorded rather than that a correction dropped it.
 */
export function sectionPeriodLabel(section: StandUpSection, week: string, asOf?: string | null, open = false): string {
  if (section.period === 'completed') return `Completed week · ${periodRange(shiftDay(week, -7), shiftDay(week, -1))}`
  if (section.period === 'expected') return `Forecast week · ${periodRange(week, shiftDay(week, 6))}`
  return `Monday morning · ${asOf ? `Figures recorded ${easternStamp(asOf)}` : open ? 'Figures recorded when you save' : 'No recorded time'}`
}
export function easternTime(value: string): string { return new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
/** Full attribution stamp: "September 14 at 8:31 a.m. Eastern". */
export function easternStamp(value: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(value))
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('month')} ${part('day')} at ${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase() === 'am' ? 'a.m.' : 'p.m.'} Eastern`
}
export function deadlinePassed(week: string, now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (key: string) => parts.find(part => part.type === key)!.value
  const today = `${get('year')}-${get('month')}-${get('day')}`
  return today > week || (today === week && `${get('hour')}:${get('minute')}` >= '08:45')
}

/** Imported history cannot establish when an administrator submitted a report. */
export function reportDeadlineState(report: StandUpReport | undefined, week: string, currentWeek: string, now: Date): 'past_target' | 'timing_unknown' | 'none' {
  if (week !== currentWeek) return 'none'
  if (!report) return deadlinePassed(week, now) ? 'past_target' : 'none'
  const capturedSubmission = !!(report.first_submitted_at || report.last_submitted_at)
  if (report.status === 'ready' && capturedSubmission) return 'none'
  if (report.status !== 'ready' && (report.entry_origin === 'initialized' || derivedValues(report.values).completed_fields === 0)) return deadlinePassed(week, now) ? 'past_target' : 'none'
  if (!capturedSubmission && (!report.entry_origin || report.entry_origin === 'imported')) return 'timing_unknown'
  const tracked = capturedSubmission || report.entry_origin === 'manual' || report.entry_origin === 'recovery'
  return tracked && report.status !== 'ready' && deadlinePassed(week, now) ? 'past_target' : 'none'
}
