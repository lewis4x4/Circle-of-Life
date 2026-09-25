import { describe, expect, it } from 'vitest'
import { chipText, parseDisagreements, parseNotices, readReconcileRequest, reconcileHref, showsChip } from './census-disagreement'

const row = (patch: Record<string, unknown> = {}, figure: Record<string, unknown> = {}) => ({
  facility_id: 'f1', facility_name: 'Homewood Lodge', meeting_day: 'monday', week_start: '2026-09-21',
  entry_due_at: '2026-09-21T12:45:00Z', call_at: '2026-09-21T13:15:00Z', state: 'open', unreconciled: false,
  roster_as_of: '2026-09-20T12:00:00Z', reason_window_days: 7,
  figures: [
    { key: 'current_total_census', label: 'Census', stand_up: 35, roster: 33, state: 'open', reason: null, reason_at: null, reason_until: null, roster_changed_since_reason: false, ...figure },
    { key: 'hospital_and_rehab_total', label: 'At hospital or rehab', stand_up: 1, roster: 1, state: 'agrees', reason: null, reason_at: null, reason_until: null, roster_changed_since_reason: false },
  ],
  ...patch,
})

describe('census disagreement (COL-555)', () => {
  it('words the same fact the same way everywhere, with both numbers in the words', () => {
    const [open] = parseDisagreements([row()])!
    expect(chipText(open)).toBe('Monday Stand Up disagrees with the roster · Census: Stand Up 35, roster 33')
    const [explained] = parseDisagreements([row({ state: 'explained' }, { state: 'explained', reason: 'change_not_entered', reason_at: '2026-09-21T13:00:00Z', reason_until: '2026-09-28T13:00:00Z' })])!
    expect(chipText(explained)).toBe('Monday Stand Up differs from the roster, explained · Census: Stand Up 35, roster 33 · reason: Admission or discharge not entered in Haven (Sep 21, until Sep 28)')
    const [lapsed] = parseDisagreements([row({}, { reason: 'roster_not_current', reason_at: '2026-09-14T13:00:00Z', roster_changed_since_reason: true })])!
    expect(chipText(lapsed)).toContain('reason: Roster not updated yet (Sep 14, the roster has changed since)')
    const [late] = parseDisagreements([row({ unreconciled: true, meeting_day: 'thursday' })])!
    expect(chipText(late)).toBe('Thursday Stand Up census unreconciled · Census: Stand Up 35, roster 33')
  })

  it('shows a chip only for open or explained disagreements', () => {
    expect(showsChip(parseDisagreements([row()])![0])).toBe(true)
    expect(showsChip(parseDisagreements([row({ state: 'agrees' })])![0])).toBe(false)
    expect(showsChip(parseDisagreements([row({ state: 'not_entered' })])![0])).toBe(false)
  })

  it('refuses an unreadable answer rather than showing agreement', () => {
    expect(parseDisagreements({})).toBeNull()
    expect(parseDisagreements([row({ state: 'fine' })])).toBeNull()
    expect(parseDisagreements([row({ figures: [{ key: 'other' }] })])).toBeNull()
    expect(parseNotices([{ id: 'n' }])).toBeNull()
  })

  it('sends every Reconcile to the report with the dialog open, and reads it back', () => {
    const href = reconcileHref({ facility_id: 'f1', meeting_day: 'thursday' })
    expect(href).toBe('/admin/stand-up?facility=f1&meeting=thursday&reconcile=1')
    expect(readReconcileRequest(href.slice(href.indexOf('?')))).toEqual({ facilityId: 'f1', meeting: 'thursday' })
    expect(readReconcileRequest('?facility=f1&meeting=friday&reconcile=1')).toBeNull()
    expect(readReconcileRequest('?facility=f1&meeting=monday')).toBeNull()
  })
})
