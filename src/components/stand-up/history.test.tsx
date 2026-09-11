import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyValues, type StandUpReport } from '@/lib/stand-up/model';
import { StandUpHistory, revisionChanges } from './history';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./transport', async importOriginal => ({ ...(await importOriginal<typeof import('./transport')>()), standUpRequest: mocks.request }));
afterEach(cleanup);
beforeEach(() => { mocks.request.mockReset(); });
function report(id: string, week: string, values: Partial<StandUpReport['values']>, facility = 'a', patch: Partial<StandUpReport> = {}): StandUpReport {
  return { id, week_start: week, facility_id: facility, version: 1, revision_id: id, values: { ...emptyValues(), ...values }, status: 'draft', source_as_of: null, updated_at: '2026-09-14T13:00:00Z', ...patch };
}
describe('facility history analytics', () => {
  it('compares previous available reports, labels gaps, formats money like the form, and excludes other facilities', () => {
    render(<StandUpHistory facilityId="a" facilityName="Homewood" reports={[
      report('old', '2026-08-31', { monthly_rent_roll_cents: 9645385, current_total_census: 10 }),
      report('other', '2026-09-07', { monthly_rent_roll_cents: 999999 }, 'b'),
      report('new', '2026-09-14', { monthly_rent_roll_cents: 9777078, current_total_census: 12 }),
    ]} />);
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('2026-09-14');
    expect(within(rows[1]).getByText('Compared with 2026-08-31 — gap in weekly reports')).toBeInTheDocument();
    expect(within(rows[1]).getByText('$97,770.78')).toBeInTheDocument();
    expect(within(rows[1]).getByText('+$1,316.93')).toBeInTheDocument();
    expect(within(rows[1]).getByText('+2')).toBeInTheDocument();
    expect(screen.queryByText('$97770.78')).not.toBeInTheDocument();
    expect(screen.queryByText('$9,999.99')).not.toBeInTheDocument();
  });
  it('preserves known zero and unknown source time without inventing a change or average', () => {
    render(<StandUpHistory facilityId="a" facilityName="Homewood" reports={[
      report('old', '2026-09-07', {}),
      report('new', '2026-09-14', { current_total_census: 0, callouts_last_week: 0, overtime_reported: 0 }),
    ]} />);
    const latest = within(screen.getAllByRole('row')[1]);
    expect(latest.getAllByText('Change unavailable')).toHaveLength(2);
    expect(latest.getByText('Not calculable')).toBeInTheDocument();
    expect(latest.getByText('Unknown')).toBeInTheDocument();
    expect(latest.getAllByText('0')).toHaveLength(2);
    expect(latest.getByText('0h 0m')).toBeInTheDocument();
    expect(latest.getByText('Compared with 2026-09-07')).toBeInTheDocument();
  });
  it('names why each figure is absent with the shared vocabulary', () => {
    render(<StandUpHistory facilityId="a" facilityName="Homewood" reports={[
      report('held', '2026-08-31', { current_total_census: 34 }, 'a', { entry_origin: 'imported', field_dispositions: { overtime_reported: 'historical_unit_unconfirmed' } }),
      report('review', '2026-09-07', { current_total_census: 34, overtime_reported: 15.65 }, 'a', { entry_origin: 'manual' }),
      report('blank', '2026-09-14', { current_total_census: 35 }, 'a', { entry_origin: 'manual' }),
    ]} />);
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getAllByText('Not provided').length).toBeGreaterThan(0);
    expect(within(rows[2]).getByText('Needs duration review')).toBeInTheDocument();
    const held = within(rows[3]).getAllByRole('cell');
    expect(held[4]).toHaveTextContent('Held: unit unconfirmed'); expect(held[4]).not.toHaveTextContent('Not provided');
    expect(held[3]).toHaveTextContent('Not provided');
    expect(within(rows[3]).getByText('Imported, awaiting review')).toBeInTheDocument();
  });
  it('shows what changed on a revision from Haven revisions, per field, with time and person', async () => {
    mocks.request.mockResolvedValueOnce({ facility_id: 'a', week_start: '2026-09-07', revisions: [
      { version: 1, revision_id: 'r1', status: 'draft', created_at: '2026-09-11T14:15:00Z', reason: 'Historical import', values: { ...emptyValues(), monthly_rent_roll_cents: 9645385, current_total_census: 34 }, updated_by: 'u', updated_by_name: 'Brian T Lewis', entry_origin: 'imported' },
      { version: 2, revision_id: 'r2', status: 'draft', created_at: '2026-09-11T14:17:00Z', reason: null, values: { ...emptyValues(), monthly_rent_roll_cents: 9777078, current_total_census: 34 }, updated_by: 'u', updated_by_name: 'Brian T Lewis', entry_origin: 'manual' },
    ] });
    render(<StandUpHistory facilityId="a" facilityName="Homewood" reports={[report('r', '2026-09-07', { monthly_rent_roll_cents: 9777078, current_total_census: 34 }, 'a', { version: 2 })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'What changed · 2 revisions' }));
    expect(await screen.findByText(/Revision 2 · Sep 11, 10:17 AM Eastern · Brian T Lewis · Draft saved/)).toBeInTheDocument();
    expect(screen.getByText('Monthly rent roll: $96,453.85 to $97,770.78')).toBeInTheDocument();
    expect(screen.getByText(/Revision 1 · .* · Imported from the workbook · Historical import/)).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith('revisions', { facility_id: 'a', week_start: '2026-09-07' });
    fireEvent.click(screen.getByRole('button', { name: 'Hide changes' }));
    expect(screen.queryByText(/Revision 2/)).not.toBeInTheDocument();
  });
  it('refuses a revision list for another facility or meeting', async () => {
    mocks.request.mockResolvedValueOnce({ facility_id: 'b', week_start: '2026-09-07', revisions: [] });
    render(<StandUpHistory facilityId="a" facilityName="Homewood" reports={[report('r', '2026-09-07', { current_total_census: 34 })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'What changed · 1 revision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('did not match this facility and meeting');
  });
  it('derives per-field changes without treating a blank as zero', () => {
    const changes = revisionChanges([
      { version: 1, revision_id: 'a', status: 'draft', created_at: '2026-09-07T12:00:00Z', reason: null, values: { ...emptyValues(), callouts_last_week: 0 }, updated_by: null, updated_by_name: null },
      { version: 2, revision_id: 'b', status: 'ready', created_at: '2026-09-07T12:30:00Z', reason: null, values: { ...emptyValues(), callouts_last_week: null, overtime_reported: 17.15 }, updated_by: null, updated_by_name: 'Jessica' },
    ]);
    expect(changes[1].changes).toEqual(['Callouts last week: 0 to Not provided', 'Overtime last week: Not provided to 17h 15m']);
    expect(changes[1].origin).toBe('Submitted');
    expect(changes[0].changes).toEqual([]);
  });
});
