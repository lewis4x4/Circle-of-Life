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
  { key: 'overtime_reported', label: 'Overtime reported (unit awaiting confirmation)', section: 'Staffing — last Monday–Sunday' },
  { key: 'tours_expected', label: 'Expected tours this week', section: 'Marketing' },
  { key: 'provider_activities_expected', label: 'Home-health activities this week', section: 'Marketing' },
  { key: 'outreach_engagements', label: 'Outreach and engagements this week', section: 'Marketing' },
] as const
export type MetricKey = typeof METRICS[number]['key']
export const METRIC_KEYS: MetricKey[] = METRICS.map(metric => metric.key)
export type StandUpValues = Record<MetricKey, number | null>
export type StandUpReport = { id: string; facility_id: string; week_start: string; version: number; revision_id: string; values: StandUpValues; status: 'draft' | 'ready'; updated_at: string; source_as_of?: string | null }
export function emptyValues(): StandUpValues { return Object.fromEntries(METRIC_KEYS.map(key => [key, null])) as StandUpValues }
export function validateValues(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['Values must be an object.']
  const values = input as Record<string, unknown>
  const errors: string[] = []
  if (Object.keys(values).length !== METRIC_KEYS.length || Object.keys(values).some(key => !METRIC_KEYS.includes(key as MetricKey))) errors.push('Include exactly the sixteen supported metrics.')
  for (const key of METRIC_KEYS) {
    const value = values[key]
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2147483647 || (key !== 'overtime_reported' && !Number.isSafeInteger(value)))) errors.push(`${key}: enter a nonnegative ${key === 'overtime_reported' ? 'number' : 'whole number'} or leave blank.`)
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
    completed_fields: METRIC_KEYS.filter(key => values[key] !== null).length }
}
