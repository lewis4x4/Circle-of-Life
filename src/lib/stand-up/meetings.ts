import type { RosterConfirmations } from './roster-census'
/**
 * Stand Up meets more than once a week (COL-749 / COL-752). Monday is the weekly
 * report in `model.ts`; every other meeting has its own short figure set, read
 * and written through `stand_up_command` with a `meeting_day`.
 *
 * Nothing here states a weekday or a time. When a meeting opens, is due and
 * meets comes from the runtime schedule the server returns
 * (`public.stand_up_meeting_schedule`); this file only words it.
 */
import { easternStamp } from './model'

export const MEETING_DAYS = ['monday', 'thursday'] as const
export type MeetingDay = typeof MEETING_DAYS[number]
export const MEETING_LABELS: Record<MeetingDay, string> = { monday: 'Monday', thursday: 'Thursday' }
export const isMeetingDay = (value: unknown): value is MeetingDay => MEETING_DAYS.includes(value as MeetingDay)

/**
 * Thursday's figures (COL-749 ruling 5): "the current A/R, current census,
 * depatures, and hosptial stays". Each names the Monday figure it is compared
 * with; departures have none, because Monday reports expected discharges, not
 * departures. The server holds the same list in `haven.stand_up_meeting_keys`.
 */
export const THURSDAY_FIGURES = [
  { key: 'current_ar_cents', label: 'Current A/R', money: true, mondayKey: 'monthly_rent_roll_cents', help: 'Everything owed if every resident pays, as it stands this morning.' },
  { key: 'current_total_census', label: 'Current census', money: false, mondayKey: 'current_total_census', help: 'Residents holding a bed this morning, including anyone away whose bed is held.' },
  { key: 'departures_since_monday', label: 'Departures since Monday', money: false, mondayKey: null, help: 'Residents who left since Monday’s call: discharges and deaths.' },
  { key: 'hospital_and_rehab_total', label: 'Residents at hospital or rehab', money: false, mondayKey: 'hospital_and_rehab_total', help: 'Residents away at a hospital or in rehab this morning. Their bed is held, so they stay on census.' },
  // COL-755: counted apart. Monday reports only the total, so neither has a Monday figure.
  { key: 'hospital_total', label: 'At a hospital', money: false, mondayKey: null, help: 'Of those, residents at a hospital this morning.' },
  { key: 'rehab_total', label: 'In rehab', money: false, mondayKey: null, help: 'Of those, residents in rehab this morning. A stay whose type was never recorded is in the total only.' },
] as const
export type ThursdayKey = typeof THURSDAY_FIGURES[number]['key']
export type ThursdayValues = Record<ThursdayKey, number | null>
export const THURSDAY_KEYS: ThursdayKey[] = THURSDAY_FIGURES.map(figure => figure.key)

export type MeetingWindow = { week_start: string; meeting_date: string; entry_opens_at: string | null; entry_due_at: string; call_at: string }
export type MeetingScheduleEntry = { meeting_day: MeetingDay; weekday: number; entry_due_local: string; call_local: string; time_zone: string; facility_override: boolean }
export type MondaySubmitted = { revision_id: string; submitted_at: string; values: Partial<Record<ThursdayKey, number | null>> } | null
export type MeetingReport = {
  id: string | null; facility_id: string; week_start: string; meeting_day: MeetingDay; version: number; revision_id: string | null
  values: ThursdayValues; status: 'draft' | 'ready'; source_as_of: string | null; updated_at: string | null
  updated_by?: string | null; updated_by_name?: string | null
  first_submitted_at?: string | null; last_submitted_at?: string | null; last_submitted_revision_id?: string | null; last_submitted_by?: string | null
  monday_submitted: MondaySubmitted; not_started?: boolean
  /** COL-555: what the roster said and any reason given, on the current revision (open period only). */
  roster_confirmations?: RosterConfirmations
}
export type MeetingFacility = { id: string; name: string; open_week: string | null; window: MeetingWindow | null }
export type MeetingWorkspace = {
  meeting_day: MeetingDay; scheduled: boolean; current_week: string | null; window: MeetingWindow | null
  schedule: MeetingScheduleEntry[]; keys: string[]
  facilities: MeetingFacility[]; reports: MeetingReport[]
  monday_baselines: { facility_id: string; week_start: string; monday_submitted: MondaySubmitted }[]
  can_edit: boolean; can_edit_submitted: boolean; server_now: string; actor_role: string
}
export type MeetingRevision = { version: number; revision_id: string; status: 'draft' | 'ready'; created_at: string; reason: string | null; values: ThursdayValues; updated_by_name: string | null }
export type MeetingHistory = { window: MeetingWindow | null; call_snapshot_revision_id: string | null; revisions: MeetingRevision[] }

export function emptyThursdayValues(): ThursdayValues {
  return Object.fromEntries(THURSDAY_KEYS.map(key => [key, null])) as ThursdayValues
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
/** "08:45" → "8:45 a.m." */
export function wallClock(value: string): string {
  const [hour, minute] = value.split(':').map(Number)
  const period = hour < 12 ? 'a.m.' : 'p.m.'
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${period}`
}
/** ISO weekday (1 Monday … 7 Sunday) → its name. */
export const weekdayName = (weekday: number): string => WEEKDAYS[(weekday - 1) % 7] ?? ''
/** The time-zone name a staff member reads. Eastern is the only zone Circle of Life keeps. */
export const zoneLabel = (zone: string): string => zone === 'America/New_York' ? 'Eastern' : zone

/** Entry is always available; each meeting record locks at its own scheduled call. */
export function meetingWindowLine(schedule: MeetingScheduleEntry[], day: MeetingDay): string | null {
  const own = schedule.find(entry => entry.meeting_day === day)
  if (!own) return null
  return `Entry available anytime · Due ${weekdayName(own.weekday)} ${wallClock(own.entry_due_local)} · Record locks ${weekdayName(own.weekday)} ${wallClock(own.call_local)} ${zoneLabel(own.time_zone)}`
}

/** A Thursday figure for reading: dollars for A/R, a count otherwise. */
export function thursdayDisplay(key: ThursdayKey, value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Not provided'
  const figure = THURSDAY_FIGURES.find(item => item.key === key)!
  return figure.money ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100) : value.toLocaleString('en-US')
}

/**
 * Thursday against Monday for one figure. The baseline is what the administrator
 * submitted on Monday (COL-749 ruling 3); a figure Monday does not report, or a
 * Monday that was never submitted, says so rather than showing a change of 0.
 */
export function mondayComparison(key: ThursdayKey, thursday: number | null, monday: MondaySubmitted): { monday: string; change: string | null } {
  const figure = THURSDAY_FIGURES.find(item => item.key === key)!
  if (!figure.mondayKey) return { monday: 'Not on Monday’s report', change: null }
  if (!monday) return { monday: 'Monday not submitted', change: null }
  const before = monday.values[key]
  if (before === null || before === undefined) return { monday: 'Not provided', change: null }
  if (thursday === null) return { monday: thursdayDisplay(key, before), change: null }
  const delta = thursday - before
  const size = figure.money ? thursdayDisplay(key, Math.abs(delta)) : Math.abs(delta).toLocaleString('en-US')
  return { monday: thursdayDisplay(key, before), change: delta === 0 ? 'No change' : `${delta > 0 ? '+' : '−'}${size}` }
}

/** Dollars typed by a person → cents; whole numbers otherwise. Blank is null, never 0. */
export function parseThursdayField(key: ThursdayKey, raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const figure = THURSDAY_FIGURES.find(item => item.key === key)!
  if (figure.money) {
    const plain = text.replace(/[$,]/g, '')
    if (!/^\d+(\.\d{1,2})?$/.test(plain)) throw new Error(`${figure.label}: enter dollars with up to two decimal places.`)
    return Math.round(Number(plain) * 100)
  }
  if (!/^\d+$/.test(text) || Number(text) > 2147483647) throw new Error(`${figure.label}: enter a whole number or leave it blank.`)
  return Number(text)
}
export function thursdayFieldText(key: ThursdayKey, value: number | null): string {
  if (value === null) return ''
  return THURSDAY_FIGURES.find(item => item.key === key)!.money ? (value / 100).toFixed(2) : String(value)
}

export type MeetingReportState = 'Not started' | 'Draft' | 'Submitted' | 'Changes awaiting resubmission'
export function meetingReportState(report: MeetingReport | undefined): MeetingReportState {
  if (!report || report.not_started || THURSDAY_KEYS.every(key => report.values[key] === null)) return 'Not started'
  if (report.status === 'ready') return 'Submitted'
  return report.last_submitted_at ? 'Changes awaiting resubmission' : 'Draft'
}
export const meetingStamp = (value: string | null | undefined): string => value ? easternStamp(value) : 'No recorded time'
