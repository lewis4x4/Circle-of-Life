import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CensusDisagreementChips } from './CensusDisagreementChip'
import { CensusNotices } from './CensusNotices'
import { ReconcileDialog } from './ReconcileDialog'
import { parseDisagreements } from '@/lib/stand-up/census-disagreement'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }))

const disagreement = (state = 'open', patch: Record<string, unknown> = {}) => ({
  facility_id: 'f1', facility_name: 'Homewood Lodge', meeting_day: 'monday', week_start: '2026-09-21',
  entry_due_at: '2026-09-21T12:45:00Z', call_at: '2026-09-21T13:15:00Z', state, unreconciled: false, roster_as_of: null, reason_window_days: 7,
  figures: [{ key: 'current_total_census', label: 'Census', stand_up: 35, roster: 33, state, reason: null, reason_at: null, reason_until: null, roster_changed_since_reason: false }],
  ...patch,
})

beforeEach(() => rpc.mockReset())
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
  it('offers the roster figure, the roster itself, and a reason', () => {
    const onUseRoster = vi.fn(); const onExplain = vi.fn(); const onCheckAgain = vi.fn()
    const [d] = parseDisagreements([disagreement()])!
    render(<ReconcileDialog disagreement={d} open onOpenChange={() => {}} canChange onUseRoster={onUseRoster} onExplain={onExplain} onCheckAgain={onCheckAgain} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use the roster for census: 33' }))
    expect(onUseRoster).toHaveBeenCalledWith(d.figures[0])
    expect(screen.getByRole('link', { name: 'Open the resident roster' })).toHaveAttribute('href', '/admin/residents')
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(onCheckAgain).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Record the reason' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Why census is different'), { target: { value: 'change_not_entered' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record the reason' }))
    expect(onExplain).toHaveBeenCalledWith(d.figures[0], 'change_not_entered')
  })

  it('says so where the meeting records no reasons', () => {
    const [d] = parseDisagreements([disagreement('open', { meeting_day: 'thursday' })])!
    render(<ReconcileDialog disagreement={d} open onOpenChange={() => {}} canChange onUseRoster={() => {}} onCheckAgain={() => {}} explainUnavailable="The Thursday report records no reasons. Put the roster’s figure on it, or fix the roster." />)
    expect(screen.getByText(/records no reasons/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record the reason' })).not.toBeInTheDocument()
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
