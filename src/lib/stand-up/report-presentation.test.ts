import { describe, expect, it } from 'vitest'
import { changesFromPrevious, lastSaveLine, reportStatus, snapshotAsOf, submissionChecklist, submissionEvidence } from './report-presentation'
import { emptyValues, type StandUpReport } from './model'

const base = (patch: Partial<StandUpReport> = {}): StandUpReport => ({ id: 'r', facility_id: 'a', week_start: '2026-09-14', version: 1, revision_id: 'rev', values: emptyValues(), status: 'draft', updated_at: '2026-09-14T12:31:00Z', ...patch })
const populated = { ...emptyValues(), current_total_census: 34 }

describe('Stand Up report presentation', () => {
 it('asks for administrator review whenever populated figures are not submitted', () => {
  expect(reportStatus(base({ values: populated, entry_origin: 'manual' }))).toEqual({ state: 'Draft', qualifier: 'Administrator review required' })
  // A connector revision carries no entry origin and reads as a draft that still needs a person.
  expect(reportStatus(base({ values: populated }))).toEqual({ state: 'Draft', qualifier: 'Administrator review required' })
  // The imported state already says it is awaiting review; the qualifier is not repeated.
  expect(reportStatus(base({ values: populated, entry_origin: 'imported' }))).toEqual({ state: 'Imported, awaiting review', qualifier: null })
  expect(reportStatus(base({ values: populated, status: 'ready', last_submitted_at: '2026-09-14T12:40:00Z' }))).toEqual({ state: 'Submitted', qualifier: null })
  expect(reportStatus(base({ values: populated, status: 'ready', last_submitted_at: '2026-09-14T12:40:00Z' }, ), true)).toEqual({ state: 'Changes awaiting resubmission', qualifier: 'Administrator review required' })
  expect(reportStatus(base({ entry_origin: 'initialized' }))).toEqual({ state: 'Not started', qualifier: null })
  expect(reportStatus(undefined)).toEqual({ state: 'Not started', qualifier: null })
  // Typing into a new report makes it a draft; "Not started" never sits over live entries.
  expect(reportStatus(undefined, true)).toEqual({ state: 'Draft', qualifier: 'Administrator review required' })
  expect(reportStatus(base({ entry_origin: 'initialized' }), true)).toEqual({ state: 'Draft', qualifier: 'Administrator review required' })
 })
 it('separates submission evidence from the last save and never invents a submission', () => {
  expect(submissionEvidence(base({ values: populated, last_submitted_at: '2026-09-14T12:40:00Z', status: 'ready' }))).toBe('Last submitted September 14 at 8:40 a.m. Eastern.')
  // A connector revision carries no entry origin, and a historical import carries 'imported'.
  expect(submissionEvidence(base({ values: populated }))).toBe('Original submission time unavailable.')
  expect(submissionEvidence(base({ values: populated, entry_origin: 'imported' }))).toBe('Original submission time unavailable.')
  expect(submissionEvidence(base({ values: populated, entry_origin: 'manual' }))).toBe('Not submitted in Haven.')
  expect(submissionEvidence(base({ entry_origin: 'initialized' }))).toBe('Not submitted in Haven.')
  expect(submissionEvidence(undefined)).toBe('Not submitted in Haven.')
 })
 it('attributes the last save to the recorded actor without dressing it up as review', () => {
  expect(lastSaveLine(base({ updated_by: 'connector', updated_by_name: 'Hosted Stand Up Connector' }), 'u'))
   .toBe('Last saved by Hosted Stand Up Connector on September 14 at 8:31 a.m. Eastern.')
  expect(lastSaveLine(base({ updated_by: 'u', updated_by_name: 'Charlene Elmore' }), 'u')).toBe('Last saved by you on September 14 at 8:31 a.m. Eastern.')
  expect(lastSaveLine(base(), 'u')).toBe('Last saved September 14 at 8:31 a.m. Eastern.')
  expect(lastSaveLine(undefined, 'u')).toBe('No saved report yet.')
 })
 it('keeps populated figures, review, unresolved rules and submission as four separate facts', () => {
  const complete = Object.fromEntries(Object.keys(emptyValues()).map(key => [key, 1])) as StandUpReport['values']
  // Every figure present, and still not reviewed: completeness never stands in for approval.
  expect(submissionChecklist({ report: base({ values: complete, entry_origin: 'imported' }), provided: 16, total: 16, unresolved: 14 })).toEqual([
   { term: 'Figures provided', detail: 'All 16' },
   { term: 'Administrator review', detail: 'Not confirmed yet — submitting confirms yours' },
   { term: 'Unresolved definitions', detail: '14 figures — Circle of Life has not settled how they are counted, so they stay provisional' },
   { term: 'Submission', detail: 'Original submission time unavailable.' },
  ])
  const submitted = submissionChecklist({ report: base({ values: complete, status: 'ready', last_submitted_at: '2026-09-14T12:40:00Z' }), provided: 16, total: 16, unresolved: 0 })
  expect(submitted[1].detail).toBe('Confirmed by the last submission')
  expect(submitted[2].detail).toBe('None')
  // A held duration leaves the count unknowable; it is never reported as a figure provided.
  const partial = submissionChecklist({ provided: 15, total: 16, unresolved: 14 })
  expect(partial[0].detail).toBe('15 of 16 — all 16 are needed to submit')
  expect(submissionChecklist({ provided: null, total: 16, unresolved: 14 })[0].detail).toBe('Not countable while a figure needs correction')
 })
 it('reports the recorded observation time only when the report carries one', () => {
  expect(snapshotAsOf(base({ source_as_of: '2026-09-14T12:31:00Z' }))).toBe('2026-09-14T12:31:00Z')
  expect(snapshotAsOf(base({ source_as_of: null }))).toBeNull()
  expect(snapshotAsOf(undefined)).toBeNull()
 })
 it('lists what differs from the previous report, keeping blank distinct from zero', () => {
  const previous = base({ week_start: '2026-09-07', values: { ...emptyValues(), current_total_census: 34, callouts_last_week: 0 } })
  expect(changesFromPrevious({ ...emptyValues(), current_total_census: 36, callouts_last_week: 0 }, previous))
   .toEqual(['Current census: 34 to 36'])
  expect(changesFromPrevious({ ...emptyValues(), current_total_census: 34 }, previous))
   .toEqual(['Callouts last week: 0 to Not provided'])
  expect(changesFromPrevious(populated, undefined)).toEqual([])
 })
})
