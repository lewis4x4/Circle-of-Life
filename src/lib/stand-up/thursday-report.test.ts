import { describe, expect, it } from 'vitest'
import { emptyThursdayValues } from './meetings'
import { admissionLine, recruiterItemLine, reportFigureLine, thursdayPrefill, thursdayPrintHref, timelineLine, type FacilityReport } from './thursday-report'

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
