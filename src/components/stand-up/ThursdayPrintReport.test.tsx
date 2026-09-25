import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThursdayPrintReport } from './ThursdayPrintReport'

const request = vi.hoisted(() => vi.fn())
vi.mock('./transport', async importOriginal => ({ ...(await importOriginal<typeof import('./transport')>()), standUpRequest: request }))

const facility = {
  facility_id: 'a', facility_name: 'Homewood', week_start: '2026-09-21', since: '2026-09-21T13:15:00Z',
  figures: { current_total_census: { value: 36, source: 'Resident roster' } },
  departures: [], hospital: { out_now: [], went_out: [], came_back: [] }, names_shown: true, admission_notes_shown: true,
  potential_residents: [], recruiters: [],
}
const baseline = { revision_id: 'm1', submitted_at: '2026-09-21T12:40:00Z', values: { current_ar_cents: 11000000, current_total_census: 38, hospital_and_rehab_total: 1 } }

afterEach(() => { cleanup(); request.mockReset() })

describe('printable Thursday report (COL-754)', () => {
  it('prints each facility’s submitted figures beside Monday’s and Haven’s, then its sections', async () => {
    request.mockImplementation(async (action: string) => action === 'report'
      ? { meeting_day: 'thursday', generated_at: '2026-09-24T12:30:00Z', actor_role: 'facility_admin', facilities: [facility] }
      : { meeting_day: 'thursday', scheduled: true, current_week: '2026-09-21', window: null, schedule: [], keys: [], facilities: [], monday_baselines: [],
          can_edit: true, can_edit_submitted: true, server_now: '2026-09-24T12:30:00Z', actor_role: 'facility_admin',
          reports: [{ id: 't1', facility_id: 'a', week_start: '2026-09-21', meeting_day: 'thursday', version: 1, revision_id: 'r', status: 'ready',
            values: { current_ar_cents: 11710800, current_total_census: 36, departures_since_monday: 2, hospital_and_rehab_total: 3, hospital_total: 1, rehab_total: 2 },
            source_as_of: null, updated_at: null, monday_submitted: baseline }] })
    render(<ThursdayPrintReport facilityId="a" week="2026-09-21" />)
    const section = await screen.findByRole('region', { name: 'Homewood' })
    expect(section).toHaveTextContent('Figures submitted by the administrator')
    const census = within(section).getByRole('row', { name: /Current census/ })
    expect(census).toHaveTextContent('36')
    expect(census).toHaveTextContent('38')
    expect(census).toHaveTextContent('−2')
    expect(census).toHaveTextContent('Haven: 36 · Resident roster')
    expect(within(section).getByText('No open referral for this facility.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('report', { meeting_day: 'thursday', facility_id: 'a', week_start: '2026-09-21' })
  })
})
