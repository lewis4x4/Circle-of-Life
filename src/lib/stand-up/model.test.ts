import { describe, expect, it } from 'vitest'
import { derivedValues, emptyValues, reportingWeek, validateValues, deadlinePassed, shiftDay, staffingPeriod, reportState, metricDisplay, reportOvertimeMinutes, reportDeadlineState, fieldState, fieldDisplay, overtimeNeedsReview, easternStamp, periodRange, sectionPeriodLabel, metricSection, sectionMetrics, METRIC_KEYS, SECTIONS, FIELD_STATE_TEXT, FIELD_STATE_CODES, FIELD_STATE_VERSION, getStandUpEntryWindow, standUpEntryOpensAt, standUpOpenWeek, isEntryOpenLeadMinutes, entryOpenLeadMinutes, entryOpenLabel, entryOpensStamp, entryWindowLine, easternInstant, STAND_UP_DEFAULT_ENTRY_OPEN_LEAD_MINUTES, STAND_UP_ENTRY_OPEN_LEAD_MIN, STAND_UP_ENTRY_OPEN_LEAD_MAX, STAND_UP_ENTRY_OPEN_CHOICES, type StandUpReport } from './model'
describe('Stand Up reporting contract', () => {
 it('opens upcoming Monday on Eastern Sunday, including DST transition', () => {
  expect(reportingWeek(new Date('2026-09-13T04:00:00Z'))).toBe('2026-09-14')
  expect(reportingWeek(new Date('2026-09-13T03:59:59Z'))).toBe('2026-09-07')
  expect(reportingWeek(new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-02')
 })
 it('keeps blanks distinct from zero and rejects implicit coercion and unknown metrics', () => {
  expect(validateValues(emptyValues())).toEqual([])
  expect(validateValues({ ...emptyValues(), current_total_census: '0' })).not.toEqual([])
  expect(validateValues({ ...emptyValues(), extra: 0 })).not.toEqual([])
  expect(validateValues({ ...emptyValues(), monthly_rent_roll_cents: 0.5 })).not.toEqual([])
  expect(validateValues({ ...emptyValues(), overtime_reported: 2.5 })).toEqual([])
 })
 it('does not fabricate averages or total beds from incomplete values', () => {
  expect(derivedValues(emptyValues())).toEqual({ average_rent_cents: null, total_beds_open: null, completed_fields: 0 })
  expect(derivedValues({ ...emptyValues(), monthly_rent_roll_cents: 120001, current_total_census: 3 }).average_rent_cents).toBe(40000)
  expect(derivedValues({ ...emptyValues(), monthly_rent_roll_cents: 120001, current_total_census: 0 }).average_rent_cents).toBeNull()
 })
})


/**
 * One window model, one set of boundaries. Every instant here is written as UTC
 * so a wrong offset shows up as a failure rather than as a passing tautology.
 */
describe('Stand Up entry window', () => {
 const utc = (value: string) => new Date(value)
 it('opens the default lead at Sunday 12:00 a.m. Eastern and closes at the 8:45 a.m. target', () => {
  const window = getStandUpEntryWindow({ meetingMonday: '2026-09-21', leadMinutes: null, now: utc('2026-09-20T04:00:00Z') })
  expect(window.leadMinutes).toBe(STAND_UP_DEFAULT_ENTRY_OPEN_LEAD_MINUTES)
  expect(window.opensAt.toISOString()).toBe('2026-09-20T04:00:00.000Z')
  expect(window.deadlineAt.toISOString()).toBe('2026-09-21T12:45:00.000Z')
  expect(window.callAt.toISOString()).toBe('2026-09-21T13:15:00.000Z')
  expect(window.staffingPeriodStart.toISOString()).toBe('2026-09-14T04:00:00.000Z')
  expect(window.staffingPeriodEnd.toISOString()).toBe('2026-09-21T04:00:00.000Z')
 })
 it('names not_open, open and past_deadline at the exact Eastern minute', () => {
  const state = (now: string) => getStandUpEntryWindow({ meetingMonday: '2026-09-21', leadMinutes: null, now: utc(now) }).state
  expect(state('2026-09-20T03:59:00Z')).toBe('not_open')   // Saturday 23:59 Eastern
  expect(state('2026-09-20T04:00:00Z')).toBe('open')       // Sunday 00:00 Eastern
  expect(state('2026-09-21T12:44:00Z')).toBe('open')       // Monday 08:44 Eastern
  expect(state('2026-09-21T12:45:00Z')).toBe('past_deadline')
 })
 it('holds the wall clock across both daylight-saving transitions', () => {
  // Fall back: the open is still Sunday 12:00 a.m., though 33h45m pass before the target.
  const fall = getStandUpEntryWindow({ meetingMonday: '2026-11-02', leadMinutes: null, now: utc('2026-11-01T05:00:00Z') })
  expect(fall.opensAt.toISOString()).toBe('2026-11-01T04:00:00.000Z')
  expect(fall.deadlineAt.toISOString()).toBe('2026-11-02T13:45:00.000Z')
  expect(fall.state).toBe('open')
  // Spring forward: Sunday 12:00 a.m. is still standard time, the target is daylight time.
  const spring = getStandUpEntryWindow({ meetingMonday: '2027-03-15', leadMinutes: null, now: utc('2027-03-14T04:59:00Z') })
  expect(spring.opensAt.toISOString()).toBe('2027-03-14T05:00:00.000Z')
  expect(spring.deadlineAt.toISOString()).toBe('2027-03-15T12:45:00.000Z')
  expect(spring.state).toBe('not_open')
 })
 it('reaches back across a month boundary at the widest allowed lead', () => {
  expect(standUpEntryOpensAt('2026-11-30', 3405).toISOString()).toBe('2026-11-28T05:00:00.000Z')
  expect(getStandUpEntryWindow({ meetingMonday: '2026-11-30', leadMinutes: 3405, now: utc('2026-11-28T04:59:00Z') }).state).toBe('not_open')
  expect(getStandUpEntryWindow({ meetingMonday: '2026-11-30', leadMinutes: 3405, now: utc('2026-11-28T05:00:00Z') }).state).toBe('open')
 })
 it('places each of the four offered choices on its named weekday and hour', () => {
  expect(STAND_UP_ENTRY_OPEN_CHOICES.map(choice => choice.minutes)).toEqual([3405, 1965, 885, 525])
  const opens = Object.fromEntries(STAND_UP_ENTRY_OPEN_CHOICES.map(choice => [choice.minutes, standUpEntryOpensAt('2026-09-21', choice.minutes).toISOString()]))
  expect(opens).toEqual({
   3405: '2026-09-19T04:00:00.000Z', // Saturday 12:00 a.m. Eastern
   1965: '2026-09-20T04:00:00.000Z', // Sunday 12:00 a.m. Eastern
   885: '2026-09-20T22:00:00.000Z',  // Sunday 6:00 p.m. Eastern
   525: '2026-09-21T04:00:00.000Z',  // Monday 12:00 a.m. Eastern
  })
  expect(STAND_UP_ENTRY_OPEN_CHOICES.map(choice => choice.label)).toEqual(STAND_UP_ENTRY_OPEN_CHOICES.map(choice => entryOpenLabel(choice.minutes)))
 })
 it('rejects a lead outside the bounds and falls back to the default', () => {
  expect(STAND_UP_ENTRY_OPEN_LEAD_MIN).toBe(60)
  expect(STAND_UP_ENTRY_OPEN_LEAD_MAX).toBe(3405)
  expect(isEntryOpenLeadMinutes(59)).toBe(false)
  expect(isEntryOpenLeadMinutes(3406)).toBe(false)
  expect(isEntryOpenLeadMinutes(60)).toBe(true)
  expect(isEntryOpenLeadMinutes(3405)).toBe(true)
  expect(isEntryOpenLeadMinutes(1965.5)).toBe(false)
  expect(isEntryOpenLeadMinutes('1965')).toBe(false)
  for (const rejected of [59, 3406, null, undefined]) expect(entryOpenLeadMinutes(rejected as number)).toBe(1965)
  // The narrowest allowed window still opens Monday morning before the target.
  expect(standUpEntryOpensAt('2026-09-21', 60).toISOString()).toBe('2026-09-21T11:45:00.000Z')
 })
 it('advances the open week only when that facility window has opened', () => {
  // Default lead: unchanged from the behaviour Haven shipped, Sunday midnight Eastern.
  expect(standUpOpenWeek({ now: utc('2026-09-20T03:59:59Z') })).toBe('2026-09-14')
  expect(standUpOpenWeek({ now: utc('2026-09-20T04:00:00Z') })).toBe('2026-09-21')
  expect(reportingWeek(utc('2026-09-13T04:00:00Z'))).toBe('2026-09-14')
  // A widened facility reaches the upcoming Monday a full day earlier.
  expect(standUpOpenWeek({ now: utc('2026-09-19T03:59:00Z'), leadMinutes: 3405 })).toBe('2026-09-14')
  expect(standUpOpenWeek({ now: utc('2026-09-19T04:00:00Z'), leadMinutes: 3405 })).toBe('2026-09-21')
  // A narrowed facility stays on the prior Monday until Monday morning.
  expect(standUpOpenWeek({ now: utc('2026-09-21T03:00:00Z'), leadMinutes: 60 })).toBe('2026-09-14')
  expect(standUpOpenWeek({ now: utc('2026-09-21T11:45:00Z'), leadMinutes: 60 })).toBe('2026-09-21')
 })
 it('writes one operator line for the window and one for a report that has not opened', () => {
  expect(entryWindowLine(null)).toBe('Opens Sunday 12:00 a.m. · Due Monday 8:45 a.m. · Call 9:15 a.m. Eastern')
  expect(entryWindowLine(3405)).toBe('Opens Saturday 12:00 a.m. · Due Monday 8:45 a.m. · Call 9:15 a.m. Eastern')
  expect(entryOpensStamp('2026-09-21', null)).toBe('Sunday, September 20 at 12:00 a.m. Eastern')
  expect(entryOpensStamp('2026-09-21', 885)).toBe('Sunday, September 20 at 6:00 p.m. Eastern')
 })
 it('resolves an Eastern wall clock without adding a fixed offset to UTC', () => {
  expect(easternInstant('2026-09-20', 0).toISOString()).toBe('2026-09-20T04:00:00.000Z')
  expect(easternInstant('2026-11-02', 0).toISOString()).toBe('2026-11-02T05:00:00.000Z')
  expect(easternInstant('2027-03-15', 525).toISOString()).toBe('2027-03-15T12:45:00.000Z')
 })
})

describe('Stand Up presentation semantics', () => {
 it('uses the exact Eastern 8:45 target across daylight-saving and year boundaries', () => {
  expect(deadlinePassed('2026-09-14', new Date('2026-09-14T12:44:59Z'))).toBe(false)
  expect(deadlinePassed('2026-09-14', new Date('2026-09-14T12:45:00Z'))).toBe(true)
  expect(deadlinePassed('2026-11-02', new Date('2026-11-02T13:44:59Z'))).toBe(false)
  expect(deadlinePassed('2026-11-02', new Date('2026-11-02T13:45:00Z'))).toBe(true)
  expect(shiftDay('2027-01-04', -7)).toBe('2026-12-28')
  expect(staffingPeriod('2027-01-04')).toBe('December 28, 2026–January 3, 2027')
 })
 it('keeps imported, submitted and resubmission states distinct from completeness', () => {
  const report = { values: emptyValues(), status: 'draft', entry_origin: 'imported' } as StandUpReport
  expect(reportState()).toBe('Not started')
  expect(reportState(report)).toBe('Imported, awaiting review')
  expect(reportState({ ...report, status: 'ready' })).toBe('Submitted')
  expect(reportState({ ...report, last_submitted_at: '2026-09-14T12:30:00Z' })).toBe('Changes awaiting resubmission')
  expect(reportState({ ...report, entry_origin: 'initialized' })).toBe('Not started')
 })
 it('formats HH.MM as a duration and refuses inconsistent or invalid projections', () => {
  expect(metricDisplay('overtime_reported', 17.15)).toBe('17h 15m')
  expect(metricDisplay('overtime_reported', 17.6)).toBe('Needs duration review')
  expect(metricDisplay('monthly_rent_roll_cents', 16082512)).toBe('$160,825.12')
  const report = { values: { ...emptyValues(), overtime_reported: 17.15 }, overtime_minutes: 1035 } as StandUpReport
  expect(reportOvertimeMinutes(report)).toBe(1035)
  expect(reportOvertimeMinutes({ ...report, overtime_minutes: 1029 })).toBeNull()
  expect(validateValues({ ...emptyValues(), overtime_reported: 17.6 })).not.toEqual([])
 })
})


describe('deadline provenance', () => {
 it('uses only current manually tracked deadlines and preserves unknown imported timing', () => {
  const report = { values: { ...emptyValues(), current_total_census: 40 }, status: 'draft', entry_origin: 'manual' } as StandUpReport
  const now = new Date('2026-09-14T13:00:00Z')
  expect(reportDeadlineState(report, '2026-09-14', '2026-09-14', now)).toBe('past_target')
  expect(reportDeadlineState(undefined, '2026-09-14', '2026-09-14', now)).toBe('past_target')
  expect(reportDeadlineState({ ...report, entry_origin: 'initialized' }, '2026-09-14', '2026-09-14', now)).toBe('past_target')
  expect(reportDeadlineState({ ...report, entry_origin: 'imported' }, '2026-09-14', '2026-09-14', now)).toBe('timing_unknown')
  expect(reportDeadlineState({ ...report, entry_origin: undefined }, '2026-09-14', '2026-09-14', now)).toBe('timing_unknown')
  expect(reportDeadlineState(report, '2026-09-07', '2026-09-14', now)).toBe('none')
  expect(reportDeadlineState({ ...report, entry_origin: 'imported', last_submitted_at: '2026-09-14T12:00:00Z' }, '2026-09-14', '2026-09-14', now)).toBe('past_target')
 })
})


describe('field-state vocabulary', () => {
 const base = (patch: Partial<StandUpReport> = {}): StandUpReport => ({ id: 'r', facility_id: 'a', week_start: '2026-09-07', version: 1, revision_id: 'rev', values: emptyValues(), status: 'draft', updated_at: '2026-09-11T14:00:00Z', ...patch })
 it('names every one of the six states from stored facts only', () => {
  expect(fieldState(undefined, 'current_total_census')).toBe('no_report')
  expect(fieldState(base({ entry_origin: 'initialized' }), 'current_total_census')).toBe('no_report')
  expect(fieldState(base({ entry_origin: 'manual', values: { ...emptyValues(), current_total_census: 34 } }), 'callouts_last_week')).toBe('not_provided')
  expect(fieldState(base({ entry_origin: 'manual', values: { ...emptyValues(), current_total_census: 34 } }), 'current_total_census')).toBe('provided')
  const held = base({ entry_origin: 'imported', values: { ...emptyValues(), current_total_census: 34 }, field_dispositions: { overtime_reported: 'historical_unit_unconfirmed' } })
  expect(fieldState(held, 'overtime_reported')).toBe('held_unit_unconfirmed')
  expect(fieldState(held, 'callouts_last_week')).toBe('not_provided')
  expect(fieldState(base({ values: { ...emptyValues(), overtime_reported: 15.65 } }), 'overtime_reported')).toBe('needs_duration_review')
  expect(fieldState(base({ values: { ...emptyValues(), overtime_reported: 17.15 }, overtime_issue: true }), 'overtime_reported')).toBe('needs_duration_review')
  expect(fieldState(base({ values: { ...emptyValues(), overtime_reported: 0 } }), 'overtime_reported')).toBe('provided')
  expect(FIELD_STATE_TEXT.source_held).toBe('Source held for review')
  expect(FIELD_STATE_CODES).toEqual({ provided: 0, not_provided: 1, held_unit_unconfirmed: 2, needs_duration_review: 3, source_held: 4 })
  expect(FIELD_STATE_VERSION).toBe(1)
 })
 it('renders the value when provided and the vocabulary text otherwise, never a converted legacy value', () => {
  const held = base({ entry_origin: 'imported', values: { ...emptyValues(), monthly_rent_roll_cents: 9645385, current_total_census: 34 }, field_dispositions: { overtime_reported: 'historical_unit_unconfirmed' } })
  expect(fieldDisplay(held, 'overtime_reported')).toBe('Held: unit unconfirmed')
  expect(fieldDisplay(held, 'monthly_rent_roll_cents')).toBe('$96,453.85')
  expect(fieldDisplay(held, 'callouts_last_week')).toBe('Not provided')
  expect(fieldDisplay(undefined, 'callouts_last_week')).toBe('No report')
  expect(fieldDisplay(base({ values: { ...emptyValues(), overtime_reported: 15.65 } }), 'overtime_reported')).toBe('Needs duration review')
  expect(fieldDisplay(base({ values: { ...emptyValues(), overtime_reported: 17.15 } }), 'overtime_reported')).toBe('17h 15m')
 })
 it('does not count a held raw notation as provided anywhere', () => {
  const values = Object.fromEntries(Object.keys(emptyValues()).map(key => [key, 1])) as StandUpReport['values']
  expect(derivedValues({ ...values, overtime_reported: 17.15 }).completed_fields).toBe(16)
  expect(derivedValues({ ...values, overtime_reported: 15.65 }).completed_fields).toBe(15)
  expect(derivedValues({ ...values, overtime_reported: null }).completed_fields).toBe(15)
  expect(overtimeNeedsReview(base({ values: { ...values, overtime_reported: 15.65 } }))).toBe(true)
  expect(overtimeNeedsReview(base({ values: { ...values, overtime_reported: 17.15 } }))).toBe(false)
  expect(overtimeNeedsReview(undefined)).toBe(false)
 })
 it('keeps a held import held after an unrelated edit and provided once a value is entered', () => {
  const edited = base({ entry_origin: 'manual', values: { ...emptyValues(), current_total_census: 35 }, field_dispositions: { overtime_reported: 'historical_unit_unconfirmed' } })
  expect(fieldState(edited, 'overtime_reported')).toBe('held_unit_unconfirmed')
  expect(fieldState({ ...edited, values: { ...edited.values, overtime_reported: 3.16 }, field_dispositions: {} }, 'overtime_reported')).toBe('provided')
 })
 it('assigns every figure to exactly one section and keeps the away count out of the forecast', () => {
  expect(METRIC_KEYS.every(key => SECTIONS.some(section => section.key === metricSection(key).key))).toBe(true)
  expect(SECTIONS.flatMap(section => sectionMetrics(section.key)).length).toBe(METRIC_KEYS.length)
  expect(metricSection('hospital_and_rehab_total')).toMatchObject({ key: 'census', period: 'current' })
  expect(metricSection('admissions_expected').period).toBe('expected')
  expect(metricSection('callouts_last_week').period).toBe('completed')
 })
 it('labels each section with the period it covers, reads the same on a past report, and never claims an observation time', () => {
  const [census, , admissions, staffing] = SECTIONS
  expect(sectionPeriodLabel(staffing, '2026-09-14')).toBe('Completed week · September 7–13, 2026')
  // Not "this week": the label is read on historical reports too, where the range is the only truthful anchor.
  expect(sectionPeriodLabel(admissions, '2026-09-14')).toBe('Forecast week · September 14–20, 2026')
  expect(sectionPeriodLabel(admissions, '2026-09-07', null, false)).toBe('Forecast week · September 7–13, 2026')
  // The settled as-of point is Monday morning, the state the week starts from (COL-374).
  // source_as_of is when the figures reached Haven — a save, or the connector reading the
  // workbook — and each ALF saves at its own minute, so it is shown rather than implied.
  expect(sectionPeriodLabel(census, '2026-09-14', '2026-09-14T12:31:00Z')).toBe('Monday morning · Figures recorded September 14 at 8:31 a.m. Eastern')
  expect(sectionPeriodLabel(census, '2026-09-14', null, true)).toBe('Monday morning · Figures recorded when you save')
  expect(sectionPeriodLabel(census, '2026-09-07', null, false)).toBe('Monday morning · No recorded time')
 })
 it('writes compact ranges across months and years', () => {
  expect(periodRange('2026-08-31', '2026-09-06')).toBe('August 31 – September 6, 2026')
  expect(periodRange('2025-12-29', '2026-01-04')).toBe('December 29, 2025 – January 4, 2026')
 })
 it('stamps attribution in Eastern time on both sides of noon', () => {
  expect(easternStamp('2026-09-14T12:31:00Z')).toBe('September 14 at 8:31 a.m. Eastern')
  expect(easternStamp('2026-09-15T19:05:00Z')).toBe('September 15 at 3:05 p.m. Eastern')
 })
})
