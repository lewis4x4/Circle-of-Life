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
    const [explained] = parseDisagreements([row({ state: 'explained' }, { state: 'explained', reason: 'change_not_entered', reason_label: 'Admission or discharge not entered in Haven', reason_at: '2026-09-21T13:00:00Z', reason_until: '2026-09-28T13:00:00Z' })])!
    expect(chipText(explained)).toBe('Monday Stand Up differs from the roster, explained · Census: Stand Up 35, roster 33 · reason: Admission or discharge not entered in Haven (Sep 21, until Sep 28)')
    const [lapsed] = parseDisagreements([row({}, { reason: 'roster_not_current', reason_label: 'Roster not updated yet', reason_at: '2026-09-14T13:00:00Z', roster_changed_since_reason: true })])!
    expect(chipText(lapsed)).toContain('reason: Roster not updated yet (Sep 14, the roster has changed since)')
    const [late] = parseDisagreements([row({ unreconciled: true, meeting_day: 'thursday' })])!
    expect(chipText(late)).toBe('Thursday Stand Up census unreconciled · Census: Stand Up 35, roster 33')
  })

  it('names a reason by the label it was given with, from the facility setting (COL-555)', () => {
    const [d] = parseDisagreements([row({ state: 'explained', reason_options: [{ key: 'awaiting_paperwork', label: 'Paperwork not back' }] },
      { state: 'explained', reason: 'awaiting_paperwork', reason_label: 'Paperwork not back', reason_at: '2026-09-21T13:00:00Z', reason_until: '2026-09-28T13:00:00Z' })])!
    expect(chipText(d)).toContain('reason: Paperwork not back (Sep 21, until Sep 28)')
    expect(d.reason_options).toEqual([{ key: 'awaiting_paperwork', label: 'Paperwork not back' }])
    // An unreadable reason list offers nothing rather than a list from code.
    expect(parseDisagreements([row({ reason_options: [{ key: 'Bad Key', label: 'x' }] })])![0].reason_options).toEqual([])
  })

  it('words a Thursday check against Monday with Monday and the roster change (COL-751)', () => {
    const [d] = parseDisagreements([row({ meeting_day: 'thursday', compares_with_monday: true }, {
      against: 'monday', label: 'Census against Monday', stand_up: 35, roster: 34, monday: 33, roster_change_since_monday: 1 })])!
    expect(d.compares_with_monday).toBe(true)
    expect(d.figures[0].against).toBe('monday')
    expect(chipText(d)).toBe("Thursday Stand Up disagrees with the roster · Census against Monday: Stand Up 35, Monday 33 with the roster's change since (+1) is 34")
    expect(parseDisagreements([row({}, { against: 'tuesday' })])).toBeNull()
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
