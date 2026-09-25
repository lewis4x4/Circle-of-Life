import { describe, expect, it } from 'vitest'
import { emptyThursdayValues } from './meetings'
import { admissionLine, bridgeGapText, bridgeSentence, bridgeStateLabel, bridgeTerms, recruiterItemLine, reportFigureLine, thursdayPrefill, thursdayPrintHref, timelineLine, type FacilityReport } from './thursday-report'

const report = {
  facility_id: 'a', facility_name: 'Homewood', week_start: '2026-09-21', since: '2026-09-21T13:15:00Z',
  figures: {
    current_ar_cents: { value: null, source: null, note: 'Haven has no invoices for this facility' },
    current_total_census: { value: 34, source: 'Resident roster' },
    hospital_total: { value: 1, source: 'Resident roster: stays recorded as hospital', note: '1 stay(s) have no hospital or rehab recorded and are in the total only' },
  },
} as unknown as FacilityReport

describe('Thursday report (COL-754)', () => {
  it('prefills what Haven computes and leaves the rest blank, never 0', () => {
    const values = thursdayPrefill(report, emptyThursdayValues())
    expect(values.current_total_census).toBe(34)
    expect(values.current_ar_cents).toBeNull()
    expect(values.departures_since_monday).toBeNull()
    expect(thursdayPrefill(report, { ...emptyThursdayValues(), current_total_census: 30 }).current_total_census).toBe(30)
  })

  it('says where a figure came from, or why Haven has none', () => {
    expect(reportFigureLine(report, 'current_ar_cents', String)).toBe('Haven cannot compute this: Haven has no invoices for this facility')
    expect(reportFigureLine(report, 'hospital_total', String)).toBe('Haven: 1 · Resident roster: stays recorded as hospital (1 stay(s) have no hospital or rehab recorded and are in the total only)')
    expect(reportFigureLine(report, 'rehab_total', String)).toBeNull()
  })

  it('words notes, tours, admission stages and recruiter activity without raw codes', () => {
    expect(timelineLine({ at: '', recorded_at: '', new: true, kind: 'contact', by: 'R', method: 'phone_call', with: 'Jordan', text: 'Wants a tour.', status: null })).toBe('Phone call with Jordan · Wants a tour.')
    expect(timelineLine({ at: '', recorded_at: '', new: false, kind: 'tour', by: 'R', method: null, with: null, text: 'Loved the garden.', status: 'no_show' })).toBe('Tour no show · Loved the garden.')
    // Migration 549: clinical admission notes.
    expect(timelineLine({ at: '', recorded_at: '', new: true, kind: 'physician_orders', by: null, method: null, with: null, text: 'Metformin 500 mg twice daily', status: null })).toBe('Physician orders · Metformin 500 mg twice daily')
    expect(timelineLine({ at: '', recorded_at: '', new: true, kind: 'form_1823', by: 'Dr. Reyes', method: null, with: null, text: 'Allergies: penicillin', status: 'received' })).toBe('Form 1823 · Allergies: penicillin')
    expect(timelineLine({ at: '', recorded_at: '', new: true, kind: 'arrival_decision', by: 'A', method: 'withdrawn', with: null, text: 'Bed not ready', status: null })).toBe('Arrival approval withdrawn · Bed not ready')
    expect(timelineLine({ at: '', recorded_at: '', new: true, kind: 'arrival_decision', by: 'A', method: 'approved', with: null, text: null, status: null })).toBe('Arrival approved')
    expect(timelineLine({ at: '', recorded_at: '', new: false, kind: 'admission_note', by: null, method: null, with: null, text: 'Orders pending.', status: null })).toBe('Admission notes · Orders pending.')
    expect(admissionLine({ status: 'bed_reserved', target_move_in_date: '2026-10-05', financial_clearance_at: null, physician_orders_received_at: null, medicaid_pipeline_stage: 'app_requested', bed_label: '101-A', form_1823_status: null }))
      .toEqual(['Case: Bed reserved', 'Form 1823: Not on file', 'Financial clearance: Not yet', 'Physician orders: Not yet', 'Bed: 101-A', 'Target move-in: Oct 5', 'Medicaid: App requested'])
    expect(recruiterItemLine({ at: '', kind: 'outreach', lead_name: 'St. Mary’s', method: 'facility_outreach', text: null, status: 'planned' })).toBe('Outreach: Facility outreach · St. Mary’s')
    expect(recruiterItemLine({ at: '', kind: 'contact', lead_name: 'Avery Prospect', method: 'text_message', text: 'Sent brochure.', status: null })).toBe('Text message · Avery Prospect · Sent brochure.')
  })

  it('links to the printable report for one facility and week, or for every facility', () => {
    expect(thursdayPrintHref({ facilityId: 'a', week: '2026-09-21' })).toBe('/print/stand-up/thursday?facility=a&week=2026-09-21')
    expect(thursdayPrintHref({})).toBe('/print/stand-up/thursday')
  })
})

describe('the census bridge in words (COL-749 ruling 3)', () => {
  const base = { state: 'matches' as const, monday_census: 30, monday_at: '2026-09-21T12:40:00Z', arrivals: 1, departures: 0, hospital_out: 2, returns: 1,
    hospital_in_census: false, expected: 30, actual: 30, gap: 0, tolerance: 0, through: '2026-09-24T12:31:00Z' }
  it('subtracts stays and adds returns when the census leaves hospital stays out, exactly as the bridge reads', () => {
    expect(bridgeTerms(base).map(term => `${term.sign} ${term.label}${term.movesCensus ? '' : ' (no change)'}`))
      .toEqual(['+ 1 arrival', '− 0 departures', '− 2 hospital or rehab out', '+ 1 return'])
    expect(bridgeSentence(base)).toBe('Census bridge matches: Monday 30, plus 1 arrival, minus 0 departures, minus 2 hospital or rehab out, plus 1 return, expected 30. Thursday 30, exactly as expected.')
  })
  it('names a gap within the tolerance, a missing Thursday and a missing Monday without inventing a number', () => {
    expect(bridgeStateLabel({ ...base, actual: 31, gap: 1, tolerance: 1 })).toBe('Matches within 1')
    expect(bridgeSentence({ ...base, state: 'not_entered', actual: null, gap: null })).toBe('Census bridge so far: Monday 30, plus 1 arrival, minus 0 departures, minus 2 hospital or rehab out, plus 1 return, expected 30. Thursday’s census is not entered yet.')
    expect(bridgeSentence({ ...base, state: 'no_monday', monday_census: null, expected: null, actual: 30, gap: null })).toMatch(/not submitted, so there is nothing to bridge from/)
    expect(bridgeGapText({ ...base, gap: -2 })).toBe('2 residents fewer than expected')
  })
})
