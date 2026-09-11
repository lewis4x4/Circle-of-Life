import { describe, expect, it } from 'vitest'
import { derivedValues, emptyValues, reportingWeek, validateValues, deadlinePassed, shiftDay, staffingPeriod, reportState, metricDisplay, reportOvertimeMinutes, reportDeadlineState, fieldState, fieldDisplay, overtimeNeedsReview, FIELD_STATE_TEXT, FIELD_STATE_CODES, FIELD_STATE_VERSION, type StandUpReport } from './model'
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
})
