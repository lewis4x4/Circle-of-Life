import { describe, expect, it } from 'vitest'
import { changesFromPrevious, lastSaveLine, reportStatus, snapshotAsOf, submissionEvidence } from './report-presentation'
import { emptyValues, type StandUpReport } from './model'

const base = (patch: Partial<StandUpReport> = {}): StandUpReport => ({ id: 'r', facility_id: 'a', week_start: '2026-09-14', version: 1, revision_id: 'rev', values: emptyValues(), status: 'draft', updated_at: '2026-09-14T12:31:00Z', ...patch })
const populated = { ...emptyValues(), current_total_census: 34 }

describe('Stand Up report presentation', () => {
 it('asks for administrator review whenever populated figures are not submitted', () => {
  expect(reportStatus(base({ values: populated, entry_origin: 'manual' }))).toEqual({ state: 'Draft', qualifier: 'Administrator review required' })
  expect(reportStatus(base({ values: populated, entry_origin: 'imported' }))).toEqual({ state: 'Imported, awaiting review', qualifier: 'Administrator review required' })
  expect(reportStatus(base({ values: populated, status: 'ready', last_submitted_at: '2026-09-14T12:40:00Z' }))).toEqual({ state: 'Submitted', qualifier: null })
  expect(reportStatus(base({ values: populated, status: 'ready', last_submitted_at: '2026-09-14T12:40:00Z' }, ), true)).toEqual({ state: 'Changes awaiting resubmission', qualifier: 'Administrator review required' })
  expect(reportStatus(base({ entry_origin: 'initialized' }))).toEqual({ state: 'Not started', qualifier: null })
  expect(reportStatus(undefined)).toEqual({ state: 'Not started', qualifier: null })
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
