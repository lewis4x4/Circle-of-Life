import { describe, expect, it } from 'vitest'
import { buildStandUpPrint } from './print-sheet'
import { emptyValues, METRICS, type StandUpReport } from './model'

const report = (patch: Partial<StandUpReport> = {}): StandUpReport => ({
  id: 'r', facility_id: 'f', week_start: '2026-09-21', version: 3, revision_id: 'v', status: 'ready', updated_at: '2026-09-21T12:40:00Z',
  values: { ...emptyValues(), current_total_census: 33, sp_flexible_beds_open: 6, monthly_rent_roll_cents: 12345600 },
  source_as_of: '2026-09-21T12:31:00Z', first_submitted_at: '2026-09-21T12:40:00Z', last_submitted_at: '2026-09-21T12:40:00Z', updated_by_name: 'Charlene Elmore',
  roster_confirmations: { sp_flexible_beds_open: { source: 'roster_confirmed', suggested: 6, confirmed: 6, override_reason: null, roster_as_of: '2026-09-21T11:00:00Z', confirmed_at: '2026-09-21T12:31:00Z' } },
  ...patch,
})

describe('Stand Up printout (A6)', () => {
  it('prints every figure once under the period it describes, with its definition', () => {
    const sheet = buildStandUpPrint({ facilityName: 'Homewood Lodge', week: '2026-09-21', report: report() })
    expect(sheet.facility).toBe('Homewood Lodge')
    expect(sheet.week).toBe('Meeting week of September 21, 2026')
    expect(sheet.state).toBe('Submitted')
    const rows = sheet.sections.flatMap(section => section.rows)
    expect(rows.map(row => row.key)).toEqual(METRICS.map(metric => metric.key))
    expect(rows.every(row => row.definition.length > 0)).toBe(true)
    expect(rows.find(row => row.key === 'current_total_census')?.value).toBe('33')
    expect(rows.find(row => row.key === 'monthly_rent_roll_cents')?.value).toBe('$123,456.00')
    expect(rows.find(row => row.key === 'tours_expected')?.value).toBe('Not provided')
  })
  it('shows what Haven recorded for a checked figure, and the previous report when there is one', () => {
    const sheet = buildStandUpPrint({ facilityName: 'Homewood Lodge', week: '2026-09-21', report: report(), prior: report({ values: { ...emptyValues(), sp_flexible_beds_open: 4 } }) })
    const flexible = sheet.sections.find(section => section.key === 'beds')!.rows.find(row => row.key === 'sp_flexible_beds_open')!
    expect(flexible.checked).toBe('Confirmed from the roster (6)')
    expect(flexible.previous).toBe('4')
    expect(sheet.sections.find(section => section.key === 'marketing')!.rows[0].checked).toBeNull()
  })
  it('retains a historical bed prefill confirmation after beds move to roster verification', () => {
    const old = report({ roster_confirmations: {}, prefill_confirmations: { sp_flexible_beds_open: { source: 'haven_confirmed', haven_value: 6, confirmed: 6, override_reason: null, haven_source: 'Historical stored category', computed_at: '2026-09-21T12:30:00Z', confirmed_at: '2026-09-21T12:31:00Z' } } });
    const sheet = buildStandUpPrint({ facilityName: 'Test facility', week: old.week_start, report: old });
    expect(sheet.sections.find(section => section.key === 'beds')!.rows.find(row => row.key === 'sp_flexible_beds_open')!.checked).toBe('Confirmed from Haven (6)');
  })
  it('prints a week with no report as not started rather than as zeros', () => {
    const sheet = buildStandUpPrint({ facilityName: 'Oakridge', week: '2026-09-21' })
    expect(sheet.state).toBe('Not started')
    expect(sheet.sections.flatMap(section => section.rows).every(row => row.value === 'No report')).toBe(true)
  })
})
