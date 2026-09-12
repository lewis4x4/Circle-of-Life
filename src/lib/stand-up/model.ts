import { legacyOvertimeToMinutes, formatOvertimeMinutes } from './duration'

export const METRICS = [
  { key: 'monthly_rent_roll_cents', label: 'Monthly rent roll', section: 'Census and rent' },
  { key: 'current_total_census', label: 'Current census', section: 'Census and rent' },
  { key: 'sp_female_beds_open', label: 'Semi-private female beds open', section: 'Beds' },
  { key: 'sp_male_beds_open', label: 'Semi-private male beds open', section: 'Beds' },
  { key: 'sp_flexible_beds_open', label: 'Semi-private flexible beds open', section: 'Beds' },
  { key: 'private_beds_open', label: 'Private beds open', section: 'Beds' },
  { key: 'admissions_expected', label: 'Expected admissions this week', section: 'Admissions' },
  { key: 'hospital_and_rehab_total', label: 'Residents at hospital or rehab', section: 'Admissions' },
  { key: 'expected_discharges', label: 'Expected discharges this week', section: 'Admissions' },
  { key: 'callouts_last_week', label: 'Callouts last week', section: 'Staffing — last Monday–Sunday' },
  { key: 'terminations_last_week', label: 'Terminations last week', section: 'Staffing — last Monday–Sunday' },
  { key: 'current_open_positions', label: 'Open positions last week', section: 'Staffing — last Monday–Sunday' },
  { key: 'overtime_reported', label: 'Overtime last week', section: 'Staffing — last Monday–Sunday' },
  { key: 'tours_expected', label: 'Expected tours this week', section: 'Marketing' },
  { key: 'provider_activities_expected', label: 'Home-health activities this week', section: 'Marketing' },
  { key: 'outreach_engagements', label: 'Outreach and engagements this week', section: 'Marketing' },
] as const
export type MetricKey = typeof METRICS[number]['key']
export const METRIC_KEYS: MetricKey[] = METRICS.map(metric => metric.key)
export type StandUpValues = Record<MetricKey, number | null>
export type StandUpReport = { id: string; facility_id: string; week_start: string; version: number; revision_id: string; values: StandUpValues; status: 'draft' | 'ready'; updated_at: string; source_as_of?: string | null; overtime_minutes?: number | null; overtime_issue?: boolean; entry_origin?: 'imported' | 'manual' | 'recovery' | 'initialized'; updated_by?: string | null; updated_by_name?: string | null; first_submitted_at?: string | null; last_submitted_at?: string | null; last_submitted_revision_id?: string | null; field_dispositions?: Record<string, string> }
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
export function reportingWeek(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find(part => part.type === type)!.value
  const day = new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() + (day.getUTCDay() === 0 ? 1 : 1 - day.getUTCDay()))
  return day.toISOString().slice(0, 10)
}
export function derivedValues(values: StandUpValues) {
  const beds = [values.sp_female_beds_open, values.sp_male_beds_open, values.sp_flexible_beds_open, values.private_beds_open]
  return { average_rent_cents: values.monthly_rent_roll_cents !== null && values.current_total_census !== null && values.current_total_census > 0 ? Math.round(values.monthly_rent_roll_cents / values.current_total_census) : null,
    total_beds_open: beds.every(value => value !== null) ? beds.reduce<number>((sum, value) => sum + value!, 0) : null,
    // A held raw notation is evidence, not a provided figure; it never counts.
    completed_fields: METRIC_KEYS.filter(key => values[key] !== null && (key !== 'overtime_reported' || validOvertime(values[key]))).length }
}
function validOvertime(value: number | null): boolean { try { legacyOvertimeToMinutes(value); return true } catch { return false } }
/** True when the stored overtime cannot be read as whole hours and minutes. */
export function overtimeNeedsReview(report: StandUpReport | undefined): boolean {
  if (!report) return false
  return !!report.overtime_issue || !validOvertime(report.values.overtime_reported)
}
function notStarted(report: StandUpReport | undefined): boolean {
  return !report || (report.entry_origin === 'initialized' && derivedValues(report.values).completed_fields === 0)
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
export function easternTime(value: string): string { return new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
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
