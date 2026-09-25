import type { MetricKey } from './model'
import type { CensusReasonOption } from '@/lib/operating-rules/operating-rules'

/**
 * COL-351: the Weekly Stand Up census and hospital figures are suggested from
 * the resident roster and confirmed by an administrator, never written on
 * their own. Counts and tokens only; names, rooms and resident ids stay in the
 * out of house panel inside the facility's own screen.
 *
 * The status set below is the ONLY copy in TypeScript. Its SQL mirror is the
 * `IN ('active','hospital_hold','loa')` list in public.stand_up_roster_census
 * (migration 404), which is the same set public.resident_billable_status
 * treats as billable. Census treatment of hospital and leave residents is an
 * owner decision; TBD confirmation against the workbook.
 */
export const STAND_UP_ROSTER_CENSUS_STATUSES = ['active', 'hospital_hold', 'loa'] as const
export type RosterCensusStatus = typeof STAND_UP_ROSTER_CENSUS_STATUSES[number]

/** The two Stand Up figures the roster can suggest. */
export const ROSTER_FIELD_KEYS = ['current_total_census', 'hospital_and_rehab_total'] as const satisfies readonly MetricKey[]
export type RosterFieldKey = typeof ROSTER_FIELD_KEYS[number]
export const isRosterFieldKey = (key: string): key is RosterFieldKey => (ROSTER_FIELD_KEYS as readonly string[]).includes(key)

/** Result of the `roster` Stand Up command (public.stand_up_roster_census). */
export type RosterCensus = {
  facility_id: string
  in_house_count: number
  hospital_hold_count: number
  loa_count: number
  roster_census_count: number
  resident_count_in_haven: number
  roster_as_of: string | null
  /** COL-755: the bed-hold stays split by type; they add up to hospital_hold_count. Absent from a server before migration 521. */
  hospital_count?: number
  rehab_count?: number
  bed_hold_type_not_recorded_count?: number
  server_now?: string
}

/** differs_unexplained: a Thursday draft saved with a differing figure and no reason yet (COL-555). */
export const ROSTER_SOURCES = ['roster_confirmed', 'entered_no_roster', 'overridden', 'differs_unexplained'] as const
export type RosterSource = typeof ROSTER_SOURCES[number]

/**
 * An override reason is a key from the facility's reason list, a setting
 * (`stand_up.census_reason_options`, COL-555, migration 534), never a list in
 * code. No free text: free text invites resident names. The server checks the
 * key against the list in force and keeps the label it was given with.
 */
export type OverrideReason = string
export const isOverrideReason = (value: string, options: readonly CensusReasonOption[] | null | undefined): value is OverrideReason =>
  !!options && options.some(reason => reason.key === value)

/** What the server recorded for one figure on one saved revision. */
export type RosterConfirmation = {
  source: RosterSource
  suggested: number | null
  confirmed: number
  override_reason: OverrideReason | null
  /** The reason's label when it was given (COL-555); absent from a server before migration 534. */
  override_reason_label?: string | null
  roster_as_of: string | null
  confirmed_at: string
}
export type RosterConfirmations = Partial<Record<RosterFieldKey, RosterConfirmation>>

/** The client's part of a save: the reason, when the typed figure differs. The server decides the source. */
export type RosterPayload = Record<RosterFieldKey, { override_reason?: OverrideReason }>

export const NO_ROSTER_TEXT = 'No roster in Haven for this facility'

/** A facility with no residents in Haven gets no suggestion at all. */
export function hasRoster(roster: RosterCensus | null | undefined): roster is RosterCensus {
  return !!roster && roster.resident_count_in_haven > 0
}

/** Point in time: residents currently at hospital or rehab, whose bed is held. */
export function selectHospitalSuggestion(roster: RosterCensus | null | undefined): number | null {
  return hasRoster(roster) ? roster.hospital_hold_count : null
}

export function rosterSuggestion(roster: RosterCensus | null | undefined, key: RosterFieldKey): number | null {
  if (!hasRoster(roster)) return null
  return key === 'current_total_census' ? roster.roster_census_count : selectHospitalSuggestion(roster)
}

/** The total is never shown without its components. */
export function formatRosterCensusBreakdown(roster: RosterCensus): string {
  const part = (count: number, singular: string) => `${count.toLocaleString('en-US')} ${singular}`
  return `Roster: ${roster.roster_census_count.toLocaleString('en-US')} (${part(roster.in_house_count, 'in house')}, ${part(roster.hospital_hold_count, 'hospital or rehab')}, ${part(roster.loa_count, 'leave')})`
}

/**
 * COL-755: Monday keeps one figure for hospital and rehab together (the Front
 * Office and workbook contract); the roster line shows the split beside it.
 */
export function formatRosterHospital(roster: RosterCensus): string {
  const total = `Roster: ${roster.hospital_hold_count.toLocaleString('en-US')} at hospital or rehab`
  if (roster.hospital_count === undefined || roster.rehab_count === undefined) return total
  const parts = [`${roster.hospital_count.toLocaleString('en-US')} hospital`, `${roster.rehab_count.toLocaleString('en-US')} rehab`]
  if (roster.bed_hold_type_not_recorded_count) parts.push(`${roster.bed_hold_type_not_recorded_count.toLocaleString('en-US')} type not recorded`)
  return `${total} (${parts.join(', ')})`
}

/** Neutral text, no staleness colour, no invented day threshold. */
export function rosterAsOfLine(roster: RosterCensus): string {
  if (!roster.roster_as_of) return 'Roster has no recorded status change'
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(roster.roster_as_of))
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `Roster last changed ${part('month')} ${part('day')}, ${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase() === 'am' ? 'a.m.' : 'p.m.'}`
}

/** The source the server will record for a typed figure, so the form can ask for a reason before saving. */
export function expectedSource(roster: RosterCensus | null | undefined, key: RosterFieldKey, value: number | null): RosterSource | null {
  if (value === null) return null
  const suggested = rosterSuggestion(roster, key)
  if (suggested === null) return 'entered_no_roster'
  return value === suggested ? 'roster_confirmed' : 'overridden'
}

/** Neutral suffix for a saved figure: only an override says anything. */
export function rosterSourceSuffix(confirmation: RosterConfirmation | undefined): string | null {
  if (!confirmation || confirmation.source !== 'overridden' || !confirmation.override_reason) return null
  return `override: ${confirmation.override_reason_label ?? 'reason recorded'}`
}

/** What a past report recorded at the time. The suggestion is never recomputed for a past meeting. */
export function recordedConfirmationLine(confirmation: RosterConfirmation | undefined): string | null {
  if (!confirmation) return null
  if (confirmation.source === 'entered_no_roster') return 'Entered without a Haven roster'
  const suggested = confirmation.suggested === null ? 'none' : confirmation.suggested.toLocaleString('en-US')
  if (confirmation.source === 'roster_confirmed') return `Confirmed from the roster (${suggested})`
  if (confirmation.source === 'differs_unexplained') return `Roster suggested ${suggested} · no reason given yet`
  return `Roster suggested ${suggested} · ${rosterSourceSuffix(confirmation)}`
}
