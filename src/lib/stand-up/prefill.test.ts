import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_AR_INVOICE_STATUSES } from '@/lib/billing/receivables'
import { emptyValues } from './model'
import { PREFILL_KEYS, PREFILL_OVERRIDE_REASONS, expectedPrefillSource, prefillIssues, prefillLine, prefilledValues, recordedPrefillLine, type MondayPrefill } from './prefill'

const root = path.resolve(__dirname, '../../..')
const migration = (name: RegExp) => {
  const file = readdirSync(path.join(root, 'supabase/migrations')).find(entry => name.test(entry))!
  return readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')
}

const prefill: MondayPrefill = {
  facility_id: 'a', week_start: '2026-09-21', computed_at: '2026-09-21T12:00:00Z',
  fields: {
    monthly_rent_roll_cents: { value: 11_710_816, source: 'Invoices in Haven: sent with a balance, plus drafts not yet sent' },
    current_total_census: { value: 34, source: 'Resident roster' },
    callouts_last_week: { value: 2, source: 'Attendance records' },
    current_open_positions: { value: null, source: null, note: 'Haven does not record how many positions each facility is budgeted for' },
  },
}

describe('Monday prefill (COL-753)', () => {
  it('computes Current AR from the same invoice statuses as every other Current AR (COL-665)', () => {
    const sql = migration(/^522_stand_up_monday_prefill\.sql$/)
    const list = sql.match(/i\.status IN \(([^)]+)\)/)![1].match(/'([a-z_]+)'/g)!.map(item => item.slice(1, -1))
    expect(list).toEqual([...CURRENT_AR_INVOICE_STATUSES])
  })

  it('holds the same override reasons as the server', () => {
    const sql = migration(/^522_stand_up_monday_prefill\.sql$/)
    const server = sql.match(/override_reason IN \(([^)]+)\)/)![1].match(/'([a-z_]+)'/g)!.map(item => item.slice(1, -1))
    expect(server).toEqual(PREFILL_OVERRIDE_REASONS.map(reason => reason.key))
  })

  it('leaves census and hospital to the roster confirmation', () => {
    expect(PREFILL_KEYS).not.toContain('current_total_census')
    expect(PREFILL_KEYS).not.toContain('hospital_and_rehab_total')
    expect(PREFILL_KEYS).toHaveLength(10)
  })

  it('opens an unstarted report with Haven’s figures and leaves what Haven cannot compute blank, never 0', () => {
    const values = prefilledValues(prefill, emptyValues())
    expect(values.monthly_rent_roll_cents).toBe(11_710_816)
    expect(values.current_total_census).toBe(34)
    expect(values.current_open_positions).toBeNull()
    expect(values.overtime_reported).toBeNull()
    // A figure already typed is never overwritten.
    expect(prefilledValues(prefill, { ...emptyValues(), callouts_last_week: 5 }).callouts_last_week).toBe(5)
  })

  it('says where each figure came from, or why Haven has none', () => {
    expect(prefillLine(prefill, 'monthly_rent_roll_cents')).toBe('Haven: $117,108.16 · Invoices in Haven: sent with a balance, plus drafts not yet sent')
    expect(prefillLine(prefill, 'current_open_positions')).toBe('Haven cannot compute this: Haven does not record how many positions each facility is budgeted for')
  })

  it('knows the source the server will record, and asks for a reason only for a differing figure', () => {
    expect(expectedPrefillSource(prefill, 'callouts_last_week', 2)).toBe('haven_confirmed')
    expect(expectedPrefillSource(prefill, 'callouts_last_week', 5)).toBe('overridden')
    expect(expectedPrefillSource(prefill, 'current_open_positions', 3)).toBe('entered_no_source')
    expect(expectedPrefillSource(prefill, 'callouts_last_week', null)).toBeNull()
    const values = { ...prefilledValues(prefill, emptyValues()), callouts_last_week: 5 }
    expect(prefillIssues(prefill, values, {})).toEqual(['callouts_last_week'])
    expect(prefillIssues(prefill, values, { callouts_last_week: 'haven_not_current' })).toEqual([])
  })

  it('reads back what a saved report recorded', () => {
    expect(recordedPrefillLine('callouts_last_week', { source: 'haven_confirmed', haven_value: 2, confirmed: 2, override_reason: null, haven_source: null, computed_at: '', confirmed_at: '' })).toBe('Confirmed from Haven (2)')
    expect(recordedPrefillLine('callouts_last_week', { source: 'overridden', haven_value: 2, confirmed: 5, override_reason: 'haven_not_current', haven_source: null, computed_at: '', confirmed_at: '' })).toBe('Haven had 2 · override: Haven is not up to date')
    expect(recordedPrefillLine('current_open_positions', { source: 'entered_no_source', haven_value: null, confirmed: 3, override_reason: null, haven_source: null, computed_at: '', confirmed_at: '' })).toBe('Entered where Haven had no figure')
  })
})
