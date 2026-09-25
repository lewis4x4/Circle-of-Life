import type { OverrideReason } from './roster-census'
import { parseCensusReasonOptions, type CensusReasonOption } from '@/lib/operating-rules/operating-rules'
import { MEETING_LABELS, isMeetingDay, type MeetingDay } from './meetings'
import { easternStamp } from './model'

/**
 * COL-555: a census disagreement is one object, derived on every read by
 * `public.stand_up_census_disagreements` (migration 523): the open reporting
 * period's census and hospital figures against the live roster, with the
 * reason recorded and how long it holds. Every surface that shows census
 * words it through this file, so the same fact reads the same everywhere.
 */
export const DISAGREEMENT_STATES = ['not_entered', 'no_roster', 'agrees', 'explained', 'open'] as const
export type DisagreementState = typeof DISAGREEMENT_STATES[number]

/**
 * COL-749 ruling 3: a Thursday-against-Monday figure is checked against the
 * census bridge (migration 542): Monday's submitted figure plus the movements
 * dated since, within the facility's tolerance. Never a raw difference.
 */
export type DisagreementBridge = {
  monday: number
  expected: number
  arrivals: number
  departures: number
  hospital_out: number
  returns: number
  /** True when a hospital or rehab stay stays in the census (the roster's own definition). */
  hospital_in_census: boolean
  tolerance: number
}

export type DisagreementFigure = {
  key: 'current_total_census' | 'hospital_and_rehab_total'
  /**
   * What the figure is compared with: the live roster, or (Thursday, with
   * stand_up.thursday_census_vs_monday on, the default since migration 542)
   * the census bridge's expected figure from Monday, which is then `roster`.
   */
  against: 'roster' | 'monday'
  label: string
  stand_up: number | null
  roster: number | null
  /** Monday's submitted figure, on a comparison against Monday. */
  monday: number | null
  roster_change_since_monday: number | null
  /** The bridge behind a comparison against Monday; null against the roster. */
  bridge: DisagreementBridge | null
  state: DisagreementState
  reason: OverrideReason | null
  /** The reason's label as it was given (the facility's list may have changed since). */
  reason_label: string | null
  reason_at: string | null
  reason_until: string | null
  roster_changed_since_reason: boolean
}
export type CensusDisagreement = {
  facility_id: string
  facility_name: string
  meeting_day: MeetingDay
  week_start: string
  entry_due_at: string
  call_at: string
  state: DisagreementState
  unreconciled: boolean
  roster_as_of: string | null
  reason_window_days: number
  /** The facility's census reasons in force today (COL-555, a setting). */
  reason_options: CensusReasonOption[]
  compares_with_monday: boolean
  figures: DisagreementFigure[]
}

/** A stable key for one figure's comparison, for lists and ids. */
export const figureId = (figure: Pick<DisagreementFigure, 'key' | 'against'>): string => `${figure.key}-${figure.against}`

/** What the signed-in person was told before a deadline and is still open (COL-751). */
export type CensusNotice = {
  id: string
  facility_id: string
  facility_name: string
  meeting_day: MeetingDay
  week_start: string
  phase: 'before_deadline' | 'at_deadline'
  entry_due_at: string
  sent_at: string
  message: string
  unreconciled: boolean
  figures: DisagreementFigure[]
}

const isState = (value: unknown): value is DisagreementState => DISAGREEMENT_STATES.includes(value as DisagreementState)

function parseFigure(raw: unknown): DisagreementFigure | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if ((row.key !== 'current_total_census' && row.key !== 'hospital_and_rehab_total') || !isState(row.state) || typeof row.label !== 'string') return null
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  const text = (value: unknown) => (typeof value === 'string' ? value : null)
  if (row.against !== undefined && row.against !== 'roster' && row.against !== 'monday') return null
  const bridge = parseDisagreementBridge(row.bridge)
  return {
    key: row.key, against: row.against === 'monday' ? 'monday' : 'roster', label: row.label, state: row.state,
    stand_up: num(row.stand_up), roster: num(row.roster),
    monday: num(row.monday), roster_change_since_monday: num(row.roster_change_since_monday),
    bridge,
    reason: typeof row.reason === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(row.reason) ? row.reason : null,
    reason_label: text(row.reason_label),
    reason_at: text(row.reason_at), reason_until: text(row.reason_until),
    roster_changed_since_reason: row.roster_changed_since_reason === true,
  }
}

function parseDisagreementBridge(raw: unknown): DisagreementBridge | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const whole = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : null)
  const monday = whole(row.monday), expected = whole(row.expected)
  if (monday === null || expected === null) return null
  return {
    monday, expected,
    arrivals: whole(row.arrivals) ?? 0, departures: whole(row.departures) ?? 0,
    hospital_out: whole(row.hospital_out) ?? 0, returns: whole(row.returns) ?? 0,
    hospital_in_census: row.hospital_in_census !== false, tolerance: whole(row.tolerance) ?? 0,
  }
}

/** Hand-rolled guard: an unreadable row is dropped, never shown as agreeing. */
export function parseDisagreements(data: unknown): CensusDisagreement[] | null {
  if (!Array.isArray(data)) return null
  const rows: CensusDisagreement[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    if (typeof row.facility_id !== 'string' || !isMeetingDay(row.meeting_day) || !isState(row.state) || !Array.isArray(row.figures)) return null
    const figures = row.figures.map(parseFigure)
    if (figures.some(figure => figure === null)) return null
    rows.push({
      facility_id: row.facility_id, facility_name: typeof row.facility_name === 'string' ? row.facility_name : '',
      meeting_day: row.meeting_day, week_start: String(row.week_start ?? ''),
      entry_due_at: String(row.entry_due_at ?? ''), call_at: String(row.call_at ?? ''),
      state: row.state, unreconciled: row.unreconciled === true,
      roster_as_of: typeof row.roster_as_of === 'string' ? row.roster_as_of : null,
      reason_window_days: typeof row.reason_window_days === 'number' ? row.reason_window_days : 0,
      reason_options: parseCensusReasonOptions(row.reason_options) ?? [],
      compares_with_monday: row.compares_with_monday === true,
      figures: figures as DisagreementFigure[],
    })
  }
  return rows
}

export function parseNotices(data: unknown): CensusNotice[] | null {
  if (!Array.isArray(data)) return null
  const rows: CensusNotice[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.facility_id !== 'string' || !isMeetingDay(row.meeting_day) || typeof row.message !== 'string') return null
    const figures = (Array.isArray(row.figures) ? row.figures : []).map(parseFigure).filter((figure): figure is DisagreementFigure => figure !== null)
    rows.push({
      id: row.id, facility_id: row.facility_id, facility_name: typeof row.facility_name === 'string' ? row.facility_name : '',
      meeting_day: row.meeting_day, week_start: String(row.week_start ?? ''),
      phase: row.phase === 'at_deadline' ? 'at_deadline' : 'before_deadline',
      entry_due_at: String(row.entry_due_at ?? ''), sent_at: String(row.sent_at ?? ''), message: row.message,
      unreconciled: row.unreconciled === true, figures,
    })
  }
  return rows
}

/** A disagreement worth showing: open, or explained by a reason still in force. */
export const showsChip = (d: CensusDisagreement): boolean => d.state === 'open' || d.state === 'explained'

const reasonLabel = (figure: DisagreementFigure): string => figure.reason_label ?? 'reason recorded'
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n))
const monthDay = (iso: string): string => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(iso))

/**
 * One wording for every surface:
 * "Monday Stand Up disagrees with the roster · Census: Stand Up 35, roster 33 · reason: Admission or discharge not entered in Haven (Sep 21)".
 * The figures are in the words, so a screen reader announces the numbers, not just "warning".
 */
export function chipText(d: CensusDisagreement): string {
  const differing = d.figures.filter(figure => figure.state === 'open' || figure.state === 'explained')
  // Only the bridge differs (the roster agrees): say so, not "the roster".
  const against = differing.length > 0 && differing.every(figure => figure.against === 'monday') ? 'the census bridge from Monday' : 'the roster'
  const lead = d.unreconciled
    ? `${MEETING_LABELS[d.meeting_day]} Stand Up census unreconciled`
    : d.state === 'explained'
      ? `${MEETING_LABELS[d.meeting_day]} Stand Up differs from ${against}, explained`
      : `${MEETING_LABELS[d.meeting_day]} Stand Up disagrees with ${against}`
  const parts = differing.map(figure => {
    const numbers = figure.against === 'monday'
      ? `${figure.label}: Stand Up ${figure.stand_up ?? 'blank'}, expected ${figure.roster ?? 'none'} from Monday's ${figure.monday ?? 'none'} and the movements since (${signed(figure.roster_change_since_monday ?? 0)})`
      : `${figure.label}: Stand Up ${figure.stand_up ?? 'blank'}, roster ${figure.roster ?? 'none'}`
    if (!figure.reason || !figure.reason_at) return numbers
    const tail = figure.state === 'explained' && figure.reason_until
      ? `until ${monthDay(figure.reason_until)}`
      : figure.roster_changed_since_reason ? 'the roster has changed since' : 'no longer in force'
    return `${numbers} · reason: ${reasonLabel(figure)} (${monthDay(figure.reason_at)}, ${tail})`
  })
  return [lead, ...parts].join(' · ')
}

/** Where every chip's Reconcile goes: the Stand Up report, with the Reconcile dialog open. */
export function reconcileHref(d: Pick<CensusDisagreement, 'facility_id' | 'meeting_day'>): string {
  return `/admin/stand-up?facility=${encodeURIComponent(d.facility_id)}&meeting=${d.meeting_day}&reconcile=1`
}

/** "Before 8:45 a.m. Thursday" line for a notice. */
export function noticeDueLine(notice: CensusNotice): string {
  if (!notice.entry_due_at) return ''
  return notice.phase === 'at_deadline'
    ? `The ${MEETING_LABELS[notice.meeting_day]} entry deadline, ${easternStamp(notice.entry_due_at)}, has passed.`
    : `Due ${easternStamp(notice.entry_due_at)}.`
}

/**
 * COL-751: whether a notice recipient reconciles where they read the notice
 * (by fixing the roster) rather than on the report. Only the report's writers
 * (owner, org admin, the facility's administrator; the database decides the
 * same) change the report; the manager and the assistant fix the roster.
 */
export function reconcilesInPlace(role: string | null | undefined): boolean {
  return !!role && !['owner', 'org_admin', 'facility_admin'].includes(role)
}

/** The query a Stand Up link carries to open a facility's Reconcile dialog. */
export function readReconcileRequest(search: string): { facilityId: string; meeting: MeetingDay } | null {
  const params = new URLSearchParams(search)
  const facilityId = params.get('facility')
  const meeting = params.get('meeting')
  if (params.get('reconcile') !== '1' || !facilityId || !isMeetingDay(meeting)) return null
  return { facilityId, meeting }
}
