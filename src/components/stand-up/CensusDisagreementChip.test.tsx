import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CensusDisagreementChips } from './CensusDisagreementChip'
import { CensusNotices } from './CensusNotices'
import { ReconcileDialog } from './ReconcileDialog'
import { parseDisagreements } from '@/lib/stand-up/census-disagreement'
import { axeViolations } from '@/test-utils/axe'

const rpc = vi.hoisted(() => vi.fn())
const tables = vi.hoisted(() => ({ residents: [] as unknown[], admission_cases: [] as unknown[] }))
// The inline roster fix reads the facility's roster and waiting arrivals through the browser client.
function query(data: unknown[]) {
  const q: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit']) q[method] = () => q
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  return q
}
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc, from: (table: 'residents' | 'admission_cases') => query(tables[table] ?? []) }) }))

const disagreement = (state = 'open', patch: Record<string, unknown> = {}) => ({
  facility_id: 'f1', facility_name: 'Homewood Lodge', meeting_day: 'monday', week_start: '2026-09-21',
  entry_due_at: '2026-09-21T12:45:00Z', call_at: '2026-09-21T13:15:00Z', state, unreconciled: false, roster_as_of: null, reason_window_days: 7,
  reason_options: [{ key: 'change_not_entered', label: 'Admission or discharge not entered in Haven' }, { key: 'other', label: 'Other' }],
  figures: [{ key: 'current_total_census', label: 'Census', stand_up: 35, roster: 33, state, reason: null, reason_at: null, reason_until: null, roster_changed_since_reason: false }],
  ...patch,
})

beforeEach(() => { rpc.mockReset(); tables.residents = []; tables.admission_cases = [] })
afterEach(() => cleanup())

describe('census disagreement chip (COL-555)', () => {
  it('is announced with both numbers and links to Reconcile', async () => {
    rpc.mockResolvedValue({ data: [disagreement()], error: null })
    render(<CensusDisagreementChips facilityId="f1" />)
    const chip = await screen.findByRole('status', { name: /Census: Stand Up 35, roster 33/ })
    expect(within(chip).getByRole('link', { name: 'Reconcile' })).toHaveAttribute('href', '/admin/stand-up?facility=f1&meeting=monday&reconcile=1')
    expect(rpc).toHaveBeenCalledWith('stand_up_census_disagreements', { p_facility: 'f1' })
  })

  it('shows nothing when the figures agree, when nothing is entered, or when the reader may not see Stand Up', async () => {
    rpc.mockResolvedValueOnce({ data: [disagreement('agrees'), disagreement('not_entered', { meeting_day: 'thursday' })], error: null })
    const { container } = render(<CensusDisagreementChips facilityId="f1" />)
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    cleanup()
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    const denied = render(<CensusDisagreementChips facilityId="f1" />)
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
    expect(denied.container).toBeEmptyDOMElement()
  })
})

describe('reconcile in either direction (COL-555)', () => {
  it('offers the roster figure, the facility’s own reasons, and fixes the roster inside the dialog', async () => {
    const onUseRoster = vi.fn(); const onExplain = vi.fn(); const onCheckAgain = vi.fn()
    tables.residents = [{ id: 'r1', first_name: 'Test', last_name: 'Resident', preferred_name: null, status: 'active', bed_hold_stay_type: null }]
    const [d] = parseDisagreements([disagreement()])!
    render(<ReconcileDialog disagreement={d} open onOpenChange={() => {}} canChange onUseRoster={onUseRoster} onExplain={onExplain} onCheckAgain={onCheckAgain} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use the roster for census: 33' }))
    expect(onUseRoster).toHaveBeenCalledWith(d.figures[0])
    // The roster is fixed here, not in a new tab.
    expect(screen.queryByRole('link', { name: 'Open the resident roster' })).not.toBeInTheDocument()
    expect(await screen.findByText('Residents on the roster (1)')).toBeInTheDocument()
    expect(screen.getByText('Arrivals waiting to be confirmed (0)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Record discharge/ })).toBeInTheDocument()
    // Checking again re-reads the disagreement and says when the two agree.
    rpc.mockResolvedValueOnce({ data: [disagreement('agrees')], error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('The report and the roster agree now. Nothing is left to reconcile.')).toBeInTheDocument()
    expect(onCheckAgain).toHaveBeenCalled()
  })

  it('records a reason from the facility’s list, never a list in code', () => {
    const onExplain = vi.fn()
    const [d] = parseDisagreements([disagreement()])!
    render(<ReconcileDialog disagreement={d} open onOpenChange={() => {}} canChange onUseRoster={() => {}} onExplain={onExplain} onCheckAgain={() => {}} canFixRoster={false} />)
    const select = screen.getByLabelText('Why census is different')
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose a reason', 'Admission or discharge not entered in Haven', 'Other'])
    expect(screen.getByRole('button', { name: 'Record the reason for census' })).toBeDisabled()
    fireEvent.change(select, { target: { value: 'change_not_entered' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record the reason for census' }))
    expect(onExplain).toHaveBeenCalledWith(d.figures[0], 'change_not_entered')
  })

  it('offers Thursday’s reason too, and says so where a reason cannot be recorded', () => {
    const onExplain = vi.fn()
    const [thursday] = parseDisagreements([disagreement('open', { meeting_day: 'thursday' })])!
    const first = render(<ReconcileDialog disagreement={thursday} open onOpenChange={() => {}} canChange onUseRoster={() => {}} onExplain={onExplain} onCheckAgain={() => {}} canFixRoster={false} />)
    expect(screen.getByLabelText('Why census is different')).toBeInTheDocument()
    first.unmount()
    render(<ReconcileDialog disagreement={thursday} open onOpenChange={() => {}} canChange onUseRoster={() => {}} onCheckAgain={() => {}} canFixRoster={false} explainUnavailable="A reason can be recorded only on the open Thursday report, by its administrator." />)
    expect(screen.getByText(/can be recorded only on the open Thursday report/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Record the reason/ })).not.toBeInTheDocument()
  })

  it('offers Monday’s figure with the roster’s change on a Thursday check against Monday (COL-751)', () => {
    const [d] = parseDisagreements([disagreement('open', { meeting_day: 'thursday', compares_with_monday: true, figures: [
      { key: 'current_total_census', against: 'monday', label: 'Census against Monday', stand_up: 35, roster: 34, monday: 33, roster_change_since_monday: 1, state: 'open', reason: null, reason_at: null, reason_until: null, roster_changed_since_reason: false }] })])!
    const onUseRoster = vi.fn()
    render(<ReconcileDialog disagreement={d} open onOpenChange={() => {}} canChange onUseRoster={onUseRoster} onCheckAgain={() => {}} canFixRoster={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use Monday’s census with the roster’s change: 34' }))
    expect(onUseRoster).toHaveBeenCalledWith(d.figures[0])
  })
})

describe('accessibility of the chip and the dialog (COL-555)', () => {
  it('the chip passes axe and is announced with its two numbers', async () => {
    rpc.mockResolvedValue({ data: [disagreement()], error: null })
    const { container } = render(<CensusDisagreementChips facilityId="f1" />)
    const chip = await screen.findByRole('status', { name: 'Monday Stand Up disagrees with the roster · Census: Stand Up 35, roster 33' })
    expect(chip).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })

  it('the Reconcile dialog, with the roster fix open, passes axe', async () => {
    tables.residents = [{ id: 'r1', first_name: 'Test', last_name: 'Resident', preferred_name: null, status: 'hospital_hold', bed_hold_stay_type: 'rehab' }]
    const [d] = parseDisagreements([disagreement()])!
    render(<ReconcileDialog disagreement={d} open onOpenChange={() => {}} canChange onUseRoster={() => {}} onExplain={() => {}} onCheckAgain={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'Reconcile census · Homewood Lodge' })
    await screen.findByText('Residents on the roster (1)')
    for (const summary of within(dialog).getAllByText(/\(\d+\)$/)) fireEvent.click(summary)
    expect(await axeViolations(dialog)).toEqual([])
  })
})

describe('census notices (COL-751)', () => {
  it('shows what was sent, in plain words, with a link to reconcile', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'n1', facility_id: 'f1', facility_name: 'Homewood Lodge', meeting_day: 'thursday', week_start: '2026-09-21', phase: 'before_deadline',
      entry_due_at: '2026-09-24T12:45:00Z', sent_at: '2026-09-24T11:45:00Z', message: 'Census: Stand Up says 35, roster says 33. Reconcile before 8:45 AM.', unreconciled: false,
      figures: [{ key: 'current_total_census', label: 'Census', stand_up: 35, roster: 33, state: 'open', reason: null, reason_at: null, reason_until: null, roster_changed_since_reason: false }] }], error: null })
    render(<CensusNotices />)
    const notice = await screen.findByRole('alert')
    expect(notice).toHaveTextContent('Census disagrees with the roster · Homewood Lodge, Thursday Stand Up')
    expect(notice).toHaveTextContent('Census: Stand Up says 35, roster says 33')
    expect(notice).toHaveTextContent('Due September 24 at 8:45 a.m. Eastern.')
    expect(within(notice).getByRole('link', { name: 'Reconcile' })).toHaveAttribute('href', '/admin/stand-up?facility=f1&meeting=thursday&reconcile=1')
    expect(rpc).toHaveBeenCalledWith('stand_up_census_notices_for_me')
  })
})
