import { enumLabel } from '@/lib/display/enum-label'
import { bedHoldLabel, isBedHoldStayType } from '@/lib/residents/presence'
import { THURSDAY_KEYS, type ThursdayKey, type ThursdayValues } from './meetings'

/**
 * COL-754: the Thursday Stand Up report, as `stand_up_command('report')`
 * (migration 524) returns it, per facility: Haven's figures for Thursday, who
 * left and who is away, every open referral with all of its notes and contacts
 * in time order, and each recruiter's activity since Monday's call.
 *
 * Resident names come back only for the roles that already read the roster,
 * and admission notes only for the roles that read admission cases; a
 * recruiter's report carries counts in their place and says so.
 */
export type ReportFigure = { value: number | null; source: string | null; note?: string | null }
export type ReportPerson = { resident: string | null; kind?: string; at?: string; back_at?: string | null; since?: string; stay_type?: string | null; new?: boolean }
export type TimelineItem = {
  at: string; recorded_at: string; new: boolean
  /**
   * admission_step, rate_note and checklist_note are the non-clinical admission
   * workflow (COL-749 ruling 4, migration 543): for an admission_step `method`
   * is the step, `with` the stage it left and `status` the stage it reached;
   * for a rate_note `status` is the accommodation quoted; for a checklist_note
   * `status` is the document and `method` whether it is received or waived.
   */
  kind: 'contact' | 'next_step' | 'tour' | 'status' | 'lead_note' | 'admission_note' | 'admission_step' | 'rate_note' | 'checklist_note'
  by: string | null; method: string | null; with: string | null; text: string | null; status: string | null
}
export type ReportTour = { scheduled_for: string | null; outcome: string; completed_at: string | null; owner_name: string | null; new: boolean }
export type ReportAdmission = {
  status: string; target_move_in_date: string | null; financial_clearance_at: string | null; physician_orders_received_at: string | null
  medicaid_pipeline_stage: string | null; bed_label: string | null; form_1823_status: string | null
}
export type PotentialResident = {
  lead_id: string; name: string; stage: string; work_state: string; owner_name: string | null
  next_action: string | null; next_action_at: string | null; created_at: string; new: boolean
  tours: ReportTour[]; admission: ReportAdmission | null; notes_withheld: boolean; timeline: TimelineItem[]
}
export type RecruiterItem = { at: string; kind: 'contact' | 'tour' | 'outreach'; lead_name: string; method: string | null; text: string | null; status: string | null }
export type RecruiterActivity = { user_id: string; name: string; contacts: number; tours: number; outreach: number; items: RecruiterItem[] }
/**
 * COL-749 ruling 3: the Thursday census bridge (migration 542), counts only.
 * Monday submitted + arrivals - departures (- hospital or rehab out + returns
 * when the census leaves hospital stays out) = expected Thursday, beside
 * Thursday's actual, within the facility's tolerance.
 */
export type CensusBridgeState = 'matches' | 'differs' | 'not_entered' | 'no_monday'
export type CensusBridge = {
  state: CensusBridgeState
  monday_census: number | null; monday_at: string | null
  arrivals: number; departures: number; hospital_out: number; returns: number
  /** True when a hospital or rehab stay stays in the census, as the roster counts it. */
  hospital_in_census: boolean
  expected: number | null; actual: number | null; gap: number | null; tolerance: number
  /** When the movements are counted through: Thursday's figures, or now before they are given. */
  through: string | null
}
export type FacilityReport = {
  facility_id: string; facility_name: string; week_start: string; since: string
  /** Absent on a report from before migration 543. */
  bridge?: CensusBridge | null
  admission_workflow_shown?: boolean
  figures: Partial<Record<ThursdayKey, ReportFigure>>
  departures: ReportPerson[]
  hospital: { out_now: ReportPerson[]; went_out: ReportPerson[]; came_back: ReportPerson[] }
  names_shown: boolean; admission_notes_shown: boolean
  potential_residents: PotentialResident[]; recruiters: RecruiterActivity[]
}
export type ThursdayReport = { meeting_day: 'thursday'; generated_at: string; actor_role: string; facilities: FacilityReport[] }

/** A figure Haven computed for Thursday; null when it cannot, with the reason. */
export function reportFigureValue(report: FacilityReport | undefined, key: ThursdayKey): number | null {
  const value = report?.figures[key]?.value
  return typeof value === 'number' ? value : null
}

/** Haven's figures for an unstarted Thursday report. Blanks stay blank, never 0. */
export function thursdayPrefill(report: FacilityReport | undefined, base: ThursdayValues): ThursdayValues {
  const next = { ...base }
  for (const key of THURSDAY_KEYS) {
    const value = reportFigureValue(report, key)
    if (next[key] === null && value !== null) next[key] = value
  }
  return next
}

/** "Haven: 34 · Resident roster" or why Haven has none. */
export function reportFigureLine(report: FacilityReport | undefined, key: ThursdayKey, display: (value: number) => string): string | null {
  const figure = report?.figures[key]
  if (!figure) return null
  if (figure.value === null) return `Haven cannot compute this: ${figure.note ?? 'no source in Haven'}`
  return `Haven: ${display(figure.value)} · ${figure.source}${figure.note ? ` (${figure.note})` : ''}`
}

const ET = 'America/New_York'
/** "Tue, Sep 22, 3:10 p.m." in Eastern time. */
export function reportStamp(iso: string | null | undefined): string {
  if (!iso) return 'No time recorded'
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(iso))
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('weekday')}, ${part('month')} ${part('day')}, ${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase() === 'am' ? 'a.m.' : 'p.m.'}`
}
export function reportDay(iso: string | null | undefined): string {
  if (!iso) return 'No date'
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, month: 'short', day: 'numeric' }).format(new Date(iso))
}

/** A person line that works with or without a name. */
export function personLabel(person: ReportPerson, fallback: string): string {
  return person.resident ?? fallback
}
export function stayLabel(stayType: string | null | undefined): string {
  return bedHoldLabel(isBedHoldStayType(stayType) ? stayType : null)
}

const TIMELINE_KIND_LABELS: Record<TimelineItem['kind'], string> = {
  contact: 'Contact', next_step: 'Next step', tour: 'Tour', status: 'Stage', lead_note: 'Lead notes', admission_note: 'Admission notes',
  admission_step: 'Admission', rate_note: 'Quoted rate', checklist_note: 'Admission paperwork',
}
const ADMISSION_STEP_LABELS: Record<string, string> = {
  referral_admission_started: 'Admission started',
  admission_move_in_blocked: 'Move-in blocked',
  form_1823_received: 'Form 1823 received',
  referral_converted: 'Moved in',
}

/** "Admission: Pending clearance to Bed reserved", "Move-in blocked: quoted rate terms, Form 1823". */
function admissionStepLine(item: TimelineItem): string {
  if (item.method === 'admission_status_changed') {
    return item.with && item.status ? `Admission moved from ${enumLabel(item.with, { case: 'lower' })} to ${enumLabel(item.status, { case: 'lower' })}` : 'Admission stage changed'
  }
  const label = (item.method && ADMISSION_STEP_LABELS[item.method]) ?? 'Admission updated'
  return item.text ? `${label}: ${item.text}` : label
}
export function timelineKindLabel(kind: TimelineItem['kind']): string { return TIMELINE_KIND_LABELS[kind] ?? enumLabel(kind) }

/** One timeline line: what happened, how, with whom, and what was said. */
export function timelineLine(item: TimelineItem): string {
  const parts: string[] = []
  if (item.kind === 'contact') parts.push([item.method ? enumLabel(item.method) : 'Contact', item.with ? `with ${item.with}` : null].filter(Boolean).join(' '))
  else if (item.kind === 'tour') parts.push(item.status ? `Tour ${enumLabel(item.status, { case: 'lower' })}` : 'Tour')
  else if (item.kind === 'status') parts.push(item.status ? `Stage: ${enumLabel(item.status)}` : 'Stage changed')
  else if (item.kind === 'admission_step') return admissionStepLine(item)
  else if (item.kind === 'rate_note') parts.push(item.status ? `Quoted ${enumLabel(item.status, { case: 'lower' })} room` : 'Quoted rate')
  else if (item.kind === 'checklist_note') parts.push([item.status ? enumLabel(item.status) : 'Paperwork', item.method ? enumLabel(item.method, { case: 'lower' }) : null].filter(Boolean).join(', '))
  else parts.push(TIMELINE_KIND_LABELS[item.kind])
  if (item.text) parts.push(item.text)
  return parts.join(' · ')
}

export function tourLine(tour: ReportTour): string {
  const when = tour.completed_at ?? tour.scheduled_for
  return `${enumLabel(tour.outcome)} · ${reportStamp(when)}${tour.owner_name ? ` · ${tour.owner_name}` : ''}`
}

export function admissionLine(admission: ReportAdmission): string[] {
  return [
    `Case: ${enumLabel(admission.status)}`,
    `Form 1823: ${admission.form_1823_status ? enumLabel(admission.form_1823_status) : 'Not on file'}`,
    `Financial clearance: ${admission.financial_clearance_at ? reportDay(admission.financial_clearance_at) : 'Not yet'}`,
    `Physician orders: ${admission.physician_orders_received_at ? reportDay(admission.physician_orders_received_at) : 'Not yet'}`,
    `Bed: ${admission.bed_label ?? 'Not assigned'}`,
    `Target move-in: ${admission.target_move_in_date ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${admission.target_move_in_date}T12:00:00Z`)) : 'Not set'}`,
    `Medicaid: ${admission.medicaid_pipeline_stage ? enumLabel(admission.medicaid_pipeline_stage) : 'Not recorded'}`,
  ]
}

export function recruiterItemLine(item: RecruiterItem): string {
  const what = item.kind === 'outreach'
    ? `Outreach${item.method ? `: ${enumLabel(item.method)}` : ''}${item.lead_name ? ` · ${item.lead_name}` : ''}`
    : `${item.kind === 'contact' ? (item.method ? enumLabel(item.method) : 'Contact') : `Tour${item.status ? ` ${enumLabel(item.status, { case: 'lower' })}` : ''}`} · ${item.lead_name}`
  return item.text ? `${what} · ${item.text}` : what
}

/** Where the printable report lives. */
export function thursdayPrintHref(input: { facilityId?: string | null; week?: string | null }): string {
  const params = new URLSearchParams()
  if (input.facilityId) params.set('facility', input.facilityId)
  if (input.week) params.set('week', input.week)
  const query = params.toString()
  return `/print/stand-up/thursday${query ? `?${query}` : ''}`
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** One term of the bridge: what it adds or takes away, and whether it moves the census. */
export type BridgeTerm = { key: 'arrivals' | 'departures' | 'hospital_out' | 'returns'; sign: '+' | '−'; count: number; label: string; movesCensus: boolean }

/** The bridge's terms in Brian's order: + arrivals, − departures, − hospital or rehab out, + returns. */
export function bridgeTerms(bridge: CensusBridge): BridgeTerm[] {
  const moves = !bridge.hospital_in_census
  return [
    { key: 'arrivals', sign: '+', count: bridge.arrivals, label: count(bridge.arrivals, 'arrival'), movesCensus: true },
    { key: 'departures', sign: '−', count: bridge.departures, label: count(bridge.departures, 'departure'), movesCensus: true },
    { key: 'hospital_out', sign: '−', count: bridge.hospital_out, label: `${bridge.hospital_out} hospital or rehab out`, movesCensus: moves },
    { key: 'returns', sign: '+', count: bridge.returns, label: count(bridge.returns, 'return'), movesCensus: moves },
  ]
}

/** How far Thursday is from the bridge, in words: "1 more than expected". */
export function bridgeGapText(bridge: CensusBridge): string | null {
  if (bridge.gap === null) return null
  if (bridge.gap === 0) return 'exactly as expected'
  const n = Math.abs(bridge.gap)
  return `${count(n, 'resident')} ${bridge.gap > 0 ? 'more' : 'fewer'} than expected`
}

/** The short state for the badge. */
export function bridgeStateLabel(bridge: CensusBridge): string {
  switch (bridge.state) {
    case 'matches': return bridge.gap ? `Matches within ${bridge.tolerance}` : 'Matches'
    case 'differs': return `Off by ${Math.abs(bridge.gap ?? 0)}`
    case 'not_entered': return 'Thursday not entered'
    case 'no_monday': return 'No Monday figure'
  }
}

/**
 * The whole bridge in one sentence, so a screen reader hears the numbers and
 * the result, never only a colour.
 */
export function bridgeSentence(bridge: CensusBridge): string {
  if (bridge.state === 'no_monday' || bridge.monday_census === null || bridge.expected === null) {
    return 'Census bridge: Monday’s census for this week was not submitted, so there is nothing to bridge from.'
  }
  const terms = bridgeTerms(bridge)
  const moving = terms.filter(term => term.movesCensus).map(term => `${term.sign === '+' ? 'plus' : 'minus'} ${term.label}`)
  const inCensus = terms.filter(term => !term.movesCensus)
  const stays = inCensus.length
    ? ` Hospital or rehab: ${inCensus.map(term => term.label).join(' and ')}, still counted in census.`
    : ''
  const chain = `Monday ${bridge.monday_census}, ${moving.join(', ')}, expected ${bridge.expected}.`
  switch (bridge.state) {
    case 'matches': return `Census bridge matches: ${chain} Thursday ${bridge.actual}, ${bridgeGapText(bridge)}.${stays}`
    case 'differs': return `Census bridge is off by ${Math.abs(bridge.gap ?? 0)}: ${chain} Thursday ${bridge.actual}, ${bridgeGapText(bridge)}.${stays}`
    case 'not_entered': return `Census bridge so far: ${chain} Thursday’s census is not entered yet.${stays}`
  }
  return chain
}
